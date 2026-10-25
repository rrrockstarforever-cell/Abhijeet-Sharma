import React, { useState, useRef, useMemo, useEffect } from 'react';
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
  Square,
  MessageSquarePlus,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import ExamPatternDisplay from './ExamPatternDisplay';
import { ExamType, AppView, DifficultyTier, DifficultySubLevel, INISyllabusMode, ClinicalQuestion } from '../types.ts';
import { 
  NEET_PG_SUBJECTS, 
  INI_CET_DOMAINS_6, 
  AMC_CAT_DOMAINS_6 
} from '../data/mockClinicalData.ts';
import { SUBTOPICS } from '../data/subtopics.ts';
import { generateExamQuestions, AiError, NOT_CONNECTED_MESSAGE, getActiveProvider, getEffectiveModel } from '../lib/ai.ts';
import { summarizeAttempts, attemptsToday, listAttempts } from '../utils/attemptStore.ts';
import { listUserHighlights } from '../utils/userHighlightsStore.ts';

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
}

// ---- Section-14 AI writing options (chips passed into the AI prompt) ----
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
  // Real cancellation: the Stop button aborts the in-flight batch request (and, with the
  // server-side abort, the upstream provider call) instead of waiting for the batch.
  const abortRef = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  // Questions kept when the user stopped early: validated, never padded, launchable as-is.
  const [partial, setPartial] = useState<ClinicalQuestion[] | null>(null);

  // Suggestion box: a TEMPORARY generation profile. Held in component state only — never
  // localStorage, never written to settings — so a reload or restart drops it.
  const [profileDraft, setProfileDraft] = useState('');
  const [appliedProfile, setAppliedProfile] = useState<string | null>(null);

  // Leaving the screen mid-generation must not keep spending quota.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Section-14 AI writing options
  const [questionTypes, setQuestionTypes] = useState<string[]>([]);
  const [stemPatterns, setStemPatterns] = useState<string[]>([]);
  const [evidenceSources, setEvidenceSources] = useState<string[]>([]);
  const [patientGroup, setPatientGroup] = useState<string>('');
  const [presentingProblems, setPresentingProblems] = useState<string[]>([]);

  // Question source (PARITY section 2): new AI items, or MCQs derived from the
  // learner's real saved notes. The bank sources open the Question Bank screen.
  const [sourceMode, setSourceMode] = useState<'AI' | 'MY_NOTES'>('AI');

  const toggleFromList = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const chip = (selected: boolean) =>
    `px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors ${
      selected
        ? 'bg-[#0f8b8d]/10 border-[#0f8b8d]/40 text-[#00696b]'
        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
    }`;

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

  // Launch: generate the questions with the ACTIVE AI provider (batches <=10), validate,
  // then hand the generated list to the Test Runner launch path. No canned question fallback.
  const resolveSubjects = () => {
    if (selectedExam === 'NEET_PG') return selectedNeetSubjects;
    if (selectedExam === 'INI_CET') return iniSyllabusMode === '19_SUBJECTS' ? selectedIniSubjects : selectedIniDomains;
    return selectedAmcDomains;
  };

  const handleLaunch = async () => {
    if (genState.busy) return;

    const subjects = resolveSubjects();
    const chosenSubtopics: string[] = [];
    subjects.forEach(subj => {
      const list = selectedSubtopics[subj] ?? SUBTOPICS[subj] ?? [];
      chosenSubtopics.push(...list);
    });

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

    setGenState({ busy: true, generated: 0, total: questionCount, batch: 0, totalBatches: Math.ceil(questionCount / 10), dropped: 0, error: null });
    stopEarlyRef.current = false;
    setPartial(null);
    setStopping(false);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { questions, dropped, stopped } = await generateExamQuestions({
        exam: selectedExam,
        count: questionCount,
        subjectSubtopics: subjects.map(s => ({ subject: s, subtopics: selectedSubtopics[s] ?? SUBTOPICS[s] ?? [] })),
        difficultyTier,
        difficultySubLevel,
        onProgress: (generated, total, batch, totalBatches) =>
          setGenState(st => ({ ...st, generated, batch, totalBatches })),
        shouldStop: () => stopEarlyRef.current,
        signal: controller.signal,
        customInstructions: appliedProfile ?? undefined,
        questionTypes,
        stemPatterns,
        evidenceSources: selectedExam === 'AMC_CAT' ? evidenceSources : undefined,
        patientGroup: selectedExam === 'AMC_CAT' && patientGroup ? patientGroup : undefined,
        presentingProblems: selectedExam === 'AMC_CAT' ? presentingProblems : undefined,
        sourceMaterial,
      });

      if (questions.length === 0) {
        const stopped = stopEarlyRef.current;
        setGenState({
          busy: false,
          generated: 0,
          total: questionCount,
          batch: 0,
          totalBatches: 0,
          dropped,
          error: stopped
            ? 'Generation stopped before the first batch returned a valid question. Try again or reduce the count.'
            : `The AI provider returned 0 valid questions (${dropped} dropped by validation). Try again, reduce the count, or change the active provider in Settings.`,
        });
        return;
      }

      setGenState({
        busy: false,
        generated: questions.length,
        total: questionCount,
        batch: Math.ceil(questions.length / 10),
        totalBatches: Math.ceil(questionCount / 10),
        dropped,
        error: null,
      });
      if (stopped) {
        // Stopped by the user: keep every validated question and let them launch it.
        setPartial(questions);
        return;
      }
      launchWith(questions, subjects, chosenSubtopics);
    } catch (err: any) {
      const aborted = controller.signal.aborted || (err instanceof AiError && err.kind === 'aborted');
      const message = aborted
        ? 'Generation stopped.'
        : err instanceof AiError ? err.message : (err?.message || 'AI question generation failed.');
      setGenState({ busy: false, generated: 0, total: questionCount, batch: 0, totalBatches: 0, dropped: 0, error: aborted ? null : message });
    } finally {
      abortRef.current = null;
      setStopping(false);
    }
  };

  /** Hand a question set to the Test Runner launch path. */
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
  };

  /** Stop button: cancel the in-flight batch now, keep everything already validated. */
  const handleStop = () => {
    if (!genState.busy || stopping) return;
    stopEarlyRef.current = true;
    setStopping(true);
    setGenState(st => ({ ...st, error: null }));
    abortRef.current?.abort();
  };

  /** Launch the questions kept from a stopped run. */
  const handleLaunchPartial = () => {
    if (!partial || partial.length === 0) return;
    const subjects = resolveSubjects();
    const chosenSubtopics: string[] = [];
    subjects.forEach(subj => {
      const list = selectedSubtopics[subj] ?? SUBTOPICS[subj] ?? [];
      chosenSubtopics.push(...list);
    });
    setPartial(null);
    launchWith(partial, subjects, chosenSubtopics);
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

  // Real progress (PARITY section 2): computed only from stored attempts.
  const progressStats = useMemo(() => {
    const summary = summarizeAttempts();
    const today = attemptsToday();
    const last = listAttempts()[0] ?? null;
    return { summary, todayCount: today.length, last };
  }, []);

  // Targeted drill (PARITY section 2): only subjects the learner has actually answered,
  // lowest accuracy first. Subject names come from real attempt records.
  const subjectNames = useMemo(() => NEET_PG_SUBJECTS.map((s) => s.name), []);
  const canDrillBySubject = selectedExam === 'NEET_PG' || (selectedExam === 'INI_CET' && iniSyllabusMode === '19_SUBJECTS');
  const weakForDrill = useMemo(
    () => progressStats.summary.weakSubjects.filter((w) => subjectNames.includes(w.subject)),
    [progressStats.summary.weakSubjects, subjectNames],
  );

  const applyWeakDrill = () => {
    const targets = weakForDrill.map((w) => w.subject);
    if (!targets.length) return;
    if (selectedExam === 'NEET_PG') setSelectedNeetSubjects(targets);
    else setSelectedIniSubjects(targets);
    setSelectedSubtopics((prev) => {
      const next = { ...prev };
      for (const subject of targets) next[subject] = [...(SUBTOPICS[subject] ?? [])];
      return next;
    });
    setGenState((st) => ({ ...st, error: null }));
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

      {/* Real progress strip — modules today / overall accuracy / last module */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Modules today</div>
          <div className="text-2xl font-mono font-bold text-slate-900 mt-0.5">{progressStats.todayCount}</div>
          <div className="text-[10px] text-slate-400">{progressStats.summary.modules} submitted in total</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Overall accuracy</div>
          <div className="text-2xl font-mono font-bold text-[#0f8b8d] mt-0.5">
            {progressStats.summary.accuracyPercent === null ? '—' : `${progressStats.summary.accuracyPercent}%`}
          </div>
          <div className="text-[10px] text-slate-400">
            {progressStats.summary.questionsAnswered > 0
              ? `${progressStats.summary.correct} correct of ${progressStats.summary.questionsAnswered} answered`
              : 'No questions answered yet'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Last module</div>
          <div className="text-sm font-bold text-slate-900 mt-1 truncate">
            {progressStats.last
              ? `${progressStats.last.correct}/${progressStats.last.attempted} correct · ${progressStats.last.exam.replace('_', '-')}`
              : 'No module submitted yet'}
          </div>
          <div className="text-[10px] text-slate-400">
            {progressStats.last
              ? `${progressStats.last.mode === 'EXAM' ? 'Strict exam' : 'Tutor'} mode · ${new Date(progressStats.last.at).toLocaleString()}`
              : 'Finish a module to see your summary here'}
          </div>
        </div>
      </div>

      {/* Targeted drill from real weak topics (only when analysed attempts exist) */}
      {progressStats.summary.modules > 0 && (
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-rose-500" /> Targeted drill — weakest real topics
            </h3>
            <span className="text-[10px] text-slate-500">
              Built only from your submitted modules ({progressStats.summary.questionsAnswered} answers)
            </span>
          </div>
          {weakForDrill.length === 0 ? (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {canDrillBySubject
                ? 'Not enough answers per subject yet (at least 3 per subject) to rank weak topics. Submit another module.'
                : 'Weak-topic ranking uses NEET-PG / INI-CET subject names. Switch the target exam (or INI syllabus mode) to drill by subject.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {weakForDrill.map((w) => (
                  <span
                    key={w.subject}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold border bg-rose-50 border-rose-200 text-rose-800"
                    title={`${w.correct} correct of ${w.total} answered`}
                  >
                    {w.subject} · {w.accuracy}% ({w.correct}/{w.total})
                  </span>
                ))}
              </div>
              <button
                onClick={applyWeakDrill}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#001432] hover:bg-[#13294b] text-white text-[11px] font-bold"
              >
                <Target className="w-3.5 h-3.5 text-[#8ff3f4]" />
                Select these {weakForDrill.length} subject{weakForDrill.length === 1 ? '' : 's'} + all their subtopics
              </button>
            </>
          )}
        </div>
      )}

      {/* Question source (PARITY section 2) — AI items, own notes, or an existing bank */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#0f8b8d]" /> Question source
          </h3>
          <span className="text-[10px] text-slate-500">
            {sourceMode === 'MY_NOTES'
              ? `${listUserHighlights().length} saved note${listUserHighlights().length === 1 ? '' : 's'} will ground the questions`
              : 'Fresh questions written by your active AI provider'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setSourceMode('AI')} className={chip(sourceMode === 'AI')}>
            New AI questions
          </button>
          <button onClick={() => setSourceMode('MY_NOTES')} className={chip(sourceMode === 'MY_NOTES')}>
            My notes → MCQs
          </button>
          <span className="w-px h-5 bg-slate-200 mx-1" />
          <button onClick={() => onNavigate('mistakes')} className={chip(false)} title="Open the Mistake Notebook and its real SRS sprint">
            My mistakes ↗
          </button>
          <button onClick={() => onNavigate('question-bank')} className={chip(false)} title="Open the Question Bank (load your own bank files there)">
            Recall bank ↗
          </button>
          <button onClick={() => onNavigate('question-bank')} className={chip(false)} title="Open the Question Bank (load your own bank files there)">
            eMedici ↗
          </button>
          <button onClick={() => onNavigate('question-bank')} className={chip(false)} title="Open the Question Bank (load your own bank files there)">
            AMC SUCCESS ↗
          </button>
        </div>
        {sourceMode === 'MY_NOTES' && (
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Questions are written only from the highlights and AI notes you have saved. Nothing else is invented; the
            note's citation is carried into the generated question.
          </p>
        )}
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
              <button
                onClick={() => setQuestionCount(100)}
                className={`py-2 rounded-xl text-xs font-bold transition-all ${
                  questionCount === 100
                    ? 'bg-[#001432] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ALL
              </button>
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

          {/* Section-14: AI writing options (types, stem patterns, AMC evidence & patient context) */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">AI Writing Options</h3>
              <span className="text-[10px] text-slate-500 font-mono">sent to the AI with every batch</span>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Question types</div>
              <div className="flex flex-wrap gap-1.5">
                {QUESTION_TYPE_CHIPS.map((q) => (
                  <button key={q} onClick={() => toggleFromList(questionTypes, setQuestionTypes, q)} className={chip(questionTypes.includes(q))}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Stem patterns</div>
              <div className="flex flex-wrap gap-1.5">
                {STEM_PATTERN_CHIPS.map((p) => (
                  <button key={p} onClick={() => toggleFromList(stemPatterns, setStemPatterns, p)} className={chip(stemPatterns.includes(p))}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {selectedExam === 'AMC_CAT' && (
              <>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Evidence sources (AMC practice)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {EVIDENCE_SOURCE_CHIPS.map((src) => (
                      <button key={src} onClick={() => toggleFromList(evidenceSources, setEvidenceSources, src)} className={chip(evidenceSources.includes(src))}>
                        {src}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Patient group (AMC blueprint)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PATIENT_GROUP_CHIPS.map((g) => (
                      <button
                        key={g}
                        onClick={() => setPatientGroup(patientGroup === g ? '' : g)}
                        className={chip(patientGroup === g)}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Presenting problems (Murtagh)</div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {PRESENTING_PROBLEM_CHIPS.map((pp) => (
                      <button key={pp} onClick={() => toggleFromList(presentingProblems, setPresentingProblems, pp)} className={chip(presentingProblems.includes(pp))}>
                        {pp}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
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
                {questionCount} Questions · {difficultyTier} Tier {difficultySubLevel ? `(${difficultySubLevel})` : ''} · {totalChosenSubtopicsCount} Subtopics Active · {examDetails[selectedExam].scoring}
              </p>
            </div>

            {/* Suggestion box — a TEMPORARY generation profile (component state only, never
                persisted). Only an applied profile is sent with the request. */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8ff3f4]">
                  <MessageSquarePlus className="w-3.5 h-3.5" /> Suggestion box
                </div>
                <span className="text-[9px] font-mono text-white/45">temporary &middot; never saved</span>
              </div>
              <p className="text-[10px] leading-relaxed text-white/60">
                Tell the AI how to write <span className="italic">this</span> set — style, difficulty, stem length,
                distractors, focus. It applies to the next generation only, and a reload clears it.
              </p>
              <textarea
                value={profileDraft}
                onChange={(e) => setProfileDraft(e.target.value)}
                disabled={genState.busy}
                rows={3}
                placeholder={'e.g. "closer distractors, shorter stems, more next-best-step items, use Indian guidelines, drop classic one-liners"'}
                className="w-full resize-y rounded-lg bg-black/30 border border-white/15 px-2.5 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#0f8b8d]/70 disabled:opacity-50"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAppliedProfile(profileDraft.trim() || null)}
                  disabled={genState.busy || !profileDraft.trim() || (appliedProfile ?? '') === profileDraft.trim()}
                  className="flex-1 py-1.5 rounded-lg bg-[#0f8b8d]/90 hover:bg-[#00696b] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition-colors"
                >
                  {appliedProfile && appliedProfile === profileDraft.trim()
                    ? 'Temporary profile applied'
                    : 'Apply temporary profile'}
                </button>
                <button
                  onClick={() => { setAppliedProfile(null); setProfileDraft(''); }}
                  disabled={genState.busy || (!appliedProfile && !profileDraft.trim())}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white/80 text-[10px] font-semibold transition-colors"
                >
                  Clear
                </button>
              </div>
              {appliedProfile && appliedProfile !== profileDraft.trim() && (
                <p className="text-[10px] text-amber-300">Unapplied changes — press Apply to use the edited text.</p>
              )}
            </div>

            {/* AI generation status */}
            <div className="rounded-xl bg-black/20 border border-white/10 p-3 text-[11px] font-mono text-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-[#8ff3f4] font-bold uppercase tracking-wider">AI Generator</span>
                <span>{getActiveProvider() ? `${getActiveProvider()} · ${getEffectiveModel(getActiveProvider()!)}` : 'no active provider'}</span>
              </div>
              {appliedProfile && (
                <div className="text-[10px] text-amber-200/90 truncate" title={appliedProfile}>
                  Temporary profile active · not saved — {appliedProfile.slice(0, 84)}{appliedProfile.length > 84 ? '…' : ''}
                </div>
              )}
              {genState.busy ? (
                <>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#0f8b8d] transition-all"
                      style={{ width: `${genState.total > 0 ? Math.min(100, Math.round((genState.generated / genState.total) * 100)) : 0}%` }}
                    />
                  </div>
                  <div>
                    Batch {genState.batch} of {genState.totalBatches} · {genState.generated} / {genState.total} ready
                    {genState.dropped > 0 ? ` · ${genState.dropped} dropped invalid` : ''}
                  </div>
                </>
              ) : (
                <div>Questions are written live by your active AI provider on launch.</div>
              )}
            </div>

            {genState.error && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-[11px] leading-relaxed flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400" />
                <span>{genState.error}</span>
              </div>
            )}
          </div>

          <button
            onClick={handleLaunch}
            disabled={genState.busy || !getActiveProvider()}
            className="w-full py-3 bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 transform active:scale-95"
          >
            {genState.busy ? (
              <>
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>Generating… {genState.generated}/{genState.total}</span>
              </>
            ) : !getActiveProvider() ? (
              <>
                <ShieldAlert className="w-4 h-4" />
                <span>Connect an AI provider in Settings</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" /> Launch Clinical Module
              </>
            )}
          </button>

          {/* Stop is ALWAYS reachable while generating — the first batch can run for a
              minute, and stopping used to be impossible until it returned. */}
          {genState.busy && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="w-full py-2.5 bg-rose-600/90 hover:bg-rose-500 disabled:opacity-60 disabled:cursor-wait border border-rose-400/40 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {stopping
                ? 'Stopping…'
                : genState.generated > 0
                  ? `Stop generating · keep ${genState.generated} ready`
                  : 'Stop generating'}
            </button>
          )}

          {partial && partial.length > 0 && !genState.busy && (
            <>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-100 text-[11px] leading-relaxed">
                Stopped at {partial.length} of {genState.total} questions. Every one of them passed validation —
                nothing was padded. Launch them as a module, or discard and generate again.
              </div>
              <button
                onClick={handleLaunchPartial}
                className="w-full py-3 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 transform active:scale-95"
              >
                <Play className="w-4 h-4 fill-current" />
                Launch with {partial.length} ready
              </button>
              <button
                onClick={() => setPartial(null)}
                className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/15 text-white/75 text-[11px] font-semibold rounded-xl transition-all"
              >
                Discard these {partial.length}
              </button>
            </>
          )}

          {genState.total > 0 && genState.dropped > 0 && !genState.busy && !genState.error && (
            <p className="text-[11px] text-white/70 font-mono">
              Validation report: {genState.generated} valid questions, {genState.dropped} dropped by the validator.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
