// Offline checks of the style rules with hand-written good and bad questions. No model, no network.
//   node --import tsx tools/quality/styles.test.mjs
import { styleProblem, hasDuplicateOptions, leadInFitsFact, pointsAtMissingPicture, unpointDescribedPicture, inventedSource, explainsDistractors, planSlots, stylesFromChips, leadInsFromChips } from '../../src/lib/questionStyles.ts';

const mk = (o) => ({ stem: '', questionText: '', options: [], correctOption: 'A', explanation: '', ...o });
const opts = (...t) => t.map((text, i) => ({ id: 'ABCDE'[i], text }));
let fails = 0;
const expect = (name, got, want) => {
  const ok = want === null ? got === null : String(got ?? '').startsWith(want);
  if (!ok) { fails += 1; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const slot = (style, extra = {}) => ({ style, tier: 'MEDIUM', related: [], ...extra });
const mi = 'A 58-year-old man presents with crushing chest pain for 40 minutes radiating to the left arm. He is sweating, pulse 98/min, blood pressure 130/80 mmHg. ECG shows ST elevation in leads II, III and aVF.';

// vignette
expect('vignette good', styleProblem(mk({ stem: mi, questionText: 'What is the most likely diagnosis?', options: opts('a', 'b', 'c', 'd') }), slot('vignette', { leadIn: 'diagnosis' }), 4), null);
expect('vignette no patient', styleProblem(mk({ stem: 'Chest pain with ST elevation is seen in this condition on the tracing of the heart in many people.', questionText: 'What is it?', options: opts('a', 'b', 'c', 'd') }), slot('vignette'), 4), 'not-a-vignette');
expect('vignette wrong lead-in', styleProblem(mk({ stem: mi, questionText: 'Which artery is most likely occluded?', options: opts('a', 'b', 'c', 'd') }), slot('vignette', { leadIn: 'next-step' }), 4), 'wrong-lead-in');
// one-liner
expect('one-liner good', styleProblem(mk({ stem: 'Nephrotic syndrome in children is most commonly caused by', questionText: 'Which of the following?', options: opts('a', 'b', 'c', 'd') }), slot('one-liner'), 4), null);
expect('one-liner patient', styleProblem(mk({ stem: 'A 6-year-old boy has puffy eyes and frothy urine for 2 weeks.', questionText: 'Which is the cause?', options: opts('a', 'b', 'c', 'd') }), slot('one-liner'), 4), 'one-liner-has-patient');
// negative
expect('negative good', styleProblem(mk({ stem: 'Regarding isoniazid', questionText: 'Which of the following is NOT true?', options: opts('a', 'b', 'c', 'd') }), slot('negative'), 4), null);
expect('negative missing', styleProblem(mk({ stem: 'Regarding isoniazid', questionText: 'Which of the following is true?', options: opts('a', 'b', 'c', 'd') }), slot('negative'), 4), 'no-negative-lead-in');
// match
const matchStem = 'Match List I with List II.\nList I\nA. Coagulative necrosis\nB. Caseous necrosis\nC. Fat necrosis\nD. Fibrinoid necrosis\nList II\n1. Tuberculosis\n2. Myocardial infarction\n3. Pancreatitis\n4. Vasculitis';
const matchOpts = opts('A-2, B-1, C-3, D-4', 'A-1, B-2, C-3, D-4', 'A-2, B-1, C-4, D-3', 'A-3, B-1, C-2, D-4');
expect('match good', styleProblem(mk({ stem: matchStem, questionText: 'Choose the correct combination.', options: matchOpts }), slot('match'), 4), null);
expect('match plain options', styleProblem(mk({ stem: matchStem, questionText: 'Choose the correct combination.', options: opts('Coagulative', 'Caseous', 'Fat', 'Fibrinoid') }), slot('match'), 4), 'match-options-not-combinations');
expect('match no lists', styleProblem(mk({ stem: 'Match the necrosis with its cause.', questionText: 'Choose', options: matchOpts }), slot('match'), 4), 'match-lists-incomplete');
// multi
const multiStem = 'Consider the following statements about DKA:\n1. Blood glucose is usually above 250 mg/dL.\n2. Ketones are present.\n3. Bicarbonate is raised.\n4. Anion gap is high.';
expect('multi good', styleProblem(mk({ stem: multiStem, questionText: 'Which of the statements is/are correct?', options: opts('1 and 3 only', '1, 2 and 4 only', '2, 3 and 4 only', '1 and 4 only') }), slot('multi-statement'), 4), null);
expect('multi plain', styleProblem(mk({ stem: multiStem, questionText: 'Which is correct?', options: opts('glucose', 'ketones', 'bicarbonate', 'gap') }), slot('multi-statement'), 4), 'statement-options-not-combinations');
expect('multi unnumbered', styleProblem(mk({ stem: 'Regarding DKA', questionText: 'Which is correct?', options: opts('1 and 3 only', '1, 2 and 4 only', '2, 3 and 4 only', '1 and 4 only') }), slot('multi-statement'), 4), 'no-numbered-statements');
// assertion
const arOpts = opts('Both A and R are true and R is the correct explanation of A', 'Both A and R are true but R is not the correct explanation of A', 'A is true but R is false', 'A is false but R is true');
expect('assertion good', styleProblem(mk({ stem: 'Assertion (A): Magnesium sulphate is used in eclampsia.\nReason (R): It prevents recurrent seizures.', questionText: 'Choose the correct option.', options: arOpts }), slot('assertion-reason'), 4), null);
expect('assertion missing', styleProblem(mk({ stem: 'Magnesium sulphate is used in eclampsia.', questionText: 'Why?', options: opts('a', 'b', 'c', 'd') }), slot('assertion-reason'), 4), 'no-assertion-reason');
// calculation
const calcStem = 'In a screening test, 90 of 100 diseased persons test positive and 160 of 200 healthy persons test negative.';
expect('calc good', styleProblem(mk({ stem: calcStem, questionText: 'What is the sensitivity?', options: opts('80%', '90%', '70%', '60%'), explanation: 'Sensitivity = 90/100 = 90%.' }), slot('calculation'), 4), null);
expect('calc no working', styleProblem(mk({ stem: calcStem, questionText: 'What is the sensitivity?', options: opts('80%', '90%', '70%', '60%'), explanation: 'Sensitivity is the proportion of diseased people detected.' }), slot('calculation'), 4), 'calculation-no-working');
expect('calc words', styleProblem(mk({ stem: calcStem, questionText: 'What is the sensitivity?', options: opts('high', 'low', 'moderate', 'zero'), explanation: '90/100 = 90%' }), slot('calculation'), 4), 'calculation-options-not-numbers');
// pictures and option count
expect('dangling', styleProblem(mk({ stem: 'The pattern seen in this biopsy is most characteristic of', questionText: 'Which vasculitis?', options: opts('a', 'b', 'c', 'd') }), slot('one-liner'), 4), 'refers-to-missing-picture');
expect('described ok', pointsAtMissingPicture(mk({ stem: 'A chest X-ray shows a boot-shaped heart with oligaemic lung fields.', questionText: 'What is the diagnosis?' })) ? 'pointer' : null, null);
expect('pointer with image', pointsAtMissingPicture(mk({ stem: 'Identify the condition shown in this image', image: 'x' })) ? 'pointer' : null, null);
expect('pointer no image', pointsAtMissingPicture(mk({ stem: 'Identify the condition shown in this image' })) ? 'pointer' : null, 'pointer');
expect('image style ok', styleProblem(mk({ stem: 'A chest X-ray shows a boot-shaped heart with oligaemic lung fields.', questionText: 'What is the diagnosis?', options: opts('a', 'b', 'c', 'd') }), slot('image'), 4), null);
expect('option count AMC', styleProblem(mk({ stem: 'A 40-year-old woman presents to her GP with 3 weeks of low mood and poor sleep and loss of interest in her usual activities at work.', questionText: 'What is the most appropriate next step?', options: opts('a', 'b', 'c', 'd') }), slot('vignette', { leadIn: 'next-step' }), 5), 'wrong-option-count');
expect('image style plain text', styleProblem(mk({ stem: 'Stable angina is assessed with a treadmill stress test and the physician wants to delay ischaemic changes.', questionText: 'Which drug class helps?', options: opts('a', 'b', 'c', 'd') }), slot('image'), 4), 'no-picture-description');
expect('vignette needs a case', styleProblem(mk({ stem: 'Artemether-lumefantrine is an oral combination used for uncomplicated falciparum malaria and must be taken with fatty food for good absorption of the drug.', questionText: 'What is needed?', options: opts('a', 'b', 'c', 'd') }), slot('vignette'), 4), 'not-a-vignette');
expect('negative only in question line', styleProblem(mk({ stem: 'Regarding isoniazid, it is not hepatotoxic in children.', questionText: 'Which statement is best?', options: opts('a', 'b', 'c', 'd') }), slot('negative'), 4), 'no-negative-lead-in');
// explanation coverage
const q1 = mk({ options: opts('Hypomagnesaemia', 'Hyperkalaemia', 'Hypernatraemia', 'Hypercalcaemia'), correctOption: 'A', explanation: 'Long-term PPI use impairs intestinal magnesium absorption, so hypomagnesaemia is the recognised effect. Hyperkalaemia and hypernatraemia are not linked to PPIs; option D is also wrong because hypercalcaemia is not seen.' });
expect('explains yes', explainsDistractors(q1) ? null : 'no', null);
expect('explains no', explainsDistractors({ ...q1, explanation: 'Long-term PPI use impairs intestinal magnesium absorption, which is why hypomagnesaemia is the recognised adverse effect of these drugs.' }) ? null : 'no', 'no');

// slot planning
const facts = Array.from({ length: 20 }, (_, i) => ({ fact: `Fact ${i} about drug ${i % 2 ? 'with 5 mg dose' : 'effect'}`, subtopic: `Sub ${i % 4}`, picturable: i % 5 === 0 }));
const count = (slots, key) => slots.reduce((m, s) => { m[s[key]] = (m[s[key]] || 0) + 1; return m; }, {});
const neet = planSlots(facts, 'NEET_PG', [], [], 'ALL');
expect('neet few negatives', String(count(neet, 'style').negative <= 2), 'true');
expect('neet no match', 'match' in count(neet, 'style') ? 'has match' : null, null);
const tiers = count(neet, 'tier');
expect('tier mix', `${tiers.LOW}/${tiers.MEDIUM}/${tiers.HIGH}`, '4/9/7');
const ini = planSlots(facts, 'INI_CET', [], [], 'ALL');
expect('ini negative about 16%', String(count(ini, 'style').negative), '3');
const anat = planSlots(facts.map((f) => ({ ...f, picturable: true })), 'NEET_PG', [], [], 'MEDIUM', 'Anatomy');
expect('anatomy mostly picture', String((count(anat, 'style').image || 0) >= 5), 'true');
const amc = planSlots(facts, 'AMC_CAT', [], [], 'MEDIUM');
expect('amc all vignettes', JSON.stringify(count(amc, 'style')), '{"vignette":20}');
const picked = planSlots(facts, 'INI_CET', stylesFromChips(['Match the following']), leadInsFromChips(['Next best step']), 'MEDIUM');
expect('picked match', String(count(picked, 'style').match), '20');
expect('picked related', String(picked[0].related.length > 0), 'true');
const lead = planSlots(facts, 'NEET_PG', ['vignette'], ['next-step', 'drug-of-choice'], 'MEDIUM');
expect('lead-ins split', JSON.stringify(count(lead, 'leadIn')), '{"next-step":10,"drug-of-choice":10}');
// drug-of-choice lead-ins written in other words, picture stems described in words, invented settings
const sau = "A 34-year-old hospital nurse has recurrent impetigo on the forearm after two courses of oral antibiotics. The crusted lesions are 3 cm across, with no fever or lymphadenopathy. Culture grows Staphylococcus aureus resistant to fusidic acid and erythromycin.";
expect("drug choice: most appropriate choice", styleProblem(mk({ stem: sau, questionText: "Which topical agent is the most appropriate choice for this lesion?", options: opts("a", "b", "c", "d") }), slot("vignette", { leadIn: "drug-of-choice" }), 4), null);
expect("drug choice: agent is most appropriate", styleProblem(mk({ stem: sau, questionText: "Which topical agent is most appropriate for the local lesion?", options: opts("a", "b", "c", "d") }), slot("vignette", { leadIn: "drug-of-choice" }), 4), null);
expect("drug choice: not a drug question", styleProblem(mk({ stem: sau, questionText: "Which enzyme does the organism produce that explains the resistance?", options: opts("a", "b", "c", "d") }), slot("vignette", { leadIn: "drug-of-choice" }), 4), "wrong-lead-in");
const described = mk({ stem: "A PAS-stained section of nail clippings from a 56-year-old woman shows pink septate hyphae and arthrospores in the nail keratin.", questionText: "Which fungus is seen in this section?" });
expect("described picture kept", String(unpointDescribedPicture(described) && !pointsAtMissingPicture(described)), "true");
const bare = mk({ stem: "A 56-year-old woman has a thick yellow toenail. A biopsy was taken.", questionText: "Which fungus is seen in this section?" });
expect("undescribed picture still dropped", String(unpointDescribedPicture(bare) || !pointsAtMissingPicture(bare)), "false");
expect("stock list is invented", String(inventedSource(mk({ stem: "A community pharmacist in Munich compares the cephalosporins on the practice stock list." }))), "true");
expect("hospital in Delhi is fine", String(inventedSource(mk({ stem: "A 30-year-old woman attends a hospital in Delhi with fever and dysuria." }))), "false");
// option duplicates and planner lead-ins
expect("exact option duplicate", String(hasDuplicateOptions(mk({ options: opts("Penicillin G", "penicillin-g", "Ceftriaxone", "Meropenem") }))), "true");
expect("option letter variants kept", String(hasDuplicateOptions(mk({ options: opts("Penicillin G", "Penicillin V", "Ceftriaxone", "Meropenem") }))), "false");
expect("option polarity grid kept", String(hasDuplicateOptions(mk({ options: opts("Gram-negative, acid-fast", "Gram-negative, non-acid-fast", "Gram-positive, acid-fast", "Gram-positive, non-acid-fast") }))), "false");
expect("option dose variants kept", String(hasDuplicateOptions(mk({ options: opts("Doxycycline 100 mg for 7 days", "Doxycycline 100 mg for 14 days", "Doxycycline 100 mg for 28 days", "Ceftriaxone for 10 days") }))), "false");
expect("treatment lead-in needs treatment fact", String(leadInFitsFact("Phospholipase C degrades the host cell membrane.", "treatment-of-choice")), "false");
expect("treatment fact accepts treatment lead-in", String(leadInFitsFact("Penicillin is the first-line treatment for this infection.", "treatment-of-choice")), "true");
const nonTreatmentFacts = [
  { fact: "Phospholipase C degrades host cell membranes.", subtopic: "virulence", picturable: false },
  { fact: "The MBC is not used to guide antibiotic selection.", subtopic: "testing", picturable: false },
  { fact: "Cephalosporin P, N and C groups are derivatives.", subtopic: "cephalosporins", picturable: false },
  { fact: "Ziehl-Neelsen stain is also called AFB stain.", subtopic: "stains", picturable: false },
];
const autoLeadSlots = planSlots(nonTreatmentFacts, 'NEET_PG', ['vignette'], [], 'MEDIUM');
expect("default lead-ins fit non-treatment facts", String(autoLeadSlots.every((s) => s.leadIn === 'finding' || s.leadIn === 'diagnosis')), "true");
console.log(fails ? `${fails} FAILED` : 'all style checks passed');
process.exit(fails ? 1 : 0);
