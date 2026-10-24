import React, { useState, useEffect, useRef } from 'react';
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
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Database,
  Upload,
  Trash2,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  FileText,
  Check
} from 'lucide-react';
import { ExamType, AppView, DifficultyTier, DifficultySubLevel, INISyllabusMode, ClinicalQuestion } from '../types.ts';
import { 
  NEET_PG_SUBJECTS, 
  INI_CET_DOMAINS_6, 
  AMC_CAT_DOMAINS_6 
} from '../data/mockClinicalData.ts';
import { SUBTOPICS } from '../data/subtopics.ts';
import {
  BankId,
  BankMetadata,
  BankQuestion,
  getBankFromIDB,
  getBankMetaFromIDB,
  saveBankToIDB,
  removeBankFromIDB,
  validateAndParseBankJSON,
  getSeenQuestionIds,
  markQuestionsAsSeen,
  resetSeenQuestions
} from '../utils/questionBankDB.ts';

export type QuestionSource = 'BUILTIN' | 'EMEDICI' | 'SUCCESS' | 'AMC' | 'ALL_IMPORTED';

export const BANK_CONFIGS: Record<BankId, { name: string; key: string; desc: string; sampleTag: string }> = {
  emedici: {
    name: 'eMedici',
    key: 'bank:emedici',
    desc: 'Australian medical case & clinical scenario question bank',
    sampleTag: 'eMedici Bank'
  },
  success: {
    name: 'AMC Success',
    key: 'bank:success',
    desc: 'High-yield AMC CAT preparation questions and rationales',
    sampleTag: 'AMC Success'
  },
  amc: {
    name: 'AMC Recall',
    key: 'bank:amc',
    desc: 'Authentic exam candidate recall collection (supports 2-5 options)',
    sampleTag: 'AMC Recall'
  }
};

interface PracticeModuleBuilderViewProps {
  currentExam: ExamType;
  onLaunchModule: (
    exam: ExamType, 
    count: number, 
    mode: 'EXAM' | 'TUTOR', 
    subjects: string[], 
    difficultyTier: DifficultyTier,
    difficultySubLevel?: DifficultySubLevel,
    chosenSubtopics?: string[],
    customQuestions?: ClinicalQuestion[]
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

  // Question Bank Source and Storage states
  const [questionSource, setQuestionSource] = useState<QuestionSource>('BUILTIN');
  const [bankMetas, setBankMetas] = useState<Record<BankId, BankMetadata | null>>({
    emedici: null,
    success: null,
    amc: null,
  });
  const [seenCounts, setSeenCounts] = useState<Record<BankId, number>>({
    emedici: 0,
    success: 0,
    amc: 0,
  });
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [emptyBankError, setEmptyBankError] = useState<string | null>(null);

  const fileInputRefs = {
    emedici: useRef<HTMLInputElement>(null),
    success: useRef<HTMLInputElement>(null),
    amc: useRef<HTMLInputElement>(null),
  };

  const refreshSeenCounts = () => {
    setSeenCounts({
      emedici: getSeenQuestionIds('emedici').length,
      success: getSeenQuestionIds('success').length,
      amc: getSeenQuestionIds('amc').length,
    });
  };

  const refreshBanks = async () => {
    try {
      const [emediciMeta, successMeta, amcMeta] = await Promise.all([
        getBankMetaFromIDB('emedici'),
        getBankMetaFromIDB('success'),
        getBankMetaFromIDB('amc'),
      ]);
      setBankMetas({
        emedici: emediciMeta,
        success: successMeta,
        amc: amcMeta,
      });
      refreshSeenCounts();
    } catch (err) {
      console.error('Failed to load bank metadata', err);
    }
  };

  useEffect(() => {
    refreshBanks();
  }, []);

  const triggerImport = (bankId: BankId) => {
    setEmptyBankError(null);
    fileInputRefs[bankId].current?.click();
  };

  const handleFileChange = async (bankId: BankId, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = validateAndParseBankJSON(text, bankId);
      await saveBankToIDB(bankId, result.valid, result.skippedCount);
      await refreshBanks();
      setEmptyBankError(null);
      setImportMessage({
        type: 'success',
        text: `Successfully imported ${result.importedCount} questions to ${BANK_CONFIGS[bankId].name} (${result.skippedCount} skipped: ${result.duplicatesDropped} duplicates, ${result.needsReviewSkipped} needs review, ${result.invalidFormatSkipped} invalid format).`
      });
    } catch (err: any) {
      setImportMessage({
        type: 'error',
        text: err.message || 'Failed to import question bank file.'
      });
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleRemoveBank = async (bankId: BankId) => {
    if (window.confirm(`Are you sure you want to remove all imported questions from ${BANK_CONFIGS[bankId].name}?`)) {
      await removeBankFromIDB(bankId);
      resetSeenQuestions(bankId);
      await refreshBanks();
      setImportMessage({
        type: 'success',
        text: `Removed ${BANK_CONFIGS[bankId].name} from local storage.`
      });
    }
  };

  const handleResetSeen = (bankId: BankId) => {
    resetSeenQuestions(bankId);
    refreshSeenCounts();
    setImportMessage({
      type: 'success',
      text: `Reset seen question tracker for ${BANK_CONFIGS[bankId].name}. Questions can now be drawn again.`
    });
  };

  // Subtopics state: Record<subjectName, selectedSubtopicNames[]>
  const [selectedSubtopics, setSelectedSubtopics] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    Object.keys(SUBTOPICS).forEach(key => {
      initial[key] = [...SUBTOPICS[key]];
    });
    return initial;
  });

