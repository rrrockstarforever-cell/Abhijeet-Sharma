import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, ImageIcon, Eye, ExternalLink, Stethoscope, Loader2 } from 'lucide-react';
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
  }, [questions]);

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

  const shell = darkMode ? 'bg-[#0A101D] text-slate-200' : 'bg-slate-50 text-slate-800';
  const card = darkMode ? 'border-slate-800 bg-[#0F172A]' : 'border-slate-200 bg-white';
  const dim = darkMode ? 'text-slate-400' : 'text-slate-500';
  const title = darkMode ? 'text-slate-100' : 'text-slate-900';

  const statChip = (label: string, value: number, tone: string) => (
    <div className={`rounded-xl border px-3 py-2 ${card}`}>
      <div className={`font-mono text-[10px] uppercase tracking-wider ${dim}`}>{label}</div>
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );

  const filterBtn = (key: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
        filter === key
          ? 'border-[#0f8b8d] bg-[#0f8b8d]/10 text-[#0f8b8d]'
          : `${darkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`min-h-full ${shell}`}>
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className={`flex items-center gap-2 text-lg font-bold ${title}`}>
              <ImageIcon className="h-5 w-5 text-[#0f8b8d]" />
              Image Question Review
            </h1>
            <p className={`mt-1 text-xs ${dim}`}>
              Every image question with its vision-verification result. Anything unverified is shown amber — check it by eye.
              {counts.ranAt
                ? ` · Last run ${new Date(counts.ranAt).toLocaleString()}: ${counts.attempted} image items attempted, ${counts.total} kept with an image; ${counts.textOnly} fell back to text-only (counted separately, not in the total).`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('practice')}
            className="rounded-lg border border-[#0f8b8d] px-3 py-1.5 text-xs font-semibold text-[#0f8b8d] transition hover:bg-[#0f8b8d]/10"
          >
            Build more →
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {statChip('Total', counts.total, title)}
          {statChip('Verified', counts.verified, 'text-emerald-500')}
          {statChip('Unverified', counts.unverified, 'text-amber-500')}
          {statChip('Text-only fallback', counts.textOnly, dim)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {filterBtn('ALL', `All (${counts.total})`)}
          {filterBtn('VERIFIED', `Verified (${counts.verified})`)}
          {filterBtn('UNVERIFIED', `Unverified (${counts.unverified})`)}
          {filterBtn('TEXT_ONLY', `Text-only (${counts.textOnly})`)}
        </div>

        {/* Two useful datasets: this session's questions, and the recorded end-to-end
            verification run (which also reports the items that fell back to text). */}
        {runState === 'ready' && run && (questions?.length ?? 0) > 0 && (
          <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${card}`}>
            <span className={`font-mono text-[10px] uppercase tracking-wider ${dim}`}>Showing</span>
            <button
              type="button"
              onClick={() => setSource('session')}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                source === 'session'
                  ? 'border-[#0f8b8d] bg-[#0f8b8d]/10 text-[#0f8b8d]'
                  : `${darkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`
              }`}
            >
              This session ({(questions ?? []).length})
            </button>
            <button
              type="button"
              onClick={() => setSource('run')}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                source === 'run'
                  ? 'border-[#0f8b8d] bg-[#0f8b8d]/10 text-[#0f8b8d]'
                  : `${darkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`
              }`}
            >
              Last test run ({run.results?.length ?? 0} attempted)
            </button>
          </div>
        )}

        {runState === 'loading' ? (
          <div className={`flex items-center justify-center gap-2 rounded-xl border p-8 ${card}`}>
            <Loader2 className={`h-4 w-4 animate-spin ${dim}`} />
            <span className={`text-xs ${dim}`}>Loading the last verification run…</span>
          </div>
        ) : shown.length === 0 ? (
          <div className={`rounded-xl border p-8 text-center ${card}`}>
            <Eye className={`mx-auto h-8 w-8 ${dim}`} />
            <p className={`mt-3 text-sm font-semibold ${title}`}>Nothing to review yet</p>
            <p className={`mx-auto mt-1 max-w-md text-xs ${dim}`}>
              Image-based questions appear here after a generation run that had images enabled. Only images that pass
              vision verification are attached; anything that fails falls back to a text-only question.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((q) => {
              const verified = q.imageVerified === true;
              return (
                <li key={q.id} className={`rounded-xl border p-3 sm:p-4 ${card}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                      <span className={`rounded border px-1.5 py-0.5 ${darkMode ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                        {q.subject}
                      </span>
                      {q.figureModality && <span className={dim}>{q.figureModality}</span>}
                      {q.imageLicence && <span className={dim}>· {q.imageLicence}</span>}
                    </div>
                    {q.image ? (
                      verified ? (
                        <span className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Unverified
                        </span>
                      )
                    ) : (
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${darkMode ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                        Text-only
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
                    <div>
                      {q.image ? (
                        <img
                          src={q.image}
                          alt={q.imageCaption || 'Clinical image'}
                          className={`max-h-64 w-full rounded-lg border bg-white object-contain ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}
                        />
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
                          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-600 hover:underline dark:text-cyan-400"
                        >
                          <ExternalLink className="h-3 w-3" /> Source ↗
                        </a>
                      )}
                    </div>

                    <div className="space-y-2">
                      {q.imageGroundTruth && (
                        <p className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${dim}`}>
                          <Stethoscope className="h-3 w-3" /> Ground truth: {q.imageGroundTruth}
                        </p>
                      )}
                      <p className={`text-sm font-semibold leading-snug ${title}`}>{q.stem}</p>
                      {q.questionText && q.questionText !== q.stem && (
                        <p className={`text-xs leading-relaxed ${dim}`}>{q.questionText}</p>
                      )}

                      <ol className="space-y-1">
                        {q.options.map((o) => {
                          const isCorrect = o.id === q.correctOption;
                          return (
                            <li
                              key={o.id}
                              className={`rounded-md border px-2 py-1 text-xs ${
                                isCorrect
                                  ? 'border-emerald-500/40 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400'
                                  : darkMode
                                    ? 'border-slate-800 text-slate-300'
                                    : 'border-slate-200 text-slate-600'
                              }`}
                            >
                              <span className="mr-1.5 font-mono font-bold">{o.id}.</span>
                              {o.text}
                              {isCorrect && <span className="ml-1.5 text-[10px] uppercase">✓ key</span>}
                            </li>
                          );
                        })}
                      </ol>

                      {q.imageVerifyReason && (
                        <p className={`text-[11px] leading-snug ${verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {verified ? 'Verification: ' : 'Reason: '}
                          {q.imageVerifyReason}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
