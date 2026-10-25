#!/usr/bin/env node
// Fails the build if credentials could ship inside the app.
// Scans the built client, the bundled server and (if present) the packaged asar for
// credential-shaped VALUES — not field names like "refresh_token".
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = [];
const add = (p) => { if (fs.existsSync(p)) targets.push(p); };

for (const dir of ['dist', 'electron']) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else add(p);
    }
  };
  if (fs.existsSync(path.join(root, dir))) walk(path.join(root, dir));
}
add(path.join(root, 'server.mjs'));

const asar = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
add(asar);

const VALUE_PATTERNS = [
  [/AIza[0-9A-Za-z_\-]{30,}/g, 'google api key'],
  [/sk-ant-[A-Za-z0-9_\-]{20,}/g, 'anthropic key'],
  [/sk-[A-Za-z0-9]{20,}/g, 'openai-style key'],
  [/xai-[A-Za-z0-9_\-]{20,}/g, 'xai key'],
  [/eyJ[A-Za-z0-9_\-]{12,}\.[A-Za-z0-9_\-]{12,}\.[A-Za-z0-9_\-]{8,}/g, 'jwt'],
  [/Bearer\s+[A-Za-z0-9\-_.]{30,}/g, 'literal bearer token'],
  [/GEMINI_API_KEY\s*[:=]\s*["'`][^"'`]{12,}["'`]/g, 'inlined gemini key'],
];
const BAD_NAMES = /(^|[\\/])(\.env[^\\/]*|oauth[^\\/]*\.json|[^\\/]*token[^\\/]*\.json|[^\\/]*credentials[^\\/]*\.json|[^\\/]*\.pem|[^\\/]*\.key)$/i;

let failures = 0;
for (const t of targets) {
  const rel = path.relative(root, t);
  if (BAD_NAMES.test(t)) { console.error(`FAIL credential-shaped FILE packaged: ${rel}`); failures++; }
  let text;
  try { text = fs.readFileSync(t, 'latin1'); } catch { continue; }
  for (const [re, label] of VALUE_PATTERNS) {
    const m = text.match(re);
    if (m && m.length) { console.error(`FAIL ${label} x${m.length} in ${rel}`); failures++; }
  }
}

if (failures) {
  console.error(`\nSecret guard: ${failures} problem(s). Refusing to build.`);
  process.exit(1);
}
console.log(`Secret guard: clean (${targets.length} files scanned, no credential values, no credential files).`);
