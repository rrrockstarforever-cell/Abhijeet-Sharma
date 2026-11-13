// Rules and checks shared by the NEET PG and INI-CET pipelines. Anything that differs between the two exams lives in
// that exam's own file (neetPg.ts, iniCet.ts); only what is truly common is here.
import type { ClinicalQuestion } from '../../types.ts';

export type Tier = 'LOW' | 'MEDIUM' | 'HIGH';
export type Letter = 'A' | 'B' | 'C' | 'D' | 'E';

/** Options are plain answer labels. Every bit of reasoning belongs in the explanation, never in an option. */
export const OPTION_RULES =
  'Options are plain answer labels: a term or a short phrase of 1 to 6 words (a full sentence only when the question asks which statement is NOT true or correct). ' +
  'An option never carries reasoning, a justification, a mechanism after "because", "due to" or "as", a parenthetical hint, or an "e.g." list. ' +
  'All four options are the same kind of thing (all diagnoses, all drugs, all investigations, all structures) and about the same length; the correct option is not the longest or the most detailed. ' +
  'Never use "all of the above", "none of the above" or "both A and B".';

/**
 * The explanation the learner reads after answering: background on the topic first, then why the key is right, then
 * one bullet for EVERY wrong option, then a high-yield line. optionReasons repeats the per-option verdict in a form the
 * Test Runner shows beside each option.
 */
export const EXPLANATION_RULES =
  'Explanation: 170 to 260 words of teaching, in plain simple English, each part on its own line, in this order: ' +
  '(1) the first line is the key fact in **bold**, one sentence (the app shows it as "The big idea"); ' +
  '(2) a line starting "Background:" with two or three sentences on the topic itself (what the condition, drug or structure is; its core mechanism or classification) so a learner who has not revised it can follow; ' +
  '(3) one or two sentences linking the clues in the stem to the answer; ' +
  '(4) one bullet per wrong option, EVERY wrong option, written "- <option text>: <why it is wrong here, and when it WOULD be the answer>". Name options by their text, never by their letter; ' +
  '(5) a last line starting "High-yield:" with the single fact to remember. ' +
  'Never mention sources, pages, notes, passages, attachments, the examiner, the stem or "this question". ' +
  'Also return "optionReasons": an object with one entry for every option letter, each one or two sentences saying why that option is right or wrong.';

/** The JSON field list the writer must return, shared by both pipelines. */
export function jsonShape(exam: string, subject: string, subtopic: string, tier: Tier, optionCount: number, withFigure: boolean): string {
  const ids = 'ABCDE'.slice(0, optionCount).split('');
  return `JSON shape — return exactly one object: { "examType": "${exam}", "subject": "${subject}", "subtopic": "${subtopic}", ` +
    `"cognitiveTier": "Direct Recall | Clinical 2-Step | Multi-Step & IBQ", "difficultyTier": "${tier}", "stem": "...", "questionText": "...", ` +
    `"options": {${ids.map((k) => `"${k}": "plain label"`).join(', ')}}, "correctOption": "${ids.join('|')}", "explanation": "...", ` +
    `"optionReasons": {${ids.map((k) => `"${k}": "why right or wrong"`).join(', ')}}, ` +
    '"keyFact": "one sentence: the textbook or guideline fact that makes the correct option right", "boardPearl": "...", "citations": [...], ' +
    '"trapType": "...", "trapExplanation": "...", "targetAccuracy": 0-100, "sourceCheck": "supported|not supported"' +
    `${withFigure ? ', "figureModality": "", "figureQuery": ""' : ''} }`;
}

const REASONING_IN_OPTION = /\b(because|since|due to|owing to|as it|as this|as they|which (?:is why|explains|causes|leads)|therefore|hence|thus|so that|in order to|e\.g\.|i\.e\.|resulting in|leading to)\b/i;
/** A parenthetical of four or more words ("(as it inhibits cell wall synthesis)") is a hint, not a label. */
const LONG_PARENTHETICAL = /\(([^)]*\s){3,}[^)]*\)/;

/** True when the question asks the learner to judge statements, so sentence-long options are expected. */
export function asksAboutStatements(q: ClinicalQuestion): boolean {
  const line = `${(q as { questionText?: string }).questionText ?? ''} ${q.stem ?? ''}`;
  return /\b(NOT|EXCEPT|FALSE|INCORRECT|UNTRUE|true|correct statement|statements?|assertion)\b/i.test(line);
}

/**
 * Null when every option is a plain label; otherwise the reason. Options that judge statements (NOT true, which is
 * correct) may be sentences, but even they must not explain themselves.
 */
