import express, { Request, Response } from 'express';
import { scopeInstruction } from './src/lib/scopeRules.ts';
import { passageMatchesQuery } from './src/lib/pipelines/shared.ts';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
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
import { aiLog } from './server/oauth.mjs';
import { research as webResearch, literatureSources, SOURCE_REGISTRY } from './server/web.mjs';
import { pyqWeights, pyqSource } from './server/pyqFrequency.mjs';
import { searchMyBooks, myBooksStatus } from './server/mybooks.mjs';
import { searchImages, fetchImage, REFERENCE_SOURCES, buildVisionVerificationPrompt, parseVisionVerdict } from './server/images.mjs';
import { generateQuestionFromImage } from './server/visionQuestion.mjs';
import { buildImageBank, loadImageBank, queryImageBank, getBankImage, bankStats, rejectImage, searchBankByText } from './server/imageBank.mjs';
import {
  runQaPipeline,
  listExamProfiles,
  refineBatch,
  type CompleteFn,
  type DupRecord,
} from './server/qa/index.ts';
import { serverDebugLog } from './server/utils/debugLog.ts';
import { extractJson } from './src/lib/ai.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Only this computer may talk to the server. The server holds the user's AI keys, so it must never answer a request
// addressed to another host name. Browsers send the Host header as the name they used (localhost, 127.0.0.1 or [::1]),
// so requests for any other name (including a web page reaching the server through DNS rebinding) are refused.
app.use((req: Request, res: Response, next: () => void) => {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return next();
  res.status(403).json({ error: 'This server only accepts requests from this computer.' });
});
const PORT = parseInt(process.env.PORT || '3000', 10);

// User data dir (Electron passes PULSE_DATA_DIR=app.getPath('userData'); dev fallback keeps
// secrets OUT of the repository). The user's pasted Gemini key lives here, never in the repo.
const DATA_DIR = process.env.PULSE_DATA_DIR || path.join(os.homedir(), '.pulse-med');
const ENV_FILE = path.join(DATA_DIR, '.env');
try { dotenv.config({ path: ENV_FILE }); } catch { /* dev: file may not exist */ }

// Page images for notes are far larger than the default 100 KB body limit. Registered first so
// this route is parsed here and the global parser below leaves it alone.
app.use('/api/ai/complete-images', express.json({ limit: '30mb' }));
app.use('/api/export/questions', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '50mb' })); // raised for the sync-folder push (loopback only)

// ==========================================
// PROVIDER CONFIG (real providers only)
// ==========================================

// OpenCode's default model id (Console / Go gateway).
const OPENCODE_DEFAULT_MODEL = 'deepseek-v4.1-flash';

const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
  opencode: OPENCODE_DEFAULT_MODEL,
  custom: 'gpt-4o-mini',
  deeprelay: 'deeprelay/deepseek-v4.1-flash',
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


const DEEPRELAY_BASE_URL = 'https://api.deeprelay.ai/v1';
function deepRelayKey(): string { return (process.env.DEEPRELAY_API_KEY || '').trim(); }

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

// Save a secret the user pastes in Settings to <PULSE_DATA_DIR>/.env.
// Never echo the key back, never write it to the repository.
function writeEnvValue(name: string, value: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let lines: string[] = [];
  if (fs.existsSync(ENV_FILE)) {
    const existing = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
    const matcher = new RegExp(`^${name}\\s*=`);
    lines = existing.filter((l) => l.trim() !== '' && !matcher.test(l));
  }
  lines.push(`${name}=${value}`, '');
  fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
  process.env[name] = value;
}

function clearEnvValue(name: string): void {
  if (fs.existsSync(ENV_FILE)) {
    const matcher = new RegExp(`^${name}\\s*=`);
    const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '' && !matcher.test(l));
    fs.writeFileSync(ENV_FILE, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
  }
  delete process.env[name];
}

function saveGeminiKey(key: string): void {
  writeEnvValue('GEMINI_API_KEY', key);
}

// ==========================================
// OPENCODE (Console / Go inference gateway)
// ==========================================
// OpenCode exposes an OpenAI-compatible gateway at https://opencode.ai/inference. Two ways
// to authenticate, checked in this order:
//   1. OPENCODE_API_KEY saved from Settings (stored in <PULSE_DATA_DIR>/.env).
//   2. The key already present in the OpenCode CLI's own auth file, so a signed-in
//      OpenCode install works with no extra paste.
const OPENCODE_CHAT_URL = 'https://opencode.ai/inference/openai/v1/chat/completions';
const OPENCODE_GO_CHAT_URL = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
const OPENCODE_SESSION = `pulsemed-${Math.random().toString(36).slice(2)}`;
const OPENCODE_MODELS_URL = 'https://opencode.ai/inference/v1/models';
const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models';

function opencodeAuthFile(): string {
  return process.env.OPENCODE_AUTH_FILE || path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
}

function opencodeKeyFromCli(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(opencodeAuthFile(), 'utf8'));
    const entry = raw?.opencode ?? raw?.['opencode-go'] ?? raw?.['opencode-zen'];
    const key = entry?.key ?? entry?.apiKey ?? entry?.access;
    return typeof key === 'string' ? key.trim() : '';
  } catch {
    return '';
  }
}

// The OpenCode desktop install ships its own CLI. `auth export` lists the credentials it stores,
// including the device sign-in for the OpenCode Console account, which is what "Sign in" gives.
let signInCache: { key: string; at: number } | null = null;
function opencodeKeyFromSignIn(): string {
  if (signInCache && Date.now() - signInCache.at < 5 * 60_000) return signInCache.key;
  const cli = process.env.OPENCODE_CLI_PATH
    || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ai.opencode.desktop', 'resources', 'opencode-cli.exe');
  let key = '';
  try {
    const list = JSON.parse(execFileSync(cli, ['auth', 'export'], { encoding: 'utf8', timeout: 15_000, windowsHide: true }));
    // Either account's sign-in works: the OpenCode Console login or the OpenCode Go login.
    const signedIn = (id: string) => list.find((c: any) => c?.integrationID === id && c?.active && c?.value?.type === 'oauth');
    const fresh = (c: any) => typeof c?.value?.expires === 'number' && c.value.expires > Date.now() && typeof c?.value?.access === 'string';
    const oauth = [signedIn('opencode-go'), signedIn('opencode')].find(fresh);
    const goKey = list.find((c: any) => c?.integrationID === 'opencode-go' && c?.active && c?.value?.type === 'key');
    key = oauth ? oauth.value.access : goKey?.value?.key ?? '';
  } catch {
    key = '';
  }
  signInCache = { key, at: Date.now() };
  return key;
}

function opencodeKey(): string {
  return (opencodeKeyFromSignIn() || process.env.OPENCODE_API_KEY || opencodeKeyFromCli()).trim();
}

/** Save/replace the OpenCode Console API key (never echoed back to the browser). */
function saveOpenCodeKey(key: string): void {
  writeEnvValue('OPENCODE_API_KEY', key);
}

function providerErrorText(body: any, status: number): string {
  const e = body?.error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') return e.message || e.code || `HTTP ${status}`;
  return body?.message || `HTTP ${status}`;
}


function isProviderConnected(providerId: string): boolean {
  if (providerId === 'gemini') return Boolean(geminiKey());
  if (providerId === 'opencode') return Boolean(opencodeKey());
  if (providerId === 'deeprelay') return Boolean(deepRelayKey());
  if (providerId === 'deeprelay') return Boolean(deepRelayKey());
  if (providerId === 'custom') return Boolean(getActiveCustomEndpoint());
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
  if (providerId === 'opencode') {
    return 'OpenCode is not connected. Paste your OpenCode Console API key in Settings → AI Subscription Hub.';
  }
  if (providerId === 'deeprelay') return 'Deep Relay is not connected. Paste your Deep Relay API key in Settings → AI Subscription Hub.';
  if (providerId === 'custom') {
    return 'Custom provider is not connected. Add a custom endpoint in Settings → AI Subscription Hub.';
  }
  return `${providerId.charAt(0).toUpperCase() + providerId.slice(1)} is not signed in. Connect an AI provider in Settings → AI Subscription Hub.`;
}


