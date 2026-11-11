// Offline checks for image licenses, topic matching, and strict vision verdicts.
//   node --import tsx tools/quality/image-license-accuracy.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildImageQuestionInstruction } from '../../server/visionQuestion.mjs';
import { buildVisionVerificationPrompt, parseVisionVerdict, relevanceOf, reusableLicense, reusableSearchResult } from '../../server/images.mjs';
import { normalizeReusableImageLicense, stripUnlicensedImageFields } from '../../src/utils/imageLicense.ts';

let failures = 0;
const expect = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

expect('Public Domain label accepted', reusableLicense('Public domain')?.label, 'Public domain');
expect('PD label accepted', reusableLicense('PD-US-expired')?.label, 'Public domain');
expect('CC0 label accepted', reusableLicense('CC0 1.0 Universal')?.label, 'CC0');
expect('Open-i CC0 URL accepted', reusableLicense('', 'https://creativecommons.org/publicdomain/zero/1.0/')?.label, 'CC0');
for (const label of ['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-ND 4.0', 'by', 'bysa', 'unknown']) {
  expect(`reject ${label}`, reusableLicense(label), null);
}
expect('contradictory CC BY URL rejected', reusableLicense('CC0', 'https://creativecommons.org/licenses/by/4.0/'), null);
expect('unknown label cannot borrow CC0 URL rights', reusableLicense('unknown', 'https://creativecommons.org/publicdomain/zero/1.0/'), null);

expect('exact diagnostic token matches', relevanceOf({ title: 'Lobar pneumonia chest radiograph', caption: '' }, 'pneumonia chest x-ray') >= 0.6, true);
expect('substring collision does not match a different diagnosis', relevanceOf({ title: 'Pneumothorax X-ray', caption: '' }, 'pneumonia'), 0);
expect('weak modality-only live result rejected', reusableSearchResult({ title: 'Generic chest X-ray', caption: '', licence: 'Public domain' }, 'lobar pneumonia'), false);
expect('unlicensed search result rejected', reusableSearchResult({ title: 'Lobar pneumonia X-ray', caption: '', licence: 'CC BY 4.0' }, 'lobar pneumonia'), false);
expect('relevant Public Domain search result accepted', reusableSearchResult({ title: 'Lobar pneumonia X-ray', caption: '', licence: 'Public domain' }, 'lobar pneumonia'), true);

expect('complete valid vision verdict passes', parseVisionVerdict('{"shows":"lobar pneumonia on chest X-ray","unsupported_question_claims":[],"pass":true,"reason":"Finding is visible."}')?.pass, true);
expect('false vision verdict stays false', parseVisionVerdict('{"shows":"pneumothorax","unsupported_question_claims":[],"pass":false,"reason":"Different finding."}')?.pass, false);
const contradicted = parseVisionVerdict('{"shows":"impetigo on the dorsal hand","unsupported_question_claims":["stem says palm, image shows dorsum"],"pass":true,"reason":"The bank diagnosis matches."}');
expect('contradicted stem detail vetoes pass', contradicted?.pass, false);
expect('contradicted detail is reported', contradicted?.reason.includes('palm'), true);
expect('malformed pass text is rejected', parseVisionVerdict('model output: {"pass":true,"shows":"pneumonia","unsupported_question_claims":[]}'), null);
expect('missing shows is rejected', parseVisionVerdict('{"pass":true,"unsupported_question_claims":[],"reason":"yes"}'), null);
expect('missing unsupported claim audit is rejected', parseVisionVerdict('{"pass":true,"shows":"pneumonia","reason":"yes"}'), null);
expect('non-string shows is rejected', parseVisionVerdict('{"pass":true,"shows":42,"unsupported_question_claims":[]}'), null);
const consistencyPrompt = buildVisionVerificationPrompt({ claim: 'erythema multiforme', modality: 'clinical photo', bodyPart: 'skin', questionStem: 'A 22-year-old develops lesions after a recent URI; mucosal involvement is minimal.', questionText: 'What is the diagnosis?', correctAnswer: 'Erythema multiforme', explanation: 'The image shows target lesions.', boardPearl: '' });
expect('verifier prompt includes the generated stem', consistencyPrompt.includes('A 22-year-old develops lesions after a recent URI'), true);
expect('image-only verification has no case chart to trust', consistencyPrompt.includes('There is no separate patient chart or case history'), true);
expect('non-visible history and mucosal details must be rejected', consistencyPrompt.includes('mucosal status that are not visible'), true);
expect('verifier audits visual anatomy details', consistencyPrompt.includes('body site/surface, laterality'), true);
const unsupportedContext = parseVisionVerdict('{"shows":"target lesions","unsupported_question_claims":["patient age and URI history are not visible"],"pass":true,"reason":"The diagnosis matches."}');
expect('nonvisual case context vetoes an otherwise positive verdict', unsupportedContext?.pass, false);
const imageWriterPrompt = buildImageQuestionInstruction({ groundTruth: 'erythema multiforme', modality: 'clinical photo', subject: 'Dermatology', bodyPart: 'skin', examLabel: 'INI-CET', optionCount: 4 });
expect('image-only writer is told not to invent patient context', imageWriterPrompt.includes('Do NOT invent patient age, sex, symptoms, history'), true);
expect('image-only writer states side, plane and phase only from metadata', imageWriterPrompt.includes('unless the trusted metadata above states it'), true);
const genericPrompt = buildVisionVerificationPrompt({ claim: 'lobar pneumonia', modality: 'X-ray' });
expect('generic bank verification retains label-only behavior', genericPrompt.includes('No generated question context was provided'), true);

