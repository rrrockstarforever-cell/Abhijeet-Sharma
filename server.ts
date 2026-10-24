import express, { Request, Response } from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import {
  startLogin,
  pollLogin,
  completeLogin,
  status as oauthStatus,
  logout as oauthLogout,
  chat as oauthChat,
  listModels as oauthListModels,
  type OAuthChatMessage,
} from './server/oauth.mjs';
import { research as webResearch } from './server/web.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// User data dir (Electron passes PULSE_DATA_DIR=app.getPath('userData'); dev fallback keeps
// secrets OUT of the repository). The user's pasted Gemini key lives here, never in the repo.
const DATA_DIR = process.env.PULSE_DATA_DIR || path.join(os.homedir(), '.pulse-med');
const ENV_FILE = path.join(DATA_DIR, '.env');
try { dotenv.config({ path: ENV_FILE }); } catch { /* dev: file may not exist */ }

app.use(express.json());

// ==========================================
// PROVIDER CONFIG (real providers only)
// ==========================================

const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
};

// UI provider ids -> old oauth.mjs internal ids
const INTERNAL_PROVIDER: Record<string, string> = {
  chatgpt: 'codex',
  grok: 'xai',
  claude: 'claude',
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function geminiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

// Gemini client is created lazily and refreshed if the key changes, so a key pasted
// in Settings takes effect immediately without restarting the server.
let geminiClient: { key: string; client: GoogleGenAI } | null = null;
function getGemini(): GoogleGenAI | null {
  const key = geminiKey();
  if (!key) return null;
  if (!geminiClient || geminiClient.key !== key) {
    geminiClient = { key, client: new GoogleGenAI({ apiKey: key }) };
  }
  return geminiClient.client;
}

// Save the key the user pastes in Settings to <PULSE_DATA_DIR>/.env.
// Never echo the key back, never write it to the repository.
function saveGeminiKey(key: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let lines: string[] = [];
  if (fs.existsSync(ENV_FILE)) {
    lines = fs
      .readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '' && !/^GEMINI_API_KEY\s*=/.test(l));
  }
  lines.push(`GEMINI_API_KEY=${key}`, '');
  fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
  process.env.GEMINI_API_KEY = key;
}

function isProviderConnected(providerId: string): boolean {
  if (providerId === 'gemini') return Boolean(geminiKey());
  try {
    const s = oauthStatus();
    if (providerId === 'chatgpt') return Boolean(s.codex);
    if (providerId === 'grok') return Boolean(s.xai);
    if (providerId === 'claude') return Boolean(s.claude);
  } catch { /* treat storage failure as not connected */ }
  return false;
}

function notConnectedMessage(providerId: string): string {
  if (providerId === 'gemini') {
    return 'Gemini is not connected. Add your Gemini API key in Settings → AI Subscription Hub.';
  }
  return `${providerId.charAt(0).toUpperCase() + providerId.slice(1)} is not signed in. Connect an AI provider in Settings → AI Subscription Hub.`;
}

