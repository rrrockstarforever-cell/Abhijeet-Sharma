// Utility for IndexedDB persistence, file validation, and 'seen' tracking for question banks

export type BankId = 'emedici' | 'success' | 'amc';

export interface BankQuestion {
  id: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  subject?: string;
  topic?: string;
  group?: string;
  difficulty?: string;
  image?: string;
  bank: BankId;
}

export interface BankMetadata {
  bankId: BankId;
  name: string;
  count: number;
  skippedCount: number;
  importedAt?: string;
}

export interface ParseResult {
  valid: BankQuestion[];
  totalParsed: number;
  importedCount: number;
  skippedCount: number;
  duplicatesDropped: number;
  needsReviewSkipped: number;
  invalidFormatSkipped: number;
}

const DB_NAME = 'PulseMedDB';
const DB_VERSION = 2;
const STORE_NAME = 'question_banks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store validated bank questions in IndexedDB under key `bank:<name>`
 */
export async function saveBankToIDB(bankId: BankId, questions: BankQuestion[], skippedCount: number = 0): Promise<void> {
  const db = await openDB();
  const key = `bank:${bankId}`;
  const metaKey = `meta:${bankId}`;
  
  const meta: BankMetadata = {
    bankId,
    name: bankId === 'emedici' ? 'eMedici' : bankId === 'success' ? 'AMC Success' : 'AMC Recall',
    count: questions.length,
    skippedCount,
    importedAt: new Date().toLocaleDateString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(questions, key);
    store.put(meta, metaKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve questions from IndexedDB under key `bank:<name>`
 */
export async function getBankFromIDB(bankId: BankId): Promise<BankQuestion[]> {
  const db = await openDB();
  const key = `bank:${bankId}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as BankQuestion[]) || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve bank metadata (count and skipped count)
 */
export async function getBankMetaFromIDB(bankId: BankId): Promise<BankMetadata | null> {
  const db = await openDB();
  const metaKey = `meta:${bankId}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(metaKey);
    req.onsuccess = () => resolve((req.result as BankMetadata) || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove bank from IndexedDB
 */
export async function removeBankFromIDB(bankId: BankId): Promise<void> {
  const db = await openDB();
  const key = `bank:${bankId}`;
  const metaKey = `meta:${bankId}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    store.delete(metaKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Parse and strictly validate bank JSON file in browser
 * Validation rules:
 * - question must be a non-empty string
 * - options must be strings, minimum 2 (recall banks legitimately have 2-3 options, do NOT require 4)
 * - answerIndex must be an integer inside the options range
 * - skip questions with needsReview=true
 * - drop duplicates by lowercase alphanumeric question text
 * - image only if it starts with data:image/(jpeg|png|webp);base64, else ignore it
 * - Never use dangerouslySetInnerHTML
 */
export function validateAndParseBankJSON(jsonString: string, bankId: BankId): ParseResult {
  let parsedData: any;
  try {
    parsedData = JSON.parse(jsonString);
  } catch (err: any) {
    throw new Error('Invalid JSON file format: Failed to parse JSON.');
  }

  const rawList: any[] = Array.isArray(parsedData)
    ? parsedData
    : Array.isArray(parsedData?.questions)
      ? parsedData.questions
      : [];

  if (rawList.length === 0) {
    throw new Error('No questions found in JSON. File must be an array of questions or contain a "questions" array.');
  }

  const seenAlphanumeric = new Set<string>();
  const valid: BankQuestion[] = [];
  let duplicatesDropped = 0;
  let needsReviewSkipped = 0;
  let invalidFormatSkipped = 0;

  rawList.forEach((item, index) => {
    // 1. Skip if needsReview is true
    if (item.needsReview === true) {
      needsReviewSkipped++;
      return;
    }

    // 2. Question must be a non-empty string
    if (typeof item.question !== 'string' || !item.question.trim()) {
      invalidFormatSkipped++;
      return;
    }

    // 3. Options must be an array of strings, minimum 2
    if (
      !Array.isArray(item.options) ||
      item.options.length < 2 ||
      !item.options.every((opt: any) => typeof opt === 'string' && opt.trim() !== '')
    ) {
      invalidFormatSkipped++;
      return;
    }

    // 4. answerIndex must be an integer inside the options range
    const answerIdx = Number(item.answerIndex);
    if (!Number.isInteger(answerIdx) || answerIdx < 0 || answerIdx >= item.options.length) {
      invalidFormatSkipped++;
      return;
    }

    // 5. Drop duplicates by lowercase alphanumeric question text
    const normalizedKey = item.question.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalizedKey || seenAlphanumeric.has(normalizedKey)) {
      duplicatesDropped++;
      return;
    }
    seenAlphanumeric.add(normalizedKey);

    // 6. Image only if it starts with data:image/(jpeg|png|webp);base64, else ignore
    let validImage: string | undefined = undefined;
    if (
      typeof item.image === 'string' &&
      /^data:image\/(jpeg|png|webp);base64,/i.test(item.image)
    ) {
      validImage = item.image;
    }

    const cleanQuestion: BankQuestion = {
      id: item.id ? String(item.id) : `${bankId}_${index + 1}`,
      question: item.question.trim(),
      options: item.options.map((opt: string) => opt.trim()),
      answerIndex: answerIdx,
      explanation: typeof item.explanation === 'string' && item.explanation.trim() ? item.explanation.trim() : undefined,
      subject: typeof item.subject === 'string' && item.subject.trim() ? item.subject.trim() : undefined,
      topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : (typeof item.group === 'string' && item.group.trim() ? item.group.trim() : undefined),
      group: typeof item.group === 'string' && item.group.trim() ? item.group.trim() : undefined,
      difficulty: typeof item.difficulty === 'string' ? item.difficulty.trim() : undefined,
      image: validImage,
      bank: bankId
    };

    valid.push(cleanQuestion);
  });

  const totalSkipped = needsReviewSkipped + duplicatesDropped + invalidFormatSkipped;

  return {
    valid,
    totalParsed: rawList.length,
    importedCount: valid.length,
    skippedCount: totalSkipped,
    duplicatesDropped,
    needsReviewSkipped,
    invalidFormatSkipped
  };
}

/**
 * Seen questions tracking in localStorage per-bank
 */
export function getSeenQuestionIds(bankId: string): string[] {
  try {
    const raw = localStorage.getItem(`seen_bank_${bankId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markQuestionsAsSeen(bankId: string, ids: string[]): void {
  try {
    const current = new Set(getSeenQuestionIds(bankId));
    ids.forEach(id => current.add(id));
    localStorage.setItem(`seen_bank_${bankId}`, JSON.stringify(Array.from(current)));
  } catch (err) {
    console.error('Failed to update seen questions', err);
  }
}

export function resetSeenQuestions(bankId: string): void {
  localStorage.removeItem(`seen_bank_${bankId}`);
}
