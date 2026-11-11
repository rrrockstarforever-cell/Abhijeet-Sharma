import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
  page: '  selection:',
  bar: ' ',
  barBack: 'border    ',
  barTitle: '',
  barSub: '',
  chip: 'border   ',
  chipAccent: 'border   ',
  chipMono: 'border   ',
  pace: 'border   ',
  paceLabel: '',
  timer: 'border    ',
  flagOn: 'border    ',
  flagOff: 'border     ',
  submitTop: 'border    ',
  card: 'border  ',
  shadow: '',
  shadowXl: '',
  inner: 'border-y-2 border-r-2  border-l-4 border-l-[#0F8B8D] ',
  vignetteLabel: 'border   ',
  faint: '',
  dim: '',
  text: '',
  body: '',
  title: '',
  strong: '',
  accent: '',
  accentCyan: '',
  accentAmber: '',
  chipAnswered: 'border   ',
  chipOk: 'border   ',
  chipTeal: 'border   ',
  chipWarn: 'border   ',
  track: 'border  ',
  divider: '',
  optIdle: 'border   hover:-translate-y-0.5 ',
  optIdleTile: 'border   ',
  optIdleText: 'font-semibold ',
  optPick: 'border   -translate-y-0.5',
  optPickTile: ' text-white',
  optPickText: 'font-medium ',
  optOk: 'border   -translate-y-0.5',
  optOkTile: ' text-white',
  optOkText: 'font-medium ',
  okBadge: 'border   ',
  optBad: 'border   -translate-y-0.5',
  optBadTile: ' text-white',
  optBadText: 'font-medium ',
  badBadge: 'border   ',
  okHint: '',
  matrixHead: 'border-b-2  ',
  tabOn: 'border-b-4   font-medium ',
  tabOff: 'border-b-4 border-transparent  ',
  warnBox: 'border   ',
  warnTitle: '',
  warnText: '',
  pearl: 'border   ',
  pearlTitle: '',
  pearlText: '',
  swallow: 'border  ',
  navBtn: 'border    ',
  ghostBtn: 'border    ',
  aside: 'border-l-2  ',
  paletteIdle: 'border    ',
  ringOffset: 'ring-offset-[#FFF9ED]',
  copilot: 'border  ',
  copilotText: '',
  submit: 'border    ',
  dissect: 'border   hover:brightness-105',
};

type Theme = typeof LIGHT;

