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
  Layers,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  Play,
  Square,
  Zap,
  Plus,
  Pencil,
  Save
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
  const paceDisplay = paceSeconds !== null ? `${paceSeconds}s / Q` : '-';
  const amcEstimatedScore = accuracy !== null ? Math.round(100 + (accuracy / 100) * 400) : 0;

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
      <div className="max-w-2xl mx-auto mt-10">
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4">
          <BookOpen className="w-9 h-9 text-slate-300 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">No active module</h2>
          <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            The runner only shows questions you actually launched. Build a module in the Practice Builder, or open a question from your bank, and it will appear here with your answers recorded to your real progress.
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
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header - Timer & Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold text-[#8ff3f4]">
                {currentQ?.moduleCode || 'CLINICAL BLOCK #8842'}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {currentQ?.difficultyTier || 'MEDIUM'}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {mode === 'EXAM' ? 'Exam Mode' : 'Tutor Mode'}
              </span>
            </div>
            <div className="text-xs text-slate-400 font-medium mt-1">
              {currentQ?.subject} · {currentQ?.subtopic}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {mode === 'EXAM' && !examSubmitted && (
            <button
              onClick={handleSubmitExam}
              className="px-4 py-2 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all shadow-xs"
            >
              Submit Exam
            </button>
          )}

          {examSubmitted && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold font-mono">
              Exam Submitted
            </span>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-mono">
            <span className="text-slate-400">Pace:</span>
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
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-amber-500/20 hover:border-amber-400 hover:text-amber-400'
            }`}
            title="Flag question for review"
          >
            <Flag className={`w-4 h-4 ${isFlagged ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full bg-[#0f8b8d] transition-all duration-300 rounded-full"
          style={{ width: `${totalQuestions > 0 ? Math.min(100, Math.round((answeredCount / totalQuestions) * 100)) : 0}%` }}
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Question */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-5">
            {/* Question Stem */}
            {(() => {
              const questionPrompt = ((currentQ as any)?.question || currentQ?.questionText || '').trim();
              const rawStem = (currentQ?.stem || '').trim();
              const isStemMissingOrEqual = !rawStem || rawStem.toLowerCase() === questionPrompt.toLowerCase();

              return (
                <>
                  {!isStemMissingOrEqual && (
                    <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm leading-relaxed font-sans">
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 text-[10px] font-bold text-[#0f8b8d]">Clinical Vignette:</span>
                        <span className="text-slate-800">{rawStem}</span>
                      </div>
                    </div>
                  )}

                  {/* Embedded Image */}
                  {currentQ?.image && (
                    <div className="mb-4 p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                      <div className="flex items-start justify-between gap-2 text-xs font-bold text-slate-700">
                        <span className="leading-snug">{currentQ.imageCaption || 'Clinical image'}</span>
                        {currentQ.imageSourceUrl && (
                          <a
                            href={currentQ.imageSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 font-semibold text-[10px] text-[#0f8b8d] hover:underline"
                            title="Open source"
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

                  {/* Question */}
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                    {questionPrompt}
                  </h2>
                </>
              );
            })()}

            {/* Answer Options */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Select Answer
              </div>
              {currentQ.options.map((opt) => {
                const isSelected = selectedAnswer === opt.id;
                const isCorrect = currentQ.correctOption === opt.id;
                const optionColors: Record<string, string> = {
                  'A': 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-50',
                  'B': 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-50',
                  'C': 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-50',
                  'D': 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-50',
                  'E': 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-50',
                };

                const showResult = isAnswered && showExplanation;

                const baseClasses = 'w-full px-4 py-3 rounded-xl border text-left flex items-start gap-3 transition-all';
                
                let borderClass = 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-slate-300';
                if (showResult && isCorrect) {
                  borderClass = 'bg-emerald-50 border-emerald-200 text-emerald-800 ring-2 ring-emerald-500 font-bold';
                } else if (isAnswered && showResult && opt.id === selectedAnswer && !isCorrect) {
                  borderClass = 'bg-rose-50 border-rose-200 text-rose-800 ring-2 ring-rose-500';
                }

                return (
                  <button
                    key={opt.id}
                    onClick={() => handleSelectOption(opt.id)}
                    disabled={isLocked}
                    className={`${baseClasses} ${borderClass} transition-all`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                        isAnswered && showResult && isCorrect ? 'bg-emerald-600' : 
                        isAnswered && showResult && opt.id === selectedAnswer ? 'bg-rose-600' : 
                        isSelected ? 'bg-[#0f8b8d]' : 'bg-white border border-slate-200'
                      }`}>
                        {opt.id}
                      </div>
                      <div className="flex-1 leading-relaxed text-sm text-slate-800">
                        {opt.text}
                      </div>
                      {isAnswered && showExplanation && isCorrect && (
                        <span className="ml-2 text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Correct
                        </span>
                      )}
                      {isAnswered && showExplanation && isSelected && !isCorrect && (
                        <span className="text-[10px] font-bold text-rose-600 flex items-center gap-1">
                          <X className="w-3 h-3" />
                          Wrong
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between pt-2">
              <button
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <button
                disabled={currentIndex === questions.length - 1}
                onClick={() => setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1))}
                className="px-4 py-2 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Explanation */}
            {isAnswered && showExplanation && (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Explanation
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {currentQ.explanation}
                  </p>
              </div>

              {currentQ.boardPearl && (
                  <div className="p-3 rounded-xl bg-[#001432] text-white space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#8ff3f4] uppercase tracking-wider">
                      <Brain className="w-3 h-3 text-[#8ff3f4]" />
                      Board Pearl
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {currentQ.boardPearl}
                    </p>
                  </div>
                )}

                {currentQ.citations && currentQ.citations.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                    <BookOpen className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800">Citations:</span>
                    <span className="text-slate-600">{currentQ.citations.join(' · ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Question Palette */}
        <div className="lg:col-span-4 space-y-6">
          {/* Question Palette */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">Question Palette</h3>
              <span className="text-xs font-mono text-slate-500">
                {answeredCount} / {totalQuestions}
              </span>
            </div>

            <div className="grid grid-cols-6 gap-1.5">
              {questions.map((q, idx) => {
                const ans = userAnswers[q.id];
                const isCurrent = idx === currentIndex;
                const isFlagged = !!flaggedIds[q.id];
                
                let baseClass = 'w-6 h-6 rounded-lg text-xs font-mono flex items-center justify-center transition-all border';
                let colorClass = 'border-slate-200 bg-white text-slate-700';
                
                if (ans) {
                  if (ans === q.correctOption) {
                    colorClass = 'bg-emerald-50 border-emerald-200 text-emerald-800';
                  } else {
                    colorClass = 'bg-rose-50 border-rose-200 text-rose-800';
                  }
                }
                
                if (isCurrent) {
                  colorClass = 'bg-[#0f8b8d] text-white border-[#0f8b8d]';
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`${baseClass} ${colorClass}`}
                  >
                    {idx + 1}
                    {isFlagged && (
                      <span className="absolute top-1 right-1 w-1.5 h-2 rounded-full bg-amber-500 text-[3px]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 mt-2">
            <button
              onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
              className="w-full py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              <ChevronLeft className="w-3 h-3 mr-1" />
              Back
            </button>

            <button
              onClick={handleSubmitExam}
              disabled={examSubmitted}
              className="w-full py-2.5 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-[#0f8b8d]/20"
            >
              {examSubmitted ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#8ff3f4]" />
                  <span>Exam Submitted</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  Submit Exam
                </>
              )}
            </button>
          </div>

          {/* Question Info */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="font-semibold text-slate-800">Difficulty</span>
              <span className="font-mono text-slate-800">{currentQ?.difficultyTier || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="font-bold text-slate-900">Subject</span>
              <span className="font-sans text-slate-600">{currentQ?.subject}</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="font-bold text-slate-900">Subtopic</span>
              <span className="font-sans text-slate-600 truncate">{currentQ?.subtopic}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};