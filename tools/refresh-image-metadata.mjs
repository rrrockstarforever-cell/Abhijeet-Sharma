// Repair/refresh attribution for entries already in public/medical-images/manifest.json.
// Reads each sourceUrl's Commons title and fills credit + license (the first fetch wrote
// "[object Object]" because extmetadata values are objects with a .value field).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'public', 'medical-images', 'manifest.json');
const API = 'https://commons.wikimedia.org/w/api.php';
const strip = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let changed = 0;

for (const entry of manifest) {
  if (!entry.sourceUrl) continue;
  const hasAttribution =
    entry.credit && entry.credit !== '[object Object]' && entry.license && entry.license !== '[object Object]';
  if (hasAttribution) continue;
  const title = decodeURIComponent(entry.sourceUrl.split('/wiki/')[1] || '');
  if (!title) continue;
  try {
    await new Promise((r) => setTimeout(r, 6000));
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      titles: title,
      prop: 'imageinfo',
      iiprop: 'extmetadata',
    });
    const res = await fetch(`${API}?${params}`, {
      headers: { 'User-Agent': 'PulseMed-Education/1.0' },
    });
    if (!res.ok) {
      console.log(`skip ${entry.id} (HTTP ${res.status})`);
      continue;
    }
    const body = await res.json();
    const page = Object.values(body?.query?.pages || {})[0];
    const meta = page?.imageinfo?.[0]?.extmetadata;
    if (!meta) {
      console.log(`skip ${entry.id} (no metadata)`);
      continue;
    }
    entry.credit = strip(meta.Artist?.value) || 'Wikimedia Commons contributor';
    entry.license = strip(meta.LicenseShortName?.value) || 'See source page';
    // Long Commons descriptions are not useful as exam captions; keep a trimmed fallback
    // only when the entry has no hand-written caption yet.
    if (!entry.caption || entry.caption === '[object Object]') {
      entry.caption = strip(meta.ImageDescription?.value).slice(0, 220) || entry.diagnosis;
    }
    changed += 1;
    console.log(`ok   ${entry.id}: ${entry.license}`);
  } catch (err) {
    console.log(`FAIL ${entry.id}: ${err?.message || err}`);
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nupdated ${changed}/${manifest.length} entries`);
