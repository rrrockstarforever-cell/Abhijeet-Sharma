import React, { useState } from 'react';
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
  Clock, 
  Filter,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { ClinicalQuestion, AppView } from '../types.ts';
import { INITIAL_QUESTIONS } from '../data/mockClinicalData.ts';

interface MistakeNotebookViewProps {
  onNavigate: (view: AppView, questionId?: string) => void;
  onLaunchTestWithFilter?: (filter: string) => void;
}

export const MistakeNotebookView: React.FC<MistakeNotebookViewProps> = ({ 
  onNavigate,
  onLaunchTestWithFilter 
}) => {
  const [filterSubject, setFilterSubject] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'UNRESOLVED' | 'REMEDIATED'>('ALL');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({
    'Q-PA-1049': true,
    'Q-GM-4120': false,
    'Q10': false,
    'Q-PED-2911': false,
  });

  const toggleExpand = (id: string) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const questions = INITIAL_QUESTIONS.filter(q => {
    if (filterStatus === 'UNRESOLVED' && q.isRemediated) return false;
    if (filterStatus === 'REMEDIATED' && !q.isRemediated) return false;
    if (filterSubject !== 'ALL' && q.subject !== filterSubject) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <RotateCcw className="w-3.5 h-3.5 animate-spin-slow" />
              SRS Engine Active v4.2
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Clinical Mistake Notebook & Cognitive Root-Cause Analysis
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Track repeated board distractor traps, pinpoint pathophysiological misconceptions, and schedule spaced repetition remediation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onLaunchTestWithFilter ? onLaunchTestWithFilter('MISTAKE_SPRINT') : onNavigate('test-runner')}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#0f8b8d] to-[#00696b] hover:from-[#00696b] hover:to-[#0f8b8d] text-white text-sm font-semibold rounded-xl shadow-lg transition-all transform active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              Start SRS Mistake Sprint (10 Qs)
            </button>
          </div>
        </div>

        {/* 4 Stat Badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-700/60">
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Total Flagged Traps</div>
            <div className="text-2xl font-mono font-bold text-white mt-1">38 <span className="text-xs text-amber-400 font-normal">Active</span></div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Remediated & Retested</div>
            <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">22 <span className="text-xs text-emerald-400/80 font-normal">(57.8%)</span></div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Unresolved Misconceptions</div>
            <div className="text-2xl font-mono font-bold text-rose-400 mt-1">16 <span className="text-xs text-rose-300 font-normal">Priority</span></div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <div className="text-xs text-slate-400 font-medium">Due for Spaced Review Today</div>
            <div className="text-2xl font-mono font-bold text-amber-400 mt-1">7 <span className="text-xs text-amber-200 font-normal">Cards</span></div>
          </div>
        </div>
      </div>

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
                  {status === 'ALL' ? 'All Mistakes' : status === 'UNRESOLVED' ? 'Unresolved (16)' : 'Remediated (22)'}
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
                <option value="PATHOLOGY">Pathology</option>
                <option value="PHARMACOLOGY">Pharmacology</option>
                <option value="GENERAL MEDICINE">General Medicine</option>
                <option value="PEDIATRICS">Pediatrics</option>
                <option value="MICROBIOLOGY">Microbiology</option>
              </select>
            </div>
          </div>

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
                      </div>
                    </div>

                    {/* Question Title / Stem Preview */}
                    <div className="text-sm font-semibold text-slate-900 mt-2">
                      {q.stem}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                      {q.questionText}
                    </p>

                    {/* Embedded Histopathology Image if present */}
                    {q.image && (
                      <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
                        <img 
                          src={q.image} 
                          alt="Clinical Histopathology" 
                          className="w-32 h-24 object-cover rounded-lg border border-slate-300 shadow-sm"
                        />
                        <div className="flex-1 text-left">
                          <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider block">
                            {q.imageCaption || 'Histopathology Specimen'}
                          </span>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                            Cellular crescent compression of capillary tuft &gt;65% with basement membrane rupture on Jones Methenamine Silver stain.
                          </p>
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
              onClick={() => onNavigate('test-runner', 'Q-PA-1049')}
              className="w-full mt-4 py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              Launch Targeted Sprint <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Root Cause Attribution Breakdown */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0f8b8d]" /> Mistake Attribution Breakdown
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Psychometric categorization of incorrect selections across 38 questions
            </p>

            <div className="mt-4 space-y-3.5">
              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700">Conceptual Misunderstanding</span>
                  <span className="font-mono font-bold text-rose-600">46% (17 Qs)</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full" style={{ width: '46%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700">50-50 Eliminator Trap Picked</span>
                  <span className="font-mono font-bold text-amber-600">28% (11 Qs)</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: '28%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700">Negative Cue / Word Overlook ("EXCEPT")</span>
                  <span className="font-mono font-bold text-sky-600">26% (10 Qs)</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-sky-500 rounded-full" style={{ width: '26%' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Due for Spaced Review Today */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" /> Due Today (7 Items)
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                SRS v4.2
              </span>
            </div>

            <div className="space-y-2.5">
              {[
                { title: 'VanA vs VanB Glycopeptide Operon', sub: 'Microbiology · Harrison 142', due: 'Overdue by 2h' },
                { title: 'Pauci-Immune RPGN Silver Stain', sub: 'Pathology · Robbins 912', due: 'Due Today' },
                { title: 'Pheochromocytoma Alpha Blockade First', sub: 'Gen Medicine · Goodman & Gilman', due: 'Due Today' },
                { title: 'Neonatal Kernicterus with Ceftriaxone', sub: 'Pediatrics · Nelson 120', due: 'Due 4:00 PM' },
              ].map((item, idx) => (
                <div 
                  key={idx}
                  onClick={() => onNavigate('highlights')}
                  className="p-2.5 rounded-xl border border-slate-100 hover:border-[#0f8b8d]/40 hover:bg-slate-50 transition-all cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-800">{item.title}</div>
                    <div className="text-[11px] text-slate-500">{item.sub}</div>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-amber-600 px-1.5 py-0.5 rounded bg-amber-50">
                    {item.due}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