// Shared completion dispatcher used by /api/ai/complete and /api/ai/tutor-chat.
async function runCompletion(opts: {
  provider: string;
  model?: string;
  system?: string;
  messages: OAuthChatMessage[];
  json?: boolean;
  effort?: string;
  search?: boolean;
}): Promise<string> {
  const { provider, model, system, messages, json, effort, search } = opts;
  if (provider === 'gemini') {
    const ai = getGemini();
    if (!ai) throw new ApiError(notConnectedMessage('gemini'), 401);
    const model_ = model || DEFAULT_MODELS.gemini;
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const response = await ai.models.generateContent({
      model: model_,
      contents,
      config: {
        systemInstruction: system,
        temperature: 0.7,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    });
    return response.text || '';
  }

  const internal = INTERNAL_PROVIDER[provider];
  if (!internal) throw new ApiError(`Unknown AI provider: ${provider}`, 400);
  try {
    return await oauthChat({
      provider: internal as 'codex' | 'xai' | 'claude',
      model: model || DEFAULT_MODELS[provider],
      system,
      messages,
      json,
      effort,
      search,
    });
  } catch (err: any) {
    const msg = String(err?.message || 'AI request failed');
    if (/not signed in|login expired/i.test(msg)) {
      throw new ApiError(notConnectedMessage(provider), 401);
    }
    throw new ApiError(msg, 502);
  }
}

// ==========================================
// REAL OAUTH ROUTES (subscription sign-in)
// Tokens live in ~/.neet-pg-prep/oauth.json via server/oauth.mjs and are never
// returned to the browser. Same token file the old app used.
// ==========================================

// 1. GET /api/oauth/status: real connection state for all providers
app.get('/api/oauth/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    providers: {
      gemini: { connected: isProviderConnected('gemini') },
      chatgpt: { connected: isProviderConnected('chatgpt') },
      claude: { connected: isProviderConnected('claude') },
      grok: { connected: isProviderConnected('grok') },
    },
    defaults: DEFAULT_MODELS,
  });
});

// 2. POST /api/oauth/start: begin a real device-code / PKCE+paste-code flow
app.post('/api/oauth/start', async (req: Request, res: Response) => {
  const { provider } = req.body || {};
  const internal = INTERNAL_PROVIDER[provider];
  if (!internal) {
    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  }
  try {
    const started = await startLogin(internal as 'codex' | 'xai' | 'claude');
    if (internal === 'claude') {
      // UI adapter: login id doubles as the PKCE "state" for /complete
      return res.json({ provider, flow: 'pkce', authUrl: started.url, state: started.id });
    }
    // UI adapter: login id doubles as the "deviceCode" for /poll and /complete
    return res.json({
      provider,
      flow: 'device_code',
      userCode: started.userCode,
      verificationUri: started.url,
      deviceCode: started.id,
      interval: Math.max(3, started.interval || 5),
    });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Failed to start sign-in flow.' });
  }
});

// 3. POST /api/oauth/poll: poll a real device-code authorization
app.post('/api/oauth/poll', async (req: Request, res: Response) => {
  const { provider, deviceCode } = req.body || {};
  try {
    if (provider === 'claude') {
      // Claude uses the paste-code flow; authorization_pending until completeLogin succeeds.
      return res.json(
        isProviderConnected('claude')
          ? { status: 'success', connected: true }
          : { status: 'authorization_pending', connected: false },
      );
    }
    if (!deviceCode) {
      return res.status(400).json({ error: 'deviceCode is required.' });
    }
    const r = await pollLogin(String(deviceCode));
    if (r.status === 'done') return res.json({ status: 'success', connected: true });
    if (r.status === 'pending') return res.json({ status: 'authorization_pending', connected: false });
    const expired = /expired/i.test(r.error || '');
    return res.json({ status: expired ? 'expired' : 'error', error: r.error || 'Authorization failed.' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Poll failed.' });
  }
});

// 4. POST /api/oauth/complete: finish sign-in (Claude paste-code or device approval check)
app.post('/api/oauth/complete', async (req: Request, res: Response) => {
  const { provider, code, state, deviceCode } = req.body || {};
  try {
    if (provider === 'claude') {
      if (!code || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ error: 'Paste the code shown after you approve on the Claude page.' });
      }
      if (!state) {
        return res.status(400).json({ error: 'Sign-in state is missing. Restart the Claude sign-in.' });
      }
      await completeLogin(state, code.trim());
      return res.json({ success: true, connected: true, provider });
    }
    if (provider === 'chatgpt' || provider === 'grok') {
      if (!deviceCode) {
        return res.status(400).json({ error: 'deviceCode is required.' });
      }
      const r = await pollLogin(String(deviceCode));
      if (r.status === 'done') {
        return res.json({ success: true, connected: true, provider });
      }
      if (r.status === 'pending') {
        return res.status(400).json({
          error: 'Not approved yet. Approve the code on the provider page, then click Verify again.',
        });
      }
      return res.status(400).json({ error: r.error || 'Sign-in failed. Start a new sign-in.' });
    }
    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Sign-in failed.' });
  }
});

