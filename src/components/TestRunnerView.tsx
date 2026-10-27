import React, { useState, useEffect, useRef } from 'react';
import { 
  Clock, 
  Flag, 
  CheckCircle2, 
  AlertTriangle, 
  Brain, 
  BookOpen, 
  Sparkles, 
  ChevronLeft, 
  ChevronRight, 
  Check, 
  X,
  Award,
  TrendingUp,
  Activity,
  Layers
} from 'lucide-react';
import { ClinicalQuestion, AppView, ExamType } from '../types.ts';
import { AiQuestionTools } from './AiQuestionTools.tsx';
import { addAttempt } from '../utils/attemptStore.ts';
import { loadRunSession, saveRunSession, signature } from '../utils/sessionStore.ts';

interface TestRunnerViewProps {
  initialQuestionId?: string;
  onNavigate: (view: AppView, targetId?: string) => void;
  questions?: ClinicalQuestion[];
  mode?: 'EXAM' | 'TUTOR';
}

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({
  initialQuestionId,
  onNavigate,
  questions: propQuestions,
  mode = 'TUTOR',
}) => {
  // Only real questions ever reach the runner. With no module launched there is
  // nothing to answer, so the view shows an empty state instead of sample items.
  // Progress for this exact question set is restored, so leaving the screen, or
  // restarting the app, never loses answers, flags, position or the timer.
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

  // Sync questions if prop changes
  useEffect(() => {
    // The first run after a restore must not reset the progress we just loaded.
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
      setShowResultsScreen(false);
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

  // Save progress for this question set whenever any of it changes.
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

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const currentQ = questions[currentIndex] || questions[0];
  const selectedAnswer = userAnswers[currentQ?.id];
  const isAnswered = !!selectedAnswer;
  const isFlagged = !!flaggedIds[currentQ?.id];
  const isAMC = (questions.length > 0 && questions.some(q => q.examType === 'AMC_CAT')) || currentQ?.examType === 'AMC_CAT';
  // A revealed question is final: in Tutor mode the key is shown on the first pick, and after
  // submit everything is graded. Without this lock a second click silently re-scored the
  // question (a wrong pick could be turned into a "correct" one, inflating accuracy).
  // Exam mode BEFORE submit is deliberately not locked — changing answers there is the point.
  const isLocked = (mode === 'TUTOR' || examSubmitted) && !!selectedAnswer;

  // Computed session metrics strictly from real answers
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(userAnswers).length;
  const flaggedCount = Object.values(flaggedIds).filter(Boolean).length;
  const correctCount = Object.entries(userAnswers).filter(([qid, chosen]) => {
    const q = questions.find(item => item.id === qid);
    return q && q.correctOption === chosen;
  }).length;
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null;
  const paceSeconds = answeredCount > 0 ? Math.round(secondsElapsed / answeredCount) : null;
  const paceDisplay = paceSeconds !== null ? `${paceSeconds}s / Q` : '-';
  const amcEstimatedScore = accuracy !== null ? Math.round(100 + (accuracy / 100) * 400) : 0;

  const handleSelectOption = (optId: 'A' | 'B' | 'C' | 'D' | 'E') => {
    if (!currentQ) return;
    // Already revealed/submitted: keep the first answer. This is the fix for the score
    // flipping from 0/1 to 1/1 when another option was clicked after the key appeared.
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

  // Record a REAL attempt so analytics / revision stats are computed from actual history
  // (PARITY section 12: progress must be computed from stored attempts, not mocks).
  const recordAttempt = (_submitters: 'exam' | 'module') => {
    try {
      const subjects: Record<string, { total: number; correct: number }> = {};
      for (const q of questions) {
        // Only answered questions count toward subject accuracy — unanswered items
        // must never be silently scored as wrong.
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

  // Real submit confirmation: names how many questions are still unanswered.
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
      <div className="max-w-2xl mx-auto mt-10">
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center space-y-3">
          <BookOpen className="w-9 h-9 text-slate-300 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">No active module</h2>
          <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            The runner only shows questions you actually launched. Build a module in the Practice
            Builder, or open a question from your bank, and it will appear here with your answers
            recorded to your real progress.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              onClick={() => onNavigate('practice')}
              className="px-4 py-2 rounded-xl bg-[#001432] hover:bg-[#13294b] text-white text-xs font-bold"
            >
              Open Practice Builder
            </button>
            <button
              onClick={() => onNavigate('question-bank')}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
            >
              Open Question Bank
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Runner Header Bar */}
      <div className="bg-[#001432] rounded-2xl p-4 sm:p-5 text-white border border-[#13294b] shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate(currentQ.sourceType ? 'question-bank' : 'practice')}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold text-[#8ff3f4]">
                {currentQ.moduleCode || 'CLINICAL BLOCK #8842'}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0f8b8d]/20 text-[#8ff3f4] border border-[#0f8b8d]/30">
                {currentQ.cognitiveTier}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {mode === 'EXAM' ? 'Exam Mode (Strict Timed)' : 'Tutor Mode (Immediate Feedback)'}
              </span>
              {currentQ.sourceType && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-900/60 text-[#8ff3f4] border border-teal-500/30">
                  Bank: {currentQ.sourceType.toUpperCase()}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-300 font-medium mt-1">
              {currentQ.subject} · {currentQ.subtopic}
            </div>
          </div>
        </div>

        {/* Right side stats: Pace + Timer + Submit + Flag */}
        <div className="flex items-center gap-3">
          {mode === 'EXAM' && !examSubmitted && (
            <button
              onClick={handleSubmitExam}
              className="px-3.5 py-1.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all shadow-xs"
            >
              Submit Exam
            </button>
          )}

          {examSubmitted && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold font-mono">
              Exam Submitted
            </span>
          )}

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-mono">
            <span className="text-slate-400">Mock Pace:</span>
            <span className="text-emerald-400 font-bold">{paceDisplay}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-white">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{formatTimer(secondsElapsed)}</span>
          </div>

          <button
            onClick={toggleFlag}
            className={`p-2 rounded-xl border transition-colors ${
              isFlagged 
                ? 'bg-amber-500/20 border-amber-500 text-amber-400' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Flag question for review"
          >
            <Flag className={`w-4 h-4 ${isFlagged ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {/* Honest Session Progress / Performance Panel */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#0f8b8d]" />
            <span className="font-bold text-slate-900">Session Progress:</span>
            {answeredCount === 0 ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                0 attempted
              </span>
            ) : mode === 'EXAM' && !examSubmitted ? (
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  Answered: {answeredCount} / {totalQuestions}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Flagged: {flaggedCount}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  Answered: {answeredCount} / {totalQuestions}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Correct: {correctCount} / {answeredCount}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-teal-50 text-teal-700 border border-teal-200">
                  Accuracy: {accuracy}%
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
            {answeredCount === 0 ? (
              <span className="text-slate-400">0 attempted · No score or accuracy computed yet</span>
            ) : mode === 'EXAM' && !examSubmitted ? (
              <span className="text-slate-500">Exam Mode · Scoring withheld until submit</span>
            ) : (
              <span className="text-slate-600">
                Session Accuracy: <strong className="text-slate-900">{accuracy}%</strong> ({correctCount}/{answeredCount})
              </span>
            )}
          </div>
        </div>

        {/* Real Progress Meter */}
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-[#0f8b8d] transition-all duration-300 rounded-full"
            style={{ width: `${totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0}%` }}
          />
        </div>

        <div className="flex justify-between text-[10px] text-slate-400 font-mono">
          <span>Question 1</span>
          <span>
            {answeredCount} of {totalQuestions} answered ({totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0}%)
          </span>
          <span>Question {totalQuestions}</span>
        </div>
      </div>

      {/* Dedicated Results Screen when submitted */}
      {showResultsScreen && (
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-md space-y-6 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-[#0f8b8d]" />
                <h2 className="text-xl font-bold text-slate-900">Session Results & Analysis</h2>
                <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-[#001432] text-[#8ff3f4]">
                  {currentQ?.examType || 'CLINICAL BLOCK'}
                </span>
                <span className="px-2.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600">
                  {mode === 'EXAM' ? 'Exam Mode' : 'Tutor Mode'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Completed in {formatTimer(secondsElapsed)} · {questions.length} Questions Block
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowResultsScreen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
              >
                Review Questions with Explanations
              </button>
              <button
                onClick={() => onNavigate('analytics')}
                className="px-4 py-2 rounded-xl bg-[#001432] hover:bg-[#13294b] text-white text-xs font-bold transition-all"
              >
                Go to Analytics
              </button>
            </div>
          </div>

          {/* AMC CAT Scaled Score Card - ONLY appears on results screen for AMC CAT */}
          {isAMC && (
            <div className="p-5 rounded-2xl bg-[#001432] text-white border border-[#13294b] space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-[#8ff3f4] uppercase tracking-wider flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#8ff3f4]" /> AMC CAT Scaled Score
                </div>
                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Estimate
                </span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-mono font-bold text-white">
                  {amcEstimatedScore}
                </span>
                <span className="text-sm font-mono text-slate-400">/ 500</span>
                <span className={`ml-auto px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
                  amcEstimatedScore >= 250
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}>
                  {amcEstimatedScore >= 250 ? 'Estimated Pass (≥250)' : 'Below Passing Cutoff (<250)'}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed border-t border-slate-700/60 pt-2.5">
                <strong className="text-slate-100">Estimate Computation:</strong> Computed from this session's real performance ({correctCount} correct of {totalQuestions} total questions = {totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0}%) using the standard linear scaling formula: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-[#8ff3f4]">Score = 100 + (Accuracy % × 4)</code>. Official AMC CAT examinations apply multi-parameter Computerized Adaptive Testing (IRT 3PL model).
              </p>
            </div>
          )}

          {/* Performance Breakdown Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500 font-semibold uppercase">Attempted</div>
              <div className="text-2xl font-mono font-bold text-slate-900 mt-1">
                {answeredCount} <span className="text-xs text-slate-400 font-normal">/ {totalQuestions}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <div className="text-xs text-emerald-800 font-semibold uppercase">Correct</div>
              <div className="text-2xl font-mono font-bold text-emerald-700 mt-1">
                {correctCount}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200">
              <div className="text-xs text-rose-800 font-semibold uppercase">Incorrect</div>
              <div className="text-2xl font-mono font-bold text-rose-700 mt-1">
                {answeredCount - correctCount}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200">
              <div className="text-xs text-teal-800 font-semibold uppercase">Session Accuracy</div>
              <div className="text-2xl font-mono font-bold text-teal-700 mt-1">
                {accuracy !== null ? `${accuracy}%` : '-'}
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div className="font-bold text-slate-900">Session Statistics:</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-600 font-mono">
              <div>Time Elapsed: <strong className="text-slate-800">{formatTimer(secondsElapsed)}</strong></div>
              <div>Average Pace: <strong className="text-slate-800">{paceDisplay}</strong></div>
              <div>Flagged Questions: <strong className="text-slate-800">{flaggedCount}</strong></div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <button
              onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to {currentQ?.sourceType ? 'Question Bank' : 'Practice Builder'}
            </button>

            <button
              onClick={() => setShowResultsScreen(false)}
              className="px-4 py-2 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all shadow-xs"
            >
              Review Test Questions with Explanations →
            </button>
          </div>
        </div>
      )}

      {/* Main Grid: Left Question, Right Palette */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Question Details & Dissection */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
            {/* Clinical Vignette Stem & Question Text: Render stem only if not missing or equal to question */}
            {(() => {
              const questionPrompt = ((currentQ as any)?.question || currentQ?.questionText || '').trim();
              const rawStem = (currentQ?.stem || '').trim();
              const isStemMissingOrEqual = !rawStem || rawStem.toLowerCase() === questionPrompt.toLowerCase();

              return (
                <>
                  {!isStemMissingOrEqual && (
                    <div className="p-4 rounded-xl bg-slate-50 border-l-4 border-[#001432] text-slate-800 text-sm leading-relaxed font-sans">
                      <span className="font-bold text-slate-900 block mb-1">
                        Clinical Vignette:
                      </span>
                      {rawStem}
                    </div>
                  )}

                  {/* Embedded Image if available */}
                  {currentQ?.image && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-start justify-between gap-3 text-xs font-bold text-slate-700">
                        <span className="leading-snug">{currentQ.imageCaption || 'Clinical image'}</span>
                        {currentQ.imageSourceUrl && (
                          <a
                            href={currentQ.imageSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 font-semibold text-[10px] text-[#0f8b8d] hover:underline"
                            title="Open the source of this image"
                          >
                            Source ↗
                          </a>
                        )}
                      </div>
                      <img 
                        src={currentQ.image} 
                        alt={currentQ.imageCaption || 'Clinical image'} 
                        className="w-full max-h-80 object-contain bg-white rounded-lg border border-slate-300 shadow-sm"
                      />
                    </div>
                  )}

                  {/* Question Text */}
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                    {questionPrompt}
                  </h2>
                </>
              );
            })()}

            {/* Statements List if multiple completion */}
            {currentQ.statements && currentQ.statements.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Clinical Assertions to Evaluate:
                </div>
                <div className="space-y-2.5">
                  {currentQ.statements.map((stmt) => (
                    <div 
                      key={stmt.num}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 font-mono">Statement {stmt.num}:</span>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                          stmt.statusBadge === 'TRAP POINT' 
                            ? 'bg-rose-100 text-rose-800' 
                            : 'bg-teal-100 text-teal-800'
                        }`}>
                          {stmt.statusBadge}
                        </span>
                      </div>
                      <p className="font-sans text-slate-700">{stmt.text}</p>

                      {isAnswered && showExplanation && (
                        <div className={`mt-2 pt-2 border-t text-[11px] leading-relaxed ${
                          stmt.isCorrect ? 'border-teal-200 text-teal-900' : 'border-rose-200 text-rose-900'
                        }`}>
                          <span className="font-bold">{stmt.isCorrect ? '✓ True: ' : '✗ False (Trap): '}</span>
                          {stmt.explanation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Options Selection (Supports 4 or 5 options) */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {isAMC ? 'Select Single Best Answer (5 Options):' : 'Select Answer Option:'}
              </div>

              <div className="space-y-2.5">
                {currentQ.options.map((opt) => {
                  const isSelected = selectedAnswer === opt.id;
                  const isCorrect = currentQ.correctOption === opt.id;

                  let borderClass = isLocked
                    ? 'border-slate-200 bg-white'
                    : 'border-slate-200 hover:border-slate-300 bg-white';
                  let badgeClass = 'bg-slate-100 text-slate-700';

                  if (isAnswered && showExplanation) {
                    if (isCorrect) {
                      borderClass = 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500';
                      badgeClass = 'bg-emerald-600 text-white';
                    } else if (isSelected) {
                      borderClass = 'border-rose-500 bg-rose-50/70 ring-1 ring-rose-500';
                      badgeClass = 'bg-rose-600 text-white';
                    }
                  } else if (isSelected) {
                    borderClass = 'border-[#0f8b8d] bg-teal-50/20 ring-1 ring-[#0f8b8d]';
                    badgeClass = 'bg-[#0f8b8d] text-white';
                  }

                  return (
                    <div
                      key={opt.id}
                      onClick={() => handleSelectOption(opt.id)}
                      aria-disabled={isLocked}
                      className={`p-4 rounded-xl border transition-all flex items-start gap-3.5 text-xs ${isLocked ? 'cursor-default select-none' : 'cursor-pointer'} ${borderClass}`}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${badgeClass}`}>
                        {opt.id}
                      </span>
                      <div className="flex-1 font-medium text-slate-800 leading-relaxed pt-0.5">
                        {opt.text}
                      </div>
                      {isAnswered && showExplanation && isCorrect && (
                        <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      )}
                      {isAnswered && showExplanation && isSelected && !isCorrect && (
                        <X className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Phenotypic Dissection & Board Trap Analysis */}
            {isAnswered && showExplanation && (
              <div className="space-y-4 pt-4 border-t border-slate-200">
                {currentQ.trapExplanation && (
                  <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                          Distractor Dissection: {currentQ.trapType || 'COGNITIVE HEURISTIC ERROR'}
                        </div>
                        <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                          {currentQ.trapExplanation}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {currentQ.explanation && (
                  <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-1.5">
                    <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">Explanation</div>
                    <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{currentQ.explanation}</p>
                  </div>
                )}

                <div className="p-4 rounded-xl bg-[#001432] text-white space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#8ff3f4] uppercase tracking-wider">
                    <Brain className="w-4 h-4 text-[#8ff3f4]" /> High-Yield Board Pearl
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {currentQ.boardPearl}
                  </p>
                </div>

                {currentQ.citations && currentQ.citations.length > 0 && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-700">Verified Citations:</span>
                    <span className="text-slate-600">{currentQ.citations.join(' · ')}</span>
                  </div>
                )}

                {/* Per-question AI tools (explain every option / notes / topic notes) */}
                <AiQuestionTools
                  question={currentQ}
                  userChoice={selectedAnswer ?? undefined}
                />
              </div>
            )}

            {/* Bottom Card Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>

              <button
                onClick={() => onNavigate('ai-tutor', currentQ.id)}
                className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold hover:bg-amber-100 flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4 text-amber-600" /> Dissect with AI Tutor
              </button>

              <button
                disabled={currentIndex === questions.length - 1}
                onClick={() => setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1))}
                className="px-4 py-2 rounded-xl bg-[#001432] text-white text-xs font-bold hover:bg-[#13294b] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Question Palette & Score Card */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Question Palette</h3>
              <span className="text-xs font-mono text-slate-500">
                {answeredCount} / {totalQuestions} Attempted
              </span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const ans = userAnswers[q.id];
                const isCurrent = idx === currentIndex;
                const isFlag = !!flaggedIds[q.id];

                let bgClass = 'bg-slate-100 text-slate-700 hover:bg-slate-200';
                if (ans) {
                  if (mode === 'EXAM' && !examSubmitted) {
                    bgClass = 'bg-[#001432] text-white font-bold';
                  } else if (ans === q.correctOption) {
                    bgClass = 'bg-emerald-600 text-white font-bold';
                  } else {
                    bgClass = 'bg-rose-600 text-white font-bold';
                  }
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-9 rounded-xl text-xs font-mono font-medium transition-all relative ${bgClass} ${
                      isCurrent ? 'ring-2 ring-[#0f8b8d] ring-offset-2' : ''
                    }`}
                  >
                    {idx + 1}
                    {isFlag && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1 right-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Module Score Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Session Performance
            </h3>
            
            {answeredCount === 0 ? (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-center space-y-1">
                <div className="text-base font-mono font-bold text-slate-700">0 attempted</div>
                <div className="text-[11px] text-slate-400">No score or accuracy computed yet</div>
              </div>
            ) : mode === 'EXAM' && !examSubmitted ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-xl font-mono font-bold text-slate-900">
                      {answeredCount} / {totalQuestions}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                      Answered
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-xl font-mono font-bold text-amber-600">
                      {flaggedCount}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                      Flagged
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 text-center font-mono">
                  Exam mode: scoring revealed upon submission
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-xl font-mono font-bold text-slate-900">
                    {correctCount} / {answeredCount}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Correct Answers
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="text-xl font-mono font-bold text-emerald-600">
                    {accuracy}%
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Session Accuracy
                  </div>
                </div>
              </div>
            )}

            {!examSubmitted ? (
              <button
                onClick={handleSubmitModule}
                className="w-full mt-3 py-2.5 bg-[#001432] hover:bg-[#13294b] text-white text-xs font-bold rounded-xl transition-all"
              >
                {mode === 'EXAM' ? 'Submit Exam & View Results' : 'Submit Module & View Results'}
              </button>
            ) : (
              <div className="space-y-2 mt-3">
                <button
                  onClick={() => setShowResultsScreen(true)}
                  className="w-full py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all shadow-xs"
                >
                  View Results Summary
                </button>
                <button
                  onClick={() => onNavigate('analytics')}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
                >
                  Go to Analytics
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
