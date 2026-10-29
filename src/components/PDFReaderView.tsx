// PDF Reader — REAL pdf.js rendering (pdfjs-dist), Adobe-style layout.
// - Library imported from the user's files, stored as blobs in IndexedDB 'PulseMedFilesDB'.
//   Import only reads page COUNT (cheap metadata) — page content renders on demand while scrolling.
// - Continuous scroll with IntersectionObserver-driven lazy rendering + LRU eviction.
// - pdf.js TextLayer for real text selection; selects open a floating popup:
//   highlight with colour (saved to the user-highlights store), copy, or Ask AI.
// - Whole-document search builds a text index on demand (cached per page in IndexedDB),
//   with next/previous match navigation.
// - Right panel: notes & highlights for the doc + "Ask AI about this page/selection"
//   (optionally with live web sources from /api/web/research) and MCQ generation.
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
  FileText,
  Trash,
  GraduationCap,
  Maximize,
  ScanText,
  FileDown,
  NotebookPen,
  Square,
  Send,
  Type as TypeIcon,
  Database,
  Focus,
  LayoutGrid,
  PanelRight,
  Activity,
  Ruler,
  Contrast,
  RotateCcw,
  Stethoscope,
  Zap
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
  type PDFLibraryMeta
} from '../utils/pdfLibraryDB.ts';
import {
  listUserHighlightsForDoc,
  addUserHighlight,
  removeUserHighlight,
  highlightFromPdfSelection,
  type UserHighlight
} from '../utils/userHighlightsStore.ts';
import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE, extractJson } from '../lib/ai.ts';
import { ocrImage, createOcrPool, ocrConcurrency, OcrWord } from '../utils/ocr.ts';
import { startJob, stopJob, type JobControl } from '../utils/jobRegistry.ts';
import { RevisionNote, downloadNotesPdf } from './RevisionNote.tsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// One-tap prompts for the Ask AI rail. Each is answered from the current page/selection,
// so the learner does not have to invent a question to get value from the panel.
const ASK_QUICK_PROMPTS: { label: string; question: string }[] = [
  {
    label: 'Explain',
    question: 'Explain this passage clearly and completely, with mechanisms and the clinical reasoning a postgraduate examiner expects.',
  },
  {
    label: 'Key points',
    question: 'List the high-yield key points in this passage as short bullets, then one line on why each matters clinically.',
  },
  {
    label: 'Exam pearls',
    question: 'Give the exam pearls a NEET-PG / INI-CET / AMC CAT examiner would test from this passage, including the classic trap.',
  },
  {
    label: 'Define terms',
    question: 'Define every clinical term and abbreviation in this passage, with a one-line clinical significance for each.',
  },
];

interface PDFReaderViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
  onGenerateQuizFromPage?: (bookTitle: string, pageNumber: number, textSnippet: string) => void;
  /** Follow the app-wide theme so the suite has a real light counterpart. */
  darkMode?: boolean;
}

const MAX_RENDERED = 24; // LRU bound for rendered pages
const HL_COLORS: { id: string; css: string; label: string }[] = [
  { id: 'yellow', css: '#fde047', label: 'Yellow' },
  { id: 'green', css: '#86efac', label: 'Green' },
  { id: 'pink', css: '#f9a8d4', label: 'Pink' },
  { id: 'blue', css: '#93c5fd', label: 'Blue' },
];

/**
 * The Stitch "Clinical Diagnostic Precision" shell has a real light counterpart:
 * chrome, cards and text switch with the app theme, while the imaging plate stays
 * dark in both (a PACS viewport should never glow white around a scan).
 */
const SUITE_LIGHT = {
  page: 'bg-[#f6f8fc] text-slate-800',
  panel: 'border-slate-200 bg-white',
  panelSoft: 'border-slate-200 bg-slate-50',
  border: 'border-slate-200',
  divider: 'border-slate-100',
  text: 'text-slate-700',
  muted: 'text-slate-500',
  dim: 'text-slate-400',
  strong: 'text-slate-900',
  accent: 'text-[#00696b]',
  cta: 'bg-[#0f8b8d] text-white hover:bg-[#00696b]',
  seg: 'border-slate-200 bg-slate-100',
  tabOn: 'bg-[#0f8b8d] text-white shadow-sm',
  tabOff: 'text-slate-600 hover:text-slate-900',
  chip: 'border-slate-200 bg-slate-50 text-slate-600',
  chipAccent: 'border-[#0f8b8d]/30 bg-[#0f8b8d]/10 text-[#00696b]',
  chipWarn: 'border-amber-300 bg-amber-50 text-amber-700',
  chipGood: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  softHover: 'hover:bg-slate-100',
  input: 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400',
  reader: 'bg-slate-200/70',
  plate: 'bg-[#050b16]',
  notes: 'bg-white',
  segBtnOn: 'bg-[#0f8b8d] text-white',
  segBtnOff: 'text-slate-500 hover:text-slate-800',
};

const SUITE_DARK: typeof SUITE_LIGHT = {
  page: 'bg-[#070d18] text-slate-200',
  panel: 'border-slate-700/70 bg-[#0e1a2b]',
  panelSoft: 'border-slate-700/60 bg-[#0b1526]',
  border: 'border-slate-700/70',
  divider: 'border-slate-700/50',
  text: 'text-slate-300',
  muted: 'text-slate-400',
  dim: 'text-slate-500',
  strong: 'text-white',
  accent: 'text-[#6bd8cb]',
  cta: 'bg-[#0d9488] text-white hover:bg-[#0f766e]',
  seg: 'border-slate-700 bg-[#060e20]',
  tabOn: 'bg-[#0d9488] text-white shadow-sm',
  tabOff: 'text-slate-400 hover:text-white',
  chip: 'border-slate-700 bg-slate-800/60 text-slate-300',
  chipAccent: 'border-[#6bd8cb]/40 bg-[#6bd8cb]/10 text-[#89f5e7]',
  chipWarn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  chipGood: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  softHover: 'hover:bg-slate-800/60',
  input: 'border-slate-700 bg-[#060e20] text-slate-100 placeholder:text-slate-500',
  reader: 'bg-[#060e20]',
  plate: 'bg-[#050b16]',
  notes: 'bg-[#0b1526]',
  segBtnOn: 'bg-[#0d9488] text-white',
  segBtnOff: 'text-slate-400 hover:text-white',
};

/** Radiographic window/level presets, expressed as CSS filters on the page raster. */
const PLATE_FILTERS: Record<'normal' | 'lung' | 'mediastinum' | 'bone', { label: string; css: string }> = {
  normal: { label: 'Normal', css: 'none' },
  lung: { label: 'Lung', css: 'grayscale(1) contrast(1.35) brightness(0.96)' },
  mediastinum: { label: 'Mediastinum', css: 'grayscale(1) contrast(1.12) brightness(1.06)' },
  bone: { label: 'Bone', css: 'grayscale(1) contrast(1.65) brightness(1.12)' },
};

interface SelectionPopup { x: number; y: number; text: string; }

/**
 * Normalise OCR word boxes to fractions of the page and precompute the horizontal fit.
 * Storing fractions means the overlay is positioned with percentages, so it stays aligned
 * through zoom, fit-width, fullscreen and resize with no scale arithmetic.
 */
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

/** Cheap subject heuristic used on import (no AI call); editable afterwards. */
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

/** Split extracted DOCX text into readable "pages" at paragraph boundaries (~2,400 chars). */
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