function recordTokenUsage(_purpose: string | undefined, _body: any): void {
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
  signal?: AbortSignal;
  /** Stable conversation id for providers that route/cache per session (OpenCode Go). */
  session?: string;
  images?: string[];
  /** Who asked for this call (write, check-solve, check-judge): shown in the server log. */
  purpose?: string;
}): Promise<string> {
  const { provider, model, system, messages, json, effort, search, signal, images } = opts;

  if (provider === 'opencode') {
    const key = opencodeKey();
    if (!key) throw new ApiError(notConnectedMessage('opencode'), 401);
    const model_ = model || DEFAULT_MODELS.opencode;
    const payloadMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const payload = JSON.stringify({
      model: model_,
      messages: payloadMessages,
      temperature: 0.7,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      // OpenCode Go asks clients to identify themselves and keep a stable session id,
      // which also lets their gateway cache the prompt across batches.
      'User-Agent': 'PulseMed/1.0.7 (desktop study app)',
      'x-opencode-session': opts.session || OPENCODE_SESSION,
    };
    // Go subscriptions are served under /inference/go/..., Console pay-as-you-go keys
    // under /inference/... . Try Go first and fall back when this key has no Go allowance.
    const attempt = (url: string) =>
      fetch(url, { method: 'POST', headers, body: payload, ...(signal ? { signal } : {}) });
    const readBody = async (response: Response | any) => {
      const raw = await response.text();
      try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
    };

    let r = await attempt(OPENCODE_GO_CHAT_URL);
    let body: any = await readBody(r);
    if (!r.ok) {
      const reason = providerErrorText(body, r.status);
      const retryOnConsole = r.status === 402 || r.status === 403 || r.status === 404 ||
        /credit|balance|quota|no access|not entitled|not available|unknown model|forbidden/i.test(reason);
      if (retryOnConsole) {
        r = await attempt(OPENCODE_CHAT_URL);
        body = await readBody(r);
      }
    }
    if (!r.ok) {
      aiLog({ provider: 'opencode', model: model_, status: r.status, error: true });
      const reason = providerErrorText(body, r.status);
      const hint = /credit|balance|quota/i.test(reason)
        ? ' — this key has no Console credits. Use an OpenCode Go subscription with a Go-included model (deepseek-v4.1-flash, grok-4.7, glm-5.3-flash …), or enable Extra Usage in the OpenCode console.'
        : '';
      throw new ApiError(`OpenCode: ${reason}${hint}`, r.status === 401 || r.status === 403 ? 401 : 502);
    }
    const choice = body?.choices?.[0];
    const content = choice?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('')
      : typeof content === 'string'
        ? content
        : '';
    aiLog({ provider: 'opencode', model: model_, status: r.status, finish: choice?.finish_reason, text_len: text.length, json: !!json });
    if (!text.trim()) {
      throw new ApiError(`OpenCode returned no text (finishReason: ${choice?.finish_reason || 'unknown'}).`, 502);
    }
    return text;
  }

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
        ...(signal ? { abortSignal: signal } : {}),
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    });
    const gText = response.text || '';
    const cand = response.candidates?.[0];
    aiLog({
      provider: 'gemini', model: model_, finish: cand?.finishReason,
      text_len: gText.length, json: !!json, blocked: !!response.promptFeedback?.blockReason,
    });
    if (!gText.trim()) {
      const why = response.promptFeedback?.blockReason
        ? `the prompt was blocked (${response.promptFeedback.blockReason})`
        : cand?.finishReason === 'MAX_TOKENS'
          ? 'the reply hit the output token limit (finishReason: MAX_TOKENS)'
          : cand?.finishReason
            ? `no text (finishReason: ${cand.finishReason})`
            : 'the reply was empty';
      throw new ApiError(`Gemini returned no text: ${why}.`, 502);
    }
    return gText;
  }

  if (provider === 'custom') {
    const endpoint = getActiveCustomEndpoint();
    if (!endpoint) throw new ApiError(notConnectedMessage('custom'), 401);
    const baseUrl = endpoint.endpointUrl;
    const key = endpoint.apiKey;
    const model_ = model || endpoint.defaultModel || DEFAULT_MODELS.custom;
    if (!baseUrl || !key || !model_) throw new ApiError(notConnectedMessage('custom'), 401);
    const payloadMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const apiMode = endpoint.apiMode || 'auto-detect';
    const url =
      apiMode === 'responses-api'
        ? `${baseUrl.replace(/\/$/, '')}/responses`
        : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    let payload: any;
    if (apiMode === 'anthropic-messages') {
      payload = {
        model: model_,
        messages: payloadMessages,
        temperature: 0.7,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      };
    } else {
      payload = {
        model: model_,
        messages: payloadMessages,
        temperature: 0.7,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      };
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
    const raw = await r.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
    if (!r.ok) {
      aiLog({ provider: 'custom', model: model_, status: r.status, error: true, endpoint: endpoint.name });
      throw new ApiError(`Custom (${endpoint.name}): ${providerErrorText(body, r.status)}`, r.status === 401 ? 401 : 502);
    }
    let text = '';
    if (apiMode === 'responses-api') {
      // Responses API returns output array with content items
      const output = body?.output;
      if (Array.isArray(output)) {
        for (const item of output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
            }
          }
        }
      } else if (typeof body?.output_text === 'string') {
        text = body.output_text;
      }
    } else if (apiMode === 'anthropic-messages') {
      // Anthropic-style: content is array of {type, text}
      const content = body?.content;
      if (Array.isArray(content)) {
        text = content.map((c: any) => (c.type === 'text' ? c.text : '')).join('');
      } else if (typeof body?.content === 'string') {
        text = body.content;
      }
    } else {
      const choice = body?.choices?.[0];
      text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    }
    aiLog({ provider: 'custom', model: model_, status: r.status, text_len: text.length, json: !!json, endpoint: endpoint.name });
    if (!text.trim()) {
      throw new ApiError(`Custom (${endpoint.name}) returned no text (finishReason: ${body?.choices?.[0]?.finish_reason || body?.output?.[0]?.finish_reason || 'unknown'}).`, 502);
    }
    return text;
  }

  if (provider === 'deeprelay') {
    const key = deepRelayKey();
    if (!key) throw new ApiError(notConnectedMessage('deeprelay'), 401);
    const model_ = model || DEFAULT_MODELS.deeprelay;
    const r = await fetch(`${DEEPRELAY_BASE_URL}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: model_, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.map((m) => ({ role: m.role, content: m.content }))], temperature: 0.7, ...(json ? { response_format: { type: 'json_object' } } : {}) }), ...(signal ? { signal } : {}) });
    const raw = await r.text(); let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
    if (!r.ok) { aiLog({ provider: 'deeprelay', model: model_, status: r.status, error: true }); throw new ApiError(`Deep Relay: ${providerErrorText(body, r.status)}`, r.status === 401 ? 401 : 502); }
    const content = body?.choices?.[0]?.message?.content; const text = typeof content === 'string' ? content : '';
    aiLog({ provider: 'deeprelay', model: model_, status: r.status, text_len: text.length, json: !!json }); recordTokenUsage(opts.purpose, body);
    if (!text.trim()) throw new ApiError(`Deep Relay returned no text (finishReason: ${body?.choices?.[0]?.finish_reason || 'unknown'}).`, 502);
    return text;
  }


  const internal = INTERNAL_PROVIDER[provider];
  if (!internal) throw new ApiError(`Unknown AI provider: ${provider}`, 400);  try {
    return await oauthChat({
      provider: internal as 'codex' | 'xai' | 'claude',
      model: model || DEFAULT_MODELS[provider],
      system,
      messages,
      json,
      effort,
      search,
      signal,
    });
  } catch (err: any) {
    const msg = String(err?.message || 'AI request failed');
    if (/not signed in|login expired/i.test(msg)) {
      throw new ApiError(notConnectedMessage(provider), 401);
    }
    if (provider === 'claude' && /not allowed for this organization/i.test(msg)) {
      throw new ApiError('Claude subscription sign-in is restricted for your organisation. Use Claude via OpenCode or add a Gemini API key instead.', 401);
    }
    if (provider === 'opencode' && /unavailable/i.test(msg)) {
      throw new ApiError('OpenCode: this model is not on your plan. Pick one from “Find models” (Go-included: deepseek-v4.1-flash, grok-4.7, qwen3.8-flash, glm-5.3-flash …).', 400);
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
      opencode: { connected: isProviderConnected('opencode') },
      deeprelay: { connected: isProviderConnected('deeprelay') },
      custom: { connected: isProviderConnected('custom') },
    },
    defaults: DEFAULT_MODELS,
  });
});

// POST /api/pyq/weights: how often each subtopic is asked in the previous-year papers for an exam, so a set can follow
// the exam's own frequency. Subtopics with no PYQ match weigh 1. Reads the PYQ bundle on this machine, if present.
app.post('/api/pyq/weights', (req: Request, res: Response) => {
  const subtopics = Array.isArray(req.body?.subtopics) ? req.body.subtopics.map((s: any) => String(s)).slice(0, 200) : [];
  const exam = String(req.body?.exam || '');
  return res.json({ weights: pyqWeights(subtopics, exam), source: pyqSource() });
});

// POST /api/ai/split-topic: splits a typed topic into distinct subtopics. Runs once per module; cached per session.
const splitCache = new Map<string, { subtopic: string; priority: number; facts: number }[]>();
app.post('/api/ai/split-topic', async (req: Request, res: Response) => {
  const topic = String(req.body?.topic || '').trim().slice(0, 120);
  const exam = String(req.body?.exam || 'NEET-PG');
  const provider = String(req.body?.provider || '');
  const model = String(req.body?.model || '');
  if (!topic || !provider) return res.json({ subtopics: [] });
  const key = JSON.stringify({ topic, exam, provider, model });
  const cached = splitCache.get(key);
  if (cached) return res.json({ subtopics: cached.map((s) => s.subtopic), priorities: cached.map((s) => s.priority), facts: cached.map((s) => s.facts) });
  // The split reads the library and the web first, so it lists only subtopics that have content behind them.
  let evidence = '';
  try {
    const found = await webResearch(topic, 1200);
    evidence = found.sources.map((s: any, i: number) => `[${i + 1}] ${s.title}\n${s.text}`).join('\n').slice(0, 6000);
  } catch {
    evidence = '';
  }
  const prompt = [
    `You are an expert medical exam item writer for ${exam}.`,
    evidence
      ? `Evidence from the textbook library and the web on this topic (a guide: list every subtopic the evidence supports, and every other subtopic an examiner tests on this topic):\n${evidence}`
      : 'No evidence was found, so list the subtopics an exam would test.',
    `Split the topic "${topic}" into its distinct subtopics, sorted as an examiner would sort them:`,
    'for drugs, use drug classes with the named drugs; for diseases, use the clinical areas (diagnosis, investigation, treatment, complications), and always include the drugs used with their adverse effects and the national programme regimen (for example NTEP for tuberculosis) when the disease has them; for anatomy or physiology, use the structures or systems. ' +
      'Keep one clinical area as one subtopic: do not split a single area (for example skin involvement) into several overlapping subtopics. List every distinct subtopic an examiner tests on this topic: a narrow topic may have only two or three, a broad one thirty or more. Do not stop at a fixed number.',
    'Each subtopic must be different from every other: no repeated class, and no drug, disease or structure listed under two subtopics.',
    `Subtopic lock: list only subtopics inside the boundary. ${scopeInstruction()} Do not broaden a narrow topic to its whole chapter.`,
    'If several medical specialties examine this topic (for example pathology, general medicine, surgery, radiology, pharmacology, community medicine), list subtopics from each of those specialties, each written from that specialty point of view. No single specialty may take more than a third of the list.',
    'Give each subtopic a priority from 1 to 10 for how often it is tested.',
    'Give each subtopic "facts": the number of high-yield, exam-testable facts in it (1 to 6). Count only facts an examiner would ask, not background detail.',
    // JSON mode returns one object, so the list sits inside it under "subtopics".
    `Return only a JSON object: {"subtopics": [{"subject": "${topic}", "subtopic": "<name: items>", "priority": <1-10>, "facts": <1-6>}, ...]}.`,
    'Do not repeat any entry.',
  ].join('\n');
  // Reads the subtopic list from one reply. Returns [] when the reply has no usable list.
  const splitWith = async (useModel: string | undefined, text = prompt, via = provider): Promise<{ subtopic: string; priority: number; facts: number }[]> => {
    const raw = await runCompletion({ provider: via, model: useModel, messages: [{ role: 'user', content: text }], json: true, effort: 'min' });
    const parsed = extractJson<any>(raw);
    // Some models return one object, or a list wrapped in an object; both are read as a list.
    const asList: any[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (Object.values(parsed).find(Array.isArray) as any[] | undefined) ?? [parsed]
        : [];
    console.log('[split-topic] model', useModel, 'raw', String(raw).slice(0, 120), 'items:', asList.length);
    // Each subtopic carries the exam priority (1-10) the model gave it. The most important come first, and
    // only those at 5 or above are kept, so the count reflects what is actually tested.
    const rated = asList
      .map((e: any) => (typeof e === 'string'
        ? { subtopic: e, priority: 10, facts: 1 }
        : { subtopic: e?.subtopic, priority: Number(e?.priority) || 0, facts: Math.min(6, Math.max(1, Math.round(Number(e?.facts) || 1))) }))
      .filter((r: any) => typeof r.subtopic === 'string' && r.subtopic.trim());
    // Every relevant subtopic is kept; the priority only sets the order.
    const chosen = rated.sort((a: any, b: any) => b.priority - a.priority);
    const seen = new Set<string>();
    const unique: { subtopic: string; priority: number; facts: number }[] = [];
    for (const r of chosen) {
      const name = r.subtopic.trim();
      if (seen.has(name)) continue;
      seen.add(name);
      unique.push({ subtopic: name, priority: r.priority, facts: r.facts });
    }
    return unique;
  };
  try {
    // A small model sometimes gives no list. Retry once with the stronger default model, then fall back to the typed topic.
    let subtopics = await splitWith(model || undefined).catch((e: any) => { console.log('[split-topic] first attempt failed:', e?.message || e); return []; });
    // One or two categories cannot spread a set, so a thin split is asked again with a stricter brief.
    if (subtopics.length < 4) {
      const strict = [
        prompt,
        'Your last reply gave too few subtopics. Return every distinct subtopic an examiner tests on this topic, each a different category.',
        'For a drug or drug class, cover every organ system and effect type it is known for (for example renal, neurological, sensory, haematological, hepatic, cardiac, metabolic, skin, endocrine, pregnancy), plus its key interactions and monitoring.',
        'For a disease, cover its causes, clinical features, investigations, treatment, complications and prognosis.',
        'A single subtopic is not acceptable.',
      ].join('\n');
      const more = await splitWith(model || undefined, strict).catch((e: any) => { console.log('[split-topic] strict attempt failed:', e?.message || e); return []; });
      if (more.length > subtopics.length) subtopics = more;
    }
    // A failed or thin split (the provider was rate-limited or timed out) is never kept: the next request asks again.
    const thin = subtopics.length < 4;
    if (!subtopics.length) subtopics = [{ subtopic: topic, priority: 10, facts: 1 }];
    if (!thin) {
      if (splitCache.size >= 50) splitCache.delete(splitCache.keys().next().value as string);
      splitCache.set(key, subtopics);
    }
    return res.json({ subtopics: subtopics.map((s) => s.subtopic), priorities: subtopics.map((s) => s.priority), facts: subtopics.map((s) => s.facts) });
  } catch (err: any) {
    console.log('[split-topic] failed:', err?.message || err);
    return res.json({ subtopics: [topic], priorities: [10], facts: [1] });
  }
});

// GET /api/ai/source-registry: the sources the question writer may read, with licence and status.
app.get('/api/ai/source-registry', (_req: Request, res: Response) => {
  return res.json({ sources: SOURCE_REGISTRY });
});

// Figures for imported question banks (eMedici). Read-only, from a folder set by
// BANK_FIGURES_DIR (default ~/.pulse-med/bank-figures). The path is restricted to plain
// folder/file names, so a request cannot read anything else on disk.
const BANK_FIGURES_DIR = process.env.BANK_FIGURES_DIR || path.join(os.homedir(), '.pulse-med', 'bank-figures');
app.get(/^\/api\/bank-figures\/(.+)$/, (req: Request, res: Response) => {
  const rel = String(req.params[0] ?? '');
  if (!/^[A-Za-z0-9_\-/]+\.(png|jpe?g|webp|gif)$/i.test(rel) || rel.split('/').includes('..')) {
    return res.status(400).end();
  }
  const full = path.join(BANK_FIGURES_DIR, rel);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

/** Ranking replies from the planner, kept for the session so later rounds of a module do not rank again. */
const rankCache = new Map<string, string>();

/** A subtopic's parts, as the writer focuses on them: "Antipsychotics: haloperidol, olanzapine" gives two. */
function subtopicParts(subtopic: string): string[] {
  const after = subtopic.includes(':') ? subtopic.split(':').slice(1).join(':') : subtopic;
  // Each part keeps only its own name: "Antiepileptics: phenytoin" becomes "phenytoin".
  return after
    .split(/,|&| and /)
    .map((s) => s.trim().split(':').pop()!.trim())
    .filter(Boolean);
}

/**
 * Lists `count` distinct, specific topics for the chosen subjects and subtopics. Each topic is the focus of one
 * question (one drug, one adverse effect, one clinical situation). Subject and subtopic must be copied from the
 * selection; topics already written in this module (`excluded`, as "subtopic|focus") are not repeated.
 */
async function listDistinctTopics(
  subjectSubtopics: { subject: string; subtopics: string[] }[],
  count: number,
  exam: string | undefined,
  provider: string | undefined,
  model: string | undefined,
  excluded: Set<string>,
): Promise<{ subject: string; subtopic: string; focus: string }[]> {
  const avoid = [...excluded].map((k) => k.split('|')[1]).filter(Boolean).slice(0, 200);
  const prompt = [
    `You are an expert medical exam item writer for ${exam || 'NEET-PG'}.`,
    `Allowed subjects and subtopics:`,
    ...subjectSubtopics.map((s) => `  ${s.subject}: ${(s.subtopics || []).join(', ')}`),
    '',
    `List ${count} distinct, specific topics that an exam question can test within these subtopics. Each topic is one concrete focus: one drug, one adverse effect, one mechanism, one investigation, one clinical situation. No two topics may overlap.`,
    avoid.length ? `Do not repeat these already written topics: ${avoid.join('; ')}.` : '',
    `Return one JSON object with a single key "topics", whose value is an array of ${count} objects. Each object has "subject", "subtopic" and "focus". Copy "subject" and "subtopic" exactly from the list above. "focus" is 3 to 10 words.`,
    `Output ONLY the JSON array.`,
  ].filter(Boolean).join('\n');
  const raw = await runCompletion({
    provider: provider || 'gemini',
    messages: [{ role: 'user', content: prompt }],
    json: true,
    effort: 'min',
  });
  const parsed = extractJson<any>(raw);
  // Some models return a single object, or a list wrapped in an object; both are read as a list.
  const list: any[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (Object.values(parsed).find(Array.isArray) as any[] | undefined) ?? [parsed]
      : [];
  const allowed = new Map<string, Set<string>>();
  for (const s of subjectSubtopics) allowed.set(s.subject, new Set((s.subtopics || []).map((sub) => String(sub).trim())));
  const seen = new Set<string>();
  const out: { subject: string; subtopic: string; focus: string }[] = [];
  for (const entry of list) {
    const subject = String(entry?.subject ?? '');
    const subtopic = String(entry?.subtopic ?? '').trim();
    const focus = String(entry?.focus ?? '').trim();
    if (!focus || !allowed.get(subject)?.has(subtopic)) continue;
    const key = focus.toLowerCase();
    if (seen.has(key) || excluded.has(`${subtopic}|${focus}`)) continue;
    seen.add(key);
    out.push({ subject, subtopic, focus });
    if (out.length >= count) break;
  }
  return out;
}

// 1a-bis. POST /api/ai/plan-topics: plan topic distribution for MCQ generation.
// Returns a ranked list of subject+subtopic pairs with importance weights,
// so that important topics appear more often across concurrent batches.
app.post('/api/ai/plan-topics', async (req: Request, res: Response) => {
  const { subjectSubtopics, count, difficultyTier, provider, model, exam, effort, exclude } = req.body || {};
  // Topic units already written in this module ("subtopic|focus"). Later rounds skip them.
  const excluded = new Set<string>(Array.isArray(exclude) ? exclude.map(String) : []);
  if (!subjectSubtopics || !Array.isArray(subjectSubtopics) || subjectSubtopics.length === 0) {
    return res.status(400).json({ error: 'subjectSubtopics is required' });
  }
  const countN = Math.max(1, Math.min(parseInt(String(count || '20'), 10) || 20, 200));
  const tier = difficultyTier || 'MEDIUM';

  // Build the full pool of subject+subtopic pairs.
  const pool: { subject: string; subtopic: string }[] = [];
  for (const s of subjectSubtopics) {
    for (const sub of (s.subtopics || [])) {
      if (sub && sub.trim()) pool.push({ subject: s.subject, subtopic: sub.trim() });
    }
  }
  if (pool.length === 0) {
    return res.status(400).json({ error: 'No subtopics found in subjectSubtopics' });
  }

  try {
    // Ask the AI provider to rank topics by importance for this exam.
    const planPrompt = [
      `You are an expert medical exam item writer for ${exam || 'NEET-PG'}.`,
      `Given these allowed subjects and subtopics, rank them by exam importance (most-tested first):`,
      ...subjectSubtopics.map((s: any) => `  ${s.subject}: ${(s.subtopics || []).join(', ')}`),
      '',
      `Return a JSON array of topic objects, each with "subject", "subtopic", and "priority" (1-10, where 10 = most important).`,
      `Use ONLY the subjects and subtopics listed above, copied exactly. Do not add any other subject or subtopic.`,
      `Include approximately ${countN} entries total. If there are fewer unique pairs than ${countN}, repeat important ones.`,
      `Output ONLY the JSON array.`,
    ].join('\n');

    // The same subjects are ranked again in every later round of a module. Keep the first reply for this session.
    const rankKey = JSON.stringify({ exam, provider, model, subjectSubtopics });
    let raw = rankCache.get(rankKey) ?? '';
    if (!raw) {
      raw = await runCompletion({
        provider: provider || 'gemini',
        messages: [{ role: 'user', content: planPrompt }],
        json: true,
        // Ranking subtopics is a short judgement, so it runs without reasoning, like the rest of the pipeline.
        effort: 'min',
      });
      if (rankCache.size >= 50) rankCache.delete(rankCache.keys().next().value as string);
      rankCache.set(rankKey, raw);
    }

    const parsed = extractJson<{ subject: string; subtopic: string; priority: number }[]>(raw);
    // Keep only pairs the user actually selected. The model can return subjects it was
    // not given, which would leak other specialties into a focused module.
    const allowed = new Map<string, Set<string>>();
    for (const s of subjectSubtopics) {
      allowed.set(s.subject, new Set((s.subtopics || []).map((sub: string) => String(sub).trim())));
    }
    const ranked = (Array.isArray(parsed) ? parsed : []).filter(
      (entry) => allowed.get(entry?.subject)?.has(String(entry?.subtopic ?? '').trim()),
    );

    // One distinct topic per question first. Each subtopic is split into its parts (for example, one drug
    // class each). Subtopics are taken in priority order, round by round, so a topic repeats only after every
    // subtopic has had its first question, and then only with a different part.
    // The model can list one subtopic more than once; keep each subtopic once, at its highest priority.
    const bestByTopic = new Map<string, any>();
    for (const entry of ranked) {
      const key = `${entry.subject}|${String(entry.subtopic).trim()}`;
      const prior = bestByTopic.get(key);
      if (!prior || (entry.priority || 0) > (prior.priority || 0)) bestByTopic.set(key, entry);
    }
    // The model's reply may leave whole subjects out (it only lists about as many entries as asked for); give
    // every unlisted subtopic a low priority so each selected subject can still appear.
    for (const p of pool) {
      const key = `${p.subject}|${p.subtopic}`;
      if (!bestByTopic.has(key)) bestByTopic.set(key, { subject: p.subject, subtopic: p.subtopic, priority: 1 });
    }
    const byPriority = [...bestByTopic.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    // With several subjects, the model's top priorities come from a few subjects and fill the whole set (a 100-question
    // run over 19 subjects covered only 7). Interleave: each subject gives its best topic, then its next best, and so on.
    const perSubject = new Map<string, any[]>();
    for (const entry of byPriority) {
      if (!perSubject.has(entry.subject)) perSubject.set(entry.subject, []);
      perSubject.get(entry.subject)!.push(entry);
    }
    const sorted: any[] = [];
    for (let i = 0; sorted.length < byPriority.length; i++) {
      for (const list of perSubject.values()) if (list[i]) sorted.push(list[i]);
    }
    const weighted: { subject: string; subtopic: string; focus?: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }[] = [];
    for (let round = 0; sorted.length > 0 && weighted.length < countN && round < 20; round++) {
      for (const entry of sorted) {
        if (weighted.length >= countN) break;
        const parts = subtopicParts(entry.subtopic);
        const focus = parts.length > 1 ? parts[round % parts.length] : undefined;
        if (excluded.has(`${entry.subtopic}|${focus ?? ''}`)) continue;
        weighted.push({
          subject: entry.subject,
          subtopic: entry.subtopic,
          focus,
          difficultyTier: tier as 'LOW' | 'MEDIUM' | 'HIGH',
        });
      }
    }

    // If the ranking failed, fall back to a round-robin over the same units, with the same rules: each unit
    // once, parts split out, and units already written in this module skipped.
    if (weighted.length === 0) {
      const units: { subject: string; subtopic: string; focus?: string }[] = [];
      for (let round = 0; round < 20; round++) {
        for (const entry of pool) {
          const parts = subtopicParts(entry.subtopic);
          const focus = parts.length > 1 ? parts[round % parts.length] : undefined;
          if (round > 0 && parts.length <= 1) continue;
          units.push({ subject: entry.subject, subtopic: entry.subtopic, focus });
        }
      }
      for (const unit of units) {
        if (weighted.length >= countN) break;
        if (excluded.has(`${unit.subtopic}|${unit.focus ?? ''}`)) continue;
        weighted.push({ ...unit, difficultyTier: tier as 'LOW' | 'MEDIUM' | 'HIGH' });
      }
    }

    // A subtopic with no parts gives one unit, so a single broad subtopic (for example "HIV drugs") would give one
    // question topic. In that case the model first lists distinct, specific topics for the same subjects, one per
    // question. Those are the topics the questions are then written on.
    let planned = weighted;
    if (weighted.length < countN) {
      let expanded = await listDistinctTopics(subjectSubtopics, countN, exam, provider, model, excluded);
      // The model sometimes lists fewer than asked. Ask again for the rest, avoiding the topics already listed.
      for (let round = 0; expanded.length < countN && round < 2; round++) {
        const avoidNow = new Set([...excluded, ...expanded.map((t) => `${t.subtopic}|${t.focus}`)]);
        const more = await listDistinctTopics(subjectSubtopics, countN - expanded.length, exam, provider, model, avoidNow);
        if (more.length === 0) break;
        expanded = [...expanded, ...more];
      }
      if (expanded.length > weighted.length) planned = expanded.map((t) => ({ ...t, difficultyTier: tier as 'LOW' | 'MEDIUM' | 'HIGH' }));
    }

    // Trim to countN, preserving order.
    const finalTopics = planned.slice(0, countN);
    return res.json({ topics: finalTopics, total: finalTopics.length });
  } catch (err: any) {
    // Fallback: simple round-robin.
    const fallback: { subject: string; subtopic: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }[] = [];
    for (let i = 0; i < countN; i++) {
      fallback.push({
        subject: pool[i % pool.length].subject,
        subtopic: pool[i % pool.length].subtopic,
        difficultyTier: tier as 'LOW' | 'MEDIUM' | 'HIGH',
      });
    }
    return res.json({ topics: fallback, total: fallback.length });
  }
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
  if (provider === 'opencode') {
    // The OpenCode key is a plain API key in <PULSE_DATA_DIR>/.env, not an OAuth token.
    try {
      clearEnvValue('OPENCODE_API_KEY');
      return res.json({ ok: true, connected: false, provider });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Could not remove the OpenCode key.' });
    }
  }
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

// 6b. POST /api/settings/opencode-key: save the OpenCode Console API key.
// NEVER echoes the key back.
app.post('/api/settings/opencode-key', (req: Request, res: Response) => {
  const key = String(req.body?.apiKey || '').trim();
  if (!/^[A-Za-z0-9_.\-]{10,}$/.test(key)) {
    return res.status(400).json({ error: 'That does not look like a valid OpenCode API key.' });
  }
  try {
    saveOpenCodeKey(key);
    return res.json({ ok: true, connected: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not save the OpenCode API key.' });
  }
});


app.post('/api/settings/deeprelay-key', (req: Request, res: Response) => {
  const key = String(req.body?.apiKey || '').trim();
  if (!/^[A-Za-z0-9_.\-]{10,}$/.test(key)) return res.status(400).json({ error: 'That does not look like a valid Deep Relay API key.' });
  try { writeEnvValue('DEEPRELAY_API_KEY', key); return res.json({ ok: true, connected: true }); }
  catch (err: any) { return res.status(500).json({ error: err?.message || 'Could not save the Deep Relay API key.' }); }
});

// ==========================================
// CUSTOM ENDPOINTS (user-configurable OpenAI-compatible endpoints)
// ==========================================

const CUSTOM_ENDPOINTS_FILE = path.join(DATA_DIR, 'custom-endpoints.json');

interface CustomEndpoint {
  id: string;
  name: string;
  providerId: string;
  endpointUrl: string;
  apiMode: 'auto-detect' | 'chat-completions' | 'responses-api' | 'anthropic-messages';
  defaultModel: string;
  context: string;
  apiKey: string;
  useForNewChats: boolean;
  discoverModels: boolean;
  createdAt: string;
  updatedAt: string;
}

function readCustomEndpoints(): CustomEndpoint[] {
  try {
    if (!fs.existsSync(CUSTOM_ENDPOINTS_FILE)) return [];
    const raw = fs.readFileSync(CUSTOM_ENDPOINTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeCustomEndpoints(endpoints: CustomEndpoint[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CUSTOM_ENDPOINTS_FILE, JSON.stringify(endpoints, null, 2), 'utf8');
}

function findCustomEndpoint(id: string): CustomEndpoint | undefined {
  return readCustomEndpoints().find((e) => e.id === id);
}

// GET /api/settings/custom-endpoints: list all saved custom endpoints
// ---- Sync across devices through a shared folder (loopback only; fixed file name) ----
type PulseSyncStoredConfig = { folder: string | null };

const PULSE_SYNC_FILE_NAME = 'pulse-med-sync.json';

async function pulseSyncConfigPaths(): Promise<{ configDir: string; configFile: string }> {
  const os = await import('node:os');
  const path = await import('node:path');
  const configDir = path.join(os.homedir(), '.pulse-med');
  return {
    configDir,
    configFile: path.join(configDir, 'sync-config.json'),
  };
}

async function readPulseSyncStoredConfig(): Promise<PulseSyncStoredConfig> {
  const fs = await import('node:fs/promises');
  const { configFile } = await pulseSyncConfigPaths();

  try {
    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'folder' in parsed) {
      const folder = (parsed as { folder?: unknown }).folder;
      if (folder === null || typeof folder === 'string') {
        return { folder };
      }
    }
  } catch {
    // Missing or unreadable config means no folder is configured yet.
  }

  return { folder: null };
}

async function writePulseSyncStoredConfig(folder: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const { configDir, configFile } = await pulseSyncConfigPaths();

  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify({ folder }, null, 2), 'utf8');
}

async function getPulseSyncConfigResponse(folder: string | null): Promise<{
  folder: string | null;
  file: string | null;
  exists: boolean;
  modifiedAt: string | null;
}> {
  if (!folder) {
    return { folder: null, file: null, exists: false, modifiedAt: null };
  }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(folder, PULSE_SYNC_FILE_NAME);

  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) {
      return { folder, file, exists: false, modifiedAt: null };
    }
    return {
      folder,
      file,
      exists: true,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') {
      return { folder, file, exists: false, modifiedAt: null };
    }
    throw error;
  }
}

app.get('/api/sync/config', async (_req: Request, res: Response) => {
  try {
    const stored = await readPulseSyncStoredConfig();
    const config = await getPulseSyncConfigResponse(stored.folder);
    res.json(config);
  } catch {
    res.status(500).json({ error: 'Could not read sync configuration.' });
  }
});

app.post('/api/sync/config', async (req: Request, res: Response) => {
  try {
    const body = req.body as { folder?: unknown } | undefined;
    const rawFolder = body?.folder;

    if (typeof rawFolder !== 'string' || rawFolder.trim().length === 0) {
      res.status(400).json({ error: 'A non-empty folder path is required.' });
      return;
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const folder = path.resolve(rawFolder.trim());

    let stat;
    try {
      stat = await fs.stat(folder);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ENOENT') {
        res.status(400).json({ error: 'The selected folder does not exist.' });
        return;
      }
      throw error;
    }

    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'The selected path is not a directory.' });
      return;
    }

    await writePulseSyncStoredConfig(folder);
    const config = await getPulseSyncConfigResponse(folder);
    res.json(config);
  } catch {
    res.status(500).json({ error: 'Could not save sync configuration.' });
  }
});

app.post('/api/sync/push', async (req: Request, res: Response) => {
  try {
    const body = req.body as { payload?: unknown } | undefined;
    const payload = body?.payload;

    if (typeof payload !== 'string' || payload.length > 50_000_000) {
      res.status(400).json({
        error: 'Payload must be a string up to 50,000,000 characters.',
      });
      return;
    }

    const stored = await readPulseSyncStoredConfig();
    if (!stored.folder) {
      res.status(400).json({ error: 'No sync folder is configured.' });
      return;
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const target = path.join(stored.folder, PULSE_SYNC_FILE_NAME);
    const temp = path.join(
      stored.folder,
      `.${PULSE_SYNC_FILE_NAME}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );

    let tempWritten = false;
    try {
      await fs.writeFile(temp, payload, 'utf8');
      tempWritten = true;
      await fs.rename(temp, target);
      tempWritten = false;
    } finally {
      if (tempWritten) {
        try {
          await fs.unlink(temp);
        } catch {
          // Best-effort cleanup of the temporary file.
        }
      }
    }

    const stat = await fs.stat(target);
    res.json({
      ok: true,
      bytes: Buffer.byteLength(payload, 'utf8'),
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch {
    res.status(500).json({ error: 'Could not write the sync file.' });
  }
});

app.get('/api/sync/pull', async (_req: Request, res: Response) => {
  try {
    const stored = await readPulseSyncStoredConfig();
    if (!stored.folder) {
      res.status(404).json({ error: 'No sync file is available yet.' });
      return;
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(stored.folder, PULSE_SYNC_FILE_NAME);

    try {
      const [payload, stat] = await Promise.all([
        fs.readFile(file, 'utf8'),
        fs.stat(file),
      ]);
      res.json({
        ok: true,
        payload,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ENOENT') {
        res.status(404).json({ error: 'No sync file is available yet.' });
        return;
      }
      throw error;
    }
  } catch {
    res.status(500).json({ error: 'Could not read the sync file.' });
  }
});

app.get('/api/settings/custom-endpoints', (_req: Request, res: Response) => {
  const endpoints = readCustomEndpoints().map((e) => ({ ...e, apiKey: '***' })); // never return real keys
  return res.json({ endpoints });
});

// POST /api/settings/custom-endpoints: create a new custom endpoint
app.post('/api/settings/custom-endpoints', (req: Request, res: Response) => {
  const { name, providerId, endpointUrl, apiMode, defaultModel, context, apiKey, useForNewChats, discoverModels } = req.body || {};
  const now = new Date().toISOString();
  const id = String(providerId || name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || `custom-${Date.now()}`;
  if (!name || !endpointUrl || !apiKey) {
    return res.status(400).json({ error: 'Name, Endpoint URL and API Key are required.' });
  }
  try {
    const endpoints = readCustomEndpoints();
    const endpoint: CustomEndpoint = {
      id,
      name: String(name),
      providerId: String(providerId || name),
      endpointUrl: String(endpointUrl).replace(/\/$/, ''),
      apiMode: (apiMode as CustomEndpoint['apiMode']) || 'auto-detect',
      defaultModel: String(defaultModel || ''),
      context: String(context || 'Auto'),
      apiKey: String(apiKey),
      useForNewChats: Boolean(useForNewChats),
      discoverModels: Boolean(discoverModels),
      createdAt: now,
      updatedAt: now,
    };
    const existing = endpoints.findIndex((e) => e.id === id);
    if (existing >= 0) endpoints[existing] = { ...endpoints[existing], ...endpoint, updatedAt: now };
    else endpoints.push(endpoint);
    writeCustomEndpoints(endpoints);
    return res.json({ ok: true, endpoint: { ...endpoint, apiKey: '***' } });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not save custom endpoint.' });
  }
});

// PUT /api/settings/custom-endpoints/:id: update an existing custom endpoint
app.put('/api/settings/custom-endpoints/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, providerId, endpointUrl, apiMode, defaultModel, context, apiKey, useForNewChats, discoverModels } = req.body || {};
  try {
    const endpoints = readCustomEndpoints();
    const idx = endpoints.findIndex((e) => e.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Custom endpoint not found.' });
    const existing = endpoints[idx];
    const now = new Date().toISOString();
    endpoints[idx] = {
      ...existing,
      name: name !== undefined ? String(name) : existing.name,
      providerId: providerId !== undefined ? String(providerId) : existing.providerId,
      endpointUrl: endpointUrl !== undefined ? String(endpointUrl).replace(/\/$/, '') : existing.endpointUrl,
      apiMode: apiMode !== undefined ? (apiMode as CustomEndpoint['apiMode']) : existing.apiMode,
      defaultModel: defaultModel !== undefined ? String(defaultModel) : existing.defaultModel,
      context: context !== undefined ? String(context) : existing.context,
      apiKey: apiKey !== undefined ? String(apiKey) : existing.apiKey,
      useForNewChats: useForNewChats !== undefined ? Boolean(useForNewChats) : existing.useForNewChats,
      discoverModels: discoverModels !== undefined ? Boolean(discoverModels) : existing.discoverModels,
      updatedAt: now,
    };
    writeCustomEndpoints(endpoints);
    return res.json({ ok: true, endpoint: { ...endpoints[idx], apiKey: '***' } });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not update custom endpoint.' });
  }
});

// DELETE /api/settings/custom-endpoints/:id: delete a custom endpoint
app.delete('/api/settings/custom-endpoints/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const endpoints = readCustomEndpoints();
    const filtered = endpoints.filter((e) => e.id !== id);
    if (filtered.length === endpoints.length) return res.status(404).json({ error: 'Custom endpoint not found.' });
    writeCustomEndpoints(filtered);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not delete custom endpoint.' });
  }
});

// POST /api/settings/custom-endpoints/:id/test: test a custom endpoint connection
app.post('/api/settings/custom-endpoints/:id/test', async (req: Request, res: Response) => {
  const { id } = req.params;
  const endpoint = findCustomEndpoint(id);
  if (!endpoint) return res.status(404).json({ error: 'Custom endpoint not found.' });
  try {
    const model_ = endpoint.defaultModel || 'gpt-4o-mini';
    const url = `${endpoint.endpointUrl}/chat/completions`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: model_,
        messages: [{ role: 'user', content: 'Name the first-line drug for anaphylaxis in one word.' }],
        temperature: 0.7,
      }),
    });
    const raw = await r.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
    if (!r.ok) {
      return res.status(502).json({ error: `Test failed: ${providerErrorText(body, r.status)}` });
    }
    const content = body?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    if (!text.trim()) {
      return res.status(502).json({ error: 'Test failed: endpoint returned an empty reply.' });
    }
    return res.json({ ok: true, reply: text.slice(0, 200) });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Test failed: could not reach endpoint.' });
  }
});

