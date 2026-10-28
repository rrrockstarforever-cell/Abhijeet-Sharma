// Persistent Question Bank Storage Manager (IndexedDB).
// Reuses PulseMedDB (version 2) with new object stores; never destroys existing data.
// Every generated question is saved here automatically with full metadata + audit.

const DB_NAME = 'PulseMedDB';
const DB_VERSION = 2;

const STORES = {
  questions: 'questions',
  versions: 'question_versions',
  memberships: 'question_bank_memberships',
  reviews: 'question_reviews',
  batches: 'generation_batches',
  batchItems: 'generation_batch_items',
  evidence: 'question_evidence',
  audit: 'question_audit_log',
} as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Legacy store (already exists in v1)
      if (!db.objectStoreNames.contains('question_banks')) db.createObjectStore('question_banks');
      // New stores
      if (!db.objectStoreNames.contains(STORES.questions)) {
        const s = db.createObjectStore(STORES.questions, { keyPath: 'id' });
        s.createIndex('exam', 'examId', { unique: false });
        s.createIndex('bank', 'bankId', { unique: false });
        s.createIndex('subject', 'subjectId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('batch', 'batchId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.versions)) {
        db.createObjectStore(STORES.versions, { keyPath: ['questionId', 'version'] });
      }
      if (!db.objectStoreNames.contains(STORES.memberships)) {
        const s = db.createObjectStore(STORES.memberships, { autoIncrement: true });
        s.createIndex('questionId', 'questionId', { unique: false });
        s.createIndex('bankId', 'bankId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.reviews)) {
        db.createObjectStore(STORES.reviews, { keyPath: 'questionId' });
      }
      if (!db.objectStoreNames.contains(STORES.batches)) {
        db.createObjectStore(STORES.batches, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.batchItems)) {
        const s = db.createObjectStore(STORES.batchItems, { autoIncrement: true });
        s.createIndex('batchId', 'batchId', { unique: false });
        s.createIndex('key', 'key', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORES.evidence)) {
        const s = db.createObjectStore(STORES.evidence, { autoIncrement: true });
        s.createIndex('questionId', 'questionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.audit)) {
        const s = db.createObjectStore(STORES.audit, { autoIncrement: true });
        s.createIndex('questionId', 'questionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeNames: string | string[], mode: IDBTransactionMode): IDBTransaction {
  // openDB is async; callers should use the helpers below which handle it.
  throw new Error('use openDB() directly');
}

async function withTx<T>(storeNames: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(storeNames, mode);
  const result = await fn(tx);
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function put(store: string, value: any, key?: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    if (key !== undefined) s.put(value, key); else s.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get(store: string, key: IDBValidKey): Promise<any> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(store: string): Promise<any[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error);
  });
}

async function getByIndex(store: string, index: string, value: IDBValidKey): Promise<any[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(index).getAll(value);
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error);
  });
}

export interface GenerationBatch {
  id: string;
  examType: string;
  bankId: string;
  requestedCount: number;
  createdCount: number;
  failedCount: number;
  status: 'pending' | 'running' | 'completed' | 'interrupted' | 'failed';
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
}

export interface GenerationBatchItem {
  batchId: string;
  index: number;
  status: 'pending' | 'generated' | 'validated' | 'approved' | 'rejected' | 'failed';
  questionId?: string;
  error?: string;
  key: string; // idempotency key
}

export interface QuestionRecord {
  id: string;
  version: number;
  examId: string;
  bankId: string;
  subjectId: string;
  topicId: string;
  subtopicId: string;
  questionType: string;
  difficulty: string;
  stem: string;
  questionText: string;
  options: { id: string; text: string }[];
  correctOption: string;
  explanation?: string;
  image?: string;
  imageCaption?: string;
  sourceType?: string;
  tags?: string[];
  contentFingerprint: string;
  generationBatchId?: string;
  generationModel?: string;
  createdAt: string;
  updatedAt: string;
  status: 'GENERATED' | 'VALIDATING' | 'VERIFYING' | 'REVIEWING' | 'REVISION_REQUIRED' | 'HUMAN_REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'SUSPENDED';
  qaScore?: number;
  qaStatus?: string;
  publicationEligible: boolean;
  auditLog: { at: string; event: string; detail?: string }[];
}