// 5. POST /api/oauth/logout: revoke the locally stored subscription tokens
app.post('/api/oauth/logout', (req: Request, res: Response) => {
  const { provider } = req.body || {};
  const internal = INTERNAL_PROVIDER[provider];
  if (!internal) {
    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  }
  try {
    oauthLogout(internal);
    return res.json({ ok: true, connected: false, provider });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Logout failed.' });
  }
});

// 6. POST /api/settings/gemini-key: save the Gemini API key the user pastes in Settings.
// NEVER echoes the key back.
app.post('/api/settings/gemini-key', (req: Request, res: Response) => {
  const key = String(req.body?.apiKey || '').trim();
  if (!/^[A-Za-z0-9_\-]{10,}$/.test(key)) {
    return res.status(400).json({ error: 'That does not look like a valid Gemini API key.' });
  }
  try {
    saveGeminiKey(key);
    getGemini();
    return res.json({ ok: true, connected: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not save the API key.' });
  }
});

// 6a. GET /api/models/available: the models THIS account may really use, asked of each
// provider with its own stored token. The models.dev catalogue is not account-aware, so it
// suggests ids a subscription login cannot call. Gemini has no OAuth here (API key), so it
// reports separately and never blocks the others.
let availableModelsCache: { at: number; payload: any } | null = null;

// A model listed by the provider is not necessarily runnable on this subscription: some need
// paid usage credits, some need a newer client version. Probe each model once with a tiny
// prompt and remember the verdict, so the picker only offers models that actually answer.
// Only definitive refusals hide a model; a timeout or 5xx keeps it (the failure is transient).
const modelVerdicts = new Map<string, { ok: boolean; reason?: string; at: number }>();
const VERDICT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFINITIVE_REFUSAL = /usage credits|credits are required|does not support this model|not supported|not found|no access|permission|not available|unknown model|invalid model|deprecated/i;

async function probeModel(uiId: string, modelId: string): Promise<{ ok: boolean; reason?: string }> {
  const key = `${uiId}:${modelId}`;
  const cached = modelVerdicts.get(key);
  if (cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached;
  let verdict: { ok: boolean; reason?: string } = { ok: true };
  try {
    const text = await Promise.race([
      runCompletion({ provider: uiId, model: modelId, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('probe timed out')), 45_000)),
    ]);
    verdict = { ok: Boolean(text && text.trim()) };
    if (!verdict.ok) verdict.reason = 'returned an empty reply';
  } catch (err: any) {
    const msg = String(err?.message || 'request failed');
    // Hide only on a definitive refusal; keep the model when the failure looks transient.
    verdict = DEFINITIVE_REFUSAL.test(msg) ? { ok: false, reason: msg.replace(/^Claude:\s*/i, '').slice(0, 140) } : { ok: true };
  }
  modelVerdicts.set(key, { ...verdict, at: Date.now() });
  return verdict;
}

app.get('/api/models/available', async (_req: Request, res: Response) => {
  if (availableModelsCache && Date.now() - availableModelsCache.at < 300_000) {
    return res.json(availableModelsCache.payload);
  }
  const providers: Record<string, { id: string; name: string; source: string }[]> = {};
  const errors: Record<string, string> = {};

  await Promise.all(
    (['claude', 'grok', 'chatgpt'] as const).map(async (uiId) => {
      if (!isProviderConnected(uiId)) {
        errors[uiId] = 'Not signed in.';
        providers[uiId] = [];
        return;
      }
      const internal = INTERNAL_PROVIDER[uiId];
      const result = await oauthListModels(internal as 'codex' | 'xai' | 'claude');
      const listed = (result.models || []).map((m) => ({ id: m.id, name: m.name || m.id, source: 'account' }));
      const verdicts = await Promise.all(listed.map((m) => probeModel(uiId, m.id)));
      providers[uiId] = listed.filter((_, i) => verdicts[i].ok);
      const hidden = listed
        .map((m, i) => ({ m, v: verdicts[i] }))
        .filter((x) => !x.v.ok);
      if (hidden.length) {
        errors[uiId] = `${hidden.length} listed model${hidden.length === 1 ? '' : 's'} hidden because your plan cannot run ${hidden.length === 1 ? 'it' : 'them'}: ` +
          hidden.map((x) => `${x.m.id} (${x.v.reason || 'refused'})`).join('; ');
      }
      if (result.error) errors[uiId] = result.error;
    }),
  );

  // Gemini is key-based: list from the public API when a key is present.
  if (isProviderConnected('gemini')) {
    try {
      const key = geminiKey();
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
      providers.gemini = ((b.models || []) as any[])
        .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => ({ id: String(m?.name || '').replace(/^models\//, ''), name: String(m?.displayName || m?.name || ''), source: 'account' }))
        .filter((m) => m.id);
    } catch (e: any) {
      providers.gemini = [];
      errors.gemini = e?.message || 'Could not list Gemini models.';
    }
  } else {
    providers.gemini = [];
    errors.gemini = 'No Gemini API key saved.';
  }

  const payload = { providers, errors, fetchedAt: new Date().toISOString() };
  availableModelsCache = { at: Date.now(), payload };
  return res.json(payload);
});

// 6b. GET /api/models/catalog: optional live model catalog from models.dev.
// Used by Settings to suggest current model ids / context sizes. Cached for an
// hour; a network failure is reported honestly (the static defaults still work).
const CATALOG_PROVIDER_MAP: Record<string, string> = {
  chatgpt: 'openai',
  claude: 'anthropic',
  gemini: 'google',
  grok: 'xai',
};
let modelsCatalogCache: { at: number; payload: any } | null = null;

app.get('/api/models/catalog', async (_req: Request, res: Response) => {
  if (modelsCatalogCache && Date.now() - modelsCatalogCache.at < 3_600_000) {
    return res.json(modelsCatalogCache.payload);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let raw: any;
    try {
      const upstream = await fetch('https://models.dev/api.json', { signal: controller.signal });
      if (!upstream.ok) throw new Error(`models.dev returned HTTP ${upstream.status}`);
      raw = await upstream.json();
    } finally {
      clearTimeout(timer);
    }
    const providers: Record<string, { id: string; name: string; context: number | null; released: string | null }[]> = {};
    for (const [ours, theirs] of Object.entries(CATALOG_PROVIDER_MAP)) {
      const entry = raw?.[theirs];
      const modelsObj = entry?.models && typeof entry.models === 'object' ? entry.models : {};
      providers[ours] = Object.values(modelsObj)
        .map((m: any) => ({
          id: typeof m?.id === 'string' ? m.id : '',
          name: typeof m?.name === 'string' ? m.name : (typeof m?.id === 'string' ? m.id : ''),
          context: typeof m?.limit?.context === 'number' ? m.limit.context : null,
          released: typeof m?.release_date === 'string' ? m.release_date : null,
        }))
        .filter((m) => m.id)
        .sort((a, b) => String(b.released ?? '').localeCompare(String(a.released ?? '')))
        .slice(0, 60);
    }
    const payload = { providers, fetchedAt: new Date().toISOString() };
    modelsCatalogCache = { at: Date.now(), payload };
    return res.json(payload);
  } catch (err: any) {
    return res.status(502).json({ error: `Could not load the live model catalog (${err?.message || 'network error'}).` });
  }
});

// ==========================================
// AI COMPLETION ROUTES
// ==========================================

// POST /api/ai/complete -> {text}. real provider calls only; errors are surfaced, never fabricated.
app.post('/api/ai/complete', async (req: Request, res: Response) => {
  const { provider, model, system, messages, json, effort } = req.body || {};
  if (!provider) {
    return res.status(400).json({ error: 'No AI provider selected. Connect an AI provider in Settings.' });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.some((m: any) => !m || typeof m.content !== 'string')) {
    return res.status(400).json({ error: 'messages must be an array of {role, content}.' });
  }
  try {
    const text = await runCompletion({ provider, model, system, messages, json, effort });
    if (!text || !text.trim()) {
      return res.status(502).json({ error: 'The AI provider returned an empty response. Try again.' });
    }
    return res.json({ success: true, text, model: model || DEFAULT_MODELS[provider] });
  } catch (err: any) {
    const status = err instanceof ApiError ? err.status : 502;
    return res.status(status).json({ error: err?.message || 'AI request failed.' });
  }
});

// ---------- tutor-chat (kept for AITutorView; backed by the same real completion path) ----------

const PERSONA_PROMPTS: Record<string, string> = {
  BOARD_MASTER: 'You are the PULSE MED Board Exam Master for NEET-PG / INI-CET / AMC CAT: razor-sharp high-yield clinical breakdowns, distractor (trap) dissection, and exam-board pearls.',
  ATTENDING: 'You are the PULSE MED Socratic Attending Physician on teaching rounds: reason step by step with the resident, ask and answer like a senior clinician.',
  PHARMACOLOGIST: 'You are the PULSE MED Mechanism & Kinetics Specialist: pharmacodynamics, pharmacokinetics, receptor and antimicrobial-resistance mechanisms explained precisely.',
};

function parseJsonBlock(raw: string): any | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end > -1) text = text.slice(0, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

app.post('/api/ai/tutor-chat', async (req: Request, res: Response) => {
  const body = req.body || {};
  const message: string = typeof body.message === 'string' ? body.message : '';
  const persona: string = typeof body.persona === 'string' ? body.persona : typeof body.activePersona === 'string' ? body.activePersona : 'BOARD_MASTER';
  const contextQuestion = body.contextQuestion;

  if (!message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  // The client sends its ACTIVE provider/model; if absent, resolve any connected provider.
  let provider: string = typeof body.provider === 'string' ? body.provider : '';
  if (!provider) {
    const candidates = ['chatgpt', 'claude', 'grok'];
    provider =
      candidates.find((p) => isProviderConnected(p)) || (isProviderConnected('gemini') ? 'gemini' : '');
  }
  if (!provider) {
    return res.status(401).json({ error: 'No AI provider is connected yet. Connect an AI provider in Settings → AI Subscription Hub.' });
  }

  const system = [
    'You are the PULSE MED clinical AI tutor for postgraduate medical exams (NEET-PG, INI-CET, AMC CAT).',
    typeof body.exam === 'string' && body.exam
      ? `The learner's active exam is ${String(body.exam).replace('_', '-')}. Tailor depth, terminology and guidelines to that exam (AMC CAT: Australian eTG/TGA and RACGP guidance; NEET-PG/INI-CET: Indian and international standard references).`
      : '',
    PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.BOARD_MASTER,
    'Rules:',
    '- High-yield, clinically grounded answers. Cite standard textbooks/guidelines when relevant (e.g., Harrison\'s Principles 21st Ed, Robbins Pathology 10th Ed, Australian Therapeutic Guidelines eTG).',
    '- Explain the cognitive trap and discriminative reasoning when dissecting a question.',
    contextQuestion?.stem
      ? `- The resident attached an exam question (subject: ${contextQuestion.subject || 'n/a'}, subtopic: ${contextQuestion.subtopic || 'n/a'}). Analyse it in context: correct answer, reasoning, and trap.\nAttached stem: "${contextQuestion.stem}"\nMarked key: ${contextQuestion.correctOption || 'n/a'}${contextQuestion.trapExplanation ? `\nKnown trap note: ${String(contextQuestion.trapExplanation).slice(0, 400)}` : ''}`
      : '',
    'Respond with ONLY a single valid JSON object (no markdown fences) shaped exactly like:',
    '{"reply": "your main markdown answer", "reasoningSteps": [{"step": "short step name", "detail": "one or two sentences"}], "pearl": "one-line high-yield board pearl or empty string", "citations": ["textbook / guideline citations"], "suggestedFollowups": ["2-3 probing follow-up questions the resident could ask next"]}',
    '- reasoningSteps: 2-5 steps when the answer involves reasoning; may be empty for simple facts.',
    '- "reply" must contain the complete answer itself, not a summary of the other fields.',
  ]
    .filter(Boolean)
    .join('\n');

  const history: OAuthChatMessage[] = Array.isArray(body.history)
    ? body.history
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-8)
        .map((m: any) => ({ role: m.role, content: m.content }))
    : [];

  const messages: OAuthChatMessage[] = [...history, { role: 'user', content: message }];

  try {
    const raw = await runCompletion({
      provider,
      model: typeof body.model === 'string' ? body.model : undefined,
      system,
      messages,
      json: true,
      effort: typeof body.effort === 'string' ? body.effort : undefined,
    });

    const parsed = parseJsonBlock(raw);
    let reply: string | null = null;
    if (parsed && !Array.isArray(parsed) && typeof parsed.reply === 'string' && parsed.reply.trim()) {
      reply = parsed.reply;
    }
    if (!reply) {
      // fall back to plain text in "reply" — never fabricate structured content
      reply = raw.trim();
    }

    const result: any = { success: true, reply, modelUsed: body.model || DEFAULT_MODELS[provider] };

    if (parsed && !Array.isArray(parsed)) {
      if (Array.isArray(parsed.reasoningSteps)) {
        const steps = parsed.reasoningSteps
          .filter((s: any) => s && typeof s.step === 'string' && typeof s.detail === 'string' && s.step.trim() && s.detail.trim())
          .map((s: any) => ({ step: s.step, detail: s.detail }))
          .slice(0, 6);
        if (steps.length) result.reasoningSteps = steps;
      }
      if (typeof parsed.pearl === 'string' && parsed.pearl.trim()) result.pearl = parsed.pearl.trim();
      if (Array.isArray(parsed.citations)) {
        const citations = parsed.citations.filter((c: any) => typeof c === 'string' && c.trim()).slice(0, 6);
        if (citations.length) result.citations = citations;
      }
      if (Array.isArray(parsed.suggestedFollowups)) {
        const followups = parsed.suggestedFollowups.filter((f: any) => typeof f === 'string' && f.trim()).slice(0, 4);
        if (followups.length) result.suggestedFollowups = followups;
      }
    }

    return res.json(result);
  } catch (err: any) {
    const status = err instanceof ApiError ? err.status : 502;
    return res.status(status).json({ error: err?.message || 'AI request failed.' });
  }
});

// POST /api/web/research {query} -> real internet search (DuckDuckGo + PubMed).
// Sources carry their URLs; the client may ask the AI to summarise them. Never canned.
app.post('/api/web/research', async (req: Request, res: Response) => {
  const query = typeof req.body?.query === 'string' ? req.body.query : '';
  try {
    const out = await webResearch(query);
    return res.json({ success: true, sources: out.sources, retrievedAt: out.retrievedAt });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Web research failed.' });
  }
});

// Legacy provider list endpoint, now reporting ONLY real connection state (no latency fakes).
app.get('/api/providers/status', (req: Request, res: Response) => {
  res.json({
    providers: (['gemini', 'chatgpt', 'claude', 'grok'] as string[]).map((id) => ({
      id,
      model: DEFAULT_MODELS[id],
      connected: isProviderConnected(id),
    })),
  });
});

// Mount Vite middleware in development or serve static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[Pulse Med Server] Running on http://127.0.0.1:${PORT}`);
  });
}

startServer();
