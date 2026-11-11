// Benchmark: compares a generated question set with reference banks (mock and previous-year
// papers). Deterministic only: no model calls, so a result is reproducible and free to rerun.
// It measures style and mix, not clinical correctness; that stays with the QA pipeline and a
// human reviewer.
import type { ClinicalQuestion } from '../types.ts';
import type { BankQuestion } from '../utils/questionBankDB.ts';

export interface BenchItem {
  stem: string; // vignette plus question line
  options: string[];
  correctIndex: number;
  subject: string;
}

export interface SetProfile {
  n: number;
  medianStemWords: number;
  pctVignette: number;
  pctNegative: number;
  pctMultiStatement: number;
  pctLongestIsKey: number;
  meanOptionCount: number;
  medianOptionSpread: number;
  subjects: Set<string>;
}

export interface MetricRow {
  metric: string;
  generated: string;
  reference: string;
  flag: boolean;
  note: string;
}

export interface DuplicateHit {
  generatedStem: string;
  referenceStem: string;
  similarity: number;
}

export interface BenchReport {
  verdict: 'empty' | 'insufficient-reference' | 'needs-work' | 'close-to-reference';
  generatedCount: number;
  referenceCount: number;
  rows: MetricRow[];
  duplicates: DuplicateHit[];
}

/** Below this many reference items the proportions are too noisy to judge a set against. */
export const MIN_REFERENCE = 30;
/** Two stems sharing at least this share of content words are treated as the same item. */
export const DUPLICATE_SIMILARITY = 0.6;

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'was', 'were', 'that', 'this', 'which', 'what', 'following', 'statement',
  'statements', 'correct', 'regarding', 'is', 'are', 'of', 'in', 'a', 'an', 'to', 'on', 'at', 'by', 'from',
  'as', 'be', 'has', 'have', 'had', 'about', 'most', 'likely', 'patient', 'year', 'old', 'only',
]);

export function toBenchItem(q: ClinicalQuestion): BenchItem {
  const raw = (q.stem || '').trim();
  const line = (q.questionText || q.question || '').trim();
  const stem = [raw && raw !== line ? raw : '', line].filter(Boolean).join(' ');
  return {
    stem,
    options: (q.options || []).map((o) => o.text.trim()),
    correctIndex: Math.max(0, LETTERS.indexOf(q.correctOption)),
    subject: q.subject || 'Unknown',
  };
}

export function fromBankQuestion(q: BankQuestion): BenchItem {
  return {
    stem: (q.question || '').trim(),
    options: (q.options || []).map((o) => String(o).trim()),
    correctIndex: Math.max(0, q.answerIndex ?? 0),
    subject: q.subject || 'Unknown',
  };
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const share = (count: number, total: number) => (total ? (100 * count) / total : 0);

/** Subject labels differ between sources ("Pharmacology", "pharmacology", "Anaesthesia & ICU"). */
export const normalizeSubject = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Above this share of items with the longest option as the key, the set is a giveaway even with no reference. */
export const GIVEAWAY_ABSOLUTE = 40;

const VIGNETTE_AGE = /\b\d{1,3}[\s-]*(year|yr)s?[\s-]*old\b|\b\d{1,3}[\s-]?(y\/o|yo)\b/i;
const NEGATIVE_CAPS = /\b(EXCEPT|NOT|LEAST)\b/;
const NEGATIVE_WORDS = /\b(except|false|incorrect)\b/i;
const MULTI_STATEMENT = /\b1\.\s[\s\S]*\b2\.\s/;

function isVignette(stem: string): boolean {
  return VIGNETTE_AGE.test(stem) || wordCount(stem) >= 30;
}

function isNegative(stem: string): boolean {
  return NEGATIVE_CAPS.test(stem) || NEGATIVE_WORDS.test(stem);
}

/** Longest option is strictly longer than every other and is the key: a test-wise giveaway. */
function longestIsKey(item: BenchItem): boolean {
  const lengths = item.options.map((o) => o.length);
  const max = Math.max(...lengths);
  return lengths.filter((l) => l === max).length === 1 && lengths[item.correctIndex] === max;
}

function optionSpread(item: BenchItem): number {
  const lengths = item.options.map((o) => o.length).filter((l) => l > 0);
  return lengths.length >= 2 ? Math.max(...lengths) / Math.min(...lengths) : 1;
}

export function profileSet(items: BenchItem[]): SetProfile {
  const n = items.length;
  return {
    n,
    medianStemWords: median(items.map((i) => wordCount(i.stem))),
    pctVignette: share(items.filter((i) => isVignette(i.stem)).length, n),
    pctNegative: share(items.filter((i) => isNegative(i.stem)).length, n),
    pctMultiStatement: share(items.filter((i) => MULTI_STATEMENT.test(i.stem)).length, n),
    pctLongestIsKey: share(items.filter(longestIsKey).length, n),
    meanOptionCount: n ? items.reduce((sum, i) => sum + i.options.length, 0) / n : 0,
    medianOptionSpread: median(items.map(optionSpread)),
    subjects: new Set(items.map((i) => i.subject)),
  };
}

const contentWords = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)));

