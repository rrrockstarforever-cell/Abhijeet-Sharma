// Real spaced-repetition review panel (PARITY section 9 / 12).
// - Again / Hard / Good / Easy ratings with the actual next interval preview
// - Reveal, due-now count, next-due time, Review later, Remove from review
// - Source tag (Notes / AI notes / PDF notes / Mistake notebook)
// Scheduling lives in utils/flashcardStore.ts; this panel never invents due dates.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Brain, Clock3, RotateCcw, Eye, CalendarClock, Trash2, CheckCircle2, Layers, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  buildReviewCards,
  dueReviewCards,
  formatDueIn,
  nextDueAt,
  previewLabel,
  rateCard,
  removeFromReview,
  restoreToReview,
  reviewLater,
  sourceLabel,
  loadSchedules,
  type ReviewCard,
  type ReviewRating,
} from '../utils/flashcardStore.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';

interface FlashcardReviewPanelProps {
  /** compact panel for the notebook rail */
  compact?: boolean;
  onOpenPage?: (docId: string, page: number) => void;
}

export const FlashcardReviewPanel: React.FC<FlashcardReviewPanelProps> = ({ compact, onOpenPage }) => {
  const [refreshToken, setRefreshToken] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [showSuspended, setShowSuspended] = useState(false);
  const [rated, setRated] = useState<{ card: ReviewCard; next: number } | null>(null);

  const refresh = () => {
    setRevealed(false);
    setRated(null);
    setRefreshToken((t) => t + 1);
  };

  // New highlights / captures / imported backups must appear in the deck even while
  // this panel stays mounted (the stores only notify through the shared event bus).
  useEffect(() => subscribeDataChanged(() => setRefreshToken((t) => t + 1)), []);

  const { queue, all, next } = useMemo(() => {
    void refreshToken;
    return {
      queue: dueReviewCards(),
      all: buildReviewCards(),
      next: nextDueAt(),
    };
  }, [refreshToken]);

  const current = queue[0] ?? null;
  const schedule = current?.schedule;
  const suspended = useMemo(() => {
    void refreshToken;
    const schedules = loadSchedules();
    return all.filter(({ card }) => schedules[card.key]?.suspended);
  }, [all, refreshToken]);
  const activeCount = Math.max(0, all.length - suspended.length);

  const rate = (rating: ReviewRating) => {
    if (!current) return;
    const updated = rateCard(current.card.key, rating);
    setRated({ card: current.card, next: updated.due });
    setRevealed(false);
    setRefreshToken((t) => t + 1);
  };

  const ratingChip = (rating: ReviewRating, label: string, className: string) => (
    <button
      key={rating}
      onClick={() => rate(rating)}
      className={`group flex-1 min-w-[68px] ${compact ? 'min-h-[36px] px-2 py-1.5' : 'min-h-[44px] px-3 py-2'} rounded-[12px] border text-[10px] font-medium transition-all duration-150 hover:-translate-y-0.5 hover:focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 active:translate-y-0 dark:dark:hover:dark:focus-visible: focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-offset-[#1A1A22] ${className}`}
    >
      <span className="block">{label}</span>
      <span className="mt-0.5 block text-[9px] font-mono font-normal opacity-90">
        {schedule ? previewLabel(schedule, rating) : '—'}
      </span>
    </button>
  );

  return (
    <div className={`relative overflow-hidden rounded-[20px] border     dark:${compact ? 'p-3' : 'p-5'}`}>
      <div className="relative mb-3 overflow-hidden rounded-[16px] border   p-3  ">
        {!compact && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.12]"
            style={{
              backgroundImage: 'repeating-linear-gradient(135deg, #14110F 0 1px, transparent 1px 8px)',
              maskImage: 'radial-gradient(circle at center, transparent 0 38%, black 72%)',
              WebkitMaskImage: 'radial-gradient(circle at center, transparent 0 38%, black 72%)',
            }}
          />
        )}
        <div className="relative flex items-start justify-between gap-2">
          <div>
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border   px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em]    ">
              <Clock3 className="h-3 w-3  " /> Mission
            </div>
            <h3 className="font-['Cormorant_Garamond'] text-lg font-medium leading-tight  ">
              Spaced review
            </h3>
          </div>
          <div className={`shrink-0 rounded-[14px] border  px-3 py-1.5 text-center  dark:${queue.length > 0 ? ' ' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100'}`}>
            <span className="block font-[''] text-lg leading-none tracking-wider">{queue.length} DUE NOW</span>
            <span className="mt-0.5 block text-[8px] font-medium uppercase tracking-widest opacity-80">
              {queue.length > 0 ? 'clear the queue' : 'all clear'}
            </span>
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
          <span className="rounded-full border   px-2 py-0.5    ">
            {activeCount} active card{activeCount === 1 ? '' : 's'}
          </span>
          {suspended.length > 0 && (
            <span className="rounded-full border   px-2 py-0.5    ">
              {suspended.length} paused
            </span>
          )}
          <span className="rounded-full border   px-2 py-0.5 font-mono    ">
            {next ? `next ${formatDueIn(next)}` : queue.length ? 'all due now' : 'no upcoming'}
          </span>
        </div>
      </div>

      {rated && (
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-[10px] border   px-2.5 py-1 font-[''] text-sm leading-none tracking-wider   dark:">
            RATED
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-semibold  ">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> next due {formatDueIn(rated.next)}
          </span>
        </div>
      )}

      {!current && (
        <div className={`mt-3 rounded-[14px] border     dark:${compact ? 'p-2.5' : 'p-3.5'}`}>
          <div className="mb-1 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            <span className="text-[9px] font-medium uppercase tracking-[0.16em]  ">
              {all.length === 0 ? 'No cards yet' : activeCount === 0 ? 'Deck paused' : 'No due cards'}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed  ">
            {all.length === 0
              ? 'No cards yet. Save a highlight, an AI note, or capture a mistake — it becomes a review card automatically.'
              : activeCount === 0
                ? 'Every card in your deck is removed from review. Restore one below to bring it back.'
                : 'Nothing is due right now. Your next card is scheduled for later.'}
          </p>
        </div>
      )}

      {current && schedule && (
        <div className={`${compact ? 'mt-2.5 space-y-2' : 'mt-3 space-y-3'}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border   px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider    ">
              {sourceLabel(current.card)}
            </span>
            <span className="rounded-full border   px-2 py-0.5 text-[10px] font-semibold    ">
              {current.card.subject}
            </span>
            <span className="truncate rounded-full border   px-2 py-0.5 text-[10px]    ">
              {current.card.topic}
            </span>
          </div>

          <div className={`relative rounded-[14px] border     dark:${compact ? 'p-2.5' : 'p-3.5'}`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] font-medium uppercase tracking-[0.16em]  ">Question</span>
              {!compact && <span className="h-1.5 w-1.5 rounded-full  " />}
            </div>
            <div className={`overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed   ${compact ? 'max-h-32' : 'max-h-40'}`}>
              {current.card.front}
            </div>
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className={`group flex w-full items-center justify-center gap-2 rounded-[16px] font-medium  transition-all duration-150 hover:-translate-y-0.5 hover:scale-[1.01] hover:focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 dark:dark:hover:dark:focus-visible: focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-offset-[#1A1A22] ${compact ? 'min-h-[40px] px-3 py-2 text-[11px]' : 'min-h-[44px] px-4 py-2.5 text-[12px]'}`}
            >
              <Eye className="h-4 w-4 " /> Reveal answer
            </button>
          ) : (
            <>
              <div className={`relative rounded-[14px] border     dark:${compact ? 'p-2.5' : 'p-3.5'}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[9px] font-medium uppercase tracking-[0.16em]  ">Answer</span>
                  <span className="h-1.5 w-1.5 rounded-full  " />
                </div>
                <div className={`overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed   ${compact ? 'max-h-36' : 'max-h-44'}`}>
                  {current.card.back}
                </div>
              </div>
              {current.card.docId && current.card.page && onOpenPage && (
                <button
                  onClick={() => onOpenPage(current.card.docId!, current.card.page!)}
                  className="inline-flex items-center gap-1.5 text-[10px] font-medium  underline decoration-2 underline-offset-4 transition-colors  focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2   dark:focus-visible: focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-offset-[#1A1A22]"
                >
                  Open source page {current.card.page}
                </button>
              )}
              <div className="flex flex-wrap gap-1.5">
                {ratingChip('again', 'Again', 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:border-rose-400/60 dark:text-rose-100 dark:hover:bg-rose-900/60')}
                {ratingChip('hard', 'Hard', 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:border-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-900/60')}
                {ratingChip('good', 'Good', 'bg-teal-50   hover:bg-teal-100 dark:bg-teal-950/40   dark:hover:bg-teal-900/60')}
                {ratingChip('easy', 'Easy', 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-400/60 dark:text-emerald-100 dark:hover:bg-emerald-900/60')}
              </div>
            </>
          )}

          <div className={`grid gap-2 border-t  pt-2  ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
            <button
              onClick={() => {
                reviewLater(current.card.key);
                refresh();
              }}
              className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-[12px] border   px-2 py-1.5 text-[10px] font-semibold  transition-colors  focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2     dark:focus-visible: focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-offset-[#1A1A22]"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Postpone to tomorrow
            </button>
            <button
              onClick={() => {
                removeFromReview(current.card.key);
                refresh();
              }}
              className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-[12px] border border-rose-300 bg-rose-50 px-2 py-1.5 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-900/60 dark:focus-visible:ring-rose-400 focus-visible:ring-offset-[#FAF3E0] dark:focus-visible:ring-offset-[#1A1A22]"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove from review
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 text-[9px] font-mono  ">
            <span>reps {schedule.reps} · lapses {schedule.lapses} · ease {schedule.ease.toFixed(2)}</span>
            <span>{formatDueIn(schedule.due)}</span>
          </div>
        </div>
      )}

      {suspended.length > 0 && (
        <div className="mt-3 rounded-[14px] border   p-2  ">
          <button
            onClick={() => setShowSuspended((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-[10px] px-1 py-1 text-[10px] font-semibold  transition-colors  focus-visible:outline-none focus-visible:ring-2 focus-visible:   dark:focus-visible:"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> {suspended.length} removed from review
            </span>
            {showSuspended ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showSuspended && (
            <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto border-t  pt-1.5 ">
              {suspended.map(({ card }) => (
                <div key={card.key} className="flex items-center justify-between gap-2 rounded-[10px]  px-2 py-1.5 text-[10px]   ">
                  <span className="truncate">{card.front.slice(0, 60)}</span>
                  <button
                    onClick={() => {
                      restoreToReview(card.key);
                      refresh();
                    }}
                    className="flex shrink-0 items-center gap-0.5 rounded-full border   px-2 py-0.5 font-medium  transition-colors hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:    dark:hover:bg-teal-900/60 dark:focus-visible:"
                  >
                    <RotateCcw className="h-2.5 w-2.5" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {all.length === 0 && (
        <div className="mt-3 flex items-center gap-1.5 rounded-[10px] border   px-2 py-1.5 text-[10px]    ">
          <Brain className="h-3 w-3 shrink-0" /> Cards come from your real notes — nothing is preloaded.
        </div>
      )}
    </div>
  );
};
