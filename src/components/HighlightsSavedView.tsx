import React, { useEffect, useMemo, useState } from 'react';
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
    setDeckIndex(0);
    refreshHighlights();
    bumpSrs();
  };

  const handleReviewLater = (): void => {
    if (!currentCard) return;
    deferReview(currentCard.id);
    setRatedNote('Deferred — back in the deck tomorrow.');
    setRevealed(false);
    setDeckIndex(0);
    bumpSrs();
  };

  const handleRemoveFromReview = (): void => {
    if (!currentCard) return;
    suspendReview(currentCard.id);
    setRatedNote('Removed from the review deck. It stays in your saved highlights.');
    setRevealed(false);
    setDeckIndex(0);
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
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Bookmark className="w-3.5 h-3.5" />
              Saved Highlights & Memory Anchors
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Clinical Highlights & Memory Anchors Repository
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Your saved highlights with spaced-repetition review. {dueNowCount > 0
                ? `${dueNowCount} card${dueNowCount === 1 ? '' : 's'} due now.`
                : nextDue
                  ? `Nothing due right now — next review ${dueLabel(nextDue.due)}.`
                  : 'Save a highlight to start a review deck.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportTsv}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              <Download className="w-4 h-4 text-slate-300" />
              Export Anki TSV
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-semibold rounded-xl shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Add Clinical Pearl
            </button>
          </div>
        </div>

        {/* Filter Bar & Search */}
        <div className="mt-6 pt-5 border-t border-slate-700/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {tagTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSelectedTag(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedTag === tab.id
                    ? 'bg-[#0f8b8d] text-white shadow-sm'
                    : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search your saved highlights..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#0f8b8d]"
            />
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Highlights Cards */}
        <div className="lg:col-span-8 space-y-6">
          {highlights.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#0f8b8d]/10 mb-3">
                <Bookmark className="w-6 h-6 text-[#0f8b8d]" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Nothing saved yet</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                Highlights you save from the PDF reader, the AI tutor, or the quick capture box land here and join your spaced-repetition deck.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-semibold rounded-xl transition-colors"
              >
                <Plus className="w-4 h-4" /> Add your first highlight
              </button>
            </div>
          ) : filteredHighlights.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center text-xs text-slate-500">
              No saved highlights match this filter.
            </div>
          ) : (
            filteredHighlights.map((highlight) => {
              const rec = srs[highlight.id];
              const footerSrs = !rec
                ? 'New · not scheduled yet'
                : rec.suspended
                  ? 'Removed from review'
                  : `Next review ${dueLabel(rec.due)} · interval ${formatSpan(rec.intervalDays)}`;
              return (
                <div
                  key={highlight.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:border-slate-300 transition-all"
                >
                  {/* Card Header */}
                  <div className="p-6 pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#0f8b8d]/10 text-[#0f8b8d] uppercase tracking-wide">
                          {highlight.subject}
                        </span>
                        <span className="text-xs font-semibold text-slate-700">
                          {highlight.subtopic}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                          {KIND_LABEL[highlight.kind] || 'Saved'}
                        </span>
                      </div>

                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 uppercase tracking-wider">
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
                            <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
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
                          <span className="font-bold text-rose-900 uppercase tracking-wider text-[11px]">Board Trap Warning: </span>
                          <span className="text-rose-800 font-medium leading-relaxed">{highlight.boardTrapAlert}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 text-slate-500 font-medium">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{footerSrs}</span>
                      {rec?.suspended && (
                        <button
                          onClick={() => { resumeReview(highlight.id); bumpSrs(); }}
                          className="text-[#0f8b8d] hover:underline font-semibold inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Resume review
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => onNavigate('ai-tutor')}
                        className="text-slate-600 hover:text-[#0f8b8d] font-semibold flex items-center gap-1 transition-colors"
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
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Interactive SRS Review Deck & Quick Capture */}
        <div className="lg:col-span-4 space-y-6">
          {/* Spaced Repetition Interactive Card */}
          <div className="bg-gradient-to-br from-[#001432] to-[#13294b] text-white rounded-2xl p-5 border border-[#13294b] shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#8ff3f4] font-bold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Review Deck
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {dueNowCount > 0 ? `Due ${dueNowCount}` : 'All clear'}
              </span>
            </div>

            {highlights.length === 0 ? (
              <div className="mt-3 p-4 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs text-slate-300 text-center">
                No saved highlights yet — add one to build your review deck.
              </div>
            ) : currentCard ? (
              <>
                <div className="mt-3 p-3.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-amber-400 font-bold">Prompt:</span>
                    <span className="text-[10px] text-slate-400 font-semibold">
                      {KIND_LABEL[currentCard.kind] || 'Saved'} · {currentCard.subject}
                    </span>
                  </div>
                  <p className="text-slate-200 leading-relaxed font-medium">{currentCard.quote}</p>

                  {isNewCard && (
                    <div className="mt-2 text-[10px] text-slate-400 italic">
                      New card · correct answer never confirmed by a rating yet.
                    </div>
                  )}

                  {revealed ? (
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <div className="text-amber-400 font-bold mb-1">Answer:</div>
                      <p className="text-slate-200 leading-relaxed">
                        {currentCard.memoryAnchor || currentCard.note || 'No answer saved with this highlight yet.'}
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRevealed(true)}
                      className="mt-3 w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Show answer
                    </button>
                  )}
                </div>

                <div className="mt-4">
                  <div className="text-[11px] text-slate-400 mb-2 font-medium">
                    Rate recall difficulty to set the next due date:
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
                          ? 'text-rose-300 border-slate-700 hover:bg-slate-800'
                          : btn.tone === 'amber'
                            ? 'text-amber-300 border-slate-700 hover:bg-slate-800'
                            : btn.tone === 'sky'
                              ? 'text-sky-300 border-slate-700 hover:bg-slate-800'
                              : 'text-emerald-300 border-slate-700 hover:bg-slate-800';
                      return (
                        <button
                          key={btn.label}
                          disabled={!revealed}
                          onClick={() => handleRate(btn.label as Rating)}
                          className={`py-2 px-2.5 rounded-xl border text-center font-bold transition-all bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed ${toneCls}`}
                        >
                          {btn.label} <span className="text-[10px] block font-normal opacity-80">in {btn.preview}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3.5 flex items-center justify-between gap-2 text-[11px]">
                  <button
                    onClick={handleReviewLater}
                    className="text-slate-300 hover:text-white font-semibold inline-flex items-center gap-1"
                  >
                    <Clock className="w-3.5 h-3.5" /> Review later
                  </button>
                  <button
                    onClick={handleRemoveFromReview}
                    className="text-slate-400 hover:text-rose-300 font-semibold inline-flex items-center gap-1"
                  >
                    <EyeOff className="w-3.5 h-3.5" /> Remove from review
                  </button>
                </div>

                {ratedNote && (
                  <div className="mt-3 p-2 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] text-center font-semibold">
                    ✓ {ratedNote}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-3 p-4 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs text-slate-300">
                <div className="font-semibold text-slate-200 mb-1">Nothing due right now.</div>
                {nextDue && (
                  <div className="text-slate-400">
                    Next review {dueLabel(nextDue.due)} — {dueDateText(nextDue.due)}.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Capture Form */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
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

          {/* Deck Retention Status */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#0f8b8d]" /> Study Deck Retention Status
            </h3>

            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-xl font-mono font-bold text-slate-900">{highlights.length}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 font-medium">Total Anchors</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <div className="text-xl font-mono font-bold text-amber-700">{dueNowCount}</div>
                <div className="text-[11px] text-amber-600 mt-0.5 font-medium">Due Now</div>
              </div>
              <div className="p-3 rounded-xl bg-sky-50 border border-sky-100">
                <div className="text-xl font-mono font-bold text-sky-700">{inReviewCount}</div>
                <div className="text-[11px] text-sky-600 mt-0.5 font-medium">In Active Review</div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="text-xl font-mono font-bold text-emerald-700">{newThisWeekCount}</div>
                <div className="text-[11px] text-emerald-600 mt-0.5 font-medium">New This Week</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Add New Clinical Highlight</h3>
            <p className="text-xs text-slate-500 mt-1">Saved to your highlights and added to the review deck.</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Subject</label>
                <input
                  type="text"
                  value={modalSubject}
                  onChange={e => setModalSubject(e.target.value)}
                  placeholder="e.g. PHARMACOLOGY"
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Concept / Title</label>
                <input
                  type="text"
                  value={modalConcept}
                  onChange={e => setModalConcept(e.target.value)}
                  placeholder="e.g. Daptomycin Surfactant Inactivation"
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Memory Anchor / Board Trap Note</label>
                <textarea
                  rows={3}
                  value={modalNote}
                  onChange={e => setModalNote(e.target.value)}
                  placeholder="Key high yield point..."
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
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
                  setModalSubject('');
                  setModalConcept('');
                  setModalNote('');
                  setShowAddModal(false);
                }}
                className="px-4 py-2 text-xs font-semibold bg-[#0f8b8d] text-white rounded-lg hover:bg-[#00696b]"
              >
                Save & Index
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