app.get('/api/models/custom', async (_req: Request, res: Response) => {
  const provider = String(_req.query.provider || '').trim();

  // Default: custom endpoint model discovery
  const endpoints = readCustomEndpoints();
  const activeEndpoint = endpoints.find((e) => e.useForNewChats) || endpoints[0];
  if (!activeEndpoint) {
    return res.status(401).json({ error: 'No custom endpoint configured. Add one in Settings → AI Subscription Hub.' });
  }
  try {
    const modelsUrl = `${activeEndpoint.endpointUrl}/models`;
    const r = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeEndpoint.apiKey}`,
      },
    });
    const raw = await r.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
    if (!r.ok) {
      return res.status(502).json({ error: `Model discovery failed: ${providerErrorText(body, r.status)}` });
    }
    const rows: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
    const models = rows
      .map((m) => ({ id: String(m?.id ?? m?.name ?? ''), name: String(m?.name || m?.id || ''), source: 'custom' }))
      .filter((m) => m.id);
    return res.json({ models, fetchedAt: new Date().toISOString(), endpoint: activeEndpoint.name });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Could not discover models from custom endpoint.' });
  }
});

// Helper: get the active custom endpoint (the one marked useForNewChats, or first)
function getActiveCustomEndpoint(): CustomEndpoint | undefined {
  const endpoints = readCustomEndpoints();
  return endpoints.find((e) => e.useForNewChats) || endpoints[0];
}

// Backward-compatible helpers (for any remaining references)
function customBaseUrl(): string {
  const ep = getActiveCustomEndpoint();
  return ep ? ep.endpointUrl : '';
}
function customApiKey(): string {
  const ep = getActiveCustomEndpoint();
  return ep ? ep.apiKey : '';
}
function customModelId(): string {
  const ep = getActiveCustomEndpoint();
  return ep ? ep.defaultModel : '';
}
// Fetches {CUSTOM_BASE_URL}/models and returns the model id list so the user can pick one.
app.get('/api/models/custom', async (_req: Request, res: Response) => {
  const baseUrl = customBaseUrl();
  const apiKey = customApiKey();
  if (!baseUrl || !apiKey) {
    return res.status(401).json({ error: 'Custom provider not configured. Save API Base URL, Model ID and API Key first.' });
  }
  try {
    const modelsUrl = baseUrl.replace(/\/$/, '') + '/models';
    const r = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const raw = await r.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
    if (!r.ok) {
      return res.status(502).json({ error: `Custom model discovery failed: ${providerErrorText(body, r.status)}` });
    }
    const rows: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
    const models = rows
      .map((m) => ({ id: String(m?.id ?? m?.name ?? ''), name: String(m?.name || m?.id || ''), source: 'custom' }))
      .filter((m) => m.id);
    return res.json({ models, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Could not discover models from custom endpoint.' });
  }
});

// 6a. GET /api/models/available: the models THIS account may really use, asked of each
// provider with its own stored token. The models.dev catalogue is not account-aware, so it
// suggests ids a subscription login cannot call. Gemini has no OAuth here (API key), so it
// reports separately and never blocks the others.
//
// Fast by default: return the provider's own library exactly as reported. Probing every
// model with a live prompt is opt-in (`?probe=1`) because a large library can take minutes
// and a transient refusal must not erase models from the picker. `?refresh=1` bypasses the
// cache; `?provider=claude` refreshes just one provider.
let availableModelsCache: { at: number; payload: any } | null = null;

// A model listed by the provider is not necessarily runnable on this subscription: some need
// paid usage credits, some need a newer client version. The explicit Test button asks for a
// verdict, and remembers it so the same model is not paid for twice.
const modelVerdicts = new Map<string, { ok: boolean; reason?: string; at: number }>();
const VERDICT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFINITIVE_REFUSAL = /usage credits|credits are required|out of credits|spending.limit|balance exhausted|does not support this model|does not include|not supported|not found|no access|permission|not available|unknown model|invalid model|deprecated/i;

async function probeModel(uiId: string, modelId: string, force = false): Promise<{ ok: boolean; reason?: string }> {
  const key = `${uiId}:${modelId}`;
  const cached = modelVerdicts.get(key);
  if (!force && cached && Date.now() - cached.at < VERDICT_TTL_MS) return cached;
  let verdict: { ok: boolean; reason?: string } = { ok: true };
  try {
    const text = await Promise.race([
      runCompletion({ provider: uiId, model: modelId, messages: [{ role: 'user', content: 'Name the first-line drug for anaphylaxis in one word.' }] }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('probe timed out')), 45_000)),
    ]);
    verdict = { ok: Boolean(text && text.trim()) };
    if (!verdict.ok) verdict.reason = 'returned an empty reply';
  } catch (err: any) {
    const msg = String(err?.message || 'request failed');
    // Hide only on a definitive refusal; keep the model when the failure looks transient.
    verdict = DEFINITIVE_REFUSAL.test(msg) ? { ok: false, reason: msg.replace(/^Claude:\s*/i, '').slice(0, 200) } : { ok: true };
  }
  modelVerdicts.set(key, { ...verdict, at: Date.now() });
  return verdict;
}

async function listProviderModels(uiId: 'claude' | 'grok' | 'chatgpt'): Promise<{ models: { id: string; name: string; source: string }[]; error?: string }> {
  if (!isProviderConnected(uiId)) return { models: [], error: 'Not signed in.' };
  const internal = INTERNAL_PROVIDER[uiId];
  try {
    const result = await oauthListModels(internal as 'codex' | 'xai' | 'claude');
    return {
      models: (result.models || []).map((m: any) => ({ id: String(m.id), name: String(m.name || m.id), source: 'account' })),
      error: result.error,
    };
  } catch (err: any) {
    return { models: [], error: err?.message || `Could not list ${uiId} models.` };
  }
}

async function listOpenCodeModels(): Promise<{ models: { id: string; name: string; source: string }[]; error?: string }> {
  if (!isProviderConnected('opencode')) return { models: [], error: 'No OpenCode API key saved.' };
  const key = opencodeKey();
  // A Go subscription is served under /inference/go/v1/models, a Console key under
  // /inference/v1/models. Try Go first so Go users only see their included models.
  const urls = [OPENCODE_GO_MODELS_URL, OPENCODE_MODELS_URL];
  let lastError = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      const b: any = await r.json().catch(() => ({}));
      if (!r.ok) { lastError = providerErrorText(b, r.status); continue; }
      const rows: any[] = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : [];
      const models = rows
        .map((m: any) => {
          const id = String(m?.id ?? m?.name ?? '');
          return { id, name: String(m?.name || id), source: 'account' };
        })
        .filter((m) => m.id);
      if (models.length) {
        aiLog({ provider: 'opencode', action: 'models', url, count: models.length });
        return { models };
      }
    } catch (e: any) {
      lastError = e?.message || 'network error';
    }
  }
  return { models: [], error: lastError || 'Could not list OpenCode models.' };
}

async function listGeminiModels(): Promise<{ models: { id: string; name: string; source: string }[]; error?: string }> {
  if (!isProviderConnected('gemini')) return { models: [], error: 'No Gemini API key saved.' };
  try {
    const key = geminiKey();
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
    return {
      models: ((b.models || []) as any[])
        .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => ({ id: String(m?.name || '').replace(/^models\//, ''), name: String(m?.displayName || m?.name || ''), source: 'account' }))
        .filter((m) => m.id),
    };
  } catch (e: any) {
    return { models: [], error: e?.message || 'Could not list Gemini models.' };
  }
}


async function listDeepRelayModels(): Promise<{ models: { id: string; name: string; source: string }[]; error?: string }> {
  if (!isProviderConnected('deeprelay')) return { models: [], error: 'No Deep Relay API key saved.' };
  try {
    const r = await fetch(`${DEEPRELAY_BASE_URL}/models`, { method: 'GET', headers: { Authorization: `Bearer ${deepRelayKey()}` } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(providerErrorText(b, r.status));
    const rows: any[] = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : [];
    return { models: rows.map((m) => ({ id: String(m?.id ?? m?.name ?? ''), name: String(m?.name || m?.id || ''), source: 'account' })).filter((m) => m.id) };
  } catch (e: any) { return { models: [], error: e?.message || 'Could not list Deep Relay models.' }; }
}

app.get('/api/models/available', async (req: Request, res: Response) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const probe = req.query.probe === '1' || req.query.probe === 'true';
  const only = String(req.query.provider || '').trim();
  if (only && !['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'custom', 'deeprelay'].includes(only)) {
    return res.status(400).json({ error: `Unknown provider: ${only}` });
  }
  // The full, unprobed list is cacheable; targeted or probed requests are not.
  if (!only && !probe && !refresh && availableModelsCache && Date.now() - availableModelsCache.at < 300_000) {
    return res.json(availableModelsCache.payload);
  }

  const providers: Record<string, { id: string; name: string; source: string }[]> = {};
  const errors: Record<string, string> = {};
  const verified: Record<string, { model: string; ok: boolean; reason?: string }[]> = {};

  const social = (['claude', 'grok', 'chatgpt'] as const).filter((id) => !only || only === id);
  await Promise.all(
    social.map(async (uiId) => {
      const listed = await listProviderModels(uiId);
      if (probe && listed.models.length) {
        const verdicts = await Promise.all(listed.models.map((m) => probeModel(uiId, m.id)));
        providers[uiId] = listed.models.filter((_, i) => verdicts[i].ok);
        verified[uiId] = listed.models.map((m, i) => ({ model: m.id, ok: verdicts[i].ok, reason: verdicts[i].reason }));
        const hidden = listed.models
          .map((m, i) => ({ m, v: verdicts[i] }))
          .filter((x) => !x.v.ok);
        if (hidden.length) {
          errors[uiId] = `${hidden.length} listed model${hidden.length === 1 ? '' : 's'} refused by this plan: ` +
            hidden.map((x) => `${x.m.id} (${x.v.reason || 'refused'})`).join('; ');
        }
      } else {
        providers[uiId] = listed.models;
      }
      if (listed.error && !errors[uiId]) errors[uiId] = listed.error;
    }),
  );

  if (!only || only === 'gemini') {
    const gem = await listGeminiModels();
    providers.gemini = gem.models;
    if (gem.error) errors.gemini = gem.error;
  }

  if (!only || only === 'opencode') {
    const oc = await listOpenCodeModels();
    providers.opencode = oc.models;
    if (oc.error) errors.opencode = oc.error;
  }


  if (!only || only === 'deeprelay') {
    const dr = await listDeepRelayModels(); providers.deeprelay = dr.models; if (dr.error) errors.deeprelay = dr.error;
  }

  const payload = {
    providers,
    errors,
    verified: probe ? verified : undefined,
    probed: probe,
    fetchedAt: new Date().toISOString(),
  };
  if (!only && !probe) availableModelsCache = { at: Date.now(), payload };
  return res.json(payload);
});

// 6a-bis. POST /api/models/probe: explicitly test ONE model with a tiny real prompt.
// This is the honest way to learn whether the subscription can run a listed model.
app.post('/api/models/probe', async (req: Request, res: Response) => {
  const provider = String(req.body?.provider || '').trim();
  const model = String(req.body?.model || '').trim();
  if (!['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'custom', 'deeprelay'].includes(provider)) {
    return res.status(400).json({ error: 'Choose a provider to test.' });
  }
  if (!model || model.length > 200) {
    return res.status(400).json({ error: 'Choose a model id to test.' });
  }
  if (!isProviderConnected(provider)) {
    return res.status(401).json({ error: notConnectedMessage(provider) });
  }
  const verdict = await probeModel(provider, model, true);
  return res.json({ provider, model, ok: verdict.ok, reason: verdict.reason || null, at: new Date().toISOString() });
});

// 6b. GET /api/models/catalog: optional live model catalog from models.dev.
// Used by Settings to suggest current model ids / context sizes. Cached for an
// hour; a network failure is reported honestly (the static defaults still work).
const CATALOG_PROVIDER_MAP: Record<string, string> = {
  chatgpt: 'openai',
  claude: 'anthropic',
  gemini: 'google',
  grok: 'xai',
  opencode: 'opencode',
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
/**
 * Adds internet sources for a topic to the last message, so the writing call can check its own keyed answer
 * against them in the same call. Web pages and Europe PMC are searched here; the book and drug labels come from literatureSources.
 */
async function withInternetSources(messages: OAuthChatMessage[], groundOn: { query?: unknown; subject?: unknown; books?: unknown }): Promise<OAuthChatMessage[]> {
  const query = String(groundOn.query || '').trim().slice(0, 200);
  if (!query) return messages;
  const subject = String(groundOn.subject || '');
  if (groundOn.books) return withBookSources(messages, query, subject);
  const [web, found] = await Promise.all([
    webResearch(query, 1200).then((r) => r.sources).catch(() => []),
    literatureSources(query, subject).catch(() => []),
  ]);
  const seen = new Set<string>();
  const sources = [...found, ...web].filter((s) => {
    if (!s?.text || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  }).slice(0, 6);
  if (!sources.length) return messages;
  const block = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${String(s.text).slice(0, 1200)}`).join('\n\n');
  const last = messages[messages.length - 1];
  return [
    ...messages.slice(0, -1),
    { ...last, content: `${last.content}\n\nInternet sources found for this topic. Read them, then check the keyed option against them before you answer: """${block}"""` },
  ];
}


