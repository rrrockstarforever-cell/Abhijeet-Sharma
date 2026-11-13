import React, { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Sparkles, X, Loader2, TrendingDown, CheckCircle2 } from 'lucide-react';
import { aiComplete, extractJson, getActiveProvider, getEffectiveModel } from '../lib/ai.ts';
import { setTutorSeed } from '../lib/tutorSeed.ts';
import { playReward } from '../lib/sounds.ts';
import { TeachMeModal } from './TeachMeModal.tsx';
import { WEAK_BELOW, lessonMessage, saveAdvice, weakTopics, type ReviewAdvice, type ReviewRecord, type TopicStat } from '../lib/testReview.ts';

interface Props {
  review: ReviewRecord;
  darkMode: boolean;
  /** True right after a test is submitted: the reward sound plays once. */
  celebrate?: boolean;
  onClose: () => void;
  /** Opens the Clinical AI Tutor (the lesson message is handed over first). */
  onTeach: () => void;
}

export const TestCoachPanel: React.FC<Props> = ({ review, darkMode, celebrate, onClose, onTeach }) => {
  useEffect(() => { if (celebrate && review.xp) playReward(); }, []);
  const stats = review.topics;
  const { answered, correct, total } = review;
  const overall = answered ? Math.round((correct / answered) * 100) : 0;
  const weak = useMemo(() => weakTopics(stats), [stats]);
  const strong = useMemo(() => stats.filter((s) => s.accuracy >= 80).sort((a, b) => b.accuracy - a.accuracy).slice(0, 4), [stats]);

  const [advice, setAdvice] = useState<ReviewAdvice | null>(review.advice ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');

  useEffect(() => {
    setAdvice(review.advice ?? null);
    const provider = getActiveProvider();
    // An opened review keeps the advice it was given before; only a review without any asks the AI.
    if (review.advice || !provider || !weak.length) return;
    let live = true;
    setState('loading');
    const lines = weak.map((s) => `${s.key}: ${s.total - s.wrong - s.skipped}/${s.total} right. Missed facts: ${s.missedFacts.join(' | ') || 'none recorded'}`).join('\n');
    aiComplete({
      system: 'You are a kind, direct exam coach for a medical PG entrance candidate. Reply with ONLY JSON: {"summary":"2 short sentences on how the test went and the main pattern","topics":{"<topic key exactly as given>":"one short sentence on what to fix in that topic"}}. Plain words, no jargon, no praise padding.',
      messages: [{ role: 'user', content: `Overall: ${correct}/${answered} correct (${overall}%), ${total - answered} skipped.\nWeak topics:\n${lines}` }],
      json: true,
      effort: 'low',
      purpose: 'coach',
      provider,
      model: getEffectiveModel(provider),
    }).then((raw) => {
      if (!live) return;
      const parsed = extractJson<{ summary?: string; topics?: Record<string, string> }>(raw);
      if (parsed?.summary) {
        const got = { summary: String(parsed.summary), topics: parsed.topics ?? {} };
        setAdvice(got);
        saveAdvice(review.id, got);
        setState('idle');
      } else setState('failed');
    }).catch(() => { if (live) setState('failed'); });
    return () => { live = false; };
  }, [review.id]);

  const [teaching, setTeaching] = useState<TopicStat[] | null>(null);
  const teach = (list: TopicStat[]) => setTeaching(list);

  const card = darkMode ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900';
  const sub = darkMode ? 'text-slate-400' : 'text-slate-600';
  const bar = (pct: number) => (pct >= 80 ? 'bg-emerald-500' : pct >= WEAK_BELOW ? 'bg-amber-500' : 'bg-rose-500');

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Performance review">
      <div className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-5 shadow-2xl ${card}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0f8b8d]"><GraduationCap className="h-5 w-5" /> Your performance review</div>
            <div className="mt-1 text-2xl font-semibold">{correct} of {total} correct <span className={`text-base font-normal ${sub}`}>({answered ? `${overall}% of attempted` : 'nothing attempted'})</span></div>
          </div>
          <button onClick={onClose} className={`rounded-lg p-2 ${darkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`} aria-label="Close review"><X className="h-5 w-5" /></button>
        </div>

        {!!review.xp && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-teal-500/15 px-3 py-1 text-[#0f8b8d] dark:text-teal-300">+{review.xp} XP earned</span>
            {review.leveledUp && <span className="rounded-full bg-amber-400 px-3 py-1 text-amber-950">Level up!</span>}
            {(review.newBadges ?? []).map((b) => <span key={b} className="rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Badge: {b}</span>)}
          </div>
        )}
        <div className={`mt-3 rounded-xl border p-3 text-sm ${darkMode ? 'border-slate-700 bg-slate-800/60' : 'border-teal-100 bg-teal-50'}`}>
          {state === 'loading' && <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading your answers…</span>}
          {advice && <p>{advice.summary}</p>}
          {!advice && state !== 'loading' && (
            <p>{weak.length ? `You are weakest in ${weak.slice(0, 3).map((s) => s.topic).join(', ')}.` : 'No weak topic stood out in this test.'}{state === 'failed' ? ' (The AI coach could not be reached, so this is a plain count.)' : ''}</p>
          )}
        </div>

        {weak.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-5 w-5" /> Every topic is at {WEAK_BELOW}% or above. Try a harder set next.</div>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><TrendingDown className="h-4 w-4 text-rose-500" /> Weak topics</h3>
              <button onClick={() => teach(weak)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f8b8d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0b6b6d]">
                <Sparkles className="h-3.5 w-3.5" /> Teach me all of these
              </button>
            </div>
            <ul className="mt-2 space-y-2">
              {weak.map((s) => (
                <li key={s.key} className={`rounded-xl border p-3 ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{s.topic}</div>
                      <div className={`text-xs ${sub}`}>{s.subject}{s.subject ? ' · ' : ''}{s.total - s.wrong - s.skipped} of {s.total} right{s.skipped ? `, ${s.skipped} skipped` : ''}</div>
                    </div>
                    <button onClick={() => teach([s])} className="shrink-0 rounded-lg border border-[#0f8b8d] px-2.5 py-1 text-xs font-semibold text-[#0f8b8d] hover:bg-[#0f8b8d] hover:text-white">Teach me</button>
                  </div>
                  <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}><div className={`h-full ${bar(s.accuracy)}`} style={{ width: `${Math.max(4, s.accuracy)}%` }} /></div>
                  {advice?.topics?.[s.key] && <p className={`mt-2 text-xs ${sub}`}>{advice.topics[s.key]}</p>}
                </li>
              ))}
            </ul>
          </>
        )}

        {strong.length > 0 && (
          <p className={`mt-4 text-xs ${sub}`}>Going well: {strong.map((s) => `${s.topic} (${s.accuracy}%)`).join(', ')}.</p>
        )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${darkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}`}>Review my answers</button>
        </div>
      </div>
    </div>
    {teaching && <TeachMeModal topics={teaching} onClose={() => setTeaching(null)} onAskTutor={() => { setTutorSeed(lessonMessage(teaching)); onTeach(); }} />}
    </>
  );
};
