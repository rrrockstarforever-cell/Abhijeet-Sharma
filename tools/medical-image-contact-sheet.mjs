// Build a review contact sheet for the verified-image library.
//   node tools/medical-image-contact-sheet.mjs
// Opens nothing itself — point the app (or any browser) at
// public/medical-images/contact-sheet.html to eyeball every picture next to its diagnosis.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'medical-images');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

const cards = manifest
  .map(
    (m) => `
    <figure>
      <img src="${m.file}" alt="${m.diagnosis}" loading="lazy" />
      <figcaption>
        <strong>${m.diagnosis}</strong>
        <span class="badge ${m.verified ? 'ok' : 'no'}">${m.verified ? 'verified' : 'UNVERIFIED'}</span>
        <div class="meta">${m.modality} · ${m.subject} · ${m.subtopic}</div>
        <div class="meta">${m.license} · ${m.sourceUrl || ''}</div>
        <div class="tags">${(m.tags || []).join(' · ')}</div>
        <div class="id">${m.id}</div>
      </figcaption>
    </figure>`,
  )
  .join('\n');

writeFileSync(
  join(dir, 'contact-sheet.html'),
  `<!doctype html><meta charset="utf-8"><title>Pulse Med image library review</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; background:#f6f7f9; margin:24px; }
  h1 { font-size:18px; margin:0 0 16px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:16px; }
  figure { background:#fff; border:1px solid #e3e7ee; border-radius:12px; margin:0; overflow:hidden; }
  img { width:100%; height:190px; object-fit:contain; background:#0b1220; display:block; }
  figcaption { padding:10px; font-size:12px; }
  .meta, .tags, .id { color:#64748b; font-size:11px; margin-top:3px; }
  .id { font-family: ui-monospace, monospace; color:#0f8b8d; }
  .badge { font-size:10px; padding:1px 6px; border-radius:99px; margin-left:6px; }
  .badge.ok { background:#dcfce7; color:#166534; }
  .badge.no { background:#fee2e2; color:#991b1b; }
</style>
<h1>Pulse Med — clinical image library (${manifest.length} entries, ${manifest.filter((m) => m.verified).length} verified)</h1>
<div class="grid">${cards}</div>`,
);
console.log(`wrote ${join(dir, 'contact-sheet.html')}`);
