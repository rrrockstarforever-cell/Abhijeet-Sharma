// Topics for the 19 subjects, arranged chapter by chapter (book order); inside a chapter the most-asked come first.
// Built from the ChatGPT PYQ-updated lists by tools/build-chapter-topics.mjs. The scores and probabilities are
// ChatGPT's estimates from the PYQ files, not official numbers: show them as "predicted".
import raw from './chapterTopics.json';

export type TopicTier = 'Very high' | 'High' | 'Medium' | 'Low';
export interface TopicMeta { tier: TopicTier; score: number; pyq: number; predicted: number }
const TIERS: TopicTier[] = ['Low', 'Medium', 'High', 'Very high'];
type RawRow = [string, number, number, number, number, string?];
const DATA = raw as unknown as Record<string, [string, RawRow[]][]>;

// How the exam asks each topic (ChatGPT's note from the PYQ files), by lower-case topic name. Used to steer the question writer.
let HOW_ASKED: Map<string, string> | null = null;
export function howAskedFor(topic: string): string | undefined {
  if (!HOW_ASKED) {
    HOW_ASKED = new Map();
    for (const chapters of Object.values(DATA)) for (const [, rows] of chapters) for (const r of rows) if (r[5]) HOW_ASKED.set(r[0].toLowerCase(), r[5]);
  }
  return HOW_ASKED.get(topic.trim().toLowerCase());
}

export function hasChapterTopics(subject: string): boolean { return !!DATA[subject]; }

export function chapterTopics(subject: string): { chapter: string; topics: string[] }[] | undefined {
  const d = DATA[subject];
  return d ? d.map(([chapter, rows]) => ({ chapter, topics: rows.map((r) => r[0]) })) : undefined;
}

export function flatTopics(subject: string): string[] | undefined {
  return chapterTopics(subject)?.flatMap((c) => c.topics);
}

export function topicMeta(subject: string, topic: string): TopicMeta | undefined {
  for (const [, rows] of DATA[subject] ?? []) {
    const r = rows.find((x) => x[0] === topic);
    if (r) return { tier: TIERS[r[1]] ?? 'Medium', score: r[2], pyq: r[3], predicted: r[4] };
  }
  return undefined;
}

// ---------------------------------------------------------------- background lookup
// The database is not shown in the pickers. When a question is asked for, it is searched first; the sources and the
// AI are used after it, for whatever the database does not cover.

export interface DbTopic { topic: string; subject: string; chapter: string; score: number; tier: TopicTier; pyq: number }

const STOP = new Set(['the', 'and', 'of', 'in', 'on', 'for', 'to', 'a', 'an', 'with', 'including', 'include', 'drug', 'drugs', 'agent', 'agents', 'questions', 'question', 'mcq', 'mcqs', 'topic', 'chapter', 'about', 'related', 'all']);
const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, (m, _g, off, str) => (str.length - m.length >= 4 ? '' : m));
const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
// Words the topic names use interchangeably, so "lung cancer", "lung carcinoma" and "bronchogenic carcinoma" find one another.
const SYNONYM: Record<string, string> = { carcinoma: 'cancer', carcinomas: 'cancer', tumour: 'cancer', tumor: 'cancer', tumours: 'cancer', tumors: 'cancer', malignancy: 'cancer', malignant: 'cancer', neoplasm: 'cancer', neoplasms: 'cancer', neoplastic: 'cancer', pulmonary: 'lung', bronchogenic: 'lung', bronchial: 'lung' };
const keyTokens = (s: string): string[] => words(s).filter((w) => !STOP.has(w)).map((w) => SYNONYM[w] ?? stem(w));
const norm = (s: string) => words(s).map(stem).join(' ');

