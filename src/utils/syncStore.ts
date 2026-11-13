import { notifyDataChanged } from './dataEvents.ts';
import { backupToJson, importBackup } from './flashcardStore.ts';
import { exportReminders, importReminders } from './remindersStore.ts';
import { exportStudyPlan, importStudyPlan } from './studyPlanStore.ts';
import { exportSyllabus, importSyllabus } from './syllabusStore.ts';

export interface SyncConfig {
  folder: string | null;
  file: string | null;
  exists: boolean;
  modifiedAt: string | null;
}

interface LastSyncTimes {
  lastPushAt: string | null;
  lastPullAt: string | null;
}

const LAST_SYNC_KEY = 'pulse.sync.last';

function emptyLastSyncTimes(): LastSyncTimes {
  return { lastPushAt: null, lastPullAt: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSyncConfig(value: unknown): value is SyncConfig {
  return (
    isRecord(value) &&
    (value.folder === null || typeof value.folder === 'string') &&
    (value.file === null || typeof value.file === 'string') &&
    typeof value.exists === 'boolean' &&
    (value.modifiedAt === null || typeof value.modifiedAt === 'string')
  );
}

function responseErrorMessage(data: unknown, fallback: string): string {
  if (isRecord(data) && typeof data.error === 'string' && data.error.trim().length > 0) {
    return data.error;
  }
  return fallback;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function requireSyncConfig(response: Response): Promise<SyncConfig> {
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(responseErrorMessage(data, `Sync request failed (${response.status}).`));
  }
  if (!isSyncConfig(data)) {
    throw new Error('The sync server returned an unexpected response.');
  }
  return data;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function recordLastSync(kind: 'push' | 'pull'): void {
  const at = new Date().toISOString();
  const current = getLastSyncTimes();
  const next: LastSyncTimes = {
    lastPushAt: kind === 'push' ? at : current.lastPushAt,
    lastPullAt: kind === 'pull' ? at : current.lastPullAt,
  };

  try {
    localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(next));
    notifyDataChanged();
  } catch {
    // Storage failures should not turn a successful sync into a failure.
  }
}

export function getLastSyncTimes(): { lastPushAt: string | null; lastPullAt: string | null } {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) {
      return emptyLastSyncTimes();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return emptyLastSyncTimes();
    }

    return {
      lastPushAt: typeof parsed.lastPushAt === 'string' ? parsed.lastPushAt : null,
      lastPullAt: typeof parsed.lastPullAt === 'string' ? parsed.lastPullAt : null,
    };
  } catch {
    return emptyLastSyncTimes();
  }
}

export function buildSyncPayload(): string {
  return JSON.stringify({
    format: 'pulse-med-sync',
    version: 1,
    createdAt: new Date().toISOString(),
    backup: backupToJson(),
    studyPlan: exportStudyPlan(),
    syllabus: exportSyllabus(),
    reminders: exportReminders(),
  });
}

export function applySyncPayload(raw: string): { ok: boolean; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, message: 'The sync file is not valid JSON.' };
  }

  if (!isRecord(parsed) || parsed.format !== 'pulse-med-sync') {
    return { ok: false, message: 'This is not a Pulse Med sync file.' };
  }

  const merged: string[] = [];
  const problems: string[] = [];

  if (typeof parsed.backup === 'string') {
    try {
      const result = importBackup(parsed.backup);
      merged.push(
 `study data (${result.schedules} review schedules, ${result.highlights} highlights, ${result.attempts} attempts, ${result.capturedQuestions} captured questions added)`,
      );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'Flashcard schedules could not be merged.');
    }
  } else {
    problems.push('The flashcard backup section is missing.');
  }

  if (isRecord(parsed.studyPlan)) {
    try {
      importStudyPlan(parsed.studyPlan);
      merged.push('study plan');
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'The study plan could not be merged.');
    }
  } else {
    problems.push('The study plan section is missing.');
  }

  if (isRecord(parsed.syllabus)) {
    try {
      importSyllabus(parsed.syllabus);
      merged.push('syllabus');
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'The syllabus could not be merged.');
    }
  } else {
    problems.push('The syllabus section is missing.');
  }

  if (isRecord(parsed.reminders)) {
    try {
      importReminders(parsed.reminders);
      merged.push('reminders');
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'Reminders could not be merged.');
    }
  } else {
    problems.push('The reminders section is missing.');
  }

  if (problems.length > 0) {
    const summary = merged.length > 0 ? `Merged ${merged.join(', ')}. ` : '';
    return { ok: false, message: `${summary}${problems.join(' ')}`.trim() };
  }

  return {
    ok: true,
    message: merged.length > 0 ? `Merged ${merged.join(', ')}.` : 'The sync file contained no data to merge.',
  };
}

export async function getSyncConfig(): Promise<SyncConfig> {
  const response = await fetch('/api/sync/config', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return requireSyncConfig(response);
}

export async function setSyncFolder(folder: string): Promise<SyncConfig> {
  const trimmed = folder.trim();
  if (trimmed.length === 0) {
    throw new Error('Enter a non-empty folder path.');
  }

  const response = await fetch('/api/sync/config', {
    method: 'POST',
    headers: {
 'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ folder: trimmed }),
  });

  return requireSyncConfig(response);
}

export async function pushNow(): Promise<{ ok: boolean; message: string }> {
  try {
    const payload = buildSyncPayload();
    const response = await fetch('/api/sync/push', {
      method: 'POST',
      headers: {
 'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ payload }),
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        message: responseErrorMessage(data, `Push failed (${response.status}).`),
      };
    }

    if (!isRecord(data) || data.ok !== true) {
      return { ok: false, message: 'The sync server did not confirm the push.' };
    }

    recordLastSync('push');

    const bytes = typeof data.bytes === 'number' ? data.bytes : payload.length;
    return { ok: true, message: `Pushed sync file (${formatBytes(bytes)}).` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Push failed.' };
  }
}

export async function pullNow(): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch('/api/sync/pull', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        message: responseErrorMessage(data, `Pull failed (${response.status}).`),
      };
    }

    if (!isRecord(data) || data.ok !== true || typeof data.payload !== 'string') {
      return { ok: false, message: 'The sync server returned an unexpected pull response.' };
    }

    const applied = applySyncPayload(data.payload);
    if (applied.ok) {
      recordLastSync('pull');
    }
    return applied;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Pull failed.' };
  }
}
