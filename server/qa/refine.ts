// Stage 1.5 — Post-generation refinement.
// Runs AFTER the AI has written a batch of questions and BEFORE QA/storage.
// Its job is to remove answer leakage and obvious hints, and to make the option set
// structurally neutral so the correct answer is not telegraphed by length, grammar,
// specificity, or "all/none of the above" patterns.
import type { CompleteFn } from './pipeline.ts';

export interface RefineQuestionInput {
  id?: string;
  stem?: string;
  questionText?: string;
  options?: { id: string; text: string }[];
  correctOption?: string;
  explanation?: string;
  subject?: string;
  subtopic?: string;
  examType?: string;
  image?: string;
  imageCaption?: string;
  difficulty?: string;
  difficultyTier?: string;
  [key: string]: unknown;
}

export interface RefineSignal {
  needsRefinement: boolean;
  reasons: string[];
}

export interface RefineResult extends RefineQuestionInput {
  changes: string[];
  refined: boolean;
}

function norm(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Deterministic pre-check: only spend an LLM call when something actually looks leaky. */
export function detectRefinementSignals(q: RefineQuestionInput): RefineSignal {
  const reasons: string[] = [];
  const combined = norm(`${q.stem ?? ''} ${q.questionText ?? ''}`);
  // Raw (case-insensitive) text for phrase checks — `norm` strips punctuation but keeps words.
  const rawCombined = String(`${q.stem ?? ''} ${q.questionText ?? ''}`);
  const options = Array.isArray(q.options) ? q.options : [];
  const correct = options.find((o) => String(o.id).toUpperCase() === String(q.correctOption ?? '').toUpperCase());
  const correctText = correct ? norm(correct.text) : '';

  // 1. Answer written into the stem / lead-in.
  if (correctText && correctText.length >= 4 && combined.includes(correctText)) {
    reasons.push('The correct answer appears verbatim in the stem/lead-in.');
  }

  // 2. Give-away phrases (word-boundary so "most likely" in a lead-in counts, but
  //    harmless substrings inside medical words do not).
  const hintPhrases = [
    'classic', 'classical', 'pathognomonic', 'textbook', 'obvious', 'obviously',
    'clearly', 'typical of', 'the answer is', 'you can tell',
  ];
  for (const p of hintPhrases) {
    if (new RegExp(`\\b${p}\\b`, 'i').test(rawCombined)) reasons.push(`Contains hint phrase "${p}".`);
  }

  // 3. Option-length telegraphing.
  const lens = options.map((o) => String(o.text ?? '').trim().length).filter((n) => n > 0);
  if (lens.length >= 2) {
    const min = Math.min(...lens);
    const max = Math.max(...lens);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (max - min > 30) reasons.push('Option lengths are visibly imbalanced.');
    const longOnes = lens.filter((l) => l > avg * 1.75).length;
    if (longOnes === 1) reasons.push('Exactly one option is much longer than the rest.');
    const shortOnes = lens.filter((l) => l < avg * 0.55).length;
    if (shortOnes === 1) reasons.push('Exactly one option is much shorter than the rest.');
  }

  // 4. Meta options that telegraph the key.
  if (options.some((o) => /all of the above|none of the above/i.test(String(o.text ?? '')))) {
    reasons.push('Contains an "all/none of the above" option.');
  }

  return { needsRefinement: reasons.length > 0, reasons };
}

function parseJson<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end > -1) text = text.slice(0, end + 1);
  try { return JSON.parse(text) as T; } catch { return null; }
}

function optionLines(q: RefineQuestionInput): string {
  return (q.options ?? []).map((o) => `${o.id}. ${o.text}`).join('\n');
}

/**
 * Refine one generated question. The LLM is asked to rewrite only the presentation —
 * the clinical concept and the correct answer's meaning must stay intact.
 * Returns the original question unchanged when no refinement is needed/failed.
 */
