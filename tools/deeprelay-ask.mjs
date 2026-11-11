// Ask Deep Relay's DeepSeek V4.1 Flash a question from the command line.
// The API key is read from the DEEPRELAY_API_KEY environment variable and is never written to disk.
//   node tools/deeprelay-ask.mjs prompt.txt            (prompt read from a file)
//   echo "question" | node tools/deeprelay-ask.mjs -   (prompt read from stdin)
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

const jobLogPath = process.env.DEEPSEEK_JOBS_LOG || path.join(os.homedir(), '.pulse-med', 'deepseek-jobs.jsonl');

function appendJob(event) {
  try {
    fs.mkdirSync(path.dirname(jobLogPath), { recursive: true });
    fs.appendFileSync(jobLogPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8' });
  } catch {
    // Logging must not change the CLI's normal behaviour.
  }
}

function shortError(value, apiKey) {
  let text = value instanceof Error ? value.message : String(value ?? '');
  if (apiKey) text = text.split(apiKey).join('[redacted]');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 200) || 'Unknown error';
}

function firstNonEmptyLine(text) {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 160);
  }
  return '';
}

const key = process.env.DEEPRELAY_API_KEY;
if (!key) {
  console.error('DEEPRELAY_API_KEY is not set in this environment.');
  process.exit(1);
}
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node tools/deeprelay-ask.mjs <prompt-file | ->');
  process.exit(1);
}

const model = process.env.DEEPRELAY_MODEL || 'deeprelay/deepseek-v4.1-flash';
const maxTokens = Number(process.env.DEEPRELAY_MAX_TOKENS || 128000);
const id = randomBytes(16).toString('hex');

const promptReadStartedAt = Date.now();
let prompt;
try {
  prompt = arg === '-' ? await new Response(process.stdin).text() : fs.readFileSync(arg, 'utf8');
} catch (err) {
  const error = shortError(err, key);
  appendJob({
    event: 'end',
    id,
    at: new Date().toISOString(),
    ms: Date.now() - promptReadStartedAt,
    http: null,
    finish: null,
    contentChars: 0,
    reasoningTokens: null,
    completionTokens: null,
    promptTokens: null,
    error,
  });
  console.error(error);
  process.exit(1);
}

const startedAt = Date.now();
appendJob({
  event: 'start',
  id,
  at: new Date(startedAt).toISOString(),
  pid: process.pid,
  promptFile: arg,
  promptChars: prompt.length,
  firstLine: firstNonEmptyLine(prompt),
  model,
  maxTokens,
});

try {
  const res = await fetch('https://api.deeprelay.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens }),
  });
  const body = await res.json().catch(() => ({}));
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  const contentChars = typeof content === 'string' ? content.length : 0;
  const finish = choice?.finish_reason ?? null;
  const usage = body?.usage ?? {};
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null;
  const completionTokens = usage?.completion_tokens ?? null;
  const promptTokens = usage?.prompt_tokens ?? null;

  if (!res.ok) {
    appendJob({
      event: 'end',
      id,
      at: new Date().toISOString(),
      ms: Date.now() - startedAt,
      http: res.status,
      finish,
      contentChars,
      reasoningTokens,
      completionTokens,
      promptTokens,
      error: `HTTP ${res.status}`,
    });
    console.error(`Deep Relay error ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    process.exit(1);
  }

  appendJob({
    event: 'end',
    id,
    at: new Date().toISOString(),
    ms: Date.now() - startedAt,
    http: res.status,
    finish,
    contentChars,
    reasoningTokens,
    completionTokens,
    promptTokens,
    error: null,
  });
  console.log(content ?? '(no text returned)');
} catch (err) {
  const error = shortError(err, key);
  appendJob({
    event: 'end',
    id,
    at: new Date().toISOString(),
    ms: Date.now() - startedAt,
    http: null,
    finish: null,
    contentChars: 0,
    reasoningTokens: null,
    completionTokens: null,
    promptTokens: null,
    error,
  });
  console.error(error);
  process.exit(1);
}
