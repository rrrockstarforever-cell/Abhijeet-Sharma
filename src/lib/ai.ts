// Client-side AI library for Pulse Med.
// Real provider calls only (via /api/ai/complete on the local Express server).
// No silent fallbacks: every failure is thrown as a typed AiError and must be shown in the UI.
import type { ClinicalQuestion, ExamType, DifficultyTier, DifficultySubLevel } from '../types.ts';

import { AMC_BLUEPRINT, getDifficultyDescription } from "./amcBlueprint";
import { findLiveImage, liveImageCaption, isLiveImageSearchEnabled } from '../utils/liveImages.ts';
import { DUPLICATE_SIMILARITY, stemSimilarity, toBenchItem } from './benchmark.ts';

/**
 * Shape of each item by its position in the set: mostly single best answer, one in four asks which
 * option is incorrect or NOT true, and only one in eight is a numbered-statements item.
 */
const SINGLE_BEST_ANSWER = 'Use a single best answer lead-in (diagnosis, next step, drug of choice or investigation). Do not use a numbered statements list.';

function itemShape(idx: number, exam: ExamType): string {
  // NEET-PG and AMC CAT papers are single-best-answer throughout (recall papers, sample items);
  // only INI-CET mixes in statement and incorrect-option items.
  if (exam !== 'INI_CET') return SINGLE_BEST_ANSWER;
  const slot = idx % 8;
  if (slot === 2 || slot === 6) return 'Ask which option is INCORRECT, FALSE or NOT true; exactly one option is the answer.';
  if (slot === 4) return 'Use a single best answer lead-in such as "Which is the most appropriate ...?". Do not use a numbered statements list.';
  if (slot === 7) return 'This item may use a numbered statements list (1, 2, 3, 4) with "1 and 3 only"-style options.';
  return 'Use a single best answer lead-in (diagnosis, next step, drug of choice or investigation). Do not use a numbered statements list.';
}

/** Splits a subtopic such as "Anticancer Chemotherapy: Alkylating Agents, Antimetabolites & MAbs" into its parts. */
function focusParts(subtopic: string): string[] {
  const after = subtopic.includes(':') ? subtopic.split(':').slice(1).join(':') : subtopic;
  return after.split(/,|&| and /).map((s) => s.trim()).filter(Boolean);
}
export type AiProviderId = 'gemini' | 'chatgpt' | 'claude' | 'grok' | 'opencode' | 'nvidia';

