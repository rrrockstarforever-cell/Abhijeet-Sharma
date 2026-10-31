// Saved question banks (generated modules). Each module is stored whole, with its questions in
// their original order, so it can be reopened later and finished. Progress is not stored here: the
// Test Runner already saves answers, flags and position under runSession-<signature>, and the
// signature is the module's id, so reopening a module restores where the learner stopped.
import type { ClinicalQuestion, ExamType } from '../types.ts';

const DB_NAME = 'PulseMedModules';
const STORE = 'modules';

export interface SavedModule {
  id: string; // the Test Runner signature of its questions, so progress lines up
  title: string;
  exam: ExamType;
  mode: 'EXAM' | 'TUTOR';
  createdAt: string;
  count: number;
  questions: ClinicalQuestion[];
}

export interface ModuleSummary {
  id: string;
  title: string;
  exam: ExamType;
  mode: 'EXAM' | 'TUTOR';
  createdAt: string;
  count: number;
  answered: number;
  correct: number;
}

/** Event fired whenever the saved list changes, so open screens can refresh. */
export const MODULES_CHANGED = 'pulse-modules-changed';
function notifyModulesChanged(): void {
  window.dispatchEvent(new Event(MODULES_CHANGED));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Title from the subjects in the set, e.g. "Pharmacology, Lung Carcinoma". */
export function titleFor(questions: ClinicalQuestion[]): string {
  const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))];
  const shown = subjects.slice(0, 3).join(', ') + (subjects.length > 3 ? ` +${subjects.length - 3} more` : '');
  return shown || 'Question bank';
}

/** Saves (or refreshes) a module. Re-saving the same questions keeps one entry. */
export async function saveModule(module: Omit<SavedModule, 'createdAt' | 'count' | 'title'>): Promise<void> {
  const record: SavedModule = {
    ...module,
    title: titleFor(module.questions),
    count: module.questions.length,
    createdAt: new Date().toISOString(),
  };
  await withStore('readwrite', (store) => store.put(record));
  notifyModulesChanged();
}

export async function getModule(id: string): Promise<SavedModule | null> {
  return (await withStore('readonly', (store) => store.get(id))) ?? null;
}

export async function deleteModule(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
  notifyModulesChanged();
}

/** Lists saved modules, newest first, with progress read from the runner's saved sessions. */
export async function listModules(): Promise<ModuleSummary[]> {
  const all = (await withStore('readonly', (store) => store.getAll())) as SavedModule[];
  return all
    .map((m) => {
      let answers: Record<string, string> = {};
      try {
        answers = JSON.parse(localStorage.getItem('runSession-' + m.id) || 'null')?.answers ?? {};
      } catch { /* unreadable progress: treat as not started */ }
      const answered = m.questions.filter((q) => answers[q.id]).length;
      const correct = m.questions.filter((q) => answers[q.id] && answers[q.id] === q.correctOption).length;
      return { id: m.id, title: m.title, exam: m.exam, mode: m.mode, createdAt: m.createdAt, count: m.count, answered, correct };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * One-time rebuild of modules created before whole-module saving existed. Each runner session is
 * keyed by its question ids, and the full questions are still in the QA review list, so a past
 * module can be recovered when every one of its questions is still stored. Modules missing any
 * question are skipped.
 */
export async function backfillModulesFromSessions(): Promise<number> {
  if (localStorage.getItem('pulse.modules.backfilled') === 'v1') return 0;
  const byId = new Map<string, ClinicalQuestion>();
  try {
    const reviewed = JSON.parse(localStorage.getItem('pulse.qa.bank') || '[]') as { question?: ClinicalQuestion }[];
    for (const entry of reviewed) if (entry?.question?.id) byId.set(entry.question.id, entry.question);
  } catch { /* unreadable QA list: nothing to rebuild from */ }

  let saved = 0;
  const existing = new Set((await listModules()).map((m) => m.id));
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('runSession-sig-')) continue;
    let sig = '';
    try { sig = JSON.parse(localStorage.getItem(key) || 'null')?.sig ?? ''; } catch { continue; }
    if (!sig.startsWith('sig-') || existing.has(sig)) continue;
    const ids = sig.slice(4).split(',').filter(Boolean);
    const questions = ids.map((id) => byId.get(id)).filter((q): q is ClinicalQuestion => Boolean(q));
    if (questions.length === 0 || questions.length !== ids.length) continue;
    await saveModule({ id: sig, exam: questions[0].examType, mode: 'TUTOR', questions });
    saved += 1;
  }
  localStorage.setItem('pulse.modules.backfilled', 'v1');
  return saved;
}
