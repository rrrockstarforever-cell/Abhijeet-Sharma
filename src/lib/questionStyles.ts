// Question styles: one place that says what each style is, how to ask the writer for it, and how to check it was
// delivered. The generator uses it to plan a set (which style each question gets) and to reject a question whose
// shape is wrong; the quality tests use the same rules.
import type { ClinicalQuestion, ExamType } from '../types.ts';
import { PYQ_PROFILE, type StyleShares } from './pyqProfile.ts';

export type StyleId =
  | 'vignette' | 'short-case' | 'one-liner' | 'negative' | 'match'
  | 'multi-statement' | 'assertion-reason' | 'calculation' | 'mechanism' | 'image';

export type LeadIn = 'next-step' | 'drug-of-choice' | 'investigation-of-choice' | 'treatment-of-choice' | 'diagnosis' | 'advice' | 'finding';

/** One question slot of a set: its style, lead-in, difficulty and the other facts it may draw on. */
export interface Slot {
  style: StyleId;
  leadIn?: LeadIn;
  tier: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Other planned facts of the same subtopic: the true statements for NOT, match and statement items. */
  related: string[];
}

const PATIENT = /\b(\d{1,3}[- ]?(?:year|month|week|day)s?[- ]?old|\d{1,3}[- ]?(?:yo|y\/o)\b|\b(?:man|woman|boy|girl|patient|child|infant|neonate|baby|male|female|lady|traveller|farmer|worker)\b[^.?]{0,50}\b(?:presents?|presented|comes|came|brought|complains?|complained|admitted|referred|reports?|reported|has|had|returns?|returned|develops?|developed|is being|was found|undergoes?)\b)/i;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** What a lead-in asks, and how to recognise it in the question line. */
const LEAD_INS: Record<LeadIn, { ask: string; test: RegExp }> = {
  'next-step': { ask: 'The question line asks for the next best step in management ("What is the most appropriate next step in management?").', test: /next (best |appropriate )?step|next step|most appropriate (next )?(step|management|action|initial)|best next|initial management/i },
  'drug-of-choice': { ask: 'The question line asks for the drug of choice or the most appropriate drug ("Which drug is the drug of choice?").', test: /drug of choice|most appropriate (drug|medication|treatment|therapy|agent|antibiotic|regimen|prophylaxis|dose)|first[- ]line|best (drug|treatment|agent|regimen)|treatment of choice|regimen of choice/i },
  'investigation-of-choice': { ask: 'The question line asks for the investigation of choice or the most appropriate test ("Which investigation is most appropriate?").', test: /investigation|test|imaging|scan|biopsy|gold standard|most (appropriate|useful|sensitive|specific)|best (initial )?(test|investigation)/i },
  'treatment-of-choice': { ask: 'The question line asks for the treatment of choice ("What is the treatment of choice?").', test: /treatment|management|therapy|drug|manage|intervention|procedure/i },
  diagnosis: { ask: 'The question line asks for the most likely diagnosis ("What is the most likely diagnosis?"). The stem must carry enough findings to settle it.', test: /diagnosis|condition|disorder|disease|most likely/i },
  finding: { ask: 'The question line asks for a finding, feature, cause, complication or association of the stated condition ("Which of the following is the most likely finding?", "... is associated with?").', test: /./ },
  advice: { ask: 'The question line asks for the most appropriate advice or counselling ("What is the most appropriate advice to give this patient?").', test: /advice|counsel|inform|explain|tell|reassur|educat|recommend/i },
};

export interface StyleSpec {
  id: StyleId;
  /** Question-type chips in the Practice Builder that select this style. */
  chips: string[];
  /** How to ask the writer for it. */
  instruction: (slot: Slot, optionCount: number) => string;
  /** Null when the shape is right, otherwise a short reason. */
  validate: (q: ClinicalQuestion, slot: Slot) => string | null;
  /** Needs the item the related facts (three or more) to be written well. */
  needsRelated: boolean;
  /** Options are combinations or numbers, so the "similar options" check does not apply. */
  codedOptions: boolean;
  /** What the examiner must confirm about the shape. */
  judge: string;
}

