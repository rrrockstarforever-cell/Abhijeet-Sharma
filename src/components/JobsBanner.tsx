// Floating background-job banner (PARITY sections 1 / 5).
// Reads the shared job registry, so OCR / page-note / indexing jobs keep running
// when the user changes screens. Every running job has a real Stop button.
import React from 'react';
import { Loader2, Square, CheckCircle2, AlertCircle, X, Wrench } from 'lucide-react';
import { useStudyJobs, stopJob, dismissJob, clearFinishedJobs } from '../utils/jobRegistry.ts';

export const JobsBanner: React.FC = () => {
  const jobs = useStudyJobs();
  if (jobs.length === 0) return null;

  const running = jobs.filter((j) => j.status === 'running');
  const finished = jobs.filter((j) => j.status !== 'running');
  const visible = [...running, ...finished.slice(0, 3)];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2">
      <div className="flex items-center justify-between bg-[#001432] text-white rounded-t-xl px-3 py-2 border border-[#13294b] shadow-lg">
        <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-[#8ff3f4]" /> Background tasks
          {running.length > 0 && <span className="text-amber-300">({running.length} running)</span>}
        </span>
        {finished.length > 0 && (
          <button
            onClick={clearFinishedJobs}
            className="text-[10px] font-semibold text-slate-300 hover:text-white underline"
          >
            Clear finished
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl shadow-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
        {visible.map((job) => (
          <div key={job.id} className="p-2.5 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-slate-800 truncate flex items-center gap-1.5">
                  {job.status === 'running' && <Loader2 className="w-3 h-3 text-[#0f8b8d] animate-spin shrink-0" />}
                  {job.status === 'done' && <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />}
                  {job.status === 'error' && <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />}
                  {job.status === 'stopped' && <Square className="w-3 h-3 text-slate-400 shrink-0" />}
                  <span className="truncate">{job.label}</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {job.status === 'error' ? job.error : job.detail || (job.status === 'running' ? 'Working…' : job.status)}
                </div>
              </div>
              {job.status === 'running' ? (
                <button
                  onClick={() => stopJob(job.id)}
                  title="Stop this task"
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold hover:bg-rose-100"
                >
                  <Square className="w-2.5 h-2.5" /> Stop
                </button>
              ) : (
                <button
                  onClick={() => dismissJob(job.id)}
                  title="Dismiss"
                  className="shrink-0 p-0.5 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {typeof job.progress === 'number' && job.status === 'running' && (
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-[#0f8b8d] transition-all"
                  style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
