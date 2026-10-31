// Benchmark panel: compares the latest generated module with the imported reference banks
// (eMedici, AMC SUCCESS, AMC Recall). The comparison is deterministic and shows its numbers,
// so a reviewer can see why a set was flagged.
import React, { useState } from 'react';
import { Scale, RefreshCw, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { compareSets, fromBankQuestion, toBenchItem, MIN_REFERENCE, type BenchReport } from '../lib/benchmark.ts';
import { getBankFromIDB, type BankId, type BankQuestion } from '../utils/questionBankDB.ts';
import { loadActiveTest } from '../utils/sessionStore.ts';
import type { ClinicalQuestion } from '../types.ts';

const BANKS: { id: BankId; label: string }[] = [
  { id: 'emedici', label: 'eMedici' },
  { id: 'success', label: 'AMC SUCCESS' },
  { id: 'amc', label: 'AMC Recall' },
];

const verdictStyle: Record<BenchReport['verdict'], { text: string; tone: string }> = {
  empty: { text: 'No generated module found. Build a module first.', tone: 'border-slate-200 bg-slate-50 text-slate-700' },
  'insufficient-reference': { text: `Reference too small to judge (need ${MIN_REFERENCE}+ items).`, tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  'needs-work': { text: 'Differs from the reference papers. Review the flagged rows.', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
  'close-to-reference': { text: 'Style and mix match the reference papers on every measured point.', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
};

export const BenchmarkPanel: React.FC = () => {
  const [report, setReport] = useState<BenchReport | null>(null);
  const [refCounts, setRefCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const generated: ClinicalQuestion[] = loadActiveTest()?.questions ?? [];
      const banks = await Promise.all(BANKS.map((b) => getBankFromIDB(b.id).catch(() => [] as BankQuestion[])));
      const counts: Record<string, number> = {};
      BANKS.forEach((b, i) => { counts[b.id] = banks[i].length; });
      setRefCounts(counts);
      const reference = banks.flat().map(fromBankQuestion);
      setReport(compareSets(generated.map(toBenchItem), reference));
    } catch (err: any) {
      setError(err?.message || 'Benchmark failed.');
    } finally {
      setBusy(false);
    }
  };

  const style = report ? verdictStyle[report.verdict] : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-4 h-4 text-[#0f8b8d]" /> Benchmark against reference papers
          </div>
          <div className="text-[11px] text-slate-500">
            Compares the latest module with imported eMedici, AMC SUCCESS and AMC Recall items on stem length, vignettes,
            negative stems, giveaways and near-duplicates.
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 disabled:opacity-40 flex items-center gap-1"
        >
          {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Scale className="w-3 h-3" />}
          Compare latest module
        </button>
      </div>

      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {report && style && (
        <>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
            <span className="px-2 py-1 rounded-full bg-slate-100">Generated: {report.generatedCount}</span>
            {BANKS.map((b) => (
              <span key={b.id} className="px-2 py-1 rounded-full bg-slate-100">{b.label}: {refCounts[b.id] ?? 0}</span>
            ))}
            <span className="px-2 py-1 rounded-full bg-slate-100">Reference total: {report.referenceCount}</span>
          </div>

          <div className={`rounded-xl border px-3 py-2 text-xs font-semibold flex items-center gap-2 ${style.tone}`}>
            {report.verdict === 'close-to-reference' ? <CheckCircle2 className="w-4 h-4" /> : report.verdict === 'empty' || report.verdict === 'insufficient-reference' ? <Info className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {style.text}
          </div>

          {report.verdict !== 'empty' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-semibold">Measure</th>
                    <th className="py-2 pr-3 font-semibold">Generated</th>
                    <th className="py-2 pr-3 font-semibold">Reference</th>
                    <th className="py-2 pr-3 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.metric} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 text-slate-800">
                        {row.metric}
                        <div className="text-[10px] text-slate-400">{row.note}</div>
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-800">{row.generated}</td>
                      <td className="py-2 pr-3 font-mono text-slate-500">{row.reference}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.flag ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {row.flag ? 'FLAG' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.duplicates.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-700 mb-2">
                Near-duplicates of reference items ({report.duplicates.length})
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {report.duplicates.slice(0, 10).map((d, i) => (
                  <div key={i} className="rounded-lg border border-rose-100 bg-rose-50/40 p-2 text-[11px]">
                    <div className="font-semibold text-rose-700">{Math.round(d.similarity * 100)}% overlap</div>
                    <div className="text-slate-700 mt-0.5">Generated: {d.generatedStem.slice(0, 220)}</div>
                    <div className="text-slate-500 mt-0.5">Reference: {d.referenceStem.slice(0, 220)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-slate-400">
            This checks style and mix only. It can't tell whether the medicine is right. The QA pipeline and a human reviewer
            still decide that.
          </div>
        </>
      )}
    </div>
  );
};
