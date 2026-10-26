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
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = (content.items || [])
      .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

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
