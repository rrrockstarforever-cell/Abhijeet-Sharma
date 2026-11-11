// FSRS-style flashcard scheduling for Pulse Med (PARITY section 9 / 12).
//
// Cards are built from REAL saved material only:
//   - user highlights / AI notes (localStorage `pulse.userHighlights.v1`)
//   - captured mistake-notebook questions (`pulse.mistakes.v1`)
// There is no mock schedule. New cards are due immediately; ratings reschedule them.
//
// Scheduling is a compact FSRS-inspired model: stability grows with successful
// recalls, difficulty/ease adapts to lapses, ratings are Again / Hard / Good / Easy.
// Every next-due value is computed from the real clock, so "due now", "next due"
// and the interval previews shown on the buttons are all honest.
import { listUserHighlights, type UserHighlight } from './userHighlightsStore.ts';
import { listCapturedQuestions, importCapturedQuestions } from './mistakeStore.ts';
import { listAttempts, importAttempts, type AttemptRecord } from './attemptStore.ts';
import { notifyDataChanged } from './dataEvents.ts';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewSchedule {
  /** epoch ms when the card becomes due */
  due: number;
  /** current interval in days (fractional for <1 day) */
  intervalDays: number;
  /** ease / stability proxy, 1.3 – 2.8 */
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: number;
  /** postponed with "Review later" — stays in the deck but not due */
  reviewedLaterUntil?: number;
  /** removed from review without deleting the highlight */
  suspended?: boolean;
}

export interface ReviewCard {
  key: string;
  source: 'highlight' | 'captured';
  subject: string;
  topic: string;
  front: string;
  back: string;
  citation?: string;
  page?: number;
  docId?: string;
  color?: string;
  createdAt: string;
}

const SCHEDULE_KEY = 'pulse.flashcards.v1';
const DAY_MS = 86_400_000;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadSchedules(): Record<string, ReviewSchedule> {
  return safeParse<Record<string, ReviewSchedule>>(localStorage.getItem(SCHEDULE_KEY), {});
}

function saveSchedules(map: Record<string, ReviewSchedule>): void {
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(map));
    notifyDataChanged();
  } catch (err) {
    console.error('Could not save flashcard schedule', err);
  }
}

/** Every card that can be reviewed, with its real schedule attached. */
export function buildReviewCards(): { card: ReviewCard; schedule: ReviewSchedule }[] {
  const schedules = loadSchedules();
  const cards: ReviewCard[] = [];

  for (const h of listUserHighlights()) {
    cards.push(highlightToCard(h));
  }
  for (const q of listCapturedQuestions()) {
    const correct = q.question.options.find((o) => o.id === q.question.correctOption);
    cards.push({
      key: `q:${q.id}`,
      source: 'captured',
      subject: q.question.subject,
      topic: q.question.subtopic || q.topic || 'Captured question',
      front: `${q.question.stem}\n\n${q.question.questionText}`.trim(),
      back: `${q.question.correctOption}. ${correct?.text ?? ''}\n\n${q.explanation || q.question.boardPearl || 'No explanation captured.'}`,
      citation: q.source || 'Mistake notebook',
      createdAt: q.createdAt,
    });
  }

  return cards.map((card) => {
    const existing = schedules[card.key];
    const created = Date.parse(card.createdAt);
    return {
      card,
      schedule: existing ?? {
        due: Number.isFinite(created) ? created : Date.now(),
        intervalDays: 0,
        ease: 2.3,
        reps: 0,
        lapses: 0,
      },
    };
  });
}

function highlightToCard(h: UserHighlight): ReviewCard {
  const back = [h.memoryAnchor, h.note, h.citation ? `Source: ${h.citation}` : '']
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n\n');
  return {
    key: `hl:${h.id}`,
    source: 'highlight',
    subject: h.subject || 'General',
    topic: h.subtopic || 'Note',
    front: h.quote,
    back: back || 'No extra note saved for this highlight.',
    citation: h.citation,
    page: h.page,
    docId: h.docId,
    color: h.color,
    createdAt: h.createdAt || new Date().toISOString(),
  };
}

export function sourceLabel(card: ReviewCard): string {
  if (card.source === 'captured') return 'Mistake notebook';
  if (card.docId) return 'PDF notes';
  if (card.citation?.startsWith('AI')) return 'AI notes';
  return 'Notes';
}

