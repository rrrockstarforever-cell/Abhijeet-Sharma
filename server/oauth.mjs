// Subscription logins (device-code OAuth) for ChatGPT/Codex and xAI Grok, same pattern Hermes uses.
// Runs server-side because these endpoints don't allow browser (CORS) calls. Tokens live in
// ~/.neet-pg-prep/oauth.json (mode 600) and never reach the web page.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Where subscription tokens are stored. Electron sets PULSE_DATA_DIR to the app's own
// user-data folder (%APPDATA%\Pulse Med), so tokens live with the install's data and are
// NEVER inside the installer or the asar. The home-dir path is a dev-only fallback for
// `npm run dev`; it must never be __dirname or the app folder.
const DATA_ROOT = process.env.PULSE_DATA_DIR || join(homedir(), '.pulse-med');
const DIR = process.env.PULSE_DATA_DIR ? join(process.env.PULSE_DATA_DIR, 'oauth') : join(homedir(), '.neet-pg-prep');

// Provider-call diagnostics. Packaged Electron discards the child's stdout, so this goes to a
// file. Metadata only — provider, model, status, sizes, stop reasons. Never a token, prompt
// or response body.
export function aiLog(entry) {
  try {
    const dir = join(DATA_ROOT, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'ai.log'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* logging must never break a request */ }
}
const FILE = join(DIR, 'oauth.json');

const CODEX = {
  issuer: 'https://auth.openai.com',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  base: 'https://chatgpt.com/backend-api/codex',
};
const XAI = {
  issuer: 'https://auth.x.ai',
  clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
  scope: 'openid profile email offline_access grok-cli:access api:access',
  base: 'https://api.x.ai/v1',
  // A Grok subscription login is a *Grok CLI* token, not an xAI API key: api.x.ai
  // answers 403 "run out of credits" for it while the CLI proxy works. Both the
  // model library and chat therefore go through the proxy, which requires the
  // same client-version header the CLI sends (426 "version (none) is outdated").
  cliBase: 'https://cli-chat-proxy.grok.com/v1',
  cliVersion: '1.0.13',
};
const xaiHeaders = (tok) => ({ Authorization: `Bearer ${tok}`, 'x-grok-client-version': XAI.cliVersion });
const providerMessage = (b, status) => {
  const e = b?.error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object' && (e.message || e.code)) return e.message || e.code;
  return b?.message || `HTTP ${status}`;
};

const CLAUDE = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorize: 'https://claude.ai/oauth/authorize',
  tokenUrls: ['https://platform.claude.com/v1/oauth/token', 'https://console.anthropic.com/v1/oauth/token'],
  redirect: 'https://console.anthropic.com/oauth/code/callback',
  scope: 'org:create_api_key user:profile user:inference',
  base: 'https://api.anthropic.com/v1',
  ua: 'axios/1.7.9', // the token endpoint rejects claude-code/ user agents
  betas: 'claude-code-20250219,oauth-2025-04-20',
  version: '2.1.280', // newest models refuse older client versions ("2.1.280 or newer is required")
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function claudeToken(body) {
  let last = 'unknown error';
  for (const url of CLAUDE.tokenUrls) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': CLAUDE.ua }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    last = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
  }
  throw new Error(last);
}

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});
function save(d) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(d, null, 2));
  try { chmodSync(FILE, 0o600); } catch {}
}
const pending = new Map(); // login id -> { provider, ... , status, error }

const form = (o) => new URLSearchParams(o).toString();
async function jpost(url, body, headers = {}) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
async function fpost(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form(body) });
}
const jwt = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return {}; } };

