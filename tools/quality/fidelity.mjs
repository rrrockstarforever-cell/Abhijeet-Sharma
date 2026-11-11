// How close are the generated sets to the real papers? Compares a runner output file with the PYQ statistics
// (tools/quality/pyq-stats.json: aggregate numbers only). Only the default-mix cases (style "mix") are compared.
//   node tools/quality/fidelity.mjs out.json
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const real = JSON.parse(fs.readFileSync(new URL('./pyq-stats.json', import.meta.url), 'utf8'));
const PATIENT = /\b(\d{1,3}[- ]?(?:year|yr|month|week|day)s?[- ]?(?:old)?|a (?:man|woman|boy|girl|patient|child|infant|neonate|baby|male|female))\b/i;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ');
const words = (s) => strip(s).trim().split(/\s+/).filter(Boolean).length;
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

const groups = { NEET_PG: { key: 'NEET-PG', qs: [] }, INI_CET: { key: 'INI-CET/AIIMS', qs: [] } };
for (const r of run.results) if (!r.error && r.style === 'mix' && groups[r.exam]) groups[r.exam].qs.push(...r.questions);

for (const [exam, g] of Object.entries(groups)) {
  const n = g.qs.length;
  if (!n) { console.log(`${exam}: no default-mix questions`); continue; }
  const ref = real[g.key];
  const stems = g.qs.map((q) => words(q.stem));
  const vignette = g.qs.filter((q) => PATIENT.test(q.stem) && words(q.stem) >= 22).length;
  const negative = g.qs.filter((q) => /\b(not|except|false|incorrect)\b/i.test(`${q.questionText} ${q.stem}`)).length;
  const picture = g.qs.filter((q) => q.image || /\b(x-?ray|radiograph|ecg|ekg|ct|mri|ultrasound|histolog|biopsy|smear|fundus|photograph|micrograph)\b/i.test(q.stem)).length;
  const optLen = g.qs.reduce((a, q) => a + q.options.reduce((x, o) => x + String(o.text).length, 0) / Math.max(1, q.options.length), 0) / n;
  const expWords = median(g.qs.map((q) => words(q.explanation)));
  const rows = [
    ['median stem words', median(stems), ref.stem_words.median, 8],
    ['patient vignettes %', Math.round((100 * vignette) / n), ref.style_share_pct.vignette, 12],
    ['NOT / EXCEPT %', Math.round((100 * negative) / n), 100 * 0.1, 10],
    ['picture-based %', Math.round((100 * picture) / n), 25, 12],
    ['mean option chars', Math.round(optLen), 20, 18],
    ['median explanation words', expWords, ref.explanation_words_median, 70],
  ];
  console.log(`\n${exam} (${n} generated questions) vs real papers`);
  for (const [name, got, want, tol] of rows) console.log(`${Math.abs(got - want) <= tol ? 'OK  ' : 'FAR '} ${name.padEnd(26)} generated ${String(got).padStart(4)}   real ${String(Math.round(want)).padStart(4)}`);
}
