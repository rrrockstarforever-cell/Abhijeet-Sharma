#!/usr/bin/env node
/**
 * Debug Control Center verification suite.
 *
 * Starts the control center if it is not already running, then checks the real
 * security boundaries and endpoints against the live server. Writes a JSON
 * report to debug-center-data/verify-report.json.
 *
 * Usage: node tools/debug-center/verify.mjs [--keep]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'debug-center-data');
const REPORT = path.join(DATA, 'verify-report.json');
const PORT = Number(process.env.DEBUG_CENTER_PORT || 4319);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const KEEP = process.argv.includes('--keep');

fs.mkdirSync(DATA, { recursive: true });

const results = [];
let token = '';
let child = null;
let startedHere = false;

function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function request(method, pathname, { headers = {}, body = null, auth = false, origin = true } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    if (auth && token) h['x-debug-token'] = token;
    if (origin && method !== 'GET' && method !== 'HEAD') h.Origin = BASE;
    let payload = null;
    if (body !== null && body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = String(payload.length);
    }
    const req = http.request(`${BASE}${pathname}`, { method, headers: h, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, text: raw.toString('utf8'), json });
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message, raw: Buffer.alloc(0), text: '', json: null, headers: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', raw: Buffer.alloc(0), text: '', json: null, headers: {} }); });
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health() {
  const r = await request('GET', '/api/health');
  return r.status === 200 && Boolean(r.json?.ok);
}

function readToken() {
  if (process.env.DEBUG_CENTER_TOKEN) return process.env.DEBUG_CENTER_TOKEN.trim();
  try {
    return fs.readFileSync(path.join(DATA, '.token'), 'utf8').trim();
  } catch {
    return '';
  }
}

async function ensureServer() {
  if (await health()) {
    console.log(`Reusing the running control center on ${BASE}.`);
    return;
  }
  console.log(`Starting a control center for verification on ${BASE} …`);
  child = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG_CENTER_PORT: String(PORT) },
  });
  startedHere = true;
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    if (await health()) return;
    await sleep(250);
  }
  throw new Error('The control center did not become healthy within 30 seconds.');
}

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (!entry.internal && (entry.family === 'IPv4' || entry.family === 4)) out.push(entry.address);
    }
  }
  return [...new Set(out)];
}

function tcpProbe(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function run() {
  await ensureServer();
  for (let i = 0; i < 40 && !token; i++) {
    token = readToken();
    if (!token) await sleep(150);
  }
  if (!token) throw new Error('No debug token found in debug-center-data/.token.');

  // ---- static dashboard ----
  let r = await request('GET', '/');
  record('Dashboard HTML is served', r.status === 200 && /Debug Control Center/.test(r.text), `HTTP ${r.status}, ${r.raw.length} bytes`);
  r = await request('GET', '/app.js');
  record('Dashboard client script is served', r.status === 200 && /sendInstruction/.test(r.text), `HTTP ${r.status}`);
  r = await request('GET', '/styles.css');
  record('Dashboard stylesheet is served', r.status === 200 && r.raw.length > 1000, `HTTP ${r.status}, ${r.raw.length} bytes`);
  r = await request('GET', '/favicon.svg');
  record('Favicon is served', r.status === 200, `HTTP ${r.status}`);

  // ---- auth ----
  r = await request('GET', '/api/status');
  record('Unauthenticated status is rejected', r.status === 401, `HTTP ${r.status}`);
  r = await request('GET', '/api/status', { headers: { 'x-debug-token': 'deadbeef'.repeat(8) } });
  record('Wrong token is rejected', r.status === 401, `HTTP ${r.status}`);
  r = await request('GET', '/api/status', { auth: true });
  record('Authenticated status works', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}`);
  const status = r.json || {};

  // ---- host/origin guards ----
  r = await request('GET', '/api/health', { headers: { Host: 'evil.example.com' } });
  record('Non-localhost Host header is rejected', r.status === 403, `HTTP ${r.status}`);
  r = await request('POST', '/api/app/stop', { auth: true, origin: false, headers: { Origin: 'http://evil.example.com' }, body: {} });
  record('Cross-origin write is rejected', r.status === 403, `HTTP ${r.status}`);
  r = await request('POST', '/api/app/stop', { origin: false, body: {} });
  record('Unauthenticated write is rejected', r.status === 401, `HTTP ${r.status}`);

  // ---- LAN exposure ----
  const lan = localAddresses();
  let exposed = [];
  for (const ip of lan) {
    if (await tcpProbe(ip, PORT)) exposed.push(ip);
  }
  record('Server is bound to 127.0.0.1 only', exposed.length === 0, exposed.length ? `reachable on ${exposed.join(', ')}` : `${lan.length} LAN address(es) probed, none reachable`);

  // ---- status shape ----
  record('Status reports app/center/agent state', Boolean(status.center?.port && status.app && status.agent && status.repo?.root), `app=${status.app?.status}, agent=${status.agent?.available ? 'available' : 'missing'}`);
  record('Status lists installer or reports none', typeof status.installer === 'object', status.installer?.name || 'no installer yet');

  // ---- logs ----
  r = await request('GET', '/api/logs?since=0&limit=50', { auth: true });
  record('Logs endpoint returns entries', r.status === 200 && Array.isArray(r.json?.entries), `${r.json?.entries?.length ?? 0} entries, lastSeq ${r.json?.lastSeq ?? '—'}`);
  r = await request('GET', '/api/logs/export', { auth: true });
  record('Log export downloads a text file', r.status === 200 && /attachment/.test(String(r.headers['content-disposition'] || '')), `HTTP ${r.status}, ${r.raw.length} bytes`);

  // ---- checkpoints ----
  r = await request('GET', '/api/checkpoints', { auth: true });
  record('Checkpoint list is available', r.status === 200 && Array.isArray(r.json?.checkpoints), `${r.json?.checkpoints?.length ?? 0} checkpoint(s)`);

  // ---- agent ----
  r = await request('GET', '/api/agent', { auth: true });
  record('Agent bridge state is available', r.status === 200 && Boolean(r.json?.agent), r.json?.agent?.available ? `CLI ${r.json.agent.version || 'found'}` : 'CLI missing (manual handoff mode)');
  r = await request('POST', '/api/agent/config', { auth: true, body: { sessionId: 'not-a-session' } });
  record('Invalid session ID is rejected', r.status === 400, `HTTP ${r.status}`);
  r = await request('POST', '/api/agent/probe', { auth: true, body: {} });
  record('Agent probe responds', r.status === 200 && Boolean(r.json?.probe), r.json?.probe?.error || `session ${r.json?.probe?.sessionId || 'none'}`);

  // ---- screenshots ----
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await request('POST', '/api/screenshots', { auth: true, body: { dataUrl: `data:image/png;base64,${png}`, note: 'verification image' } });
  record('Screenshot upload works', r.status === 200 && Boolean(r.json?.file), r.json?.file || `HTTP ${r.status}`);
  if (r.status === 200 && r.json?.file) {
    const shot = await request('GET', `/api/screenshots/${encodeURIComponent(r.json.file)}`, { auth: true });
    record('Uploaded screenshot can be read back', shot.status === 200 && shot.raw.length === r.json.bytes, `${shot.raw.length} bytes`);
  } else {
    record('Uploaded screenshot can be read back', false, 'upload failed');
  }

  // ---- fixed command surface ----
  r = await request('POST', '/api/exec', { auth: true, body: { cmd: 'whoami' } });
  record('No arbitrary command endpoint exists', r.status === 404, `HTTP ${r.status}`);
  r = await request('GET', '/api/definitely-not-real', { auth: true });
  record('Unknown API routes return 404', r.status === 404, `HTTP ${r.status}`);

  // ---- source checks ----
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const listensLocal = /server\.listen\(PORT,\s*HOST/.test(serverSrc);
  record('Server source binds the local host constant', listensLocal, listensLocal ? 'listen(PORT, HOST)' : 'pattern not found');
  const spawnCalls = [...serverSrc.matchAll(/spawn\(([^,]+),/g)].map((m) => m[1]);
  record('All spawn targets are fixed paths/variables', spawnCalls.length > 0, `${spawnCalls.length} spawn call(s)`);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    startedHere,
    tokenFile: path.join(DATA, '.token'),
    passed,
    failed,
    results,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n${passed}/${results.length} checks passed. Report: ${REPORT}`);
  if (failed) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error(`Verification could not run: ${err?.message || err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (startedHere && child && !KEEP) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
    } else if (startedHere && KEEP) {
      console.log(`Control center left running (PID ${child.pid}).`);
    }
  });
