// Live clinical-image search for image-based questions.
//
// Sources and why only some are embedded:
//   • Open-i (NLM) — searches open-access PubMed Central figures and exposes each figure's
//     licence and article. Only CC BY / CC BY-SA / CC0 / public-domain figures are returned,
//     so the picture can be shown with attribution. This is the live provider.
//   • Wikimedia Commons (CDC PHIL, Radiopaedia-style cases, etc.) — the curated local
//     library in public/medical-images/ already comes from here.
//   • Radiopaedia, DermNet, RSNA Case Collection, Columbia Ophthalmology Atlas, LITFL,
//     MedPix — copyrighted / "personal use only" terms. They are offered as reference
//     links in the UI, never scraped into the app.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_ROOT = process.env.PULSE_DATA_DIR || join(homedir(), '.pulse-med');
const CACHE_DIR = join(DATA_ROOT, 'image-cache');
const OPENI = 'https://openi.nlm.nih.gov';
const UA = 'PulseMed-Education/1.0 (offline exam study app)';

const stripHtml = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Only licences that allow redistribution inside a study app. */
function licenceOf(entry) {
  const cc = String(entry.ccLicense || '').toLowerCase();
  const url = String(entry.licenseURL || '');
  if (cc === 'by' || /creativecommons\.org\/licenses\/by\//i.test(url)) {
    return { label: 'CC BY', url };
  }
  if (cc === 'bysa' || cc === 'by-sa' || /creativecommons\.org\/licenses\/by-sa\//i.test(url)) {
    return { label: 'CC BY-SA', url };
  }
  if (/publicdomain\/zero/i.test(url)) return { label: 'CC0', url };
  if (/publicdomain\/mark/i.test(url)) return { label: 'Public domain', url };
  return null; // NC / ND / unknown — not reusable here
}

