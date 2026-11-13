// NEET PG and INI-CET pipelines, without a model: routing, mixes, the clean-ups, the new quality checks (calibrated on a
// real 100-question Tuberculosis run), letter balance and letter remapping, and one mocked end-to-end generation.
// Run: node --import tsx tools/quality/pipelines.test.mjs
import {
  pipelineFor, NEET_PG_PIPELINE, INI_CET_PIPELINE, cleanOptionLabels, splitStemQuestion, optionReasoningProblem,
  everyDistractorExplained, answerInStem, decorativeCase, oppositeOptions, sourceBoundExplanation, topicAllowsTreatment,
  hasAboveOption, scrubSourceMentions, isGeneralFact, isDatedFact, passageMatchesQuery,
} from '../../src/lib/pipelines/index.ts';
import { startRun, finishRun } from '../../src/lib/diagnostics.ts';
import { sourceLeakWhere } from '../../src/lib/questionStyles.ts';
import { balanceAnswerLetters, remapLetterMentions, shuffleOptions, priorityWeights, generateExamQuestions, assignedPatient, guardCaseSlots, salvageSpec, planTopicFacts, stemAndLine } from '../../src/lib/ai.ts';
import { lookupTopicsBalanced, specialtyOf } from '../../src/data/chapterTopics.ts';
import { planSlots } from '../../src/lib/questionStyles.ts';

globalThis.localStorage = { getItem: (k) => (k === 'ai.activeProvider' ? 'claude' : null), setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = globalThis.localStorage;
let fails = 0;
const expect = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { fails += 1; console.log(`FAIL ${name}: got ${g} want ${w}`); }
};
const opts = (...t) => t.map((text, i) => ({ id: 'ABCDE'[i], text }));
const mk = (o) => ({ stem: '', questionText: '', options: opts('a', 'b', 'c', 'd'), correctOption: 'A', explanation: '', ...o });

// ---- routing and mixes
expect('NEET routed', pipelineFor('NEET_PG')?.exam, 'NEET_PG');
expect('INI routed', pipelineFor('INI_CET')?.exam, 'INI_CET');
expect('AMC untouched', pipelineFor('AMC_CAT'), null);
const neetStyles = NEET_PG_PIPELINE.styleMix().map(([s]) => s);
expect('NEET has no match/statements', neetStyles.some((s) => ['match', 'multi-statement', 'assertion-reason'].includes(s)), false);
expect('INI has NOT and match', ['negative', 'match'].every((s) => INI_CET_PIPELINE.styleMix().some(([x]) => x === s)), true);
const hardShare = (p) => p.tierMix.find(([t]) => t === 'HIGH')[1] / p.tierMix.reduce((a, [, w]) => a + w, 0);
expect('NEET harder than paper (>=40% hard)', hardShare(NEET_PG_PIPELINE) >= 0.4, true);
expect('INI harder than NEET', hardShare(INI_CET_PIPELINE) > hardShare(NEET_PG_PIPELINE), true);
const slots = planSlots(Array.from({ length: 20 }, (_, i) => ({ fact: `fact ${i}`, subtopic: `s${i % 4}` })), 'INI_CET', [], [], 'ALL', undefined,
  { styleMix: INI_CET_PIPELINE.styleMix(), leadInMix: INI_CET_PIPELINE.leadInMix, tierMix: INI_CET_PIPELINE.tierMix });
expect('INI ALL tier mix: 11 hard of 20', slots.filter((s) => s.tier === 'HIGH').length, 11);

