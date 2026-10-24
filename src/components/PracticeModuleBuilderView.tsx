import React, { useState } from 'react';
import { 
  Sliders, 
  Layers, 
  Play, 
  Clock, 
  CheckCircle2, 
  Target, 
  Brain, 
  BookOpen, 
  Sparkles,
  ArrowRight,
  Flame,
  Award,
  ToggleLeft,
  ToggleRight,
  ShieldAlert
} from 'lucide-react';
import { ExamType, AppView, DifficultyTier, DifficultySubLevel, INISyllabusMode } from '../types.ts';
import { 
  NEET_PG_SUBJECTS, 
  INI_CET_DOMAINS_6, 
  AMC_CAT_DOMAINS_6 
} from '../data/mockClinicalData.ts';

interface PracticeModuleBuilderViewProps {
  currentExam: ExamType;
  onLaunchModule: (
    exam: ExamType, 
    count: number, 
    mode: 'EXAM' | 'TUTOR', 
    subjects: string[], 
    difficultyTier: DifficultyTier,
    difficultySubLevel?: DifficultySubLevel
  ) => void;
  onNavigate: (view: AppView) => void;
}

export const PracticeModuleBuilderView: React.FC<PracticeModuleBuilderViewProps> = ({
  currentExam,
  onLaunchModule,
  onNavigate
}) => {
  const [selectedExam, setSelectedExam] = useState<ExamType>(currentExam);
  const [iniSyllabusMode, setIniSyllabusMode] = useState<INISyllabusMode>('19_SUBJECTS');
  const [questionCount, setQuestionCount] = useState<number>(25);
  const [mode, setMode] = useState<'EXAM' | 'TUTOR'>('TUTOR');
  
  // Granular Difficulty State
  const [difficultyTier, setDifficultyTier] = useState<DifficultyTier>('ALL');
  const [difficultySubLevel, setDifficultySubLevel] = useState<DifficultySubLevel | undefined>(undefined);

  // Subject checklist states
  const [selectedNeetSubjects, setSelectedNeetSubjects] = useState<string[]>([
    'Pathology', 'Pharmacology', 'General Medicine', 'Obstetrics & Gynaecology'
  ]);
  const [selectedIniSubjects, setSelectedIniSubjects] = useState<string[]>([
    'Pathology', 'Pharmacology', 'General Medicine'
  ]);
  const [selectedIniDomains, setSelectedIniDomains] = useState<string[]>([
    'AIIMS_BASIC', 'AIIMS_MED', 'AIIMS_SURG'
  ]);
  const [selectedAmcDomains, setSelectedAmcDomains] = useState<string[]>([
    'AMC_MED', 'AMC_SURG', 'AMC_CHILD'
  ]);

  const toggleNeetSubject = (name: string) => {
    setSelectedNeetSubjects(prev => 
      prev.includes(name) ? (prev.length > 1 ? prev.filter(s => s !== name) : prev) : [...prev, name]
    );
  };

  const toggleIniSubject = (name: string) => {
    setSelectedIniSubjects(prev => 
      prev.includes(name) ? (prev.length > 1 ? prev.filter(s => s !== name) : prev) : [...prev, name]
    );
  };

  const toggleIniDomain = (id: string) => {
    setSelectedIniDomains(prev => 
      prev.includes(id) ? (prev.length > 1 ? prev.filter(d => d !== id) : prev) : [...prev, id]
    );
  };

  const toggleAmcDomain = (id: string) => {
    setSelectedAmcDomains(prev => 
      prev.includes(id) ? (prev.length > 1 ? prev.filter(d => d !== id) : prev) : [...prev, id]
    );
  };

  const examDetails = {
    NEET_PG: {
      name: 'NEET-PG Pattern',
      scoring: '+4 / -1 Marking Rule',
      desc: 'National Board of Examinations (NBE) blueprint across 19 NMC subjects with clinical vignettes.',
    },
    INI_CET: {
      name: 'INI-CET AIIMS Pattern',
      scoring: '+1 / -0.33 Marking Rule',
      desc: 'AIIMS clinical matrix matching, assertion-reasoning, and multiple statement completion.',
    },
    AMC_CAT: {
      name: 'AMC CAT Examination',
      scoring: 'Computer Adaptive Scoring (0-500 scale, 250 pass mark)',
      desc: 'Australian Medical Council 6 core domains with dynamic item difficulty calibration.',
    },
  };

  const handleLaunch = () => {
    let subjects: string[] = [];
    if (selectedExam === 'NEET_PG') {
      subjects = selectedNeetSubjects;
    } else if (selectedExam === 'INI_CET') {
      subjects = iniSyllabusMode === '19_SUBJECTS' ? selectedIniSubjects : selectedIniDomains;
    } else {
      subjects = selectedAmcDomains;
    }

    onLaunchModule(selectedExam, questionCount, mode, subjects, difficultyTier, difficultySubLevel);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Sliders className="w-3.5 h-3.5" />
              Dynamic Test Engine & Blueprint Calibrator
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Adaptive Practice Module Generator & Exam Builder
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Configure question sets calibrated to target board marking rules, authentic syllabi (NEET-PG, INI-CET, AMC CAT), and granular difficulty tiers.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-800 text-amber-400 border border-slate-700 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-amber-400" /> Blueprint Calibrated
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid Setup */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Configuration Controls */}
        <div className="lg:col-span-8 space-y-6">
          {/* 1. Target Board Examination Selection (USMLE Removed) */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Target className="w-4 h-4 text-[#0f8b8d]" /> 1. Target Board Blueprint
              </h3>
              <span className="text-xs font-semibold text-slate-500">Selects marking rules & exam styling</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['NEET_PG', 'INI_CET', 'AMC_CAT'] as ExamType[]).map((examKey) => {
                const isSelected = selectedExam === examKey;
                const info = examDetails[examKey];

                return (
                  <div
                    key={examKey}
                    onClick={() => setSelectedExam(examKey)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-[#0f8b8d] bg-teal-50/20 ring-2 ring-[#0f8b8d]/20 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-900">{info.name}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#0f8b8d]" />}
                    </div>
                    <div className="text-[10px] font-mono font-bold text-[#0f8b8d] mb-1">
                      {info.scoring}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {info.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Granular Question Difficulty Selector with Sub-levels */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[#0f8b8d]" /> 2. Granular Question Difficulty & Sub-Tiers
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select baseline complexity or target specific cognitive challenges
                </p>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                Tier: {difficultyTier} {difficultySubLevel ? `(${difficultySubLevel})` : ''}
              </span>
            </div>

            {/* 4 Main Tier Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { id: 'ALL', label: 'All Levels (Adaptive Mix)', desc: 'Dynamic mix from basic to ranker' },
                { id: 'LOW', label: 'Low Difficulty', desc: 'Direct recall & buzzword cues' },
                { id: 'MEDIUM', label: 'Medium Difficulty', desc: '2-step reasoning & mimickers' },
                { id: 'HIGH', label: 'High Difficulty', desc: 'Multi-step traps & complex cases' },
              ].map(tier => {
                const isSelected = difficultyTier === tier.id;
                return (
                  <button
                    key={tier.id}
                    onClick={() => {
                      setDifficultyTier(tier.id as DifficultyTier);
                      setDifficultySubLevel(undefined);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-[#001432] text-white border-[#001432] shadow-sm ring-1 ring-[#001432]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-xs font-bold">{tier.label}</div>
                    <div className={`text-[10px] mt-1 leading-snug ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {tier.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Granular Sub-level Pills */}
            {difficultyTier !== 'ALL' && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  Fine-Tune {difficultyTier} Sub-Level (Optional):
                </span>
                <div className="flex flex-wrap gap-2">
                  {difficultyTier === 'LOW' && (
                    <>
                      <button
                        onClick={() => setDifficultySubLevel(difficultySubLevel === 'L1' ? undefined : 'L1')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          difficultySubLevel === 'L1' ? 'bg-[#0f8b8d] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Sub-level L1: 1-Step Direct Fact Retrieval (Enzymes, normal ranges)
                      </button>
                      <button
                        onClick={() => setDifficultySubLevel(difficultySubLevel === 'L2' ? undefined : 'L2')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          difficultySubLevel === 'L2' ? 'bg-[#0f8b8d] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Sub-level L2: Characteristic Sign & Buzzwords (Pathognomonic cues)
                      </button>
                    </>
                  )}

                  {difficultyTier === 'MEDIUM' && (
                    <>
                      <button
                        onClick={() => setDifficultySubLevel(difficultySubLevel === 'M1' ? undefined : 'M1')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          difficultySubLevel === 'M1' ? 'bg-[#0f8b8d] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Sub-level M1: Clinical 2-Step Reasoning (Vignette + Labs $\rightarrow$ Diagnosis)
                      </button>
                      <button
                        onClick={() => setDifficultySubLevel(difficultySubLevel === 'M2' ? undefined : 'M2')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          difficultySubLevel === 'M2' ? 'bg-[#0f8b8d] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Sub-level M2: Plausible Distractor Discrimination (Eliminate paired traps)
                      </button>
                    </>
                  )}

                  {difficultyTier === 'HIGH' && (
                    <>
                      <button
                        onClick={() => setDifficultySubLevel(difficultySubLevel === 'H1' ? undefined : 'H1')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          difficultySubLevel === 'H1' ? 'bg-[#0f8b8d] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Sub-level H1: Multi-Step Management & Complications (Condition $\rightarrow$ Failure $\rightarrow$ Emergency)
                      </button>
                      <button
                        onClick={() => setDifficultySubLevel(difficultySubLevel === 'H2' ? undefined : 'H2')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          difficultySubLevel === 'H2' ? 'bg-[#0f8b8d] text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Sub-level H2: High-Yield Board Traps & Atypical IBQs (Subtle normal lab distractors)
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Authentic Syllabus & Discipline Tree */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#0f8b8d]" /> 3. Official Syllabus & Subject Coverage
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedExam === 'NEET_PG' && '19 Standard NMC/NBE Medical Disciplines'}
                  {selectedExam === 'INI_CET' && 'AIIMS Integrated Clinical Disciplines'}
                  {selectedExam === 'AMC_CAT' && 'Australian Medical Council 6 Core Patient Domains'}
                </p>
              </div>

              {/* INI-CET Dual Syllabus View Toggle */}
              {selectedExam === 'INI_CET' && (
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => setIniSyllabusMode('19_SUBJECTS')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                      iniSyllabusMode === '19_SUBJECTS'
                        ? 'bg-[#001432] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    19 NMC Subjects View
                  </button>
                  <button
                    onClick={() => setIniSyllabusMode('6_INTEGRATED_DOMAINS')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                      iniSyllabusMode === '6_INTEGRATED_DOMAINS'
                        ? 'bg-[#001432] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    6 AIIMS Organ Domains View
                  </button>
                </div>
              )}
            </div>

            {/* Disciplines Content */}
            {selectedExam === 'NEET_PG' && (
              <div className="space-y-4">
                <div className="text-xs text-slate-500 font-medium">
                  {selectedNeetSubjects.length} of 19 Subjects Selected
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {NEET_PG_SUBJECTS.map(subj => {
                    const isSelected = selectedNeetSubjects.includes(subj.name);
                    return (
                      <button
                        key={subj.id}
                        onClick={() => toggleNeetSubject(subj.name)}
                        className={`p-2.5 rounded-xl text-left border text-xs font-semibold transition-all ${
                          isSelected
                            ? 'bg-[#001432] text-white border-[#001432] shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate pr-1">{subj.name}</span>
                          <span className={`text-[9px] font-mono px-1 rounded shrink-0 ${
                            isSelected ? 'bg-slate-700 text-[#8ff3f4]' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {subj.weightage}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedExam === 'INI_CET' && iniSyllabusMode === '19_SUBJECTS' && (
              <div className="space-y-4">
                <div className="text-xs text-slate-500 font-medium">
                  {selectedIniSubjects.length} of 19 Subjects Selected
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {NEET_PG_SUBJECTS.map(subj => {
                    const isSelected = selectedIniSubjects.includes(subj.name);
                    return (
                      <button
                        key={subj.id}
                        onClick={() => toggleIniSubject(subj.name)}
                        className={`p-2.5 rounded-xl text-left border text-xs font-semibold transition-all ${
                          isSelected
                            ? 'bg-[#001432] text-white border-[#001432] shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate pr-1">{subj.name}</span>
                          {subj.highYield && (
                            <span className="text-[9px] font-bold text-amber-500">★ AIIMS</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedExam === 'INI_CET' && iniSyllabusMode === '6_INTEGRATED_DOMAINS' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {INI_CET_DOMAINS_6.map(domain => {
                    const isSelected = selectedIniDomains.includes(domain.id);
                    return (
                      <div
                        key={domain.id}
                        onClick={() => toggleIniDomain(domain.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-[#0f8b8d] bg-teal-50/20 ring-1 ring-[#0f8b8d]'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900">{domain.name}</span>
                          <span className="text-[10px] font-mono font-bold text-[#0f8b8d] bg-teal-50 px-1.5 py-0.5 rounded">
                            {domain.weightage}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {domain.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedExam === 'AMC_CAT' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {AMC_CAT_DOMAINS_6.map(domain => {
                    const isSelected = selectedAmcDomains.includes(domain.id);
                    return (
                      <div
                        key={domain.id}
                        onClick={() => toggleAmcDomain(domain.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-[#0f8b8d] bg-teal-50/20 ring-1 ring-[#0f8b8d]'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900">{domain.name}</span>
                          <span className="text-[10px] font-mono font-bold text-[#0f8b8d] bg-teal-50 px-1.5 py-0.5 rounded">
                            {domain.officialWeight} ({domain.questionRatio})
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {domain.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Execution Mode, Volume & Launch CTA */}
        <div className="lg:col-span-4 space-y-6">
          {/* Execution Mode Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#0f8b8d]" /> Execution & Feedback Mode
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('TUTOR')}
                className={`p-3 rounded-xl border text-center transition-all ${
                  mode === 'TUTOR'
                    ? 'border-[#0f8b8d] bg-[#0f8b8d]/10 text-[#0f8b8d] font-bold ring-1 ring-[#0f8b8d]'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs">Tutor Mode</div>
                <div className="text-[10px] text-slate-500 font-normal mt-0.5">Instant explanations & pearls</div>
              </button>

              <button
                onClick={() => setMode('EXAM')}
                className={`p-3 rounded-xl border text-center transition-all ${
                  mode === 'EXAM'
                    ? 'border-[#001432] bg-[#001432] text-white font-bold'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs">Strict Exam Mode</div>
                <div className="text-[10px] text-slate-300 font-normal mt-0.5">Countdown & negative scoring</div>
              </button>
            </div>
          </div>

          {/* Question Volume Selector */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Question Volume</h3>
              <span className="text-xs font-mono font-bold text-[#0f8b8d]">{questionCount} MCQs</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[10, 25, 50, 100].map((count) => (
                <button
                  key={count}
                  onClick={() => setQuestionCount(count)}
                  className={`py-2 rounded-xl text-xs font-bold transition-all ${
                    questionCount === count
                      ? 'bg-[#001432] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {count} Qs
                </button>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 font-mono">
              <div className="flex justify-between text-slate-600">
                <span>Estimated Duration:</span>
                <span className="font-bold text-slate-800">~{Math.round(questionCount * 1.1)} min</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Target Pace:</span>
                <span className="font-bold text-emerald-600">1.1 min / Question</span>
              </div>
            </div>
          </div>

          {/* Module Launch Action Card */}
          <div className="bg-gradient-to-br from-[#001432] to-[#13294b] text-white rounded-2xl p-5 border border-[#13294b] shadow-lg space-y-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#8ff3f4] font-bold">
                Ready to Assemble
              </div>
              <h4 className="text-base font-bold text-white mt-1">
                {selectedExam.replace('_', '-')} Practice Module
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {questionCount} Questions · {difficultyTier} Tier {difficultySubLevel ? `(${difficultySubLevel})` : ''} · {examDetails[selectedExam].scoring}
              </p>
            </div>

            <button
              onClick={handleLaunch}
              className="w-full py-3 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 transform active:scale-95"
            >
              <Play className="w-4 h-4 fill-current" /> Launch Clinical Module
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
