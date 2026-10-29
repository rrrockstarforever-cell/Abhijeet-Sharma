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

// ---------- multiple exam dates per exam ----------
// A single datetime picker cannot hold the real world: NEET-PG/INI-CET/AMC CAT run on
// several dates and shifts. Each exam keeps a list (exam.dates.<ID>) plus the one the
// learner is counting down to (exam.date.<ID>, the key the rest of the app already reads).

const loadStoredDateList = (storageKeys: string[], fallback: string): string[] => {
  for (const key of storageKeys) {
    const raw = localStorage.getItem(`exam.dates.${key.split('.').pop()}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter((v: unknown): v is string => typeof v === 'string' && !Number.isNaN(new Date(v).getTime()));
          if (clean.length) return clean;
        }
      } catch { /* old or corrupt value — fall through to the single date */ }
    }
  }
  return fallback ? [fallback] : [];
};

const toLocalInputValue = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Pull every date out of pasted text (notifications, "14 Jun 2026 / 15 Jun 2026", ISO, D/M/Y). */
export function parseExamDates(text: string): string[] {
  const found = new Map<string, string>();
  const push = (y: number, mo: number, d: number, hh = 9, mi = 0) => {
    const date = new Date(y, mo - 1, d, hh, mi);
    if (Number.isNaN(date.getTime()) || mo < 1 || mo > 12 || d < 1 || d > 31) return;
    if (date.getMonth() !== mo - 1) return; // e.g. 31 Feb
    const iso = toLocalInputValue(date.toISOString());
    if (iso) found.set(iso, iso);
  };

  // 2026-06-14 / 2026/06/14 / 2026-06-14T09:00
  for (const m of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/g)) {
    push(+m[1], +m[2], +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
  }
  // 14/06/2026 or 14-06-2026 (day first, as notices are written here)
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
    const a = +m[1];
    const b = +m[2];
    if (a > 31 || b > 12) continue;
    push(+m[3], b, a);
  }
  // 14 June 2026 / 14th Jun 2026
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(20\d{2})\b/g)) {
    const month = MONTH_NAMES.findIndex((name) => name.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (month >= 0) push(+m[3], month + 1, +m[1]);
  }

  return Array.from(found.values()).sort();
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
  const [examDates, setExamDates] = useState<Record<ExamType, string>>(() => ({
    NEET_PG: loadStoredExamDate(['exam.date.NEET_PG', 'exam.date.NEET-PG']),
    INI_CET: loadStoredExamDate(['exam.date.INI_CET', 'exam.date.INI-CET']),
    AMC_CAT: loadStoredExamDate(['exam.date.AMC_CAT', 'exam.date.AMC-CAT']),
  }));
  const [examDateLists, setExamDateLists] = useState<Record<ExamType, string[]>>(() => ({
    NEET_PG: loadStoredDateList(['exam.date.NEET_PG', 'exam.date.NEET-PG'], loadStoredExamDate(['exam.date.NEET_PG', 'exam.date.NEET-PG'])),
    INI_CET: loadStoredDateList(['exam.date.INI_CET', 'exam.date.INI-CET'], loadStoredExamDate(['exam.date.INI_CET', 'exam.date.INI-CET'])),
    AMC_CAT: loadStoredDateList(['exam.date.AMC_CAT', 'exam.date.AMC-CAT'], loadStoredExamDate(['exam.date.AMC_CAT', 'exam.date.AMC-CAT'])),
  }));

  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [editingExam, setEditingExam] = useState<ExamType | null>(null);
  const [tempDateInput, setTempDateInput] = useState<string>('');
  // Multi-date editor: draft list, the date counted down to, and the paste box.
  const [draftDates, setDraftDates] = useState<string[]>([]);
  const [draftSelected, setDraftSelected] = useState<string>('');
  const [pasteInput, setPasteInput] = useState<string>('');
  const [detectedNote, setDetectedNote] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const openEditor = (exam: (typeof EXAM_CARDS)[number]) => {
    const list = examDateLists[exam.id]?.length ? examDateLists[exam.id] : examDates[exam.id] ? [toLocalInputValue(examDates[exam.id])] : [];
    setDraftDates(list);
    setDraftSelected(examDates[exam.id] || list[0] || '');
    setTempDateInput('');
    setPasteInput('');
    setDetectedNote(null);
    setEditingExam(exam.id);
  };

  const addDraftDate = (value: string) => {
    const local = toLocalInputValue(value) || value;
    if (!local || Number.isNaN(new Date(local).getTime())) return;
    setDraftDates((prev) => (prev.includes(local) ? prev : [...prev, local].sort()));
    setDraftSelected((prev) => prev || local);
  };

  /** Detect every date in the pasted text and add them to the draft list. */
  const detectDates = (text: string) => {
    setPasteInput(text);
    const found = parseExamDates(text);
    if (!found.length) {
      setDetectedNote(text.trim() ? 'No date recognised in that text yet.' : null);
      return;
    }
    setDraftDates((prev) => Array.from(new Set([...prev, ...found])).sort());
    const future = found.find((d) => new Date(d).getTime() > Date.now());
    setDraftSelected((prev) => prev || future || found[0]);
    setDetectedNote(`${found.length} date${found.length === 1 ? '' : 's'} detected — pick the one you are counting down to.`);
  };

  const handleSaveExamDate = (examId: ExamType, storageKeys: string[]) => {
    const list = Array.from(new Set([...draftDates, ...(tempDateInput ? [tempDateInput] : [])])).sort();
    const selected = draftSelected && list.includes(draftSelected)
      ? draftSelected
      : tempDateInput || list[0] || '';
    const slug = storageKeys[0].split('.').pop() as string;
    localStorage.setItem(`exam.dates.${slug}`, JSON.stringify(list));
    storageKeys.forEach((k) => {
      if (selected) localStorage.setItem(k, selected);
      else localStorage.removeItem(k);
    });
    setExamDates((prev) => ({ ...prev, [examId]: selected }));
    setExamDateLists((prev) => ({ ...prev, [examId]: list }));
    setEditingExam(null);
    setDraftDates([]);
    setDraftSelected('');
    setPasteInput('');
    setTempDateInput('');
    setDetectedNote(null);
  };

  const handleClearExamDate = (examId: ExamType, storageKeys: string[]) => {
    const slug = storageKeys[0].split('.').pop() as string;
    localStorage.removeItem(`exam.dates.${slug}`);
    storageKeys.forEach((k) => localStorage.removeItem(k));
    setExamDates((prev) => ({ ...prev, [examId]: '' }));
    setExamDateLists((prev) => ({ ...prev, [examId]: [] }));
    setTempDateInput('');
    setDraftDates([]);
    setDraftSelected('');
    setPasteInput('');
    setEditingExam(null);
  };

  /** Switching which sitting/shift the countdown targets. */
  const selectExamDate = (examId: ExamType, storageKeys: string[], value: string) => {
    storageKeys.forEach((k) => {
      if (value) localStorage.setItem(k, value);
      else localStorage.removeItem(k);
    });
    setExamDates((prev) => ({ ...prev, [examId]: value }));
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
    { id: 'mistakes' as AppView, label: 'Mistakes & Spaced Review', icon: AlertOctagon, badge: srsDueCount > 0 ? `${srsDueCount} due` : unresolvedMistakesCount > 0 ? String(unresolvedMistakesCount) : undefined },
    { id: 'highlights' as AppView, label: 'Highlights & Memory', icon: Bookmark },
    { id: 'ai-tutor' as AppView, label: 'Clinical AI Tutor', icon: Brain },
    { id: 'pdf-reader' as AppView, label: 'PDF Reader & OCR', icon: BookOpen },
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
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1">
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
      <div className="px-3 pb-2 shrink-0 max-h-[52vh] overflow-y-auto">
        <div className="flex items-center justify-between px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 bg-[#001432] pb-1 z-10">
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
                        openEditor(exam);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700/60 transition-colors"
                    title={dateVal ? "Edit exam dates" : "Set exam date"}
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
                    <div className="flex items-center gap-1">
                      <input
                        type="datetime-local"
                        value={tempDateInput}
                        onChange={(e) => setTempDateInput(e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] text-white focus:outline-none focus:border-[#0f8b8d]"
                      />
                      <button
                        type="button"
                        onClick={() => { addDraftDate(tempDateInput); setTempDateInput(''); }}
                        disabled={!tempDateInput}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[10px] font-bold text-[#8ff3f4]"
                      >
                        Add
                      </button>
                    </div>

                    {/* Paste a notification / list of dates: every date is detected. */}
                    <input
                      type="text"
                      value={pasteInput}
                      onChange={(e) => detectDates(e.target.value)}
                      placeholder="Paste dates or exam notice…"
                      className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-white placeholder:text-slate-500 focus:outline-none focus:border-[#0f8b8d]"
                    />

                    {draftDates.length > 0 && (
                      <div className="space-y-1">
                        <select
                          value={draftSelected}
                          onChange={(e) => setDraftSelected(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-white focus:outline-none focus:border-[#0f8b8d]"
                        >
                          {draftDates.map((d) => (
                            <option key={d} value={d}>
                              {new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap gap-1">
                          {draftDates.map((d) => (
                            <span
                              key={d}
                              className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                draftSelected === d
                                  ? 'bg-[#0f8b8d]/30 text-[#8ff3f4] border-[#0f8b8d]/50'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              {new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                              <button
                                type="button"
                                onClick={() => {
                                  setDraftDates((prev) => prev.filter((x) => x !== d));
                                  if (draftSelected === d) setDraftSelected('');
                                }}
                                className="hover:text-rose-400"
                                title="Remove this date"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {detectedNote && (
                      <p className="text-[9px] text-[#8ff3f4] leading-snug">{detectedNote}</p>
                    )}

                    <div className="flex items-center justify-between text-[10px]">
                      <button
                        type="button"
                        onClick={() => handleClearExamDate(exam.id, exam.storageKeys)}
                        className="text-slate-400 hover:text-rose-400 px-1 py-0.5"
                      >
                        Clear all
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
                          openEditor(exam);
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
                            openEditor(exam);
                          }}
                          className="text-[10px] text-slate-400 hover:text-white underline"
                        >
                          Update
                        </button>
                      </div>
                    )}

                    {countdown.status === 'ACTIVE' && (
                      <div>
                        <div className="font-mono font-bold text-xs text-white tracking-wide">
                          {countdown.text}
                        </div>
                        {/* More than one sitting/shift: choose which date to count down to. */}
                        {(examDateLists[exam.id]?.length ?? 0) > 1 ? (
                          <select
                            value={dateVal}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => selectExamDate(exam.id, exam.storageKeys, e.target.value)}
                            className="mt-1 w-full px-1.5 py-0.5 bg-slate-900/80 border border-slate-700 rounded text-[10px] text-slate-200 focus:outline-none focus:border-[#0f8b8d]"
                            title="Choose which exam date to count down to"
                          >
                            {examDateLists[exam.id].map((d) => (
                              <option key={d} value={d}>
                                {new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-[9px] text-slate-400 font-mono">
                            {new Date(dateVal).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                          </div>
                        )}
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
