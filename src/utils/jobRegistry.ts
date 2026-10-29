// Background task registry (PARITY sections 1 / 5): long jobs (OCR, whole-book
// page notes, search indexing) run in the UI while the user changes screens. A
// floating banner shows every running task with progress and a real Stop button.
// This is a tiny pub/sub singleton — no fake timeouts, no canned progress.
import { useEffect, useState } from 'react';

export type JobStatus = 'running' | 'done' | 'stopped' | 'error';

export interface StudyJob {
  id: string;
  label: string;
  detail?: string;
  /** 0 – 100, or null when the job cannot report a percentage */
  progress: number | null;
  status: JobStatus;
  startedAt: number;
  error?: string;
}

export interface JobControl {
  id: string;
  /** update label/details/progress */
  update: (patch: { progress?: number | null; detail?: string; label?: string }) => void;
  /** true once the user pressed Stop for this job */
  isCancelled: () => boolean;
  done: (detail?: string) => void;
  fail: (error: string) => void;
}

type Listener = (jobs: StudyJob[]) => void;

const MAX_JOBS = 20;
let jobs: StudyJob[] = [];
const listeners = new Set<Listener>();
const cancelled = new Set<string>();

function emit(): void {
  const snapshot = [...jobs];
  for (const listener of listeners) listener(snapshot);
}

export function startJob(label: string, detail?: string): JobControl {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const job: StudyJob = {
    id,
    label,
    detail,
    progress: 0,
    status: 'running',
    startedAt: Date.now(),
  };
  jobs = [job, ...jobs].slice(0, MAX_JOBS);
  cancelled.delete(id);
  emit();

  const patch = (next: Partial<StudyJob>) => {
    jobs = jobs.map((j) => (j.id === id ? { ...j, ...next } : j));
    emit();
  };

  return {
    id,
    update: ({ progress, detail: d, label: l }) => {
      // Only touch the fields the caller actually provided, so a progress tick
      // never erases the current detail line.
      const next: Partial<StudyJob> = {};
      if (progress !== undefined) next.progress = progress;
      if (d !== undefined) next.detail = d;
      if (l !== undefined) next.label = l;
      if (Object.keys(next).length > 0) patch(next);
    },
    isCancelled: () => cancelled.has(id),
    done: (d) => { patch({ status: 'done', progress: 100, detail: d ?? 'Finished' }); },
    fail: (error) => { patch({ status: 'error', error }); },
  };
}

export function stopJob(id: string): void {
  cancelled.add(id);
  jobs = jobs.map((j) => (j.id === id && j.status === 'running' ? { ...j, status: 'stopped', detail: 'Stopped' } : j));
  emit();
}

export function dismissJob(id: string): void {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}

export function clearFinishedJobs(): void {
  jobs = jobs.filter((j) => j.status === 'running');
  emit();
}

export function getJobs(): StudyJob[] {
  return [...jobs];
}

export function subscribeJobs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: current job list, re-rendering on every registry update. */
export function useStudyJobs(): StudyJob[] {
  const [list, setList] = useState<StudyJob[]>(() => getJobs());
  useEffect(() => subscribeJobs(setList), []);
  return list;
}

/** Cancel tokens are process-wide; clearing them here only affects future jobs. */
export function isJobCancelled(id: string): boolean {
  return cancelled.has(id);
}