/**
 * "My books" mode: the book passages are the only source. The internet is searched only when a passage says the
 * books themselves differ on the point, and then only to settle that point. With no passage the writer is told so,
 * and its item is dropped rather than written from memory.
 */
// The last 300 book lookups for writing (query, passages found, how many matched it, whether the internet was used
// instead), so a run's source problems can be read: GET /api/diagnostics/sources.
const sourceLog: { at: string; query: string; subject: string; passages: number; relevant: number; usedWeb: boolean; titles: string[] }[] = [];

async function withBookSources(messages: OAuthChatMessage[], query: string, subject: string): Promise<OAuthChatMessage[]> {
  const found = searchMyBooks(query, subject, 4, 1800);
  // Only passages that are about the query count; unrelated chapters are not handed to the writer.
  const passages = found.filter((p: any) => passageMatchesQuery(`${p.title} ${p.heading} ${p.text}`, query));
  const last = messages[messages.length - 1];
  const withText = (extra: string): OAuthChatMessage[] => [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${extra}` }];
  const logEntry = { at: new Date().toISOString(), query: query.slice(0, 160), subject, passages: found.length, relevant: passages.length, usedWeb: false, titles: found.map((p: any) => `${p.title} / ${p.heading}`.slice(0, 120)) };
  sourceLog.push(logEntry);
  if (sourceLog.length > 300) sourceLog.splice(0, sourceLog.length - 300);
  if (!passages.length) {
    // The books do not cover this point: the internet is used for it instead (books where possible, the internet when
    // they fall short), and the writer is told plainly, so it writes a question rather than a note about missing passages.
    const web = await webResearch(query, 1200).then((r: any) => r.sources).catch(() => []);
    const sources = (web || []).filter((w: any) => w?.text).slice(0, 4);
    if (sources.length) {
      logEntry.usedWeb = true;
      return withText(`The learner's books have no passage on this point, so use these internet sources for it. Base the correct option and keyFact on them; never mention the books, passages or sources in the question or the explanation. Sources: """${sources.map((w: any, i: number) => `[W${i + 1}] ${w.title}\n${w.url}\n${String(w.text).slice(0, 1500)}`).join('\n\n')}"""`);
    }
    return withText('MY BOOKS: no passage in the learner\'s books matches this topic. Write nothing from memory: set "sourceCheck" to "not supported".');
  }
  const bookBlock = passages.map((p: any, i: number) => `[B${i + 1}] ${p.title}\nSection: ${p.heading}\n${p.text}`).join('\n\n');
  let extra = `MY BOOKS (the learner's own books, the only source for this item). Base the correct option and keyFact ONLY on these passages, never on outside knowledge. In "citations" give the book and chapter you used. If these passages do not state a fact you can test, set "sourceCheck" to "not supported". Passages: """${bookBlock}"""`;
  if (passages.some((p: any) => p.disputed)) {
    const web = await webResearch(query, 1200).then((r: any) => r.sources).catch(() => []);
    const sources = web.filter((w: any) => w?.text).slice(0, 3);
    if (sources.length) {
      extra += `\n\nThe books say their sources differ on a point here. Use these internet sources ONLY to settle that disputed point, and prefer a different fact if it stays unsettled: """${sources.map((w: any, i: number) => `[W${i + 1}] ${w.title}\n${w.url}\n${String(w.text).slice(0, 1200)}`).join('\n\n')}"""`;
    }
  }
  return withText(extra);
}

