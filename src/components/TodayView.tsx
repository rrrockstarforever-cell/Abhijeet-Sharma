import React, { useEffect, useMemo, useState } from 'react';
import { Award, Check, Flame, Lock, RefreshCw, Snowflake, Sparkles, TrendingDown, Trophy } from 'lucide-react';
import type { AppView, ExamType } from '../types.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';
import { getTodayProgress } from '../utils/studyPlanStore.ts';
import { getBadges, getMission, getStreak, getXp, weekActivity } from '../utils/gameStore.ts';
import { lessonMessage, listReviews, weakAcrossTests } from '../lib/testReview.ts';
import { setTutorSeed } from '../lib/tutorSeed.ts';
import { TeachMeModal } from './TeachMeModal.tsx';
import type { TopicStat } from '../lib/testReview.ts';

interface Props {
  exam: ExamType;
  onNavigate: (view: AppView, targetId?: string) => void;
}

const greeting = (): string => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const TodayView: React.FC<Props> = ({ exam, onNavigate }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeDataChanged(() => setTick((n) => n + 1)), []);

  const mission = useMemo(() => getMission(exam), [exam, tick]);
  const streak = useMemo(() => getStreak(), [tick]);
  const level = useMemo(() => getXp(), [tick]);
  const badges = useMemo(() => getBadges(), [tick]);
  const week = useMemo(() => weekActivity(), [tick]);
  const due = useMemo(() => getTodayProgress(exam).reviewsDue, [exam, tick]);
  const weak = useMemo(() => weakAcrossTests(listReviews(), 3), [tick]);

  const maxWeek = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((n, d) => n + d.count, 0);
  const ring = 2 * Math.PI * 56;
  const done = mission.doneCount;

  const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900';
  const muted = 'text-slate-600 dark:text-slate-400';
  const title = 'text-slate-900 dark:text-white';

  const [teaching, setTeaching] = useState<TopicStat[] | null>(null);
  const teachWeak = () => {
    if (weak.length) setTeaching(weak.slice(0, 1));
    else onNavigate('ai-tutor');
  };
  const goTask = (id: string) => {
    if (id === 'questions') onNavigate('practice');
    else if (id === 'review') onNavigate('mistakes');
    else teachWeak();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className={`text-sm ${muted}`}>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className={`mt-1 text-3xl font-semibold tracking-tight ${title}`}>
            {greeting()}. {done === 3 ? 'Mission complete.' : `${done} of 3 done today.`}
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Flame className="h-4 w-4 text-amber-500" />
          {streak.current}-day streak
          <span className="font-normal text-amber-800/80 dark:text-amber-200/70">· {streak.freezes} freeze{streak.freezes === 1 ? '' : 's'} saved</span>
        </div>
      </header>

      <section className="grid gap-5 lg:grid-cols-3">
        {/* Mission */}
        <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-6 shadow-sm dark:border-teal-900/60 dark:from-[#0e2a3a] dark:to-[#0b1f33] lg:col-span-2">
          <div className="flex flex-wrap items-center gap-6">
            <div className="relative h-[132px] w-[132px] shrink-0">
              <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={`${done} of 3 missions done`}>
                <circle cx="66" cy="66" r="56" fill="none" strokeWidth="12" className="stroke-teal-100 dark:stroke-[#1b3550]" />
                <circle cx="66" cy="66" r="56" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-[#0f8b8d] dark:stroke-teal-300" strokeDasharray={`${(ring * done) / 3} ${ring}`} transform="rotate(-90 66 66)" style={{ transition: 'stroke-dasharray .6s ease' }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className={`text-3xl font-bold ${title}`}>{done}/3</div>
                <div className={`text-xs ${muted}`}>today</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 basis-72">
              <div className="text-xs font-semibold tracking-widest text-[#0f8b8d] dark:text-teal-300">TODAY'S MISSION</div>
              <ul className="mt-3 space-y-2.5">
                {mission.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${t.done ? 'bg-emerald-500 text-white' : 'border-2 border-[#0f8b8d] dark:border-teal-300'}`}>
                      {t.done && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
                    </span>
                    <button onClick={() => goTask(t.id)} className={`min-h-[32px] min-w-0 flex-1 text-left text-sm ${t.done ? `line-through ${muted}` : `font-semibold ${title} hover:underline`}`}>
                      {t.title} <span className={`font-normal ${muted}`}>· {t.progress}</span>
                    </button>
                    <span className={`shrink-0 text-xs font-semibold ${t.done ? muted : 'text-[#0f8b8d] dark:text-teal-300'}`}>+{t.xp} XP</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => onNavigate('practice')} className="min-h-[44px] rounded-xl bg-[#0f8b8d] px-5 text-sm font-semibold text-white hover:bg-[#0b6b6d]">Start practice</button>
                <button onClick={teachWeak} className="min-h-[44px] rounded-xl border border-[#0f8b8d] px-5 text-sm font-semibold text-[#0f8b8d] hover:bg-[#0f8b8d] hover:text-white dark:border-teal-300 dark:text-teal-300">
                  <Sparkles className="mr-1.5 inline h-4 w-4" />{weak.length ? `Teach me ${weak[0].topic}` : 'Ask the tutor'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Level */}
        <div className={card}>
          <div className={`flex items-center gap-2 text-xs font-semibold tracking-widest ${muted}`}><Trophy className="h-4 w-4" /> LEVEL</div>
          <div className="mt-2 flex items-baseline gap-2"><span className={`text-4xl font-bold ${title}`}>{level.level}</span><span className={`text-base ${muted}`}>{level.name}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-gradient-to-r from-[#0f8b8d] to-teal-300" style={{ width: `${Math.max(3, level.pct)}%`, transition: 'width .6s ease' }} /></div>
          <div className={`mt-2 text-xs ${muted}`}>{level.into} / {level.need} XP to level {level.level + 1}</div>
          <div className={`mt-4 text-xs leading-relaxed ${muted}`}>10 XP for each right answer, 20 for finishing a test, 50 for a perfect set and 50 for a lesson with the tutor.</div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        {/* Streak */}
        <div className={card}>
          <div className="flex items-center justify-between"><div className={`flex items-center gap-2 text-xs font-semibold tracking-widest ${muted}`}><Flame className="h-4 w-4" /> STREAK</div><div className="text-xs text-amber-600 dark:text-amber-300">Longest: {streak.longest}</div></div>
          <div className="mt-2 flex items-baseline gap-2"><span className={`text-5xl font-bold leading-none ${title}`}>{streak.current}</span><span className={`text-sm ${muted}`}>days in a row</span></div>
          <div className="mt-4 flex gap-2">
            {streak.days.map((d) => (
              <div key={d.key} className="flex-1 text-center">
                <div className={`flex h-9 items-center justify-center rounded-lg text-[10px] font-semibold ${d.state === 'done' ? 'bg-amber-400 text-amber-950' : d.state === 'frozen' ? 'bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100' : d.state === 'today' ? 'border-2 border-dashed border-[#0f8b8d] dark:border-teal-300' : 'bg-slate-200 dark:bg-slate-800'}`}>
                  {d.state === 'frozen' && <Snowflake className="h-4 w-4" />}
                </div>
                <div className={`mt-1 text-[10px] ${d.state === 'today' ? 'font-semibold text-[#0f8b8d] dark:text-teal-300' : muted}`}>{d.label}</div>
              </div>
            ))}
          </div>
          <div className={`mt-3 text-xs leading-relaxed ${muted}`}>A missed day uses a freeze, so one bad day does not erase your run. You earn a freeze for every 7 days in a row.</div>
        </div>

        {/* Due reviews */}
        <div className={card}>
          <div className="flex items-center justify-between"><div className={`flex items-center gap-2 text-xs font-semibold tracking-widest ${muted}`}><RefreshCw className="h-4 w-4" /> DUE FOR REVIEW</div></div>
          <div className="mt-2 flex items-baseline gap-2"><span className={`text-5xl font-bold leading-none ${title}`}>{due}</span><span className={`text-sm ${muted}`}>{due === 1 ? 'card' : 'cards'}{due > 0 ? `, about ${Math.max(1, Math.ceil(due / 3))} min` : ''}</span></div>
          <p className={`mt-3 text-sm ${muted}`}>{due > 0 ? 'A short review now keeps what you learned from fading.' : 'Nothing is waiting. Add questions you got wrong to your review deck.'}</p>
          <button onClick={() => onNavigate('mistakes')} className="mt-4 min-h-[44px] w-full rounded-xl bg-[#0f8b8d] text-sm font-semibold text-white hover:bg-[#0b6b6d]">{due > 0 ? 'Start the review' : 'Open spaced review'}</button>
        </div>

        {/* Weak topics */}
        <div className={card}>
          <div className={`flex items-center gap-2 text-xs font-semibold tracking-widest ${muted}`}><TrendingDown className="h-4 w-4" /> WEAK TOPICS</div>
          {weak.length === 0 ? (
            <p className={`mt-3 text-sm ${muted}`}>Submit a test and your weakest topics will appear here, with a Teach me button for each.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {weak.map((s) => (
                <li key={s.key}>
                  <div className="flex items-center justify-between text-sm"><span className={`font-semibold ${title}`}>{s.topic}</span><span className="font-semibold text-rose-500">{s.accuracy}%</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.max(4, s.accuracy)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => onNavigate('reviews')} className={`mt-4 text-xs font-semibold text-[#0f8b8d] hover:underline dark:text-teal-300`}>Open all test reviews</button>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className={`${card} lg:col-span-1`}>
          <div className="flex items-center justify-between"><div className={`text-xs font-semibold tracking-widest ${muted}`}>THIS WEEK</div><div className={`text-xs ${muted}`}>{weekTotal} questions</div></div>
          <div className="mt-4 flex h-28 items-end gap-2">
            {week.map((d, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className={`w-full rounded-t-md ${d.today ? 'bg-teal-300' : d.count ? 'bg-[#0f8b8d]' : 'bg-slate-200 dark:bg-slate-700'}`} style={{ height: `${d.count ? Math.max(8, (d.count / maxWeek) * 100) : 6}%`, transition: 'height .6s ease' }} title={`${d.count} questions`} />
                </div>
                <span className={`text-[10px] ${d.today ? 'font-semibold text-[#0f8b8d] dark:text-teal-300' : muted}`}>{d.today ? 'Today' : d.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={`${card} lg:col-span-2`}>
          <div className={`flex items-center gap-2 text-xs font-semibold tracking-widest ${muted}`}><Award className="h-4 w-4" /> BADGES</div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {badges.map(({ def, earnedOn }) => (
              <li key={def.id} className={`flex items-center gap-3 rounded-xl border p-3 ${earnedOn ? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30' : 'border-slate-200 opacity-70 dark:border-slate-700'}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${earnedOn ? 'bg-amber-400 text-amber-950' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'}`}>{earnedOn ? <Award className="h-5 w-5" /> : <Lock className="h-4 w-4" />}</span>
                <div className="min-w-0"><div className={`truncate text-sm font-semibold ${title}`}>{def.name}</div><div className={`truncate text-xs ${muted}`}>{earnedOn ? `Earned ${earnedOn}` : def.hint}</div></div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {teaching && <TeachMeModal topics={teaching} onClose={() => setTeaching(null)} onAskTutor={() => { setTutorSeed(lessonMessage(teaching)); onNavigate('ai-tutor'); }} />}
    </div>
  );
};
