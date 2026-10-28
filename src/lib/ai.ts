// Client-side AI library for Pulse Med.
// Real provider calls only (via /api/ai/complete on the local Express server).
// No silent fallbacks: every failure is thrown as a typed AiError and must be shown in the UI.
import type { ClinicalQuestion, ExamType, DifficultyTier, DifficultySubLevel } from '../types.ts';

import { AMC_BLUEPRINT, getDifficultyDescription } from "./amcBlueprint";
import { findLiveImage, liveImageCaption, isLiveImageSearchEnabled } from '../utils/liveImages.ts';
export type AiProviderId = 'gemini' | 'chatgpt' | 'claude' | 'grok' | 'opencode';

export const AI_PROVIDER_IDS: AiProviderId[] = ['gemini', 'chatgpt', 'claude', 'grok', 'opencode'];

// Server defaults (mirrored in server.ts); models are user-selectable and persisted
// in localStorage as `ai.model.<provider>` and sent with every request.
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
  // OpenCode Console / Go (https://opencode.ai/inference) — any model id the account has.
  opencode: 'deepseek-v4.1-flash',
};

// Console-only model ids a previous version of the app offered for OpenCode. They are not
// included in the Go plan and return "Model is unavailable" — drop them on read.
const NON_GO_OPENCODE_MODELS = new Set([
  'claude-sonnet-5-5',
  'gpt-6.1-sol',
  'gemini-3.8-flash',
  'kimi-k3',
  'claude-opus-4-5',
  'gpt-5.4',
]);

export const NOT_CONNECTED_MESSAGE = 'Connect an AI provider in Settings → AI Subscription Hub.';

export class AiError extends Error {
  kind: 'not_connected' | 'api' | 'network' | 'invalid' | 'aborted';
  /** HTTP status when the failure came from the local server. */
  status?: number;
  /** Server-suggested wait (from Retry-After), capped. */
  retryAfterMs?: number;
  constructor(message: string, kind: AiError['kind'] = 'api') {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

// ---------- localStorage persistence ----------

export function getActiveProvider(): AiProviderId | null {
  const value = localStorage.getItem('ai.activeProvider');
  return value && (AI_PROVIDER_IDS as string[]).includes(value) ? (value as AiProviderId) : null;
}

export function setActiveProvider(provider: AiProviderId): void {
  localStorage.setItem('ai.activeProvider', provider);
}

/** Pick the first connected provider (called after fetching /api/oauth/status). */
export function pickDefaultActiveProvider(status: Record<string, { connected?: boolean }>): AiProviderId | null {
  const connected = AI_PROVIDER_IDS.filter((id) => Boolean(status[id]?.connected));
  return connected[0] ?? null;
}

export function getModel(provider: AiProviderId): string | null {
  const value = localStorage.getItem(`ai.model.${provider}`);
  return value && value.trim() ? value.trim() : null;
}

export function setModel(provider: AiProviderId, model: string): void {
  localStorage.setItem(`ai.model.${provider}`, model.trim());
}

export function getEffectiveModel(provider: AiProviderId): string {
  const stored = getModel(provider);
  if (provider === 'opencode' && stored && NON_GO_OPENCODE_MODELS.has(stored)) {
    // A previous version of the app listed Console-only model ids as if they were
    // OpenCode Go models; those return "Model is unavailable" on a Go subscription.
    try { localStorage.removeItem('ai.model.opencode'); } catch { /* ignore */ }
    return DEFAULT_MODELS.opencode;
  }
  return stored ?? DEFAULT_MODELS[provider];
}

// ---------- provider status ----------

export interface ProviderStatusResponse {
  providers: Record<string, { connected?: boolean; userEmail?: string }>;
}

export async function fetchProviderStatus(): Promise<ProviderStatusResponse['providers']> {
  try {
    const res = await fetch('/api/oauth/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ProviderStatusResponse = await res.json();
    return data.providers ?? {};
  } catch (err: any) {
    throw new AiError(`Could not reach the local AI server (${err?.message || 'network error'}).`, 'network');
  }
}

// ---------- completion ----------

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiCompleteOptions {
  system?: string;
  messages: AiMessage[];
  json?: boolean;
  effort?: string;
  provider?: AiProviderId;
  model?: string;
  /** Cancels the HTTP request; the server also drops the upstream call (see /api/ai/complete). */
  signal?: AbortSignal;
}

// Stable conversation id for providers that cache/route per session (OpenCode Go).
// Stored in sessionStorage so each tab/instance keeps its own session — running several
// instances in parallel then maps to several distinct sessions on the provider gateway.
function openCodeSessionId(): string {
  try {
    let id = sessionStorage.getItem('pulse.opencode.session');
    if (!id) {
      id = localStorage.getItem('pulse.opencode.session') ||
        `pulsemed-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem('pulse.opencode.session', id);
      try { localStorage.setItem('pulse.opencode.session', id); } catch { /* ignore */ }
    }
    return id;
  } catch {
    return `pulsemed-${Math.random().toString(36).slice(2)}`;
  }
}

/** Calls POST /api/ai/complete with the active (or given) provider. Throws typed AiError on failure. */
export async function aiComplete(options: AiCompleteOptions): Promise<string> {
  const provider = options.provider ?? getActiveProvider();
  if (!provider) {
    throw new AiError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`, 'not_connected');
  }
  const body = {
    provider,
    model: options.model ?? getEffectiveModel(provider),
    system: options.system,
    messages: options.messages,
    json: options.json,
    effort: options.effort,
  };

  let res: Response;
  try {
    res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-opencode-session': openCodeSessionId() },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw new AiError('Generation stopped.', 'aborted');
    }
    throw new AiError(`Could not reach the local AI server (${err?.message || 'network error'}).`, 'network');
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const srvMsg = typeof data?.error === 'string' ? data.error : `AI request failed (HTTP ${res.status}).`;
    if (res.status === 401) throw new AiError(`${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. ${NOT_CONNECTED_MESSAGE}`, 'not_connected');
    const err = new AiError(srvMsg, 'api');
    err.status = res.status;
    const ra = res.headers.get('retry-after');
    if (ra) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) err.retryAfterMs = Math.min(30_000, Math.max(0, secs * 1000));
    }
    throw err;
  }
  const text = typeof data?.text === 'string' ? data.text : '';
  if (!text.trim()) throw new AiError('The AI provider returned an empty response. Try again.', 'api');
  return text;
}