const letters = (n: number) => 'ABCDE'.slice(0, n);
const questionLine = (q: ClinicalQuestion) => String((q as { questionText?: string }).questionText ?? '');
const optionTexts = (q: ClinicalQuestion) => (q.options || []).map((o) => String(o.text ?? ''));
const relatedLine = (slot: Slot) => (slot.related.length ? ` Draw on these related facts (they are sourced and true): ${slot.related.slice(0, 6).map((f) => `"${f.slice(0, 140)}"`).join(' | ')}.` : '');

export const STYLES: Record<StyleId, StyleSpec> = {
  vignette: {
    id: 'vignette', chips: ['Clinical vignette'], needsRelated: false, codedOptions: false,
    judge: 'a clinical vignette (age, sex, presentation, findings) ending in one question',
    instruction: (slot) => `Style: clinical vignette. Write 2 to 4 sentences (about 30 to 45 words): age, sex, presenting complaint, the key finding or result, then ONE question. Real exam vignettes are brief. Weave in the findings that point to the tested fact; do not name the answer. ${slot.leadIn ? LEAD_INS[slot.leadIn].ask : 'End with one clear lead-in.'}`,
    validate: (q, slot) => {
      if (!PATIENT.test(q.stem ?? '')) return 'not-a-vignette: the stem has no patient (age and sex)';
      if (words(q.stem ?? '') < 22) return 'vignette-too-short: add presentation, findings and results';
      if (slot.leadIn && !LEAD_INS[slot.leadIn].test.test(questionLine(q))) return `wrong-lead-in: the question line must be a ${slot.leadIn.replace(/-/g, ' ')} question`;
      return null;
    },
  },
  'short-case': {
    id: 'short-case', chips: ['Clinical vignette'], needsRelated: false, codedOptions: false,
    judge: 'a short patient case of at most three sentences ending in one question',
    instruction: (slot) => `Style: short case. At most three sentences: age and sex, the presentation, then ONE question. The answer is the named fact itself. ${slot.leadIn ? LEAD_INS[slot.leadIn].ask : ''}`,
    validate: (q, slot) => {
      if (!PATIENT.test(q.stem ?? '')) return 'not-a-case: the stem has no patient (age and sex)';
      if (slot.leadIn && !LEAD_INS[slot.leadIn].test.test(questionLine(q))) return `wrong-lead-in: the question line must be a ${slot.leadIn.replace(/-/g, ' ')} question`;
      return null;
    },
  },
  'one-liner': {
    id: 'one-liner', chips: ['One-liner recall'], needsRelated: false, codedOptions: false,
    judge: 'a one-line factual recall question with no patient',
    instruction: () => 'Style: one-liner recall. One short line (under 25 words) about the fact, for example "Which of the following is ...?" or "... is caused by?". No patient: the stem has no age, no sex and no "a patient" or "a child". The stem must still give a subject (a drug, condition, structure or finding), not just a topic label.',
    validate: (q) => {
      if (PATIENT.test(q.stem ?? '')) return 'one-liner-has-patient: remove the patient';
      if (words(`${q.stem ?? ''} ${questionLine(q)}`) > 35) return 'one-liner-too-long: keep it to one short line';
      return null;
    },
  },
  negative: {
    id: 'negative', chips: ['NOT / EXCEPT'], needsRelated: true, codedOptions: false,
    judge: 'a NOT/EXCEPT/FALSE question where exactly one option is the false one',
    instruction: (slot) => `Style: negative lead-in. The question line is "Which of the following is NOT true about ...?" (or "All of the following are features of ... EXCEPT"). Exactly three options are true statements about the topic and exactly one is false; the false one is the key.${relatedLine(slot)}`,
    validate: (q) => (/\b(NOT|EXCEPT|FALSE|INCORRECT|LEAST|UNTRUE|exception)\b/i.test(questionLine(q)) || /\b(EXCEPT)\b/.test(q.stem ?? '') ? null : 'no-negative-lead-in: the question line must say NOT, EXCEPT or FALSE'),
  },
  match: {
    id: 'match', chips: ['Match the following'], needsRelated: true, codedOptions: true,
    judge: 'a match-the-following item: two lists, options are combinations such as A-2, B-4, C-1, D-3, exactly one fully correct',
    instruction: (slot, n) => `Style: match the following. In the stem write "Match List I with List II." then List I as lines "A. ...", "B. ...", "C. ...", "D. ..." and List II as lines "1. ...", "2. ...", "3. ...", "4. ...". The question line is "Choose the correct combination." The ${n} options are different combinations written like "A-2, B-4, C-1, D-3"; exactly one is fully correct and each wrong one differs from it in at least two pairs.${relatedLine(slot)}`,
    validate: (q) => {
      const stem = q.stem ?? '';
      if (!/match/i.test(`${stem} ${questionLine(q)}`)) return 'no-match-lists: the stem must say "Match List I with List II"';
      if (!(/\bA[.)]\s*\S/.test(stem) && /\bD[.)]\s*\S/.test(stem) && /\b1[.)]\s*\S/.test(stem) && /\b4[.)]\s*\S/.test(stem))) return 'match-lists-incomplete: list items A-D and 1-4 are required in the stem';
      const combos = optionTexts(q).filter((t) => (t.match(/[A-D]\s*[-–:→]\s*[1-4]/g) ?? []).length >= 3);
      if (combos.length < (q.options?.length ?? 4)) return 'match-options-not-combinations: options must look like "A-2, B-4, C-1, D-3"';
      if (new Set(optionTexts(q).map(norm)).size !== optionTexts(q).length) return 'match-options-repeat';
      return null;
    },
  },
  'multi-statement': {
    id: 'multi-statement', chips: ['Multiple statements ("1 and 3 only")'], needsRelated: true, codedOptions: true,
    judge: 'a numbered-statements item: statements 1-4 in the stem, options such as "1 and 3 only", exactly one correct combination',
    instruction: (slot, n) => `Style: multiple statements. The stem is "Consider the following statements about ...:" then statements 1., 2., 3. and 4., each on its own line and each a complete claim. The question line is "Which of the statements is/are correct?" The ${n} options are combinations such as "1 and 3 only", "2, 3 and 4 only", "1, 2 and 4 only", "1 and 4 only"; exactly one combination is correct.${relatedLine(slot)}`,
    validate: (q) => {
      const stem = q.stem ?? '';
      const numbered = [1, 2, 3].every((n) => new RegExp(`(^|\\s|\\n)${n}[.)]\\s*\\S`).test(stem));
      if (!numbered) return 'no-numbered-statements: list statements 1., 2., 3. (and 4.) in the stem';
      const combos = optionTexts(q).filter((t) => /^\s*\d(\s*(,|and|&)\s*\d)*(\s*only)?\s*$/i.test(t));
      if (combos.length < Math.max(3, (q.options?.length ?? 4) - 1)) return 'statement-options-not-combinations: options must look like "1 and 3 only"';
      return null;
    },
  },
  'assertion-reason': {
    id: 'assertion-reason', chips: ['Assertion-reason'], needsRelated: false, codedOptions: true,
    judge: 'an assertion-reason item with the four standard options, exactly one correct',
    instruction: () => 'Style: assertion-reason. The stem is "Assertion (A): ..." on one line and "Reason (R): ..." on the next. The four options are exactly: "Both A and R are true and R is the correct explanation of A", "Both A and R are true but R is not the correct explanation of A", "A is true but R is false", "A is false but R is true". The question line is "Choose the correct option." Exactly one option is correct.',
    validate: (q) => {
      if (!/assertion/i.test(q.stem ?? '') || !/reason/i.test(q.stem ?? '')) return 'no-assertion-reason: the stem needs "Assertion (A)" and "Reason (R)"';
      if (optionTexts(q).filter((t) => /\b(both a and r|a is true|a is false)\b/i.test(t)).length < 3) return 'assertion-options-wrong: use the four standard options';
      return null;
    },
  },
  calculation: {
    id: 'calculation', chips: ['Calculation'], needsRelated: false, codedOptions: true,
    judge: 'a calculation item: the stem gives the numbers, the options are numbers (a unit is optional for counts), the explanation shows the working',
    instruction: () => 'Style: calculation. Give every number needed in the stem (counts, percentages, doses, rates) and ask for ONE computed value. All options are numbers with the same unit. Pick values that give a clean result. The explanation shows the working with "=" signs.',
    validate: (q) => {
      if ((`${q.stem ?? ''}`.match(/\d+(\.\d+)?/g) ?? []).length < 2) return 'calculation-without-numbers: the stem must give the numbers';
      if (optionTexts(q).filter((t) => /^[\s~≈]*[\d.,/:]+\s*[%a-zA-Z/ ]{0,16}$/.test(t)).length < 3) return 'calculation-options-not-numbers: options must be numbers with one unit';
      if (!/[=×x*÷/]/.test(String(q.explanation ?? ''))) return 'calculation-no-working: show the working in the explanation';
      return null;
    },
  },
  mechanism: {
    id: 'mechanism', chips: ['Mechanism'], needsRelated: false, codedOptions: false,
    judge: 'a mechanism question: asks why or how the effect happens',
    instruction: () => 'Style: mechanism. Ask WHY or HOW the effect happens (the mechanism, pathway, receptor or step) in one or two lines. One short patient or drug context is fine.',
    validate: (q) => (/\b(why|how|mechanism|pathway|due to|because|by which|responsible|explains|basis)\b/i.test(`${questionLine(q)} ${q.stem ?? ''}`) ? null : 'not-a-mechanism-question: ask why or how'),
  },
  image: {
    id: 'image', chips: ['ECG / X-ray interpretation', 'Identify the structure'], needsRelated: false, codedOptions: false,
    judge: 'an image-based item: the stem names the picture type and states its findings in words, so it can be answered without seeing the picture',
    instruction: () => 'Style: image-based. The stem names the picture type and states what it shows in plain words, as if the picture were attached ("A chest X-ray shows ...", "An ECG shows ...", "A biopsy section shows ..."). Then ask for the condition, finding or structure. The stem must be answerable from the words alone. Set "figureModality" and "figureQuery" (3-6 words: the diagnosis plus the picture type).',
    validate: (q) => (/\b(x-?ray|radiograph|ecg|ekg|ct|mri|ultrasound|sonograph|histolog\w*|biopsy|smear|fundus|fundoscop\w*|micrograph|photograph|section|slide|tracing|film|scan|angiogra\w*|endoscop\w*|specimen|picture|image)\b[^.?]{0,70}\b(shows?|reveals?|demonstrates?|depicts?|displays?|is seen|are seen|seen|noted|visible|reading)\b/i.test(q.stem ?? '') ? null : 'no-picture-description: start the stem with the picture type and say what it shows ("A chest X-ray shows ...")'),
  },
};

