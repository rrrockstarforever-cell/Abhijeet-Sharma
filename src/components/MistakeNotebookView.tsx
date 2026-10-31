import React, { useMemo, useState } from 'react';
import { 
  AlertTriangle, 
  RotateCcw, 
  CheckCircle2, 
  Brain, 
  BookOpen, 
  Sparkles, 
  ArrowRight, 
  Target, 
  Layers, 
  Filter,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  ClipboardPaste,
  Loader2
} from 'lucide-react';
import { ClinicalQuestion, AppView, ExamType } from '../types.ts';
import { INITIAL_QUESTIONS } from '../data/mockClinicalData.ts';
import { AiQuestionTools } from './AiQuestionTools.tsx';
import { FlashcardReviewPanel } from './FlashcardReviewPanel.tsx';
import { QuestionCaptureModal } from './QuestionCaptureModal.tsx';
import { ZoomableImage } from './ZoomableImage.tsx';
import {
  capturedToClinicalQuestion,
  listCapturedQuestions,
  removeCapturedQuestion,
  updateCapturedQuestion,
} from '../utils/mistakeStore.ts';
import { summarizeAttempts, attemptsToday } from '../utils/attemptStore.ts';
import { dueCount } from '../utils/flashcardStore.ts';
import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from '../lib/ai.ts';
import { addUserHighlight, highlightFromAiReply } from '../utils/userHighlightsStore.ts';
import { RevisionNote, downloadNotesPdf } from './RevisionNote.tsx';

interface MistakeNotebookViewProps {
  onNavigate: (view: AppView, questionId?: string) => void;
  /** Launch a real retest built from the learner's captured questions (no canned IDs). */
  onStartSprint?: (questions: ClinicalQuestion[]) => void;
  currentExam?: ExamType;
}