// Diagnostics: the run report the app sends after each generation, saved under <PULSE_DATA_DIR>/diagnostics/, and the
// recent book lookups for writing.
app.post('/api/diagnostics/run-report', (req: Request, res: Response) => {
  try {
    const dir = path.join(DATA_DIR, 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    const name = `run-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ ...req.body, sourceLog: sourceLog.slice(-300) }, null, 2), 'utf8');
    return res.json({ ok: true, file: path.join(dir, name) });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not save the run report.' });
  }
});
app.get('/api/diagnostics/sources', (_req: Request, res: Response) => res.json({ lookups: sourceLog.slice(-300) }));

// GET /api/mybooks/status -> which of the learner's books are installed.
app.get('/api/mybooks/status', (_req: Request, res: Response) => {
  try { return res.json(myBooksStatus()); } catch (err: any) { return res.status(500).json({ error: err?.message || 'Could not read the books.' }); }
});


// Checks one generated item against the sources: is the keyed answer correct, and is every fact it relies on
// (a study, a product, a therapy) supported by those sources? Returns 'supported' or 'unsupported' with a reason.
app.post('/api/ai/verify-item', async (req: Request, res: Response) => {
  const { provider, model, question, groundOn } = req.body || {};
  if (!provider || !question || typeof question !== 'object') {
    return res.status(400).json({ error: 'provider and question are required.' });
  }
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  const item = JSON.stringify({
    stem: question.stem,
    questionText: question.questionText,
    options: question.options,
    keyedAnswer: question.correctOption,
    keyFact: question.keyFact,
  });
  const messages: OAuthChatMessage[] = [{
    role: 'user',
    content: `Check this exam item against the sources attached after this request.\n\nItem:\n${item}\n\nAnswer with one JSON object: {"keyCorrect": true or false, "premiseSupported": true or false, "reason": "one sentence"}.\n- keyCorrect is false only if the sources show the keyed answer is wrong, or another option is clearly better. If the sources simply do not mention the topic, keyCorrect is true.\n- premiseSupported is false only if the sources contradict the item or say the study, product or therapy it relies on does not exist. Mentioning nothing about it is not a contradiction.`,
  }];
  try {
    const grounded = groundOn && typeof groundOn === 'object' ? await withInternetSources(messages, groundOn) : messages;
    const text = await runCompletion({
      provider,
      model,
      system: 'You are a strict medical fact checker for postgraduate exam items. Answer only with the JSON object.',
      messages: grounded,
      json: true,
      effort: 'min',
      purpose: 'verify',
      signal: controller.signal,
    });
    const parsed = extractJson<{ keyCorrect?: boolean; premiseSupported?: boolean; reason?: string }>(text);
    // Only a wrong key or a contradicted premise drops an item. Sources that are silent on a point do not.
    const supported = parsed?.keyCorrect !== false && parsed?.premiseSupported !== false;
    return res.json({ verdict: supported ? 'supported' : 'unsupported', reason: String(parsed?.reason ?? '').slice(0, 300) });
  } catch (err: any) {
    if (controller.signal.aborted) return;
    const status = err instanceof ApiError ? err.status : 502;
    return res.status(status).json({ error: err?.message || 'Verification failed.' });
  }
});

// Saves a set of generated questions to exports/ in the project, so they can be read and checked later.
app.post('/api/export/questions', (req: Request, res: Response) => {
  const dir = path.join(process.cwd(), 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const name = `questions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(req.body, null, 2), 'utf8');
  res.json({ ok: true, file: path.join('exports', name) });
});




// The engine used by the most recent generation request, so the progress page can show what is running.
let lastEngine: { provider: string; model: string; at: string } | null = null;


// Gate for /api/ai/complete: at most 30 calls at once to the provider, and a call refused with HTTP 429 (rate limit)
// waits and tries again instead of failing. Long batch jobs (topic lists, merges) then lose almost nothing.
let completeActive = 0;
const completeWaiters: Array<() => void> = [];
async function gatedCompletion(args: Parameters<typeof runCompletion>[0]): Promise<string> {
  while (completeActive >= 30) await new Promise<void>((r) => completeWaiters.push(r));
  completeActive++;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await runCompletion(args);
      } catch (err: any) {
        const limited = (err instanceof ApiError && err.status === 429) || /rate limit|429/i.test(String(err?.message || ''));
        if (!limited || attempt >= 5 || args.signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1) + Math.random() * 2000));
      }
    }
  } finally {
    completeActive--;
    completeWaiters.shift()?.();
  }
}

