import React, { useState, useMemo } from 'react';
import { 
  BookOpen, 
  UploadCloud, 
  Search, 
  Cpu, 
  Sparkles, 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Bookmark, 
  Brain, 
  CheckCircle2, 
  Layers, 
  FileText, 
  Maximize2, 
  ListTree, 
  Eye, 
  X,
  Play
} from 'lucide-react';
import { PDFDocument, AppView } from '../types.ts';
import { MOCK_PDF_DOCUMENTS } from '../data/mockClinicalData.ts';

interface PDFReaderViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
  onGenerateQuizFromPage?: (bookTitle: string, pageNumber: number, textSnippet: string) => void;
}

export const PDFReaderView: React.FC<PDFReaderViewProps> = ({ 
  onNavigate,
  onGenerateQuizFromPage 
}) => {
  const [documents, setDocuments] = useState<PDFDocument[]>(MOCK_PDF_DOCUMENTS);
  const [activeDocId, setActiveDocId] = useState<string>('PDF-HARRISON-21');
  const [currentPageNum, setCurrentPageNum] = useState<number>(1120);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [searchQuery, setSearchQuery] = useState<string>('VanA');
  const [activeSidebarTab, setActiveSidebarTab] = useState<'INDEX' | 'PEARLS' | 'SEARCH'>('INDEX');
  
  // OCR Worker Pool Settings
  const [ocrWorkers, setOcrWorkers] = useState<number>(12); // User requested 10-15 workers
  const [isProcessingOCR, setIsProcessingOCR] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [isGeneratingAIIndex, setIsGeneratingAIIndex] = useState<boolean>(false);
  const [aiIndexNotification, setAiIndexNotification] = useState<string | null>(null);

  const activeDoc = useMemo(() => {
    return documents.find(d => d.id === activeDocId) || documents[0];
  }, [documents, activeDocId]);

  const activePageContent = useMemo(() => {
    const page = activeDoc.pagesContent.find(p => p.pageNumber === currentPageNum);
    if (page) return page;
    return activeDoc.pagesContent[0] || {
      pageNumber: currentPageNum,
      title: `${activeDoc.title} · Page ${currentPageNum}`,
      text: 'No OCR text extracted for this page yet. Click "Process with SIMD OCR" to extract full text.',
      pearls: []
    };
  }, [activeDoc, currentPageNum]);

  // High-speed Simulated SIMD OCR Processing
  const handleUploadOrProcessPDF = () => {
    setIsProcessingOCR(true);
    setOcrProgress(0);
    const stepTime = 160; // Fast execution
    const interval = setInterval(() => {
      setOcrProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsProcessingOCR(false);
          triggerAIIndexing();
          return 100;
        }
        return prev + 20;
      });
    }, stepTime);
  };

  const triggerAIIndexing = () => {
    setIsGeneratingAIIndex(true);
    setTimeout(() => {
      setIsGeneratingAIIndex(false);
      setAiIndexNotification('AI Chapter & Concept Index generated with 24 high-yield headings.');
      setTimeout(() => setAiIndexNotification(null), 4000);
    }, 1200);
  };

  // Keyword Highlighting in page text
  const renderHighlightedText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, index) => 
      regex.test(part) ? (
        <mark key={index} className="bg-amber-300 text-slate-950 font-bold px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Top Banner: Medical PDF Reader & SIMD OCR Engine */}
      <div className="bg-[#001432] rounded-2xl p-5 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Cpu className="w-3.5 h-3.5" />
              SIMD Parallel OCR Pipeline ({ocrWorkers} Worker Threads Active)
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Medical PDF Reader & AI-Indexed Knowledge Base
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm mt-0.5 max-w-2xl">
              High-speed WebAssembly SIMD optical extraction (10–16 workers) with automated AI chapter indexing, live in-document search, and one-click MCQ generation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleUploadOrProcessPDF}
              disabled={isProcessingOCR}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md transition-all active:scale-95"
            >
              <UploadCloud className="w-4 h-4" />
              {isProcessingOCR ? `Processing (${ocrProgress}%)` : 'Upload & OCR Scan PDF'}
            </button>
          </div>
        </div>

        {/* OCR Worker Speed Control & Status Bar */}
        <div className="mt-4 pt-4 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-medium">Parallel OCR Workers:</span>
              <div className="flex items-center gap-1.5">
                {[10, 12, 14, 16].map(num => (
                  <button
                    key={num}
                    onClick={() => setOcrWorkers(num)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all ${
                      ocrWorkers === num 
                        ? 'bg-[#0f8b8d] text-white shadow-xs' 
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {num}W
                  </button>
                ))}
              </div>
            </div>

            <span className="hidden sm:inline-block text-slate-400 font-mono text-[11px]">
              Throughput: <strong className="text-emerald-400">~{Math.round(ocrWorkers * 1.55)} pages/sec</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={triggerAIIndexing}
              disabled={isGeneratingAIIndex}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-400 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isGeneratingAIIndex ? 'Analyzing Structure...' : 'Re-generate AI Index'}
            </button>
          </div>
        </div>

        {/* Progress Bar if processing */}
        {isProcessingOCR && (
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-3">
            <div 
              className="h-full bg-gradient-to-r from-[#0f8b8d] to-[#8ff3f4] transition-all duration-200"
              style={{ width: `${ocrProgress}%` }}
            />
          </div>
        )}

        {aiIndexNotification && (
          <div className="mt-3 p-2 bg-emerald-500/20 border border-emerald-400/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{aiIndexNotification}</span>
          </div>
        )}
      </div>

      {/* Book Tabs Header */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {documents.map(doc => (
          <button
            key={doc.id}
            onClick={() => {
              setActiveDocId(doc.id);
              setCurrentPageNum(doc.pagesContent[0]?.pageNumber || 1);
            }}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border flex items-center gap-2 ${
              activeDocId === doc.id
                ? 'bg-[#001432] text-white border-[#001432] shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-[#0f8b8d]" />
            <span>{doc.title}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-normal">
              {doc.totalPages}p
            </span>
          </button>
        ))}
      </div>

      {/* Main Reading Workspace: 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[700px]">
        {/* Left Sidebar: AI Chapter Index, Pearls, Search (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[740px] overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveSidebarTab('INDEX')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  activeSidebarTab === 'INDEX'
                    ? 'bg-[#001432] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60'
                }`}
              >
                AI Index
              </button>
              <button
                onClick={() => setActiveSidebarTab('PEARLS')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  activeSidebarTab === 'PEARLS'
                    ? 'bg-[#001432] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60'
                }`}
              >
                Pearls ({activePageContent.pearls.length})
              </button>
              <button
                onClick={() => setActiveSidebarTab('SEARCH')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  activeSidebarTab === 'SEARCH'
                    ? 'bg-[#001432] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60'
                }`}
              >
                Search
              </button>
            </div>
            <span className="text-[10px] font-mono font-bold text-[#0f8b8d] px-2 py-0.5 rounded bg-teal-50">
              OCR {activeDoc.ocrConfidence}%
            </span>
          </div>

          {/* Sidebar Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activeSidebarTab === 'INDEX' && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Structured Table of Contents</span>
                  <span className="text-[10px] font-mono text-slate-500">Auto-Indexed</span>
                </div>

                {activeDoc.chapters.map(chap => {
                  const isCurrent = currentPageNum === chap.pageNumber;
                  return (
                    <div
                      key={chap.id}
                      onClick={() => setCurrentPageNum(chap.pageNumber)}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        isCurrent
                          ? 'border-[#0f8b8d] bg-teal-50/20 ring-1 ring-[#0f8b8d]'
                          : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isCurrent ? 'bg-[#0f8b8d] text-white' : 'bg-slate-100 text-slate-700'
                        }`}>
                          p. {chap.pageNumber}
                        </span>
                        {chap.isHighYield && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            HIGH-YIELD
                          </span>
                        )}
                      </div>
                      <div className={`font-semibold text-slate-900 leading-snug ${chap.level === 2 ? 'pl-2 text-[11px]' : ''}`}>
                        {chap.title}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeSidebarTab === 'PEARLS' && (
              <div className="space-y-3">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Extracted High-Yield Pearls on this Page:
                </div>
                {activePageContent.pearls.length > 0 ? (
                  activePageContent.pearls.map((pearl, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs space-y-1.5">
                      <div className="flex items-center gap-1.5 text-amber-800 font-bold text-[11px]">
                        <Brain className="w-3.5 h-3.5 text-amber-600" />
                        <span>Board Pearl #{idx + 1}</span>
                      </div>
                      <p className="text-amber-950 font-medium leading-relaxed">
                        {pearl}
                      </p>
                      <div className="pt-1 flex items-center justify-between">
                        <button
                          onClick={() => onNavigate('highlights')}
                          className="text-[11px] font-bold text-[#0f8b8d] hover:underline"
                        >
                          Anchor in Deck →
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic p-4 text-center">
                    No pearls highlighted on this specific page.
                  </p>
                )}
              </div>
            )}

            {activeSidebarTab === 'SEARCH' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search keywords in text..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="text-[11px] font-bold text-slate-500">
                  Search Occurrences for "{searchQuery}":
                </div>

                <div className="space-y-2">
                  <div 
                    onClick={() => setCurrentPageNum(1120)}
                    className="p-2.5 rounded-xl border border-slate-200 hover:border-[#0f8b8d] hover:bg-slate-50 cursor-pointer text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-mono font-bold text-[11px] text-[#0f8b8d]">
                      <span>Page 1120</span>
                      <span>3 matches</span>
                    </div>
                    <p className="text-slate-600 text-[11px] line-clamp-2">
                      "...The <mark className="bg-amber-300 font-bold">VanA</mark> phenotype is the most clinically prevalent variant worldwide. Carried on transposon Tn1546..."
                    </p>
                  </div>

                  <div 
                    onClick={() => setCurrentPageNum(1122)}
                    className="p-2.5 rounded-xl border border-slate-200 hover:border-[#0f8b8d] hover:bg-slate-50 cursor-pointer text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-mono font-bold text-[11px] text-[#0f8b8d]">
                      <span>Page 1122</span>
                      <span>2 matches</span>
                    </div>
                    <p className="text-slate-600 text-[11px] line-clamp-2">
                      "...Genomic regulation of the <mark className="bg-amber-300 font-bold">VanA</mark> cluster involves a two-component regulatory system consisting of VanS and VanR..."
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Canvas: Pleasant, Glare-Free PDF Page Reader (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[740px] overflow-hidden">
          {/* Reader Top Controls */}
          <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800">
                {activeDoc.title}
              </span>
              <span className="text-xs text-slate-400 font-mono">|</span>
              <div className="flex items-center gap-1 text-xs font-mono font-semibold text-slate-700">
                <span>Page</span>
                <input
                  type="number"
                  value={currentPageNum}
                  onChange={e => setCurrentPageNum(Number(e.target.value))}
                  className="w-16 px-1.5 py-0.5 border border-slate-300 rounded text-center bg-white text-xs font-bold"
                />
                <span className="text-slate-500">/ {activeDoc.totalPages}</span>
              </div>
            </div>

            {/* Pagination & Zoom Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPageNum(prev => Math.max(1, prev - 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentPageNum(prev => Math.min(activeDoc.totalPages, prev + 1))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="h-4 w-px bg-slate-300 mx-1" />

              <button
                onClick={() => setZoomLevel(prev => Math.max(75, prev - 15))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-semibold text-slate-600 min-w-10 text-center">
                {zoomLevel}%
              </span>
              <button
                onClick={() => setZoomLevel(prev => Math.min(150, prev + 15))}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Context Action Bar */}
          <div className="px-5 py-2.5 bg-teal-50/50 border-b border-teal-100/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-teal-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#0f8b8d]" />
              Active Passage Ready for Clinical Action
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (onGenerateQuizFromPage) {
                    onGenerateQuizFromPage(activeDoc.title, currentPageNum, activePageContent.text);
                  }
                  onNavigate('practice');
                }}
                className="px-3 py-1 rounded-lg bg-[#001432] hover:bg-[#13294b] text-white font-bold text-[11px] flex items-center gap-1.5 transition-all shadow-xs"
              >
                <Play className="w-3 h-3 fill-current" />
                Generate MCQs from this Page
              </button>
              <button
                onClick={() => onNavigate('ai-tutor', 'Q10')}
                className="px-3 py-1 rounded-lg bg-white border border-slate-200 hover:border-[#0f8b8d] text-slate-700 hover:text-[#0f8b8d] font-bold text-[11px] flex items-center gap-1.5 transition-colors"
              >
                Dissect with AI Tutor
              </button>
            </div>
          </div>

          {/* Reading Document Body: Warm, Clean, Glare-Free Paper Canvas */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-[#fafafc]">
            <div 
              className="max-w-3xl mx-auto bg-white rounded-2xl p-8 sm:p-12 shadow-sm border border-slate-200/80 space-y-6 transition-all"
              style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
            >
              {/* Header inside paper page */}
              <div className="border-b border-slate-200 pb-4 flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>{activeDoc.title} · {activeDoc.edition}</span>
                <span>Page {currentPageNum}</span>
              </div>

              {/* Page Title */}
              <h2 className="text-xl font-bold text-slate-900 font-sans tracking-tight leading-snug">
                {activePageContent.title}
              </h2>

              {/* Main OCR Extracted Paragraphs */}
              <div className="text-slate-800 text-[13px] leading-relaxed font-sans space-y-4 whitespace-pre-line text-justify selection:bg-teal-200">
                {renderHighlightedText(activePageContent.text, searchQuery)}
              </div>

              {/* Page Footer */}
              <div className="pt-6 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>Indexed via SIMD {ocrWorkers} Workers</span>
                <span>Pulse Med Neural RAG Grounded</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
