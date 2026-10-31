// Real page text for "attach a book page" in the AI tutor.
// Reads the learner's own imported PDF/DOCX from the local library (IndexedDB).
// Order: cached page text -> live PDF extraction -> honest error (e.g. scanned
// page with no text layer, which must be OCR'd in the PDF Reader first).

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getLibraryDocument, getPageText, savePageText } from './pdfLibraryDB.ts';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface BookPageText {
  docId: string;
  docTitle: string;
  pageNumber: number;
  text: string;
}

export async function extractBookPageText(docId: string, pageNumber: number): Promise<BookPageText> {
  const rec = await getLibraryDocument(docId);
  if (!rec) throw new Error('That document is no longer in the library.');

  const total = rec.numPages || 0;
  if (!Number.isFinite(pageNumber) || pageNumber < 1 || (total > 0 && pageNumber > total)) {
    throw new Error(total > 0 ? `That document has ${total} page${total === 1 ? '' : 's'}.` : 'Enter a page number of 1 or more.');
  }

  const cached = await getPageText(docId, pageNumber).catch(() => null);
  if (cached && cached.text.trim()) {
    return { docId, docTitle: rec.title, pageNumber, text: cached.text.trim() };
  }

  if (rec.fileType === 'docx') {
    throw new Error('That page has no stored text. Re-import the document, then try again.');
  }

  const buffer = await rec.blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const text = await readPdfPageText(pdf, pageNumber);
    if (!text) {
      throw new Error(
        `Page ${pageNumber} has no selectable text — it is probably a scan. Open it in the PDF Reader and run OCR, then attach it again.`,
      );
    }
    await savePageText(docId, pageNumber, text).catch(() => undefined);
    return { docId, docTitle: rec.title, pageNumber, text };
  } finally {
    try { await pdf.destroy(); } catch { /* already closed */ }
  }
}

/** Extract the text of one already-open pdf.js page (cached write-back is the caller's job). */
async function readPdfPageText(pdf: any, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return (content.items || [])
    .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BookRangeText {
  docId: string;
  docTitle: string;
  /** 1-based, inclusive */
  fromPage: number;
  /** 1-based, inclusive */
  toPage: number;
  text: string;
  /** pages that yielded no text (e.g. scans) and were therefore skipped */
  emptyPages: number[];
}

/**
 * Extract a CONTIGUOUS RUN of pages in one pass.
 *
 * The model's window is up to 1M tokens, so a single page cap was leaving almost all of
 * it unused (a 400-page book is roughly 300k tokens). Reading a run in one pass also
 * avoids reopening the same PDF once per page, which is what made anything larger than a
 * single page impractical before.
 *
 * `maxChars` is a safety valve, not the real limit: it stops one pathological document
 * from building a prompt so large the browser or the provider chokes. Pages are added in
 * order and the run stops cleanly at the last page that fits, so the caller always gets a
 * coherent contiguous excerpt rather than a truncated page.
 */
export async function extractBookRangeText(
  docId: string,
  fromPage: number,
  toPage: number,
  options: { maxChars?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BookRangeText> {
  const { maxChars = 400_000, onProgress } = options;
  const rec = await getLibraryDocument(docId);
  if (!rec) throw new Error('That document is no longer in the library.');

  const total = rec.numPages || 0;
  const from = Math.max(1, Math.round(fromPage));
  const to = total > 0 ? Math.min(total, Math.round(toPage)) : Math.round(toPage);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new Error('Enter a valid page range (start page must not exceed end page).');
  }

  const pieces: string[] = [];
  const emptyPages: number[] = [];
  let used = 0;
  let lastIncluded = from - 1;

  if (rec.fileType === 'docx') {
    throw new Error('That document has no extractable text. Re-import it, then try again.');
  }

  const buffer = await rec.blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    for (let pageNumber = from; pageNumber <= to; pageNumber++) {
      onProgress?.(pageNumber - from + 1, to - from + 1);
      let pageText = '';
      const cached = await getPageText(docId, pageNumber).catch(() => null);
      if (cached && cached.text.trim()) {
        pageText = cached.text.trim();
      } else {
        pageText = await readPdfPageText(pdf, pageNumber).catch(() => '');
        if (pageText) await savePageText(docId, pageNumber, pageText).catch(() => undefined);
      }
      if (!pageText) {
        // A scanned page contributes nothing; note it and keep the run contiguous.
        emptyPages.push(pageNumber);
        continue;
      }
      if (used + pageText.length > maxChars) break;
      pieces.push(`[p.${pageNumber}] ${pageText}`);
      used += pageText.length;
      lastIncluded = pageNumber;
    }
  } finally {
    try { await pdf.destroy(); } catch { /* already closed */ }
  }

  if (!pieces.length) {
    throw new Error(
      `No selectable text found in pages ${from}–${to}. They may be scans — open them in the PDF Reader and run OCR first.`,
    );
  }

  return {
    docId,
    docTitle: rec.title,
    fromPage: from,
    toPage: lastIncluded,
    text: pieces.join('\n\n'),
    emptyPages,
  };
}