/** Cards due right now, oldest due first. */
export function dueReviewCards(now: number = Date.now()): { card: ReviewCard; schedule: ReviewSchedule }[] {
  return buildReviewCards()
    .filter(({ schedule }) => !schedule.suspended && schedule.due <= now)
    .sort((a, b) => a.schedule.due - b.schedule.due);
}

/** Earliest future due time (ignores suspended cards). Null when no cards exist. */
export function nextDueAt(): number | null {
  const future = buildReviewCards()
    .filter(({ schedule }) => !schedule.suspended && schedule.due > Date.now())
    .map(({ schedule }) => schedule.due);
  return future.length ? Math.min(...future) : null;
}

export function dueCount(now: number = Date.now()): number {
  return dueReviewCards(now).length;
}

/** Human-readable "in 3 days" / "10 min" style label. */
export function formatDueIn(due: number, now: number = Date.now()): string {
  const diff = due - now;
  if (diff <= 0) return 'Due now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 36) return `${hours} h`;
  const days = Math.round(diff / DAY_MS);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Project the interval (in days) that a rating would schedule from the current state. */
export function projectInterval(schedule: ReviewSchedule, rating: ReviewRating): number {
  const isNew = schedule.reps === 0;
  switch (rating) {
    case 'again':
      return 10 / (60 * 24); // 10 minutes
    case 'hard':
      return isNew ? 0.5 : Math.max(0.5, schedule.intervalDays * 1.2);
    case 'good':
      return isNew ? 1 : Math.max(1, schedule.intervalDays * schedule.ease);
    case 'easy':
      return isNew ? 4 : Math.max(4, schedule.intervalDays * schedule.ease * 1.35);
  }
}

export function previewLabel(schedule: ReviewSchedule, rating: ReviewRating): string {
  const days = projectInterval(schedule, rating);
  if (days < 1) {
    const mins = Math.max(1, Math.round(days * 24 * 60));
    return `${mins} min`;
  }
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

/** Apply a real rating and persist the new due date. Returns the updated schedule. */
export function rateCard(cardKey: string, rating: ReviewRating): ReviewSchedule {
  const schedules = loadSchedules();
  const current = schedules[cardKey] ?? {
    due: Date.now(),
    intervalDays: 0,
    ease: 2.3,
    reps: 0,
    lapses: 0,
  };
  const intervalDays = Math.min(365, projectInterval(current, rating));
  let ease = current.ease;
  if (rating === 'again') ease = Math.max(1.3, ease - 0.2);
  else if (rating === 'hard') ease = Math.max(1.3, ease - 0.05);
  else if (rating === 'easy') ease = Math.min(2.8, ease + 0.15);

  const next: ReviewSchedule = {
    due: Date.now() + intervalDays * DAY_MS,
    intervalDays,
    ease,
    reps: current.reps + 1,
    lapses: current.lapses + (rating === 'again' ? 1 : 0),
    lastReviewedAt: Date.now(),
    suspended: current.suspended,
    reviewedLaterUntil: undefined,
  };
  schedules[cardKey] = next;
  saveSchedules(schedules);
  return next;
}

/** "Review later" — postpone for a day without recording a failed recall. */
export function reviewLater(cardKey: string, days = 1): void {
  const schedules = loadSchedules();
  const current = schedules[cardKey] ?? {
    due: Date.now(),
    intervalDays: 0,
    ease: 2.3,
    reps: 0,
    lapses: 0,
  };
  schedules[cardKey] = {
    ...current,
    due: Date.now() + days * DAY_MS,
    reviewedLaterUntil: Date.now() + days * DAY_MS,
  };
  saveSchedules(schedules);
}

/** Remove from review without deleting the underlying note/question. */
export function removeFromReview(cardKey: string): void {
  const schedules = loadSchedules();
  const current = schedules[cardKey] ?? {
    due: Date.now(),
    intervalDays: 0,
    ease: 2.3,
    reps: 0,
    lapses: 0,
  };
  schedules[cardKey] = { ...current, suspended: true };
  saveSchedules(schedules);
}

/** Put a suspended card back into the deck, due now. */
export function restoreToReview(cardKey: string): void {
  const schedules = loadSchedules();
  const current = schedules[cardKey];
  if (!current) return;
  schedules[cardKey] = { ...current, suspended: false, due: Date.now() };
  saveSchedules(schedules);
}

// ---------------------------------------------------------------------------
// Data & exports (PARITY section 9): versioned JSON backup, merge import that
// never overwrites existing schedules, and reset schedules with a backup first.
// Deliberately excludes credentials: no OAuth tokens, no API keys.
// ---------------------------------------------------------------------------

export const BACKUP_FORMAT = 'pulse-med-backup';
export const BACKUP_VERSION = 1;

export interface PulseBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  app: 'Pulse Med';
  data: {
    highlights: UserHighlight[];
    schedules: Record<string, ReviewSchedule>;
    attempts: AttemptRecord[];
    capturedQuestions: ReturnType<typeof listCapturedQuestions>;
  };
}

export function exportBackup(): PulseBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'Pulse Med',
    data: {
      highlights: listUserHighlights(),
      schedules: loadSchedules(),
      attempts: listAttempts(),
      capturedQuestions: listCapturedQuestions(),
    },
  };
}

