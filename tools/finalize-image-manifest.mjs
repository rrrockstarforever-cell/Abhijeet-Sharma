// Finalise the clinical image library: verified flag + hand-written exam captions.
// Every entry below was checked visually against its diagnosis (contact sheet review).
//   node tools/finalize-image-manifest.mjs
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'medical-images');
const manifestPath = join(dir, 'manifest.json');

const captions = {
  'ecg-anterior-stemi':
    '12-lead ECG: marked ST elevation in V1–V5 with reciprocal ST depression — acute anterior STEMI.',
  'ecg-atrial-fibrillation':
    '12-lead ECG: rapid, irregularly irregular rhythm with no discrete P waves — atrial fibrillation with a rapid ventricular response.',
  'ecg-ventricular-tachycardia':
    '12-lead ECG: broad-complex regular tachycardia at about 160/min — monomorphic ventricular tachycardia.',
  'ecg-hyperkalaemia':
    '12-lead ECG: tall, peaked T waves (best seen in V2–V4) — hyperkalaemia.',
  'cxr-pneumothorax':
    'Erect chest radiograph: right-sided pneumothorax with a visible pleural line and absent peripheral lung markings.',
  'cxr-lobar-pneumonia':
    'Composite figure: chest radiograph and CT slices showing left lower lobe consolidation — lobar pneumonia.',
  'cxr-pleural-effusion':
    'Chest radiograph: large right-sided pleural effusion; the arrows mark the depth of the effusion.',
  'cxr-tuberculosis':
    'Chest radiograph: bilateral upper-zone fibrosis and cavitation — pulmonary tuberculosis.',
  'ct-ischaemic-stroke':
    'Non-contrast CT brain: large right middle-cerebral-artery territory hypodensity with mass effect — ischaemic stroke.',
  'us-acute-cholecystitis':
    'Ultrasound: thick-walled gallbladder containing stones (arrows) — acute cholecystitis.',
  'histology-hodgkin-lymphoma':
    'H&E lymph-node histology: scattered large binucleate Reed–Sternberg cells in a mixed inflammatory background — classic Hodgkin lymphoma.',
  'histology-tuberculosis-granuloma':
    'Lung histology: multiple well-formed granulomas with giant cells and central necrosis — tuberculosis.',
  'clinical-graves-exophthalmos':
    'Clinical photo: bilateral proptosis with lid retraction — Graves orbitopathy (thyroid eye disease).',
  'clinical-herpes-zoster':
    'Clinical photo: grouped vesicles on an erythematous base in a dermatomal distribution — herpes zoster.',
  'clinical-psoriasis':
    'Clinical plate: well-demarcated scaly plaques on the hands — psoriasis.',
  'fundus-diabetic-retinopathy':
    'Fundus photo: dot-blot haemorrhages with panretinal laser scars — treated proliferative diabetic retinopathy.',
  'fundus-papilloedema':
    'Fundus photo: swollen optic disc with blurred margins and obscured vessels — papilloedema.',
  'xray-colles-fracture':
    'Wrist radiographs: distal radius fracture with dorsal angulation — Colles fracture.',
  'xray-osteoarthritis-knee':
    'Knee radiograph: joint-space narrowing, subchondral sclerosis and marginal osteophytes — osteoarthritis.',
  'xray-pneumoperitoneum':
    'Chest radiograph and axial CT: free gas under the diaphragm — pneumoperitoneum from a perforated viscus.',
  'ct-pneumoperitoneum':
    'Chest radiograph and axial CT: free gas under the diaphragm — pneumoperitoneum from a perforated viscus.',
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let verified = 0;

for (const entry of manifest) {
  // The pneumoperitoneum picture was filed under a "ct-" id although it leads with an X-ray.
  if (entry.id === 'ct-pneumoperitoneum') {
    const oldFile = join(dir, entry.file);
    const newFile = join(dir, 'xray-pneumoperitoneum.png');
    if (existsSync(oldFile) && !existsSync(newFile)) renameSync(oldFile, newFile);
    entry.id = 'xray-pneumoperitoneum';
    entry.file = 'xray-pneumoperitoneum.png';
    entry.modality = 'X-ray';
  }
  const caption = captions[entry.id];
  if (caption) {
    entry.caption = caption;
    entry.verified = true;
    verified += 1;
  } else {
    entry.verified = false;
  }
  delete entry.bytes;
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`verified ${verified}/${manifest.length} entries`);
