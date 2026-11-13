// Generated question banks, grouped by category (the subject each question was generated for).
// Every generated question is already saved with its exam (examId) and category (subjectId, the
// slug of its subject) when it is created; this panel shows those groups, so earlier generations
// can be found and reviewed by category.
import React, { useEffect, useMemo, useState } from 'react';
import { Layers, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { listQuestions, type QuestionRecord } from '../utils/questionBankStorage.ts';

const EXAM_LABEL: Record<string, string> = { NEET_PG: 'NEET-PG', INI_CET: 'INI-CET' };

/** "adult-health-medicine" -> "Adult Health Medicine". The slug is the stored category id. */
const categoryName = (categoryId: string) =>
  categoryId.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Uncategorised';

interface Category {
  id: string;
  name: string;
  total: number;
  byExam: Record<string, number>;
  bySubtopic: Record<string, QuestionRecord[]>;
}

export const GeneratedBanksPanel: React.FC = () => {
  const [rows, setRows] = useState<QuestionRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listQuestions()
      .then(setRows)
      .catch((err: any) => setError(err?.message || 'Could not read the generated questions.'));
  };
  useEffect(load, []);

  const categories = useMemo<Category[]>(() => {
    const byId = new Map<string, Category>();
    for (const q of rows ?? []) {
      const id = q.subjectId || 'uncategorised';
      let cat = byId.get(id);
      if (!cat) {
        cat = { id, name: categoryName(id), total: 0, byExam: {}, bySubtopic: {} };
        byId.set(id, cat);
      }
      cat.total += 1;
      cat.byExam[q.examId] = (cat.byExam[q.examId] || 0) + 1;
      const sub = q.subtopicId || 'general';
      (cat.bySubtopic[sub] ||= []).push(q);
    }
    return [...byId.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const totalQuestions = rows?.length ?? 0;

  // Global NEET-PG / INI-CET split, derived only from rows that have actually loaded.
  const examSplit = useMemo<Array<[string, number]>>(() => {
    const counts: Record<string, number> = {};
    for (const q of rows ?? []) counts[q.examId] = (counts[q.examId] || 0) + 1;
    return Object.entries(counts);
  }, [rows]);

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm ring-[#0f8b8d]/15   p-4 ring-[3px]  ring-offset-0   dark:bg-slate-900 dark:border-slate-700 sm:p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.10] dark:opacity-[0.08]"
        style={{
          backgroundImage: 'radial-gradient(#0f172a 1px, transparent 1px)',
          backgroundSize: '8px 8px',
          maskImage: 'radial-gradient(ellipse at 50% 45%, transparent 0%, transparent 55%, #000 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 45%, transparent 0%, transparent 55%, #000 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05] motion-reduce:hidden"
        style={{
          backgroundImage: 'repeating-linear-gradient(115deg, #0f172a 0 1px, transparent 1px 14px)',
          maskImage: 'radial-gradient(ellipse at 50% 40%, transparent 0%, transparent 60%, #000 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 40%, transparent 0%, transparent 60%, #000 100%)',
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900  ">
            <Layers className="h-4 w-4 shrink-0 text-[#0f8b8d] " />
            <span className="min-w-0 break-words">Generated question banks by category</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-baseline gap-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700   px-2.5 py-0.5 text-[11px] font-medium  ">
              <span className=" text-sm leading-none">{totalQuestions}</span>
              generated question{totalQuestions === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-baseline gap-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700   px-2.5 py-0.5 text-[11px] font-medium    ">
              <span className=" text-sm leading-none">{categories.length}</span>
              categor{categories.length === 1 ? 'y' : 'ies'}
            </span>
            {examSplit.map(([exam, n]) => (
              <span
                key={exam}
                className="inline-flex items-baseline gap-1 rounded-full border border-teal-200 bg-teal-50 text-[#00696b]   px-2.5 py-0.5 text-[11px] font-medium    "
              >
                {EXAM_LABEL[exam] ?? exam}
                <span className=" text-sm leading-none">{n}</span>
              </span>
            ))}
          </div>

          <p className="mt-2 text-[11px] text-slate-500  ">
            Each question is filed under the subject it was generated for.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-slate-200 bg-white text-slate-700 hover:border-[#0f8b8d]/40   px-3.5 py-2 text-xs font-medium  transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0    dark:focus-visible:"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {rows === null && !error && (
        <div className="relative space-y-2.5" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading generated question banks…</span>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-[16px] border border-slate-200 bg-white   p-4 motion-reduce:animate-none  "
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="h-4 w-2/5 min-w-[120px] rounded-full bg-slate-200  " />
                <div className="flex gap-1.5">
                  <div className="h-5 w-20 rounded-full bg-slate-200  " />
                  <div className="h-5 w-14 rounded-full bg-slate-200  " />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="relative flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 ring-rose-200   px-3.5 py-3 text-xs font-semibold  ring-1   "
        >
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-2xl border border-rose-200 text-rose-700  bg-transparent px-3 py-1.5 text-xs font-medium transition-colors  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {rows && categories.length === 0 && (
        <div className="relative rounded-[16px] border border-dashed border-slate-300 text-slate-500   px-4 py-6 text-center  ">
          <div className=" text-lg leading-none text-slate-900  ">
            No banks yet
          </div>
          <p className="mx-auto mt-2 max-w-sm text-xs text-slate-500  ">
            No generated questions yet. Build a module in the Practice Builder and it will appear here.
          </p>
        </div>
      )}

      <div className="relative space-y-2.5">
        {categories.map((cat) => {
          const expanded = open === cat.id;
          return (
            <div
              key={cat.id}
              className={`rounded-[16px] border transition-shadow duration-200 motion-reduce:transition-none ${
                expanded
                  ? '  border-[#0f8b8d]/40 bg-white shadow-sm dark:'
                  : '  border-slate-200 bg-white dark:'
              }`}
            >
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : cat.id)}
                aria-expanded={expanded}
                aria-controls={`generated-banks-${cat.id}`}
                className={`flex min-h-[44px] w-full flex-wrap items-center justify-between gap-2 rounded-[16px] px-3.5 py-3 text-left transition-transform duration-200 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:dark:focus-visible: sm:px-4 ${
                  expanded
                    ? 'bg-teal-50/60 text-[#00696b]'
                    : 'bg-transparent  '
                }`}
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-900  ">
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500  transition-transform duration-200 motion-reduce:transition-none" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500  transition-transform duration-200 motion-reduce:transition-none" />
                  )}
                  <span className="min-w-0 break-words">{cat.name}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                  <span className="rounded-full border border-slate-200 bg-slate-100 text-slate-700   px-2 py-0.5  ">
                    <span className=" text-[13px] leading-none">{cat.total}</span> questions
                  </span>
                  {Object.entries(cat.byExam).map(([exam, n]) => (
                    <span
                      key={exam}
                      className="rounded-full border border-teal-200 bg-teal-50 text-[#00696b]   px-2 py-0.5    "
                    >
                      {EXAM_LABEL[exam] ?? exam}: <span className=" text-[13px] leading-none">{n}</span>
                    </span>
                  ))}
                </span>
              </button>

              {expanded && (
                <div
                  id={`generated-banks-${cat.id}`}
                  className="space-y-2.5 border-t-2 border-slate-100  px-3 pb-4 pt-3  sm:px-4"
                >
                  {Object.entries(cat.bySubtopic).sort((a, b) => b[1].length - a[1].length).map(([sub, items]) => (
                    <div
                      key={sub}
                      className="rounded-xl border border-slate-200 bg-white   px-2.5 py-2.5   sm:px-3"
                    >
                      <div className="mb-1.5 flex flex-wrap items-baseline gap-1.5 text-[11px] text-slate-700 font-medium  ">
                        <span className="min-w-0 break-words">{sub.replace(/-/g, ' ')}</span>
                        <span className="rounded-full border border-slate-200 bg-slate-100 text-slate-600  px-1.5 py-px text-[10px] font-medium   ">
                          {items.length}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {items.slice(0, 50).map((q) => (
                          <li
                            key={q.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 text-slate-700   px-2 py-1.5 text-[11px] leading-snug    "
                          >
                            <span className="mr-1.5 inline-block rounded border border-slate-200 text-slate-500  px-1 font-mono text-[10px]   ">
                              {EXAM_LABEL[q.examId] ?? q.examId}
                            </span>
                            {(q.stem || q.questionText || '').replace(/\s+/g, ' ').slice(0, 220)}
                            {(q.stem || q.questionText || '').length > 220 ? '…' : ''}
                            <span className="ml-1.5 inline-block rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700   px-1.5 font-medium    ">
                              Key {q.correctOption}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {items.length > 50 && (
                        <div className="mt-1 text-[10px] text-slate-400  ">
                          Showing 50 of {items.length}.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
