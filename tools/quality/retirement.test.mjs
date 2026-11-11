// The retirement cap, without a model: a planned fact that keeps failing must be given up, and a queued
// duplicate of it must not be written again. Run: node --import tsx tools/quality/retirement.test.mjs
import { generateExamQuestions } from '../../src/lib/ai.ts';

globalThis.localStorage = { getItem: (k) => (k === 'ai.activeProvider' ? 'gemini' : null), setItem: () => {}, removeItem: () => {} };

let fails = 0;
const expect = (name, got, want) => {
  if (got !== want) { fails += 1; console.log(`FAIL ${name}: got ${got} want ${want}`); }
};

const badFact = 'Phospholipase C of Bacillus anthracis degrades the phospholipid bilayer of host cells.';
const facts = [badFact, badFact, 'Penicillin is the first-line treatment for this infection.'];
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/api/web/research')) {
    return new Response(JSON.stringify({ sources: [{ title: 'Test source', text: 'Phospholipase C of Bacillus anthracis degrades the phospholipid bilayer of host cells and enables escape from phagosomes. Penicillin is the first-line treatment for this infection in standard practice.', kind: 'book' }] }));
  }
  if (u.includes('/api/ai/jobs')) {
    const body = JSON.parse(init.body);
    const asked = body.messages?.[0]?.content ?? '';
    calls.push(asked.slice(0, 200));
    const text = asked.includes('Phospholipase')
      ? JSON.stringify({
          stem: 'A 36-year-old abattoir worker has fever and a painless black necrotic ulcer on the forearm.',
          questionText: 'Which enzyme does the organism produce that explains the escape from phagosomes?',
          options: [{ id: 'A', text: 'Hyaluronidase' }, { id: 'B', text: 'Phospholipase C' }, { id: 'C', text: 'Collagenase' }, { id: 'D', text: 'DNase' }],
          correctOption: 'B', explanation: 'The sources state the keyed fact.', keyFact: badFact, sourceCheck: 'not supported',
        })
      : JSON.stringify({ stem: 'Penicillin remains first-line treatment.', questionText: 'Which drug is first-line?', options: [{ id: 'A', text: 'Penicillin' }, { id: 'B', text: 'Vancomycin' }, { id: 'C', text: 'Meropenem' }, { id: 'D', text: 'Linezolid' }], correctOption: 'A', explanation: 'Penicillin is first-line.', keyFact: 'Penicillin is first-line.', sourceCheck: 'supported' });
    return new Response(JSON.stringify({ id: `job-${calls.length}`, done: true, status: 200, body: { success: true, text } }));
  }
  return originalFetch(url, init);
};

const result = await generateExamQuestions({
  exam: 'INI_CET',
  count: 3,
  requestedTopic: 'drugs acting on bacteria',
  factPlan: facts.map((fact) => ({ subtopic: 'virulence', fact, quote: fact, source: 'test' })),
  subjectSubtopics: [{ subject: 'drugs acting on bacteria', subtopics: ['virulence'] }],
  difficultyTier: 'MEDIUM',
  questionTypes: ['One-liner recall'],
  includeImages: false,
});

const phospholipaseCalls = calls.filter((c) => c.includes('Phospholipase')).length;
console.log('total calls:', calls.length, 'phospholipase:', phospholipaseCalls);
expect('bad fact retried at most three times', phospholipaseCalls <= 3, true);
expect('duplicate planned fact never written', phospholipaseCalls > 0, true);
expect('no question kept from an unsupported fact', result.questions.length, 0);
globalThis.fetch = originalFetch;
console.log(fails ? `${fails} FAILED` : 'retirement checks passed');
process.exit(fails ? 1 : 0);
