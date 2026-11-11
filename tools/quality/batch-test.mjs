// Quality test for the topic-to-MCQ generator. It runs under the headless runner (tools/quality/run.mjs) or inside the
// dev app page. Each case plans facts and writes questions exactly as the Practice Builder does, then scores the result
// with plain rules (no model) and one model judge call per case. Nothing is saved to the question bank.
import { splitTopic, planTopicFacts, generateExamQuestions, getActiveProvider, getEffectiveModel, aiComplete, extractJson } from '../../src/lib/ai.ts';
import { stemSimilarity } from '../../src/lib/benchmark.ts';
import { STYLES, styleProblem, pointsAtMissingPicture, explainsDistractors } from '../../src/lib/questionStyles.ts';

export const MATRIX = [];

const GENERIC_LEAD = /^which of the following\??$/i;
const HEDGE = /\b(may|might|possibly|uncertain|unclear|remains? to be|not well understood)\b/i;
const PATIENT = /\b(\d{1,2}[- ]year[- ]old|\d+ ?(month|week|day)s?[- ]old|a (man|woman|boy|girl|patient|child|infant|neonate))\b/i;
const OPTION_COUNT = { NEET_PG: 4, INI_CET: 4, AMC_CAT: 5 };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const correctText = (q) => (q.options.find((o) => o.id === q.correctOption)?.text) || '';

/** The slot a declared style stands for, so the same validators the app uses can be applied to the output. */
function declaredSlot(style) {
  if (!style || style === 'mix') return null;
  const [base, lead] = style.split(':');
  return { style: base, leadIn: lead, tier: 'MEDIUM', related: [] };
}

/** Rules that need no model. Returns one list of problems per question and set-level problems. */
export function plainChecks(questions, c = {}) {
  const slot = declaredSlot(c.style);
  const optionCount = OPTION_COUNT[c.exam] ?? 4;
  const per = questions.map((q) => {
    const issues = [];
    const opts = q.options || [];
    const texts = opts.map((o) => norm(o.text));
    if (new Set(texts).size !== texts.length) issues.push('duplicate options');
    const ans = norm(correctText(q));
    if (!ans) issues.push('no correct option');
    if (ans.length >= 6 && norm(q.stem).includes(ans)) issues.push('answer appears in stem');
    if (GENERIC_LEAD.test(String(q.questionText || '').trim())) issues.push('generic question line');
    if (HEDGE.test(String(q.explanation || '').slice(0, 160)) && /\b(is|are)\b/.test(String(q.questionText))) issues.push('hedged explanation');
    const lens = opts.map((o) => String(o.text).length);
    const longest = lens.indexOf(Math.max(...lens));
    if (!(slot && STYLES[slot.style]?.codedOptions) && opts[longest]?.id === q.correctOption && Math.max(...lens) > 2.2 * (lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length))) issues.push('correct option is conspicuously longest');
    // Shape, option count and picture references, with the same rules the app uses.
    const shape = styleProblem(q, slot ?? undefined, optionCount, true);
    if (shape) issues.push(`style: ${shape.split(':')[0]}`);
    if (pointsAtMissingPicture(q)) issues.push('dangling picture');
    if (!(slot && slot.style === 'calculation') && !explainsDistractors(q)) issues.push('explanation skips distractors');
    return issues;
  });
  const set = [];
  const answers = questions.map((q) => norm(correctText(q)));
  const dupAnswers = answers.filter((a, i) => a && answers.indexOf(a) !== i).length;
  if (dupAnswers && !(slot && STYLES[slot.style]?.codedOptions)) set.push(`${dupAnswers} repeated answers`);
  let nearDup = 0;
  for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
    if (stemSimilarity(norm(questions[i].stem + ' ' + questions[i].questionText), norm(questions[j].stem + ' ' + questions[j].questionText)) >= 0.6) nearDup += 1;
  }
  if (nearDup) set.push(`${nearDup} near-duplicate question pairs`);
  const cases = questions.filter((q) => PATIENT.test(q.stem)).length;
  const letters = questions.map((q) => q.correctOption);
  const share = Math.max(...['A', 'B', 'C', 'D', 'E'].map((l) => letters.filter((x) => x === l).length)) / Math.max(1, questions.length);
  if (questions.length >= 8 && share > 0.4) set.push(`correct letter skewed (${Math.round(share * 100)}% one letter)`);
  // The exam's own mix, when no style was forced.
  if (c.style === 'mix' && questions.length >= 8) {
    const n = questions.length;
    const kinds = { negative: questions.filter((q) => /\b(NOT|EXCEPT|FALSE|INCORRECT)\b/.test(`${q.questionText} ${q.stem}`)).length, statements: questions.filter((q) => /(^|\s)1[.)]\s.*\s2[.)]\s/s.test(q.stem)).length, match: questions.filter((q) => /match list/i.test(q.stem)).length };
    if (c.exam === 'NEET_PG' && (kinds.statements + kinds.match) / n > 0.1) set.push('NEET-PG set has statement or match items (they are almost absent in real papers)');
    if (c.exam === 'NEET_PG' && kinds.negative / n > 0.25) set.push('NEET-PG set has too many NOT items');
    if (c.exam === 'AMC_CAT' && cases / n < 0.9) set.push(`AMC set is not all patient vignettes (${Math.round((cases / n) * 100)}%)`);
    if (c.exam === 'INI_CET' && kinds.negative / n > 0.3) set.push('INI-CET set has too many NOT items');
  }
  return { per, set, patientShare: questions.length ? cases / questions.length : 0 };
}

