// The habit layer: XP and levels, a streak that forgives a missed day (a "freeze"), badges, and the daily mission.
// Everything is kept on this device (localStorage 'pulse.game.v1'). Nothing here needs the internet or a login.
import type { ExamType } from '../types.ts';
import { listAttempts } from './attemptStore.ts';
import { getTodayProgress } from './studyPlanStore.ts';
import { notifyDataChanged } from './dataEvents.ts';

interface GameState {
  xp: number;
  freezes: number;
  /** Days (YYYY-MM-DD) a freeze covered, so the streak did not break. */
  frozen: string[];
  /** badge id -> the day it was earned */
  badges: Record<string, string>;
  /** Days the learner asked the tutor to teach a weak topic. */
  taught: string[];
  /** The streak length at which the last freeze was earned (one every 7 days). */
  freezeMilestone: number;
}

const KEY = 'pulse.game.v1';
const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
const dkey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (): string => dkey(new Date());
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function read(): GameState {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<GameState> | null;
    if (p && typeof p.xp === 'number') {
      return { xp: p.xp, freezes: p.freezes ?? 0, frozen: p.frozen ?? [], badges: p.badges ?? {}, taught: p.taught ?? [], freezeMilestone: p.freezeMilestone ?? 0 };
    }
  } catch { /* unreadable: start fresh */ }
  // A new learner starts with one freeze, so the very first missed day is forgiven.
  return { xp: 0, freezes: 1, frozen: [], badges: {}, taught: [], freezeMilestone: 0 };
}

function write(s: GameState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full */ }
  notifyDataChanged();
}

// ---------------------------------------------------------------- levels
const LEVEL_NAMES = ['Student', 'Intern', 'Resident', 'Registrar', 'Senior resident', 'Fellow', 'Specialist', 'Consultant', 'Professor', 'Legend'];
/** XP needed to reach level L (level 1 starts at 0): 100, 300, 600, 1000, ... */
const xpToReach = (level: number): number => 50 * (level - 1) * level;

export interface LevelInfo { level: number; name: string; xp: number; into: number; need: number; pct: number }

export function levelFor(xp: number): LevelInfo {
  let level = 1;
  while (xp >= xpToReach(level + 1)) level += 1;
  const start = xpToReach(level);
  const need = xpToReach(level + 1) - start;
  const into = xp - start;
  return { level, name: LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)], xp, into, need, pct: Math.round((into / need) * 100) };
}

export function getXp(): LevelInfo { return levelFor(read().xp); }

// ---------------------------------------------------------------- streak with freezes
export interface StreakInfo { current: number; longest: number; freezes: number; days: { key: string; state: 'done' | 'frozen' | 'today' | 'missed' | 'future'; label: string }[] }

/** The days with an attempt, plus the days a freeze covered. A freeze is spent when exactly one day was missed. */
function activeDays(s: GameState): Set<string> {
  const days = new Set<string>(s.frozen);
  for (const a of listAttempts()) {
    const d = new Date(a.at);
    if (!Number.isNaN(d.getTime())) days.add(dkey(d));
  }
  return days;
}

export function getStreak(): StreakInfo {
  const s = read();
  let days = activeDays(s);
  const today = new Date();
  // Yesterday was missed but the day before was studied: spend a freeze so the run keeps going.
  const yesterday = dkey(addDays(today, -1));
  const dayBefore = dkey(addDays(today, -2));
  if (!days.has(yesterday) && days.has(dayBefore) && s.freezes > 0) {
    s.freezes -= 1;
    s.frozen.push(yesterday);
    write(s);
    days = activeDays(s);
  }
  const cursor = new Date();
  if (!days.has(dkey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (days.has(dkey(cursor))) { current += 1; cursor.setDate(cursor.getDate() - 1); }
  // Longest run over every known day.
  const serials = [...days].map((k) => Math.floor(new Date(`${k}T00:00:00Z`).getTime() / DAY)).sort((a, b) => a - b);
  let longest = 0; let run = 0;
  serials.forEach((n, i) => { run = i > 0 && n === serials[i - 1] + 1 ? run + 1 : 1; if (run > longest) longest = run; });
  // One new freeze for every 7 days of streak.
  if (current >= 7 && Math.floor(current / 7) > s.freezeMilestone && s.freezes < 3) {
    s.freezes += 1; s.freezeMilestone = Math.floor(current / 7); write(s);
  } else if (current < 7 && s.freezeMilestone > 0) {
    s.freezeMilestone = 0; write(s);
  }
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 6);
    const key = dkey(d);
    const isToday = key === todayKey();
    const state: StreakInfo['days'][number]['state'] = s.frozen.includes(key) && !days.has(key) ? 'frozen'
      : s.frozen.includes(key) ? 'frozen'
        : days.has(key) ? 'done' : isToday ? 'today' : 'missed';
    return { key, state: isToday && !days.has(key) ? 'today' : state, label: isToday ? 'Today' : labels[d.getDay()] };
  });
  return { current, longest: Math.max(longest, current), freezes: s.freezes, days: week };
}

