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
  Mic,
  MicOff,
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
  highlightFromAiReply,
  type UserHighlight,
} from '../utils/userHighlightsStore.ts';
import {
  aiComplete,
  aiCompleteWithImages,
  getActiveProvider,
  getEffectiveModel,
  NOT_CONNECTED_MESSAGE,
  extractJson,
} from '../lib/ai.ts';
import { createOcrPool, ocrConcurrency, OcrWord } from '../utils/ocr.ts';
import { recognizeWithNemotron } from '../utils/nemotronOcr.ts';
import { startJob, stopJob, type JobControl } from '../utils/jobRegistry.ts';
import { downloadNotesPdf } from './RevisionNote.tsx';
import { useVoiceInput } from './useVoiceInput.ts';
import { runWebCheck, webCheckToText } from '../lib/noteWebCheck.ts';
import { StructuredNote, PAGE_TRANSCRIBE_SYSTEM, TEACHING_NOTE_SYSTEM, readSavedNotes, teachingNoteToText, toTeachingNote, writeSavedNotes, type SavedNote, type TeachingNote } from './StructuredNote.tsx';

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

type ContentLevel = 'unit' | 'chapter' | 'section' | 'topic';

/** One line of the book's contents: a unit, chapter, section or topic, and the page it starts on. */
interface ContentEntry {
  id: string;
  level: ContentLevel;
  title: string;
  page: number;
  /** true when the entry came from scanning the book; manual entries are kept on a rescan */
  auto?: boolean;
}

interface ContentNode {
  entry: ContentEntry;
  children: ContentNode[];
}

const LEVEL_ORDER: Record<ContentLevel, number> = { unit: 0, chapter: 1, section: 2, topic: 3 };
const LEVEL_LABEL: Record<ContentLevel, string> = { unit: 'Unit', chapter: 'Chapter', section: 'Section', topic: 'Topic' };

const contentsKey = (docId: string) => `pulse.contents.v1.${docId}`;

const newEntryId = () => Math.random().toString(36).slice(2, 10);

const sameText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function readContents(docId: string): ContentEntry[] {
  try {
    const raw = localStorage.getItem(contentsKey(docId));
    return raw ? (JSON.parse(raw) as ContentEntry[]) : [];
  } catch {
    return [];
  }
}

