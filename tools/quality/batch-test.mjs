// Batch quality test for the topic-to-MCQ generator. Run it inside the dev app (the page supplies the AI sign-in):
//   const t = await import('/tools/quality/batch-test.mjs'); const out = await t.runMatrix(t.MATRIX, { parallel: 3 });
// Each case plans facts and writes questions exactly as the Practice Builder does, then scores the result with
// plain checks (no model) and one model judge call per case. Nothing is saved to the question bank.
import { splitTopic, planTopicFacts, generateExamQuestions, getActiveProvider, getEffectiveModel, aiComplete, extractJson } from '/src/lib/ai.ts';
import { stemSimilarity } from '/src/lib/benchmark.ts';

/** Topics across subjects and shapes, with the question styles the Builder offers. */
export const MATRIX = [
  { id: 'drug-ppi', topic: 'adverse effects of proton pump inhibitors', exam: 'INI_CET', count: 20 },
  { id: 'drug-att', topic: 'side effects of antitubercular drugs', exam: 'NEET_PG', count: 20, stemPatterns: ['Drug of choice'] },
  { id: 'med-nephrotic', topic: 'nephrotic syndrome', exam: 'INI_CET', count: 20, questionTypes: ['Clinical vignette'] },
  { id: 'med-dka', topic: 'diabetic ketoacidosis', exam: 'NEET_PG', count: 20, stemPatterns: ['Next best step'] },
  { id: 'anat-brachial', topic: 'brachial plexus injuries', exam: 'NEET_PG', count: 20, questionTypes: ['One-liner recall'] },
  { id: 'physio-cardiac', topic: 'cardiac cycle', exam: 'NEET_PG', count: 20, questionTypes: ['One-liner recall'] },
  { id: 'biochem-urea', topic: 'urea cycle and its disorders', exam: 'NEET_PG', count: 20 },
  { id: 'path-necrosis', topic: 'types of necrosis', exam: 'NEET_PG', count: 15, questionTypes: ['Match the following'] },
  { id: 'micro-malaria', topic: 'malaria diagnosis and treatment', exam: 'INI_CET', count: 20 },
  { id: 'surg-appendicitis', topic: 'acute appendicitis', exam: 'NEET_PG', count: 20, stemPatterns: ['Investigation of choice'] },
  { id: 'obg-preeclampsia', topic: 'pre-eclampsia', exam: 'INI_CET', count: 20 },
  { id: 'psm-screening', topic: 'screening tests sensitivity and specificity', exam: 'NEET_PG', count: 15 },
  { id: 'forensic-pm', topic: 'postmortem changes and time since death', exam: 'NEET_PG', count: 15 },
  { id: 'chapter-lung', topic: 'lung chapter', exam: 'INI_CET', count: 30 },
  { id: 'amc-chest', topic: 'chest pain in general practice', exam: 'AMC_CAT', count: 20 },
];

const GENERIC_LEAD = /^(which of the following|what is the most likely diagnosis)\??$/i;
const HEDGE = /\b(may|might|possibly|uncertain|unclear|remains? to be|not well understood)\b/i;
const PATIENT = /\b(\d{1,2}[- ]year[- ]old|\d+ ?(month|week|day)s?[- ]old|a (man|woman|boy|girl|patient|child|infant|neonate))\b/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const correctText = (q) => (q.options.find((o) => o.id === q.correctOption)?.text) || '';