/** Jaccard overlap of content words, 0 to 1. */
export function stemSimilarity(a: string, b: string): number {
  const A = contentWords(a);
  const B = contentWords(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

function nearestReference(item: BenchItem, refs: BenchItem[]): { similarity: number; ref: BenchItem | null } {
  let best = { similarity: 0, ref: null as BenchItem | null };
  for (const r of refs) {
    const s = stemSimilarity(item.stem, r.stem);
    if (s > best.similarity) best = { similarity: s, ref: r };
  }
  return best;
}

const fmt = (x: number, digits = 0) => x.toFixed(digits);

export function compareSets(generated: BenchItem[], reference: BenchItem[]): BenchReport {
  const g = profileSet(generated);
  const r = profileSet(reference);
  const rows: MetricRow[] = [];
  // Nothing is judged against a reference that is missing or too small; the values still show.
  const judge = reference.length >= MIN_REFERENCE;
  const add = (metric: string, gv: string, rv: string, flag: boolean, note: string) =>
    rows.push({ metric, generated: gv, reference: reference.length ? rv : '—', flag: judge && flag, note });

  const stemDrift = r.medianStemWords > 0 ? Math.abs(g.medianStemWords - r.medianStemWords) / r.medianStemWords : 0;
  add('Median stem length (words)', fmt(g.medianStemWords), fmt(r.medianStemWords), stemDrift > 0.4,
    'Flagged when more than 40% away from the reference.');
  add('Clinical vignettes (%)', fmt(g.pctVignette), fmt(r.pctVignette), Math.abs(g.pctVignette - r.pctVignette) > 20,
    'Flagged when more than 20 points away.');
  add('Negative stems, EXCEPT/NOT/FALSE (%)', fmt(g.pctNegative), fmt(r.pctNegative), Math.abs(g.pctNegative - r.pctNegative) > 10,
    'Flagged when more than 10 points away.');
  add('Multi-statement items (%)', fmt(g.pctMultiStatement), fmt(r.pctMultiStatement), Math.abs(g.pctMultiStatement - r.pctMultiStatement) > 20,
    'Flagged when more than 20 points away.');
  // Judged against the reference when there is one; otherwise against an absolute ceiling.
  rows.push({
    metric: 'Longest option is the key (%)',
    generated: fmt(g.pctLongestIsKey),
    reference: reference.length ? fmt(r.pctLongestIsKey) : '—',
    flag: judge ? g.pctLongestIsKey - r.pctLongestIsKey > 10 : g.pctLongestIsKey > GIVEAWAY_ABSOLUTE,
    note: judge
      ? 'Flagged when more than 10 points above the reference: a test-wise giveaway.'
      : `No reference yet, so flagged above ${GIVEAWAY_ABSOLUTE}% (four options give about 25% by chance).`,
  });
  add('Options per question', fmt(g.meanOptionCount, 1), fmt(r.meanOptionCount, 1), Math.abs(g.meanOptionCount - r.meanOptionCount) > 0.5,
    'Flagged when the mean differs by more than half an option.');
  add('Option length spread (max/min)', fmt(g.medianOptionSpread, 1), fmt(r.medianOptionSpread, 1), g.medianOptionSpread > r.medianOptionSpread * 1.5,
    'Flagged when options are more than 50% more uneven than the reference.');

  // Only compare subjects when the reference actually labels them; AMC SUCCESS has no subject field.
  const refSubjects = new Set([...r.subjects].map(normalizeSubject).filter((s) => s && s !== 'unknown'));
  if (refSubjects.size === 0) {
    rows.push({ metric: 'Subjects present in reference (%)', generated: '—', reference: '—', flag: false,
      note: 'The reference items carry no subject labels, so this cannot be checked.' });
  } else {
    const covered = generated.filter((i) => refSubjects.has(normalizeSubject(i.subject))).length;
    const coverage = share(covered, generated.length);
    add('Subjects present in reference (%)', fmt(coverage), '100', coverage < 80,
      'Flagged when under 80% of items come from a subject the reference papers do not cover.');
  }

  const duplicates: DuplicateHit[] = [];
  for (const item of generated) {
    const near = nearestReference(item, reference);
    if (near.ref && near.similarity >= DUPLICATE_SIMILARITY) {
      duplicates.push({ generatedStem: item.stem, referenceStem: near.ref.stem, similarity: near.similarity });
    }
  }
  duplicates.sort((a, b) => b.similarity - a.similarity);

  let verdict: BenchReport['verdict'];
  if (generated.length === 0) verdict = 'empty';
  else if (reference.length < MIN_REFERENCE) verdict = 'insufficient-reference';
  else if (rows.some((row) => row.flag) || duplicates.length > 0) verdict = 'needs-work';
  else verdict = 'close-to-reference';

  return { verdict, generatedCount: generated.length, referenceCount: reference.length, rows, duplicates };
}