app.post('/api/ai/complete', async (req: Request, res: Response) => {
  const { provider, model, system, messages, json, effort, groundOn } = req.body || {};
  if (!provider) {
    return res.status(400).json({ error: 'No AI provider selected. Connect an AI provider in Settings.' });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.some((m: any) => !m || typeof m.content !== 'string')) {
    return res.status(400).json({ error: 'messages must be an array of {role, content}.' });
  }
  // The client's Stop button aborts its fetch; mirror that upstream so a stopped
  // generation does not keep burning provider quota.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    const grounded = groundOn && typeof groundOn === 'object' ? await withInternetSources(messages, groundOn) : messages;
    const text = await gatedCompletion({ provider, model, system, messages: grounded, json, effort, purpose: 'write', signal: controller.signal, session: req.header('x-opencode-session') || undefined });
    if (controller.signal.aborted) return;
    if (!text || !text.trim()) {
      return res.status(502).json({ error: 'The AI provider returned an empty response. Try again.' });
    }
    return res.json({ success: true, text, model: model || DEFAULT_MODELS[provider] });
  } catch (err: any) {
    if (controller.signal.aborted) return; // client stopped it; nothing to answer
    const status = err instanceof ApiError ? err.status : 502;
    if (!res.headersSent) return res.status(status).json({ error: err?.message || 'AI request failed.' });
  }
});

// Generation jobs. The browser allows only a few open connections to one server, so a long completion would hold
// one of them for the whole call. A job starts the completion here and returns at once; the browser checks it with
// short requests. The server, not the browser, then runs as many calls at once as the provider allows.
type CompletionJob = { controller: AbortController; done: boolean; status: number; body: unknown; retryAfter?: string; createdAt: number };
const completionJobs = new Map<string, CompletionJob>();
setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, job] of completionJobs) if (job.createdAt < cutoff) { job.controller.abort(); completionJobs.delete(id); }
}, 60_000).unref();

app.post('/api/ai/jobs', (req: Request, res: Response) => {
  const { provider, model, system, messages, json, effort, groundOn } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'No AI provider selected. Connect an AI provider in Settings.' });
  if (!Array.isArray(messages) || messages.length === 0 || messages.some((m: any) => !m || typeof m.content !== 'string')) {
    return res.status(400).json({ error: 'messages must be an array of {role, content}.' });
  }
  const id = crypto.randomUUID();
  const job: CompletionJob = { controller: new AbortController(), done: false, status: 200, body: null, createdAt: Date.now() };
  completionJobs.set(id, job);
  const session = req.header('x-opencode-session') || undefined;
  lastEngine = { provider: String(provider), model: String(model || DEFAULT_MODELS[provider] || provider), at: new Date().toISOString() };
  void (async () => {
    try {
      const grounded = groundOn && typeof groundOn === 'object' ? await withInternetSources(messages, groundOn) : messages;
      const text = await runCompletion({ provider, model, system, messages: grounded, json, effort, purpose: 'write', signal: job.controller.signal, session });
      if (!text || !text.trim()) {
        job.status = 502;
        job.body = { error: 'The AI provider returned an empty response. Try again.' };
      } else {
        job.status = 200;
        job.body = { success: true, text, model: model || DEFAULT_MODELS[provider] };
      }
    } catch (err: any) {
      job.status = err instanceof ApiError ? err.status : 502;
      job.body = { error: err?.message || 'AI request failed.' };
    } finally {
      job.done = true;
    }
  })();
  return res.json({ id });
});

// Checks a job. Returns { done: false } while it runs; once done, returns the result and forgets the job.
app.get('/api/ai/jobs/:id', (req: Request, res: Response) => {
  const job = completionJobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'Unknown or expired job.' });
  if (!job.done) return res.json({ done: false });
  completionJobs.delete(String(req.params.id));
  return res.json({ done: true, status: job.status, body: job.body, retryAfter: job.retryAfter });
});

// Stops a job the browser no longer waits for (the user pressed Stop).
app.delete('/api/ai/jobs/:id', (req: Request, res: Response) => {
  const job = completionJobs.get(String(req.params.id));
  if (job) {
    job.controller.abort();
    completionJobs.delete(String(req.params.id));
  }
  res.json({ ok: true });
});




// ---------- tutor-chat (kept for AITutorView; backed by the same real completion path) ----------