// ---- clean-ups
const reasoning = mk({ questionText: 'Which drug is preferred?', options: opts('Vancomycin, because it covers MRSA', 'Linezolid (as it is bacteriostatic against cocci)', 'Daptomycin', 'Cefazolin') });
expect('reasoning flagged', Boolean(optionReasoningProblem(reasoning)), true);
cleanOptionLabels(reasoning);
expect('reasoning cut', reasoning.options.map((o) => o.text), ['Vancomycin', 'Linezolid', 'Daptomycin', 'Cefazolin']);
expect('clean after cut', optionReasoningProblem(reasoning), null);
const statements = mk({ questionText: 'Which of the following is NOT true?', options: opts('Cyanosis is due to shunting', 'b', 'c', 'd') });
cleanOptionLabels(statements);
expect('statement options untouched', statements.options[0].text, 'Cyanosis is due to shunting');
const stemQ = mk({ stem: 'A 30-year-old man has fever and a cough for three weeks. Which test is most useful?', questionText: '' });
splitStemQuestion(stemQ);
expect('question moved out of stem', [stemQ.stem, stemQ.questionText], ['A 30-year-old man has fever and a cough for three weeks.', 'Which test is most useful?']);
expect('above option', hasAboveOption(mk({ options: opts('x', 'y', 'z', 'All of the above') })), true);

// ---- checks calibrated on the real Tuberculosis run (each mirrors a kept question that was defective)
expect('#87 answer named in stem', answerInStem(mk({ stem: 'In tuberculous dactylitis, the characteristic honeycomb appearance on radiographs is termed spina ventosa.', questionText: 'Which radiographic feature is associated?', options: opts('Spina ventosa', 'Caries sicca', 'Soft cork-like sequestra', 'Mortal Pestle appearance') })), true);
expect('#43 key words in stem', answerInStem(mk({ stem: 'A barium meal follow-through image shows contrast outlining the small bowel to the ileocaecal valve.', questionText: 'Which investigation is represented?', options: opts('Barium meal follow-through', 'Barium enema', 'Small-bowel enteroclysis', 'Water-soluble contrast challenge') })), true);
expect('good vignette not a leak', answerInStem(mk({ stem: 'A 32-year-old woman has a slowly enlarging plaque on her cheek with a pale scar-like centre and an advancing red-brown edge.', questionText: 'Which cutaneous tuberculosis variant best accounts for this?', options: opts('Lupus vulgaris', 'Scrofuloderma', 'Tuberculous gumma', 'Tuberculosis verrucosa cutis') })), false);
expect('#50 decorative case', decorativeCase(mk({ stem: 'A 56-year-old woman presents with persistent back pain and focal spinal tenderness.', questionText: 'Approximately what proportion of skeletal tuberculosis cases involve the spine?' })), true);
expect('case used by question', decorativeCase(mk({ stem: 'A 37-year-old man with tuberculous destruction of adjacent vertebrae develops difficulty swallowing.', questionText: 'What is the most likely cause of the bulge in this patient?' })), false);
expect('#5 opposite options', oppositeOptions(mk({ options: opts('It may spread from adjacent osteomyelitis.', 'It is usually polyarticular.', 'It follows haematogenous spread.', 'It is usually monoarticular.') })), true);
expect('#49 opposite options', oppositeOptions(mk({ options: opts('Usually affects several joints', 'Usually affects one joint', 'Typically affects paired joints', 'Usually migrates between joints') })), true);
expect('distinct options fine', oppositeOptions(mk({ options: opts('Ghon focus', 'Ranke complex', 'Simon focus', 'Assmann focus') })), false);
expect('#72 source-bound key', sourceBoundExplanation(mk({ explanation: 'Both the threshold and timing differ from the stated criterion.' })), true);
expect('Tuberculosis allows drugs', topicAllowsTreatment('Tuberculosis'), true);
expect('anatomy topic does not', topicAllowsTreatment('Brachial plexus anatomy'), false);
expect('every distractor needed', everyDistractorExplained(mk({ options: opts('MRI', 'CT', 'X-ray', 'PET'), explanation: 'MRI is best. CT is less sensitive. X-ray is late.' })), false);
expect('short options matched', everyDistractorExplained(mk({ options: opts('MRI', 'CT', 'X-ray', 'PET'), explanation: 'MRI is best. CT is less sensitive. X-ray is late. PET is not used.' })), true);

