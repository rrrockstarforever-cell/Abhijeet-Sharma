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
  const [selectedPapers, setSelectedPapers] = useState<string[]>([]);
  const [recentWindow, setRecentWindow] = useState<RecentWindow>('any');
  const [redFlagsOnly, setRedFlagsOnly] = useState<boolean>(false);
  const [unseenOnly, setUnseenOnly] = useState<boolean>(false);
  const [questionCount, setQuestionCount] = useState<number>(25);
  const [testMode, setTestMode] = useState<'EXAM' | 'TUTOR'>('TUTOR');

  // Paste recall text
  const [pasteBank, setPasteBank] = useState<BankId>('amc');
  const [pasteText, setPasteText] = useState<string>('');
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

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
  useEffect(() => {
    setSelectedSubjects(prev => prev.filter(s => availableSubjects.includes(s)));
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

        {/* Paste recall text (in addition to the JSON file import) */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-3.5 h-3.5 text-[#0f8b8d]" />
                Paste recall text
              </h4>
              <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
                Paste bank JSON (same schema as the file import) or plain recall blocks: stem, then{' '}
                <code className="font-mono">A.</code>/<code className="font-mono">B.</code> options and{' '}
                <code className="font-mono">Answer: B</code>, with optional{' '}
                <code className="font-mono">Paper:</code>, <code className="font-mono">Updated:</code> and{' '}
                <code className="font-mono">Red flag:</code> lines. Pasted questions are added to the selected bank;
                existing questions are kept and duplicates are skipped.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {(['emedici', 'success', 'amc'] as BankId[]).map(bankId => (
                <button
                  key={bankId}
                  type="button"
                  onClick={() => {
                    setPasteBank(bankId);
                    pasteTextareaRef.current?.focus();
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    pasteBank === bankId
                      ? 'bg-[#001432] text-white ring-1 ring-[#0f8b8d]'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title={`Add pasted text to ${BANK_CONFIGS[bankId].name}`}
                >
                  {BANK_CONFIGS[bankId].name}
                </button>
              ))}
            </div>
          </div>

          <textarea
            ref={pasteTextareaRef}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder={`Paste JSON: [{"question":"...","options":["...","..."],"answerIndex":0,"paper":"2024 March","updatedAt":"2026-10-20","redFlag":true}]\n\nOr paste recall blocks separated by a blank line:\nA 62-year-old man presents with crushing central chest pain.\nA. Aortic dissection\nB. Acute myocardial infarction\nC. Pericarditis\nAnswer: B\nPaper: 2024 March`}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 font-mono focus:outline-none focus:border-[#0f8b8d] focus:bg-white transition-all resize-y"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              Pasted questions are added to <strong className="text-slate-700">{BANK_CONFIGS[pasteBank].name}</strong>.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPasteText('')}
                disabled={!pasteText}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handlePasteImport}
                disabled={!pasteText.trim()}
                className="px-4 py-1.5 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                Import pasted text
              </button>
            </div>
          </div>
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

              {/* Start over: clears seen history for the active bank only */}
              {activeTab !== 'all' && (
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white border border-amber-200 text-amber-800 hover:bg-amber-50 text-xs font-bold transition-colors shrink-0"
                  title={`Clear seen history for ${BANK_CONFIGS[activeTab].name} only`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Start over (forget seen)
                </button>
              )}
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

            {/* Optional Filters: rendered only when the imported bank actually has the field */}
            {(availablePapers.length > 0 || hasUpdatedField || hasRedFlagField) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 4. Paper Filter */}
                {availablePapers.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
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
                              isChecked ? 'bg-teal-50 text-teal-900 font-bold' : 'text-slate-700 hover:bg-slate-200/60'
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
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
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
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
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
                      <span className="text-xs font-bold text-slate-700">Red-flagged only</span>
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
