import React, { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Bookmark,
  Search,
  Download,
  Plus,
  Sparkles,
  Brain,
  AlertTriangle,
  BookOpen,
  Clock,
  Trash2,
  Eye,
  EyeOff,
  RotateCcw
} from 'lucide-react';
import { AppView } from '../types.ts';
import {
  listUserHighlights,
  addUserHighlight,
  updateUserHighlight,
  removeUserHighlight,
  UserHighlight
} from '../utils/userHighlightsStore.ts';

interface HighlightsSavedViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
}

/* ---------------------------------------------------------------------------
 * FSRS-style schedule — persisted in localStorage under 'pulse.srs.v1'
 * keyed by highlight id. Ratings: Again / Hard / Good / Easy.
 * ------------------------------------------------------------------------- */

type Rating = 'Again' | 'Hard' | 'Good' | 'Easy';

interface SrsCard {
  id: string;
  /** ISO datetime the card is next due */
  due: string;
  /** current interval in days */
  intervalDays: number;
  /** FSRS difficulty 1 (easy) .. 10 (hard) */
  difficulty: number;
  reps: number;
  lapses: number;
  lastRating?: Rating;
  lastRatedAt?: string;
  /** "Remove from review" — card stays saved but leaves the deck */
  suspended?: boolean;
}

const SRS_KEY = 'pulse.srs.v1';
const MINUTE_DAYS = 1 / 1440;

function readSrs(): Record<string, SrsCard> {
  try {
    const raw = localStorage.getItem(SRS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, SrsCard>)
      : {};
  } catch {
    return {};
  }
}

