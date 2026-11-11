// End-to-end test for the image-first pipeline (Step 4 review).
//
// For each requested subject it picks a curated bank image, generates an MCQ FROM that
// image via the vision model, verifies it, and records the outcome. Anything that fails
// generation or verification is reported as a text-only fallback — the same behaviour
// the app has — so the pass/fallback ratio is honest.
//
// Usage:  node tools/test-image-first.mjs [countPerSubject]
//   1. Start the app server first (npm run start).
//   2. Run this script; it writes tools/image-first-results.json and prints a table.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadImageBank, queryImageBank, bankStats } from '../server/imageBank.mjs';

const DATA_ROOT = process.env.PULSE_DATA_DIR || join(homedir(), '.pulse-med');

const BASE = process.env.PULSE_BASE_URL || 'http://127.0.0.1:3000';
const PER_SUBJECT = Number(process.argv[2]) || 3;

const SUBJECTS = ['Radiology', 'Dermatology', 'Ophthalmology', 'Pathology', 'Cardiology', 'Orthopaedics'];

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

async function runOne(subject, image) {
  const t0 = Date.now();
  const gen = await post('/api/images/generate-question', {
    imageUrl: image.imageUrl,
    groundTruth: image.ground_truth,
    modality: image.modality,
    subject: image.subject,
    exam: 'NEET_PG',
    difficultyTier: 'MEDIUM',
    optionCount: 4,
  });
  const ms = Date.now() - t0;

  if (!gen.ok || !gen.json?.question) {
    return {
      log: `\n[${subject}] FALLBACK (${ms}ms) ${image.ground_truth}: ${gen.json?.error || gen.text.slice(0, 120)}`,
      row: { subject, groundTruth: image.ground_truth, sourceUrl: image.sourceUrl, status: 'fallback', reason: gen.json?.error || gen.text.slice(0, 200) },
      pass: false,
    };
  }

  // Independent verification pass (the app does this inside generateImageFirstQuestion,
  // but here we check the finished item explicitly so the report shows the verdict).
  const claim = `${image.ground_truth}${image.modality ? ` (${image.modality})` : ''}`;
  const v = await post('/api/images/verify', { imageUrl: image.imageUrl, claim, modality: image.modality });
  const pass = v.json?.pass === true;

  const q = gen.json.question;
  const lines = [
    `\n[${subject}] ${pass ? 'PASS' : 'UNVERIFIED'} (${ms}ms) ${image.ground_truth}`,
    `  Q: ${q.stem.slice(0, 140)}`,
    `  key ${q.correctOption}: ${(q.options?.[q.correctOption] || '').slice(0, 90)}`,
    `  verify: ${v.json?.reason}`,
  ];

  return {
    log: lines.join('\n'),
    pass,
    row: {
      subject,
      imageId: image.image_id,
      groundTruth: image.ground_truth,
      modality: image.modality,
      licence: image.licence,
      sourceUrl: image.sourceUrl,
      imageUrl: image.imageUrl,
      previewUrl: image.previewUrl,
      question: q,
      verification: { pass, reason: v.json?.reason },
      ms,
      status: pass ? 'pass' : 'unverified',
    },
  };
}

async function main() {
  const stats = bankStats();
  console.log(`Bank: ${stats.total} entries`);
  console.log(JSON.stringify(stats.bySubject));
  if (stats.total === 0) {
    console.error('Bank is empty. Run POST /api/images/bank/build first.');
    process.exit(1);
  }

  // Build the full candidate list first, then run everything CONCURRENTLY. Each vision
  // call takes ~30–75s; serialising 18 of them took >18 minutes. Running different
  // images in parallel (concurrency 3) is the same work with far less wall-clock.
  const jobs = [];
  for (const subject of SUBJECTS) {
    const images = queryImageBank({ subject, limit: PER_SUBJECT });
    if (images.length === 0) {
      console.log(`[${subject}] no bank images — skipped`);
      jobs.push({ subject, row: { subject, status: 'no-images' } });
      continue;
    }
    for (const image of images) jobs.push({ subject, image });
  }

  const CONCURRENCY = 3;
  let cursor = 0;
  const results = [];
  let passed = 0;
  let fellBack = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job.image) {
        results.push(job.row);
        continue;
      }
      try {
        const out = await runOne(job.subject, job.image);
        console.log(out.log);
        results.push(out.row);
        if (out.pass) passed += 1; else fellBack += 1;
      } catch (err) {
        fellBack += 1;
        console.log(`\n[${job.subject}] ERROR ${job.image.ground_truth}: ${err?.message || err}`);
        results.push({ subject: job.subject, groundTruth: job.image.ground_truth, status: 'error', reason: String(err?.message || err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  const out = {
    ranAt: new Date().toISOString(),
    bank: stats,
    requested: SUBJECTS.length * PER_SUBJECT,
    generated: results.filter((r) => r.status === 'pass' || r.status === 'unverified').length,
    passed,
    fellBack,
    results,
  };
  const file = join(process.cwd(), 'tools', 'image-first-results.json');
  writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  // Also drop a copy where the app server can serve it, so the Image Question Review
  // page can show this exact run (the Step-4 review table) without a rebuild.
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(join(DATA_ROOT, 'image-first-results.json'), JSON.stringify(out, null, 2), 'utf8');
  } catch (e) {
    console.warn(`Could not mirror results to ${DATA_ROOT}: ${e?.message || e}`);
  }
  console.log(`\n==== SUMMARY ====`);
  console.log(`passed: ${passed}   fell back to text-only: ${fellBack}   wrote ${file}`);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
