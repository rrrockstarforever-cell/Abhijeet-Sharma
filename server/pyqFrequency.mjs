// How often a subtopic is asked in the previous-year papers. The counts come from the PYQ bundle on this machine
// (pyq_dataset.json), so a set can follow the exam's own frequency for any topic, not a fixed table.
// If the bundle is not found, every subtopic weighs 1 and the set is spread evenly.
import fs from 'fs';
import os from 'os';
import path from 'path';

const DATASET_DIRS = [
  process.env.PYQ_DATASET_DIR,
  path.join(os.homedir(), 'OneDrive', 'Desktop', 'pyq-dataset'),
  path.join(os.homedir(), 'Desktop', 'pyq-dataset'),
].filter(Boolean);

// Exam labels in the bundle, per exam the app runs.
const EXAM_LABEL = { INI_CET: 'INI-CET', NEET_PG: 'NEET' };

// Words that name a category of the topic, not a specific thing to count.
const STOP = new Set([
  'drugs', 'drug', 'classes', 'class', 'effects', 'effect', 'adverse', 'monitoring', 'mechanism', 'mechanisms', 'therapy',
  'treatment', 'management', 'clinical', 'features', 'diagnosis', 'investigation', 'investigations', 'complications',
  'pharmacology', 'pharmacokinetics', 'resistance', 'general', 'introduction', 'overview', 'other', 'others', 'agents',
  'agent', 'with', 'from', 'their', 'uses', 'use', 'spectrum', 'activity', 'prophylaxis', 'stewardship', 'empirical',
  'first', 'second', 'third', 'fourth', 'fifth', 'generation', 'generations', 'types', 'type', 'group', 'groups',
]);

let cache = null; // { exams: { label -> [lowercase text] } }

function loadBundle() {
  if (cache) return cache;
  cache = { exams: {} };
  for (const dir of DATASET_DIRS) {
    const file = path.join(dir, 'pyq_dataset.json');
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const q of data.questions || []) {
        const label = String(q.exam || '');
        const text = `${q.question || ''} ${q.explanation || ''}`.toLowerCase();
        (cache.exams[label] ||= []).push(text);
      }
      cache.source = file;
      break;
    } catch {
      // A damaged bundle is treated as missing.
    }
  }
  return cache;
}

/** The specific names in a subtopic label, e.g. "Macrolides: erythromycin, azithromycin" -> [erythromycin, azithromycin, macrolides]. */
export function namesOf(subtopic) {
  const text = String(subtopic || '').toLowerCase().replace(/[()\[\]\/&]/g, ',').replace(/\band\b/g, ',');
  const words = text.split(/[,:;]+/).flatMap((part) => part.split(/\s+/));
  const names = new Set();
  for (const raw of words) {
    const w = raw.replace(/[^a-z-]/g, '').replace(/^-+|-+$/g, '');
    if (w.length >= 5 && !STOP.has(w)) names.add(w);
  }
  return [...names];
}

/** PYQ count for one subtopic and exam: questions that name any of its specific names. */
export function pyqCount(subtopic, exam) {
  const label = EXAM_LABEL[exam];
  if (!label) return null;
  const texts = loadBundle().exams[label];
  if (!texts) return null;
  const names = namesOf(subtopic);
  if (!names.length) return null;
  let n = 0;
  for (const t of texts) if (names.some((name) => t.includes(name))) n += 1;
  return n;
}

export function pyqWeights(subtopics, exam) {
  const out = {};
  for (const s of subtopics) {
    const n = pyqCount(s, exam);
    out[s] = n == null ? 1 : Math.max(1, n);
  }
  return out;
}

export function pyqSource() {
  return loadBundle().source || null;
}
