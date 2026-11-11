// Deterministic checks for image-only candidate selection and its verified-image gate.
//   node --import tsx tools/quality/image-only.test.mjs
import { imageBankSubjectsForLabels, selectImageBankCandidates, selectVerifiedImageQuestions, unsupportedImageDetailCode } from '../../src/lib/imageFirst.ts';

let failures = 0;
const expect = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};
const image = (image_id, ground_truth, subject) => ({ image_id, ground_truth, subject });

expect(
  'selected imaging specialties map to bank taxonomy',
  imageBankSubjectsForLabels(['Radiodiagnosis & Radiotherapy', 'Dermatology & Venereology', 'Pharmacology', 'Pathology']),
  ['Radiology', 'Dermatology', 'Pathology'],
);
expect('unsupported subjects do not broaden image search', imageBankSubjectsForLabels(['General Medicine', 'Pharmacology']), []);

const first = image('r1', 'pneumothorax', 'Radiology');
const duplicate = image('r2', 'pneumothorax', 'Radiology');
const next = image('d1', 'melanoma', 'Dermatology');
expect('bank candidates prefer unique diagnoses before alternate images', selectImageBankCandidates([[first, duplicate], [next]], 3).map((entry) => entry.image_id), ['r1', 'd1', 'r2']);
expect('no candidates remains empty', selectImageBankCandidates([[], []], 10), []);

const verified = { question: { image: '/verified.jpg', imageVerified: true }, verification: { pass: true, reason: 'Verified' } };
const textOnly = { question: { stem: 'text only', imageVerified: false }, verification: { pass: false, reason: 'Failed' } };
const unmarked = { question: { image: '/unverified.jpg' }, verification: { pass: true, reason: 'Verified' } };
expect('only questions with verified images enter the image-only set', selectVerifiedImageQuestions([verified, null, textOnly, unmarked], 10), [verified.question]);
expect('verified image results stop at the requested count', selectVerifiedImageQuestions([verified, { ...verified, question: { image: '/second.jpg', imageVerified: true } }], 1), [verified.question]);

const planeQuestion = (stem) => ({ stem, questionText: 'What is the most likely finding?', options: [{ id: 'A', text: 'Finding' }], correctOption: 'A' });
const ctBrain = { ground_truth: 'intracranial hemorrhage', body_part: 'brain', modality: 'CT' };
const mriSpine = { ground_truth: 'spinal stenosis', body_part: 'spine', modality: 'MRI' };
expect('CT brain convention supports axial plane', unsupportedImageDetailCode(planeQuestion('What does this axial CT show?'), ctBrain), null);
expect('MRI spine convention supports sagittal plane', unsupportedImageDetailCode(planeQuestion('What is seen on this sagittal MRI?'), mriSpine), null);
expect('CT brain convention does not support coronal plane', unsupportedImageDetailCode(planeQuestion('What does this coronal CT show?'), ctBrain), 'scan-plane');
expect('unrelated study metadata still cannot support a plane', unsupportedImageDetailCode(planeQuestion('What is seen on this sagittal CT?'), ctBrain), 'scan-plane');
expect('explicit plane metadata remains supported', unsupportedImageDetailCode(planeQuestion('What does this coronal image show?'), { ...ctBrain, modality: 'coronal CT' }), null);
expect('plane inference does not weaken laterality checks', unsupportedImageDetailCode(planeQuestion('What does this axial CT of the right brain show?'), ctBrain), 'laterality');
expect('routine CT brain supports non-contrast phase', unsupportedImageDetailCode(planeQuestion('What does this non-contrast CT of the brain show?'), ctBrain), null);
expect('CT brain does not support contrast-enhanced phase', unsupportedImageDetailCode(planeQuestion('What does this contrast-enhanced CT of the brain show?'), ctBrain), 'contrast-phase');
expect('laterality without side metadata remains unsupported', unsupportedImageDetailCode(planeQuestion('What does this right-sided chest X-ray show?'), { ground_truth: 'pneumothorax', body_part: 'chest', modality: 'X-ray' }), 'laterality');
expect('laterality stated in trusted metadata is supported', unsupportedImageDetailCode(planeQuestion('What does this right-sided chest X-ray show?'), { ground_truth: 'right pneumothorax', body_part: 'chest', modality: 'X-ray' }), null);
expect('skin surface without metadata remains unsupported', unsupportedImageDetailCode(planeQuestion('What is the diagnosis from these palmar lesions?'), { ground_truth: 'psoriasis', body_part: 'skin', modality: 'clinical photo' }), 'skin-surface');
expect('skin surface stated in metadata is supported', unsupportedImageDetailCode(planeQuestion('What is the diagnosis from these palmar lesions?'), { ground_truth: 'palmar psoriasis', body_part: 'skin', modality: 'clinical photo' }), null);

console.log(failures ? `${failures} FAILED` : 'all image-only checks passed');
process.exit(failures ? 1 : 0);
