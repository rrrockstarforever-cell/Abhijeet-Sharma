// NEET PG (NBEMS) question pipeline. Only NEET PG behaviour lives here; INI-CET has its own file.
//
// What the recent papers look like (2022 onwards, see pyqProfile.ts): about a third long clinical vignettes, two
// fifths picture items (described in words when no picture is attached), a fifth one-liners, about 5% NOT items.
// Every item is single best answer with 4 options: no match-the-following, numbered statements or assertion-reason.
// The learner asked for questions harder than the real paper, so the difficulty mix leans hard.
import type { ClinicalQuestion } from '../../types.ts';
import { PYQ_PROFILE } from '../pyqProfile.ts';
import type { LeadIn, StyleId } from '../questionStyles.ts';
import type { ExamPipeline } from './types.ts';
import { cleanOptionLabels, hasAboveOption, splitStemQuestion, type Tier } from './shared.ts';

const SBA = 'Single best answer with a direct lead-in (diagnosis, finding, next step, drug of choice or investigation of choice). Never a numbered-statements, match or assertion-reason item.';

export const NEET_PG_PIPELINE: ExamPipeline = {
  exam: 'NEET_PG',
  name: 'NEET PG',
  optionCount: 4,

  pattern:
    'NEET PG (NBEMS) pattern. Exactly 4 options (A-D), one correct; +4 for correct, -1 for wrong. ' +
    'Mostly clinical vignettes of 3 to 5 sentences giving age, sex, presenting complaint, relevant history, vitals or examination and one or two investigation results, ending with ONE lead-in ' +
    '("What is the most likely diagnosis?", "What is the next best step in management?", "What is the investigation of choice?", "What is the drug of choice?"). ' +
    'Mix in one-liner recall items and image-based items whose finding is described in words ("A chest X-ray shows ..."). ' +
    'Integrated items that link two subjects (for example pathology with pharmacology) are welcome. ' +
    'Every item is single best answer: no numbered-statement, match-the-following or assertion-reason items.',

  rules:
    'NEET PG (NBEMS): exactly 4 options (A-D), one correct, single best answer. Options are homogeneous and close. ' +
    'Standard Indian textbook answers (Harrison, Robbins, KD Tripathi, Park, Bailey & Love, DC Dutta, Ghai) decide the key.',

  itemShape(idx: number): string {
    // Two in three are vignettes; the rest alternate one-liner and image-described items.
    const slot = idx % 6;
    if (slot === 2) return `${SBA} One-liner recall: one short line, no patient.`;
    if (slot === 5) return `${SBA} Image-described item: start the stem with the picture type and state its findings in words ("An ECG shows ..."), then ask for the diagnosis or structure.`;
    return `${SBA} Clinical vignette of 3 to 5 sentences.`;
  },

  styleMix(subject?: string): [StyleId, number][] {
    const profile = PYQ_PROFILE.NEET_PG;
    const known = subject && Object.keys(profile.subjects).find((k) => k.toLowerCase() === subject.toLowerCase());
    const sh = known ? profile.subjects[known] : profile.all;
    const calc = subject === 'PSM' ? 5 : 1;
    const mech = 2;
    const mix: [StyleId, number][] = [
      ['one-liner', Math.max(0, sh['one-liner'] - calc - mech)],
      ['short-case', sh['short-case']],
      // Harder than the paper: some one-liner weight moves to full vignettes.
      ['vignette', sh.vignette + 5],
      ['negative', sh.negative],
      ['image', sh.image],
      ['calculation', calc],
      ['mechanism', mech],
    ];
    return mix.filter(([, w]) => w > 0);
  },

  leadInMix: [['diagnosis', 30], ['finding', 25], ['next-step', 17], ['drug-of-choice', 12], ['investigation-of-choice', 10], ['treatment-of-choice', 6]] as [LeadIn, number][],

  // Real NEET PG is roughly 20/45/35; the learner wants it harder.
  tierMix: [['LOW', 10], ['MEDIUM', 45], ['HIGH', 45]],

  tierText(style: StyleId | undefined, tier: Tier): string {
    const caseLike = !style || style === 'vignette' || style === 'short-case' || style === 'image';
    if (caseLike) {
      return {
        LOW: 'EASY (still exam level): one inferential step from the findings to the answer. Distractors share the key\'s category and are plausible.',
        MEDIUM: 'MEDIUM, a little above the real NEET PG: the candidate must first identify the condition from the findings (never named in the stem), then answer about it. Distractors are its classic mimics.',
        HIGH: 'HARD, above the real NEET PG: two or three reasoning steps (findings → diagnosis → complication, mechanism or management), or an atypical presentation. Every distractor is right in a slightly different patient; only the exact details given make one option best. Not answerable from one buzzword.',
      }[tier];
    }
    return {
      LOW: 'EASY: a standard textbook fact; distractors are plausible but clearly weaker.',
      MEDIUM: 'MEDIUM: recall plus one inference; distractors are the classic confusions of this fact.',
      HIGH: 'HARD: precise textbook detail (the exception, the most common vs the most specific, the first vs the best); every distractor is individually plausible.',
    }[tier];
  },

  styleAddendum: {
    vignette: 'NEET PG vignette length overrides the length above: 3 to 5 sentences, about 45 to 70 words, with age, sex, complaint with duration, relevant history, vitals or examination and one or two results.',
    'short-case': 'Keep it to two or three sentences, about 25 to 40 words.',
    negative: 'NEET PG uses NOT items rarely: make the false option a classic misconception, and write NOT or EXCEPT in capitals.',
  },

  examinerFocus:
    'Hold it to NEET PG standard: the key must be the answer in standard Indian textbooks (Harrison, Robbins, KD Tripathi, Park, Bailey & Love, DC Dutta, Ghai) and current national programmes. ' +
    'Also mark ok=false when the key is what one source or set of notes says but not the standard textbook answer (for example a Mantoux cut-off or a lesion size that differs from the standard figure). ' +
    'A question asking for an obscure research detail, a non-Indian practice that conflicts with the Indian standard, or a key that depends on one particular book edition is not acceptable.',

  examinerChecks:
    'Also mark ok=false when: the stem or question line names or paraphrases the answer (for example a biopsy report that already states the finding asked for); ' +
    'the patient case is not needed to answer the question; the question asks a percentage, size, case-series figure or eponym that standard textbooks do not emphasise; ' +
    'or the item is really about another disease (for example leprosy or syphilis under a tuberculosis topic).',

  selfCheck:
    'Before replying, check your draft and fix it if any answer is no: ' +
    '(1) exactly 4 options, one clearly best; (2) the stem never names the answer or its distinctive words; ' +
    '(3) the stem ends with the last finding and the question is only in questionText; ' +
    '(4) every option is a plain label of 1 to 6 words with no reasoning, no brackets, no "all/none of the above"; ' +
    '(5) the correct option is not the longest and not the only one with words like always, never or only; ' +
    '(6) no two options mean the same thing; (7) the explanation has Background, why the key is right, one bullet for every wrong option by its text, and High-yield; ' +
    '(8) the stem never points at a picture ("this image") unless the style is image-based and the stem says what it shows; ' +
    '(9) the stem does not name or paraphrase the answer; (10) if there is a patient, the question needs the patient\'s findings (never a general proportion, commonest-site-overall or alternative-name question after a case); ' +
    '(11) no two options are opposites of each other ("usually one joint" / "usually several joints"); (12) the key is the standard textbook answer, not one source\'s wording.',

  normalize(q: ClinicalQuestion): void {
    splitStemQuestion(q);
    cleanOptionLabels(q);
    // NOT/EXCEPT lead-ins are written in capitals in the paper.
    const line = (q as { questionText?: string }).questionText;
    if (line) (q as { questionText?: string }).questionText = line.replace(/\b(not|except)\b(?=[^?]*\?)/g, (w) => w.toUpperCase());
  },

  validate(q: ClinicalQuestion): string | null {
    if (hasAboveOption(q)) return 'above-option: NEET PG items never use "all/none of the above" or "both A and B"; give four real, specific options';
    const optionText = (q.options ?? []).map((o) => o.text).join(' ');
    if (/^\s*\d(\s*(,|and|&)\s*\d)+\s*(only)?\s*$/im.test(optionText) || /\bA\s*[-–]\s*\d\s*,\s*B\s*[-–]\s*\d/.test(optionText)) {
      return 'coded-options: NEET PG is single best answer; do not use statement combinations or match codes';
    }
    return null;
  },
};
