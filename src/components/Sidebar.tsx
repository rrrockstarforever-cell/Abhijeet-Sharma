import React from 'react';
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
  UploadCloud
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
  const navItems = [
    { id: 'analytics' as AppView, label: 'Performance Analytics', icon: BarChart3 },
    { id: 'practice' as AppView, label: 'Practice Builder', icon: FileQuestion },
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

      {/* Target Exam Milestone Countdown */}
      <div className="p-4 mx-3 mb-3 rounded-2xl bg-gradient-to-br from-[#13294b] to-[#001432] border border-slate-700/60 text-xs">
        <div className="flex items-center justify-between text-slate-300 mb-1">
          <span className="font-bold text-[#8ff3f4] uppercase tracking-wider text-[10px]">
            {selectedExam.replace('_', '-')} TARGET
          </span>
          <span className="text-[10px] font-mono text-slate-400">Nov Cycle</span>
        </div>
        <div className="text-white font-extrabold text-sm flex items-center justify-between">
          <span>58 Days Remaining</span>
          <span className="text-emerald-400 font-mono text-xs">76% Ready</span>
        </div>
      </div>

      {/* Footer Controls: Dark Mode Toggle & HIPAA Status */}
      <div className="p-3 border-t border-[#13294b] flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-mono">100% HIPAA Private</span>
        </div>

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
