import type { AppView, ExamType } from '../types.ts';
import { notifyDataChanged } from './dataEvents.ts';
import { dueCount } from './flashcardStore.ts';
import { getTodayProgress } from './studyPlanStore.ts';

export interface ReminderSettings {
  enabled: boolean;
  reviewTime: string;
  studyTime: string;
  examCountdownDays: number[];
  browserNotifications: boolean;
}

export interface ReminderMessage {
  id: string;
  title: string;
  body: string;
  view?: AppView;
}

type FiredMap = Record<string, string>;
type TodayProgress = ReturnType<typeof getTodayProgress>;

const SETTINGS_KEY = 'pulse.reminders.settings';
const FIRED_KEY = 'pulse.reminders.fired';
const CHECK_INTERVAL_MS = 60_000;
const FIRED_RETENTION_DAYS = 7;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: true,
  reviewTime: '19:00',
  studyTime: '18:00',
  examCountdownDays: [30, 14, 7, 1],
  browserNotifications: false,
};

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    notifyDataChanged();
  } catch {
    // Storage may be unavailable (private mode, quota); reminders simply will not persist.
  }
}

function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function timeToMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(raw: string | null): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = ISO_DATE_PREFIX.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfLocalDay(parsed);
}

function wholeDaysBetween(from: Date, to: Date): number {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.round((end - start) / 86_400_000);
}

function readExamDate(exam: ExamType): Date | null {
  return parseLocalDate(readRaw(`exam.date.${exam}`));
}

function examLabel(exam: ExamType): string {
  return exam === 'INI_CET' ? 'INI-CET' : 'NEET PG';
}

function sanitizeCountdownDays(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_SETTINGS.examCountdownDays];
  }
  const seen = new Set<number>();
  for (const value of input) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    const day = Math.round(numeric);
    if (day < 0 || day > 365) continue;
    seen.add(day);
  }
  return Array.from(seen).sort((a, b) => b - a);
}

function sanitizeSettings(input: unknown): ReminderSettings {
  const settings: ReminderSettings = {
    enabled: DEFAULT_SETTINGS.enabled,
    reviewTime: DEFAULT_SETTINGS.reviewTime,
    studyTime: DEFAULT_SETTINGS.studyTime,
    examCountdownDays: [...DEFAULT_SETTINGS.examCountdownDays],
    browserNotifications: DEFAULT_SETTINGS.browserNotifications,
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return settings;
  }
  const source = input as Record<string, unknown>;
  if (typeof source.enabled === 'boolean') settings.enabled = source.enabled;
  if (isTimeString(source.reviewTime)) settings.reviewTime = source.reviewTime;
  if (isTimeString(source.studyTime)) settings.studyTime = source.studyTime;
  settings.examCountdownDays = sanitizeCountdownDays(source.examCountdownDays);
  if (typeof source.browserNotifications === 'boolean') {
    settings.browserNotifications = source.browserNotifications;
  }
  return settings;
}

