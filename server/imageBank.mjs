// Curated clinical-image bank (image-first pipeline, step 1).
//
// Why a bank instead of a live search per question: a live keyword search decides the
// picture AFTER the question exists, which produced unrelated images. Here each entry
// carries TRUSTED metadata (diagnosis / finding, modality, subject) harvested from
// Public Domain/CC0 sources, so the question can be written FROM a known image.
//
// The bank is built once (harvest) and persisted to disk, then read offline. Re-running
// the harvest merges by image_id and never duplicates.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { searchImages, reusableLicense } from './images.mjs';

const DATA_ROOT = process.env.PULSE_DATA_DIR || join(homedir(), '.pulse-med');
const BANK_DIR = join(DATA_ROOT, 'image-bank');
const BANK_FILE = join(BANK_DIR, 'bank.json');

/** Promisified delay, used to space out harvest calls so we don't get rate-limited. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Curated seeds: high-yield, visually distinctive findings across the six core
 * subjects and the modalities that appear in exams. Keep `query` short and lead with
 * the finding so the upstream search has the best chance of a clean match.
 */
export const SEED_TOPICS = [
  // ---- Radiology ----
  { subject: 'Radiology', modality: 'X-ray', ground_truth: 'lobar pneumonia', query: 'lobar pneumonia chest x-ray' },
  { subject: 'Radiology', modality: 'X-ray', ground_truth: 'pneumothorax', query: 'pneumothorax chest x-ray' },
  { subject: 'Radiology', modality: 'X-ray', ground_truth: 'pulmonary tuberculosis with cavity', query: 'cavitary pulmonary tuberculosis x-ray' },
  { subject: 'Radiology', modality: 'X-ray', ground_truth: 'femoral neck fracture', query: 'femoral neck fracture x-ray' },
  { subject: 'Radiology', modality: 'X-ray', ground_truth: 'rib fracture', query: 'rib fracture chest x-ray' },
  { subject: 'Radiology', modality: 'CT', ground_truth: 'cerebral haemorrhage', query: 'intracerebral haemorrhage CT' },
  { subject: 'Radiology', modality: 'CT', ground_truth: 'pancreatitis', query: 'acute pancreatitis CT' },
  { subject: 'Radiology', modality: 'CT', ground_truth: 'hydronephrosis', query: 'hydronephrosis CT' },
  { subject: 'Radiology', modality: 'MRI', ground_truth: 'meningioma', query: 'meningioma MRI brain' },
  { subject: 'Radiology', modality: 'MRI', ground_truth: 'lumbar disc herniation', query: 'lumbar disc herniation MRI' },
  { subject: 'Radiology', modality: 'ultrasound', ground_truth: 'acute cholecystitis with gallstones', query: 'gallstones ultrasound' },
  { subject: 'Radiology', modality: 'ultrasound', ground_truth: 'hydatid liver cyst', query: 'liver cyst ultrasound' },
  // ---- Cardiology (ECG) ----
  { subject: 'Cardiology', modality: 'ECG', ground_truth: 'atrial fibrillation', query: 'atrial fibrillation ECG' },
  { subject: 'Cardiology', modality: 'ECG', ground_truth: 'ventricular tachycardia', query: 'ventricular tachycardia ECG' },
  { subject: 'Cardiology', modality: 'ECG', ground_truth: 'ST elevation myocardial infarction', query: 'ST elevation myocardial infarction ECG' },
  { subject: 'Cardiology', modality: 'ECG', ground_truth: 'complete heart block', query: 'complete heart block ECG' },
  { subject: 'Cardiology', modality: 'ECG', ground_truth: 'hyperkalaemia with peaked T waves', query: 'hyperkalemia peaked T waves ECG' },
  { subject: 'Cardiology', modality: 'ECG', ground_truth: 'Wolff-Parkinson-White syndrome', query: 'Wolff Parkinson White ECG' },
  { subject: 'Cardiology', modality: 'X-ray', ground_truth: 'cardiomegaly', query: 'cardiomegaly chest x-ray' },
  // ---- Dermatology ----
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'erythema multiforme', query: 'erythema multiforme skin' },
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'psoriasis', query: 'plaque psoriasis skin' },
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'basal cell carcinoma', query: 'basal cell carcinoma skin' },
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'herpes zoster', query: 'herpes zoster shingles skin' },
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'impetigo', query: 'impetigo skin' },
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'pemphigus vulgaris', query: 'pemphigus vulgaris skin' },
  { subject: 'Dermatology', modality: 'clinical photo', ground_truth: 'urticaria', query: 'urticaria hives skin' },
  // ---- Ophthalmology ----
  { subject: 'Ophthalmology', modality: 'fundus', ground_truth: 'papilloedema', query: 'papilloedema fundus' },
  { subject: 'Ophthalmology', modality: 'fundus', ground_truth: 'diabetic retinopathy', query: 'diabetic retinopathy fundus' },
  { subject: 'Ophthalmology', modality: 'fundus', ground_truth: 'central retinal artery occlusion with cherry-red spot', query: 'central retinal artery occlusion fundus' },
  { subject: 'Ophthalmology', modality: 'fundus', ground_truth: 'retinitis pigmentosa', query: 'retinitis pigmentosa fundus' },
  { subject: 'Ophthalmology', modality: 'clinical photo', ground_truth: 'cataract', query: 'cataract eye' },
  { subject: 'Ophthalmology', modality: 'clinical photo', ground_truth: 'conjunctivitis', query: 'bacterial conjunctivitis eye' },
  // ---- Pathology / histology ----
  { subject: 'Pathology', modality: 'histology', ground_truth: 'membranous nephropathy', query: 'membranous nephropathy histology' },
  { subject: 'Pathology', modality: 'histology', ground_truth: 'acute appendicitis', query: 'acute appendicitis histology' },
  { subject: 'Pathology', modality: 'histology', ground_truth: 'squamous cell carcinoma', query: 'squamous cell carcinoma histology' },
  { subject: 'Pathology', modality: 'histology', ground_truth: 'tuberculous granuloma with caseation', query: 'tuberculous granuloma histology' },
  { subject: 'Pathology', modality: 'histology', ground_truth: 'chronic gastritis with H. pylori', query: 'Helicobacter pylori gastritis histology' },
  { subject: 'Pathology', modality: 'histology', ground_truth: 'cirrhosis', query: 'liver cirrhosis histology' },
  // ---- Orthopaedics ----
  { subject: 'Orthopaedics', modality: 'X-ray', ground_truth: 'Colles fracture', query: 'Colles fracture x-ray wrist' },
  { subject: 'Orthopaedics', modality: 'X-ray', ground_truth: 'tibial shaft fracture', query: 'tibia fracture x-ray' },
  { subject: 'Orthopaedics', modality: 'X-ray', ground_truth: 'osteoarthritis of the knee', query: 'knee osteoarthritis x-ray' },
  { subject: 'Orthopaedics', modality: 'X-ray', ground_truth: 'shoulder dislocation', query: 'anterior shoulder dislocation x-ray' },
  { subject: 'Orthopaedics', modality: 'MRI', ground_truth: 'anterior cruciate ligament tear', query: 'anterior cruciate ligament tear MRI' },
];

