// A bank rebuild must never delete entries whose licence is not reusable: those stay in the file, they are only
// left out of queries. Runs against a temporary data folder, never the real bank.
//   node --import tsx tools/quality/image-bank-rewrite.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'bank-test-'));
process.env.PULSE_DATA_DIR = dataDir;
const bankDir = join(dataDir, 'image-bank');
mkdirSync(bankDir, { recursive: true });
const bankFile = join(bankDir, 'bank.json');

const ccBy = { image_id: 'old-ccby-1', ground_truth: 'pneumonia', subject: 'Radiology', modality: 'X-ray', imageUrl: 'https://example.org/a.jpg', licence: 'CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/2.0/' };
const cc0 = { image_id: 'old-cc0-1', ground_truth: 'cirrhosis', subject: 'Radiology', modality: 'CT', imageUrl: 'https://example.org/b.jpg', licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
writeFileSync(bankFile, JSON.stringify({ builtAt: '2026-10-30T00:00:00.000Z', entries: [ccBy, cc0] }, null, 2));

let failures = 0;
const expect = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

const { buildImageBank, loadImageBank } = await import('../../server/imageBank.mjs');

// A search that returns one new CC0 picture for every seed; the rebuild must add it without dropping the old rows.
const newRow = { id: 'new-cc0-1', imageUrl: 'https://example.org/c.jpg', proxyUrl: '/api/images/proxy?x=c', title: 'New CC0 image', caption: '', licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', articleUrl: '', credit: '' };
await buildImageBank({ search: async () => ({ results: [newRow], errors: [] }), throttleMs: 0, limitPerSeed: 1 });

const onDisk = JSON.parse(readFileSync(bankFile, 'utf8')).entries.map((e) => e.image_id).sort();
expect('rebuild keeps the CC BY entry on disk', onDisk.includes('old-ccby-1'), true);
expect('rebuild keeps the CC0 entry on disk', onDisk.includes('old-cc0-1'), true);
expect('rebuild adds the new CC0 entry', onDisk.includes('new-cc0-1'), true);

const visible = loadImageBank().map((e) => e.image_id);
expect('queries still hide the CC BY entry', visible.includes('old-ccby-1'), false);
expect('queries show the CC0 entries', visible.includes('old-cc0-1') && visible.includes('new-cc0-1'), true);

console.log(failures ? `${failures} FAILED` : 'all image-bank rewrite checks passed');
process.exit(failures ? 1 : 0);