function loadFired(): FiredMap {
  const raw = readRaw(FIRED_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: FiredMap = {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    for (const [id, value] of entries) {
      if (typeof value === 'string' && DATE_KEY_PATTERN.test(value)) {
        result[id] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveFired(fired: FiredMap): void {
  writeRaw(FIRED_KEY, JSON.stringify(fired));
}

function pruneFired(fired: FiredMap, now: Date): boolean {
  const cutoff = localDateKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - FIRED_RETENTION_DAYS),
  );
  let changed = false;
  const ids = Object.keys(fired);
  for (const id of ids) {
    const value = fired[id];
    if (typeof value === 'string' && value < cutoff) {
      delete fired[id];
      changed = true;
    }
  }
  return changed;
}

function showBrowserNotification(settings: ReminderSettings, message: ReminderMessage): void {
  if (!settings.browserNotifications) return;
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    new Notification(message.title, { body: message.body });
  } catch {
    // Notifications can be blocked by the platform; the in-app banner still fired.
  }
}

export function getReminderSettings(): ReminderSettings {
  const raw = readRaw(SETTINGS_KEY);
  if (!raw) return sanitizeSettings(null);
  try {
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return sanitizeSettings(null);
  }
}

export function saveReminderSettings(s: ReminderSettings): void {
  const clean = sanitizeSettings(s);
  writeRaw(SETTINGS_KEY, JSON.stringify(clean));
}

function runReminderCheck(
  getExam: () => ExamType,
  onNotify: (message: ReminderMessage) => void,
): void {
  const settings = getReminderSettings();
  if (!settings.enabled) return;

  const now = new Date();
  const today = localDateKey(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const fired = loadFired();
  let dirty = pruneFired(fired, now);

  const alreadyFired = (id: string): boolean => fired[id] === today;
  const fire = (message: ReminderMessage): void => {
    fired[message.id] = today;
    dirty = true;
    try {
      onNotify(message);
    } catch {
      // A broken banner listener must never stop the engine.
    }
    showBrowserNotification(settings, message);
  };

  if (!alreadyFired('review') && minutesNow >= timeToMinutes(settings.reviewTime)) {
    let due = 0;
    try {
      due = dueCount();
    } catch {
      due = 0;
    }
    if (due > 0) {
      fire({
        id: 'review',
        title: 'Spaced review due',
        body: `${due} card${due === 1 ? '' : 's'} ready for review. Clear them to keep your spacing on track.`,
        view: 'mistakes',
      });
    }
  }

  let exam: ExamType | null = null;
  try {
    exam = getExam();
  } catch {
    exam = null;
  }

  if (exam !== null && !alreadyFired('study') && minutesNow >= timeToMinutes(settings.studyTime)) {
    let progress: TodayProgress | null = null;
    try {
      progress = getTodayProgress(exam);
    } catch {
      progress = null;
    }
    if (progress !== null && !progress.goalMet) {
      fire({
        id: 'study',
        title: "Today's study goal",
        body: `You have done ${progress.questionsDone} of ${progress.questionsGoal} questions today. A short focused set will close the gap.`,
        view: 'study-plan',
      });
    }
  }

  if (exam !== null) {
    const examDate = readExamDate(exam);
    if (examDate !== null) {
      const days = wholeDaysBetween(now, examDate);
      const id = `exam-${days}`;
      const scheduled = days >= 0 && settings.examCountdownDays.includes(days);
      if (scheduled && !alreadyFired(id)) {
        const label = examLabel(exam);
        const body =
          days === 0
            ? `Your ${label} exam is today. Stay calm and trust your preparation.`
            : `Your ${label} exam is ${days} day${days === 1 ? '' : 's'} away. Open your study plan to make the most of it.`;
        fire({
          id,
          title: `${days} day${days === 1 ? '' : 's'} to your exam`,
          body,
          view: 'study-plan',
        });
      }
    }
  }

  if (dirty) {
    saveFired(fired);
  }
}

export function startReminderEngine(
  getExam: () => ExamType,
  onNotify: (m: ReminderMessage) => void,
): () => void {
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    try {
      runReminderCheck(getExam, onNotify);
    } catch {
      // Never let a reminder hiccup break the app.
    }
  };

  tick();
  const timer = window.setInterval(tick, CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

export function exportReminders(): Record<string, unknown> {
  return {
    kind: 'pulse.reminders',
    version: 1,
    settings: getReminderSettings(),
  };
}

export function importReminders(data: Record<string, unknown>): void {
  try {
    const existing = readRaw(SETTINGS_KEY);
    if (existing !== null && existing !== '') return; // Local settings win; import never overwrites.
    if (!data || typeof data !== 'object') return;

    const nested = data.settings;
    const candidate: unknown =
      nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : data;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;

    const source = candidate as Record<string, unknown>;
    const knownKeys = [
 'enabled',
 'reviewTime',
 'studyTime',
 'examCountdownDays',
 'browserNotifications',
    ];
    const looksLikeSettings = knownKeys.some((key) => key in source);
    if (!looksLikeSettings) return;

    saveReminderSettings(sanitizeSettings(source));
  } catch {
    // Malformed backup payloads are ignored; existing settings stay untouched.
  }
}
