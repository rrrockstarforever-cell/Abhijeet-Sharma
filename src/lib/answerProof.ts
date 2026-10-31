// Answer proof: each question's keyed answer is checked (blind solves plus PubMed evidence) before it
// may reach the Test Runner. Results are stored per question, so a question is checked once.
import type { ClinicalQuestion } from '../types.ts';
import { getActiveProvider, getEffectiveModel } from './ai.ts';

export type ProofStatus = 'VERIFIED' | 'UNVERIFIED' | 'CONTESTED';

export interface ProofRecord {
  proof: ProofStatus;
  keyed: string;
  solves: string[];
  query: string;
  evidence: { verdict: string; cited: { title: string; url: string }[] };
  wellFormed?: boolean;
  issues?: string[];
  checkedAt: string;
}

const STORE_KEY = 'pulse.proof.v1';

function readStore(): Record<string, ProofRecord> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Record<string, ProofRecord>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, ProofRecord>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage full: the check runs again next time */
  }
}

/** The stored proof for a question, or null if it was never checked. */
export function proofOf(questionId: string): ProofRecord | null {
  return readStore()[questionId] ?? null;
}

/** Runs the answer check for one question and stores the result. */
export async function checkAnswer(question: ClinicalQuestion): Promise<ProofRecord> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider is active, so the answer cannot be checked.');
  const res = await fetch('/api/qa/verify-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, provider, model: getEffectiveModel(provider) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Answer check failed (HTTP ${res.status}).`);
  const record: ProofRecord = { ...data, checkedAt: new Date().toISOString() };
  writeStore({ ...readStore(), [question.id]: record });
  return record;
}

/**
 * Checks many questions, a few at a time. Questions already checked are reused, unless force is set.
 * Failures are recorded as UNVERIFIED with the reason, so one bad call never blocks the rest.
 */
export async function checkMany(
  questions: ClinicalQuestion[],
  onProgress?: (done: number, total: number) => void,
  options: { force?: boolean; concurrency?: number } = {},
): Promise<Map<string, ProofRecord>> {
  const results = new Map<string, ProofRecord>();
  const unique = [...new Map(questions.map((q) => [q.id, q])).values()];
  const todo: ClinicalQuestion[] = [];
  for (const q of unique) {
    const existing = proofOf(q.id);
    if (existing && !options.force) results.set(q.id, existing);
    else todo.push(q);
  }
  let done = unique.length - todo.length;
  onProgress?.(done, unique.length);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const q = todo[next++];
      try {
        results.set(q.id, await checkAnswer(q));
      } catch (err: any) {
        // Not stored: a failed check is retried next time instead of counting as a result.
        console.warn('[answer-check]', q.id, err?.message || err);
      }
      done += 1;
      onProgress?.(done, unique.length);
    }
  };
  // 3 at a time: the provider rate-limits higher parallelism (HTTP 429), so bursts of 10 fail.
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 3, todo.length) }, worker));
  return results;
}
