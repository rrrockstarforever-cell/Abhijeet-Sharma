// Reads a runner output file and prints what to fix: totals against the targets, failures grouped by kind, and the
// flagged questions. Usage: node tools/quality/analyze.mjs out.json [--examples 3]
import fs from 'node:fs';

const file = process.argv[2];
const per = Number(process.argv[process.argv.indexOf('--examples') + 1]) || 3;
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = run.results.filter((r) => !r.error);
const errors = run.results.filter((r) => r.error);
const sum = (k) => R.reduce((a, r) => a + (r[k] || 0), 0);
const n = sum('kept');
const pct = (x) => `${x} (${n ? Math.round((100 * x) / n) : 0}%)`;
const avgRel = R.length ? (R.reduce((a, r) => a + (r.avgRelevance || 0), 0) / R.length).toFixed(2) : '-';

const targets = [
  ['wrong answers', sum('wrong'), (v) => v === 0],
  ['ambiguous', sum('ambiguous'), (v) => v <= 0.05 * n],
  ['style not delivered', sum('styleBad'), (v) => v <= 0.05 * n],
  ['explanation skips distractors', sum('expBad'), (v) => v <= 0.1 * n],
  ['dangling picture references', sum('dangling'), (v) => v === 0],
  ['low relevance', sum('lowRelevance'), (v) => v <= 0.05 * n],
];
console.log(`${R.length} cases, ${n} questions, ${errors.length} errors, average relevance ${avgRel} (target 3.8), yield ${run.yield}`);
for (const [name, v, ok] of targets) console.log(`${ok(v) ? 'OK  ' : 'FAIL'} ${name}: ${pct(v)}`);
const skew = R.filter((r) => r.setIssues.some((s) => s.includes('skewed')));
console.log(`${skew.length ? 'FAIL' : 'OK  '} letter skew: ${skew.map((r) => r.id).join(', ') || 'none'}`);
console.log(`pictures attached: ${sum('images')}; time per case ${Math.round(R.reduce((a, r) => a + r.seconds, 0) / Math.max(1, R.length))}s on average`);
if (errors.length) console.log('errors:', errors.map((e) => `${e.id}: ${e.error}`).join(' | '));

// Failing cases, worst first, with example questions of each kind.
const score = (r) => r.wrong * 5 + r.ambiguous * 3 + r.styleBad * 3 + r.dangling * 3 + r.expBad + r.lowRelevance;
const failing = R.filter((r) => score(r) > 0 || r.setIssues.length).sort((a, b) => score(b) - score(a));
console.log(`\ncases to fix next (${failing.length}): ${failing.map((r) => r.id).join(',')}`);
for (const r of failing.slice(0, 12)) {
  console.log(`\n## ${r.id} [${r.exam} ${r.style}] ${r.topic}: wrong ${r.wrong}, amb ${r.ambiguous}, style ${r.styleBad}, expl ${r.expBad}, dangling ${r.dangling}, low ${r.lowRelevance}; set: ${r.setIssues.join('; ') || '-'}`);
  for (const f of r.flagged.slice(0, per)) console.log(`  - ${f.stem.slice(0, 120)} || ${f.ask} => ${f.ans}\n      ${[...f.plain, f.judge].filter(Boolean).join(' | ')}`);
}
// Plain-rule reasons across the whole run.
const reasons = {};
for (const r of R) for (const f of r.flagged) for (const p of f.plain) reasons[p] = (reasons[p] || 0) + 1;
console.log('\nplain-rule reasons:', JSON.stringify(reasons));
