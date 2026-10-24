// Client-side AI library for Pulse Med.
// Real provider calls only (via /api/ai/complete on the local Express server).
// No silent fallbacks: every failure is thrown as a typed AiError and must be shown in the UI.
import type { ClinicalQuestion, ExamType, DifficultyTier, DifficultySubLevel } from '../types.ts';

export type AiProviderId = 'gemini' | 'chatgpt' | 'claude' | 'grok';

export const AI_PROVIDER_IDS: AiProviderId[] = ['gemini', 'chatgpt', 'claude', 'grok'];

// Server defaults (mirrored in server.ts); models are user-selectable and persisted
// in localStorage as `ai.model.<provider>` and sent with every request.
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
};

export const NOT_CONNECTED_MESSAGE = 'Connect an AI provider in Settings → AI Subscription Hub.';

export class AiError extends Error {
  kind: 'not_connected' | 'api' | 'network' | 'invalid';
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
  return getModel(provider) ?? DEFAULT_MODELS[provider];
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw new AiError(`Could not reach the local AI server (${err?.message || 'network error'}).`, 'network');
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const srvMsg = typeof data?.error === 'string' ? data.error : `AI request failed (HTTP ${res.status}).`;
    if (res.status === 401) throw new AiError(`${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. ${NOT_CONNECTED_MESSAGE}`, 'not_connected');
    throw new AiError(srvMsg, 'api');
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

// ---------- AI exam-question generation ----------

const GENERATOR_SYSTEM = `You are an expert medical exam item writer for NEET-PG, INI-CET and the AMC CAT.
You write authentic, clinically rigorous single-best-answer MCQs with exactly one clearly correct option and plausible distractors.
Always respond with ONLY a single valid JSON object (no markdown fences, no commentary).`;

const TIER_BEHAVIOUR: Record<string, string> = {
  LOW: 'Direct-recall style: clear stem, characteristic finding or guideline fact; distractors must be obviously wrong to the well-prepared.',
  MEDIUM: 'Clinical 2-step reasoning: a short vignette, the reader must infer the diagnosis/mechanism first, then pick the correct next step; distractors are mimickers or classic confusions.',
  HIGH: 'Multi-step / IBQ style: longer vignette or management sequence, subtle traps, atypical presentations or evidence-based next best step; distractors are individually defensible but one is clearly best.',
};

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
  citations: string[];
  trapType?: string;
  trapExplanation?: string;
  targetAccuracy?: number;
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
  /** Progress after each completed batch: ready count, target total, batch number (1-based), planned batch count. */
  onProgress?: (ready: number, total: number, batch: number, totalBatches: number) => void;
  /** Checked between batches; return true to stop early and keep everything generated so far. */
  shouldStop?: () => boolean;
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

let globalSeq = 0;
function nextId(exam: ExamType): string {
  globalSeq += 1;
  return `AI-${exam.replace('_', '')}-${Date.now().toString(36)}-${globalSeq}`;
}

/** Validate/repair one raw question from the model; null when it must be dropped. */
function buildQuestion(raw: any, exam: ExamType, pool: { subject: string; subtopic: string }[], tier: 'LOW' | 'MEDIUM' | 'HIGH', subLevel?: DifficultySubLevel): ClinicalQuestion | null {
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
  if (entries.length < 4 || entries.length > 5) return null; // 4-5 options required

  const correct = String(raw.correctOption ?? '').trim().toUpperCase();
  if (!entries.some((o) => o.id === correct)) return null; // correctOption must exist among options

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
    options: entries.map((o) => ({ id: o.id as 'A' | 'B' | 'C' | 'D' | 'E', text: o.text })),
    correctOption: correct as ClinicalQuestion['correctOption'],
    boardPearl: typeof raw.boardPearl === 'string' ? raw.boardPearl.trim() : '',
    citations: Array.isArray(raw.citations)
      ? raw.citations.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim()).slice(0, 5)
      : [],
    trapType: typeof raw.trapType === 'string' && raw.trapType.trim() ? raw.trapType.trim() : undefined,
    trapExplanation: typeof raw.trapExplanation === 'string' && raw.trapExplanation.trim() ? raw.trapExplanation.trim() : undefined,
    targetAccuracy,
  };
}