const PERSONA_PROMPTS: Record<string, string> = {
  BOARD_MASTER: 'You are the PULSE MED Board Exam Master for NEET-PG / INI-CET: razor-sharp high-yield clinical breakdowns, distractor (trap) dissection, and exam-board pearls.',
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
    const candidates = ['chatgpt', 'claude', 'grok', 'opencode', 'gemini'];
    provider = candidates.find((p) => isProviderConnected(p)) || '';
  }
  if (!provider) {
    return res.status(401).json({ error: 'No AI provider is connected yet. Connect an AI provider in Settings → AI Subscription Hub.' });
  }

  const system = [
    'You are the PULSE MED clinical AI tutor for postgraduate medical exams (NEET-PG, INI-CET).',
    typeof body.exam === 'string' && body.exam
      ? `The learner's active exam is ${String(body.exam).replace('_', '-')}. Tailor depth, terminology and guidelines to that exam (NEET-PG/INI-CET: Indian and international standard references).`
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
    '- Start "reply" with one bold line giving the direct answer, for example "**Answer: C - voriconazole.**", then the explanation. A learner revising in a hurry should get the answer in the first line.',
    '- Each citation must name the book with its edition and the chapter or guideline section, for example "Harrison\'s Principles of Internal Medicine, 21st Ed, Ch. 142 (Invasive aspergillosis)". Cite only sources you are confident exist; leave the list empty rather than guess a chapter.',
    // The reply is rendered as markdown. Without this the model often returns one unbroken
    // block of prose, which reads as a dense wall of text in the chat bubble.
    '- Format "reply" for readability: separate distinct topics or stages into their own paragraphs using \\n\\n, and use a short markdown heading or a "- " bullet list where the content is genuinely a list (e.g. investigations, differentials, management steps). Do not return one unbroken paragraph.',
    // Optional illustration request. The model DESCRIBES the figure it wants; it must never
    // choose or link an image, because the server has to vision-verify whatever is shown.
    body.requestImage
      ? '- If (and only if) a clinical figure would materially help, make the LAST line of "reply" exactly: IMAGE_CUE: <short description of the single most useful image, e.g. "chest X-ray of tension pneumothorax">. Describe only the finding and modality — never output a URL, filename or markdown image. If no figure would genuinely help, make the last line: IMAGE_CUE: NONE'
      : '',
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

  // Evidence for this question: a drug label and PubMed abstracts, fetched before the model answers.
  // The model is told to rely on them where they apply and to cite them by title.
  const evidence = await literatureSources(message.slice(0, 200), typeof body.subject === 'string' ? body.subject : '').catch(() => []);
  const groundedSystem = evidence.length
    ? [
        system,
        'Evidence retrieved for this question (use it where it applies, cite it by its title, and say when a point is from your own knowledge rather than these sources):',
        ...evidence.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${String(s.text || '').slice(0, 1200)}`),
      ].join('\n\n')
    : system;

  try {
    const raw = await runCompletion({
      provider,
      model: typeof body.model === 'string' ? body.model : undefined,
      system: groundedSystem,
      messages,
      json: true,
      effort: typeof body.effort === 'string' ? body.effort : undefined,
      session: req.header('x-opencode-session') || undefined,
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
    if (evidence.length) result.sources = evidence.map((s) => ({ title: s.title, url: s.url }));

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

// GET /api/images/search?q=... -> PD/CC0-licensed clinical figures from Open-i (NLM) and Wikimedia Commons.
// Results also need strong metadata relevance; weak or uncertain matches are omitted.
app.get('/api/images/search', async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.status(400).json({ error: 'q is required.' });
  try {
    const { results, errors } = await searchImages(query, { limit: 6 });
    return res.json({ provider: 'Open-i + Wikimedia Commons', query, results, errors });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Live image search failed.' });
  }
});

// GET /api/images/proxy?u=... -> stream one Open-i figure (cached on disk, no hotlinking).
app.get('/api/images/proxy', async (req: Request, res: Response) => {
  const url = typeof req.query.u === 'string' ? req.query.u : '';
  try {
    const { buffer, type } = await fetchImage(url);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(buffer);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Could not load that image.' });
  }
});



// Vision check: does `imageUrl` actually show `claim`? Shared by the /verify route and
// the bank harvest (so both use identical strictness). Fail-closed: any error, missing
// key, unsupported type or non-answer yields pass=false — an unverified picture is NEVER
// attached, the question stays text-only instead.
async function visionVerify(
  imageUrl: string,
  claim: string,
  modality: string,
  questionContext: { questionStem?: string; questionText?: string; correctAnswer?: string; explanation?: string; boardPearl?: string; bodyPart?: string } = {},
  provider: string = 'gemini',
  model: string = '',
  attempt = 0,
): Promise<{ pass: boolean; reason: string; debug?: { raw: string; finish?: string } }> {
  if (provider === 'gemini' && !geminiKey()) {
    return { pass: false, reason: notConnectedMessage('gemini') };
  }
  const { buffer, type } = await fetchImage(imageUrl);
  // The vision API accepts JPEG/PNG/WebP. GIF (and anything else) is rejected with
  // HTTP 415, so treat it as unverifiable rather than attaching it blind.
  if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
    return { pass: false, reason: `Unsupported image type (${type}) — image skipped.` };
  }
  const dataUrl = `data:${type};base64,${buffer.toString('base64')}`;
  const instruction = buildVisionVerificationPrompt({
    claim,
    modality,
    questionStem: questionContext.questionStem,
    questionText: questionContext.questionText,
    correctAnswer: questionContext.correctAnswer,
    explanation: questionContext.explanation,
    boardPearl: questionContext.boardPearl,
    bodyPart: questionContext.bodyPart,
  });
  if (provider !== 'gemini') {
    return { pass: false, reason: 'The selected model cannot check images. Use Gemini for image questions.' };
  }
  const model_ = model || DEFAULT_MODELS.gemini;
  const payload = JSON.stringify({
    model: model_,
    messages: [
      { role: 'system', content: 'You are a strict medical-image verifier. Reply with only a JSON object.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: Number(process.env.VISION_MAX_TOKENS || 2048),
    stream: false,
  });
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${geminiKey()}` },
    body: payload,
    signal: AbortSignal.timeout(Number(process.env.VISION_TIMEOUT_MS || 180000)),
  });
  const raw = await r.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }
  if (!r.ok) {
    // A 5xx here is an upstream blip, not a verdict on the image. Retry once so a good
    // image is not discarded (and forced to text-only) because the provider hiccuped.
    if (r.status >= 500 && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return visionVerify(imageUrl, claim, modality, questionContext, provider, model, attempt + 1);
    }
    aiLog({ provider: 'gemini', model: model_, status: r.status, error: true, route: 'images/verify' });
    return { pass: false, reason: `Vision check failed (HTTP ${r.status}) — image skipped.` };
  }
  const msg = body?.choices?.[0]?.message;
  const content = msg?.content;
  let text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('')
      : '';
  if (!text.trim() && typeof msg?.reasoning_content === 'string') text = msg.reasoning_content;
  const finish = body?.choices?.[0]?.finish_reason;
  const verdict = parseVisionVerdict(text);
  const pass = verdict?.pass === true;
  const reason = verdict?.reason || (pass
    ? 'Verified.'
    : finish === 'length'
      ? 'Vision model ran out of tokens before answering — image skipped.'
      : 'Model did not return a complete structured verdict — image skipped.');
  aiLog({ provider: 'gemini', model: model_, status: r.status, route: 'images/verify', pass, finish, text_len: text.length });
  return process.env.VISION_DEBUG
    ? { pass, reason, debug: { raw: text.slice(0, 1500), finish } }
    : { pass, reason };
}

// POST /api/images/verify -> vision check BEFORE an image may be attached.
// The old pipeline matched a figure's *caption/title* words, so an unrelated picture
// whose caption happened to reuse the right words (a tangerine for "hazy cornea")
// still passed. This actually looks at the pixels with the selected Gemini vision
// model and asks whether the image shows what the question claims.
app.post('/api/images/verify', async (req: Request, res: Response) => {
  const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : '';
  const claim = typeof req.body?.claim === 'string' ? req.body.claim.trim().slice(0, 800) : '';
  const modality = typeof req.body?.modality === 'string' ? req.body.modality.trim().slice(0, 40) : '';
  const questionStem = typeof req.body?.questionStem === 'string' ? req.body.questionStem.trim().slice(0, 4000) : '';
  const questionText = typeof req.body?.questionText === 'string' ? req.body.questionText.trim().slice(0, 2000) : '';
  const correctAnswer = typeof req.body?.correctAnswer === 'string' ? req.body.correctAnswer.trim().slice(0, 500) : '';
  const explanation = typeof req.body?.explanation === 'string' ? req.body.explanation.trim().slice(0, 3000) : '';
  const boardPearl = typeof req.body?.boardPearl === 'string' ? req.body.boardPearl.trim().slice(0, 1000) : '';
  const bodyPart = typeof req.body?.bodyPart === 'string' ? req.body.bodyPart.trim().slice(0, 60) : '';
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'gemini';
  const model = typeof req.body?.model === 'string' ? req.body.model : '';
  if (!imageUrl || !claim) {
    return res.status(400).json({ error: 'imageUrl and claim are required.' });
  }
  try {
    const verdict = await visionVerify(imageUrl, claim, modality, { questionStem, questionText, correctAnswer, explanation, boardPearl, bodyPart }, provider, model);
    return res.json(verdict);
  } catch (err: any) {
    return res.json({ pass: false, reason: err?.message || 'Vision check failed — image skipped.' });
  }
});

// GET /api/images/bank -> curated bank statistics (for the settings/status panel).
app.get('/api/images/bank', (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, ...bankStats() });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not read the image bank.' });
  }
});

// POST /api/images/bank/build -> harvest the curated seeds into the bank (idempotent).
// Pass { verify: true } to vision-confirm each candidate at harvest time, so the bank
// only ever holds images that genuinely show the claimed finding.
app.post('/api/images/bank/build', async (req: Request, res: Response) => {
  try {
    const wantVerify = req.body?.verify === true;
    const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'gemini';
    const model = typeof req.body?.model === 'string' ? req.body.model : '';
    const canVerify = wantVerify && provider === 'gemini' && Boolean(geminiKey());
    const summary = await buildImageBank({
      limitPerSeed: Number(req.body?.limitPerSeed) || 3,
      verify: canVerify
        ? async (entry: any) => {
            const claim = `${entry.ground_truth}${entry.modality ? ` (${entry.modality})` : ''}`;
            try {
              const verdict = await visionVerify(entry.imageUrl, claim, entry.modality, {}, provider, model);
              return verdict.pass === true;
            } catch {
              return false;
            }
          }
        : undefined,
    });
    return res.json({ success: true, ...summary, verified: Boolean(canVerify) });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Image-bank build failed.' });
  }
});

// GET /api/images/qa-results -> the last image-first verification RUN (tools/test-image-first.mjs).
// Lets the Image Question Review page show a real end-to-end run: per-question image,
// ground truth, verification verdict and the pass/fallback counts.
app.get('/api/images/qa-results', (_req: Request, res: Response) => {
  try {
    const file = path.join(DATA_DIR, 'image-first-results.json');
    if (!fs.existsSync(file)) return res.json({ success: true, available: false, run: null });
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    return res.json({ success: true, available: true, run });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not read the last image-first run.' });
  }
});

// GET /api/images/bank/entry?id=... -> one bank entry (used by the review page).
app.get('/api/images/bank/entry', (req: Request, res: Response) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const entry = id ? getBankImage(id) : null;
  if (!entry) return res.status(404).json({ error: 'No bank entry with that id.' });
  return res.json({ success: true, entry });
});

// GET /api/images/bank/entries?subject=&modality=&limit= -> browse bank entries.
app.get('/api/images/bank/entries', (req: Request, res: Response) => {
  try {
    const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;
    const modality = typeof req.query.modality === 'string' ? req.query.modality : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 300) : '';
    const limit = Number(req.query.limit) || 6;
    const rows = query
      ? searchBankByText(query, { subject, limit })
      : subject || modality ? queryImageBank({ subject, modality, limit }) : loadImageBank().slice(0, limit);
    return res.json({ success: true, total: loadImageBank().length, results: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not read the image bank.' });
  }
});



// POST /api/images/find-for-explanation -> one VERIFIED illustration for an explanation.
//
// Flow (same safety rules as the question pipeline):
//   1. the model supplies a text CUE only ("chest X-ray of a tension pneumothorax") — it
//      never writes a URL, so it cannot fabricate or hotlink an image;
//   2. the cue is matched against the curated bank's trusted metadata;
//   3. the winner is vision-verified against its OWN ground truth before it is returned.
// Fail-closed: no cue, no match, no vision provider, or a failed check all return
// { found: false } and the explanation stays text-only — never an unverified picture.
app.post('/api/images/find-for-explanation', async (req: Request, res: Response) => {
  const body = req.body || {};
  const cue = typeof body.cue === 'string' ? body.cue.trim().slice(0, 300) : '';
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const provider = typeof body.provider === 'string' ? body.provider : 'gemini';
  const model = typeof body.model === 'string' ? body.model : '';
  if (!cue) return res.json({ found: false, reason: 'No image cue was supplied.' });
  try {
    const candidates = searchBankByText(cue, { subject, limit: 4 });
    if (!candidates.length) {
      return res.json({ found: false, reason: 'No bank image matches that description.' });
    }
    // Try candidates in score order; the first that passes verification wins.
    for (const entry of candidates) {
      const claim = `${entry.ground_truth}${entry.modality ? ` (${entry.modality})` : ''}`;
      let verdict: { pass: boolean; reason: string };
      try {
        verdict = await visionVerify(entry.imageUrl, claim, entry.modality, {}, provider, model);
      } catch (err: any) {
        verdict = { pass: false, reason: err?.message || 'Vision check failed.' };
      }
      if (verdict.pass) {
        return res.json({
          found: true,
          imageId: entry.image_id,
          // SECURITY/EXAM-INTEGRITY: the ground truth is Omitted from the response the
          // UI renders up-front. Attribution + licence only; the finding is withheld
          // because it can be the answer to the very question being explained.
          imageUrl: entry.previewUrl || entry.imageUrl,
          source: entry.source,
          sourceUrl: entry.sourceUrl,
          licence: entry.licence,
          attribution: entry.attribution,
          modality: entry.modality,
          subject: entry.subject,
          verification: verdict.reason,
        });
      }
      aiLog({ provider, route: 'images/find-for-explanation', pass: false, reason: verdict.reason.slice(0, 160), image_id: entry.image_id });
    }
    return res.json({ found: false, reason: 'No bank image passed verification for that description.' });
  } catch (err: any) {
    return res.json({ found: false, reason: err?.message || 'Image lookup failed.' });
  }
});

// POST /api/images/generate-question -> image-first: write an MCQ FROM one bank image.
// The ground truth comes from the bank (never from the model), so the diagnosis shown
// by the image is authoritative and the question is built around it.
app.post('/api/images/generate-question', async (req: Request, res: Response) => {
  const body = req.body || {};
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : '';
  const groundTruth = typeof body.groundTruth === 'string' ? body.groundTruth.trim() : '';
  const imageId = typeof body.imageId === 'string' ? body.imageId : '';
  const provider = typeof body.provider === 'string' ? body.provider : 'gemini';
  const model = typeof body.model === 'string' ? body.model : DEFAULT_MODELS.gemini;
  if (!imageUrl || !groundTruth) {
    return res.status(400).json({ error: 'imageUrl and groundTruth are required.' });
  }
  if (provider !== 'gemini') {
    return res.status(400).json({ error: 'The selected model cannot check images. Use Gemini for image questions.' });
  }
  const key = geminiKey();
  if (!key) {
    return res.status(401).json({ error: notConnectedMessage('gemini') });
  }
  try {
    const writeOnce = () => generateQuestionFromImage({
      imageUrl,
      groundTruth,
      modality: typeof body.modality === 'string' ? body.modality : '',
      subject: typeof body.subject === 'string' ? body.subject : '',
      bodyPart: typeof body.bodyPart === 'string' ? body.bodyPart.trim().slice(0, 60) : '',
      exam: typeof body.exam === 'string' ? body.exam : 'NEET_PG',
      difficultyTier: typeof body.difficultyTier === 'string' ? body.difficultyTier : 'MEDIUM',
      optionCount: Number(body.optionCount) === 5 ? 5 : 4,
      apiKey: key,
      model,
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    });
    let question;
    try {
      question = await writeOnce();
    } catch (firstErr: any) {
      // The vision model sometimes answers with text that is not JSON. That is a one-off, so one more attempt is made
      // before the image is given up; a real mismatch or a provider outage is not retried.
      if (!/did not return usable JSON/i.test(String(firstErr?.message || ''))) throw firstErr;
      question = await writeOnce();
    }
    return res.json({ success: true, question, model });
  } catch (err: any) {
    const msg = String(err?.message || 'Image-first generation failed.');
    // A model-declared mismatch means this image genuinely does not show the claimed
    // finding. Remember it, so future runs do not spend another slow vision call on it.
    const status = msg === 'image_mismatch' ? 422 : 502;
    if (msg === 'image_mismatch' && imageId) {
      try { rejectImage(imageId, groundTruth, msg); } catch { /* bookkeeping only */ }
    }
    aiLog({ provider: 'gemini', route: 'images/generate-question', error: true, status, reason: msg.slice(0, 200) });
    return res.status(status).json({ error: msg });
  }
});

// GET /api/images/sources -> which libraries are embedded vs reference-only.
app.get('/api/images/sources', (_req: Request, res: Response) => {
  res.json({
    embedded: [
      { name: 'Open-i (NLM / PubMed Central)', url: 'https://openi.nlm.nih.gov/', note: 'Live search; CC0 and Public Domain items only.' },
      { name: 'Wikimedia Commons (CDC PHIL and others)', url: 'https://commons.wikimedia.org/', note: 'PD/CC0 images only; verify the license shown for each source file.' },
    ],
    reference: REFERENCE_SOURCES,
  });
});

// ==========================================
// QUALITY ASSURANCE PIPELINE (server/qa)
// ==========================================
// Intercepts generated questions before publication. Deterministic stages always run;
// LLM stages run only when the caller passes runLlm and a provider is available. Fail
// closed: a question is never approved on the strength of a single free-text AI answer.
const qaBank: DupRecord[] = []; // in-memory approved bank used for duplicate detection

function qaComplete(provider: string, model: string): CompleteFn {
  return async (system, messages, json, role) => {
    const modelOverride = role ? process.env[`QA_MODEL_${role.toUpperCase()}`] : undefined;
    return runCompletion({
      provider,
      model: modelOverride || model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.opencode,
      system,
      messages,
      json,
      // QA checks are short judgements on a finished question; thinking here made each review take minutes.
      effort: 'min',
    });
  };
}

app.get('/api/qa/profiles', (_req: Request, res: Response) => {
  res.json({ profiles: listExamProfiles() });
});

app.post('/api/qa/review', async (req: Request, res: Response) => {
  const question = req.body?.question;
  if (!question || typeof question !== 'object') {
    return res.status(400).json({ error: 'question is required.' });
  }
  const runLlm = req.body?.runLlm === true;
  const provider = String(req.body?.provider || 'opencode');
  const model = String(req.body?.model || DEFAULT_MODELS[provider] || '');
  const complete = runLlm ? qaComplete(provider, model) : undefined;
  try {
    const review = await runQaPipeline(question, {
      complete,
      runLlm,
      bank: qaBank,
    });
    if (review.status === 'APPROVED') {
      qaBank.push({
        id: question.id || String(Date.now()),
        stem: question.stem,
        questionText: question.questionText,
        subject: question.subject,
        subtopic: question.subtopic,
        correctOption: question.correctOption,
      });
    }
    return res.json({ review });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'QA review failed.' });
  }
});