export function backupToJson(): string {
  return JSON.stringify(exportBackup(), null, 2);
}

export interface ImportResult {
  highlights: number;
  schedules: number;
  attempts: number;
  capturedQuestions: number;
}

/** Minimal shape check so a corrupt backup cannot poison the scheduler. */
function isReviewSchedule(value: unknown): value is ReviewSchedule {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.due === 'number' && Number.isFinite(v.due) &&
    typeof v.intervalDays === 'number' && Number.isFinite(v.intervalDays) &&
    typeof v.ease === 'number' && Number.isFinite(v.ease) &&
    typeof v.reps === 'number' &&
    typeof v.lapses === 'number'
  );
}

/**
 * Merge a backup into the current data.
 * - Schedules are only applied to card keys that do not already have one, so a
 *   restore can never overwrite the learner's current scheduling progress.
 * - Items are matched by id; duplicates are skipped.
 */
export function importBackup(raw: string): ImportResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || parsed.format !== BACKUP_FORMAT) {
    throw new Error('Unrecognised backup file (expected a Pulse Med backup).');
  }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
    throw new Error(`Backup version ${String(parsed.version)} is newer than this app understands.`);
  }
  const data = parsed.data || {};
  const result: ImportResult = { highlights: 0, schedules: 0, attempts: 0, capturedQuestions: 0 };

  // Highlights
  if (Array.isArray(data.highlights)) {
    const existing = new Set(listUserHighlights().map((h) => h.id));
    const toAdd = data.highlights.filter((h: any) => h && typeof h.id === 'string' && h.id && !existing.has(h.id));
    for (const h of toAdd) {
      // write through the same store format, preserving the original id/createdAt
      const all = listUserHighlights();
      all.unshift(h as UserHighlight);
      try {
        localStorage.setItem('pulse.userHighlights.v1', JSON.stringify(all));
        result.highlights += 1;
      } catch {
        throw new Error('Local storage is full — could not import highlights.');
      }
    }
  }

  // Schedules — never overwrite an existing schedule
  if (data.schedules && typeof data.schedules === 'object') {
    const schedules = loadSchedules();
    for (const [key, value] of Object.entries(data.schedules)) {
      if (!schedules[key] && isReviewSchedule(value)) {
        schedules[key] = value;
        result.schedules += 1;
      }
    }
    saveSchedules(schedules);
  }

  // Attempts
  if (Array.isArray(data.attempts)) {
    result.attempts = importAttempts(data.attempts as AttemptRecord[]);
  }

  // Captured questions
  if (Array.isArray(data.capturedQuestions)) {
    result.capturedQuestions = importCapturedQuestions(data.capturedQuestions as any);
  }

  notifyDataChanged();
  return result;
}

/** Reset all scheduling (decks become due now). Returns the backup JSON to save. */
export function resetSchedules(): string {
  const backup = backupToJson();
  try {
    localStorage.removeItem(SCHEDULE_KEY);
    notifyDataChanged();
  } catch {
    throw new Error('Could not clear the local schedule store.');
  }
  return backup;
}

/** Delete everything review-related, including highlights and captured questions. */
export function clearAllStudyData(): string {
  const backup = backupToJson();
  try {
    localStorage.removeItem(SCHEDULE_KEY);
    localStorage.removeItem('pulse.userHighlights.v1');
    localStorage.removeItem('pulse.mistakes.v1');
    localStorage.removeItem('pulse.attempts.v1');
    notifyDataChanged();
  } catch {
    throw new Error('Could not clear the local study data.');
  }
  return backup;
}