const DARK: Theme = {
  page: '  selection:',
  bar: ' ',
  barBack: 'border    ',
  barTitle: '',
  barSub: '',
  chip: 'border   ',
  chipAccent: 'border   ',
  chipMono: 'border   ',
  pace: 'border   ',
  paceLabel: '',
  timer: 'border    ',
  flagOn: 'border    ',
  flagOff: 'border     hover:text-white',
  submitTop: 'border    ',
  card: 'border  ',
  shadow: '',
  shadowXl: '',
  inner: 'border-y-2 border-r-2  border-l-4 border-l-[#2DD4BF] ',
  vignetteLabel: 'border   ',
  faint: '',
  dim: '',
  text: '',
  body: '',
  title: '',
  strong: '',
  accent: '',
  accentCyan: '',
  accentAmber: '',
  chipAnswered: 'border   ',
  chipOk: 'border   ',
  chipTeal: 'border   ',
  chipWarn: 'border   ',
  track: 'border  ',
  divider: '',
  optIdle: 'border   hover:-translate-y-0.5 ',
  optIdleTile: 'border   ',
  optIdleText: 'font-semibold ',
  optPick: 'border   -translate-y-0.5',
  optPickTile: ' ',
  optPickText: 'font-medium ',
  optOk: 'border   -translate-y-0.5',
  optOkTile: ' ',
  optOkText: 'font-medium ',
  okBadge: 'border   ',
  optBad: 'border   -translate-y-0.5',
  optBadTile: ' ',
  optBadText: 'font-medium ',
  badBadge: 'border   ',
  okHint: '',
  matrixHead: 'border-b-2  ',
  tabOn: 'border-b-4   font-medium ',
  tabOff: 'border-b-4 border-transparent  ',
  warnBox: 'border   ',
  warnTitle: '',
  warnText: '',
  pearl: 'border   ',
  pearlTitle: '',
  pearlText: '',
  swallow: 'border  ',
  navBtn: 'border    ',
  ghostBtn: 'border    ',
  aside: 'border-l-2  ',
  paletteIdle: 'border    ',
  ringOffset: 'ring-offset-[#1C1916]',
  copilot: 'border  ',
  copilotText: '',
  submit: 'border    ',
  dissect: 'border   hover:brightness-110',
};

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({
  initialQuestionId,
  onNavigate,
  questions: propQuestions,
  mode = 'TUTOR',
  darkMode = false,
}) => {
  const t: Theme = darkMode ? DARK : LIGHT;
  const shouldReduceMotion = useReducedMotion();
  const directionRef = useRef<1 | -1>(1);
  const dragBlockedRef = useRef(false);
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

  // The run starts over only when a different set of questions is passed in. A parent that passes a new array with the same
  // questions (same ids) must not reset the saved position and answers, or the progress is lost on every re-render.
  const lastSigRef = useRef<string>(propQuestions && propQuestions.length > 0 ? signature(propQuestions) : '');
  useEffect(() => {
    if (skipFirstSync.current) {
      skipFirstSync.current = false;
      return;
    }
    if (propQuestions && propQuestions.length > 0) {
      const sig = signature(propQuestions);
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;
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
    // Let the Question Bank's saved list show the new progress.
    window.dispatchEvent(new Event('pulse-modules-changed'));
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

  const goNext = () => {
    directionRef.current = 1;
    setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1));
  };
  const goPrev = () => {
    directionRef.current = -1;
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

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
          <h2 className={`mt-3 text-base font-medium ${t.title}`}>No active module</h2>
          <p className={`mx-auto mt-2 max-w-md text-xs leading-relaxed ${t.text}`}>
            The runner only shows questions you actually launched. Build a module in the Practice Builder, or open a
            question from your bank, and it will appear here with your answers recorded to your real progress.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => onNavigate('practice')}
              className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-500"
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
  const tabButton = (tab: MatrixTab, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const tabNo = tab === 'rationale' ? '01' : tab === 'pearl' ? '02' : tab === 'evidence' ? '03' : '04';
    return (
      <button
        key={tab}
        onClick={() => setMatrixTab(tab)}
        className={`flex min-h-[44px] items-center gap-2 rounded-t-md border-b-4 px-2.5 py-1.5 font-mono text-[11px] transition ${
          matrixTab === tab ? t.tabOn : t.tabOff
        }`}
      >
        <span className={`font-[''] text-sm tracking-wide ${matrixTab === tab ? '' : 'opacity-60'}`}>{tabNo}</span>
        <Icon className="h-3.5 w-3.5" />
        <span className="whitespace-nowrap font-medium">{label}</span>
      </button>
    );
  };

  const questionCardVariants = {
    enter: (dir: number) => ({
      x: shouldReduceMotion ? 0 : dir * 84,
      rotate: shouldReduceMotion ? 0 : dir * 1.4,
      opacity: 0,
    }),
    center: { x: 0, rotate: 0, opacity: 1 },
    exit: (dir: number) => ({
      x: shouldReduceMotion ? 0 : -dir * 64,
      rotate: shouldReduceMotion ? 0 : -dir * 1,
      opacity: 0,
    }),
  };

  const handleQuestionDragStart = (event: any) => {
    const tagName = String((event?.target as HTMLElement | null)?.tagName || '').toUpperCase();
    dragBlockedRef.current = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  };

  const handleQuestionDragEnd = (_event: any, info: any) => {
    if (dragBlockedRef.current) {
      dragBlockedRef.current = false;
      return;
    }
    if (info.offset.x < -80 || info.velocity.x < -500) {
      goNext();
    } else if (info.offset.x > 80 || info.velocity.x > 500) {
      goPrev();
    }
  };

  const palette = (
    <div className={`${cardShell} p-3.5 ${t.shadow}`}>
      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className={`h-4 w-4 shrink-0 ${t.accentCyan}`} />
          <h3 className={`whitespace-nowrap font-mono text-[11px] font-medium ${t.strong}`}>Question Palette</h3>
        </div>
        <span className="whitespace-nowrap font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          {answeredCount} / {totalQuestions} Attempted
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5 font-mono text-xs font-semibold">
        {questions.map((q, idx) => {
          const ans = userAnswers[q.id];
          const isCurrent = idx === currentIndex;
          const wasFlagged = !!flaggedIds[q.id];

          const answerCls = ans === q.correctOption
            ? darkMode
              ? '   '
              : '   '
            : darkMode
              ? '   '
              : '   ';
          let cls = t.paletteIdle;
          if (ans) cls = answerCls;
          if (isCurrent) {
            cls += ` ring-2  ring-offset-1 ${t.ringOffset}`;
          }

          return (
            <button
              key={q.id}
              onClick={() => setCurrentIndex(idx)}
              className={`relative flex min-h-[36px] items-center justify-center rounded-md border font-medium transition active:translate-y-0.5 ${cls}`}
              title={`Question ${idx + 1}${wasFlagged ? ' · flagged' : ''}`}
            >
              {idx + 1}
              {wasFlagged && (
                <span
                  className={`absolute -right-1 -top-1 h-3 w-3 border ${
                    darkMode ? ' ' : ' '
                  }`}
                />
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
      <header className={`sticky top-0 z-20 overflow-hidden border-b-2 px-3 py-2 sm:px-6 ${t.bar}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: shouldReduceMotion
              ? 'none'
              : 'repeating-conic-gradient(from 0deg at 50% 50%, currentColor 0deg 2deg, transparent 2deg 12deg)',
          }}
        />
        <div className="relative z-10 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition ${t.barBack}`}
              title="Return to modules"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className={`font-[''] text-lg tracking-wide ${t.barTitle}`}>
                  {examLabel} • AI MODULE
                </span>
                <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide ${t.chipAccent}`}>
                  {currentQ?.cognitiveTier ?? 'CLINICAL 2-STEP'}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.chip}`}>
                  {mode === 'EXAM' ? 'Exam Mode' : 'Tutor Mode'}
                </span>
                <span className={`hidden rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium sm:inline ${t.chipMono}`}>
                  BANK: {bankLabel}
                </span>
              </div>
              <p className={`mt-0.5 max-w-xl truncate text-[11px] ${t.barSub}`}>
                {currentQ?.subject} • {safeSubtopic(currentQ, reveal)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-medium">
              <span className={`rounded-md border px-2 py-1 ${t.chipAnswered}`}>
                Q {currentIndex + 1}/{totalQuestions}
              </span>
              <span className={`rounded-md border px-2 py-1 ${t.chipOk}`}>
                ANS {answeredCount}
              </span>
              <span className={`rounded-md border px-2 py-1 ${t.chipWarn}`}>
                FLAG {flaggedCount}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className={`hidden items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs sm:flex ${t.pace}`}>
              <Gauge className={`h-4 w-4 ${darkMode ? '' : ''}`} />
              <span className={t.paceLabel}>PACE</span>
              <span className={`font-[''] text-base ${t.accent}`}>{paceDisplay}</span>
            </div>

            {mode === 'EXAM' && !examSubmitted && (
              <button
                onClick={handleSubmitExam}
                className={`hidden min-h-[44px] rounded-lg px-3 py-1.5 font-mono text-[11px] font-medium sm:block ${t.submitTop}`}
              >
                SUBMIT EXAM
              </button>
            )}
            {examSubmitted && (
              <span className={`hidden rounded-lg px-2.5 py-1 font-mono text-[11px] font-medium sm:block ${t.chipMono}`}>
                SUBMITTED
              </span>
            )}

            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs font-semibold ${t.timer}`}>
              <Clock className="h-4 w-4" />
              <span className="font-[''] text-xl tracking-wider">{formatTimer(secondsElapsed)}</span>
            </div>

            <button
              onClick={toggleFlag}
              aria-pressed={isFlagged}
              className={`relative flex min-h-[44px] items-center gap-1.5 rounded-lg p-2 transition ${isFlagged ? t.flagOn : t.flagOff}`}
              title={isFlagged ? 'Remove flag from this question' : 'Flag this question for review'}
            >
              <Flag className={`h-4 w-4 ${isFlagged ? 'fill-current' : ''}`} />
              <AnimatePresence>
                {isFlagged && (
                  <motion.span
                    initial={shouldReduceMotion ? false : { scale: 0.6, rotate: -12, opacity: 0 }}
                    animate={{ scale: 1, rotate: -6, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                    className={`pointer-events-none absolute -right-2 -top-3 rounded-md border  px-1.5 py-0.5 font-[''] text-[10px] tracking-wide  ${
                      darkMode ? ' ' : ' '
                    }`}
                  >
                    FLAGGED!
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>

        <div className={`relative z-10 mt-2 h-2 w-full overflow-hidden rounded-full border ${t.track}`}>
          <div className="h-full rounded-full  transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <div className="flex">
        {/* ── Scrollable workspace ─────────────────────────────────────── */}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-4xl space-y-5 pb-16">
            {/* Session telemetry */}
            <div className={`relative overflow-hidden ${cardShell} p-3.5 ${t.shadow}`}>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-12 opacity-10"
                style={{
                  backgroundImage: `radial-gradient(circle, ${darkMode ? '#EEEEED' : '#14110F'} 1px, transparent 1px)`,
                  backgroundSize: '8px 8px',
                }}
              />
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className={`flex items-center gap-1.5 font-[''] text-lg tracking-wide ${t.accent}`}>
                    <Zap className="h-4 w-4" /> PULSE PROGRESS
                  </span>
                  <span className={`rounded-md border px-2 py-1 font-medium ${t.chipAnswered}`}>ANSWERED {answeredCount}/{totalQuestions}</span>
                  <span className={`rounded-md border px-2 py-1 font-medium ${t.chipOk}`}>CORRECT {correctCount}</span>
                  <span className={`rounded-md border px-2 py-1 font-medium ${t.chipTeal}`}>ACCURACY {accuracy === null ? '—' : `${accuracy}%`}</span>
                  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium ${t.chipWarn}`}>
                    FLAG {flaggedCount}
                    <span className="flex gap-1">
                      {Array.from({ length: Math.min(flaggedCount, 4) }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-2 w-2 border ${darkMode ? ' ' : ' '}`}
                        />
                      ))}
                    </span>
                  </span>
                </div>
                <div className={`font-mono text-[11px] ${t.dim}`}>
                  CURRENT <span className={`font-[''] text-base ${t.accentCyan}`}>Q{currentIndex + 1}</span> OF {totalQuestions}
                </div>
              </div>

              <div className="relative z-10 mt-3">
                <div className={`h-3 w-full overflow-hidden rounded-full border ${t.track}`}>
                  <div
                    className="h-full rounded-full  transition-all duration-500 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className={`mt-1 flex justify-between font-mono text-[11px] ${t.dim}`}>
                  <span>1</span>
                  <span className={`font-medium ${t.accentCyan}`}>
                    {answeredCount} of {totalQuestions} answered ({progressPct}%)
                  </span>
                  <span>{totalQuestions}</span>
                </div>
              </div>
            </div>

            {/* Question card */}
            <AnimatePresence mode="popLayout" initial={false} custom={directionRef.current}>
              <motion.div
                key={currentIndex}
                custom={directionRef.current}
                variants={questionCardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: 'easeOut' }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragStart={handleQuestionDragStart}
                onDragEnd={handleQuestionDragEnd}
              >
                <section className={`space-y-5 rounded-xl border p-5 sm:p-6 ${t.card} ${t.shadowXl}`}>
              {hasVignette && (
                <div className={`rounded-r-xl border p-4 sm:p-5 ${t.inner}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${t.vignetteLabel}`}>
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
                        <span className="ml-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400" title={currentQ.imageVerifyReason || 'Image verified against this question'}>
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
                <h2 className={`flex items-start gap-3 text-[15px] font-semibold leading-relaxed sm:text-base ${t.title}`}>
                  <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium ${t.vignetteLabel}`}>
                    Q{currentIndex + 1}
                  </span>
                  <span className="min-w-0">{questionPrompt}</span>
                </h2>
                <div className="flex flex-wrap items-center justify-between gap-2 pl-0 sm:pl-12">
                  <span className={`mt-2 block font-mono text-[10px] uppercase tracking-wider ${t.dim}`}>
                    Select one option from below
                  </span>
                  {isFlagged && (
                    <span
                      className={`mt-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${t.chipWarn}`}
                    >
                      Flagged for review
                    </span>
                  )}
                </div>
              </div>

              {/* Options */}
              <div className="space-y-2.5">
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
                      aria-pressed={picked}
                      className={`group relative flex min-h-[52px] w-full flex-col gap-2 rounded-xl px-4 py-3.5 text-left transition-all duration-150 active:translate-y-0 ${shell} ${
                        isLocked
                          ? 'cursor-default'
                          : `cursor-pointer hover:-translate-y-1 ${darkMode ? 'hover:' : 'hover:'}`
                      }`}
                    >
                      {showCorrect && (
                        <span
                          className={`absolute -right-1 -top-2 z-10 -rounded-md border px-2 py-0.5 font-[''] text-sm tracking-wide ${t.okBadge} ${
                            darkMode ? '' : ''
                          }`}
                        >
                          CORRECT!
                        </span>
                      )}
                      {showWrong && (
                        <span
                          className={`absolute -right-1 -top-2 z-10 rounded-md border px-2 py-0.5 font-[''] text-sm tracking-wide ${t.badBadge} ${
                            darkMode ? '' : ''
                          }`}
                        >
                          YOUR PICK
                        </span>
                      )}
                      {pending && (
                        <span
                          className={`absolute -right-1 -top-2 z-10 -rounded-md border px-2 py-0.5 font-[''] text-sm tracking-wide ${t.okBadge} ${
                            darkMode ? '' : ''
                          }`}
                        >
                          LOCKED IN
                        </span>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-4">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-medium ${tile}`}
                          >
                            {opt.id}
                          </div>
                          <div className={`text-[15px] leading-relaxed ${label}`}>{opt.text}</div>
                        </div>
                        {showCorrect && (
                          <CheckCircle2 className={`h-6 w-6 shrink-0 ${darkMode ? '' : ''}`} />
                        )}
                        {showWrong && (
                          <X className={`h-6 w-6 shrink-0 ${darkMode ? '' : ''}`} />
                        )}
                      </div>

                      {showCorrect && (
                        <div className={`pl-12 font-mono text-xs font-medium ${t.okHint}`}>
                          ✓ Keyed correct option for this item.
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
                </section>
              </motion.div>
            </AnimatePresence>

            {/* Clinical Reasoning Matrix */}
            {(reveal || matrixOpen) && (
              <>
                {matrixOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="fixed inset-0 z-30  backdrop-blur-[2px] sm:"
                    onClick={() => setMatrixOpen(false)}
                    aria-hidden
                  />
                )}
                <section
                  id="reasoning-matrix"
                  className={`${
                    matrixOpen
                      ? 'fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[560px] sm:max-w-[92vw] sm:rounded-none sm:border-l-4'
                      : 'overflow-hidden rounded-xl border'
                  } ${t.card} ${t.shadowXl}`}
                >
                <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 pt-2.5 sm:px-4 ${t.matrixHead}`}>
                  <div className="flex items-center gap-2 pb-2">
                    <Activity className={`h-4 w-4 ${t.accentCyan}`} />
                    <span className={`font-mono text-xs font-medium uppercase tracking-wider ${t.strong}`}>
                      Clinical Reasoning Matrix
                    </span>
                    {matrixOpen && (
                      <button
                        onClick={() => setMatrixOpen(false)}
                        className={`ml-1 flex h-8 w-8 items-center justify-center rounded-md ${t.ghostBtn}`}
                        title="Close reasoning matrix"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
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
                              <h3 className={`font-mono text-[11px] font-medium uppercase tracking-wider ${t.warnTitle}`}>
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
                        <span className={`font-mono text-[11px] font-medium uppercase tracking-wider ${t.accentCyan}`}>
                          Comprehensive explanation
                        </span>
                        <p className="whitespace-pre-line">{currentQ?.explanation || 'No explanation was attached to this item.'}</p>
                      </div>

                      <div className={`space-y-1.5 border-t pt-3 ${t.divider}`}>
                        <span className={`font-mono text-[10px] font-medium uppercase tracking-wider ${t.accentCyan}`}>
                          Option verdicts
                        </span>
                        {currentQ.options.map((opt) => {
                          const correct = opt.id === currentQ.correctOption;
                          return (
                            <div key={opt.id} className="flex items-start gap-2 text-xs">
                              <span
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-medium ${
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
                          <span className={`mb-0.5 block font-mono text-[11px] font-medium uppercase tracking-wider ${t.pearlTitle}`}>
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
                        <div className={`mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-wider ${t.accentCyan}`}>
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
                          <div className={`text-base font-medium leading-tight ${t.title}`}>
                            {currentQ?.difficultyTier ?? '—'}
                          </div>
                          <div className={`mt-1 text-[9px] font-medium uppercase ${t.dim}`}>Difficulty</div>
                        </div>
                        <div className={`rounded-lg border p-2.5 text-center ${t.swallow}`}>
                          <div className={`text-base font-medium leading-tight ${t.accentCyan}`}>
                            {currentQ?.targetAccuracy ?? '—'}%
                          </div>
                          <div className={`mt-1 text-[9px] font-medium uppercase ${t.dim}`}>Target accuracy</div>
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
              </>
            )}

            {/* Bottom navigation */}
            <div
              className={`sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t-2 px-4 py-2 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none ${
                darkMode
                  ? '  '
                  : '  '
              }`}
            >
              <button
                disabled={currentIndex === 0}
                onClick={goPrev}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-medium transition active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${t.navBtn}`}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={goNext}
                  className={`min-h-[44px] rounded-lg border px-3 py-2 text-xs font-medium transition active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${t.ghostBtn}`}
                  title="Skip without answering"
                >
                  Skip
                </button>

                {(mode === 'TUTOR' || examSubmitted) && (
                  <button
                    // Open the reasoning matrix as an ink-outlined side sheet/bottom sheet.
                    onClick={() => setMatrixOpen(true)}
                    className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium transition active:scale-95 ${t.dissect}`}
                  >
                    <Stethoscope className="h-4 w-4" />
                    Dissect with AI Tutor
                  </button>
                )}

                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={goNext}
                  className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border  px-5 py-2 text-xs font-medium  transition  active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${
                    darkMode ? ' ' : ' '
                  }`}
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
            <h4 className={`mb-2.5 flex items-center gap-1.5 text-xs font-medium ${t.strong}`}>
              <Gauge className={`h-4 w-4 ${t.accent}`} /> Telemetry Status
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-lg border p-2.5 text-center ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`text-lg font-medium leading-tight ${t.title}`}>{correctCount} / {answeredCount}</div>
                <div className={`mt-1 text-[9px] font-medium uppercase ${t.dim}`}>Correct Hits</div>
              </div>
              <div className={`rounded-lg border p-2.5 text-center ${darkMode ? 'border-emerald-700/50 bg-emerald-950/40' : 'border-emerald-600/30 bg-emerald-50'}`}>
                <div className="text-lg font-medium leading-tight text-emerald-600 dark:text-emerald-400">
                  {accuracy === null ? '—' : `${accuracy}%`}
                </div>
                <div className={`mt-1 text-[9px] font-medium uppercase ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Accuracy</div>
              </div>
            </div>
            <div className={`mt-2 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10px] ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${t.dim}`}>
              <span>Pace</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{paceDisplay}</span>
            </div>
            <div className={`mt-1.5 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10px] ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${t.dim}`}>
              <span>Flagged</span>
              <span className="font-medium text-amber-600 dark:text-amber-300">{flaggedCount}</span>
            </div>
          </div>

          <div className="mt-auto pt-1">
            <button
              onClick={handleSubmitModule}
              disabled={examSubmitted}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 font-mono text-[11px] font-medium shadow-sm transition disabled:opacity-50 ${t.submit}`}
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