/** Book order: by page, and a parent comes before its children when they start on the same page. */
function sortContents(entries: ContentEntry[]): ContentEntry[] {
  return [...entries].sort((a, b) => a.page - b.page || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** Nests the sorted entries: each topic sits under its section, each section under its chapter, and so on. */
function contentTree(entries: ContentEntry[]): ContentNode[] {
  const roots: ContentNode[] = [];
  const stack: ContentNode[] = [];
  for (const entry of sortContents(entries)) {
    const node: ContentNode = { entry, children: [] };
    while (stack.length && LEVEL_ORDER[stack[stack.length - 1].entry.level] >= LEVEL_ORDER[entry.level]) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** Every line of a PDF page, top to bottom, with the largest font size on that line. */
async function scanLines(page: any): Promise<{ text: string; size: number; top: number }[]> {
  const [, y0, , y1] = page.view;
  const height = y1 - y0 || 1;
  const tc = await page.getTextContent();
  const items = (tc.items as any[])
    .filter((it) => typeof it.str === 'string' && it.str.trim())
    .map((it) => ({ y: Math.round(it.transform[5]), x: it.transform[4], str: it.str as string, size: Math.abs(it.transform[3]) || it.height || 0 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { text: string; size: number; top: number }[] = [];
  let lineY: number | null = null;
  let current = { text: '', size: 0, y: 0 };
  const close = () => {
    const text = current.text.replace(/\s+/g, ' ').trim();
    // top: how far down the page the line is, 0 at the top edge and 1 at the bottom
    if (text) lines.push({ text, size: Math.round(current.size), top: (y1 - current.y) / height });
  };
  for (const item of items) {
    if (lineY === null || Math.abs(item.y - lineY) > 2) {
      close();
      current = { text: item.str, size: item.size, y: item.y };
      lineY = item.y;
    } else {
      current = { text: `${current.text} ${item.str}`, size: Math.max(current.size, item.size), y: current.y };
    }
  }
  close();
  return lines;
}

/** A printed contents page: which line is a unit heading and which is a chapter with its page. */
function parsePrintedContents(lines: string[]): { level: ContentLevel; title: string; page: number }[] {
  // A line ending in a connecting word is a title that wraps onto the next line.
  const WRAPS_ON = /(\band|\bor|\bof|\bwith|\bfor|\bthe|\bin|\bto|,|:|-)$/i;
  const rows: { level: ContentLevel; title: string; page: number | null }[] = [];
  let pending = '';
  const flushPending = () => {
    if (pending) rows.push({ level: 'unit', title: pending, page: null });
    pending = '';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /medicalstudyzone/i.test(line) || /^contents$/i.test(line)) continue;
    // "Title 12" or "Title12": the last number is the page. A title may end in a number ("Part 1 12").
    const spaced = line.match(/^(.+)\s+(\d{1,3})$/);
    const glued = line.match(/^(.*\D)(\d{1,3})$/);
    const numbered = spaced ?? glued;
    if (numbered) {
      let title = numbered[1].replace(/[\s.·…-]+$/, '').trim();
      if (pending && WRAPS_ON.test(pending)) {
        title = `${pending} ${title}`;
        pending = '';
      } else {
        flushPending();
      }
      rows.push({ level: 'chapter', title, page: Number(numbered[2]) });
      continue;
    }
    if (/^\d{1,3}$/.test(line)) {
      // a page number that wrapped onto its own line
      if (pending) {
        rows.push({ level: 'chapter', title: pending, page: Number(line) });
        pending = '';
      }
      continue;
    }
    if (pending && WRAPS_ON.test(pending)) pending = `${pending} ${line}`;
    else {
      flushPending();
      pending = line;
    }
  }
  flushPending();

  // A unit has no page of its own: it starts where the next chapter starts.
  let nextPage: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].page !== null) nextPage = rows[i].page;
    else if (nextPage !== null) rows[i].page = nextPage;
  }
  return rows.filter((r): r is { level: ContentLevel; title: string; page: number } => r.page !== null);
}

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

// How the copilot answers: a teacher working through the passage with the student, not a summary.
const TEACHER_SYSTEM =
  'You are a patient teacher. The student has never studied this subject, so start from zero. ' +
  'Explain the selected passage from the beginning: ' +
  '(1) the simplest definition of the idea in plain words; ' +
  '(2) define every medical word, abbreviation and symbol the first time it appears, in brackets; ' +
  '(3) one simple everyday example that is not medical; ' +
  "(4) the clinical meaning (how it affects a patient's care): why it matters for a patient; " +
  '(5) each step of any process, with what happens at that step; ' +
  '(6) one question for the student to answer, then the answer on the next line. ' +
  'Use short sentences and common words. Stay grounded in the passage and cite it as [book p. N]. ' +
  'Mark any fact not in the passage with a dagger symbol (†, meaning not in the passage). If the passage does not cover a step, say so.';
interface PDFReaderViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
  darkMode?: boolean;
}
export const PDFReaderView: React.FC<PDFReaderViewProps> = ({ onNavigate, darkMode = false }) => {
  const [docs, setDocs] = useState<PDFLibraryMeta[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const activeDocIdRef = useRef<string | null>(null);
  activeDocIdRef.current = activeDocId;
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
  const [askDialog, setAskDialog] = useState<{ text: string; label: string } | null>(null);
  const [askDialogPrompt, setAskDialogPrompt] = useState<string>('');

  const [showThumbs, setShowThumbs] = useState<boolean>(false);
  const [ocrForce, setOcrForce] = useState<boolean>(false);
  const [ocrBusy, setOcrBusy] = useState<boolean>(false);
  // Which engine reads the pages: on-device Tesseract, or NVIDIA's hosted nemotron-ocr-v2.
  const [ocrEngine, setOcrEngine] = useState<'tesseract' | 'nemotron'>(() => {
    try {
      return localStorage.getItem('pulse.ocrEngine') === 'nemotron' ? 'nemotron' : 'tesseract';
    } catch {
      return 'tesseract';
    }
  });
  const [ocrTask, setOcrTask] = useState<{ done: number; total: number; detail: string } | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [wordsVersion, setWordsVersion] = useState(0);

  const [rightTab, setRightTab] = useState<'copilot' | 'highlights' | 'notes' | 'index'>('copilot');
  // The library shelf is the opening page; a book opens the reader, and "Library" returns here.
  const [showShelf, setShowShelf] = useState<boolean>(true);
  const [libQuery, setLibQuery] = useState<string>('');
  const [libResults, setLibResults] = useState<{ docId: string; title: string; page: number; snippet: string }[] | null>(null);
  const [libSearchNote, setLibSearchNote] = useState<string | null>(null);

  // ----- Book contents: units, chapters and sections with their start pages -----
  const [bookContents, setBookContents] = useState<ContentEntry[]>([]);
  const [newEntry, setNewEntry] = useState<{ level: ContentLevel; title: string; page: string }>({ level: 'chapter', title: '', page: '' });
  const [contentsNote, setContentsNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [notesFrom, setNotesFrom] = useState<number>(1);
  const [notesTo, setNotesTo] = useState<number>(5);
  const [notesPartSize, setNotesPartSize] = useState<number>(5);
  const [notesBusy, setNotesBusy] = useState<boolean>(false);
  const notesCancelRef = useRef<boolean>(false);
  const pageTranscriptsRef = useRef<Map<string, string>>(new Map());
  const [madeNotes, setMadeNotes] = useState<SavedNote[]>([]);
  const [checkingNotes, setCheckingNotes] = useState<Set<string>>(new Set());
  const [notesError, setNotesError] = useState<string | null>(null);

  // ----- AI panel / MCQ state -----
  const [askContext, setAskContext] = useState<string>('');
  const [askContextLabel, setAskContextLabel] = useState<string>('current page');
  const [askIncludeWeb, setAskIncludeWeb] = useState<boolean>(false);
  const [askBusy, setAskBusy] = useState<boolean>(false);
  const [askReply, setAskReply] = useState<string>('');
  const [askQuestion, setAskQuestion] = useState<string>('');
  const [askInput, setAskInput] = useState<string>('');
  // Voice input for the copilot: the transcript is added to the question box.
  const voice = useVoiceInput((text) => setAskInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text)));
  const voiceStatus = voice.status;
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

  // The open book and page are remembered, so leaving the PDF reader tab and coming back returns to the same page.
  const LAST_VIEW_KEY = 'pulse.pdfReader.last';
  const restoredView = useRef<{ docId: string; page: number } | null>(null);
  if (restoredView.current === null) {
    try {
      const raw = localStorage.getItem(LAST_VIEW_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      restoredView.current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        typeof parsed.docId === 'string' && Number.isInteger(parsed.page) && parsed.page > 0
        ? parsed
        : { docId: '', page: 1 };
    } catch {
      restoredView.current = { docId: '', page: 1 };
    }
  }
  const pendingScrollPage = useRef<number | null>(null);
  useEffect(() => {
    if (!activeDocId) return;
    try { localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ docId: activeDocId, page: currentPage })); } catch { /* storage full or blocked */ }
  }, [activeDocId, currentPage]);

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

  const openDoc = useCallback(async (id: string, startPage: number = 1) => {
    if (pdfRef.current) {
      try { await pdfRef.current.destroy(); } catch { /* ignore */ }
      pdfRef.current = null;
    }
    clearRenderedPages();
    // A notes run reads pages from the open PDF, so it must not carry on into another book.
    if (id !== activeDocIdRef.current) notesCancelRef.current = true;
    setActiveDocId(id);
    setShowShelf(false);
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
    setCurrentPage(startPage);
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
      // wasmUrl: JPEG 2000 and JBIG2 images in scanned books need these decoders, or the page stays white.
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), wasmUrl: '/pdfjs-wasm/' }).promise;
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
    const doc = docs.find((d) => d.id === id);
    if (!window.confirm(`Delete "${doc?.title ?? 'this book'}" from the library? This cannot be undone.`)) return;
    try {
      await removeLibraryDocument(id);
      writeSavedNotes(id, []);
      await refreshLibrary();
      if (id === activeDocId) {
        clearRenderedPages();
        if (pdfRef.current) { try { await pdfRef.current.destroy(); } catch { /* ignore */ } pdfRef.current = null; }
        setActiveDocId(null);
        setNumPages(0);
        setHighlights([]);
        setShowShelf(true);
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
      x: Math.min(Math.max(range.left - rowRect.left, 12), Math.max(12, row.clientWidth - 360)),
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
    setOcrTask({ done: 0, total: pages.length, detail: 'starting' });
    const job = startJob(`OCR · ${doc?.title ?? 'document'}`, scope === 'current' ? `page ${pages[0]}` : 'scanning pages…');
    ocrJobRef.current = job;
    let processed = 0;
    let skipped = 0;
    let pool: Awaited<ReturnType<typeof createOcrPool>> | null = null;
    const failures: string[] = [];
    // One page after another for the whole document: pages are recognised in order, and only one
    // OCR engine is busy at a time, so memory stays low on large scans.
    const K = 1;
    const measure = document.createElement('canvas').getContext('2d')!;
    try {
      if (ocrEngine === 'tesseract') pool = await createOcrPool(K);
      let next = 0;
      const runOne = async () => {
        for (;;) {
          const index = next++;
          if (index >= pages.length || job.isCancelled()) return;
          const n = pages[index];
          try {
            if (scope === 'missing' && !ocrForce) {
              // A page counts as "has text" only with real body text: a running header or a watermark
              // alone (a few dozen characters) must not stop a scanned page from being recognised.
              const existing = await ensurePageText(n).catch(() => '');
              if (existing.replace(/\s+/g, '').length >= 200) { skipped += 1; return; }
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
            const result = ocrEngine === 'nemotron'
              ? await recognizeWithNemotron(canvas)
              : await pool!.recognize(canvas, (p) => {
                job.update({
                  progress: Math.round(((processed + p.progress) / pages.length) * 100),
                  detail: `page ${n} · ${p.status}`,
                });
                setOcrTask({ done: processed, total: pages.length, detail: `page ${n} · ${p.status}` });
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
            setOcrTask({ done: processed, total: pages.length, detail: `page ${n} done` });
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
      setOcrTask(null);
      ocrJobRef.current = null;
    }
  };

  // ============================ Book contents ============================

  // The book's own structure, laid out like the contents page at the front of a printed book:
  // units, chapters and sections, each with the page it starts on. It comes from the PDF's
  // bookmarks when there are any, and can always be typed in by hand.
  const saveContents = (docId: string, entries: ContentEntry[]) => {
    const sorted = sortContents(entries);
    setBookContents(sorted);
    try {
      localStorage.setItem(contentsKey(docId), JSON.stringify(sorted));
    } catch {
      /* storage full: the contents stay for this session only */
    }
  };

  // Bookmarks at the top level become chapters, and bookmarks nested under them become sections.
  // Units are not in the bookmarks, so the units already typed in are kept.
  const importFromBookmarks = async () => {
    const pdf = pdfRef.current;
    if (!pdf || !activeDocId) return;
    const found: ContentEntry[] = [];
    const walk = async (items: any[], depth: number) => {
      for (const item of items) {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest).catch(() => null);
        let page = 0;
        if (Array.isArray(dest) && dest[0]) page = (await pdf.getPageIndex(dest[0]).catch(() => -1)) + 1;
        const title = String(item.title || '').trim();
        if (page > 0 && title) {
          found.push({ id: newEntryId(), level: depth === 0 ? 'chapter' : 'section', title, page });
        }
        if (item.items?.length) await walk(item.items, depth + 1);
      }
    };
    await walk((await pdf.getOutline().catch(() => null)) ?? [], 0);
    if (!found.length) {
      setLibraryError('This PDF has no bookmarks. Add its units and chapters by hand.');
      return;
    }
    saveContents(activeDocId, [...bookContents.filter((e) => e.level === 'unit'), ...found]);
  };

  const addEntry = (level: ContentLevel, title: string, page: number) => {
    if (!activeDocId) return;
    const entry: ContentEntry = {
      id: newEntryId(),
      level,
      title: title.trim() || `${LEVEL_LABEL[level]} from p. ${page}`,
      page,
    };
    saveContents(activeDocId, [...bookContents, entry]);
  };

  const removeEntry = (id: string) => {
    if (activeDocId) saveContents(activeDocId, bookContents.filter((e) => e.id !== id));
  };

  // Scans every page of the book and builds the contents from the whole text: the printed contents
  // page (units and chapters, when the book has one) plus the headings found on the pages, nested
  // unit > chapter > section > topic. Entries typed in by hand are kept.
  const buildIndexFromBook = async () => {
    const pdf = pdfRef.current;
    if (!pdf || !activeDocId || scanning) return;
    const docId = activeDocId;
    const total = numPages;
    setContentsNote(null);
    setScanning({ done: 0, total });
    try {
      // 1. Read every page, so nothing depends on where the contents page happens to be.
      const pages = new Map<number, { text: string; size: number; top: number }[]>();
      for (let n = 1; n <= total; n++) {
        pages.set(n, await scanLines(await pdf.getPage(n)));
        setScanning({ done: n, total });
      }

      // 2. The printed contents page, if there is one, and the pages that carry on from it.
      let start = 0;
      for (let n = 1; n <= total && !start; n++) {
        if (pages.get(n)!.some((l) => /^contents$/i.test(l.text))) start = n;
      }
      const contentsPages: number[] = [];
      let printed: { level: ContentLevel; title: string; page: number }[] = [];
      if (start) {
        contentsPages.push(start);
        // A contents page is mostly lines that end in a page number. Slide pages are not, so they stop the run.
        const contentsLike = (n: number) => {
          const ls = pages.get(n)!;
          const numbered = ls.filter((l) => /\d{1,3}$/.test(l.text)).length;
          return numbered >= 3 && numbered / ls.length >= 0.5;
        };
        for (let n = start + 1; n <= Math.min(total, start + 6) && contentsLike(n); n++) {
          contentsPages.push(n);
        }
        printed = parsePrintedContents(contentsPages.flatMap((n) => pages.get(n)!.map((l) => l.text)));
      }
      const bodyPages = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !contentsPages.includes(n));
      const pageHead = (n: number) => sameText(pages.get(n)!.map((l) => l.text).join(' ').slice(0, 400));

      // 3. Printed page numbers are not PDF page numbers (the front matter comes first). Find the
      //    shift that puts the first chapter titles on their printed pages.
      let offset = 0;
      if (printed.length) {
        const probes = printed.filter((e) => e.level !== 'unit').slice(0, 6);
        let bestHits = -1;
        for (let shift = 0; shift <= 30; shift++) {
          let hits = 0;
          for (const e of probes) {
            const n = e.page + shift;
            if (n >= 1 && n <= total && !contentsPages.includes(n) && pageHead(n).includes(sameText(e.title).slice(0, 18))) {
              hits += 1;
            }
          }
          if (hits > bestHits) {
            bestHits = hits;
            offset = shift;
          }
        }
      }

      // 4. Headings: lines set in a bigger font than the body text, on the pages outside the contents.
      const sizeChars = new Map<number, number>();
      for (const n of bodyPages) {
        for (const l of pages.get(n)!) sizeChars.set(l.size, (sizeChars.get(l.size) ?? 0) + l.text.length);
      }
      let bodySize = 0;
      let most = -1;
      for (const [size, chars] of sizeChars) {
        if (chars > most) {
          most = chars;
          bodySize = size;
        }
      }
      const headings: { text: string; size: number; page: number }[] = [];
      for (const n of bodyPages) {
        for (const l of pages.get(n)!) {
          if (l.size < bodySize + 2 || l.text.length < 3 || l.text.length > 90) continue;
          // A heading is a short line near the top of the page. Figures, slide text and bullet points are not.
          if (l.top > 0.4 || l.text.split(' ').length > 12) continue;
          if (/[.;,:]$/.test(l.text) || /^[•*\-–]/.test(l.text) || /\d{1,2}:\d{2}/.test(l.text)) continue;
          if (!/[A-Za-z]{3}/.test(l.text) || /medicalstudyzone/i.test(l.text)) continue;
          // Slide titles repeat in capitals, and slide artwork leaves "Active space" and garbled text behind.
          if (l.text.length > 12 && l.text === l.text.toUpperCase()) continue;
          if (/active\s*space/i.test(l.text) || l.text.replace(/[^A-Za-z]/g, '').length < l.text.length * 0.7) continue;
          headings.push({ text: l.text, size: l.size, page: n });
        }
      }
      // The biggest heading size is the top level. With a printed contents page, chapters come from
      // it, so headings become sections and topics.
      const sizes = [...new Set(headings.map((h) => h.size))].sort((a, b) => b - a);
      const levelOfSize = (size: number): ContentLevel => {
        const rank = sizes.indexOf(size);
        if (printed.length) return rank === 0 ? 'section' : 'topic';
        return rank === 0 ? 'chapter' : rank === 1 ? 'section' : 'topic';
      };
      const known = new Set(printed.map((e) => sameText(e.title)));
      const seen = new Set<string>();
      const found: { level: ContentLevel; title: string; page: number }[] = [];
      for (const h of headings) {
        const key = sameText(h.text);
        // a running header repeats on every page: keep only its first page
        if (!key || known.has(key) || seen.has(key)) continue;
        seen.add(key);
        found.push({ level: levelOfSize(h.size), title: h.text, page: h.page });
      }

      // 5. Save: the scanned entries replace the earlier scan, and manual entries stay.
      const scanned: ContentEntry[] = [
        ...printed.map((e) => ({ level: e.level, title: e.title, page: e.page + offset })),
        ...found,
      ]
        .filter((e) => e.page >= 1 && e.page <= total)
        .map((e) => ({ id: newEntryId(), level: e.level, title: e.title, page: e.page, auto: true }));
      saveContents(docId, [...bookContents.filter((e) => !e.auto), ...scanned]);
      const count = (lvl: ContentLevel) => scanned.filter((e) => e.level === lvl).length;
      setContentsNote(
        `Scanned ${total} pages: ${count('unit')} units, ${count('chapter')} chapters, ${count('section')} sections, ${count('topic')} topics. ` +
          (printed.length
            ? `Printed page 1 is PDF page ${1 + offset}.`
            : 'No printed contents page was found, so chapters come from the headings.'),
      );
    } catch (err: any) {
      setContentsNote(`Scan failed: ${err?.message || 'unknown error'}`);
    } finally {
      setScanning(null);
    }
  };

  const deleteNote = (id: string) => {
    if (!activeDocId) return;
    const remaining = readSavedNotes(activeDocId).filter((n) => n.id !== id);
    writeSavedNotes(activeDocId, remaining);
    setMadeNotes((prev) => prev.filter((n) => n.id !== id));
  };

  // Show the saved contents and notes of the open book.
  useEffect(() => {
    setMadeNotes(activeDocId ? readSavedNotes(activeDocId) : []);
    setNotesError(null);
    setBookContents(activeDocId ? readContents(activeDocId) : []);
    setNewEntry({ level: 'chapter', title: '', page: '' });
  }, [activeDocId]);

  // ============================ Make notes from pages ============================

  const checkNoteOnWeb = async (docId: string, target: SavedNote) => {
    const provider = getActiveProvider();
    if (!provider) { setNotesError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    setCheckingNotes((prev) => new Set(prev).add(target.id));
    const webCheck = await runWebCheck(teachingNoteToText(target.note), { provider, model: getEffectiveModel(provider) });
    // A failed re-check must not wipe out an earlier good result.
    const keepOld = webCheck.status === 'failed' && target.webCheck?.status === 'done';
    if (keepOld) {
      setNotesError(`The new web check failed, so the earlier result is still shown. ${webCheck.error ?? ''}`);
    } else {
      writeSavedNotes(docId, readSavedNotes(docId).map((n) => (n.id === target.id ? { ...n, webCheck } : n)));
      if (activeDocIdRef.current === docId) {
        setMadeNotes((prev) => prev.map((n) => (n.id === target.id ? { ...n, webCheck } : n)));
      }
    }
    setCheckingNotes((prev) => {
      const next = new Set(prev);
      next.delete(target.id);
      return next;
    });
  };

  // A book page drawn as an image for the figures in a note. Kept in memory only, so nothing is stored.
  const figurePageCache = useRef(new Map<string, string>());
  const renderNotePage = useCallback(async (n: number, caption = ''): Promise<string | null> => {
    const label = (caption.match(/^\s*FIGURES?\s*\d+\s*[–\-.]\s*\d+/i)?.[0] ?? '').replace(/\s+/g, ' ').trim();
    const key = activeDocId + ':' + n + ':' + label;
    const hit = figurePageCache.current.get(key);
    if (hit) return hit;
    const pdf = pdfRef.current;
    if (!pdf || n < 1 || n > pdf.numPages) return null;
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.2, 1100 / Math.max(1, base.width)) });
    // The figure sits just above its caption. Find the caption line on the page and keep the band from the figure
    // before it (or the top of the page) down to the end of the caption. A band that is too thin or covers most of
    // the page means the caption was not found cleanly, so the whole page is shown instead.
    let top = 0;
    let bottom = viewport.height;
    let left = 0;
    let right = viewport.width;
    if (label) {
      try {
        const content = await page.getTextContent();
        const norm = (s: string) => s.replace(/\s+/g, '').replace(/[–—]/g, '-').toLowerCase();
        const want = norm(label);
        const items = content.items as any[];
        const toView = (it: any) => viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        // Books set in two columns put a figure and its caption in one column, so the picture is cut to that column.
        const half = viewport.width / 2;
        const long = items.filter((it) => typeof it?.str === 'string' && it.str.trim().length > 25);
        const twoColumns = long.filter((it) => toView(it)[0] < half * 0.9).length >= 3 && long.filter((it) => toView(it)[0] >= half * 1.05).length >= 3;
        const columnOf = (x: number) => (x < half ? 0 : 1);
        const captions = items
          .filter((it) => typeof it?.str === 'string' && /^\s*FIGURE\s*\d/.test(it.str))
          .map((it) => { const [x, y] = toView(it); return { text: norm(it.str), x, y }; })
          .sort((a, b) => a.y - b.y);
        const at = captions.findIndex((l) => l.text.startsWith(want) || want.startsWith(l.text.slice(0, 12)));
        if (at >= 0) {
          const cap = captions[at];
          const col = columnOf(cap.x);
          const sameColumn = twoColumns ? captions.filter((c) => columnOf(c.x) === col) : captions;
          const idx = sameColumn.indexOf(cap);
          const bandTop = idx > 0 ? sameColumn[idx - 1].y + 60 * viewport.scale : 0;
          const bandBottom = Math.min(viewport.height, cap.y + 70 * viewport.scale);
          const frac = (bandBottom - bandTop) / viewport.height;
          if (frac >= 0.1 && frac <= 0.85) {
            top = Math.max(0, bandTop - 12);
            bottom = bandBottom;
            if (twoColumns) { left = col === 0 ? 0 : half - 8; right = col === 0 ? half + 8 : viewport.width; }
          }
        }
      } catch { /* keep the whole page */ }
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.floor(right - left));
    out.height = Math.max(1, Math.floor(bottom - top));
    out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/jpeg', 0.82);
    canvas.width = 0;
    canvas.height = 0;
    out.width = 0;
    out.height = 0;
    figurePageCache.current.set(key, url);
    return url;
  }, [activeDocId]);

  // override: notes for a given page range (a chapter from the index); label names that range in the notes.
  const makeNotesFromPages = async (override?: { from: number; to: number; label?: string }) => {
    if (notesBusy) return;
    const provider = getActiveProvider();
    if (!provider) { setNotesError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    if (!activeDocId || numPages === 0) { setNotesError('Open a document first.'); return; }
    const from = Math.max(1, Math.min(numPages, Math.floor(override?.from ?? notesFrom) || 1));
    const to = Math.max(from, Math.min(numPages, Math.floor(override?.to ?? notesTo) || from));
    const partSize = Math.max(1, Math.min(20, Math.floor(notesPartSize) || 5));
    const doc = docs.find((d) => d.id === activeDocId);
    const notesDocId = activeDocId;
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
        // Handwritten and scanned pages come through OCR garbled, so each page is first read from its
        // image, one call per page, which keeps small details like "3rd" or "CYP2C19" legible. The teacher
        // then writes from those transcripts. A page that cannot be read falls back to its text layer.
        const sources: string[] = [];
        let pagesRead = 0;
        for (let n = start; n <= end; n++) {
          if (notesCancelRef.current || job.isCancelled()) break;
          const key = activeDocId + ':' + n;
          let transcript = pageTranscriptsRef.current.get(key) ?? '';
          if (!transcript && pdfRef.current) {
            job.update({ detail: 'reading page ' + n + ' of ' + end });
            try {
              const page = await pdfRef.current.getPage(n);
              const base = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: Math.min(3, 1600 / Math.max(1, base.width)) });
              const canvas = document.createElement('canvas');
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
              const image = canvas.toDataURL('image/jpeg', 0.8);
              canvas.width = 0;
              canvas.height = 0;
              // The provider rate-limits bursts (HTTP 429). Waiting beats falling back to garbled text.
              for (let attempt = 0; ; attempt++) {
                try {
                  transcript = (await aiCompleteWithImages({
                    system: PAGE_TRANSCRIBE_SYSTEM,
                    messages: [{ role: 'user', content: 'Transcribe this page.' }],
                    // Copying text from an image needs no reasoning; thinking here made each page take far longer.
                    effort: 'min',
                    provider,
                    model: getEffectiveModel(provider),
                  }, [image])).trim();
                  break;
                } catch (err: any) {
                  if (attempt >= 3 || !/429/.test(err?.message || '')) throw err;
                  job.update({ detail: 'rate limited, retrying page ' + n });
                  await new Promise((resolve) => setTimeout(resolve, 10000 * (attempt + 1)));
                }
              }
              if (transcript) pageTranscriptsRef.current.set(key, transcript);
            } catch (err: any) {
              console.warn('[notes] page ' + n + ' image was not read:', err?.message || err);
            }
          }
          if (transcript) {
            pagesRead += 1;
            sources.push('[page ' + n + ']\n' + transcript);
          } else {
            const layer = parts.find((p) => p.startsWith('[page ' + n + ']'));
            if (layer) sources.push(layer);
          }
        }
        if (notesCancelRef.current || job.isCancelled()) break;
        if (!sources.length) continue;
        const readImages = pagesRead === end - start + 1;
        job.update({ detail: 'writing notes for pages ' + start + '–' + end });
        // Malformed JSON gets one more try before the part is reported as failed.
        let note: TeachingNote | null = null;
        for (let attempt = 0; attempt < 2 && !note; attempt++) {
          note = toTeachingNote(extractJson(await aiComplete({
            system: TEACHING_NOTE_SYSTEM,
            messages: [{
              role: 'user',
              content: 'Book: ' + (doc?.title ?? 'document') + '\nPages ' + start + '–' + end + ':\n\n' + sources.join('\n\n').slice(0, 24000) + '\n\nTeach these pages. Reply with the JSON note.',
            }],
            json: true,
            // Medium is about as good as high for writing from a transcript, and about three times faster.
            effort: 'medium',
            provider,
            model: getEffectiveModel(provider),
          })));
        }
        if (!note) {
          setNotesError(`Pages ${start}–${end}: the AI reply could not be read as a note, so this part was skipped.`);
          continue;
        }
        const made: SavedNote = {
          id: newEntryId(),
          range: `${override?.label ? `${override.label} · ` : ''}pp. ${start}–${end}`,
          note,
          readImages,
        };
        // Saved after every part, so a stopped or interrupted chapter keeps what it already made.
        const savedNotes = [...readSavedNotes(notesDocId), made];
        if (!writeSavedNotes(notesDocId, savedNotes)) {
          setNotesError('This note could not be saved because browser storage is full. It will be lost on reload.');
        }
        if (activeDocIdRef.current === notesDocId) setMadeNotes((prev) => [...prev, made]);
        job.update({ detail: 'checking pages ' + start + '–' + end + ' on the web' });
        await checkNoteOnWeb(notesDocId, made);
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

  // ctx: text to answer from (defaults to the panel's current context); onReply: receives the answer.
  const askAi = async (customQuestion?: string, ctx?: string, onReply?: (reply: string) => void) => {
    const provider = getActiveProvider();
    if (!provider) { setAskError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    if (!(ctx ?? askContext).trim()) {
      const text = await ensurePageText(currentPageRef.current).catch(() => '');
      setAskContext(text.slice(0, 6000));
      if (!text.trim()) { setAskError('No text available on this page (possibly a scanned image without OCR).'); return; }
    }
    setAskBusy(true);
    setAskError(null);
    setAskCitations([]);
    setAskReply('');
    const question = customQuestion?.trim() || 'Teach me this passage from the beginning, as if I have never seen it before.';
    setAskQuestion(question);
    const contextText = (ctx ?? askContext).trim();
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
          TEACHER_SYSTEM +
          (askIncludeWeb ? ' Use the labelled web sources too, and cite them as [Wn].' : ''),
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
      onReply?.(raw);
    } catch (err: any) {
      setAskError(err?.message || 'AI request failed.');
    } finally {
      setAskBusy(false);
    }
  };

  // Selection popup actions: open the Ask panel on the selected text and answer straight away.
  const EXPLAIN_PROMPT = "Explain this selection to someone who has never studied this subject: start with the simplest definition, define every medical or technical term the first time it appears (clinical means related to patient care), give one simple everyday example, then the clinical meaning, and mark any fact not in the passage with a dagger symbol (†).";
  const NOTES_PROMPT = 'Turn this passage into a beginner-friendly revision note card for someone meeting the topic for the first time: one bold title line, a plain-English definition, 3-6 bullets, and define any medical or technical term in each bullet, a "Why it matters:" line, and a citation in the form [book p. N]; mark outside facts with †.';
  const runSelectionAi = (text: string, label: string, prompt?: string, saveNote = false) => {
    setRightTab('copilot');
    setShowNotes(true);
    setAskError(null);
    setMcqs([]);
    setAskContext(text);
    setAskContextLabel(label);
    void askAi(prompt, text, saveNote ? (reply) => {
      addUserHighlight(highlightFromAiReply({
        quote: reply,
        subject: activeDoc?.subject ?? '',
        subtopic: label,
        citation: `AI note · ${activeDoc?.title ?? 'book'} · ${label}`,
        tags: ['ai-note'],
      }));
    } : undefined);
  };

  const askSelection = (prompt?: string, saveNote = false) => {
    if (!popup) return;
    const text = popup.text;
    const label = `selection (p. ${currentPageRef.current})`;
    setPopup(null);
    runSelectionAi(text, label, prompt, saveNote);
  };

  // The Ask AI dialog: options plus a free-text question about the selected text. Nothing runs until one is picked.
  const closeAskDialog = () => {
    setAskDialog(null);
    setAskDialogPrompt('');
  };
  const sendAskDialog = (prompt: string) => {
    if (!askDialog || !prompt.trim()) return;
    runSelectionAi(askDialog.text, askDialog.label, prompt.trim());
    closeAskDialog();
  };
  const ASK_DIALOG_OPTIONS: { label: string; prompt: string }[] = [
    { label: 'Explain simply', prompt: EXPLAIN_PROMPT },
    { label: 'Summarise in 3 lines', prompt: 'Summarise this in 3 short sentences a student can remember.' },
    { label: 'Give an example', prompt: 'Give one clinical example that uses this text, then explain why it fits.' },
    { label: 'Simpler words', prompt: 'Rewrite this in very simple English, keeping every number and name exactly as in the text.' },
    { label: 'Quiz me on it', prompt: 'Ask me one short exam question about this text, wait for my answer, then tell me if I am right and why.' },
  ];

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
    // Entering full screen refits the page to the screen width instead of keeping the old zoom.
    if (next) setFitWidth(true);
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
  const panelOpen = showNotes;

  // Reopen the remembered book and page when the reader mounts.
  useEffect(() => {
    const last = restoredView.current;
    if (!last?.docId || activeDocId) return;
    restoredView.current = null;
    pendingScrollPage.current = last.page > 1 ? last.page : null;
    setShowShelf(false);
    void openDoc(last.docId, last.page || 1);
  }, [openDoc]);

  // After a remembered book has loaded, scroll to the remembered page.
  useEffect(() => {
    if (!numPages || pendingScrollPage.current == null) return;
    const page = pendingScrollPage.current;
    pendingScrollPage.current = null;
    setTimeout(() => jumpToPage(page), 300);
  }, [numPages, jumpToPage]);

  // Library search: the pages already indexed (read once when a book is searched or opened) are searched across all books.
  const runLibrarySearch = async () => {
    const q = libQuery.trim().toLowerCase();
    if (!q) { setLibResults(null); setLibSearchNote(null); return; }
    const found: { docId: string; title: string; page: number; snippet: string }[] = [];
    let indexedPages = 0;
    for (const d of docs) {
      const rows = await listPageTexts(d.id).catch(() => []);
      indexedPages += rows.length;
      for (const row of rows) {
        const text = String(row.text || '');
        const at = text.toLowerCase().indexOf(q);
        if (at >= 0) {
          found.push({ docId: d.id, title: d.title, page: row.pageNumber, snippet: text.slice(Math.max(0, at - 80), at + q.length + 80) });
        }
      }
    }
    found.sort((a, b) => a.title.localeCompare(b.title) || a.page - b.page);
    setLibResults(found.slice(0, 200));
    setLibSearchNote(`Searched ${indexedPages} indexed page${indexedPages === 1 ? '' : 's'} in ${docs.length} book${docs.length === 1 ? '' : 's'}. Search inside a book to index its other pages.`);
  };

  // Books grouped by subject, for the library shelf. Uncategorised comes last.
  const shelfGroups = Object.entries(
    docs.reduce<Record<string, PDFLibraryMeta[]>>((acc, d) => {
      const key = d.subject || 'Uncategorised';
      (acc[key] ??= []).push(d);
      return acc;
    }, {}),
  ).sort(([a], [b]) => Number(a === 'Uncategorised') - Number(b === 'Uncategorised') || a.localeCompare(b));

  const shelfView = (
    <div className="flex h-[calc(100vh-64px)] flex-col gap-3 overflow-y-auto bg-slate-200/70 p-3 text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-slate-400">PDF reader</p>
          <h2 className="text-[16px] font-bold text-slate-900">Your library</h2>
          <p className="text-[11px] text-slate-500">
            {docs.length} book{docs.length === 1 ? '' : 's'} · grouped by subject
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold transition active:scale-95 ${T.cta}`}
        >
          <UploadCloud className="h-3.5 w-3.5" /> Import
        </button>
        {/* The shelf needs its own input: the reader's input is not mounted while the shelf is showing. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          className="hidden"
          onChange={(e) => { handleImportFiles(e.target.files); e.target.value = ''; }}
        />
      </header>

      {libraryError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{libraryError}</span>
        </div>
      )}

      {docs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex gap-2">
            <input
              value={libQuery}
              onChange={(e) => setLibQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runLibrarySearch(); }}
              placeholder="Search all your books"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-[12px]"
            />
            <button onClick={() => void runLibrarySearch()} className={`rounded-lg px-3 py-2 text-[11px] font-bold transition active:scale-95 ${T.cta}`}>
              Search
            </button>
          </div>
          {libSearchNote && <p className="mt-2 text-[10px] text-slate-500">{libSearchNote}</p>}
          {libResults && (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-[11px]">
              {libResults.length === 0 && <li className="text-slate-500">No match in the indexed pages.</li>}
              {libResults.map((r, i) => (
                <li key={`${r.docId}-${r.page}-${i}`}>
                  <button
                    onClick={() => { setShowShelf(false); void openDoc(r.docId, r.page); }}
                    className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-100"
                  >
                    <span className="font-bold text-slate-800">{r.title}</span>
                    <span className="text-slate-500"> · page {r.page}</span>
                    <span className="block text-slate-600">…{r.snippet}…</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!docs.length && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BookOpen className={`h-8 w-8 ${T.dim}`} />
          <p className={`text-[12px] font-bold ${T.strong}`}>No books yet</p>
          <p className={`max-w-xs text-[11px] leading-relaxed ${T.muted}`}>Import a PDF or DOCX. It is stored on this computer and sorted by its subject.</p>
        </div>
      )}

      {shelfGroups.map(([subject, books]) => (
        <section key={subject} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[12px] font-bold text-slate-900">{subject}</span>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 font-mono text-[9px] text-[#00696b]">{books.length}</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {books.map((d) => (
              <div key={d.id} className="group relative">
                <button
                  onClick={() => openDoc(d.id)}
                  title={`${d.title} · ${d.numPages} pages`}
                  className="flex w-full flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:-translate-y-0.5 hover:border-[#0f8b8d]/40 hover:bg-white hover:shadow-md"
                >
                  <div className="flex h-24 items-center justify-center rounded-lg bg-gradient-to-br from-[#00696b] to-[#0f8b8d] text-white">
                    <BookOpen className="h-8 w-8 opacity-90" />
                  </div>
                  <span className="line-clamp-2 text-[12px] font-semibold text-slate-900">{d.title}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {(d.fileType ?? 'pdf').toUpperCase()} · {d.numPages} pages
                  </span>
                </button>
                <button
                  onClick={() => handleDeleteDoc(d.id)}
                  title="Delete this book"
                  aria-label={`Delete ${d.title}`}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/95 text-slate-500 opacity-0 shadow-sm transition hover:border-rose-300 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  if (showShelf) return shelfView;

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col gap-2 overflow-y-auto p-2 lg:overflow-hidden bg-slate-200/70 text-slate-800">
      <section className={`shrink-0 rounded-xl border px-2.5 py-2 ${T.panel}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              onClick={() => setShowShelf(true)}
              title="Back to the library"
              className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${T.chip} ${T.softHover}`}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Library
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition active:scale-95 ${T.cta}`}
              title="Import a PDF or DOCX (stored locally in IndexedDB)"
            >
              <UploadCloud className="h-3.5 w-3.5" /> Import
            </button>
            {activeDoc && (
              <button
                onClick={() => handleDeleteDoc(activeDoc.id)}
                title="Delete this book from the library"
                className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition hover:border-rose-300 hover:text-rose-600 ${T.chip}`}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              multiple
              className="hidden"
              onChange={(e) => { handleImportFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="min-w-0">
              <div className={`truncate text-[12px] font-bold ${T.strong}`}>{activeDoc?.title ?? 'No document open'}</div>
              <div className={`truncate font-mono text-[9px] ${T.dim}`}>
                {activeDoc
                  ? `${activeDoc.fileType?.toUpperCase() ?? ''} · ${numPages} pages · ${activeDoc.subject || 'Uncategorised'}`
                  : 'Import a PDF or DOCX to begin'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className={`hidden items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-wider xl:flex ${T.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${numPages ? 'bg-emerald-500' : 'bg-slate-500'}`} />
              {numPages ? 'Local engine · ready' : 'Idle'}
            </span>
            {numPages > 0 && (
              <>
                <span
                  className={`flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[9px] ${ocrBusy ? T.chipAccent : currentOcr || currentNativeText ? T.chipGood : T.chip}`}
                  title="OCR status for the current page"
                >
                  <ScanText className="h-3 w-3" />
                  OCR: {ocrBusy
                    ? `running ${ocrTask ? `${ocrTask.done}/${ocrTask.total}` : ''}`
                    : currentOcr
                      ? `ready (${ocrWordsRef.current.size} pp)`
                      : currentNativeText
                        ? 'native text'
                        : 'not scanned'}
                </span>
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
                  onClick={() => { setRightTab('copilot'); setShowNotes(true); generateMcqs(); }}
                  disabled={mcqBusy || !getActiveProvider()}
                  title={getActiveProvider() ? 'Generate MCQs from this page' : 'Connect an AI provider first'}
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-40 ${getActiveProvider() ? T.cta : T.chip} ${T.softHover}`}
                >
                  {mcqBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GraduationCap className="h-3 w-3" />}
                  {mcqBusy ? 'Generating…' : mcqs.length ? 'Regenerate MCQs' : 'Generate MCQs'}
                </button>
                <button
                  onClick={() => { setRightTab('copilot'); setShowNotes(true); }}
                  title="Ask AI about this page"
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition ${panelOpen && rightTab === 'copilot' ? T.chipAccent : T.chip} ${T.softHover}`}
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
              </>
            )}
          </div>
        </div>
      </section>
      {numPages > 0 && (
        <div className={`flex shrink-0 flex-wrap items-center gap-2 rounded-xl border px-2.5 py-1.5 ${T.panel}`}>
          <span className={`flex items-center gap-1.5 text-[10px] font-bold ${T.accent}`}>
            <ScanText className="h-3.5 w-3.5" /> OCR
          </span>
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
          <label className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${T.muted}`}>
            <input type="checkbox" checked={ocrForce} onChange={(e) => setOcrForce(e.target.checked)} className="accent-[#0f8b8d]" />
            Force OCR even where text exists
          </label>
          <label className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${T.muted}`}>
            Engine
            <select
              value={ocrEngine}
              onChange={(e) => {
                const next = e.target.value === 'nemotron' ? 'nemotron' : 'tesseract';
                setOcrEngine(next);
                try { localStorage.setItem('pulse.ocrEngine', next); } catch { /* storage full: the choice is for this session */ }
              }}
              disabled={ocrBusy}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] ${T.input}`}
            >
              <option value="tesseract">Tesseract (on-device)</option>
              <option value="nemotron">NVIDIA nemotron-ocr-v2 (hosted)</option>
            </select>
          </label>
          {ocrNote && <span className={`min-w-0 text-[10px] ${T.muted}`}>{ocrNote}</span>}
          {!pdfRef.current && <span className="text-[10px] text-amber-600 dark:text-amber-300">OCR needs a PDF. DOCX already has real text.</span>}
          <span className={`ml-auto hidden font-mono text-[9px] ${T.dim} 2xl:inline`}>
            {ocrEngine === 'nemotron' ? 'NVIDIA nemotron-ocr-v2 · hosted' : 'tesseract.js · English · on-device'} · pages run one after another · lossy, review the text
          </span>
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
            immersive ? 'fixed inset-0 z-50 rounded-none border-0' : panelOpen && numPages > 0 ? 'lg:col-span-7' : 'lg:col-span-12'
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
              {immersive && numPages > 0 && (
                <div className={`mr-2 flex items-center gap-1 rounded-lg border px-1.5 py-1 ${T.input}`}>
                  <button onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} className="p-0.5 disabled:opacity-30" title="Previous page">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[52px] text-center font-mono text-[11px]">{currentPage} / {numPages}</span>
                  <button onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-0.5 disabled:opacity-30" title="Next page">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <span className="mx-1 h-3.5 w-px bg-slate-300" />
                  <button onClick={() => { setFitWidth(false); setScale((s) => Math.max(0.25, +(s - 0.2).toFixed(2))); }} title="Zoom out">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-10 text-center font-mono text-[10px]">{Math.round(scale * 100)}%</span>
                  <button onClick={() => { setFitWidth(false); setScale((s) => Math.min(4, +(s + 0.2).toFixed(2))); }} title="Zoom in">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setFitWidth(true)} title="Fit width" className={`ml-0.5 ${fitWidth ? T.accent : T.dim}`}>
                    <Maximize className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <button
                onClick={() => setShowThumbs((v) => !v)}
                title="Page thumbnails"
                className={`rounded-lg border p-1.5 transition ${showThumbs ? T.chipAccent : `${T.chip} ${T.softHover}`}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowNotes((v) => !v)}
                title={panelOpen ? 'Hide side panel' : 'Show side panel'}
                className={`hidden rounded-lg border p-1.5 transition lg:block ${panelOpen ? T.chipAccent : `${T.chip} ${T.softHover}`}`}
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={toggleFullscreen}
                title={immersive ? 'Exit full screen (Esc)' : 'Full screen reader'}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition ${immersive ? T.cta : `${T.chip} ${T.softHover}`}`}
              >
                {immersive ? <><X className="h-3.5 w-3.5" /> Exit full screen</> : <Maximize className="h-3.5 w-3.5" />}
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
              className={`h-full overflow-auto ${immersive ? 'bg-slate-800' : T.reader}`}
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
                          <span className={`absolute left-1.5 top-1.5 z-10 rounded px-1 font-mono text-[8px] font-bold ${T.chipAccent}`}>OCR · review</span>
                        )}
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
                                  textDecoration: word.confidence < 60 ? 'underline dashed #f59e0b' : undefined,
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
                <button
                  onClick={() => {
                    setAskDialog({ text: popup.text, label: `selection (p. ${currentPageRef.current})` });
                    setAskDialogPrompt('');
                    setPopup(null);
                  }}
                  title="Ask AI about this selection"
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[#00696b] hover:bg-teal-50"
                >Ask AI</button>
                <button onClick={() => askSelection(EXPLAIN_PROMPT)} title="Explain this selection" className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[#00696b] hover:bg-teal-50">Explain</button>
                <button onClick={() => askSelection(NOTES_PROMPT, true)} title="Make an AI note and save it to Highlights" className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[#00696b] hover:bg-teal-50">AI notes</button>
                <div className="mx-0.5 h-4 w-px bg-slate-200" />
                <button onClick={copySelection} className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Copy">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setPopup(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-3 w-3" /></button>
              </div>
            )}
            {askDialog && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
                onClick={closeAskDialog}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Ask AI about the selected text"
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-bold text-slate-900">Ask AI about the selected text</div>
                      <div className="text-[10px] text-slate-500">{askDialog.label}</div>
                    </div>
                    <button onClick={closeAskDialog} className="rounded p-1 text-slate-400 hover:bg-slate-100" title="Close">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <blockquote className="mb-3 max-h-24 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-700">
                    {askDialog.text.length > 400 ? `${askDialog.text.slice(0, 400)}…` : askDialog.text}
                  </blockquote>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {ASK_DIALOG_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => sendAskDialog(opt.prompt)}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${T.chip} hover:border-[#0f8b8d]/40 hover:bg-teal-50 hover:text-[#00696b]`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-500" htmlFor="ask-dialog-text">
                    Or tell me what to do with this text
                  </label>
                  <textarea
                    id="ask-dialog-text"
                    value={askDialogPrompt}
                    onChange={(e) => setAskDialogPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendAskDialog(askDialogPrompt);
                    }}
                    rows={3}
                    placeholder="For example: compare this with glycolysis, or list the exceptions"
                    className={`w-full resize-none rounded-lg border px-2.5 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/30 ${T.input}`}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400">Ctrl+Enter to send</span>
                    <button
                      onClick={() => sendAskDialog(askDialogPrompt)}
                      disabled={!askDialogPrompt.trim()}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-40 ${T.cta}`}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            )}
            {ocrBusy && ocrTask && (
              <div className={`absolute bottom-3 right-3 z-30 w-64 rounded-xl border bg-white p-2.5 text-[10px] shadow-xl ${T.border}`}>
                <div className={`mb-1.5 flex items-center justify-between font-bold ${T.strong}`}>
                  <span className="flex items-center gap-1.5"><Loader2 className={`h-3 w-3 animate-spin ${T.accent}`} /> OCR</span>
                  <span className={`font-mono ${T.accent}`}>{ocrTask.done}/{ocrTask.total}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-[#0f8b8d] transition-all" style={{ width: `${Math.round((ocrTask.done / Math.max(1, ocrTask.total)) * 100)}%` }} />
                </div>
                <p className={`mt-1.5 truncate ${T.dim}`}>{ocrTask.detail} · one page at a time</p>
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
            <header className={`flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5 ${T.divider}`}>
              <div className="flex items-center gap-1">
                {([
                  { id: 'copilot', label: 'Copilot' },
                  { id: 'highlights', label: `Highlights · ${highlights.length}` },
                  { id: 'notes', label: 'Notes' },
                  { id: 'index', label: 'Index' },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setRightTab(tab.id)}
                    className={`rounded-lg px-2.5 py-1 text-[10px] font-bold transition ${rightTab === tab.id ? T.chipAccent : `${T.muted} ${T.softHover}`}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowNotes(false)} className={`${T.dim} hover:opacity-70`} title="Hide side panel">
                <X className="h-3.5 w-3.5" />
              </button>
            </header>

            {rightTab === 'highlights' && (
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
            )}

            {rightTab === 'notes' && (
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5 text-xs">
                <div className="flex flex-wrap items-end gap-2">
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
                    onClick={() => makeNotesFromPages()}
                    disabled={notesBusy}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.cta}`}
                  >
                    {notesBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <NotebookPen className="h-3 w-3" />}
                    {notesBusy ? 'Making notes…' : 'Generate notes'}
                  </button>
                  {notesBusy && (
                    <button
                      onClick={() => { notesCancelRef.current = true; }}
                      className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
                    >
                      <Square className="h-3 w-3" /> Stop
                    </button>
                  )}
                </div>
                {madeNotes.length > 0 && (
                  <button
                    onClick={() => downloadNotesPdf(
                      `${activeDoc?.title ?? 'Book'} — page notes`,
                      madeNotes.map((n) => `${n.range}\n${webCheckToText(n.webCheck)}\n\n${teachingNoteToText(n.note)}`).join('\n\n\n'),
                    )}
                    className={`mt-2 flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${T.chip}`}
                  >
                    <FileDown className="h-3 w-3" /> Download all notes (PDF)
                  </button>
                )}
                {notesError && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{notesError}</span>
                  </div>
                )}
                <div className="mt-3 space-y-4">
                  {madeNotes.map((n, i) => (
                    <StructuredNote key={`${n.range}-${i}`} note={n.note} range={n.range} readImages={n.readImages} onOpenPage={gotoPage} onDelete={() => deleteNote(n.id)} webCheck={n.webCheck} checking={checkingNotes.has(n.id)} onWebCheck={() => { if (activeDocId) void checkNoteOnWeb(activeDocId, n); }} renderPage={renderNotePage} />
                  ))}
                  {!madeNotes.length && !notesBusy && (
                    <p className={`text-[10px] leading-relaxed ${T.dim}`}>
                      Pick a page range, or press Notes on a chapter in the Index tab.
                    </p>
                  )}
                </div>
              </div>
            )}

            {rightTab === 'index' && (() => {
              const field = `rounded-lg border px-2.5 py-1.5 text-[11px] focus:outline-none ${T.input}`;
              const addPage = Math.round(Number(newEntry.page));
              const canAdd = !!activeDocId && addPage >= 1 && addPage <= numPages;
              const tree = contentTree(bookContents);
              const pct = scanning && scanning.total ? Math.round((scanning.done / scanning.total) * 100) : 0;
              const styleOf: Record<ContentLevel, string> = {
                unit: 'font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#00696b]',
                chapter: `text-[13px] font-bold ${T.strong}`,
                section: `text-[12px] font-semibold ${T.text}`,
                topic: `text-[11px] ${T.muted}`,
              };
              const pageChip = (e: ContentEntry) => (
                <button
                  onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); gotoPage(e.page); }}
                  className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 transition hover:border-[#0f8b8d]/40 hover:bg-teal-50 hover:text-[#00696b]"
                >
                  {e.page}
                </button>
              );
              const removeButton = (e: ContentEntry) => (
                <button
                  onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); removeEntry(e.id); }}
                  title="Remove"
                  className={`shrink-0 text-[14px] leading-none opacity-0 transition group-hover:opacity-100 ${T.dim} hover:text-rose-500`}
                >
                  ×
                </button>
              );
              // The page range a contents entry covers: from its start to the page before the next entry at
              // the same level or above (or the end of the book).
              const endPageOf = (e: ContentEntry) => {
                const sorted = sortContents(bookContents);
                const i = sorted.findIndex((x) => x.id === e.id);
                const next = sorted.slice(i + 1).find((x) => LEVEL_ORDER[x.level] <= LEVEL_ORDER[e.level] && x.page > e.page);
                return next ? next.page - 1 : numPages;
              };
              const notesButton = (e: ContentEntry) => (
                <button
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const to = endPageOf(e);
                    setRightTab('notes');
                    setShowNotes(true);
                    // Fill the panel's From/To too, so Generate notes afterwards covers the same pages.
                    setNotesFrom(e.page);
                    setNotesTo(to);
                    void makeNotesFromPages({ from: e.page, to, label: e.title });
                  }}
                  disabled={notesBusy}
                  title={`Make notes from ${LEVEL_LABEL[e.level].toLowerCase()} "${e.title}"`}
                  className={`flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition disabled:opacity-40 ${T.chip} hover:border-[#0f8b8d]/40 hover:bg-teal-50 hover:text-[#00696b]`}
                >
                  <NotebookPen className="h-3 w-3" /> Notes
                </button>
              );
              // A parent with children is a dropdown; a leaf is a plain line that opens its page.
              const renderNode = (node: ContentNode): React.ReactNode => {
                const { entry: e, children } = node;
                if (!children.length) {
                  return (
                    <li key={e.id} className="group flex items-center gap-2 py-1">
                      <button onClick={() => gotoPage(e.page)} className={`min-w-0 flex-1 truncate text-left hover:underline ${styleOf[e.level]}`}>
                        {e.title}
                      </button>
                      {pageChip(e)}
                      {notesButton(e)}
                      {removeButton(e)}
                    </li>
                  );
                }
                return (
                  <li key={e.id} className="group">
                    <details open={e.level === 'unit' || e.level === 'chapter'} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-2 py-1">
                        <span className={`text-[9px] text-slate-400 transition-transform group-open:rotate-90 ${T.dim}`}>▶</span>
                        <span className={`min-w-0 flex-1 truncate ${styleOf[e.level]}`}>{e.title}</span>
                        <span className={`shrink-0 font-mono text-[9px] ${T.dim}`}>{children.length}</span>
                        {pageChip(e)}
                        {notesButton(e)}
                        {removeButton(e)}
                      </summary>
                      <ul className="ml-2 mt-0.5 space-y-0.5 border-l border-slate-200 pl-3">{children.map(renderNode)}</ul>
                    </details>
                  </li>
                );
              };
              const flatten = (nodes: ContentNode[], depth = 0): string[] =>
                nodes.flatMap((n) => [
                  `${'    '.repeat(depth)}${n.entry.level === 'unit' ? n.entry.title.toUpperCase() : n.entry.title} ..... ${n.entry.page}`,
                  ...flatten(n.children, depth + 1),
                ]);
              return (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className={`shrink-0 space-y-2.5 border-b p-2.5 ${T.divider}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={buildIndexFromBook}
                        disabled={!!scanning || !pdfRef.current}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.cta}`}
                      >
                        {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListTree className="h-3 w-3" />}
                        {scanning ? `Scanning ${scanning.done}/${scanning.total}` : 'Scan whole book'}
                      </button>
                      <button
                        onClick={importFromBookmarks}
                        disabled={!!scanning || !pdfRef.current}
                        className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.chip}`}
                      >
                        Import from bookmarks
                      </button>
                      {tree.length > 0 && (
                        <button
                          onClick={() => downloadNotesPdf(`${activeDoc?.title ?? 'Book'} — contents`, flatten(tree).join('\n'))}
                          className={`ml-auto flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold ${T.chip}`}
                        >
                          <FileDown className="h-3 w-3" /> Download contents
                        </button>
                      )}
                    </div>
                    {scanning && (
                      <div className="h-1 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full bg-[#0f8b8d] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {contentsNote && <p className={`text-[10px] leading-relaxed ${T.muted}`}>{contentsNote}</p>}
                    <div className="grid grid-cols-[96px_1fr_64px] gap-1.5">
                      <select
                        value={newEntry.level}
                        onChange={(e) => setNewEntry((n) => ({ ...n, level: e.target.value as ContentLevel }))}
                        className={field}
                      >
                        <option value="unit">Unit</option>
                        <option value="chapter">Chapter</option>
                        <option value="section">Section</option>
                        <option value="topic">Topic</option>
                      </select>
                      <input
                        value={newEntry.title}
                        onChange={(e) => setNewEntry((n) => ({ ...n, title: e.target.value }))}
                        placeholder="Title"
                        className={`min-w-0 ${field}`}
                      />
                      <input
                        type="number"
                        min={1}
                        max={numPages}
                        value={newEntry.page}
                        onChange={(e) => setNewEntry((n) => ({ ...n, page: e.target.value }))}
                        placeholder="Page"
                        className={field}
                      />
                    </div>
                    <button
                      onClick={() => {
                        addEntry(newEntry.level, newEntry.title, addPage);
                        setNewEntry((n) => ({ ...n, title: '', page: '' }));
                      }}
                      disabled={!canAdd}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${T.cta}`}
                    >
                      Add to contents
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    {!tree.length && (
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50">
                          <ListTree className="h-6 w-6 text-[#00696b]" />
                        </div>
                        <p className={`text-[12px] font-bold ${T.strong}`}>No contents yet</p>
                        <p className={`max-w-[240px] text-[11px] leading-relaxed ${T.muted}`}>
                          Press Scan whole book. It reads every page and builds units, chapters, sections and topics as dropdowns.
                        </p>
                      </div>
                    )}
                    {tree.length > 0 && (
                      <div className="mb-3 text-center">
                        <p className={`font-mono text-[9px] uppercase tracking-[0.25em] ${T.dim}`}>Contents</p>
                        <p className={`mt-0.5 text-[13px] font-bold ${T.strong}`}>{activeDoc?.title}</p>
                      </div>
                    )}
                    <ol className="space-y-1">{tree.map(renderNode)}</ol>
                  </div>
                </div>
              );
            })()}

            {rightTab === 'copilot' && (
            <div className="flex min-h-0 flex-1 flex-col">
            {/* ======================= Question Bank ======================= */}
            {mcqs.length > 0 && (
          <section className={`flex h-56 shrink-0 flex-col overflow-hidden border-b ${T.divider}`}>
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

        {/* ======================= Clinical copilot ======================= */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pt-1.5">
                <button
                  onClick={() => askAi('Teach me this passage from the beginning, as if I have never seen it before.')}
                  disabled={askBusy}
                  title="Teach this passage step by step"
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition disabled:opacity-40 ${T.chip} ${T.softHover}`}
                >
                  Teach me
                </button>
                <button
                  onClick={() => askAi('What must I remember from this passage for the exam, and why does each point matter? Teach each one briefly.')}
                  disabled={askBusy}
                  title="Exam takeaways, with the reason for each"
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
                        setAskInput('');
                        askAi(question);
                      }
                    }}
                    placeholder={`Ask copilot about page ${currentPage}…`}
                    rows={1}
                    className="max-h-14 min-h-[22px] flex-1 resize-none bg-transparent px-1 py-0.5 text-[10px] focus:outline-none"
                  />
                  <button
                    onClick={() => voice.toggle()}
                    title={voice.recording ? 'Stop recording and transcribe' : 'Speak your question (transcribed on this device)'}
                    aria-pressed={voice.recording}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${
                      voice.recording ? 'bg-rose-600 text-white hover:bg-rose-700' : `${T.chip} hover:border-[#0f8b8d]/40`
                    }`}
                  >
                    {voice.recording ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => {
                      const question = askInput.trim();
                      if (!question || askBusy) return;
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
                {voiceStatus && (
                  <p className={`mt-1 px-1 text-[10px] ${voice.recording ? 'text-rose-700' : T.muted}`}>{voiceStatus}</p>
                )}
              </div>
            </div>
          </div>
            )}
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
