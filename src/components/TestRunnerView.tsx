import React, { useState, useEffect } from 'react';
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
import { INITIAL_QUESTIONS } from '../data/mockClinicalData.ts';

interface TestRunnerViewProps {
  initialQuestionId?: string;
  onNavigate: (view: AppView, targetId?: string) => void;
  questions?: ClinicalQuestion[];
}

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({
  initialQuestionId,
  onNavigate,
  questions: propQuestions,
}) => {
  const [questions, setQuestions] = useState<ClinicalQuestion[]>(
    propQuestions && propQuestions.length > 0 ? propQuestions : INITIAL_QUESTIONS
  );
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>>({
    'Q10': 'B',
  });
  const [flaggedIds, setFlaggedIds] = useState<Record<string, boolean>>({});
  const [showExplanation, setShowExplanation] = useState<boolean>(true);
  const [secondsElapsed, setSecondsElapsed] = useState<number>(866);

  // Sync questions if prop changes
  useEffect(() => {
    if (propQuestions && propQuestions.length > 0) {
      setQuestions(propQuestions);
      setCurrentIndex(0);
    }
  }, [propQuestions]);

  // AMC CAT Adaptive State
  const [adaptiveTheta, setAdaptiveTheta] = useState<number>(268); // Out of 500
  const [adaptiveTier, setAdaptiveTier] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'>('MEDIUM');
  const [consecutiveCorrect, setConsecutiveCorrect] = useState<number>(1);

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

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const currentQ = questions[currentIndex] || questions[0];
  const selectedAnswer = userAnswers[currentQ.id];
  const isAnswered = !!selectedAnswer;
  const isFlagged = !!flaggedIds[currentQ.id];
  const isAMC = currentQ.examType === 'AMC_CAT';

  const handleSelectOption = (optId: 'A' | 'B' | 'C' | 'D' | 'E') => {
    setUserAnswers(prev => ({ ...prev, [currentQ.id]: optId }));
    setShowExplanation(true);

    // AMC CAT Adaptive Calibration
    if (isAMC) {
      const isCorrect = optId === currentQ.correctOption;
      if (isCorrect) {
        setAdaptiveTheta(prev => Math.min(500, prev + 16));
        setConsecutiveCorrect(prev => {
          const next = prev + 1;
          if (next >= 2) setAdaptiveTier('HIGH');
          if (next >= 4) setAdaptiveTier('EXTREME');
          return next;
        });
      } else {
        setAdaptiveTheta(prev => Math.max(100, prev - 18));
        setConsecutiveCorrect(0);
        setAdaptiveTier('LOW');
      }
    }
  };

  const toggleFlag = () => {
    setFlaggedIds(prev => ({ ...prev, [currentQ.id]: !prev[currentQ.id] }));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Runner Header Bar */}
      <div className="bg-[#001432] rounded-2xl p-4 sm:p-5 text-white border border-[#13294b] shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('practice')}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Back to Modules"
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
                {currentQ.examType === 'NEET_PG' && 'NEET-PG (+4 / -1)'}
                {currentQ.examType === 'INI_CET' && 'INI-CET (+1 / -0.33)'}
                {currentQ.examType === 'AMC_CAT' && 'AMC CAT (Adaptive Item Response)'}
              </span>
            </div>
            <div className="text-xs text-slate-300 font-medium mt-1">
              {currentQ.subject} · {currentQ.subtopic}
            </div>
          </div>
        </div>

        {/* Right side stats: Pace + Timer + Flag */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-mono">
            <span className="text-slate-400">Pace:</span>
            <span className="text-emerald-400 font-bold">1.1 m/Q [NOMINAL]</span>
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

      {/* AMC CAT Real-Time Difficulty Calibration Bar */}
      {isAMC && (
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#0f8b8d]" />
              <span className="font-bold text-slate-900">AMC CAT Adaptive Difficulty Calibration:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                adaptiveTier === 'EXTREME' ? 'bg-purple-100 text-purple-800' :
                adaptiveTier === 'HIGH' ? 'bg-rose-100 text-rose-800' :
                adaptiveTier === 'MEDIUM' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                Current Tier: {adaptiveTier}
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span>Scaled Score: <strong className="text-slate-900">{adaptiveTheta} / 500</strong></span>
              <span className={`font-bold px-1.5 py-0.5 rounded ${
                adaptiveTheta >= 250 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}>
                {adaptiveTheta >= 250 ? 'PASSING (>=250)' : 'BELOW PASS MARK'}
              </span>
            </div>
          </div>

          {/* Visual Dynamic Calibration Meter */}
          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                adaptiveTier === 'EXTREME' ? 'bg-purple-600' :
                adaptiveTier === 'HIGH' ? 'bg-rose-500' :
                adaptiveTier === 'MEDIUM' ? 'bg-[#0f8b8d]' : 'bg-emerald-500'
              }`}
              style={{ width: `${(adaptiveTheta / 500) * 100}%` }}
            />
            {/* 250 Pass Mark Vertical Line */}
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-slate-700/80" 
              style={{ left: '50%' }}
              title="Pass Mark Threshold (250/500)"
            />
          </div>

          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>Low Cognitive (100)</span>
            <span className="font-bold text-slate-600">▲ 250 Pass Cutoff</span>
            <span>Mastery Ranker (500)</span>
          </div>
        </div>
      )}

      {/* Main Grid: Left Question, Right Palette */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Question Details & Dissection */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
            {/* Clinical Vignette Stem */}
            <div className="p-4 rounded-xl bg-slate-50 border-l-4 border-[#001432] text-slate-800 text-sm leading-relaxed font-sans">
              <span className="font-bold text-slate-900 block mb-1">
                Clinical Vignette:
              </span>
              {currentQ.stem}
            </div>

            {/* Embedded Image if available */}
            {currentQ.image && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>{currentQ.imageCaption || 'Histopathology Specimen'}</span>
                  <span className="text-slate-400 font-mono">Special Stain</span>
                </div>
                <img 
                  src={currentQ.image} 
                  alt="Clinical Specimen" 
                  className="w-full max-h-72 object-cover rounded-lg border border-slate-300 shadow-sm"
                />
              </div>
            )}

            {/* Question Text */}
            <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
              {currentQ.questionText}
            </h2>

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

                  let borderClass = 'border-slate-200 hover:border-slate-300 bg-white';
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
                      className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5 text-xs ${borderClass}`}
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
                {Object.keys(userAnswers).length} / {questions.length} Attempted
              </span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const ans = userAnswers[q.id];
                const isCurrent = idx === currentIndex;
                const isFlag = !!flaggedIds[q.id];

                let bgClass = 'bg-slate-100 text-slate-700 hover:bg-slate-200';
                if (ans) {
                  if (ans === q.correctOption) {
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
              {isAMC ? 'AMC CAT Performance' : 'Board Scoring & Marking'}
            </h3>
            
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-xl font-mono font-bold text-slate-900">
                  {isAMC ? `${adaptiveTheta}` : '+1.67'}
                </div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                  {isAMC ? 'Scaled Score (500)' : 'Net Score'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-xl font-mono font-bold text-emerald-600">
                  {isAMC ? (adaptiveTheta >= 250 ? 'PASS' : 'FAIL') : '100%'}
                </div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                  {isAMC ? 'Result Status' : 'Accuracy'}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                alert('Module submitted! Results compiled into your Analytics dashboard.');
                onNavigate('analytics');
              }}
              className="w-full mt-3 py-2.5 bg-[#001432] hover:bg-[#13294b] text-white text-xs font-bold rounded-xl transition-all"
            >
              Submit Module & View Analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
