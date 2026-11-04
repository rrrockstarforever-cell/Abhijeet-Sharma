// Runs one grid case with a small count and prints why questions were dropped.
//   node --import tsx tools/quality/debug-case.mjs mx-neet-ppi 4
import fs from 'node:fs';

const BASE = 'http://localhost:3100';
const store = new Map();
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(process.argv[5] || 'quality-plans.json', 'utf8')))) store.set(k, v); } catch { /* none */ }
const mk = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } });
globalThis.localStorage = mk(store);
globalThis.sessionStorage = mk(new Map());
store.set('ai.activeProvider', process.argv[4] || 'opencode');
store.set('ai.model.opencode', 'deepseek-v4.1-flash');
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (i, init) => realFetch(typeof i === 'string' && i.startsWith('/') ? BASE + i : i, init);

const { GRID } = await import('./grid.mjs');
const ai = await import('../../src/lib/ai.ts');
const c = GRID.find((x) => x.id === process.argv[2]);
const n = Number(process.argv[3] || 4);
const key = `pulse.quality.plan.v3.${c.exam}.${c.topic.toLowerCase()}`;
const cached = JSON.parse(store.get(key) || 'null');
if (!cached) { console.log('no cached plan for', key); process.exit(1); }
const qs = await import('../../src/lib/questionStyles.ts');
const subj = qs.subjectFromTopic(c.topic);
const planned = qs.planSlots(cached.plan.map((f) => ({ fact: f.fact, subtopic: f.subtopic, picturable: f.picturable })), c.exam, qs.stylesFromChips([], c.styles), qs.leadInsFromChips([], c.leadIns), 'ALL', subj);
console.log('subject', subj, 'plan facts', cached.plan.length, 'slot styles', JSON.stringify(planned.reduce((m, x) => { m[x.style] = (m[x.style] || 0) + 1; return m; }, {})));
const res = await ai.generateExamQuestions({
  exam: c.exam, count: n, requestedTopic: c.topic, factPlan: cached.plan,
  subjectSubtopics: [{ subject: c.topic, subtopics: cached.split.subtopics }],
  difficultyTier: 'ALL', questionTypes: [], stemPatterns: [], styles: c.styles || [], leadIns: c.leadIns || [],
  includeImages: false, usedUnits: new Set(), batchPromises: [],
});
const reasons = {};
for (const s of globalThis.__stageLog) if (s.stage.startsWith('drop:')) reasons[s.stage] = (reasons[s.stage] || 0) + 1;
console.log('kept', res.questions.length, 'failure', res.failure);
console.log('dropped reasons', JSON.stringify(reasons, null, 0));
for (const q of res.questions) console.log('-', q.stem.slice(0, 120), '||', q.questionText);
process.exit(0);