/**
 * Generate `count` MCQs with the user's ACTIVE AI provider, in batches of <=10.
 * Returns validated ClinicalQuestion[] tagged sourceType:'ai-generator' plus the number dropped.
 */
export async function generateExamQuestions(options: GenerateQuestionsOptions): Promise<{ questions: ClinicalQuestion[]; dropped: number }> {
  const {
    exam, count, subjectSubtopics, difficultyTier, difficultySubLevel, effort,
    onProgress, shouldStop,
    questionTypes, stemPatterns, evidenceSources, patientGroup, presentingProblems,
    sourceMaterial,
  } = options;

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

  while (questions.length < count && batch < maxBatches && consecutiveFailed < 3) {
    if (shouldStop?.()) break;
    batch += 1;
    const batchSize = Math.min(10, count - questions.length);
    const before = questions.length;

    // Sample distinct pool entries for this batch (loop if batch > pool size).
    const poolStart = ((batch - 1) * batchSize) % workingPool.length;
    const batchPool: { subject: string; subtopic: string }[] = [];
    for (let i = 0; i < batchSize; i++) {
      batchPool.push(workingPool[(poolStart + i) % workingPool.length]);
    }

    const prompt = [
      `Write ${batchSize} exam MCQs for the ${exam.replace('_', '-')} exam.`,
      `Difficulty tier: ${difficultyTier === 'ALL' ? 'adaptive mix (vary LOW / MEDIUM / HIGH across questions)' : difficultyTier}${difficultySubLevel ? ` (sub-level ${difficultySubLevel})` : ''}.`,
      TIER_BEHAVIOUR[difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier],
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
      '  "options": {"A": "text", "B": "text", "C": "text", "D": "text", "E": "text (optional 5th)"},',
      `  "correctOption": "A" (single best answer, 4-5 options total)${exam === 'AMC_CAT' ? ' — AMC CAT style: pick the single most appropriate next step or diagnosis' : ''},`,
      '  "boardPearl": "one-line high-yield exam pearl",',
      '  "citations": ["standard textbook / guideline citation, e.g. Harrison\'s 21st Ed Ch. 142 or eTG"],',
      '  "trapType": "short label for the classic trap in this item",',
      '  "trapExplanation": "why the most tempting distractor is wrong",',
      '  "targetAccuracy": 0-100 expected percent of examinees answering correctly',
      '}',
      `${exam === 'NEET_PG' ? 'NEET-PG style: NBE clinical vignettes, +4/-1 scoring mindset.' : exam === 'INI_CET' ? 'INI-CET style: AIIMS clinical matrix, assertion-reasoning depth.' : 'AMC CAT style: Australian practice (TGA/eTG medications, Australian screening schedules).'}`,
      'Use authentic current clinical knowledge; no obsolete trivia. Output ONLY the JSON object.',
    ].join('\n');

    const raw = await aiComplete({
      system: GENERATOR_SYSTEM,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      json: true,
      effort,
    });

    const parsed = extractJson<{ questions?: BatchQuestionSpec[] } | BatchQuestionSpec[]>(raw);
    const batchItems: BatchQuestionSpec[] | null = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray((parsed as any).questions)
        ? (parsed as any).questions
        : null;

    if (!batchItems) {
      dropped += batchSize; // entire batch unusable
      consecutiveFailed += 1;
    } else {
      for (const item of batchItems) {
        if (questions.length >= count) break;
        const tierForItem = difficultyTier === 'ALL'
          ? (['LOW', 'MEDIUM', 'HIGH'] as const)[questions.length % 3]
          : tier;
        const q = buildQuestion(item, exam, batchPool, tierForItem, difficultySubLevel);
        if (q) questions.push(q);
      }
      // Everything requested but not delivered (invalid items or missing) counts as dropped.
      dropped += batchSize - (questions.length - before);
      consecutiveFailed = questions.length === before ? consecutiveFailed + 1 : 0;
    }

    onProgress?.(questions.length, count, batch, Math.max(plannedBatches, batch));
  }

  return { questions, dropped };
}
