// Writes a small My-books question set through the dev server and saves it, so the questions can be read and judged.
//   node --import tsx tools/quality/books-sample.mjs --topic "Antifungal drugs" --count 10 --out out.json [--provider deeprelay] [--model gpt-6-luna] [--books 0] [--base http://localhost:3100]
import fs from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:3100');
const store = new Map();
const mk = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } });
globalThis.localStorage = mk(store); globalThis.sessionStorage = mk(new Map());
store.set('ai.activeProvider', arg('provider', 'deeprelay'));
if (arg('model')) store.set(`ai.model.${arg('provider', 'deeprelay')}`, arg('model'));
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (i, init) => realFetch(typeof i === 'string' && i.startsWith('/') ? BASE + i : i, init);
const { splitTopic, planTopicFacts, generateExamQuestions, getActiveProvider } = await import('../../src/lib/ai.ts');
const topic = arg('topic', 'Antifungal drugs'); const count = Number(arg('count', '10'));
const split = await splitTopic(topic, 'NEET_PG');
const plan = await planTopicFacts(topic, split.subtopics, split.facts, getActiveProvider(), true);
const target = Math.min(count, plan.length || count);
const r = await generateExamQuestions({ exam: 'NEET_PG', count: target, requestedTopic: topic, factPlan: plan.length ? plan : undefined,
  subjectSubtopics: [{ subject: topic, subtopics: split.subtopics.length ? split.subtopics : [topic] }], difficultyTier: 'ALL',
  questionTypes: [], stemPatterns: [], styles: [], leadIns: [], includeImages: false, booksOnly: arg('books', '1') !== '0', usedUnits: new Set(), batchPromises: [] });
fs.writeFileSync(arg('out', 'books-sample.json'), JSON.stringify({ topic, plan, ...r }, null, 1));
console.log(`plan ${plan.length}, kept ${r.questions.length}, dropped ${r.dropped}, failure ${r.failure}`);
process.exit(0);
