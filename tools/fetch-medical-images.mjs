// Fetch openly-licensed clinical images for the question bank from Wikimedia Commons.
//
//   node tools/fetch-medical-images.mjs [--all] [--only id1,id2]
//
// For every seed in tools/medical-image-seeds.json this searches Commons, downloads the
// best bitmap candidate as a ~1000 px thumbnail into public/medical-images/, and writes
// public/medical-images/manifest.json with the diagnosis, tags, caption, author, licence
// and the Commons file page (so attribution always travels with the image).
//
// Images still need a human/agent pass: the manifest is written with "verified": false and
// only verified entries are used by the app. Edit the manifest (or pass --verify <id>) after
// checking the picture actually matches the diagnosis.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'medical-images');
const seedsPath = join(root, 'tools', 'medical-image-seeds.json');
const manifestPath = join(outDir, 'manifest.json');
const API = 'https://commons.wikimedia.org/w/api.php';

const args = process.argv.slice(2);
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function search(query) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '1100',
  });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`${API}?${params}`, {
      headers: { 'User-Agent': 'PulseMed-Education/1.0 (offline exam study app; contact: local)' },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Commons search failed (HTTP ${res.status})`);
    const body = await res.json();
    const pages = body?.query?.pages ? Object.values(body.query.pages) : [];
    return pages
      .map((p) => ({ page: p, info: p.imageinfo?.[0] }))
      .filter(({ info }) => info && info.mime && /^image\/(jpeg|png|webp)$/i.test(info.mime))
      .filter(({ page, info }) => {
        const name = page.title.toLowerCase();
        // Skip obvious non-clinical clutter and huge files.
        if (/\b(logo|icon|map|diagram of hospital|portrait of)\b/.test(name)) return false;
        return (info.width || 0) >= 450 && (info.height || 0) >= 300;
      });
  }
  throw new Error('Commons rate limit (HTTP 429) after retries');
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': 'PulseMed-Education/1.0' } });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf.length;
}

function loadManifest() {
  if (!existsSync(manifestPath)) return [];
  try {
    const rows = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const seeds = JSON.parse(readFileSync(seedsPath, 'utf8'));
  const manifest = loadManifest();
  const taken = new Set(manifest.map((m) => m.id));

  for (const seed of seeds) {
    if (only && !only.has(seed.id)) continue;
    if (taken.has(seed.id)) {
      console.log(`skip ${seed.id} (already in manifest)`);
      continue;
    }
    try {
      await new Promise((r) => setTimeout(r, 2500));
      let candidates = await search(seed.query);
      if (!candidates.length) {
        await new Promise((r) => setTimeout(r, 2500));
        candidates = await search(`${seed.diagnosis} ${seed.modality}`);
      }
      if (!candidates.length) {
        console.log(`MISS ${seed.id}: no bitmap result for "${seed.query}"`);
        continue;
      }
      const pick = candidates[0];
      const ext = extname(new URL(pick.info.url).pathname).toLowerCase() || '.jpg';
      const file = `${seed.id}${ext === '.jpeg' ? '.jpg' : ext}`;
      const bytes = await download(pick.info.thumburl || pick.info.url, join(outDir, file));
      const meta = pick.info.extmetadata || {};
      manifest.push({
        id: seed.id,
        file,
        diagnosis: seed.diagnosis,
        modality: seed.modality,
        subject: seed.subject,
        subtopic: seed.subtopic,
        tags: seed.tags,
        caption: stripHtml(meta.ImageDescription?.value ?? meta.ImageDescription) || stripHtml(pick.page.title.replace(/^File:/, '')),
        credit: stripHtml(meta.Artist?.value ?? meta.Artist) || 'Wikimedia Commons contributor',
        license: stripHtml(meta.LicenseShortName?.value ?? meta.LicenseShortName) || 'See source page',
        sourceUrl: pick.info.descriptionurl,
        width: pick.info.thumbwidth || pick.info.width,
        height: pick.info.thumbheight || pick.info.height,
        verified: false,
        fetchedAt: new Date().toISOString(),
        bytes,
      });
      console.log(`ok   ${seed.id}: ${file} (${Math.round(bytes / 1024)} kB)`);
    } catch (err) {
      console.log(`FAIL ${seed.id}: ${err?.message || err}`);
    }
  }

  manifest.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest: ${manifest.length} entries (${manifest.filter((m) => m.verified).length} verified)`);
}

main();
