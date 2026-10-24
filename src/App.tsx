import React, { useState, useEffect } from 'react';
import { AppView, ExamType, DifficultyTier, DifficultySubLevel, ClinicalQuestion } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { PerformanceAnalyticsView } from './components/PerformanceAnalyticsView.tsx';
import { MistakeNotebookView } from './components/MistakeNotebookView.tsx';
import { HighlightsSavedView } from './components/HighlightsSavedView.tsx';
import { SettingsAIView } from './components/SettingsAIView.tsx';
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

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('analytics');
  const [currentExam, setCurrentExam] = useState<ExamType>('INI_CET');
  const [activeQuestionId, setActiveQuestionId] = useState<string>('');
  const [activeTestQuestions, setActiveTestQuestions] = useState<ClinicalQuestion[] | undefined>(undefined);
  const [activeTestMode, setActiveTestMode] = useState<'EXAM' | 'TUTOR'>('TUTOR');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  // Bumped whenever a store writes, so the sidebar badges stay truthful.
  const [, setDataVersion] = useState(0);
  useEffect(() => subscribeDataChanged(() => setDataVersion((v) => v + 1)), []);

  // Real sidebar badges: captured-but-unresolved mistakes and cards due now.
  const unresolvedMistakes = listCapturedQuestions().filter((q) => q.status === 'unresolved').length;
  const srsDue = dueCount();

  const handleNavigate = (view: AppView, targetId?: string) => {
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
    setCurrentView('test-runner');
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

  const renderActiveView = () => {
    switch (currentView) {
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
          {renderActiveView()}
        </main>
      </div>

      {/* Background task registry banner (OCR, page notes, indexing) */}
      <JobsBanner />
    </div>
  );
}
