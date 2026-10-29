// GenerationProgress.tsx
// Shows every step of the question pipeline and highlights the current one.
// Order: generating → refining → saved → qa → integrity → done

import React from 'react';

export type GenerationStep =
  | 'idle'
  | 'generating'
  | 'refining'
  | 'saved'
  | 'qa'
  | 'integrity'
  | 'done';

interface GenerationProgressProps {
  step: GenerationStep;
  subtitle?: string | null;
  /** Shown for the completed `saved` step (refinement rewrites the question text). */
  savedDetail?: string | null;
  /** Shown for the completed `qa` step. */
  qaDetail?: string | null;
  /** Shown for the completed `refining` step. */
  refiningDetail?: string | null;
}

// Ordered pipeline steps (idle is the resting state, not part of the bar)
const STEP_ORDER: Exclude<GenerationStep, 'idle'>[] = [
  'generating',
  'refining',
  'saved',
  'qa',
  'integrity',
  'done',
];

const STEP_LABELS: Record<Exclude<GenerationStep, 'idle'>, string> = {
  generating: 'Generating',
  refining: 'Refining',
  saved: 'Saving',
  qa: 'QA review',
  integrity: 'Integrity',
  done: 'Ready',
};

// Tailwind-friendly colours (background + text) per step
const STEP_STYLES: Record<Exclude<GenerationStep, 'idle'>, { dot: string; pill: string }> = {
  generating: { dot: 'bg-orange-500', pill: 'bg-orange-100 text-orange-800 border-orange-200' },
  refining: { dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800 border-amber-200' },
  saved: { dot: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  qa: { dot: 'bg-blue-500', pill: 'bg-blue-100 text-blue-800 border-blue-200' },
  integrity: { dot: 'bg-violet-500', pill: 'bg-violet-100 text-violet-800 border-violet-200' },
  done: { dot: 'bg-emerald-600', pill: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
};

function currentIndex(step: GenerationStep): number {
  if (step === 'idle') return -1;
  return STEP_ORDER.indexOf(step);
}

export const GenerationProgress: React.FC<GenerationProgressProps> = ({ step, subtitle, savedDetail, qaDetail, refiningDetail }) => {
  if (step === 'idle') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full bg-slate-300" />
        Ready
      </div>
    );
  }

  const idx = currentIndex(step);
  // For finished pipeline steps, show what actually happened (e.g. "12 rewritten").
  const detailByStep: Partial<Record<Exclude<GenerationStep, 'idle'>, string | null | undefined>> = {
    refining: refiningDetail,
    saved: savedDetail,
    qa: qaDetail,
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${STEP_STYLES[step as Exclude<GenerationStep, 'idle'>].dot}`} />
        <span className="text-sm font-semibold text-slate-800">
          {STEP_LABELS[step as Exclude<GenerationStep, 'idle'>]}
        </span>
        {subtitle && <span className="text-[10px] text-slate-500">{subtitle}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {STEP_ORDER.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          const style = STEP_STYLES[s];
          const detail = done ? detailByStep[s] : null;
          return (
            <React.Fragment key={s}>
              <span
                className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold transition-colors ${
                  active
                    ? style.pill
                    : done
                      ? 'bg-slate-100 text-slate-500 border-slate-200'
                      : 'bg-white text-slate-400 border-slate-200'
                }`}
                title={detail ?? undefined}
              >
                {done ? '✓ ' : ''}{STEP_LABELS[s]}{detail ? ` · ${detail}` : ''}
              </span>
              {i < STEP_ORDER.length - 1 && <span className="text-slate-300 text-[9px]">→</span>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default GenerationProgress;
