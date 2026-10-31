// Generated question banks, grouped by category (the subject each question was generated for).
// Every generated question is already saved with its exam (examId) and category (subjectId, the
// slug of its subject) when it is created; this panel shows those groups, so earlier generations
// can be found and reviewed by category.
import React, { useEffect, useMemo, useState } from 'react';
import { Layers, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { listQuestions, type QuestionRecord } from '../utils/questionBankStorage.ts';

const EXAM_LABEL: Record<string, string> = { NEET_PG: 'NEET-PG', INI_CET: 'INI-CET', AMC_CAT: 'AMC CAT' };

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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#0f8b8d]" /> Generated question banks by category
          </div>
          <div className="text-[11px] text-slate-500">
            {totalQuestions} generated question{totalQuestions === 1 ? '' : 's'} in {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}.
            Each question is filed under the subject it was generated for.
          </div>
        </div>
        <button onClick={load} className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {rows && categories.length === 0 && (
        <div className="text-xs text-slate-500">No generated questions yet. Build a module in the Practice Builder and it will appear here.</div>
      )}

      <div className="space-y-2">
        {categories.map((cat) => {
          const expanded = open === cat.id;
          return (
            <div key={cat.id} className="rounded-xl border border-slate-200">
              <button
                onClick={() => setOpen(expanded ? null : cat.id)}
                className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 rounded-xl"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  {cat.name}
                </span>
                <span className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{cat.total} questions</span>
                  {Object.entries(cat.byExam).map(([exam, n]) => (
                    <span key={exam} className="px-2 py-0.5 rounded-full bg-teal-50 text-[#00696b]">{EXAM_LABEL[exam] ?? exam}: {n}</span>
                  ))}
                </span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
                  {Object.entries(cat.bySubtopic).sort((a, b) => b[1].length - a[1].length).map(([sub, items]) => (
                    <div key={sub} className="pt-3">
                      <div className="text-[11px] font-bold text-slate-700 mb-1.5">
                        {sub.replace(/-/g, ' ')} <span className="font-normal text-slate-400">({items.length})</span>
                      </div>
                      <ul className="space-y-1.5">
                        {items.slice(0, 50).map((q) => (
                          <li key={q.id} className="text-[11px] text-slate-700 leading-snug">
                            <span className="font-mono text-[10px] text-slate-400 mr-1.5">{EXAM_LABEL[q.examId] ?? q.examId}</span>
                            {(q.stem || q.questionText || '').replace(/\s+/g, ' ').slice(0, 220)}
                            {(q.stem || q.questionText || '').length > 220 ? '…' : ''}
                            <span className="ml-1.5 font-bold text-emerald-700">Key {q.correctOption}</span>
                          </li>
                        ))}
                      </ul>
                      {items.length > 50 && <div className="text-[10px] text-slate-400 mt-1">Showing 50 of {items.length}.</div>}
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
