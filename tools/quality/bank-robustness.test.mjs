// Robustness checks for atomic bank writes and optional bank metadata.
//   npx tsx tools/quality/bank-robustness.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'bank-robustness-'));
process.env.PULSE_DATA_DIR = dataDir;
const bankDir = join(dataDir, 'image-bank');
mkdirSync(bankDir, { recursive: true });

let failures = 0;
const expect = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

const { buildImageBank } = await import('../../server/imageBank.mjs');

await buildImageBank({
  seeds: [{ subject: 'Radiology', modality: 'X-ray', ground_truth: 'pneumonia', query: 'pneumonia' }],
  throttleMs: 0,
  limitPerSeed: 1,
  search: async () => ({ results: [{ id: 'robustness-row', imageUrl: 'https://example.org/image.jpg', proxyUrl: '/image.jpg', licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }], errors: [] }),
});

const bankFile = join(bankDir, 'bank.json');
let parsedBank;
try {
  parsedBank = JSON.parse(readFileSync(bankFile, 'utf8'));
} catch (error) {
  parsedBank = null;
  console.log(`FAIL bank.json parses: ${error.message}`);
  failures += 1;
}
expect('rebuild leaves no temporary bank files', readdirSync(bankDir).filter((name) => /^bank\.json\.tmp-/.test(name)), []);
expect('rebuilt bank contains its entry', Array.isArray(parsedBank?.entries) && parsedBank.entries.some((entry) => entry.image_id === 'robustness-row'), true);

const { selectImageBankCandidates } = await import('../../src/lib/imageFirst.ts');
let selected;
try {
  selected = selectImageBankCandidates([[{ image_id: 'missing-ground-truth' }]], 1);
} catch (error) {
  console.log(`FAIL candidate selection accepts missing ground_truth: ${error.message}`);
  failures += 1;
}
expect('candidate selection returns entry without ground_truth', selected?.map((entry) => entry.image_id), ['missing-ground-truth']);

console.log(failures ? `${failures} FAILED` : 'all bank robustness checks passed');
process.exit(failures ? 1 : 0);