// ---------- login ----------
export async function startLogin(provider) {
  const id = Math.random().toString(36).slice(2);
  if (provider === 'codex') {
    const r = await jpost(`${CODEX.issuer}/api/accounts/deviceauth/usercode`, { client_id: CODEX.clientId });
    if (r.status === 429) throw new Error('OpenAI is rate-limiting logins. Wait a minute and try again.');
    if (!r.ok) throw new Error(`OpenAI device-code request failed (HTTP ${r.status}).`);
    const d = await r.json();
    const p = { provider, status: 'pending', device_auth_id: d.device_auth_id, user_code: d.user_code, interval: Math.max(3, +d.interval || 5) };
    pending.set(id, p);
    return { id, userCode: d.user_code, url: `${CODEX.issuer}/codex/device`, interval: p.interval };
  }
  if (provider === 'xai') {
    const disc = await (await fetch(`${XAI.issuer}/.well-known/openid-configuration`)).json();
    const r = await fpost(`${XAI.issuer}/oauth2/device/code`, { client_id: XAI.clientId, scope: XAI.scope });
    if (!r.ok) throw new Error(`xAI device-code request failed (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    pending.set(id, { provider, status: 'pending', device_code: d.device_code, token_endpoint: disc.token_endpoint, interval: Math.max(1, +d.interval || 5) });
    return { id, userCode: d.user_code, url: d.verification_uri_complete || d.verification_uri, interval: Math.max(1, +d.interval || 5) };
  }
  if (provider === 'claude') {
    // Claude Pro/Max login: open the link, approve, then paste the code shown on the page.
    const { createHash, randomBytes } = await import('node:crypto');
    const verifier = b64u(randomBytes(32));
    const state = b64u(randomBytes(32));
    const challenge = b64u(createHash('sha256').update(verifier).digest());
    pending.set(id, { provider, status: 'pending', mode: 'code', verifier, state });
    const q = new URLSearchParams({ code: 'true', client_id: CLAUDE.clientId, response_type: 'code', redirect_uri: CLAUDE.redirect, scope: CLAUDE.scope, code_challenge: challenge, code_challenge_method: 'S256', state });
    return { id, mode: 'code', url: `${CLAUDE.authorize}?${q}`, interval: 0 };
  }
  throw new Error('Unknown provider');
}

export async function completeLogin(id, pasted) {
  const p = pending.get(id);
  if (!p || p.provider !== 'claude') throw new Error('Login expired. Start again.');
  const [code, state = ''] = String(pasted || '').trim().split('#');
  if (!code) throw new Error('Paste the code shown after you approve.');
  if (state !== p.state) throw new Error('That code does not match this login attempt. Click sign in again and use the new link.');
  const tok = await claudeToken({ grant_type: 'authorization_code', client_id: CLAUDE.clientId, code, state, redirect_uri: CLAUDE.redirect, code_verifier: p.verifier });
  if (!tok.access_token) throw new Error('No access token returned.');
  const d = load();
  d.claude = { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 };
  save(d);
  p.status = 'done';
  return { status: 'done' };
}

export async function pollLogin(id) {
  const p = pending.get(id);
  if (!p) return { status: 'error', error: 'Login expired. Start again.' };
  if (p.status !== 'pending') return { status: p.status, error: p.error };
  try {
    if (p.provider === 'codex') {
      const r = await jpost(`${CODEX.issuer}/api/accounts/deviceauth/token`, { device_auth_id: p.device_auth_id, user_code: p.user_code });
      if (r.status === 403 || r.status === 404) return { status: 'pending' };
      if (!r.ok) throw new Error(`Sign-in check failed (HTTP ${r.status}).`);
      const c = await r.json();
      const t = await fpost(CODEX.tokenUrl, {
        grant_type: 'authorization_code', code: c.authorization_code, redirect_uri: `${CODEX.issuer}/deviceauth/callback`,
        client_id: CODEX.clientId, code_verifier: c.code_verifier,
      });
      if (!t.ok) throw new Error(`Token exchange failed (HTTP ${t.status}).`);
      const tok = await t.json();
      const d = load();
      d.codex = { access: tok.access_token, refresh: tok.refresh_token, at: Date.now() };
      save(d);
    } else {
      const r = await fpost(p.token_endpoint, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: XAI.clientId, device_code: p.device_code });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (b.error === 'authorization_pending' || b.error === 'slow_down') return { status: 'pending' };
        throw new Error(b.error_description || b.error || `HTTP ${r.status}`);
      }
      const d = load();
      d.xai = { access: b.access_token, refresh: b.refresh_token, tokenUrl: p.token_endpoint, at: Date.now() };
      save(d);
    }
    p.status = 'done';
    return { status: 'done' };
  } catch (e) {
    p.status = 'error';
    p.error = e.message;
    return { status: 'error', error: e.message };
  }
}

export const status = () => { const d = load(); return { codex: !!d.codex, xai: !!d.xai, claude: !!d.claude }; };
export function logout(provider) { const d = load(); delete d[provider]; save(d); }

// ---------- tokens ----------
async function token(provider) {
  const d = load();
  const s = d[provider];
  if (!s) throw new Error('Not signed in. Open Settings and sign in.');
  if (provider === 'claude') {
    if (s.exp - Date.now() > 120_000) return s.access;
    try {
      const b = await claudeToken({ grant_type: 'refresh_token', client_id: CLAUDE.clientId, refresh_token: s.refresh });
      s.access = b.access_token;
      if (b.refresh_token) s.refresh = b.refresh_token;
      s.exp = Date.now() + (b.expires_in || 3600) * 1000;
      save(d);
      return s.access;
    } catch { throw new Error('Your Claude login expired. Open Settings and sign in again.'); }
  }
  const exp = (jwt(s.access).exp || 0) * 1000;
  if (exp && exp - Date.now() > 120_000) return s.access;
  const r = await fpost(provider === 'codex' ? CODEX.tokenUrl : s.tokenUrl, { grant_type: 'refresh_token', client_id: provider === 'codex' ? CODEX.clientId : XAI.clientId, refresh_token: s.refresh });
  if (!r.ok) throw new Error('Your login expired. Open Settings and sign in again.');
  const b = await r.json();
  s.access = b.access_token;
  if (b.refresh_token) s.refresh = b.refresh_token;
  save(d);
  return s.access;
}

// ---------- live model lists ----------
// Ask each provider what THIS account may actually use, using the stored token.
// The public models.dev catalogue is not account-aware: it lists API models that a
// subscription login is often not entitled to, which made the picker suggest ids
// that fail on send.
const CHAT_MODEL_FILTER = [
  // media / image / video / multi-agent helpers are not chat models
  /imagine/i, /-image(-|$)/i, /-video(-|$)/i, /-audio(-|$)/i, /multi-agent/i, /^grok-build/i,
  /embedding/i, /whisper/i, /tts/i, /dall-e/i, /realtime/i, /transcribe/i,
];
const isChatModel = (id) => typeof id === 'string' && id.length > 1 && !CHAT_MODEL_FILTER.some((re) => re.test(id));

export async function listModels(provider) {
  try {
    const tok = await token(provider);

    if (provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: {
          Authorization: `Bearer ${tok}`, 'anthropic-version': '2023-06-01',
          'anthropic-beta': CLAUDE.betas, 'User-Agent': `claude-code/${CLAUDE.version} (external, cli)`,
        },
      });
      if (!r.ok) return { models: [], error: `Anthropic returned HTTP ${r.status}` };
      const b = await r.json();
      const models = (b.data || [])
        .map((m) => ({ id: m.id, name: m.display_name || m.id, created: m.created_at || null }))
        .filter((m) => isChatModel(m.id));
      return { models };
    }

    if (provider === 'xai') {
      // The subscription token can list its real library only on the CLI proxy.
      const r = await fetch(`${XAI.cliBase}/models`, { headers: xaiHeaders(tok) });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        return { models: [], error: `xAI returned HTTP ${r.status}: ${providerMessage(b, r.status)}` };
      }
      const b = await r.json().catch(() => ({}));
      const models = (b.data || [])
        .map((m) => ({ id: m.id, name: m.name || m.id, created: null, context: m.context_window || null }))
        .filter((m) => isChatModel(m.id));
      if (models.length) return { models };
      return { models: [], error: 'xAI listed no chat models for this subscription.' };
    }

    // codex: the backend only lists models the signed-in plan is entitled to.
    const claims = jwt(tok)['https://api.openai.com/auth'] || {};
    const headers = {
      Authorization: `Bearer ${tok}`,
      ...(claims.chatgpt_account_id ? { 'ChatGPT-Account-ID': claims.chatgpt_account_id } : {}),
    };
    for (const v of ['0.50.0', '0.63.0', '0.44.0']) {
      const r = await fetch(`${CODEX.base}/models?client_version=${v}`, { headers });
      if (!r.ok) continue;
      const b = await r.json().catch(() => ({}));
      const models = (b.models || []).map((m) => ({
        id: m.slug || m.id || m.model, name: m.display_name || m.title || m.slug || m.id, created: null,
      })).filter((m) => isChatModel(m.id));
      if (models.length) return { models };
    }
    return {
      models: [],
      error: 'Your ChatGPT plan does not include any Codex model, so there is nothing to choose here.',
    };
  } catch (e) {
    return { models: [], error: e.message };
  }
}

// ---------- chat ----------
export async function chat({ provider, model, system, messages, json, effort, search, signal }) {
  const tok = await token(provider);
  if (provider === 'claude') {
    // Anthropic rejects an empty text block ("system: text content blocks must be
    // non-empty"), so only append the caller's system prompt when there is one. The
    // JSON instruction is kept in its own block when the caller sent no prompt.
    const claudeSystem = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }];
    const jsonRule = '\n\nRespond with ONLY a single valid JSON object. No markdown fences.';
    if (system && String(system).trim()) {
      claudeSystem.push({ type: 'text', text: String(system) + (json ? jsonRule : '') });
    } else if (json) {
      claudeSystem.push({ type: 'text', text: jsonRule.trim() });
    }
    // Newer Claude models think by default, and that hidden reasoning is billed against
    // max_tokens. A 10-question JSON batch then ran out of budget with only ~17k visible
    // characters and was cut off mid-sentence, which made the whole batch unparseable.
    // Switch thinking off (the old app's models never thought) and fall back to omitting
    // the field for older models that do not recognise it.
    const claudeBody = {
      // A 10-item JSON batch (stems + 120-220 word explanations) is ~6-9k output tokens.
      // 16k left no headroom, and a reply cut at max_tokens comes back with no text block at
      // all — which reached the user as "the provider returned an empty response".
      model, max_tokens: json ? 32000 : 8192,
      system: claudeSystem,
      messages,
    };
    const sendClaude = (thinking) => fetch(`${CLAUDE.base}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, 'anthropic-version': '2023-06-01',
        'anthropic-beta': CLAUDE.betas, 'User-Agent': `claude-code/${CLAUDE.version} (external, cli)`,
      },
      body: JSON.stringify(thinking ? { ...claudeBody, thinking } : claudeBody),
      signal,
    });
    let r = await sendClaude({ type: 'between_tools' });
    let b = await r.json().catch(() => ({}));
    if (!r.ok && /thinking/i.test(b?.error?.message || '')) {
      r = await sendClaude(null);
      b = await r.json().catch(() => ({}));
    }
    const blocks = Array.isArray(b?.content) ? b.content : [];
    const text = blocks.filter((x) => x.type === 'text').map((x) => x.text || '').join('');
    aiLog({ provider: 'claude', model, status: r.status, stop: b?.stop_reason,
            out_tokens: b?.usage?.output_tokens, blocks: blocks.map((x) => x.type), text_len: text.length, json: !!json });
    if (!r.ok) throw new Error(`Claude: ${b?.error?.message || 'HTTP ' + r.status}`);
    if (!text.trim()) {
      const reason = b?.stop_reason === 'max_tokens'
        ? 'the reply hit the output token limit before any answer text (stop_reason: max_tokens)'
        : b?.stop_reason === 'refusal'
          ? 'the model refused the request (stop_reason: refusal)'
          : blocks.length
            ? `the reply contained only ${blocks.map((x) => x.type).join(', ')} blocks and no text`
            : `the reply was empty (HTTP ${r.status})`;
      throw new Error(`Claude returned no text: ${reason}.`);
    }
    return text;
  }
  if (provider === 'xai' && search) {
    // Web search is a Responses-API tool. The subscription token must call the
    // Grok CLI proxy, not api.x.ai (which answers 403 for CLI tokens).
    const r = await fetch(`${XAI.cliBase}/responses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...xaiHeaders(tok) },
      body: JSON.stringify({ model, ...(system && String(system).trim() ? { instructions: String(system) } : {}), input: messages.map((m) => ({ role: m.role, content: m.content })), tools: [{ type: 'web_search' }], max_output_tokens: 4000 }),
      signal,
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`xAI web search refused (HTTP ${r.status}): ${providerMessage(b, r.status)}`.slice(0, 300));
    const msg = (b.output || []).filter((x) => x.type === 'message').flatMap((x) => x.content || []);
    const text = msg.map((c) => c.text || '').join('');
    if (!text) throw new Error('Empty response from Grok search.');
    const urls = [...new Set(msg.flatMap((c) => (c.annotations || []).filter((a) => a.type === 'url_citation').map((a) => a.url)))];
    return text + (urls.length ? '\n\n**Sources**\n' + urls.map((u, i) => `${i + 1}. ${u}`).join('\n') : '');
  }
  if (provider === 'xai') {
    // Only send a system turn when there is one: { role: 'system' } with no content
    // serialises to an object missing `content` and xAI rejects the whole body with
    // 422 "missing field `content`".
    const xaiMessages = system && String(system).trim()
      ? [{ role: 'system', content: String(system) }, ...messages]
      : messages;
    // The Grok CLI talks Chat Completions by default (the model list's api_backend
    // says which protocol a given model wants). Try the CLI default first, then
    // fall back to the Responses API for models that only expose that backend.
    const cliHeaders = { 'Content-Type': 'application/json', ...xaiHeaders(tok) };
    let r = await fetch(`${XAI.cliBase}/chat/completions`, {
      method: 'POST', headers: cliHeaders,
      body: JSON.stringify({ model, messages: xaiMessages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal,
    });
    if (r.status === 404 || r.status === 405) {
      r = await fetch(`${XAI.cliBase}/responses`, {
        method: 'POST', headers: cliHeaders,
        body: JSON.stringify({ model, input: xaiMessages, ...(json ? { text: { format: { type: 'json_object' } } } : {}) }),
        signal,
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`xAI: ${providerMessage(b, r.status)}`);
      const msg = (b.output || []).filter((x) => x.type === 'message').flatMap((x) => x.content || []);
      return msg.map((c) => c.text || '').join('');
    }
    const b = await r.json().catch(() => ({}));
    const msg = b.choices?.[0]?.message || {};
    const raw = msg.content;
    const text = Array.isArray(raw)
      ? raw.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('')
      : (typeof raw === 'string' ? raw : '');
    const finish = b.choices?.[0]?.finish_reason;
    aiLog({ provider: 'xai', model, status: r.status, finish, text_len: text.length,
            content_type: Array.isArray(raw) ? 'array' : typeof raw, reasoning: !!msg.reasoning_content, json: !!json });
    if (!r.ok) throw new Error(`xAI: ${providerMessage(b, r.status)}`);
    if (!text.trim()) {
      throw new Error(finish === 'length'
        ? 'Grok returned no text: the reply hit the output limit (finish_reason: length).'
        : `Grok returned no text (finish_reason: ${finish || 'unknown'}).`);
    }
    return text;
  }
  const claims = jwt(tok)['https://api.openai.com/auth'] || {};
  const r = await fetch(`${CODEX.base}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${tok}`,
      originator: 'neet-pg-prep', 'User-Agent': 'NEETPGPrep/0.1',
      ...(claims.chatgpt_account_id ? { 'ChatGPT-Account-ID': claims.chatgpt_account_id } : {}),
    },
    body: JSON.stringify({
      model, instructions: system, store: false, stream: true,
      input: messages.map((m) => ({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }] })),
      ...(json ? { text: { format: { type: 'json_object' } } } : {}),
      ...(/^(gpt-5|o\d)/i.test(model || '') ? { reasoning: { effort: { min: 'low', low: 'low', medium: 'medium', high: 'high', extra: 'high', ultra: 'high' }[effort || 'medium'] || 'medium' } } : {}),
    }),
    signal,
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 300);
    try { const j = JSON.parse(t); msg = j?.error?.message || j?.detail || msg; } catch {}
    // A ChatGPT subscription that does not include Codex models answers 400 for every
    // model name. Say so plainly instead of surfacing a bare model-not-supported error.
    if (/not supported when using Codex with a ChatGPT account/i.test(msg)) {
      throw new Error(
        'Your ChatGPT plan does not include Codex models, so ChatGPT cannot run prompts here. ' +
        'Sign in with Claude or Grok instead, or use a ChatGPT plan that includes Codex.'
      );
    }
    throw new Error(`ChatGPT: ${msg} (HTTP ${r.status})`);
  }
  let out = '';
  let doneText = '';
  let completedText = '';
  let finishReason = '';
  const seen = new Set();
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const j = JSON.parse(line.slice(5));
        if (j.type) seen.add(j.type);
        if (j.type === 'response.output_text.delta') out += j.delta;
        // Some plans emit only the finished text, never deltas.
        else if (j.type === 'response.output_text.done') doneText = j.text || doneText;
        else if (j.type === 'response.completed') {
          const msg = (j.response?.output || []).find((x) => x.type === 'message');
          completedText = (msg?.content || []).map((c) => c?.text || '').join('') || completedText;
        } else if (j.type === 'response.incomplete') {
          finishReason = j.response?.incomplete_details?.reason || 'incomplete';
        } else if (j.type === 'response.failed' || j.type === 'error') {
          throw new Error(j.response?.error?.message || j.message || 'Request failed');
        }
      } catch (e) { if (e.message && !(e instanceof SyntaxError)) throw e; }
    }
  }
  const text = out || doneText || completedText;
  aiLog({ provider: 'codex', model, status: r.status, text_len: text.length, finish: finishReason || 'completed',
          events: [...seen].slice(0, 12), json: !!json });
  if (!text.trim()) {
    throw new Error(finishReason === 'max_output_tokens'
      ? 'ChatGPT returned no text: the reply hit the output limit (incomplete: max_output_tokens).'
      : `ChatGPT returned no text (events: ${[...seen].slice(0, 6).join(', ') || 'none'}).`);
  }
  return text;
}

// ---------- HTTP glue (connect-style) ----------
const body = (req) => new Promise((res) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => res(s ? JSON.parse(s) : {})); });
export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const send = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname === '/status') return send(200, status());
    if (url.pathname === '/poll') return send(200, await pollLogin(url.searchParams.get('id')));
    const b = await body(req);
    if (url.pathname === '/start') return send(200, await startLogin(b.provider));
    if (url.pathname === '/complete') return send(200, await completeLogin(b.id, b.code));
    if (url.pathname === '/logout') return (logout(b.provider), send(200, { ok: true }));
    if (url.pathname === '/chat') return send(200, { text: await chat(b) });
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: e.message });
  }
}

// Image generation through the same Grok login. Temporary image links are downloaded here so they do not expire.
export async function image(prompt) {
  const tok = await token('xai');
  const r = await fetch(`${XAI.base}/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ model: 'grok-imagine-image', prompt: String(prompt).slice(0, 4000), n: 1 }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Grok image generation refused (HTTP ${r.status}): ${b?.error || b?.message || ''}`.slice(0, 300));
  const d = b.data?.[0]; if (!d) throw new Error('No image returned.');
  if (d.b64_json) return `data:image/jpeg;base64,${d.b64_json}`;
  const ir = await fetch(d.url); if (!ir.ok) throw new Error('Could not download the generated image.');
  return `data:${d.mime_type || 'image/jpeg'};base64,${Buffer.from(await ir.arrayBuffer()).toString('base64')}`;
}
