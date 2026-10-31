import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  BookOpen,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  Zap,
  Flag,
  Clock,
  Gauge,
  Send,
  LayoutGrid,
  Stethoscope,
  Lightbulb,
  Quote,
} from 'lucide-react';
import { ClinicalQuestion, AppView, ExamType } from '../types.ts';
import { AiQuestionTools } from './AiQuestionTools.tsx';
import { ZoomableImage } from './ZoomableImage.tsx';
import { addAttempt } from '../utils/attemptStore.ts';
import { loadRunSession, saveRunSession, signature } from '../utils/sessionStore.ts';

interface TestRunnerViewProps {
  initialQuestionId?: string;
  onNavigate: (view: AppView, targetId?: string) => void;
  questions?: ClinicalQuestion[];
  mode?: 'EXAM' | 'TUTOR';
  /** app-level theme: the cockpit renders a light skin when this is false */
  darkMode?: boolean;
}

type MatrixTab = 'rationale' | 'pearl' | 'evidence' | 'ai';

const EXAM_LABEL: Record<ExamType, string> = {
  NEET_PG: 'NEET-PG',
  INI_CET: 'INI-CET',
  AMC_CAT: 'AMC CAT',
};

/**
 * EXAM-INTEGRITY: the subtopic is rendered in the runner header BEFORE the student
 * answers, and for image-first questions it historically held the ground-truth dx (the
 * answer). Suppress it pre-answer whenever it would give the diagnosis away — this also
 * protects questions already saved to localStorage from before the fix. Once the answer
 * is revealed the real subtopic is shown, where it becomes useful revision context.
 */
function safeSubtopic(q: ClinicalQuestion | undefined, revealed: boolean): string {
  const sub = (q?.subtopic || '').trim();
  if (revealed) return sub || 'Clinical image';
  if (!sub) return 'Clinical image';
  const answer = (q?.options?.find((o) => o.id === q.correctOption)?.text || '').trim().toLowerCase();
  const hay = sub.toLowerCase();
  // Leaks if the subtopic contains the correct option text, or vice versa.
  if (answer && (answer.includes(hay) || hay.includes(answer))) return q?.figureModality ? `${q.figureModality} interpretation` : 'Image interpretation';
  return sub;
}

/**
 * EXAM-INTEGRITY: the image header must never name the diagnosis. Captions written by
 * earlier versions of the app were stored as "PANCREATITIS — Hellerhoff", i.e. the answer
 * itself, and they persist in localStorage — so a render-time guard is required, not just
 * a safer producer. Any caption segment that overlaps the ground truth, the subtopic or
 * the correct option is dropped, as is the licence (shown separately from the trusted
 * field, which also stops the licence appearing twice).
 */
