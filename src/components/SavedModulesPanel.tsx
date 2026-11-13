// Saved question banks: every generated module, kept whole, so it can be finished later.
// Resuming reopens the same questions in the Test Runner, which restores the answers and position.
import React, { useEffect, useState } from 'react';
import { BookOpen, Play, Trash2, RefreshCw, Copy, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { cleanQuestions } from '../lib/questionCleanup.ts';
import type { ClinicalQuestion, ExamType } from '../types.ts';
import {
  listModules, getModule, deleteModule, backfillModulesFromSessions, MODULES_CHANGED, type ModuleSummary,
  storedQuestions, findDuplicates, removeStoredQuestions, type StoredQuestion,
} from '../utils/moduleStore.ts';

const EXAM_LABEL: Record<string, string> = { NEET_PG: 'NEET-PG', INI_CET: 'INI-CET' };

interface SavedModulesPanelProps {
  onLaunchTest: (questions: ClinicalQuestion[], mode: 'EXAM' | 'TUTOR', exam: ExamType) => void;
}

export const SavedModulesPanel: React.FC<SavedModulesPanelProps> = ({ onLaunchTest }) => {
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ReturnType<typeof findDuplicates> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const findRepeats = async () => {
    setError(null);
    try {
      setDuplicates(findDuplicates(await storedQuestions()));
    } catch (err: any) {
      setError(err?.message || 'Could not check for duplicates.');
    }
  };

  const dropQuestions = async (items: StoredQuestion[], message: string) => {
    try {
      const n = await removeStoredQuestions(items);
      setNotice(`${message} (${n} question${n === 1 ? '' : 's'} removed).`);
      await findRepeats();
    } catch (err: any) {
      setError(err?.message || 'Could not delete the question.');
    }
  };
  // Of each repeated pair, the copy in the newer bank goes; the older one stays. The QA list counts as oldest.
  const removeAllRepeats = async () => {
    if (!duplicates?.length) return;
    if (!window.confirm(`Delete the newer copy of every repeated pair (${duplicates.length}) from your saved banks? Your answers on the other questions stay.`)) return;
    const age = (s: StoredQuestion) => (s.moduleId ? s.createdAt ?? '' : '');
    const newer = new Map<string, StoredQuestion>();
    for (const d of duplicates) {
      const pick = age(d.a) > age(d.b) ? d.a : d.b;
      newer.set(`${pick.moduleId ?? 'qa'}|${pick.question.id}`, pick);
    }
    await dropQuestions([...newer.values()], 'Repeats cleaned up');
  };

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
      const questions = cleanQuestions(saved.questions);
      if (questions.length === 0) throw new Error('This question bank has no questions.');
      onLaunchTest(questions, saved.mode, saved.exam);
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
    <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm p-5    ">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-[#0f8b8d]" />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 ">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-slate-50/60 px-4 py-3 ">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <div className="flex items-center gap-2 text-base font-medium text-slate-900">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#0f8b8d]/40 bg-teal-50 text-[#00696b]">
                <BookOpen className="h-5 w-5" />
              </span>
              <span className="truncate">Saved question banks</span>
            </div>
            <div className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
              Every generated bank is kept as it was. Resume to continue where you stopped.
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={findRepeats}
            className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-[#0f8b8d]/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-[#8ff3f4] dark:focus-visible:ring-offset-[#262D59]"
            aria-label="Find duplicate saved questions"
          >
            <Copy className="h-4 w-4" /> Find duplicates
          </button>
          <button
            type="button"
            onClick={load}
            className="flex min-h-[44px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-[#0f8b8d]/40 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-[#8ff3f4] dark:focus-visible:ring-offset-[#262D59]"
            aria-label="Refresh saved question banks"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {duplicates && (
        <section className="relative mb-4 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
          <div className="relative overflow-hidden border-b-2 border-slate-200 px-3 py-2">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-0.5 text-sm font-medium uppercase tracking-wide text-rose-800" style={{ fontFamily: ', system-ui, sans-serif' }}>
                  DUPES!
                </span>
                <span className="text-xs font-medium text-slate-700">
                  {duplicates.length === 0 ? 'No repeated questions found.' : `${duplicates.length} repeated pair${duplicates.length === 1 ? '' : 's'} found`}
                </span>
              </div>
              <div className="flex items-center gap-2">
              {duplicates.length > 0 && (
                <button type="button" onClick={removeAllRepeats} className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500 bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
                  <Trash2 className="h-4 w-4" /> Remove all repeats
                </button>
              )}
              <button
                type="button"
                onClick={() => setDuplicates(null)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-[#8ff3f4] dark:focus-visible:ring-offset-[#262D59]"
                aria-label="Close duplicate results"
              >
                <X className="h-4 w-4" />
              </button>
              </div>
            </div>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
            {duplicates.slice(0, 30).map((d, i) => (
              <div key={i} className={`rounded-xl border p-2 text-[11px] leading-relaxed ${d.sameAnswer ? 'border-slate-200 bg-white text-slate-800' : 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/60 dark:bg-rose-950/50 dark:text-rose-50'}`}>
                <div className={`mb-1 font-medium ${d.sameAnswer ? 'text-slate-700' : 'text-rose-800 dark:text-rose-100'}`}>
                  {d.sameAnswer ? 'Same question, same answer' : 'Same question, DIFFERENT answers'} · {Math.round(d.similarity * 100)}% overlap
                </div>
                {[d.a, d.b].map((side, k) => (
                  <div key={k} className="mb-1">
                  <div className="text-slate-700">{(side.question.stem || side.question.questionText || '').slice(0, 160)}</div>
                  <div className="text-slate-500">
                      From <span className="font-semibold">{side.source}</span> · Key {side.question.correctOption}: {side.question.options.find((o) => o.id === side.question.correctOption)?.text ?? '—'}
                    </div>
                    <button
                      type="button"
                      onClick={() => { if (window.confirm('Delete only this question from its saved bank?')) void dropQuestions([side], 'Question deleted'); }}
                      className="mt-1 inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-rose-400 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50"
                      aria-label="Delete this question"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete this one
                    </button>
                  </div>
                ))}
              </div>
            ))}
            {duplicates.length > 30 && <div className="text-[10px] font-semibold text-slate-500">Showing 30 of {duplicates.length}.</div>}
          </div>
        </section>
      )}

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:border-rose-400/50 dark:bg-rose-950/50 dark:text-rose-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="mb-3 flex items-start gap-2 rounded-2xl border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900 dark:border-teal-400/50 dark:bg-teal-950/40 dark:text-teal-100">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {modules === null && (
        <div className="mb-3 flex min-h-[54px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading saved banks…
        </div>
      )}

      {modules && modules.length === 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No saved question banks yet. You have not built one in the Practice Builder. Build a module there and it will show up here.</span>
        </div>
      )}

      <div className="space-y-2">
        {(modules ?? []).map((m) => {
          const done = m.count > 0 && m.answered >= m.count;
          const pct = m.count ? Math.round((m.answered / m.count) * 100) : 0;
          const status = done ? 'Completed' : m.answered > 0 ? `${m.answered}/${m.count} answered` : 'Not started';
          return (
            <div key={m.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{m.title}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    {EXAM_LABEL[m.exam] ?? m.exam} · {m.count} questions · {m.mode === 'EXAM' ? 'Exam mode' : 'Tutor mode'} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="h-2.5 w-40 max-w-full rounded-full border border-slate-200 bg-transparent p-[1px]" aria-hidden="true">
                      <div className="h-full rounded-full bg-[#0f8b8d] transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`inline-flex min-h-[22px] items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : m.answered > 0 ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                      {status}
                    </span>
                    {m.answered > 0 && (
                      <span className="text-[10px] font-semibold text-slate-600">{m.correct} correct</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resume(m.id)}
                    disabled={busyId === m.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[16px] bg-[#0f8b8d] px-4 py-2.5 text-xs font-medium text-white transition hover:bg-[#00696b] hover:-translate-y-[3px] hover:scale-[1.03] hover:disabled:translate-y-0 disabled:scale-100 disabled:opacity-60 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-[#8ff3f4] dark:focus-visible:ring-offset-[#262D59]"
                    aria-label={busyId === m.id ? 'Opening saved question bank' : `${done ? 'Review' : m.answered > 0 ? 'Continue' : 'Start'} ${m.title}`}
                  >
                    {busyId === m.id ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</>
                    ) : (
                      <><Play className="h-4 w-4" /> {done ? 'Review' : m.answered > 0 ? 'Continue' : 'Start'}</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    title="Delete this saved question bank"
                    aria-label="Delete this saved question bank"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-rose-500 bg-rose-50 text-rose-700 transition hover:-translate-y-0.5 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:border-rose-400/80 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-900/50 dark:focus-visible:ring-rose-400 dark:focus-visible:ring-offset-[#262D59]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
