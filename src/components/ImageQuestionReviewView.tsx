import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, ImageIcon, Eye, ExternalLink, Stethoscope, X, RotateCcw, ChevronDown, ArrowRight } from 'lucide-react';
import type { AppView, ClinicalQuestion } from '../types.ts';

interface ImageQuestionReviewViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
  /** Image-based questions to review. When omitted the view reads its own last set. */
  questions?: ClinicalQuestion[];
  darkMode?: boolean;
}

const SELF_KEY = 'pulse.imageQuestions.review.v1';

/** A question as recorded by the image-first verification run (tools/test-image-first.mjs). */
interface RunRow {
  subject: string;
  imageId?: string;
  groundTruth?: string;
  modality?: string;
  licence?: string;
  sourceUrl?: string;
  imageUrl?: string;
  previewUrl?: string;
  status: 'pass' | 'unverified' | 'fallback' | 'no-images' | 'error';
  reason?: string;
  verification?: { pass: boolean; reason?: string };
  question?: {
    stem?: string;
    questionText?: string;
    options?: Record<string, string>;
    correctOption?: string;
    explanation?: string;
  };
}

interface RunSummary {
  ranAt?: string;
  passed?: number;
  fellBack?: number;
  generated?: number;
  results?: RunRow[];
}

/**
 * Load the last image-question set the app stored for review. Kept deliberately
 * defensive: a corrupt or absent entry yields an empty list, never a crash.
 */
function loadStoredQuestions(): ClinicalQuestion[] {
  try {
    const raw = localStorage.getItem(SELF_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClinicalQuestion[]) : [];
  } catch {
    return [];
  }
}

/** Map one recorded run row to the app's ClinicalQuestion shape so it renders identically. */
function runRowToQuestion(row: RunRow, idx: number): ClinicalQuestion {
  const q = row.question || {};
  const options = Object.entries(q.options || {}).map(([id, text]) => ({
    id: id as 'A' | 'B' | 'C' | 'D' | 'E',
    text: String(text),
  }));
  const pass = row.verification?.pass === true;
  const verified = row.status === 'pass' || pass;
  return {
    id: row.imageId ? `RUN-${row.imageId}-${idx}` : `RUN-${idx}`,
    examType: 'NEET_PG',
    subject: row.subject,
    subtopic: row.groundTruth || 'Image-first item',
    cognitiveTier: 'Multi-Step & IBQ',
    stem: q.stem || '',
    questionText: q.questionText || q.stem || '',
    options,
    correctOption: (String(q.correctOption || 'A').trim().toUpperCase() || 'A') as ClinicalQuestion['correctOption'],
    explanation: q.explanation,
    image: row.previewUrl || row.imageUrl,
    imageSourceUrl: row.sourceUrl,
    imageCaption: row.groundTruth,
    imageId: row.imageId,
    imageLicence: row.licence,
    imageGroundTruth: row.groundTruth,
    figureModality: row.modality,
    // A fallback row has NO image, so it can only ever be "text-only" in the table.
    imageVerified: verified && Boolean(row.question),
    imageVerifyReason: row.verification?.reason || row.reason,
  } as ClinicalQuestion;
}

type Filter = 'ALL' | 'VERIFIED' | 'UNVERIFIED' | 'TEXT_ONLY';

/**
 * Human review surface for AI-generated image questions: the image, the question, the
 * key and — critically — the vision VERIFICATION verdict, so a mismatch is obvious at a
 * glance instead of being buried in logs.
 */
