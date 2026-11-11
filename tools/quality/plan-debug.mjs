// Why does a topic get few planned facts? Plans one topic and prints, per subtopic, what the model returned and why facts were dropped.
//   node --import tsx tools/quality/plan-debug.mjs "urea cycle and its disorders" deeprelay
const BASE = 'http://localhost:3100';
const store = new Map();
const mk = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } });
globalThis.localStorage = mk(store);
globalThis.sessionStorage = mk(new Map());
const provider = process.argv[3] || 'deeprelay';
store.set('ai.activeProvider', provider);
store.set('ai.model.opencode', 'deepseek-v4.1-flash');
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (i, init) => realFetch(typeof i === 'string' && i.startsWith('/') ? BASE + i : i, init);
globalThis.__planDebug = [];

const ai = await import('../../src/lib/ai.ts');
const topic = process.argv[2];
const t0 = Date.now();
const split = await ai.splitTopic(topic, 'NEET_PG');
console.log(`split: ${split.subtopics.length} subtopics, facts asked ${split.facts.reduce((a, b) => a + b, 0)} (${Math.round((Date.now() - t0) / 1000)}s)`);
const plan = await ai.planTopicFacts(topic, split.subtopics, split.facts, provider);
console.log(`plan: ${plan.length} facts (${Math.round((Date.now() - t0) / 1000)}s)`);
for (const d of globalThis.__planDebug) console.log(JSON.stringify(d));
process.exit(0);