export function optionReasoningProblem(q: ClinicalQuestion): string | null {
  const statements = asksAboutStatements(q);
  for (const o of q.options ?? []) {
    const text = String(o.text ?? '');
    if (!statements && REASONING_IN_OPTION.test(text)) return `option "${text.slice(0, 60)}" explains itself; an option is a plain label and the reasoning goes in the explanation`;
    if (LONG_PARENTHETICAL.test(text)) return `option "${text.slice(0, 60)}" carries a hint in brackets; remove it`;
    if (!statements && text.trim().split(/\s+/).length > 12) return `option "${text.slice(0, 60)}" is too long; options are short labels of 1 to 6 words`;
  }
  return null;
}

const STOP = new Set(['with', 'from', 'that', 'this', 'into', 'than', 'have', 'been', 'only', 'more', 'most', 'less', 'very', 'over', 'under', 'which', 'their', 'there', 'other', 'about', 'after', 'before']);
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Whether the explanation (or optionReasons) says something about this option. */
export function mentionsOption(explanation: string, optionText: string, letter: string): boolean {
  const exp = normText(explanation);
  const opt = normText(optionText);
  if (!opt) return false;
  if (` ${exp} `.includes(` ${opt} `)) return true;
  const keyWords = opt.split(' ').filter((w) => w.length >= 4 && !STOP.has(w));
  if (keyWords.length && keyWords.filter((w) => exp.includes(w)).length >= Math.min(2, keyWords.length)) return true;
  return new RegExp(`\\b(?:options?|choices?)\\s*(?:[A-E]\\s*(?:,|and|or|&)\\s*)*${letter}\\b|\\(${letter}\\)`, 'i').test(explanation);
}

/** Every wrong option has a reason, either in the explanation or in optionReasons. */
export function everyDistractorExplained(q: ClinicalQuestion): boolean {
  const exp = String(q.explanation ?? '');
  const reasons = (q as { optionReasons?: Partial<Record<Letter, string>> }).optionReasons ?? {};
  return (q.options ?? []).filter((o) => o.id !== q.correctOption).every((o) =>
    mentionsOption(exp, o.text, o.id) || String(reasons[o.id as Letter] ?? '').trim().length >= 15);
}

/** An explanation too short to carry background plus a reason for each option. */
export function explanationThin(q: ClinicalQuestion): boolean {
  return String(q.explanation ?? '').trim().split(/\s+/).filter(Boolean).length < 110;
}

/** Reads the writer's optionReasons into letter → text, keeping only letters the question has. */
export function parseOptionReasons(raw: unknown, letters: string[]): Partial<Record<Letter, string>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Partial<Record<Letter, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = k.trim().toUpperCase();
    if (letters.includes(id) && typeof v === 'string' && v.trim()) out[id as Letter] = v.trim().slice(0, 600);
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Deterministic clean-ups. Each one turns a cosmetic slip into a fixed question instead of a rejection and a rewrite.

/**
 * Cuts a reasoning tail off an option ("Vancomycin, because it covers MRSA" → "Vancomycin"; "Warfarin (as it is
 * teratogenic in the first trimester)" → "Warfarin"). Statement-judging options are left alone. Returns how many
 * options were cleaned.
 */
export function cleanOptionLabels(q: ClinicalQuestion): number {
  if (asksAboutStatements(q)) return 0;
  let cleaned = 0;
  for (const o of q.options ?? []) {
    let text = String(o.text ?? '');
    const before = text;
    text = text.replace(LONG_PARENTHETICAL, '').trim();
    const cut = text.search(/\s*(?:[,;:—–-]\s*|\s)(?:because|since|due to|owing to|as it|as this|as they|which (?:is why|explains)|therefore|hence|thus|so that|e\.g\.|i\.e\.|resulting in|leading to)\b/i);
    if (cut > 0) text = text.slice(0, cut).trim();
    text = text.replace(/[\s,;:—–-]+$/, '').trim();
    // Only keep the cut when a real label is left.
    if (text !== before && text.split(/\s+/).filter(Boolean).length >= 1 && text.length >= 2) { o.text = text; cleaned += 1; }
  }
  return cleaned;
}