// ---------- JSON helpers ----------

/** Extract the first JSON value from raw model output (tolerates markdown fences and surrounding prose). */
export function extractJson<T = any>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end > -1) text = text.slice(0, end + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * A reply cut off mid-item (token limit, dropped connection) is invalid JSON as a whole,
 * but every item before the cut is intact. Walk the "questions" array and keep each
 * COMPLETE object so one truncated tail never throws away a whole batch.
 */
export function salvageQuestionObjects(text: string): any[] {
  if (!text) return [];
  const key = text.indexOf('"questions"');
  const open = text.indexOf('[', key >= 0 ? key : 0);
  if (open < 0) return [];
  const items: any[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { items.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip a malformed item */ }
        start = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return items;
}

// ---------- AI exam-question generation ----------

const GENERATOR_SYSTEM = `You are a senior item writer for the Indian and Australian postgraduate medical entrance exams (NEET-PG, INI-CET, AMC CAT).
Your questions are written to DISCRIMINATE between well-prepared candidates, not to confirm what everyone already knows. An item that a candidate can answer from a single buzzword is a failed item.
Every question has exactly one defensible best answer. Distractors are real, plausible entities that a half-prepared candidate would genuinely choose, never absurd or obviously wrong.
Always respond with ONLY a single valid JSON object (no markdown fences, no commentary).`;

/**
 * Per-exam item patterns, ported from the original app's generator (its `__cmExam`
 * table). These, not a one-line label, are what keep the questions exam-standard.
 */
const EXAM_PATTERNS: Record<ExamType, { name: string; opts: number; pat: string }> = {
  NEET_PG: {
    name: 'NEET PG',
    opts: 4,
    pat: "NEET PG (NBEMS) pattern. Exactly 4 options (A-D), one correct; +4 for correct, -1 for wrong. Mostly 2-5 line clinical vignettes giving age, sex, presenting complaint, key examination findings and results, ending with ONE lead-in such as 'What is the most likely diagnosis?', 'What is the next best step in management?', 'What is the investigation of choice?', 'What is the drug of choice?' or 'Identify the structure/condition shown'. Mix in one-liner factual recall items, about one in five image-based items (describe the X-ray, CT, histology slide, instrument, ECG or clinical photo finding in words, then ask to identify it), integrated items linking two subjects, and PSM/biostatistics calculations where relevant. Options must be homogeneous and close; avoid 'all of the above', 'none of the above' and 'all except' wording.",
  },
  INI_CET: {
    name: 'INI-CET',
    opts: 4,
    pat: "INI-CET (AIIMS) pattern. Exactly 4 options (A-D); +1 correct, -1/3 wrong. About half single-best-answer clinical vignettes and half analytical formats: multiple-statement items ('Which of the following statements is/are correct? 1. ... 2. ... 3. ... 4. ...' with options such as '1 and 3 only', '2, 3 and 4 only'), match-the-following (List I with List II, options as code combinations like 'A-2, B-4, C-1, D-3'), assertion-reason (Assertion A / Reason R with the four standard options), arrange-in-correct-sequence, and recent-advances or guideline facts. Image-heavy topics describe the image in words. Distractors must be very close; elimination should be hard.",
  },
  AMC_CAT: {
    name: 'AMC CAT MCQ',
    opts: 5,
    pat: "AMC CAT MCQ pattern (Australia). Exactly 5 options (A-E), one best answer, no negative marking. Every item is a patient vignette set in Australian practice (general practice, emergency department, ward, rural or remote clinic) giving age, sex, history, examination and relevant results, ending with ONE lead-in such as 'What is the most appropriate next step in management?', 'What is the most likely diagnosis?', 'Which investigation is most appropriate?', 'What is the most appropriate advice?'. Test data gathering, data interpretation and management, favouring safe guideline-based next steps. Follow Australian sources: Therapeutic Guidelines (eTG), Australian Medicines Handbook, RACGP Red Book, John Murtagh's General Practice (safe diagnostic strategy: probability diagnosis, serious disorders not to be missed, pitfalls, masquerades, is the patient trying to tell me something), National Immunisation Program, state Mental Health Acts, consent and Gillick competence, mandatory reporting, Aboriginal and Torres Strait Islander health. Options must be homogeneous (all diagnoses, or all management steps).",
  },
};

const TIER_BEHAVIOUR: Record<string, string> = {
  LOW: 'EASY: still a short clinical vignette (never a bare one-line fact). One inferential step. Distractors are plausible and share the same category as the key, but the key is clearly best to a well-prepared candidate.',
  MEDIUM: 'MEDIUM: a full vignette. The candidate must first infer the diagnosis or mechanism, then choose the correct next step. Distractors are close mimickers or classic confusions, so recognising the buzzword alone does not give the answer.',
  HIGH: 'HARD: a long vignette with two or three reasoning steps, an atypical or overlapping presentation, and a recent-guideline or evidence-based decision point. Every distractor is individually defensible in some other scenario; only the exact details of THIS patient make one option best. Elimination must be hard and the key must not be guessable from keywords.',
};

const GENERATION_RULES =
  'Rules: medically accurate and current; do not invent doses or values; no two questions on the same fact; ' +
  'the stem must not contain a clue that gives the answer away; options must be homogeneous and of similar length; ' +
  'vary which option is correct across the batch (do not favour B or C).';

// Options that must keep their order (combination codes, "all of the above", ...) are never shuffled.
const NO_SHUFFLE = /\b(all|none|both|neither)\b.*\b(above|these|of the)\b|\b(a|b|c|d|e)\s*(and|&|,)\s*(a|b|c|d|e)\b|^\s*(a|b|c|d|e)\s*[,&]|\bonly\s*$|^\s*\d(\s*(,|and|&)\s*\d)+/i;

/** Models over-use B/C for the key. Shuffle so the position is not a tell. */
export function shuffleOptions(entries: { id: string; text: string }[], correctId: string): { entries: { id: string; text: string }[]; correct: string } {
  if (entries.length < 3 || entries.some((e) => NO_SHUFFLE.test(e.text))) return { entries, correct: correctId };
  const order = entries.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const ids = ['A', 'B', 'C', 'D', 'E'];
  const origCorrect = entries.findIndex((e) => e.id === correctId);
  return {
    entries: order.map((o, i) => ({ id: ids[i], text: entries[o].text })),
    correct: ids[order.indexOf(origCorrect)],
  };
}

interface BatchQuestionSpec {
  examType: string;
  subject: string;
  subtopic: string;
  cognitiveTier: string;
  difficultyTier: string;
  difficultySubLevel?: string;
  stem: string;
  questionText: string;
  options: Record<string, string>;
  correctOption: string;
  boardPearl: string;
  explanation?: string;
  citations: string[];
  trapType?: string;
  trapExplanation?: string;
  targetAccuracy?: number;
  figureModality?: string;
  figureQuery?: string;
}

export interface GenerateQuestionsOptions {
  exam: ExamType;
  count: number;
  subjectSubtopics: { subject: string; subtopics: string[] }[];
  difficultyTier: DifficultyTier;
  difficultySubLevel?: DifficultySubLevel;
  effort?: string;
  /** Section-14 options: question types / stem patterns / evidence sources / patient context */
  questionTypes?: string[];
  stemPatterns?: string[];
  evidenceSources?: string[];
  patientGroup?: string;
  presentingProblems?: string[];
  /** "My notes" source: real saved highlights/notes the questions must be derived from. */
  sourceMaterial?: string;
  /**
   * Ask for image-based items (~1 in 5) and attach a verified picture from the local
   * medical-image library when one matches the item's diagnosis.
   */
  includeImages?: boolean;
  /**
   * Learner's temporary generation profile (suggestion box in Practice Builder).
   * Sent as a user-message instruction for THIS run only; never persisted, never edited
   * into the system prompt.
   */
  customInstructions?: string;
  /** Progress after each completed batch: ready count, target total, batch number (1-based), planned batch count. */
  onProgress?: (ready: number, total: number, batch: number, totalBatches: number) => void;
  /** Called with the questions of each completed batch (after image attachment). */
  onBatch?: (batchQuestions: ClinicalQuestion[]) => Promise<void> | void;
  /** Shared array the caller uses to await all per-batch post-processing. */
  batchPromises?: Promise<void>[];
  /** Checked between batches; return true to stop early and keep everything generated so far. */
  shouldStop?: () => boolean;
  /** Aborts the in-flight batch request immediately (Stop button) and ends the loop. */
  signal?: AbortSignal;
  /** Called when a batch is being retried: 1-based attempt, attempt limit, and why. */
  onRetry?: (attempt: number, maxAttempts: number, reason: string) => void;
}

const SUB_LEVEL_DEFAULT: Record<'LOW' | 'MEDIUM' | 'HIGH', DifficultySubLevel> = {
  LOW: 'L1',
  MEDIUM: 'M1',
  HIGH: 'H1',
};

const TIER_ACCURACY: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 82,
  MEDIUM: 64,
  HIGH: 48,
};

const validCogTiers = ['Direct Recall', 'Clinical 2-Step', 'Multi-Step & IBQ'];
const tierToCog: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'Direct Recall',
  MEDIUM: 'Clinical 2-Step',
  HIGH: 'Multi-Step & IBQ',
};

