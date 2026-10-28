// Copies the tesseract engine, wasm core and English language data into public/tesseract/ so
// OCR works with NO network. Runs automatically before `dev` and `build`.
//
// Why this exists: tesseract.js defaults fetch the worker script, the wasm core and
// eng.traineddata.gz from jsdelivr. In a packaged app with no internet that hangs at
// "Loading the OCR engine" until the 60 s timeout.
import { mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'tesseract');
const nm = path.join(root, 'node_modules');

const jobs = [];

// 1. The worker script.
jobs.push([
  path.join(nm, 'tesseract.js', 'dist', 'worker.min.js'),
  path.join(out, 'worker.min.js'),
]);

// 2. The wasm core. Copy every variant: tesseract picks simd / lstm / simd-lstm at runtime
//    depending on what the browser supports, so a missing variant is a runtime failure.
const coreDir = path.join(nm, 'tesseract.js-core');
if (existsSync(coreDir)) {
  for (const f of await readdir(coreDir)) {
    if (/^tesseract-core.*\.(js|wasm)$/.test(f)) {
      jobs.push([path.join(coreDir, f), path.join(out, 'core', f)]);
    }
  }
}

// 3. Language data. best_int is ~3 MB and plenty for book scans; the 10 MB "4.0.0" build is
//    only worth it if recognition quality on a specific book demands it.
const langSrc = path.join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz');
jobs.push([langSrc, path.join(out, 'lang', 'eng.traineddata.gz')]);

let copied = 0;
let bytes = 0;
for (const [src, dst] of jobs) {
  if (!existsSync(src)) {
    console.warn(`[tesseract] missing ${path.relative(root, src)} — run npm install`);
    continue;
  }
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  bytes += (await stat(dst)).size;
  copied += 1;
}

console.log(
  `[tesseract] ${copied} files, ${(bytes / 1048576).toFixed(1)} MB -> public/tesseract/`,
);
