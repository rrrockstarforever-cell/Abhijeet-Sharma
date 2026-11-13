import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ClipboardCheck, GraduationCap, Sparkles, TrendingDown } from 'lucide-react';
import type { AppView } from '../types.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';
import { lessonMessage, listReviews, weakAcrossTests, weakTopics, type ReviewRecord } from '../lib/testReview.ts';
import { setTutorSeed } from '../lib/tutorSeed.ts';
import { TestCoachPanel } from './TestCoachPanel.tsx';
import { TeachMeModal } from './TeachMeModal.tsx';

interface Props {
  onNavigate: (view: AppView, targetId?: string) => void;
  darkMode?: boolean;
}

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const TestReviewsView: React.FC<Props> = ({ onNavigate, darkMode = false }) => {
  const [reviews, setReviews] = useState<ReviewRecord[]>(() => listReviews());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => subscribeDataChanged(() => setReviews(listReviews())), []);

  const weak = useMemo(() => weakAcrossTests(reviews), [reviews]);
  const open = reviews.find((r) => r.id === openId) ?? null;

  const [teaching, setTeaching] = useState<typeof weak | null>(null);
  const teach = (topics: typeof weak) => setTeaching(topics);

  const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900';
  const muted = 'text-slate-600 dark:text-slate-400';

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[#0f8b8d]"><ClipboardCheck className="h-5 w-5" /> Test reviews</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">Every test you have submitted</h1>
        <p className={`mt-1 text-sm ${muted}`}>Each review is kept on this computer. Open one again any time, or let the tutor teach your weak topics.</p>
      </div>

      {reviews.length === 0 ? (
        <div className={`${card} text-center`}>
          <GraduationCap className="mx-auto h-8 w-8 text-[#0f8b8d]" />
          <p className="mt-2 font-semibold text-slate-900 dark:text-white">No reviews yet</p>
          <p className={`mt-1 text-sm ${muted}`}>Submit a test and its performance review will appear here.</p>
          <button onClick={() => onNavigate('practice')} className="mt-3 rounded-lg bg-[#0f8b8d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b6b6d]">Start a practice set</button>
        </div>
      ) : (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><TrendingDown className="h-4 w-4 text-rose-500" /> Weakest topics across all your tests</h2>
              {weak.length > 0 && (
                <button onClick={() => teach(weak)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f8b8d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0b6b6d]"><Sparkles className="h-3.5 w-3.5" /> Teach me these</button>
              )}
            </div>
            {weak.length === 0 ? (
              <p className={`mt-2 text-sm ${muted}`}>No topic is below 60% over your tests so far.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {weak.map((s) => (
                  <li key={s.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{s.topic}</div>
                        <div className={`text-xs ${muted}`}>{s.subject} · {s.total - s.wrong - s.skipped} of {s.total} right</div>
                      </div>
                      <button onClick={() => teach([s])} className="shrink-0 rounded-lg border border-[#0f8b8d] px-2 py-1 text-xs font-semibold text-[#0f8b8d] hover:bg-[#0f8b8d] hover:text-white">Teach me</button>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full bg-rose-500" style={{ width: `${Math.max(4, s.accuracy)}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            {reviews.map((r) => {
              const pct = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
              const w = weakTopics(r.topics, 3);
              return (
                <button key={r.id} onClick={() => setOpenId(r.id)} className={`${card} flex w-full items-center justify-between gap-3 p-4 text-left transition hover:border-[#0f8b8d]`}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{r.correct} of {r.total} correct <span className={`font-normal ${muted}`}>({pct}% of attempted)</span></div>
                    <div className={`text-xs ${muted}`}>{when(r.at)} · {r.exam.replace('_', '-')}</div>
                    {w.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{w.map((s) => <span key={s.key} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{s.topic}</span>)}</div>}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              );
            })}
          </section>
        </>
      )}

      {teaching && <TeachMeModal topics={teaching} onClose={() => setTeaching(null)} onAskTutor={() => { setTutorSeed(lessonMessage(teaching)); onNavigate('ai-tutor'); }} />}
      {open && <TestCoachPanel review={open} darkMode={darkMode} onClose={() => setOpenId(null)} onTeach={() => { setOpenId(null); onNavigate('ai-tutor'); }} />}
    </div>
  );
};