export const AI_PROVIDER_IDS: AiProviderId[] = ['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'nvidia'];

// Server defaults (mirrored in server.ts); models are user-selectable and persisted
// in localStorage as `ai.model.<provider>` and sent with every request.
export const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
  // OpenCode Console / Go (https://opencode.ai/inference) — any model id the account has.
  opencode: 'deepseek-v4.1-flash',
  // Custom OpenAI-compatible endpoint — user supplies URL, model id and key.
  custom: 'gpt-4o-mini',
  // NVIDIA NIM API — OpenAI-compatible endpoint at integrate.api.nvidia.com/v1.
  nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
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
    pat: "NEET PG (NBEMS) pattern. Exactly 4 options (A-D), one correct; +4 for correct, -1 for wrong. Mostly 2-5 line clinical vignettes giving age, sex, presenting complaint, key examination findings and results, ending with ONE lead-in such as 'What is the most likely diagnosis?', 'What is the next best step in management?', 'What is the investigation of choice?', 'What is the drug of choice?' or 'Identify the structure/condition shown'. Mix in one-liner factual recall items, about one in five image-based items (describe the X-ray, CT, histology slide, instrument, ECG or clinical photo finding in words, then ask to identify it), integrated items linking two subjects, and PSM/biostatistics calculations where relevant. Every item is single best answer: no numbered-statement, match-the-following or assertion-reason items. Options must be homogeneous and close; avoid 'all of the above', 'none of the above' and 'all except' wording.",
  },
  INI_CET: {
    name: 'INI-CET',
    opts: 4,
    pat: "INI-CET (AIIMS) pattern. Exactly 4 options (A-D); +1 correct, -1/3 wrong. Most items (about seven in eight) are single-best-answer items: clinical vignettes, drug of choice, next step, or factual recall. About one item in five asks which option is INCORRECT, FALSE or NOT true (for example 'Which of the following is NOT a feature of ...?'). Numbered multiple-statement items ('Which of the following statements is/are correct? 1. ... 2. ... 3. ... 4. ...' with options such as '1 and 3 only', '2, 3 and 4 only') are rare, at most one item in eight. Match-the-following (List I with List II, options as code combinations like 'A-2, B-4, C-1, D-3'), assertion-reason (Assertion A / Reason R with the four standard options), arrange-in-correct-sequence, and recent-advances or guideline facts. Image-heavy topics describe the image in words. Distractors must be very close; elimination should be hard.",
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
  // The learner selected a specific topic; trust that over whatever subtopic string the
  // model chose to put in its JSON. The model frequently "drifts" to a neighbouring
  // subtopic (e.g. you ask for "Antifungal & Antiviral Drugs" and it returns "Antibiotics"),
  // which is why question pools came out mixed. Subject is honoured the same way.
  const subject = typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : requested.subject;
  const subtopic = requested.subtopic;

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
  const activeProvider = getActiveProvider();
  const liveImages = includeImages && isLiveImageSearchEnabled();
  let attachedImages = 0;
  const usedImages = new Set<string>();

  const tier: 'LOW' | 'MEDIUM' | 'HIGH' = difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier;
  const pattern = EXAM_PATTERNS[exam];
  const questions: ClinicalQuestion[] = [];
  let dropped = 0;

  let stopped = false;
  let failure: string | null = null;
  const seenStems = new Set<string>();
  const acceptedStems: string[] = [];
  const stemKey = (stem: string) =>
    stem.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 140);

  // ---------- Step 1: Topic Planning ----------
  // Ask the backend to plan topic distribution with importance weighting.
  // Higher priority topics are repeated more often across concurrent batches.
  const planTopics = async (): Promise<{ subject: string; subtopic: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }[] | null> => {
    try {
      const res = await fetch('/api/ai/plan-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectSubtopics,
          count,
          difficultyTier,
          provider: activeProvider || 'gemini',
          model: getEffectiveModel(activeProvider || 'gemini'),
          exam,
          effort,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.topics)) return null;
      return data.topics.map((t: any) => ({
        subject: t.subject,
        subtopic: t.subtopic,
        difficultyTier: (t.difficultyTier ?? tier) as 'LOW' | 'MEDIUM' | 'HIGH',
      }));
    } catch {
      return null;
    }
  };

  const plannedTopics = await planTopics();

  // Build the subject/subtopic pool as fallback.
  const pool: { subject: string; subtopic: string }[] = [];
  const subjectEntries = subjectSubtopics.map((s) => ({ subject: s.subject, subs: s.subtopics.filter((t) => typeof t === 'string' && t.trim()) }));
  const maxLen = Math.max(0, ...subjectEntries.map((s) => s.subs.length));
  for (let i = 0; i < maxLen; i++) {
    for (const entry of subjectEntries) {
      if (entry.subs[i]) pool.push({ subject: entry.subject, subtopic: entry.subs[i] });
    }
  }
  const workingPool = pool.length ? pool : [{ subject: subjectSubtopics[0]?.subject ?? 'General Medicine', subtopic: 'General Clinical Sciences' }];

  // ---------- Step 2: Select topic subsets for concurrent batches ----------
  // For 50-100 questions, we select subsets of 10 topics per concurrent batch.
  // Important topics (higher priority) appear more often in the topic list.
  const topics: { subject: string; subtopic: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }[] = plannedTopics ??
    Array.from({ length: count }, (_, i) => ({
      ...workingPool[i % workingPool.length],
      difficultyTier: tier,
    }));

  // ---------- Step 3: Single-question generation ----------
  const generateSingleQuestion = async (topic: { subject: string; subtopic: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }, attempt: number, focus?: string, shape?: string): Promise<ClinicalQuestion | null> => {
    if (signal?.aborted || shouldStop?.()) { stopped = true; return null; }

    const prompt = [
      `Write ONE exam-standard MCQ for ${pattern.name}.`,
      `Subject: ${topic.subject}`,
      `Subtopic: ${topic.subtopic}`,
      // Rotate the set across the subtopic's parts (drug classes, systems) so one regimen
      // is not written again and again.
      focus ? `Focus this item on: ${focus}. Use a different drug, regimen or scenario from the usual textbook example.` : '',
      shape ?? '',
      'Make the four options similar in length and detail. The correct option must not be the longest or the most detailed.',
      `Difficulty: ${topic.difficultyTier}. ${TIER_BEHAVIOUR[topic.difficultyTier]}`,
      pattern.pat,
      questionTypes?.length ? `Question type focus: ${questionTypes.join('; ')}.` : '',
      stemPatterns?.length ? `Stem pattern: ${stemPatterns.join('; ')}.` : '',
      evidenceSources?.length ? `Ground answers in: ${evidenceSources.join('; ')}.` : '',
      patientGroup ? `Patient group: ${patientGroup}.` : '',
      presentingProblems?.length ? `Presenting problems: ${presentingProblems.join('; ')}.` : '',
      sourceMaterial ? `Base on these notes: """${sourceMaterial.slice(0, 6000)}""".` : '',
      includeImages
        ? 'If this item is image-based (about one in five items must be), describe the finding in the stem AND set "figureModality" and "figureQuery" so a real picture can be fetched: "figureModality" is one of ECG | X-ray | CT | MRI | ultrasound | histology | fundus | clinical photo, and "figureQuery" is a 3-6 word English search phrase naming the diagnosis + modality (e.g. "atrial fibrillation ECG", "lobar pneumonia chest X-ray", "membranous nephropathy histology"). For items that are NOT image-based, set both to an empty string — never invent a picture.'
        : '',
      `JSON shape — return exactly one object: { "examType": "${exam}", "subject": "${topic.subject}", "subtopic": "${topic.subtopic}", "cognitiveTier": "Direct Recall | Clinical 2-Step | Multi-Step & IBQ", "difficultyTier": "${topic.difficultyTier}", "stem": "...", "questionText": "...", "options": {${'ABCDE'.slice(0, pattern.opts).split('').map(k => `"${k}": "text"`).join(', ')}}, "correctOption": "A|B|C|D|E", "explanation": "...", "boardPearl": "...", "citations": [...], "trapType": "...", "trapExplanation": "...", "targetAccuracy": 0-100${includeImages ? ', "figureModality": "", "figureQuery": ""' : ''} }`,
      learnerProfile ? `Learner instructions: """${learnerProfile}"""` : '',
      'Output ONLY the JSON object.',
    ].join('\n');

    const MAX_ATTEMPTS = 3;
    for (let a = attempt; a <= MAX_ATTEMPTS; a++) {
      if (signal?.aborted || shouldStop?.()) { stopped = true; return null; }
      try {
        const raw = await aiComplete({
          system: GENERATOR_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
          json: true,
          effort,
          signal,
        });
        const parsed = extractJson<BatchQuestionSpec>(raw);
        if (!parsed) return null;

        const q = buildQuestion(parsed, exam, [{ subject: topic.subject, subtopic: topic.subtopic }], topic.difficultyTier, difficultySubLevel, pattern.opts);
        if (!q) return null;

        // Dedup against already-accepted questions: exact stems, then near-identical scenarios
        // (same patient and regimen with the words reshuffled).
        const key = stemKey(q.stem);
        if (seenStems.has(key)) return null;
        const fullStem = toBenchItem(q).stem;
        if (acceptedStems.some((s) => stemSimilarity(s, fullStem) >= DUPLICATE_SIMILARITY)) return null;
        seenStems.add(key);
        acceptedStems.push(fullStem);

        // Attach image if this item actually asked for one. Previously this read
        // `!q.figureQuery` and then searched with `q.figureQuery || ''` — an empty
        // string — so it never matched anything. Now we only attach when the model
        // flagged the item as image-based and supplied a search phrase, AND the figure
        // passed the vision check (findLiveImage returns only verified figures).
        if (includeImages && liveImages && q.figureQuery) {
          const live = await findLiveImage(q.figureQuery, usedImages);
          if (live && !usedImages.has(live.id)) {
            usedImages.add(live.id);
            q.image = live.proxyUrl;
            q.imageSourceUrl = live.articleUrl;
            q.imageCaption = liveImageCaption(live);
            q.imageId = live.id;
            q.imageLicence = live.licence;
            q.imageGroundTruth = q.figureQuery;
            q.imageVerified = live.verified === true;
            q.imageVerifyReason = live.verifyReason;
            attachedImages += 1;
          }
        }

        return q;
      } catch (err: any) {
        if (signal?.aborted || (err instanceof AiError && err.kind === 'aborted') || err?.name === 'AbortError') {
          stopped = true;
          return null;
        }
        if (err instanceof AiError && err.kind === 'not_connected') throw err;
        if (!isRetryable(err)) break;
      }
    }
    return null;
  };

  // ---------- Step 4: Fire all question-generation requests in parallel ----------
  // Use a completion counter that updates progress as each question finishes.
  let completedCount = 0;
  const questionPromises = topics.map((topic, idx) => {
    const parts = focusParts(topic.subtopic);
    const focus = parts.length > 1 ? parts[idx % parts.length] : undefined;
    return generateSingleQuestion(topic, 0, focus, itemShape(idx, exam)).then((q) => {
      // Update progress as each question completes (not after all finish).
      completedCount += 1;
      if (q) {
        questions.push(q);
      }
      onProgress?.(questions.length, count, completedCount, topics.length);
      // Fire onBatch periodically (every ~25% of completion).
      if (onBatch && questions.length > 0 && completedCount % Math.max(1, Math.floor(topics.length / 4)) === 0) {
        const p = onBatch(questions.slice());
        if (p && batchPromises) batchPromises.push(Promise.resolve(p));
      }
      return q;
    });
  });
  const results = await Promise.all(questionPromises);

  // Dedup by stem (already done in generateSingleQuestion, but double-check).
  const unique = questions.filter((q, i) => questions.findIndex((x) => x.stem === q.stem) === i);
  questions.length = 0;
  questions.push(...unique);

  // Count dropped (questions requested but not delivered).
  dropped = count - questions.length;

  // ---------- Step 5: Attach images for any remaining image-based items ----------
  // Only items the model marked image-based (non-empty figureQuery) get a picture.
  // The old code fell back to `stem.slice(0, 48)` and so attached a loosely-related
  // (or irrelevant) figure to EVERY question — that is why images looked "messed up".
  if (includeImages && liveImages && questions.length > 0) {
    // Process images sequentially to avoid rate limiting.
    for (const q of questions) {
      if (signal?.aborted || shouldStop?.()) { stopped = true; break; }
      if (q.image) continue;      // already has an image
      if (!q.figureQuery) continue; // not an image-based item — leave it text-only

      const live = await findLiveImage(q.figureQuery, usedImages);
      if (live && !usedImages.has(live.id)) {
        usedImages.add(live.id);
        q.image = live.proxyUrl;
        q.imageSourceUrl = live.articleUrl;
        q.imageCaption = liveImageCaption(live);
        q.imageId = live.id;
        q.imageLicence = live.licence;
        q.imageGroundTruth = q.figureQuery;
        q.imageVerified = live.verified === true;
        q.imageVerifyReason = live.verifyReason;
        attachedImages += 1;
      }
    }
  }

  return { questions, dropped, stopped, failure: null, imagesAttached: attachedImages };
}
