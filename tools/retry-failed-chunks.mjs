// Re-asks Luna for the chunks that came back empty (failed) in a <slug>-pdf-raw.json file, then rewrites the
// matching <slug>-pdf-topics.json (unique topics; the finalize step does the real merge).
// Usage: node tools/retry-failed-chunks.mjs "<Subject>" <raw-file-without-folder> [concurrency]
import fs from 'node:fs';
const [SUBJ, RAW, CONC = '6'] = process.argv.slice(2);
const D = 'docs/chapter-topics/';
const OCR = 'C:/ad/book-work/ocr/';
const LIB = 'C:/ad/book-work/library/by_subject/' + SUBJ + '/';
const sys = 'You read OCR text (some noisy, with watermarks and garbled handwriting) of a standard medical exam-prep book/notes. List every distinct topic this block of pages teaches that NEET-PG / INI-CET could ask. Reply ONLY JSON: {"topics":[{"topic":"short clear name","facts":"key testable facts in <=25 words","importance":"Very high|High|Medium|Low"}]}. Ignore watermarks, ads and page furniture. Skip text that is too garbled to understand. One entry per distinct topic (nerve, structure, syndrome, landmark, concept, drug, etc.).';
let active = 0; const waiters = [];
const slot = async () => { while (active >= Number(CONC)) await new Promise((r) => waiters.push(r)); active++; };
const free = () => { active--; const w = waiters.shift(); if (w) w(); };
const call = async (content) => {
  for (let a = 0; a < 6; a++) {
    await slot();
    try {
      const r = await fetch('http://localhost:3100/api/ai/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'chatgpt', model: 'gpt-6-luna', system: sys, json: true, messages: [{ role: 'user', content }] }) });
      const j = await r.json();
      return JSON.parse(String(j.text).match(/\{[\s\S]*\}/)[0]);
    } catch { /* pause and retry */ } finally { free(); }
    await new Promise((r) => setTimeout(r, 4000 * (a + 1)));
  }
  return null;
};
const pagesOf = (f) => {
  if (fs.existsSync(OCR + f + '.jsonl')) return fs.readFileSync(OCR + f + '.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return fs.readFileSync(LIB + f + '.txt', 'utf8').split(/^=== page (\d+) ===$/m).reduce((a, x, i, arr) => { if (i % 2 === 1) a.push({ page: Number(x), text: arr[i + 1] || '' }); return a; }, []);
};
const raw = JSON.parse(fs.readFileSync(D + RAW, 'utf8'));
const cache = new Map();
const bad = raw.filter((c) => c.topics === null);
console.log('failed chunks to redo:', bad.length, 'of', raw.length);
let done = 0;
await Promise.all(bad.map(async (c) => {
  if (!cache.has(c.f)) cache.set(c.f, pagesOf(c.f));
  const chunk = cache.get(c.f).filter((p) => p.page >= c.from && p.page <= c.to);
  const text = chunk.map((p) => '[page ' + p.page + ']\n' + String(p.text || '').slice(0, 3500)).join('\n\n');
  const v = await call('Book: ' + c.f + '\n' + text);
  if (v) c.topics = v.topics || [];
  done++; if (done % 10 === 0) console.log(done + '/' + bad.length);
}));
fs.writeFileSync(D + RAW, JSON.stringify(raw));
const still = raw.filter((c) => c.topics === null).length;
const m = new Map();
for (const c of raw) for (const t of c.topics || []) {
  const k = String(t.topic).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (!k) continue;
  const o = m.get(k);
  if (!o) m.set(k, { topic: t.topic, group: '', importance: t.importance || 'Medium', books: [c.f], how_asked: String(t.facts || '').slice(0, 160) });
  else { if (!o.books.includes(c.f)) o.books.push(c.f); if (t.importance === 'Very high') o.importance = 'Very high'; }
}
const out = RAW.replace('-raw.json', '-topics.json');
// keep the merged file (with real group headings) if one with topics already exists and nothing was recovered into it
fs.writeFileSync(D + out, JSON.stringify([...m.values()], null, 1));
console.log('RETRY DONE', RAW, 'still failed', still, 'unique topics', m.size);
