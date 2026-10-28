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
  Type as TypeIcon
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
}

const MAX_RENDERED = 24; // LRU bound for rendered pages
const HL_COLORS: { id: string; css: string; label: string }[] = [
  { id: 'yellow', css: '#fde047', label: 'Yellow' },
  { id: 'green', css: '#86efac', label: 'Green' },
  { id: 'pink', css: '#f9a8d4', label: 'Pink' },
  { id: 'blue', css: '#93c5fd', label: 'Blue' },
];

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

export const PDFReaderView: React.FC<PDFReaderViewProps> = ({ onNavigate, onGenerateQuizFromPage }) => {
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
    const contextText = (askContext || (await ensurePageText(currentPageRef.current).catch(() => ''))).trim();
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
    } catch (err: any) {
      setAskError(err?.message || 'MCQ generation failed.');
    } finally {
      setMcqBusy(false);
    }
  };

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

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col max-w-7xl mx-auto w-full px-2">
      {/* Top toolbar */}
      <div className="bg-[#001432] rounded-2xl mt-2 px-3 py-2 text-white border border-[#13294b] shadow-md flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-xs font-bold flex items-center gap-1.5"
        >
          <UploadCloud className="w-3.5 h-3.5" /> Open PDF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          className="hidden"
          onChange={(e) => { handleImportFiles(e.target.files); e.target.value = ''; }}
        />

        <select
          value={activeDocId ?? ''}
          onChange={(e) => { if (e.target.value) openDoc(e.target.value); }}
          className="bg-slate-800/80 border border-slate-700 text-[11px] font-semibold text-white rounded-lg px-2 py-1.5 max-w-[220px] focus:outline-none"
        >
          <option value="">{docs.length ? 'Choose a document…' : 'No documents yet'}</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>{d.title} ({d.numPages}p)</option>
          ))}
        </select>

        {numPages > 0 && (
          <>
            <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-1">
              <button onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} className="p-0.5 disabled:opacity-30 hover:text-[#8ff3f4]">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                value={currentPage}
                onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setCurrentPage(n); }}
                onKeyDown={(e) => { if (e.key === 'Enter') gotoPage(currentPage); }}
                className="w-9 bg-transparent text-center text-xs font-mono focus:outline-none"
              />
              <span className="text-[11px] text-slate-400">/ {numPages}</span>
              <button onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-0.5 disabled:opacity-30 hover:text-[#8ff3f4]">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700 rounded-lg px-1.5 py-1">
              <button onClick={() => setFitWidth(!fitWidth)} title="Fit width" className={`p-1 rounded hover:bg-slate-700 ${fitWidth ? 'text-[#8ff3f4]' : 'text-slate-400'}`}>
                <Maximize className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setFitWidth(false); setScale((s) => Math.max(0.25, +(s - 0.2).toFixed(2))); }} className="p-1 rounded hover:bg-slate-700">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] font-mono w-11 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => { setFitWidth(false); setScale((s) => Math.min(4, +(s + 0.2).toFixed(2))); }} className="p-1 rounded hover:bg-slate-700">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Search across all pages (on-demand index) */}
            <div className="flex items-center gap-1 bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-1 flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                placeholder="Search whole book…"
                className="flex-1 min-w-0 bg-transparent text-xs placeholder-slate-500 focus:outline-none"
              />
              {indexing.busy ? (
                <button onClick={stopSearch} className="text-[11px] text-amber-300 flex items-center gap-1 shrink-0" title="Stop indexing">
                  <Loader2 className="w-3 h-3 animate-spin" /> {indexing.done}/{numPages}
                </button>
              ) : matches.length > 0 ? (
                <button onClick={() => moveMatch(1)} className="text-[11px] font-mono text-[#8ff3f4] shrink-0">
                  {matchIndex + 1}/{matches.length}
                </button>
              ) : matches.length === 0 && matchIndex === -1 && !indexing.busy ? null : null}
              <button onClick={() => moveMatch(-1)} disabled={!matches.length} className="p-0.5 disabled:opacity-30 hover:text-[#8ff3f4]" title="Previous match">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => moveMatch(1)} disabled={!matches.length} className="p-0.5 disabled:opacity-30 hover:text-[#8ff3f4]" title="Next match">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <button onClick={printDocument} title="Print" className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300">
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button onClick={downloadDocument} title="Download original file" className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300">
              <UploadCloud className="w-3.5 h-3.5 rotate-180" />
            </button>
            <button
              onClick={() => {
                if (activeDoc?.fileType === 'docx') return;
                if (viewMode === 'text') {
                  // Returning to page view: the wrappers remount and setPageWrapRef re-renders
                  // them, but only if the bookkeeping no longer claims they are rendered.
                  clearRenderedPages();
                  setViewMode('page');
                } else {
                  setViewMode('text');
                }
                setPopup(null);
              }}
              disabled={activeDoc?.fileType === 'docx'}
              title={activeDoc?.fileType === 'docx' ? 'DOCX documents are shown as extracted text' : viewMode === 'page' ? 'Extracted-text view' : 'Page view'}
              className={`p-1.5 rounded-lg hover:bg-slate-700 flex items-center gap-1 text-[10px] font-bold disabled:opacity-40 ${viewMode === 'text' ? 'text-[#8ff3f4] bg-slate-700/50' : 'text-slate-300'}`}
            >
              <TypeIcon className="w-3.5 h-3.5" /> {viewMode === 'page' ? 'Text' : 'Page'}
            </button>
            <button
              onClick={() => setOcrOpen((v) => !v)}
              title="Read pages with OCR"
              className={`p-1.5 rounded-lg hover:bg-slate-700 flex items-center gap-1 text-[10px] font-bold ${ocrOpen ? 'text-[#8ff3f4] bg-slate-700/50' : 'text-slate-300'}`}
            >
              <ScanText className="w-3.5 h-3.5" /> OCR
            </button>
            <button
              onClick={() => setNotesOpen((v) => !v)}
              title="Make revision notes from a page range"
              className={`p-1.5 rounded-lg hover:bg-slate-700 flex items-center gap-1 text-[10px] font-bold ${notesOpen ? 'text-[#8ff3f4] bg-slate-700/50' : 'text-slate-300'}`}
            >
              <NotebookPen className="w-3.5 h-3.5" /> Page notes
            </button>
            <button
              onClick={() => { setFitWidth(false); setScale(fitPageScale()); }}
              title="Fit whole page"
              className={`p-1.5 rounded-lg text-xs font-bold ${fitWidth ? 'text-slate-400 hover:bg-slate-700' : 'text-[#8ff3f4] bg-slate-700/50'}`}
            >
              Fit page
            </button>
            <button onClick={() => setShowLibrary(!showLibrary)} title="Toggle sidebar" className={`p-1.5 rounded-lg hover:bg-slate-700 ${showLibrary ? 'text-[#8ff3f4]' : 'text-slate-400'}`}>
              <ListTree className="w-3.5 h-3.5" />
            </button>
            <button onClick={toggleFullscreen} title="Full screen" className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300">
              <Maximize className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => openAskPanel('page')} title="Ask AI about this page" className="px-2 py-1.5 rounded-lg bg-[#0f8b8d]/40 border border-[#0f8b8d]/40 text-xs font-bold flex items-center gap-1.5 hover:bg-[#0f8b8d]/60">
              <Sparkles className="w-3.5 h-3.5 text-[#8ff3f4]" /> Ask AI
            </button>
            <button onClick={() => setShowNotes(!showNotes)} title="Notes & highlights" className={`p-1.5 rounded-lg hover:bg-slate-700 ${showNotes ? 'text-[#8ff3f4]' : 'text-slate-400'}`}>
              <ListTree className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* OCR panel (real tesseract.js; Force OCR checkbox from section 14) */}
      {ocrOpen && numPages > 0 && (
        <div className="mt-2 p-3 bg-white rounded-xl border border-slate-200 shadow-sm text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <ScanText className="w-4 h-4 text-[#0f8b8d]" /> OCR this book
              <span className="font-mono text-[10px] text-slate-400">tesseract.js · English</span>
            </span>
            <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={ocrForce}
                onChange={(e) => setOcrForce(e.target.checked)}
                className="accent-[#0f8b8d]"
              />
              Force OCR even when a page already has text
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runOcr('current')}
              disabled={ocrBusy || !pdfRef.current}
              className="px-2.5 py-1.5 rounded-lg bg-[#001432] text-white text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
            >
              {ocrBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanText className="w-3 h-3 text-[#8ff3f4]" />}
              OCR current page ({currentPage})
            </button>
            <button
              onClick={() => runOcr('missing')}
              disabled={ocrBusy || !pdfRef.current}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
            >
              <FileDown className="w-3 h-3" /> OCR pages without text
            </button>
            {ocrBusy && (
              <button
                onClick={() => {
                  if (ocrJobRef.current) stopJob(ocrJobRef.current.id);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold flex items-center gap-1"
              >
                <Square className="w-3 h-3" /> Stop OCR
              </button>
            )}
            <button onClick={() => setOcrOpen(false)} className="ml-auto text-slate-400 hover:text-slate-600" title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            OCR is lossy — review recognised text before relying on it. The first run downloads tesseract language data.
            Recognised text is saved to this book's page cache and used by search and Ask AI.
          </p>
          {ocrNote && (
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-700">{ocrNote}</div>
          )}
          {!pdfRef.current && (
            <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              OCR needs a PDF document. DOCX imports already contain real extracted text.
            </div>
          )}
        </div>
      )}

      {/* Make notes from pages panel */}
      {notesOpen && numPages > 0 && (
        <div className="mt-2 p-3 bg-white rounded-xl border border-slate-200 shadow-sm text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <NotebookPen className="w-4 h-4 text-[#0f8b8d]" /> Make revision notes from pages
            </span>
            <button onClick={() => setNotesOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-semibold text-slate-600">
              From page
              <input type="number" min={1} max={numPages} value={notesFrom}
                onChange={(e) => setNotesFrom(Number(e.target.value))}
                className="block w-20 mt-0.5 px-2 py-1 rounded-lg border border-slate-200 text-[11px]" />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">
              To page
              <input type="number" min={1} max={numPages} value={notesTo}
                onChange={(e) => setNotesTo(Number(e.target.value))}
                className="block w-20 mt-0.5 px-2 py-1 rounded-lg border border-slate-200 text-[11px]" />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">
              Pages per part
              <input type="number" min={1} max={20} value={notesPartSize}
                onChange={(e) => setNotesPartSize(Number(e.target.value))}
                className="block w-20 mt-0.5 px-2 py-1 rounded-lg border border-slate-200 text-[11px]" />
            </label>
            <button
              onClick={makeNotesFromPages}
              disabled={notesBusy}
              className="px-3 py-1.5 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-white text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
            >
              {notesBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {notesBusy ? 'Generating…' : 'Generate in parts'}
            </button>
            {notesBusy && (
              <button
                onClick={() => { notesCancelRef.current = true; }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold flex items-center gap-1"
              >
                <Square className="w-3 h-3" /> Stop (keeps saved parts)
              </button>
            )}
            {madeNotes.length > 0 && (
              <button
                onClick={() => downloadNotesPdf(
                  `${docs.find((d) => d.id === activeDocId)?.title ?? 'Book'} — page notes`,
                  madeNotes.map((n) => `## ${n.range}\n\n${n.text}`).join('\n\n'),
                  getActiveProvider() ? `${getActiveProvider()} · ${getEffectiveModel(getActiveProvider()!)}` : undefined,
                )}
                className="ml-auto px-2.5 py-1.5 rounded-lg bg-[#001432] text-white text-[10px] font-bold flex items-center gap-1"
              >
                <FileDown className="w-3 h-3 text-[#8ff3f4]" /> Download all notes (PDF)
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Each part is written by your active AI provider from the book text, saved to your highlights immediately, and
            kept even if you press Stop. Page citations open the reader.
          </p>
          {notesError && (
            <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-800 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{notesError}</span>
            </div>
          )}
          {madeNotes.length > 0 && (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {madeNotes.map((n, i) => (
                <div key={`${n.range}-${i}`} className="p-2 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="text-[9px] font-mono font-bold text-slate-500 mb-1">{n.range}</div>
                  <RevisionNote text={n.text} topic={docs.find((d) => d.id === activeDocId)?.title} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Library / doc errors */}
      {(libraryError || docOpenError) && (
        <div className="mt-2 p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="flex-1">{libraryError || docOpenError}</span>
          <button onClick={() => { setLibraryError(null); setDocOpenError(null); }}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 min-h-0 flex gap-2 mt-2 pb-2 relative">
        {/* Left: library list + thumbnails */}
        <div className={`${showLibrary ? 'hidden md:flex' : 'hidden'} flex-col w-44 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm`}>
          <div className="p-2 border-b border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-1 pb-1 flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Library
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1">
              {docs.map((d) => (
                <div
                  key={d.id}
                  onClick={() => openDoc(d.id)}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-[11px] cursor-pointer ${
                    d.id === activeDocId ? 'bg-teal-50 text-[#00696b] font-semibold border border-[#0f8b8d]/30' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span className="truncate">{d.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteDoc(d.id); }}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 shrink-0"
                    title="Delete from library"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {!docs.length && <div className="text-[10px] text-slate-400 px-2 py-1">Import with “Open file”</div>}
            </div>
            {activeDoc && (
              <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-1 text-[10px]">
                <button
                  onClick={editSubject}
                  className="truncate font-semibold text-[#00696b] hover:underline"
                  title="Edit the subject for this book"
                >
                  {activeDoc.subject || 'Uncategorised'}
                </button>
                <button
                  onClick={classifyWithAi}
                  className="shrink-0 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold"
                  title="Classify this book's subject with your active AI"
                >
                  AI
                </button>
              </div>
            )}
          </div>
          {/* Thumbnails (lazy render) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2" data-thumb-scroll>
            {numPages > 0 && activeDoc?.fileType === 'docx' && Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => gotoPage(n)}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-mono ${
                  n === currentPage ? 'bg-teal-50 text-[#00696b] border border-[#0f8b8d]/30 font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                Page {n}
              </button>
            ))}
            {numPages > 0 && activeDoc?.fileType !== 'docx' && Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <Thumb
                key={n}
                num={n}
                active={n === currentPage}
                scaleHint={fitScale()}
                pdfRef={pdfRef}
                onClick={() => gotoPage(n)}
              />
            ))}
            {!numPages && (
              <div className="h-full flex flex-col items-center justify-center text-center p-3">
                {loadingDoc ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#0f8b8d]" />
                ) : (
                  <>
                    <FileText className="w-6 h-6 text-slate-300 mb-1" />
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Open a PDF to start reading. Files stay on this machine (IndexedDB).
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: continuous scroll viewer */}
        <div
          ref={scrollRef}
          onPointerDown={handlePointerDown}
          onMouseUp={handleMouseUp}
          className={`flex-1 min-w-0 bg-slate-300/70 overflow-y-auto overflow-x-auto ${
            // `relative` must NOT be present while immersive: Tailwind emits .fixed before
            // .relative, so both classes together resolve to relative and the viewer never
            // actually goes full screen.
            immersive ? 'fixed inset-0 z-50 rounded-none border-0' : 'relative rounded-2xl border border-slate-300'
          }`}
          style={{ scrollbarGutter: 'stable' }}
        >
          {immersive && (
            <button
              onClick={() => setImmersive(false)}
              title="Exit full screen"
              className="fixed top-3 right-3 z-[60] px-3 py-1.5 rounded-lg bg-slate-900/85 text-white text-xs font-bold flex items-center gap-1.5 hover:bg-slate-900 shadow-lg"
            >
              <X className="w-3.5 h-3.5" /> Exit full screen
            </button>
          )}
          {loadingDoc && (
            <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#0f8b8d]" />
            </div>
          )}
          {viewMode === 'text' && numPages > 0 ? (
            <div className="h-full overflow-y-auto bg-white">
              <div className="max-w-3xl mx-auto p-5">
                <div className="sticky top-0 bg-white/95 backdrop-blur pb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 mb-3">
                  <span className="text-[11px] font-bold text-slate-700">
                    Extracted text · page {textView.page} / {numPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => gotoPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="p-1 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => gotoPage(currentPage + 1)}
                      disabled={currentPage >= numPages}
                      className="p-1 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {textView.loading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-[#0f8b8d]" /> Extracting page text…
                  </div>
                ) : (
                  <div className="text-[12px] leading-relaxed text-slate-800 whitespace-pre-wrap">
                    {textView.text || 'No extractable text on this page. Run OCR from the toolbar to read a scanned page.'}
                  </div>
                )}
                <p className="mt-6 pt-3 border-t border-slate-100 text-[10px] text-slate-400">
                  Extracted text comes from the document itself or from a real OCR run — it is never invented.
                </p>
              </div>
            </div>
          ) : pdfRef.current && numPages > 0 ? (
            <div
              className="py-4 px-2 flex flex-col items-center gap-4"
              style={{
                // pdf.js 5.7 sizes text-layer spans with --total-scale-factor, which its CSS only
                // defines inside `.pdfViewer .page`. Outside that selector the calc() is invalid
                // and every span falls back to a default size — that is what made selections
                // balloon past the words. Define both properties for our standalone layer.
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
                    className="relative bg-white shadow-md border border-slate-300 rounded-sm overflow-hidden"
                    style={{ width: w, height: h, containerType: 'size' }}
                  >
                    {/* canvas slot */}
                    <div data-canvas-slot className="absolute inset-0 pointer-events-none" />
                    {/* text layer slot (pdf.js TextLayer fills it) */}
                    <div data-text-slot className="textLayer absolute inset-0 overflow-hidden" />
                    {/* OCR text layer — invisible selectable text over the scan (Acrobat's model).
                        Percentages + cqh keep it aligned at any zoom; scaleX fits each word to its box. */}
                    {ocrWordsRef.current.has(n) && !nativeTextPagesRef.current.has(n) && (
                      <div className="ocrTextLayer absolute inset-0 overflow-hidden select-text" style={{ zIndex: 2 }}>
                        {ocrWordsRef.current.get(n)!.map((w, i) => (
                          <span
                            key={i}
                            className="absolute select-text"
                            style={{
                              left: `${w.bbox.x0 * 100}%`,
                              top: `${w.bbox.y0 * 100}%`,
                              width: `${(w.bbox.x1 - w.bbox.x0) * 100}%`,
                              height: `${(w.bbox.y1 - w.bbox.y0) * 100}%`,
                              fontSize: `${(w.bbox.y1 - w.bbox.y0) * 100}cqh`,
                              lineHeight: `${(w.bbox.y1 - w.bbox.y0) * 100}cqh`,
                              transform: `scaleX(${w.sx ?? 1})`,
                              transformOrigin: 'left top',
                              whiteSpace: 'pre',
                              color: 'transparent',
                              userSelect: 'text',
                              cursor: 'text',
                            }}
                          >
                            {w.text + ' '}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* saved highlight overlay (normalised rects, so it scales with zoom) */}
                    {highlights
                      .filter((h) => h.page === n && h.rects && h.rects.length > 0)
                      .map((h) =>
                        (h.rects ?? []).map((r, ri) => (
                          <div
                            key={`${h.id}-${ri}`}
                            title={h.quote.slice(0, 160)}
                            className="absolute rounded-[1px] mix-blend-multiply pointer-events-none"
                            style={{
                              left: `${r.x * 100}%`,
                              top: `${r.y * 100}%`,
                              width: `${r.w * 100}%`,
                              height: `${r.h * 100}%`,
                              background: HL_COLORS.find((c) => c.id === h.color)?.css ?? '#fde047',
                              opacity: 0.42,
                              pointerEvents: 'none',
                              zIndex: 3,
                            }}
                          />
                        )),
                      )}
                    {/* page number plate */}
                    <div className="absolute bottom-1 right-2 text-[9px] text-slate-400 font-mono select-none z-10 bg-white/70 px-1 rounded">
                      {n}
                    </div>
                    {/* render error */}
                    {pageErrors[n] && (
                      <div className="absolute inset-0 flex items-center justify-center p-4 bg-rose-50/90 text-xs text-rose-700 text-center z-10">
                        <span>{pageErrors[n]}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            !loadingDoc && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                  <BookOpen className="w-7 h-7 text-slate-300" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Real PDF reader</h3>
                <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
                  Import your books with <strong>Open PDF</strong>. Pages render on demand while you scroll (fast even for
                  1,500-page texts), text is selectable, highlights &amp; notes are saved, and search covers the entire book.
                </p>
              </div>
            )
          )}
        </div>

        {/* Floating selection popup (positioned relative to the viewer row) */}
        {popup && (
          <div
            className="absolute z-30 bg-white border border-slate-200 shadow-xl rounded-xl px-2 py-1.5 flex items-center gap-1"
            style={{ left: popup.x, top: popup.y }}
          >
            {HL_COLORS.map((c) => (
              <button
                key={c.id}
                onClick={() => saveSelectionHighlight(c.id)}
                title={`Highlight ${c.label}`}
                className="w-5 h-5 rounded-full border border-slate-300 hover:scale-110 transition-transform"
                style={{ background: c.css }}
              />
            ))}
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button onClick={copySelection} className="p-1 rounded hover:bg-slate-100 text-slate-500" title="Copy">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => openAskPanel('selection')} className="px-2 py-1 rounded-lg bg-[#001432] text-white text-[10px] font-bold flex items-center gap-1" title="Ask AI about this selection">
              <Sparkles className="w-3 h-3 text-[#8ff3f4]" /> Ask AI
            </button>
            <button onClick={() => setPopup(null)} className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* Right: notes/highlights + Ask AI */}
        {showNotes && (
          <div className="hidden lg:flex flex-col w-80 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-3 border-b border-slate-100 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5 text-amber-500" /> Highlights &amp; notes
              </div>
              <button onClick={() => setShowNotes(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
            </div>

            {/* Ask AI panel — context-first assistant rail */}
            <div className="border-b border-slate-100 bg-gradient-to-br from-white to-teal-50/50 p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-[#001432] flex items-center justify-center shrink-0 shadow-xs">
                    <Sparkles className="w-3.5 h-3.5 text-[#8ff3f4]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-900 leading-tight">Ask AI</div>
                    <div className="text-[9px] text-slate-500 truncate">
                      <span className="capitalize">{askContextLabel}</span> · grounded in this passage
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {activeAskProvider ? (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-white border border-teal-200 text-[#00696b] max-w-[96px] truncate"
                      title={providerLabel}
                    >
                      {activeAskProvider} · {getEffectiveModel(activeAskProvider)}
                    </span>
                  ) : (
                    <button
                      onClick={() => onNavigate('settings')}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800"
                    >
                      Connect AI
                    </button>
                  )}
                  <button
                    onClick={() => setAskPanel(false)}
                    title="Hide the answer"
                    className="text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {!activeAskProvider && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
                  No AI provider is active.{' '}
                  <button onClick={() => onNavigate('settings')} className="font-bold underline decoration-dotted">
                    Connect one in Settings
                  </button>{' '}
                  to ask about this page.
                </div>
              )}

              {/* One-tap prompts: the fastest path from reading to an answer */}
              <div className="flex gap-1 overflow-x-auto pb-0.5 -mb-0.5">
                {ASK_QUICK_PROMPTS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => askAi(preset.question)}
                    disabled={askBusy}
                    title={preset.question}
                    className="shrink-0 text-[9px] font-semibold px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-[#0f8b8d]/50 hover:text-[#0f8b8d] disabled:opacity-40 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Web sources switch */}
              <button
                onClick={() => setAskIncludeWeb(!askIncludeWeb)}
                className={`w-full flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                  askIncludeWeb
                    ? 'bg-teal-50 border-[#0f8b8d]/40 text-[#00696b]'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
                title="Include live web + PubMed sources in the answer context"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-semibold">
                  <Globe className="w-3 h-3" /> Live web sources
                </span>
                <span className={`relative w-7 h-3.5 rounded-full transition-colors ${askIncludeWeb ? 'bg-[#0f8b8d]' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${askIncludeWeb ? 'left-3.5' : 'left-0.5'}`} />
                </span>
              </button>

              {/* Conversation */}
              <div className="space-y-2">
                {askQuestion && (askBusy || askReply || askError) && (
                  <div className="flex justify-end">
                    <div className="max-w-[92%] rounded-xl rounded-br-sm bg-[#13294b] px-2 py-1.5 text-[10px] leading-snug text-white/90">
                      {askQuestion}
                    </div>
                  </div>
                )}

                {askBusy ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[9px] font-semibold text-[#0f8b8d]">
                      <Loader2 className="w-3 h-3 animate-spin" /> Reading {askContextLabel}…
                    </div>
                    <div className="h-1.5 rounded bg-slate-100 animate-pulse" />
                    <div className="h-1.5 rounded bg-slate-100 animate-pulse w-5/6" />
                    <div className="h-1.5 rounded bg-slate-100 animate-pulse w-2/3" />
                  </div>
                ) : askReply ? (
                  <div className="rounded-xl border border-teal-200/70 bg-white shadow-xs overflow-hidden">
                    <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#0f8b8d] flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" /> Answer
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(askReply).then(() => {
                            setAskCopied(true);
                            setTimeout(() => setAskCopied(false), 1500);
                          }).catch(() => {});
                        }}
                        title="Copy the answer"
                        className="text-slate-400 hover:text-[#0f8b8d] p-0.5"
                      >
                        {askCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    <div className="p-2 text-[10px] leading-relaxed text-slate-800 max-h-56 overflow-y-auto whitespace-pre-wrap">
                      {askReply}
                    </div>
                  </div>
                ) : !askError ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-2.5 py-3 text-center space-y-1">
                    <Sparkles className="w-4 h-4 text-slate-300 mx-auto" />
                    <p className="text-[10px] font-semibold text-slate-600">Select text on the page, or ask about the whole page</p>
                    <p className="text-[9px] leading-snug text-slate-400">
                      Answers stay inside this passage{askIncludeWeb ? ' plus the live sources' : ''} — nothing is invented.
                    </p>
                  </div>
                ) : null}

                {askError && (
                  <div className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{askError}</span>
                  </div>
                )}

                {askCitations.length > 0 && (
                  <div className="flex flex-wrap gap-1">
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
                          className="max-w-full truncate text-[9px] font-mono px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[#00696b] hover:border-[#0f8b8d]/50"
                        >
                          {label || `Source ${i + 1}`}
                        </a>
                      ) : (
                        <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-500">
                          {citation}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Practice questions from the same passage */}
              {mcqs.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1">
                      <GraduationCap className="w-3 h-3" /> Practice questions
                    </span>
                    <span className="text-[9px] font-mono text-slate-400">{mcqs.length} items</span>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                    {mcqs.map((q, qi) => (
                      <div key={qi} className="p-2 bg-white border border-slate-200 rounded-lg space-y-1.5 shadow-xs">
                        <div className="text-[10px] font-semibold text-slate-800 leading-snug">{qi + 1}. {q.question}</div>
                        <div className="space-y-0.5">
                          {q.options.map((o, oi) => (
                            <div key={oi} className="text-[10px] text-slate-600 pl-2">
                              <span className="font-mono text-slate-400">{String.fromCharCode(65 + oi)}.</span> {o}
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => setShowMcqAnswers((prev) => ({ ...prev, [qi]: !prev[qi] }))}
                          className="text-[9px] font-bold text-[#0f8b8d] hover:underline"
                        >
                          {showMcqAnswers[qi] ? 'Hide answer' : 'Reveal answer'}
                        </button>
                        {showMcqAnswers[qi] && (
                          <div className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-1 leading-snug">
                            <span className="font-bold">{String.fromCharCode(65 + q.answerIndex)}.</span> {q.explanation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Composer */}
              <div className="rounded-xl border border-slate-200 bg-white focus-within:border-[#0f8b8d] focus-within:ring-2 focus-within:ring-[#0f8b8d]/20 transition-shadow">
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
                  placeholder={`Ask about ${askContextLabel}…`}
                  rows={2}
                  className="w-full text-[10px] px-2 pt-1.5 pb-1 bg-transparent resize-none focus:outline-none placeholder:text-slate-400"
                />
                <div className="flex items-center justify-between px-1.5 pb-1.5">
                  <span className="text-[8px] text-slate-400">Enter to send · Shift+Enter for a new line</span>
                  <button
                    onClick={() => {
                      const question = askInput.trim();
                      if (!question || askBusy) return;
                      setAskInput('');
                      askAi(question);
                    }}
                    disabled={!askInput.trim() || askBusy}
                    title="Send"
                    className="w-6 h-6 rounded-lg bg-[#001432] text-white flex items-center justify-center disabled:opacity-30 hover:bg-[#13294b] transition-colors"
                  >
                    {askBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => generateMcqs()}
                  disabled={mcqBusy || !activeAskProvider}
                  className="text-[9px] font-bold px-2 py-1 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-white disabled:opacity-40 flex items-center gap-1"
                >
                  {mcqBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}
                  Generate MCQs
                </button>
                <button
                  onClick={() => askAi()}
                  disabled={askBusy || !activeAskProvider}
                  className="text-[9px] font-bold px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d] disabled:opacity-40 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" /> Explain {askContextLabel}
                </button>
              </div>
            </div>

            {/* Saved highlights list */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {highlights.length === 0 && (
                <p className="text-[10px] text-slate-400">
                  No highlights in this book yet. Select any text and pick a colour — it is saved to your Highlights collection.
                </p>
              )}
              {highlights.map((h) => (
                <div key={h.id} className="group p-2 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full border border-slate-300" style={{ background: h.color ?? '#fde047' }} />
                      <button
                        onClick={() => h.page && gotoPage(h.page)}
                        className="text-[10px] font-bold text-[#0f8b8d] hover:underline"
                      >
                        {`p. ${h.page ?? '—'}`}
                      </button>
                    </div>
                    <button
                      onClick={() => deleteHighlight(h.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600"
                    >
                      <Trash className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-700 leading-relaxed line-clamp-4">{h.quote}</p>
                  {h.note && <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-1">{h.note}</p>}
                </div>
              ))}
            </div>
          </div>
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