// ---- letters
const q = mk({ options: opts('Isoniazid', 'Rifampicin', 'Ethambutol', 'Pyrazinamide'), correctOption: 'B', explanation: 'Option A causes neuropathy (A). Options C and D are wrong.', optionReasons: { A: 'neuropathy', B: 'orange urine', C: 'optic neuritis', D: 'gout' } });
const sh = shuffleOptions(q.options, 'B');
q.options = sh.entries; q.correctOption = sh.correct;
remapLetterMentions(q, (l) => sh.map[l] ?? l);
const letterOf = (text) => q.options.find((o) => o.text === text).id;
expect('key follows its text', q.options.find((o) => o.id === q.correctOption).text, 'Rifampicin');
expect('reasons follow options', q.optionReasons[letterOf('Ethambutol')], 'optic neuritis');
expect('explanation letter follows', q.explanation.includes(`Option ${letterOf('Isoniazid')} causes`), true);

const set = Array.from({ length: 40 }, (_, i) => mk({ options: opts('w', 'x', 'y', 'z'), correctOption: 'A', explanation: `Option A is right ${i}.` }));
let seed = 7;
balanceAnswerLetters(set, () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; });
const counts = set.reduce((c, x) => ({ ...c, [x.correctOption]: (c[x.correctOption] ?? 0) + 1 }), {});
expect('letters even', [counts.A, counts.B, counts.C, counts.D], [10, 10, 10, 10]);
expect('text moved with key', set.every((x) => x.options.find((o) => o.id === x.correctOption).text === 'w'), true);
expect('explanation moved with key', set.every((x) => x.explanation.startsWith(`Option ${x.correctOption} `)), true);
expect('not a fixed ABCD pattern', set.slice(0, 8).map((x) => x.correctOption).join('') !== 'ABCDABCD', true);

const w = priorityWeights([{ subtopic: 'drugs' }, { subtopic: 'skin' }], {}, { drugs: 10, skin: 3 });
expect('priority weights favour high-yield', w.drugs / w.skin >= 10, true);

// ---- live-test report (13 Nov): repeat patients, specialty spread
const pairs = new Set(Array.from({ length: 100 }, (_, i) => { const p = assignedPatient(i); return `${p.age}-${p.sex}`; }));
expect('100 case slots get 100 different patients', pairs.size, 100);
expect('assigned ages are adults 18-78', Array.from({ length: 120 }, (_, i) => assignedPatient(i).age).every((a) => a >= 18 && a <= 78), true);
const tb = lookupTopicsBalanced('Tuberculosis', 60);
const tbSubjects = new Set(tb.map((t) => t.subject));
expect('TB plan reaches Pharmacology', tbSubjects.has('Pharmacology'), true);
expect('TB plan reaches General Medicine', tbSubjects.has('General Medicine'), true);
expect('TB plan reaches PSM', tbSubjects.has('Preventive & Social Medicine (PSM)'), true);
const topShare = Math.max(...[...tbSubjects].map((s) => tb.filter((t) => t.subject === s).length)) / tb.length;
expect('no specialty above about a third of the TB topics', topShare <= 0.35, true);

