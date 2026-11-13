import { AppView, ExamType } from '../types.ts';
import { listAttempts } from './attemptStore.ts';
import { dueCount } from './flashcardStore.ts';
import { SUBTOPICS } from '../data/subtopics.ts';
import { nextSyllabusTopics } from './syllabusStore.ts';
import { notifyDataChanged } from './dataEvents.ts';

export interface StudyPlanSettings {
  exam: ExamType;
  dailyQuestions: number;
  dailyReviews: number;
  dailyMinutes: number;
  studyDays: number[];
}

export interface PlanTask {
  id: string;
  kind: 'questions' | 'review' | 'syllabus' | 'mock' | 'custom';
  title: string;
  subject?: string;
  target: number;
  unit: 'questions' | 'cards' | 'topics' | 'minutes';
  done: number;
  targetView?: AppView;
}

const SETTINGS = 'pulse.studyPlan.settings.';
const LONGEST = 'pulse.studyPlan.longestStreak';
const EXAMS: ExamType[] = ['NEET_PG', 'INI_CET'];
const DAY = 86400000;

const pad = (n: number) => String(n).padStart(2, '0');
const dkey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dkey(new Date());
const serial = (k: string) => {
  const p = k.split('-');
  return Math.floor(Date.UTC(Number(p[0] ?? 0), Number(p[1] ?? 1) - 1, Number(p[2] ?? 1)) / DAY);
};
const isoKey = (iso: string): string | null => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dkey(d);
};
const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase();
const sameExam = (raw: string, exam: ExamType) => norm(raw) === norm(exam);

let subjectMap: Map<string, string> | null = null;
function appSubject(name: string): string {
  if (!subjectMap) {
    const m = new Map<string, string>();
    for (const k of Object.keys(SUBTOPICS)) m.set(k.toLowerCase(), k);
    subjectMap = m;
  }
  return subjectMap.get(name.toLowerCase()) ?? name;
}

const defaults = (exam: ExamType): StudyPlanSettings => ({
  exam,
  dailyQuestions: 40,
  dailyReviews: 20,
  dailyMinutes: 120,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
});

function sanitize(exam: ExamType, p: Partial<StudyPlanSettings>): StudyPlanSettings {
  const d = defaults(exam);
  const num = (v: unknown, f: number, min: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.round(v)) : f;
  const raw = Array.isArray(p.studyDays)
    ? p.studyDays.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6)
    : d.studyDays;
  const studyDays = Array.from(new Set(raw)).sort((a, b) => a - b);
  return {
    exam,
    dailyQuestions: num(p.dailyQuestions, d.dailyQuestions, 1),
    dailyReviews: num(p.dailyReviews, d.dailyReviews, 0),
    dailyMinutes: num(p.dailyMinutes, d.dailyMinutes, 5),
    studyDays: studyDays.length ? studyDays : d.studyDays,
  };
}

export function getPlanSettings(exam: ExamType): StudyPlanSettings {
  try {
    const raw = localStorage.getItem(SETTINGS + exam);
    if (raw) return sanitize(exam, JSON.parse(raw) as Partial<StudyPlanSettings>);
  } catch {
    /* ignore */
  }
  return defaults(exam);
}

export function savePlanSettings(s: StudyPlanSettings): void {
  try {
    localStorage.setItem(SETTINGS + s.exam, JSON.stringify(sanitize(s.exam, s)));
    notifyDataChanged();
  } catch {
    /* ignore */
  }
}