/** setTimeout that resolves early (and harmlessly) when the run is aborted. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** Turns a provider error into one sentence a learner can act on. */
export function describeFailure(err: any): string {
  if (!err) return 'the provider returned nothing';
  const msg = String(err?.message || err).replace(/\s+/g, ' ').trim();
  if (/content[_ ]?filter|safety/i.test(msg)) {
    return 'the provider’s safety filter blocked that batch — retrying with clinical-only wording';
  }
  return msg.length > 220 ? msg.slice(0, 217) + '…' : msg;
}

/** Empty replies, 5xx and throttling are worth retrying; a missing login is not. */
function isRetryable(err: any): boolean {
  if (err instanceof AiError) return err.kind === 'api' || err.kind === 'network';
  return true;
}

let globalSeq = 0;
function nextId(exam: ExamType): string {
  globalSeq += 1;
  return `AI-${exam.replace('_', '')}-${Date.now().toString(36)}-${globalSeq}`;
}

/** Validate/repair one raw question from the model; null when it must be dropped. */
function buildQuestion(raw: any, exam: ExamType, pool: { subject: string; subtopic: string }[], tier: 'LOW' | 'MEDIUM' | 'HIGH', subLevel: DifficultySubLevel | undefined, requiredOptions: number): ClinicalQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const stem = typeof raw.stem === 'string' ? raw.stem.trim() : '';
  if (!stem) return null; // non-empty stem required

  // options: accept {"A": "...", ...} or [{id,text}]
  const entries: { id: string; text: string }[] = [];
  if (Array.isArray(raw.options)) {
    raw.options.forEach((o: any) => {
      if (o && typeof o.text === 'string' && o.text.trim()) {
        const id = (typeof o.id === 'string' ? o.id : '').trim().toUpperCase();
        if (['A', 'B', 'C', 'D', 'E'].includes(id)) entries.push({ id: id as any, text: o.text.trim() });
      }
    });
  } else if (raw.options && typeof raw.options === 'object') {
    for (const key of ['A', 'B', 'C', 'D', 'E']) {
      const text = raw.options[key];
      if (typeof text === 'string' && text.trim()) entries.push({ id: key as any, text: text.trim() });
    }
  }
  if (entries.length !== requiredOptions) return null; // each exam has a fixed option count

  const keyed = String(raw.correctOption ?? '').trim().toUpperCase();
  if (!entries.some((o) => o.id === keyed)) return null; // correctOption must exist among options
  const shuffled = shuffleOptions(entries, keyed);
  const correct = shuffled.correct;

  const requested = pool[Math.floor(Math.random() * pool.length)];
  const subject = typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : requested.subject;
  const subtopic = typeof raw.subtopic === 'string' && raw.subtopic.trim() ? raw.subtopic.trim() : requested.subtopic;

  const cogTier =
    validCogTiers.includes(raw.cognitiveTier) ? raw.cognitiveTier : tierToCog[tier];
  const aiTier: 'LOW' | 'MEDIUM' | 'HIGH' = ['LOW', 'MEDIUM', 'HIGH'].includes(raw.difficultyTier) ? raw.difficultyTier : tier;
  const targetAccuracy =
    typeof raw.targetAccuracy === 'number' && raw.targetAccuracy > 5 && raw.targetAccuracy < 100
      ? Math.round(raw.targetAccuracy)
      : TIER_ACCURACY[aiTier];

  return {
    id: nextId(exam),
    moduleCode: `${exam.replace('_', '-')} · AI Generated Module`,
    examType: exam,
    subject,
    subtopic,
    cognitiveTier: cogTier as ClinicalQuestion['cognitiveTier'],
    difficultyTier: aiTier,
    difficultySubLevel: subLevel || SUB_LEVEL_DEFAULT[aiTier],
    stem,
    questionText: typeof raw.questionText === 'string' && raw.questionText.trim() ? raw.questionText.trim() : stem,
    options: shuffled.entries.map((o) => ({ id: o.id as 'A' | 'B' | 'C' | 'D' | 'E', text: o.text })),
    correctOption: correct as ClinicalQuestion['correctOption'],
    boardPearl: typeof raw.boardPearl === 'string' ? raw.boardPearl.trim() : '',
    explanation: typeof raw.explanation === 'string' && raw.explanation.trim() ? raw.explanation.trim() : undefined,
    citations: Array.isArray(raw.citations)
      ? raw.citations.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim()).slice(0, 5)
      : [],
    trapType: typeof raw.trapType === 'string' && raw.trapType.trim() ? raw.trapType.trim() : undefined,
    trapExplanation: typeof raw.trapExplanation === 'string' && raw.trapExplanation.trim() ? raw.trapExplanation.trim() : undefined,
    targetAccuracy,
    figureModality: typeof raw.figureModality === 'string' && raw.figureModality.trim() ? raw.figureModality.trim() : undefined,
    figureQuery: typeof raw.figureQuery === 'string' && raw.figureQuery.trim() ? raw.figureQuery.trim() : undefined,
  };
}