/** Topics in the database that answer a typed request, best first. Chapter titles named in the request count in full. */
export function lookupTopics(query: string, limit = 40): DbTopic[] {
  const q = norm(query);
  const keys = [...new Set(keyTokens(query))];
  if (!keys.length) return [];
  const need = Math.min(2, keys.length);
  const found = new Map<string, DbTopic & { rank: number }>();
  for (const subject of Object.keys(DATA)) {
    for (const [chapter, rows] of DATA[subject]) {
      const chapterNorm = norm(chapter);
      const chapterHit = chapterNorm.length >= 6 && (q.includes(chapterNorm) || chapterNorm.includes(q));
      for (const r of rows) {
        const topicKeys = new Set(keyTokens(r[0]));
        const overlap = keys.filter((k) => topicKeys.has(k)).length;
        if (!chapterHit && overlap < need) continue;
        const key = r[0].toLowerCase();
        const rank = (chapterHit ? 1000 : 0) + overlap * 100 + r[2];
        const prev = found.get(key);
        if (!prev || rank > prev.rank) found.set(key, { topic: r[0], subject, chapter, score: r[2], tier: TIERS[r[1]] ?? 'Medium', pyq: r[3], rank });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.rank - a.rank).slice(0, limit).map(({ rank: _rank, ...t }) => t);
}

/**
 * The same search across all specialties. The specialty with most matches is the main one and keeps most of the places;
 * every other specialty with matching topics gets a few places too, so a topic that several specialties ask
 * (lung carcinoma: Pathology, Medicine, Surgery, Radiology) is covered from each of them.
 */
export function lookupTopicsBalanced(query: string, limit = 40, perOtherSubject = 5): DbTopic[] {
  const all = lookupTopics(query, 400);
  const bySubject = new Map<string, DbTopic[]>();
  for (const t of all) bySubject.set(t.subject, [...(bySubject.get(t.subject) ?? []), t]);
  if (bySubject.size <= 1) return all.slice(0, limit);
  const ordered = [...bySubject.entries()].sort((a, b) => b[1].length - a[1].length);
  const [mainSubject, mainRows] = ordered[0];
  const others = ordered.slice(1).flatMap(([, rows]) => rows.slice(0, perOtherSubject));
  const keepOthers = others.slice(0, Math.max(0, Math.floor(limit / 2)));
  // The main specialty keeps most places but not all: with many specialties asking the topic, it is limited so the others are heard.
  const main = mainRows.slice(0, Math.max(1, Math.min(limit - keepOthers.length, 14)));
  void mainSubject;
  return [...main, ...keepOthers];
}

/** The specialty named at the start of an outside topic ("Pharmacology — EGFR inhibitors"), as the database spells it. */
export function subjectFromPrefix(topic: string): string | undefined {
  const m = topic.trim().match(/^([A-Za-z &]+?)\s*(?:—|–|:| - )\s/);
  if (!m) return undefined;
  const w = m[1].toLowerCase();
  const table: [RegExp, string][] = [
    [/^pathology$/, 'Pathology'], [/^(general )?medicine$/, 'General Medicine'], [/^(general )?surgery$/, 'General Surgery'],
    [/^radio/, 'Radiodiagnosis & Radiotherapy'], [/^pharmacology$/, 'Pharmacology'], [/^(community medicine|psm|preventive)/, 'Preventive & Social Medicine (PSM)'],
    [/^microbiology$/, 'Microbiology'], [/^anatomy$/, 'Anatomy'], [/^physiology$/, 'Physiology'], [/^biochemistry$/, 'Biochemistry'],
    [/^(obg|obstetrics)/, 'Obstetrics & Gynaecology'], [/^(pediatrics|paediatrics)$/, 'Pediatrics'], [/^ent$/, 'Oto-Rhino-Laryngology (ENT)'],
    [/^ophthalmology$/, 'Ophthalmology'], [/^dermatology/, 'Dermatology & Venereology'], [/^psychiatry$/, 'Psychiatry'],
    [/^(anaesthesia|anesthesia|anesthesiology|anaesthesiology)$/, 'Anesthesiology'], [/^forensic/, 'Forensic Medicine & Toxicology'], [/^orthop/, 'Orthopedics'],
  ];
  for (const [re, name] of table) if (re.test(w)) return name;
  return undefined;
}

let SUBJECT_OF: Map<string, string> | null = null;
/** The specialty a database topic belongs to. */
export function subjectOfTopic(topic: string): string | undefined {
  if (!SUBJECT_OF) {
    SUBJECT_OF = new Map();
    for (const [subject, chapters] of Object.entries(DATA)) for (const [, rows] of chapters) for (const r of rows) if (!SUBJECT_OF.has(r[0].toLowerCase())) SUBJECT_OF.set(r[0].toLowerCase(), subject);
  }
  return SUBJECT_OF.get(topic.trim().toLowerCase());
}

/** The most-asked topics of one subject, for a request that names the subject and no topic. */
export function topTopicsFor(subject: string, limit = 40): string[] {
  const rows: RawRow[] = [];
  for (const [, r] of DATA[subject] ?? []) rows.push(...r);
  return rows.sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, limit).map((r) => r[0]);
}
