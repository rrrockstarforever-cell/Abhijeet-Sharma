// PDF Reader — REAL pdf.js rendering (pdfjs-dist), Adobe-style layout.
// - Library imported from the user's files, stored as blobs in IndexedDB 'PulseMedFilesDB'.
//   Import only reads page COUNT (cheap metadata) — page content renders on demand while scrolling.
// - Continuous scroll with IntersectionObserver-driven lazy rendering + LRU eviction.
// - pdf.js TextLayer for real text selection; selects open a floating popup:
//   highlight with colour (saved to the user-highlights store) or copy.
// - Whole-document search builds a text index on demand (cached per page in IndexedDB),
//   with next/previous match navigation.
// - Right panel: highlights for the doc.
// - OCR matrix (tesseract.js, on-device).
// No MOCK_PDF_DOCUMENTS, no fake OCR numbers, no dangerouslySetInnerHTML.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import {
  BookOpen,
  UploadCloud,
  Search,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Printer,
  ListTree,
  X,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Highlighter,
  StickyNote,
  Trash2,
  Sparkles,
  Globe,
  GraduationCap,
  Send,
  Type as TypeIcon,
  Database,
  FileText,
  Trash,
  Maximize,
  ScanText,
  FileDown,
  NotebookPen,
  Square,
  Focus,
  LayoutGrid,
  PanelRight,
  Activity,
  Ruler,
  Contrast,
  RotateCcw,
  Stethoscope,
  Zap,
} from 'lucide-react';
import { AppView } from '../types.ts';
import {
  listLibraryDocuments,
  addLibraryDocument,
  getLibraryDocument,
  removeLibraryDocument,
  savePageText,
  getPageText,
  listPageTexts,
  updateLibraryMeta,
  type PDFLibraryMeta,
} from '../utils/pdfLibraryDB.ts';
import {
  listUserHighlightsForDoc,
  addUserHighlight,
  removeUserHighlight,
  highlightFromPdfSelection,
  type UserHighlight,
} from '../utils/userHighlightsStore.ts';
import {
  aiComplete,
  getActiveProvider,
  getEffectiveModel,
  NOT_CONNECTED_MESSAGE,
  extractJson,
} from '../lib/ai.ts';
import { createOcrPool, ocrConcurrency, OcrWord } from '../utils/ocr.ts';
import { startJob, stopJob, type JobControl } from '../utils/jobRegistry.ts';
import { RevisionNote, downloadNotesPdf } from './RevisionNote.tsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const HL_COLORS: { id: string; css: string; label: string }[] = [
  { id: 'yellow', css: '#fde047', label: 'Yellow' },
  { id: 'green', css: '#86efac', label: 'Green' },
  { id: 'pink', css: '#f9a8d4', label: 'Pink' },
  { id: 'blue', css: '#93c5fd', label: 'Blue' },
];

const T = {
  page: 'bg-slate-200/70 text-slate-800',
  panel: 'border border-slate-200 bg-white',
  panelSoft: 'bg-slate-50 border border-slate-200',
  border: 'border-slate-200',
  divider: 'border-slate-100',
  text: 'text-slate-700',
  muted: 'text-slate-500',
  dim: 'text-slate-400',
  strong: 'text-slate-900',
  accent: 'text-[#00696b]',
  cta: 'bg-[#0f8b8d] text-white hover:bg-[#00696b]',
  chip: 'border-slate-200 bg-slate-50 text-slate-600',
  chipAccent: 'border-[#0f8b8d]/30 bg-[#0f8b8d]/10 text-[#00696b]',
  chipWarn: 'border-amber-300 bg-amber-50 text-amber-700',
  chipGood: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  softHover: 'hover:bg-slate-100',
  input: 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400',
  reader: 'bg-slate-200/70',
};

const SUBJECT_RULES: { subject: string; patterns: RegExp }[] = [
  { subject: 'Anatomy', patterns: /anatomy|gray'?s|netter|moore/i },
  { subject: 'Physiology', patterns: /physiolog|guyton|ganong/i },
  { subject: 'Pathology', patterns: /patholog|robbins|goljan/i },
  { subject: 'Pharmacology', patterns: /pharmacolog|goodman|lippincott|katzung/i },
  { subject: 'Microbiology', patterns: /microbiolog|bacteriolog|virolog|parasitolog|levinson|jawetz/i },
  { subject: 'General Medicine', patterns: /harrison|davidson|medicine|kumar|clinical medicine/i },
  { subject: 'Surgery', patterns: /surgery|bailey|sabiston|schwartz/i },
  { subject: 'Pediatrics', patterns: /pediatric|paediatric|nelson|ghai/i },
  { subject: 'Obstetrics & Gynaecology', patterns: /obstetric|gynaecolog|gynecolog|williams|dc dutta/i },
  { subject: 'Psychiatry', patterns: /psychiatr|kaplan|stahl/i },
  { subject: 'Dermatology', patterns: /dermatolog/i },
  { subject: 'Radiology', patterns: /radiol|grainger/i },
  { subject: 'Ophthalmology', patterns: /ophthalmolog|khurana/i },
  { subject: 'ENT', patterns: /\bent\b|otolaryng|dhingra/i },
  { subject: 'Forensic Medicine', patterns: /forensic|toxicolog/i },
  { subject: 'Community Medicine', patterns: /community medicine|preventive|social medicine|park\b/i },
  { subject: 'Anaesthesia', patterns: /anaesthes|anesthes|morgan/i },
  { subject: 'Orthopaedics', patterns: /orthopaed|orthoped|apley/i },
];

function categorizeTitle(title: string): string {
  const match = SUBJECT_RULES.find((r) => r.patterns.test(title));
  return match?.subject ?? 'Uncategorised';
}

function splitDocxIntoPages(raw: string): string[] {
  const formFeeds = raw.split(/\f/).map((p) => p.trim()).filter(Boolean);
  if (formFeeds.length > 1) return formFeeds;
  const paragraphs = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pages: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > 2400 && current) {
      pages.push(current.trim());
      current = '';
    }
    current += `${para}\n\n`;
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length ? pages : [raw.trim()];
}

interface SelectionPopup { x: number; y: number; text: string; }

function normalizeOcrWords(
  words: OcrWord[] | undefined,
  srcW: number,
  srcH: number,
  measure: CanvasRenderingContext2D,
): OcrWord[] {
  if (!words || !words.length || !srcW || !srcH) return [];
  return words.map((w) => {
    const bw = Math.max(1, w.bbox.x1 - w.bbox.x0);
    const bh = Math.max(1, w.bbox.y1 - w.bbox.y0);
    measure.font = `${bh}px Helvetica, Arial, sans-serif`;
    const measured = measure.measureText(w.text).width || bw;
    return {
      text: w.text,
      confidence: w.confidence,
      bbox: {
        x0: w.bbox.x0 / srcW,
        y0: w.bbox.y0 / srcH,
        x1: w.bbox.x1 / srcW,
        y1: w.bbox.y1 / srcH,
      },
      sx: Math.max(0.3, Math.min(3, bw / measured)),
    };
  });
}

