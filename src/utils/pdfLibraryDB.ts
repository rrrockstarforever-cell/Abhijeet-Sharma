// IndexedDB persistence for the PDF library.
// DB 'PulseMedFilesDB' (version 1):
//   - 'files': imported PDF blobs + metadata (NOT parsed on import — pages render on demand)
//   - 'pages': extracted page text cache (one store entry per page, written lazily
//              when a page is visited or indexed for search)

export interface PDFLibraryMeta {
  id: string;
  title: string;
  author?: string;
  sizeBytes: number;
  numPages: number;
  addedAt: string;
  /** 'pdf' (default) or 'docx' — DOCX is stored as extracted text pages */
  fileType?: 'pdf' | 'docx';
  /** subject grouping (heuristic on import, editable, or AI-classified) */
  subject?: string;
}

const DB_NAME = 'PulseMedFilesDB';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const PAGES_STORE = 'pages';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        const s = db.createObjectStore(FILES_STORE, { keyPath: 'id' });
        s.createIndex('addedAt', 'addedAt');
      }
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        const s = db.createObjectStore(PAGES_STORE, { keyPath: ['docId', 'pageNumber'] });
        s.createIndex('docId', 'docId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

// ---------- metadata ----------

export async function addLibraryDocument(meta: PDFLibraryMeta, blob: Blob): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(FILES_STORE, 'readwrite');
  tx.objectStore(FILES_STORE).put({ ...meta, blob });
  await txDone(tx);
  db.close();
}

export async function updateLibraryMeta(docId: string, patch: Partial<PDFLibraryMeta>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(FILES_STORE, 'readwrite');
  const store = tx.objectStore(FILES_STORE);
  const getReq = store.get(docId);
  getReq.onsuccess = () => {
    const existing = getReq.result;
    if (existing) store.put({ ...existing, ...patch });
  };
  await txDone(tx);
  db.close();
}

export async function listLibraryDocuments(): Promise<(PDFLibraryMeta & { blob: Blob })[]> {
  const db = await openDB();
  const tx = db.transaction(FILES_STORE, 'readonly');
  const req = tx.objectStore(FILES_STORE).getAll();
  const all = await new Promise<any[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return all as (PDFLibraryMeta & { blob: Blob })[];
}

export async function getLibraryDocument(docId: string): Promise<(PDFLibraryMeta & { blob: Blob }) | null> {
  const db = await openDB();
  const tx = db.transaction(FILES_STORE, 'readonly');
  const req = tx.objectStore(FILES_STORE).get(docId);
  const result = await new Promise<any>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return result as (PDFLibraryMeta & { blob: Blob }) | null;
}

export async function removeLibraryDocument(docId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([FILES_STORE, PAGES_STORE], 'readwrite');
  tx.objectStore(FILES_STORE).delete(docId);
  const pages = tx.objectStore(PAGES_STORE).index('docId');
  const cursorReq = pages.openCursor(IDBKeyRange.only(docId));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await txDone(tx);
  db.close();
}

// ---------- page-text cache (for whole-document search & Ask-AI context) ----------

export async function savePageText(docId: string, pageNumber: number, text: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(PAGES_STORE, 'readwrite');
  tx.objectStore(PAGES_STORE).put({ docId, pageNumber, text });
  await txDone(tx);
  db.close();
}

export async function getPageText(docId: string, pageNumber: number): Promise<string | null> {
  const db = await openDB();
  const tx = db.transaction(PAGES_STORE, 'readonly');
  const req = tx.objectStore(PAGES_STORE).get([docId, pageNumber]);
  const result = await new Promise<any>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return result ? (result.text as string) : null;
}

export async function listPageTexts(docId: string): Promise<{ pageNumber: number; text: string }[]> {
  const db = await openDB();
  const tx = db.transaction(PAGES_STORE, 'readonly');
  const req = tx.objectStore(PAGES_STORE).index('docId').getAll(IDBKeyRange.only(docId));
  const results = await new Promise<any[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return results
    .map((r) => ({ pageNumber: r.pageNumber as number, text: r.text as string }))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}