/** A stem that ends with the question while questionText is empty or a copy: the question moves to questionText. */
export function splitStemQuestion(q: ClinicalQuestion): void {
  const stem = String(q.stem ?? '').trim();
  const line = String((q as { questionText?: string }).questionText ?? '').trim();
  if (!/\?\s*$/.test(stem)) return;
  const m = stem.match(/^(.*?[.!])\s+([^.!?]*\?)\s*$/s);
  if (!m || m[1].trim().split(/\s+/).length < 6) return;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!line || norm(line) === norm(stem) || norm(line) === norm(m[2])) {
    q.stem = m[1].trim();
    (q as { questionText?: string }).questionText = m[2].trim();
  }
}

/** "None of the above" / "All of the above" / "Both A and B": banned in both exams' current patterns. */
export function hasAboveOption(q: ClinicalQuestion): boolean {
  return (q.options ?? []).some((o) => /\b(all|none) of the above\b|\bboth [a-e] (and|&) [a-e]\b|\ball of these\b|\bnone of these\b/i.test(String(o.text ?? '')));
}

// ---------------------------------------------------------------------------------------------------------------
// Quality checks found from a real 100-question NEET PG run (topic: Tuberculosis). Each one targets a defect that the
// earlier checks let through.

const LEAK_STOP = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'into', 'than', 'for', 'its', 'are', 'was', 'were', 'has', 'have', 'only', 'most', 'more', 'less', 'very', 'usually', 'commonly', 'common', 'type', 'form', 'pattern', 'finding', 'feature', 'disease', 'condition', 'lesion', 'about', 'approximately']);
const leakWords = (s: string) => normText(s).split(' ').filter((w) => w.length >= 4 && !LEAK_STOP.has(w));

/**
 * The stem or question line names the answer: the whole correct option appears in it ("...termed spina ventosa" →
 * "Spina ventosa"), or every distinctive word of a multi-word key does ("A barium meal follow-through image shows ..."
 * → "Barium meal follow-through"). Statement-judging items are skipped, since their options restate the topic.
 */
export function answerInStem(q: ClinicalQuestion): boolean {
  if (asksAboutStatements(q)) return false;
  const key = (q.options ?? []).find((o) => o.id === q.correctOption)?.text ?? '';
  const stem = normText(`${q.stem ?? ''} ${(q as { questionText?: string }).questionText ?? ''}`);
  const keyNorm = normText(key);
  if (!keyNorm || keyNorm.length < 4) return false;
  if (` ${stem} `.includes(` ${keyNorm} `)) return true;
  const words = leakWords(key);
  const stemWords = new Set(stem.split(' '));
  // A one-word key (a drug, a sign, a structure) named in the stem, when no distractor is named there too.
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 5 || !stemWords.has(w)) return false;
    const others = (q.options ?? []).filter((o) => o.id !== q.correctOption);
    return !others.some((o) => leakWords(o.text).some((x) => stemWords.has(x)));
  }
  if (words.length < 2) return false;
  // Every distinctive word of the key is in the stem, and the distractors do not share them all (a shared subject word
  // such as the disease name in every option is not a clue).
  if (!words.every((w) => stemWords.has(w))) return false;
  const others = (q.options ?? []).filter((o) => o.id !== q.correctOption);
  return !others.some((o) => leakWords(o.text).filter((w) => stemWords.has(w)).length >= words.length);
}

const CASE = /\b\d{1,3}[- ](?:year|month|week|day)s?[- ]old\b/i;
const GENERIC_ASK = /\b(proportion|percentage|what percent|approximately what|how many|overall|in general|among the forms|which (?:site|joint|bone|region|segment|group) is (?:the )?most common(?:ly)? (?:involved|affected)|typical (?:diameter|size)|age distribution|alternative name|also known as|what volume)\b/i;
const POINTS_AT_CASE = /\b(this|his|her|the) (patient|child|man|woman|boy|girl|infant|lesion|finding|presentation|case)\b|\bhe\b|\bshe\b|\bin this\b/i;

/**
 * A patient case that the question does not use: the stem is a vignette, but the question asks a general fact (a
 * proportion, the commonest site overall, an alternative name) that can be answered without reading the case. Real
 * NEET PG / INI-CET vignettes make the candidate use the findings.
 */
export function decorativeCase(q: ClinicalQuestion): boolean {
  const line = String((q as { questionText?: string }).questionText ?? '');
  if (!CASE.test(q.stem ?? '')) return false;
  return GENERIC_ASK.test(line) && !POINTS_AT_CASE.test(line);
}