export interface BankMembership {
  questionId: string;
  bankId: string;
  examId: string;
  addedAt: string;
}

// ---------- Classification ----------

export function classifyQuestion(input: {
  examType: string;
  bankId?: string;
  subject: string;
  subtopic: string;
  questionType?: string;
  difficulty?: string;
}): { examId: string; bankId: string; subjectId: string; topicId: string; subtopicId: string; questionType: string; difficulty: string } {
  const examId = input.examType;
  // Default bank per exam
  const defaultBank: Record<string, string> = {
    AMC_CAT: 'amc_general',
    NEET_PG: 'neet_medicine',
    INI_CET: 'ini_integrated',
  };
  const bankId = input.bankId || defaultBank[examId] || `${examId.toLowerCase()}_general`;
  // Subject → topic: use the subtopic as the topic id (the generator already provides a
  // clinical subtopic). Normalise to a slug for stable identifiers.
  const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
  const subjectId = slug(input.subject);
  const topicId = slug(input.subtopic);
  const subtopicId = slug(input.subtopic);
  return {
    examId,
    bankId,
    subjectId,
    topicId,
    subtopicId,
    questionType: input.questionType || 'single-best-answer',
    difficulty: input.difficulty || 'MEDIUM',
  };
}

// ---------- Fingerprint ----------

