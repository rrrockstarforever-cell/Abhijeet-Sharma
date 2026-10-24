import React, { useState, useEffect } from 'react';
import {
  Activity,
  BookOpen,
  Cpu,
  Brain,
  Layers,
  FileQuestion,
  Timer,
  AlertOctagon,
  BarChart3,
  Bookmark,
  Compass,
  Sliders,
  Moon,
  Sun,
  ShieldCheck,
  FileText,
  UploadCloud,
  Calendar,
  Database
} from 'lucide-react';
import { AppView, ExamType } from '../types.ts';

interface SidebarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  selectedExam: ExamType;
  onSelectExam: (exam: ExamType) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  unresolvedMistakesCount: number;
  srsDueCount: number;
}

const EXAM_CARDS: { id: ExamType; label: string; storageKeys: string[] }[] = [
  { id: 'NEET_PG', label: 'NEET-PG', storageKeys: ['exam.date.NEET_PG', 'exam.date.NEET-PG'] },
  { id: 'INI_CET', label: 'INI-CET', storageKeys: ['exam.date.INI_CET', 'exam.date.INI-CET'] },
  { id: 'AMC_CAT', label: 'AMC CAT', storageKeys: ['exam.date.AMC_CAT', 'exam.date.AMC-CAT'] },
];

