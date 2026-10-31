import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Play,
  Clock,
  Check,
  Target,
  Brain,
  BookOpen,
  Sparkles,
  ShieldAlert,
  Square,
  MessageSquarePlus,
  ChevronsUpDown,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react';
import { ExamType, AppView, DifficultyTier, DifficultySubLevel, INISyllabusMode, ClinicalQuestion } from '../types.ts';
import GenerationProgress from './GenerationProgress';
import {
  NEET_PG_SUBJECTS,
  INI_CET_DOMAINS_6,
  AMC_CAT_DOMAINS_6
} from '../data/mockClinicalData.ts';
import { SUBTOPICS } from '../data/subtopics.ts';
import { generateExamQuestions, AiError, NOT_CONNECTED_MESSAGE, getActiveProvider, getEffectiveModel, aiComplete } from '../lib/ai.ts';
import { generateImageFirstQuestion, type BankImage } from '../lib/imageFirst.ts';
import { summarizeAttempts, attemptsToday, listAttempts } from '../utils/attemptStore.ts';
import { listUserHighlights } from '../utils/userHighlightsStore.ts';
import { debugLog } from '../utils/debugLog.ts';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfile,
  getActiveProfileId,
  setActiveProfileId,
  getDraft,
  setDraft as persistDraft,
  type InstructionProfile,
} from '../utils/instructionProfiles.ts';
import {
  createBatch,
  saveGeneratedQuestion,
  type GenerationBatch,
  updateQuestionStatus,
} from '../utils/questionBankStorage.ts';
import { TopicPickerModal } from './TopicPickerModal.tsx';
import { reviewBatch, refineBatch, recordReviewBatch } from '../lib/qaClient.ts';

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
    generatedQuestions?: ClinicalQuestion[]
  ) => void;
  onNavigate: (view: AppView) => void;
  /** Keeps the app-wide exam chip in step with the builder (they used to drift apart). */
  onExamChange?: (exam: ExamType) => void;
}

// ---- writing options offered as Tags ----
const QUESTION_TYPE_CHIPS = [
  'Clinical vignette',
  'One-liner recall',
  'Match the following',
  'Multiple statements ("1 and 3 only")',
  'ECG / X-ray interpretation',
  'Identify the structure',
];
const STEM_PATTERN_CHIPS = [
  'Most likely diagnosis',
  'Next best step',
  'Drug of choice',
  'Investigation of choice',
  'Treatment of choice',
  'Most appropriate advice',
];
const EVIDENCE_SOURCE_CHIPS = [
  'Australian eTG',
  'RACGP Red Book',
  'National Immunisation Program (NIP)',
  'Good Medical Practice (Ahpra/Medical Board)',
];
const PATIENT_GROUP_CHIPS = [
  "Women's health",
  "Men's health",
  'Children & adolescents',
  'Older adults',
  'Aboriginal & Torres Strait Islander health',
  'Culturally & linguistically diverse patients',
  'Mental health presentations',
];
const PRESENTING_PROBLEM_CHIPS = [
  'Chest pain', 'Dyspnoea', 'Fever', 'Abdominal pain', 'Headache', 'Dizziness/vertigo',
  'Cough', 'Fatigue', 'Back pain', 'Joint pain', 'Palpitations', 'Weight loss',
  'Anaemia', 'Jaundice', 'Confusion', 'Syncope', 'Dysuria', 'Rash', 'Sleep problems', 'Low mood',
];

const EXAM_SCORING: Record<ExamType, string> = {
  NEET_PG: '+4 / -1',
  INI_CET: '+1 / -0.33',
  AMC_CAT: 'Adaptive 0-500',
};

const EXAM_LABEL: Record<ExamType, string> = {
  NEET_PG: 'NEET-PG',
  INI_CET: 'INI-CET',
  AMC_CAT: 'AMC CAT',
};

const QUESTION_COUNTS = [10, 20, 25, 30, 40, 50, 75, 100];

