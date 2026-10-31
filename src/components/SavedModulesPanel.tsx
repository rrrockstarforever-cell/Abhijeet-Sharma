// Saved question banks: every generated module, kept whole, so it can be finished later.
// Resuming reopens the same questions in the Test Runner, which restores the answers and position.
import React, { useEffect, useState } from 'react';
import { BookOpen, Play, Trash2, RefreshCw } from 'lucide-react';
import type { ClinicalQuestion, ExamType } from '../types.ts';
import { listModules, getModule, deleteModule, backfillModulesFromSessions, MODULES_CHANGED, type ModuleSummary } from '../utils/moduleStore.ts';

const EXAM_LABEL: Record<string, string> = { NEET_PG: 'NEET-PG', INI_CET: 'INI-CET', AMC_CAT: 'AMC CAT' };

interface SavedModulesPanelProps {
  onLaunchTest: (questions: ClinicalQuestion[], mode: 'EXAM' | 'TUTOR', exam: ExamType) => void;
}

export const SavedModulesPanel: React.FC<SavedModulesPanelProps> = ({ onLaunchTest }) => {
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listModules().then(setModules).catch((err: any) => setError(err?.message || 'Could not read saved question banks.'));
  };
  useEffect(() => {
    // First visit: rebuild earlier banks from saved sessions (runs once), then list.
    backfillModulesFromSessions().catch(() => { /* listing still works without it */ }).then(load);
    window.addEventListener(MODULES_CHANGED, load);
    return () => window.removeEventListener(MODULES_CHANGED, load);
  }, []);

  const resume = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const saved = await getModule(id);
      if (!saved) throw new Error('This question bank is no longer stored.');
      onLaunchTest(saved.questions, saved.mode, saved.exam);
    } catch (err: any) {
      setError(err?.message || 'Could not reopen this question bank.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this saved question bank? Its questions and your progress on it will be removed.')) return;
    try {
      await deleteModule(id);
      localStorage.removeItem('runSession-' + id);
      load();
    } catch (err: any) {
      setError(err?.message || 'Could not delete this question bank.');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#0f8b8d]" /> Saved question banks
          </div>
          <div className="text-[11px] text-slate-500">
            Every generated bank is kept as it was. Resume to continue where you stopped.
          </div>
        </div>
        <button onClick={load} className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {modules && modules.length === 0 && (
        <div className="text-xs text-slate-500">No saved question banks yet. Build a module in the Practice Builder and it will be kept here.</div>
      )}

      <div className="space-y-2">
        {(modules ?? []).map((m) => {
          const done = m.count > 0 && m.answered >= m.count;
          const pct = m.count ? Math.round((m.answered / m.count) * 100) : 0;
          return (
            <div key={m.id} className="rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{m.title}</div>
                <div className="text-[11px] text-slate-500">
                  {EXAM_LABEL[m.exam] ?? m.exam} · {m.count} questions · {m.mode === 'EXAM' ? 'Exam mode' : 'Tutor mode'} · {new Date(m.createdAt).toLocaleString()}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 w-40 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-[#0f8b8d]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600">
                    {done ? 'Completed' : m.answered > 0 ? `${m.answered}/${m.count} answered` : 'Not started'}
                    {m.answered > 0 ? ` · ${m.correct} correct` : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => resume(m.id)}
                  disabled={busyId === m.id}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#0f8b8d] text-white hover:bg-[#00696b] disabled:opacity-40 flex items-center gap-1"
                >
                  <Play className="w-3 h-3" /> {done ? 'Review' : m.answered > 0 ? 'Continue' : 'Start'}
                </button>
                <button
                  onClick={() => remove(m.id)}
                  title="Delete this saved question bank"
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
