export const MIN_MCQ_CONCURRENCY = 1;
export const MAX_MCQ_CONCURRENCY = 20;

const MCQ_CONCURRENCY_KEY = 'pulse.parallelLimit';

export function getMcqConcurrencyOverride(): number | null {
  try {
    const raw = localStorage.getItem(MCQ_CONCURRENCY_KEY);
    if (raw === null) return null;
    const count = Number(raw);
    if (!Number.isFinite(count) || count < MIN_MCQ_CONCURRENCY) return null;
    return Math.min(MAX_MCQ_CONCURRENCY, Math.round(count));
  } catch {
    return null;
  }
}

export function setMcqConcurrencyOverride(count: number | null): number | null {
  if (count !== null && !Number.isFinite(count)) return getMcqConcurrencyOverride();
  const normalized = count === null
    ? null
    : Math.max(MIN_MCQ_CONCURRENCY, Math.min(MAX_MCQ_CONCURRENCY, Math.round(count)));
  try {
    if (normalized === null) localStorage.removeItem(MCQ_CONCURRENCY_KEY);
    else localStorage.setItem(MCQ_CONCURRENCY_KEY, String(normalized));
    return normalized;
  } catch {
    return getMcqConcurrencyOverride();
  }
}

export function imageQuestionConcurrencyLimit(): number {
  return getMcqConcurrencyOverride() ?? 3;
}
