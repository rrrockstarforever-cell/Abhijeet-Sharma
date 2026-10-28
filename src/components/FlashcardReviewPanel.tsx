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
      className={`flex-1 min-w-[68px] px-2 py-1.5 rounded-lg border text-[10px] font-bold ${className}`}
    >
      <span className="block">{label}</span>
      <span className="block text-[9px] font-mono font-normal opacity-80">
        {schedule ? previewLabel(schedule, rating) : '—'}
      </span>
    </button>
  );

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Clock3 className="w-4 h-4 text-amber-500" /> Spaced review
        </h3>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
          queue.length > 0
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {queue.length} due now
        </span>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 pb-2 border-b border-slate-100">
        <span>{activeCount} card{activeCount === 1 ? '' : 's'} in deck{suspended.length > 0 ? ` · ${suspended.length} paused` : ''}</span>
        <span className="font-mono">
          {next ? `next ${formatDueIn(next)}` : queue.length ? 'all due now' : 'no upcoming'}
        </span>
      </div>

      {rated && (
        <div className="mt-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-800 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Rated — next due {formatDueIn(rated.next)}.</span>
        </div>
      )}

      {!current && (
        <div className="mt-3 text-[11px] text-slate-500 leading-relaxed flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            {all.length === 0
              ? 'No cards yet. Save a highlight, an AI note, or capture a mistake — it becomes a review card automatically.'
              : activeCount === 0
                ? 'Every card in your deck is removed from review. Restore one below to bring it back.'
                : 'Nothing is due right now. Your next card is scheduled for later.'}
          </span>
        </div>
      )}

      {current && schedule && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {sourceLabel(current.card)}
            </span>
            <span className="text-[10px] font-semibold text-[#00696b]">{current.card.subject}</span>
            <span className="text-[10px] text-slate-500 truncate">{current.card.topic}</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-800 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
            {current.card.front}
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full py-2 rounded-lg bg-[#001432] text-white text-[11px] font-bold flex items-center justify-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5 text-[#8ff3f4]" /> Reveal answer
            </button>
          ) : (
            <>
              <div className="p-3 rounded-xl bg-teal-50/60 border border-[#0f8b8d]/25 text-[11px] text-slate-800 leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap">
                {current.card.back}
              </div>
              {current.card.docId && current.card.page && onOpenPage && (
                <button
                  onClick={() => onOpenPage(current.card.docId!, current.card.page!)}
                  className="text-[10px] font-bold text-[#0f8b8d] underline"
                >
                  Open source page {current.card.page}
                </button>
              )}
              <div className="flex flex-wrap gap-1.5">
                {ratingChip('again', 'Again', 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100')}
                {ratingChip('hard', 'Hard', 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100')}
                {ratingChip('good', 'Good', 'bg-teal-50 border-[#0f8b8d]/30 text-[#00696b] hover:bg-teal-100')}
                {ratingChip('easy', 'Easy', 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100')}
              </div>
            </>
          )}

          <div className="flex items-center justify-between text-[10px]">
            <button
              onClick={() => {
                reviewLater(current.card.key);
                refresh();
              }}
              className="font-semibold text-slate-600 hover:text-[#0f8b8d] flex items-center gap-1"
            >
              <CalendarClock className="w-3 h-3" /> Review later (tomorrow)
            </button>
            <button
              onClick={() => {
                removeFromReview(current.card.key);
                refresh();
              }}
              className="font-semibold text-slate-500 hover:text-rose-600 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Remove from review
            </button>
          </div>

          <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
            <span>reps {schedule.reps} · lapses {schedule.lapses} · ease {schedule.ease.toFixed(2)}</span>
            <span>{formatDueIn(schedule.due)}</span>
          </div>
        </div>
      )}

      {suspended.length > 0 && (
        <div className="mt-3 pt-2 border-t border-slate-100">
          <button
            onClick={() => setShowSuspended((v) => !v)}
            className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <Layers className="w-3 h-3" /> {suspended.length} removed from review
            {showSuspended ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showSuspended && (
            <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
              {suspended.map(({ card }) => (
                <div key={card.key} className="flex items-center justify-between gap-2 text-[10px] text-slate-600">
                  <span className="truncate">{card.front.slice(0, 60)}</span>
                  <button
                    onClick={() => {
                      restoreToReview(card.key);
                      refresh();
                    }}
                    className="shrink-0 font-bold text-[#0f8b8d] flex items-center gap-0.5"
                  >
                    <RotateCcw className="w-2.5 h-2.5" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {all.length === 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
          <Brain className="w-3 h-3" /> Cards come from your real notes — nothing is preloaded.
        </div>
      )}
    </div>
  );
};