function safeImageCaption(q: ClinicalQuestion | undefined, revealed: boolean): string {
  if (!q?.image) return 'Clinical image';
  if (!revealed) return 'Clinical image';
  const raw = (q?.imageCaption || '').trim();
  if (!raw) return 'Clinical image';
  const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const leaks = [q.imageGroundTruth, q.subtopic, q.options?.find((o) => o.id === q.correctOption)?.text]
    .map((s) => norm(s ?? ''))
    .filter((s) => s.length >= 4);
  const kept = String(raw)
    .split(/[·•|—–;]| - |,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((seg) => {
      if (/^(cc0|cc\s|creative commons|public domain|pd|all rights|©|\d)/i.test(seg)) return false;
      const n = norm(seg);
      if (!n) return false;
      return !leaks.some((l) => l.includes(n) || (n.length >= 4 && n.includes(l)));
    });
  return kept.join(' · ') || 'Clinical image';
}

/**
 * Every colour used by the runner lives here, once per theme. Keeping the two
 * palettes side by side makes it impossible for the screen to get stuck in one
 * mode: the component simply reads `t.<token>` and the theme prop decides.
 */
const LIGHT = {
  page: 'bg-[#f6f8fc] text-slate-800',
  bar: 'border-slate-200 bg-white',
  barBack: 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
  barTitle: 'text-slate-900',
  barSub: 'text-slate-500',
  chip: 'border-slate-200 bg-slate-100 text-slate-600',
  chipAccent: 'border-cyan-600/30 bg-cyan-50 text-cyan-700',
  chipMono: 'border-emerald-600/30 bg-emerald-50 text-emerald-700',
  pace: 'border-slate-200 bg-slate-50',
  paceLabel: 'text-slate-500',
  timer: 'border-amber-300 bg-amber-50 text-amber-700',
  flagOn: 'border-amber-400 bg-amber-100 text-amber-700',
  flagOff: 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  submitTop: 'border-cyan-600/40 bg-cyan-50 text-cyan-700 hover:border-cyan-600',
  card: 'border-slate-200 bg-white',
  shadow: 'shadow-sm',
  shadowXl: 'shadow-md',
  inner: 'border-y border-r border-slate-200 border-l-4 border-l-[#0f8b8d] bg-slate-50',
  vignetteLabel: 'border-cyan-600/30 bg-cyan-50 text-cyan-700',
  faint: 'text-slate-400',
  dim: 'text-slate-500',
  text: 'text-slate-500',
  body: 'text-slate-600',
  title: 'text-slate-900',
  strong: 'text-slate-900',
  accent: 'text-teal-700',
  accentCyan: 'text-cyan-700',
  accentAmber: 'text-amber-600',
  chipAnswered: 'border-slate-200 bg-slate-100 text-slate-700',
  chipOk: 'border-emerald-600/30 bg-emerald-50 text-emerald-700',
  chipTeal: 'border-teal-600/30 bg-teal-50 text-teal-700',
  chipWarn: 'border-amber-500/40 bg-amber-50 text-amber-700',
  track: 'border-slate-200 bg-slate-100',
  divider: 'border-slate-200',
  optIdle: 'border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
  optIdleTile: 'border border-slate-200 bg-slate-100 text-slate-600',
  optIdleText: 'font-medium text-slate-700',
  optPick: 'border-2 border-[#0f8b8d] bg-teal-50',
  optPickTile: 'bg-[#0f8b8d] text-white',
  optPickText: 'font-semibold text-teal-900',
  optOk: 'border-2 border-emerald-500 bg-emerald-50',
  optOkTile: 'bg-emerald-600 text-white',
  optOkText: 'font-bold text-emerald-800',
  okBadge: 'border-emerald-600/40 bg-emerald-100 text-emerald-700',
  optBad: 'border-2 border-rose-500 bg-rose-50',
  optBadTile: 'bg-rose-600 text-white',
  optBadText: 'font-semibold text-rose-800',
  badBadge: 'border-rose-500/40 bg-rose-100 text-rose-700',
  okHint: 'text-emerald-700',
  matrixHead: 'border-slate-200 bg-slate-50',
  tabOn: 'border-[#0f8b8d] bg-white font-bold text-teal-700',
  tabOff: 'border-transparent text-slate-500 hover:text-slate-800',
  warnBox: 'border-amber-400/60 bg-amber-50',
  warnTitle: 'text-amber-700',
  warnText: 'text-amber-800',
  pearl: 'border-teal-500/40 bg-teal-50',
  pearlTitle: 'text-teal-700',
  pearlText: 'text-slate-900',
  swallow: 'border-slate-200 bg-slate-50',
  navBtn: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  ghostBtn: 'border-slate-200 bg-white text-slate-500 hover:text-slate-800',
  aside: 'border-slate-200 bg-white',
  paletteIdle: 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  ringOffset: 'ring-offset-white',
  copilot: 'border-teal-600/30 bg-gradient-to-b from-teal-50 to-white',
  copilotText: 'text-slate-600',
  submit: 'border-cyan-600/40 bg-white text-cyan-700 hover:border-cyan-600 hover:bg-cyan-50',
  dissect: 'border-amber-500/60 bg-gradient-to-r from-amber-100 to-teal-100 text-amber-700 hover:border-amber-500',
};

type Theme = typeof LIGHT;

const DARK: Theme = {
  page: 'bg-[#0F172A] text-slate-200',
  bar: 'border-slate-800/90 bg-[#0A101D]',
  barBack: 'border-slate-700/80 bg-slate-800/80 text-slate-300 hover:bg-slate-700',
  barTitle: 'text-slate-100',
  barSub: 'text-slate-400',
  chip: 'border-slate-700 bg-slate-800 text-slate-300',
  chipAccent: 'border-cyan-500/40 bg-cyan-500/20 text-cyan-300',
  chipMono: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  pace: 'border-slate-800 bg-slate-900',
  paceLabel: 'text-slate-400',
  timer: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  flagOn: 'border-amber-400 bg-amber-500/20 text-amber-300',
  flagOff: 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white',
  submitTop: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400',
  card: 'border-slate-700/80 bg-[#1E293B]',
  shadow: 'shadow-md',
  shadowXl: 'shadow-xl',
  inner: 'border-y border-r border-slate-700/70 border-l-4 border-l-cyan-500 bg-[#151F30]',
  vignetteLabel: 'border-cyan-500/30 bg-cyan-950/80 text-cyan-400',
  faint: 'text-slate-500',
  dim: 'text-slate-400',
  text: 'text-slate-400',
  body: 'text-slate-300',
  title: 'text-white',
  strong: 'text-slate-100',
  accent: 'text-teal-400',
  accentCyan: 'text-cyan-400',
  accentAmber: 'text-amber-300',
  chipAnswered: 'border-slate-700 bg-slate-900 text-slate-300',
  chipOk: 'border-emerald-700/60 bg-emerald-950/60 text-emerald-300',
  chipTeal: 'border-teal-700/60 bg-teal-950/60 text-teal-300',
  chipWarn: 'border-amber-600/60 bg-amber-950/50 text-amber-300',
  track: 'border-slate-800 bg-slate-900',
  divider: 'border-slate-800/80',
  optIdle: 'border border-slate-700/80 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800/50',
  optIdleTile: 'border border-slate-700 bg-slate-800 text-slate-300',
  optIdleText: 'font-medium text-slate-300',
  optPick: 'border-2 border-teal-500 bg-teal-500/10',
  optPickTile: 'bg-teal-600 text-white',
  optPickText: 'font-semibold text-teal-100',
  optOk: 'border-2 border-emerald-500 bg-emerald-950/20',
  optOkTile: 'bg-emerald-500 text-slate-950',
  optOkText: 'font-bold text-emerald-200',
  okBadge: 'border-emerald-500/40 bg-emerald-900/60 text-emerald-400',
  optBad: 'border-2 border-rose-500 bg-rose-950/20',
  optBadTile: 'bg-rose-600 text-white',
  optBadText: 'font-semibold text-rose-200',
  badBadge: 'border-rose-500/40 bg-rose-900/60 text-rose-300',
  okHint: 'text-emerald-300/80',
  matrixHead: 'border-slate-700/80 bg-[#131C2E]',
  tabOn: 'border-cyan-500 bg-[#1E293B] font-bold text-sky-300',
  tabOff: 'border-transparent text-slate-400 hover:text-slate-200',
  warnBox: 'border-amber-500/40 bg-amber-950/20',
  warnTitle: 'text-amber-300',
  warnText: 'text-amber-200/90',
  pearl: 'border-teal-500/40 bg-[#0B132B]',
  pearlTitle: 'text-teal-300',
  pearlText: 'text-slate-100',
  swallow: 'border-slate-700/80 bg-slate-900/70',
  navBtn: 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
  ghostBtn: 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200',
  aside: 'border-slate-800/90 bg-[#0A101D]',
  paletteIdle: 'border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200',
  ringOffset: 'ring-offset-[#0A101D]',
  copilot: 'border-teal-500/30 bg-gradient-to-b from-teal-950/40 to-slate-900',
  copilotText: 'text-slate-400',
  submit: 'border-cyan-500/40 bg-[#0F172A] text-cyan-300 hover:border-cyan-400 hover:bg-slate-900',
  dissect: 'border-amber-400/50 bg-gradient-to-r from-amber-500/20 to-teal-500/20 text-amber-300 hover:border-amber-400',
};

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({
  initialQuestionId,
  onNavigate,
  questions: propQuestions,
  mode = 'TUTOR',
  darkMode = false,
}) => {
  const t: Theme = darkMode ? DARK : LIGHT;
  const cardShell = `rounded-xl border ${t.card}`;

  const [restoredRun] = useState(() =>
    propQuestions && propQuestions.length > 0 ? loadRunSession(signature(propQuestions)) : null,
  );
  const skipFirstSync = useRef<boolean>(Boolean(restoredRun));

  const [questions, setQuestions] = useState<ClinicalQuestion[]>(propQuestions ?? []);
  const [currentIndex, setCurrentIndex] = useState<number>(restoredRun?.index ?? 0);
  const [userAnswers, setUserAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>>(restoredRun?.answers ?? {});
  const [flaggedIds, setFlaggedIds] = useState<Record<string, boolean>>(restoredRun?.flags ?? {});
  const [examSubmitted, setExamSubmitted] = useState<boolean>(restoredRun?.submitted ?? false);
  const [showExplanation, setShowExplanation] = useState<boolean>(restoredRun?.showExplanation ?? mode === 'TUTOR');
  const [secondsElapsed, setSecondsElapsed] = useState<number>(restoredRun?.seconds ?? 0);
  const [showResultsScreen, setShowResultsScreen] = useState<boolean>(restoredRun?.showResults ?? false);
  const [matrixTab, setMatrixTab] = useState<MatrixTab>('rationale');
  // "Dissect with AI Tutor" can open the reasoning matrix before the question is
  // answered, so the panel has its own visibility flag.
  const [matrixOpen, setMatrixOpen] = useState<boolean>(false);

  useEffect(() => {
    if (skipFirstSync.current) {
      skipFirstSync.current = false;
      return;
    }
    if (propQuestions && propQuestions.length > 0) {
      setQuestions(propQuestions);
      setCurrentIndex(0);
      setUserAnswers({});
      setFlaggedIds({});
      setExamSubmitted(false);
      setShowExplanation(mode === 'TUTOR');
      setSecondsElapsed(0);
    }
  }, [propQuestions, mode]);

  useEffect(() => {
    if (initialQuestionId) {
      const idx = questions.findIndex(q => q.id === initialQuestionId);
      if (idx !== -1) setCurrentIndex(idx);
    }
  }, [initialQuestionId, questions]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!questions.length) return;
    saveRunSession({
      sig: signature(questions),
      answers: userAnswers,
      flags: flaggedIds,
      index: currentIndex,
      seconds: secondsElapsed,
      submitted: examSubmitted,
      showResults: showResultsScreen,
      showExplanation,
    });
  }, [questions, userAnswers, flaggedIds, currentIndex, secondsElapsed, examSubmitted, showResultsScreen, showExplanation]);

  // A fresh question always opens on the rationale tab.
  useEffect(() => {
    setMatrixTab('rationale');
    setMatrixOpen(false);
  }, [currentIndex]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const currentQ = questions[currentIndex] || questions[0];
  const selectedAnswer = currentQ ? userAnswers[currentQ.id] : undefined;
  const isAnswered = !!selectedAnswer;
  const isFlagged = currentQ ? !!flaggedIds[currentQ.id] : false;
  const isLocked = (mode === 'TUTOR' || examSubmitted) && !!selectedAnswer;

  const totalQuestions = questions.length;
  const answeredCount = Object.keys(userAnswers).length;
  const flaggedCount = Object.values(flaggedIds).filter(Boolean).length;
  const correctCount = Object.entries(userAnswers).filter(([qid, chosen]) => {
    const q = questions.find(item => item.id === qid);
    return q && q.correctOption === chosen;
  }).length;
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null;
  const paceSeconds = answeredCount > 0 ? Math.round(secondsElapsed / answeredCount) : null;
  const paceDisplay = paceSeconds !== null ? `${paceSeconds}s / Q` : '—';
  const progressPct = totalQuestions > 0 ? Math.min(100, Math.round((answeredCount / totalQuestions) * 100)) : 0;

  const handleSelectOption = (optId: 'A' | 'B' | 'C' | 'D' | 'E') => {
    if (!currentQ) return;
    if ((mode === 'TUTOR' || examSubmitted) && userAnswers[currentQ.id]) return;
    setUserAnswers(prev => ({ ...prev, [currentQ.id]: optId }));
    if (mode === 'TUTOR' || examSubmitted) {
      setShowExplanation(true);
    }
  };

  const toggleFlag = () => {
    if (!currentQ) return;
    setFlaggedIds(prev => ({ ...prev, [currentQ.id]: !prev[currentQ.id] }));
  };

  const goNext = () => setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1));
  const goPrev = () => setCurrentIndex(prev => Math.max(0, prev - 1));

  const recordAttempt = (_submitters: 'exam' | 'module') => {
    try {
      const subjects: Record<string, { total: number; correct: number }> = {};
      for (const q of questions) {
        if (!userAnswers[q.id]) continue;
        const s = subjects[q.subject] ?? (subjects[q.subject] = { total: 0, correct: 0 });
        s.total += 1;
        if (userAnswers[q.id] === q.correctOption) s.correct += 1;
      }
      const attemptedQs = questions.filter((q) => userAnswers[q.id]);
      let correct = 0;
      for (const q of attemptedQs) {
        if (userAnswers[q.id] === q.correctOption) correct += 1;
      }
      addAttempt({
        exam: questions[0]?.examType ?? 'NEET_PG',
        mode,
        total: questions.length,
        attempted: attemptedQs.length,
        correct,
        subjects,
        questionIds: questions.map((q) => q.id),
        incorrectIds: attemptedQs.filter((q) => userAnswers[q.id] !== q.correctOption).map((q) => q.id),
      });
    } catch { /* never block the run on history bookkeeping */ }
  };

  const confirmSubmit = (label: string): boolean => {
    const unanswered = questions.length - answeredCount;
    if (unanswered <= 0) return true;
    return window.confirm(
      `${unanswered} of ${questions.length} question${questions.length === 1 ? '' : 's'} are unanswered. Submit ${label} anyway?`,
    );
  };

  const handleSubmitExam = () => {
    if (!confirmSubmit('the exam')) return;
    recordAttempt('exam');
    setExamSubmitted(true);
    setShowExplanation(true);
    setShowResultsScreen(true);
  };

  const handleSubmitModule = () => {
    if (!confirmSubmit('this module')) return;
    recordAttempt('module');
    setExamSubmitted(true);
    setShowExplanation(true);
    setShowResultsScreen(true);
  };

  if (questions.length === 0) {
    return (
      <div className={`-m-4 min-h-[70vh] p-6 sm:-m-6 sm:p-8 lg:-m-8 ${t.page}`}>
        <div className={`mx-auto mt-10 max-w-2xl rounded-xl border p-10 text-center ${t.card} ${t.shadowXl}`}>
          <BookOpen className={`mx-auto h-9 w-9 ${t.faint}`} />
          <h2 className={`mt-3 text-base font-bold ${t.title}`}>No active module</h2>
          <p className={`mx-auto mt-2 max-w-md text-xs leading-relaxed ${t.text}`}>
            The runner only shows questions you actually launched. Build a module in the Practice Builder, or open a
            question from your bank, and it will appear here with your answers recorded to your real progress.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => onNavigate('practice')}
              className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-500"
            >
              Open Practice Builder
            </button>
            <button
              onClick={() => onNavigate('question-bank')}
              className={`rounded-lg border px-4 py-2 text-xs font-semibold ${t.navBtn}`}
            >
              Open Question Bank
            </button>
          </div>
        </div>
      </div>
    );
  }

  const questionPrompt = ((currentQ as any)?.question || currentQ?.questionText || '').trim();
  const rawStem = (currentQ?.stem || '').trim();
  const hasVignette = !!rawStem && rawStem.toLowerCase() !== questionPrompt.toLowerCase();
  const examLabel = EXAM_LABEL[(currentQ?.examType ?? 'NEET_PG') as ExamType] ?? 'NEET-PG';
  const bankLabel = (currentQ?.sourceType ?? 'ai-generator').replace(/-/g, ' ').toUpperCase();
  const reveal = isAnswered && showExplanation;
  const tabButton = (tab: MatrixTab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      key={tab}
      onClick={() => setMatrixTab(tab)}
      className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 py-1.5 font-mono text-[11px] transition ${
        matrixTab === tab ? t.tabOn : t.tabOff
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );

  const palette = (
    <div className={`${cardShell} p-3.5 ${t.shadow}`}>
      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className={`h-4 w-4 shrink-0 ${t.accentCyan}`} />
          <h3 className={`whitespace-nowrap font-mono text-[11px] font-bold ${t.strong}`}>Question Palette</h3>
        </div>
        <span className="whitespace-nowrap font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          {answeredCount} / {totalQuestions} Attempted
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5 font-mono text-xs font-semibold">
        {questions.map((q, idx) => {
          const ans = userAnswers[q.id];
          const isCurrent = idx === currentIndex;
          const wasFlagged = !!flaggedIds[q.id];

          let cls = t.paletteIdle;
          if (ans) {
            cls = ans === q.correctOption
              ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
              : 'bg-rose-600 text-white hover:bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.25)]';
          }
          if (isCurrent) {
            cls += ` ring-2 ring-cyan-400 ring-offset-1 ${t.ringOffset}`;
          }

          return (
            <button
              key={q.id}
              onClick={() => setCurrentIndex(idx)}
              className={`relative flex h-8 items-center justify-center rounded-lg transition ${cls}`}
              title={`Question ${idx + 1}${wasFlagged ? ' · flagged' : ''}`}
            >
              {idx + 1}
              {wasFlagged && (
                <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-amber-200/60" />
              )}
            </button>
          );
        })}
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 font-mono text-[10px] ${t.divider} ${t.text}`}>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Correct</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Wrong</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Current</span>
        <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-300'}`} /> Unseen</span>
      </div>
    </div>
  );

  return (
    <div className={`-m-4 min-h-[calc(100vh-56px)] selection:bg-teal-500/30 sm:-m-6 lg:-m-8 ${t.page}`}>
      {/* ── Top cockpit bar ─────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-6 ${t.bar}`}>
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${t.barBack}`}
            title="Return to modules"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`font-mono font-bold tracking-wide ${t.barTitle}`}>
                {examLabel} • AI GENERATED MODULE
              </span>
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide ${t.chipAccent}`}>
                {currentQ?.cognitiveTier ?? 'CLINICAL 2-STEP'}
              </span>
              <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${t.chip}`}>
                {mode === 'EXAM' ? 'Exam Mode' : 'Tutor Mode (Immediate Feedback)'}
              </span>
              <span className={`hidden rounded border px-2 py-0.5 font-mono text-[10px] font-medium sm:inline ${t.chipMono}`}>
                BANK: {bankLabel}
              </span>
            </div>
            <p className={`mt-0.5 max-w-xl truncate text-[11px] ${t.barSub}`}>
              {currentQ?.subject} • {safeSubtopic(currentQ, reveal)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className={`hidden items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs sm:flex ${t.pace}`}>
            <Gauge className="h-4 w-4 text-emerald-500" />
            <span className={t.paceLabel}>Pace:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{paceDisplay}</span>
          </div>

          {mode === 'EXAM' && !examSubmitted && (
            <button
              onClick={handleSubmitExam}
              className={`hidden rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold lg:block ${t.submitTop}`}
            >
              Submit Exam
            </button>
          )}
          {examSubmitted && (
            <span className={`hidden rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold lg:block ${t.chipMono}`}>
              Submitted
            </span>
          )}

          <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${t.timer}`}>
            <Clock className="h-4 w-4" />
            <span className="text-sm font-bold tracking-wider">{formatTimer(secondsElapsed)}</span>
          </div>

          <button
            onClick={toggleFlag}
            aria-pressed={isFlagged}
            className={`flex items-center gap-1.5 rounded-lg border p-2 transition ${isFlagged ? t.flagOn : t.flagOff}`}
            title={isFlagged ? 'Remove flag from this question' : 'Flag this question for review'}
          >
            <Flag className={`h-4 w-4 ${isFlagged ? 'fill-current' : ''}`} />
            {isFlagged && <span className="font-mono text-[10px] font-bold">FLAGGED</span>}
          </button>
        </div>
      </header>

      <div className="flex">
        {/* ── Scrollable workspace ─────────────────────────────────────── */}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-4xl space-y-5 pb-16">
            {/* Session telemetry */}
            <div className={`${cardShell} p-3.5 ${t.shadow}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className={`flex items-center gap-1.5 font-bold ${t.accent}`}>
                    <Zap className="h-4 w-4" /> Session Progress:
                  </span>
                  <span className={`rounded border px-2 py-0.5 font-semibold ${t.chipAnswered}`}>
                    Answered: {answeredCount} / {totalQuestions}
                  </span>
                  <span className={`rounded border px-2 py-0.5 font-semibold ${t.chipOk}`}>
                    Correct: {correctCount} / {answeredCount}
                  </span>
                  <span className={`rounded border px-2 py-0.5 font-semibold ${t.chipTeal}`}>
                    Accuracy: {accuracy === null ? '—' : `${accuracy}%`}
                  </span>
                  {flaggedCount > 0 && (
                    <span className={`rounded border px-2 py-0.5 font-semibold ${t.chipWarn}`}>
                      Flagged: {flaggedCount}
                    </span>
                  )}
                </div>
                <div className={`font-mono text-[11px] ${t.dim}`}>
                  Telemetry Accuracy:{' '}
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {accuracy === null ? '—' : `${accuracy}%`}
                  </span>{' '}
                  ({correctCount}/{answeredCount})
                </div>
              </div>

              <div className="mt-2.5">
                <div className={`h-2 w-full overflow-hidden rounded-full border ${t.track}`}>
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)] transition-all duration-500 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className={`mt-1 flex justify-between font-mono text-[11px] ${t.dim}`}>
                  <span>Question 1</span>
                  <span className={`font-semibold ${t.accentCyan}`}>
                    Q {currentIndex + 1} · {answeredCount} of {totalQuestions} answered ({progressPct}%)
                  </span>
                  <span>Question {totalQuestions}</span>
                </div>
              </div>
            </div>

            {/* Question card */}
            <section className={`space-y-5 rounded-xl border p-5 sm:p-6 ${t.card} ${t.shadowXl}`}>
              {hasVignette && (
                <div className={`rounded-r-xl border p-4 sm:p-5 ${t.inner}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${t.vignetteLabel}`}>
                      Clinical Vignette
                    </span>
                    <span className={`font-mono text-[10px] ${t.faint}`}>
                      {currentQ?.moduleCode ?? `Q-${currentQ?.id?.slice(-6) ?? currentIndex + 1}`}
                    </span>
                  </div>
                  <p className={`whitespace-pre-line text-[15px] leading-relaxed ${t.strong}`}>{rawStem}</p>
                </div>
              )}

              {currentQ?.image && (
                <div className={`space-y-2 rounded-xl border p-3 ${t.swallow}`}>
                  <div className={`flex items-start justify-between gap-2 font-mono text-[10px] uppercase tracking-wider ${t.dim}`}>
                    <span className="leading-snug">
                      {/* Pre-answer we show ONLY the neutral label: an image caption or
                          attribution can name the diagnosis (which is the answer), so the
                          descriptive caption is withheld until the answer is revealed.
                          safeImageCaption() also scrubs legacy stored captions that
                          contained the diagnosis outright. */}
                      {safeImageCaption(currentQ, reveal)}
                      {currentQ.imageVerified && (
                        <span className="ml-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400" title={currentQ.imageVerifyReason || 'Image verified against this question'}>
                          ✓ Verified
                        </span>
                      )}
                    </span>
                    {reveal && (currentQ.imageLicence || currentQ.imageSourceUrl) && (
                      <span className="flex shrink-0 items-center gap-2">
                        {/* Licence is rendered once, from the trusted field — the caption
                            used to repeat it, which is why it appeared twice. */}
                        {currentQ.imageLicence && <span className="opacity-70">· {currentQ.imageLicence}</span>}
                        {currentQ.imageSourceUrl && (
                          <a
                            href={currentQ.imageSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`font-semibold hover:underline ${t.accentCyan}`}
                            title="Open source"
                          >
                            Source ↗
                          </a>
                        )}
                      </span>
                    )}
                  </div>
                  <ZoomableImage
                    src={currentQ.image}
                    alt={safeImageCaption(currentQ, reveal)}
                    className={`max-h-80 w-full rounded-lg border bg-white object-contain ${t.divider}`}
                  />
                </div>
              )}

              {/* Stem — deliberately smaller than the vignette */}
              <div>
                <h2 className={`flex items-start gap-2 text-[13px] font-bold leading-snug tracking-tight sm:text-sm ${t.title}`}>
                  <span className={`mt-0.5 font-mono text-xs ${t.accent}`}>Q{currentIndex + 1}.</span>
                  <span>{questionPrompt}</span>
                </h2>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`mt-1 block font-mono text-[10px] uppercase tracking-wider ${t.dim}`}>
                    Select one option from below:
                  </span>
                  {isFlagged && (
                    <span
                      className={`mt-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${t.chipWarn}`}
                    >
                      Flagged for review
                    </span>
                  )}
                </div>
              </div>

              {/* Options */}
              <div className="space-y-3">
                {currentQ.options.map((opt) => {
                  const picked = selectedAnswer === opt.id;
                  const correct = currentQ.correctOption === opt.id;
                  const showCorrect = reveal && correct;
                  const showWrong = reveal && picked && !correct;
                  const pending = picked && !reveal;

                  const shell = showCorrect ? t.optOk : showWrong ? t.optBad : pending ? t.optPick : t.optIdle;
                  const tile = showCorrect
                    ? `${t.optOkTile} shadow-md`
                    : showWrong
                      ? `${t.optBadTile} shadow-md`
                      : pending
                        ? `${t.optPickTile} shadow-md`
                        : t.optIdleTile;
                  const label = showCorrect ? t.optOkText : showWrong ? t.optBadText : pending ? t.optPickText : t.optIdleText;

                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleSelectOption(opt.id)}
                      disabled={isLocked}
                      className={`group flex w-full flex-col gap-2 rounded-xl p-3.5 text-left transition ${shell} ${
                        isLocked ? 'cursor-default' : 'cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3.5">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${tile}`}
                          >
                            {opt.id}
                          </div>
                          <div className={`text-sm leading-snug ${label}`}>{opt.text}</div>
                        </div>
                        {showCorrect && (
                          <div className="flex shrink-0 items-center gap-1.5 pr-1">
                            <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${t.okBadge}`}>
                              CORRECT
                            </span>
                            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                          </div>
                        )}
                        {showWrong && (
                          <div className="flex shrink-0 items-center gap-1.5 pr-1">
                            <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${t.badBadge}`}>
                              YOUR PICK
                            </span>
                            <X className="h-5 w-5 text-rose-500" />
                          </div>
                        )}
                      </div>

                      {showCorrect && (
                        <div className={`pl-11 font-mono text-xs ${t.okHint}`}>
                          ✓ Keyed correct option for this item.
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Clinical Reasoning Matrix */}
            {(reveal || matrixOpen) && (
              <section id="reasoning-matrix" className={`overflow-hidden rounded-xl border ${t.card} ${t.shadowXl}`}>
                <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 pt-2.5 sm:px-4 ${t.matrixHead}`}>
                  <div className="flex items-center gap-2 pb-2">
                    <Activity className={`h-4 w-4 ${t.accentCyan}`} />
                    <span className={`font-mono text-xs font-bold uppercase tracking-wider ${t.strong}`}>
                      Clinical Reasoning Matrix
                    </span>
                  </div>
                  {reveal && (
                    <div className="flex items-center gap-0.5 overflow-x-auto">
                      {tabButton('rationale', 'Rationale', Stethoscope)}
                      {tabButton('pearl', 'High-Yield Pearls', Lightbulb)}
                      {tabButton('evidence', 'Evidence', BookOpen)}
                      {tabButton('ai', 'AI Tutor Copilot', Sparkles)}
                    </div>
                  )}
                </div>

                <div className="space-y-4 p-4 sm:p-5">
                  {!reveal && (
                    <AiQuestionTools dark={darkMode} question={currentQ} userChoice={selectedAnswer} />
                  )}

                  {reveal && matrixTab === 'rationale' && (
                    <>
                      {(currentQ?.trapExplanation || currentQ?.trapType) && (
                        <div className={`rounded-xl border p-4 ${t.warnBox}`}>
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 ${t.warnTitle}`}>
                              <Flag className="h-4 w-4" />
                            </div>
                            <div>
                              <h3 className={`font-mono text-[11px] font-bold uppercase tracking-wider ${t.warnTitle}`}>
                                Distractor dissection{currentQ?.trapType ? `: ${currentQ.trapType}` : ''}
                              </h3>
                              <p className={`mt-1 text-xs leading-relaxed ${t.warnText}`}>
                                {currentQ?.trapExplanation || 'The remaining options are plausible but do not fit the stem.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className={`space-y-3 border-t pt-3 text-sm leading-relaxed ${t.divider} ${t.body}`}>
                        <span className={`font-mono text-[11px] font-bold uppercase tracking-wider ${t.accentCyan}`}>
                          Comprehensive explanation
                        </span>
                        <p className="whitespace-pre-line">{currentQ?.explanation || 'No explanation was attached to this item.'}</p>
                      </div>

                      <div className={`space-y-1.5 border-t pt-3 ${t.divider}`}>
                        <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${t.accentCyan}`}>
                          Option verdicts
                        </span>
                        {currentQ.options.map((opt) => {
                          const correct = opt.id === currentQ.correctOption;
                          return (
                            <div key={opt.id} className="flex items-start gap-2 text-xs">
                              <span
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${
                                  correct ? 'bg-emerald-600 text-white' : t.optIdleTile
                                }`}
                              >
                                {opt.id}
                              </span>
                              <p className={`min-w-0 flex-1 ${t.dim}`}>
                                <span className={correct ? 'font-semibold text-emerald-600 dark:text-emerald-300' : 'font-semibold text-rose-500 dark:text-rose-400'}>
                                  {correct ? 'Correct answer. ' : 'Distractor. '}
                                </span>
                                {opt.text}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {reveal && matrixTab === 'pearl' && (
                    currentQ?.boardPearl ? (
                      <div className={`flex items-start gap-3.5 rounded-xl border p-4 ${t.pearl}`}>
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/15 ${t.pearlTitle}`}>
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <div>
                          <span className={`mb-0.5 block font-mono text-[11px] font-bold uppercase tracking-wider ${t.pearlTitle}`}>
                            High-Yield Board Pearl
                          </span>
                          <p className={`font-mono text-sm font-semibold ${t.pearlText}`}>{currentQ.boardPearl}</p>
                        </div>
                      </div>
                    ) : (
                      <p className={`text-xs ${t.text}`}>No board pearl attached to this item.</p>
                    )
                  )}

                  {reveal && matrixTab === 'evidence' && (
                    <div className="space-y-3">
                      <div className={`rounded-xl border p-3.5 ${t.swallow}`}>
                        <div className={`mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider ${t.accentCyan}`}>
                          <Quote className="h-3.5 w-3.5" /> Verified citations
                        </div>
                        {currentQ?.citations && currentQ.citations.length > 0 ? (
                          <ul className={`space-y-1.5 text-xs ${t.body}`}>
                            {currentQ.citations.map((c, i) => (
                              <li key={`${c}-${i}`} className="flex items-start gap-2">
                                <span className="mt-0.5 text-cyan-500">•</span>
                                <span>{c}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={`text-xs ${t.text}`}>No citations attached to this item.</p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                        <div className={`rounded-lg border p-2.5 text-center ${t.swallow}`}>
                          <div className={`text-base font-extrabold leading-tight ${t.title}`}>
                            {currentQ?.difficultyTier ?? '—'}
                          </div>
                          <div className={`mt-1 text-[9px] font-bold uppercase ${t.dim}`}>Difficulty</div>
                        </div>
                        <div className={`rounded-lg border p-2.5 text-center ${t.swallow}`}>
                          <div className={`text-base font-extrabold leading-tight ${t.accentCyan}`}>
                            {currentQ?.targetAccuracy ?? '—'}%
                          </div>
                          <div className={`mt-1 text-[9px] font-bold uppercase ${t.dim}`}>Target accuracy</div>
                        </div>
                      </div>

                      {currentQ?.imageSourceUrl && (
                        <a
                          href={currentQ.imageSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block truncate rounded-lg border p-2.5 text-xs hover:underline ${t.swallow} ${t.accentCyan}`}
                        >
                          Image source ↗ {currentQ.imageSourceUrl}
                        </a>
                      )}
                    </div>
                  )}

                  {reveal && matrixTab === 'ai' && (
                    <AiQuestionTools dark={darkMode} question={currentQ} userChoice={selectedAnswer} />
                  )}
                </div>
              </section>
            )}

            {/* Bottom navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                disabled={currentIndex === 0}
                onClick={goPrev}
                className={`flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${t.navBtn}`}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <div className="flex items-center gap-2">
                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={goNext}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${t.ghostBtn}`}
                  title="Skip without answering"
                >
                  Skip
                </button>

                {(mode === 'TUTOR' || examSubmitted) && (
                  <button
                    // Open the Clinical AI Tutor window with this question attached,
                    // rather than only revealing the inline reasoning matrix.
                    onClick={() => onNavigate('ai-tutor', currentQ?.id)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold transition active:scale-95 ${t.dissect}`}
                  >
                    <Stethoscope className="h-4 w-4" />
                    Dissect with AI Tutor
                  </button>
                )}

                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={goNext}
                  className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-teal-900/30 transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Compact palette for narrow screens */}
            <div className="xl:hidden">{palette}</div>
          </div>
        </main>

        {/* ── Right rail: palette + telemetry + CTA ───────────────────── */}
        <aside className={`hidden w-72 shrink-0 flex-col space-y-4 border-l p-4 xl:sticky xl:top-[57px] xl:flex xl:max-h-[calc(100vh-57px)] xl:self-start xl:overflow-y-auto ${t.aside}`}>
          {palette}

          <div className={`${cardShell} p-3.5 font-mono ${t.shadow}`}>
            <h4 className={`mb-2.5 flex items-center gap-1.5 text-xs font-bold ${t.strong}`}>
              <Gauge className={`h-4 w-4 ${t.accent}`} /> Telemetry Status
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-lg border p-2.5 text-center ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`text-lg font-extrabold leading-tight ${t.title}`}>{correctCount} / {answeredCount}</div>
                <div className={`mt-1 text-[9px] font-bold uppercase ${t.dim}`}>Correct Hits</div>
              </div>
              <div className={`rounded-lg border p-2.5 text-center ${darkMode ? 'border-emerald-700/50 bg-emerald-950/40' : 'border-emerald-600/30 bg-emerald-50'}`}>
                <div className="text-lg font-extrabold leading-tight text-emerald-600 dark:text-emerald-400">
                  {accuracy === null ? '—' : `${accuracy}%`}
                </div>
                <div className={`mt-1 text-[9px] font-bold uppercase ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Accuracy</div>
              </div>
            </div>
            <div className={`mt-2 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10px] ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${t.dim}`}>
              <span>Pace</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{paceDisplay}</span>
            </div>
            <div className={`mt-1.5 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10px] ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${t.dim}`}>
              <span>Flagged</span>
              <span className="font-bold text-amber-600 dark:text-amber-300">{flaggedCount}</span>
            </div>
          </div>

          <div className="mt-auto pt-1">
            <button
              onClick={handleSubmitModule}
              disabled={examSubmitted}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 font-mono text-[11px] font-bold shadow-sm transition disabled:opacity-50 ${t.submit}`}
            >
              {examSubmitted ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Module Submitted
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Submit Module &amp; View Results
                </>
              )}
            </button>
            <button
              onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${t.ghostBtn}`}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
