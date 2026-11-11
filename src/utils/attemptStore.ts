// Real attempt history (PARITY section 12: "Progress computed only from real
// captured/attempted questions"). Persisted in localStorage 'pulse.attempts.v1'.
// Analytics and the mistake notebook can derive stats from this instead of mock numbers.

import { notifyDataChanged } from './dataEvents.ts';

export interface AttemptRecord {
  id: string;
  at: string;
  exam: string;
  mode: 'EXAM' | 'TUTOR';
  total: number;
  attempted: number;
  correct: number;
  /** subject -> {total, correct} for weak-topic analysis */
  subjects: Record<string, { total: number; correct: number }>;
  questionIds: string[];
  /** question ids answered incorrectly (for the mistake notebook) */
  incorrectIds: string[];
}

const KEY = 'pulse.attempts.v1';

export function addAttempt(input: Omit<AttemptRecord, 'id' | 'at'>): AttemptRecord {
  const rec: AttemptRecord = {
    ...input,
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  };
  try {
    const raw = localStorage.getItem(KEY);
    const list: AttemptRecord[] = raw ? JSON.parse(raw) : [];
    (Array.isArray(list) ? list : []).unshift(rec);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 300)));
    notifyDataChanged();
  } catch { /* storage full: keep the session running without history */ }
  return rec;
}

export function listAttempts(): AttemptRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as AttemptRecord[]) : [];
  } catch {
    return [];
  }
}

/** Merge attempts from a backup by id; never duplicates or rewrites existing rows. */
export function importAttempts(records: AttemptRecord[]): number {
  const existing = listAttempts();
  const seen = new Set(existing.map((a) => a.id));
  let added = 0;
  for (const rec of records) {
    if (!rec || typeof rec.id !== 'string' || seen.has(rec.id)) continue;
    existing.push(rec);
    seen.add(rec.id);
    added += 1;
  }
  if (added > 0) {
    try {
      existing.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      localStorage.setItem(KEY, JSON.stringify(existing.slice(0, 300)));
      notifyDataChanged();
    } catch {
      throw new Error('Local storage is full — could not import attempts.');
    }
  }
  return added;
}

/** Attempts submitted on the current calendar day (local time). */
export function attemptsToday(): AttemptRecord[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  return listAttempts().filter((a) => {
    const t = Date.parse(a.at);
    return Number.isFinite(t) && t >= startMs;
  });
}

/** Aggregate across all attempts; returns null for values with no data yet. */
export function summarizeAttempts(): {
  modules: number;
  questionsAnswered: number;
  correct: number;
  accuracyPercent: number | null;
  weakSubjects: { subject: string; correct: number; total: number; accuracy: number }[];
  lastAttemptAt: string | null;
} {
  const list = listAttempts();
  let questionsAnswered = 0;
  let correct = 0;
  const subjectAgg: Record<string, { total: number; correct: number }> = {};
  for (const a of list) {
    questionsAnswered += a.attempted;
    correct += a.correct;
    for (const [subject, s] of Object.entries(a.subjects)) {
      const agg = subjectAgg[subject] ?? (subjectAgg[subject] = { total: 0, correct: 0 });
      agg.total += s.total;
      agg.correct += s.correct;
    }
  }
  const weakSubjects = Object.entries(subjectAgg)
    .filter(([, s]) => s.total >= 3) // ignore tiny samples
    .map(([subject, s]) => ({ subject, correct: s.correct, total: s.total, accuracy: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 8);
  return {
    modules: list.length,
    questionsAnswered,
    correct,
    accuracyPercent: questionsAnswered > 0 ? Math.round((correct / questionsAnswered) * 100) : null,
    weakSubjects,
    lastAttemptAt: list[0]?.at ?? null,
  };
}