// ---------------------------------------------------------------- badges
export interface BadgeDef { id: string; name: string; hint: string }
export const BADGES: BadgeDef[] = [
  { id: 'first-test', name: 'First test', hint: 'Submit your first test' },
  { id: 'ten-tests', name: 'Ten tests', hint: 'Submit 10 tests' },
  { id: 'perfect-set', name: 'Perfect set', hint: 'Score 100% on 10 or more questions' },
  { id: 'streak-3', name: 'Three days', hint: 'Study 3 days in a row' },
  { id: 'streak-7', name: 'A full week', hint: 'Study 7 days in a row' },
  { id: 'first-lesson', name: 'Curious mind', hint: 'Let the tutor teach a weak topic' },
  { id: 'xp-1000', name: '1000 XP', hint: 'Earn 1000 XP' },
];

export function getBadges(): { def: BadgeDef; earnedOn: string | null }[] {
  const s = read();
  return BADGES.map((def) => ({ def, earnedOn: s.badges[def.id] ?? null }));
}

/** Gives any badge the learner has now earned. Returns the names of the new ones. */
function awardBadges(extra: { perfectSet?: boolean } = {}): string[] {
  const s = read();
  const attempts = listAttempts();
  const streak = getStreak();
  const fresh = read(); // getStreak may have saved a freeze
  const ok: Record<string, boolean> = {
    'first-test': attempts.length >= 1,
    'ten-tests': attempts.length >= 10,
    'perfect-set': !!extra.perfectSet || attempts.some((a) => a.attempted >= 10 && a.correct === a.attempted),
    'streak-3': streak.current >= 3,
    'streak-7': streak.current >= 7,
    'first-lesson': fresh.taught.length > 0,
    'xp-1000': fresh.xp >= 1000,
  };
  const got: string[] = [];
  for (const b of BADGES) {
    if (ok[b.id] && !fresh.badges[b.id]) { fresh.badges[b.id] = todayKey(); got.push(b.name); }
  }
  if (got.length) write(fresh);
  void s;
  return got;
}

// ---------------------------------------------------------------- rewards
export interface Reward { xp: number; leveledUp: boolean; level: LevelInfo; newBadges: string[] }

function addXp(amount: number): { before: LevelInfo; after: LevelInfo } {
  const s = read();
  const before = levelFor(s.xp);
  s.xp += Math.max(0, Math.round(amount));
  write(s);
  return { before, after: levelFor(s.xp) };
}

/** XP for a submitted test: 10 for every right answer, 2 for trying a wrong one, 20 for finishing, 50 for a perfect set. */
export function rewardForTest(correct: number, answered: number): Reward {
  const perfect = answered >= 10 && correct === answered;
  const xp = correct * 10 + (answered - correct) * 2 + (answered > 0 ? 20 : 0) + (perfect ? 50 : 0);
  const { before, after } = addXp(xp);
  const newBadges = awardBadges({ perfectSet: perfect });
  return { xp, leveledUp: after.level > before.level, level: after, newBadges };
}

/** The learner asked the tutor to teach a weak topic: 50 XP, once a day. */
export function rewardForLesson(): Reward | null {
  const s = read();
  if (s.taught.includes(todayKey())) return null;
  s.taught.push(todayKey());
  write(s);
  const { before, after } = addXp(50);
  return { xp: 50, leveledUp: after.level > before.level, level: after, newBadges: awardBadges() };
}

// ---------------------------------------------------------------- the daily mission
export interface MissionTask { id: 'questions' | 'review' | 'learn'; title: string; xp: number; done: boolean; progress: string }

export function getMission(exam: ExamType): { tasks: MissionTask[]; doneCount: number } {
  const p = getTodayProgress(exam);
  const taught = read().taught.includes(todayKey());
  const tasks: MissionTask[] = [
    { id: 'questions', title: `Answer ${p.questionsGoal} questions`, xp: 40, done: p.goalMet, progress: `${Math.min(p.questionsDone, p.questionsGoal)} of ${p.questionsGoal}` },
    { id: 'review', title: p.reviewsDue > 0 ? `Clear ${p.reviewsDue} due review${p.reviewsDue === 1 ? '' : 's'}` : 'Nothing due for review', xp: 30, done: p.reviewsDue === 0, progress: p.reviewsDue > 0 ? `${p.reviewsDue} due` : 'all clear' },
    { id: 'learn', title: 'Learn one weak topic with the tutor', xp: 50, done: taught, progress: taught ? 'done' : 'not yet' },
  ];
  return { tasks, doneCount: tasks.filter((t) => t.done).length };
}

/** Questions answered on each of the last 7 days, oldest first. */
export function weekActivity(): { label: string; count: number; today: boolean }[] {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts = new Map<string, number>();
  for (const a of listAttempts()) {
    const d = new Date(a.at);
    if (Number.isNaN(d.getTime())) continue;
    counts.set(dkey(d), (counts.get(dkey(d)) ?? 0) + (a.attempted || 0));
  }
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), i - 6);
    return { label: labels[d.getDay()], count: counts.get(dkey(d)) ?? 0, today: i === 6 };
  });
}
