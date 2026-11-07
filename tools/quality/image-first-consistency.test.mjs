// Offline check that image verification receives the generated question text.
//   node --import tsx tools/quality/image-first-consistency.test.mjs

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { generateImageFirstQuestion, hasUnsupportedImageDetailsClaim } = await import('../../src/lib/imageFirst.ts');

let failures = 0;
const expect = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

const image = { image_id: 'fixture-impetigo', ground_truth: 'impetigo', modality: 'clinical photo', subject: 'Dermatology', body_part: 'skin' };
const palmQuestion = { stem: 'The image shows lesions on the palm.', questionText: 'What is the diagnosis?', options: [{ id: 'A', text: 'Impetigo' }], correctOption: 'A' };
expect('unsupported palm claim is rejected when bank metadata only says skin', hasUnsupportedImageDetailsClaim(palmQuestion, image), true);
expect('unsupported dorsum claim is rejected when bank metadata only says skin', hasUnsupportedImageDetailsClaim({ ...palmQuestion, stem: 'Lesions on the dorsum are shown.' }, image), true);
expect('unrecorded scan plane is rejected', hasUnsupportedImageDetailsClaim({ ...palmQuestion, stem: 'Axial brain images are shown.' }, { ...image, ground_truth: 'cerebral haemorrhage', body_part: 'brain', modality: 'MRI' }), true);
expect('unrecorded side in keyed answer is rejected', hasUnsupportedImageDetailsClaim({ ...palmQuestion, stem: 'A chest radiograph is shown.', options: [{ id: 'A', text: 'Right lower lobe pneumonia' }] }, { ...image, ground_truth: 'lobar pneumonia', body_part: 'chest', modality: 'X-ray' }), true);
expect('patient history laterality is not treated as an image claim', hasUnsupportedImageDetailsClaim({ ...palmQuestion, stem: 'The patient has left-sided weakness. A CT head is shown.' }, { ...image, ground_truth: 'cerebral haemorrhage', body_part: 'brain', modality: 'CT' }), false);
expect('bank metadata may support a specific surface', hasUnsupportedImageDetailsClaim(palmQuestion, { ...image, body_part: 'palmar hand' }), false);

const originalFetch = globalThis.fetch;
let verificationRequest;
const rejectionCodes = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/api/images/generate-question')) {
    return new Response(JSON.stringify({ question: {
      stem: 'Lesions on the palm are shown in the image.',
      questionText: 'What is the most likely diagnosis?',
      options: { A: 'Impetigo', B: 'Scabies', C: 'Tinea', D: 'Eczema' },
      correctOption: 'A',
    } }));
  }
  if (String(url).includes('/api/images/verify')) {
    verificationRequest = JSON.parse(init.body);
    return new Response(JSON.stringify({ pass: false, reason: 'Image shows the dorsum, not the palm.' }));
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

try {
  const imageRecord = {
    image_id: 'fixture-impetigo', source: 'Wikimedia Commons',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:fixture',
    imageUrl: 'https://upload.wikimedia.org/fixture.jpg', previewUrl: '/api/images/proxy?u=fixture',
    licence: 'Public domain', licenceUrl: 'https://commons.wikimedia.org/wiki/File:fixture',
    attribution: 'Test creator', ground_truth: 'impetigo', modality: 'clinical photo', subject: 'Dermatology', body_part: 'skin',
  };
  const opts = { exam: 'INI_CET', difficultyTier: 'MEDIUM', optionCount: 4 };
  const blocked = await generateImageFirstQuestion({ image: imageRecord, ...opts, onReject: (code) => rejectionCodes.push(code) });
  expect('unsupported skin-surface detail rejects before vision call', blocked, null);
  expect('unsupported detail code is reported', rejectionCodes, ['unsupported-skin-surface']);
  expect('unsupported detail does not reach verifier', verificationRequest, undefined);

  rejectionCodes.length = 0;
  verificationRequest = undefined;
  const checked = await generateImageFirstQuestion({ image: { ...imageRecord, body_part: 'palmar hand' }, ...opts, onReject: (code) => rejectionCodes.push(code) });
  expect('question is rejected when final vision check fails', checked, null);
  expect('vision rejection category is reported', rejectionCodes, ['vision-rejected']);
  expect('verification receives exact generated stem', verificationRequest?.questionStem, 'Lesions on the palm are shown in the image.');
  expect('verification receives question text', verificationRequest?.questionText, 'What is the most likely diagnosis?');
  expect('verification receives keyed answer', verificationRequest?.correctAnswer, 'Impetigo');
  expect('verification receives image explanation', verificationRequest?.explanation, '');
  expect('verification receives trusted body-part metadata', verificationRequest?.bodyPart, 'palmar hand');
  expect('trusted finding remains the verifier claim', verificationRequest?.claim, 'impetigo (clinical photo)');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(failures ? `${failures} FAILED` : 'all image-first consistency checks passed');
process.exit(failures ? 1 : 0);