// ---- second live-test report (v3): shape fixes in code, case-slot guard, plan budget
{
  const src = mk({ stem: 'In the supplied material on female genital tuberculosis, the fallopian tubes are involved.', questionText: 'Which site is most often involved?', explanation: 'According to the supplied passage, tubes are involved.' });
  scrubSourceMentions(src);
  expect('source talk removed from stem', src.stem, 'In female genital tuberculosis, the fallopian tubes are involved.');
  expect('source talk removed from explanation', src.explanation, 'Tubes are involved.');
  expect('general fact', isGeneralFact('Spinal tuberculosis was historically the most common cause of psoas abscess.'), true);
  expect('feature fact is not general', isGeneralFact('Ethambutol causes optic neuritis with red-green colour loss.'), false);
  expect('dated fact', isDatedFact('BPaLM was approved for longer MDR-TB treatment in August 2024.'), true);
  expect('one-word key named in stem', answerInStem(mk({ stem: 'A 40-year-old man on linezolid for MDR-TB develops tingling in both feet.', questionText: 'Which drug is responsible?', options: opts('Linezolid', 'Bedaquiline', 'Clofazimine', 'Delamanid') })), true);
  expect('one-word key absent', answerInStem(mk({ stem: 'A 40-year-old man on an MDR-TB regimen develops tingling in both feet.', questionText: 'Which drug is responsible?', options: opts('Linezolid', 'Bedaquiline', 'Clofazimine', 'Delamanid') })), false);

  const slots = [
    { style: 'vignette', leadIn: 'finding', tier: 'MEDIUM', related: [] },
    { style: 'vignette', leadIn: 'finding', tier: 'MEDIUM', related: [] },
    { style: 'vignette', leadIn: 'diagnosis', tier: 'MEDIUM', related: [] },
    { style: 'short-case', leadIn: 'next-step', tier: 'MEDIUM', related: [] },
  ];
  guardCaseSlots(slots, [
    { fact: 'Infertility is the commonest presenting complaint of genital tuberculosis.', subtopic: 'genital' },
    { fact: 'Tubal tuberculosis gives beaded tubes on hysterosalpingography.', subtopic: 'genital' },
    { fact: "India's NTEP strategy rests on four pillars: detect, treat, prevent and build.", subtopic: 'NTEP' },
    { fact: 'Ethambutol dose is reduced in renal failure.', subtopic: 'drugs' },
  ], false, false);
  expect('general fact case becomes a one-liner', [slots[0].style, slots[0].leadIn], ['one-liner', undefined]);
  expect('feature case keeps its planned lead-in (v4: no diagnosis conversion)', [slots[1].style, slots[1].leadIn], ['vignette', 'finding']);
  expect('programme fact becomes a one-liner', slots[2].style, 'one-liner');
  expect('management lead-in kept', slots[3].leadIn, 'next-step');

  const r1 = { options: ['A) Isoniazid', 'B) Ethambutol', 'C) Rifampicin', 'D) Pyrazinamide'], correctOption: 'Option B' };
  salvageSpec(r1);
  expect('string options salvaged', [r1.options.B, r1.correctOption], ['Ethambutol', 'B']);
  const r2 = { options: { a: 'Isoniazid', b: 'Ethambutol', c: 'Rifampicin', d: 'Pyrazinamide' }, correctOption: 'Ethambutol' };
  salvageSpec(r2);
  expect('key given as text salvaged', [Object.keys(r2.options).join(''), r2.correctOption], ['ABCD', 'B']);
}

// ---- third live-test report (v4)
{
  const blank = { stem: '', questionText: 'Which drug causes optic neuritis?', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctOption: 'A' };
  salvageSpec(blank);
  expect('blank stem takes the question line', blank.stem, 'Which drug causes optic neuritis?');
  expect('one-line question sent to judges once', stemAndLine(mk({ stem: 'Which drug causes optic neuritis?', questionText: 'Which drug causes optic neuritis?' })), 'Which drug causes optic neuritis?');
  expect('stem and line both sent when different', stemAndLine(mk({ stem: 'A 40-year-old man has blurred vision.', questionText: 'Which drug?' })), 'A 40-year-old man has blurred vision.\nWhich drug?');
  expect('tuberculoid leprosy is not a TB topic', lookupTopicsBalanced('Tuberculosis', 60).some((t) => /tuberculoid/i.test(t.topic)), false);
  expect('top-up drug topic gets Pharmacology', specialtyOf('Second-line and newer antitubercular drugs: drug classes, named agents'), 'Pharmacology');
  expect('top-up imaging topic gets Radiology', specialtyOf('Pulmonary TB imaging: primary, post-primary, miliary and healed disease patterns'), 'Radiodiagnosis & Radiotherapy');
  expect('top-up clinical topic gets General Medicine', specialtyOf('Clinical features: pulmonary TB presentation, constitutional symptoms and patterns of disease'), 'General Medicine');
  expect('prefixed top-up topic keeps its prefix', specialtyOf('Community medicine — Epidemiology: burden, distribution'), 'Preventive & Social Medicine (PSM)');
}