export async function refineQuestion(
  q: RefineQuestionInput,
  complete: CompleteFn,
): Promise<RefineResult> {
  const signals = detectRefinementSignals(q);
  if (!signals.needsRefinement) {
    return { ...q, changes: [], refined: false };
  }

  const system =
    'You are a meticulous medical MCQ editor for postgraduate exams (NEET-PG / INI-CET / AMC CAT). ' +
    'You receive a machine-generated single-best-answer MCQ. Rewrite ONLY its presentation to remove answer leakage and obvious hints, ' +
    'and to make the option set structurally neutral. Never change the tested concept or the correct answer meaning.';

  const prompt = [
    `Question (subject: ${q.subject ?? 'unknown'}, subtopic: ${q.subtopic ?? 'unknown'}):`,
    `Stem: ${q.stem ?? ''}`,
    `Lead-in: ${q.questionText ?? ''}`,
    `Options:\n${optionLines(q)}`,
    `Correct answer: ${q.correctOption ?? ''}`,
    `Explanation: ${q.explanation ?? ''}`,
    '',
    'Detected problems:',
    ...signals.reasons.map((r) => `- ${r}`),
    '',
    'MANDATORY RULES:',
    '1. The stem and lead-in must NOT contain the correct answer, any word from it, or a close synonym that gives the diagnosis/treatment away.',
    '2. Remove tell-tale wording such as "classic", "pathognomonic", "textbook", "obvious", "most common", "most likely", "always", "never", "the answer is".',
    '3. Options must be homogeneous: all the same grammatical form (all noun phrases or all sentences), similar length (within about 3 words), similar specificity. No single option may be conspicuously longer, more detailed, or more academic than the others.',
    '4. Do not use "all of the above" / "none of the above".',
    '5. Distractors must be plausible and clinically coherent — not absurd and not obviously wrong.',
    '6. Keep the number of options the same (A-D or A-E). Keep the same correct answer meaning. You MAY reorder options; if you do, update correctOption to the new letter.',
    '7. Do not invent new clinical facts. You may rephrase the stem/lead-in for neutrality. The explanation may be rewritten for clarity but must stay accurate.',
    '',
    'You MUST return the fully rewritten item, even if only small changes are needed.',
    'Reply with ONLY this JSON object (no prose, no markdown fences):',
    '{"stem":"...","questionText":"...","options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],"correctOption":"B","explanation":"...","changes":["removed the diagnosis from the stem","equalised option lengths"]}',
  ].join('\n');

  try {
    const raw = await complete(system, [{ role: 'user', content: prompt }], true, 'refine');
    const parsed = parseJson<{
      stem: string;
      questionText: string;
      options: { id: string; text: string }[];
      correctOption: string;
      explanation?: string;
      changes?: string[];
    }>(raw);

    if (!parsed || !parsed.stem || !parsed.questionText || !Array.isArray(parsed.options) || parsed.options.length < 2) {
      return deterministicFallback(q, signals.reasons);
    }

    // Validate the returned option set and key before accepting it.
    const ids = parsed.options.map((o) => String(o.id ?? '').toUpperCase());
    const key = String(parsed.correctOption ?? '').toUpperCase();
    if (ids.some((id) => !id) || !ids.includes(key)) {
      return deterministicFallback(q, signals.reasons);
    }

    return {
      ...q,
      stem: parsed.stem,
      questionText: parsed.questionText,
      options: parsed.options,
      correctOption: key,
      explanation: parsed.explanation ?? q.explanation,
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      refined: true,
    };
  } catch {
    // Refinement is advisory — a provider failure must never lose the original question.
    return deterministicFallback(q, signals.reasons);
  }
}

/**
 * Code-only rewrite used when the model declines or is unavailable: strips hint phrases
 * and removes the correct answer's wording from the stem. Options and key are untouched,
 * so nothing clinical is invented.
 */
export function deterministicFallback(q: RefineQuestionInput, reasons: string[]): RefineResult {
  const changes: string[] = [];
  const strip = [
    /\bclassic(?:al)?(?:ly)?\s+/gi,
    /\bpathognomonic(?:ally)?\s+/gi,
    /\btextbook\s+/gi,
    /\bobviously?\s+/gi,
    /\bclearly\s+/gi,
    /\btypical of\b/gi,
    /\byou can tell\b/gi,
  ];
  const clean = (input: string | undefined): string => {
    let out = String(input ?? '');
    for (const re of strip) {
      const before = out;
      out = out.replace(re, '');
      if (out !== before) changes.push(`removed hint wording (${re.source.replace(/\\b|\\\\/g, '')})`);
    }
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  };

  const options = Array.isArray(q.options) ? q.options : [];
  const key = String(q.correctOption ?? '').toUpperCase();
  const correct = options.find((o) => String(o.id).toUpperCase() === key);
  const correctText = String(correct?.text ?? '').trim();

  let stem = clean(q.stem);
  const leadIn = clean(q.questionText);

  // Remove the correct answer's wording from the stem when it gives the answer away.
  if (correctText.length >= 6 && new RegExp(correctText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(stem)) {
    const escaped = correctText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    stem = stem.replace(new RegExp(escaped, 'gi'), 'the condition described').replace(/\s{2,}/g, ' ').trim();
    changes.push('removed the diagnosis from the stem');
  }

  if (changes.length === 0) {
    return { ...q, changes: [], refined: false };
  }

  return {
    ...q,
    stem,
    questionText: leadIn,
    options,
    correctOption: key,
    changes: [...changes, ...reasons],
    refined: true,
  };
}

/** Refine a batch with configurable concurrency, preserving order and never throwing for a
 *  single failed item. Higher concurrency improves throughput when the deterministic
 *  pre-filter catches most issues, so LLM calls are relatively rare. */
export async function refineBatch(
  questions: RefineQuestionInput[],
  complete: CompleteFn,
  concurrency = 5, // increased from 3 to improve throughput
): Promise<RefineResult[]> {
  if (questions.length === 0) return [];
  // Clamp concurrency to batch size and sensible bounds.
  const workersCount = Math.min(Math.max(1, concurrency), questions.length, 12);
  const results: RefineResult[] = new Array(questions.length);
  let next = 0;
  const workers = Array.from({ length: workersCount }, async () => {
    for (;;) {
      const i = next++;
      if (i >= questions.length) return;
      results[i] = await refineQuestion(questions[i], complete);
    }
  });
  await Promise.all(workers);
  return results;
}
