// Stage 5 duplicate detection. Similarity against the question bank.
// No LLM: token Jaccard over the stem plus a shared-learning-objective heuristic.
export interface DupInput {
  stem?: string;
  questionText?: string;
  subject?: string;
  subtopic?: string;
  correctOption?: string;
}

export interface DupRecord {
  id: string;
  stem?: string;
  questionText?: string;
  subject?: string;
  subtopic?: string;
  correctOption?: string;
}

const stop = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'for', 'with', 'and', 'or', 'to', 'at', 'by', 'from', 'which', 'that', 'this', 'these', 'those', 'has', 'have', 'not', 'as', 'be', 'but', 'who', 'what', 'when', 'his', 'her', 'their', 'patient', 'presents']);

function tokens(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !stop.has(t));
}

function jaccard(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Near-duplicate when the stems overlap strongly. A shared diagnosis is fine; a shared
 * reasoning path (same stem + same keyed option) is a duplicate of the learning objective.
 */
export function detectDuplicates(input: DupInput, bank: DupRecord[], threshold = 0.75): { id: string; similarity: number }[] {
  const out: { id: string; similarity: number }[] = [];
  const stem = `${input.stem ?? ''} ${input.questionText ?? ''}`;
  for (const rec of bank) {
    if (!rec.id || rec.id === (input as any).id) continue;
    const other = `${rec.stem ?? ''} ${rec.questionText ?? ''}`;
    const sim = jaccard(stem, other);
    const sameObjective =
      Boolean(input.subtopic) && Boolean(rec.subtopic) &&
      String(input.subtopic).toLowerCase() === String(rec.subtopic).toLowerCase() &&
      Boolean(input.correctOption) && String(input.correctOption) === String(rec.correctOption);
    if (sim >= threshold || (sameObjective && sim >= 0.55)) {
      out.push({ id: rec.id, similarity: Math.round(sim * 100) / 100 });
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
