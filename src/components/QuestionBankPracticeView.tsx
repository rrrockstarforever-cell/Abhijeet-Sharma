import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
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
import { GeneratedBanksPanel } from './GeneratedBanksPanel.tsx';
import { SavedModulesPanel } from './SavedModulesPanel.tsx';
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

export const BANK_CONFIGS: Omit<Record<BankId, { name: string; key: string; desc: string; defaultExam: ExamType }>, 'success'> = {
  emedici: {
    name: 'eMedici',
    key: 'bank:emedici',
    desc: 'Australian medical case & clinical scenario question bank',
    defaultExam: 'NEET_PG'
  }
};

export type ActiveBankTab = 'emedici' | 'all';

type BankQuestionWithMeta = BankQuestion & {
  paper?: string;
  updatedAt?: string;
  redFlag?: boolean;
  redFlags?: string[];
};

interface ExtraMeta {
  paper?: string;
  updatedAt?: string;
  redFlag?: boolean;
  redFlags?: string[];
}

interface PastedRecallParse {
  items: Array<Record<string, unknown>>;
  invalidBlocks: number;
}

type RecentWindow = 'any' | '7' | '30' | '90';

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeQuestionKey = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]/g, '');

const parseDateValue = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? undefined : fromNumber.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const fromString = new Date(value.trim());
    return Number.isNaN(fromString.getTime()) ? undefined : fromString.toISOString();
  }
  return undefined;
};

// Only fields that are actually present in the imported file are carried over.
const extractExtraMeta = (item: any): ExtraMeta => {
  const meta: ExtraMeta = {};
  if (!item || typeof item !== 'object') return meta;

  if (typeof item.paper === 'string' && item.paper.trim()) {
    meta.paper = item.paper.trim();
  } else if (typeof item.paper === 'number' && Number.isFinite(item.paper)) {
    meta.paper = String(item.paper);
  }

  const updatedAt = parseDateValue(
    item.updatedAt ?? item.updated ?? item.lastUpdated ?? item.lastUpdatedAt ?? item.modifiedAt
  );
  if (updatedAt) meta.updatedAt = updatedAt;

  if (typeof item.redFlag === 'boolean') {
    meta.redFlag = item.redFlag;
  } else if (typeof item.redFlag === 'string' && /^(true|yes|1|y)$/i.test(item.redFlag.trim())) {
    meta.redFlag = true;
  } else if (typeof item.redFlag === 'string' && /^(false|no|0|n)$/i.test(item.redFlag.trim())) {
    meta.redFlag = false;
  }

  if (Array.isArray(item.redFlags)) {
    const flags = item.redFlags
      .filter((flag: unknown): flag is string => typeof flag === 'string' && flag.trim() !== '')
      .map((flag: string) => flag.trim());
    meta.redFlags = flags;
    if (flags.length > 0) meta.redFlag = true;
  } else if (typeof item.redFlags === 'string' && item.redFlags.trim()) {
    meta.redFlags = [item.redFlags.trim()];
    meta.redFlag = true;
  }

  return meta;
};

const stripCodeFence = (text: string): string => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : trimmed;
};

const getRawQuestionList = (jsonText: string): any[] => {
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  } catch {
    // Not JSON; the caller may parse it as plain recall text instead.
  }
  return [];
};

const extractExtrasFromRawList = (rawList: any[]): Map<string, ExtraMeta> => {
  const extras = new Map<string, ExtraMeta>();
  rawList.forEach(item => {
    if (!item || typeof item.question !== 'string') return;
    const key = normalizeQuestionKey(item.question);
    if (!key) return;
    const meta = extractExtraMeta(item);
    if (Object.keys(meta).length > 0 && !extras.has(key)) extras.set(key, meta);
  });
  return extras;
};

// The shared validator only keeps its known fields, so re-attach paper/date/flag
// metadata from the original items by matching normalised question text.
const withExtraMeta = (questions: BankQuestion[], extras: Map<string, ExtraMeta>): BankQuestion[] =>
  questions.map(question => {
    const extra = extras.get(normalizeQuestionKey(question.question));
    return extra ? ({ ...question, ...extra } as BankQuestionWithMeta) : question;
  });

const getBankQuestionMeta = (question: BankQuestion): BankQuestionWithMeta =>
  question as BankQuestionWithMeta;

const OPTION_LINE = /^([A-Ha-h])[).:\-]\s*(.+)$/;
const ANSWER_LINE = /^(?:answer|correct answer|ans|key)\s*[:\-]\s*([A-Ha-h]|\d+)\b/i;
const PAPER_LINE = /^paper(?:\s*(?:name|code|title))?\s*[:\-]\s*(.+)$/i;
const UPDATED_LINE = /^(?:updated(?:\s*at)?|last updated|date)\s*[:\-]\s*(.+)$/i;
const RED_FLAG_LINE = /^red\s*flags?(?:\s*notes?)?\s*[:\-]\s*(.+)$/i;

