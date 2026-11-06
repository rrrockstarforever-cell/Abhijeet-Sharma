// Deterministic formatting cleanup for generated questions. It only removes formatting damage:
// literal "\n" text, options copied into the stem, and a stem or question line repeated twice.
// It never changes the medical content, the options, or the key.
import type { ClinicalQuestion } from '../types.ts';

const OPTION_BLOCK = /\n\s*A[.)]\s|\bOptions?\s*:|\bPlease select the single best option\b/i;

function cleanText(text: string): string {
  return String(text ?? '').replace(/\\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** Returns the question with formatting damage removed. Unchanged questions come back as the same content. */
export function cleanQuestion(q: ClinicalQuestion): ClinicalQuestion {
  let stem = cleanText(q.stem ?? '');
  let line = cleanText(q.questionText ?? (q as any).question ?? '');

  // Options written out again inside the stem or the question line: keep the text before them.
  const cut = (text: string) => {
    const at = text.search(OPTION_BLOCK);
    return at > 0 ? text.slice(0, at).trim() : text;
  };
  stem = cut(stem);
  line = cut(line);

  // A question line repeated at the end of the stem, or a stem equal to the question line.
  if (line && stem.endsWith(line)) stem = stem.slice(0, stem.length - line.length).trim();
  if (stem && stem === line) stem = '';

  return { ...q, stem, questionText: line || q.questionText, options: q.options.map((o) => ({ ...o, text: cleanText(o.text) })) };
}

/** Cleans a list of questions. */
export function cleanQuestions(questions: ClinicalQuestion[]): ClinicalQuestion[] {
  return questions.map(cleanQuestion);
}
