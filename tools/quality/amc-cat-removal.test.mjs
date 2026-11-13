import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TOPIC_IMPORTANCE } from '../../src/data/topicImportance.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const AMC_PLAN_PREFIX = 'pulse.quality.plan.v3.AMC_CAT.';

test('the sidebar retains NEET-PG and INI-CET without AMC CAT controls', async () => {
  const sidebar = await read('../../src/components/Sidebar.tsx');
  assert.equal(/AMC_CAT|AMC[ -]CAT/i.test(sidebar), false, 'AMC references remain in the sidebar');
  assert.match(sidebar, /NEET_PG/);
  assert.match(sidebar, /INI_CET/);
  assert.equal(/\bAMC\b/i.test(sidebar), false, 'AMC date lookup references remain');
});

test('the question bank no longer excludes a legacy AMC bank', async () => {
  const source = await read('../../src/components/QuestionBankPracticeView.tsx');
  assert.equal(/[\'"]amc[\'"]/i.test(source), false, 'a legacy AMC bank exclusion remains');
});

test('topic importance retains NEET-PG and INI-CET data without AMC rows', () => {
  assert.ok(TOPIC_IMPORTANCE.filter((row) => /NEET/i.test(row.exam)).length >= 869);
  assert.ok(TOPIC_IMPORTANCE.filter((row) => /INI-CET/i.test(row.exam)).length >= 606);
  assert.equal(TOPIC_IMPORTANCE.filter((row) => /AMC(?: CAT)?/i.test(row.exam) || /AMC CAT/i.test(row.unit)).length, 0);
});

test('server source and bundled runtime omit AMC-specific prompts and date lookup', async () => {
  for (const path of ['../../server.ts', '../../server.mjs', '../../server/visionQuestion.d.mts']) {
    assert.equal(/AMC_CAT|AMC CAT|AMC MCQ|amc\.org\.au/i.test(await read(path)), false, `${path} contains AMC-specific behavior`);
  }
});

test('Pulse Med metadata omits AMC CAT', async () => {
  for (const path of ['../../metadata.json', '../../index.html', '../../package.json']) {
    assert.equal(/AMC[ -]CAT/i.test(await read(path)), false, `${path} contains AMC CAT metadata`);
  }
});

test('cached plans contain no AMC CAT plan entries', async () => {
  for (const path of ['../../plans-vyce.json', '../../plans-nvidia-merge.json', '../../plans-nvidia.json']) {
    const data = JSON.parse(await read(path));
    assert.equal(Object.keys(data).filter((key) => key.startsWith(AMC_PLAN_PREFIX)).length, 0, path);
  }
});