// Plain recall blocks: stem lines, A./B./C. options, "Answer: B", and optional
// "Paper:", "Updated:" and "Red flag:" lines. Blank line separates questions.
const parseRecallText = (text: string): PastedRecallParse => {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(Boolean);

  const items: Array<Record<string, unknown>> = [];
  let invalidBlocks = 0;

  blocks.forEach(block => {
    const lines = block
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const stemLines: string[] = [];
    const options: string[] = [];
    let answerValue: string | undefined;
    let paper: string | undefined;
    let updatedAt: string | undefined;
    let redFlag: boolean | undefined;

    lines.forEach(line => {
      const answerMatch = line.match(ANSWER_LINE);
      if (answerMatch) {
        answerValue = answerMatch[1];
        return;
      }

      const paperMatch = line.match(PAPER_LINE);
      if (paperMatch) {
        paper = paperMatch[1].trim();
        return;
      }

      const updatedMatch = line.match(UPDATED_LINE);
      if (updatedMatch) {
        updatedAt = parseDateValue(updatedMatch[1]);
        return;
      }

      const redFlagMatch = line.match(RED_FLAG_LINE);
      if (redFlagMatch) {
        const value = redFlagMatch[1].trim();
        redFlag = !/^(no|false|0|n)$/i.test(value);
        return;
      }

      const optionMatch = line.match(OPTION_LINE);
      if (optionMatch) {
        const expectedIndex = options.length;
        const optionIndex = optionMatch[1].toUpperCase().charCodeAt(0) - 65;
        if (optionIndex === expectedIndex) {
          options.push(optionMatch[2].trim());
          return;
        }
      }

      if (options.length === 0) {
        stemLines.push(line);
      }
    });

    const stem = stemLines.join(' ').trim();
    let answerIndex = -1;
    if (answerValue) {
      if (/^\d+$/.test(answerValue)) {
        answerIndex = Number(answerValue) - 1;
      } else {
        answerIndex = answerValue.toUpperCase().charCodeAt(0) - 65;
      }
    }

    if (!stem || options.length < 2 || answerIndex < 0 || answerIndex >= options.length) {
      invalidBlocks++;
      return;
    }

    const item: Record<string, unknown> = {
      question: stem,
      options,
      answerIndex,
    };
    if (paper) item.paper = paper;
    if (updatedAt) item.updatedAt = updatedAt;
    if (redFlag !== undefined) item.redFlag = redFlag;
    items.push(item);
  });

  return { items, invalidBlocks };
};

interface QuestionBankPracticeViewProps {
  onNavigate: (view: AppView) => void;
  onLaunchTest: (questions: ClinicalQuestion[], mode: 'EXAM' | 'TUTOR', exam: ExamType) => void;
  /** Subjects to pre-select, for example a weak subject sent from the analytics remediation link. */
  initialSubjects?: string[];
}