/** Words that show a stem points at a picture the learner cannot see ("this biopsy", "shown here"). */
const POINTER = /\b(?:this|the following|the above|the below)\s+(?:image|picture|photograph|photo|figure|slide|micrograph|radiograph|x-?ray|ecg|ekg|tracing|scan|film|biopsy|specimen|smear|section|lesion in the (?:image|picture))\b|\b(?:shown|seen|depicted|illustrated|pictured)\s+(?:here|above|below|in the (?:image|picture|figure|photograph|slide))\b|\bin the (?:image|picture|figure|photograph|photo)\b|\b(?:see|refer to) (?:the )?(?:image|figure|picture)\b/i;

/** A stem that points at a picture, when no picture is attached, cannot be answered. */
export function pointsAtMissingPicture(q: ClinicalQuestion): boolean {
  if (q.image) return false;
  return POINTER.test(`${q.stem ?? ''} ${questionLine(q)}`);
}

/** Checks every other option is accounted for in the explanation (by letter or by its words). */
export function explainsDistractors(q: ClinicalQuestion): boolean {
  const exp = String(q.explanation ?? '');
  if (exp.length < 80) return false;
  const lower = exp.toLowerCase();
  const others = (q.options || []).filter((o) => o.id !== q.correctOption);
  let covered = 0;
  for (const o of others) {
    const byLetter = new RegExp(`\\b(?:options?|choices?|answers?)\\s*(?:[A-E](?:\\s*(?:,|and|or|&)\\s*)?)*\\b${o.id}\\b|\\(${o.id}\\)|\\b${o.id}\\)`, 'i').test(exp);
    const key = norm(String(o.text ?? '')).split(' ').filter((w) => w.length >= 6).slice(0, 4);
    const byWords = key.length > 0 && key.filter((w) => lower.includes(w)).length >= Math.min(2, key.length);
    if (byLetter || byWords) covered += 1;
  }
  return covered >= Math.min(2, others.length);
}

