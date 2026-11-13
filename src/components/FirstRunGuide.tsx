import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppView, ExamType } from '../types.ts';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Info,
  KeyRound,
  ListChecks,
  Sparkles,
  X,
} from 'lucide-react';

interface GuideStep {
  title: string;
  shortTitle: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  view?: AppView;
  note?: string;
}

export const FirstRunGuide: React.FC<{
  exam: ExamType;
  onNavigate: (v: AppView) => void;
  onClose: () => void;
}> = ({ exam, onNavigate, onClose }) => {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = 'first-run-guide-title';
  const descriptionId = 'first-run-guide-step-description';

  const steps = useMemo<GuideStep[]>(() => {
    const examName = exam === 'NEET_PG' ? 'NEET PG' : 'INI-CET';

    return [
      {
        title: `Pick your ${examName} exam date`,
        shortTitle: 'Exam',
        body: `Find the exam card in the sidebar. It shows which exam you are preparing for and the date you have set. Choose your exam and add the date now so reminders and daily plans know your deadline.`,
        icon: CalendarDays,
      },
      {
        title: 'Build your first practice set',
        shortTitle: 'Practice',
        body: 'Start with questions you can already practise from the built-in bank. Pick one subject or a mixed set, answer a few, and the app will start showing your weak areas. Your first set is the quickest way to make every screen useful.',
        icon: ClipboardList,
        view: 'practice',
      },
      {
        title: 'Add your own notes (optional)',
        shortTitle: 'Notes',
        body: 'If you already keep notes, bring them into the PDF reader. It keeps everything in one place while you practise. This is optional, so feel free to skip it.',
        icon: FileText,
        view: 'pdf-reader',
      },
      {
        title: 'Connect an AI provider (optional)',
        shortTitle: 'AI',
        body: 'AI-written questions and the AI tutor need a provider key that you add yourself. Practice with the existing question bank works without any key. Add one in Settings only if you want the extra AI tools.',
        icon: KeyRound,
        view: 'settings',
      },
      {
        title: 'Your daily plan',
        shortTitle: 'Plan',
        body: 'Your daily plan puts practice, reviews, and syllabus topics in one place. It changes as you study and shows what to do next. Check it each morning and keep the streak going.',
        icon: ListChecks,
        view: 'study-plan',
        note: `Why do I see 'No data'? Screens fill up after your first practice set. Each empty screen also tells you what to do next, so follow the button on that screen.`,
      },
    ];
  }, [exam]);

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;
  const progressPercent = Math.round(((index + 1) / steps.length) * 100);
  const Icon = step.icon;

  const goBack = () => setIndex((current) => Math.max(0, current - 1));
  const goNext = () => setIndex((current) => Math.min(steps.length - 1, current + 1));

  const handleTakeMeThere = () => {
    const targetView = step.view;
    if (!targetView) return;
    onNavigate(targetView);
    onClose();
  };

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goBack();
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }

    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const activeIsInside = active ? dialog.contains(active) : false;

    if (!activeIsInside) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-slate-950/40 dark:bg-black/70"
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white text-slate-900 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <header className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#0f8b8d]/30 bg-[#0f8b8d]/10 text-[#0f8b8d] dark:border-[#0f8b8d]/40 dark:bg-[#0f8b8d]/20 dark:text-[#8ff3f4]"
                aria-hidden="true"
              >
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-xl">
                  Welcome to Pulse Med
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  A quick 5-step setup. You can skip it and come back later.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close first-run guide"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white dark:focus-visible:ring-offset-slate-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <nav
          aria-label="First-run guide steps"
          className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40 sm:px-6"
        >
          <ol className="flex flex-wrap items-center gap-2">
            {steps.map((guideStep, guideIndex) => {
              const isActive = guideIndex === index;
              return (
                <li key={guideStep.title}>
                  <button
                    type="button"
                    onClick={() => setIndex(guideIndex)}
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={`Step ${guideIndex + 1}: ${guideStep.title}`}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
                      isActive
                        ? 'border-[#0f8b8d] bg-[#0f8b8d] text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white'
                    }`}
                  >
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] leading-none ${
                        isActive
                          ? 'border-white/60 bg-white/20 text-white'
                          : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                      aria-hidden="true"
                    >
                      {guideIndex + 1}
                    </span>
                    <span className="hidden sm:inline">{guideStep.shortTitle}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-3">
            <div className="flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span>
                Step {index + 1} of {steps.length}
              </span>
              <span className="font-semibold text-[#0f8b8d] dark:text-[#8ff3f4]">{progressPercent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="First-run guide progress"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={index + 1}
              className="mt-2 h-3 overflow-hidden rounded-full border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-800"
            >
              <div
                className="h-full bg-[#0f8b8d] motion-safe:transition-[width] motion-safe:duration-300 dark:bg-[#2fb8ba]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </nav>

        <div className="flex-1 overflow-y-auto bg-white px-4 py-5 dark:bg-slate-900 sm:px-6">
          <div className="flex items-start gap-4">
            <span
              className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#0f8b8d]/20 bg-[#0f8b8d]/10 text-[#0f8b8d] shadow-sm dark:border-[#0f8b8d]/30 dark:bg-[#0f8b8d]/20 dark:text-[#8ff3f4]"
              aria-hidden="true"
            >
              <Icon className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <h3
                className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl"
                aria-live="polite"
              >
                {step.title}
              </h3>
              <p
                id={descriptionId}
                className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base"
              >
                {step.body}
              </p>

              {step.note ? (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                  <p className="text-sm leading-6">{step.note}</p>
                </div>
              ) : null}

              {step.view ? (
                <button
                  type="button"
                  onClick={handleTakeMeThere}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#00696b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
                >
                  Take me there
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-950/40 sm:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
            >
              Skip guide
            </button>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={goBack}
                disabled={isFirst}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>

              {isLast ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#00696b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
                >
                  Finish
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#00696b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};
