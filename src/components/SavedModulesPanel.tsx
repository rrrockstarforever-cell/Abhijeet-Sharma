// Saved question banks: every generated module, kept whole, so it can be finished later.
// Resuming reopens the same questions in the Test Runner, which restores the answers and position.
import React, { useEffect, useState } from 'react';
import { BookOpen, Play, Trash2, RefreshCw, Copy, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { cleanQuestions } from '../lib/questionCleanup.ts';
import type { ClinicalQuestion, ExamType } from '../types.ts';
import {
  listModules, getModule, deleteModule, backfillModulesFromSessions, MODULES_CHANGED, type ModuleSummary,
  storedQuestions, findDuplicates,
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
    <div className="relative overflow-hidden rounded-[20px] border   p-5    ">
      <div className="absolute inset-x-0 top-0 h-[3px]  " />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b  pb-4 ">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl  px-4 py-3 ">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 dark:" />
          <div className="relative">
            <div className="flex items-center gap-2 text-base font-medium  ">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border      ">
                <BookOpen className="h-5 w-5" />
              </span>
              <span className="truncate">Saved question banks</span>
            </div>
            <div className="mt-1 max-w-xl text-sm leading-relaxed  ">
              Every generated bank is kept as it was. Resume to continue where you stopped.
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={findRepeats}
            className="flex min-h-[44px] items-center gap-2 rounded-2xl border   px-3 py-2 text-xs font-medium  transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0]     dark:focus-visible: dark:focus-visible:ring-offset-[#262D59]"
            aria-label="Find duplicate saved questions"
          >
            <Copy className="h-4 w-4" /> Find duplicates
          </button>
          <button
            type="button"
            onClick={load}
            className="flex min-h-[44px] items-center gap-2 rounded-2xl border   px-3 py-2 text-xs font-medium  transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0]     dark:focus-visible: dark:focus-visible:ring-offset-[#262D59]"
            aria-label="Refresh saved question banks"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {duplicates && (
        <section className="relative mb-4 overflow-hidden rounded-[18px] border  bg-white    ">
          <div className="relative overflow-hidden border-b-2   px-3 py-2  ">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-50 dark:" />
            <div className="relative flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg border   px-2 py-0.5 text-sm font-medium uppercase tracking-wide  " style={{ fontFamily: ', system-ui, sans-serif' }}>
                  DUPES!
                </span>
                <span className="text-xs font-medium  ">
                  {duplicates.length === 0 ? 'No repeated questions found.' : `${duplicates.length} repeated pair${duplicates.length === 1 ? '' : 's'} found`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDuplicates(null)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border  bg-white px-2 py-1 text-[11px] font-medium  transition  focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0]     dark:focus-visible: dark:focus-visible:ring-offset-[#262D59]"
                aria-label="Close duplicate results"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
            {duplicates.slice(0, 30).map((d, i) => (
              <div key={i} className={`rounded-xl border p-2 text-[11px] leading-relaxed ${d.sameAnswer ? '   ' : 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/60 dark:bg-rose-950/50 dark:text-rose-50'}`}>
                <div className={`mb-1 font-medium ${d.sameAnswer ? ' ' : 'text-rose-800 dark:text-rose-100'}`}>
                  {d.sameAnswer ? 'Same question, same answer' : 'Same question, DIFFERENT answers'} · {Math.round(d.similarity * 100)}% overlap
                </div>
                {[d.a, d.b].map((side, k) => (
                  <div key={k} className="mb-1">
                    <div className=" ">{(side.question.stem || side.question.questionText || '').slice(0, 160)}</div>
                    <div className=" ">
                      From <span className="font-semibold">{side.source}</span> · Key {side.question.correctOption}: {side.question.options.find((o) => o.id === side.question.correctOption)?.text ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {duplicates.length > 30 && <div className="text-[10px] font-semibold  ">Showing 30 of {duplicates.length}.</div>}
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
        <div className="mb-3 flex min-h-[54px] items-center gap-2 rounded-2xl border  bg-white px-3 py-2 text-xs font-semibold    ">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading saved banks…
        </div>
      )}

      {modules && modules.length === 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-2xl border border-dashed  bg-white px-4 py-3 text-sm    ">
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
            <div key={m.id} className="rounded-2xl border  bg-white p-3  ">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium  ">{m.title}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed  ">
                    {EXAM_LABEL[m.exam] ?? m.exam} · {m.count} questions · {m.mode === 'EXAM' ? 'Exam mode' : 'Tutor mode'} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="h-2.5 w-40 max-w-full rounded-full border  bg-transparent p-[1px] " aria-hidden="true">
                      <div className="h-full rounded-full  transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`inline-flex min-h-[22px] items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${done ? '  ' : m.answered > 0 ? '  ' : '     '}`}>
                      {status}
                    </span>
                    {m.answered > 0 && (
                      <span className="text-[10px] font-semibold  ">{m.correct} correct</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resume(m.id)}
                    disabled={busyId === m.id}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[16px] px-4 py-2.5 text-xs font-medium  transition hover:-translate-y-[3px] hover:scale-[1.03] hover:disabled:translate-y-0 disabled:scale-100 disabled:opacity-60 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:focus-visible: dark:focus-visible:ring-offset-[#262D59]"
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
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-rose-500 bg-rose-50 text-rose-700 transition hover:-translate-y-0.5 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF3E0] dark:border-rose-400/80 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-900/50 dark:focus-visible: dark:focus-visible:ring-offset-[#262D59]"
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