app.post('/api/qa/review-batch', async (req: Request, res: Response) => {
  const questions = req.body?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions (array) is required.' });
  }
  const runLlm = req.body?.runLlm === true;
  const provider = String(req.body?.provider || 'opencode');
  const model = String(req.body?.model || DEFAULT_MODELS[provider] || '');
  const complete = runLlm ? qaComplete(provider, model) : undefined;
  // Questions are reviewed three at a time; results keep the order they were sent in.
  const list = questions.slice(0, 200);
  const reviews: any[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const q = list[i];
      try {
        reviews[i] = await runQaPipeline(q, { complete, runLlm, bank: qaBank });
      } catch (err: any) {
        reviews[i] = { questionId: q?.id, error: err?.message || 'QA failed', status: 'REVIEWING' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
  return res.json({ reviews });
});

// POST /api/qa/refine-batch -> SECOND mechanism: post-generation refinement.
// Removes answer leakage / obvious hints and neutralises option structure before QA.
app.post('/api/qa/refine-batch', async (req: Request, res: Response) => {
  const questions = req.body?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions (array) is required.' });
  }
  const provider = String(req.body?.provider || 'opencode');
  const model = String(req.body?.model || DEFAULT_MODELS[provider] || '');
  const complete = qaComplete(provider, model);
  try {
    const refined = await refineBatch(questions.slice(0, 200), complete);
    return res.json({ questions: refined });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Refinement failed.' });
  }
});

// POST /api/web/research {query} -> real internet search (DuckDuckGo + PubMed).// Sources carry their URLs; the client may ask the AI to summarise them. Never canned.
app.post('/api/web/research', async (req: Request, res: Response) => {
  const query = typeof req.body?.query === 'string' ? req.body.query : '';
  try {
    const pageChars = Math.min(30000, Math.max(2500, Number(req.body?.pageChars) || 2500));
    // My books mode: the sources are the learner's own books only, the subject's book first and then the others.
    if (req.body?.books) {
      const found = searchMyBooks(query, typeof req.body?.subject === 'string' ? req.body.subject : '', 6, Math.min(pageChars, 2500));
      return res.json({ success: true, sources: found.map((f: any) => ({ title: `${f.title} — ${f.heading}`, url: `mybooks:${f.title}`, text: f.text, kind: 'book' })), retrievedAt: new Date().toISOString() });
    }
    const out = await webResearch(query, pageChars);
    return res.json({ success: true, sources: out.sources, retrievedAt: out.retrievedAt });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Web research failed.' });
  }
});

// POST /api/exams/dates {exam} -> look for the next sitting's date on the OFFICIAL body
// only (NBEMS / AIIMS). Internet-backed, dependency-free.
//
// Deliberately conservative: coaching sites and aggregators routinely *guess* dates, and
// a wrong countdown actively harms a student, so a source is only used if its hostname is
// on the allowlist below. The route returns candidates WITH their source URL and a
// confidence tag for the UI to confirm — it never silently decides the date.
const OFFICIAL_EXAM_SOURCES: Record<string, { label: string; hosts: string[]; queries: string[] }> = {
  NEET_PG: {
    label: 'NBEMS (National Board of Examinations)',
    hosts: ['natboard.edu.in', 'nbe.edu.in'],
    queries: ['NBEMS NEET-PG exam date notification', 'NEET-PG 2027 information bulletin exam date'],
  },
  INI_CET: {
    label: 'AIIMS (aiimsexams.ac.in)',
    hosts: ['aiimsexams.ac.in', 'aiims.edu'],
    queries: ['AIIMS INI-CET exam date notification', 'aiimsexams INI-CET 2027 schedule prospectus'],
  },
};

app.post('/api/exams/dates', async (req: Request, res: Response) => {
  const exam = String(req.body?.exam || '').trim().toUpperCase();
  const spec = OFFICIAL_EXAM_SOURCES[exam];
  if (!spec) {
    return res.status(400).json({ error: 'Unknown exam. Use NEET_PG or INI_CET.' });
  }
  try {
    const batches = await Promise.allSettled(spec.queries.map((q) => webResearch(q)));
    const sources = batches.flatMap((b) => (b.status === 'fulfilled' ? b.value.sources : []));

    // Only keep pages actually hosted by the official body.
    const official = sources.filter((s: any) => {
      try {
        const host = new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./, '');
        return spec.hosts.some((h) => host === h || host.endsWith(`.${h}`));
      } catch {
        return false;
      }
    });

    // Harvest date-like strings from the official pages that were reachable.
    const seen = new Set<string>();
    const candidates: { iso: string; sourceUrl: string; sourceTitle: string; context: string }[] = [];
    for (const s of official) {
      const text = String(s.text || '');
      for (const m of text.matchAll(/\b(\d{1,2})[\s-](January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,-]+(\d{4})\b/g)) {
        const day = Number(m[1]);
        const monName = m[2].slice(0, 3).toLowerCase();
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const mi = months.indexOf(monName);
        if (mi < 0 || day < 1 || day > 31) continue;
        const d = new Date(Number(m[3]), mi, day, 9, 0);
        if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) continue; // only future sittings
        const iso = d.toISOString();
        const key = iso.slice(0, 10);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          iso,
          sourceUrl: String(s.url),
          sourceTitle: String(s.title || '').slice(0, 120),
          context: text.slice(Math.max(0, (m.index || 0) - 60), (m.index || 0) + 90).replace(/\s+/g, ' ').trim(),
        });
      }
    }
    candidates.sort((a, b) => a.iso.localeCompare(b.iso));

    // The official sites load dates with JavaScript, so often nothing can be read. In
    // that case the most useful thing we can return is a direct link to the official
    // page, so the learner can check it in one click instead of hunting for it.
    const officialLinks = [
      ...new Map(
        official
          .map((s: any) => {
            try {
              const host = new URL(String(s.url)).hostname.replace(/^www\./, '');
              return { host, url: String(s.url), title: String(s.title || '').slice(0, 120) };
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .map((l: any) => [l.host, l]),
      ).values(),
    ].slice(0, 4);

    return res.json({
      success: true,
      exam,
      officialBody: spec.label,
      officialDomains: spec.hosts,
      officialPagesFound: official.length,
      officialLinks,
      candidates: candidates.slice(0, 6),
      checkedAt: new Date().toISOString(),
      note: candidates.length
        ? 'Dates were read from official pages that were reachable. Confirm before saving.'
        : official.length
          ? 'The official page was found, but its dates are loaded with JavaScript, so none could be read. Enter the date manually from the official notice.'
          : 'No official page could be reached. Enter the date manually from the official notice.',
    });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Could not check exam dates.' });
  }
});

// Legacy provider list endpoint, now reporting ONLY real connection state (no latency fakes).
app.get('/api/providers/status', (req: Request, res: Response) => {
  const customEndpoints = readCustomEndpoints();
  res.json({
    providers: [
      ...(['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'deeprelay'] as string[]).map((id) => ({
        id,
        model: DEFAULT_MODELS[id],
        connected: isProviderConnected(id),
      })),
      ...customEndpoints.map((e) => ({
        id: `custom-${e.id}`,
        name: e.name,
        model: e.defaultModel,
        connected: true,
        type: 'custom',
        endpointUrl: e.endpointUrl,
        apiMode: e.apiMode,
        useForNewChats: e.useForNewChats,
      })),
    ],
  });
});

// Debug evidence route — appends to {project_root}/.agents/debug.log.
app.post('/api/debug/log', (req: Request, res: Response) => {
  const hypothesis = String(req.body?.hypothesis ?? 'H?').slice(0, 16);
  const message = String(req.body?.message ?? '').slice(0, 4000);
  try {
    serverDebugLog(hypothesis, message);
  } catch { /* ignore */ }
  res.status(204).end();
});

// Mount Vite middleware in development or serve static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      // HMR's websocket uses port 24678 by default, which another local copy can hold; the
      // page then connects to the wrong server and logs errors. DISABLE_HMR turns it off, and
      // HMR_PORT moves it.
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : process.env.HMR_PORT ? { port: Number(process.env.HMR_PORT) } : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Listen on the loopback addresses only, so other computers on the network cannot reach the server. Both IPv4 and
  // IPv6 loopback are opened, because "localhost" may resolve to either (binding only one caused ECONNREFUSED before).
  // HOST can still override this with one specific address.
  const hosts = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];
  for (const host of hosts) {
    const httpServer = app.listen(PORT, host, () => {
      console.log(`[Pulse Med Server] Running on http://${host.includes(':') ? `[${host}]` : host}:${PORT} (this computer only)`);
    });
    // A machine without IPv6 cannot bind ::1; the IPv4 server still works, so that failure is only a warning.
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (host !== '127.0.0.1' && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
        console.warn(`[Pulse Med Server] Could not bind ${host} (${err.code}); IPv4 loopback is still served.`);
        return;
      }
      throw err;
    });
    // A 10-question JSON batch can legitimately take minutes. Node's default 300 s
    // requestTimeout would destroy the socket mid-answer. The AI routes are bounded by their own abort signal instead.
    httpServer.requestTimeout = 0;
    httpServer.headersTimeout = 0;
    httpServer.keepAliveTimeout = 120_000;
  }
}

startServer();
