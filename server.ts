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
import { aiLog } from './server/oauth.mjs';
import { research as webResearch } from './server/web.mjs';
import { searchImages, fetchImage, REFERENCE_SOURCES } from './server/images.mjs';
import { buildImageBank, loadImageBank, queryImageBank, getBankImage, bankStats, rejectImage, searchBankByText } from './server/imageBank.mjs';
import { generateQuestionFromImage } from './server/visionQuestion.mjs';
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

// OpenCode's default model id (Console / Go gateway).
const OPENCODE_DEFAULT_MODEL = 'deepseek-v4.1-flash';

const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
  opencode: OPENCODE_DEFAULT_MODEL,
  custom: 'gpt-4o-mini',
  nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
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

function nvidiaKey(): string {
  return (process.env.NVIDIA_API_KEY || '').trim();
}

/**
 * Map the app's effort levels onto NVIDIA's chat-template reasoning controls.
 *
 * This matters more than it looks. Both Nemotron 3.5 Super VL and the Ultra model are
 * REASONING models: their hidden reasoning trace is billed against `max_tokens`, so a
 * modest cap gets spent entirely on thinking and the request comes back with
 * finish_reason:"length" and EMPTY content. The model cards expose the fix via
 * chat_template_kwargs: `enable_thinking` toggles the trace and `medium_effort` trims it.
 *
 * Effort therefore maps to a real quality/latency/token trade-off instead of being
 * accepted and silently ignored (which is what used to happen).
 */
function nvidiaReasoningKwargs(effort?: string): Record<string, unknown> {
  const level = String(effort || '').trim().toLowerCase();
  if (level === 'min' || level === 'minimal') return { enable_thinking: false };
  if (level === 'low' || level === 'brief') return { enable_thinking: true, medium_effort: true };
  if (level === 'high') return { enable_thinking: true };
  if (level === 'ultra') return { enable_thinking: true };
  // Medium / Standard / unset: a trace is still wanted, but not an unbounded one.
  return { enable_thinking: true, medium_effort: true };
}

/** Settings that let a long answer finish instead of being truncated mid-thought. */
function nvidiaTokenBudget(effort?: string): number {
  const level = String(effort || '').trim().toLowerCase();
  if (level === 'min' || level === 'minimal') return 2048;
  if (level === 'low' || level === 'brief') return 4096;
  if (level === 'high') return 16384;
  if (level === 'ultra') return 24000;
  return 8192;
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

function opencodeKey(): string {
  return (process.env.OPENCODE_API_KEY || opencodeKeyFromCli()).trim();
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
  if (providerId === 'nvidia') return Boolean(nvidiaKey());
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
  if (providerId === 'nvidia') {
    return 'NVIDIA is not connected. Paste your NVIDIA API key in Settings → AI Subscription Hub.';
  }
  if (providerId === 'custom') {
    return 'Custom provider is not connected. Add a custom endpoint in Settings → AI Subscription Hub.';
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
  signal?: AbortSignal;
  /** Stable conversation id for providers that route/cache per session (OpenCode Go). */
  session?: string;
}): Promise<string> {
  const { provider, model, system, messages, json, effort, search, signal } = opts;

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

  if (provider === 'nvidia') {
    const key = nvidiaKey();
    if (!key) throw new ApiError(notConnectedMessage('nvidia'), 401);
    const model_ = model || DEFAULT_MODELS.nvidia;
    const payloadMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const payload = JSON.stringify({
      model: model_,
      messages: payloadMessages,
      temperature: 0.7,
      // Let a long clinical answer finish rather than starving the reasoning trace.
      max_tokens: nvidiaTokenBudget(effort),
      chat_template_kwargs: nvidiaReasoningKwargs(effort),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    });
    // NVIDIA's endpoint returns sporadic 500/503s that succeed on an immediate retry.
    // Without this, one upstream blip surfaced to the learner as "AI request failed
    // (HTTP 502)" and discarded an otherwise fine answer. Bounded, and never retries a
    // 4xx (those are real: bad key, bad model, rate limit we should surface).
    let httpRes: any = null;
    let raw = '';
    let body: any = {};
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      httpRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: payload,
        ...(signal ? { signal } : {}),
      });
      raw = await httpRes.text();
      body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
      if (httpRes.ok || httpRes.status === 429 || httpRes.status < 500 || attempt === maxAttempts) break;
      aiLog({ provider: 'nvidia', model: model_, status: httpRes.status, error: true, retry: attempt });
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
    if (!httpRes || !httpRes.ok) {
      const status = httpRes?.status ?? 502;
      aiLog({ provider: 'nvidia', model: model_, status, error: true });
      throw new ApiError(`NVIDIA: ${providerErrorText(body, status)}`, status === 401 ? 401 : 502);
    }
    const content = body?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : '';
    aiLog({ provider: 'nvidia', model: model_, status: httpRes.status, text_len: text.length, json: !!json });
    if (!text.trim()) {
      throw new ApiError(`NVIDIA returned no text (finishReason: ${body?.choices?.[0]?.finish_reason || 'unknown'}).`, 502);
    }
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
      throw new ApiError('Claude subscription sign-in is restricted for your organisation. Use Claude via OpenCode (Claude Haiku 5.5) or add a Gemini API key instead.', 401);
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
      nvidia: { connected: isProviderConnected('nvidia') },
      custom: { connected: isProviderConnected('custom') },
    },
    defaults: DEFAULT_MODELS,
  });
});