const loadStoredExamDate = (storageKeys: string[]): string => {
  for (const k of storageKeys) {
    const val = localStorage.getItem(k);
    if (val) return val;
  }
  return '';
};

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  selectedExam,
  onSelectExam,
  darkMode,
  onToggleDarkMode,
  unresolvedMistakesCount,
  srsDueCount,
}) => {
  const [examDates, setExamDates] = useState<Record<ExamType, string>>(() => ({
    NEET_PG: loadStoredExamDate(['exam.date.NEET_PG', 'exam.date.NEET-PG']),
    INI_CET: loadStoredExamDate(['exam.date.INI_CET', 'exam.date.INI-CET']),
    AMC_CAT: loadStoredExamDate(['exam.date.AMC_CAT', 'exam.date.AMC-CAT']),
  }));

  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [editingExam, setEditingExam] = useState<ExamType | null>(null);
  const [tempDateInput, setTempDateInput] = useState<string>('');

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSaveExamDate = (examId: ExamType, storageKeys: string[]) => {
    const trimmed = tempDateInput.trim();
    storageKeys.forEach(k => {
      if (trimmed) {
        localStorage.setItem(k, trimmed);
      } else {
        localStorage.removeItem(k);
      }
    });
    setExamDates(prev => ({ ...prev, [examId]: trimmed }));
    setEditingExam(null);
  };

  const handleClearExamDate = (examId: ExamType, storageKeys: string[]) => {
    storageKeys.forEach(k => localStorage.removeItem(k));
    setExamDates(prev => ({ ...prev, [examId]: '' }));
    setTempDateInput('');
    setEditingExam(null);
  };

  const getCountdown = (dateString: string) => {
    if (!dateString) return { status: 'UNSET' as const, text: 'Set exam date' };
    const target = new Date(dateString).getTime();
    if (isNaN(target)) return { status: 'UNSET' as const, text: 'Set exam date' };
    const diff = target - nowMs;
    if (diff <= 0) return { status: 'PASSED' as const, text: 'Exam date passed' };

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return {
      status: 'ACTIVE' as const,
      text: `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`,
    };
  };

  const navItems = [
    { id: 'analytics' as AppView, label: 'Performance Analytics', icon: BarChart3 },
    { id: 'practice' as AppView, label: 'Practice Builder', icon: FileQuestion },
    { id: 'question-bank' as AppView, label: 'Question Bank', icon: Database },
    { id: 'test-runner' as AppView, label: 'Active Test Runner', icon: Timer, badge: 'Live' },
    { id: 'mistakes' as AppView, label: 'Mistake Notebook', icon: AlertOctagon, badge: unresolvedMistakesCount > 0 ? String(unresolvedMistakesCount) : undefined },
    { id: 'highlights' as AppView, label: 'Flashcards & Memory', icon: Bookmark, badge: srsDueCount > 0 ? `${srsDueCount} Due` : undefined },
    { id: 'ai-tutor' as AppView, label: 'Clinical AI Tutor', icon: Brain },
    { id: 'pdf-reader' as AppView, label: 'PDF Reader & SIMD OCR', icon: BookOpen, badge: '12W' },
    { id: 'research' as AppView, label: 'Clinical Evidence Browser', icon: Compass },
    { id: 'settings' as AppView, label: 'AI Subscriptions & OCR', icon: Sliders },
  ];

  return (
    <aside className="w-64 bg-[#001432] text-slate-200 flex flex-col shrink-0 border-r border-[#13294b] h-screen select-none z-20">
      {/* Brand Header */}
      <div className="p-5 pb-4 border-b border-[#13294b]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0f8b8d] to-[#8ff3f4] flex items-center justify-center text-[#001432] shadow-sm font-black text-lg">
            P
          </div>
          <div>
            <div className="text-sm font-extrabold tracking-tight text-white flex items-center gap-1.5">
              <span>PULSE MED</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#0f8b8d]/20 text-[#8ff3f4] rounded border border-[#0f8b8d]/30">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Postgraduate Exam Engine</p>
          </div>
        </div>

        {/* 3-Way Exam Switcher (USMLE Removed) */}
        <div className="mt-4 p-1 bg-[#13294b] rounded-xl flex items-center justify-between text-[11px] font-bold">
          <button
            onClick={() => onSelectExam('NEET_PG')}
            className={`flex-1 py-1.5 rounded-lg transition-all text-center ${
              selectedExam === 'NEET_PG'
                ? 'bg-[#0f8b8d] text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            NEET-PG
          </button>
          <button
            onClick={() => onSelectExam('INI_CET')}
            className={`flex-1 py-1.5 rounded-lg transition-all text-center ${
              selectedExam === 'INI_CET'
                ? 'bg-[#0f8b8d] text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            INI-CET
          </button>
          <button
            onClick={() => onSelectExam('AMC_CAT')}
            className={`flex-1 py-1.5 rounded-lg transition-all text-center ${
              selectedExam === 'AMC_CAT'
                ? 'bg-[#0f8b8d] text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            AMC CAT
          </button>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                isActive
                  ? 'bg-gradient-to-r from-[#0f8b8d] to-[#00696b] text-white shadow-md'
                  : 'text-slate-300 hover:bg-[#13294b]/70 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-[#8ff3f4]' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </div>

              {item.badge && (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : item.badge.includes('Due') || item.badge === 'Live'
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                        : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Real Live Countdown Cards per Exam */}
      <div className="px-3 pb-2 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-[#0f8b8d]" />
            Exam Countdowns
          </span>
          <span className="text-[9px] font-mono text-[#8ff3f4]">Live</span>
        </div>

        <div className="space-y-1.5">
          {EXAM_CARDS.map((exam) => {
            const isSelected = selectedExam === exam.id;
            const dateVal = examDates[exam.id];
            const countdown = getCountdown(dateVal);
            const isEditing = editingExam === exam.id;

            return (
              <div
                key={exam.id}
                onClick={() => {
                  if (!isEditing && selectedExam !== exam.id) {
                    onSelectExam(exam.id);
                  }
                }}
                className={`p-2.5 rounded-xl border text-xs transition-all ${
                  isSelected
                    ? 'bg-gradient-to-br from-[#0f8b8d]/25 to-[#13294b] border-[#0f8b8d] ring-1 ring-[#0f8b8d]/50 shadow-xs'
                    : 'bg-[#13294b]/40 hover:bg-[#13294b]/70 border-slate-700/60 text-slate-300'
                }`}
              >
                {/* Header: Exam Title & Selected Badge */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold text-xs ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {exam.label}
                    </span>
                    {isSelected && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 bg-[#0f8b8d]/30 text-[#8ff3f4] rounded border border-[#0f8b8d]/40">
                        Selected
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isEditing) {
                        setEditingExam(null);
                      } else {
                        setTempDateInput(dateVal);
                        setEditingExam(exam.id);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700/60 transition-colors"
                    title={dateVal ? "Edit exam date" : "Set exam date"}
                  >
                    <Calendar className="w-3 h-3" />
                  </button>
                </div>

                {/* Inline Editing Form */}
                {isEditing ? (
                  <div 
                    onClick={(e) => e.stopPropagation()} 
                    className="mt-1.5 pt-1.5 border-t border-slate-700/60 space-y-2"
                  >
                    <input
                      type="datetime-local"
                      value={tempDateInput}
                      onChange={(e) => setTempDateInput(e.target.value)}
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] text-white focus:outline-none focus:border-[#0f8b8d]"
                    />
                    <div className="flex items-center justify-between text-[10px]">
                      <button
                        type="button"
                        onClick={() => handleClearExamDate(exam.id, exam.storageKeys)}
                        className="text-slate-400 hover:text-rose-400 px-1 py-0.5"
                      >
                        Clear
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingExam(null)}
                          className="px-2 py-0.5 text-slate-300 hover:text-white rounded bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveExamDate(exam.id, exam.storageKeys)}
                          className="px-2 py-0.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white font-bold rounded"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Display: Live Countdown / Set exam date / Exam date passed */
                  <div>
                    {countdown.status === 'UNSET' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTempDateInput('');
                          setEditingExam(exam.id);
                        }}
                        className="mt-0.5 text-[11px] font-semibold text-[#8ff3f4] hover:underline flex items-center gap-1"
                      >
                        <Calendar className="w-3 h-3" />
                        <span>Set exam date</span>
                      </button>
                    )}

                    {countdown.status === 'PASSED' && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-rose-400">Exam date passed</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTempDateInput(dateVal);
                            setEditingExam(exam.id);
                          }}
                          className="text-[10px] text-slate-400 hover:text-white underline"
                        >
                          Update
                        </button>
                      </div>
                    )}

                    {countdown.status === 'ACTIVE' && (
                      <div className="font-mono font-bold text-xs text-white tracking-wide">
                        {countdown.text}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Controls: Dark Mode Toggle */}
      <div className="p-3 border-t border-[#13294b] flex items-center justify-between text-xs text-slate-400 shrink-0">
        <span className="text-[11px] font-mono text-slate-500">Board Exam Engine</span>

        <button
          onClick={onToggleDarkMode}
          className="p-1.5 rounded-lg bg-[#13294b] hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          title="Toggle Dark Mode"
        >
          {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-300" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>
    </aside>
  );
};