// ---- plan budget: the per-subtopic cap never blocks a narrow topic, and "My books" subtopics with no fact searched on the internet
{
  const W = ['hepatitis', 'neuropathy', 'arthralgia', 'thrombocytopenia', 'hyperuricaemia', 'orange urine', 'optic neuritis', 'ototoxicity', 'QT prolongation', 'skin pigmentation', 'lactic acidosis', 'hypothyroidism'];
  const V = ['monitoring', 'pyridoxine', 'dose reduction', 'colour vision', 'audiometry', 'ECG', 'serum lactate', 'TSH', 'uric acid', 'liver enzymes', 'platelet count', 'counselling'];
  const off = { alpha: 0, beta: 4, gamma: 8 };
  const fact = (sub, n) => n < 4 ? `${sub.toUpperCase()} drug causes ${W[(n + off[sub]) % 12]} and needs ${V[(n + off[sub]) % 12]}.` : `${sub.toUpperCase()} extra point ${n} repeats ${W[n % 12]}.`;
  globalThis.__planDebug = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes('/api/web/research')) {
      const q = body.query ?? '';
      const sub = (q.match(/(alpha|beta|gamma)/) ?? [])[1];
      // Books hold text for alpha and beta only; the internet holds gamma too.
      if (body.books && sub === 'gamma') return new Response(JSON.stringify({ sources: [] }));
      const subs = sub ? [sub] : body.books ? ['alpha', 'beta'] : ['alpha', 'beta', 'gamma'];
      return new Response(JSON.stringify({ sources: subs.map((x) => ({ title: `${body.books ? 'Book' : 'Web'} ${x}`, kind: body.books ? 'book' : 'web', text: Array.from({ length: 12 }, (_, n) => fact(x, n)).join(' ') })) }));
    }
    if (u.includes('/api/ai/complete')) {
      if (body.purpose === 'fact-plan') {
        const content = body.messages[0].content;
        const sub = (content.match(/Subtopic: (\w+)/) ?? [])[1];
        const srcIdx = [...content.matchAll(/\[source (\d+)\] \w+ (\w+)/g)].find(([, , x]) => x === sub)?.[1];
        if (!srcIdx) return new Response(JSON.stringify({ text: '{"facts":[]}' }));
        return new Response(JSON.stringify({ text: JSON.stringify({ facts: Array.from({ length: 12 }, (_, n) => ({ fact: fact(sub, n), quote: fact(sub, n), source: Number(srcIdx) })) }) }));
      }
      return new Response(JSON.stringify({ text: '{"duplicates":[],"offTopic":[],"picturable":[]}' }));
    }
    return new Response('{}');
  };
  const plan = await planTopicFacts('Tuberculosis', ['alpha', 'beta', 'gamma'], [6, 6, 3], 'claude', true, 50);
  const per = plan.reduce((c, f) => ({ ...c, [f.subtopic]: (c[f.subtopic] ?? 0) + 1 }), {});
  expect('narrow topic: the cap does not block its facts', per.alpha >= 4 && per.beta >= 4, true);
  expect('books-empty subtopic searched on the internet', per.gamma > 0, true);
  expect('plan summary recorded', globalThis.__planSummary?.planned, plan.length);
}

