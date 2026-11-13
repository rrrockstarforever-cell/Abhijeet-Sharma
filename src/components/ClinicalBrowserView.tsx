// Clinical Evidence Browser — REAL web research.
// Queries POST /api/web/research (server-side DuckDuckGo + PubMed, see server/web.mjs).
// "Ask AI about these results" summarises ONLY the returned sources via /api/ai/complete.
// No canned results anywhere; every failure is surfaced.
import React, { useState, useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
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
  const reduceMotion = useReducedMotion();
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
      <div className="relative overflow-hidden rounded-[24px] border border-[#13294b] bg-[#001432] p-5 text-white shadow-md  dark:">
        <div className="pointer-events-none absolute inset-0  bg-[radial-gradient(circle,#8ff3f4_1px,transparent_1px)] bg-[length:9px_9px] opacity-[0.10]" />
        <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-l from-[#0f8b8d]/20 to-transparent  opacity-[0.05] [mask-image:radial-gradient(circle_at_center,transparent_0,transparent_38%,black_76%)] md:block" />
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border   px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] border-[#0f8b8d]/30 bg-[#0f8b8d]/20 text-[#8ff3f4] ">
              <Globe className="h-3.5 w-3.5" />
              Evidence Radar
            </div>
            <h1 className="text-xl font-medium tracking-tight text-white  ">Clinical Evidence Browser</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-300 ">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{query.trim() ? query : 'Awaiting clinical query — live web + PubMed retrieval'}</span>
            </p>
          </div>
          <div className="shrink-0 self-start sm:self-center">
            {searching ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border  px-3 py-2 text-sm uppercase tracking-[0.12em] border-[#0f8b8d]/30 bg-[#0f8b8d]/20 text-[#8ff3f4]   [text-shadow:2px_2px_0_rgba(255,255,255,0.7)] ">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning live sources
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-xl border   px-3 py-2 text-[11px] font-semibold border-[#0f8b8d]/30 bg-[#0f8b8d]/20 text-[#8ff3f4] ">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Live retrieval
              </span>
            )}
          </div>
        </div>
        <p className="relative z-10 mt-2 max-w-2xl text-xs leading-relaxed text-slate-300 ">
          Searches the live web (DuckDuckGo) and PubMed abstracts at query time. Sources are fetched with their URLs — ask the AI to summarise exactly what was found.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm   p-4 dark:bg-slate-900 dark:border-slate-700">
        <div className="pointer-events-none absolute inset-0  bg-[radial-gradient(circle,#0f8b8d_1px,transparent_1px)] bg-[length:10px_10px] opacity-[0.08]" />
        <div className="relative z-10 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-h-[52px] flex-1 items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 text-slate-800   px-4 py-3 focus-within:ring-2 focus-within:ring-[#0f8b8d] focus-within:ring-offset-2 ">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={searching}
                placeholder="e.g. vanA enterococcus teicoplanin susceptibility OR glucagon-like peptide 1 renal outcomes"
                className="flex-1 min-w-0 bg-transparent text-sm   text-slate-800 placeholder-slate-400 focus:outline-none disabled:opacity-60 "
              />
              {query && !searching && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear query"
                  className="rounded-full p-1  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={runResearch}
              disabled={searching || !query.trim()}
              className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-[16px] px-5 py-3 text-sm font-medium  bg-[#0f8b8d] text-white hover:bg-[#00696b] transition-transform hover:-translate-y-0.5 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2  disabled:translate-y-0 disabled:scale-100 disabled:opacity-40"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {searching ? 'Searching…' : 'Search Live Sources'}
            </button>
          </div>

          {searchError && (
            <div className="flex rotate-[-0.5deg] items-start gap-2 rounded-[16px] border border-rose-200 bg-rose-50 text-rose-800  p-3  ">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <div className=" text-[11px] uppercase tracking-[0.14em] [text-shadow:1px_1px_0_rgba(255,255,255,0.55)]">Search failed</div>
                <p className="text-sm leading-relaxed">{searchError}</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 text-[11px] text-slate-500  sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border   px-2.5 py-1 font-medium border-slate-200 bg-slate-50 text-slate-600">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                Public pages only · trusted medical domains first
              </span>
              {retrievedAt && sources.length > 0 && (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border   px-2.5 py-1 font-mono font-medium border-slate-200 bg-slate-50 text-slate-600">
                    <Layers className="h-3.5 w-3.5" />
                    {sources.length} sources
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border   px-2.5 py-1 font-mono font-medium border-slate-200 bg-slate-50 text-slate-600">
                    <Clock className="h-3.5 w-3.5" />
                    retrieved {retrievedAt}
                  </span>
                </>
              )}
            </div>
            <button
              id="scratch-toggle"
              type="button"
              onClick={() => setShowScratch(!showScratch)}
              aria-expanded={showScratch}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] ${
                showScratch
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : ' bg-transparent text-slate-600 border-slate-200 hover:bg-slate-100  '
              }`}
            >
              <StickyNote className="h-3.5 w-3.5" />
              Scratchpad
              <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-current px-1 text-[10px] leading-4">
                {scratch.length}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Scratchpad panel (saved research notes, separate from the browser results) */}
      {showScratch && (
        <div className="fixed inset-x-3 bottom-3 z-40 max-h-[75vh] overflow-y-auto rounded-[20px] border border-amber-200 bg-white text-slate-900 shadow-sm md:fixed md:bottom-auto md:left-auto md:right-6 md:top-24 md:w-[380px] md:max-h-[calc(100vh-7rem)]">
          <div className="sticky top-0 z-10 overflow-hidden rounded-t-[17px] border-b border-amber-200 bg-white   p-3 ">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,#f59e0b_1px,transparent_1px)] bg-[length:8px_8px] opacity-[0.10]" />
            <div className="relative z-10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 ">
                  <StickyNote className="h-4 w-4" /> Case File · Scratchpad
                  <span className="inline-flex items-center rounded-lg border   px-1.5 py-0.5 text-[11px] uppercase tracking-[0.12em] border-amber-200 bg-amber-50 text-amber-800 ">
                    {scratch.length}
                  </span>
                </div>
                <p className="text-[10px] font-medium text-slate-500 ">Saved locally · persists on this device</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {scratch.length > 0 && (
                  <button
                    type="button"
                    onClick={copyScratch}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d]"
                  >
                    {copied === 'scratch' ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />} Copy all
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close scratchpad"
                  onClick={() => {
                    setShowScratch(false);
                    setTimeout(() => document.getElementById('scratch-toggle')?.focus(), 0);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
              <input
                value={scratchText}
                onChange={(e) => setScratchText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addManualScratchNote(); }}
                placeholder="Type a note and press Enter, or capture a result below…"
                className="min-h-[44px] flex-1 rounded-[14px] border border-slate-200 bg-slate-50 text-slate-800   px-4 py-3 text-sm   focus:outline-none focus:ring-2 focus:ring-[#0f8b8d] "
              />
              <button
                type="button"
                onClick={addManualScratchNote}
                disabled={!scratchText.trim()}
                className="flex min-h-[44px] items-center gap-1 rounded-[14px] border border-amber-500 bg-amber-500 text-white hover:bg-amber-600   px-3 py-2 text-xs font-medium  transition-colors  disabled:opacity-40 "
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1 md:max-h-[calc(100vh-19rem)]">
              {scratch.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-200 text-slate-400   p-3 text-[11px] leading-relaxed ">
                  Empty — capture sources with the note icon, or add a manual note above.
                </p>
              )}
              {scratch.map((n) => (
                <div key={n.id} className="group rounded-[14px] border border-slate-200 bg-slate-50   p-3 ">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-slate-800  ">
                    {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:text-[#0f8b8d]">{n.title}</a> : n.title}
                      </div>
                      {n.url && <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500 ">{n.url}</div>}
                      <p className="mt-1.5 line-clamp-4 text-[12px] leading-relaxed text-slate-600 ">{n.text}</p>
                      <div className="mt-1.5 font-mono text-[10px] text-slate-400 ">added {n.addedAt}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteScratchNote(n.id)}
                      aria-label="Delete note"
                      className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-rose-600  opacity-60 transition-colors   group-hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {sources.length > 0 && (
        <div className="space-y-4">
          {/* Ask AI banner */}
          <div className="rounded-[20px] border border-slate-200 bg-white shadow-sm   p-4 dark:bg-slate-900 dark:border-slate-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50    ">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-900  ">Ask AI about these results</div>
                  <p className="text-[11px] leading-relaxed text-slate-500 ">
                    The model answers only from the {sources.length} sources above, citing them by number. Engine: {engineLabel}
                  </p>
                </div>
              </div>
              <button
                onClick={askAboutResults}
                disabled={aiBusy || !getActiveProvider()}
                className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-[16px] px-4 py-2 text-sm font-medium  bg-[#001432] text-white hover:bg-[#13294b] transition-transform hover:-translate-y-0.5 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] disabled:translate-y-0 disabled:scale-100 disabled:opacity-40"
              >
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[#8ff3f4]" />}
                {aiBusy ? 'Reading sources…' : !getActiveProvider() ? 'Connect an AI provider' : 'Summarise Evidence'}
              </button>
            </div>
          </div>

          {aiError && (
            <div className="flex rotate-[-0.5deg] items-start gap-2 rounded-[16px] border border-rose-200 bg-rose-50 text-rose-800  p-3  ">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <div>
                <div className=" text-[11px] uppercase tracking-[0.14em] [text-shadow:1px_1px_0_rgba(255,255,255,0.55)]">AI evidence check failed</div>
                <p className="text-sm leading-relaxed">{aiError}</p>
              </div>
            </div>
          )}

          {aiSummary && (
            <div className="rounded-[20px] border border-[#0f8b8d]/30 bg-white shadow-sm   p-5 dark:bg-slate-900 dark:border-slate-700">
              <div className="mb-3 flex items-center justify-between border-b border-slate-100  pb-2">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-[#0f8b8d]  ">
                  <Layers className="h-3.5 w-3.5" /> Evidence Synthesis (source-anchored)
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(aiSummary)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] text-slate-500 hover:text-slate-800"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
              <div className="whitespace-pre-wrap font-sans text-base leading-[1.7] text-slate-800  ">
                {aiSummary}
              </div>
            </div>
          )}

          {/* Source cards */}
          <div className="space-y-2.5">
            {sources.map((s, index) => (
              <motion.div
                key={s.n}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: "easeOut", delay: reduceMotion ? 0 : Math.min(index * 0.03, 0.2) }}
              >
                <div className="rounded-[18px] border border-slate-200 bg-white shadow-sm hover:border-slate-300   p-4 transition-colors  dark:bg-slate-900 dark:border-slate-700">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide ${
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
                        className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-slate-900 hover:text-[#0f8b8d]   "
                      >
                        {s.title || s.url}
                      </a>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500 ">{s.url}</div>
                    <p className="mt-2 line-clamp-4 text-base leading-[1.7] text-slate-700  ">
                      {s.text}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => captureSourceToScratch(s)}
                      title="Capture to scratchpad"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] "
                    >
                      <StickyNote className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => copySource(s)}
                      title="Copy citation"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] "
                    >
                      {copied === String(s.n) ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source"
                      className="rounded-lg p-1.5 text-slate-400 hover:text-[#0f8b8d]  transition-colors   focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d]"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!sources.length && !searching && !searchError && (
        <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm   p-10 text-center dark:bg-slate-900 dark:border-slate-700">
          <div className="pointer-events-none absolute inset-0  bg-[radial-gradient(circle,#0f8b8d_1px,transparent_1px)] bg-[length:10px_10px] opacity-[0.08]" />
          <div className="relative z-10 space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100  ">
              <Globe className="h-6 w-6 text-slate-400 " />
            </div>
            <div className="mx-auto inline-flex items-center rounded-xl border  px-3 py-1 text-[12px] uppercase tracking-[0.14em] border-[#0f8b8d]/30 bg-[#0f8b8d]/10 text-[#0f8b8d]   ">
              Ready to scan
            </div>
            <h3 className="text-sm font-medium text-slate-900  ">No sources loaded yet</h3>
            <p className="mx-auto max-w-md text-sm leading-[1.7] text-slate-500 ">
              Type a clinical query and press Enter. Results come from a real DuckDuckGo search plus PubMed (NCBI E-utilities) at the moment you search — nothing is preloaded.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                onClick={() => { setQuery('latest guidelines management of community acquired pneumonia 2024'); inputRef.current?.focus(); }}
                className="min-h-[36px] rounded-xl border   px-3 py-1.5 text-[11px] font-medium border-slate-200 bg-white text-slate-700 hover:bg-slate-100  transition-colors  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] "
              >
                Try: CAP guidelines 2024
              </button>
              <button
                onClick={() => { setQuery('vancomycin resistant enterococcus-linezolid daptomycin bacteremia'); inputRef.current?.focus(); }}
                className="min-h-[36px] rounded-xl border   px-3 py-1.5 text-[11px] font-medium border-slate-200 bg-white text-slate-700 hover:bg-slate-100  transition-colors  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] "
              >
                Try: VRE bacteremia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="flex items-center gap-2 px-1 pb-2 text-[11px] text-slate-400 ">
        <FileText className="h-3.5 w-3.5" />
        <span>PubMed abstracts via NCBI E-utilities; web pages fetched for full text. Educational use — verify before clinical decisions.</span>
      </div>
    </div>
  );
};
