import React, { useState, useEffect, useRef } from 'react';
import { Search, Bell, Gauge, User, CheckCircle2, AlertCircle } from 'lucide-react';
import { AppView, ExamType } from '../types.ts';

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const clean = trimmed.replace(/^dr\.?\s+/i, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return trimmed.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

interface TopBarProps {
  onSearchSubmit: (query: string) => void;
  selectedExam: ExamType;
  onNavigate: (view: AppView) => void;
  mockPace?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  onSearchSubmit,
  selectedExam,
  onNavigate,
  mockPace = '-',
}) => {
  const [searchVal, setSearchVal] = useState('');
  const [showNotificationToast, setShowNotificationToast] = useState(false);
  
  // Profile state backed by localStorage 'profile.name'
  const [profileName, setProfileName] = useState<string>(() => {
    return localStorage.getItem('profile.name') || '';
  });
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(false);
  const [nameInput, setNameInput] = useState<string>('');
  const profileEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleStorage = () => {
      setProfileName(localStorage.getItem('profile.name') || '');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileEditorRef.current && !profileEditorRef.current.contains(event.target as Node)) {
        setIsEditingProfile(false);
      }
    };
    if (isEditingProfile) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditingProfile]);

  const handleOpenEditor = () => {
    setNameInput(profileName);
    setIsEditingProfile(true);
  };

  const handleSaveProfile = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed) {
      localStorage.setItem('profile.name', trimmed);
      setProfileName(trimmed);
    } else {
      localStorage.removeItem('profile.name');
      setProfileName('');
    }
    setIsEditingProfile(false);
  };

  const handleClearProfile = () => {
    localStorage.removeItem('profile.name');
    setProfileName('');
    setNameInput('');
    setIsEditingProfile(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      onSearchSubmit(searchVal);
      onNavigate('pdf-reader');
    }
  };

  return (
    <header className="h-14 bg-white border-b border-[#e3e7ee] px-5 flex items-center justify-between gap-4 shrink-0 shadow-xs z-10">
      {/* Global Clinical Search Bar */}
      <div className="flex-1 max-w-2xl relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchVal}
          onChange={(e) => setSearchVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search diseases, high-yield clinical stems, Harrison / Robbins references..."
          className="w-full pl-9 pr-16 py-1.5 bg-[#f6f7f9] border border-[#e3e7ee] rounded-lg text-xs text-[#1c2430] placeholder-slate-400 focus:outline-none focus:border-[#0f8b8d] focus:bg-white transition-all"
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white border border-[#e3e7ee] rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right Tools & Profile Lockup */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Mock Pace Tracker */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#e3f4f4] text-[#007072] text-xs font-semibold border border-[#8ff3f4]">
          <Gauge className="w-3.5 h-3.5 text-[#0f8b8d]" />
          <span>Mock Pace</span>
          <span className="font-mono font-bold text-[#13294b]">{mockPace}</span>
        </div>

        {/* Notifications Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotificationToast(!showNotificationToast)}
            className="p-1.5 text-slate-500 hover:text-[#13294b] rounded-lg hover:bg-slate-100 relative transition-colors"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="w-2 h-2 rounded-full bg-[#d64545] absolute top-1 right-1"></span>
          </button>

          {showNotificationToast && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border border-[#e3e7ee] p-3 text-xs z-50 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 font-semibold text-slate-800">
                <span>Clinical Alerts</span>
                <span className="text-[10px] text-teal-600 font-normal">Mark all read</span>
              </div>
              <div className="space-y-2 text-slate-600">
                <div className="p-2 rounded bg-amber-50/60 border border-amber-100 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800">7 SRS Cards Overdue</span>
                    <p className="text-[11px] text-slate-500">Lambert-Eaton vs Myasthenia antibodies interval expired.</p>
                  </div>
                </div>
                <div className="p-2 rounded bg-emerald-50/60 border border-emerald-100 flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800">New INI-CET Question Bank Synced</span>
                    <p className="text-[11px] text-slate-500">24 new AI clinical vignettes added across Antimicrobial Resistance.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Lockup & Inline Editor */}
        <div className="relative pl-3 border-l border-slate-200">
          <button
            type="button"
            onClick={handleOpenEditor}
            className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-slate-100 transition-colors group text-left"
            title="Click to edit profile name"
          >
            <div className="text-right hidden md:block">
              {profileName ? (
                <div className="font-bold text-xs text-[#13294b] leading-tight group-hover:text-[#0f8b8d] transition-colors">
                  {profileName}
                </div>
              ) : (
                <div className="text-xs font-semibold text-[#0f8b8d] hover:underline">
                  Add your name
                </div>
              )}
            </div>

            <div className="w-8 h-8 rounded-full bg-[#13294b] text-[#8ff3f4] font-bold text-xs flex items-center justify-center ring-2 ring-[#e3f4f4] group-hover:ring-[#8ff3f4] transition-all">
              {profileName ? (
                getInitials(profileName)
              ) : (
                <User className="w-4 h-4 text-[#8ff3f4]" />
              )}
            </div>
          </button>

          {/* Inline Profile Editor Popover */}
          {isEditingProfile && (
            <div
              ref={profileEditorRef}
              className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50 animate-in fade-in slide-in-from-top-1"
            >
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800">Edit Profile Name</span>
                <button
                  type="button"
                  onClick={() => setIsEditingProfile(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Your Name:
                  </label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="e.g. Dr. Jane Smith"
                    autoFocus
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-[#0f8b8d] focus:ring-1 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={handleClearProfile}
                    className="px-2.5 py-1 text-xs font-semibold text-slate-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                  >
                    Clear
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className="px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