// 1a-bis. POST /api/ai/plan-topics: plan topic distribution for MCQ generation.
// Returns a ranked list of subject+subtopic pairs with importance weights,
// so that important topics appear more often across concurrent batches.
app.post('/api/ai/plan-topics', async (req: Request, res: Response) => {
  const { subjectSubtopics, count, difficultyTier, provider, model, exam, effort } = req.body || {};
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
      `Include approximately ${countN} entries total. If there are fewer unique pairs than ${countN}, repeat important ones.`,
      `Output ONLY the JSON array.`,
    ].join('\n');

    const raw = await runCompletion({
      provider: provider || 'gemini',
      model: model || DEFAULT_MODELS.nvidia,
      messages: [{ role: 'user', content: planPrompt }],
      json: true,
      effort: effort || undefined,
    });

    const parsed = extractJson<{ subject: string; subtopic: string; priority: number }[]>(raw);
    const ranked = Array.isArray(parsed) ? parsed : [];

    // Build weighted topic list: higher priority = more repetitions.
    const weighted: { subject: string; subtopic: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }[] = [];
    for (const entry of ranked) {
      const repeats = Math.max(1, Math.min(entry.priority || 5, 10));
      for (let i = 0; i < repeats; i++) {
        weighted.push({
          subject: entry.subject,
          subtopic: entry.subtopic,
          difficultyTier: tier as 'LOW' | 'MEDIUM' | 'HIGH',
        });
      }
    }

    // If weighted list is empty (parse failed), fall back to round-robin.
    if (weighted.length === 0) {
      for (let i = 0; i < countN; i++) {
        weighted.push({
          subject: pool[i % pool.length].subject,
          subtopic: pool[i % pool.length].subtopic,
          difficultyTier: tier as 'LOW' | 'MEDIUM' | 'HIGH',
        });
      }
    }

    // Trim to countN, preserving order.
    const finalTopics = weighted.slice(0, countN);
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

// 6c. POST /api/settings/nvidia-key: save the NVIDIA API key.
// NEVER echoes the key back.
app.post('/api/settings/nvidia-key', (req: Request, res: Response) => {
  const key = String(req.body?.apiKey || '').trim();
  if (!/^[A-Za-z0-9_\-]{10,}$/.test(key)) {
    return res.status(400).json({ error: 'That does not look like a valid NVIDIA API key.' });
  }
  try {
    writeEnvValue('NVIDIA_API_KEY', key);
    return res.json({ ok: true, connected: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Could not save the NVIDIA API key.' });
  }
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

// GET /api/models/custom: discover models from a custom endpoint or NVIDIA.
// Query param `provider=nvidia` fetches NVIDIA NIM models instead.
app.get('/api/models/custom', async (_req: Request, res: Response) => {
  const provider = String(_req.query.provider || '').trim();
  if (provider === 'nvidia') {
    const key = nvidiaKey();
    if (!key) {
      return res.status(401).json({ error: 'NVIDIA API key not configured. Add it in Settings → AI Subscription Hub.' });
    }
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
      });
      const raw = await r.text();
      let body: any = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
      if (!r.ok) {
        return res.status(502).json({ error: `NVIDIA model discovery failed: ${providerErrorText(body, r.status)}` });
      }
      const rows: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
      const models = rows
        .map((m) => ({ id: String(m?.id ?? m?.name ?? ''), name: String(m?.name || m?.id || ''), source: 'nvidia' }))
        .filter((m) => m.id);
      return res.json({ models, fetchedAt: new Date().toISOString(), provider: 'nvidia' });
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Could not discover NVIDIA models.' });
    }
  }

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

async function listNvidiaModels(): Promise<{ models: { id: string; name: string; source: string }[]; error?: string }> {
  if (!isProviderConnected('nvidia')) return { models: [], error: 'No NVIDIA API key saved.' };
  try {
    const key = nvidiaKey();
    const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b?.error?.message || `HTTP ${r.status}`);
    const rows: any[] = Array.isArray(b?.data) ? b.data : Array.isArray(b?.models) ? b.models : [];
    const verifiedModels = [
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'nvidia/nemotron-3.5-bolt-e4b',
      'nvidia/nemotron-3.5-content-safety',
      'nvidia/nemotron-parse-2.0',
      'meta/llama-guard-4-12b',
    ];
    return {
      models: rows
        .map((m) => ({ id: String(m?.id ?? m?.name ?? ''), name: String(m?.name || m?.id || ''), source: 'account' }))
        .filter((m) => m.id && verifiedModels.includes(m.id)),
    };
  } catch (e: any) {
    return { models: [], error: e?.message || 'Could not list NVIDIA models.' };
  }
}

app.get('/api/models/available', async (req: Request, res: Response) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const probe = req.query.probe === '1' || req.query.probe === 'true';
  const only = String(req.query.provider || '').trim();
  if (only && !['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'custom', 'nvidia'].includes(only)) {
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

  if (!only || only === 'nvidia') {
    const nv = await listNvidiaModels();
    providers.nvidia = nv.models;
    if (nv.error) errors.nvidia = nv.error;
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
  if (!['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'custom', 'nvidia'].includes(provider)) {
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
app.post('/api/ai/complete', async (req: Request, res: Response) => {
  const { provider, model, system, messages, json, effort } = req.body || {};
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
    const text = await runCompletion({ provider, model, system, messages, json, effort, signal: controller.signal, session: req.header('x-opencode-session') || undefined });
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
    // Include every provider the app actually supports — this list previously omitted
    // `nvidia`, so a server-side fallback could never select the NVIDIA engine even when
    // it was the only connected provider.
    const candidates = ['nvidia', 'chatgpt', 'claude', 'grok', 'opencode', 'gemini'];
    provider = candidates.find((p) => isProviderConnected(p)) || '';
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

  try {
    const raw = await runCompletion({
      provider,
      model: typeof body.model === 'string' ? body.model : undefined,
      system,
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

// GET /api/images/search?q=... -> licence-filtered clinical figures from Open-i (NLM).
// Only CC BY / CC BY-SA / CC0 / public-domain results are returned; NC/ND are dropped.
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
  key: string,
  attempt = 0,
): Promise<{ pass: boolean; reason: string; debug?: { raw: string; finish?: string } }> {
  const { buffer, type } = await fetchImage(imageUrl);
  // The vision API accepts JPEG/PNG/WebP. GIF (and anything else) is rejected with
  // HTTP 415, so treat it as unverifiable rather than attaching it blind.
  if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
    return { pass: false, reason: `Unsupported image type (${type}) — image skipped.` };
  }
  const dataUrl = `data:${type};base64,${buffer.toString('base64')}`;
  const model_ = process.env.VISION_MODEL || DEFAULT_MODELS.nvidia;
  const instruction = [
    'One image is shown, attached to a medical exam question.',
    `The question claims the image shows: "${claim}"${modality ? ` (modality: ${modality})` : ''}.`,
    'Look ONLY at the pixels. Decide:',
    '1. Does this image actually depict that finding / condition / diagnosis?',
    '2. Is the modality consistent (an ECG is not a photo; a chest X-ray is not a histology slide)?',
    'Set pass=true ONLY if you can actually see the claimed finding in THIS image. If the image is unrelated, a random photo, a chart, text, a different body part, or you are unsure, set pass=false.',
    'Answer with ONLY this JSON object and nothing else: {"pass": true, "reason": "one short sentence"}',
  ].join('\n');
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
    // This is a reasoning model: a small budget is spent entirely on hidden
    // reasoning (finish_reason "length") and returns empty content. Give it room.
    max_tokens: Number(process.env.VISION_MAX_TOKENS || 2048),
    // A yes/no verification needs no deliberation at all, and the reasoning trace was
    // what silently ate the budget and produced empty verdicts. Turn it off outright.
    chat_template_kwargs: { enable_thinking: false },
    stream: false,
  });
  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: payload,
    // The reasoning model occasionally takes a very long time on a hard image; too
    // short a timeout silently discards a perfectly good image. Overridable.
    signal: AbortSignal.timeout(Number(process.env.VISION_TIMEOUT_MS || 180000)),
  });
  const raw = await r.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }
  if (!r.ok) {
    // A 5xx here is an upstream blip, not a verdict on the image. Retry once so a good
    // image is not discarded (and forced to text-only) because NVIDIA hiccuped.
    if (r.status >= 500 && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return visionVerify(imageUrl, claim, modality, key, attempt + 1);
    }
    aiLog({ provider: 'nvidia', model: model_, status: r.status, error: true, route: 'images/verify' });
    return { pass: false, reason: `Vision check failed (HTTP ${r.status}) — image skipped.` };
  }
  const msg = body?.choices?.[0]?.message;
  const content = msg?.content;
  let text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('')
      : '';
  // Some reasoning models put the answer (or everything) in reasoning_content.
  if (!text.trim() && typeof msg?.reasoning_content === 'string') text = msg.reasoning_content;
  const finish = body?.choices?.[0]?.finish_reason;
  // Vision models sometimes emit almost-JSON (an unquoted string value, stray prose).
  // This verdict is only a boolean + a short sentence, so extract both tolerantly
  // rather than throwing away a real answer because of one missing quote.
  const passMatch = text.match(/"pass"\s*:\s*(true|false)/i);
  const reasonMatch = text.match(/"reason"\s*:\s*"?([^"}\n]+)"?/i);
  const parsed = parseJsonBlock(text);
  const pass = parsed?.pass === true || (!parsed && passMatch?.[1]?.toLowerCase() === 'true');
  const parsedReason = typeof parsed?.reason === 'string' && parsed.reason.trim()
    ? parsed.reason.trim()
    : reasonMatch?.[1]?.trim();
  const reason = parsedReason
    ? parsedReason.slice(0, 240)
    : pass
      ? 'Verified.'
      : finish === 'length'
        ? 'Vision model ran out of tokens before answering — image skipped.'
        : 'Model did not confirm the claimed finding.';
  aiLog({ provider: 'nvidia', model: model_, status: r.status, route: 'images/verify', pass, finish, text_len: text.length });
  return process.env.VISION_DEBUG
    ? { pass, reason, debug: { raw: text.slice(0, 1500), finish } }
    : { pass, reason };
}

// POST /api/images/verify -> vision check BEFORE an image may be attached.
// The old pipeline matched a figure's *caption/title* words, so an unrelated picture
// whose caption happened to reuse the right words (a tangerine for "hazy cornea")
// still passed. This actually looks at the pixels with the connected NVIDIA vision
// model and asks whether the image shows what the question claims.
app.post('/api/images/verify', async (req: Request, res: Response) => {
  const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : '';
  const claim = typeof req.body?.claim === 'string' ? req.body.claim.trim().slice(0, 800) : '';
  const modality = typeof req.body?.modality === 'string' ? req.body.modality.trim().slice(0, 40) : '';
  if (!imageUrl || !claim) {
    return res.status(400).json({ error: 'imageUrl and claim are required.' });
  }
  const key = nvidiaKey();
  if (!key) {
    return res.json({ pass: false, reason: 'No vision provider connected — image skipped.' });
  }
  try {
    const verdict = await visionVerify(imageUrl, claim, modality, key);
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
    const key = wantVerify ? nvidiaKey() : null;
    const summary = await buildImageBank({
      limitPerSeed: Number(req.body?.limitPerSeed) || 3,
      verify: wantVerify && key
        ? async (entry: any) => {
            const claim = `${entry.ground_truth}${entry.modality ? ` (${entry.modality})` : ''}`;
            try {
              const verdict = await visionVerify(entry.imageUrl, claim, entry.modality, key);
              return verdict.pass === true;
            } catch {
              return false;
            }
          }
        : undefined,
    });
    return res.json({ success: true, ...summary, verified: Boolean(wantVerify && key) });
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
    const limit = Number(req.query.limit) || 6;
    const rows = subject || modality ? queryImageBank({ subject, modality, limit }) : loadImageBank().slice(0, limit);
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
  if (!cue) return res.json({ found: false, reason: 'No image cue was supplied.' });
  try {
    const candidates = searchBankByText(cue, { subject, limit: 4 });
    if (!candidates.length) {
      return res.json({ found: false, reason: 'No bank image matches that description.' });
    }
    const key = nvidiaKey();
    if (!key) {
      return res.json({ found: false, reason: 'No vision provider connected — image skipped.' });
    }
    // Try candidates in score order; the first that passes verification wins.
    for (const entry of candidates) {
      const claim = `${entry.ground_truth}${entry.modality ? ` (${entry.modality})` : ''}`;
      let verdict: { pass: boolean; reason: string };
      try {
        verdict = await visionVerify(entry.imageUrl, claim, entry.modality, key);
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
      aiLog({ provider: 'nvidia', route: 'images/find-for-explanation', pass: false, reason: verdict.reason.slice(0, 160), image_id: entry.image_id });
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
  if (!imageUrl || !groundTruth) {
    return res.status(400).json({ error: 'imageUrl and groundTruth are required.' });
  }
  const key = nvidiaKey();
  if (!key) {
    return res.status(401).json({ error: notConnectedMessage('nvidia') });
  }
  try {
    const question = await generateQuestionFromImage({
      imageUrl,
      groundTruth,
      modality: typeof body.modality === 'string' ? body.modality : '',
      subject: typeof body.subject === 'string' ? body.subject : '',
      exam: typeof body.exam === 'string' ? body.exam : 'NEET_PG',
      difficultyTier: typeof body.difficultyTier === 'string' ? body.difficultyTier : 'MEDIUM',
      optionCount: Number(body.optionCount) === 5 ? 5 : 4,
      apiKey: key,
      model: typeof body.model === 'string' ? body.model : process.env.VISION_MODEL || DEFAULT_MODELS.nvidia,
    });
    return res.json({ success: true, question, model: process.env.VISION_MODEL || DEFAULT_MODELS.nvidia });
  } catch (err: any) {
    const msg = String(err?.message || 'Image-first generation failed.');
    // A model-declared mismatch means this image genuinely does not show the claimed
    // finding. Remember it, so future runs do not spend another slow vision call on it.
    const status = msg === 'image_mismatch' ? 422 : 502;
    if (msg === 'image_mismatch' && imageId) {
      try { rejectImage(imageId, groundTruth, msg); } catch { /* bookkeeping only */ }
    }
    aiLog({ provider: 'nvidia', route: 'images/generate-question', error: true, status, reason: msg.slice(0, 200) });
    return res.status(status).json({ error: msg });
  }
});

// GET /api/images/sources -> which libraries are embedded vs reference-only.
app.get('/api/images/sources', (_req: Request, res: Response) => {
  res.json({
    embedded: [
      { name: 'Open-i (NLM / PubMed Central)', url: 'https://openi.nlm.nih.gov/', note: 'Live search; CC BY / BY-SA / CC0 / public domain only.' },
      { name: 'Wikimedia Commons (CDC PHIL and others)', url: 'https://commons.wikimedia.org/', note: 'Curated verified library shipped with the app.' },
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
  const reviews: any[] = [];
  for (const q of questions.slice(0, 200)) {
    try {
      reviews.push(await runQaPipeline(q, { complete, runLlm, bank: qaBank }));
    } catch (err: any) {
      reviews.push({ questionId: q?.id, error: err?.message || 'QA failed', status: 'REVIEWING' });
    }
  }
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
    const out = await webResearch(query);
    return res.json({ success: true, sources: out.sources, retrievedAt: out.retrievedAt });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Web research failed.' });
  }
});

// POST /api/exams/dates {exam} -> look for the next sitting's date on the OFFICIAL body
// only (NBEMS / AIIMS / AMC). Internet-backed, dependency-free.
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
  AMC_CAT: {
    label: 'Australian Medical Council (amc.org.au)',
    hosts: ['amc.org.au'],
    queries: ['AMC MCQ examination dates', 'AMC CAT MCQ exam dates 2027 schedule'],
  },
};

app.post('/api/exams/dates', async (req: Request, res: Response) => {
  const exam = String(req.body?.exam || '').trim().toUpperCase();
  const spec = OFFICIAL_EXAM_SOURCES[exam];
  if (!spec) {
    return res.status(400).json({ error: 'Unknown exam. Use NEET_PG, INI_CET or AMC_CAT.' });
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
      ...(['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'nvidia'] as string[]).map((id) => ({
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

  // Bind to all interfaces so the app is reachable as BOTH http://localhost:PORT
  // (which browsers may resolve to IPv6 ::1) and http://127.0.0.1:PORT. Binding to
  // 127.0.0.1 alone made localhost requests fail with ECONNREFUSED / 502 Bad Gateway.
  // Override with HOST when a specific interface is required.
  const HOST = process.env.HOST ?? '::';
  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`[Pulse Med Server] Running on http://localhost:${PORT} (host: ${HOST})`);
  });
  // Some Windows stacks only expose one family per socket; fall back to IPv4 if the
  // IPv6/dual-stack bind fails outright.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL') {
      console.warn(`[Pulse Med Server] Could not bind ${HOST}, retrying on 127.0.0.1`);
      app.listen(PORT, '127.0.0.1', () => {
        console.log(`[Pulse Med Server] Running on http://127.0.0.1:${PORT}`);
      });
    } else {
      throw err;
    }
  });
  // A 10-question JSON batch can legitimately take minutes. Node's default 300 s
  // requestTimeout would destroy the socket mid-answer (and the client saw that as a
  // generic empty response). The AI routes are bounded by their own abort signal instead.
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;
  httpServer.keepAliveTimeout = 120_000;
}

startServer();