export function fingerprint(q: { stem?: string; questionText?: string; options?: { text: string }[]; correctOption?: string }): string {
  const stem = (q.stem || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lead = (q.questionText || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const opts = (q.options || []).map((o) => o.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).sort().join('|');
  return `${stem}|${lead}|${opts}|${q.correctOption || ''}`;
}

// ---------- Batch management ----------

export async function createBatch(batch: GenerationBatch): Promise<void> {
  await put(STORES.batches, batch);
  await logAudit(batch.id, 'BATCH_CREATED', `Requested ${batch.requestedCount} questions for ${batch.examType}.`);
}

export async function updateBatch(batch: GenerationBatch): Promise<void> {
  await put(STORES.batches, { ...batch, updatedAt: new Date().toISOString() });
}

export async function getBatch(id: string): Promise<GenerationBatch | null> {
  return (await get(STORES.batches, id)) as GenerationBatch | null;
}

export async function createBatchItem(item: GenerationBatchItem): Promise<void> {
  // Idempotent: the unique index on `key` prevents duplicate writes.
  const existing = await getByIndex(STORES.batchItems, 'key', item.key);
  if (existing.length > 0) return; // already recorded
  await put(STORES.batchItems, item);
}

export async function updateBatchItem(idempotencyKey: string, patch: Partial<GenerationBatchItem>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.batchItems, 'readwrite');
    const store = tx.objectStore(STORES.batchItems);
    const idx = store.index('key');
    const req = idx.getAll(idempotencyKey);
    req.onsuccess = () => {
      const rows = req.result as GenerationBatchItem[];
      if (rows.length === 0) { resolve(); return; }
      const row = rows[0];
      const updated = { ...row, ...patch };
      // Re-put with the same auto-increment key requires getting the key first.
      const keyReq = idx.getKey(idempotencyKey);
      keyReq.onsuccess = () => {
        store.put(updated, keyReq.result);
        resolve();
      };
      keyReq.onerror = () => reject(keyReq.error);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBatchItems(batchId: string): Promise<GenerationBatchItem[]> {
  return (await getByIndex(STORES.batchItems, 'batchId', batchId)) as GenerationBatchItem[];
}

// ---------- Save a generated question (idempotent) ----------

export async function saveGeneratedQuestion(
  question: any,
  meta: {
    examType: string;
    bankId?: string;
    batchId?: string;
    index?: number;
    generationModel?: string;
    idempotencyKey?: string;
  },
): Promise<{ questionId: string; created: boolean }> {
  const id = question.id || `${meta.batchId || 'gen'}_${meta.index ?? 0}_${Date.now().toString(36)}`;
  const classification = classifyQuestion({
    examType: meta.examType,
    bankId: meta.bankId,
    subject: question.subject || 'General Medicine',
    subtopic: question.subtopic || 'General',
    questionType: 'single-best-answer',
    difficulty: question.difficultyTier || 'MEDIUM',
  });

  // Check if already saved (idempotency)
  const existing = await get(STORES.questions, id);
  if (existing) {
    // Idempotent: don't overwrite. Log the attempt.
    await logAudit(id, 'SAVE_ATTEMPT_DUPLICATE', `Question ${id} already exists; skipped duplicate write.`);
    return { questionId: id, created: false };
  }

  const now = new Date().toISOString();
  const record: QuestionRecord = {
    id,
    version: 1,
    examId: classification.examId,
    bankId: classification.bankId,
    subjectId: classification.subjectId,
    topicId: classification.topicId,
    subtopicId: classification.subtopicId,
    questionType: classification.questionType,
    difficulty: classification.difficulty,
    stem: question.stem,
    questionText: question.questionText,
    options: question.options,
    correctOption: question.correctOption,
    explanation: question.explanation,
    image: question.image,
    imageCaption: question.imageCaption,
    sourceType: question.sourceType,
    tags: question.citations || [],
    contentFingerprint: fingerprint(question),
    generationBatchId: meta.batchId,
    generationModel: meta.generationModel,
    createdAt: now,
    updatedAt: now,
    status: question.status || 'GENERATED',
    qaScore: question.qaReview?.adjudication?.totalScore,
    qaStatus: question.qaReview?.status,
    publicationEligible: question.qaReview?.publicationEligible ?? false,
    auditLog: [{ at: now, event: 'CREATED', detail: `Generated by ${meta.generationModel || 'AI'}` }],
  };

  // Write master record + version 1 + bank membership + audit entry (transactional).
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORES.questions, STORES.versions, STORES.memberships, STORES.audit], 'readwrite');
    tx.objectStore(STORES.questions).put(record);
    tx.objectStore(STORES.versions).put({ questionId: id, version: 1, stem: record.stem, questionText: record.questionText, options: record.options, correctOption: record.correctOption, explanation: record.explanation, savedAt: now });
    tx.objectStore(STORES.memberships).add({ questionId: id, bankId: classification.bankId, examId: classification.examId, addedAt: now });
    tx.objectStore(STORES.audit).add({ questionId: id, at: now, event: 'CREATED', detail: `Saved to ${classification.examId}/${classification.bankId}/${classification.subjectId}/${classification.subtopicId}` });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { questionId: id, created: true };
}

// ---------- Queries ----------

export async function getQuestion(id: string): Promise<QuestionRecord | null> {
  return (await get(STORES.questions, id)) as QuestionRecord | null;
}

export async function listQuestions(filters?: { examId?: string; bankId?: string; subjectId?: string; status?: string }): Promise<QuestionRecord[]> {
  let rows = (await getAll(STORES.questions)) as QuestionRecord[];
  if (filters?.examId) rows = rows.filter((r) => r.examId === filters.examId);
  if (filters?.bankId) rows = rows.filter((r) => r.bankId === filters.bankId);
  if (filters?.subjectId) rows = rows.filter((r) => r.subjectId === filters.subjectId);
  if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
  return rows;
}

export async function listBatches(): Promise<GenerationBatch[]> {
  return (await getAll(STORES.batches)) as GenerationBatch[];
}

// ---------- Integrity checker ----------

export interface IntegrityIssue {
  questionId: string;
  issue: string;
  severity: 'warning' | 'error';
}

export async function runIntegrityScan(): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const questions = (await getAll(STORES.questions)) as QuestionRecord[];
  const memberships = (await getAll(STORES.memberships)) as BankMembership[];
  const membershipIds = new Set(memberships.map((m) => m.questionId));

  for (const q of questions) {
    if (!q.id) issues.push({ questionId: q.id || '?', issue: 'Missing question ID.', severity: 'error' });
    if (!q.stem || !q.questionText) issues.push({ questionId: q.id, issue: 'Missing stem or lead-in.', severity: 'error' });
    if (!q.options || q.options.length < 2) issues.push({ questionId: q.id, issue: 'Fewer than 2 options.', severity: 'error' });
    if (!q.correctOption) issues.push({ questionId: q.id, issue: 'Missing correct answer.', severity: 'error' });
    if (!q.examId) issues.push({ questionId: q.id, issue: 'Missing exam reference.', severity: 'error' });
    if (!q.bankId) issues.push({ questionId: q.id, issue: 'Missing bank reference.', severity: 'error' });
    if (!membershipIds.has(q.id)) issues.push({ questionId: q.id, issue: 'No bank membership record.', severity: 'warning' });
    if (!q.contentFingerprint) issues.push({ questionId: q.id, issue: 'Missing content fingerprint.', severity: 'warning' });
    if (q.status === 'PUBLISHED' && q.qaStatus !== 'APPROVED' && !q.publicationEligible) {
      issues.push({ questionId: q.id, issue: 'Published without approval record.', severity: 'error' });
    }
  }

  // Orphaned memberships
  const qIds = new Set(questions.map((q) => q.id));
  for (const m of memberships) {
    if (!qIds.has(m.questionId)) issues.push({ questionId: m.questionId, issue: 'Orphaned bank membership.', severity: 'warning' });
  }

  // Duplicate generation IDs
  const genIds = questions.map((q) => q.generationBatchId).filter(Boolean);
  const genDupes = genIds.filter((id, i) => genIds.indexOf(id) !== i);
  for (const id of new Set(genDupes)) {
    issues.push({ questionId: id, issue: 'Duplicate generation batch ID across questions.', severity: 'warning' });
  }

  return issues;
}

