import React, { useCallback, useEffect, useState } from 'react';
import { AlarmClock, BellOff, BellRing, CalendarClock, Clock, Info, Monitor, Send } from 'lucide-react';
import type { ExamType } from '../types.ts';
import {
  getReminderSettings,
  saveReminderSettings,
  type ReminderSettings,
} from '../utils/remindersStore.ts';
import { dueCount } from '../utils/flashcardStore.ts';
import { getTodayProgress } from '../utils/studyPlanStore.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';

type PreviewTone = 'due' | 'scheduled' | 'fired' | 'idle' | 'off';

interface PreviewItem {
  id: string;
  title: string;
  detail: string;
  tone: PreviewTone;
}

type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

const COUNTDOWN_OPTIONS = [30, 14, 7, 3, 1];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const FIRED_KEY = 'pulse.reminders.fired';

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

function parseDateValue(raw: string | null): Date | null {
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

function wholeDaysUntil(from: Date, to: Date): number {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.round((end - start) / 86_400_000);
}

function readExamDate(exam: ExamType): Date | null {
  try {
    return parseDateValue(localStorage.getItem(`exam.date.${exam}`));
  } catch {
    return null;
  }
}

function readFired(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
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

function formatDate(date: Date): string {
  try {
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return date.toDateString();
  }
}

function readPermission(): PermissionState {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

function permissionLabel(state: PermissionState): string {
  switch (state) {
    case 'granted':
      return 'Allowed';
    case 'denied':
      return 'Blocked in browser settings';
    case 'default':
      return 'Not requested yet';
    default:
      return 'Not supported by this browser';
  }
}

function buildPreview(settings: ReminderSettings, exam: ExamType, now: Date): PreviewItem[] {
  const todayKey = localDateKey(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const fired = readFired();

  let due = 0;
  try {
    due = dueCount();
  } catch {
    due = 0;
  }
  const dueLabel = `${due} card${due === 1 ? '' : 's'} due`;

  let questionsDone = 0;
  let questionsGoal = 0;
  let goalMet = false;
  try {
    const progress = getTodayProgress(exam);
    questionsDone = progress.questionsDone;
    questionsGoal = progress.questionsGoal;
    goalMet = progress.goalMet;
  } catch {
    // Keep the zeroed defaults if the plan store is unavailable.
  }
  const studyLabel = `${questionsDone}/${questionsGoal} questions today`;

  let reviewItem: PreviewItem;
  if (fired['review'] === todayKey) {
    reviewItem = { id: 'review', title: 'Spaced review', detail: 'Already sent today', tone: 'fired' };
  } else if (due <= 0) {
    reviewItem = { id: 'review', title: 'Spaced review', detail: 'Nothing due right now', tone: 'idle' };
  } else if (minutesNow >= timeToMinutes(settings.reviewTime)) {
    reviewItem = { id: 'review', title: 'Spaced review', detail: `Ready to fire — ${dueLabel}`, tone: 'due' };
  } else {
    reviewItem = {
      id: 'review',
      title: 'Spaced review',
      detail: `At ${settings.reviewTime} — ${dueLabel}`,
      tone: 'scheduled',
    };
  }

  let studyItem: PreviewItem;
  if (fired['study'] === todayKey) {
    studyItem = { id: 'study', title: "Today's study goal", detail: 'Already sent today', tone: 'fired' };
  } else if (goalMet) {
    studyItem = {
      id: 'study',
      title: "Today's study goal",
      detail: 'Goal already met — nothing to nudge',
      tone: 'idle',
    };
  } else if (minutesNow >= timeToMinutes(settings.studyTime)) {
    studyItem = {
      id: 'study',
      title: "Today's study goal",
      detail: `Ready to fire — ${studyLabel}`,
      tone: 'due',
    };
  } else {
    studyItem = {
      id: 'study',
      title: "Today's study goal",
      detail: `At ${settings.studyTime} — ${studyLabel}`,
      tone: 'scheduled',
    };
  }

  let examItem: PreviewItem;
  const examDate = readExamDate(exam);
  if (examDate === null) {
    examItem = {
      id: 'exam',
      title: 'Exam countdown',
      detail: 'Exam date not set — add it in Settings',
      tone: 'idle',
    };
  } else {
    const days = wholeDaysUntil(now, examDate);
    if (days < 0) {
      examItem = {
        id: 'exam',
        title: 'Exam countdown',
        detail: 'The stored exam date has already passed',
        tone: 'idle',
      };
    } else {
      const id = `exam-${days}`;
      const label = `${days} day${days === 1 ? '' : 's'} to your exam`;
      if (fired[id] === todayKey) {
        examItem = { id, title: 'Exam countdown', detail: `${label} — already sent today`, tone: 'fired' };
      } else if (settings.examCountdownDays.includes(days)) {
        examItem = { id, title: 'Exam countdown', detail: `${label} — fires today`, tone: 'due' };
      } else {
        examItem = {
          id,
          title: 'Exam countdown',
          detail: `${label} — no countdown scheduled today`,
          tone: 'idle',
        };
      }
    }
  }

  const items = [reviewItem, studyItem, examItem];
  if (!settings.enabled) {
    return items.map((item) => ({
      ...item,
      detail: `Paused — ${item.detail}`,
      tone: 'off' as PreviewTone,
    }));
  }
  return items;
}

function toneDotClass(tone: PreviewTone): string {
  switch (tone) {
    case 'due':
      return 'bg-rose-500';
    case 'scheduled':
      return 'bg-amber-500';
    case 'fired':
      return 'bg-emerald-500';
    case 'idle':
      return 'bg-slate-400 dark:bg-slate-500';
    default:
      return 'bg-slate-300 dark:bg-slate-600';
  }
}

function toneChipClass(tone: PreviewTone): string {
  switch (tone) {
    case 'due':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'scheduled':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'fired':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    default:
      return 'border-slate-200 bg-slate-100 text-slate-600';
  }
}

function toneLabel(tone: PreviewTone): string {
  switch (tone) {
    case 'due':
      return 'Due';
    case 'scheduled':
      return 'Later';
    case 'fired':
      return 'Sent';
    case 'idle':
      return 'Quiet';
    default:
      return 'Paused';
  }
}

export const RemindersView: React.FC<{ exam: ExamType }> = ({ exam }) => {
  const [settings, setSettings] = useState<ReminderSettings>(() => getReminderSettings());
  const [permission, setPermission] = useState<PermissionState>(() => readPermission());
  const [notice, setNotice] = useState<string>('');
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const unsubscribe = subscribeDataChanged(() => {
      setSettings(getReminderSettings());
      setNow(new Date());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setPermission(readPermission());
    const refresh = (): void => setPermission(readPermission());
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const update = useCallback((patch: Partial<ReminderSettings>) => {
    const next: ReminderSettings = { ...getReminderSettings(), ...patch };
    saveReminderSettings(next);
    setSettings(next);
  }, []);

  const toggleCountdownDay = useCallback(
    (day: number) => {
      const current = getReminderSettings();
      const has = current.examCountdownDays.includes(day);
      const nextDays = has
        ? current.examCountdownDays.filter((value) => value !== day)
        : [...current.examCountdownDays, day].sort((a, b) => b - a);
      update({ examCountdownDays: nextDays });
    },
    [update],
  );

  const handleRequestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setNotice('This browser does not support desktop notifications.');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        setNotice('Desktop notifications allowed.');
      } else if (result === 'denied') {
        setNotice('Notifications are blocked. Re-enable them in your browser site settings.');
      } else {
        setNotice('Permission was dismissed. You can ask again any time.');
      }
    } catch {
      setNotice('Could not request notification permission from this browser.');
    }
  }, []);

  const handleTestReminder = useCallback(() => {
    if (typeof Notification === 'undefined') {
      setNotice('This browser cannot show desktop notifications; only the in-app banner will appear.');
      return;
    }
    if (Notification.permission !== 'granted') {
      setNotice('Allow notifications first, then send the test again.');
      return;
    }
    try {
      new Notification('Pulse Med test reminder', {
        body: 'This is what a reminder looks like. Reminders only fire while Pulse Med is open.',
      });
      setNotice('Test reminder sent.');
    } catch {
      setNotice('The browser blocked the test notification.');
    }
  }, []);

  const preview = buildPreview(settings, exam, now);
  const examDate = readExamDate(exam);
  const daysToExam = examDate === null ? null : wholeDaysUntil(now, examDate);
  const needsPermission =
    settings.browserNotifications && permission !== 'granted' && permission !== 'unsupported';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-12">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] text-white">
            <BellRing className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
              Reminders
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Daily nudges for spaced review, your study goal and the exam countdown.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-900 dark:text-slate-100">
              {settings.enabled ? (
                <BellRing className="h-4 w-4" aria-hidden="true" />
              ) : (
                <BellOff className="h-4 w-4" aria-hidden="true" />
              )}
              Reminders are {settings.enabled ? 'on' : 'off'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Turning this off pauses every reminder below without losing your settings.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => update({ enabled: !settings.enabled })}
            className={`${settings.enabled ? 'border-[#0f8b8d] bg-[#0f8b8d] text-white hover:bg-[#0c7476]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'} rounded-lg border shadow-sm shrink-0 px-4 py-2 text-xs font-medium uppercase tracking-wide`}
          >
            {settings.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <label className="block">
          <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
            <AlarmClock className="h-4 w-4" aria-hidden="true" />
            Spaced review time
          </span>
          <input
            type="time"
            value={settings.reviewTime}
            onChange={(event) => {
              const value = event.target.value;
              if (TIME_PATTERN.test(value)) update({ reviewTime: value });
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0f8b8d] focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/30"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Fires once a day at or after this time when cards are due.
          </span>
        </label>

        <label className="block">
          <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
            <Clock className="h-4 w-4" aria-hidden="true" />
            Study goal time
          </span>
          <input
            type="time"
            value={settings.studyTime}
            onChange={(event) => {
              const value = event.target.value;
              if (TIME_PATTERN.test(value)) update({ studyTime: value });
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0f8b8d] focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/30"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Fires once a day at or after this time if today&apos;s goal is not met.
          </span>
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-900 dark:text-slate-100">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Exam countdown
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            {examDate === null
              ? 'No exam date stored yet — set it in Settings to unlock countdown reminders.'
              : `Exam date: ${formatDate(examDate)}${daysToExam === null ? '' : ` · ${daysToExam} day${daysToExam === 1 ? '' : 's'} left`}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {COUNTDOWN_OPTIONS.map((day) => {
            const active = settings.examCountdownDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                onClick={() => toggleCountdownDay(day)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${active ? 'border-[#0f8b8d] bg-[#0f8b8d] text-white' : 'border-slate-300 bg-white text-slate-700 opacity-70 hover:bg-slate-50 hover:opacity-100'}`}
              >
                {day} {day === 1 ? 'day' : 'days'}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-900 dark:text-slate-100">
              <Monitor className="h-4 w-4" aria-hidden="true" />
              Desktop notifications
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Permission: {permissionLabel(permission)}
            </p>
          </div>
          <button
            type="button"
            aria-pressed={settings.browserNotifications}
            onClick={() => update({ browserNotifications: !settings.browserNotifications })}
            className={`${settings.browserNotifications ? 'border-[#0f8b8d] bg-[#0f8b8d] text-white hover:bg-[#0c7476]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'} rounded-lg border shadow-sm shrink-0 px-4 py-2 text-xs font-medium uppercase tracking-wide`}
          >
            {settings.browserNotifications ? 'On' : 'Off'}
          </button>
        </div>

        {needsPermission ? (
          <p className="text-xs text-amber-700">
            Desktop notifications need browser permission. In-app banners keep working regardless.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void handleRequestPermission();
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-700 shadow-sm hover:border-[#0f8b8d] hover:text-[#0f8b8d]"
          >
            <BellRing className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
            Allow notifications
          </button>
          <button
            type="button"
            onClick={handleTestReminder}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-700 shadow-sm hover:border-[#0f8b8d] hover:text-[#0f8b8d]"
          >
            <Send className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
            Send a test reminder
          </button>
        </div>

        {notice ? <p className="text-xs text-teal-700">{notice}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-900 dark:text-slate-100">
          <BellRing className="h-4 w-4" aria-hidden="true" />
          Today&apos;s preview
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          What would fire today, using the same rules as the live engine.
        </p>
        <ul className="mt-3 space-y-2">
          {preview.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
            >
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toneDotClass(item.tone)}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                <p className="text-xs text-slate-600">{item.detail}</p>
              </div>
              <span
                className={`${toneChipClass(item.tone)} rounded-full border shrink-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide`}
              >
                {toneLabel(item.tone)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Reminders only fire while Pulse Med is open.</span>
      </p>
    </div>
  );
};