export const PDFReaderView: React.FC<PDFReaderViewProps> = ({ onNavigate, onGenerateQuizFromPage, darkMode = false }) => {
  // ----- library -----
  const [docs, setDocs] = useState<PDFLibraryMeta[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // ----- document state -----
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [fitWidth, setFitWidth] = useState<boolean>(true);
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [docOpenError, setDocOpenError] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState<boolean>(false);

  // ----- search -----
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState<number>(-1);
  const [indexing, setIndexing] = useState<{ busy: boolean; done: number }>({ busy: false, done: 0 });

  // ----- notes / highlights -----
  const [showNotes, setShowNotes] = useState<boolean>(true);
  const [showLibrary, setShowLibrary] = useState<boolean>(true);
  const [highlights, setHighlights] = useState<UserHighlight[]>([]);
  const [copied, setCopied] = useState<boolean>(false);

  // ----- selection popup -----
  const [popup, setPopup] = useState<SelectionPopup | null>(null);

  // ----- ask AI panel state -----
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

  // ----- clinical suite shell (Stitch "Clinical Diagnostic Precision" design) -----
  const [suiteMode, setSuiteMode] = useState<'correlated' | 'text' | 'flashcard'>('correlated');
  const [plateTab, setPlateTab] = useState<'plate' | 'highlights'>('plate');
  const [plateZoom, setPlateZoom] = useState<number>(1);
  const [wlPreset, setWlPreset] = useState<'normal' | 'lung' | 'mediastinum' | 'bone'>('normal');
  const [invertPlate, setInvertPlate] = useState<boolean>(false);
  const [caliperMode, setCaliperMode] = useState<boolean>(false);
  const [showThumbs, setShowThumbs] = useState<boolean>(false);
  const [correlation, setCorrelation] = useState<string>('');
  const [correlBusy, setCorrelBusy] = useState<boolean>(false);
  const [correlError, setCorrelError] = useState<string | null>(null);

  // ----- flashcards generated from the current page (real AI, no canned cards) -----
  const [flashcards, setFlashcards] = useState<{ front: string; back: string; pearl?: string }[]>([]);
  const [flashIndex, setFlashIndex] = useState<number>(0);
  const [flashFlipped, setFlashFlipped] = useState<boolean>(false);
  const [flashBusy, setFlashBusy] = useState<boolean>(false);
  const [flashError, setFlashError] = useState<string | null>(null);

  // ----- view mode: rendered page vs extracted text (PARITY section 6) -----
  const [viewMode, setViewMode] = useState<'page' | 'text'>('page');
  // In-app full screen. Native requestFullscreen() is rejected inside an embedded pane and a
  // scripted click is not a user activation, so the viewer expands itself instead.
  const [immersive, setImmersive] = useState<boolean>(false);
  const [textView, setTextView] = useState<{ loading: boolean; text: string; page: number }>({ loading: false, text: '', page: 1 });

  // ----- OCR (PARITY section 5 / 14) -----
  const [ocrForce, setOcrForce] = useState<boolean>(false);
  const [ocrOpen, setOcrOpen] = useState<boolean>(false);
  const [ocrBusy, setOcrBusy] = useState<boolean>(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  // Bumped whenever OCR words arrive, so the overlay re-renders (refs alone do not).
  const [wordsVersion, setWordsVersion] = useState(0);

  // ----- "Make notes from pages" (PARITY section 6) -----
  const [notesOpen, setNotesOpen] = useState<boolean>(false);
  const [notesFrom, setNotesFrom] = useState<number>(1);
  const [notesTo, setNotesTo] = useState<number>(5);
  const [notesPartSize, setNotesPartSize] = useState<number>(5);
  const [notesBusy, setNotesBusy] = useState<boolean>(false);
  const notesCancelRef = useRef<boolean>(false);
  const [madeNotes, setMadeNotes] = useState<{ range: string; text: string }[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);

  // ----- refs (pdfjs objects, DOM) -----
  const pdfRef = useRef<any>(null);
  // destroy the pdfjs document when the reader unmounts
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
  // Pages whose pdf.js text layer already has real text: the OCR overlay would duplicate it.
  const nativeTextPagesRef = useRef<Set<number>>(new Set());
  const searchCancelRef = useRef<boolean>(false);

  currentPageRef.current = currentPage;
  scaleRef.current = scale;

  // ============================ library ============================

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

  // ============================ open / close document ============================

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
    setMcqs([]);
    setAskReply('');
    setAskCitations([]);
    setAskError(null);
    setLoadingDoc(true);
    try {
      const rec = await getLibraryDocument(id);
      if (!rec) throw new Error('Document record missing from the local library.');

      // DOCX documents are stored as extracted text pages — no pdf.js parse needed.
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
      // base page size from page 1 (cheap) to size the wrappers before render
      const p1 = await pdf.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      baseDimsRef.current = { w: vp.width, h: vp.height };
      // user highlights for this doc
      setHighlights(listUserHighlightsForDoc(id));
      // Words already stored by a previous OCR run: fill the overlay map up front.
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
          // DOCX import (PARITY section 12): extract real text and store it in pages.
          // @ts-ignore — mammoth builds may or may not ship their own type definitions.
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
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise; // metadata only
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

  // ============================ subject grouping ============================

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

  const classifyWithAi = async () => {
    const provider = getActiveProvider();
    const doc = docs.find((d) => d.id === activeDocId);
    if (!provider) { setLibraryError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    if (!doc) return;
    try {
      const firstText = (await ensurePageText(1).catch(() => '')).slice(0, 2500);
      const raw = await aiComplete({
        system: 'Classify a medical textbook into ONE subject. Reply with only the subject name, nothing else.',
        messages: [{
          role: 'user',
          content:
            `Title: ${doc.title}\n\nFirst page text:\n${firstText || '(no text — use the title only)'}\n\n` +
            'Choose one of: Anatomy, Physiology, Pathology, Pharmacology, Microbiology, General Medicine, Surgery, Pediatrics, Obstetrics & Gynaecology, Psychiatry, Dermatology, Radiology, Ophthalmology, ENT, Forensic Medicine, Community Medicine, Anaesthesia, Orthopaedics. Reply with only the subject name.',
        }],
        provider,
        model: getEffectiveModel(provider),
      });
      const subject = raw.trim().split('\n')[0].replace(/[."']/g, '').slice(0, 60) || 'Uncategorised';
      await setDocSubject(doc.id, subject);
    } catch (err: any) {
      setLibraryError(err?.message || 'Could not classify the book.');
    }
  };

  // ============================ page rendering (on demand) ============================

  const fitScale = useCallback(() => {
    const container = scrollRef.current;
    const base = baseDimsRef.current;
    if (!container || !base) return scaleRef.current;
    return Math.max(0.25, Math.min(4, (container.clientWidth - 48) / base.w));
  }, []);

  // recompute fit-width scale on container resize
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

      // size the wrapper to the real page
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
        // Cap the backing store. Zooming into a 4961 pt scan asks for a 6,000–20,000 px canvas,
        // which the browser cannot allocate, so the render silently never completes (blank page).
        let pxW = Math.max(1, Math.floor(cssW * dpr));
        let pxH = Math.max(1, Math.floor(cssH * dpr));
        const shrink = Math.min(1, 4096 / Math.max(pxW, pxH), Math.sqrt(16_000_000 / Math.max(1, pxW * pxH)));
        pxW = Math.max(1, Math.floor(pxW * shrink));
        pxH = Math.max(1, Math.floor(pxH * shrink));
        canvas.width = pxW;
        canvas.height = pxH;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        // cancel an in-flight render for this page
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

      // text layer for selection
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
            // pdf.js's own viewer appends this; without it a drag that leaves a line selects
            // everything to the end of the page instead of stopping at the pointer.
            if (!slot.querySelector('.endOfContent')) {
              const end = document.createElement('div');
              end.className = 'endOfContent';
              slot.appendChild(end);
            }
            // A page with a real text layer already has selectable text; layering OCR words on
            // top would give duplicate selectable text. Remember which pages are native.
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

      // LRU eviction
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

  // re-render everything after a scale change: clear + re-observe visible pages
  const lastScaleRef = useRef(scale);
  useEffect(() => {
    if (lastScaleRef.current === scale || !pdfRef.current) { lastScaleRef.current = scale; return; }
    lastScaleRef.current = scale;
    clearRenderedPages();
    // reset wrappers to estimated size and re-trigger renders for visible pages
    const base = baseDimsRef.current;
    if (base) {
      for (const wrap of pageWrapRefs.current.values()) {
        wrap.style.width = `${Math.floor(base.w * scale)}px`;
        wrap.style.height = `${Math.floor(base.h * scale)}px`;
      }
    }
    // re-observe forces the IntersectionObserver callback to run for current state
    requestAnimationFrame(() => {
      observerRef.current?.disconnect();
      for (const wrap of pageWrapRefs.current.values()) observerRef.current?.observe(wrap);
      // The observer may report a tiny ratio for a tall page and then never fire again, so
      // paint the page the user is actually looking at.
      void renderPage(currentPageRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, clearRenderedPages]);

  // wrappers create/destroy when numPages changes
  useEffect(() => {
    // nothing needed here — wrappers are created in JSX keyed by page number
  }, [numPages]);

  // IntersectionObserver for lazy rendering + current page tracking
  const observerRef = useRef<IntersectionObserver | null>(null);
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
      // current page = most visible
      let best = -1;
      let bestRatio = 0;
      for (const [n, r] of visibleRatiosRef.current) {
        if (r > bestRatio) { best = n; bestRatio = r; }
      }
      if (best > 0 && best !== currentPageRef.current) setCurrentPage(best);
    }, { root: scrollRef.current, rootMargin: '50% 0px', threshold: [0, 0.1, 0.3, 0.6, 0.9] });
    observerRef.current = io;
    // observe all wrappers
    for (const wrap of pageWrapRefs.current.values()) io.observe(wrap);
    const id = requestAnimationFrame(() => {
      if (observerRef.current !== io) return;
      for (const wrap of pageWrapRefs.current.values()) io.observe(wrap);
    });
    void id;
    return () => { io.disconnect(); if (observerRef.current === io) observerRef.current = null; };
  }, [activeDocId, numPages, renderPage]);

  // register wrappers (callback refs)
  const setPageWrapRef = useCallback((num: number, el: HTMLDivElement | null) => {
    if (el) {
      pageWrapRefs.current.set(num, el);
      // Only the IntersectionObserver decides what to render. Calling renderPage here queued
      // every page the moment the document opened, starving the single pdf.js worker.
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

  // Deep link from notes/flashcards: { docId, page } left in sessionStorage by another
  // screen (e.g. "Open source page" in the spaced-review panel).
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
      // let React commit the page wrappers before scrolling to the requested page
      timer = setTimeout(() => {
        if (!cancelled) jumpToPage(page);
      }, 250);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // run once on mount — openDoc/jumpToPage are stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================ page text / search / ask ============================

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
    if (!pdfRef.current) return ''; // DOCX / text-only document with no cached page
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

  // ============================ extracted-text view ============================

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

  // ============================ selection popup ============================

  // pdf_viewer.css pins .endOfContent to the top of the page while the layer has .selecting.
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
    setPopup(null); // a new gesture dismisses the previous popup
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    // A click is not a selection gesture — only a real drag may open the popup.
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;

    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || sel.isCollapsed || text.length < 3 || !pdfRef.current) {
      setPopup(null);
      return;
    }
    // Only a selection made inside a rendered text layer is ours to act on.
    const anchorEl = (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement) as HTMLElement | null;
    if (!anchorEl?.closest('.textLayer, .ocrTextLayer')) { setPopup(null); return; }
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const container = scrollRef.current;
    if (!range || !container) { setPopup(null); return; }
    // coords relative to the viewer row (its parent), clamped inside
    const row = container.parentElement;
    if (!row) { setPopup(null); return; }
    const rowRect = row.getBoundingClientRect();
    const above = range.top - rowRect.top - 44;
    setPopup({
      x: Math.min(Math.max(range.left - rowRect.left, 12), Math.max(12, row.clientWidth - 190)),
      // Above the selection when that fits, otherwise below it — never across the words.
      y: above >= 8 ? above : Math.min(range.bottom - rowRect.top + 8, Math.max(8, row.clientHeight - 60)),
      text: text.slice(0, 4000),
    });
  };

  const saveSelectionHighlight = (color: string) => {
    if (!popup || !activeDocId) return;
    const doc = docs.find((d) => d.id === activeDocId);
    // Capture the selection rectangles relative to the page so the highlight can be
    // painted back onto the page at any zoom level.
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
    // Always question the page that is on screen: a stale selection from another page
    // would otherwise leak into the generated MCQs.
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

  /**
   * Flashcards are generated from the page that is actually open, so the drill always
   * matches the text the learner is reading. Nothing is cached across pages.
   */
  const generateFlashcards = async () => {
    const provider = getActiveProvider();
    if (!provider) { setFlashError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    setFlashBusy(true);
    setFlashError(null);
    try {
      const text = (await ensurePageText(currentPageRef.current).catch(() => '')).trim();
      if (!text) throw new Error('No text on this page. Run OCR first if the page is a scan.');
      const raw = await aiComplete({
        system:
          'You write spaced-repetition flashcards strictly from the supplied medical textbook passage. ' +
          'Respond with ONLY JSON: {"cards":[{"front":"prompt","back":"answer","pearl":"one-line exam pearl"}]}.',
        messages: [{
          role: 'user',
          content:
            `Passage (page ${currentPageRef.current} of ${activeDoc?.title ?? 'book'}):\n\n${text.slice(0, 6000)}\n\n` +
            'Write 8 concise flashcards. Each front must be a single recall prompt (definition, mechanism, or ' +
            'classic discriminator); each back the shortest complete answer; each pearl one line an examiner would test.',
        }],
        json: true,
        provider,
        model: getEffectiveModel(provider),
      });
      const parsed = extractJson<{ cards?: any[] }>(raw);
      const list = (Array.isArray(parsed) ? parsed : parsed?.cards) ?? [];
      const clean = list
        .filter((c: any) => c && typeof c.front === 'string' && typeof c.back === 'string')
        .map((c: any) => ({
          front: String(c.front),
          back: String(c.back),
          pearl: c.pearl ? String(c.pearl) : undefined,
        }))
        .slice(0, 12);
      if (!clean.length) throw new Error('The AI returned no valid flashcards. Try again.');
      setFlashcards(clean);
      setFlashIndex(0);
      setFlashFlipped(false);
    } catch (err: any) {
      setFlashError(err?.message || 'Flashcard generation failed.');
    } finally {
      setFlashBusy(false);
    }
  };

  /** Pathophysiology -> imaging/gross appearance -> clinical consequence, from this page only. */
  const correlatePage = async () => {
    const provider = getActiveProvider();
    if (!provider) { setCorrelError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    setCorrelBusy(true);
    setCorrelError(null);
    setCorrelation('');
    try {
      const text = (await ensurePageText(currentPageRef.current).catch(() => '')).trim();
      if (!text) throw new Error('No text on this page. Run OCR first if the page is a scan.');
      const raw = await aiComplete({
        system:
          'You are a radiology-pathology correlation tutor. Use ONLY the supplied passage. ' +
          'Be concise, accurate and exam-oriented; if the passage has no imaging content, say so in one line and stop.',
        messages: [{
          role: 'user',
          content:
            `Passage (page ${currentPageRef.current}):\n\n${text.slice(0, 6000)}\n\n` +
            'Write 3 short correlation points in this shape:\n' +
            '- **Finding:** … — **Mechanism:** … — **Clinical consequence:** …\n' +
            'End with one "**Trap:**" line. No preamble.',
        }],
        provider,
        model: getEffectiveModel(provider),
      });
      setCorrelation(raw);
    } catch (err: any) {
      setCorrelError(err?.message || 'Correlation failed.');
    } finally {
      setCorrelBusy(false);
    }
  };

  // A new page invalidates everything generated for the previous one.
  useEffect(() => {
    setMcqPicked(null);
    setMcqIndex(0);
    setFlashFlipped(false);
    setCorrelation('');
    setCorrelError(null);
  }, [currentPage, activeDocId]);

  // ============================ OCR ============================

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
    // One worker for a single page; bounded parallelism for a whole book so every worker is
    // actually busy. The pool size comes from Settings (1–16, default = spare cores).
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
            // ~2000 px wide ≈ 300 dpi for a book page: legible for tesseract, a few MB instead
            // of the ~500 MB a 1:1 raster of a 4961 pt scan would need.
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
            // Fractions of the page, so the overlay needs no scale maths at render time.
            const words = normalizeOcrWords(result.words, canvas.width, canvas.height, measure);
            if (result.text.trim()) {
              // Saved the moment it is ready, so Stop keeps every finished page.
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
            // One bad page never ends the run.
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

  // ============================ make notes from pages ============================

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
        addUserHighlight({
          kind: 'pdf',
          subject: 'General',
          subtopic: `Notes · pp. ${start}–${end}`,
          yieldTier: 'HIGH',
          sourceContext: `${doc?.title ?? 'document'} · pp. ${start}–${end}`,
          citation: `${doc?.title ?? 'document'} — pages ${start}–${end}`,
          quote: text,
          docId: activeDocId,
          docTitle: doc?.title,
          page: start,
          tags: ['pdf-notes'],
          srsIntervalDays: 1,
          lastReviewed: new Date().toISOString().slice(0, 10),
        });
        setMadeNotes((prev) => [...prev, { range: `pp. ${start}–${end}`, text }]);
        setHighlights(listUserHighlightsForDoc(activeDocId));
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

  const printDocument = async () => {
    if (!activeDocId) return;
    try {
      const rec = await getLibraryDocument(activeDocId);
      if (!rec) return;

      // DOCX imports are stored as extracted text pages — print them as a document.
      if (activeDoc?.fileType === 'docx') {
        const pages = (await listPageTexts(activeDocId)).sort((a, b) => a.pageNumber - b.pageNumber);
        if (!pages.length) throw new Error('This document has no extracted text to print.');
        const win = window.open('', '_blank', 'width=860,height=1000');
        if (!win) throw new Error('The browser blocked the print window. Allow pop-ups for Pulse Med and try again.');
        const doc = win.document;
        const head = doc.createElement('head');
        const meta = doc.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        const title = doc.createElement('title');
        title.textContent = activeDoc.title;
        const style = doc.createElement('style');
        style.textContent = 'body{font-family:Georgia,serif;margin:40px;line-height:1.6;color:#111} h1{font-size:22px} .page{margin-bottom:28px} .num{font-size:11px;color:#777;border-top:1px solid #ddd;padding-top:4px;margin-top:16px} @media print{body{margin:16mm}}';
        head.append(meta, title, style);
        doc.head.replaceWith(head);
        const body = doc.body;
        const h1 = doc.createElement('h1');
        h1.textContent = activeDoc.title;
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

  // Full screen: expand the viewer in-app, and ask the window for real fullscreen as a bonus.
  // Tracks whether the WINDOW actually went fullscreen. Without this, a requestFullscreen()
  // that resolves and then immediately exits fires fullscreenchange and cancels the in-app
  // mode as well, so the button appears to do nothing.
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
      // Embedded pane / no user activation: the in-app mode already covers it.
      nativeFsRef.current = false;
    }
  };

  // Esc leaves immersive mode; when native fullscreen is active the browser eats Esc, so follow
  // its own state too.
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

  // Download the original PDF file from the local library
  const downloadDocument = async () => {
    if (!activeDocId || !activeDoc) return;
    try {
      const rec = await getLibraryDocument(activeDocId);
      if (!rec) return;
      const url = URL.createObjectURL(rec.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeDoc.fileType === 'docx'
        ? `${activeDoc.title}.docx`
        : `${activeDoc.title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err: any) {
      setLibraryError(err?.message || 'Download failed.');
    }
  };

  // Fit the whole page inside the viewport (min of width-fit and height-fit)
  const fitPageScale = useCallback(() => {
    const container = scrollRef.current;
    const base = baseDimsRef.current;
    if (!container || !base) return scaleRef.current;
    const scaleW = (container.clientWidth - 48) / base.w;
    const scaleH = (container.clientHeight - 40) / base.h;
    return Math.max(0.25, Math.min(4, Math.min(scaleW, scaleH)));
  }, []);

  // Keyboard page navigation: arrows/PageUp/PageDown turn pages, +/- zoom, Esc closes popup
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);

  // ============================ render ============================

  const activeAskProvider = getActiveProvider();
  const providerLabel = activeAskProvider ? `${activeAskProvider} · ${getEffectiveModel(activeAskProvider)}` : 'no active provider';
  const activeDoc = docs.find((d) => d.id === activeDocId);

  const t = darkMode ? SUITE_DARK : SUITE_LIGHT;
  const pageHighlights = highlights.filter((h) => h.page === currentPage && h.rects && h.rects.length > 0);
  const currentOcr = ocrWordsRef.current.has(currentPage);
  const currentNativeText = nativeTextPagesRef.current.has(currentPage);
  const indexedPages = pageTextsRef.current.size;
  const activeMcq = mcqs[mcqIndex];
  const flashcard = flashcards[flashIndex];
  const panelOpen = showNotes;
  const toggleSuiteMode = (mode: 'correlated' | 'text' | 'flashcard') => {
    setSuiteMode(mode);
    setPopup(null);
    if (mode === 'text') {
      setViewMode('text');
    } else if (viewMode === 'text') {
      // Returning to a page view: the wrappers remount, so release the bookkeeping first.
      clearRenderedPages();
      setViewMode('page');
    }
  };

  return (
    <div className={`flex h-[calc(100vh-64px)] flex-col gap-2 overflow-y-auto p-2 lg:overflow-hidden ${t.page}`}>
      {/* ======================= TOP RIBBON: documents, modes, telemetry ======================= */}
      <section className={`shrink-0 rounded-xl border px-2.5 py-2 ${t.panel}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition active:scale-95 ${t.cta}`}
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
                    className={`flex shrink-0 items-center rounded-lg border transition ${on ? t.chipAccent : `${t.border} ${t.panelSoft}`}`}
                  >
                    <button
                      onClick={() => openDoc(d.id)}
                      title={`${d.title} · ${d.numPages} pages`}
                      className={`flex items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] ${on ? 'font-bold' : t.muted}`}
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
                <span className={`px-1 font-mono text-[10px] ${t.dim}`}>No documents yet — import a PDF or DOCX</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className={`hidden items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[9px] uppercase tracking-wider xl:flex ${t.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${numPages ? 'bg-emerald-500' : 'bg-slate-500'}`} />
              {numPages ? 'Local engine · ready' : 'Idle'}
            </span>
            <div className={`flex items-center gap-0.5 rounded-lg border p-0.5 ${t.seg}`}>
              {([
                ['correlated', 'Correlated View'],
                ['text', 'Pure Text'],
                ['flashcard', 'Flashcard Drill'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => toggleSuiteMode(mode)}
                  className={`rounded-md px-2 py-1 font-mono text-[10px] font-semibold transition ${suiteMode === mode ? t.tabOn : t.tabOff}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {numPages > 0 && (
          <div className={`mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 ${t.divider}`}>
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] ${t.dim}`}>
              <span className="flex items-center gap-1"><Database className="h-3 w-3" /> {numPages} pages</span>
              <span className="flex items-center gap-1">
                <ScanText className="h-3 w-3" />
                OCR: {ocrBusy ? 'running' : currentOcr ? `ready (${ocrWordsRef.current.size} pp)` : currentNativeText ? 'native text' : 'not scanned'}
              </span>
              <span className={`max-w-[170px] truncate ${t.accent}`} title={providerLabel}>{providerLabel}</span>
              <span className="hidden sm:inline">{activeDoc?.subject ?? 'Uncategorised'}</span>
              <span className="hidden lg:inline">{indexedPages} indexed</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className={`flex min-w-[180px] flex-1 items-center gap-1 rounded-lg border px-2 py-1 sm:flex-none ${t.input}`}>
                <Search className={`h-3 w-3 shrink-0 ${t.dim}`} />
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
                  <button onClick={() => moveMatch(1)} className={`shrink-0 font-mono text-[9px] ${t.accent}`} title="Next match">
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

              <div className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 ${t.input}`}>
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
                <span className={`font-mono text-[9px] ${t.dim}`}>/ {numPages}</span>
                <button onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-0.5 disabled:opacity-30" title="Next page">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 ${t.input}`}>
                <button onClick={() => { setFitWidth(false); setScale((s) => Math.max(0.25, +(s - 0.2).toFixed(2))); }} title="Zoom out">
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="w-9 text-center font-mono text-[10px]">{Math.round(scale * 100)}%</span>
                <button onClick={() => { setFitWidth(false); setScale((s) => Math.min(4, +(s + 0.2).toFixed(2))); }} title="Zoom in">
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setFitWidth(!fitWidth)} title="Fit width" className={fitWidth ? t.accent : t.dim}>
                  <Maximize className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => { setFitWidth(false); setScale(fitPageScale()); }} title="Fit whole page" className={t.dim}>
                  <Focus className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                onClick={() => setOcrOpen((v) => !v)}
                title="OCR matrix — read scanned pages locally"
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${ocrOpen ? t.chipAccent : t.chip}`}
              >
                <ScanText className="h-3 w-3" /> OCR Matrix
              </button>
              <button
                onClick={() => setNotesOpen((v) => !v)}
                title="Generate revision notes from a page range"
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${notesOpen ? t.chipAccent : t.chip}`}
              >
                <NotebookPen className="h-3 w-3" /> Page notes
              </button>
              <button
                onClick={() => onNavigate('research')}
                title="Open the clinical evidence browser"
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition ${t.chip} ${t.softHover}`}
              >
                <Database className="h-3 w-3" /> Evidence
              </button>
              <button onClick={printDocument} title="Print" className={`rounded-lg border p-1.5 transition ${t.chip} ${t.softHover}`}>
                <Printer className="h-3.5 w-3.5" />
              </button>
              <button onClick={downloadDocument} title="Download the original file" className={`rounded-lg border p-1.5 transition ${t.chip} ${t.softHover}`}>
                <FileDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ======================= OCR matrix ======================= */}
      {ocrOpen && numPages > 0 && (
        <div className={`shrink-0 rounded-xl border p-2.5 text-xs ${t.panel}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`flex items-center gap-1.5 text-[11px] font-bold ${t.strong}`}>
              <ScanText className={`h-4 w-4 ${t.accent}`} /> OCR matrix
              <span className={`font-mono text-[9px] ${t.dim}`}>tesseract.js · English · on-device</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${t.muted}`}>
                <input type="checkbox" checked={ocrForce} onChange={(e) => setOcrForce(e.target.checked)} className="accent-[#0f8b8d]" />
                Force OCR even where text exists
              </label>
              <button onClick={() => setOcrOpen(false)} className={`${t.dim} hover:opacity-70`} title="Close"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => runOcr('current')}
              disabled={ocrBusy || !pdfRef.current}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${t.cta}`}
            >
              {ocrBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanText className="h-3 w-3" />}
              OCR current page ({currentPage})
            </button>
            <button
              onClick={() => runOcr('missing')}
              disabled={ocrBusy || !pdfRef.current}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${t.chip}`}
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
            {ocrNote && <span className={`text-[10px] ${t.muted}`}>{ocrNote}</span>}
            {!pdfRef.current && <span className="text-[10px] text-amber-600 dark:text-amber-300">OCR needs a PDF. DOCX already has real text.</span>}
          </div>
          <p className={`mt-1.5 text-[9px] leading-relaxed ${t.dim}`}>
            OCR is lossy — review recognised text. Results feed search, Copilot, MCQs and flashcards, and are cached per page.
          </p>
        </div>
      )}

      {/* ======================= Page notes ======================= */}
      {notesOpen && numPages > 0 && (
        <div className={`shrink-0 rounded-xl border p-2.5 text-xs ${t.panel}`}>
          <div className="flex items-center justify-between">
            <span className={`flex items-center gap-1.5 text-[11px] font-bold ${t.strong}`}>
              <NotebookPen className={`h-4 w-4 ${t.accent}`} /> Make revision notes from pages
            </span>
            <button onClick={() => setNotesOpen(false)} className={`${t.dim} hover:opacity-70`} title="Close"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className={`text-[9px] font-semibold ${t.muted}`}>
              From
              <input type="number" min={1} max={numPages} value={notesFrom}
                onChange={(e) => setNotesFrom(Number(e.target.value))}
                className={`mt-0.5 block w-16 rounded-lg border px-2 py-1 text-[11px] ${t.input}`} />
            </label>
            <label className={`text-[9px] font-semibold ${t.muted}`}>
              To
              <input type="number" min={1} max={numPages} value={notesTo}
                onChange={(e) => setNotesTo(Number(e.target.value))}
                className={`mt-0.5 block w-16 rounded-lg border px-2 py-1 text-[11px] ${t.input}`} />
            </label>
            <label className={`text-[9px] font-semibold ${t.muted}`}>
              Pages / part
              <input type="number" min={1} max={20} value={notesPartSize}
                onChange={(e) => setNotesPartSize(Number(e.target.value))}
                className={`mt-0.5 block w-16 rounded-lg border px-2 py-1 text-[11px] ${t.input}`} />
            </label>
            <button
              onClick={makeNotesFromPages}
              disabled={notesBusy}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${t.cta}`}
            >
              {notesBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {notesBusy ? 'Generating…' : 'Generate in parts'}
            </button>
            {notesBusy && (
              <button
                onClick={() => { notesCancelRef.current = true; }}
                className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <Square className="h-3 w-3" /> Stop (keeps saved parts)
              </button>
            )}
            {madeNotes.length > 0 && (
              <button
                onClick={() => downloadNotesPdf(
                  `${activeDoc?.title ?? 'Book'} — page notes`,
                  madeNotes.map((n) => `## ${n.range}\n\n${n.text}`).join('\n\n'),
                  activeAskProvider ? `${activeAskProvider} · ${getEffectiveModel(activeAskProvider)}` : undefined,
                )}
                className={`ml-auto flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${t.chip}`}
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
                <div key={`${n.range}-${i}`} className={`rounded-lg border p-2 ${t.panelSoft}`}>
                  <div className={`mb-1 font-mono text-[9px] font-bold ${t.dim}`}>{n.range}</div>
                  <RevisionNote text={n.text} topic={activeDoc?.title} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======================= Errors ======================= */}
      {(libraryError || docOpenError) && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span className="flex-1">{libraryError || docOpenError}</span>
          <button onClick={() => { setLibraryError(null); setDocOpenError(null); }}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ======================= MAIN: document stream + spatial plate ======================= */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-12">
        {/* LEFT — document stream */}
        <article
          className={`flex min-h-0 flex-col overflow-hidden rounded-xl border ${t.panel} ${
            immersive ? 'fixed inset-0 z-50 rounded-none' : panelOpen && suiteMode !== 'text' ? 'lg:col-span-7' : 'lg:col-span-12'
          }`}
        >
          <header className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2.5 py-1.5 ${t.divider}`}>
            <div className="flex min-w-0 items-center gap-2">
              <BookOpen className={`h-4 w-4 shrink-0 ${t.accent}`} />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`truncate text-[11px] font-bold ${t.strong}`}>{activeDoc?.title ?? 'No document open'}</span>
                  {activeDoc && (
                    <button
                      onClick={editSubject}
                      title="Edit subject"
                      className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider ${t.chip}`}
                    >
                      {activeDoc.subject || 'Uncategorised'}
                    </button>
                  )}
                  {activeDoc && (
                    <button onClick={classifyWithAi} title="Classify the subject with your active AI" className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[8px] font-bold ${t.chipAccent}`}>
                      AI
                    </button>
                  )}
                </div>
                <div className={`font-mono text-[9px] ${t.dim}`}>
                  {activeDoc ? `${activeDoc.fileType?.toUpperCase() ?? ''} · page ${currentPage} of ${numPages} · ${highlights.length} highlights` : 'Import a PDF or DOCX to begin'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowThumbs((v) => !v)}
                title="Page thumbnails"
                className={`rounded-lg border p-1.5 transition ${showThumbs ? t.chipAccent : `${t.chip} ${t.softHover}`}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowNotes((v) => !v)}
                title={panelOpen ? 'Hide the spatial plate' : 'Show the spatial plate'}
                className={`hidden rounded-lg border p-1.5 transition lg:block ${panelOpen ? t.chipAccent : `${t.chip} ${t.softHover}`}`}
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={toggleFullscreen}
                title={immersive ? 'Exit full screen' : 'Full screen reader'}
                className={`rounded-lg border p-1.5 transition ${t.chip} ${t.softHover}`}
              >
                <Maximize className="h-3.5 w-3.5" />
              </button>
              <button onClick={printDocument} title="Print" className={`rounded-lg border p-1.5 transition ${t.chip} ${t.softHover}`}>
                <Printer className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            {suiteMode === 'flashcard' ? (
              <div className={`flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-4 ${t.reader}`}>
                {!flashcards.length ? (
                  <>
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl border ${t.chipAccent}`}>
                      <Zap className="h-5 w-5" />
                    </div>
                    <div className="text-center">
                      <p className={`text-xs font-bold ${t.strong}`}>Flashcard drill · page {currentPage}</p>
                      <p className={`mx-auto mt-1 max-w-sm text-[11px] leading-relaxed ${t.muted}`}>
                        The active AI writes recall cards from this page only — prompt on the front, answer and an exam pearl on the back.
                      </p>
                    </div>
                    {flashError && (
                      <p className="max-w-sm text-center text-[10px] leading-snug text-rose-600 dark:text-rose-300">{flashError}</p>
                    )}
                    <button
                      onClick={generateFlashcards}
                      disabled={flashBusy}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold disabled:opacity-40 ${t.cta}`}
                    >
                      {flashBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {flashBusy ? 'Writing cards…' : 'Generate 8 flashcards'}
                    </button>
                  </>
                ) : (
                  <div className="flex w-full max-w-xl flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-mono text-[10px] uppercase tracking-wider ${t.dim}`}>
                        Card {flashIndex + 1} / {flashcards.length} · page {currentPage}
                      </span>
                      <button
                        onClick={generateFlashcards}
                        disabled={flashBusy}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-40 ${t.chip}`}
                      >
                        {flashBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Regenerate
                      </button>
                    </div>

                    <button
                      onClick={() => setFlashFlipped((f) => !f)}
                      className={`flex min-h-[170px] flex-col rounded-xl border p-3.5 text-left transition ${t.panelSoft} ${t.border} ${t.softHover}`}
                    >
                      <span className={`w-fit rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${flashFlipped ? t.chipAccent : t.chip}`}>
                        {flashFlipped ? 'Answer' : 'Front · tap to flip'}
                      </span>
                      <p className={`mt-2 flex-1 text-[13px] font-semibold leading-relaxed ${t.strong}`}>
                        {flashFlipped ? flashcard.back : flashcard.front}
                      </p>
                      {flashFlipped && flashcard.pearl && (
                        <p className={`mt-2 border-t pt-2 text-[10px] leading-snug ${t.divider} ${t.accent}`}>
                          <span className="font-bold uppercase tracking-wider">Pearl · </span>{flashcard.pearl}
                        </p>
                      )}
                    </button>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => { setFlashIndex((i) => Math.max(0, i - 1)); setFlashFlipped(false); }}
                        disabled={flashIndex === 0}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-30 ${t.chip}`}
                      >
                        <ChevronLeft className="h-3 w-3" /> Previous
                      </button>
                      <div className="flex items-center gap-1">
                        {flashcards.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => { setFlashIndex(i); setFlashFlipped(false); }}
                            title={`Card ${i + 1}`}
                            className={`h-1.5 rounded-full transition-all ${i === flashIndex ? 'w-4 bg-[#0f8b8d]' : 'w-1.5 bg-slate-400/40 hover:bg-slate-400'}`}
                          />
                        ))}
                      </div>
                      <button
                        onClick={() => { setFlashIndex((i) => Math.min(flashcards.length - 1, i + 1)); setFlashFlipped(false); }}
                        disabled={flashIndex >= flashcards.length - 1}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-30 ${t.chip}`}
                      >
                        Next <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                ref={scrollRef}
                onPointerDown={handlePointerDown}
                onMouseUp={handleMouseUp}
                className={`h-full overflow-auto ${t.reader} ${immersive ? '' : ''}`}
                style={{ scrollbarGutter: 'stable' }}
                data-ocr-version={wordsVersion}
              >
                {loadingDoc && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 dark:bg-slate-900/70">
                    <Loader2 className={`h-6 w-6 animate-spin ${t.accent}`} />
                  </div>
                )}

                {viewMode === 'text' && numPages > 0 ? (
                  <div className={`min-h-full ${t.panel}`}>
                    <div className="mx-auto max-w-3xl p-4">
                      <div className={`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${t.divider} ${t.panel}`}>
                        <span className={`font-mono text-[10px] uppercase tracking-wider ${t.muted}`}>
                          Extracted text · page {textView.page} / {numPages}
                        </span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} className={`rounded-lg border p-1 disabled:opacity-30 ${t.chip}`}>
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} className={`rounded-lg border p-1 disabled:opacity-30 ${t.chip}`}>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {textView.loading ? (
                        <div className={`flex items-center gap-2 py-8 text-xs ${t.muted}`}>
                          <Loader2 className={`h-4 w-4 animate-spin ${t.accent}`} /> Extracting page text…
                        </div>
                      ) : (
                        <div className={`whitespace-pre-wrap text-[13px] leading-7 ${t.text}`}>
                          {textView.text || 'No extractable text on this page. Run OCR from the toolbar to read a scanned page.'}
                        </div>
                      )}
                      <p className={`mt-6 border-t pt-3 text-[10px] ${t.divider} ${t.dim}`}>
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
                      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${t.panelSoft}`}>
                        <BookOpen className={`h-7 w-7 ${t.dim}`} />
                      </div>
                      <h3 className={`text-sm font-bold ${t.strong}`}>Clinical reading suite</h3>
                      <p className={`max-w-sm text-xs leading-relaxed ${t.muted}`}>
                        Import a book with <strong>Import</strong>. Pages render on demand, text is selectable, highlights and notes persist,
                        and the spatial plate keeps the current page beside the text.
                      </p>
                      <button onClick={() => fileInputRef.current?.click()} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold ${t.cta}`}>
                        <UploadCloud className="h-3.5 w-3.5" /> Import your first book
                      </button>
                    </div>
                  )
                )}
              </div>
            )}

            {/* selection popup — coordinates are relative to this positioned parent */}
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
                <button
                  onClick={() => openAskPanel('selection')}
                  className="flex items-center gap-1 rounded-lg bg-[#001432] px-2 py-1 text-[10px] font-bold text-white"
                  title="Ask the copilot about this selection"
                >
                  <Sparkles className="h-3 w-3 text-[#8ff3f4]" /> Ask AI
                </button>
                <button onClick={() => setPopup(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3 w-3" /></button>
              </div>
            )}
          </div>

          {showThumbs && numPages > 0 && (
            <div className={`shrink-0 border-t ${t.divider}`}>
              {activeDoc?.fileType === 'docx' ? (
                <div className="flex gap-1 overflow-x-auto p-1.5">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => gotoPage(n)}
                      className={`shrink-0 rounded border px-2 py-1 font-mono text-[10px] ${n === currentPage ? t.chipAccent : t.chip}`}
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

        {/* RIGHT — spatial plate + correlation + highlights */}
        {panelOpen && suiteMode !== 'text' && (
          <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border lg:col-span-5 ${t.panel}`}>
            <header className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${t.divider}`}>
              <div className={`flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${t.muted}`}>
                <Activity className={`h-3.5 w-3.5 ${t.accent}`} /> Spatial plate
              </div>
              <div className={`flex items-center gap-0.5 rounded-lg border p-0.5 ${t.seg}`}>
                <button
                  onClick={() => setPlateTab('plate')}
                  className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${plateTab === 'plate' ? t.tabOn : t.tabOff}`}
                >
                  Plate
                </button>
                <button
                  onClick={() => setPlateTab('highlights')}
                  className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${plateTab === 'highlights' ? t.tabOn : t.tabOff}`}
                >
                  Highlights {highlights.length}
                </button>
              </div>
            </header>

            {plateTab === 'plate' ? (
              <>
                <div className={`flex shrink-0 flex-wrap items-center justify-between gap-1 border-b px-2 py-1.5 ${t.divider}`}>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => setCaliperMode((v) => !v)}
                      title="Caliper — drag on the plate to measure"
                      className={`rounded-md border p-1 transition ${caliperMode ? t.chipAccent : `${t.chip} ${t.softHover}`}`}
                    >
                      <Ruler className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setInvertPlate((v) => !v)}
                      title="Invert contrast"
                      className={`rounded-md border p-1 transition ${invertPlate ? t.chipAccent : `${t.chip} ${t.softHover}`}`}
                    >
                      <Contrast className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { setWlPreset('normal'); setInvertPlate(false); setPlateZoom(1); }}
                      title="Reset window / level"
                      className={`rounded-md border p-1 transition ${t.chip} ${t.softHover}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-0.5">
                    {(Object.keys(PLATE_FILTERS) as Array<keyof typeof PLATE_FILTERS>).map((key) => (
                      <button
                        key={key}
                        onClick={() => setWlPreset(key)}
                        title={`W/L preset: ${PLATE_FILTERS[key].label}`}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-wider transition ${
                          wlPreset === key ? t.chipAccent : t.chip
                        }`}
                      >
                        {PLATE_FILTERS[key].label}
                      </button>
                    ))}
                  </div>

                  <div className={`flex items-center gap-1 rounded border px-1 py-0.5 ${t.chip}`}>
                    <button onClick={() => setPlateZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))} title="Plate zoom out">
                      <ZoomOut className="h-3 w-3" />
                    </button>
                    <span className="w-8 text-center font-mono text-[9px]">{Math.round(plateZoom * 100)}%</span>
                    <button onClick={() => setPlateZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} title="Plate zoom in">
                      <ZoomIn className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className={`relative min-h-[170px] flex-1 overflow-auto ${t.plate}`}>
                  <PagePlate
                    pdfRef={pdfRef}
                    page={currentPage}
                    zoom={plateZoom}
                    filter={PLATE_FILTERS[wlPreset].css}
                    invert={invertPlate}
                    caliper={caliperMode}
                    highlights={pageHighlights}
                    hasDocument={numPages > 0 && !!(pdfRef.current || activeDoc?.fileType === 'docx')}
                  />

                  {/* HUD — monospaced telemetry fixed to the viewport, not the raster */}
                  <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[62%] font-mono text-[8px] leading-tight text-slate-400">
                    <div className="truncate text-[9px] font-semibold text-slate-100">{activeDoc?.title ?? 'NO DOCUMENT'}</div>
                    <div>PLATE · PAGE {currentPage} / {numPages || '—'}</div>
                    <div className="truncate">{activeDoc?.subject?.toUpperCase() ?? 'UNCATEGORISED'}</div>
                  </div>
                  <div className="pointer-events-none absolute right-2 top-2 z-10 text-right font-mono text-[8px] leading-tight text-slate-400">
                    <div className="font-bold text-cyan-300">PLATE {Math.round(plateZoom * 100)}%</div>
                    <div>READER {Math.round(scale * 100)}%</div>
                    <div>{pageHighlights.length} PIN · {highlights.length} HL</div>
                  </div>
                  <div className="pointer-events-none absolute bottom-2 left-2 z-10 font-mono text-[8px] leading-tight text-slate-400">
                    <div>{activeDoc?.fileType?.toUpperCase() ?? '—'} · {currentOcr ? 'OCR LAYER' : currentNativeText ? 'NATIVE TEXT' : 'RASTER'}</div>
                    <div className={caliperMode ? 'font-bold text-cyan-300' : ''}>{caliperMode ? 'CALIPER: DRAG TO MEASURE' : 'CALIPER: OFF'}</div>
                  </div>
                  <div className="pointer-events-none absolute bottom-2 right-2 z-10 text-right font-mono text-[8px] leading-tight text-slate-400">
                    <div className="text-slate-200">SERIES: PAGE {String(currentPage).padStart(3, '0')}</div>
                    <div className="text-cyan-300">{currentPage >= numPages ? 'END OF BOOK' : `NEXT ${currentPage + 1}`}</div>
                  </div>
                </div>

                <div className={`shrink-0 border-t px-2 py-1.5 ${t.divider}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider ${t.accent}`}>
                      <Stethoscope className="h-3 w-3" /> Live clinical correlation
                    </span>
                    <button
                      onClick={correlatePage}
                      disabled={correlBusy}
                      className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider disabled:opacity-40 ${t.chipAccent}`}
                    >
                      {correlBusy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                      {correlBusy ? 'Reading…' : 'Correlate'}
                    </button>
                  </div>
                  {correlError ? (
                    <p className="mt-1 text-[9px] leading-snug text-rose-600 dark:text-rose-300">{correlError}</p>
                  ) : correlation ? (
                    <div className={`mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[9px] leading-relaxed ${t.muted}`}>{correlation}</div>
                  ) : (
                    <p className={`mt-1 text-[9px] leading-snug ${t.dim}`}>
                      Links mechanism → imaging / gross appearance → clinical consequence for page {currentPage}.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {highlights.length === 0 && (
                  <p className={`text-[10px] leading-relaxed ${t.dim}`}>
                    No highlights yet. Select text in the reader and pick a colour — highlights appear here and as pins on the plate.
                  </p>
                )}
                <div className="space-y-1.5">
                  {highlights.map((h) => (
                    <div key={h.id} className={`group rounded-lg border p-2 ${t.panelSoft} ${t.border}`}>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full border border-slate-300/60" style={{ background: h.color ?? '#fde047' }} />
                          <button
                            onClick={() => { if (h.page) gotoPage(h.page); setPlateTab('plate'); }}
                            className={`font-mono text-[9px] font-bold hover:underline ${t.accent}`}
                            title="Jump to this page"
                          >
                            p. {h.page ?? '—'}
                          </button>
                        </div>
                        <button onClick={() => deleteHighlight(h.id)} className={`opacity-0 transition group-hover:opacity-100 ${t.dim} hover:text-rose-500`} title="Delete highlight">
                          <Trash className="h-3 w-3" />
                        </button>
                      </div>
                      <p className={`mt-1 line-clamp-4 text-[10px] leading-relaxed ${t.text}`}>{h.quote}</p>
                      {h.note && (
                        <p className={`mt-1 rounded border px-1.5 py-1 text-[9px] ${t.chipWarn}`}>{h.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* ======================= BOTTOM: question bank + copilot ======================= */}
      {numPages > 0 && (
        <div className="grid shrink-0 grid-cols-1 gap-2 lg:grid-cols-12">
          <section className={`flex h-[210px] flex-col overflow-hidden rounded-xl border lg:col-span-8 ${t.panel}`}>
            <header className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2.5 py-1.5 ${t.divider}`}>
              <div className="flex items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${t.chipAccent}`}>
                  Page question bank
                </span>
                <span className={`font-mono text-[9px] ${t.dim}`}>
                  Page {currentPage} · {mcqs.length ? `item ${mcqIndex + 1} of ${mcqs.length}` : 'not generated'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {mcqs.length > 1 && (
                  <div className={`flex items-center gap-0.5 rounded border px-1 py-0.5 ${t.chip}`}>
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
                <button
                  onClick={generateMcqs}
                  disabled={mcqBusy || !activeAskProvider || !activeDoc}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold disabled:opacity-40 ${t.cta}`}
                  title={activeAskProvider ? 'Generate MCQs from this page' : 'Connect an AI provider first'}
                >
                  {mcqBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GraduationCap className="h-3 w-3" />}
                  {mcqBusy ? 'Writing…' : mcqs.length ? 'Regenerate' : 'Generate MCQs'}
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              {askError && (
                <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-snug text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{askError}</span>
                </div>
              )}
              {!activeMcq ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <GraduationCap className={`h-7 w-7 ${t.dim}`} />
                  <p className={`text-[11px] font-semibold ${t.strong}`}>No questions for page {currentPage} yet</p>
                  <p className={`max-w-md text-[10px] leading-relaxed ${t.muted}`}>
                    Generate single-best-answer MCQs from this page's text. Options are interactive; the explanation cites the passage.
                  </p>
                  {!activeAskProvider && (
                    <button onClick={() => onNavigate('settings')} className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${t.chipWarn}`}>
                      Connect an AI provider in Settings
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className={`text-[12px] font-medium leading-snug ${t.text}`}>{activeMcq.question}</p>
                  <div className="mt-1.5 grid grid-cols-1 gap-1 md:grid-cols-2">
                    {activeMcq.options.map((option, oi) => {
                      const isCorrect = oi === activeMcq.answerIndex;
                      const isPicked = mcqPicked === oi;
                      const reveal = mcqPicked !== null || !!showMcqAnswers[mcqIndex];
                      const state = !reveal
                        ? `${t.panelSoft} ${t.border} ${t.softHover}`
                        : isCorrect
                          ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                          : isPicked
                            ? 'border-rose-400/70 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                            : `${t.border} opacity-60`;
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
                          <span className={`shrink-0 rounded px-1 font-mono text-[9px] font-bold ${t.chip}`}>{String.fromCharCode(65 + oi)}</span>
                          <span className="min-w-0">{option}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(mcqPicked !== null || showMcqAnswers[mcqIndex]) && (
                    <div
                      className={`mt-1.5 rounded-lg border px-2 py-1 text-[10px] leading-snug ${
                        mcqPicked === null || mcqPicked === activeMcq.answerIndex
                          ? t.chipGood
                          : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
                      }`}
                    >
                      <b>
                        {mcqPicked === null ? 'Answer' : mcqPicked === activeMcq.answerIndex ? 'Correct' : 'Not quite'} · [{String.fromCharCode(65 + activeMcq.answerIndex)}]
                      </b>{' '}
                      {activeMcq.explanation}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className={`flex h-[210px] flex-col overflow-hidden rounded-xl border lg:col-span-4 ${t.panel}`}>
            <header className={`flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-1.5 ${t.divider}`}>
              <span className={`flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider ${t.accent}`}>
                <Sparkles className="h-3 w-3" /> Clinical copilot
              </span>
              <span className={`max-w-[130px] truncate rounded border px-1.5 py-0.5 font-mono text-[8px] ${t.chip}`} title={providerLabel}>
                {activeAskProvider ? providerLabel : 'no provider'}
              </span>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pt-1.5">
                {ASK_QUICK_PROMPTS.slice(0, 3).map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => { setAskPanel(true); askAi(preset.question); }}
                    disabled={askBusy}
                    title={preset.question}
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition disabled:opacity-40 ${t.chip} ${t.softHover}`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  onClick={() => setAskIncludeWeb(!askIncludeWeb)}
                  className={`ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${askIncludeWeb ? t.chipAccent : t.chip}`}
                  title="Include live web + PubMed sources"
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
                  <div className={`space-y-1.5 rounded-lg border p-2 ${t.panelSoft} ${t.border}`}>
                    <div className={`flex items-center gap-1.5 text-[9px] font-semibold ${t.accent}`}>
                      <Loader2 className="h-3 w-3 animate-spin" /> Reading {askContextLabel}…
                    </div>
                    <div className="h-1.5 w-full animate-pulse rounded bg-slate-400/20" />
                    <div className="h-1.5 w-5/6 animate-pulse rounded bg-slate-400/20" />
                    <div className="h-1.5 w-2/3 animate-pulse rounded bg-slate-400/20" />
                  </div>
                ) : askReply ? (
                  <div className={`rounded-lg border ${t.panelSoft} ${t.border}`}>
                    <div className={`flex items-center justify-between border-b px-1.5 py-1 ${t.divider}`}>
                      <span className={`font-mono text-[8px] font-bold uppercase tracking-wider ${t.accent}`}>Answer · {askContextLabel}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(askReply).then(() => {
                            setAskCopied(true);
                            setTimeout(() => setAskCopied(false), 1500);
                          }).catch(() => {});
                        }}
                        title="Copy the answer"
                        className={`${t.dim} hover:opacity-70`}
                      >
                        {askCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                    <div className={`whitespace-pre-wrap p-1.5 text-[10px] leading-relaxed ${t.text}`}>{askReply}</div>
                  </div>
                ) : !askError ? (
                  <div className={`rounded-lg border border-dashed px-2 py-2.5 text-center ${t.border}`}>
                    <p className={`text-[10px] font-semibold ${t.muted}`}>Ground the answer in page {currentPage}</p>
                    <p className={`mt-0.5 text-[9px] leading-snug ${t.dim}`}>
                      Select text for a focused answer, or use a quick prompt. Nothing is invented.
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
                          className={`max-w-full truncate rounded border px-1 py-0.5 font-mono text-[8px] ${t.chip} ${t.accent}`}
                        >
                          {label || `Source ${i + 1}`}
                        </a>
                      ) : (
                        <span key={i} className={`rounded border px-1 py-0.5 font-mono text-[8px] ${t.chip}`}>{citation}</span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className={`shrink-0 border-t p-1.5 ${t.divider}`}>
                <div className={`flex items-end gap-1 rounded-lg border p-1 ${t.input}`}>
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
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md disabled:opacity-30 ${t.cta}`}
                  >
                    {askBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {/* pdf.js canvas is inserted imperatively here; React must not own its children */}
        <div ref={canvasHostRef} className="relative w-full" />
      </div>
      <div className={`text-center text-[9px] font-mono mt-0.5 ${active ? 'text-[#00696b] font-bold' : 'text-slate-400'}`}>{num}</div>
    </div>
  );
};

// ---------------- spatial plate (synced single-page raster) ----------------

/**
 * A second, independent render of the current page, framed like a PACS viewport.
 * It is a real pdf.js render (not a screenshot) so the window/level filters, the
 * caliper and the highlight pins all operate on the true page geometry.
 */
const PagePlate: React.FC<{
  pdfRef: React.MutableRefObject<any>;
  page: number;
  zoom: number;
  filter: string;
  invert: boolean;
  caliper: boolean;
  highlights: UserHighlight[];
  hasDocument: boolean;
}> = ({ pdfRef, page, zoom, filter, invert, caliper, highlights, hasDocument }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [measure, setMeasure] = useState<{ x1: number; y1: number; x2: number; y2: number; mm: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setWidth(host.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMeasure(null);
    setDrag(null);
    const doc = pdfRef.current;
    if (!doc || !width) { setState('idle'); return; }
    setState('loading');
    (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setDims({ w: base.width, h: base.height });
        const fit = Math.max(0.12, (width - 12) / base.width);
        const viewport = pdfPage.getViewport({ scale: fit * zoom });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [page, zoom, width, pdfRef]);

  const coords = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !drag) return;
    draggingRef.current = false;
    const c = coords(e);
    const next = { ...drag, x2: c.x, y2: c.y };
    setDrag(null);
    if (dims) {
      // PDF user units are points: 1 pt = 25.4 / 72 mm.
      const dx = (next.x2 - next.x1) * dims.w;
      const dy = (next.y2 - next.y1) * dims.h;
      setMeasure({ ...next, mm: Math.sqrt(dx * dx + dy * dy) * (25.4 / 72) });
    }
  };

  if (!hasDocument) {
    return (
      <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-1 p-6 text-center text-slate-500">
        <ScanText className="h-6 w-6" />
        <p className="font-mono text-[9px] uppercase tracking-wider">No raster plate</p>
        <p className="max-w-[220px] text-[10px] leading-snug">Import a PDF to see the page raster, pins and caliper here.</p>
      </div>
    );
  }

  if (state === 'idle' && !pdfRef.current) {
    return (
      <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-1 p-6 text-center text-slate-500">
        <FileText className="h-6 w-6" />
        <p className="font-mono text-[9px] uppercase tracking-wider">Text-only document</p>
        <p className="max-w-[220px] text-[10px] leading-snug">DOCX imports have no page raster — use Pure Text.</p>
      </div>
    );
  }

  const m = measure ?? (drag ? { ...drag, mm: 0 } : null);

  return (
    <div ref={hostRef} className="flex min-h-full w-full items-start justify-center p-1.5">
      <div className="relative inline-block select-none">
        <canvas
          ref={canvasRef}
          className={`block h-auto max-w-none rounded-sm bg-white shadow-2xl ${caliper ? 'cursor-crosshair' : ''}`}
          style={{ filter: `${filter}${invert ? ' invert(1)' : ''}` }}
        />

        {/* saved highlight pins (normalised to the page) */}
        {highlights.map((h) =>
          (h.rects ?? []).map((r, i) => (
            <span
              key={`${h.id}-${i}`}
              title={h.quote.slice(0, 160)}
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/80 bg-cyan-400/90 shadow-[0_0_6px_rgba(34,211,238,0.8)]"
              style={{ left: `${(r.x + r.w / 2) * 100}%`, top: `${(r.y + r.h / 2) * 100}%` }}
            />
          )),
        )}

        {m && (
          <>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 z-30 h-full w-full"
            >
              <line
                x1={m.x1 * 100}
                y1={m.y1 * 100}
                x2={m.x2 * 100}
                y2={m.y2 * 100}
                stroke="#38bdf8"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={m.x1 * 100} cy={m.y1 * 100} r={1.2} fill="#38bdf8" />
              <circle cx={m.x2 * 100} cy={m.y2 * 100} r={1.2} fill="#38bdf8" />
            </svg>
            <div
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded bg-[#050b16]/90 px-1 py-0.5 font-mono text-[9px] font-bold text-cyan-300"
              style={{ left: `${((m.x1 + m.x2) / 2) * 100}%`, top: `${((m.y1 + m.y2) / 2) * 100}%` }}
            >
              {m.mm ? `${m.mm.toFixed(1)} mm` : '…'}
            </div>
          </>
        )}

        {caliper && (
          <div
            className="absolute inset-0 z-20 touch-none"
            onPointerDown={(e) => {
              draggingRef.current = true;
              const c = coords(e);
              setDrag({ x1: c.x, y1: c.y, x2: c.x, y2: c.y });
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
            onPointerMove={(e) => {
              if (!draggingRef.current) return;
              const c = coords(e);
              setDrag((d) => (d ? { ...d, x2: c.x, y2: c.y } : d));
            }}
            onPointerUp={finish}
            onPointerCancel={() => { draggingRef.current = false; setDrag(null); }}
          />
        )}

        {state === 'loading' && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-3 text-center font-mono text-[9px] text-rose-300">
            Could not render page {page}
          </div>
        )}
      </div>
    </div>
  );
};