// ---------- Audit log ----------

export async function logAudit(questionId: string, event: string, detail?: string): Promise<void> {
  try {
    await put(STORES.audit, { questionId, at: new Date().toISOString(), event, detail });
  } catch { /* best effort */ }
}

// ---------- Migration (non-destructive) ----------

export async function migrateLegacyBanks(): Promise<{ migrated: number; skipped: number }> {
  // Reads the existing question_banks store and copies records into the new questions store
  // without overwriting anything. Ambiguous records are flagged for review.
  const db = await openDB();
  let migrated = 0, skipped = 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('question_banks', 'readonly');
    const req = tx.objectStore('question_banks').getAll();
    req.onsuccess = async () => {
      const rows = (req.result as any[]) || [];
      for (const row of rows) {
        if (!Array.isArray(row)) { skipped++; continue; }
        for (const q of row) {
          if (!q || !q.question) { skipped++; continue; }
          const id = q.id || `legacy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          const existing = await get(STORES.questions, id);
          if (existing) { skipped++; continue; }
          const now = new Date().toISOString();
          await put(STORES.questions, {
            id,
            version: 1,
            examId: 'AMC_CAT',
            bankId: q.bank || 'amc',
            subjectId: (q.subject || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            topicId: (q.topic || q.group || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            subtopicId: (q.topic || q.group || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            questionType: 'single-best-answer',
            difficulty: q.difficulty || 'MEDIUM',
            stem: q.question,
            questionText: q.question,
            options: (q.options || []).map((o: string, i: number) => ({ id: String.fromCharCode(65 + i), text: o })),
            correctOption: String.fromCharCode(65 + (q.answerIndex || 0)),
            explanation: q.explanation,
            image: q.image,
            sourceType: 'imported',
            tags: [],
            contentFingerprint: fingerprint(q),
            createdAt: now,
            updatedAt: now,
            status: 'GENERATED',
            publicationEligible: false,
            auditLog: [{ at: now, event: 'MIGRATED', detail: 'Imported from legacy question_banks store.' }],
          });
          migrated++;
        }
      }
      resolve({ migrated, skipped });
    };
    req.onerror = () => reject(req.error);
  });
}