/** Checks that need no model. Returns one list of problems per question and set-level problems. */
export function plainChecks(questions) {
  const per = questions.map((q) => {
    const issues = [];
    const opts = q.options || [];
    if (opts.length < 4) issues.push('fewer than 4 options');
    const texts = opts.map((o) => norm(o.text));
    if (new Set(texts).size !== texts.length) issues.push('duplicate options');
    const ans = norm(correctText(q));
    if (!ans) issues.push('no correct option');
    if (ans.length >= 6 && norm(q.stem).includes(ans)) issues.push('answer appears in stem');
    if (GENERIC_LEAD.test(String(q.questionText || '').trim())) issues.push('generic question line');
    if (!q.explanation || String(q.explanation).trim().length < 40) issues.push('thin explanation');
    if (HEDGE.test(String(q.explanation || '').slice(0, 160)) && /\b(is|are)\b/.test(String(q.questionText))) issues.push('hedged explanation');
    const lens = opts.map((o) => String(o.text).length);
    const longest = lens.indexOf(Math.max(...lens));
    if (opts[longest]?.id === q.correctOption && Math.max(...lens) > 2.2 * (lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length))) issues.push('correct option is conspicuously longest');
    return issues;
  });
  const set = [];
  const answers = questions.map((q) => norm(correctText(q)));
  const dupAnswers = answers.filter((a, i) => a && answers.indexOf(a) !== i).length;
  if (dupAnswers) set.push(`${dupAnswers} repeated answers`);
  let nearDup = 0;
  for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
    if (stemSimilarity(norm(questions[i].stem + ' ' + questions[i].questionText), norm(questions[j].stem + ' ' + questions[j].questionText)) >= 0.6) nearDup += 1;
  }
  if (nearDup) set.push(`${nearDup} near-duplicate question pairs`);
  const cases = questions.filter((q) => PATIENT.test(q.stem)).length;
  const letters = questions.map((q) => q.correctOption);
  const share = Math.max(...['A', 'B', 'C', 'D', 'E'].map((l) => letters.filter((x) => x === l).length)) / Math.max(1, questions.length);
  if (questions.length >= 8 && share > 0.4) set.push(`correct letter skewed (${Math.round(share * 100)}% one letter)`);
  return { per, set, patientShare: questions.length ? cases / questions.length : 0 };
}

const JUDGE_SYSTEM =
  'You are a strict NEET-PG / INI-CET / AMC examiner reviewing MCQs. For each numbered question decide: ' +
  '"correct" (the marked answer is right by standard textbooks and guidelines), "single" (exactly one option is defensible), ' +
  '"relevance" (1-5: how likely an exam is to test this fact; 1 = research trivia or filler), "clear" (stem unambiguous and complete), ' +
  'and a short "issue" (empty if none). Reply with ONLY JSON: {"items":[{"n":1,"correct":true,"single":true,"relevance":4,"clear":true,"issue":""}]}';

async function judge(topic, questions, provider) {
  if (!questions.length) return [];
  const list = questions.map((q, i) => `${i + 1}. ${q.stem}\n${q.questionText}\n` + q.options.map((o) => `${o.id}) ${o.text}`).join('\n') + `\nMarked answer: ${q.correctOption}\nExplanation: ${String(q.explanation || '').slice(0, 300)}`).join('\n\n');
  const raw = await aiComplete({ system: JUDGE_SYSTEM, messages: [{ role: 'user', content: `Topic: ${topic}\n\n${list}` }], json: true, effort: 'medium', provider, model: getEffectiveModel(provider) }).catch(() => '');
  return extractJson(raw)?.items ?? [];
}

async function stats() {
  try { return await fetch('/api/ai/nvidia-stats').then((r) => r.json()); } catch { return null; }
}