export const QuestionBankPracticeView: React.FC<QuestionBankPracticeViewProps> = ({
  onNavigate,
  onLaunchTest,
  initialSubjects
}) => {
  const reduceMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<ActiveBankTab>('emedici');
  
  // Bank cache and metadata
  const [bankMetas, setBankMetas] = useState<Omit<Record<BankId, BankMetadata | null>, 'success'>>({
    emedici: null,
  });
  const [bankQuestions, setBankQuestions] = useState<Omit<Record<BankId, BankQuestion[]>, 'success'>>({
    emedici: [],
  });
  const [seenCounts, setSeenCounts] = useState<Omit<Record<BankId, number>, 'success'>>({
    emedici: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedPapers, setSelectedPapers] = useState<string[]>([]);
  const [recentWindow, setRecentWindow] = useState<RecentWindow>('any');
  const [redFlagsOnly, setRedFlagsOnly] = useState<boolean>(false);
  const [unseenOnly, setUnseenOnly] = useState<boolean>(false);
  const [questionCount, setQuestionCount] = useState<number>(25);
  const [testMode, setTestMode] = useState<'EXAM' | 'TUTOR'>('TUTOR');

  // Paste recall text
  const [pasteBank, setPasteBank] = useState<'emedici'>('emedici');
  const [pasteText, setPasteText] = useState<string>('');
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  // File input refs per bank
  const fileInputRefs = {
    emedici: useRef<HTMLInputElement>(null),
  };

  const refreshSeenCounts = () => {
    setSeenCounts({
      emedici: getSeenQuestionIds('emedici').length,
    });
  };

  const loadAllBanks = async () => {
    setIsLoading(true);
    try {
      const emediciMeta = await getBankMetaFromIDB('emedici');
      const emediciQs = await getBankFromIDB('emedici');

      setBankMetas({
        emedici: emediciMeta,
      });
      setBankQuestions({
        emedici: emediciQs,
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
      const extras = extractExtrasFromRawList(getRawQuestionList(text));
      await saveBankToIDB(bankId, withExtraMeta(result.valid, extras), result.skippedCount);
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

  // Clears seen history for the active bank only; other banks keep their history.
  const handleStartOver = () => {
    if (activeTab === 'all') return;
    const bankName = BANK_CONFIGS[activeTab].name;
    const confirmed = window.confirm(
 `Start over and forget every seen question in ${bankName}? Questions and the other banks' seen history are not affected.`
    );
    if (!confirmed) return;

    resetSeenQuestions(activeTab);
    refreshSeenCounts();
    setImportMessage({
      type: 'success',
      text: `Started over in ${bankName}: seen history cleared for this bank only. All ${bankMetas[activeTab]?.count || 0} questions can be drawn again.`
    });
  };

  const handlePasteImport = async () => {
    const pasted = stripCodeFence(pasteText);
    if (!pasted) return;

    const targetBank = pasteBank;

    try {
      // Accept either the same JSON schema as the file import or plain recall blocks.
      let rawItems = getRawQuestionList(pasted);
      let invalidBlocks = 0;
      let sourceLabel = 'JSON';

      if (rawItems.length === 0) {
        const parsedText = parseRecallText(pasted);
        rawItems = parsedText.items;
        invalidBlocks = parsedText.invalidBlocks;
        sourceLabel = 'recall text';
      }

      if (rawItems.length === 0) {
        throw new Error(
          invalidBlocks > 0
            ? `Could not read any questions from the pasted text (${invalidBlocks} block(s) were missing a stem, at least two A./B. options, or a valid Answer line).`
            : 'No questions found in pasted text. Paste bank JSON, or blocks with a stem, A./B./C. options and an "Answer: A" line.'
        );
      }

      const result = validateAndParseBankJSON(JSON.stringify({ questions: rawItems }), targetBank);
      if (result.valid.length === 0) {
        throw new Error(
 `No valid questions found in pasted ${sourceLabel} (${result.skippedCount} skipped for invalid format, duplicates or needs-review).`
        );
      }

      const extras = extractExtrasFromRawList(rawItems);
      const enriched = withExtraMeta(result.valid, extras);

      const existing = bankQuestions[targetBank] || [];
      const existingKeys = new Set(existing.map(q => normalizeQuestionKey(q.question)));
      const usedIds = new Set(existing.map(q => q.id));
      const additions: BankQuestion[] = [];

      enriched.forEach((question, index) => {
        const key = normalizeQuestionKey(question.question);
        if (existingKeys.has(key)) return;

        let id = question.id;
        if (!id || usedIds.has(id)) {
          id = `${targetBank}_paste_${Date.now()}_${index + 1}`;
          while (usedIds.has(id)) id = `${id}_x`;
        }
        usedIds.add(id);
        existingKeys.add(key);
        additions.push({ ...question, id });
      });

      if (additions.length === 0) {
        setImportMessage({
          type: 'error',
          text: `No new questions added to ${BANK_CONFIGS[targetBank].name}: all ${result.valid.length} pasted question(s) already exist in this bank.`
        });
        return;
      }

      await saveBankToIDB(
        targetBank,
        [...existing, ...additions],
        (bankMetas[targetBank]?.skippedCount || 0) + result.skippedCount
      );
      await loadAllBanks();
      setPasteText('');
      setImportMessage({
        type: 'success',
        text: `Added ${additions.length} question(s) to ${BANK_CONFIGS[targetBank].name} from pasted ${sourceLabel}${
          result.skippedCount ? ` (${result.skippedCount} skipped)` : ''
        }${invalidBlocks ? `; ${invalidBlocks} block(s) could not be read` : ''}.`
      });
    } catch (err: any) {
      setImportMessage({
        type: 'error',
        text: err?.message || 'Failed to import pasted recall text.'
      });
    }
  };

  // Determine current active questions pool
  const currentPool: BankQuestion[] = useMemo(() => {
    if (activeTab === 'all') {
      return [
        ...bankQuestions.emedici,
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

  // Paper / recent-update / red-flag filters only exist when the imported file has those fields.
  const availablePapers = useMemo(() => {
    const set = new Set<string>();
    currentPool.forEach(q => {
      const paper = getBankQuestionMeta(q).paper;
      if (paper) set.add(paper);
    });
    return Array.from(set).sort();
  }, [currentPool]);

  const hasUpdatedField = useMemo(
    () => currentPool.some(q => Boolean(getBankQuestionMeta(q).updatedAt)),
    [currentPool]
  );

  const hasRedFlagField = useMemo(
    () => currentPool.some(q => {
      const meta = getBankQuestionMeta(q);
      return typeof meta.redFlag === 'boolean' || Array.isArray(meta.redFlags);
    }),
    [currentPool]
  );

  const redFlagCount = useMemo(
    () => currentPool.filter(q => {
      const meta = getBankQuestionMeta(q);
      return meta.redFlag === true || (Array.isArray(meta.redFlags) && meta.redFlags.length > 0);
    }).length,
    [currentPool]
  );

  const recentCounts = useMemo(() => {
    const now = Date.now();
    const counts = { d7: 0, d30: 0, d90: 0 };
    currentPool.forEach(q => {
      const updatedAt = getBankQuestionMeta(q).updatedAt;
      if (!updatedAt) return;
      const age = now - new Date(updatedAt).getTime();
      if (Number.isNaN(age)) return;
      if (age <= 7 * DAY_MS) counts.d7++;
      if (age <= 30 * DAY_MS) counts.d30++;
      if (age <= 90 * DAY_MS) counts.d90++;
    });
    return counts;
  }, [currentPool]);

  // Reset selected filters when switching tabs if they don't exist in new pool
  // A subject requested from outside (weak-topic remediation) is applied once the bank lists it; until then it is held,
  // so this reset does not clear it while the banks are still loading.
  const pendingInitialSubjects = useRef<string[]>(initialSubjects ?? []);
  useEffect(() => {
    const ready = pendingInitialSubjects.current.filter(s => availableSubjects.includes(s));
    if (ready.length > 0) {
      pendingInitialSubjects.current = pendingInitialSubjects.current.filter(s => !ready.includes(s));
    }
    setSelectedSubjects(prev => [...new Set([...prev, ...ready])].filter(s => availableSubjects.includes(s)));
    setSelectedTopics(prev => prev.filter(t => availableTopics.includes(t)));
    setSelectedGroups(prev => prev.filter(g => availableGroups.includes(g)));
    setSelectedPapers(prev => prev.filter(p => availablePapers.includes(p)));
  }, [activeTab, availableSubjects, availableTopics, availableGroups, availablePapers]);

  useEffect(() => {
    if (!hasUpdatedField) setRecentWindow('any');
    if (!hasRedFlagField) setRedFlagsOnly(false);
  }, [activeTab, hasUpdatedField, hasRedFlagField]);

  // Seen questions for current tab
  const currentSeenSet = useMemo(() => {
    const set = new Set<string>();
    if (activeTab === 'all') {
      getSeenQuestionIds('emedici').forEach(id => set.add(id));
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

      // 5. Paper Filter
      if (selectedPapers.length > 0) {
        const paper = getBankQuestionMeta(q).paper;
        if (!paper || !selectedPapers.includes(paper)) {
          return false;
        }
      }

      // 6. Recent Updates Filter
      if (recentWindow !== 'any') {
        const updatedAt = getBankQuestionMeta(q).updatedAt;
        if (!updatedAt) {
          return false;
        }
        const age = Date.now() - new Date(updatedAt).getTime();
        if (Number.isNaN(age) || age > Number(recentWindow) * DAY_MS) {
          return false;
        }
      }

      // 7. Red Flags Filter
      if (redFlagsOnly) {
        const meta = getBankQuestionMeta(q);
        const isFlagged = meta.redFlag === true || (Array.isArray(meta.redFlags) && meta.redFlags.length > 0);
        if (!isFlagged) {
          return false;
        }
      }

      // 8. Unseen Only Filter
      if (unseenOnly) {
        if (currentSeenSet.has(q.id)) {
          return false;
        }
      }

      return true;
    });
  }, [
    currentPool,
    searchQuery,
    selectedSubjects,
    selectedTopics,
    selectedGroups,
    selectedPapers,
    recentWindow,
    redFlagsOnly,
    unseenOnly,
    currentSeenSet
  ]);

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

      const bankTitle = 'eMedici Question Bank';

      const defaultExam: ExamType = 'NEET_PG';

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

    const targetExam = activeTab !== 'all' ? BANK_CONFIGS[activeTab].defaultExam : 'NEET_PG';
    onLaunchTest(clinicalQuestions, testMode, targetExam);
  };

  const totalImportedCount =
    (bankMetas.emedici?.count || 0);

  const strippedPaste = useMemo(() => stripCodeFence(pasteText), [pasteText]);
  const pasteJsonItems = useMemo(() => getRawQuestionList(strippedPaste), [strippedPaste]);
  const pasteRecallPreview = useMemo(() => parseRecallText(strippedPaste), [strippedPaste]);
  const pastePreviewCount = pasteJsonItems.length || pasteRecallPreview.items.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <SavedModulesPanel onLaunchTest={onLaunchTest} />
      <GeneratedBanksPanel />

      {isLoading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs ">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-100" />
            <div className="space-y-2">
              <div className="h-3 w-40 rounded bg-slate-200" />
              <div className="h-2.5 w-64 rounded bg-slate-200" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-24 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3  ">
                <div className="h-3 w-24 rounded bg-slate-200" />
                <div className="mt-3 h-2 w-full rounded bg-slate-200" />
                <div className="mt-2 h-2 w-3/4 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bank HQ Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-teal-50 p-5 shadow-xs">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0f8b8d] to-transparent opacity-[0.08] [mask-image:linear-gradient(90deg,transparent,black_35%,black_65%,transparent)] dark:dark:opacity-[0.09]" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white text-teal-700 px-3 py-1 text-[11px] font-medium uppercase tracking-wider">
              <Database className="h-3.5 w-3.5" />
              Bank HQ
            </div>
            <h1 className=" text-3xl leading-none tracking-wide text-slate-900 sm:text-4xl">
              {BANK_CONFIGS.emedici.name} <span className="text-[#0f8b8d]">Question Bank</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              {BANK_CONFIGS.emedici.desc}. Source: IndexedDB (<code className="font-mono text-xs">bank:emedici</code>). Imported questions stay isolated from AI-generated modules.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-1.5">
                <Layers className="mr-1 inline h-3.5 w-3.5" /> Total: {totalImportedCount} Qs
              </span>
              <span className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-1.5">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Seen: {seenCounts.emedici || 0}
              </span>
              <span className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-1.5">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> Skipped: {bankMetas.emedici?.skippedCount || 0}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <button
              type="button"
              onClick={() => triggerImport('emedici')}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] text-white shadow-xs hover:bg-[#00696b] px-5 py-3 text-sm font-medium transition-transform active:scale-[0.98]"
            >
              <Upload className="h-4 w-4" /> Import JSON
            </button>
            <button
              type="button"
              onClick={() => pasteTextareaRef.current?.focus()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 px-5 py-3 text-sm font-medium transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <FileQuestion className="h-4 w-4" /> Paste Recall
            </button>
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
              Import status: {importMessage ? importMessage.type === 'success' ? 'last action saved' : 'needs attention' : 'ready'}
            </div>
          </div>
        </div>
      </div>

      {/* Import / Validation Callout */}
      {importMessage && (
        <div className={`flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm ${
          importMessage.type === 'success'
            ? 'border-teal-200 bg-teal-50 text-teal-900'
            : 'border-rose-200 bg-rose-50 text-rose-900'
        }`}>
          <div className="flex items-start gap-3">
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${
              importMessage.type === 'success'
                ? 'border-teal-200 bg-teal-100 text-teal-800'
                : 'border-rose-200 bg-rose-100 text-rose-800'
            }`}>
              {importMessage.type === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {importMessage.type === 'success' ? 'Import OK' : 'Needs Fix'}
            </span>
            <span className="max-w-4xl leading-relaxed">{importMessage.text}</span>
          </div>
          <button
            onClick={() => setImportMessage(null)}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 shadow-2xs hover:bg-slate-50 "
            aria-label="Dismiss import message"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bank HQ Storage & Import Panel */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-medium text-slate-900">
              <Database className="h-4 w-4" /> Import JSON / Validate Bank
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
              Secure client-side IndexedDB persistence (<code className="font-mono">bank:&lt;name&gt;</code>) with duplicate pruning and answer-index validation. File import runs through the existing validator before saving.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
              Accepts: JSON array or {'{ questions: [] }'}
            </span>
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
              Invalid items are reported after parsing
            </span>
          </div>
        </div>
        <details className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">Format hint & validation notes</summary>
          <p className="mt-2 leading-relaxed text-slate-600">
            Each question needs a stem, at least two options, and an answerIndex matching an option. Extra paper, updatedAt and redFlag/redFlags fields are preserved when present. The preview below mirrors the existing parse path and never writes until you save.
          </p>
        </details>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {(['emedici'] as const).map((bankId, index) => {
            const cfg = BANK_CONFIGS[bankId];
            const meta = bankMetas[bankId];
            const count = meta?.count || 0;
            const skipped = meta?.skippedCount || 0;
            const seen = seenCounts[bankId] || 0;
            const isImported = count > 0;

            return (
              <motion.div
                key={bankId}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: "easeOut", delay: reduceMotion ? 0 : Math.min(index * 0.03, 0.2) }}
                className={`flex flex-col justify-between space-y-3.5 rounded-xl border p-4 transition-all hover:-translate-y-0.5 ${
                  isImported
                    ? 'border-slate-200 bg-white shadow-2xs'
                    : 'border-dashed border-slate-300 bg-slate-50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-900">{cfg.name}</span>
                    <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
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
                        <span className="font-medium text-slate-800">{count} Qs</span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>Skipped:</span>
                        <span>{skipped} invalid/dupes</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Seen questions:</span>
                        <span className="font-medium text-slate-800">{seen} / {count}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                  {!isImported ? (
                    <button
                      type="button"
                      onClick={() => triggerImport(bankId)}
                      className="w-full py-2 px-3 rounded-lg border border-[#0f8b8d] bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-medium transition-all flex items-center justify-center gap-1.5 shadow-xs"
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
              </motion.div>
            );
          })}
        </div>

        {/* Paste Recall Inline Validation Panel */}
        <details open className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <summary className="flex cursor-pointer flex-col gap-2 text-sm font-medium text-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><Upload className="h-4 w-4" /> Paste Recall / JSON Preview</span>
            <span className="flex flex-wrap gap-2 text-[10px] font-medium">
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-700">
                Parsed: {pastePreviewCount}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${pasteRecallPreview.invalidBlocks > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-700'}`}>
                Invalid blocks: {pasteRecallPreview.invalidBlocks}
              </span>
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="max-w-3xl text-xs leading-relaxed text-slate-600">
              Paste bank JSON (same schema as file import) or plain recall blocks: stem, then <code className="font-mono">A.</code>/<code className="font-mono">B.</code> options and <code className="font-mono">Answer: B</code>, with optional <code className="font-mono">Paper:</code>, <code className="font-mono">Updated:</code> and <code className="font-mono">Red flag:</code> lines. Invalid blocks are counted before saving; no silent data loss.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {(['emedici'] as const).map(bankId => (
                <button
                  key={bankId}
                  type="button"
                  onClick={() => {
                    setPasteBank(bankId);
                    pasteTextareaRef.current?.focus();
                  }}
                  className={`min-h-[44px] rounded-lg border px-3 text-[11px] font-medium transition-all ${
                    pasteBank === bankId
                      ? 'bg-[#0f8b8d] border-[#0f8b8d] text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                  title={`Add pasted text to ${BANK_CONFIGS[bankId].name}`}
                >
                  {BANK_CONFIGS[bankId].name}
                </button>
              ))}
            </div>
            <textarea
              ref={pasteTextareaRef}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={`Paste JSON: [{"question":"...","options":["...","..."],"answerIndex":0,"paper":"2024 March","updatedAt":"2026-10-20","redFlag":true}]\n\nOr paste recall blocks separated by a blank line:\nA 62-year-old man presents with crushing central chest pain.\nA. Aortic dissection\nB. Acute myocardial infarction\nC. Pericarditis\nAnswer: B\nPaper: 2024 March`}
              className="w-full resize-y rounded-xl border border-slate-200 bg-white text-slate-800 px-3 py-2 font-mono text-xs  placeholder-[#5B5550]/70 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/30 focus:border-[#0f8b8d] dark:placeholder-[#B8B2AA]/60"
            />
            {pastePreviewCount > 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-700">
                <p className="font-medium text-slate-800">Sample preview</p>
                <p className="mt-1 line-clamp-2 text-slate-600">
                  {String((pasteJsonItems[0] as any)?.question || (pasteRecallPreview.items[0] as any)?.question || 'No readable question stem in the first block.')}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] text-slate-500">
                Adds to <strong className="font-semibold text-slate-700">{BANK_CONFIGS[pasteBank].name}</strong>. Existing questions are kept; duplicates are skipped.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPasteText('')}
                  disabled={!pasteText}
                  className="min-h-[44px] rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-xs font-semibold transition-all  disabled:cursor-not-allowed disabled:opacity-50   "
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handlePasteImport}
                  disabled={!pasteText.trim()}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#0f8b8d] bg-[#0f8b8d] text-white hover:bg-[#00696b] shadow-xs px-4 text-xs font-medium transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import pasted text
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* Active Bank Practice Set */}
      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-medium text-slate-900">
              <Filter className="h-4 w-4" /> Active Bank Practice Set
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Select bank source, refine by extracted fields, and launch timed exams or tutor sessions.
            </p>
          </div>
          <span className="rounded-xl border border-slate-200 bg-white text-slate-700 px-3 py-1.5 text-xs font-medium">
            Filtered: {filteredQuestions.length} Qs
          </span>
        </div>

        {/* Bank Tabs with Real Question Counts */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {[
            { id: 'emedici', label: 'eMedici', count: bankMetas.emedici?.count || 0 },
            { id: 'all', label: 'All Imported Banks', count: totalImportedCount },
          ].map((tab) => {
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveBankTab)}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all ${
                  isTabActive
                    ? 'bg-teal-50 border-teal-300 text-teal-900 font-semibold'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                  isTabActive
                    ? 'bg-white text-teal-900 border-teal-300'
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
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0f8b8d] to-transparent opacity-[0.08] [mask-image:linear-gradient(180deg,transparent,black_35%,black_65%,transparent)]" />
            <div className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 ">
              <Database className="h-7 w-7" />
            </div>
            <h4 className="relative z-10 mt-4 text-2xl tracking-wide text-slate-900">
              {activeTab === 'all' ? 'No Questions Imported Yet' : `${BANK_CONFIGS[activeTab].name} has no questions yet`}
            </h4>
            <p className="relative z-10 mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
              You have not added any questions to this bank yet. Import a .json file or paste recall text to start.
            </p>
            {activeTab !== 'all' ? (
              <button
                type="button"
                onClick={() => triggerImport(activeTab)}
                className="relative z-10 mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] text-white hover:bg-[#00696b] shadow-xs px-5 py-2.5 text-xs font-medium transition-transform active:scale-[0.98]"
              >
                <Upload className="h-4 w-4" />
                Import {BANK_CONFIGS[activeTab].name} (.json)
              </button>
            ) : (
              <div className="relative z-10 mt-5 flex justify-center gap-2">
                {(['emedici'] as const).map(bid => (
                  <button
                    key={bid}
                    type="button"
                    onClick={() => triggerImport(bid)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3.5 py-2 text-xs font-medium"
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
            {/* Sticky Search & Unseen Filter */}
            <div className="sticky top-2 z-20 -mx-1 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-xs backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search stems, signs, drugs, topics, or explanations..."
                    className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white text-slate-800 pl-9 pr-28 text-sm  placeholder-[#5B5550]/70 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/30 focus:border-[#0f8b8d] dark:placeholder-[#B8B2AA]/60"
                  />
                  <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                    <span className="rounded-full border border-slate-200 bg-slate-50 text-slate-600 px-2 py-0.5 text-[10px] font-medium">
                      {filteredQuestions.length}
                    </span>
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="min-h-[36px] rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-2 text-[10px] font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={unseenOnly}
                    onChange={(e) => setUnseenOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d] accent-[#0f8b8d]"
                  />
                  <span className="text-xs font-medium">Unseen only</span>
                  <span className="rounded border border-slate-200 bg-white text-slate-600 px-2 py-0.5 text-[10px] font-mono">
                    {currentPool.length - currentSeenSet.size}
                  </span>
                </label>

                {activeTab !== 'all' && (
                  <button
                    type="button"
                    onClick={handleStartOver}
                    className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-4 py-2 text-xs font-medium transition-colors   "
                    title={`Clear seen history for ${BANK_CONFIGS[activeTab].name} only`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset seen
                  </button>
                )}
              </div>
            </div>

            {/* Active Filter Chips */}
            {(searchQuery || selectedSubjects.length > 0 || selectedTopics.length > 0 || selectedGroups.length > 0 || selectedPapers.length > 0 || recentWindow !== 'any' || redFlagsOnly || unseenOnly) && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
                <span className="text-[10px] font-medium uppercase tracking-wider">Active filters:</span>
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Search: {searchQuery} ✕
                  </button>
                )}
                {selectedSubjects.map(item => (
                  <button key={`chip-sub-${item}`} onClick={() => toggleItem(selectedSubjects, setSelectedSubjects, item)} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Subject: {item} ✕
                  </button>
                ))}
                {selectedTopics.map(item => (
                  <button key={`chip-topic-${item}`} onClick={() => toggleItem(selectedTopics, setSelectedTopics, item)} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Topic: {item} ✕
                  </button>
                ))}
                {selectedGroups.map(item => (
                  <button key={`chip-group-${item}`} onClick={() => toggleItem(selectedGroups, setSelectedGroups, item)} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Group: {item} ✕
                  </button>
                ))}
                {selectedPapers.map(item => (
                  <button key={`chip-paper-${item}`} onClick={() => toggleItem(selectedPapers, setSelectedPapers, item)} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Paper: {item} ✕
                  </button>
                ))}
                {recentWindow !== 'any' && (
                  <button onClick={() => setRecentWindow('any')} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Updated: {recentWindow} days ✕
                  </button>
                )}
                {redFlagsOnly && (
                  <button onClick={() => setRedFlagsOnly(false)} className="min-h-[36px] rounded-full border border-rose-200 bg-rose-50 text-rose-700 px-3 text-[11px] font-medium ">
                    Red flags only ✕
                  </button>
                )}
                {unseenOnly && (
                  <button onClick={() => setUnseenOnly(false)} className="min-h-[36px] rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 text-[11px] font-medium  ">
                    Unseen only ✕
                  </button>
                )}
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedSubjects([]);
                    setSelectedTopics([]);
                    setSelectedGroups([]);
                    setSelectedPapers([]);
                    setRecentWindow('any');
                    setRedFlagsOnly(false);
                    setUnseenOnly(false);
                  }}
                  className="ml-auto min-h-[36px] rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 px-3 text-[11px] font-medium "
                >
                  Reset all
                </button>
              </div>
            )}

            {/* Dynamic Filters from Questions' Own Fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Subjects Filter */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-800 uppercase tracking-wider">
                    Subjects ({availableSubjects.length} available)
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

                {selectedSubjects.length > 0 && (
                  <p className="text-[11px] font-semibold text-slate-700" aria-live="polite">
                    Selected: {selectedSubjects.join(', ')}
                  </p>
                )}

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
                            isChecked ? 'bg-teal-50 text-teal-900 font-medium' : 'text-slate-700 hover:bg-slate-200/60'
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
                  <span className="text-xs font-medium text-slate-800 uppercase tracking-wider">
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
                            isChecked ? 'bg-teal-50 text-teal-900 font-medium' : 'text-slate-700 hover:bg-slate-200/60'
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
                  <span className="text-xs font-medium text-slate-800 uppercase tracking-wider">
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
                            isChecked ? 'bg-teal-50 text-teal-900 font-medium' : 'text-slate-700 hover:bg-slate-200/60'
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

            {/* Optional Filters: rendered only when the imported bank actually has the field */}
            {(availablePapers.length > 0 || hasUpdatedField || hasRedFlagField) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 4. Paper Filter */}
                {availablePapers.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-800 uppercase tracking-wider">
                        Papers ({availablePapers.length})
                      </span>
                      {selectedPapers.length > 0 && (
                        <button
                          onClick={() => setSelectedPapers([])}
                          className="text-[10px] text-teal-700 font-semibold hover:underline"
                        >
                          Clear ({selectedPapers.length})
                        </button>
                      )}
                    </div>

                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {availablePapers.map((paper) => {
                        const isChecked = selectedPapers.includes(paper);
                        return (
                          <label
                            key={paper}
                            className={`flex items-center gap-2 p-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                              isChecked ? 'bg-teal-50 text-teal-900 font-medium' : 'text-slate-700 hover:bg-slate-200/60'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleItem(selectedPapers, setSelectedPapers, paper)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] accent-[#0f8b8d]"
                            />
                            <span className="truncate">{paper}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 5. Recent Updates Filter */}
                {hasUpdatedField && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Recent updates
                      </span>
                      {recentWindow !== 'any' && (
                        <button
                          onClick={() => setRecentWindow('any')}
                          className="text-[10px] text-teal-700 font-semibold hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <select
                      value={recentWindow}
                      onChange={(e) => setRecentWindow(e.target.value as RecentWindow)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-[#0f8b8d]"
                    >
                      <option value="any">Any time ({currentPool.length})</option>
                      <option value="7">Last 7 days ({recentCounts.d7})</option>
                      <option value="30">Last 30 days ({recentCounts.d30})</option>
                      <option value="90">Last 90 days ({recentCounts.d90})</option>
                    </select>

                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Uses each question's own updated date from the imported file.
                    </p>
                  </div>
                )}

                {/* 6. Red Flags Filter */}
                {hasRedFlagField && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Red flags ({redFlagCount})
                      </span>
                      {redFlagsOnly && (
                        <button
                          onClick={() => setRedFlagsOnly(false)}
                          className="text-[10px] text-teal-700 font-semibold hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={redFlagsOnly}
                        onChange={(e) => setRedFlagsOnly(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-[#0f8b8d] accent-[#0f8b8d]"
                      />
                      <span className="text-xs font-medium text-slate-700">Red-flagged only</span>
                      <span className="ml-auto text-[10px] font-mono text-slate-500">
                        {redFlagCount} flagged
                      </span>
                    </label>

                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Shows questions whose imported red-flag field is set.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Launch Settings & Execution Controls */}
            <div className="sticky bottom-0 z-30 flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-md backdrop-blur md:flex-row md:items-center">
              {/* Question Count & Execution Mode */}
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-600">
                    Question Count:
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[10, 25, 50, 100].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setQuestionCount(cnt)}
                        className={`min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          questionCount === cnt
                            ? 'bg-[#0f8b8d] border-[#0f8b8d] text-white shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {cnt} Qs
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setQuestionCount(filteredQuestions.length || 10)}
                      className={`min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        questionCount === filteredQuestions.length && filteredQuestions.length > 0
                          ? 'bg-[#0f8b8d] border-[#0f8b8d] text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      All ({filteredQuestions.length})
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-600">
                    Execution Mode:
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTestMode('TUTOR')}
                      className={`min-h-[44px] rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-all ${
                        testMode === 'TUTOR'
                          ? 'bg-[#0f8b8d] border-[#0f8b8d] text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Tutor Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestMode('EXAM')}
                      className={`min-h-[44px] rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-all ${
                        testMode === 'EXAM'
                          ? 'bg-[#0f8b8d] border-[#0f8b8d] text-white shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Exam Mode
                    </button>
                  </div>
                </div>
              </div>

              {/* Launch Action Button */}
              <div className="text-left md:text-right">
                <div className="mb-1.5 text-xs font-mono text-slate-600">
                  Available: <strong className="text-slate-800">{filteredQuestions.length}</strong> matching questions
                </div>
                {filteredQuestions.length === 0 && (
                  <p role="status" aria-live="polite" className="mb-2 text-xs text-amber-700">
                    {(availableSubjects.length + availableTopics.length) === 0
                      ? 'This bank has no questions yet. Import a bank, then choose filters to start practicing.'
                      : 'No questions match these filters. Clear or change a filter to see more questions.'}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={filteredQuestions.length === 0}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] text-white hover:bg-[#00696b] shadow-md px-6 py-3 text-sm font-medium  transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
