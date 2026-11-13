import type { ExamType } from '../types.ts';
import { SUBTOPICS } from '../data/subtopics.ts';
import { TOPIC_IMPORTANCE } from '../data/topicImportance.ts';
import { toAppSubject } from '../data/subjectAliases.ts';
import { notifyDataChanged } from './dataEvents.ts';

export interface SyllabusSubjectProgress {
  subject: string;
  total: number;
  done: number;
  weightPercent: number;
}

const STORAGE_PREFIX = 'pulse.syllabus.';

const ALL_EXAMS: ExamType[] = ['NEET_PG', 'INI_CET'];

type SyllabusMap = Record<string, string[]>;

function storageKey(exam: ExamType): string {
  return `${STORAGE_PREFIX}${exam}`;
}

function readSyllabusMap(exam: ExamType): SyllabusMap {
  try {
    const raw = localStorage.getItem(storageKey(exam));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SyllabusMap = {};
    for (const [subject, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!subject || !Array.isArray(value)) continue;
      const topics: string[] = [];
      for (const item of value) {
        if (typeof item === 'string' && item.length > 0) topics.push(item);
      }
      out[subject] = topics;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSyllabusMap(exam: ExamType, map: SyllabusMap): void {
  try {
    localStorage.setItem(storageKey(exam), JSON.stringify(map));
  } catch {
    // localStorage can be unavailable (private mode / quota); keep the app usable.
  }
  notifyDataChanged();
}

export function isTopicDone(exam: ExamType, subject: string, topic: string): boolean {
  const list = readSyllabusMap(exam)[subject];
  return Array.isArray(list) && list.includes(topic);
}

export function setTopicDone(exam: ExamType, subject: string, topic: string, done: boolean): void {
  if (!subject || !topic) return;
  const map = readSyllabusMap(exam);
  const current = new Set(map[subject] ?? []);
  if (done === current.has(topic)) return;
  if (done) current.add(topic);
  else current.delete(topic);
  const next = Array.from(current);
  if (next.length > 0) map[subject] = next;
  else delete map[subject];
  writeSyllabusMap(exam, map);
}

export function setSubjectTopicsDone(
  exam: ExamType,
  subject: string,
  topics: string[],
  done: boolean,
): void {
  if (!subject) return;
  const map = readSyllabusMap(exam);
  const current = new Set(map[subject] ?? []);
  let changed = false;
  for (const topic of topics) {
    if (!topic) continue;
    if (done && !current.has(topic)) {
      current.add(topic);
      changed = true;
    } else if (!done && current.has(topic)) {
      current.delete(topic);
      changed = true;
    }
  }
  if (!changed) return;
  const next = Array.from(current);
  if (next.length > 0) map[subject] = next;
  else delete map[subject];
  writeSyllabusMap(exam, map);
}

export function getDoneTopics(exam: ExamType): SyllabusMap {
  const map = readSyllabusMap(exam);
  const out: SyllabusMap = {};
  for (const [subject, topics] of Object.entries(map)) out[subject] = [...topics];
  return out;
}

function examMatchesRow(rowExam: string, exam: ExamType): boolean {
  const value = typeof rowExam === 'string' ? rowExam.toLowerCase() : '';
  if (exam === 'NEET_PG') return value.includes('neet');
  return value.includes('ini');
}

const weightCache: Partial<Record<ExamType, Map<string, number>>> = {};

// The 19 core subjects = the subjects that have researched importance data, named as SUBTOPICS names them.
const CORE_SUBJECTS: Set<string> = new Set(TOPIC_IMPORTANCE.map((row) => toAppSubject(row.subject)));

function getSubjectWeights(exam: ExamType): Map<string, number> {
  const cached = weightCache[exam];
  if (cached) return cached;
  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of TOPIC_IMPORTANCE) {
    if (!row || typeof row.topic !== 'string' || typeof row.subject !== 'string') continue;
    if (!row.topic.trim().toLowerCase().startsWith('subject total')) continue;
    if (!examMatchesRow(row.exam, exam)) continue;
    const subject = toAppSubject(row.subject);
    if (!subject || !(subject in SUBTOPICS)) continue;
    const percent = typeof row.percent === 'number' && Number.isFinite(row.percent) ? row.percent : 0;
    const bucket = totals.get(subject) ?? { sum: 0, count: 0 };
    bucket.sum += percent;
    bucket.count += 1;
    totals.set(subject, bucket);
  }
  const weights = new Map<string, number>();
  for (const [subject, bucket] of totals) {
    const average = bucket.count > 0 ? bucket.sum / bucket.count : 0;
    weights.set(subject, Math.round(average * 100) / 100);
  }
  weightCache[exam] = weights;
  return weights;
}

export function getSyllabusProgress(exam: ExamType): SyllabusSubjectProgress[] {
  const map = readSyllabusMap(exam);
  const weights = getSubjectWeights(exam);
  const progress: SyllabusSubjectProgress[] = [];
  for (const subject of Object.keys(SUBTOPICS)) {
    // Only the 19 core subjects: SUBTOPICS also holds the integrated-domain groups and AIIMS_* ids,
    // which overlap the same topics and would double-count the syllabus.
    if (!CORE_SUBJECTS.has(subject)) continue;
    const topics = SUBTOPICS[subject] ?? [];
    const doneSet = new Set(map[subject] ?? []);
    let done = 0;
    for (const topic of topics) {
      if (doneSet.has(topic)) done += 1;
    }
    progress.push({
      subject,
      total: topics.length,
      done,
      weightPercent: weights.get(subject) ?? 0,
    });
  }
  return progress;
}

export function nextSyllabusTopics(exam: ExamType, count: number): { subject: string; topic: string }[] {
  const wanted = Math.max(0, Math.floor(count));
  if (!Number.isFinite(wanted) || wanted === 0) return [];
  const map = readSyllabusMap(exam);
  const progress = getSyllabusProgress(exam);
  const ordered = [...progress].sort((a, b) => {
    if (b.weightPercent !== a.weightPercent) return b.weightPercent - a.weightPercent;
    const aCompletion = a.total > 0 ? a.done / a.total : 0;
    const bCompletion = b.total > 0 ? b.done / b.total : 0;
    if (aCompletion !== bCompletion) return aCompletion - bCompletion;
    return a.subject.localeCompare(b.subject);
  });
  const queues = ordered.map((entry) => {
    const doneSet = new Set(map[entry.subject] ?? []);
    const remaining = (SUBTOPICS[entry.subject] ?? []).filter((topic) => !doneSet.has(topic));
    return { subject: entry.subject, topics: remaining };
  });
  const picked: { subject: string; topic: string }[] = [];
  const perSubject = new Map<string, number>();
  let addedInPass = true;
  while (picked.length < wanted && addedInPass) {
    addedInPass = false;
    for (const queue of queues) {
      if (picked.length >= wanted) break;
      if (queue.topics.length === 0) continue;
      const taken = perSubject.get(queue.subject) ?? 0;
      if (taken >= 2) continue;
      const topic = queue.topics.shift();
      if (topic === undefined) continue;
      picked.push({ subject: queue.subject, topic });
      perSubject.set(queue.subject, taken + 1);
      addedInPass = true;
    }
  }
  if (picked.length < wanted) {
    for (const queue of queues) {
      while (picked.length < wanted && queue.topics.length > 0) {
        const topic = queue.topics.shift();
        if (topic === undefined) continue;
        picked.push({ subject: queue.subject, topic });
      }
      if (picked.length >= wanted) break;
    }
  }
  return picked;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function mergeExam(exam: ExamType, incoming: unknown): void {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
  const current = readSyllabusMap(exam);
  let changed = false;
  for (const [subject, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (!subject || !isStringArray(value)) continue;
    const merged = new Set(current[subject] ?? []);
    const before = merged.size;
    for (const topic of value) {
      if (topic) merged.add(topic);
    }
    if (merged.size !== before) {
      current[subject] = Array.from(merged);
      changed = true;
    }
  }
  if (changed) writeSyllabusMap(exam, current);
}

export function exportSyllabus(): Record<string, unknown> {
  const exams: Record<string, SyllabusMap> = {};
  for (const exam of ALL_EXAMS) exams[exam] = readSyllabusMap(exam);
  return { version: 1, exams };
}

export function importSyllabus(data: Record<string, unknown>): void {
  if (!data || typeof data !== 'object') return;
  const exams = (data as { exams?: unknown }).exams;
  if (exams && typeof exams === 'object' && !Array.isArray(exams)) {
    const record = exams as Record<string, unknown>;
    for (const exam of ALL_EXAMS) mergeExam(exam, record[exam]);
    return;
  }
  // Tolerate payloads that store each exam directly at the top level.
  let foundExamKey = false;
  for (const exam of ALL_EXAMS) {
    if (exam in data) {
      foundExamKey = true;
      mergeExam(exam, (data as Record<string, unknown>)[exam]);
    }
  }
  if (foundExamKey) return;
  // Tolerate a nested { syllabus: ... } payload from a combined sync file.
  const nested = (data as Record<string, unknown>).syllabus;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    importSyllabus(nested as Record<string, unknown>);
  }
}