// ---------------------------------------------------------------- small pieces

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode; last?: boolean }> = ({
  label, hint, children, last,
}) => (
  <div className={`py-5 ${last ? '' : 'border-b border-slate-100'}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
      <h3 className="text-sm font-bold text-slate-900">{label}</h3>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
    {children}
  </div>
);

const Radio: React.FC<{
  checked: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}> = ({ checked, onClick, label, hint }) => (
  <button type="button" onClick={onClick} className="flex items-start gap-2 text-left cursor-pointer">
    <span
      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
        checked ? 'border-[#0f8b8d]' : 'border-slate-300'
      }`}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-[#0f8b8d]" />}
    </span>
    <span>
      <span className={`block text-xs font-semibold ${checked ? 'text-slate-900' : 'text-slate-700'}`}>{label}</span>
      {hint && <span className="block text-[10px] text-slate-500 leading-snug mt-0.5 max-w-[230px]">{hint}</span>}
    </span>
  </button>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({
  active, onClick, children, title,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors ${
      active
        ? 'bg-[#0f8b8d] border-[#0f8b8d] text-white'
        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    }`}
  >
    {children}
  </button>
);

const SubjectTick: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
      checked ? 'bg-[#0f8b8d] border-[#0f8b8d]' : 'bg-white border-slate-300'
    }`}
  >
    {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
  </span>
);

// ---------------------------------------------------------------- main view

export const PracticeModuleBuilderView: React.FC<PracticeModuleBuilderViewProps> = ({
  currentExam,
  onLaunchModule,
  onNavigate,
  onExamChange,
}) => {
  const [selectedExam, setSelectedExam] = useState<ExamType>(currentExam);
  // The builder used to keep its own exam forever: switching the exam chip in the top bar
  // left this screen on the old exam, so an INI-CET run could be built from AMC domains.
  useEffect(() => { setSelectedExam(currentExam); }, [currentExam]);

  const [iniSyllabusMode, setIniSyllabusMode] = useState<INISyllabusMode>('19_SUBJECTS');
  const [questionCount, setQuestionCount] = useState<number>(25);
  const [mode, setMode] = useState<'EXAM' | 'TUTOR'>('TUTOR');
  const [progressStep, setProgressStep] = useState<'idle' | 'generating' | 'refining' | 'qa' | 'saved' | 'integrity' | 'done'>('idle');
  // What the finished steps actually did, shown on the progress bar ("Refining · 9 rewritten").
  const [progressDetail, setProgressDetail] = useState<{ refining: string | null; saved: string | null; qa: string | null; imageFirst: string | null }>({
    refining: null, saved: null, qa: null, imageFirst: null,
  });

  const [difficultyTier, setDifficultyTier] = useState<DifficultyTier>('ALL');
  const [difficultySubLevel, setDifficultySubLevel] = useState<DifficultySubLevel | undefined>(undefined);

  // NOTHING is pre-selected: the learner picks specialities (or chooses "All").
  const [specialtyAll, setSpecialtyAll] = useState(false);
  const [selectedNeetSubjects, setSelectedNeetSubjects] = useState<string[]>([]);
  const [selectedIniSubjects, setSelectedIniSubjects] = useState<string[]>([]);
  const [selectedIniDomains, setSelectedIniDomains] = useState<string[]>([]);
  const [selectedAmcDomains, setSelectedAmcDomains] = useState<string[]>([]);

  // Absent entry = every topic of that subject; only an explicit subset is stored.
  const [selectedSubtopics, setSelectedSubtopics] = useState<Record<string, string[]>>({});
  const [topicModal, setTopicModal] = useState<{ key: string; label: string } | null>(null);

  // AI question generation state (real AI provider; progressive batches of <=10)
  const [genState, setGenState] = useState<{
    busy: boolean;
    generated: number;
    total: number;
    batch: number;
    totalBatches: number;
    dropped: number;
    error: string | null;
  }>({ busy: false, generated: 0, total: 0, batch: 0, totalBatches: 0, dropped: 0, error: null });
  const stopEarlyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Refinement → bank save → QA run after generation. Stop aborts this too.
  const processingRef = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const [partial, setPartial] = useState<ClinicalQuestion[] | null>(null);
  // Why a run ended short (provider error after retries) — shown with the kept questions.
  const [partialReason, setPartialReason] = useState<string | null>(null);
  // "Batch 7 of 10 · retrying (1/2) · <why>"
  const [retrying, setRetrying] = useState<string | null>(null);
  // Seconds spent on the current run, so a slow first batch does not look like a hang.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!genState.busy) { setElapsedSec(0); return; }
    const startedAt = Date.now();
    setElapsedSec(0);
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [genState.busy]);
  // Questions kept from an earlier run that a Continue call appends to.
  const appendBaseRef = useRef<ClinicalQuestion[] | null>(null);

  // Saved AI-instruction profiles. The draft is persisted too, so a reload never loses the
  // text; an applied profile stays wired to the next generation until it is cleared.
  const [profiles, setProfiles] = useState<InstructionProfile[]>(() => listProfiles());
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(() => getActiveProfileId());
  const [profileDraft, setProfileDraft] = useState<string>(() => getDraft());
  const [appliedProfile, setAppliedProfile] = useState<string | null>(() => getProfile(getActiveProfileId())?.text ?? null);
  const [profileName, setProfileName] = useState<string>(() => getProfile(getActiveProfileId())?.name ?? '');
  const [showSaveRow, setShowSaveRow] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  // Live connection state for the active engine. A stored provider id survives sign-out,
  // so the builder must not promise to generate with an engine the server cannot reach.
  const [providerOk, setProviderOk] = useState<Record<string, boolean> | null>(null);
  const refreshProviderStatus = () => {
    fetch('/api/oauth/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.providers) return;
        const next: Record<string, boolean> = {};
        for (const [id, value] of Object.entries(data.providers as Record<string, { connected?: boolean }>)) {
          next[id] = Boolean(value?.connected);
        }
        setProviderOk(next);
      })
      .catch(() => { /* leave unknown: the server will explain any failure */ });
  };
  useEffect(() => {
    refreshProviderStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProvider = getActiveProvider();
  const providerKnownDown = Boolean(activeProvider && providerOk && providerOk[activeProvider] === false);

  // The draft survives a reload even if it was never saved as a named profile.
  useEffect(() => {
    persistDraft(profileDraft);
  }, [profileDraft]);

  const [questionTypes, setQuestionTypes] = useState<string[]>([]);
  const [stemPatterns, setStemPatterns] = useState<string[]>([]);
  /** Attach verified library pictures to the ~1-in-5 image-based items. */
  const [includeImages, setIncludeImages] = useState<boolean>(true);
  const [evidenceSources, setEvidenceSources] = useState<string[]>([]);
  const [patientGroup, setPatientGroup] = useState<string>('');
  const [presentingProblems, setPresentingProblems] = useState<string[]>([]);
  const [showAmcOptions, setShowAmcOptions] = useState(false);

  const [sourceMode, setSourceMode] = useState<'AI' | 'MY_NOTES'>('AI');

  useEffect(() => () => { abortRef.current?.abort(); }, []);
  // Keep the progress step visible through refinement/QA after generation finishes;
  // it is only reset when a new run begins (setProgressStep('generating')) or on error.

  const toggleFromList = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  // ------------------------------------------------------------ subject model

  type SubjectRow = { key: string; label: string; meta: string; topics: string[]; desc?: string; highYield?: boolean };

  const subjectList: SubjectRow[] = useMemo(() => {
    const topical = (key: string, label: string) => SUBTOPICS[key] ?? SUBTOPICS[label] ?? [];
    if (selectedExam === 'NEET_PG') {
      return NEET_PG_SUBJECTS.map((s) => ({
        key: s.name, label: s.name, meta: s.weightage, topics: topical(s.name, s.name), highYield: s.highYield,
      }));
    }
    if (selectedExam === 'INI_CET') {
      if (iniSyllabusMode === '19_SUBJECTS') {
        return NEET_PG_SUBJECTS.map((s) => ({
          key: s.name, label: s.name, meta: s.weightage, topics: topical(s.name, s.name), highYield: s.highYield,
        }));
      }
      return INI_CET_DOMAINS_6.map((d) => ({
        key: d.id, label: d.name, meta: d.weightage, topics: topical(d.id, d.name), desc: d.desc,
      }));
    }
    return AMC_CAT_DOMAINS_6.map((d) => ({
      key: d.id,
      label: d.name,
      meta: `${d.officialWeight} · ${d.questionRatio}`,
      topics: topical(d.id, d.name),
      desc: d.desc,
      highYield: d.highYield,
    }));
  }, [selectedExam, iniSyllabusMode]);

  const chosenKeys: string[] = selectedExam === 'NEET_PG'
    ? selectedNeetSubjects
    : selectedExam === 'INI_CET'
      ? (iniSyllabusMode === '19_SUBJECTS' ? selectedIniSubjects : selectedIniDomains)
      : selectedAmcDomains;

  const setChosenKeys = (updater: (prev: string[]) => string[]) => {
    if (selectedExam === 'NEET_PG') setSelectedNeetSubjects(updater);
    else if (selectedExam === 'INI_CET') {
      if (iniSyllabusMode === '19_SUBJECTS') setSelectedIniSubjects(updater);
      else setSelectedIniDomains(updater);
    } else setSelectedAmcDomains(updater);
  };

  const effectiveKeys = specialtyAll ? subjectList.map((s) => s.key) : chosenKeys;
  const isSubjectOn = (key: string) => effectiveKeys.includes(key);

  const toggleSubject = (key: string) => {
    setGenState((st) => ({ ...st, error: null }));
    // Ticking one subject while "All" is on turns the blanket choice into a real list.
    if (specialtyAll) {
      setSpecialtyAll(false);
      setChosenKeys(() => [key]);
      return;
    }
    setChosenKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    setSelectedSubtopics((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const chosenTopicsFor = (row: SubjectRow) => selectedSubtopics[row.key] ?? row.topics;

  const totalChosenSubtopicsCount = subjectList
    .filter((row) => isSubjectOn(row.key))
    .reduce((sum, row) => sum + chosenTopicsFor(row).length, 0);

  const applyTopics = (topics: string[], kind: 'ALL' | 'CHOOSE') => {
    if (!topicModal) return;
    const key = topicModal.key;
    setSelectedSubtopics((prev) => {
      const next = { ...prev };
      if (kind === 'ALL') delete next[key];
      else next[key] = topics;
      return next;
    });
    if (kind === 'CHOOSE' && topics.length === 0) {
      if (!specialtyAll) setChosenKeys((prev) => prev.filter((k) => k !== key));
    } else if (specialtyAll) {
      setSpecialtyAll(false);
      setChosenKeys(() => [key]);
    } else {
      setChosenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }
    setTopicModal(null);
    setGenState((st) => ({ ...st, error: null }));
  };

  // ------------------------------------------------------------ generation

  /** Labels (not ids) go to the AI and into the module record, so prompts read "Adult Health - Medicine". */
  const labelsFor = (keys: string[]) =>
    keys.map((k) => subjectList.find((r) => r.key === k)?.label ?? k);

  const resolveSubjects = () => effectiveKeys;

  const topicsForKeys = (keys: string[]): string[] => {
    const chosen: string[] = [];
    keys.forEach((key) => {
      const row = subjectList.find((r) => r.key === key);
      const list = selectedSubtopics[key] ?? (row ? row.topics : SUBTOPICS[key] ?? []);
      chosen.push(...list);
    });
    return chosen;
  };

  const handleLaunch = async (countOverride?: number) => {
    if (genState.busy) return;
    const targetCount = Math.max(1, Math.min(100, Math.round(countOverride ?? questionCount)));

    const keys = resolveSubjects();
    if (keys.length === 0) {
      setGenState({
        busy: false, generated: 0, total: 0, batch: 0, totalBatches: 0, dropped: 0,
        error: 'Pick at least one speciality (or choose All) before building a module.',
      });
      return;
    }
    const labels = labelsFor(keys);
    const chosenSubtopics = topicsForKeys(keys);

    if (!getActiveProvider()) {
      setGenState({ busy: false, generated: 0, total: 0, batch: 0, totalBatches: 0, dropped: 0, error: `No AI provider is active. ${NOT_CONNECTED_MESSAGE}` });
      return;
    }

    // "My notes" only works when real notes exist — never invent source material.
    let sourceMaterial: string | undefined;
    if (sourceMode === 'MY_NOTES') {
      const highlights = listUserHighlights();
      if (!highlights.length) {
        setGenState({
          busy: false, generated: 0, total: 0, batch: 0, totalBatches: 0, dropped: 0,
          error: 'No saved notes yet. Save a highlight or an AI note first, or switch the source to AI-generated questions.',
        });
        return;
      }
      sourceMaterial = highlights
        .slice(0, 60)
        .map((h, i) => `[${i + 1}] ${h.subject} — ${h.subtopic}\n${h.quote}${h.memoryAnchor || h.note ? `\nKey point: ${h.memoryAnchor || h.note}` : ''}`)
        .join('\n\n')
        .slice(0, 12000);
    }

    setGenState({ busy: true, generated: 0, total: targetCount, batch: 0, totalBatches: Math.ceil(targetCount / 10), dropped: 0, error: null });
    setProgressStep('generating');
    setProgressDetail({ refining: null, saved: null, qa: null, imageFirst: null });
    stopEarlyRef.current = false;
    setStopping(false);
    setRetrying(null);
    setPartialReason(null);
    processingRef.current = new AbortController();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // ---------------------------------------------------------------- post-processing
      // As soon as each batch is produced, refine → save to bank → QA it, while the
      // remaining batches keep generating. Every per-batch job is tracked in
      // batchPromises so we can await them all before opening the test runner.
      const postSignal = processingRef.current!.signal;
      const batchPromises: Promise<void>[] = [];
      const onBatch = (batchQuestions: ClinicalQuestion[]): Promise<void> => {
        const run = async () => {
          if (postSignal.aborted) return;

          // 1. Refine — remove answer leakage, obvious hints and telegraphed options.
          setProgressStep('refining');
          let finalQuestions: ClinicalQuestion[] = batchQuestions;
          try {
            const refined = await refineBatch(batchQuestions);
            if (Array.isArray(refined) && refined.length === batchQuestions.length) {
              finalQuestions = refined;
              for (let i = 0; i < batchQuestions.length; i++) {
                Object.assign(batchQuestions[i], refined[i]);
              }
            }
          } catch (e: any) {
            debugLog('H9', `refine FAILED: ${e?.message || e}`);
          }
          const rewritten = finalQuestions.filter((q: any) => q?.refined).length;
          setProgressDetail((d) => ({ ...d, refining: `${rewritten}/${finalQuestions.length} rewritten` }));

          if (postSignal.aborted) return;

          // 2. Save to the Question Bank with full metadata and an audit entry.
          setProgressStep('saved');
          const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
          const batch: GenerationBatch = {
            id: batchId,
            examType: selectedExam,
            bankId: selectedExam === 'AMC_CAT' ? 'amc_general' : selectedExam === 'NEET_PG' ? 'neet_medicine' : 'ini_integrated',
            requestedCount: batchQuestions.length,
            createdCount: 0,
            failedCount: 0,
            status: 'completed',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            idempotencyKey: batchId,
          };
          let stored = 0;
          try {
            await createBatch(batch);
            for (let i = 0; i < finalQuestions.length; i++) {
              if (postSignal.aborted) break;
              await saveGeneratedQuestion(finalQuestions[i], {
                examType: selectedExam,
                bankId: batch.bankId,
                batchId,
                index: i,
                generationModel: getActiveProvider() ?? undefined,
              });
              stored += 1;
            }
            await createBatch({ ...batch, createdCount: finalQuestions.length, status: 'completed' });
          } catch (e: any) {
            debugLog('H9', `save FAILED: ${e?.message || e}`);
          }
          setProgressDetail((d) => ({ ...d, saved: `${stored} stored` }));

          if (postSignal.aborted) return;

          // 3. QA review so questions carry a status in the bank right away.
          setProgressStep('qa');
          try {
            const reviews = await reviewBatch(finalQuestions);
            recordReviewBatch(finalQuestions, reviews);
            for (const q of finalQuestions) {
              const review = reviews.find((r: any) => r.questionId === q.id);
              if (review) await updateQuestionStatus(q.id, review.status);
            }
            const approved = reviews.filter((r: any) => r?.status === 'APPROVED').length;
            debugLog('H9', `qa reviews=${reviews.length} approved=${approved}/${finalQuestions.length}`);
            setProgressDetail((d) => ({ ...d, qa: `${approved}/${finalQuestions.length} approved` }));
          } catch (e: any) {
            debugLog('H9', `qa FAILED: ${e?.message || e}`);
            setProgressDetail((d) => ({ ...d, qa: 'unavailable' }));
          }
        };
        return run();
      };

      const { questions, dropped, stopped, failure } = await generateExamQuestions({
        exam: selectedExam,
        count: targetCount,
        subjectSubtopics: keys.map((key, i) => ({
          subject: labels[i],
          subtopics: selectedSubtopics[key] ?? (subjectList.find((r) => r.key === key)?.topics ?? SUBTOPICS[key] ?? []),
        })),
        difficultyTier,
        difficultySubLevel,
        onProgress: (generated, total, batch, totalBatches) => {
          setRetrying(null);
          setGenState(st => ({ ...st, generated, batch, totalBatches }));
        },
        onBatch,
        batchPromises,
        shouldStop: () => stopEarlyRef.current,
        signal: controller.signal,
        onRetry: (attempt, maxAttempts, reason) =>
          setRetrying(`retrying ${attempt}/${maxAttempts} · ${reason}`),
        customInstructions: appliedProfile ?? undefined,
        includeImages,
        questionTypes,
        stemPatterns,
        evidenceSources: selectedExam === 'AMC_CAT' ? evidenceSources : undefined,
        patientGroup: selectedExam === 'AMC_CAT' && patientGroup ? patientGroup : undefined,
        presentingProblems: selectedExam === 'AMC_CAT' ? presentingProblems : undefined,
        sourceMaterial,
      });

      // ---- Image-first pass -------------------------------------------------
      // When images are enabled, upgrade a slice of the set to genuine image-based
      // items: pick a curated bank image, write the question FROM it (vision), then
      // VERIFY it. Anything that fails is simply dropped here and the text-only
      // questions from above remain — the ratio of image to text items is therefore
      // honest, and an unrelated picture can never be attached.
      let imageQuestions: ClinicalQuestion[] = [];
      if (includeImages && selectedExam) {
        try {
          const perSubject = Math.max(1, Math.round(targetCount / 5));
          const wantImages = Math.min(perSubject, 6); // cap vision cost per run
          const subjects = ['Radiology', 'Dermatology', 'Ophthalmology', 'Pathology', 'Cardiology', 'Orthopaedics'];
          const optionCount = selectedExam === 'AMC_CAT' ? 5 : 4;
          setProgressDetail((d) => ({ ...d, imageFirst: 'choosing bank images…' }));

          // Each image-first question costs one slow vision call (~30–75s on the
          // reasoning model), so running them one at a time made image generation the
          // dominant wait. Instead we gather candidates up front and run several
          // DIFFERENT images concurrently — same total work, far less wall-clock.
          // (Retrying the same image would not help: a token exhaustion is a reply
          // that was cut short, and image_mismatch is a stable verdict.)
          const candidateLists = await Promise.all(
            subjects.map(async (subject) => {
              const res = await fetch(`/api/images/bank/entries?subject=${encodeURIComponent(subject)}&limit=2`);
              const body: any = await res.json().catch(() => ({}));
              return Array.isArray(body?.results) ? (body.results as BankImage[]) : [];
            }),
          );
          // Interleave subjects so a run covers a spread of modalities, then take the
          // first `wantImages` unique candidates. Dedupe by TOPIC as well as id: the bank
          // holds two images per diagnosis, so an id-only check would spend two of the
          // (slow, expensive) vision calls on the very same condition.
          const candidates: BankImage[] = [];
          const seenIds = new Set<string>();
          const seenTopics = new Set<string>();
          for (let col = 0; col < 2 && candidates.length < wantImages; col++) {
            for (const list of candidateLists) {
              const image = list[col];
              if (!image || seenIds.has(image.image_id)) continue;
              const topic = (image.ground_truth || '').trim().toLowerCase();
              if (topic && seenTopics.has(topic)) continue;
              seenIds.add(image.image_id);
              if (topic) seenTopics.add(topic);
              candidates.push(image);
              if (candidates.length >= wantImages) break;
            }
          }

          const CONCURRENCY = 3; // NVIDIA tolerates a few concurrent vision calls
          let done = 0;
          let cursor = 0;
          const results: (ClinicalQuestion | null)[] = new Array(candidates.length).fill(null);
          const worker = async () => {
            while (!stopEarlyRef.current) {
              const i = cursor++;
              if (i >= candidates.length) return;
              const image = candidates[i];
              setProgressDetail((d) => ({ ...d, imageFirst: `${done}/${candidates.length} — ${image.ground_truth}` }));
              try {
                const made = await generateImageFirstQuestion({
                  image,
                  exam: selectedExam,
                  difficultyTier,
                  difficultySubLevel,
                  optionCount,
                  signal: controller.signal,
                });
                results[i] = made ? made.question : null;
              } catch (e: any) {
                // A provider error on one image must not sink the others or the run.
                debugLog('H10', `image-first failed for ${image.image_id}: ${e?.message || e}`);
              } finally {
                done += 1;
                setProgressDetail((d) => ({ ...d, imageFirst: `${done}/${candidates.length} images done` }));
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
          imageQuestions = results.filter((q): q is ClinicalQuestion => q !== null);
          setProgressDetail((d) => ({ ...d, imageFirst: `${imageQuestions.length} image question(s), ${candidates.length - imageQuestions.length} fell back` }));
        } catch (e: any) {
          debugLog('H10', `image-first pass skipped: ${e?.message || e}`);
        }
      }

      // A Continue call appends to the questions kept from the previous run.
      const base = appendBaseRef.current;
      appendBaseRef.current = null;
      // Image-first items lead the batch so they are easy to review, then the
      // text-only questions fill the rest of the requested count.
      const combined = [...imageQuestions, ...questions];
      const merged = base ? [...base, ...combined] : combined;

      if (questions.length === 0) {
        const wasStopped = stopEarlyRef.current;
        setGenState({
          busy: false,
          generated: base ? base.length : 0,
          total: targetCount,
          batch: 0,
          totalBatches: 0,
          dropped,
          error: wasStopped
            ? 'Generation stopped before the first batch returned a valid question. Try again or reduce the count.'
            : failure
              ? `The provider failed on every attempt: ${failure}. Nothing new was kept — try again, lower the question count, or switch provider in Settings.`
              : `The AI provider returned 0 valid questions (${dropped} dropped by validation). Try again, reduce the count, or change the active provider in Settings.`,
        });
        if (base && base.length) { setPartial(base); setPartialReason(failure); }
        return;
      }

      setGenState({
        busy: false,
        generated: merged.length,
        total: targetCount,
        batch: Math.ceil(merged.length / 10),
        totalBatches: Math.ceil(targetCount / 10),
        dropped,
        error: null,
      });

      // Wait for every batch's refine → save → QA pass to land before opening the
      // runner, so the questions being solved are the refined, bank-stored ones.
      try { await Promise.all(batchPromises); } catch { /* advisory */ }
      setProgressStep('done');

      // Stopped, or the provider gave up mid-run: keep what is valid and say why.
      if (stopped || failure) {
        setPartial(merged);
        setPartialReason(failure);
        return;
      }

      launchWith(merged, labels, chosenSubtopics);
    } catch (err: any) {
      const aborted = controller.signal.aborted || (err instanceof AiError && err.kind === 'aborted');
      const message = aborted
        ? 'Generation stopped.'
        : err instanceof AiError ? err.message : (err?.message || 'AI question generation failed.');
      setGenState({ busy: false, generated: 0, total: targetCount, batch: 0, totalBatches: 0, dropped: 0, error: aborted ? null : message });
      // A 401 usually means the engine was signed out: refresh the banner immediately.
      if (!aborted && err instanceof AiError && err.kind === 'not_connected') refreshProviderStatus();
    } finally {
      abortRef.current = null;
      setStopping(false);
    }
  };

  const launchWith = (questions: ClinicalQuestion[], subjects: string[], chosenSubtopics: string[]) => {
    onLaunchModule(
      selectedExam,
      questions.length,
      mode,
      subjects,
      difficultyTier,
      difficultySubLevel,
      chosenSubtopics,
      questions
    );
    // Refinement → bank save → QA all run in the caller's background pipeline, so a launched
    // module must not start a second (unrefined) QA pass here.
  };

  const handleStop = () => {
    // Stop works for both phases: AI writing, and the refinement/save/QA that runs after it.
    const writing = genState.busy;
    const processing = !genState.busy && progressStep !== 'idle' && progressStep !== 'done';
    if (stopping || (!writing && !processing)) return;
    if (writing) {
      stopEarlyRef.current = true;
      abortRef.current?.abort();
    }
    if (processing) processingRef.current?.abort();
    setStopping(true);
    setGenState(st => ({ ...st, error: null }));
    // Release the stop button; the background pipeline checks its abort signal.
    window.setTimeout(() => setStopping(false), 600);
  };

  /** Keep the questions we have and ask the provider for the rest. */
  const handleContinue = () => {
    if (!partial || partial.length === 0 || genState.busy) return;
    const remaining = Math.max(1, questionCount - partial.length);
    appendBaseRef.current = partial;
    setPartial(null);
    setPartialReason(null);
    void handleLaunch(remaining);
  };

  const handleLaunchPartial = () => {
    if (!partial || partial.length === 0) return;
    const keys = resolveSubjects();
    const labels = labelsFor(keys);
    const chosenSubtopics = topicsForKeys(keys);
    setPartial(null);
    launchWith(partial, labels, chosenSubtopics);
  };

  // ------------------------------------------------------------ AI instruction profiles

  const refreshProfiles = () => setProfiles(listProfiles());

  const loadProfile = (id: string) => {
    if (!id) {
      setActiveProfileIdState(null);
      setActiveProfileId(null);
      setProfileName('');
      return;
    }
    const profile = getProfile(id);
    if (!profile) return;
    setProfileDraft(profile.text);
    setProfileName(profile.name);
    setAppliedProfile(profile.text);
    setActiveProfileIdState(profile.id);
    setActiveProfileId(profile.id);
    setShowSaveRow(false);
    setProfileNotice(`Loaded “${profile.name}” — applied to the next generation.`);
  };

  const defaultProfileName = () =>
    `${selectedExam.replace('_', '-')} · ${difficultyTier === 'ALL' ? 'mixed' : difficultyTier.toLowerCase()} · ${new Date().toLocaleDateString()}`;

  const handleSaveProfile = () => {
    const text = profileDraft.trim();
    if (!text) {
      setProfileNotice('Write the instructions before saving a profile.');
      return;
    }
    const name = (profileName.trim() || defaultProfileName()).slice(0, 80);
    const saved = activeProfileId
      ? updateProfile(activeProfileId, { name, text })
      : createProfile({ name, text, exam: selectedExam });
    if (!saved) {
      setProfileNotice('That profile no longer exists — saving it as a new one instead.');
      const created = createProfile({ name, text, exam: selectedExam });
      setActiveProfileId(created.id);
      setActiveProfileIdState(created.id);
      setProfileName(created.name);
    } else {
      setActiveProfileId(saved.id);
      setActiveProfileIdState(saved.id);
      setProfileName(saved.name);
    }
    setAppliedProfile(text);
    refreshProfiles();
    setShowSaveRow(false);
    setProfileNotice(`Saved “${name}”. It stays available after a reload.`);
  };

  const handleDeleteProfile = () => {
    if (!activeProfileId) return;
    deleteProfile(activeProfileId);
    setActiveProfileIdState(null);
    setShowSaveRow(false);
    refreshProfiles();
    setProfileNotice('Profile deleted. The text stays in the box as a draft.');
  };

  /** Draft a reusable instruction profile from the current builder settings, then save it. */
  const handleGenerateProfile = async () => {
    const provider = getActiveProvider();
    if (!provider) {
      setProfileNotice(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`);
      return;
    }
    setGeneratingProfile(true);
    setProfileNotice(null);
    try {
      const keys = resolveSubjects();
      const subjects = labelsFor(keys);
      const text = await aiComplete({
        provider,
        model: getEffectiveModel(provider),
        system:
          'You write compact, reusable instruction profiles for an exam-question generator. ' +
          'Return ONLY the instruction text — no preamble, no markdown fences, no explanation. ' +
          'Write second-person instructions to the generator (e.g. "Write …", "Avoid …"). ' +
          'Cover: stem style and length, option design, distractor strategy, reasoning steps, and exam-specific conventions. ' +
          'Keep it under 700 characters and make it specific enough to change the output.',
        messages: [{
          role: 'user',
          content:
            `Exam: ${selectedExam.replace('_', '-')}\n` +
            `Difficulty: ${difficultyTier}${difficultySubLevel ? ` (${difficultySubLevel})` : ''}\n` +
            `Subjects: ${subjects.slice(0, 8).join(', ') || 'mixed'}\n` +
            `Writing options: ${[...questionTypes, ...stemPatterns].join('; ') || 'standard'}\n` +
            (appliedProfile ? `Build on this existing profile:\n"""\n${appliedProfile.slice(0, 600)}\n"""\n` : '') +
            'Write the reusable instruction profile now.',
        }],
      });
      const clean = text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim().slice(0, 1400);
      if (!clean) throw new Error('The provider returned an empty profile.');
      const name = `${selectedExam.replace('_', '-')} · ${difficultyTier === 'ALL' ? 'mixed' : difficultyTier.toLowerCase()} · AI profile`;
      const created = createProfile({ name, text: clean, exam: selectedExam });
      setProfileDraft(clean);
      setProfileName(created.name);
      setAppliedProfile(clean);
      setActiveProfileId(created.id);
      setActiveProfileIdState(created.id);
      setShowSaveRow(false);
      refreshProfiles();
      setProfileNotice(`Generated and saved “${created.name}”. Applied to the next generation.`);
    } catch (err: any) {
      setProfileNotice(err?.message || 'Could not generate a profile.');
    } finally {
      setGeneratingProfile(false);
    }
  };

  // ------------------------------------------------------------ history

  const progressStats = useMemo(() => {
    const summary = summarizeAttempts();
    const today = attemptsToday();
    const last = listAttempts()[0] ?? null;
    return { summary, todayCount: today.length, last };
  }, []);

  const subjectNames = useMemo(() => NEET_PG_SUBJECTS.map((s) => s.name), []);
  const weakForDrill = useMemo(
    () => progressStats.summary.weakSubjects.filter((w) => subjectNames.includes(w.subject)),
    [progressStats.summary.weakSubjects, subjectNames],
  );

  const applyWeakDrill = () => {
    const targets = weakForDrill.map((w) => w.subject);
    if (!targets.length) return;
    if (selectedExam === 'NEET_PG') setSelectedNeetSubjects(targets);
    else if (selectedExam === 'INI_CET' && iniSyllabusMode === '19_SUBJECTS') setSelectedIniSubjects(targets);
    else return;
    setSpecialtyAll(false);
    setSelectedSubtopics((prev) => {
      const next = { ...prev };
      for (const subject of targets) delete next[subject];
      return next;
    });
    setGenState((st) => ({ ...st, error: null }));
  };

  const subjectsChosen = effectiveKeys.length;
  const canLaunch = subjectsChosen > 0;
  const activeModalRow = topicModal ? subjectList.find((r) => r.key === topicModal.key) ?? null : null;
  const durationMin = Math.max(1, Math.round(questionCount * 1.1));

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Create a custom module</h1>
          <p className="text-sm text-slate-500 mt-1">Customise an MCQ set by adding your own parameters</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
          {(['NEET_PG', 'INI_CET', 'AMC_CAT'] as ExamType[]).map((examKey) => (
            <button
              key={examKey}
              onClick={() => { setSelectedExam(examKey); onExamChange?.(examKey); setSpecialtyAll(false); }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                selectedExam === examKey ? 'bg-white text-[#00696b] shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {EXAM_LABEL[examKey]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ------------------------------------------------ form */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm px-6">
          <Row label="Number of questions" hint={`${EXAM_SCORING[selectedExam]} marking · ~${durationMin} min`}>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-[#0f8b8d]"
              >
                {QUESTION_COUNTS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="text-[11px] text-slate-500">
                questions · written in batches of 10, up to 100
              </span>
            </div>
          </Row>

          <Row label="Difficulty Level">
            <div className="flex flex-wrap items-start gap-6">
              <Radio
                checked={difficultyTier === 'ALL'}
                onClick={() => { setDifficultyTier('ALL'); setDifficultySubLevel(undefined); }}
                label="All"
                hint="Realistic exam mix (~20% easy, 45% medium, 35% hard)"
              />
              <Radio
                checked={difficultyTier !== 'ALL'}
                onClick={() => setDifficultyTier(difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier)}
                label="Choose level"
                hint="Every item at one level"
              />
            </div>

            {difficultyTier !== 'ALL' && (
              <div className="mt-3.5 space-y-2.5 pl-6">
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'LOW', label: 'Low' },
                    { id: 'MEDIUM', label: 'Medium' },
                    { id: 'HIGH', label: 'High' },
                  ] as const).map((tier) => (
                    <Chip
                      key={tier.id}
                      active={difficultyTier === tier.id}
                      onClick={() => { setDifficultyTier(tier.id); setDifficultySubLevel(undefined); }}
                    >
                      {tier.label}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(difficultyTier === 'LOW'
                    ? [{ id: 'L1', label: 'L1 · 1-step fact retrieval' }, { id: 'L2', label: 'L2 · pathognomonic cues' }]
                    : difficultyTier === 'MEDIUM'
                      ? [{ id: 'M1', label: 'M1 · vignette + labs → diagnosis' }, { id: 'M2', label: 'M2 · eliminate paired traps' }]
                      : [{ id: 'H1', label: 'H1 · multi-step management' }, { id: 'H2', label: 'H2 · atypical board traps' }]
                  ).map((sub) => (
                    <Chip
                      key={sub.id}
                      active={difficultySubLevel === sub.id}
                      onClick={() => setDifficultySubLevel(difficultySubLevel === sub.id ? undefined : (sub.id as DifficultySubLevel))}
                      title="Optional sub-level"
                    >
                      {sub.label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </Row>

          <Row label="Questions from" hint="written by your active AI provider">
            <div className="flex flex-wrap items-start gap-6">
              <Radio checked={sourceMode === 'AI'} onClick={() => setSourceMode('AI')} label="New AI questions" />
              <Radio
                checked={sourceMode === 'MY_NOTES'}
                onClick={() => setSourceMode('MY_NOTES')}
                label="My notes"
                hint={`${listUserHighlights().length} saved note${listUserHighlights().length === 1 ? '' : 's'}`}
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Chip active={false} onClick={() => onNavigate('mistakes')} title="Open the Mistake Notebook">My mistakes ↗</Chip>
              <Chip active={false} onClick={() => onNavigate('question-bank')} title="Open the Question Bank">Recall bank ↗</Chip>
              <Chip active={false} onClick={() => onNavigate('question-bank')} title="Open the Question Bank">eMedici ↗</Chip>
              <Chip active={false} onClick={() => onNavigate('question-bank')} title="Open the Question Bank">AMC SUCCESS ↗</Chip>
            </div>
            {sourceMode === 'MY_NOTES' && (
              <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
                Questions are written only from the highlights and AI notes you have saved. Nothing else is invented;
                the note's citation is carried into the generated question.
              </p>
            )}
          </Row>

          <div id="speciality-picker">
          <Row label="Speciality" hint={`${subjectsChosen} of ${subjectList.length} selected`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-3">
              <Radio
                checked={specialtyAll}
                onClick={() => setSpecialtyAll(true)}
                label="All"
                hint={`Every ${selectedExam === 'AMC_CAT' ? 'domain' : 'subject'} (${subjectList.length})`}
              />
              <Radio checked={!specialtyAll} onClick={() => setSpecialtyAll(false)} label="Choose" hint="Pick the subjects yourself" />
              {selectedExam === 'INI_CET' && (
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 ml-auto">
                  <button
                    onClick={() => setIniSyllabusMode('19_SUBJECTS')}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold ${iniSyllabusMode === '19_SUBJECTS' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                  >
                    19 subjects
                  </button>
                  <button
                    onClick={() => setIniSyllabusMode('6_INTEGRATED_DOMAINS')}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold ${iniSyllabusMode === '6_INTEGRATED_DOMAINS' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
                  >
                    6 AIIMS domains
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 max-h-[320px] overflow-y-auto">
              {subjectList.map((row) => {
                const on = isSubjectOn(row.key);
                const chosenTopics = chosenTopicsFor(row);
                const allTopics = chosenTopics.length === row.topics.length;
                return (
                  <div
                    key={row.key}
                    title={row.desc || row.label}
                    className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-100 last:border-b-0 transition-colors ${
                      on ? 'bg-teal-50/40' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button onClick={() => toggleSubject(row.key)} className="flex items-start gap-2.5 flex-1 min-w-0 text-left">
                      <span className="mt-0.5"><SubjectTick checked={on} /></span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-800 truncate">
                          {row.label}
                          {row.highYield && <span className="ml-1 text-[9px] text-amber-500 align-top">★</span>}
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          {on
                            ? allTopics
                              ? `All topics (${row.topics.length})`
                              : `${chosenTopics.length} of ${row.topics.length} topics`
                            : row.meta}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => setTopicModal({ key: row.key, label: row.label })}
                      className="shrink-0 mt-0.5 px-2 py-1 rounded-md text-[10px] font-bold text-[#0f8b8d] hover:bg-teal-50 flex items-center gap-1"
                      title="Choose topics"
                    >
                      Topics <ChevronsUpDown className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </Row>
          </div>

          <Row label="Tags" hint="style hints sent to the AI writer">
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Question style</div>
                <div className="flex flex-wrap gap-1.5">
                  {QUESTION_TYPE_CHIPS.map((q) => (
                    <Chip key={q} active={questionTypes.includes(q)} onClick={() => toggleFromList(questionTypes, setQuestionTypes, q)}>
                      {q}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Stem focus</div>
                <div className="flex flex-wrap gap-1.5">
                  {STEM_PATTERN_CHIPS.map((p) => (
                    <Chip key={p} active={stemPatterns.includes(p)} onClick={() => toggleFromList(stemPatterns, setStemPatterns, p)}>
                      {p}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold text-slate-800">Include image-based questions</div>
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Any item where a real ECG / X-ray / CT / histology / clinical photo is expected gets one fetched
                    from the internet (Wikimedia Commons + Open-i/NLM) — as many as the set needs, each picture used
                    once. Items stay text-only when no matching figure is found.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludeImages((v) => !v)}
                  className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors ${includeImages ? 'bg-[#0f8b8d]' : 'bg-slate-300'}`}
                  aria-pressed={includeImages}
                  title={includeImages ? 'Image-based items are on' : 'Image-based items are off'}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${includeImages ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>

              {selectedExam === 'AMC_CAT' && (
                <>
                  <button onClick={() => setShowAmcOptions((v) => !v)} className="text-[11px] font-bold text-[#0f8b8d] hover:underline">
                    {showAmcOptions ? 'Hide' : 'Show'} AMC blueprint tags (evidence, patient group, presenting problem)
                  </button>
                  {showAmcOptions && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Evidence sources</div>
                        <div className="flex flex-wrap gap-1.5">
                          {EVIDENCE_SOURCE_CHIPS.map((src) => (
                            <Chip key={src} active={evidenceSources.includes(src)} onClick={() => toggleFromList(evidenceSources, setEvidenceSources, src)}>
                              {src}
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Patient group</div>
                        <div className="flex flex-wrap gap-1.5">
                          {PATIENT_GROUP_CHIPS.map((g) => (
                            <Chip key={g} active={patientGroup === g} onClick={() => setPatientGroup(patientGroup === g ? '' : g)}>
                              {g}
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Presenting problems</div>
                        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                          {PRESENTING_PROBLEM_CHIPS.map((pp) => (
                            <Chip key={pp} active={presentingProblems.includes(pp)} onClick={() => toggleFromList(presentingProblems, setPresentingProblems, pp)}>
                              {pp}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Row>

          <Row label="Mode" last>
            <div className="flex flex-wrap items-start gap-6">
              <Radio
                checked={mode === 'TUTOR'}
                onClick={() => setMode('TUTOR')}
                label="Regular"
                hint="See answer and explanations after solving each MCQ"
              />
              <Radio
                checked={mode === 'EXAM'}
                onClick={() => setMode('EXAM')}
                label="Exam Mode"
                hint="Review answers only after completing the module"
              />
            </div>
          </Row>
        </div>
        {/* ------------------------------------------------ right rail */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Module summary</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">{EXAM_LABEL[selectedExam]}</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {EXAM_LABEL[selectedExam]} pattern · {EXAM_SCORING[selectedExam]} · {mode === 'EXAM' ? 'strict exam timing' : 'regular practice'}
            </p>
            <div className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 text-[11px]">
              {[
                ['Questions', `${questionCount}`],
                ['Difficulty', difficultyTier === 'ALL' ? 'All levels' : `${difficultyTier}${difficultySubLevel ? ` · ${difficultySubLevel}` : ''}`],
                ['Specialities', `${subjectsChosen} of ${subjectList.length}`],
                ['Topics', `${totalChosenSubtopicsCount}`],
                ['Est. duration', `~${durationMin} min`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-3 py-2">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-bold text-slate-800 font-mono">{value}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Modules today</div>
                <div className="text-sm font-mono font-bold text-slate-900">{progressStats.todayCount}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Accuracy</div>
                <div className="text-sm font-mono font-bold text-[#0f8b8d]">
                  {progressStats.summary.accuracyPercent === null ? '—' : `${progressStats.summary.accuracyPercent}%`}
                </div>
              </div>
            </div>
            {progressStats.summary.modules > 0 && weakForDrill.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Weakest real topics</div>
                <div className="flex flex-wrap gap-1.5">
                  {weakForDrill.slice(0, 4).map((w) => (
                    <span key={w.subject} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 border border-rose-200 text-rose-800">
                      {w.subject} · {w.accuracy}%
                    </span>
                  ))}
                </div>
                {(selectedExam === 'NEET_PG' || (selectedExam === 'INI_CET' && iniSyllabusMode === '19_SUBJECTS')) && (
                  <button onClick={applyWeakDrill} className="text-[10px] font-bold text-[#0f8b8d] hover:underline">
                    Select these {weakForDrill.length} subjects
                  </button>
                )}
              </div>
            )}
          </div>

          {/* AI instruction profiles — saved, reusable, and generated on demand */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <MessageSquarePlus className="w-4 h-4 text-[#0f8b8d]" /> AI instructions
              </h3>
              <span className="text-[9px] font-mono text-slate-400">
                {profiles.length} saved profile{profiles.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-500">
              Tell the AI how to write <span className="italic">this</span> set — style, difficulty, stem length,
              distractors, focus. Save it as a named profile and reuse it on any future run.
            </p>

            {profiles.length > 0 && (
              <div className="flex items-center gap-1.5">
                <select
                  value={activeProfileId ?? ''}
                  onChange={(e) => loadProfile(e.target.value)}
                  disabled={genState.busy}
                  className="flex-1 min-w-0 text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 focus:outline-none focus:border-[#0f8b8d] disabled:opacity-50"
                >
                  <option value="">Load a saved profile…</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {activeProfileId && (
                  <button
                    type="button"
                    onClick={handleDeleteProfile}
                    disabled={genState.busy}
                    title="Delete this profile"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <textarea
              value={profileDraft}
              onChange={(e) => setProfileDraft(e.target.value)}
              disabled={genState.busy}
              rows={3}
              placeholder={'e.g. "closer distractors, shorter stems, more next-best-step items, use Indian guidelines, drop classic one-liners"'}
              className="w-full resize-y rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#0f8b8d] disabled:opacity-50"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setAppliedProfile(profileDraft.trim() || null)}
                disabled={genState.busy || !profileDraft.trim() || (appliedProfile ?? '') === profileDraft.trim()}
                className="flex-1 min-w-[110px] py-1.5 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition-colors"
              >
                {appliedProfile && appliedProfile === profileDraft.trim() ? 'Profile applied' : 'Apply to next run'}
              </button>
              <button
                onClick={() => { setProfileDraft(''); persistDraft(''); }}
                disabled={genState.busy || !profileDraft.trim()}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 text-[10px] font-semibold transition-colors"
              >
                Clear draft
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleGenerateProfile}
                disabled={genState.busy || generatingProfile}
                title="Ask the active AI to draft a reusable instruction profile from these settings, then save it"
                className="px-2.5 py-1.5 rounded-lg border border-[#0f8b8d]/30 bg-teal-50 text-[#00696b] hover:bg-[#0f8b8d]/10 disabled:opacity-40 text-[10px] font-bold flex items-center gap-1.5 transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {generatingProfile ? 'Generating…' : 'Generate profile'}
              </button>
              <button
                onClick={() => setShowSaveRow((v) => !v)}
                disabled={genState.busy || !profileDraft.trim()}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d] disabled:opacity-40 text-[10px] font-bold flex items-center gap-1.5 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {activeProfileId ? 'Save changes' : 'Save profile'}
              </button>
            </div>

            {showSaveRow && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProfile(); }}
                  placeholder={defaultProfileName()}
                  className="flex-1 min-w-0 text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-[#0f8b8d]"
                />
                <button
                  onClick={handleSaveProfile}
                  className="px-2.5 py-1.5 rounded-lg bg-[#001432] hover:bg-[#13294b] text-white text-[10px] font-bold"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveRow(false)}
                  className="px-2 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 text-[10px] font-semibold"
                >
                  Cancel
                </button>
              </div>
            )}

            {profileNotice && (
              <p className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">{profileNotice}</p>
            )}
            {appliedProfile && appliedProfile !== profileDraft.trim() && (
              <p className="text-[10px] text-amber-600">Unapplied changes — press Apply to use the edited text.</p>
            )}
            {appliedProfile && appliedProfile === profileDraft.trim() && (
              <p className="text-[10px] text-[#0f8b8d]">Active for the next generation{activeProfileId ? ' · saved profile' : ''}.</p>
            )}
          </div>

          {/* Generator + launch */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#0f8b8d]" /> AI generator
              </h3>
              <span className="text-[10px] font-mono text-slate-500 truncate max-w-[55%]">
                {activeProvider
                  ? `${activeProvider} · ${providerKnownDown ? 'not connected' : getEffectiveModel(activeProvider)}`
                  : 'no provider'}
              </span>
            </div>

            {!activeProvider && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  No AI engine is connected, so questions cannot be written. Connect Claude, ChatGPT, Grok, Gemini or
                  OpenCode in Settings — the questions come from your own subscription.
                  <button
                    onClick={() => onNavigate('settings')}
                    className="ml-1 font-bold underline decoration-dotted hover:text-amber-950"
                  >
                    Open Settings
                  </button>
                </span>
              </div>
            )}

            {providerKnownDown && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  <strong className="capitalize">{activeProvider}</strong> is set as your engine but is not connected
                  on this machine, so generation would fail. Reconnect it or choose another provider in Settings.
                  <button
                    onClick={() => onNavigate('settings')}
                    className="ml-1 font-bold underline decoration-dotted hover:text-amber-950"
                  >
                    Open Settings
                  </button>
                </span>
              </div>
            )}

            {genState.busy ? (
              <div className="space-y-1.5">
                <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-[#0f8b8d] transition-all"
                    style={{ width: `${genState.total > 0 ? Math.min(100, Math.round((genState.generated / genState.total) * 100)) : 0}%` }}
                  />
                </div>
                <div className="text-[10px] font-mono text-slate-600">
                  Questions {genState.generated} / {genState.total}
                  {genState.dropped > 0 ? ` · ${genState.dropped} dropped` : ''}
                  {elapsedSec > 0 ? ` · ${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')} elapsed` : ''}
                </div>
                {elapsedSec >= 25 && (
                  <div className="text-[9px] text-slate-400 leading-snug">
                    Generating questions in parallel — each question runs independently through the active provider.
                  </div>
                )}
                {retrying && (
                  <div className="text-[10px] font-mono text-amber-700 leading-snug">
                    {retrying}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-slate-500 leading-relaxed">
                {!activeProvider
                  ? 'Connect a provider first — then this button builds the module.'
                  : providerKnownDown
                    ? `${activeProvider} is signed out — reconnect it to generate.`
                    : canLaunch
                      ? `${questionCount} questions across ${subjectsChosen} ${selectedExam === 'AMC_CAT' ? 'domains' : 'specialities'} and ${totalChosenSubtopicsCount} topics.`
                      : 'Select at least one speciality (or choose All) to build a module.'}
              </p>
            )}

            {genState.error && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[10px] leading-relaxed flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-500" />
                <span>{genState.error}</span>
              </div>
            )}

            <button
              onClick={() => {
                if (!activeProvider || providerKnownDown) {
                  onNavigate('settings');
                  return;
                }
                if (!canLaunch) {
                  setGenState({
                    busy: false, generated: 0, total: 0, batch: 0, totalBatches: 0, dropped: 0,
                    error: 'Pick at least one speciality (or choose All) before building a module.',
                  });
                  document.getElementById('speciality-picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }
                handleLaunch();
              }}
              disabled={genState.busy}
              className="w-full py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
            >
              {genState.busy ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  <span>Generating… {genState.generated}/{genState.total}</span>
                </>
              ) : !activeProvider ? (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Connect an AI provider in Settings</span>
                </>
              ) : providerKnownDown ? (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Reconnect {activeProvider} in Settings</span>
                </>
              ) : !canLaunch ? (
                <>
                  <Target className="w-4 h-4" />
                  <span>Select at least one speciality</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" /> Launch Clinical Module
                </>
              )}
            </button>

            {genState.busy && (
              <button
                onClick={handleStop}
                disabled={stopping}
                className="w-full py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 disabled:cursor-wait text-white text-[11px] font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Square className="w-3 h-3 fill-current" />
                {stopping ? 'Stopping…' : genState.generated > 0 ? `Stop generating · keep ${genState.generated} ready` : 'Stop generating'}
              </button>
            )}
            {genState.busy || progressStep !== 'idle' ? (
              <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-200">
                <GenerationProgress
                  step={progressStep}
                  subtitle={genState.busy ? `Batch ${genState.batch} of ${genState.totalBatches}` : null}
                  refiningDetail={progressDetail.refining}
                  savedDetail={progressDetail.saved}
                  qaDetail={progressDetail.qa}
                />
                <div className="mt-2 text-xs text-slate-500">
                  {genState.busy ? `${genState.generated} of ${genState.total} generated` : `${progressStep} complete`}
                </div>
                {!genState.busy && progressStep !== 'done' && (
                  <button
                    onClick={handleStop}
                    disabled={stopping}
                    className="mt-2 w-full py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 disabled:opacity-60 text-rose-700 text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                    title="Stop refinement / QA"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                    {stopping ? 'Stopping…' : 'Stop'}
                  </button>
                )}
              </div>
            ) : null}            {partial && partial.length > 0 && !genState.busy && (
              <div className="space-y-2">
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[10px] leading-relaxed">
                  {partialReason
                    ? `Generated ${partial.length} of ${genState.total} — the provider failed on a batch: ${partialReason}`
                    : `Stopped at ${partial.length} of ${genState.total} questions.`}{' '}
                  Every kept question passed validation; nothing was padded.
                </div>
                {partial.length < questionCount && (
                  <button
                    onClick={handleContinue}
                    className="w-full py-2 rounded-xl bg-[#001432] hover:bg-[#13294b] text-white text-[11px] font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Continue generating the remaining {questionCount - partial.length}
                  </button>
                )}
                <button
                  onClick={handleLaunchPartial}
                  className="w-full py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-current" /> Launch with {partial.length} ready
                </button>
                <button
                  onClick={() => setPartial(null)}
                  className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded-lg transition-colors"
                >
                  Discard these {partial.length}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1.5 px-1">
            <div className="flex items-start gap-2 text-[10px] text-slate-500">
              <Brain className="w-3.5 h-3.5 shrink-0" />
              <span>Questions come from your active AI subscription — nothing is canned.</span>
            </div>
            <div className="flex items-start gap-2 text-[10px] text-slate-500">
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Topic picks shape the blueprint; they never invent facts.</span>
            </div>
            <div className="flex items-start gap-2 text-[10px] text-slate-500">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Last module:{' '}
                {progressStats.last ? `${progressStats.last.correct}/${progressStats.last.attempted} correct` : 'none yet'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {topicModal && activeModalRow && (
        <TopicPickerModal
          subject={activeModalRow.label}
          topics={activeModalRow.topics}
          selected={selectedSubtopics[activeModalRow.key] ?? []}
          subjectPicked={isSubjectOn(activeModalRow.key)}
          onApply={applyTopics}
          onClose={() => setTopicModal(null)}
        />
      )}
    </div>
  );
};

export default PracticeModuleBuilderView;
