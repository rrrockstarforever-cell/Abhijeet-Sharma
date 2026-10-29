import React, { useState, useEffect, useRef } from 'react';
import { AppView, ExamType, DifficultyTier, DifficultySubLevel, ClinicalQuestion } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { PerformanceAnalyticsView } from './components/PerformanceAnalyticsView.tsx';
import { MistakeNotebookView } from './components/MistakeNotebookView.tsx';
import { HighlightsSavedView } from './components/HighlightsSavedView.tsx';
import { SettingsAIView } from './components/SettingsAIView.tsx';
import { QAReviewDashboard } from './components/QAReviewDashboard.tsx';
import { ClinicalBrowserView } from './components/ClinicalBrowserView.tsx';
import { PracticeModuleBuilderView } from './components/PracticeModuleBuilderView.tsx';
import { QuestionBankPracticeView } from './components/QuestionBankPracticeView.tsx';
import { TestRunnerView } from './components/TestRunnerView.tsx';
import { AITutorView } from './components/AITutorView.tsx';
import { PDFReaderView } from './components/PDFReaderView.tsx';
import { JobsBanner } from './components/JobsBanner.tsx';
import { dueCount } from './utils/flashcardStore.ts';
import { listCapturedQuestions } from './utils/mistakeStore.ts';
import { subscribeDataChanged } from './utils/dataEvents.ts';
import { loadActiveTest, saveActiveTest } from './utils/sessionStore.ts';

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('analytics');
  // The launched test is restored from storage so a restart never loses generated questions.
  const [restoredTest] = useState(() => loadActiveTest());
  const [currentExam, setCurrentExam] = useState<ExamType>((restoredTest?.exam as ExamType) ?? 'INI_CET');
  const [activeQuestionId, setActiveQuestionId] = useState<string>(restoredTest?.activeQuestionId ?? '');
  const [activeTestQuestions, setActiveTestQuestions] = useState<ClinicalQuestion[] | undefined>(restoredTest?.questions);
  const [activeTestMode, setActiveTestMode] = useState<'EXAM' | 'TUTOR'>(restoredTest?.mode ?? 'TUTOR');

  useEffect(() => {
    saveActiveTest(
      activeTestQuestions && activeTestQuestions.length
        ? { questions: activeTestQuestions, mode: activeTestMode, exam: currentExam, activeQuestionId }
        : null,
    );
  }, [activeTestQuestions, activeTestMode, currentExam, activeQuestionId]);

  // Screens that hold long-running or unsaved work stay mounted (hidden) once opened, so
  // switching away never destroys an in-flight generation, filters, or a test in progress.
  const KEEP_ALIVE: AppView[] = ['practice', 'test-runner', 'question-bank'];
  const [mountedViews, setMountedViews] = useState<AppView[]>([]);

  // Generation can finish while the learner is on another screen. Read the live view from a
  // ref (the launch callback is captured when they pressed Launch) and, if they have moved
  // on, leave them where they are and offer the finished module instead of yanking them away.
  const currentViewRef = useRef<AppView>(currentView);
  useEffect(() => { currentViewRef.current = currentView; }, [currentView]);
  const [readyNotice, setReadyNotice] = useState<{ count: number } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('pulse-dark-mode');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    localStorage.setItem('pulse-dark-mode', String(isDarkMode));
  }, [isDarkMode]);
  // Bumped whenever a store writes, so the sidebar badges stay truthful.
  const [, setDataVersion] = useState(0);
  useEffect(() => subscribeDataChanged(() => setDataVersion((v) => v + 1)), []);

  // Real sidebar badges: captured-but-unresolved mistakes and cards due now.
  const unresolvedMistakes = listCapturedQuestions().filter((q) => q.status === 'unresolved').length;
  const srsDue = dueCount();

  useEffect(() => {
    if (KEEP_ALIVE.includes(currentView)) {
      setMountedViews((m) => (m.includes(currentView) ? m : [...m, currentView]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  const handleNavigate = (view: AppView, targetId?: string) => {
    if (view === 'test-runner') setReadyNotice(null);
    setCurrentView(view);
    if (targetId) {
      setActiveQuestionId(targetId);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchSubmit = (query: string) => {
    const q = query.trim();
    if (!q) return;
    try { sessionStorage.setItem('pulse.research.query', q); } catch { /* storage unavailable */ }
    setCurrentView('research');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLaunchModule = (
    exam: ExamType, 
    count: number, 
    mode: 'EXAM' | 'TUTOR', 
    subjects: string[],
    difficultyTier: DifficultyTier,
    difficultySubLevel?: DifficultySubLevel,
    chosenSubtopics?: string[],
    generatedQuestions?: ClinicalQuestion[]
  ) => {
    setCurrentExam(exam);
    setActiveTestMode(mode);
    // Only real, validated AI-generated questions may launch a module. There is no
    // sample-question fallback: an empty batch is reported by the builder itself.
    const questions = generatedQuestions ?? [];
    if (questions.length === 0) {
      setCurrentView('practice');
      return;
    }
    const tagged = questions.map(q => ({
      ...q,
      sourceType: 'ai-generator' as const,
    }));
    setActiveTestQuestions(tagged);
    if (tagged.length > 0) {
      setActiveQuestionId(tagged[0].id);
    }
    if (currentViewRef.current === 'practice') {
      setReadyNotice(null);
      setCurrentView('test-runner');
    } else {
      setReadyNotice({ count: tagged.length });
    }
  };

  const handleLaunchBankQuestions = (
    questions: ClinicalQuestion[], 
    mode: 'EXAM' | 'TUTOR', 
    exam: ExamType
  ) => {
    setCurrentExam(exam);
    setActiveTestMode(mode);
    setActiveTestQuestions(questions);
    if (questions.length > 0) {
      setActiveQuestionId(questions[0].id);
    }
    setCurrentView('test-runner');
  };

  const renderView = (view: AppView) => {
    switch (view) {
      case 'analytics':
        return (
          <PerformanceAnalyticsView 
            onNavigate={handleNavigate}
            onLaunchRemediation={(subject: string) => 
              handleNavigate('test-runner', subject.includes('Pathology') ? 'Q-PA-1049' : 'Q10')
            }
          />
        );
      case 'practice':
        return (
          <PracticeModuleBuilderView 
            currentExam={currentExam}
            onLaunchModule={handleLaunchModule}
            onNavigate={handleNavigate}
            onExamChange={setCurrentExam}
          />
        );
      case 'question-bank':
        return (
          <QuestionBankPracticeView 
            onNavigate={handleNavigate}
            onLaunchTest={handleLaunchBankQuestions}
          />
        );
      case 'test-runner':
        return (
          <TestRunnerView 
            initialQuestionId={activeQuestionId}
            onNavigate={handleNavigate}
            questions={activeTestQuestions}
            mode={activeTestMode}
            darkMode={isDarkMode}
          />
        );
      case 'mistakes':
        return (
          <MistakeNotebookView 
            onNavigate={handleNavigate}
            onStartSprint={(questions) => {
              if (!questions.length) return;
              setActiveTestMode('TUTOR');
              setActiveTestQuestions(questions);
              setActiveQuestionId(questions[0].id);
              setCurrentView('test-runner');
            }}
            currentExam={currentExam}
          />
        );
      case 'highlights':
        return (
          <HighlightsSavedView 
            onNavigate={handleNavigate}
          />
        );
      case 'ai-tutor':
        return (
          <AITutorView 
            initialQuestionId={activeQuestionId}
            attachedQuestion={
              (activeQuestionId
                ? activeTestQuestions?.find((q) => q.id === activeQuestionId)
                : null) ?? null
            }
            onNavigate={handleNavigate}
            currentExam={currentExam}
          />
        );
      case 'pdf-reader':
        return (
          <PDFReaderView 
            onNavigate={handleNavigate}
            darkMode={isDarkMode}
            onGenerateQuizFromPage={(book, page, snippet) => {
              handleNavigate('practice');
            }}
          />
        );
      case 'research':
        return (
          <ClinicalBrowserView 
            onNavigate={handleNavigate}
          />
        );
      case 'settings':
        return (
          <SettingsAIView />
        );
      case 'qa':
        return (
          <QAReviewDashboard />
        );
      default:
        return (
          <PerformanceAnalyticsView 
            onNavigate={handleNavigate} 
            onLaunchRemediation={(subject: string) => handleNavigate('test-runner')}
          />
        );
    }
  };

  return (
    <div className={`min-h-screen bg-[#f8f9ff] text-slate-800 flex font-sans antialiased selection:bg-[#0f8b8d]/20 selection:text-[#001432] ${
      isDarkMode ? 'dark' : ''
    }`}>
      {/* Persistent Clinical Navy Sidebar */}
      <Sidebar
        currentView={currentView}
        onNavigate={handleNavigate}
        selectedExam={currentExam}
        onSelectExam={setCurrentExam}
        darkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        unresolvedMistakesCount={unresolvedMistakes}
        srsDueCount={srsDue}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Sticky Top Clinical Header Bar */}
        <TopBar
          selectedExam={currentExam}
          onSearchSubmit={handleSearchSubmit}
          onNavigate={handleNavigate}
        />

        {/* Dynamic Canvas Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {readyNotice && currentView !== 'test-runner' && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3"
            >
              <span className="text-sm font-semibold text-slate-800">
                Your {readyNotice.count}-question module finished generating and is ready.
              </span>
              <span className="flex items-center gap-2">
                <button
                  onClick={() => handleNavigate('test-runner')}
                  className="rounded-lg bg-[#0f8b8d] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#00696b]"
                >
                  Open test
                </button>
                <button
                  onClick={() => setReadyNotice(null)}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Dismiss
                </button>
              </span>
            </div>
          )}
          {KEEP_ALIVE.filter((v) => mountedViews.includes(v) || v === currentView).map((v) => (
            <div key={v} className={v === currentView ? '' : 'hidden'}>
              {renderView(v)}
            </div>
          ))}
          {!KEEP_ALIVE.includes(currentView) && renderView(currentView)}
        </main>
      </div>

      {/* Background task registry banner (OCR, page notes, indexing) */}
      <JobsBanner />
    </div>
  );
}
