// QA dashboard: recent generated questions, their verification status, findings and the
// human-review queue. Deterministic validation is recorded automatically; a full (LLM)
// review can be triggered per question here.
import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, RefreshCw, FileQuestion, Search, ExternalLink } from 'lucide-react';
import { loadBank, reviewQuestion, recordReviewBatch, updateReviewStatus, type BankEntry } from '../lib/qaClient.ts';
import { runIntegrityScan, listQuestions, listBatches, type IntegrityIssue } from '../utils/questionBankStorage.ts';

const statusColor: Record<string, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PUBLISHED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REVISION_REQUIRED: 'bg-amber-50 text-amber-700 border-amber-200',
  HUMAN_REVIEW_REQUIRED: 'bg-rose-50 text-rose-700 border-rose-200',
  REJECTED: 'bg-slate-100 text-slate-600 border-slate-200',
  GENERATED: 'bg-sky-50 text-sky-700 border-sky-200',
  REVIEWING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  SUSPENDED: 'bg-slate-100 text-slate-500 border-slate-200',
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
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b]">
        <div className="flex items-center gap-2 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-1">
          <ShieldCheck className="w-4 h-4" /> Quality Assurance
        </div>
        <h1 className="text-2xl font-bold">Question Verification Pipeline</h1>
        <p className="text-slate-300 text-sm mt-1 max-w-2xl">
          Every generated question passes deterministic validation before it can enter the bank. Clinical
          solving, evidence verification, adversarial audit and refinement run as independent LLM stages.
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <Stat label="Generated" value={counts.total} />
          <Stat label="Approved" value={counts.approved} tone="good" />
          <Stat label="Awaiting review" value={counts.review} tone="warn" />
          <Stat label="Rejected" value={counts.rejected} tone="bad" />
        </div>
      </div>

      {note && <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-xs text-teal-800">{note}</div>}

      {Object.keys(defectCounts).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-xs font-bold text-slate-700 mb-2">Most common defect categories</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(defectCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cat, n]) => (
              <span key={cat} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">{cat} · {n}</span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileQuestion className="w-4 h-4 text-[#0f8b8d]" /> Review queue
          </h2>
          <button onClick={refresh} className="text-xs font-semibold text-[#0f8b8d] hover:underline">Refresh</button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">Question Bank Storage</div>
          <div className="text-[11px] text-slate-500">
            {storedCount} persisted question{storedCount === 1 ? '' : 's'} · {batchCount} generation batch{batchCount === 1 ? '' : 'es'}.
            Every generated question is saved automatically with exam, bank, subject, topic and subtopic before launch.
          </div>
        </div>
        <button
          onClick={runIntegrity}
          disabled={integrityBusy}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 disabled:opacity-40 flex items-center gap-1"
        >
          {integrityBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
          Run integrity scan
        </button>
      </div>

      {integrity && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-bold text-slate-900 mb-2">
            Integrity scan: {integrity.length === 0 ? 'clean' : `${integrity.length} issue${integrity.length === 1 ? '' : 's'}`}
          </div>
          {integrity.length === 0 ? (
            <div className="text-xs text-emerald-700">No issues found.</div>
          ) : (
            <div className="space-y-1">
              {integrity.map((iss, i) => (
                <div key={i} className="text-xs flex items-start gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${iss.severity === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{iss.severity}</span>
                  <span className="font-mono text-slate-400 text-[10px]">{iss.questionId}</span>
                  <span className="text-slate-600">{iss.issue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {bank.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            No generated questions yet. Build a module in the Practice Builder — it will be validated here automatically.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {bank.slice().reverse().map((b) => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor[b.status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {b.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{b.subject} · {b.subtopic}</span>
                      <span className="text-[10px] font-mono text-slate-400">{b.review.adjudication.totalScore}/100</span>
                    </div>
                    <div className="text-xs text-slate-800 mt-1 line-clamp-2">{b.question.stem}</div>
                    {b.review.humanReviewRequired && (
                      <div className="text-[10px] text-rose-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Human review required</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                      className="text-xs font-semibold text-slate-600 hover:text-[#0f8b8d]"
                    >
                      {expanded === b.id ? 'Hide' : 'Findings'}
                    </button>
                    <button
                      onClick={() => runFullReview(b.id)}
                      disabled={busy === b.id}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 disabled:opacity-40 flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${busy === b.id ? 'animate-spin' : ''}`} />
                      {busy === b.id ? 'Reviewing…' : 'Full review'}
                    </button>
                  </div>
                </div>
                {expanded === b.id && (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="font-bold text-slate-700">Findings</div>
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
                    <div className="text-slate-500">{b.review.adjudication.reason}</div>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => { updateReviewStatus(b.id, 'APPROVED'); refresh(); }} className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-100 text-emerald-800">Approve (override)</button>
                      <button onClick={() => { updateReviewStatus(b.id, 'REJECTED'); refresh(); }} className="text-[10px] font-bold px-2 py-1 rounded bg-rose-100 text-rose-700">Reject</button>
                      <button onClick={() => { updateReviewStatus(b.id, 'SUSPENDED'); refresh(); }} className="text-[10px] font-bold px-2 py-1 rounded bg-slate-200 text-slate-700">Suspend</button>
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
  <div className={`px-4 py-2 rounded-xl border ${tone === 'good' ? 'bg-emerald-500/10 border-emerald-400/30' : tone === 'warn' ? 'bg-amber-500/10 border-amber-400/30' : tone === 'bad' ? 'bg-rose-500/10 border-rose-400/30' : 'bg-white/5 border-white/10'}`}>
    <div className="text-2xl font-bold">{value}</div>
    <div className="text-[11px] text-slate-300">{label}</div>
  </div>
);

const Finding: React.FC<{ severity: string; text: string }> = ({ severity, text }) => (
  <div className="flex items-start gap-1.5">
    {severity === 'critical' || severity === 'error'
      ? <XCircle className="w-3 h-3 text-rose-500 mt-0.5 shrink-0" />
      : severity === 'warning'
        ? <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
        : <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />}
    <span className={severity === 'critical' || severity === 'error' ? 'text-rose-700' : severity === 'warning' ? 'text-amber-700' : 'text-slate-600'}>{text}</span>
  </div>
);

// Silence unused import warning for icons referenced conditionally above.
void Search; void ExternalLink;