expect('legacy generated QBank image without license is hidden', stripUnlicensedImageFields({ image: '/old.jpg', imageLicence: undefined, imageCaption: 'Old source' }).image, undefined);
expect('QBank keeps a CC0 image with provenance', stripUnlicensedImageFields({ image: '/cc0.jpg', imageLicence: 'CC0', imageLicenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }).image, '/cc0.jpg');
expect('QBank strips a non-free image', stripUnlicensedImageFields({ image: '/by.jpg', imageLicence: 'CC BY 4.0' }).image, undefined);
expect('shared browser/server license gate agrees', normalizeReusableImageLicense('Public domain')?.label, reusableLicense('Public domain')?.label);

const tempRoot = mkdtempSync(join(tmpdir(), 'pulse-image-license-'));
const previousDataDir = process.env.PULSE_DATA_DIR;
process.env.PULSE_DATA_DIR = tempRoot;
try {
  const bankDir = join(tempRoot, 'image-bank');
  mkdirSync(bankDir, { recursive: true });
  writeFileSync(join(bankDir, 'bank.json'), JSON.stringify({ entries: [
    { image_id: 'pd-pneumonia', licence: 'Public domain', ground_truth: 'lobar pneumonia', subject: 'Radiology', modality: 'X-ray', body_part: 'chest' },
    { image_id: 'cc0-pneumothorax', licence: 'CC0', ground_truth: 'pneumothorax', subject: 'Radiology', modality: 'X-ray', body_part: 'chest' },
    { image_id: 'by-cancer', licence: 'CC BY 4.0', ground_truth: 'pneumonia', subject: 'Radiology', modality: 'X-ray', body_part: 'chest' },
    { image_id: 'missing-license', ground_truth: 'pneumonia', subject: 'Radiology', modality: 'X-ray', body_part: 'chest' },
  ] }));
  const bank = await import(`../../server/imageBank.mjs?license-test=${Date.now()}`);
  expect('persisted bank exposes only PD and CC0 rows', bank.loadImageBank().map((entry) => entry.image_id).sort(), ['cc0-pneumothorax', 'pd-pneumonia']);
  expect('topic search requires diagnosis agreement', bank.searchBankByText('pneumonia', { limit: 10 }).map((entry) => entry.image_id), ['pd-pneumonia']);
  expect('topic search rejects substring collision', bank.searchBankByText('pneumonia', { limit: 10 }).some((entry) => entry.image_id === 'cc0-pneumothorax'), false);
  expect('weak modality-only cue cannot return entries', bank.searchBankByText('histology lung', { limit: 10 }), []);
  expect('broad modality and body-part cue may match', bank.searchBankByText('chest x-ray', { limit: 10 }).length, 2);

  writeFileSync(join(bankDir, 'rejected.json'), JSON.stringify({ entries: [{ image_id: 'rejected-id', ground_truth: 'pneumothorax', reason: 'wrong image' }] }));
  const build = await bank.buildImageBank({
    seeds: [{ subject: 'Radiology', modality: 'X-ray', ground_truth: 'pneumothorax', query: 'pneumothorax chest x-ray' }],
    limitPerSeed: 2,
    throttleMs: 0,
    maxAttempts: 1,
    search: async () => ({ results: [
      { id: 'rejected-id', provider: 'Wikimedia Commons', articleUrl: 'https://commons.wikimedia.org/rejected', imageUrl: 'https://upload.wikimedia.org/rejected.jpg', proxyUrl: '/proxy?u=rejected', licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: 'Test' },
      { id: 'new-pd-id', provider: 'Wikimedia Commons', articleUrl: 'https://commons.wikimedia.org/new', imageUrl: 'https://upload.wikimedia.org/new.jpg', proxyUrl: '/proxy?u=new', licence: 'Public domain', licenceUrl: 'https://commons.wikimedia.org/new', credit: 'Test' },
    ], errors: [] }),
    verify: async () => true,
  });
  expect('bank harvest skips previously rejected images', build.rejected, 1);
  expect('rejected image id is not resurrected', bank.loadImageBank().some((entry) => entry.image_id === 'rejected-id'), false);
  expect('verified PD candidate enters the bank', bank.loadImageBank().some((entry) => entry.image_id === 'new-pd-id'), true);
} finally {
  if (previousDataDir === undefined) delete process.env.PULSE_DATA_DIR;
  else process.env.PULSE_DATA_DIR = previousDataDir;
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(failures ? `${failures} FAILED` : 'all image-license and accuracy checks passed');
process.exit(failures ? 1 : 0);
