// Offline picture hit rate: no model calls. Asks the picture search for 60 typical exam pictures and reports how many
// queries return a candidate whose own title or caption names the condition, and how long that took.
//   node tools/quality/image-hitrate.mjs [--old]   (--old skips the article and category sources, for comparison)
import { searchImages } from '../../server/images.mjs';

const QUERIES = [
  'tetralogy of Fallot chest X-ray', 'atrial fibrillation ECG', 'ST elevation myocardial infarction ECG', 'pericarditis ECG', 'lobar pneumonia chest X-ray',
  'pneumothorax chest X-ray', 'pleural effusion chest X-ray', 'miliary tuberculosis chest X-ray', 'coagulative necrosis histology', 'caseous necrosis histology',
  'fat necrosis histology', 'fibrinoid necrosis histology', 'membranous nephropathy histology', 'minimal change disease histology', 'focal segmental glomerulosclerosis histology',
  'diabetic retinopathy fundus', 'papilledema fundus', 'retinitis pigmentosa fundus', 'central retinal artery occlusion fundus', 'glaucoma optic disc cupping',
  'peripheral smear iron deficiency anaemia', 'sickle cell anaemia peripheral smear', 'malaria Plasmodium falciparum smear', 'chronic myeloid leukaemia smear', 'megaloblastic anaemia smear',
  'psoriasis clinical photo', 'vitiligo clinical photo', 'pemphigus vulgaris clinical photo', 'erythema nodosum clinical photo', 'herpes zoster clinical photo',
  'Erb palsy clinical photo', 'Klumpke palsy', 'wrist drop radial nerve palsy', 'foot drop common peroneal nerve', 'cleft lip and palate',
  'Colles fracture X-ray', 'supracondylar fracture humerus X-ray', 'scaphoid fracture X-ray', 'osteosarcoma X-ray', 'Ewing sarcoma X-ray',
  'acute appendicitis CT', 'intussusception ultrasound', 'gallstones ultrasound', 'hydronephrosis ultrasound', 'ectopic pregnancy ultrasound',
  'subdural haematoma CT', 'epidural haematoma CT', 'ischaemic stroke MRI', 'glioblastoma MRI', 'pituitary adenoma MRI',
  'Kayser-Fleischer ring', 'goitre clinical photo', 'Graves ophthalmopathy', 'acromegaly facies', 'Cushing syndrome facies',
  'neurofibromatosis clinical photo', 'Down syndrome facies', 'rickets clinical photo', 'kwashiorkor', 'scurvy gingivitis',
];

const old = process.argv.includes('--old');
const GENERIC = new Set(['histology', 'histological', 'ecg', 'ekg', 'x-ray', 'xray', 'radiograph', 'ct', 'mri', 'ultrasound', 'smear', 'peripheral', 'fundus', 'photo', 'photograph', 'clinical', 'image', 'picture', 'disease', 'syndrome', 'acute', 'chronic']);
let found = 0;
let relevant = 0;
let totalMs = 0;
const misses = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  let rows = [];
  try { rows = (await searchImages(q, { limit: 10, noExtra: old })).results; } catch { rows = []; }
  const ms = Date.now() - t0;
  totalMs += ms;
  const tokens = q.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
  const need = Math.max(1, Math.ceil(tokens.length * 0.6));
  const hit = rows.find((r) => tokens.filter((t) => `${r.title} ${r.caption}`.toLowerCase().includes(t)).length >= need);
  if (rows.length) found += 1;
  if (hit) relevant += 1; else misses.push(`${q} (${rows.length} rows)`);
  process.stdout.write(`${hit ? 'OK  ' : 'MISS'} ${String(ms).padStart(5)}ms ${q}${hit ? ' -> ' + hit.provider + ': ' + hit.title.slice(0, 50) : ''}\n`);
}
console.log(`\nany candidate: ${found}/${QUERIES.length}; candidate naming the condition: ${relevant}/${QUERIES.length} (${Math.round(100 * relevant / QUERIES.length)}%); average ${Math.round(totalMs / QUERIES.length)} ms`);
console.log('misses:', misses.join(' | '));
process.exit(0);