/**
 * Read every entry in the bank file, including ones whose licence is not reusable. Use this only to REWRITE the file:
 * writing back a licence-filtered list silently deletes the entries that were filtered out. (Never throws.)
 */
function readRawBankFile() {
  try {
    if (!existsSync(BANK_FILE)) return { entries: [], builtAt: null };
    const parsed = JSON.parse(readFileSync(BANK_FILE, 'utf8'));
    const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : [];
    return { entries: rawEntries.filter((entry) => entry && typeof entry.image_id === 'string'), builtAt: parsed?.builtAt ?? null };
  } catch {
    return { entries: [], builtAt: null };
  }
}

/** Read the bank for USE (queries, stats, tutor): only entries with a reusable CC0 or public-domain licence. Never throws. */
function readBankFile() {
  const raw = readRawBankFile();
  const entries = raw.entries.flatMap((entry) => {
    const license = reusableLicense(entry.licence, entry.licenceUrl);
    return license ? [{ ...entry, licence: license.label, licenceUrl: entry.licenceUrl || license.url }] : [];
  });
  return { entries, builtAt: raw.builtAt };
}

function writeBankFile(entries, builtAt) {
  mkdirSync(BANK_DIR, { recursive: true });
  // Write a temporary file and rename it over the bank: a crash mid-write leaves the old complete file in place.
  const tmp = `${BANK_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ builtAt, entries }, null, 2), 'utf8');
  renameSync(tmp, BANK_FILE);
}

// ---------------------------------------------------------------------------
// Rejection memory. Melting the bank is cheap by comparison with vision calls:
// each candidate costs a slow model round-trip, so an image the verifier already
// rejected must never be tried again on the next run. We remember the failures
// on disk and skip them forever.
// ---------------------------------------------------------------------------
const REJECT_FILE = join(BANK_DIR, 'rejected.json');

/** Read the set of image ids the verifier has already rejected. Never throws. */
export function loadRejected() {
  try {
    if (!existsSync(REJECT_FILE)) return new Map();
    const parsed = JSON.parse(readFileSync(REJECT_FILE, 'utf8'));
    const rows = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return new Map(rows.filter((r) => r && typeof r.image_id === 'string').map((r) => [r.image_id, r]));
  } catch {
    return new Map();
  }
}

/**
 * Record that an image failed verification against its claimed finding, with the
 * reason. Called from the generation path, so the same bad image is not retried.
 */
export function rejectImage(image_id, ground_truth, reason) {
  if (!image_id) return;
  try {
    const all = loadRejected();
    all.set(image_id, {
      image_id,
      ground_truth: ground_truth || '',
      reason: String(reason || '').slice(0, 200),
      rejectedAt: new Date().toISOString(),
    });
    mkdirSync(BANK_DIR, { recursive: true });
    writeFileSync(REJECT_FILE, JSON.stringify({ entries: [...all.values()] }, null, 2), 'utf8');
  } catch {
    /* best-effort only — never let bookkeeping break generation */
  }
}

/** Drop rejected entries from the bank and return how many were removed. */
function pruneRejected() {
  const rejected = loadRejected();
  if (rejected.size === 0) return 0;
  const current = readRawBankFile();
  const kept = current.entries.filter((e) => !rejected.has(e.image_id));
  const removed = current.entries.length - kept.length;
  if (removed > 0) {
    writeBankFile(kept, current.builtAt);
    // Keep the rejection log bounded to what is still relevant.
    try {
      writeFileSync(REJECT_FILE, JSON.stringify({ entries: [...rejected.values()].slice(-500) }, null, 2), 'utf8');
    } catch { /* best-effort */ }
  }
  return removed;
}

/** Read the persisted bank ([] when absent). Never throws. */
export function loadImageBank() {
  return readBankFile().entries;
}

/** Best-effort body part from the finding/query text (used for metadata display only). */
function guessBodyPart(text) {
  const t = String(text || '').toLowerCase();
  const map = [
    [/chest|lung|pulmonary|thorax|pneumo/, 'chest'],
    [/brain|cerebr|intracran|mening|head/, 'brain'],
    [/knee|femur|tibia|hip|shoulder|wrist|bone|fracture|dislocat|osteo/, 'musculoskeletal'],
    [/kidney|renal|nephro|urinary|hydronephro/, 'kidney'],
    [/liver|hepato|biliary|gallbladder|gallstone|cholecyst/, 'hepatobiliary'],
    [/skin|derm|cutaneous|rash|lesion/, 'skin'],
    [/eye|retina|fundus|optic|cornea|conjunctiva|cataract/, 'eye'],
    [/heart|cardiac|myocard|ecg|arrhythm/, 'heart'],
    [/stomach|gastr|colon|bowel|append|intestin/, 'gastrointestinal'],
    [/pancrea/, 'pancreas'],
  ];
  for (const [re, part] of map) if (re.test(t)) return part;
  return '';
}

/**
 * Build (or extend) the bank by running each curated seed through the existing
 * licence-filtered search, then persisting every usable row. Idempotent: entries are
 * merged by image_id.
 * @returns {Promise<{ total:number, added:number, bySubject:Record<string,number>, errors:string[] }>}
 */
export async function buildImageBank(options = {}) {
  const {
    seeds = SEED_TOPICS,
    limitPerSeed = 3,
    onProgress,
    throttleMs = 1200,
    maxAttempts = 4,
    search = searchImages,
    // Optional async (entry) => boolean. When supplied, an entry is only added if it
    // RESOLVES TRUE — used to confirm with vision that the image really shows the seed's
    // claimed finding before it enters the bank. Keyword search alone returns merely
    // "related" images (a Colles-fracture seed once matched a pseudarthrosis film), so
    // pre-verifying at harvest time is what keeps the bank trustworthy.
    verify,
  } = options;
  // House-cleaning first: entries the verifier already rejected are dropped, so a
  // rebuild does not resurrect images that are known not to show their claimed finding.
  const pruned = pruneRejected();
  const rejectionMemory = loadRejected();
  const existing = readRawBankFile();
  const byId = new Map(existing.entries.map((e) => [e.image_id, e]));
  const errors = [];
  if (pruned > 0) errors.push(`Pre-run prune: removed ${pruned} previously-rejected image(s).`);
  let added = 0;
  let rejected = 0;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    // Wikimedia Commons and Open-i rate-limit aggressive callers (HTTP 429). Space the
    // seeds out and retry 429/5xx with exponential backoff, otherwise most of a large
    // harvest is lost to throttling.
    let attempt = 0;
    let done = false;
    while (!done && attempt < maxAttempts) {
      attempt += 1;
      try {
        const { results, errors: searchErrors } = await search(seed.query, { limit: limitPerSeed });
        const throttled = (searchErrors || []).some((e) => /429|rate|too many/i.test(e));
        for (const row of results || []) {
          const license = reusableLicense(row.licence, row.licenceUrl);
          if (!row?.id || !row?.imageUrl || !license) continue;
          if (rejectionMemory.has(row.id)) {
            rejected += 1;
            continue;
          }
          if (byId.has(row.id)) continue;
          const entry = {
            image_id: row.id,
            source: row.provider || 'Unknown',
            sourceUrl: row.articleUrl || row.licenceUrl || '',
            imageUrl: row.imageUrl,
            previewUrl: row.proxyUrl || '',
            licence: license.label,
            licenceUrl: row.licenceUrl || license.url,
            attribution: row.credit || '',
            ground_truth: seed.ground_truth,
            modality: seed.modality,
            subject: seed.subject,
            body_part: guessBodyPart(`${seed.ground_truth} ${seed.query}`),
            addedAt: new Date().toISOString(),
          };
          // When a verifier is supplied, an image only joins the bank if it is CONFIRMED
          // to show the claimed finding — otherwise it is discarded here rather than
          // wasting a full generation call (and a fallback) later.
          if (typeof verify === 'function') {
            let ok = false;
            try { ok = (await verify(entry)) === true; } catch { ok = false; }
            if (!ok) {
              rejected += 1;
              continue;
            }
            entry.verifiedAt = new Date().toISOString();
          }
          byId.set(row.id, entry);
          added += 1;
        }
        if (throttled && !(results || []).length && attempt < maxAttempts) {
          await sleep(throttleMs * 2 ** attempt);
          continue; // retry this seed after backing off
        }
        if (throttled) for (const err of searchErrors) errors.push(`${seed.query}: ${err}`);
        done = true;
      } catch (err) {
        const msg = err?.message || String(err);
        if (/429|rate|too many/i.test(msg) && attempt < maxAttempts) {
          await sleep(throttleMs * 2 ** attempt);
          continue;
        }
        errors.push(`${seed.query}: ${msg}`);
        done = true;
      }
    }
    if (i < seeds.length - 1) await sleep(throttleMs);
    if (typeof onProgress === 'function') onProgress(i + 1, seeds.length, added);
  }

  const entries = [...byId.values()];
  const builtAt = new Date().toISOString();
  writeBankFile(entries, builtAt);

  const bySubject = {};
  for (const e of entries) bySubject[e.subject] = (bySubject[e.subject] || 0) + 1;
  return { total: entries.length, added, rejected, bySubject, errors };
}

/**
 * Pick bank entries for a subject and/or modality (shuffled within the result).
 *
 * Images the verifier previously rejected are skipped: the bank is cheap, vision calls
 * are not, so a known-bad image must never be offered again.
 */
export function queryImageBank({ subject, modality, limit = 6, includeRejected = false } = {}) {
  const rejected = includeRejected ? new Map() : loadRejected();
  let rows = loadImageBank().filter((e) => !rejected.has(e.image_id));
  if (subject) rows = rows.filter((e) => e.subject === subject);
  if (modality) {
    const m = String(modality).toLowerCase();
    rows = rows.filter((e) => String(e.modality || '').toLowerCase().includes(m));
  }
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(0, Math.max(0, limit));
}

/**
 * Free-text lookup used when an explanation asks for a figure ("this would be clearer with
 * a chest X-ray of a pneumothorax"). The bank is small and every entry carries a trusted
 * `ground_truth`, so a simple token-overlap score over the trusted fields is enough — and
 * importantly it never invents an image: no overlap means no candidates, not a best guess.
 *
 * Callers MUST still vision-verify the winner; this only narrows the shortlist.
 */
export function bankTopicScore(entry, query) {
  const queryTokens = new Set(topicWords(query));
  if (!queryTokens.size) return 0;
  const diagnosisTokens = new Set(topicWords(entry.ground_truth));
  const bodyTokens = new Set(topicWords(`${entry.body_part || ''} ${entry.ground_truth || ''}`));
  const modalityTokens = new Set(topicWords(entry.modality));
  const modalities = MODALITY_GROUPS.filter((group) => group.some((token) => queryTokens.has(token)));
  const bodyParts = BODY_PART_GROUPS.filter((group) => group.some((token) => queryTokens.has(token)));
  const diagnosticTerms = [...queryTokens].filter((token) =>
    !STOPWORDS.has(token) && !TOPIC_NOISE.has(token) &&
    !MODALITY_GROUPS.some((group) => group.includes(token)) &&
    !BODY_PART_GROUPS.some((group) => group.includes(token)),
  );

  if (diagnosticTerms.length) {
    const matched = diagnosticTerms.filter((token) => diagnosisTokens.has(token)).length;
    const coverage = matched / diagnosticTerms.length;
    if (coverage < 0.75) return 0;
    if (modalities.some((group) => !group.some((token) => modalityTokens.has(token)))) return 0;
    if (bodyParts.some((group) => !group.some((token) => bodyTokens.has(token)))) return 0;
    return coverage;
  }

  if (!modalities.length || !bodyParts.length) return 0;
  if (modalities.some((group) => !group.some((token) => modalityTokens.has(token)))) return 0;
  if (bodyParts.some((group) => !group.some((token) => bodyTokens.has(token)))) return 0;
  return 1;
}

function topicWords(value) {
  return String(value || '').toLowerCase().replace(/x[\s-]?ray/g, ' xray ').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
}

const MODALITY_GROUPS = [
  ['xray', 'radiograph', 'radiography'],
  ['ecg', 'ekg', 'electrocardiogram', 'electrocardiograph'],
  ['ct', 'computed', 'tomography'],
  ['mri', 'magnetic', 'resonance'],
  ['ultrasound', 'sonography', 'sonogram'],
  ['histology', 'histological', 'histopathology', 'biopsy', 'micrograph'],
  ['fundus', 'fundal', 'retina'],
];
const BODY_PART_GROUPS = [
  ['chest', 'lung', 'lungs', 'pulmonary', 'thorax'],
  ['brain', 'cerebral', 'intracranial', 'head'],
  ['knee', 'femur', 'tibia', 'hip', 'shoulder', 'wrist', 'bone', 'musculoskeletal'],
  ['kidney', 'renal', 'nephro', 'urinary'],
  ['liver', 'hepato', 'biliary', 'gallbladder', 'pancreas'],
  ['skin', 'derm', 'cutaneous', 'rash'],
  ['eye', 'retina', 'fundus', 'optic', 'cornea', 'conjunctiva'],
  ['heart', 'cardiac', 'myocard', 'cardiology'],
  ['stomach', 'gastr', 'colon', 'bowel', 'append', 'intestin'],
];
const TOPIC_NOISE = new Set(['acute', 'chronic', 'severe', 'mild', 'classic', 'typical', 'condition', 'disease', 'finding', 'findings', 'image', 'images', 'picture', 'pictures', 'photo', 'photograph', 'clinical', 'showing', 'shows', 'with', 'from', 'the', 'of', 'and', 'for', 'in', 'on', 'a', 'an']);

/** Trusted-metadata shortlist for a cue; diagnosis agreement is required when a diagnosis is named. */
export function searchBankByText(query, { subject, limit = 4 } = {}) {
  const queryTokens = topicWords(query);
  if (!queryTokens.length) return [];
  const rejected = loadRejected();
  const rows = loadImageBank().filter((entry) => !rejected.has(entry.image_id));
  const wantedSubject = subject ? String(subject).toLowerCase() : '';
  return rows
    .map((entry) => {
      const relevance = bankTopicScore(entry, query);
      const subjectBonus = wantedSubject && String(entry.subject || '').toLowerCase() === wantedSubject ? 0.01 : 0;
      return { entry, score: relevance + subjectBonus };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ entry }) => entry);
}

/** Common words that carry no diagnostic signal in a cue. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'image', 'picture', 'photo', 'show', 'shows',
  'showing', 'helpful', 'would', 'clear', 'clearer', 'need', 'needs', 'see', 'view', 'best',
  'classic', 'typical', 'case', 'patient', 'clinical', 'illustration', 'diagram', 'figure',
]);

/** One entry by image_id, or null. */
export function getBankImage(imageId) {
  const id = String(imageId || '');
  if (!id) return null;
  return loadImageBank().find((e) => e.image_id === id) || null;
}

/** Summary statistics for a settings/status panel. */
export function bankStats() {
  const { entries, builtAt } = readBankFile();
  const bySubject = {};
  const byModality = {};
  for (const e of entries) {
    bySubject[e.subject] = (bySubject[e.subject] || 0) + 1;
    byModality[e.modality] = (byModality[e.modality] || 0) + 1;
  }
  return { total: entries.length, bySubject, byModality, builtAt };
}