function writeSrs(map: Record<string, SrsCard>): void {
  try {
    localStorage.setItem(SRS_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Could not save SRS schedule', err);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** FSRS-style next interval (days) for a card + rating. */
function nextIntervalDays(card: SrsCard | null, rating: Rating): number {
  const first = !card || card.reps === 0;
  switch (rating) {
    case 'Again':
      return 10 * MINUTE_DAYS; // relearn in ~10 minutes
    case 'Hard':
      return first ? 1 : Math.max(1, card!.intervalDays * 1.2);
    case 'Good':
      return first ? 3 : Math.max(3, card!.intervalDays * 2.5);
    case 'Easy':
      return first ? 7 : Math.max(7, card!.intervalDays * 4);
  }
}

function nextDifficulty(card: SrsCard | null, rating: Rating): number {
  const d = card ? card.difficulty : 5;
  switch (rating) {
    case 'Again':
      return clamp(d + 1, 1, 10);
    case 'Hard':
      return clamp(d + 0.5, 1, 10);
    case 'Good':
      return d;
    case 'Easy':
      return clamp(d - 0.7, 1, 10);
  }
}

function scheduleReview(id: string, rating: Rating): SrsCard {
  const map = readSrs();
  const prev = map[id] || null;
  const interval = nextIntervalDays(prev, rating);
  const card: SrsCard = {
    id,
    due: new Date(Date.now() + interval * 86400000).toISOString(),
    intervalDays: interval,
    difficulty: nextDifficulty(prev, rating),
    reps: rating === 'Again' ? 0 : (prev?.reps || 0) + 1,
    lapses: (prev?.lapses || 0) + (rating === 'Again' ? 1 : 0),
    lastRating: rating,
    lastRatedAt: new Date().toISOString(),
    suspended: false
  };
  map[id] = card;
  writeSrs(map);
  return card;
}

/** "Review later" — defer one day without changing the interval or reps. */
function deferReview(id: string): void {
  const map = readSrs();
  const prev = map[id];
  map[id] = {
    id,
    due: new Date(Date.now() + 86400000).toISOString(),
    intervalDays: prev?.intervalDays ?? 0,
    difficulty: prev?.difficulty ?? 5,
    reps: prev?.reps ?? 0,
    lapses: prev?.lapses ?? 0,
    lastRating: prev?.lastRating,
    lastRatedAt: prev?.lastRatedAt,
    suspended: false
  };
  writeSrs(map);
}

/** "Remove from review" — suspend; the highlight itself stays saved. */
function suspendReview(id: string): void {
  const map = readSrs();
  const prev = map[id];
  map[id] = {
    id,
    due: prev?.due ?? new Date().toISOString(),
    intervalDays: prev?.intervalDays ?? 0,
    difficulty: prev?.difficulty ?? 5,
    reps: prev?.reps ?? 0,
    lapses: prev?.lapses ?? 0,
    lastRating: prev?.lastRating,
    lastRatedAt: prev?.lastRatedAt,
    suspended: true
  };
  writeSrs(map);
}

function resumeReview(id: string): void {
  const map = readSrs();
  const prev = map[id];
  if (!prev) return;
  map[id] = { ...prev, suspended: false, due: new Date().toISOString() };
  writeSrs(map);
}

/* --------------------------- formatting helpers --------------------------- */

function formatSpan(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))} min`;
  if (days < 1) return `${Math.round(days * 24)} hr`;
  if (days < 30) return `${Math.round(days)} d`;
  return `${(days / 30).toFixed(1)} mo`;
}

function dueLabel(due: string): string {
  const delta = new Date(due).getTime() - Date.now();
  if (delta <= 0) return 'Due now';
  return `in ${formatSpan(delta / 86400000)}`;
}

function dueDateText(due: string): string {
  try {
    return new Date(due).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return due;
  }
}

const KIND_LABEL: Record<string, string> = {
  manual: 'My note',
 'ai-reply': 'AI Tutor note',
  pdf: 'PDF highlight'
};

/* -------------------------------- component ------------------------------- */

export const HighlightsSavedView: React.FC<HighlightsSavedViewProps> = ({ onNavigate }) => {
  const reduceMotion = useReducedMotion();
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [ratedNote, setRatedNote] = useState<string | null>(null);
  const [deckIndex, setDeckIndex] = useState<number>(0);
  const [customPearlText, setCustomPearlText] = useState<string>('');

  const [modalSubject, setModalSubject] = useState<string>('');
  const [modalConcept, setModalConcept] = useState<string>('');
  const [modalNote, setModalNote] = useState<string>('');

  const [highlights, setHighlights] = useState<UserHighlight[]>(() => listUserHighlights());
  const [srsVersion, setSrsVersion] = useState<number>(0);

  const refreshHighlights = () => setHighlights(listUserHighlights());
  const bumpSrs = () => setSrsVersion(v => v + 1);

  useEffect(() => {
    setRevealed(false);
  }, [deckIndex, srsVersion]);

  const srs = useMemo(() => {
    void srsVersion;
    return readSrs();
  }, [srsVersion]);

  /* Deck: overdue + never-rated cards, in due order. Suspended cards stay out. */
  const dueDeck = useMemo(() => {
    const now = Date.now();
    const overdue = highlights
      .filter(h => {
        const rec = srs[h.id];
        return !!rec && !rec.suspended && new Date(rec.due).getTime() <= now;
      })
      .sort((a, b) => new Date(srs[a.id].due).getTime() - new Date(srs[b.id].due).getTime());
    const fresh = highlights.filter(h => !srs[h.id]);
    return [...overdue, ...fresh];
  }, [highlights, srs]);

  const currentCard = dueDeck[Math.min(deckIndex, Math.max(0, dueDeck.length - 1))] || null;
  const currentRec = currentCard ? srs[currentCard.id] : undefined;
  const isNewCard = !!currentCard && !currentRec;
  const dueNowCount = dueDeck.length;
  const nextDue = useMemo(() => {
    const upcoming = highlights
      .map(h => srs[h.id])
      .filter((r): r is SrsCard => !!r && !r.suspended && new Date(r.due).getTime() > Date.now())
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
    return upcoming[0] || null;
  }, [highlights, srs]);

  const inReviewCount = highlights.filter(h => {
    const rec = srs[h.id];
    return !!rec && !rec.suspended;
  }).length;
  const newThisWeekCount = highlights.filter(h => {
    const created = new Date(h.createdAt).getTime();
    return Date.now() - created < 7 * 86400000;
  }).length;

  const suspendedHighlights = useMemo(
    () => highlights.filter(h => srs[h.id]?.suspended),
    [highlights, srs]
  );

  /* Tag filter chips derived from real saved highlights. */
  const tagTabs = useMemo(() => {
    const counts = new Map<string, number>();
    highlights.forEach(h =>
      h.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1))
    );
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([tag, count]) => ({ id: tag, label: `${tag} (${count})` }));
    return [{ id: 'ALL', label: `All Highlights (${highlights.length})` }, ...top];
  }, [highlights]);

  const filteredHighlights = useMemo(() => {
    return highlights.filter(h => {
      if (selectedTag !== 'ALL' && !h.tags.includes(selectedTag)) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          h.subject.toLowerCase().includes(q) ||
          h.subtopic.toLowerCase().includes(q) ||
          h.quote.toLowerCase().includes(q) ||
          (h.memoryAnchor && h.memoryAnchor.toLowerCase().includes(q)) ||
          (h.note && h.note.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [highlights, selectedTag, searchQuery]);

  const saveManualHighlight = (input: {
    subject: string;
    subtopic: string;
    quote: string;
    note?: string;
  }): void => {
    addUserHighlight({
      kind: 'manual',
      subject: input.subject,
      subtopic: input.subtopic,
      yieldTier: 'HIGH',
      sourceContext: 'Personal note',
      citation: 'Personal note',
      quote: input.quote,
      memoryAnchor: input.note,
      note: input.note,
      tags: ['note'],
      srsIntervalDays: 1,
      lastReviewed: new Date().toISOString().slice(0, 10)
    });
    refreshHighlights();
    bumpSrs();
  };

  const handleExportTsv = (): void => {
    if (highlights.length === 0) {
      alert('Nothing to export yet — save a highlight first.');
      return;
    }
    const esc = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
    const header = ['Front', 'Back', 'Subject', 'Subtopic', 'Citation', 'Tags'].join('\t');
    const rows = highlights.map(h =>
      [esc(h.quote), esc(h.memoryAnchor || h.note || ''), esc(h.subject), esc(h.subtopic), esc(h.citation), esc(h.tags.join(','))].join('\t')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pulse-highlights.tsv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRate = (rating: Rating): void => {
    if (!currentCard) return;
    const card = scheduleReview(currentCard.id, rating);
    // Keep the highlight's own denormalised schedule fields in sync with the SRS store.
    updateUserHighlight(currentCard.id, {
      srsIntervalDays: Math.max(1, Math.round(card.intervalDays)),
      lastReviewed: new Date().toISOString().slice(0, 10)
    });
    setRatedNote(`Scheduled — next review ${dueLabel(card.due)} (${formatSpan(card.intervalDays)} interval).`);
    setRevealed(false);
    setDeckIndex(prev => Math.min(prev, Math.max(0, dueDeck.length - 2)));
    refreshHighlights();
    bumpSrs();
  };

  const handleReviewLater = (): void => {
    if (!currentCard) return;
    deferReview(currentCard.id);
    setRatedNote("Deferred to tomorrow — the card is out of today's deck.");
    setRevealed(false);
    setDeckIndex(prev => Math.min(prev, Math.max(0, dueDeck.length - 2)));
    bumpSrs();
  };

  const handleRemoveFromReview = (): void => {
    if (!currentCard) return;
    suspendReview(currentCard.id);
    setRatedNote('SUSPENDED — removed from review. Your saved highlight is intact.');
    setRevealed(false);
    setDeckIndex(prev => Math.min(prev, Math.max(0, dueDeck.length - 2)));
    bumpSrs();
  };

  const handleDeleteHighlight = (id: string): void => {
    removeUserHighlight(id);
    const map = readSrs();
    delete map[id];
    writeSrs(map);
    refreshHighlights();
    bumpSrs();
  };

  const ratingPreview = (rating: Rating): string => formatSpan(nextIntervalDays(currentRec || null, rating));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <section className="relative overflow-hidden rounded-[20px] border border-[#13294b] bg-[#001432] text-white shadow-md">
        <div className=" pointer-events-none absolute inset-0 bg-[#0f8b8d] opacity-[0.10] dark:opacity-[0.12]" aria-hidden="true" />
        <div className=" pointer-events-none absolute inset-0 bg-[#8ff3f4] opacity-5 [mask-image:radial-gradient(ellipse_at_center,transparent_35%,black_75%)]" aria-hidden="true" />
        <div className="relative z-10 space-y-5 p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-xl border border-[#0f8b8d]/30 bg-[#0f8b8d]/20 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[#8ff3f4]">
                <Bookmark className="h-3.5 w-3.5" /> Review Arena
              </div>
              <h1 className=" text-3xl font-medium tracking-tight md:text-4xl">
                Saved Highlights & Memory Anchors
              </h1>
              <p className="max-w-2xl text-sm text-slate-300">
                Train recall from your clinical captures. Due now, active reviews, and new anchors are counted from the same SRS deck.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleExportTsv}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[16px] border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 text-xs font-medium text-white transition-colors hover:bg-slate-700"
              >
                <Download className="h-4 w-4" />
                Export Anki TSV
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[16px] border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2.5 text-xs font-medium text-white transition-all hover:bg-[#00696b] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible: dark:focus-visible:"
              >
                <Plus className="h-4 w-4" />
                Add Clinical Pearl
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-[16px] border border-white/10 bg-white/5 p-3 ">
              <div className=" text-2xl tracking-wide">{dueNowCount}</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-300">Due now</div>
            </div>
            <div className="rounded-[16px] border border-white/10 bg-white/5 p-3 ">
              <div className=" text-2xl tracking-wide">{inReviewCount}</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-300">In review</div>
            </div>
            <div className="rounded-[16px] border border-white/10 bg-white/5 p-3 ">
              <div className=" text-2xl tracking-wide">{newThisWeekCount}</div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-300">New this week</div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-[16px] border border-white/10 bg-slate-900/40 p-3 sm:flex-row sm:items-center">
            <div className="text-xs font-semibold text-slate-200">
              {nextDue ? <>Next due {dueLabel(nextDue.due)} · {dueDateText(nextDue.due)}</> : dueNowCount > 0 ? 'Review deck ready.' : 'Save a highlight to start a review deck.'}
            </div>
            <button
              onClick={() => {
                const el = document.getElementById('pm-review-card');
                el?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
                (el as HTMLElement | null)?.focus();
              }}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[16px] border border-[#0f8b8d] bg-[#0f8b8d] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#00696b] focus-visible:outline-none focus-visible:ring-2 focus-visible: dark:focus-visible:"
            >
              <Brain className="h-4 w-4" /> Start Review
            </button>
          </div>

          {/* Filter Bar & Search */}
          <div className="flex flex-col items-center justify-between gap-3 pt-1 sm:flex-row">
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:pb-0">
              {tagTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTag(tab.id)}
                  className={`min-h-[36px] whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedTag === tab.id
                      ? 'border-[#0f8b8d] bg-[#0f8b8d] text-white'
                    : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search your saved highlights..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="min-h-[40px] w-full rounded-xl border border-slate-700 bg-slate-900/80 py-1.5 pl-9 pr-3 text-xs text-white placeholder-slate-400 focus:border-[#0f8b8d] focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/40 dark:focus:"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Highlights Cards */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex flex-col justify-between gap-2 rounded-[16px] border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm sm:flex-row sm:items-center">
            <div className="font-semibold text-slate-800">
              <span className="">{filteredHighlights.length}</span> saved highlight{filteredHighlights.length === 1 ? '' : 's'} shown
              {(selectedTag !== 'ALL' || searchQuery.trim() !== '') && (
                <span> · {selectedTag !== 'ALL' ? `tag: ${selectedTag}` : 'all tags'}{searchQuery.trim() ? ` · search: “${searchQuery.trim()}”` : ''}</span>
              )}
            </div>
            {(selectedTag !== 'ALL' || searchQuery.trim() !== '') && (
              <button
                onClick={() => { setSelectedTag('ALL'); setSearchQuery(''); }}
                className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </button>
            )}
          </div>
          {highlights.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#0f8b8d]/10 mb-3">
                <Bookmark className="w-6 h-6 text-[#0f8b8d]" />
              </div>
              <h3 className="text-base font-medium text-slate-900">Nothing saved yet</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                You have not saved any highlights yet. Save one from the PDF reader, AI tutor, or quick capture box, or tap Add your first highlight.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-semibold rounded-xl transition-colors"
              >
                <Plus className="w-4 h-4" /> Add your first highlight
              </button>
            </div>
          ) : filteredHighlights.length === 0 ? (
            <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 shadow-sm ">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <div className=" text-xl tracking-wide text-slate-800">NO MATCHES</div>
              <p className="mx-auto mt-1 max-w-sm leading-relaxed">
                No saved highlights match this search or filter. Clear it to see your full deck again.
              </p>
              <button
                onClick={() => { setSelectedTag('ALL'); setSearchQuery(''); }}
                className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-[16px] border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </button>
            </div>
          ) : (
            filteredHighlights.map((highlight, index) => {
              const rec = srs[highlight.id];
              const isDue = !!rec && !rec.suspended && new Date(rec.due).getTime() <= Date.now();
              const statusLabel = !rec ? 'New' : rec.suspended ? 'Suspended' : isDue ? 'Due now' : 'Later';
              const statusTone = !rec
                ? 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-200'
                : rec.suspended
                  ? 'border-rose-400/60 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                  : isDue
                    ? 'border-amber-400/70 bg-amber-400/15 text-amber-800 dark:text-amber-200'
                    : 'border-sky-400/60 bg-sky-500/10 text-sky-700 dark:text-sky-200';
              const footerSrs = !rec
                ? 'Not scheduled yet'
                : rec.suspended
                  ? 'Removed from review — saved highlight stays intact'
                  : `Next ${dueLabel(rec.due)} · interval ${formatSpan(rec.intervalDays)}`;
              return (
                <motion.div
                  key={highlight.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut", delay: reduceMotion ? 0 : Math.min(index * 0.03, 0.2) }}
                  className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm transition-all "
                >
                  {/* Card Header */}
                  <div className="p-6 pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#0f8b8d]/10 text-[#0f8b8d] uppercase tracking-wide">
                          {highlight.subject}
                        </span>
                        <span className="text-xs font-semibold text-slate-700">
                          {highlight.subtopic}
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                          {KIND_LABEL[highlight.kind] || 'Saved'}
                        </span>
                      </div>

                      <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 uppercase tracking-wider">
                        {highlight.yieldTier}
                      </span>
                    </div>

                    {/* Source Citation */}
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-4">
                      <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                      <span>{highlight.citation}</span>
                    </div>

                    {/* Quote Box */}
                    <div className="p-4 rounded-xl bg-slate-50 border-l-4 border-[#0f8b8d] text-slate-800 text-xs leading-relaxed font-sans italic">
 "{highlight.quote}"
                    </div>

                    {/* Memory Anchor Box */}
                    {highlight.memoryAnchor && (
                      <div className="mt-4 p-4 rounded-xl bg-amber-50/80 border border-amber-200">
                        <div className="flex items-start gap-2.5">
                          <Brain className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-medium text-amber-900 uppercase tracking-wider">
                              Memory Anchor & Rapid Recall Mnemonic:
                            </div>
                            <p className="text-xs text-amber-800 font-medium mt-1 leading-relaxed">
                              {highlight.memoryAnchor}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Board Trap Alert Box */}
                    {highlight.boardTrapAlert && (
                      <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-medium text-rose-900 uppercase tracking-wider text-[11px]">Board Trap Warning: </span>
                          <span className="text-rose-800 font-medium leading-relaxed">{highlight.boardTrapAlert}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2 font-medium ">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider  ${statusTone}`}>
                        <Clock className="h-3 w-3" /> {statusLabel}
                      </span>
                      <span>{footerSrs}</span>
                      {rec?.suspended && (
                        <button
                          onClick={() => { resumeReview(highlight.id); bumpSrs(); }}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <RotateCcw className="h-3 w-3" /> Restore
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => onNavigate('ai-tutor')}
                        className="text-slate-600  font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Ask AI Tutor
                      </button>
                      <button
                        onClick={() => handleDeleteHighlight(highlight.id)}
                        className="text-slate-400 hover:text-rose-600 font-semibold flex items-center gap-1 transition-colors"
                        title="Delete this saved highlight"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Right Column: Interactive SRS Review Deck & Quick Capture */}
        <div className="lg:col-span-4 space-y-6">
          <div
            id="pm-review-card"
            tabIndex={-1}
            className="relative scroll-mt-24 overflow-hidden rounded-[20px] border border-[#13294b] bg-gradient-to-br from-[#001432] to-[#13294b] p-5 text-white shadow-md outline-none"
          >
            <div className=" pointer-events-none absolute inset-0 bg-[#0f8b8d] opacity-[0.08] dark:opacity-[0.12]" aria-hidden="true" />
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-[#8ff3f4]">
                  <Clock className="h-3.5 w-3.5" /> Review Deck
                </span>
                <span className="rounded-full border border-white/10 bg-slate-800 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-300">
                  {dueNowCount > 0 ? `Due ${dueNowCount}` : 'Deck clear'}
                </span>
              </div>

              {highlights.length === 0 ? (
                <div className="mt-4 rounded-[16px] border border-white/10 bg-slate-900/80 p-4 text-center text-xs text-slate-300">
                  You have not saved any highlights yet. Add one to build your review deck.
                </div>
              ) : currentCard ? (
                <>
                  <div className="mt-4 rounded-[16px] border border-white/10 bg-slate-900/80 p-4 text-xs text-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#8ff3f4]">
                          {currentCard.subject}
                        </span>
                        <span className="text-xs font-medium text-slate-300">{currentCard.subtopic}</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-300">
                          {KIND_LABEL[currentCard.kind] || 'Saved'}
                        </span>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider  ${isNewCard ? 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-200' : 'border-amber-400/70 bg-amber-400/15 text-amber-800 dark:text-amber-200'}`}>
                        <Sparkles className="h-3 w-3" /> {isNewCard ? 'NEW' : 'DUE NOW'}
                      </span>
                    </div>

                    {currentCard.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {currentCard.tags.map(tag => (
                          <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-300">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className="mt-3 text-sm font-medium leading-relaxed text-white">“{currentCard.quote}”</p>

                    {isNewCard && (
                    <div className="mt-2 text-[10px] text-slate-400 italic">
                        New card · no rating has confirmed recall yet.
                      </div>
                    )}

                    {revealed ? (
                    <div className="mt-3 pt-3 border-t border-slate-700">
                        <div className="mb-1 text-lg tracking-wide text-[#8ff3f4]">EXPLANATION</div>
                      <p className="text-slate-200 leading-relaxed">
                          {currentCard.memoryAnchor || currentCard.note || 'No memory anchor or note saved with this highlight yet.'}
                        </p>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRevealed(true)}
                        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[16px] border border-white/10 bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        <Eye className="h-3.5 w-3.5" /> Reveal answer
                      </button>
                    )}
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold text-slate-300">
                      {revealed ? 'Rate recall to set the next due date:' : 'Reveal the answer before rating.'}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {([
                        { label: 'Again', tone: 'rose', preview: ratingPreview('Again') },
                        { label: 'Hard', tone: 'amber', preview: ratingPreview('Hard') },
                        { label: 'Good', tone: 'sky', preview: ratingPreview('Good') },
                        { label: 'Easy', tone: 'emerald', preview: ratingPreview('Easy') }
                      ] as const).map(btn => {
                        const toneCls =
                          btn.tone === 'rose'
                            ? 'text-rose-700 dark:text-rose-200 border-rose-400/60 hover:bg-rose-500/10'
                            : btn.tone === 'amber'
                              ? 'text-amber-800 dark:text-amber-200 border-amber-400/70 hover:bg-amber-400/10'
                              : btn.tone === 'sky'
                                ? 'text-sky-700 dark:text-sky-200 border-sky-400/60 hover:bg-sky-500/10'
                                : 'text-emerald-700 dark:text-emerald-200 border-emerald-400/60 hover:bg-emerald-500/10';
                        return (
                          <button
                            key={btn.label}
                            disabled={!revealed}
                            onClick={() => handleRate(btn.label as Rating)}
                            className={`min-h-[44px] rounded-[16px] border px-2.5 py-2 text-center font-medium  transition-all disabled:cursor-not-allowed disabled:opacity-40 ${toneCls}`}
                          >
                            {btn.label} <span className="block text-[10px] font-normal opacity-80">in {btn.preview}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <button
                      onClick={handleReviewLater}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-white/10 bg-slate-800 px-2.5 py-1 font-medium text-slate-200 hover:bg-slate-700"
                    >
                      <Clock className="h-3.5 w-3.5" /> Review later
                    </button>
                    <button
                      onClick={handleRemoveFromReview}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-rose-400/50 bg-rose-500/10 px-2.5 py-1 font-medium text-rose-700 hover:opacity-90 dark:text-rose-200"
                    >
                      <EyeOff className="h-3.5 w-3.5" /> Remove from review
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-[16px] border border-white/10 bg-slate-900/80 p-4 text-xs text-slate-300">
                  <div className=" text-2xl tracking-wide text-white">DECK CLEAR</div>
                  <div className="mt-1 font-semibold text-slate-200">Nothing due right now.</div>
                  {nextDue && (
                    <div className="mt-1 text-slate-400">
                      Next review {dueLabel(nextDue.due)} — {dueDateText(nextDue.due)}.
                    </div>
                  )}
                </div>
              )}

              {ratedNote && (
                <div className="mt-4 rounded-[16px] border border-[#0f8b8d]/40 bg-[#0f8b8d]/10 p-3 text-center text-[11px] font-medium text-[#8ff3f4]  ">
                  <span className="mr-1 text-base tracking-wide">
                    {ratedNote.toLowerCase().includes('suspend') ? 'SUSPENDED' : ratedNote.toLowerCase().includes('defer') ? 'LATER' : 'DUE NOW'}
                  </span>
                  {ratedNote}
                </div>
              )}
            </div>
          </div>

          {/* Quick Capture Form */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-medium text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#0f8b8d]" /> Quick Pearl Capture
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste or type high-yield board facts from bedside rounds or mock tests
            </p>

            <div className="mt-3 space-y-3">
              <textarea
                value={customPearlText}
                onChange={e => setCustomPearlText(e.target.value)}
                placeholder="e.g. Linezolid causes bone marrow suppression & weak reversible MAO inhibition (risk of serotonin syndrome with SSRIs)..."
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-mono">Saved as your note</span>
                <button
                  onClick={() => {
                    const text = customPearlText.trim();
                    if (!text) return;
                    saveManualHighlight({
                      subject: 'General',
                      subtopic: 'Quick Capture',
                      quote: text
                    });
                    setCustomPearlText('');
                  }}
                  className="px-3.5 py-1.5 bg-[#001432] hover:bg-[#13294b] text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Save Pearl
                </button>
              </div>
            </div>
          </div>

          {/* Suspended Review Management */}
          <div className="rounded-[20px] border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <RotateCcw className="h-4 w-4" /> Suspended Reviews
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Restored cards become due now. Saved highlights stay intact.
            </p>

            {suspendedHighlights.length === 0 ? (
              <div className="mt-4 rounded-[16px] border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500">
                No suspended reviews.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {suspendedHighlights.map(h => (
                  <div key={h.id} className="flex items-center justify-between gap-2 rounded-[16px] border border-slate-200 bg-white p-3 text-xs text-slate-700">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{h.subtopic || h.subject}</div>
                      <div className="truncate text-slate-500">{h.subject} · {KIND_LABEL[h.kind] || 'Saved'}</div>
                    </div>
                    <button
                      onClick={() => { resumeReview(h.id); bumpSrs(); }}
                      className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RotateCcw className="h-3 w-3" /> Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg overflow-hidden rounded-[20px] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl  ">
            <div className=" pointer-events-none absolute inset-0 bg-[#0f8b8d] opacity-[0.08] dark:opacity-[0.12]" aria-hidden="true" />
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className=" text-2xl tracking-wide text-slate-900">NEW HIGHLIGHT</div>
                  <p className="mt-1 text-xs text-slate-500">Saved to your highlights and added to the review deck.</p>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  aria-label="Close add highlight modal"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Subject</label>
                  <input
                    type="text"
                    value={modalSubject}
                    onChange={e => setModalSubject(e.target.value)}
                    placeholder="e.g. PHARMACOLOGY"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d] dark:focus:"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Concept / Title</label>
                  <input
                    type="text"
                    value={modalConcept}
                    onChange={e => setModalConcept(e.target.value)}
                    placeholder="e.g. Daptomycin Surfactant Inactivation"
                    aria-invalid={!modalConcept.trim() && !modalNote.trim()}
                    className={`w-full rounded-xl border p-2.5 text-xs text-slate-800 placeholder-slate-400 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d] dark:focus: ${!modalConcept.trim() && !modalNote.trim() ? 'border-rose-400' : 'border-slate-200'}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Memory Anchor / Board Trap Note</label>
                  <textarea
                    rows={3}
                    value={modalNote}
                    onChange={e => setModalNote(e.target.value)}
                    placeholder="Key high yield point..."
                    aria-invalid={!modalConcept.trim() && !modalNote.trim()}
                    className={`w-full rounded-xl border p-2.5 text-xs text-slate-800 placeholder-slate-400 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d] dark:focus: ${!modalConcept.trim() && !modalNote.trim() ? 'border-rose-400' : 'border-slate-200'}`}
                  />
                  {!modalConcept.trim() && !modalNote.trim() && (
                    <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                      Add a concept or note before saving.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[44px] rounded-[16px] border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const quote = (modalConcept.trim() || modalNote.trim());
                    if (!quote) return;
                    saveManualHighlight({
                      subject: modalSubject.trim() || 'General',
                      subtopic: modalConcept.trim() || 'Clinical Pearl',
                      quote,
                      note: modalNote.trim() || undefined
                    });
                    setRatedNote('NEW — highlight saved and added to the review deck.');
                    setModalSubject('');
                    setModalConcept('');
                    setModalNote('');
                    setShowAddModal(false);
                  }}
                  disabled={!modalConcept.trim() && !modalNote.trim()}
                  className="min-h-[44px] rounded-[16px] border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2 text-xs font-medium text-white hover:bg-[#00696b] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save & Index
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