export const MistakeNotebookView: React.FC<MistakeNotebookViewProps> = ({ 
  onNavigate,
  onStartSprint,
  currentExam = 'NEET_PG',
}) => {
  const [filterSubject, setFilterSubject] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'UNRESOLVED' | 'REMEDIATED'>('ALL');
  const [capturedVersion, setCapturedVersion] = useState(0);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState<{ text: string; topics: string } | null>(null);

  // REAL captured questions (localStorage) come first. Sample rows are only shown
  // when the notebook is empty, clearly labelled, so progress can never be faked.
  const captured = useMemo(() => {
    void capturedVersion;
    return listCapturedQuestions();
  }, [capturedVersion]);

  const realQuestions: ClinicalQuestion[] = useMemo(
    () => captured.map(capturedToClinicalQuestion),
    [captured],
  );

  const usingSamples = realQuestions.length === 0 && showSample;
  const allQuestions = usingSamples ? INITIAL_QUESTIONS : realQuestions;

  const toggleExpand = (id: string) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const markStatus = (id: string, status: 'unresolved' | 'remediated') => {
    if (captured.some((c) => c.id === id)) {
      updateCapturedQuestion(id, { status, markedCorrect: status === 'remediated' });
      setCapturedVersion((v) => v + 1);
    }
  };

  const deleteCaptured = (id: string) => {
    if (!captured.some((c) => c.id === id)) return;
    removeCapturedQuestion(id);
    setCapturedVersion((v) => v + 1);
  };

  /**
   * Real SRS sprint: only the learner's own captured questions, unresolved first.
   * If nothing has been captured yet the action explains that instead of loading
   * preloaded sample questions into the runner.
   */
  const startSprint = () => {
    setSprintError(null);
    const unresolved = realQuestions.filter((q) => !q.isRemediated);
    const pool = (unresolved.length ? unresolved : realQuestions).slice(0, 10);
    if (!pool.length) {
      setSprintError('Capture at least one question first — the sprint only uses your own mistakes.');
      return;
    }
    if (!onStartSprint) {
      setSprintError('The sprint launcher is not connected in this build.');
      return;
    }
    onStartSprint(pool);
  };

  const subjects = useMemo(
    () => [...new Set(allQuestions.map((q) => q.subject))].sort(),
    [allQuestions],
  );

  const questions = allQuestions.filter(q => {
    if (filterStatus === 'UNRESOLVED' && q.isRemediated) return false;
    if (filterStatus === 'REMEDIATED' && !q.isRemediated) return false;
    if (filterSubject !== 'ALL' && q.subject !== filterSubject) return false;
    return true;
  });

  const stats = useMemo(() => {
    const unresolved = allQuestions.filter((q) => !q.isRemediated).length;
    const remediated = allQuestions.filter((q) => q.isRemediated).length;
    return { total: allQuestions.length, unresolved, remediated };
  }, [allQuestions]);

  const attemptStats = useMemo(() => summarizeAttempts(), [capturedVersion]);
  const todayModules = useMemo(() => attemptsToday().length, [capturedVersion]);

  // Revision notes from the learner's real weakest topics/mistakes (PARITY section 8).
  const generateRevisionNotes = async () => {
    const provider = getActiveProvider();
    if (!provider) { setNotesError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    const weak = attemptStats.weakSubjects.slice(0, 4).map((s) => `${s.subject} (${s.accuracy}% accuracy on ${s.total} questions)`);
    const mistakeTopics = [...new Set(captured.map((c) => `${c.question.subject} — ${c.question.subtopic}`))].slice(0, 8);
    const topics = weak.length ? weak : mistakeTopics;
    if (!topics.length) {
      setNotesError('Answer some questions or capture a mistake first — these notes are built only from your real weak topics.');
      return;
    }
    setNotesBusy(true);
    setNotesError(null);
    try {
      const text = await aiComplete({
        system:
          'You are a medical exam revision coach. Write concise, high-yield revision notes for the learner\'s weakest topics. ' +
          'Use short headings and bullets, mark key takeaways with a line starting "High-yield:" and memory aids with "Mnemonic:". ' +
          'End with 3 exam pearls. Plain text only.',
        messages: [{
          role: 'user',
          content:
            `Exam: ${currentExam.replace('_', '-')}\n\nMy weakest topics (from real attempt data):\n${topics.map((t) => `- ${t}`).join('\n')}\n\n` +
            (mistakeTopics.length ? `Mistakes I captured:\n${mistakeTopics.map((t) => `- ${t}`).join('\n')}\n\n` : '') +
            'Write the revision notes, prioritising discriminators and classic traps.',
        }],
        provider,
        model: getEffectiveModel(provider),
      });
      setRevisionNotes({ text, topics: topics.join(' · ') });
      addUserHighlight(highlightFromAiReply({
        quote: text,
        subject: 'Revision',
        subtopic: 'Weak topics',
        citation: `AI revision · ${topics.slice(0, 3).join(', ')}`,
        tags: ['ai-note', 'revision'],
      }));
    } catch (err: any) {
      setNotesError(err?.message || 'Could not generate revision notes.');
    } finally {
      setNotesBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <RotateCcw className="w-3.5 h-3.5" />
              SRS Engine · {dueCount()} card{dueCount() === 1 ? '' : 's'} due
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Clinical Mistake Notebook & Cognitive Root-Cause Analysis
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Capture real mistakes from any mock test, mark them resolved as you master them, and review note cards on a real spaced schedule.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setCaptureOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-semibold rounded-xl transition-all"
            >
              <Plus className="w-4 h-4" />
              Capture Question
            </button>
            <button
              onClick={startSprint}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#0f8b8d] to-[#00696b] hover:from-[#00696b] hover:to-[#0f8b8d] text-white text-sm font-semibold rounded-xl shadow-lg transition-all transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              Start SRS Mistake Sprint
            </button>
          </div>
        </div>

        {/* 4 Stat Badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-700/60">
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Captured Questions</div>
            <div className="text-2xl font-mono font-bold text-white mt-1">
              {captured.length}
              {usingSamples && <span className="text-[10px] text-amber-300 font-normal block">sample rows shown</span>}
            </div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Remediated & Retested</div>
            <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
              {stats.remediated}
              <span className="text-xs text-emerald-400/80 font-normal">
                {stats.total ? ` (${Math.round((stats.remediated / stats.total) * 100)}%)` : ''}
              </span>
            </div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Unresolved Misconceptions</div>
            <div className="text-2xl font-mono font-bold text-rose-400 mt-1">
              {stats.unresolved}
              <span className="text-xs text-rose-300 font-normal"> {stats.unresolved ? 'Priority' : ''}</span>
            </div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Due for Spaced Review Today</div>
            <div className="text-2xl font-mono font-bold text-amber-400 mt-1">
              {dueCount()} <span className="text-xs text-amber-200 font-normal">Cards</span>
            </div>
          </div>
        </div>
      </div>

      {sprintError && (
        <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800">{sprintError}</div>
      )}

      {/* Main Grid: Left Questions List, Right Rails */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Filter + Questions */}
        <div className="lg:col-span-8 space-y-4">
          {/* Filter Bar */}
          <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 mr-1 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Filter:
              </span>
              {(['ALL', 'UNRESOLVED', 'REMEDIATED'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    filterStatus === status 
                      ? 'bg-[#001432] text-white shadow-sm' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {status === 'ALL' ? `All Mistakes (${stats.total})` : status === 'UNRESOLVED' ? `Unresolved (${stats.unresolved})` : `Remediated (${stats.remediated})`}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filterSubject}
                onChange={e => setFilterSubject(e.target.value)}
                className="text-xs font-medium bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
              >
                <option value="ALL">All Disciplines</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {captured.length === 0 && !showSample && (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-3">
              <ClipboardPaste className="w-8 h-8 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-800">No real mistakes captured yet</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Paste a screenshot from any mock test and structure it with your AI. Captured questions persist locally and feed the spaced-review deck.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setCaptureOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-[#001432] text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Capture Question
                </button>
                <button
                  onClick={() => setShowSample(true)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold"
                >
                  View sample rows
                </button>
              </div>
            </div>
          )}

          {usingSamples && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-[11px] text-amber-800 flex items-center justify-between">
              <span>These are sample rows to show the layout — they are not your progress.</span>
              <button onClick={() => setShowSample(false)} className="font-bold underline">Hide samples</button>
            </div>
          )}

          {/* Questions Cards */}
          <div className="space-y-4">
            {questions.map((q) => {
              const isExpanded = expandedCards[q.id] ?? false;

              return (
                <div 
                  key={q.id}
                  className={`bg-white rounded-2xl border transition-all duration-200 shadow-sm overflow-hidden ${
                    q.isRemediated 
                      ? 'border-emerald-200/80 hover:border-emerald-400' 
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Card Header */}
                  <div className="p-5 pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {q.id}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#0f8b8d]/10 text-[#0f8b8d]">
                          {q.subject}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          {q.subtopic}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {q.isRemediated ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Remediated in {q.remediatedInTest || 'Grand Test'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertTriangle className="w-3 h-3 text-rose-600" /> Failed {q.timesFailed || 1}x · Unresolved
                          </span>
                        )}
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          {q.examType.replace('_', '-')}
                        </span>
                        {captured.some((c) => c.id === q.id) && (
                          <>
                            <button
                              onClick={() => markStatus(q.id, q.isRemediated ? 'unresolved' : 'remediated')}
                              title={q.isRemediated ? 'Mark as unresolved again' : 'Mark this mistake as resolved'}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                q.isRemediated
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                              }`}
                            >
                              <Check className="w-3 h-3" /> {q.isRemediated ? 'Resolved' : 'Mark resolved'}
                            </button>
                            <button
                              onClick={() => deleteCaptured(q.id)}
                              title="Delete this captured question"
                              className="text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Question Title / Stem Preview */}
                    <div className="text-sm font-semibold text-slate-900 mt-2">
                      {q.stem}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                      {q.questionText}
                    </p>

                    {/* Embedded clinical image if present */}
                    {q.image && (
                      <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
                        <ZoomableImage
                          src={q.image}
                          alt={q.imageCaption || 'Clinical image'}
                          className="w-32 h-24 object-contain bg-white rounded-lg border border-slate-300 shadow-sm"
                          wrapperClassName="shrink-0"
                          caption={q.imageCaption || undefined}
                        />
                        <div className="flex-1 text-left">
                          <span className="text-[11px] font-bold text-slate-800 block leading-snug">
                            {q.imageCaption || 'Clinical image'}
                          </span>
                          {q.imageSourceUrl && (
                            <a
                              href={q.imageSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block mt-1 text-[10px] font-semibold text-[#0f8b8d] hover:underline"
                            >
                              Source ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Expand / Collapse trigger */}
                  <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between">
                    <button
                      onClick={() => toggleExpand(q.id)}
                      className="text-xs font-semibold text-[#0f8b8d] hover:text-[#00696b] flex items-center gap-1"
                    >
                      {isExpanded ? (
                        <>Hide Cognitive Root Cause & Options <ChevronUp className="w-3.5 h-3.5" /></>
                      ) : (
                        <>View Board Distractor Analysis & Options <ChevronDown className="w-3.5 h-3.5" /></>
                      )}
                    </button>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => onNavigate('ai-tutor', q.id)}
                        className="text-xs font-semibold text-slate-600 hover:text-[#0f8b8d] flex items-center gap-1"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Dissect with AI Tutor
                      </button>
                      <button
                        onClick={() => onNavigate('test-runner', q.id)}
                        className="text-xs font-semibold text-[#001432] hover:text-[#0f8b8d] flex items-center gap-1"
                      >
                        Retest Now <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Section: Trap, Options, and Pearl */}
                  {isExpanded && (
                    <div className="p-5 pt-4 border-t border-slate-200 bg-white space-y-4">
                      {/* Distractor Alert Box */}
                      {q.trapExplanation && (
                        <div className="p-4 rounded-xl bg-amber-50/90 border border-amber-200">
                          <div className="flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                                Board Distractor Analysis: {q.trapType || 'COGNITIVE HEURISTIC ERROR'}
                              </div>
                              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                {q.trapExplanation}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Options with marked user choice and correct choice */}
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-700">Answer Breakdown:</div>
                        <div className="grid grid-cols-1 gap-2">
                          {q.options.map((opt) => {
                            const isCorrect = opt.id === q.correctOption;
                            const isSelected = opt.id === q.selectedOption;

                            return (
                              <div
                                key={opt.id}
                                className={`p-3 rounded-xl border text-xs flex items-start gap-3 ${
                                  isCorrect 
                                    ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 font-medium' 
                                    : isSelected 
                                      ? 'bg-rose-50/80 border-rose-300 text-rose-950' 
                                      : 'bg-slate-50/60 border-slate-200 text-slate-700'
                                }`}
                              >
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5 ${
                                  isCorrect 
                                    ? 'bg-emerald-600 text-white' 
                                    : isSelected 
                                      ? 'bg-rose-600 text-white' 
                                      : 'bg-slate-200 text-slate-700'
                                }`}>
                                  {opt.id}
                                </span>
                                <div className="flex-1 leading-relaxed">
                                  {opt.text}
                                  {isSelected && !isCorrect && (
                                    <span className="ml-2 font-bold text-rose-600 text-[10px] uppercase tracking-wide">
                                      [Your Selection — Trap]
                                    </span>
                                  )}
                                  {isCorrect && (
                                    <span className="ml-2 font-bold text-emerald-700 text-[10px] uppercase tracking-wide">
                                      [Correct Answer]
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Board Pearl */}
                      <div className="p-3.5 rounded-xl bg-[#001432] text-white">
                        <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                          <Brain className="w-3.5 h-3.5" /> High-Yield Board Pearl
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed font-sans">
                          {q.boardPearl}
                        </p>
                      </div>

                      {/* Citations */}
                      {q.citations && q.citations.length > 0 && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 pt-1">
                          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-semibold text-slate-600">Standard Text Citations:</span>
                          <span>{q.citations.join(' · ')}</span>
                        </div>
                      )}

                      {/* Per-question AI tools (explain every option / notes / topic notes) */}
                      <AiQuestionTools
                        question={q}
                        userChoice={q.selectedOption ?? undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: SRS Sprint, Root-Cause Breakdown, Due Today */}
        <div className="lg:col-span-4 space-y-6">
          {/* Quick Sprint Launcher */}
          <div className="bg-gradient-to-br from-[#001432] to-[#13294b] text-white rounded-2xl p-5 border border-[#13294b] shadow-md">
            <div className="flex items-center gap-2 text-[#8ff3f4] text-xs font-bold uppercase tracking-wider">
              <Target className="w-4 h-4" /> Spaced Repetition Sprint
            </div>
            <h3 className="text-base font-bold mt-1 text-white">
              Fix 10 Recurring Traps
            </h3>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              Curated by error frequency. High-yield items where you scored &lt;50% accuracy or picked the top distractor.
            </p>
            <div className="mt-4 flex items-center justify-between text-xs font-mono text-slate-300 pb-3 border-b border-slate-700">
              <span>Time Target: 12 min</span>
              <span className="text-[#8ff3f4]">Penalty: Board Rules</span>
            </div>
            <button
              onClick={startSprint}
              className="w-full mt-4 py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              Launch Targeted Sprint <ArrowRight className="w-3.5 h-3.5" />
            </button>
            {sprintError && (
              <div className="mt-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-800">{sprintError}</div>
            )}
          </div>

          {/* Root Cause Attribution Breakdown — computed from real attempts & captures */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0f8b8d]" /> Mistake Attribution Breakdown
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {attemptStats.questionsAnswered > 0
                ? `Built from ${attemptStats.questionsAnswered} answered questions in ${attemptStats.modules} real module${attemptStats.modules === 1 ? '' : 's'}`
                : 'No attempts recorded yet — submit a module or capture a mistake to populate this'}
            </p>

            <div className="mt-4 space-y-3.5">
              {attemptStats.weakSubjects.length === 0 && captured.length === 0 && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Once you answer questions, your weakest subjects and their accuracy appear here. Nothing is simulated.
                </p>
              )}
              {attemptStats.weakSubjects.slice(0, 3).map((s) => (
                <div key={s.subject}>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span className="text-slate-700 truncate mr-2">{s.subject}</span>
                    <span className="font-mono font-bold text-rose-600">{s.accuracy}% ({s.correct}/{s.total})</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.max(2, s.accuracy)}%` }} />
                  </div>
                </div>
              ))}
              {captured.length > 0 && (
                <div className="pt-1 text-[10px] text-slate-500 flex items-center justify-between">
                  <span>{todayModules} module{todayModules === 1 ? '' : 's'} today</span>
                  <span className="font-mono">{attemptStats.accuracyPercent === null ? '—' : `${attemptStats.accuracyPercent}%`} overall accuracy</span>
                </div>
              )}
            </div>
          </div>

          {/* Real spaced review (FSRS-style ratings, real due dates) */}
          <FlashcardReviewPanel
            compact
            onOpenPage={(docId, page) => {
              try {
                sessionStorage.setItem('pulse.openPdf', JSON.stringify({ docId, page }));
              } catch { /* sessionStorage unavailable — the reader still opens */ }
              onNavigate('pdf-reader');
            }}
          />

          {/* Revision notes from real weak topics / captured mistakes */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" /> Revision notes
              </h3>
              <span className="text-[9px] font-mono text-slate-400 truncate max-w-[55%]">
                {getActiveProvider() ? `${getActiveProvider()} · ${getEffectiveModel(getActiveProvider()!)}` : 'no provider'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Generated from your weakest subjects and captured mistakes — nothing preloaded.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={generateRevisionNotes}
                disabled={notesBusy}
                className="px-3 py-1.5 rounded-lg bg-[#001432] text-white text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
              >
                {notesBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-[#8ff3f4]" />}
                {notesBusy ? 'Writing…' : 'Make my revision notes'}
              </button>
              {revisionNotes && (
                <button
                  onClick={() => {
                    try {
                      downloadNotesPdf(
                        `Weak-topic revision — ${currentExam.replace('_', '-')}`,
                        revisionNotes.text,
                        getActiveProvider() ? `${getActiveProvider()} · ${getEffectiveModel(getActiveProvider()!)}` : undefined,
                      );
                    } catch (err: any) {
                      setNotesError(err?.message || 'Could not open the print window.');
                    }
                  }}
                  className="text-[10px] font-bold text-[#0f8b8d] hover:underline"
                >
                  Download PDF
                </button>
              )}
            </div>
            {notesError && (
              <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-800">{notesError}</div>
            )}
            {revisionNotes && (
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 max-h-64 overflow-y-auto">
                <RevisionNote text={revisionNotes.text} topic={revisionNotes.topics} />
              </div>
            )}
          </div>
        </div>
      </div>

      {captureOpen && (
        <QuestionCaptureModal
          exam={currentExam}
          onClose={() => setCaptureOpen(false)}
          onSaved={() => setCapturedVersion((v) => v + 1)}
        />
      )}
    </div>
  );
};