/** Runs one case end to end. Returns its questions, plan and scores. */
export async function runCase(c) {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider is active in this page.');
  const t0 = Date.now();
  // The split and the fact plan are kept for a day per topic, so a rerun goes straight to writing questions.
  const cacheKey = `pulse.quality.plan.${c.exam}.${c.topic.toLowerCase()}`;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { cached = null; }
  let split;
  let plan;
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000 && cached.plan?.length) {
    ({ split, plan } = cached);
  } else {
    split = await splitTopic(c.topic, c.exam);
    plan = split.subtopics.length ? await planTopicFacts(c.topic, split.subtopics, split.facts, provider) : [];
    try { if (plan.length) localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), split, plan })); } catch { /* storage full */ }
  }
  const factsTotal = split.facts.reduce((a, b) => a + b, 0);
  const target = Math.max(1, Math.min(c.count, plan.length ? Math.min(plan.length, factsTotal) : factsTotal));
  const moduleUnits = new Set();
  const args = {
    exam: c.exam, count: target, requestedTopic: c.topic, factPlan: plan.length ? plan : undefined,
    subjectSubtopics: [{ subject: c.topic, subtopics: split.subtopics.length ? split.subtopics : [c.topic] }],
    difficultyTier: c.tier || 'ALL', questionTypes: c.questionTypes || [], stemPatterns: c.stemPatterns || [],
    includeImages: c.images !== false, usedUnits: moduleUnits, batchPromises: [],
  };
  let result = await generateExamQuestions(args);
  let questions = result.questions;
  let dropped = result.dropped;
  for (let round = 2; round <= 3 && questions.length < target && !result.failure; round++) {
    const more = await generateExamQuestions({ ...args, count: Math.min(2 * (target - questions.length), 60), existing: questions });
    questions = [...questions, ...more.questions];
    dropped += more.dropped;
    result = more;
  }
  const checks = plainChecks(questions);
  const judged = await judge(c.topic, questions, provider);
  const verdict = questions.map((q, i) => ({ q, plain: checks.per[i], j: judged.find((x) => Number(x.n) === i + 1) || null }));
  const bad = verdict.filter((v) => v.plain.length || (v.j && (!v.j.correct || !v.j.single || !v.j.clear || v.j.relevance <= 2)));
  return {
    id: c.id, topic: c.topic, requested: c.count, planned: plan.length, target, kept: questions.length, dropped,
    seconds: Math.round((Date.now() - t0) / 1000),
    wrong: verdict.filter((v) => v.j && !v.j.correct).length,
    ambiguous: verdict.filter((v) => v.j && !v.j.single).length,
    lowRelevance: verdict.filter((v) => v.j && v.j.relevance <= 2).length,
    avgRelevance: judged.length ? +(judged.reduce((a, x) => a + (Number(x.relevance) || 0), 0) / judged.length).toFixed(2) : null,
    images: questions.filter((q) => q.image).length,
    plainFlags: checks.per.filter((p) => p.length).length,
    setIssues: checks.set, patientShare: +checks.patientShare.toFixed(2),
    flagged: bad.map((v) => ({ stem: v.q.stem.slice(0, 110), ask: String(v.q.questionText).slice(0, 110), ans: correctText(v.q).slice(0, 60), plain: v.plain, judge: v.j && (v.j.issue || ((!v.j.correct ? 'WRONG ' : '') + (!v.j.single ? 'AMBIGUOUS ' : '') + (v.j.relevance <= 2 ? 'LOW-RELEVANCE' : ''))) })),
    questions,
  };
}

/** Runs many cases with a small number at once (the provider rate-limits bursts). */
export async function runMatrix(allCases, { parallel = 3, onDone, maxCount = 0 } = {}) {
  // maxCount shortens every case (for a quick run): 12 questions per topic is enough to see the same problems.
  const cases = maxCount ? allCases.map((c) => ({ ...c, count: Math.min(c.count, maxCount) })) : allCases;
  const out = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      try { out[i] = await runCase(cases[i]); } catch (e) { out[i] = { id: cases[i].id, topic: cases[i].topic, error: String(e?.message || e) }; }
      onDone?.(out[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, cases.length) }, worker));
  // The server counters reset whenever a case starts, so yield is counted from what each case reports.
  const kept = out.reduce((a, r) => a + (r.kept || 0), 0);
  const dropped = out.reduce((a, r) => a + (r.dropped || 0), 0);
  const started = kept + dropped;
  return { results: out, started, kept, yield: started ? +(kept / started).toFixed(2) : null };
}

/** One-line table of a run. */
export function summarize(run) {
  return run.results.map((r) => r.error ? `${r.id}: ERROR ${r.error}` : `${r.id}: kept ${r.kept}/${r.target} (planned ${r.planned}, asked ${r.requested}) wrong ${r.wrong} ambiguous ${r.ambiguous} lowRel ${r.lowRelevance} avgRel ${r.avgRelevance} images ${r.images} plainFlags ${r.plainFlags} patients ${r.patientShare} set[${r.setIssues.join('; ')}] ${r.seconds}s`).join('\n') + `\nYIELD ${run.kept}/${run.started} = ${run.yield}`;
}