// ---- mocked end-to-end: a NEET PG subject run (no typed topic), one writer reply with defects that are now fixed in code
globalThis.localStorage = { getItem: (k) => (k === 'ai.activeProvider' ? 'claude' : null), setItem: () => {}, removeItem: () => {} };
const seen = { examiner: 0, explanation: 0, write: 0 };
// The repair is sent the options under their current letters ("C) Ethambutol"), so its reasons use those letters.
const WHY = { Isoniazid: 'Isoniazid causes neuropathy.', Ethambutol: 'Ethambutol causes optic neuritis.', Rifampicin: 'Rifampicin colours secretions.', Pyrazinamide: 'Pyrazinamide causes gout.' };
const reasonsFor = (content) => Object.fromEntries([...content.matchAll(/^([A-D])\) (\w+)/gm)].map(([, l, name]) => [l, WHY[name]]));
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(init.body) : {};
  const reply = (text) => new Response(JSON.stringify({ text }));
  if (u.includes('/api/ai/nvidia-stats')) return new Response('{}');
  if (u.includes('/api/ai/plan-topics')) return new Response(JSON.stringify({ topics: [{ subject: 'Pharmacology', subtopic: 'Antitubercular drugs', difficultyTier: 'ALL' }] }));
  if (u.includes('/api/ai/verify-item')) return new Response(JSON.stringify({ verdict: 'supported' }));
  if (u.includes('/api/ai/jobs')) {
    seen.write += 1;
    const text = JSON.stringify({
      stem: 'A 45-year-old man on treatment for pulmonary tuberculosis notices blurred vision and red-green colour confusion after two months. Which drug is responsible?',
      questionText: '',
      options: { A: 'Isoniazid', B: 'Ethambutol, as it causes optic neuritis', C: 'Rifampicin', D: 'Pyrazinamide' },
      correctOption: 'B',
      explanation: 'Option B is right. Option A causes neuropathy, option C turns urine orange and option D causes gout.',
      optionReasons: { A: 'Peripheral neuropathy.', B: 'Optic neuritis.', C: 'Orange secretions.', D: 'Hyperuricaemia.' },
      sourceCheck: 'supported',
    });
    return new Response(JSON.stringify({ id: 'j', done: true, status: 200, body: { text } }));
  }
  if (u.includes('/api/ai/complete')) {
    if (body.purpose === 'examiner') { seen.examiner += 1; return reply('{"ok":true,"problem":""}'); }
    if (body.purpose === 'explanation') { seen.explanation += 1; return reply(JSON.stringify({ explanation: `**Background:** ${'Ethambutol is a first-line anti-TB drug. '.repeat(8)}**Why Ethambutol is right:** optic neuritis.\n**Why the others are wrong:**\n- Isoniazid: neuropathy.\n- Rifampicin: orange urine.\n- Pyrazinamide: gout.\n**High-yield:** colour vision first.`, optionReasons: reasonsFor(body.messages[0].content) })); }
    return reply('{}');
  }
  if (u.includes('/api/pyq/weights') || u.includes('/api/web/research')) return new Response('{}');
  return new Response('{}', { status: 404 });
};
const run = await generateExamQuestions({ exam: 'NEET_PG', count: 1, subjectSubtopics: [{ subject: 'Pharmacology', subtopics: ['Antitubercular drugs'] }], difficultyTier: 'ALL', includeImages: false });
const got = run.questions[0];
expect('e2e: one question kept', run.questions.length, 1);
if (got) {
  const key = got.options.find((o) => o.id === got.correctOption);
  expect('e2e: reasoning tail removed from option', key.text, 'Ethambutol');
  expect('e2e: question moved to questionText', got.questionText, 'Which drug is responsible?');
  expect('e2e: examiner ran on a subject run', seen.examiner >= 1, true);
  expect('e2e: thin explanation rewritten with background', /Background/.test(got.explanation), true);
  expect('e2e: per-option reason sits with its option', got.optionReasons[got.correctOption], 'Ethambutol causes optic neuritis.');
  expect('e2e: tier is a real tier', ['LOW', 'MEDIUM', 'HIGH'].includes(got.difficultyTier), true);
}