function normalise(entry) {
  const licence = licenceOf(entry);
  if (!licence) return null;
  const large = entry.imgLarge || entry.imgThumbLarge || entry.imgThumb;
  if (!large || !/^\/imgs\//.test(large)) return null;

  const caption = stripHtml(entry.image?.caption) || stripHtml(entry.image?.mention);
  if (!caption) return null;

  const imageUrl = `${OPENI}${large}`;
  const authors = stripHtml(entry.authors);
  const journal = stripHtml(entry.journal_abbr || entry.journal_title);
  const credit = [authors, journal].filter(Boolean).join(' · ').slice(0, 160) || 'PubMed Central';

  return {
    id: createHash('sha1').update(imageUrl).digest('hex').slice(0, 16),
    provider: 'Open-i · NLM',
    title: stripHtml(entry.title).slice(0, 160),
    caption: caption.slice(0, 400),
    credit,
    licence: licence.label,
    licenceUrl: licence.url,
    articleUrl: entry.pmc_url || entry.pubMed_url || '',
    modality: entry.image?.modalityMajor || '',
    imageUrl,
    proxyUrl: `/api/images/proxy?u=${encodeURIComponent(imageUrl)}`,
    thumbUrl: entry.imgGrid150 ? `${OPENI}${entry.imgGrid150}` : `${OPENI}${large}`,
  };
}

/** Search Open-i for reusable figures. Returns [] on no match; throws only on network errors. */
export async function searchImages(query, { limit = 6 } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return { results: [], errors: [] };
  const errors = [];
  const [commons, openi] = await Promise.all([
    searchCommons(q, { limit: Math.ceil(limit / 2) }).catch((err) => {
      errors.push(`Wikimedia Commons: ${err?.message || err}`);
      return [];
    }),
    searchOpenI(q, { limit }).catch((err) => {
      errors.push(`Open-i: ${err?.message || err}`);
      return [];
    }),
  ]);
  const seen = new Set();
  const merged = [];
  // Commons first: usually a single clean picture rather than a multi-panel journal figure.
  for (const item of [...commons, ...openi]) {
    if (seen.has(item.imageUrl)) continue;
    seen.add(item.imageUrl);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return { results: merged, errors };
}

/** Wikimedia Commons search (also covers CDC PHIL material). Licence-filtered. */
async function searchCommons(q, { limit = 3 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '1000',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Commons returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const pages = body?.query?.pages ? Object.values(body.query.pages) : [];
  const out = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp|gif)$/i.test(info.mime || '')) continue;
    if ((info.width || 0) < 400 || (info.height || 0) < 250) continue;
    const meta = info.extmetadata || {};
    const licenceName = stripHtml(meta.LicenseShortName?.value);
    if (!/public domain|cc0|cc by(?!-nc|-nd)/i.test(licenceName)) continue;
    if (/non-?commercial|-nc|no-?deriv|-nd/i.test(licenceName)) continue;
    const imageUrl = info.thumburl || info.url;
    if (!imageUrl) continue;
    out.push({
      id: createHash('sha1').update(imageUrl).digest('hex').slice(0, 16),
      provider: 'Wikimedia Commons',
      title: stripHtml(page.title.replace(/^File:/, '')).slice(0, 160),
      caption: stripHtml(meta.ImageDescription?.value).slice(0, 400),
      credit: stripHtml(meta.Artist?.value).slice(0, 160) || 'Wikimedia Commons contributor',
      licence: licenceName,
      licenceUrl: info.descriptionurl || '',
      articleUrl: info.descriptionurl || '',
      modality: '',
      imageUrl,
      proxyUrl: `/api/images/proxy?u=${encodeURIComponent(imageUrl)}`,
      thumbUrl: info.thumburl || imageUrl,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchOpenI(q, { limit = 6 } = {}) {
  const params = new URLSearchParams({ query: q, m: '1', n: String(Math.max(12, limit * 4)) });
  const res = await fetch(`${OPENI}/api/search?${params}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Open-i returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const list = Array.isArray(body?.list) ? body.list : [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const item = normalise(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Fetch (and cache) one external figure so the app never hotlinks the source site. */
export async function fetchImage(url) {
  const target = String(url || '');
  const allowed =
    /^https:\/\/openi\.nlm\.nih\.gov\/imgs\/[\w./%\-]+$/.test(target) ||
    /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/[\w./%\-]+(?:\?[\w=&.%\-]+)?$/.test(target);
  if (!allowed) {
    throw new Error('Unsupported image host.');
  }
  const key = createHash('sha1').update(target).digest('hex');
  const file = join(CACHE_DIR, key);
  if (existsSync(file)) {
    return { buffer: readFileSync(file), type: sniffType(file) };
  }
  const res = await fetch(target, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Image fetch failed (HTTP ${res.status})`);
  const type = res.headers.get('content-type') || 'image/png';
  if (!/^image\//.test(type)) throw new Error('Upstream did not return an image.');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Image too large.');
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, buffer);
  return { buffer, type };
}

function sniffType(file) {
  const head = readFileSync(file).subarray(0, 4);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  return 'image/png';
}

/** Reference-only sources (never scraped) shown in Settings. */
export const REFERENCE_SOURCES = [
  { name: 'Radiopaedia', url: 'https://radiopaedia.org/', note: 'Radiologist-reviewed cases. Copyright — open the case on their site.' },
  { name: 'DermNet', url: 'https://dermnetnz.org/images', note: 'Dermatology atlas. Copyright — reference only.' },
  { name: 'RSNA Case Collection', url: 'https://cases.rsna.org/', note: 'Peer-reviewed radiology cases. Copyright — reference only.' },
  { name: 'MedPix (NLM)', url: 'https://medpix.nlm.nih.gov/', note: 'Personal/local teaching use only; permission needed for redistribution.' },
  { name: 'Columbia Ophthalmology Atlas', url: 'https://www.vagelos.columbia.edu/departments-centers/ophthalmology/education/digital-reference-ophthalmology', note: 'Fundus/eye atlas. Reference only.' },
  { name: 'Life in the Fast Lane', url: 'https://litfl.com/library/', note: 'ECGs and emergency cases. Copyright — reference only.' },
  { name: 'CDC PHIL', url: 'https://wwwn.cdc.gov/phil/', note: 'Public-health images; many are public domain, surfaced here via Wikimedia Commons.' },
];
