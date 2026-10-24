// Data & exports (PARITY section 9): versioned JSON backup with no keys, merge
// import that never overwrites existing schedules, and reset schedules with an
// automatic backup download first. All counts are read from the real stores.
import React, { useMemo, useRef, useState } from 'react';
import {
  Database, Download, Upload, RotateCcw, AlertCircle, CheckCircle2, ShieldCheck, Trash2,
} from 'lucide-react';
import {
  backupToJson,
  importBackup,
  resetSchedules,
  clearAllStudyData,
  buildReviewCards,
  dueCount,
  BACKUP_VERSION,
} from '../utils/flashcardStore.ts';
import { listUserHighlights } from '../utils/userHighlightsStore.ts';
import { listAttempts } from '../utils/attemptStore.ts';
import { listCapturedQuestions } from '../utils/mistakeStore.ts';

function download(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

export const DataBackupPanel: React.FC = () => {
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    void version;
    return {
      highlights: listUserHighlights().length,
      attempts: listAttempts().length,
      captured: listCapturedQuestions().length,
      cards: buildReviewCards().length,
      due: dueCount(),
    };
  }, [version]);

  const refresh = () => setVersion((v) => v + 1);

  const exportNow = () => {
    setError(null);
    try {
      download(`pulse-med-backup-${stamp()}.json`, 'application/json', backupToJson());
      setMessage('Backup downloaded (no keys or tokens included).');
    } catch (err: any) {
      setError(err?.message || 'Could not create the backup.');
    }
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const result = importBackup(text);
      setMessage(
        `Merged: ${result.highlights} highlight(s), ${result.schedules} schedule(s), ` +
        `${result.attempts} attempt(s), ${result.capturedQuestions} captured question(s). ` +
        'Existing schedules were kept.',
      );
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Import failed.');
    }
  };

  const reset = () => {
    if (!window.confirm('Reset every review schedule? A backup will download first; your highlights and questions are kept.')) return;
    setError(null);
    try {
      const backup = resetSchedules();
      download(`pulse-med-before-schedule-reset-${stamp()}.json`, 'application/json', backup);
      setMessage('Schedules reset — every card is due now. Backup downloaded.');
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not reset the schedules.');
    }
  };

  const clearAll = () => {
    if (!window.confirm('Delete ALL highlights, captured questions, attempts and schedules? A backup downloads first. This cannot be undone from the app.')) return;
    setError(null);
    try {
      const backup = clearAllStudyData();
      download(`pulse-med-before-delete-${stamp()}.json`, 'application/json', backup);
      setMessage('Study data deleted. Backup downloaded.');
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Could not clear the data.');
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-4 h-4 text-[#0f8b8d]" /> Data, backup & review schedule
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Versioned JSON backup (v{BACKUP_VERSION}) — never includes OAuth tokens or API keys.
          </p>
        </div>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
          {counts.cards} cards · {counts.due} due
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[
          { label: 'Highlights', value: counts.highlights },
          { label: 'Captured Qs', value: counts.captured },
          { label: 'Attempts', value: counts.attempts },
          { label: 'Review cards', value: counts.cards },
        ].map((c) => (
          <div key={c.label} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-lg font-mono font-bold text-slate-800">{c.value}</div>
            <div className="text-[10px] text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      {message && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] rounded-xl flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{message}</span>
        </div>
      )}
      {error && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-xl flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={exportNow}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#001432] hover:bg-[#13294b] text-white text-xs font-bold"
        >
          <Download className="w-3.5 h-3.5 text-[#8ff3f4]" /> Export backup (JSON)
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#0f8b8d]/50 text-slate-700 text-xs font-bold"
        >
          <Upload className="w-3.5 h-3.5" /> Merge import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { importFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
        />
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 text-xs font-bold"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset schedules (backup first)
        </button>
        <button
          onClick={clearAll}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-bold"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete study data
        </button>
      </div>

      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[10px] text-slate-600 leading-relaxed flex items-start gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
        <span>
          Merge import matches items by id and never overwrites a schedule that already exists on this machine.
          Export/import stay entirely on this computer.
        </span>
      </div>
    </div>
  );
};