function examDay(exam: ExamType): Date | null {
  try {
    const raw = localStorage.getItem('exam.date.' + exam);
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function daysLeft(d: Date): number {
  const n = new Date();
  return Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / DAY,
  );
}

export function buildTodayPlan(exam: ExamType): PlanTask[] {
  const s = getPlanSettings(exam);
  const now = new Date();
  const today = dkey(now);
  const id = (suffix: string) => `${exam}-${today}-${suffix}`;
  if (!s.studyDays.includes(now.getDay())) {
    return [{ id: id('rest'), kind: 'custom', title: 'Rest day — recover for tomorrow', target: 1, unit: 'minutes', done: 0 }];
  }

  let attempts: ReturnType<typeof listAttempts> = [];
  try {
    attempts = listAttempts().filter(a => sameExam(a.exam, exam));
  } catch {
    attempts = [];
  }
  const mine = attempts.filter(a => isoKey(a.at) === today);
  const doneToday = mine.reduce((n, a) => n + (Number.isFinite(a.attempted) ? a.attempted : 0), 0);
  let due = 0;
  try {
    due = dueCount();
  } catch {
    /* ignore */
  }

  const tasks: PlanTask[] = [
    {
      id: id('review'),
      kind: 'review',
      title: due ? `Review ${due} due card${due === 1 ? '' : 's'}` : 'Spaced review — all caught up',
      target: Math.min(due, s.dailyReviews),
      unit: 'cards',
      done: 0,
      targetView: 'mistakes',
    },
    {
      id: id('questions'),
      kind: 'questions',
      title: 'Daily practice questions',
      target: s.dailyQuestions,
      unit: 'questions',
      done: doneToday,
      targetView: 'practice',
    },
  ];

  const since = Date.now() - 30 * DAY;
  const agg = new Map<string, { total: number; correct: number }>();
  for (const a of attempts) {
    const at = new Date(a.at).getTime();
    if (!Number.isFinite(at) || at < since || !a.subjects) continue;
    for (const [raw, v] of Object.entries(a.subjects)) {
      if (!v || !Number.isFinite(v.total)) continue;
      const key = appSubject(raw);
      const cur = agg.get(key) ?? { total: 0, correct: 0 };
      cur.total += v.total;
      cur.correct += Number.isFinite(v.correct) ? v.correct : 0;
      agg.set(key, cur);
    }
  }
  let weak: string | null = null;
  let weakAcc = 1;
  for (const [key, v] of agg) {
    if (v.total < 10) continue;
    const acc = v.correct / v.total;
    if (acc < weakAcc) {
      weak = key;
      weakAcc = acc;
    }
  }
  if (weak) {
    let done = 0;
    for (const a of mine) {
      for (const [raw, v] of Object.entries(a.subjects ?? {})) {
        if (appSubject(raw) === weak && v && Number.isFinite(v.total)) done += v.total;
      }
    }
    tasks.push({
      id: id('weak-' + weak),
      kind: 'questions',
      title: `Weak-area drill: ${weak}`,
      subject: weak,
      target: 15,
      unit: 'questions',
      done,
      targetView: 'practice',
    });
  }

  let topics: { subject: string; topic: string }[] = [];
  try {
    topics = nextSyllabusTopics(exam, 2);
  } catch {
    topics = [];
  }
  if (topics.length) {
    tasks.push({
      id: id('syllabus'),
      kind: 'syllabus',
      title: `Syllabus: ${topics.map(t => t.topic).join(' + ')}`,
      subject: topics[0]?.subject,
      target: topics.length,
      unit: 'topics',
      done: 0,
      targetView: 'syllabus',
    });
  }

  const when = examDay(exam);
  if (when) {
    const left = daysLeft(when);
    if (left >= 0 && left <= 60 && now.getDay() === Math.min(...s.studyDays)) {
      tasks.push({
        id: id('mock'),
        kind: 'mock',
        title: 'Take a timed mock block',
        target: 1,
        unit: 'minutes',
        done: 0,
        targetView: 'test-runner',
      });
    }
  }
  return tasks;
}

export function getTodayProgress(exam: ExamType): { questionsDone: number; questionsGoal: number; reviewsDue: number; goalMet: boolean } {
  const s = getPlanSettings(exam);
  const today = todayKey();
  let questionsDone = 0;
  try {
    for (const a of listAttempts()) {
      if (sameExam(a.exam, exam) && isoKey(a.at) === today) {
        questionsDone += Number.isFinite(a.attempted) ? a.attempted : 0;
      }
    }
  } catch {
    /* ignore */
  }
  let reviewsDue = 0;
  try {
    reviewsDue = dueCount();
  } catch {
    /* ignore */
  }
  return { questionsDone, questionsGoal: s.dailyQuestions, reviewsDue, goalMet: questionsDone >= s.dailyQuestions };
}

let longestCache: number | null = null;
function readLongest(): number {
  if (longestCache !== null) return longestCache;
  try {
    const n = Number.parseInt(localStorage.getItem(LONGEST) ?? '0', 10);
    longestCache = Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    longestCache = 0;
  }
  return longestCache;
}
function bumpLongest(n: number): void {
  if (longestCache !== null && n <= longestCache) return;
  longestCache = n;
  try {
    localStorage.setItem(LONGEST, String(n));
  } catch {
    /* ignore */
  }
  queueMicrotask(() => notifyDataChanged());
}
function longestRun(days: Set<string>): number {
  if (!days.size) return 0;
  const list = Array.from(days, serial).sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < list.length; i++) {
    const cur = list[i] ?? 0;
    const prev = list[i - 1] ?? 0;
    run = cur === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export function getStreak(): { current: number; longest: number; lastActiveDate: string | null } {
  const days = new Set<string>();
  try {
    for (const a of listAttempts()) {
      const k = isoKey(a.at);
      if (k) days.add(k);
    }
  } catch {
    /* ignore */
  }
  let lastActiveDate: string | null = null;
  for (const d of days) if (!lastActiveDate || d > lastActiveDate) lastActiveDate = d;

  const cursor = new Date();
  if (!days.has(dkey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (days.has(dkey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const longest = Math.max(readLongest(), current, longestRun(days));
  bumpLongest(longest);
  return { current, longest, lastActiveDate };
}

export function exportStudyPlan(): Record<string, unknown> {
  const settings: Record<string, StudyPlanSettings> = {};
  for (const e of EXAMS) settings[e] = getPlanSettings(e);
  return { version: 1, longestStreak: readLongest(), settings };
}

export function importStudyPlan(data: Record<string, unknown>): void {
  let changed = false;
  try {
    const incoming = data.settings as Record<string, unknown> | undefined;
    if (incoming && typeof incoming === 'object') {
      for (const e of EXAMS) {
        const raw = incoming[e];
        if (raw && typeof raw === 'object' && localStorage.getItem(SETTINGS + e) == null) {
          localStorage.setItem(SETTINGS + e, JSON.stringify(sanitize(e, raw as Partial<StudyPlanSettings>)));
          changed = true;
        }
      }
    }
    const n =
      typeof data.longestStreak === 'number' && Number.isFinite(data.longestStreak)
        ? Math.max(0, Math.round(data.longestStreak))
        : 0;
    if (n > readLongest()) {
      longestCache = n;
      localStorage.setItem(LONGEST, String(n));
      changed = true;
    }
  } catch {
    /* ignore */
  }
  if (changed) notifyDataChanged();
}
