#!/usr/bin/env node
/**
 * Pulse Med — Debug Control Center launcher.
 *
 * 1. Reuses an already-running control center when possible.
 * 2. Otherwise starts tools/debug-center/server.mjs detached, with logs on disk.
 * 3. Opens the dashboard in an Edge/Chrome app window using the one-time token link.
 *
 * Set DEBUG_CENTER_NO_OPEN=1 to start the server without opening a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, 'debug-center-data');
const OUT_LOG = path.join(DATA, 'center.out.log');
const ERR_LOG = path.join(DATA, 'center.err.log');
const PROFILE = path.join(DATA, 'browser-profile');
const PORT = Number(process.env.DEBUG_CENTER_PORT || 4319);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

fs.mkdirSync(DATA, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probe(url, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function readToken() {
  if (process.env.DEBUG_CENTER_TOKEN) return process.env.DEBUG_CENTER_TOKEN.trim();
  try {
    const token = fs.readFileSync(path.join(DATA, '.token'), 'utf8').trim();
    if (token) return token;
  } catch { /* not created yet */ }
  return '';
}

function findBrowser() {
  const roots = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  candidates.push('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

function openUrl(url) {
  if (process.env.DEBUG_CENTER_NO_OPEN === '1') {
    console.log(`Browser launch skipped (DEBUG_CENTER_NO_OPEN=1). URL: ${url}`);
    return;
  }
  const browser = findBrowser();
  if (browser) {
    const args = [
      `--app=${url}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1500,1000',
    ];
    try {
      spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      console.log(`Opened ${path.basename(browser)} app window.`);
      return;
    } catch (err) {
      console.warn(`Could not start ${browser}: ${err.message}`);
    }
  }
  console.log('No Edge/Chrome found; opening the default browser.');
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function tail(file, lines = 20) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function main() {
  let running = await probe(`${BASE}/api/health`);
  if (!running) {
    console.log(`Starting Debug Control Center on ${BASE} …`);
    const out = fs.openSync(OUT_LOG, 'a');
    const err = fs.openSync(ERR_LOG, 'a');
    const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], {
      cwd: ROOT,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, DEBUG_CENTER_PORT: String(PORT) },
    });
    child.unref();
    fs.closeSync(out);
    fs.closeSync(err);

    for (let i = 0; i < 100; i++) {
      running = await probe(`${BASE}/api/health`, 700);
      if (running) break;
      await sleep(250);
    }
  } else {
    console.log(`Debug Control Center is already running on ${BASE}.`);
  }

  if (!running) {
    console.error('The Debug Control Center did not start. Recent log output:');
    console.error(await tail(ERR_LOG));
    console.error(await tail(OUT_LOG));
    process.exitCode = 1;
    return;
  }

  let token = '';
  for (let i = 0; i < 40 && !token; i++) {
    token = readToken();
    if (!token) await sleep(150);
  }
  if (!token) {
    console.error('The server is running but no debug token was found. Set DEBUG_CENTER_TOKEN or check debug-center-data\\.token.');
    process.exitCode = 1;
    return;
  }

  const url = `${BASE}/?token=${encodeURIComponent(token)}`;
  console.log(`Debug Control Center ready: ${BASE}`);
  console.log(`Token file: ${path.join(DATA, '.token')}`);
  console.log(`Logs: ${OUT_LOG}`);
  openUrl(url);
  // The server is detached and intentionally keeps running for the next launch.
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