interface PDFReaderViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
  darkMode?: boolean;
}
export const PDFReaderView: React.FC<PDFReaderViewProps> = ({ onNavigate, darkMode = false }) => {
  const [docs, setDocs] = useState<PDFLibraryMeta[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [fitWidth, setFitWidth] = useState<boolean>(true);
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [docOpenError, setDocOpenError] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState<number>(-1);
  const [indexing, setIndexing] = useState<{ busy: boolean; done: number }>({ busy: false, done: 0 });

  const [showNotes, setShowNotes] = useState<boolean>(true);
  const [showLibrary, setShowLibrary] = useState<boolean>(true);
  const [highlights, setHighlights] = useState<UserHighlight[]>([]);
  const [copied, setCopied] = useState<boolean>(false);

  const [popup, setPopup] = useState<SelectionPopup | null>(null);

  const [showThumbs, setShowThumbs] = useState<boolean>(false);
  const [ocrForce, setOcrForce] = useState<boolean>(false);
  const [ocrOpen, setOcrOpen] = useState<boolean>(false);
  const [ocrBusy, setOcrBusy] = useState<boolean>(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [wordsVersion, setWordsVersion] = useState(0);

  const [notesOpen, setNotesOpen] = useState<boolean>(false);
  const [notesFrom, setNotesFrom] = useState<number>(1);
  const [notesTo, setNotesTo] = useState<number>(5);
  const [notesPartSize, setNotesPartSize] = useState<number>(5);
  const [notesBusy, setNotesBusy] = useState<boolean>(false);
  const notesCancelRef = useRef<boolean>(false);
  const [madeNotes, setMadeNotes] = useState<{ range: string; text: string }[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);

  // ----- AI panel / MCQ state -----
  const [askPanel, setAskPanel] = useState<boolean>(false);
  const [askContext, setAskContext] = useState<string>('');
  const [askContextLabel, setAskContextLabel] = useState<string>('current page');
  const [askIncludeWeb, setAskIncludeWeb] = useState<boolean>(false);
  const [askBusy, setAskBusy] = useState<boolean>(false);
  const [askReply, setAskReply] = useState<string>('');
  const [askQuestion, setAskQuestion] = useState<string>('');
  const [askInput, setAskInput] = useState<string>('');
  const [askCopied, setAskCopied] = useState<boolean>(false);
  const [askCitations, setAskCitations] = useState<string[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const [mcqs, setMcqs] = useState<{ question: string; options: string[]; answerIndex: number; explanation: string }[]>([]);
  const [mcqBusy, setMcqBusy] = useState<boolean>(false);
  const [showMcqAnswers, setShowMcqAnswers] = useState<Record<number, boolean>>({});
  const [mcqIndex, setMcqIndex] = useState<number>(0);
  const [mcqPicked, setMcqPicked] = useState<number | null>(null);

  const [viewMode, setViewMode] = useState<'page' | 'text'>('page');
  const [immersive, setImmersive] = useState<boolean>(false);
  const [textView, setTextView] = useState<{ loading: boolean; text: string; page: number }>({ loading: false, text: '', page: 1 });

  const pdfRef = useRef<any>(null);
  useEffect(() => () => {
    if (pdfRef.current) { try { pdfRef.current.destroy(); } catch { /* ignore */ } pdfRef.current = null; }
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageWrapRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedRef = useRef<Set<number>>(new Set());
  const renderingRef = useRef<Set<number>>(new Set());
  const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
  const baseDimsRef = useRef<{ w: number; h: number } | null>(null);
  const visibleRatiosRef = useRef<Map<number, number>>(new Map());
  const currentPageRef = useRef<number>(1);
  const scaleRef = useRef<number>(1.2);
  const pageTextsRef = useRef<Map<number, string>>(new Map());
  const ocrWordsRef = useRef<Map<number, OcrWord[]>>(new Map());
  const nativeTextPagesRef = useRef<Set<number>>(new Set());
  const searchCancelRef = useRef<boolean>(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  currentPageRef.current = currentPage;
  scaleRef.current = scale;
  const refreshLibrary = useCallback(async () => {
    try {
      const all = await listLibraryDocuments();
      setDocs(all);
      return all;
    } catch (err: any) {
      setLibraryError(err?.message || 'Could not read the local PDF library.');
      return [];
    }
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const clearRenderedPages = useCallback(() => {
    renderedRef.current.clear();
    renderingRef.current.clear();
    for (const task of renderTasksRef.current.values()) {
      try { task.cancel(); } catch { /* already done */ }
    }
    renderTasksRef.current.clear();
    for (const canvas of canvasRefs.current.values()) {
      if (canvas.parentElement) canvas.parentElement.replaceChildren();
    }
    canvasRefs.current.clear();
    textLayerRefs.current.clear();
    visibleRatiosRef.current.clear();
  }, []);

  const openDoc = useCallback(async (id: string) => {
    if (pdfRef.current) {
      try { await pdfRef.current.destroy(); } catch { /* ignore */ }
      pdfRef.current = null;
    }
    clearRenderedPages();
    setActiveDocId(id);
    setDocOpenError(null);
    setPageErrors({});
    setMatches([]);
    setMatchIndex(-1);
    setSearchQuery('');
    pageTextsRef.current = new Map();
    ocrWordsRef.current = new Map();
    nativeTextPagesRef.current = new Set();
    setWordsVersion((v) => v + 1);
    setNumPages(0);
    setCurrentPage(1);
    setLoadingDoc(true);
    try {
      const rec = await getLibraryDocument(id);
      if (!rec) throw new Error('Document record missing from the local library.');
      if (rec.fileType === 'docx') {
        pdfRef.current = null;
        setNumPages(rec.numPages);
        baseDimsRef.current = { w: 720, h: 1000 };
        setHighlights(listUserHighlightsForDoc(id));
        setViewMode('text');
        return;
      }
      const buf = await rec.blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      setViewMode('page');
      const p1 = await pdf.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      baseDimsRef.current = { w: vp.width, h: vp.height };
      setHighlights(listUserHighlightsForDoc(id));
      const storedPages = await listPageTexts(id).catch(() => []);
      let loadedWords = 0;
      for (const row of storedPages) {
        if (row.words && row.words.length) { ocrWordsRef.current.set(row.pageNumber, row.words); loadedWords += 1; }
      }
      if (loadedWords) setWordsVersion((v) => v + 1);
    } catch (err: any) {
      setDocOpenError(err?.message || 'Could not open the PDF.');
      pdfRef.current = null;
      setNumPages(0);
    } finally {
      setLoadingDoc(false);
    }
  }, [clearRenderedPages]);

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setLibraryError(null);
    const imported: PDFLibraryMeta[] = [];
    try {
      for (const file of Array.from(files)) {
        const isPdf = /\.pdf$|application\/pdf/i.test(`${file.type} ${file.name}`);
        const isDocx = /\.docx$/i.test(file.name);
        if (!isPdf && !isDocx) {
          setLibraryError(`"${file.name}" is not a PDF or DOCX file.`);
          continue;
        }
        if (isDocx) {
          const mammoth: any = await import('mammoth');
          const lib = mammoth.default ?? mammoth;
          const buf = await file.arrayBuffer();
          const result = await lib.extractRawText({ arrayBuffer: buf });
          const rawText = typeof result?.value === 'string' ? result.value : '';
          if (!rawText.trim()) throw new Error(`"${file.name}" contains no extractable text.`);
          const chunks = splitDocxIntoPages(rawText);
          const meta: PDFLibraryMeta = {
            id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            title: file.name.replace(/\.docx$/i, ''),
            sizeBytes: file.size,
            numPages: chunks.length,
            addedAt: new Date().toISOString(),
            fileType: 'docx',
            subject: categorizeTitle(file.name),
          };
          await addLibraryDocument(meta, file);
          for (let i = 0; i < chunks.length; i++) {
            await savePageText(meta.id, i + 1, chunks[i]);
          }
          imported.push(meta);
          continue;
        }
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const meta: PDFLibraryMeta = {
          id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          title: file.name.replace(/\.pdf$/i, ''),
          sizeBytes: file.size,
          numPages: pdf.numPages,
          addedAt: new Date().toISOString(),
          fileType: 'pdf',
          subject: categorizeTitle(file.name),
        };
        try { await pdf.destroy(); } catch { /* ignore */ }
        await addLibraryDocument(meta, file);
        imported.push(meta);
      }
      const all = await refreshLibrary();
      if (imported.length && all.length) {
        await openDoc(imported[0].id);
      }
    } catch (err: any) {
      setLibraryError(err?.message || 'Import failed.');
    }
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await removeLibraryDocument(id);
      const all = await refreshLibrary();
      if (id === activeDocId) {
        clearRenderedPages();
        if (pdfRef.current) { try { await pdfRef.current.destroy(); } catch { /* ignore */ } pdfRef.current = null; }
        setActiveDocId(null);
        setNumPages(0);
        if (all.length) await openDoc(all[0].id);
      }
    } catch (err: any) {
      setLibraryError(err?.message || 'Could not delete the document.');
    }
  };

  const setDocSubject = async (id: string, subject: string) => {
    try {
      await updateLibraryMeta(id, { subject: subject.trim() || 'Uncategorised' });
      await refreshLibrary();
    } catch (err: any) {
      setLibraryError(err?.message || 'Could not save the subject.');
    }
  };

  const editSubject = async () => {
    const doc = docs.find((d) => d.id === activeDocId);
    if (!doc) return;
    const next = window.prompt('Subject / discipline for this book:', doc.subject || 'Uncategorised');
    if (next === null) return;
    await setDocSubject(doc.id, next);
  };
  const MAX_RENDERED = 24;
  const fitScale = useCallback(() => {
    const container = scrollRef.current;
    const base = baseDimsRef.current;
    if (!container || !base) return scaleRef.current;
    return Math.max(0.25, Math.min(4, (container.clientWidth - 48) / base.w));
  }, []);

  useEffect(() => {
    if (!fitWidth) return;
    const container = scrollRef.current;
    if (!container) return;
    const apply = () => setScale(fitScale());
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitWidth, fitScale, activeDocId, numPages]);

  const renderPage = useCallback(async (num: number) => {
    const pdf = pdfRef.current;
    const container = scrollRef.current;
    if (!pdf || !container) return;
    if (renderedRef.current.has(num) || renderingRef.current.has(num) || num < 1 || num > pdf.numPages) return;
    renderingRef.current.add(num);
    try {
      const page = await pdf.getPage(num);
      const s = scaleRef.current;
      const viewport = page.getViewport({ scale: s });
      const wrap = pageWrapRefs.current.get(num);
      if (!wrap) { renderingRef.current.delete(num); return; }
      wrap.style.width = `${Math.floor(viewport.width)}px`;
      wrap.style.height = `${Math.floor(viewport.height)}px`;
      let canvas = canvasRefs.current.get(num);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'block';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvasRefs.current.set(num, canvas);
      }
      const canvasParent = wrap.querySelector<HTMLDivElement>('[data-canvas-slot]');
      if (canvasParent) {
        if (canvas.parentElement !== canvasParent) {
          canvasParent.replaceChildren(canvas);
        }
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        let pxW = Math.max(1, Math.floor(cssW * dpr));
        let pxH = Math.max(1, Math.floor(cssH * dpr));
        const shrink = Math.min(1, 4096 / Math.max(pxW, pxH), Math.sqrt(16_000_000 / Math.max(1, pxW * pxH)));
        pxW = Math.max(1, Math.floor(pxW * shrink));
        pxH = Math.max(1, Math.floor(pxH * shrink));
        canvas.width = pxW;
        canvas.height = pxH;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const prevTask = renderTasksRef.current.get(num);
        if (prevTask) { try { prevTask.cancel(); } catch { /* ignore */ } }
        const renderViewport = shrink < 1 ? page.getViewport({ scale: s * shrink }) : viewport;
        const task = page.render({
          canvasContext: canvas.getContext('2d')!,
          viewport: renderViewport,
          ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {}),
        });
        renderTasksRef.current.set(num, task);
        await task.promise;
        renderTasksRef.current.delete(num);
      }
      const slot = wrap.querySelector<HTMLDivElement>('[data-text-slot]');
      if (slot) {
        slot.replaceChildren();
        const tl = (pdfjsLib as any).TextLayer;
        if (tl) {
          slot.style.setProperty('--scale-factor', String(s));
          slot.style.setProperty('--total-scale-factor', String(s));
          slot.style.setProperty('--user-unit', '1');
          try {
            const textLayer = new tl({
              textContentSource: page.streamTextContent({ includeMarkedContent: false }),
              container: slot,
              viewport,
            });
            await textLayer.render();
            if (!slot.querySelector('.endOfContent')) {
              const end = document.createElement('div');
              end.className = 'endOfContent';
              slot.appendChild(end);
            }
            const nativeLen = (slot.textContent || '').replace(/\s+/g, '').length;
            if (nativeLen > 20) {
              if (!nativeTextPagesRef.current.has(num)) {
                nativeTextPagesRef.current.add(num);
                setWordsVersion((v) => v + 1);
              }
            } else if (nativeTextPagesRef.current.delete(num)) {
              setWordsVersion((v) => v + 1);
            }
          } catch (err) {
            console.warn(`Text layer failed on page ${num}`, err);
          }
        }
        textLayerRefs.current.set(num, slot);
      }
      renderedRef.current.add(num);
      if (renderedRef.current.size > MAX_RENDERED) {
        const sorted = [...renderedRef.current]
          .map((n) => ({ n, dist: Math.abs(n - currentPageRef.current) }))
          .sort((a, b) => b.dist - a.dist);
        for (const { n } of sorted.slice(0, Math.max(2, renderedRef.current.size - MAX_RENDERED + 4))) {
          if (n === currentPageRef.current) continue;
          const task = renderTasksRef.current.get(n);
          if (task) { try { task.cancel(); } catch { /* ignore */ } renderTasksRef.current.delete(n); }
          const wrapN = pageWrapRefs.current.get(n);
          const slotN = wrapN?.querySelector<HTMLDivElement>('[data-canvas-slot]');
          if (slotN) slotN.replaceChildren();
          const textSlotN = wrapN?.querySelector<HTMLDivElement>('[data-text-slot]');
          if (textSlotN) textSlotN.replaceChildren();
          canvasRefs.current.delete(n);
          textLayerRefs.current.delete(n);
          renderedRef.current.delete(n);
        }
      }
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        setPageErrors((prev) => ({ ...prev, [num]: err?.message || 'Render failed.' }));
      }
    } finally {
      renderingRef.current.delete(num);
    }
  }, []);

  const lastScaleRef = useRef(scale);
  useEffect(() => {
    if (lastScaleRef.current === scale || !pdfRef.current) { lastScaleRef.current = scale; return; }
    lastScaleRef.current = scale;
    clearRenderedPages();
    const base = baseDimsRef.current;
    if (base) {
      for (const wrap of pageWrapRefs.current.values()) {
        wrap.style.width = `${Math.floor(base.w * scale)}px`;
        wrap.style.height = `${Math.floor(base.h * scale)}px`;
      }
    }
    requestAnimationFrame(() => {
      observerRef.current?.disconnect();
      for (const wrap of pageWrapRefs.current.values()) observerRef.current?.observe(wrap);
      void renderPage(currentPageRef.current);
    });
  }, [scale, clearRenderedPages]);

  useEffect(() => {
  }, [numPages]);

  useEffect(() => {
    if (!pdfRef.current) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const num = Number((entry.target as HTMLElement).dataset.pageNumber);
        if (!num || Number.isNaN(num)) continue;
        const ratio = entry.intersectionRatio;
        if (ratio > 0) {
          visibleRatiosRef.current.set(num, ratio);
          if (!renderedRef.current.has(num)) renderPage(num);
        } else {
          visibleRatiosRef.current.delete(num);
        }
      }
      let best = -1;
      let bestRatio = 0;
      for (const [n, r] of visibleRatiosRef.current) {
        if (r > bestRatio) { best = n; bestRatio = r; }
      }
      if (best > 0 && best !== currentPageRef.current) setCurrentPage(best);
    }, { root: scrollRef.current, rootMargin: '50% 0px', threshold: [0, 0.1, 0.3, 0.6, 0.9] });
    observerRef.current = io;
    for (const wrap of pageWrapRefs.current.values()) io.observe(wrap);
    const id = requestAnimationFrame(() => {
      if (observerRef.current !== io) return;
      for (const wrap of pageWrapRefs.current.values()) io.observe(wrap);
    });
    void id;
    return () => { io.disconnect(); if (observerRef.current === io) observerRef.current = null; };
  }, [activeDocId, numPages, renderPage]);

  const setPageWrapRef = useCallback((num: number, el: HTMLDivElement | null) => {
    if (el) {
      pageWrapRefs.current.set(num, el);
      observerRef.current?.observe(el);
    } else {
      const existing = pageWrapRefs.current.get(num);
      if (existing) observerRef.current?.unobserve(existing);
      pageWrapRefs.current.delete(num);
    }
  }, [renderPage]);

  const jumpToPage = useCallback((num: number) => {
    const wrap = pageWrapRefs.current.get(num);
    const container = scrollRef.current;
    if (!wrap || !container) return;
    container.scrollTo({ top: wrap.offsetTop - 12, behavior: 'smooth' });
  }, []);

  const gotoPage = (num: number) => {
    const n = Math.max(1, Math.min(numPages, Math.round(num) || 0));
    setCurrentPage(n);
    jumpToPage(n);
  };

  useEffect(() => {
    let cancelled = false;
    let timer: any = null;
    (async () => {
      let target: { docId?: string; page?: number } | null = null;
      try {
        const raw = sessionStorage.getItem('pulse.openPdf');
        if (raw) {
          sessionStorage.removeItem('pulse.openPdf');
          target = JSON.parse(raw);
        }
      } catch {
        target = null;
      }
      if (!target?.docId) return;
      const all = await listLibraryDocuments();
      if (cancelled) return;
      if (!all.some((d) => d.id === target!.docId)) {
        setLibraryError('That book is no longer in the local library.');
        return;
      }
      await openDoc(target.docId);
      if (cancelled) return;
      const page = Math.max(1, Math.round(Number(target.page) || 1));
      setCurrentPage(page);
      timer = setTimeout(() => {
        if (!cancelled) jumpToPage(page);
      }, 250);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  const ensurePageText = useCallback(async (num: number): Promise<string> => {
    const cachedMem = pageTextsRef.current.get(num);
    if (cachedMem !== undefined) return cachedMem;
    const cachedIdb = await getPageText(activeDocId ?? '', num).catch(() => null);
    if (cachedIdb && cachedIdb.text) {
      pageTextsRef.current.set(num, cachedIdb.text);
      if (cachedIdb.words && cachedIdb.words.length) {
        ocrWordsRef.current.set(num, cachedIdb.words);
      }
      return cachedIdb.text;
    }
    if (!pdfRef.current) return '';
    const page = await pdfRef.current.getPage(num);
    const tc = await page.getTextContent();
    const text = (tc.items || []).map((it: any) => (typeof it?.str === 'string' ? it.str : '')).filter(Boolean).join(' ');
    if (activeDocId) await savePageText(activeDocId, num, text).catch(() => undefined);
    pageTextsRef.current.set(num, text);
    return text;
  }, [activeDocId]);

  const runSearch = async () => {
    const q = searchQuery.trim();
    if (!numPages || !q) return;
    searchCancelRef.current = false;
    setIndexing({ busy: true, done: 0 });
    const found: number[] = [];
    const lower = q.toLowerCase();
    try {
      for (let n = 1; n <= numPages; n++) {
        if (searchCancelRef.current) break;
        const text = (await ensurePageText(n)).toLowerCase();
        if (text.includes(lower)) found.push(n);
        setIndexing({ busy: true, done: n });
      }
      setMatches(found);
      setMatchIndex(found.length ? 0 : -1);
      if (found.length) { setCurrentPage(found[0]); jumpToPage(found[0]); }
    } catch (err: any) {
      setLibraryError(err?.message || 'Search failed.');
    } finally {
      setIndexing({ busy: false, done: 0 });
    }
  };

  const moveMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (matchIndex + dir + matches.length) % matches.length;
    setMatchIndex(next);
    jumpToPage(matches[next]);
  };

  const stopSearch = () => {
    searchCancelRef.current = true;
  };

  useEffect(() => {
    if (viewMode !== 'text' || !activeDocId || !numPages) return;
    let cancelled = false;
    const page = Math.max(1, Math.min(numPages, currentPage));
    setTextView((prev) => ({ ...prev, loading: true, page }));
    ensurePageText(page)
      .then((text) => {
        if (!cancelled) setTextView({ loading: false, text, page });
      })
      .catch((err: any) => {
        if (!cancelled) setTextView({ loading: false, text: `Could not read page ${page}: ${err?.message || 'unknown error'}`, page });
      });
    return () => { cancelled = true; };
  }, [viewMode, currentPage, activeDocId, numPages, ensurePageText]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || viewMode !== 'page') return;
    const mark = () => scroller.querySelectorAll<HTMLElement>('.textLayer').forEach((el) => el.classList.add('selecting'));
    const unmark = () => scroller.querySelectorAll<HTMLElement>('.textLayer').forEach((el) => el.classList.remove('selecting'));
    scroller.addEventListener('pointerdown', mark);
    window.addEventListener('pointerup', unmark);
    window.addEventListener('pointercancel', unmark);
    return () => {
      scroller.removeEventListener('pointerdown', mark);
      window.removeEventListener('pointerup', unmark);
      window.removeEventListener('pointercancel', unmark);
    };
  }, [viewMode]);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setPopup(null);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || sel.isCollapsed || text.length < 3 || !pdfRef.current) {
      setPopup(null);
      return;
    }
    const anchorEl = (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement) as HTMLElement | null;
    if (!anchorEl?.closest('.textLayer, .ocrTextLayer')) { setPopup(null); return; }
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const container = scrollRef.current;
    if (!range || !container) { setPopup(null); return; }
    const row = container.parentElement;
    if (!row) { setPopup(null); return; }
    const rowRect = row.getBoundingClientRect();
    const above = range.top - rowRect.top - 44;
    setPopup({
      x: Math.min(Math.max(range.left - rowRect.left, 12), Math.max(12, row.clientWidth - 190)),
      y: above >= 8 ? above : Math.min(range.bottom - rowRect.top + 8, Math.max(8, row.clientHeight - 60)),
      text: text.slice(0, 4000),
    });
  };

  const saveSelectionHighlight = (color: string) => {
    if (!popup || !activeDocId) return;
    const doc = docs.find((d) => d.id === activeDocId);
    let rects: { x: number; y: number; w: number; h: number }[] | undefined;
    const sel = window.getSelection();
    const wrap = pageWrapRefs.current.get(currentPageRef.current);
    if (sel && wrap && sel.rangeCount > 0) {
      const pageRect = wrap.getBoundingClientRect();
      if (pageRect.width > 0 && pageRect.height > 0) {
        rects = Array.from(sel.getRangeAt(0).getClientRects())
          .filter((r) => r.width > 1 && r.height > 1)
          .map((r) => ({
            x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
            y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
            w: Math.min(1, r.width / pageRect.width),
            h: Math.min(1, r.height / pageRect.height),
          }))
          .filter((r) => r.w > 0 && r.h > 0);
      }
    }
    addUserHighlight(highlightFromPdfSelection({
      docId: activeDocId,
      docTitle: doc?.title ?? 'PDF',
      page: currentPageRef.current,
      quote: popup.text,
      color,
      rects,
    }));
    setHighlights(listUserHighlightsForDoc(activeDocId));
    setPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const copySelection = () => {
    if (!popup) return;
    navigator.clipboard.writeText(popup.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setPopup(null);
  };

  const deleteHighlight = (id: string) => {
    removeUserHighlight(id);
    if (activeDocId) setHighlights(listUserHighlightsForDoc(activeDocId));
  };
  const ocrJobRef = useRef<JobControl | null>(null);

  const runOcr = async (scope: 'current' | 'missing') => {
    if (!pdfRef.current || !activeDocId || ocrBusy) return;
    const doc = docs.find((d) => d.id === activeDocId);
    const pages: number[] = scope === 'current'
      ? [currentPageRef.current]
      : Array.from({ length: numPages }, (_, i) => i + 1);
    setOcrBusy(true);
    setOcrNote(null);
    const job = startJob(`OCR · ${doc?.title ?? 'document'}`, scope === 'current' ? `page ${pages[0]}` : 'scanning pages…');
    ocrJobRef.current = job;
    let processed = 0;
    let skipped = 0;
    let pool: Awaited<ReturnType<typeof createOcrPool>> | null = null;
    const failures: string[] = [];
    const K = scope === 'current' ? 1 : Math.max(1, ocrConcurrency());
    const measure = document.createElement('canvas').getContext('2d')!;
    try {
      pool = await createOcrPool(K);
      let next = 0;
      const runOne = async () => {
        for (;;) {
          const index = next++;
          if (index >= pages.length || job.isCancelled()) return;
          const n = pages[index];
          try {
            if (scope === 'missing' && !ocrForce) {
              const existing = await ensurePageText(n).catch(() => '');
              if (existing.trim()) { skipped += 1; return; }
            }
            job.update({ detail: `page ${n} · rendering` });
            const page = await pdfRef.current.getPage(n);
            const baseVp = page.getViewport({ scale: 1 });
            const ocrScale = Math.max(0.05, Math.min(2, 2000 / Math.max(1, baseVp.width)));
            const viewport = page.getViewport({ scale: ocrScale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
            const result = await pool!.recognize(canvas, (p) => {
              job.update({
                progress: Math.round(((processed + p.progress) / pages.length) * 100),
                detail: `page ${n} · ${p.status}`,
              });
            });
            const words = normalizeOcrWords(result.words, canvas.width, canvas.height, measure);
            if (result.text.trim()) {
              await savePageText(activeDocId, n, result.text, words);
              pageTextsRef.current.set(n, result.text);
              if (words.length) {
                ocrWordsRef.current.set(n, words);
                setWordsVersion((v) => v + 1);
              }
            }
            canvas.width = 0;
            canvas.height = 0;
            processed += 1;
            job.update({
              progress: Math.min(100, Math.round((processed / pages.length) * 100)),
              detail: `page ${n} done · ${processed}/${pages.length}`,
            });
          } catch (err: any) {
            failures.push(`p.${n}: ${err?.message || 'failed'}`);
          }
        }
      };
      await Promise.all(Array.from({ length: K }, () => runOne()));
      const parts = [
        `${processed} page${processed === 1 ? '' : 's'} recognised`,
        skipped ? `${skipped} skipped (already had text)` : '',
        failures.length ? `${failures.length} failed` : '',
      ].filter(Boolean);
      if (job.isCancelled()) {
        job.done(`stopped · ${parts.join(', ')}`);
        setOcrNote(`OCR stopped. ${parts.join(', ')}.`);
      } else {
        job.done(parts.join(', '));
        setOcrNote(
          `OCR finished: ${parts.join(', ')}.` +
          (failures.length ? ` Problems: ${failures.slice(0, 4).join('; ')}${failures.length > 4 ? '…' : ''}` : ''),
        );
      }
    } catch (err: any) {
      const message = err?.message || 'OCR failed.';
      job.fail(message);
      setOcrNote(`OCR error: ${message}`);
    } finally {
      try { await pool?.terminate(); } catch { /* already gone */ }
      setOcrBusy(false);
      ocrJobRef.current = null;
    }
  };

  // ============================ Make notes from pages ============================

  const makeNotesFromPages = async () => {
    const provider = getActiveProvider();
    if (!provider) { setNotesError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    if (!activeDocId || numPages === 0) { setNotesError('Open a document first.'); return; }
    const from = Math.max(1, Math.min(numPages, Math.floor(notesFrom) || 1));
    const to = Math.max(from, Math.min(numPages, Math.floor(notesTo) || from));
    const partSize = Math.max(1, Math.min(20, Math.floor(notesPartSize) || 5));
    const doc = docs.find((d) => d.id === activeDocId);
    const totalParts = Math.ceil((to - from + 1) / partSize);

    notesCancelRef.current = false;
    setNotesBusy(true);
    setNotesError(null);
    const job = startJob(`Notes from pages · ${doc?.title ?? 'document'}`, `pages ${from}–${to}`);
    let saved = 0;
    try {
      for (let part = 0; part < totalParts; part++) {
        if (notesCancelRef.current || job.isCancelled()) break;
        const start = from + part * partSize;
        const end = Math.min(to, start + partSize - 1);
        job.update({ progress: Math.round((part / totalParts) * 100), detail: `reading pages ${start}–${end}` });
        const parts: string[] = [];
        for (let n = start; n <= end; n++) {
          const text = await ensurePageText(n).catch(() => '');
          if (text.trim()) parts.push(`[page ${n}]\n${text}`);
        }
        if (!parts.length) continue;
        const raw = await aiComplete({
          system:
            'You are a high-yield medical revision writer. Turn the supplied book pages into a compact revision note. ' +
            'Use short headings, bullets, and mark the key takeaway with a line starting "High-yield:" and any memory device with "Mnemonic:". ' +
            'Cite the page numbers inline as "p. N". Plain text only.',
          messages: [{
            role: 'user',
            content: `Book: ${doc?.title ?? 'document'}\nPages ${start}–${end}:\n\n${parts.join('\n\n').slice(0, 12000)}\n\nWrite the revision notes for these pages.`,
          }],
          provider,
          model: getEffectiveModel(provider),
        });
        const text = raw.trim();
        if (!text) continue;
        setMadeNotes((prev) => [...prev, { range: `pp. ${start}–${end}`, text }]);
        saved += 1;
        job.update({ progress: Math.round(((part + 1) / totalParts) * 100), detail: `${saved} part${saved === 1 ? '' : 's'} saved` });
      }
      if (notesCancelRef.current || job.isCancelled()) {
        job.done(`Stopped — ${saved} part${saved === 1 ? '' : 's'} saved`);
      } else {
        job.done(`${saved} note part${saved === 1 ? '' : 's'} saved`);
      }
    } catch (err: any) {
      const message = err?.message || 'Could not make notes from these pages.';
      job.fail(message);
      setNotesError(message);
    } finally {
      setNotesBusy(false);
    }
  };

  // ============================ Ask AI panel ============================

  const openAskPanel = async (mode: 'selection' | 'page') => {
    setAskPanel(true);
    setAskError(null);
    setMcqs([]);
    if (mode === 'selection' && popup) {
      setAskContext(popup.text);
      setAskContextLabel(`selection (p. ${currentPageRef.current})`);
      setPopup(null);
    } else {
      const text = await ensurePageText(currentPageRef.current).catch(() => '');
      setAskContext(text.slice(0, 6000));
      setAskContextLabel(`page ${currentPageRef.current}`);
    }
  };

  const askAi = async (customQuestion?: string) => {
    const provider = getActiveProvider();
    if (!provider) { setAskError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    if (!askContext.trim()) {
      const text = await ensurePageText(currentPageRef.current).catch(() => '');
      setAskContext(text.slice(0, 6000));
      if (!text.trim()) { setAskError('No text available on this page (possibly a scanned image without OCR).'); return; }
    }
    setAskBusy(true);
    setAskError(null);
    setAskCitations([]);
    setAskReply('');
    const question = customQuestion?.trim() || `Explain the key clinical content clearly and completely, with mechanisms and any exam-relevant points.`;
    setAskQuestion(question);
    const contextText = askContext.trim();
    try {
      let webBlock = '';
      let urls: string[] = [];
      if (askIncludeWeb) {
        try {
          const res = await fetch('/api/web/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: contextText.split('\n')[0].slice(0, 120) || question }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(data.sources)) {
            webBlock = data.sources.map((s: any) => `[W${s.n}] ${s.title} (${s.url})\n${String(s.text).slice(0, 800)}`).join('\n\n');
            setAskCitations(data.sources.map((s: any) => `- W${s.n}: ${s.url}`));
          }
        } catch { /* web optional — proceed without */ }
      }

      const raw = await aiComplete({
        system:
          'You are the Pulse Med clinical assistant answering STRICTLY from the provided book passage' +
          (askIncludeWeb ? ' and the labelled web sources.' : ' only.') +
          ' Explain accurately with mechanisms; if the passage does not cover something, say so. Cite the passage as [book p. N] and web sources as [Wn].',
        messages: [{
          role: 'user',
          content:
            `Book: ${docs.find((d) => d.id === activeDocId)?.title ?? 'PDF'} — context from ${askContextLabel}:\n\n${contextText}\n\n` +
            (webBlock ? `Web sources:\n\n${webBlock}\n\n` : '') +
            `Question: ${question}`,
        }],
        provider,
        model: getEffectiveModel(provider),
      });
      setAskReply(raw);
    } catch (err: any) {
      setAskError(err?.message || 'AI request failed.');
    } finally {
      setAskBusy(false);
    }
  };

  const generateMcqs = async () => {
    const provider = getActiveProvider();
    if (!provider) { setAskError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    const contextText = ((askContextLabel === `page ${currentPageRef.current}` && askContext)
      ? askContext
      : await ensurePageText(currentPageRef.current).catch(() => '')).trim();
    if (!contextText) { setAskError('No selectable text on this page.'); return; }
    setMcqBusy(true);
    setAskError(null);
    try {
      const raw = await aiComplete({
        system: 'Write exam-style single-best-answer MCQs strictly from the provided passage. Respond with ONLY a JSON object: {"questions":[{"question","options":["A text",...],"answerIndex":0,"explanation"}]}.',
        messages: [{
          role: 'user',
          content: `Passage (${askContextLabel}):\n\n${contextText.slice(0, 6000)}\n\nGenerate 3 MCQs with 4 options each, answerIndex pointing at the correct option, and a one-line explanation.`,
        }],
        json: true,
        provider,
        model: getEffectiveModel(provider),
      });
      const parsed = extractJson<{ questions?: any[] }>(raw);
      const list = (Array.isArray(parsed) ? parsed : parsed?.questions) ?? [];
      const clean = list
        .filter((q: any) => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length >= 2)
        .map((q: any) => ({
          question: String(q.question),
          options: q.options.map((o: any) => String(o)),
          answerIndex: typeof q.answerIndex === 'number' && q.answerIndex < q.options.length ? q.answerIndex : 0,
          explanation: typeof q.explanation === 'string' ? q.explanation : '',
        }))
        .slice(0, 5);
      if (!clean.length) throw new Error('The AI returned no valid MCQs. Try again.');
      setMcqs(clean);
      setShowMcqAnswers({});
      setMcqIndex(0);
      setMcqPicked(null);
    } catch (err: any) {
      setAskError(err?.message || 'MCQ generation failed.');
    } finally {
      setMcqBusy(false);
    }
  };

  // A new page invalidates everything generated for the previous one.
  useEffect(() => {
    setMcqPicked(null);
    setMcqIndex(0);
  }, [currentPage, activeDocId]);

  const printDocument = async () => {
    if (!activeDocId) return;
    try {
      const rec = await getLibraryDocument(activeDocId);
      if (!rec) return;
      if (rec.fileType === 'docx') {
        const pages = (await listPageTexts(activeDocId)).sort((a, b) => a.pageNumber - b.pageNumber);
        if (!pages.length) throw new Error('This document has no extracted text to print.');
        const win = window.open('', '_blank', 'width=860,height=1000');
        if (!win) throw new Error('The browser blocked the print window.');
        const doc = win.document;
        const head = doc.createElement('head');
        const meta = doc.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        const title = doc.createElement('title');
        title.textContent = rec.title;
        const style = doc.createElement('style');
        style.textContent = 'body{font-family:Georgia,serif;margin:40px;line-height:1.6;color:#111} h1{font-size:22px} .page{margin-bottom:28px} .num{font-size:11px;color:#777;border-top:1px solid #ddd;padding-top:4px;margin-top:16px} @media print{body{margin:16mm}}';
        head.append(meta, title, style);
        doc.head.replaceWith(head);
        const body = doc.body;
        const h1 = doc.createElement('h1');
        h1.textContent = rec.title;
        body.appendChild(h1);
        for (const page of pages) {
          const wrap = doc.createElement('div');
          wrap.className = 'page';
          const text = doc.createElement('div');
          text.textContent = page.text;
          text.style.whiteSpace = 'pre-wrap';
          const num = doc.createElement('div');
          num.className = 'num';
          num.textContent = `Page ${page.pageNumber} of ${pages.length}`;
          wrap.append(text, num);
          body.appendChild(wrap);
        }
        win.focus();
        setTimeout(() => win.print(), 300);
        return;
      }
      const url = URL.createObjectURL(rec.blob);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } finally {
          setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); }, 30000);
        }
      };
    } catch (err: any) {
      setLibraryError(err?.message || 'Print failed.');
    }
  };

  const nativeFsRef = useRef<boolean>(false);
  const toggleFullscreen = async () => {
    const next = !immersive;
    setImmersive(next);
    try {
      if (next && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        nativeFsRef.current = true;
      }
      if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
        nativeFsRef.current = false;
      }
    } catch {
      nativeFsRef.current = false;
    }
  };

  useEffect(() => {
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setImmersive(false); };
    const onFsChange = () => {
      if (nativeFsRef.current && !document.fullscreenElement) {
        nativeFsRef.current = false;
        setImmersive(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [immersive]);

  const downloadDocument = async () => {
    if (!activeDocId) return;
    try {
      const rec = await getLibraryDocument(activeDocId);
      if (!rec) return;
      const url = URL.createObjectURL(rec.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = rec.fileType === 'docx' ? `${rec.title}.docx` : `${rec.title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err: any) {
      setLibraryError(err?.message || 'Download failed.');
    }
  };

  const fitPageScale = useCallback(() => {
    const container = scrollRef.current;
    const base = baseDimsRef.current;
    if (!container || !base) return scaleRef.current;
    const scaleW = (container.clientWidth - 48) / base.w;
    const scaleH = (container.clientHeight - 40) / base.h;
    return Math.max(0.25, Math.min(4, Math.min(scaleW, scaleH)));
  }, []);

  useEffect(() => {
    if (!numPages) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const current = currentPageRef.current;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); gotoPage(current + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); gotoPage(current - 1); }
      else if (e.key === '+' || e.key === '=') { setFitWidth(false); setScale((s) => Math.min(4, +(s + 0.2).toFixed(2))); }
      else if (e.key === '-') { setFitWidth(false); setScale((s) => Math.max(0.25, +(s - 0.2).toFixed(2))); }
      else if (e.key === 'Escape') setPopup(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages]);
  const activeDoc = docs.find((d) => d.id === activeDocId);
  const pageHighlights = highlights.filter((h) => h.page === currentPage && h.rects && h.rects.length > 0);
  const currentOcr = ocrWordsRef.current.has(currentPage);
  const currentNativeText = nativeTextPagesRef.current.has(currentPage);
  const indexedPages = pageTextsRef.current.size;
  const panelOpen = showNotes;

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col gap-2 overflow-y-auto p-2 lg:overflow-hidden bg-slate-200/70 text-slate-800">
      <section className={`shrink-0 rounded-xl border px-2.5 py-2 ${T.panel}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition active:scale-95 ${T.cta}`}
              title="Import a PDF or DOCX (stored locally in IndexedDB)"
            >
              <UploadCloud className="h-3.5 w-3.5" /> Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              multiple
              className="hidden"
              onChange={(e) => { handleImportFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto py-0.5">
              {docs.map((d) => {
                const on = d.id === activeDocId;
                return (
                  <div
                    key={d.id}
                    className={`flex shrink-0 items-center rounded-lg border transition ${on ? T.chipAccent : `${T.border} ${T.panelSoft}`}`}
                  >
                    <button
                      onClick={() => openDoc(d.id)}
                      title={`${d.title} · ${d.numPages} pages`}
                      className={`flex items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] ${on ? 'font-bold' : T.muted}`}
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="max-w-[150px] truncate">{d.title}</span>
                      {on && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                    </button>
                    {on && (
                      <button
                        onClick={() => handleDeleteDoc(d.id)}
                        title="Remove from library"
                        className="pr-1.5 text-current opacity-40 transition hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
              {!docs.length && (
                <span className={`px-1 font-mono text-[10px] ${T.dim}`}>No documents yet — import a PDF or DOCX</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`hidden items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[9px] uppercase tracking-wider xl:flex ${T.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${numPages ? 'bg-emerald-500' : 'bg-slate-500'}`} />
              {numPages ? 'Local engine · ready' : 'Idle'}
            </span>
            {numPages > 0 && (
              <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 ${T.divider}`}>
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] ${T.dim}`}>
                  <span className="flex items-center gap-1">{numPages} pages</span>
                  <span className="flex items-center gap-1">
                    <ScanText className="h-3 w-3" />
                    OCR: {ocrBusy ? 'running' : currentOcr ? `ready (${ocrWordsRef.current.size} pp)` : currentNativeText ? 'native text' : 'not scanned'}
                  </span>
                  <span className="hidden sm:inline">{activeDoc?.subject ?? 'Uncategorised'}</span>
                  <span className="hidden lg:inline">{indexedPages} indexed</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className={`flex min-w-[180px] flex-1 items-center gap-1 rounded-lg border px-2 py-1 sm:flex-none ${T.input}`}>
                    <Search className={`h-3 w-3 shrink-0 ${T.dim}`} />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                      placeholder="Search this book…"
                      className="min-w-0 flex-1 bg-transparent text-[11px] focus:outline-none"
                    />
                    {indexing.busy ? (
                      <button onClick={stopSearch} className="flex shrink-0 items-center gap-1 text-[9px] text-amber-600 dark:text-amber-300" title="Stop indexing">
                        <Loader2 className="h-3 w-3 animate-spin" /> {indexing.done}/{numPages}
                      </button>
                    ) : matches.length > 0 ? (
                      <button onClick={() => moveMatch(1)} className={`shrink-0 font-mono text-[9px] ${T.accent}`} title="Next match">
                        {matchIndex + 1}/{matches.length}
                      </button>
                    ) : null}
                    <button onClick={() => moveMatch(-1)} disabled={!matches.length} className="p-0.5 disabled:opacity-30" title="Previous match">
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <button onClick={() => moveMatch(1)} disabled={!matches.length} className="p-0.5 disabled:opacity-30" title="Next match">
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 ${T.input}`}>
                    <button onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} className="p-0.5 disabled:opacity-30" title="Previous page">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <input
                      value={currentPage}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setCurrentPage(n); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') gotoPage(currentPage); }}
                      className="w-8 bg-transparent text-center font-mono text-[11px] focus:outline-none"
                      title="Jump to page"
                    />
                    <span className={`font-mono text-[9px] ${T.dim}`}>/ {numPages}</span>
                    <button onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-0.5 disabled:opacity-30" title="Next page">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 ${T.input}`}>
                    <button onClick={() => { setFitWidth(false); setScale((s) => Math.max(0.25, +(s - 0.2).toFixed(2))); }} title="Zoom out">
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-9 text-center font-mono text-[10px]">{Math.round(scale * 100)}%</span>
                    <button onClick={() => { setFitWidth(false); setScale((s) => Math.min(4, +(s + 0.2).toFixed(2))); }} title="Zoom in">
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setFitWidth(!fitWidth)} title="Fit width" className={fitWidth ? T.accent : T.dim}>
                      <Maximize className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => { setFitWidth(false); setScale(fitPageScale()); }} title="Fit whole page" className={T.dim}>
                      <Focus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => setOcrOpen((v) => !v)}
                    title="OCR matrix — read scanned pages locally"
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${ocrOpen ? T.chipAccent : T.chip}`}
                  >
                    <ScanText className="h-3 w-3" /> OCR Matrix
                  </button>
                  <button
                    onClick={() => setNotesOpen((v) => !v)}
                    title="Generate revision notes from a page range"
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${notesOpen ? T.chipAccent : T.chip}`}
                  >
                    <NotebookPen className="h-3 w-3" /> Page notes
                  </button>
                  <button
                    onClick={() => generateMcqs()}
                    disabled={mcqBusy || !getActiveProvider()}
                    title={getActiveProvider() ? 'Generate MCQs from this page' : 'Connect an AI provider first'}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-40 ${getActiveProvider() ? T.cta : T.chip} ${T.softHover}`}
                  >
                    {mcqBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GraduationCap className="h-3 w-3" />}
                    {mcqBusy ? 'Generating…' : mcqs.length ? 'Regenerate MCQs' : 'Generate MCQs'}
                  </button>
                  <button
                    onClick={() => setAskPanel((v) => !v)}
                    title="Ask AI about this page"
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition ${askPanel ? T.chipAccent : T.chip} ${T.softHover}`}
                  >
                    <Sparkles className="h-3 w-3" /> Ask AI
                  </button>
                  <button
                    onClick={() => onNavigate('research')}
                    title="Open the clinical evidence browser"
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${T.chip} ${T.softHover}`}
                  >
                    <ScanText className="h-3 w-3" /> Evidence
                  </button>
                  <button onClick={printDocument} title="Print" className={`rounded-lg border p-1.5 transition ${T.chip} ${T.softHover}`}>
                    <Printer className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={downloadDocument} title="Download the original file" className={`rounded-lg border p-1.5 transition ${T.chip} ${T.softHover}`}>
                    <FileDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      {ocrOpen && numPages > 0 && (
        <div className={`shrink-0 rounded-xl border p-2.5 text-xs ${T.panel}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`flex items-center gap-1.5 text-[11px] font-bold ${T.strong}`}>
              <ScanText className={`h-4 w-4 ${T.accent}`} /> OCR matrix
              <span className={`font-mono text-[9px] ${T.dim}`}>tesseract.js · English · on-device</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${T.muted}`}>
                <input type="checkbox" checked={ocrForce} onChange={(e) => setOcrForce(e.target.checked)} className="accent-[#0f8b8d]" />
                Force OCR even where text exists
              </label>
              <button onClick={() => setOcrOpen(false)} className={`${T.dim} hover:opacity-70`} title="Close"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => runOcr('current')}
              disabled={ocrBusy || !pdfRef.current}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.cta}`}
            >
              {ocrBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanText className="h-3 w-3" />}
              OCR current page ({currentPage})
            </button>
            <button
              onClick={() => runOcr('missing')}
              disabled={ocrBusy || !pdfRef.current}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.chip}`}
            >
              <FileDown className="h-3 w-3" /> OCR pages without text
            </button>
            {ocrBusy && (
              <button
                onClick={() => { if (ocrJobRef.current) stopJob(ocrJobRef.current.id); }}
                className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <Square className="h-3 w-3" /> Stop OCR
              </button>
            )}
            {ocrNote && <span className={`text-[10px] ${T.muted}`}>{ocrNote}</span>}
            {!pdfRef.current && <span className="text-[10px] text-amber-600 dark:text-amber-300">OCR needs a PDF. DOCX already has real text.</span>}
          </div>
          <p className={`mt-1.5 text-[9px] leading-relaxed ${T.dim}`}>
            OCR is lossy — review recognised text. Results feed search and are cached per page.
          </p>
        </div>
      )}
      {notesOpen && numPages > 0 && (
        <div className={`shrink-0 rounded-xl border p-2.5 text-xs ${T.panel}`}>
          <div className="flex items-center justify-between">
            <span className={`flex items-center gap-1.5 text-[11px] font-bold ${T.strong}`}>
              <NotebookPen className={`h-4 w-4 ${T.accent}`} /> Make revision notes from pages
            </span>
            <button onClick={() => setNotesOpen(false)} className={`${T.dim} hover:opacity-70`} title="Close"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className={`text-[9px] font-semibold ${T.muted}`}>
              From
              <input type="number" min={1} max={numPages} value={notesFrom}
                onChange={(e) => setNotesFrom(Number(e.target.value))}
                className={`mt-0.5 block w-16 rounded-lg border px-2 py-1 text-[11px] ${T.input}`} />
            </label>
            <label className={`text-[9px] font-semibold ${T.muted}`}>
              To
              <input type="number" min={1} max={numPages} value={notesTo}
                onChange={(e) => setNotesTo(Number(e.target.value))}
                className={`mt-0.5 block w-16 rounded-lg border px-2 py-1 text-[11px] ${T.input}`} />
            </label>
            <label className={`text-[9px] font-semibold ${T.muted}`}>
              Pages / part
              <input type="number" min={1} max={20} value={notesPartSize}
                onChange={(e) => setNotesPartSize(Number(e.target.value))}
                className={`mt-0.5 block w-16 rounded-lg border px-2 py-1 text-[11px] ${T.input}`} />
            </label>
            <button
              onClick={makeNotesFromPages}
              disabled={notesBusy}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.cta}`}
            >
              {notesBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Generate notes'}
            </button>
            {notesBusy && (
              <button
                onClick={() => { notesCancelRef.current = true; }}
                className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            )}
            {madeNotes.length > 0 && (
              <button
                onClick={() => downloadNotesPdf(
                  `${activeDoc?.title ?? 'Book'} — page notes`,
                  madeNotes.map((n) => `## ${n.range}\n\n${n.text}`).join('\n\n'),
                )}
                className={`ml-auto flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${T.chip}`}
              >
                <FileDown className="h-3 w-3" /> Download all notes (PDF)
              </button>
            )}
          </div>
          {notesError && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{notesError}</span>
            </div>
          )}
          {madeNotes.length > 0 && (
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {madeNotes.map((n, i) => (
                <div key={`${n.range}-${i}`} className={`rounded-lg border p-2 ${T.panelSoft}`}>
                  <div className={`mb-1 font-mono text-[9px] font-bold ${T.dim}`}>{n.range}</div>
                  <RevisionNote text={n.text} topic={activeDoc?.title} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {(libraryError || docOpenError) && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span className="flex-1">{libraryError || docOpenError}</span>
          <button onClick={() => { setLibraryError(null); setDocOpenError(null); }}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-12">
        <article
          className={`flex min-h-0 flex-col overflow-hidden rounded-xl border ${T.panel} ${
            immersive ? 'fixed inset-0 z-50 rounded-none' : panelOpen ? 'lg:col-span-7' : 'lg:col-span-12'
          }`}
        >
          <header className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2.5 py-1.5 ${T.divider}`}>
            <div className="flex min-w-0 items-center gap-2">
              <BookOpen className={`h-4 w-4 shrink-0 ${T.accent}`} />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`truncate text-[11px] font-bold ${T.strong}`}>{activeDoc?.title ?? 'No document open'}</span>
                  {activeDoc && (
                    <button
                      onClick={editSubject}
                      title="Edit subject"
                      className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider ${T.chip}`}
                    >
                      {activeDoc.subject || 'Uncategorised'}
                    </button>
                  )}
                </div>
                <div className={`font-mono text-[9px] ${T.dim}`}>
                  {activeDoc ? `${activeDoc.fileType?.toUpperCase() ?? ''} · page ${currentPage} of ${numPages} · ${highlights.length} highlights` : 'Import a PDF or DOCX to begin'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowThumbs((v) => !v)}
                title="Page thumbnails"
                className={`rounded-lg border p-1.5 transition ${showThumbs ? T.chipAccent : `${T.chip} ${T.softHover}`}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowNotes((v) => !v)}
                title={panelOpen ? 'Hide highlights panel' : 'Show highlights panel'}
                className={`hidden rounded-lg border p-1.5 transition lg:block ${panelOpen ? T.chipAccent : `${T.chip} ${T.softHover}`}`}
              >
                <span className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={toggleFullscreen}
                title={immersive ? 'Exit full screen' : 'Full screen reader'}
                className={`rounded-lg border p-1.5 transition ${T.chip} ${T.softHover}`}
              >
                <Maximize className="h-3.5 w-3.5" />
              </button>
              <button onClick={printDocument} title="Print" className={`rounded-lg border p-1.5 transition ${T.chip} ${T.softHover}`}>
                <Printer className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onPointerDown={handlePointerDown}
              onMouseUp={handleMouseUp}
              className={`h-full overflow-auto ${T.reader} ${immersive ? '' : ''}`}
              style={{ scrollbarGutter: 'stable' }}
              data-ocr-version={wordsVersion}
            >
              {loadingDoc && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-slate-900/70">
                  <Loader2 className={`h-6 w-6 animate-spin ${T.accent}`} />
                </div>
              )}
              {viewMode === 'text' && numPages > 0 ? (
                <div className={`min-h-full ${T.panel}`}>
                  <div className="mx-auto max-w-3xl p-4">
                    <div className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${T.divider} ${T.panel}`}>
                      <span className={`font-mono text-[10px] uppercase tracking-wider ${T.muted}`}>
                        Extracted text · page {textView.page} / {numPages}
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} className={`rounded-lg border p-1 disabled:opacity-30 ${T.chip}`}>
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} className={`rounded-lg border p-1 disabled:opacity-30 ${T.chip}`}>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {textView.loading ? (
                      <div className={`flex items-center gap-2 py-8 text-xs ${T.muted}`}>
                        <Loader2 className={`h-4 w-4 animate-spin ${T.accent}`} /> Extracting page text…
                      </div>
                    ) : (
                      <div className={`whitespace-pre-wrap text-[13px] leading-7 ${T.text}`}>
                        {textView.text || 'No extractable text on this page. Run OCR from the toolbar to read a scanned page.'}
                      </div>
                    )}
                    <p className={`mt-6 border-t pt-3 text-[10px] ${T.divider} ${T.dim}`}>
                      Extracted text comes from the document itself or from a real OCR run — it is never invented.
                    </p>
                  </div>
                </div>
              ) : pdfRef.current && numPages > 0 ? (
                <div
                  className="flex flex-col items-center gap-4 px-2 py-4"
                  style={{
                    ['--scale-factor' as any]: String(scale),
                    ['--total-scale-factor' as any]: String(scale),
                    ['--user-unit' as any]: '1',
                  }}
                >
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
                    const base = baseDimsRef.current;
                    const w = base ? Math.floor(base.w * scale) : 620;
                    const h = base ? Math.floor(base.h * scale) : 800;
                    return (
                      <div
                        key={n}
                        data-page-number={n}
                        ref={(el) => setPageWrapRef(n, el)}
                        className="relative overflow-hidden rounded-sm border border-slate-300 bg-white shadow-md"
                        style={{ width: w, height: h, containerType: 'size' }}
                      >
                        <div data-canvas-slot className="pointer-events-none absolute inset-0" />
                        <div data-text-slot className="textLayer absolute inset-0 overflow-hidden" />
                        {ocrWordsRef.current.has(n) && !nativeTextPagesRef.current.has(n) && (
                          <div className="ocrTextLayer absolute inset-0 select-text overflow-hidden" style={{ zIndex: 2 }}>
                            {ocrWordsRef.current.get(n)!.map((word, i) => (
                              <span
                                key={i}
                                className="absolute select-text"
                                style={{
                                  left: `${word.bbox.x0 * 100}%`,
                                  top: `${word.bbox.y0 * 100}%`,
                                  width: `${(word.bbox.x1 - word.bbox.x0) * 100}%`,
                                  height: `${(word.bbox.y1 - word.bbox.y0) * 100}%`,
                                  fontSize: `${(word.bbox.y1 - word.bbox.y0) * 100}cqh`,
                                  lineHeight: `${(word.bbox.y1 - word.bbox.y0) * 100}cqh`,
                                  transform: `scaleX(${word.sx ?? 1})`,
                                  transformOrigin: 'left top',
                                  whiteSpace: 'pre',
                                  color: 'transparent',
                                  userSelect: 'text',
                                  cursor: 'text',
                                }}
                              >
                                {word.text + ' '}
                              </span>
                            ))}
                          </div>
                        )}
                        {highlights
                          .filter((h) => h.page === n && h.rects && h.rects.length > 0)
                          .map((h) =>
                            (h.rects ?? []).map((r, ri) => (
                              <div
                                key={`${h.id}-${ri}`}
                                title={h.quote.slice(0, 160)}
                                className="pointer-events-none absolute rounded-[1px] mix-blend-multiply"
                                style={{
                                  left: `${r.x * 100}%`,
                                  top: `${r.y * 100}%`,
                                  width: `${r.w * 100}%`,
                                  height: `${r.h * 100}%`,
                                  background: HL_COLORS.find((c) => c.id === h.color)?.css ?? '#fde047',
                                  opacity: 0.42,
                                  zIndex: 3,
                                }}
                              />
                            )),
                          )}
                        <div className="absolute bottom-1 right-2 z-10 select-none rounded bg-white/70 px-1 font-mono text-[9px] text-slate-400">
                          {n}
                        </div>
                        {pageErrors[n] && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-rose-50/90 p-4 text-center text-xs text-rose-700">
                            <span>{pageErrors[n]}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                !loadingDoc && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${T.panelSoft}`}>
                      <BookOpen className={`h-7 w-7 ${T.dim}`} />
                    </div>
                    <h3 className={`text-sm font-bold ${T.strong}`}>PDF Reader</h3>
                    <p className={`max-w-sm text-xs leading-relaxed ${T.muted}`}>
                      Import a book with <strong>Import</strong>. Pages render on demand, text is selectable, highlights and notes persist.
                    </p>
                    <button onClick={() => fileInputRef.current?.click()} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold ${T.cta}`}>
                      <UploadCloud className="h-3.5 w-3.5" /> Import your first book
                    </button>
                  </div>
                )
              )}
            </div>
            {popup && (
              <div
                className="absolute z-30 flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-xl"
                style={{ left: popup.x, top: popup.y }}
              >
                {HL_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => saveSelectionHighlight(c.id)}
                    title={`Highlight ${c.label}`}
                    className="h-5 w-5 rounded-full border border-slate-300 transition-transform hover:scale-110"
                    style={{ background: c.css }}
                  />
                ))}
                <div className="mx-0.5 h-4 w-px bg-slate-200" />
                <button onClick={copySelection} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Copy">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setPopup(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3 w-3" /></button>
              </div>
            )}
          </div>
          {showThumbs && numPages > 0 && (
            <div className={`shrink-0 border-t ${T.divider}`}>
              {activeDoc?.fileType === 'docx' ? (
                <div className="flex gap-1 overflow-x-auto p-1.5">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => gotoPage(n)}
                      className={`shrink-0 rounded border px-2 py-1 font-mono text-[10px] ${n === currentPage ? T.chipAccent : T.chip}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto p-1.5">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                    <div key={n} className="w-14 shrink-0">
                      <Thumb
                        num={n}
                        active={n === currentPage}
                        scaleHint={fitScale()}
                        pdfRef={pdfRef}
                        onClick={() => gotoPage(n)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </article>

        {panelOpen && numPages > 0 && (
          <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border lg:col-span-5 ${T.panel}`}>
            <header className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${T.divider}`}>
              <div className={`flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${T.muted}`}>
                Highlights
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {highlights.length === 0 && (
                <p className={`text-[10px] leading-relaxed ${T.dim}`}>
                  No highlights yet. Select text in the reader and pick a colour.
                </p>
              )}
              <div className="space-y-1.5">
                {highlights.map((h) => (
                  <div key={h.id} className={`group rounded-lg border p-2 ${T.panelSoft} ${T.border}`}>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full border border-slate-300/60" style={{ background: h.color ?? '#fde047' }} />
                        <button
                          onClick={() => { if (h.page) gotoPage(h.page); }}
                          className={`font-mono text-[9px] font-bold hover:underline ${T.accent}`}
                          title="Jump to this page"
                        >
                          p. {h.page ?? '—'}
                        </button>
                      </div>
                      <button onClick={() => deleteHighlight(h.id)} className={`opacity-0 transition group-hover:opacity-100 ${T.dim} hover:text-rose-500`} title="Delete highlight">
                        <Trash className="h-3 w-3" />
                      </button>
                    </div>
                    <p className={`mt-1 line-clamp-4 text-[10px] leading-relaxed ${T.text}`}>{h.quote}</p>
                    {h.note && (
                      <p className={`mt-1 rounded border px-1.5 py-1 text-[9px] ${T.chipWarn}`}>{h.note}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ======================= Question Bank ======================= */}
        {numPages > 0 && mcqs.length > 0 && (
          <section className={`flex h-[220px] flex-col overflow-hidden rounded-xl border ${T.panel}`}>
            <header className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${T.divider}`}>
              <div className="flex items-center gap-1.5">
                <GraduationCap className="h-3 w-3" />
                <span className={`font-mono text-[10px] font-bold ${T.accent}`}>Page question bank</span>
              </div>
              <div className="flex items-center gap-1">
                {mcqs.length > 1 && (
                  <div className={`flex items-center gap-0.5 rounded border px-1 py-0.5 ${T.chip}`}>
                    <button
                      onClick={() => { setMcqIndex((i) => Math.max(0, i - 1)); setMcqPicked(null); }}
                      disabled={mcqIndex === 0}
                      className="disabled:opacity-30"
                      title="Previous question"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <span className="font-mono text-[9px]">{mcqIndex + 1}/{mcqs.length}</span>
                    <button
                      onClick={() => { setMcqIndex((i) => Math.min(mcqs.length - 1, i + 1)); setMcqPicked(null); }}
                      disabled={mcqIndex >= mcqs.length - 1}
                      className="disabled:opacity-30"
                      title="Next question"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              {askError && (
                <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-snug text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{askError}</span>
                </div>
              )}
              {mcqs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <GraduationCap className={`h-7 w-7 ${T.dim}`} />
                  <p className={`text-[11px] font-semibold ${T.strong}`}>No questions for page {currentPage} yet</p>
                  <p className={`max-w-md text-[10px] leading-relaxed ${T.muted}`}>
                    Generate single-best-answer MCQs from this page's text.
                  </p>
                </div>
              ) : (
                <>
                  <p className={`text-[12px] font-medium leading-snug ${T.text}`}>{mcqs[mcqIndex].question}</p>
                  <div className="mt-1.5 grid grid-cols-1 gap-1 md:grid-cols-2">
                    {mcqs[mcqIndex].options.map((option, oi) => {
                      const isCorrect = oi === mcqs[mcqIndex].answerIndex;
                      const isPicked = mcqPicked === oi;
                      const reveal = mcqPicked !== null || !!showMcqAnswers[mcqIndex];
                      const state = !reveal
                        ? `${T.panelSoft} ${T.border} ${T.softHover}`
                        : isCorrect
                          ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                          : isPicked
                            ? 'border-rose-400/70 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                            : `${T.border} opacity-60`;
                      return (
                        <button
                          key={oi}
                          onClick={() => {
                            if (mcqPicked !== null) return;
                            setMcqPicked(oi);
                            setShowMcqAnswers((prev) => ({ ...prev, [mcqIndex]: true }));
                          }}
                          className={`flex items-start gap-1.5 rounded-lg border p-1.5 text-left text-[10px] leading-snug transition ${state}`}
                        >
                          <span className={`shrink-0 rounded px-1 font-mono text-[9px] font-bold ${T.chip}`}>{String.fromCharCode(65 + oi)}</span>
                          <span className="min-w-0">{option}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(mcqPicked !== null || showMcqAnswers[mcqIndex]) && (
                    <div
                      className={`mt-1.5 rounded-lg border px-2 py-1 text-[10px] leading-snug ${
                        mcqPicked === null || mcqPicked === mcqs[mcqIndex].answerIndex
                          ? T.chipGood
                          : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
                      }`}
                    >
                      <b>
                        {mcqPicked === null ? 'Answer' : mcqPicked === mcqs[mcqIndex].answerIndex ? 'Correct' : 'Not quite'} ┬À [{String.fromCharCode(65 + mcqs[mcqIndex].answerIndex)}]
                      </b>{' '}
                      {mcqs[mcqIndex].explanation}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* ======================= Ask AI Copilot ======================= */}
        {askPanel && numPages > 0 && (
          <section className={`flex h-[220px] flex-col overflow-hidden rounded-xl border ${T.panel}`}>
            <header className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${T.divider}`}>
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                <span className={`font-mono text-[10px] font-bold ${T.accent}`}>Clinical copilot</span>
              </div>
              <span className={`max-w-[130px] truncate rounded border px-1.5 py-0.5 font-mono text-[8px] ${T.chip}`} title={(() => { const p = getActiveProvider(); return p ? `${p} · ${getEffectiveModel(p)}` : 'no provider'; })()}>
                {(() => { const p = getActiveProvider(); return p ? `${p} · ${getEffectiveModel(p)}` : 'no provider'; })()}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pt-1.5">
                <button
                  onClick={() => { setAskPanel(true); askAi('Explain this passage clearly and completely, with mechanisms and clinical reasoning.'); }}
                  disabled={askBusy}
                  title="Explain this passage"
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition disabled:opacity-40 ${T.chip} ${T.softHover}`}
                >
                  Explain
                </button>
                <button
                  onClick={() => { setAskPanel(true); askAi('List the high-yield key points in this passage as short bullets.'); }}
                  disabled={askBusy}
                  title="Key points"
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition disabled:opacity-40 ${T.chip} ${T.softHover}`}
                >
                  Key points
                </button>
                <button
                  onClick={() => setAskIncludeWeb(!askIncludeWeb)}
                  className={`ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${askIncludeWeb ? T.chipAccent : T.chip}`}
                  title="Include live web sources"
                >
                  <Globe className="h-2.5 w-2.5" /> Web
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
                {askQuestion && (askBusy || askReply || askError) && (
                  <div className="mb-1 flex justify-end">
                    <div className="max-w-[92%] rounded-lg rounded-br-sm bg-[#13294b] px-2 py-1 text-[9px] leading-snug text-white/90">{askQuestion}</div>
                  </div>
                )}
                {askBusy ? (
                  <div className={`space-y-1.5 rounded-lg border p-2 ${T.panelSoft} ${T.border}`}>
                    <div className={`flex items-center gap-1.5 text-[9px] font-semibold ${T.accent}`}>
                      <Loader2 className="h-3 w-3 animate-spin" /> Reading {askContextLabel}…
                    </div>
                    <div className="h-1.5 w-full animate-pulse rounded bg-slate-400/20" />
                    <div className="h-1.5 w-5/6 animate-pulse rounded bg-slate-400/20" />
                    <div className="h-1.5 w-2/3 animate-pulse rounded bg-slate-400/20" />
                  </div>
                ) : askReply ? (
                  <div className={`rounded-lg border ${T.panelSoft} ${T.border}`}>
                    <div className={`flex items-center justify-between border-b px-1.5 py-1 ${T.divider}`}>
                      <span className={`font-mono text-[8px] font-bold uppercase tracking-wider ${T.accent}`}>Answer ┬À {askContextLabel}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(askReply).then(() => {
                            setAskCopied(true);
                            setTimeout(() => setAskCopied(false), 1500);
                          }).catch(() => {});
                        }}
                        title="Copy the answer"
                        className={`${T.dim} hover:opacity-70`}
                      >
                        {askCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                    <div className={`whitespace-pre-wrap p-1.5 text-[10px] leading-relaxed ${T.text}`}>{askReply}</div>
                  </div>
                ) : !askError ? (
                  <div className={`rounded-lg border border-dashed px-2 py-2.5 text-center ${T.border}`}>
                    <p className={`text-[10px] font-semibold ${T.muted}`}>Ground the answer in page {currentPage}</p>
                    <p className={`mt-0.5 text-[9px] leading-snug ${T.dim}`}>
                      Select text for a focused answer, or use a quick prompt.
                    </p>
                  </div>
                ) : null}

                {askError && (
                  <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[9px] leading-snug text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{askError}</span>
                  </div>
                )}

                {askCitations.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {askCitations.map((citation, i) => {
                      const url = citation.match(/https?:\/\/\S+/)?.[0];
                      const label = citation.replace(/^-?\s*W\d+:\s*/, '').replace(/https?:\/\/\S+/, '').replace(/[()]/g, '').trim();
                      return url ? (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={url}
                          className={`max-w-full truncate rounded border px-1 py-0.5 font-mono text-[8px] ${T.chip} ${T.accent}`}
                        >
                          {label || `Source ${i + 1}`}
                        </a>
                      ) : (
                        <span key={i} className={`rounded border px-1 py-0.5 font-mono text-[8px] ${T.chip}`}>{citation}</span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={`shrink-0 border-t p-1.5 ${T.divider}`}>
                <div className={`flex items-end gap-1 rounded-lg border p-1 ${T.input}`}>
                  <textarea
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const question = askInput.trim();
                        if (!question || askBusy) return;
                        setAskPanel(true);
                        setAskInput('');
                        askAi(question);
                      }
                    }}
                    placeholder={`Ask copilot about page ${currentPage}…`}
                    rows={1}
                    className="max-h-14 min-h-[22px] flex-1 resize-none bg-transparent px-1 py-0.5 text-[10px] focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      const question = askInput.trim();
                      if (!question || askBusy) return;
                      setAskPanel(true);
                      setAskInput('');
                      askAi(question);
                    }}
                    disabled={!askInput.trim() || askBusy}
                    title="Send"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md disabled:opacity-30 ${T.cta}`}
                  >
                    {askBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
// ---------------- thumbnail (lazy) ----------------

const Thumb: React.FC<{
  num: number;
  active: boolean;
  scaleHint: number;
  pdfRef: React.MutableRefObject<any>;
  onClick: () => void;
}> = ({ num, active, scaleHint, pdfRef, onClick }) => {
  const [loaded, setLoaded] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !pdfRef.current) return;
    let cancelled = false;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting) || loaded || cancelled || !pdfRef.current) return;
      io.disconnect();
      try {
        const page = await pdfRef.current.getPage(num);
        const s = Math.min(0.35, Math.max(0.12, scaleHint * 0.25));
        const vp = page.getViewport({ scale: s });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.className = 'w-full block rounded';
        if (canvasHostRef.current && !cancelled) {
          canvasHostRef.current.replaceChildren(canvas);
          const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp });
          await task.promise;
          if (!cancelled) setLoaded(true);
        }
      } catch { /* thumb render failure ignored — main page re-renders anyway */ }
    }, { root: holder.parentElement, threshold: 0.05 });
    io.observe(holder);
    return () => { cancelled = true; io.disconnect(); };
  }, [num, active]);
  return (
    <div
      ref={holderRef}
      onClick={onClick}
      className={`cursor-pointer p-1 rounded-lg border transition-colors ${active ? 'border-[#0f8b8d] bg-teal-50' : 'border-transparent hover:border-slate-300'}`}
      data-thumb-page={num}
    >
      <div className="relative bg-slate-100 rounded min-h-[60px] flex items-center justify-center overflow-hidden">
        {!loaded && <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-slate-400">{num}</span>}
        <div ref={canvasHostRef} className="relative w-full" />
      </div>
      <div className={`text-center text-[9px] font-mono mt-0.5 ${active ? 'text-[#00696b] font-bold' : 'text-slate-400'}`}>{num}</div>
    </div>
  );
};