/** The style problem of a question, or null. Common rules first, then the style's own. */
export function styleProblem(q: ClinicalQuestion, slot: Slot | undefined, optionCount: number, skipPicture = false): string | null {
  if ((q.options?.length ?? 0) !== optionCount) return `wrong-option-count: exactly ${optionCount} options are required`;
  if (!skipPicture && pointsAtMissingPicture(q) && !(slot?.style === 'image' && q.figureQuery)) return 'refers-to-missing-picture: describe the finding in words instead of pointing at a picture';
  return slot ? STYLES[slot.style].validate(q, slot) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Planning: which style each question gets.

/** The exam's own mix, as weights. NEET-PG's pattern forbids NOT, match and statement items; AMC is all vignettes. */
// Mixes follow the previous-year papers (see pyqProfile.ts): since 2022 NEET-PG is about a third long vignettes and
// two fifths picture items, INI-CET about two fifths one-liners and one in six NOT items, and the mix differs a lot by
// subject (Anatomy and Radiology are mostly pictures, Medicine and OBG mostly vignettes, Physiology mostly one-liners).
// Match, statement and assertion-reason items are almost absent (under 3%). AMC CAT is all vignettes by its own pattern.
const SUBJECT_ALIASES: [RegExp, string][] = [
  [/obstet|gynae|gynec|pre-?eclampsia|pregnan|antenatal|labou?r/i, 'OBG'], [/communit|preventive|epidemiolog|biostat|screening|vaccin|immunis/i, 'PSM'],
  [/forensic|toxicolog|poison|postmortem|autopsy|medicolegal/i, 'Forensic'], [/paediatric|pediatric|neonat|child/i, 'Paediatrics'],
  [/anaesthes|anesthes/i, 'Anaesthesia'], [/ophthal|retina|glaucoma|cornea|lens|squint/i, 'Ophthalmology'], [/\bent\b|otolaryng|larynx|tonsil|nasal|hearing/i, 'ENT'],
  [/dermat|skin|psoria|vitiligo|leprosy/i, 'Dermatology'], [/orthop|fracture|bone tumou?r|dislocation|osteo/i, 'Orthopedics'], [/psychiat|depress|schizophren|anxiety/i, 'Psychiatry'],
  [/radiolog|imaging|x-?ray|ultrasound|\bct\b|\bmri\b/i, 'Radiology'], [/anatom|nerve|plexus|artery|muscle|foramen|embryolog|histolog/i, 'Anatomy'],
  [/physiolog|cardiac cycle|renal physiolog|respiratory physiolog|nerve conduction/i, 'Physiology'], [/biochem|metabolism|enzyme|urea cycle|glycogen|vitamin|gene expression/i, 'Biochemistry'],
  [/pharmacolog|drug|adverse effect|antibiotic|anticoagul|inhibitor|receptor/i, 'Pharmacology'], [/microbiolog|bacteri|virus|viral|fung|parasit|hepatitis|malaria|immunolog/i, 'Microbiology'],
  [/patholog|tumou?r|neoplas|necrosis|carcinoma|lymphoma|inflammation|amyloid/i, 'Pathology'], [/surg|appendic|hernia|thyroid|breast|trauma|burns/i, 'Surgery'],
];

/** The profile subject a typed topic belongs to, when it can be told from the words; otherwise undefined. */
export function subjectFromTopic(topic: string): string | undefined {
  return SUBJECT_ALIASES.find(([re]) => re.test(topic))?.[1];
}

/** The style mix of an exam, adjusted to a subject when one is known. */
export function mixFor(exam: ExamType, subject?: string): [StyleId, number][] {
  if (exam === 'AMC_CAT') return [['vignette', 100]];
  const profile = PYQ_PROFILE[exam];
  const known = subject && Object.keys(profile.subjects).find((k) => k.toLowerCase() === subject.toLowerCase());
  const sh: StyleShares = known ? profile.subjects[known] : profile.all;
  // A few percent of the one-liners are calculations and mechanism questions; the rest of the numbers are the papers'.
  const calc = exam === 'NEET_PG' && subject === 'PSM' ? 5 : 1;
  const mech = 2;
  const oneLiner = Math.max(0, sh['one-liner'] - calc - mech);
  const mix: [StyleId, number][] = [['one-liner', oneLiner], ['short-case', sh['short-case']], ['vignette', sh.vignette], ['negative', sh.negative], ['image', sh.image], ['calculation', calc], ['mechanism', mech]];
  // Match-the-following is about 2% of INI-CET papers.
  if (exam === 'INI_CET') mix.push(['match', 2]);
  return mix.filter(([, w]) => w > 0);
}

// Real vignettes mostly ask for the diagnosis or a finding; next step, drug of choice and investigation are each rarer.
const EXAM_LEAD_INS: Record<ExamType, [LeadIn, number][]> = {
  NEET_PG: [['diagnosis', 35], ['finding', 30], ['next-step', 12], ['drug-of-choice', 10], ['investigation-of-choice', 8], ['treatment-of-choice', 5]],
  INI_CET: [['diagnosis', 35], ['finding', 30], ['next-step', 12], ['drug-of-choice', 10], ['investigation-of-choice', 8], ['treatment-of-choice', 5]],
  AMC_CAT: [['next-step', 35], ['diagnosis', 25], ['investigation-of-choice', 20], ['advice', 20]],
};

/** Spreads `n` picks over weighted entries so equal kinds are interleaved, not clustered (largest remainder). */
function spread<T>(n: number, weighted: [T, number][]): T[] {
  const total = weighted.reduce((a, [, w]) => a + w, 0) || 1;
  const quotas = weighted.map(([item, w]) => ({ item, exact: (w / total) * n, count: Math.floor((w / total) * n) }));
  let left = n - quotas.reduce((a, q) => a + q.count, 0);
  [...quotas].sort((a, b) => (b.exact - b.count) - (a.exact - a.count)).forEach((q) => { if (left > 0) { q.count += 1; left -= 1; } });
  const out: T[] = [];
  const queue = quotas.map((q) => ({ ...q, left: q.count }));
  while (out.length < n) {
    let progressed = false;
    for (const q of queue.sort((a, b) => b.left - a.left)) {
      if (q.left > 0 && out.length < n) { out.push(q.item); q.left -= 1; progressed = true; }
    }
    if (!progressed) break;
  }
  return out;
}

/** The styles the Builder's chips ask for (an empty list means the exam's own mix). */
export function stylesFromChips(chips: string[] | undefined, explicit?: string[]): StyleId[] {
  const picked = new Set<StyleId>();
  for (const id of explicit ?? []) if (id in STYLES) picked.add(id as StyleId);
  for (const chip of chips ?? []) {
    for (const spec of Object.values(STYLES)) if (spec.chips.some((c) => c.toLowerCase() === chip.toLowerCase())) picked.add(spec.id);
  }
  // The vignette chip stands for both vignette lengths.
  return [...picked];
}

/** Lead-ins asked for by the stem-pattern chips. */
export function leadInsFromChips(chips: string[] | undefined, explicit?: string[]): LeadIn[] {
  const map: [RegExp, LeadIn][] = [[/next best step/i, 'next-step'], [/drug of choice/i, 'drug-of-choice'], [/investigation of choice/i, 'investigation-of-choice'], [/treatment of choice/i, 'treatment-of-choice'], [/most likely diagnosis/i, 'diagnosis'], [/advice/i, 'advice']];
  const out = new Set<LeadIn>();
  for (const e of explicit ?? []) if (e in LEAD_INS) out.add(e as LeadIn);
  for (const c of chips ?? []) for (const [re, id] of map) if (re.test(c)) out.add(id);
  return [...out];
}

export interface FactInfo { fact: string; subtopic: string; picturable?: boolean }

/**
 * Gives every planned fact a slot. Styles that need related facts (NOT, match, statements) go to facts whose subtopic
 * has three or more other facts; calculation goes to facts with numbers; image goes to picturable facts. A fact that
 * cannot carry its style falls back to a short case (a one-liner for NEET-PG-style mixes).
 */
export function planSlots(facts: FactInfo[], exam: ExamType, picked: StyleId[], leadIns: LeadIn[], tierChoice: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH', subject?: string): Slot[] {
  const n = facts.length;
  const styleSeq: StyleId[] = picked.length
    ? spread(n, picked.map((s) => [s, 1] as [StyleId, number]))
    : spread(n, mixFor(exam, subject));
  const leadSeq: LeadIn[] = spread(n, leadIns.length ? leadIns.map((l) => [l, 1] as [LeadIn, number]) : EXAM_LEAD_INS[exam]);
  const tiers: ('LOW' | 'MEDIUM' | 'HIGH')[] = tierChoice === 'ALL' ? spread(n, [['LOW', 20], ['MEDIUM', 45], ['HIGH', 35]] as [('LOW' | 'MEDIUM' | 'HIGH'), number][]) : Array(n).fill(tierChoice);
  const bySub = new Map<string, number[]>();
  facts.forEach((f, i) => bySub.set(f.subtopic, [...(bySub.get(f.subtopic) ?? []), i]));
  const fits = (style: StyleId, i: number): boolean => {
    const f = facts[i];
    if (STYLES[style].needsRelated) return (bySub.get(f.subtopic)?.length ?? 0) >= 3 || facts.length >= 4;
    if (style === 'calculation') return /\d/.test(f.fact);
    if (style === 'image') return f.picturable === true;
    return true;
  };
  const slots: (Slot | null)[] = Array(n).fill(null);
  const taken = new Set<number>();
  // Place the demanding styles first so they get the facts that fit them.
  const order: StyleId[] = ['image', 'calculation', 'match', 'multi-statement', 'negative', 'assertion-reason', 'mechanism', 'vignette', 'short-case', 'one-liner'];
  const wantedCount = new Map<StyleId, number>();
  styleSeq.forEach((s) => wantedCount.set(s, (wantedCount.get(s) ?? 0) + 1));
  for (const style of order) {
    let need = wantedCount.get(style) ?? 0;
    for (let i = 0; i < n && need > 0; i++) {
      if (taken.has(i) || !fits(style, i)) continue;
      slots[i] = { style, tier: 'MEDIUM', related: [] };
      taken.add(i);
      need -= 1;
    }
    // Styles that found no fitting fact fall back below.
    if (need > 0) wantedCount.set(style, need); else wantedCount.delete(style);
  }
  const fallback: StyleId = 'one-liner';
  // A style the learner picked is never swapped for another: facts that fit it badly still get it (the writer builds the item
  // from the concept), and only a mix chosen by the exam falls back to a plain style.
  for (let i = 0; i < n; i++) if (!slots[i]) slots[i] = { style: picked.length ? picked[i % picked.length] : exam === 'AMC_CAT' ? 'vignette' : fallback, tier: 'MEDIUM', related: [] };
  // Lead-ins and tiers are laid over the final order; related facts come from the same subtopic, then from the rest.
  return slots.map((s, i) => {
    const slot = s as Slot;
    slot.tier = tiers[i];
    if (slot.style === 'vignette' || slot.style === 'short-case') slot.leadIn = leadSeq[i];
    if (STYLES[slot.style].needsRelated) {
      const same = (bySub.get(facts[i].subtopic) ?? []).filter((j) => j !== i).map((j) => facts[j].fact);
      const rest = facts.filter((_, j) => j !== i && !same.includes(facts[j].fact)).map((f) => f.fact);
      slot.related = [...same, ...rest].slice(0, 6);
    }
    return slot;
  });
}

/** The exam-specific rules that stay in force whatever the style (option count, wording, sources). */
/** Style of options and explanation seen in the real papers, appended for every item. */
export const COMMON_STYLE_RULES = 'Options are short: a term or a phrase of 1 to 6 words, unless the item needs a sentence. Explanation: 130 to 190 words of clinical reasoning only. Start with the key fact in **bold**, then one bullet per other option saying why it is wrong, naming the option by its text and never by its letter ("Hyperkalaemia: ..."), then one line "High-yield: ...". Never mention sources, pages, attachments, the examiner or the question itself.';

export const EXAM_RULES: Record<ExamType, string> = {
  NEET_PG: 'NEET PG (NBEMS): exactly 4 options (A-D), one correct. Options are homogeneous and close. Avoid "all of the above" and "none of the above".',
  INI_CET: 'INI-CET (AIIMS): exactly 4 options (A-D), one correct. Distractors are very close; elimination should be hard. Recent guidelines and advances are fair game.',
  AMC_CAT: 'AMC CAT MCQ (Australia): exactly 5 options (A-E), one best answer. Set the item in Australian practice (general practice, emergency department, ward, rural or remote clinic) and prefer safe, guideline-based steps (Therapeutic Guidelines, Australian Medicines Handbook, RACGP Red Book, Murtagh). Options are homogeneous (all diagnoses, or all management steps).',
};

/** Difficulty wording that fits the style (the vignette wording of the exam patterns would contradict a one-liner). */
export function tierText(style: StyleId, tier: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  if (style === 'vignette' || style === 'short-case' || style === 'image') {
    return {
      LOW: 'EASY: one inferential step. Distractors are plausible and share the key\'s category, but the key is clearly best to a well-prepared candidate.',
      MEDIUM: 'MEDIUM: infer the diagnosis or mechanism first, then choose. Distractors are close mimickers or classic confusions, so a buzzword alone does not give the answer.',
      HIGH: 'HARD: two or three reasoning steps or an atypical presentation. Every distractor is defensible in some other scenario; only the exact details of THIS item make one option best.',
    }[tier];
  }
  return {
    LOW: 'EASY: a direct, well-known fact; distractors are plausible but clearly weaker.',
    MEDIUM: 'MEDIUM: needs recall plus one inference; distractors are classic confusions.',
    HIGH: 'HARD: needs precise knowledge; every distractor is individually plausible and the key is not guessable from keywords.',
  }[tier];
}

/** Meta-commentary that must not appear in an exam explanation (talk of sources, pages, attachments, the examiner). */
export function explanationLeaks(q: ClinicalQuestion): boolean {
  return /\b(the (attached |provided |given )?sources?\b[^.]{0,40}\b(do|does|did) not|as per (the )?(attached |provided )?sources?|attached sources?|the examiner|this (item|question) (tests|is testing|asks)|source note|page \d+|not (stated|described|mentioned) in the (attached|provided))/i.test(String(q.explanation ?? ''));
}
