// Clinical Evidence Browser — REAL web research.
// Queries POST /api/web/research (server-side DuckDuckGo + PubMed, see server/web.mjs).
// "Ask AI about these results" summarises ONLY the returned sources via /api/ai/complete.
// No canned results anywhere; every failure is surfaced.
import React, { useState, useRef, useEffect } from 'react';
import {
  Globe,
  Search,
  BookOpen,
  ExternalLink,
  FileText,
  Copy,
  Check,
  Sparkles,
  ShieldCheck,
  Clock,
  Layers,
  AlertCircle,
  Loader2,
  X,
  StickyNote,
  Plus,
  Trash2
} from 'lucide-react';
import { AppView } from '../types.ts';
import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from '../lib/ai.ts';

interface ClinicalBrowserViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
}

interface ResearchSource {
  n: number;
  title: string;
  url: string;
  text: string;
  kind: 'web' | 'pubmed';
}

interface ScratchNote {
  id: string;
  title: string;
  url?: string;
  text: string;
  addedAt: string;
}

const SCRATCH_KEY = 'pulse.research.scratchpad.v1';

function loadScratch(): ScratchNote[] {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ScratchNote[]) : [];
  } catch {
    return [];
  }
}

export const ClinicalBrowserView: React.FC<ClinicalBrowserViewProps> = ({ onNavigate }) => {
  const [query, setQuery] = useState<string>(() => {
    // The global header search hands its query over through sessionStorage.
    try {
      const handoff = sessionStorage.getItem('pulse.research.query');
      if (handoff) {
        sessionStorage.removeItem('pulse.research.query');
        return handoff;
      }
    } catch { /* storage unavailable */ }
    return '';
  });
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** the query the visible sources actually came from (the input can be edited afterwards) */
  const [searchedQuery, setSearchedQuery] = useState<string>('');

  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiBusy, setAiBusy] = useState<boolean>(false);
  const engineLabel = (() => {
    const p = getActiveProvider();
    return p ? `${p} · ${getEffectiveModel(p)}` : 'inactive';
  })();
  const [aiError, setAiError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ----- research scratchpad (PARITY section 12): saved notes, separate from results -----
  const [scratch, setScratch] = useState<ScratchNote[]>(() => loadScratch());
  const [showScratch, setShowScratch] = useState<boolean>(false);
  const [scratchText, setScratchText] = useState<string>('');

  const persistScratch = (list: ScratchNote[]) => {
    setScratch(list);
    try { localStorage.setItem(SCRATCH_KEY, JSON.stringify(list)); } catch { /* full */ }
  };

  const captureSourceToScratch = (s: ResearchSource) => {
    persistScratch([
      { id: `sn-${Date.now().toString(36)}`, title: s.title, url: s.url, text: s.text.slice(0, 800), addedAt: new Date().toISOString() },
      ...scratch,
    ]);
    setShowScratch(true);
  };

  const addManualScratchNote = () => {
    const text = scratchText.trim();
    if (!text) return;
    persistScratch([{ id: `sn-${Date.now().toString(36)}`, title: 'Manual note', text, addedAt: new Date().toISOString() }, ...scratch]);
    setScratchText('');
  };

  const deleteScratchNote = (id: string) => persistScratch(scratch.filter((n) => n.id !== id));
  const copyScratch = () => {
    navigator.clipboard.writeText(
      scratch.map((n) => `- ${n.title}${n.url ? ` (${n.url})` : ''}\n${n.text}`).join('\n\n')
    );
    setCopied('scratch');
    setTimeout(() => setCopied(null), 1500);
  };

  const runResearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    setSources([]);
    setAiSummary('');
    setAiError(null);
    setRetrievedAt(null);
    try {
      const res = await fetch('/api/web/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Research failed (HTTP ${res.status}).`);
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setRetrievedAt(typeof data.retrievedAt === 'string' ? data.retrievedAt : null);
      setSearchedQuery(q);
    } catch (err: any) {
      setSearchError(err?.message || 'Network request failed. Check your connection.');
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') runResearch();
  };

  // Opened from the header search: run the handed-over query straight away.
  useEffect(() => {
    if (query.trim()) void runResearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Summarise strictly from the returned sources — the prompt forbids outside knowledge
  // so the answer is anchored to what was actually retrieved.
  const askAboutResults = async () => {
    if (!sources.length || aiBusy) return;
    const provider = getActiveProvider();
    if (!provider) {
      setAiError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`);
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiSummary('');
    try {
      const corpus = sources
        .map((s) => `[${s.n}] ${s.kind === 'pubmed' ? 'PubMed' : 'Web'} — "${s.title}" (${s.url})\n${s.text}`)
        .join('\n\n');
      const text = await aiComplete({
        system:
          'You are a clinical evidence assistant for a postgraduate medical exam student. ' +
          'Answer using ONLY the numbered sources provided by the user. Cite sources as [n] like PubMed citation markers. ' +
          'If the sources do not cover something, say so explicitly instead of guessing. ' +
          'Structure the answer in markdown: 1-2 sentence bottom line first, then key findings with citations, then any conflicting evidence, then one clinical takeaway for exams.',
        messages: [
          {
            role: 'user',
            content: `Clinical query: ${searchedQuery || query.trim()}\n\nSources retrieved today (retrieved ${retrievedAt ?? ''}):\n\n${corpus}\n\nSummarise the evidence in these sources for the query. Cite at least three distinct sources by number.`,
          },
        ],
        provider,
        model: getEffectiveModel(provider),
      });
      setAiSummary(text);
    } catch (err: any) {
      setAiError(err?.message || 'AI request failed.');
    } finally {
      setAiBusy(false);
    }
  };

  const copySource = (s: ResearchSource) => {
    navigator.clipboard.writeText(`${s.title} — ${s.url}`);
    setCopied(String(s.n));
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
            <Globe className="w-3.5 h-3.5" />
            Live Evidence Retrieval
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Clinical Evidence Browser</h1>
          <p className="text-slate-300 text-sm mt-1 max-w-2xl">
            Searches the live web (DuckDuckGo) and PubMed abstracts at query time. Sources are fetched with their URLs — ask the AI to summarise exactly what was found.
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus-within:ring-2 focus-within:ring-[#0f8b8d]">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={searching}
              placeholder="e.g. vanA enterococcus teicoplanin susceptibility OR glucagon-like peptide 1 renal outcomes"
              className="flex-1 bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
            />
            {query && !searching && (
              <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={runResearch}
            disabled={searching || !query.trim()}
            className="px-4 py-2.5 rounded-xl bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-40 text-white text-xs font-bold flex items-center gap-2 transition-colors shrink-0"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {searching ? 'Searching…' : 'Search Live Sources'}
          </button>
        </div>

        {searchError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{searchError}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Only public pages are fetched; results ranked with trusted medical domains first
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowScratch(!showScratch)}
              className={`flex items-center gap-1.5 font-semibold px-2 py-1 rounded-lg border ${
                showScratch ? 'bg-amber-50 border-amber-200 text-amber-800' : 'hover:bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              <StickyNote className="w-3.5 h-3.5" />
              Scratchpad ({scratch.length})
            </button>
            {retrievedAt && sources.length > 0 && (
              <span className="flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5" />
                {sources.length} sources · retrieved {retrievedAt}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Scratchpad panel (saved research notes, separate from the browser results) */}
      {showScratch && (
        <div className="bg-white rounded-2xl p-4 border border-amber-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <StickyNote className="w-3.5 h-3.5 text-amber-500" /> Research scratchpad
              <span className="text-[10px] font-normal text-slate-500">· saved locally ({scratch.length} notes)</span>
            </div>
            <div className="flex items-center gap-2">
              {scratch.length > 0 && (
                <button onClick={copyScratch} className="text-[11px] text-slate-600 hover:text-slate-900 flex items-center gap-1">
                  {copied === 'scratch' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} Copy all
                </button>
              )}
              <button onClick={() => setShowScratch(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={scratchText}
              onChange={(e) => setScratchText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addManualScratchNote(); }}
              placeholder="Type a note and press Enter, or capture a result below…"
              className="flex-1 text-xs px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
            />
            <button
              onClick={addManualScratchNote}
              disabled={!scratchText.trim()}
              className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto">
            {scratch.length === 0 && (
              <p className="text-[11px] text-slate-400">Empty — capture sources with the note icon, or add a manual note above.</p>
            )}
            {scratch.map((n) => (
              <div key={n.id} className="group p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-slate-800 truncate">
                    {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:text-[#0f8b8d]">{n.title}</a> : n.title}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-3 mt-0.5">{n.text}</p>
                </div>
                <button
                  onClick={() => deleteScratchNote(n.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {sources.length > 0 && (
        <div className="space-y-4">
          {/* Ask AI banner */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">Ask AI about these results</div>
                <p className="text-[11px] text-slate-500">
                  The model answers only from the {sources.length} sources above, citing them by number. Engine: {engineLabel}
                </p>
              </div>
            </div>
            <button
              onClick={askAboutResults}
              disabled={aiBusy || !getActiveProvider()}
              className="px-4 py-2 rounded-xl bg-[#001432] hover:bg-[#13294b] disabled:opacity-40 text-white text-xs font-bold flex items-center gap-2 shrink-0"
            >
              {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[#8ff3f4]" />}
              {aiBusy ? 'Reading sources…' : !getActiveProvider() ? 'Connect an AI provider' : 'Summarise Evidence'}
            </button>
          </div>

          {aiError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{aiError}</span>
            </div>
          )}

          {aiSummary && (
            <div className="bg-white rounded-2xl p-5 border border-[#0f8b8d]/30 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[#0f8b8d] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Evidence Synthesis (source-anchored)
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(aiSummary)}
                  className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>
              <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">
                {aiSummary}
              </div>
            </div>
          )}

          {/* Source cards */}
          <div className="space-y-2.5">
            {sources.map((s) => (
              <div key={s.n} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:border-slate-300 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                        s.kind === 'pubmed'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        {s.kind === 'pubmed' ? 'PUBMED' : 'WEB'} [{s.n}]
                      </span>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold text-slate-900 hover:text-[#0f8b8d] truncate flex items-center gap-1"
                      >
                        {s.title || s.url}
                      </a>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{s.url}</div>
                    <p className="text-xs text-slate-700 mt-2 leading-relaxed line-clamp-4">
                      {s.text}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => captureSourceToScratch(s)}
                      title="Capture to scratchpad"
                      className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600"
                    >
                      <StickyNote className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => copySource(s)}
                      title="Copy citation"
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                    >
                      {copied === String(s.n) ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source"
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-[#0f8b8d]"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!sources.length && !searching && !searchError && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
            <Globe className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No sources loaded yet</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Type a clinical query and press Enter. Results come from a real DuckDuckGo search plus PubMed (NCBI E-utilities) at the moment you search — nothing is preloaded.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={() => { setQuery('latest guidelines management of community acquired pneumonia 2024'); inputRef.current?.focus(); }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700"
            >
              Try: CAP guidelines 2024
            </button>
            <button
              onClick={() => { setQuery('vancomycin resistant enterococcus-linezolid daptomycin bacteremia'); inputRef.current?.focus(); }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700"
            >
              Try: VRE bacteremia
            </button>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1 pb-2">
        <FileText className="w-3.5 h-3.5" />
        <span>PubMed abstracts via NCBI E-utilities; web pages fetched for full text. Educational use — verify before clinical decisions.</span>
      </div>
    </div>
  );
};