// ---- mocked typed-topic run: assigned patients, and an examiner rejection repaired once
{
  let examined = 0;
  const writerPatients = [];
  const jobs = new Map();
  globalThis.__repairs = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    const reply = (text) => new Response(JSON.stringify({ text }));
    if (u.includes('/api/ai/verify-item')) return new Response(JSON.stringify({ verdict: 'supported' }));
    // The app starts a job (POST) and then polls it (GET /api/ai/jobs/<id>): the poll returns what the start computed.
    if (u.includes('/api/ai/jobs/')) return new Response(JSON.stringify(jobs.get(u.split('/').pop())));
    if (u.includes('/api/ai/jobs')) {
      const content = body.messages?.[0]?.content ?? '';
      const m = content.match(/the patient is an? (\d+)-year-old (man|woman)/);
      const who = m ? `${m[1]}-year-old ${m[2]}` : '29-year-old woman';
      writerPatients.push(who);
      const planned = (content.match(/states: "([^"]*)"/) ?? [])[1] ?? '';
      const drug = /ethambutol/i.test(planned) ? 'Ethambutol' : 'Isoniazid';
      const finding = drug === 'Ethambutol' ? 'blurred vision with red-green colour confusion' : 'burning pain and numbness in both feet';
      const text = JSON.stringify({
        stem: `A ${who} on daily first-line therapy for pulmonary tuberculosis reports ${finding} after eight weeks of treatment, with normal blood sugar.`,
        questionText: 'Which drug is the most likely cause?',
        options: { A: 'Isoniazid', B: 'Ethambutol', C: 'Rifampicin', D: 'Pyrazinamide' },
        correctOption: drug === 'Ethambutol' ? 'B' : 'A',
        explanation: `**${drug} causes this adverse effect.**\nBackground: ${'First-line anti-TB drugs each have a typical toxicity. '.repeat(10)}\n- Rifampicin: orange secretions.\n- Pyrazinamide: gout.\n- ${drug === 'Ethambutol' ? 'Isoniazid: neuropathy.' : 'Ethambutol: optic neuritis.'}\nHigh-yield: know each toxicity.`,
        keyFact: drug === 'Ethambutol' ? 'Ethambutol causes optic neuritis.' : 'Isoniazid causes peripheral neuropathy.',
        sourceCheck: 'supported',
      });
      const id = `job${jobs.size + 1}`;
      jobs.set(id, { id, done: true, status: 200, body: { text } });
      return new Response(JSON.stringify({ id }));
    }
    if (u.includes('/api/ai/complete')) {
      if (body.purpose === 'examiner') {
        examined += 1;
        // The first examination fails with a fix; every later one passes.
        return reply(examined === 1 ? '{"ok":false,"problem":"the stem should say the patient takes pyridoxine-free therapy; add that"}' : '{"ok":true,"problem":""}');
      }
      if (body.purpose === 'repair') {
        const content = body.messages?.[0]?.content ?? '';
        const stem = (content.match(/Stem: (.*)/) ?? [])[1] ?? '';
        const opts = [...content.matchAll(/^([A-D])\) (.*)$/gm)].map(([, id, text]) => ({ id, text }));
        const key = (content.match(/Correct answer: ([A-D])/) ?? [])[1] ?? 'A';
        const expl = (content.match(/Explanation: ([\s\S]*)$/) ?? [])[1] ?? '';
        return reply(JSON.stringify({ stem: stem.replace('therapy', 'therapy without pyridoxine'), questionText: 'Which drug is the most likely cause?', options: opts, correctOption: key, explanation: expl }));
      }
      return reply('{}');
    }
    return new Response('{}');
  };
  const run = await generateExamQuestions({
    exam: 'NEET_PG', count: 2, requestedTopic: 'Tuberculosis', difficultyTier: 'MEDIUM', includeImages: false,
    subjectSubtopics: [{ subject: 'Tuberculosis', subtopics: ['Anti-TB drug toxicity'] }],
    factPlan: [
      { subtopic: 'Anti-TB drug toxicity', fact: 'Isoniazid causes peripheral neuropathy, prevented by pyridoxine.', quote: 'x', source: 'KDT' },
      { subtopic: 'Anti-TB drug toxicity', fact: 'Long-term ethambutol causes optic neuritis with red-green colour loss.', quote: 'x', source: 'KDT' },
    ],
    questionTypes: ['Clinical vignette'],
  });
  expect('typed run: both questions kept', run.questions.length, 2);
  expect('typed run: no wrong-lead-in rejections for a planned (not chosen) lead-in', (globalThis.__drops ?? []).some((d) => d.reason === 'style-wrong-lead-in'), false);
  expect('typed run: writer got two different patients', new Set(writerPatients.slice(0, 2)).size, 2);
  expect('typed run: an examiner rejection is rewritten, not repaired (v4)', globalThis.__repairs.length, 0);
}

