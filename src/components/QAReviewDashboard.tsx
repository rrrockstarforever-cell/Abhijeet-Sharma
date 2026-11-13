// QA dashboard: recent generated questions, their verification status, findings and the
// human-review queue. Deterministic validation is recorded automatically; a full (LLM)
// review can be triggered per question here.
import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, RefreshCw, FileQuestion, Search, ExternalLink } from 'lucide-react';
import { loadBank, reviewQuestion, recordReviewBatch, updateReviewStatus, type BankEntry } from '../lib/qaClient.ts';
import { runIntegrityScan, listQuestions, listBatches, type IntegrityIssue } from '../utils/questionBankStorage.ts';
import { BenchmarkPanel } from './BenchmarkPanel.tsx';

const statusColor: Record<string, string> = {
  APPROVED: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  PUBLISHED: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  REVISION_REQUIRED: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  HUMAN_REVIEW_REQUIRED: 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-200',
  REJECTED: 'border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-200',
  GENERATED: 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-200',
  REVIEWING: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200',
  SUSPENDED: 'border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
};

export const QAReviewDashboard: React.FC = () => {
  const [bank, setBank] = useState<BankEntry[]>(() => loadBank());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityIssue[] | null>(null);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [storedCount, setStoredCount] = useState<number>(0);
  const [batchCount, setBatchCount] = useState<number>(0);

  useEffect(() => { refresh(); }, []);
  const refresh = () => {
    setBank(loadBank());
    listQuestions().then((qs) => setStoredCount(qs.length)).catch(() => {});
    listBatches().then((bs) => setBatchCount(bs.length)).catch(() => {});
  };

  const runIntegrity = async () => {
    setIntegrityBusy(true);
    try { setIntegrity(await runIntegrityScan()); }
    catch (e: any) { setNote(e?.message || 'Integrity scan failed.'); }
    finally { setIntegrityBusy(false); }
  };

  const runFullReview = async (id: string) => {
    const entry = bank.find((b) => b.id === id);
    if (!entry) return;
    setBusy(id);
    setNote(null);
    try {
      const review = await reviewQuestion(entry.question, true);
      entry.question.qaReview = review;
      entry.question.status = review.status;
      recordReviewBatch([entry.question], [review]);
      setNote(`Full review finished: ${review.status} (score ${review.adjudication.totalScore}/100).`);
      refresh();
    } catch (err: any) {
      setNote(err?.message || 'Full review failed.');
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    total: bank.length,
    approved: bank.filter((b) => b.status === 'APPROVED' || b.status === 'PUBLISHED').length,
    review: bank.filter((b) => b.status === 'HUMAN_REVIEW_REQUIRED' || b.status === 'REVISION_REQUIRED').length,
    rejected: bank.filter((b) => b.status === 'REJECTED').length,
  };

  const defectCounts: Record<string, number> = {};
  for (const b of bank) {
    for (const f of b.review.structural.findings) {
      defectCounts[f.category] = (defectCounts[f.category] || 0) + 1;
    }
    for (const f of b.review.audit?.findings ?? []) defectCounts[f.category] = (defectCounts[f.category] || 0) + 1;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="relative overflow-hidden rounded-[28px] border border-[#13294b] bg-[#001432] p-6 text-white    ">
        <div className="pointer-events-none absolute inset-0 bg-[#8ff3f4] opacity-[0.10]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[#8ff3f4] opacity-[0.05] motion-reduce:hidden" aria-hidden="true" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#13294b] bg-white/5 px-3 py-1 text-[11px] tracking-wide text-[#8ff3f4]    ">
            <ShieldCheck className="h-4 w-4" /> QA PIPELINE
          </div>
          <h1 className="mt-3 text-3xl font-medium leading-tight md:text-4xl">Question Verification Pipeline</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300  ">
            Every generated question passes deterministic validation before it can enter the bank. Clinical
            solving, evidence verification, adversarial audit and refinement run as independent LLM stages.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Generated" value={counts.total} />
            <Stat label="Approved" value={counts.approved} tone="good" />
            <Stat label="Awaiting review" value={counts.review} tone="warn" />
            <Stat label="Rejected" value={counts.rejected} tone="bad" />
          </div>
        </div>
      </div>

      {note && (
        <div className="relative overflow-hidden rounded-[20px] border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800    ">
          <div className="pointer-events-none absolute inset-0 bg-teal-500 opacity-[0.08]" aria-hidden="true" />
          <div className="relative flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
            <span>{note}</span>
          </div>
        </div>
      )}

      <div className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm ">
        <div className="pointer-events-none absolute inset-0 bg-slate-100 opacity-[0.10]" aria-hidden="true" />
        <div className="relative">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500  ">Quality signals</div>
              <h2 className=" text-xl font-medium text-slate-900  ">Diagnostics</h2>
            </div>
            <span className="text-[11px] text-slate-500  ">Defects and integrity checks</span>
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3 ">
            <div className="mb-2 text-xs font-medium text-slate-700  ">Most common defect categories</div>
            {Object.keys(defectCounts).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(defectCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cat, n]) => (
                  <span key={cat} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600   ">
                    {cat} · {n}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500  ">No defect categories recorded yet.</div>
            )}
          </div>
          {integrity && (
            <div className="mt-3 rounded-[16px] border border-slate-200 bg-slate-50 p-3 ">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-slate-700  ">Integrity scan</div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${integrity.length === 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'}`}>
                  {integrity.length === 0 ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {integrity.length === 0 ? 'Clean' : `${integrity.length} issue${integrity.length === 1 ? '' : 's'}`}
                </span>
              </div>
              {integrity.length === 0 ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-200">No issues found.</div>
              ) : (
                <div className="space-y-1.5">
                  {integrity.map((iss, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 ">
                      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase ${iss.severity === 'error' ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-200'}`}>
                        {iss.severity === 'error' ? <XCircle className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                        {iss.severity}
                      </span>
                  <span className="font-mono text-slate-400 text-[10px]">{iss.questionId}</span>
                      <span className="text-xs text-slate-600  ">{iss.issue}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm ">
        <BenchmarkPanel />
      </div>

      <div className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm ">
        <div className="pointer-events-none absolute inset-0 bg-slate-100 opacity-[0.08]" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900  ">
              <FileQuestion className="h-4 w-4" /> Question Bank Storage
            </div>
            <div className="mt-1 text-[11px] leading-5 text-slate-500  ">
              {storedCount} persisted question{storedCount === 1 ? '' : 's'} · {batchCount} generation batch{batchCount === 1 ? '' : 'es'}.
              Every generated question is saved automatically with exam, bank, subject, topic and subtopic before launch.
            </div>
          </div>
          <button
            onClick={runIntegrity}
            disabled={integrityBusy}
            className="flex min-h-[44px] items-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:-translate-y-0.5  focus-visible:outline-none focus-visible:ring-2 focus-visible: disabled:opacity-40  "
          >
            {integrityBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Run integrity scan
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm ">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900  ">
            <FileQuestion className="h-4 w-4 text-[#0f8b8d]" /> Review queue
          </h2>
          <button onClick={refresh} className="flex min-h-[36px] items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-[#0f8b8d] transition hover:underline   focus-visible:outline-none focus-visible:ring-2 focus-visible:  ">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
        {bank.length === 0 ? (
          <div className="relative m-4 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50 p-8 text-center text-slate-400  ">
            <div className="pointer-events-none absolute inset-0 bg-slate-100 opacity-[0.08]" aria-hidden="true" />
            <div className="relative">
              <FileQuestion className="mx-auto h-8 w-8 text-slate-400  " />
              <div className="mt-2 text-xl font-medium text-slate-700  ">No generated questions yet</div>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500  ">Build a module in the Practice Builder — it will be validated here automatically.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 ">
            {bank.slice().reverse().map((b) => (
              <div key={b.id} className="group px-4 py-4 transition-transform duration-200 hover:-focus-within:-">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${statusColor[b.status] ?? 'border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-200'}`}>
                        <ShieldCheck className="h-3 w-3" /> {b.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{b.subject} · {b.subtopic}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-sm text-slate-700   ">{b.review.adjudication.totalScore}/100</span>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-800 line-clamp-2 ">{b.question.stem}</div>
                    {b.review.humanReviewRequired && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-rose-500/60 bg-rose-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:border-rose-300/60 dark:text-rose-200">
                        <AlertTriangle className="h-3.5 w-3.5" /> Human review required
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                      className="min-h-[36px] rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:text-[#0f8b8d] hover:-translate-y-0.5  focus-visible:outline-none focus-visible:ring-2 focus-visible:  "
                    >
                      {expanded === b.id ? 'Hide' : 'Findings'}
                    </button>
                    <button
                      onClick={() => runFullReview(b.id)}
                      disabled={busy === b.id}
                      className="flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:-translate-y-0.5 hover:scale-[1.02] hover:border-[#0f8b8d]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible: disabled:opacity-40"
                    >
                      <RefreshCw className={`h-3 w-3 ${busy === b.id ? 'animate-spin' : ''}`} />
                      {busy === b.id ? 'Reviewing…' : 'Full review'}
                    </button>
                  </div>
                </div>
                {expanded === b.id && (
                  <div className="mt-4 space-y-2 rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 shadow-inner ">
                    <div className="mb-2 text-lg font-medium text-slate-700  ">Findings</div>
                    {b.review.structural.findings.length === 0 && (b.review.audit?.findings.length ?? 0) === 0 && (
                      <div className="text-slate-400">No findings.</div>
                    )}
                    {b.review.structural.findings.map((f, i) => (
                      <Finding key={`s${i}`} severity={f.severity} text={`[${f.category}] ${f.message}`} />
                    ))}
                    {(b.review.audit?.findings ?? []).map((f, i) => (
                      <Finding key={`a${i}`} severity={f.severity} text={`[${f.category}] ${f.message}`} />
                    ))}
                    {b.review.evidence?.findings.map((f, i) => (
                      <Finding key={`e${i}`} severity={f.severity} text={f.message} />
                    ))}
                    {b.review.solver && !b.review.solver.agreed && (
                      <Finding severity="error" text={`Solver selected ${b.review.solver.selectedOption} but key is ${b.question.correctOption}`} />
                    )}
                    <div className="mt-2 text-slate-500 ">{b.review.adjudication.reason}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
                      <button onClick={() => { updateReviewStatus(b.id, 'APPROVED'); refresh(); }} className="inline-flex items-center gap-1 rounded-lg border border-emerald-600/40 bg-emerald-500/15 px-2.5 py-1.5 text-[10px] font-medium text-emerald-800 transition hover:-translate-y-0.5 dark:text-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Approve (override)
                      </button>
                      <button onClick={() => { updateReviewStatus(b.id, 'REJECTED'); refresh(); }} className="inline-flex items-center gap-1 rounded-lg border border-rose-600/40 bg-rose-500/15 px-2.5 py-1.5 text-[10px] font-medium text-rose-700 transition hover:-translate-y-0.5 dark:text-rose-200">
                        <XCircle className="h-3 w-3" /> Reject
                      </button>
                      <button onClick={() => { updateReviewStatus(b.id, 'SUSPENDED'); refresh(); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-400/50 bg-slate-500/10 px-2.5 py-1.5 text-[10px] font-medium text-slate-700 transition hover:-translate-y-0.5 dark:text-slate-200">
                        Suspend
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone?: 'good' | 'warn' | 'bad' }> = ({ label, value, tone }) => (
  <div className={`relative overflow-hidden rounded-[20px] border px-4 py-3 ${tone === 'good' ? 'bg-emerald-500/10 border-emerald-400/30' : tone === 'warn' ? 'bg-amber-500/10 border-amber-400/30' : tone === 'bad' ? 'bg-rose-500/10 border-rose-400/30' : 'bg-white/5 border-white/10'}  `}>
    <div className="pointer-events-none absolute -right-3 -top-3 h-12 w-12 rounded-full border border-white/20 opacity-20" aria-hidden="true" />
    <div className={` text-3xl leading-none ${tone === 'good' ? 'text-emerald-600 dark:text-emerald-300' : tone === 'warn' ? 'text-amber-600 dark:text-amber-300' : tone === 'bad' ? 'text-rose-600 dark:text-rose-300' : 'text-white'}`}>{value}</div>
    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300  ">{label}</div>
  </div>
);

const Finding: React.FC<{ severity: string; text: string }> = ({ severity, text }) => (
  <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600 ">
    {severity === 'critical' || severity === 'error'
      ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500 dark:text-rose-300" />
      : severity === 'warning'
        ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-300" />
        : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-300" />}
    <span className={severity === 'critical' || severity === 'error' ? 'text-rose-700 dark:text-rose-200' : severity === 'warning' ? 'text-amber-700 dark:text-amber-200' : 'text-slate-600'}>{text}</span>
  </div>
);

// Silence unused import warning for icons referenced conditionally above.
void Search; void ExternalLink;
