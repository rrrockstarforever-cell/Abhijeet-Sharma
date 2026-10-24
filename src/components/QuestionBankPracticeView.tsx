import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Database,
  Upload,
  Trash2,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Search,
  Filter,
  Check,
  Clock,
  BookOpen,
  Layers,
  Sparkles,
  Info,
  CheckSquare,
  Square,
  FileQuestion
} from 'lucide-react';
import { ExamType, AppView, ClinicalQuestion } from '../types.ts';
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

export const BANK_CONFIGS: Record<BankId, { name: string; key: string; desc: string; defaultExam: ExamType }> = {
  emedici: {
    name: 'eMedici',
    key: 'bank:emedici',
    desc: 'Australian medical case & clinical scenario question bank',
    defaultExam: 'AMC_CAT'
  },
  success: {
    name: 'AMC Success',
    key: 'bank:success',
    desc: 'High-yield AMC CAT clinical examination questions & rationales',
    defaultExam: 'AMC_CAT'
  },
  amc: {
    name: 'AMC Recall',
    key: 'bank:amc',
    desc: 'Authentic AMC candidate recall collection (supports 2-5 option items)',
    defaultExam: 'AMC_CAT'
  }
};

export type ActiveBankTab = 'emedici' | 'success' | 'amc' | 'all';

interface QuestionBankPracticeViewProps {
  onNavigate: (view: AppView) => void;
  onLaunchTest: (questions: ClinicalQuestion[], mode: 'EXAM' | 'TUTOR', exam: ExamType) => void;
}