// ---- Pharmacology report (v5): book relevance, source misses, diagnostics
{
  expect('unrelated chapter is not a match', passageMatchesQuery('Antiepileptic drugs: carbamazepine induces CYP3A4 and causes hyponatraemia.', 'NK1 receptor antagonists aprepitant antiemetic'), false);
  expect('matching passage is a match', passageMatchesQuery('Aprepitant blocks NK1 receptors and prevents delayed chemotherapy-induced vomiting.', 'NK1 receptor antagonists aprepitant antiemetic'), true);
  expect('source phrase located in the explanation', sourceLeakWhere(mk({ stem: 'A 30-year-old man has a dry cough on enalapril.', explanation: 'As the supplied passage says, bradykinin accumulates.' }))[0]?.field, 'explanation');

  // A books-only run: the first reply is the writer saying no passage was supplied; the next attempt must use the internet.
  const books = [];
  const jobs = new Map();
  globalThis.__drops = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes('/api/ai/jobs/')) return new Response(JSON.stringify(jobs.get(u.split('/').pop())));
    if (u.includes('/api/ai/jobs')) {
      books.push(body.groundOn?.books ?? null);
      const refusal = books.length === 1;
      const text = JSON.stringify(refusal
        ? { stem: "No passage from the learner's books was supplied for this topic.", questionText: 'Which drug?', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctOption: 'A', explanation: 'none', sourceCheck: 'not supported' }
        : { stem: 'A 60-year-old woman with ovarian cancer receiving her first cycle of high-dose cisplatin develops persistent nausea and repeated vomiting on day three after chemotherapy, despite ondansetron and dexamethasone given before the infusion.', questionText: 'Which drug best prevents this delayed vomiting?', options: { A: 'Aprepitant', B: 'Metoclopramide', C: 'Domperidone', D: 'Promethazine' }, correctOption: 'A', explanation: `**Aprepitant blocks NK1 receptors.**\nBackground: ${'Delayed emesis is substance P driven. '.repeat(12)}\n- Metoclopramide: D2 blocker.\n- Domperidone: peripheral D2 blocker.\n- Promethazine: H1 blocker.\nHigh-yield: NK1 for delayed emesis.`, optionReasons: { A: 'NK1 antagonist.', B: 'D2 blocker.', C: 'D2 blocker.', D: 'H1 blocker.' }, keyFact: 'Aprepitant prevents delayed CINV.', sourceCheck: 'supported' });
      const id = `j${jobs.size + 1}`;
      jobs.set(id, { id, done: true, status: 200, body: { text } });
      return new Response(JSON.stringify({ id }));
    }
    if (u.includes('/api/ai/verify-item')) return new Response(JSON.stringify({ verdict: 'supported' }));
    if (u.includes('/api/ai/complete')) return new Response(JSON.stringify({ text: '{"ok":true,"problem":""}' }));
    return new Response('{}');
  };
  startRun({ exam: 'NEET_PG', requested: 1 });
  const run = await generateExamQuestions({
    exam: 'NEET_PG', count: 1, requestedTopic: 'Pharmacology', booksOnly: true, difficultyTier: 'MEDIUM', includeImages: false,
    subjectSubtopics: [{ subject: 'Pharmacology', subtopics: ['Antiemetic receptors: 5-HT3, NK1 and D2'] }],
    factPlan: [{ subtopic: 'Antiemetic receptors: 5-HT3, NK1 and D2', fact: 'Aprepitant, an NK1 antagonist, prevents delayed chemotherapy-induced vomiting.', quote: 'x', source: 'KDT' }],
    specialities: ['Pharmacology'],
  });
  const report = finishRun();
  expect('source miss: question kept on the next attempt', run.questions.length, 1);
  expect('source miss: first attempt used books, the next the internet', books.slice(0, 2), [true, null]);
  expect('report counts the source miss', report.rejectionsByReason['source-miss'], 1);
  const miss = report.records.find((r) => r.reason === 'source-miss');
  expect('report keeps what the writer said', /No passage/.test(String(miss?.detail?.writerSaid)), true);
  expect('report keeps slot, attempt and source', [miss?.attempt, miss?.source], [0, 'books']);
  expect('report records the kept question with its subject', report.records.find((r) => r.outcome === 'accepted')?.subject, 'Pharmacology');
}

console.log(fails ? `${fails} FAILED` : 'all pipeline checks passed');
process.exit(fails ? 1 : 0);
