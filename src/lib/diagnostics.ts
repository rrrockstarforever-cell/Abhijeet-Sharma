// Run diagnostics for question generation: one record per rejected or kept draft, with the full draft and the evidence
// each check found, plus a summary of the whole run. Everything stays on this computer.
//
// Read it after a run:
//   globalThis.__runReport      the whole report (settings, plan steps, every drop with evidence, summaries)
//   globalThis.pulseRunReport() downloads the report as a JSON file
// The app also saves each report to <PULSE_DATA_DIR>/diagnostics/ through POST /api/diagnostics/run-report.
import type { ClinicalQuestion } from '../types.ts';

export interface DropRecord {
  n: number;
  at: number;
  outcome: 'dropped' | 'accepted';
  reason?: string;
  /** What the writer is told for the rewrite (for the examiner, its own sentence). */
  why?: string | null;
  /** Check-specific evidence: the matched phrase and field, the shared words, the earlier fact it repeats, the raw reply... */
  detail?: Record<string, unknown>;
  subtopic?: string;
  subject?: string;
  fact?: string;
  planned?: boolean | null;
  attempt?: number;
  slot?: { style?: string; leadIn?: string; tier?: string };
  source?: 'books' | 'web';
  draft?: {
    stem?: string;
    questionText?: string;
    options?: { id: string; text: string }[];
    correctOption?: string;
    explanation?: string;
    keyFact?: string;
  };
}

interface RunState {
  startedAt: string;
  t0: number;
  meta: Record<string, unknown>;
  records: DropRecord[];
  invalid: unknown[];
}

let run: RunState | null = null;
let seq = 0;

const g = globalThis as {
  __runReport?: unknown;
  __drops?: unknown[];
  pulseRunReport?: () => void;
  __planSteps?: unknown;
  __planSummary?: unknown;
  __planDebug?: unknown;
  __invalid?: unknown[];
  __stageLog?: { stage: string; ms: number }[];
};

/** Starts a run (the first generation round); later rounds of the same module continue it. */
export function startRun(meta: Record<string, unknown>, continueRun = false): void {
  if (continueRun && run) { run.meta = { ...run.meta, rounds: Number(run.meta.rounds ?? 1) + 1 }; return; }
  run = { startedAt: new Date().toISOString(), t0: Date.now(), meta: { ...meta, rounds: 1 }, records: [], invalid: [] };
  seq = 0;
  g.__drops = [];
  g.__invalid = [];
}

export function recordDraft(rec: Omit<DropRecord, 'n' | 'at'>): void {
  const full: DropRecord = { n: ++seq, at: run ? Date.now() - run.t0 : 0, ...rec };
  run?.records.push(full);
  // The older short log stays available for existing tools.
  (g.__drops ??= []).push({ outcome: rec.outcome, reason: rec.reason, why: rec.why ?? null, q: rec.draft?.stem?.slice(0, 160), n: full.n, subtopic: rec.subtopic, detail: rec.detail });
}

export function draftOf(q: ClinicalQuestion | undefined): DropRecord['draft'] | undefined {
  if (!q) return undefined;
  return {
    stem: q.stem,
    questionText: (q as { questionText?: string }).questionText,
    options: q.options?.map((o) => ({ id: o.id, text: o.text })),
    correctOption: q.correctOption,
    explanation: String(q.explanation ?? '').slice(0, 2500),
    keyFact: q.keyFact,
  };
}

const count = <T,>(items: T[], key: (t: T) => string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const it of items) { const k = key(it); if (k) out[k] = (out[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};

/** Builds the report, keeps it on globalThis, prints a summary table and saves it through the local server. */
export function finishRun(extra: Record<string, unknown> = {}): unknown {
  if (!run) return null;
  const records = run.records;
  const dropped = records.filter((r) => r.outcome === 'dropped');
  const kept = records.filter((r) => r.outcome === 'accepted');
  // Which subtopics and which planned facts cost the most rewrites.
  const bySubtopic: Record<string, Record<string, number>> = {};
  for (const r of dropped) {
    const s = r.subtopic ?? '(none)';
    bySubtopic[s] ??= {};
    bySubtopic[s][r.reason ?? '?'] = (bySubtopic[s][r.reason ?? '?'] ?? 0) + 1;
  }
  const factCost = count(dropped, (r) => r.fact?.slice(0, 120));
  const stages: Record<string, { calls: number; ms: number }> = {};
  for (const s of g.__stageLog ?? []) {
    if (s.stage.startsWith('drop:')) continue;
    stages[s.stage] ??= { calls: 0, ms: 0 };
    stages[s.stage].calls += 1;
    stages[s.stage].ms += s.ms;
  }
  const report = {
    version: 1,
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - run.t0) / 1000),
    settings: run.meta,
    totals: {
      kept: kept.length,
      rejected: dropped.length,
      draftsWritten: kept.length + dropped.filter((r) => !['over-target', 'late-copy', 'verify-error'].includes(r.reason ?? '')).length,
      shareKept: kept.length + dropped.length ? Math.round((100 * kept.length) / (kept.length + dropped.length)) : 0,
    },
    rejectionsByReason: count(dropped, (r) => r.reason),
    rejectionsByAttempt: count(dropped, (r) => `attempt ${r.attempt ?? 0}`),
    rejectionsBySource: count(dropped, (r) => r.source),
    rejectionsBySlotStyle: count(dropped, (r) => r.slot?.style),
    rejectionsBySubtopic: bySubtopic,
    costliestFacts: Object.fromEntries(Object.entries(factCost).slice(0, 15)),
    keptBySubject: count(kept, (r) => r.subject),
    keptBySubtopic: count(kept, (r) => r.subtopic),
    plan: { steps: g.__planSteps ?? null, summary: g.__planSummary ?? null, debug: g.__planDebug ?? null },
    stages,
    invalid: g.__invalid ?? [],
    records,
    ...extra,
  };
  g.__runReport = report;
  try {
    console.info(`[run] kept ${report.totals.kept}, rejected ${report.totals.rejected} (${report.totals.shareKept}% kept) in ${report.seconds}s. Full report: globalThis.__runReport, download: pulseRunReport()`);
    console.table(Object.entries(report.rejectionsByReason).map(([reason, n]) => ({ reason, n })));
  } catch { /* console unavailable */ }
  void fetch('/api/diagnostics/run-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {});
  return report;
}

/** Downloads the last run report as a JSON file (call pulseRunReport() in the console). */
export function downloadRunReport(): void {
  const report = g.__runReport;
  if (!report || typeof document === 'undefined') { console.warn('No run report yet.'); return; }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pulse-run-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
g.pulseRunReport = downloadRunReport;
