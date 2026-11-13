// INI-CET (AIIMS) question pipeline. Only INI-CET behaviour lives here; NEET PG has its own file.
//
// What the recent papers look like (2022 onwards, see pyqProfile.ts): about two fifths one-liners, a sixth vignettes,
// a fifth picture items and about one in six NOT/EXCEPT items, with an occasional match-the-following. Distractors are
// very close and conceptual depth is higher than NEET PG. The learner asked for questions harder than the real paper,
// so the difficulty mix leans hard.
import type { ClinicalQuestion } from '../../types.ts';
import { PYQ_PROFILE } from '../pyqProfile.ts';
import type { LeadIn, StyleId } from '../questionStyles.ts';
import type { ExamPipeline } from './types.ts';
import { cleanOptionLabels, hasAboveOption, splitStemQuestion, type Tier } from './shared.ts';

export const INI_CET_PIPELINE: ExamPipeline = {
  exam: 'INI_CET',
  name: 'INI-CET',
  optionCount: 4,

  pattern:
    'INI-CET (AIIMS) pattern. Exactly 4 options (A-D); +1 correct, -1/3 wrong. ' +
    'Many items are crisp one-liners that test one level deeper than the headline textbook fact (the exception, the most specific vs the most common, the first vs the best). ' +
    'Others are short clinical vignettes or image items described in words. About one item in six asks which option is NOT true or is the EXCEPTION (write NOT or EXCEPT in capitals). ' +
    'Recent guidelines and recent advances are fair game. Distractors are very close, from the same family as the key, so elimination is hard.',

  rules:
    'INI-CET (AIIMS): exactly 4 options (A-D), one correct. Distractors are very close (same drug class, same organism family, neighbouring structures); elimination must be hard. ' +
    'Current guidelines (WHO, ICMR, NTEP, NACO) and standard texts decide the key.',

  itemShape(idx: number): string {
    const slot = idx % 6;
    if (slot === 1) return 'Negative item: the question line asks which option is NOT true or is the EXCEPTION (capitals). Exactly three options are true statements and one is false; the false one is the key.';
    if (slot === 3) return 'Short clinical vignette of 2 to 4 sentences ending with one single-best-answer lead-in.';
    if (slot === 5) return 'Image-described item: start the stem with the picture type and state its findings in words, then ask for the diagnosis, finding or structure.';
    return 'One-liner single best answer that tests one level deeper than the headline fact (an exception, a most-specific or a first-line detail). No patient.';
  },

  styleMix(subject?: string): [StyleId, number][] {
    const profile = PYQ_PROFILE.INI_CET;
    const known = subject && Object.keys(profile.subjects).find((k) => k.toLowerCase() === subject.toLowerCase());
    const sh = known ? profile.subjects[known] : profile.all;
    const calc = subject === 'PSM' ? 4 : 1;
    const mech = 3;
    const mix: [StyleId, number][] = [
      ['one-liner', Math.max(0, sh['one-liner'] - calc - mech)],
      ['short-case', sh['short-case']],
      ['vignette', sh.vignette],
      ['negative', sh.negative],
      ['image', sh.image],
      ['calculation', calc],
      ['mechanism', mech],
      // Match-the-following is about 2% of INI-CET papers.
      ['match', 2],
    ];
    return mix.filter(([, w]) => w > 0);
  },

  leadInMix: [['diagnosis', 30], ['finding', 35], ['investigation-of-choice', 12], ['drug-of-choice', 10], ['next-step', 9], ['treatment-of-choice', 4]] as [LeadIn, number][],

  // INI-CET is already the harder paper; the learner wants it harder still.
  tierMix: [['LOW', 5], ['MEDIUM', 40], ['HIGH', 55]],

  tierText(style: StyleId | undefined, tier: Tier): string {
    const caseLike = !style || style === 'vignette' || style === 'short-case' || style === 'image';
    if (caseLike) {
      return {
        LOW: 'EASY (still AIIMS level): one inferential step; distractors are close relatives of the key.',
        MEDIUM: 'MEDIUM, above the real INI-CET: identify the condition from subtle findings (never named), then answer a detail about it. Distractors are its nearest mimics.',
        HIGH: 'HARD, above the real INI-CET: an atypical or overlapping presentation and two or three reasoning steps; the deciding clue is one specific finding or number in the stem. Every distractor is correct in a closely related scenario.',
      }[tier];
    }
    return {
      LOW: 'EASY: a standard fact asked precisely; distractors from the same family.',
      MEDIUM: 'MEDIUM: one level deeper than the headline fact (the exception, the most specific, the first-line vs the drug of choice); distractors are the classic near-misses.',
      HIGH: 'HARD: a precise, high-yield detail a well-read candidate knows (recent guideline change, the exception to the rule, the rarer-but-classic association); every distractor is individually plausible.',
    }[tier];
  },

  styleAddendum: {
    vignette: 'INI-CET vignette length overrides the length above: 2 to 4 sentences, about 35 to 60 words, with the one or two findings that decide the answer.',
    'one-liner': 'Ask one level deeper than the headline fact; the four options are close members of the same family.',
    negative: 'Write NOT or EXCEPT in capitals. The three true options are each specific, examinable facts (not vague truisms); the false one is a classic trap.',
    match: 'Every pair in the lists must be a standard, examinable association.',
  },

  examinerFocus:
    'Hold it to INI-CET (AIIMS) standard: the key must match standard texts and current guidelines (WHO, ICMR, NTEP, NACO, national programmes). ' +
    'Also mark ok=false when the key is what one source or set of notes says but not the standard textbook answer (for example a Mantoux cut-off or a lesion size that differs from the standard figure). ' +
    'For NOT/EXCEPT items exactly one option must be false and the other three clearly true. Close distractors are expected, but only one may be defensible.',

  examinerChecks:
    'Also mark ok=false when: the stem or question line names or paraphrases the answer (for example a biopsy report that already states the finding asked for); ' +
    'the patient case is not needed to answer the question; the question asks a percentage, size, case-series figure or eponym that standard textbooks do not emphasise; ' +
    'or the item is really about another disease (for example leprosy or syphilis under a tuberculosis topic).',

  selfCheck:
    'Before replying, check your draft and fix it if any answer is no: ' +
    '(1) exactly 4 options, exactly one defensible; for NOT/EXCEPT items exactly one option is false; ' +
    '(2) the stem never names the answer or its distinctive words; (3) the stem ends with the last finding and the question is only in questionText; ' +
    '(4) options are plain labels (statements only for NOT/true items) with no reasoning, no brackets and no "all/none of the above"; ' +
    '(5) the correct option is not the longest and not the only one with words like always, never or only; ' +
    '(6) no two options mean the same thing; (7) the explanation has Background, why the key is right, one bullet for every wrong option by its text, and High-yield; ' +
    '(8) the stem never points at a picture ("this image") unless the style is image-based and the stem says what it shows; ' +
    '(9) the stem does not name or paraphrase the answer; (10) if there is a patient, the question needs the patient\'s findings (never a general proportion, commonest-site-overall or alternative-name question after a case); ' +
    '(11) no two options are opposites of each other ("usually one joint" / "usually several joints"); (12) the key is the standard textbook answer, not one source\'s wording.',

  normalize(q: ClinicalQuestion): void {
    splitStemQuestion(q);
    cleanOptionLabels(q);
    const line = (q as { questionText?: string }).questionText;
    if (line) (q as { questionText?: string }).questionText = line.replace(/\b(not|except|incorrect)\b(?![-])(?=[^?]*\?)/gi, (w) => w.toUpperCase());
  },

  validate(q: ClinicalQuestion): string | null {
    if (hasAboveOption(q)) return 'above-option: INI-CET items here never use "all/none of the above" or "both A and B"; give four real, specific options';
    return null;
  },
};