const JUDGE_SYSTEM =
  'You are a strict NEET-PG / INI-CET / AMC examiner reviewing MCQs. For each numbered question decide: ' +
  '"correct" (the marked answer is right by standard textbooks and guidelines), "single" (exactly one option is defensible), ' +
  '"relevance" (1-5: how likely an exam is to test this fact; 1 = research trivia or filler), "clear" (stem unambiguous and complete), ' +
  '"style_ok" (the question really has the required style, given below), "difficulty" ("easy", "medium" or "hard"), ' +
  '"explanation_ok" (the explanation says why the key is right and why the others are wrong, with no false statement), ' +
  'and a short "issue" (empty if none). For a match, statements, assertion-reason or calculation item, work through it yourself before judging "correct". ' +
  'Reply with ONLY JSON: {"items":[{"n":1,"correct":true,"single":true,"relevance":4,"clear":true,"style_ok":true,"difficulty":"medium","explanation_ok":true,"issue":""}]}';

async function judge(c, questions, provider) {
  if (!questions.length) return [];
  const slot = declaredSlot(c.style);
  const required = slot ? `Required style: ${STYLES[slot.style].judge}${slot.leadIn ? `; the question line asks for the ${slot.leadIn.replace(/-/g, ' ')} (for a drug-of-choice item a drug, regimen or treatment of choice is fine)` : ''}.` : `No single style was required: the exam's own mix for ${c.exam} applies (NEET-PG: mostly vignettes and one-liners; INI-CET: also NOT items and some statements; AMC: patient vignettes with 5 options). Mark style_ok true if the item is a well-formed exam question of any normal style.`;
  const list = questions.map((q, i) => `${i + 1}. ${q.stem}\n${q.questionText}\n` + q.options.map((o) => `${o.id}) ${o.text}`).join('\n') + `\nMarked answer: ${q.correctOption}\nExplanation: ${String(q.explanation || '').slice(0, 1800)}`).join('\n\n');
  const raw = await aiComplete({ system: JUDGE_SYSTEM, messages: [{ role: 'user', content: `Topic: ${c.topic}\nExam: ${c.exam}\n${required}\n\n${list}` }], json: true, effort: 'medium', provider, model: getEffectiveModel(provider) }).catch(() => '');
  return extractJson(raw)?.items ?? [];
}