export const ImageQuestionReviewView: React.FC<ImageQuestionReviewViewProps> = ({
  onNavigate,
  questions,
  darkMode = false,
}) => {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [own] = useState<ClinicalQuestion[]>(() => (questions && questions.length ? questions : loadStoredQuestions()));
  // The last end-to-end verification run, served by the app (Step-4 review table).
  const [run, setRun] = useState<RunSummary | null>(null);
  const [runState, setRunState] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle');
  // Which dataset is on screen. The session questions and the recorded run are both
  // useful, so neither should silently hide the other.
  const [source, setSource] = useState<'session' | 'run'>('session');
  // UI-only state for the redesign: retry token, lightbox, inline reason disclosure.
  const [reloadToken, setReloadToken] = useState(0);
  const [lightbox, setLightbox] = useState<ClinicalQuestion | null>(null);
  const [openReasonId, setOpenReasonId] = useState<string | null>(null);
  const lightboxTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hostnameOf = (url?: string) => {
    if (!url) return '';
    try { return new URL(url).hostname; } catch { return url; }
  };
  const closeLightbox = () => {
    setLightbox(null);
    window.setTimeout(() => lightboxTriggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    let cancelled = false;
    setRunState('loading');
    fetch('/api/images/qa-results')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.available && body.run?.results) {
          setRun(body.run as RunSummary);
          setRunState('ready');
          // With no in-session image questions, the recorded run is the only content.
          if (!(questions && questions.length)) setSource('run');
        } else {
          setRunState('none');
        }
      })
      .catch(() => { if (!cancelled) setRunState('none'); });
    return () => { cancelled = true; };
  }, [questions, reloadToken]);

  // Keyboard: 1-4 switch filters, J/K or arrows move card focus. Ignore typing and lightbox.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (lightbox) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      const filterMap: Record<string, Filter> = { '1': 'ALL', '2': 'VERIFIED', '3': 'UNVERIFIED', '4': 'TEXT_ONLY' };
      if (filterMap[key]) {
        event.preventDefault();
        setFilter(filterMap[key]);
        return;
      }
      if (key === 'j' || event.key === 'ArrowDown' || event.key === 'ArrowRight' || key === 'k' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-review-card]'));
        if (!cards.length) return;
        event.preventDefault();
        const current = cards.findIndex((card) => card === document.activeElement || card.contains(document.activeElement));
        const next = key === 'j' || event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? Math.min(cards.length - 1, current < 0 ? 0 : current + 1)
          : Math.max(0, current < 0 ? cards.length - 1 : current - 1);
        cards[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // Esc closes the glass lightbox and returns focus to the thumbnail.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLightbox(null);
        window.setTimeout(() => lightboxTriggerRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const runQuestions = useMemo(
    () => (run?.results || [])
      .filter((row) => row.status === 'pass' || row.status === 'unverified')
      .map((row, i) => runRowToQuestion(row, i)),
    [run],
  );

  const all = useMemo(() => {
    if (source === 'run') return runQuestions.length ? runQuestions : [];
    return questions && questions.length ? questions : own;
  }, [source, runQuestions, questions, own]);

  const counts = useMemo(() => {
    const verified = all.filter((q) => q.image && q.imageVerified === true).length;
    const withImage = all.filter((q) => Boolean(q.image)).length;
    // On the run view, report that run's real attempt/fallback totals: a fallback
    // produced no question at all, so it can never appear as a row.
    const usingRun = source === 'run' && run;
    const attempted = usingRun ? (run?.results?.length ?? all.length) : all.length;
    const runFallback = usingRun ? (run?.fellBack ?? 0) : 0;
    return {
      total: all.length,
      verified,
      unverified: withImage - verified,
      textOnly: usingRun ? runFallback : all.length - withImage,
      attempted,
      ranAt: usingRun ? run?.ranAt : undefined,
    };
  }, [all, run, source]);

  const shown = useMemo(() => {
    switch (filter) {
      case 'VERIFIED':
        return all.filter((q) => q.image && q.imageVerified === true);
      case 'UNVERIFIED':
        return all.filter((q) => q.image && q.imageVerified !== true);
      case 'TEXT_ONLY':
        return all.filter((q) => !q.image);
      default:
        return all;
    }
  }, [all, filter]);

  const shell = darkMode ? " font-['M_PLUS_Rounded_1c'] " : " font-['M_PLUS_Rounded_1c'] ";
  const card = darkMode ? ' ' : ' ';
  const dim = darkMode ? 'text-slate-400' : 'text-slate-600';
  const title = darkMode ? '' : '';

  const statChip = (label: string, value: number, tone: string, loading = false) => (
    <div className={`rounded-xl border  px-3 py-2  dark:${card}`}>
      <div className={`font-mono text-[10px] uppercase tracking-wider ${dim}`}>{label}</div>
      {loading ? (
        <div className="mt-1 h-6 w-12 animate-pulse rounded bg-slate-300/70 motion-reduce:animate-none dark:bg-slate-700/70" />
      ) : (
        <div className={`text-2xl font-[''] tracking-tight ${tone}`}>{value}</div>
      )}
    </div>
  );

  const filterBtn = (key: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      className={`min-h-[44px] rounded-[14px] border  px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-transparent  ${
        filter === key
          ? ' dark:'
          : `${darkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'}`
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`min-h-full ${shell}`}>
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <style>{`@keyframes reviewFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={`flex items-center gap-2 text-xl font-[''] uppercase tracking-tight ${title}`}>
              <ImageIcon className="h-5 w-5 " />
              Image Question Review
            </h1>
            <p className={`mt-1 max-w-2xl font-['Cormorant'] text-sm font-semibold leading-relaxed ${dim}`}>
              Every image question with its vision-verification result. Unverified items are amber — check them by eye.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('practice')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-[14px] border  px-3 py-2 text-xs font-semibold  transition  focus-visible:outline-none focus-visible:ring-2 focus-visible:   dark:hover:bg-slate-800"
          >
            Build more <ArrowRight className="h-4 w-4" />
          </button>
        </header>

        <div className={`rounded-xl border  px-3 py-2  dark:${card}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-mono text-[10px] uppercase tracking-wider ${dim}`}>Run report</span>
            <span className="rounded-full border border-teal-500/50 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300">
              Attempted <span className="font-[''] text-sm">{counts.attempted}</span>
            </span>
            <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              Kept with image <span className="font-[''] text-sm">{counts.total}</span>
            </span>
            <span className="rounded-full border border-amber-600/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-300/60 dark:text-amber-300">
              Fell back to text-only <span className="font-[''] text-sm">{counts.textOnly}</span>
            </span>
            {counts.ranAt && (
              <span className={`text-[10px] ${dim}`}>{new Date(counts.ranAt).toLocaleString()}</span>
            )}
            {runState === 'loading' && (
              <span className="h-3 w-20 animate-pulse rounded bg-slate-300/70 motion-reduce:animate-none dark:bg-slate-700/70" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {statChip('Total', counts.total, title, runState === 'loading' && counts.total === 0)}
          {statChip('Verified', counts.verified, 'text-emerald-500', runState === 'loading' && counts.total === 0)}
          {statChip('Unverified', counts.unverified, 'text-amber-500', runState === 'loading' && counts.total === 0)}
          {statChip('Text-only fallback', counts.textOnly, dim, runState === 'loading' && counts.total === 0)}
        </div>

        <div className="inline-flex flex-wrap items-center gap-2 rounded-[16px] border  p-1 " role="group" aria-label="Filter image questions">
          {filterBtn('ALL', `All (${counts.total})`)}
          {filterBtn('VERIFIED', `Verified (${counts.verified})`)}
          {filterBtn('UNVERIFIED', `Unverified (${counts.unverified})`)}
          {filterBtn('TEXT_ONLY', `Text-only (${counts.textOnly})`)}
        </div>

        {/* Two useful datasets: this session's questions, and the recorded end-to-end
            verification run (which also reports the items that fell back to text). */}
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${card}`}>
          <span className={`font-mono text-[10px] uppercase tracking-wider ${dim}`}>Showing</span>
          <button
            type="button"
            onClick={() => setSource('session')}
            className={`min-h-[40px] rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible: ${
              source === 'session'
                ? '  '
                : `${darkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`
            }`}
          >
            This session ({own.length})
          </button>
          <button
            type="button"
            onClick={() => setSource('run')}
            className={`min-h-[40px] rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible: ${
              source === 'run'
                ? '  '
                : `${darkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`
            }`}
          >
            Last test run ({run ? `${run.results?.length ?? 0} attempted` : 'No run recorded'})
          </button>
        </div>

        {source === 'run' && runState !== 'ready' && (
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-600/60 bg-amber-500/10 px-3 py-3 ${card}`}>
            <div>
              <p className={`text-sm font-semibold ${title}`}>
                {runState === 'loading' ? 'Loading the last verification run…' : 'No run recorded'}
              </p>
              <p className={`mt-0.5 text-xs ${dim}`}>
                {runState === 'loading' ? 'The session questions stay available while this resolves.' : 'Start a test run with images enabled, or retry the fetch.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReloadToken((n) => n + 1)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[14px] border  px-3 py-2 text-xs font-semibold  transition  focus-visible:outline-none focus-visible:ring-2 focus-visible:   dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-4 w-4" /> Retry
            </button>
          </div>
        )}

        <div className={`sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-y px-4 py-2 text-[11px] font-semibold sm:-mx-6 sm:px-6 ${card}`}>
          <span className={`font-mono text-[10px] uppercase tracking-wider ${dim}`}>Orientation</span>
          <span className={title}>{counts.total} total</span>
          <span className="text-emerald-600 dark:text-emerald-400">{counts.verified} verified</span>
          <span className="text-amber-600 dark:text-amber-400">{counts.unverified} unverified</span>
          <span className={dim}>{counts.textOnly} text-only</span>
          <span className={`rounded-full border px-2 py-0.5 ${darkMode ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>
            Filter: {filter === 'ALL' ? 'All' : filter === 'VERIFIED' ? 'Verified' : filter === 'UNVERIFIED' ? 'Unverified' : 'Text-only'}
          </span>
          <span className={`rounded-full border px-2 py-0.5 ${darkMode ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>
            Source: {source === 'session' ? 'This session' : 'Last test run'}
          </span>
        </div>

        {all.length === 0 && runState === 'loading' ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`animate-pulse rounded-xl border p-4 motion-reduce:animate-none ${card}`}>
                <div className="h-3 w-24 rounded bg-slate-300/70 dark:bg-slate-700/70" />
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
                  <div className="h-32 rounded-lg bg-slate-300/60 dark:bg-slate-700/60" />
                  <div className="space-y-2">
                    <div className="h-3 w-3/4 rounded bg-slate-300/70 dark:bg-slate-700/70" />
                    <div className="h-3 w-2/3 rounded bg-slate-300/70 dark:bg-slate-700/70" />
                    <div className="h-8 rounded bg-slate-300/50 dark:bg-slate-700/50" />
                    <div className="h-8 rounded bg-slate-300/50 dark:bg-slate-700/50" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className={`rounded-xl border  p-8 text-center  dark:${card}`}>
            <Eye className={`mx-auto h-8 w-8 ${dim}`} />
            <p className={`mt-3 text-lg font-[''] uppercase tracking-tight ${title}`}>
              {filter === 'ALL' ? 'Nothing to review yet' : `No ${filter === 'VERIFIED' ? 'verified' : filter === 'UNVERIFIED' ? 'unverified' : 'text-only'} questions`}
            </p>
            <p className={`mx-auto mt-1 max-w-md text-xs ${dim}`}>
              {filter === 'ALL'
                ? 'Image-based questions appear here after a generation run that had images enabled. Only images that pass vision verification are attached; anything that fails falls back to a text-only question.'
                : 'This filter produced zero rows in the current dataset. Show all to keep reviewing.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {filter !== 'ALL' ? (
                <button
                  type="button"
                  onClick={() => setFilter('ALL')}
                  className="min-h-[44px] rounded-[14px] px-4 py-2 text-xs font-medium  transition focus-visible:outline-none focus-visible:ring-2 focus-visible: dark:"
                >
                  Show all
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('practice')}
                  className="min-h-[44px] rounded-[14px] px-4 py-2 text-xs font-medium  transition focus-visible:outline-none focus-visible:ring-2 focus-visible: dark:"
                >
                  Build image questions
                </button>
              )}
              {run && (
                <button
                  type="button"
                  onClick={() => setSource('run')}
                  className="min-h-[44px] rounded-[14px] border  px-4 py-2 text-xs font-semibold  transition  focus-visible:outline-none focus-visible:ring-2 focus-visible:   dark:hover:bg-slate-800"
                >
                  Show last test run
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((q, index) => {
              const verified = q.imageVerified === true;
              const tone = !q.image
                ? ' bg-slate-200   dark:bg-slate-800 '
                : verified
                  ? 'border-teal-700 bg-teal-200 text-teal-950 dark:border-teal-300 dark:bg-teal-900/60 dark:text-teal-100'
                  : 'border-amber-700 bg-amber-200 text-amber-950 dark:border-amber-300 dark:bg-amber-900/60 dark:text-amber-100';
              return (
                <li
                  key={q.id}
                  data-review-card
                  tabIndex={0}
                  style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
                  className={`motion-safe:animate-[reviewFadeIn_0.35s_ease-out_both] rounded-xl border  p-3 transition hover:-focus-visible:outline-none focus-visible:ring-2 focus-visible: focus-visible:ring-offset-2 focus-visible:ring-offset-transparent motion-reduce:animate-none motion-reduce:hover:sm:p-4  ${card}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                      <span className={`rounded border px-1.5 py-0.5 ${darkMode ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                        {q.subject}
                      </span>
                      {q.figureModality && <span className={dim}>{q.figureModality}</span>}
                      {q.imageLicence && <span className={dim}>· {q.imageLicence}</span>}
                    </div>
                    <span
                      className={`flex items-center gap-1 rounded-md border px-2 py-1 font-[''] text-[11px] uppercase tracking-tight dark:${tone} ${
                        !verified && q.image ? 'motion-safe:animate-[bounce_0.7s_ease-out_1]' : ''
                      }`}
                    >
                      {!q.image ? <ImageIcon className="h-3 w-3" /> : verified ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {!q.image ? 'TEXT-ONLY' : verified ? 'PASS' : 'NEEDS YOUR EYES'}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
                    <div>
                      {q.image ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            lightboxTriggerRef.current = event.currentTarget;
                            setLightbox(q);
                          }}
                          className="group block w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:"
                          aria-label="Open image lightbox"
                        >
                          <img
                            src={q.image}
                            alt={q.imageCaption || 'Clinical image'}
                            className={`max-h-64 w-full rounded-lg border bg-white object-contain transition group-hover:brightness-105 dark:bg-slate-900 ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}
                          />
                        </button>
                      ) : (
                        <div className={`flex h-32 items-center justify-center rounded-lg border ${darkMode ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
                          <span className="text-xs">No image (text-only)</span>
                        </div>
                      )}
                      {q.imageSourceUrl && (
                        <a
                          href={q.imageSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible: dark:text-cyan-400"
                        >
                          <ExternalLink className="h-3 w-3" /> {hostnameOf(q.imageSourceUrl)}
                        </a>
                      )}
                    </div>

                    <div className="space-y-2">
                      {q.imageGroundTruth && (
                        <p className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${dim}`}>
                          <Stethoscope className="h-3 w-3" /> Ground truth: {q.imageGroundTruth}
                        </p>
                      )}
                      <p className={`text-base font-semibold leading-relaxed ${title}`}>{q.stem}</p>
                      {q.questionText && q.questionText !== q.stem && (
                        <p className={`text-sm leading-relaxed ${dim}`}>{q.questionText}</p>
                      )}

                      <ol className="space-y-1">
                        {q.options.map((o) => {
                          const isCorrect = o.id === q.correctOption;
                          return (
                            <li
                              key={o.id}
                              className={`rounded-md border px-2 py-1 text-sm leading-relaxed ${
                                isCorrect
                                  ? 'border-emerald-500/40 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400'
                                  : darkMode
                                    ? 'border-slate-800 text-slate-300'
                                    : 'border-slate-200 text-slate-600'
                              }`}
                            >
                              <span className="mr-1.5 font-mono font-medium">{o.id}.</span>
                              {o.text}
                              {isCorrect && <span className="ml-1.5 text-[10px] uppercase">✓ key</span>}
                            </li>
                          );
                        })}
                      </ol>

                      {q.imageVerifyReason && (
                        <div className={`rounded-md border px-2 py-1 text-[11px] leading-snug ${verified ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'border-amber-500/40 text-amber-700 dark:text-amber-300'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">{verified ? 'Verification:' : 'Why unverified:'}</span>
                            <button
                              type="button"
                              onClick={() => setOpenReasonId((id) => (id === q.id ? null : q.id))}
                              className="inline-flex items-center gap-1 rounded px-1 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:"
                              aria-expanded={openReasonId === q.id}
                            >
                              {openReasonId === q.id ? 'Hide' : 'Details'}
                              <ChevronDown className={`h-3 w-3 transition ${openReasonId === q.id ? '' : ''}`} />
                            </button>
                          </div>
                          <p className={`mt-1 ${verified || openReasonId === q.id ? '' : 'line-clamp-2'}`}>{q.imageVerifyReason}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center  p-4 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          onClick={closeLightbox}
        >
          <div
            className={`max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border  p-4  dark:${card}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`font-[''] text-lg uppercase tracking-tight ${title}`}>Image lightbox</p>
                <p className={`mt-0.5 text-[10px] uppercase tracking-wider ${dim}`}>
                  {lightbox.figureModality || 'Clinical image'}
                  {lightbox.imageLicence ? ` · ${lightbox.imageLicence}` : ''}
                </p>
              </div>
              <button
                type="button"
                autoFocus
                onClick={closeLightbox}
                className="rounded-lg border  p-2  transition  focus-visible:outline-none focus-visible:ring-2 focus-visible:   dark:hover:bg-slate-800"
                aria-label="Close lightbox"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {lightbox.image && (
              <img
                src={lightbox.image}
                alt={lightbox.imageCaption || 'Clinical image'}
                className="mt-3 max-h-[55vh] w-full rounded-xl border bg-white object-contain dark:border-slate-700 dark:bg-slate-900"
              />
            )}

            <div className="mt-3 space-y-1.5">
              {lightbox.imageCaption && <p className={`text-sm font-semibold leading-relaxed ${title}`}>{lightbox.imageCaption}</p>}
              {lightbox.imageGroundTruth && (
                <p className={`text-xs leading-relaxed ${dim}`}><span className="font-semibold">Ground truth:</span> {lightbox.imageGroundTruth}</p>
              )}
              <p className={`text-xs leading-relaxed ${title}`}>
                <span className="font-semibold">Correct option:</span>{' '}
                {lightbox.correctOption}. {lightbox.options.find((o) => o.id === lightbox.correctOption)?.text || ''}
              </p>
              {lightbox.imageSourceUrl && (
                <a
                  href={lightbox.imageSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible: dark:text-cyan-400"
                >
                  <ExternalLink className="h-3 w-3" /> {hostnameOf(lightbox.imageSourceUrl)}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