export const QuestionBankPracticeView: React.FC<QuestionBankPracticeViewProps> = ({
  onNavigate,
  onLaunchTest
}) => {
  const [activeTab, setActiveTab] = useState<ActiveBankTab>('emedici');
  
  // Bank cache and metadata
  const [bankMetas, setBankMetas] = useState<Record<BankId, BankMetadata | null>>({
    emedici: null,
    success: null,
    amc: null,
  });
  const [bankQuestions, setBankQuestions] = useState<Record<BankId, BankQuestion[]>>({
    emedici: [],
    success: [],
    amc: [],
  });
  const [seenCounts, setSeenCounts] = useState<Record<BankId, number>>({
    emedici: 0,
    success: 0,
    amc: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [unseenOnly, setUnseenOnly] = useState<boolean>(false);
  const [questionCount, setQuestionCount] = useState<number>(25);
  const [testMode, setTestMode] = useState<'EXAM' | 'TUTOR'>('TUTOR');

  // File input refs per bank
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

  const loadAllBanks = async () => {
    setIsLoading(true);
    try {
      const [emediciMeta, successMeta, amcMeta] = await Promise.all([
        getBankMetaFromIDB('emedici'),
        getBankMetaFromIDB('success'),
        getBankMetaFromIDB('amc'),
      ]);
      const [emediciQs, successQs, amcQs] = await Promise.all([
        getBankFromIDB('emedici'),
        getBankFromIDB('success'),
        getBankFromIDB('amc'),
      ]);

      setBankMetas({
        emedici: emediciMeta,
        success: successMeta,
        amc: amcMeta,
      });
      setBankQuestions({
        emedici: emediciQs,
        success: successQs,
        amc: amcQs,
      });
      refreshSeenCounts();
    } catch (err) {
      console.error('Failed to load bank data from IndexedDB', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllBanks();
  }, []);

  const triggerImport = (bankId: BankId) => {
    fileInputRefs[bankId].current?.click();
  };

  const handleFileChange = async (bankId: BankId, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = validateAndParseBankJSON(text, bankId);
      await saveBankToIDB(bankId, result.valid, result.skippedCount);
      await loadAllBanks();
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
      await loadAllBanks();
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

  // Determine current active questions pool
  const currentPool: BankQuestion[] = useMemo(() => {
    if (activeTab === 'all') {
      return [
        ...bankQuestions.emedici,
        ...bankQuestions.success,
        ...bankQuestions.amc,
      ];
    }
    return bankQuestions[activeTab] || [];
  }, [activeTab, bankQuestions]);

  // Extract unique available subjects, topics, and groups from imported questions' own fields
  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    currentPool.forEach(q => {
      if (q.subject && q.subject.trim()) set.add(q.subject.trim());
    });
    return Array.from(set).sort();
  }, [currentPool]);

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    currentPool.forEach(q => {
      if (q.topic && q.topic.trim()) set.add(q.topic.trim());
    });
    return Array.from(set).sort();
  }, [currentPool]);

  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    currentPool.forEach(q => {
      if (q.group && q.group.trim()) set.add(q.group.trim());
    });
    return Array.from(set).sort();
  }, [currentPool]);

  // Reset selected filters when switching tabs if they don't exist in new pool
  useEffect(() => {
    setSelectedSubjects(prev => prev.filter(s => availableSubjects.includes(s)));
    setSelectedTopics(prev => prev.filter(t => availableTopics.includes(t)));
    setSelectedGroups(prev => prev.filter(g => availableGroups.includes(g)));
  }, [activeTab, availableSubjects, availableTopics, availableGroups]);

  // Seen questions for current tab
  const currentSeenSet = useMemo(() => {
    const set = new Set<string>();
    if (activeTab === 'all') {
      getSeenQuestionIds('emedici').forEach(id => set.add(id));
      getSeenQuestionIds('success').forEach(id => set.add(id));
      getSeenQuestionIds('amc').forEach(id => set.add(id));
    } else {
      getSeenQuestionIds(activeTab).forEach(id => set.add(id));
    }
    return set;
  }, [activeTab, seenCounts]);

  // Filter questions according to search, subjects, topics, groups, and unseenOnly
  const filteredQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return currentPool.filter(q => {
      // 1. Search Query
      if (query) {
        const inQuestion = q.question.toLowerCase().includes(query);
        const inOptions = q.options.some(opt => opt.toLowerCase().includes(query));
        const inExplanation = q.explanation ? q.explanation.toLowerCase().includes(query) : false;
        const inTopic = q.topic ? q.topic.toLowerCase().includes(query) : false;
        const inSubject = q.subject ? q.subject.toLowerCase().includes(query) : false;
        if (!inQuestion && !inOptions && !inExplanation && !inTopic && !inSubject) {
          return false;
        }
      }

      // 2. Subject Filter
      if (selectedSubjects.length > 0) {
        if (!q.subject || !selectedSubjects.includes(q.subject)) {
          return false;
        }
      }

      // 3. Topic Filter
      if (selectedTopics.length > 0) {
        if (!q.topic || !selectedTopics.includes(q.topic)) {
          return false;
        }
      }

      // 4. Group Filter
      if (selectedGroups.length > 0) {
        if (!q.group || !selectedGroups.includes(q.group)) {
          return false;
        }
      }

      // 5. Unseen Only Filter
      if (unseenOnly) {
        if (currentSeenSet.has(q.id)) {
          return false;
        }
      }

      return true;
    });
  }, [currentPool, searchQuery, selectedSubjects, selectedTopics, selectedGroups, unseenOnly, currentSeenSet]);

  const toggleItem = (list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>, item: string) => {
    setList(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
  };

  const handleLaunch = () => {
    if (filteredQuestions.length === 0) {
      alert('No questions match your current filter selection. Please adjust your filters or import questions.');
      return;
    }

    // Shuffle and pick requested number
    const shuffled = [...filteredQuestions].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, questionCount);

    // Track chosen questions as seen
    const drawnByBank: Record<string, string[]> = {};
    chosen.forEach(q => {
      if (!drawnByBank[q.bank]) drawnByBank[q.bank] = [];
      drawnByBank[q.bank].push(q.id);
    });
    Object.entries(drawnByBank).forEach(([bid, ids]) => {
      markQuestionsAsSeen(bid, ids);
    });
    refreshSeenCounts();

    // Convert to ClinicalQuestion, preserving real option count and exact answerIndex
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

      const defaultExam: ExamType = bq.bank === 'emedici' || bq.bank === 'success' || bq.bank === 'amc'
        ? 'AMC_CAT'
        : 'NEET_PG';

      return {
        id: bq.id,
        moduleCode: bq.bank.toUpperCase(),
        sourceType: bq.bank,
        examType: defaultExam,
        subject: bq.subject || 'Clinical Medicine',
        subtopic: bq.topic || bq.group || 'Clinical Recall Application',
        cognitiveTier: 'Clinical 2-Step',
        difficultyTier: 'MEDIUM',
        stem: bq.question,
        questionText: bq.question,
        options: safeOptions,
        correctOption: safeCorrectOption,
        image: bq.image,
        boardPearl: bq.explanation || 'Key clinical board recall concept.',
        citations: [bankTitle],
        targetAccuracy: 75,
      };
    });

    const targetExam = activeTab !== 'all' ? BANK_CONFIGS[activeTab].defaultExam : 'AMC_CAT';
    onLaunchTest(clinicalQuestions, testMode, targetExam);
  };

  const totalImportedCount = 
    (bankMetas.emedici?.count || 0) + 
    (bankMetas.success?.count || 0) + 
    (bankMetas.amc?.count || 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Database className="w-3.5 h-3.5" />
              Dedicated Question Bank Module Runner
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Imported Question Banks & Candidate Recall Engine
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Practice exclusively from imported collections (eMedici, AMC Success, AMC Recall). Questions, filters, and attempt histories are kept strictly isolated from AI-generated modules.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-800 text-[#8ff3f4] border border-slate-700 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#0f8b8d]" /> Total Stored: {totalImportedCount} Qs
            </span>
          </div>
        </div>
      </div>

      {/* Import Status Alert Banner */}
      {importMessage && (
        <div className={`p-4 rounded-xl text-xs flex items-start justify-between gap-3 ${
          importMessage.type === 'success' 
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' 
            : 'bg-rose-50 border border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-start gap-2.5">
            {importMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{importMessage.text}</span>
          </div>
          <button 
            onClick={() => setImportMessage(null)}
            className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1.5 py-0.5 rounded hover:bg-slate-200/50"
          >
            ✕
          </button>
        </div>
      )}

      {/* Question Banks Management Cards (Import / Replace / Remove / Reset-seen) */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0f8b8d]" /> Question Bank Storage & File Imports
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Secure client-side IndexedDB persistence (<code className="font-mono text-[#0f8b8d]">bank:&lt;name&gt;</code>) with duplicate pruning and answer index validation
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Accepts JSON arrays or <code className="text-slate-700 font-semibold">{'{ questions: [] }'}</code>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
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
                className={`p-4 rounded-xl border flex flex-col justify-between space-y-3.5 transition-all ${
                  isImported 
                    ? 'bg-white border-slate-200 shadow-xs ring-1 ring-slate-100' 
                    : 'bg-slate-50/70 border-dashed border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-900">{cfg.name}</span>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      isImported 
                        ? 'bg-teal-100 text-teal-800' 
                        : 'bg-slate-200 text-slate-600'
                    }`}>
                      {isImported ? `${count} Qs` : 'Empty'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">
                    {cfg.desc}
                  </p>

                  {isImported && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5 text-xs font-mono text-slate-600">
                      <div className="flex justify-between">
                        <span>Imported:</span>
                        <span className="font-bold text-slate-800">{count} Qs</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>Skipped:</span>
                        <span>{skipped} invalid/dupes</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Seen questions:</span>
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
                        className="flex-1 py-1.5 px-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-all flex items-center justify-center gap-1 shadow-2xs"
                        title="Replace bank with a new JSON file"
                      >
                        <Upload className="w-3 h-3 text-[#0f8b8d]" />
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResetSeen(bankId)}
                        className="py-1.5 px-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-all flex items-center justify-center gap-1 shadow-2xs"
                        title="Reset seen questions list in localStorage"
                      >
                        <RotateCcw className="w-3 h-3 text-amber-600" />
                        Reset seen
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBank(bankId)}
                        className="py-1.5 px-2 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-all flex items-center justify-center gap-1 shadow-2xs"
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

      {/* Main Bank Selection Tabs */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#0f8b8d]" /> Active Bank Practice Set & Dynamic Filters
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Select bank source, refine by extracted fields, and launch timed exams or tutor sessions
          </p>
        </div>

        {/* Bank Tabs with Real Question Counts */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {[
            { id: 'emedici', label: 'eMedici', count: bankMetas.emedici?.count || 0 },
            { id: 'success', label: 'AMC Success', count: bankMetas.success?.count || 0 },
            { id: 'amc', label: 'AMC Recall', count: bankMetas.amc?.count || 0 },
            { id: 'all', label: 'All Imported Banks', count: totalImportedCount },
          ].map((tab) => {
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveBankTab)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  isTabActive
                    ? 'bg-[#001432] text-white shadow-sm ring-2 ring-[#0f8b8d]'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  isTabActive
                    ? 'bg-[#0f8b8d] text-white'
                    : tab.count > 0 ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-800'
                }`}>
                  {tab.count} Qs
                </span>
              </button>
            );
          })}
        </div>

        {/* Empty Active Bank Guard */}
        {currentPool.length === 0 ? (
          <div className="p-8 rounded-2xl bg-amber-50/70 border-2 border-dashed border-amber-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-bold text-amber-900">
                {activeTab === 'all' ? 'All Imported Banks are Empty' : `${BANK_CONFIGS[activeTab].name} is currently empty`}
              </h4>
              <p className="text-xs text-amber-700 max-w-md mx-auto mt-1 leading-relaxed">
                No questions found in IndexedDB. Click below to select a .json question bank file to populate this collection.
              </p>
            </div>
            {activeTab !== 'all' ? (
              <button
                type="button"
                onClick={() => triggerImport(activeTab)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all shadow-md"
              >
                <Upload className="w-4 h-4" />
                Import {BANK_CONFIGS[activeTab].name} (.json)
              </button>
            ) : (
              <div className="flex justify-center gap-2">
                {(['emedici', 'success', 'amc'] as BankId[]).map(bid => (
                  <button
                    key={bid}
                    type="button"
                    onClick={() => triggerImport(bid)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import {BANK_CONFIGS[bid].name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Free-Text Search & Unseen Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by question stem keywords, clinical signs, drugs, or explanation..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0f8b8d] focus:bg-white transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Unseen Only Toggle */}
              <label className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors shrink-0">
                <input
                  type="checkbox"
                  checked={unseenOnly}
                  onChange={(e) => setUnseenOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d] accent-[#0f8b8d]"
                />
                <span className="text-xs font-bold text-slate-700">Unseen only</span>
                <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {currentPool.length - currentSeenSet.size} Unseen
                </span>
              </label>
            </div>

            {/* Dynamic Filters from Questions' Own Fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Subjects Filter */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Subjects ({availableSubjects.length})
                  </span>
                  {selectedSubjects.length > 0 && (
                    <button
                      onClick={() => setSelectedSubjects([])}
                      className="text-[10px] text-teal-700 font-semibold hover:underline"
                    >
                      Clear ({selectedSubjects.length})
                    </button>
                  )}
                </div>

                {availableSubjects.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No subject tags found in imported file</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {availableSubjects.map((subject) => {
                      const isChecked = selectedSubjects.includes(subject);
                      return (
                        <label
                          key={subject}
                          className={`flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            isChecked ? 'bg-teal-50 text-teal-900 font-bold' : 'text-slate-700 hover:bg-slate-200/60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(selectedSubjects, setSelectedSubjects, subject)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] accent-[#0f8b8d]"
                          />
                          <span className="truncate">{subject}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. Topics Filter */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Topics ({availableTopics.length})
                  </span>
                  {selectedTopics.length > 0 && (
                    <button
                      onClick={() => setSelectedTopics([])}
                      className="text-[10px] text-teal-700 font-semibold hover:underline"
                    >
                      Clear ({selectedTopics.length})
                    </button>
                  )}
                </div>

                {availableTopics.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No topic tags found in imported file</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {availableTopics.map((topic) => {
                      const isChecked = selectedTopics.includes(topic);
                      return (
                        <label
                          key={topic}
                          className={`flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            isChecked ? 'bg-teal-50 text-teal-900 font-bold' : 'text-slate-700 hover:bg-slate-200/60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(selectedTopics, setSelectedTopics, topic)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] accent-[#0f8b8d]"
                          />
                          <span className="truncate">{topic}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Groups Filter */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Groups / Sub-categories ({availableGroups.length})
                  </span>
                  {selectedGroups.length > 0 && (
                    <button
                      onClick={() => setSelectedGroups([])}
                      className="text-[10px] text-teal-700 font-semibold hover:underline"
                    >
                      Clear ({selectedGroups.length})
                    </button>
                  )}
                </div>

                {availableGroups.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No group tags found in imported file</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {availableGroups.map((group) => {
                      const isChecked = selectedGroups.includes(group);
                      return (
                        <label
                          key={group}
                          className={`flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            isChecked ? 'bg-teal-50 text-teal-900 font-bold' : 'text-slate-700 hover:bg-slate-200/60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(selectedGroups, setSelectedGroups, group)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] accent-[#0f8b8d]"
                          />
                          <span className="truncate">{group}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Launch Settings & Execution Controls */}
            <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-50 to-teal-50/30 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-6">
              {/* Question Count & Execution Mode */}
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5 uppercase tracking-wider">
                    Question Count:
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[10, 25, 50, 100].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setQuestionCount(cnt)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          questionCount === cnt
                            ? 'bg-[#001432] text-white shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {cnt} Qs
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setQuestionCount(filteredQuestions.length || 10)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        questionCount === filteredQuestions.length && filteredQuestions.length > 0
                          ? 'bg-[#001432] text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      All ({filteredQuestions.length})
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5 uppercase tracking-wider">
                    Execution Mode:
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTestMode('TUTOR')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        testMode === 'TUTOR'
                          ? 'bg-[#0f8b8d] text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Tutor Mode (Immediate Feedback)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestMode('EXAM')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        testMode === 'EXAM'
                          ? 'bg-[#001432] text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Exam Mode (Strict Timed)
                    </button>
                  </div>
                </div>
              </div>

              {/* Launch Action Button */}
              <div className="text-right">
                <div className="text-xs font-mono text-slate-500 mb-1.5">
                  Available: <strong className="text-slate-800">{filteredQuestions.length}</strong> matching questions
                </div>
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={filteredQuestions.length === 0}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Launch Bank Practice ({Math.min(questionCount, filteredQuestions.length)} Qs)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