// Antonym pairs: two options that differ only by one of these are opposites, so one of them must be the answer.
const ANTONYMS: [RegExp, string][] = [
  [/\b(poly|mono|uni|multi|oligo)(articular|focal|clonal)\b/g, 'X$2'],
  [/\b(one|single|several|multiple|many)\b/g, 'NUM'],
  [/\b(aerobic|anaerobic)\b/g, 'AER'],
  [/\b(higher|lower|high|low)\b/g, 'HL'],
  [/\b(increased|decreased|raised|reduced|elevated)\b/g, 'ID'],
  [/\b(more|fewer|less)\b/g, 'MF'],
  [/\b(common|rare|uncommon|frequent|infrequent)\b/g, 'CR'],
  [/\b(present|absent)\b/g, 'PA'],
  [/\b(positive|negative)\b/g, 'PN'],
  [/\b(usually|rarely|always|never|often|seldom)\b/g, 'FREQ'],
  [/\b(is|is not|are|are not|does|does not|do not|not)\b/g, ''],
];
const collapse = (s: string) => ANTONYMS.reduce((t, [re, to]) => t.replace(re, to), normText(s).split(' ').map((w) => (w.length > 4 ? w.replace(/s$/, '') : w)).join(' ')).replace(/\s+/g, ' ').trim();

/** Two options that say opposite things ("usually polyarticular" / "usually monoarticular"): the pair gives the answer away. */
export function oppositeOptions(q: ClinicalQuestion): boolean {
  const opts = (q.options ?? []).map((o) => String(o.text ?? ''));
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      if (normText(opts[i]) === normText(opts[j])) continue;
      const a = collapse(opts[i]);
      if (a.split(' ').length >= 2 && a === collapse(opts[j])) return true;
    }
  }
  return false;
}

/** Explanation wording that shows the key was matched to one source's wording, not to the standard answer. */
export function sourceBoundExplanation(q: ClinicalQuestion): boolean {
  return /\b(the )?stated (criterion|threshold|cut-?off|figure|value|definition|fact)\b|\bas stated\b|\bper the (notes|source|text)\b|\bthe notes (say|state)\b/i.test(String(q.explanation ?? '') + ' ' + String(q.trapExplanation ?? ''));
}

/**
 * Whether a typed topic may get treatment and management questions. NEET PG and INI-CET ask drugs, adverse effects and
 * programme regimens for every disease, so only purely basic-science topics are kept free of treatment questions.
 * (The old rule allowed them only when the topic itself said "treatment" or "drug": "Tuberculosis" got none.)
 */
export function topicAllowsTreatment(topic: string): boolean {
  if (/treat|manag|therap|drug|dose|regimen|rescue|prevent|pharmac/i.test(topic)) return true;
  return !/\b(anatom|physiolog|biochem|embryolog|histolog|genetic|cell biology|enzyme kinetics|metabolism of)\w*/i.test(topic);
}

// ---------------------------------------------------------------------------------------------------------------
// Version 3 (second live test): deterministic fixes for defects that a repair call rarely rescued.

const SOURCE_PHRASE = '(?:supplied|cited|provided|attached|given)\\s+(?:\\w+\\s+)?(?:passages?|notes|excerpts?|extracts?|text|material|source)';
/**
 * Removes talk of "the supplied passage / notes / material" from a draft ("In the supplied material on female genital
 * tuberculosis, the ..." → "In female genital tuberculosis, the ..."). A repair of this wording was kept only 2 times in
 * 10; a text substitution is free. Returns true when something was changed.
 */
export function scrubSourceMentions(q: ClinicalQuestion): boolean {
  let changed = false;
  const fix = (text: string | undefined): string | undefined => {
    if (!text) return text;
    const out = text
      .replace(new RegExp(`\\b(in|from)\\s+(?:the|this|these|your)\\s+${SOURCE_PHRASE}\\s+(?:on|about|for)\\s+`, 'gi'), (_m, w: string) => `${w} `)
      .replace(new RegExp(`\\b(?:according to|as (?:stated|described|given) in|per|as per)\\s+(?:the|this|these|your)\\s+${SOURCE_PHRASE}\\s*,?\\s*`, 'gi'), '')
      .replace(new RegExp(`\\b(?:the|this|these|your)\\s+${SOURCE_PHRASE}\\s+(?:states?|says?|notes?|describes?)\\s+(?:that\\s+)?`, 'gi'), '')
      .replace(/\s{2,}/g, ' ')
      .replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
    if (out !== text) changed = true;
    return out;
  };
  q.stem = fix(q.stem) ?? q.stem;
  (q as { questionText?: string }).questionText = fix((q as { questionText?: string }).questionText);
  q.explanation = fix(q.explanation) ?? q.explanation;
  for (const o of q.options ?? []) o.text = fix(o.text) ?? o.text;
  return changed;
}