  // Collapsed / Expanded state per subject
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  const toggleSubjectExpanded = (key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedSubjects(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const toggleSubtopic = (subjectKey: string, subtopic: string) => {
    setSelectedSubtopics(prev => {
      const current = prev[subjectKey] ?? SUBTOPICS[subjectKey] ?? [];
      const updated = current.includes(subtopic)
        ? current.filter(s => s !== subtopic)
        : [...current, subtopic];
      return { ...prev, [subjectKey]: updated };
    });
  };

  const selectAllSubtopics = (subjectKey: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const all = SUBTOPICS[subjectKey] || [];
    setSelectedSubtopics(prev => ({
      ...prev,
      [subjectKey]: [...all]
    }));
  };

  const clearAllSubtopics = (subjectKey: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedSubtopics(prev => ({
      ...prev,
      [subjectKey]: []
    }));
  };

  const toggleNeetSubject = (name: string) => {
    setSelectedNeetSubjects(prev => {
      const isSelected = prev.includes(name);
      if (isSelected) {
        return prev.length > 1 ? prev.filter(s => s !== name) : prev;
      } else {
        if (!selectedSubtopics[name] && SUBTOPICS[name]) {
          setSelectedSubtopics(s => ({ ...s, [name]: [...SUBTOPICS[name]] }));
        }
        return [...prev, name];
      }
    });
  };

  const toggleIniSubject = (name: string) => {
    setSelectedIniSubjects(prev => {
      const isSelected = prev.includes(name);
      if (isSelected) {
        return prev.length > 1 ? prev.filter(s => s !== name) : prev;
      } else {
        if (!selectedSubtopics[name] && SUBTOPICS[name]) {
          setSelectedSubtopics(s => ({ ...s, [name]: [...SUBTOPICS[name]] }));
        }
        return [...prev, name];
      }
    });
  };

  const toggleIniDomain = (id: string) => {
    setSelectedIniDomains(prev => {
      const isSelected = prev.includes(id);
      if (isSelected) {
        return prev.length > 1 ? prev.filter(d => d !== id) : prev;
      } else {
        if (!selectedSubtopics[id] && SUBTOPICS[id]) {
          setSelectedSubtopics(s => ({ ...s, [id]: [...SUBTOPICS[id]] }));
        }
        return [...prev, id];
      }
    });
  };

  const toggleAmcDomain = (id: string) => {
    setSelectedAmcDomains(prev => {
      const isSelected = prev.includes(id);
      if (isSelected) {
        return prev.length > 1 ? prev.filter(d => d !== id) : prev;
      } else {
        if (!selectedSubtopics[id] && SUBTOPICS[id]) {
          setSelectedSubtopics(s => ({ ...s, [id]: [...SUBTOPICS[id]] }));
        }
        return [...prev, id];
      }
    });
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

  const handleLaunch = async () => {
    setEmptyBankError(null);

    let subjects: string[] = [];
    if (selectedExam === 'NEET_PG') {
      subjects = selectedNeetSubjects;
    } else if (selectedExam === 'INI_CET') {
      subjects = iniSyllabusMode === '19_SUBJECTS' ? selectedIniSubjects : selectedIniDomains;
    } else {
      subjects = selectedAmcDomains;
    }

    const chosenSubtopics: string[] = [];
    subjects.forEach(subj => {
      const list = selectedSubtopics[subj] ?? SUBTOPICS[subj] ?? [];
      chosenSubtopics.push(...list);
    });

    if (questionSource === 'BUILTIN') {
      onLaunchModule(selectedExam, questionCount, mode, subjects, difficultyTier, difficultySubLevel, chosenSubtopics);
      return;
    }

    // Imported bank launch
    try {
      const bankIdsToQuery: BankId[] = 
        questionSource === 'ALL_IMPORTED' 
          ? ['emedici', 'success', 'amc']
          : [questionSource.toLowerCase() as BankId];

      const loadedBanks = await Promise.all(
        bankIdsToQuery.map(async bid => ({
          bankId: bid,
          questions: await getBankFromIDB(bid),
        }))
      );

      const candidatePool: BankQuestion[] = [];
      loadedBanks.forEach(b => candidatePool.push(...b.questions));

      if (candidatePool.length === 0) {
        const bankName = questionSource === 'ALL_IMPORTED'
          ? 'Imported Question Banks'
          : BANK_CONFIGS[questionSource.toLowerCase() as BankId].name;
        setEmptyBankError(`Selected question bank (${bankName}) is currently empty. Please import a .json bank file before launching.`);
        return;
      }

      // Filter by chosen subjects & subtopics if bank questions have subject/topic specified
      const subjectTerms = subjects.map(s => s.toLowerCase());
      const subtopicTerms = chosenSubtopics.map(s => s.toLowerCase());

      let filtered = candidatePool.filter(q => {
        const qSubj = (q.subject || '').toLowerCase();
        const qTop = (q.topic || q.group || '').toLowerCase();
        // If question has neither subject nor topic specified, retain it
        if (!qSubj && !qTop) return true;
        const matchesSubject = subjectTerms.some(term => qSubj.includes(term) || term.includes(qSubj));
        const matchesTopic = subtopicTerms.some(term => qTop.includes(term) || term.includes(qTop));
        return matchesSubject || matchesTopic;
      });

      // If strict filter yielded no results, fallback to full candidatePool
      if (filtered.length === 0) {
        filtered = candidatePool;
      }

      // Prioritize unseen questions
      const seenSet = new Set<string>();
      bankIdsToQuery.forEach(bid => {
        getSeenQuestionIds(bid).forEach(id => seenSet.add(id));
      });

      const unseen = filtered.filter(q => !seenSet.has(q.id));
      let selectedPool = unseen;

      // If unseen questions are fewer than questionCount, cycle in seen questions
      if (selectedPool.length < questionCount) {
        const seenQuestions = filtered.filter(q => seenSet.has(q.id));
        selectedPool = [...unseen, ...seenQuestions];
      }

      // Shuffle pool
      const shuffled = [...selectedPool].sort(() => Math.random() - 0.5);
      const chosen = shuffled.slice(0, questionCount);

      // Track newly drawn questions as seen per bank
      const drawnByBank: Record<string, string[]> = {};
      chosen.forEach(q => {
        if (!drawnByBank[q.bank]) drawnByBank[q.bank] = [];
        drawnByBank[q.bank].push(q.id);
      });
      Object.entries(drawnByBank).forEach(([bid, ids]) => {
        markQuestionsAsSeen(bid, ids);
      });

      refreshSeenCounts();

      // Convert BankQuestion to ClinicalQuestion with authentic option counts & answerIndex
      const letters: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B', 'C', 'D', 'E'];
      const clinicalQuestions: ClinicalQuestion[] = chosen.map((bq) => {
        const safeOptions = bq.options.map((optText, idx) => ({
          id: (letters[idx] || 'E') as 'A' | 'B' | 'C' | 'D' | 'E',
          text: optText,
        }));

        const safeCorrectOption = (letters[bq.answerIndex] || 'A') as 'A' | 'B' | 'C' | 'D' | 'E';

        const bankTitle = bq.bank === 'emedici' 
          ? 'eMedici Question Bank' 
          : bq.bank === 'success' 
            ? 'AMC Success High-Yield' 
            : 'AMC Official Recall';

        return {
          id: bq.id,
          moduleCode: bq.bank.toUpperCase(),
          examType: selectedExam,
          subject: bq.subject || (selectedExam === 'AMC_CAT' ? 'Adult Health' : 'General Medicine'),
          subtopic: bq.topic || bq.group || 'Clinical Application',
          cognitiveTier: 'Clinical 2-Step',
          difficultyTier: difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier,
          difficultySubLevel,
          stem: bq.question,
          questionText: bq.question,
          options: safeOptions,
          correctOption: safeCorrectOption,
          image: bq.image,
          boardPearl: bq.explanation || 'Key clinical concept and examination pearl.',
          citations: [bankTitle],
          targetAccuracy: 75,
        };
      });

      onLaunchModule(
        selectedExam, 
        clinicalQuestions.length, 
        mode, 
        subjects, 
        difficultyTier, 
        difficultySubLevel, 
        chosenSubtopics,
        clinicalQuestions
      );
    } catch (err: any) {
      setEmptyBankError(`Failed to load bank questions: ${err.message || 'Unknown error'}`);
    }
  };

  const totalChosenSubtopicsCount = (() => {
    let activeKeys: string[] = [];
    if (selectedExam === 'NEET_PG') {
      activeKeys = selectedNeetSubjects;
    } else if (selectedExam === 'INI_CET') {
      activeKeys = iniSyllabusMode === '19_SUBJECTS' ? selectedIniSubjects : selectedIniDomains;
    } else {
      activeKeys = selectedAmcDomains;
    }
    return activeKeys.reduce((sum, key) => {
      const count = (selectedSubtopics[key] ?? SUBTOPICS[key] ?? []).length;
      return sum + count;
    }, 0);
  })();

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

          {/* 2. Question Source & Importable Banks */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#0f8b8d]" /> 2. Question Source & Importable Banks
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select question origin or import custom banks stored safely in your browser (IndexedDB)
                </p>
              </div>
              <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-teal-50 text-[#0f8b8d] border border-teal-100 self-start sm:self-auto">
                Source: {
                  questionSource === 'BUILTIN' ? 'Built-in sample' :
                  questionSource === 'EMEDICI' ? 'eMedici' :
                  questionSource === 'SUCCESS' ? 'AMC Success' :
                  questionSource === 'AMC' ? 'AMC Recall' : 'All imported'
                }
              </span>
            </div>

            {/* Import Status Alert Banner */}
            {importMessage && (
              <div className={`p-3.5 rounded-xl text-xs flex items-start justify-between gap-2.5 ${
                importMessage.type === 'success' 
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' 
                  : 'bg-rose-50 border border-rose-200 text-rose-900'
              }`}>
                <div className="flex items-start gap-2">
                  {importMessage.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{importMessage.text}</span>
                </div>
                <button 
                  onClick={() => setImportMessage(null)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Source Selector (Built-in sample / eMedici / AMC Success / AMC Recall / All imported) */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Active Question Source:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { id: 'BUILTIN', label: 'Built-in sample', desc: 'Calibrated cases', count: 'Standard' },
                  { id: 'EMEDICI', label: 'eMedici', desc: 'Clinical bank', count: bankMetas.emedici?.count ? `${bankMetas.emedici.count} Qs` : 'Empty' },
                  { id: 'SUCCESS', label: 'AMC Success', desc: 'High-yield prep', count: bankMetas.success?.count ? `${bankMetas.success.count} Qs` : 'Empty' },
                  { id: 'AMC', label: 'AMC Recall', desc: 'Candidate recall', count: bankMetas.amc?.count ? `${bankMetas.amc.count} Qs` : 'Empty' },
                  { id: 'ALL_IMPORTED', label: 'All imported', desc: 'Merged pool', count: `${(bankMetas.emedici?.count || 0) + (bankMetas.success?.count || 0) + (bankMetas.amc?.count || 0)} Qs` },
                ].map((src) => {
                  const isSelected = questionSource === src.id;
                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => {
                        setQuestionSource(src.id as QuestionSource);
                        setEmptyBankError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-[#001432] text-white border-[#001432] shadow-sm ring-1 ring-[#001432]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold leading-tight">{src.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#8ff3f4]" />}
                      </div>
                      <div className={`text-[10px] leading-tight ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {src.desc}
                      </div>
                      <div className={`text-[10px] font-mono mt-1.5 font-bold ${
                        isSelected 
                          ? 'text-[#8ff3f4]' 
                          : src.count === 'Empty' ? 'text-amber-600' : 'text-[#0f8b8d]'
                      }`}>
                        {src.count}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Empty Bank Warning & Import CTA Banner */}
            {(() => {
              const isSelectedBankEmpty = 
                (questionSource === 'EMEDICI' && (!bankMetas.emedici || bankMetas.emedici.count === 0)) ||
                (questionSource === 'SUCCESS' && (!bankMetas.success || bankMetas.success.count === 0)) ||
                (questionSource === 'AMC' && (!bankMetas.amc || bankMetas.amc.count === 0)) ||
                (questionSource === 'ALL_IMPORTED' && ((bankMetas.emedici?.count || 0) + (bankMetas.success?.count || 0) + (bankMetas.amc?.count || 0) === 0)) ||
                !!emptyBankError;

              if (!isSelectedBankEmpty) return null;

              const targetBankId: BankId | null = 
                questionSource === 'EMEDICI' ? 'emedici' :
                questionSource === 'SUCCESS' ? 'success' :
                questionSource === 'AMC' ? 'amc' : null;

              const currentBankName = targetBankId 
                ? BANK_CONFIGS[targetBankId].name 
                : questionSource === 'ALL_IMPORTED' 
                  ? 'All Imported Banks' 
                  : 'Selected bank';

              return (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-amber-900">
                        {currentBankName} is currently empty
                      </h4>
                      <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                        {emptyBankError || `No questions have been imported for ${currentBankName} yet. The exam engine will not silently fall back to built-in questions. Please import a .json question bank file below to practice with this source.`}
                      </p>
                    </div>
                  </div>

                  {targetBankId ? (
                    <button
                      type="button"
                      onClick={() => triggerImport(targetBankId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all shadow-xs"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import {currentBankName} (.json)
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(['emedici', 'success', 'amc'] as BankId[]).map(bid => (
                        <button
                          key={bid}
                          type="button"
                          onClick={() => triggerImport(bid)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all shadow-xs"
                        >
                          <Upload className="w-3 h-3" />
                          Import {BANK_CONFIGS[bid].name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Question Banks Card */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#0f8b8d]" />
                  Question Banks (Client-Side Storage)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  IndexedDB key: bank:&lt;name&gt; · Per-bank seen tracking in localStorage
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(['emedici', 'success', 'amc'] as BankId[]).map((bankId) => {
                  const cfg = BANK_CONFIGS[bankId];
                  const meta = bankMetas[bankId];
                  const count = meta?.count || 0;
                  const skipped = meta?.skippedCount || 0;
                  const seen = seenCounts[bankId] || 0;
                  const isImported = count > 0;

                  return (
                    <div 
                      key={bankId} 
                      className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
                        isImported 
                          ? 'bg-white border-slate-200 shadow-xs' 
                          : 'bg-slate-50/70 border-dashed border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900">{cfg.name}</span>
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                            isImported 
                              ? 'bg-teal-100 text-teal-800' 
                              : 'bg-slate-200 text-slate-600'
                          }`}>
                            {isImported ? `${count} Qs` : 'Empty'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">
                          {cfg.desc}
                        </p>

                        {isImported && (
                          <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1 text-[11px] font-mono text-slate-600">
                            <div className="flex justify-between">
                              <span>Imported:</span>
                              <span className="font-bold text-slate-800">{count} Qs</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Skipped / Dropped:</span>
                              <span className="font-bold text-slate-500">{skipped} Qs</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Seen in tests:</span>
                              <span className="font-bold text-[#0f8b8d]">{seen} / {count}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                        {!isImported ? (
                          <button
                            type="button"
                            onClick={() => triggerImport(bankId)}
                            className="w-full py-2 px-3 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            Import bank (.json)
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => triggerImport(bankId)}
                              className="flex-1 py-1.5 px-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 shadow-2xs"
                              title="Replace bank with a new JSON file"
                            >
                              <Upload className="w-3 h-3 text-[#0f8b8d]" />
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResetSeen(bankId)}
                              className="py-1.5 px-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 shadow-2xs"
                              title="Reset seen questions list in localStorage"
                            >
                              <RotateCcw className="w-3 h-3 text-amber-600" />
                              Reset seen
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveBank(bankId)}
                              className="py-1.5 px-2 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 shadow-2xs"
                              title="Remove bank from IndexedDB"
                            >
                              <Trash2 className="w-3 h-3 text-rose-600" />
                              Remove
                            </button>
                          </>
                        )}

                        <input
                          type="file"
                          ref={fileInputRefs[bankId]}
                          accept=".json"
                          onChange={(e) => handleFileChange(bankId, e)}
                          className="hidden"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Granular Question Difficulty Selector with Sub-levels */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[#0f8b8d]" /> 3. Granular Question Difficulty & Sub-Tiers
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

          {/* 4. Authentic Syllabus & Discipline Tree */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#0f8b8d]" /> 4. Official Syllabus & Subject Coverage
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
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>{selectedNeetSubjects.length} of 19 Subjects Selected</span>
                  <span className="text-[11px] text-slate-400">Expand subtopics under any selected subject</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {NEET_PG_SUBJECTS.map(subj => {
                    const isSelected = selectedNeetSubjects.includes(subj.name);
                    const subtopicsTotal = SUBTOPICS[subj.name] || [];
                    const subtopicsSelected = selectedSubtopics[subj.name] ?? subtopicsTotal;
                    const isExpanded = !!expandedSubjects[subj.name];

                    return (
                      <div
                        key={subj.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? 'border-[#001432] bg-white shadow-xs'
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div
                          onClick={() => toggleNeetSubject(subj.name)}
                          className={`p-2.5 rounded-xl cursor-pointer flex items-center justify-between text-xs font-semibold select-none ${
                            isSelected ? 'bg-[#001432] text-white' : 'text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 pr-1">
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#8ff3f4] shrink-0" />}
                            <span className="truncate">{subj.name}</span>
                          </div>
                          <span className={`text-[9px] font-mono px-1 rounded shrink-0 ${
                            isSelected ? 'bg-slate-700 text-[#8ff3f4]' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {subj.weightage}
                          </span>
                        </div>

                        {/* Collapsible Subtopics Checklist under selected subject */}
                        {isSelected && (
                          <div className="p-2.5 border-t border-slate-100 bg-slate-50/70 rounded-b-xl space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <button
                                type="button"
                                onClick={(e) => toggleSubjectExpanded(subj.name, e)}
                                className="flex items-center gap-1 font-semibold text-slate-700 hover:text-[#0f8b8d] transition-colors"
                              >
                                <span>Subtopics ({subtopicsSelected.length}/{subtopicsTotal.length})</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                )}
                              </button>

                              <div className="flex items-center gap-1 text-[10px] font-bold">
                                <button
                                  type="button"
                                  onClick={(e) => selectAllSubtopics(subj.name, e)}
                                  className="text-[#0f8b8d] hover:underline px-1 py-0.5 rounded hover:bg-teal-50"
                                >
                                  Select All
                                </button>
                                <span className="text-slate-300">·</span>
                                <button
                                  type="button"
                                  onClick={(e) => clearAllSubtopics(subj.name, e)}
                                  className="text-slate-500 hover:text-rose-600 px-1 py-0.5 rounded hover:bg-rose-50"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="max-h-52 overflow-y-auto pr-1 space-y-1 pt-1.5 border-t border-slate-200">
                                {subtopicsTotal.map((subtopic) => {
                                  const isChecked = subtopicsSelected.includes(subtopic);
                                  return (
                                    <label
                                      key={subtopic}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`flex items-start gap-2 p-1.5 rounded-lg text-[11px] leading-snug cursor-pointer transition-colors ${
                                        isChecked ? 'bg-teal-50/80 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSubtopic(subj.name, subtopic)}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d] accent-[#0f8b8d]"
                                      />
                                      <span className="select-none">{subtopic}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedExam === 'INI_CET' && iniSyllabusMode === '19_SUBJECTS' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>{selectedIniSubjects.length} of 19 Subjects Selected</span>
                  <span className="text-[11px] text-slate-400">Expand subtopics under any selected subject</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {NEET_PG_SUBJECTS.map(subj => {
                    const isSelected = selectedIniSubjects.includes(subj.name);
                    const subtopicsTotal = SUBTOPICS[subj.name] || [];
                    const subtopicsSelected = selectedSubtopics[subj.name] ?? subtopicsTotal;
                    const isExpanded = !!expandedSubjects[subj.name];

                    return (
                      <div
                        key={subj.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? 'border-[#001432] bg-white shadow-xs'
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div
                          onClick={() => toggleIniSubject(subj.name)}
                          className={`p-2.5 rounded-xl cursor-pointer flex items-center justify-between text-xs font-semibold select-none ${
                            isSelected ? 'bg-[#001432] text-white' : 'text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 pr-1">
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#8ff3f4] shrink-0" />}
                            <span className="truncate">{subj.name}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {subj.highYield && (
                              <span className="text-[9px] font-bold text-amber-500">★ AIIMS</span>
                            )}
                            <span className={`text-[9px] font-mono px-1 rounded ${
                              isSelected ? 'bg-slate-700 text-[#8ff3f4]' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {subj.weightage}
                            </span>
                          </div>
                        </div>

                        {/* Collapsible Subtopics Checklist under selected subject */}
                        {isSelected && (
                          <div className="p-2.5 border-t border-slate-100 bg-slate-50/70 rounded-b-xl space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <button
                                type="button"
                                onClick={(e) => toggleSubjectExpanded(subj.name, e)}
                                className="flex items-center gap-1 font-semibold text-slate-700 hover:text-[#0f8b8d] transition-colors"
                              >
                                <span>Subtopics ({subtopicsSelected.length}/{subtopicsTotal.length})</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                )}
                              </button>

                              <div className="flex items-center gap-1 text-[10px] font-bold">
                                <button
                                  type="button"
                                  onClick={(e) => selectAllSubtopics(subj.name, e)}
                                  className="text-[#0f8b8d] hover:underline px-1 py-0.5 rounded hover:bg-teal-50"
                                >
                                  Select All
                                </button>
                                <span className="text-slate-300">·</span>
                                <button
                                  type="button"
                                  onClick={(e) => clearAllSubtopics(subj.name, e)}
                                  className="text-slate-500 hover:text-rose-600 px-1 py-0.5 rounded hover:bg-rose-50"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="max-h-52 overflow-y-auto pr-1 space-y-1 pt-1.5 border-t border-slate-200">
                                {subtopicsTotal.map((subtopic) => {
                                  const isChecked = subtopicsSelected.includes(subtopic);
                                  return (
                                    <label
                                      key={subtopic}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`flex items-start gap-2 p-1.5 rounded-lg text-[11px] leading-snug cursor-pointer transition-colors ${
                                        isChecked ? 'bg-teal-50/80 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSubtopic(subj.name, subtopic)}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d] accent-[#0f8b8d]"
                                      />
                                      <span className="select-none">{subtopic}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedExam === 'INI_CET' && iniSyllabusMode === '6_INTEGRATED_DOMAINS' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  {INI_CET_DOMAINS_6.map(domain => {
                    const isSelected = selectedIniDomains.includes(domain.id);
                    const subtopicsTotal = SUBTOPICS[domain.name] || SUBTOPICS[domain.id] || [];
                    const subtopicsSelected = selectedSubtopics[domain.id] ?? selectedSubtopics[domain.name] ?? subtopicsTotal;
                    const isExpanded = !!expandedSubjects[domain.id];

                    return (
                      <div
                        key={domain.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? 'border-[#0f8b8d] bg-white ring-1 ring-[#0f8b8d] shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div
                          onClick={() => toggleIniDomain(domain.id)}
                          className="p-3.5 cursor-pointer"
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

                        {/* Collapsible Subtopics Checklist under selected domain */}
                        {isSelected && (
                          <div className="p-3 border-t border-slate-100 bg-slate-50/70 rounded-b-xl space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <button
                                type="button"
                                onClick={(e) => toggleSubjectExpanded(domain.id, e)}
                                className="flex items-center gap-1 font-semibold text-slate-700 hover:text-[#0f8b8d] transition-colors"
                              >
                                <span>Subtopics ({subtopicsSelected.length}/{subtopicsTotal.length})</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                )}
                              </button>

                              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                                <button
                                  type="button"
                                  onClick={(e) => selectAllSubtopics(domain.id, e)}
                                  className="text-[#0f8b8d] hover:underline px-1 py-0.5 rounded hover:bg-teal-50"
                                >
                                  Select All
                                </button>
                                <span className="text-slate-300">·</span>
                                <button
                                  type="button"
                                  onClick={(e) => clearAllSubtopics(domain.id, e)}
                                  className="text-slate-500 hover:text-rose-600 px-1 py-0.5 rounded hover:bg-rose-50"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="max-h-52 overflow-y-auto pr-1 space-y-1 pt-1.5 border-t border-slate-200">
                                {subtopicsTotal.map((subtopic) => {
                                  const isChecked = subtopicsSelected.includes(subtopic);
                                  return (
                                    <label
                                      key={subtopic}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`flex items-start gap-2 p-1.5 rounded-lg text-[11px] leading-snug cursor-pointer transition-colors ${
                                        isChecked ? 'bg-teal-50/80 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSubtopic(domain.id, subtopic)}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d] accent-[#0f8b8d]"
                                      />
                                      <span className="select-none">{subtopic}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedExam === 'AMC_CAT' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  {AMC_CAT_DOMAINS_6.map(domain => {
                    const isSelected = selectedAmcDomains.includes(domain.id);
                    const subtopicsTotal = SUBTOPICS[domain.name] || SUBTOPICS[domain.id] || [];
                    const subtopicsSelected = selectedSubtopics[domain.id] ?? selectedSubtopics[domain.name] ?? subtopicsTotal;
                    const isExpanded = !!expandedSubjects[domain.id];

                    return (
                      <div
                        key={domain.id}
                        className={`rounded-xl border transition-all ${
                          isSelected
                            ? 'border-[#0f8b8d] bg-white ring-1 ring-[#0f8b8d] shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div
                          onClick={() => toggleAmcDomain(domain.id)}
                          className="p-3.5 cursor-pointer"
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

                        {/* Collapsible Subtopics Checklist under selected domain */}
                        {isSelected && (
                          <div className="p-3 border-t border-slate-100 bg-slate-50/70 rounded-b-xl space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <button
                                type="button"
                                onClick={(e) => toggleSubjectExpanded(domain.id, e)}
                                className="flex items-center gap-1 font-semibold text-slate-700 hover:text-[#0f8b8d] transition-colors"
                              >
                                <span>Subtopics ({subtopicsSelected.length}/{subtopicsTotal.length})</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                )}
                              </button>

                              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                                <button
                                  type="button"
                                  onClick={(e) => selectAllSubtopics(domain.id, e)}
                                  className="text-[#0f8b8d] hover:underline px-1 py-0.5 rounded hover:bg-teal-50"
                                >
                                  Select All
                                </button>
                                <span className="text-slate-300">·</span>
                                <button
                                  type="button"
                                  onClick={(e) => clearAllSubtopics(domain.id, e)}
                                  className="text-slate-500 hover:text-rose-600 px-1 py-0.5 rounded hover:bg-rose-50"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="max-h-52 overflow-y-auto pr-1 space-y-1 pt-1.5 border-t border-slate-200">
                                {subtopicsTotal.map((subtopic) => {
                                  const isChecked = subtopicsSelected.includes(subtopic);
                                  return (
                                    <label
                                      key={subtopic}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`flex items-start gap-2 p-1.5 rounded-lg text-[11px] leading-snug cursor-pointer transition-colors ${
                                        isChecked ? 'bg-teal-50/80 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSubtopic(domain.id, subtopic)}
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d] accent-[#0f8b8d]"
                                      />
                                      <span className="select-none">{subtopic}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
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
                Source: {
                  questionSource === 'BUILTIN' ? 'Built-in Sample' :
                  questionSource === 'EMEDICI' ? 'eMedici Bank' :
                  questionSource === 'SUCCESS' ? 'AMC Success' :
                  questionSource === 'AMC' ? 'AMC Recall' : 'All Imported'
                } · {questionCount} Questions · {difficultyTier} Tier {difficultySubLevel ? `(${difficultySubLevel})` : ''} · {totalChosenSubtopicsCount} Subtopics Active · {examDetails[selectedExam].scoring}
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
