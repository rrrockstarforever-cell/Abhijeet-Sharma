import React, { useState } from 'react';
import { 
  Bookmark, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  Sparkles, 
  Brain, 
  AlertTriangle, 
  CheckCircle2, 
  BookOpen, 
  Clock, 
  Share2, 
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Layers,
  ArrowRight
} from 'lucide-react';
import { SavedHighlight, AppView } from '../types.ts';
import { MOCK_HIGHLIGHTS } from '../data/mockClinicalData.ts';

interface HighlightsSavedViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
}

export const HighlightsSavedView: React.FC<HighlightsSavedViewProps> = ({ onNavigate }) => {
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeDeckRating, setActiveDeckRating] = useState<string | null>(null);
  const [customPearlText, setCustomPearlText] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  const filteredHighlights = MOCK_HIGHLIGHTS.filter(h => {
    if (selectedTag !== 'ALL' && !h.tags.includes(selectedTag)) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        h.subject.toLowerCase().includes(q) ||
        h.subtopic.toLowerCase().includes(q) ||
        h.quote.toLowerCase().includes(q) ||
        (h.memoryAnchor && h.memoryAnchor.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Bookmark className="w-3.5 h-3.5" />
              RAG Knowledge Base & Syn-Highlights
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Clinical Highlights & Memory Anchors Repository
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Organize, anchor, and test high-yield board pearls, microbial resistance visualizers, and textbook excerpts extracted across 42 reference volumes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => alert('Anki deck .apkg file package exported with 142 Cloze-deletion cards.')}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl border border-slate-700 transition-colors"
            >
              <Download className="w-4 h-4 text-slate-300" />
              Export Anki Deck (.apkg)
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-semibold rounded-xl shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Add Clinical Pearl
            </button>
          </div>
        </div>

        {/* Filter Bar & Search */}
        <div className="mt-6 pt-5 border-t border-slate-700/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: 'ALL', label: 'All Highlights (142)' },
              { id: 'Antimicrobials', label: 'Antimicrobials (38)' },
              { id: 'Histopathology', label: 'Pathology IBQ (29)' },
              { id: 'Cardiology', label: 'Cardiology (18)' },
              { id: 'Pediatrics', label: 'Pediatrics (14)' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSelectedTag(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedTag === tab.id
                    ? 'bg-[#0f8b8d] text-white shadow-sm'
                    : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search concepts or drugs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#0f8b8d]"
            />
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Highlights Cards */}
        <div className="lg:col-span-8 space-y-6">
          {filteredHighlights.map((highlight) => (
            <div 
              key={highlight.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:border-slate-300 transition-all"
            >
              {/* Card Header */}
              <div className="p-6 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#0f8b8d]/10 text-[#0f8b8d] uppercase tracking-wide">
                      {highlight.subject}
                    </span>
                    <span className="text-xs font-semibold text-slate-700">
                      {highlight.subtopic}
                    </span>
                  </div>

                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 uppercase tracking-wider">
                    {highlight.yieldTier}
                  </span>
                </div>

                {/* Source Citation */}
                <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-4">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  <span>{highlight.citation}</span>
                </div>

                {/* Quote Box */}
                <div className="p-4 rounded-xl bg-slate-50 border-l-4 border-[#0f8b8d] text-slate-800 text-xs leading-relaxed font-sans italic">
                  "{highlight.quote}"
                </div>

                {/* Embedded Histopathology Image if present */}
                {highlight.id === 'HL-PA-088' && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
                    <img 
                      src="/assets/aistudio/Image_9_fc76a8d4.jpeg" 
                      alt="Glomerular Crescent" 
                      className="w-36 h-24 object-cover rounded-lg border border-slate-300 shadow-sm"
                    />
                    <div className="text-xs text-slate-700 leading-relaxed">
                      <div className="font-bold text-slate-900 mb-1">
                        Silver Methenamine (Jones) Histopathology Key:
                      </div>
                      Cellular crescent compressing glomerular tuft. Note the ruptured basement membrane (black outline) with intense parietal epithelial cell proliferation. Non-specific faint IF indicates Pauci-Immune RPGN (c-ANCA PR3).
                    </div>
                  </div>
                )}

                {/* Memory Anchor Box */}
                {highlight.memoryAnchor && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50/80 border border-amber-200">
                    <div className="flex items-start gap-2.5">
                      <Brain className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                          Dr. Sharma's Memory Anchor & Rapid Recall Mnemonic:
                        </div>
                        <p className="text-xs text-amber-800 font-medium mt-1 leading-relaxed">
                          {highlight.memoryAnchor}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Microbial Mechanism Visualizer Box if available */}
                {highlight.visualizer && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-900 text-white font-mono text-xs">
                    <div className="text-[#8ff3f4] font-bold text-[11px] uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5" /> {highlight.visualizer.title}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-slate-300">
                      <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700">
                        <span className="text-emerald-400 font-bold block mb-1">Susceptible / Active:</span>
                        {highlight.visualizer.susceptible}
                      </div>
                      <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700">
                        <span className="text-rose-400 font-bold block mb-1">Resistant Phenotypes:</span>
                        {highlight.visualizer.resistant}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-400">
                      Note: {highlight.visualizer.note}
                    </div>
                  </div>
                )}

                {/* Board Trap Alert Box */}
                {highlight.boardTrapAlert && (
                  <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-rose-900 uppercase tracking-wider text-[11px]">Board Trap Warning: </span>
                      <span className="text-rose-800 font-medium leading-relaxed">{highlight.boardTrapAlert}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Card Footer */}
              <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-500 font-medium">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Next SRS review in {highlight.srsIntervalDays} days · Last checked {highlight.lastReviewed}</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onNavigate('ai-tutor')}
                    className="text-slate-600 hover:text-[#0f8b8d] font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Ask AI Tutor
                  </button>
                  <button
                    onClick={() => onNavigate('test-runner', highlight.id === 'HL-PA-088' ? 'Q-PA-1049' : 'Q10')}
                    className="text-[#0f8b8d] hover:text-[#00696b] font-bold flex items-center gap-1 transition-colors"
                  >
                    Drill in Test <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right Column: Interactive Leitner SRS Repetition Card & Quick Capture */}
        <div className="lg:col-span-4 space-y-6">
          {/* Spaced Repetition Interactive Card */}
          <div className="bg-gradient-to-br from-[#001432] to-[#13294b] text-white rounded-2xl p-5 border border-[#13294b] shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#8ff3f4] font-bold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Leitner Review Card
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                Card 3 of 7
              </span>
            </div>

            <div className="mt-3 p-3.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs">
              <div className="text-amber-400 font-bold mb-1">Target Prompt:</div>
              <p className="text-slate-200 leading-relaxed font-medium">
                Why does Teicoplanin remain active against VanB Enterococci, but fails against VanA strains?
              </p>
            </div>

            <div className="mt-4">
              <div className="text-[11px] text-slate-400 mb-2 font-medium">Rate recall difficulty to set SRS interval:</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => setActiveDeckRating('AGAIN')}
                  className={`py-2 px-2.5 rounded-xl border text-center font-bold transition-all ${
                    activeDeckRating === 'AGAIN'
                      ? 'bg-rose-500 border-rose-400 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-rose-300 hover:bg-slate-800'
                  }`}
                >
                  Again <span className="text-[10px] block font-normal opacity-80">&lt;10 min</span>
                </button>
                <button
                  onClick={() => setActiveDeckRating('HARD')}
                  className={`py-2 px-2.5 rounded-xl border text-center font-bold transition-all ${
                    activeDeckRating === 'HARD'
                      ? 'bg-amber-500 border-amber-400 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-amber-300 hover:bg-slate-800'
                  }`}
                >
                  Hard <span className="text-[10px] block font-normal opacity-80">1 day</span>
                </button>
                <button
                  onClick={() => setActiveDeckRating('GOOD')}
                  className={`py-2 px-2.5 rounded-xl border text-center font-bold transition-all ${
                    activeDeckRating === 'GOOD'
                      ? 'bg-sky-500 border-sky-400 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-sky-300 hover:bg-slate-800'
                  }`}
                >
                  Good <span className="text-[10px] block font-normal opacity-80">3 days</span>
                </button>
                <button
                  onClick={() => setActiveDeckRating('EASY')}
                  className={`py-2 px-2.5 rounded-xl border text-center font-bold transition-all ${
                    activeDeckRating === 'EASY'
                      ? 'bg-emerald-500 border-emerald-400 text-white'
                      : 'bg-slate-800/60 border-slate-700 text-emerald-300 hover:bg-slate-800'
                  }`}
                >
                  Easy <span className="text-[10px] block font-normal opacity-80">7 days</span>
                </button>
              </div>
            </div>

            {activeDeckRating && (
              <div className="mt-3.5 p-2 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] text-center font-semibold">
                ✓ Interval updated to {activeDeckRating === 'EASY' ? '7 days' : activeDeckRating === 'GOOD' ? '3 days' : '1 day'}. Next card loaded.
              </div>
            )}
          </div>

          {/* Quick Capture Form */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#0f8b8d]" /> Quick Pearl Capture
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste or type high-yield board facts from bedside rounds or mock tests
            </p>

            <div className="mt-3 space-y-3">
              <textarea
                value={customPearlText}
                onChange={e => setCustomPearlText(e.target.value)}
                placeholder="e.g. Linezolid causes bone marrow suppression & weak reversible MAO inhibition (risk of serotonin syndrome with SSRIs)..."
                rows={3}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-mono">Auto-categorized by AI</span>
                <button
                  onClick={() => {
                    if (customPearlText.trim()) {
                      alert('Pearl anchored to RAG index and added to Spaced Repetition deck.');
                      setCustomPearlText('');
                    }
                  }}
                  className="px-3.5 py-1.5 bg-[#001432] hover:bg-[#13294b] text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Save Pearl
                </button>
              </div>
            </div>
          </div>

          {/* Highlights Breakdown */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#0f8b8d]" /> Study Deck Retention Status
            </h3>

            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-xl font-mono font-bold text-slate-900">142</div>
                <div className="text-[11px] text-slate-500 mt-0.5 font-medium">Total Anchors</div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="text-xl font-mono font-bold text-emerald-700">89</div>
                <div className="text-[11px] text-emerald-600 mt-0.5 font-medium">Mastered (&gt;21d)</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <div className="text-xl font-mono font-bold text-amber-700">34</div>
                <div className="text-[11px] text-amber-600 mt-0.5 font-medium">In Active Review</div>
              </div>
              <div className="p-3 rounded-xl bg-sky-50 border border-sky-100">
                <div className="text-xl font-mono font-bold text-sky-700">19</div>
                <div className="text-[11px] text-sky-600 mt-0.5 font-medium">New This Week</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Add New Clinical Highlight</h3>
            <p className="text-xs text-slate-500 mt-1">Anchor a high-yield concept directly into your RAG memory bank.</p>
            
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Subject</label>
                <input type="text" defaultValue="PHARMACOLOGY" className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Concept / Title</label>
                <input type="text" placeholder="e.g. Daptomycin Surfactant Inactivation" className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Memory Anchor / Board Trap Note</label>
                <textarea rows={3} placeholder="Key high yield point..." className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50" />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  alert('Highlight saved and indexed!');
                  setShowAddModal(false);
                }}
                className="px-4 py-2 text-xs font-semibold bg-[#0f8b8d] text-white rounded-lg hover:bg-[#00696b]"
              >
                Save & Index
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