/**
 * A planned fact that is a general statement (a proportion, the commonest site overall, an alternative name, a typical
 * size) cannot carry a patient case: the case is decoration and the examiner rejects it. Such facts get a one-line slot.
 */
export function isGeneralFact(fact: string): boolean {
  return /\b(\d+\s?%|per ?cent|proportion|most common(?:ly)?|commonest|least common|account(?:s|ing)? for|also (?:known|called)|alternative(?:ly)? (?:name|called)|eponym|typical(?:ly)? (?:size|diameter|measures?)|approximately|about \d|incidence|prevalence|historically)\b/i.test(fact);
}

/** A national or global programme fact (pillars, targets, strategy, notification rules): asked as a one-liner, not a case. */
export function isProgrammeFact(fact: string): boolean {
  return /\b(NTEP|RNTCP|End TB|national (?:tb |tuberculosis )?(?:elimination )?programme|programme|program|pillars?|strategic|strategy|framework|target year|by 20\d\d|sustainable development goal|SDG|Nikshay|notification|notifiable|DOTS)\b/i.test(fact);
}

/** Facts no exam asks: approval or launch dates, and programme dates. They also cost examiner rejections. */
export function isDatedFact(fact: string): boolean {
  return /\b(approv(?:ed|al)|introduced|launched|rolled out|adopted|endorsed|recommended)\b[^.]{0,60}\b(?:19|20)\d{2}\b|\b(?:in|since|from) (?:19|20)\d{2}\b/i.test(fact);
}

/**
 * One short example of each shape, on unrelated topics so it cannot be copied into the set. Shown with the slot's style
 * instruction: the second live test showed writers breaking shape rules they were only told about (a patient in a
 * one-liner 9 times, a generic question line 13 times).
 */
export const STYLE_EXAMPLES: Partial<Record<string, string>> = {
  vignette: 'Shape example (different topic): stem "A 45-year-old woman has had weight gain, constipation and cold intolerance for six months. She has a firm, painless, diffusely enlarged thyroid. Anti-TPO antibodies are strongly positive." questionText "What is the most likely diagnosis?"',
  'short-case': 'Shape example (different topic): stem "A 6-year-old boy has facial puffiness and frothy urine; urine protein is 4+ and serum albumin is low." questionText "What will light microscopy of a renal biopsy most likely show?"',
  'one-liner': 'Shape example (different topic): stem "Which nerve is most commonly injured in a fracture of the surgical neck of the humerus?" and questionText the same line. The stem is never empty. No patient, no age, one line.',
  negative: 'Shape example (different topic): stem "Which of the following is NOT a feature of nephrotic syndrome?" and questionText the same line. The stem is never empty. Three options are true features, one is not.',
  mechanism: 'Shape example (different topic): stem "Why does hypokalaemia increase the risk of digoxin toxicity?" and questionText the same line. The stem is never empty.',
  image: 'Shape example (different topic): stem "A chest X-ray of a cyanotic child shows a boot-shaped heart with oligaemic lung fields." questionText "Which congenital heart disease is most likely?"',
};

/** Extra rule for a case that asks for the diagnosis: the answer is the specific form, and no result may name it. */
export const DIAGNOSIS_GUARD = 'The answer is the specific disease, form or variant that the fact is about. The stem gives the history, examination and results that point to it, but no test result, culture, biopsy report or imaging report may name the disease, the organism or the form.';

// Words of a query that a relevant passage must contain (at least one, or two for a longer query). The Pharmacology
// report showed "My books" returning chapters on antiepileptics and dementia for an NK1-antiemetic or a TB-drug item.
const RELEVANCE_STOP = new Set(['which', 'their', 'there', 'about', 'after', 'before', 'drugs', 'agents', 'effects', 'effect', 'adverse', 'treatment', 'therapy', 'management', 'clinical', 'features', 'patient', 'patients', 'disease', 'diseases', 'causes', 'caused', 'common', 'commonly', 'important', 'standard', 'between', 'within', 'without', 'during', 'mechanism', 'mechanisms', 'action', 'used', 'using', 'first', 'second', 'third']);
export function passageMatchesQuery(text: string, query: string): boolean {
  const terms = [...new Set(String(query).toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? [])].filter((w) => !RELEVANCE_STOP.has(w)).map((w) => w.slice(0, 6));
  if (!terms.length) return true;
  const body = String(text).toLowerCase();
  const hits = terms.filter((t) => body.includes(t)).length;
  return hits >= Math.min(terms.length >= 4 ? 2 : 1, terms.length);
}