/**
 * Generate `count` MCQs with the user's ACTIVE AI provider, in batches of <=10.
 * Returns validated ClinicalQuestion[] tagged sourceType:'ai-generator' plus the number dropped.
 */
export async function generateExamQuestions(options: GenerateQuestionsOptions): Promise<{ questions: ClinicalQuestion[]; dropped: number; stopped: boolean; failure: string | null; imagesAttached: number }> {
  const {
    exam, count, subjectSubtopics, difficultyTier, difficultySubLevel, effort,
    onProgress, onBatch, batchPromises, shouldStop, signal, onRetry,
    questionTypes, stemPatterns, evidenceSources, patientGroup, presentingProblems,
    sourceMaterial, customInstructions, includeImages,
  } = options;
  const learnerProfile = typeof customInstructions === 'string' ? customInstructions.trim().slice(0, 1500) : '';
  // Every picture comes from the internet at generation time (Wikimedia Commons + Open-i).
  // The lookup can be switched off in Settings.
  // Batch size depends on the provider: the Grok CLI proxy returns 500 Internal Server
  // Error for 3+ questions, so keep it to one. Other providers handle 5-10 fine.
  const activeProvider = getActiveProvider();
  const maxBatchSize = activeProvider === 'grok' ? 1 : (activeProvider === 'opencode' ? 10 : 5);
  const liveImages = includeImages && isLiveImageSearchEnabled();
  let attachedImages = 0;
  // Every picture may appear at most once in a module: ids of images already attached.
  const usedImages = new Set<string>();

  // Round-robin the subject -> subtopic pool so every batch samples across subjects.
  const pool: { subject: string; subtopic: string }[] = [];
  const subjectEntries = subjectSubtopics.map((s) => ({ subject: s.subject, subs: s.subtopics.filter((t) => typeof t === 'string' && t.trim()) }));
  const maxLen = Math.max(0, ...subjectEntries.map((s) => s.subs.length));
  for (let i = 0; i < maxLen; i++) {
    for (const entry of subjectEntries) {
      if (entry.subs[i]) pool.push({ subject: entry.subject, subtopic: entry.subs[i] });
    }
  }
  const workingPool = pool.length ? pool : [{ subject: subjectSubtopics[0]?.subject ?? 'General Medicine', subtopic: 'General Clinical Sciences' }];
  const poolSubjects = [...new Set(workingPool.map((p) => p.subject))];

  const tier: 'LOW' | 'MEDIUM' | 'HIGH' = difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier;
  const pattern = EXAM_PATTERNS[exam];
  const questions: ClinicalQuestion[] = [];
  let dropped = 0;
  let batch = 0;

  // Progressive batching: request batches of <=10 one after another until the target
  // count is reached. Batches that return unusable JSON or invalid items are refilled
  // by the next batch (with a bounded number of refill attempts so we can never loop
  // forever). Never padded with fake questions — the final count can be short when
  // the user stops early or the provider keeps failing.
  const plannedBatches = Math.ceil(count / 10);
  const maxBatches = plannedBatches * 3 + 4; // refill allowance
  let consecutiveFailed = 0;

  let stopped = false;
  // Why the run ended short (after retries), so the UI can say more than "try again".
  let failure: string | null = null;
  let waited: number | undefined;

  // Batches are independent requests, so run several at once instead of waiting for each
  // ten-question batch to finish. Four in flight keeps a 100-question run to a few minutes
  // without tripping provider rate limits; the pool drains as soon as the target is reached.
  const CONCURRENCY = Math.max(1, Math.min(activeProvider === 'grok' ? 1 : 4, plannedBatches));
  const seenStems = new Set<string>();
  let inFlightBatches = 0;
  const stemKey = (stem: string) =>
    stem.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 140);

  const runBatch = async (batchNumber: number): Promise<void> => {
    if (stopped || signal?.aborted || shouldStop?.()) { stopped = true; return; }
    if (questions.length >= count || batchNumber > maxBatches || consecutiveFailed >= 3) return;

    const batchSize = Math.min(maxBatchSize, count - questions.length);
    if (batchSize <= 0) return;
    const before = questions.length;

    // Sample distinct pool entries for this batch (loop if batch > pool size).
    const poolStart = ((batchNumber - 1) * batchSize) % workingPool.length;
    const batchPool: { subject: string; subtopic: string }[] = [];
    for (let i = 0; i < batchSize; i++) {
      batchPool.push(workingPool[(poolStart + i) % workingPool.length]);
    }

    const prompt = [
      `Write ${batchSize} NEW, exam-standard MCQs for ${pattern.name}.`,
      difficultyTier === 'ALL'
        ? `Difficulty: a realistic exam mix of about 20% easy, 45% medium and 35% hard. Set each item's "difficultyTier" (LOW / MEDIUM / HIGH) to match what you wrote.\n${TIER_BEHAVIOUR.LOW}\n${TIER_BEHAVIOUR.MEDIUM}\n${TIER_BEHAVIOUR.HIGH}`
        : `Difficulty: ${difficultyTier}${difficultySubLevel ? ` (sub-level ${difficultySubLevel})` : ''}. Every item must be at this level.\n${TIER_BEHAVIOUR[difficultyTier]}`,
      pattern.pat,
      // ---- section-14 writing options ----
      questionTypes && questionTypes.length
        ? `Mix these QUESTION TYPES across the batch (label each item's focus implicitly through the stem): ${questionTypes.join('; ')}. For "match the following" or "multiple statements" style, use the options to present the statement sets / roman-numeral choices inside the stem.`
        : '',
      stemPatterns && stemPatterns.length
        ? `Rotate the question ("questionText") around these STEM PATTERNS: ${stemPatterns.join('; ')}.`
        : '',
      evidenceSources && evidenceSources.length
        ? `Ground management/drug/screening answers in these evidence sources and name them in citations: ${evidenceSources.join('; ')}.`
        : '',
      patientGroup ? `Where clinically relevant, frame vignettes around this patient group: ${patientGroup}.` : '',
      presentingProblems && presentingProblems.length
        ? `Present the patients with these presenting problems where possible: ${presentingProblems.join('; ')}.`
        : '',
      sourceMaterial
        ? `Base every question on the learner's own saved notes below. Use only facts stated or directly implied there; do not add unrelated content. Cite the note's source in "citations".\n"""\n${sourceMaterial.slice(0, 12000)}\n"""`
        : '',
      includeImages
        ? `IMAGE-BASED ITEMS: whenever the stem refers to a visual finding — an ECG trace, radiograph, CT, MRI, ultrasound, histology slide, blood film, clinical photograph, fundus or similar — you MUST add two extra fields: "figureModality" (one of: ECG, X-ray, CT, MRI, Ultrasound, Histology, Clinical photo, Fundus) and "figureQuery" (a 3–8 word phrase naming the exact visual finding plus the diagnosis, e.g. "anterior STEMI ST elevation", "acute otitis media bulging tympanic membrane", "Reed-Sternberg Hodgkin lymphoma"). Aim for roughly 1 in 4 items to carry a figure when the topic is visual; there is no fixed quota but prefer adding a figure when one genuinely belongs. Write the stem so the question is still answerable from the described findings if no picture is found.`
        : '',
      // Nothing already written may come back in a later batch.
      questions.length
        ? `Do NOT repeat or lightly paraphrase any of these stems already written in this module:\n${questions
            .slice(-30)
            .map((q) => `- ${q.stem.replace(/\s+/g, ' ').slice(0, 180)}`)
            .join('\n')}`
        : '',
      // ---- original prompt ----
      `Allowed subjects and their subtopics (each question's subject+subtopic pair MUST come from this list, or omit both to let the app assign one):`,
      ...subjectSubtopics.map((s) => `- ${s.subject}: ${s.subtopics.join('; ')}`),
      '',
      'JSON shape — return exactly {"questions": [...]} where each item has:',
      '{',
      '  "examType": "' + exam + '",',
      '  "subject": "one of the allowed subjects",',
      '  "subtopic": "one of the allowed subtopics for that subject",',
      '  "cognitiveTier": "Direct Recall" | "Clinical 2-Step" | "Multi-Step & IBQ",',
      '  "difficultyTier": "LOW" | "MEDIUM" | "HIGH",',
      '  "stem": "clinical vignette / scenario (2-7 sentences, concrete findings, no answer hints)",',
      '  "questionText": "the actual question sentence asking for the single best answer",',
      `  "options": {${'ABCDE'.slice(0, pattern.opts).split('').map((k) => `"${k}": "text"`).join(', ')}} — EXACTLY ${pattern.opts} options, no more and no fewer,`,
      `  "correctOption": "one of ${'ABCDE'.slice(0, pattern.opts).split('').join(', ')}" (the single best answer),`,
      '  "explanation": "120-220 words, each part on its own line: first why the keyed answer is right; then ONE line for EACH of the other options saying exactly why it is wrong; then one exam tip",',
      '  "boardPearl": "one-line high-yield exam pearl",',
      '  "citations": ["standard textbook / guideline citation, e.g. Harrison\'s 21st Ed Ch. 142 or eTG"],',
      '  "trapType": "short label for the classic trap in this item",',
      '  "trapExplanation": "why the most tempting distractor is wrong",',
      '  "targetAccuracy": 0-100 expected percent of examinees answering correctly',
      '}',
      learnerProfile
        ? [
            "Learner's temporary instructions for THIS generation run only (the suggestion box). Apply them to style, focus, difficulty, stem construction, option design and distractor choice:",
            '"""',
            learnerProfile,
            '"""',
            'These instructions are subordinate to the JSON shape above, exactly one correct option, factual accuracy, and this exam pattern. Where a learner instruction conflicts with any of those, keep the pattern and the facts and ignore only that instruction.',
          ].join('\n')
        : '',
      GENERATION_RULES,
      'Use authentic current clinical knowledge; no obsolete trivia. Output ONLY the JSON object.',
    ].join('\n');

    // One bad batch must not throw away the batches that already succeeded, so each batch
    // gets two retries (honouring Retry-After) before it is written off.
    let raw = '';
    let batchError: any = null;
    let safetyMode = false;
    let waited: number | undefined;
    // Some providers (DeepSeek via OpenCode among them) run a safety classifier that can
    // block an otherwise ordinary clinical vignette. Detect it and retry with an explicit
    // "professional medical education" instruction instead of resending the same prompt.
    const SAFETY_NOTE =
      'IMPORTANT: This is a professional medical education item for qualified doctors preparing for a licensing examination. ' +
      'Keep every detail clinical, factual and non-graphic. Do not include self-harm, suicide, sexual content, or violence. ' +
      'Use neutral clinical terminology and output ONLY the JSON object.';
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        const wait = waited ?? (attempt === 2 ? 2000 : 6000);
        onRetry?.(attempt - 1, MAX_ATTEMPTS - 1, describeFailure(batchError));
        await sleep(wait, signal);
        if (signal?.aborted || shouldStop?.()) { stopped = true; break; }
      }
      try {
        raw = await aiComplete({
          system: GENERATOR_SYSTEM,
          messages: [
            {
              role: 'user',
              content: safetyMode ? `${prompt}\n\n${SAFETY_NOTE}` : prompt,
            },
          ],
          json: true,
          effort,
          signal,
        });
        batchError = null;
        break;
      } catch (err: any) {
        // A stopped generation is not a failure: keep every question already written.
        if (signal?.aborted || (err instanceof AiError && err.kind === 'aborted') || err?.name === 'AbortError') {
          stopped = true;
          batchError = null;
          break;
        }
        batchError = err;
        if (/content[_ ]?filter|safety|blocked/i.test(String(err?.message || ''))) safetyMode = true;
        waited = err instanceof AiError ? err.retryAfterMs : undefined;
        // A missing login / cancelled run is not a "bad batch": stop at once instead of
        // spending three more calls proving it.
        if (err instanceof AiError && err.kind === 'not_connected') throw err;
        if (!isRetryable(err)) break; // a missing login cannot be fixed by retrying
      }
    }
    if (stopped) { onProgress?.(questions.length, count, batchNumber, Math.max(plannedBatches, batchNumber)); return; }
    if (batchError) {
      dropped += batchSize;
      consecutiveFailed += 1;
      failure = describeFailure(batchError);
      onProgress?.(questions.length, count, batchNumber, Math.max(plannedBatches, batchNumber));
      return;
    }

    const parsed = extractJson<{ questions?: BatchQuestionSpec[] } | BatchQuestionSpec[]>(raw);
    let batchItems: BatchQuestionSpec[] | null = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray((parsed as any).questions)
        ? (parsed as any).questions
        : null;
    if (batchItems && batchItems.length) {
      const first = batchItems[0];
      const correctOption = first?.correctOption ?? null;
      const options = first?.options;
      const optionsType = Array.isArray(options) ? 'array' : typeof options;
      const optionsKeys = options && !Array.isArray(options) ? Object.keys(options).join(',') : '';
      // Cut-off reply: recover the complete questions that came before the cut.
      const salvaged = salvageQuestionObjects(raw) as BatchQuestionSpec[];
      if (salvaged.length) batchItems = salvaged;
    }

    if (!batchItems) {
      dropped += batchSize; // entire batch unusable
      consecutiveFailed += 1;
      onProgress?.(questions.length, count, batchNumber, Math.max(plannedBatches, batchNumber));
      return;
    }

    const batchQuestions: ClinicalQuestion[] = [];
    for (const item of batchItems) {
      if (questions.length >= count) break;
      const tierForItem = difficultyTier === 'ALL'
        ? (['LOW', 'MEDIUM', 'HIGH'] as const)[questions.length % 3]
        : tier;
      const q = buildQuestion(item, exam, batchPool, tierForItem, difficultySubLevel, pattern.opts);
      if (!q) continue;
      // Parallel batches cannot see each other's in-flight stems, so drop duplicates here.
      const key = stemKey(q.stem);
      if (seenStems.has(key)) continue;
      seenStems.add(key);
      // If the stem plainly describes a visual finding but the writer omitted the figure
      // fields, derive them from the keyed answer so the item still gets a real picture.
      if (includeImages && !q.figureQuery) {
        const stemAndPrompt = `${q.stem} ${q.questionText}`;
        // Modality keywords found in the stem itself.
        let modality: string | null =
          /\bECG\b|\belectrocardiogram\b|\bcardiogram\b/i.test(stemAndPrompt) ? 'ECG'
          : /\bX-?ray\b|\bradiograph\b|\bchest film\b/i.test(stemAndPrompt) ? 'X-ray'
          : /\bCT\b|\bcomputed tomography\b/i.test(stemAndPrompt) ? 'CT'
          : /\bMRI\b|\bmagnetic resonance\b/i.test(stemAndPrompt) ? 'MRI'
          : /\bultrasound\b|\bsonograph|\bechograph/i.test(stemAndPrompt) ? 'Ultrasound'
          : /\bhistolog|\bbiopsy\b|\bsmear\b|\bmicroscop/i.test(stemAndPrompt) ? 'Histology'
          : /\bfundus\b|\bretina\b|\bophthalmoscop/i.test(stemAndPrompt) ? 'Fundus'
          : /\bphotograph|\brash\b|\blesion\b|\bskin\b/i.test(stemAndPrompt) ? 'Clinical photo'
          : null;

        // Fallback: only trust an explicit visual keyword in the subtopic. A broad
        // subject→modality guess (cardiology→ECG) produced nonsense searches and
        // unrelated pictures, which is worse than a text-only item.
        if (!modality) {
          const topic = String(q.subtopic || '').toLowerCase();
          if (/\becg\b|\bekg\b|electrocardiogram|electrocardiograph/.test(topic)) modality = 'ECG';
          else if (/x-?ray|radiograph/.test(topic)) modality = 'X-ray';
          else if (/\bct\b|computed tomography/.test(topic)) modality = 'CT';
          else if (/\bmri\b|magnetic resonance/.test(topic)) modality = 'MRI';
          else if (/ultrasound|sonograph|echograph/.test(topic)) modality = 'Ultrasound';
          else if (/histolog|micrograph|biopsy slide/.test(topic)) modality = 'Histology';
          else if (/fundus|fundal/.test(topic)) modality = 'Fundus';
        }

        const topic = String(q.subtopic || q.subject || '')
          .replace(/\(.*?\)/g, ' ')
          // Only cut at a colon or a dash used as a separator — not inside hyphenated
          // names like "Oto-Rhino-Laryngology".
          .replace(/\s*[:—–]\s*.*$/, ' ')
          // "Fluoroscopy & Barium Studies" -> "Fluoroscopy"; generic words add nothing.
          .replace(/\s*&.*$/, ' ')
          .replace(/\b(studies|study|disorders?|diseases?|general|miscellaneous|others|overview|introduction)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .slice(0, 3)
          .join(' ');
        // Only derive a figureQuery when we have a modality — otherwise the query
        // would be too vague and could attach an unrelated picture.
        if (modality && topic) {
          q.figureModality = modality;
          // "Clinical photo" is never part of a Commons/Open-i title, so search the
          // topic alone for those; every other modality is a real search keyword.
          q.figureQuery = modality === 'Clinical photo' ? topic.slice(0, 48) : `${topic} ${modality}`.slice(0, 60);
        }
      }
      questions.push(q);
      batchQuestions.push(q);
    }

    // Every picture is fetched from the web at generation time (Commons + Open-i,
    // licence-filtered). Capped per batch so a slow network cannot stall generation.
    if (liveImages) {
      const pending = batchQuestions.filter((q) => !q.image && q.figureQuery).slice(0, 10);
      // Sequential, so two lookups can never reserve the same picture.
      for (const q of pending) {
        const live = await findLiveImage(q.figureQuery as string, usedImages);
        if (!live) continue;
        // Another worker may have claimed it while this lookup was in flight.
        if (usedImages.has(live.id)) continue;
        usedImages.add(live.id);
        q.image = live.proxyUrl;
        q.imageSourceUrl = live.articleUrl;
        q.imageCaption = liveImageCaption(live);
        attachedImages += 1;
      }
    }

    // Hand the completed batch to the caller for refinement / bank save / QA while the
    // remaining batches keep generating. Fire-and-forget: generation must not block on it.
    if (onBatch && batchQuestions.length) {
      const p = onBatch(batchQuestions);
      if (p && batchPromises) batchPromises.push(Promise.resolve(p));
    }

    // Everything requested but not delivered (invalid items or missing) counts as dropped.
    dropped += batchSize - (questions.length - before);
    consecutiveFailed = questions.length === before ? consecutiveFailed + 1 : 0;
    onProgress?.(questions.length, count, batchNumber, Math.max(plannedBatches, batchNumber));
  };

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    // Pull the next batch number until the target is reached, the budget is exhausted,
    // the provider keeps failing, or the learner stops the run. A new batch is only
    // started when the batches already in flight cannot cover the remaining questions —
    // otherwise the run waits for work it no longer needs.
    while (!stopped && !signal?.aborted && !shouldStop?.() && questions.length < count) {
      if (batch >= maxBatches || consecutiveFailed >= 3) break;
      if (questions.length + inFlightBatches * 10 >= count) break;
      batch += 1;
      inFlightBatches += 1;
      try {
        await runBatch(batch);
      } finally {
        inFlightBatches -= 1;
      }
      if (consecutiveFailed >= 3) break;
    }
    if (signal?.aborted || shouldStop?.()) stopped = true;
  });
  await Promise.all(workers);
  
  return { questions, dropped, stopped, failure, imagesAttached: attachedImages };
}