/** Runs one case end to end. Returns its questions, plan and scores. */
export async function runCase(c) {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider is active.');
  const t0 = Date.now();
  // The split and the fact plan are kept per topic (v3: plans carry the picturable flag).
  const cacheKey = `pulse.quality.plan.v3.${c.exam}.${c.topic.toLowerCase()}`;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { cached = null; }
  let split;
  let plan;
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000 && cached.plan?.length >= 6) {
    ({ split, plan } = cached);
  } else {
    // A provider that is rate-limited gives a one-subtopic split and a tiny plan; planning is tried again after a pause
    // (up to three times) before the case goes on with whatever it got.
    for (let attempt = 1; attempt <= 3; attempt++) {
      split = await splitTopic(c.topic, c.exam);
      plan = split.subtopics.length ? await planTopicFacts(c.topic, split.subtopics, split.facts, provider) : [];
      if (plan.length >= 6 || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 20000 * attempt));
    }
    try { if (plan.length >= 6) localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), split, plan })); } catch { /* storage full */ }
  }
  const factsTotal = split.facts.reduce((a, b) => a + b, 0);
  const target = Math.max(1, Math.min(c.count, plan.length ? Math.min(plan.length, factsTotal) : factsTotal));
  const moduleUnits = new Set();
  const args = {
    exam: c.exam, count: target, requestedTopic: c.topic, factPlan: plan.length ? plan : undefined,
    subjectSubtopics: [{ subject: c.topic, subtopics: split.subtopics.length ? split.subtopics : [c.topic] }],
    difficultyTier: c.tier || 'ALL', questionTypes: c.questionTypes || [], stemPatterns: c.stemPatterns || [],
    styles: c.styles || [], leadIns: c.leadIns || [],
    includeImages: c.images !== false, usedUnits: moduleUnits, batchPromises: [],
  };
  let result = await generateExamQuestions(args);
  let questions = result.questions;
  let dropped = result.dropped;
  for (let round = 2; round <= 3 && questions.length < target && !result.failure; round++) {
    const more = await generateExamQuestions({ ...args, count: target - questions.length, existing: questions });
    questions = [...questions, ...more.questions];
    dropped += more.dropped;
    result = more;
  }
  questions = questions.slice(0, target);
  const checks = plainChecks(questions, c);
  const judged = await judge(c, questions, provider);
  const verdict = questions.map((q, i) => ({ q, plain: checks.per[i], j: judged.find((x) => Number(x.n) === i + 1) || null }));
  const bad = verdict.filter((v) => v.plain.length || (v.j && (!v.j.correct || !v.j.single || !v.j.clear || v.j.style_ok === false || v.j.relevance <= 2)));
  const count = (f) => verdict.filter(f).length;
  const diff = (d) => verdict.filter((v) => v.j?.difficulty === d).length;
  return {
    id: c.id, topic: c.topic, exam: c.exam, style: c.style, requested: c.count, planned: plan.length, target, kept: questions.length, dropped,
    seconds: Math.round((Date.now() - t0) / 1000),
    wrong: count((v) => v.j && !v.j.correct),
    ambiguous: count((v) => v.j && !v.j.single),
    unclear: count((v) => v.j && v.j.clear === false),
    lowRelevance: count((v) => v.j && v.j.relevance <= 2),
    avgRelevance: judged.length ? +(judged.reduce((a, x) => a + (Number(x.relevance) || 0), 0) / judged.length).toFixed(2) : null,
    styleBad: count((v) => v.plain.some((p) => p.startsWith('style:')) || v.j?.style_ok === false),
    expBad: count((v) => v.plain.includes('explanation skips distractors') || v.j?.explanation_ok === false),
    dangling: count((v) => v.plain.includes('dangling picture')),
    images: questions.filter((q) => q.image).length,
    difficulty: { easy: diff('easy'), medium: diff('medium'), hard: diff('hard') },
    plainFlags: checks.per.filter((p) => p.length).length,
    setIssues: checks.set, patientShare: +checks.patientShare.toFixed(2),
    letters: ['A', 'B', 'C', 'D', 'E'].map((l) => questions.filter((q) => q.correctOption === l).length).join('/'),
    flagged: bad.map((v) => ({ stem: v.q.stem.slice(0, 160), ask: String(v.q.questionText).slice(0, 110), ans: correctText(v.q).slice(0, 60), plain: v.plain, judge: v.j && (v.j.issue || ((!v.j.correct ? 'WRONG ' : '') + (!v.j.single ? 'AMBIGUOUS ' : '') + (v.j.style_ok === false ? 'STYLE ' : '') + (v.j.relevance <= 2 ? 'LOW-RELEVANCE' : ''))) })),
    questions,
  };
}

/** Runs many cases with a small number at once (the provider rate-limits bursts). */
export async function runMatrix(allCases, { parallel = 3, onDone, maxCount = 0 } = {}) {
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
  const kept = out.reduce((a, r) => a + (r.kept || 0), 0);
  const dropped = out.reduce((a, r) => a + (r.dropped || 0), 0);
  return { results: out, started: kept + dropped, kept, yield: kept + dropped ? +(kept / (kept + dropped)).toFixed(2) : null };
}

/** One line per case, then the totals. */
export function summarize(run) {
  const R = run.results.filter((r) => !r.error);
  const sum = (k) => R.reduce((a, r) => a + (r[k] || 0), 0);
  const lines = run.results.map((r) => r.error ? `${r.id}: ERROR ${r.error}` : `${r.id}: kept ${r.kept}/${r.target} wrong ${r.wrong} amb ${r.ambiguous} unclear ${r.unclear} low ${r.lowRelevance} rel ${r.avgRelevance} style ${r.styleBad} expl ${r.expBad} dangling ${r.dangling} img ${r.images} letters ${r.letters} set[${r.setIssues.join('; ')}] ${r.seconds}s`);
  const n = sum('kept');
  lines.push(`TOTAL ${n} questions: wrong ${sum('wrong')}, ambiguous ${sum('ambiguous')}, unclear ${sum('unclear')}, low relevance ${sum('lowRelevance')}, style ${sum('styleBad')}, explanation ${sum('expBad')}, dangling ${sum('dangling')}, images ${sum('images')}, yield ${run.yield}`);
  return lines.join('\n');
}
