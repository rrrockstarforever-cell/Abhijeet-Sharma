// The study library: the textbooks the user owns, stored page by page in one SQLite database. Search uses the
// database's full-text index and returns the matching pages from the books on the chosen subject, as short passages.
// Nothing is fetched from the internet for this: the text comes from the user's own library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.PULSE_DATA_DIR || path.join(os.homedir(), '.pulse-med');
export const LIBRARY_PATH = process.env.PULSE_LIBRARY_DB || path.join(DATA_DIR, 'books', 'pulse-library.db');

let db = null;
function library() {
  if (db) return db;
  if (!fs.existsSync(LIBRARY_PATH)) return null;
  db = new DatabaseSync(LIBRARY_PATH, { readOnly: true });
  return db;
}

// App subject label → the subject name used in the library. Subjects not listed search every book.
const SUBJECT_MAP = [
  [/forensic/i, ['Forensic Medicine']],
  [/pharmacolog/i, ['Pharmacology']],
  [/physiolog/i, ['Physiology']],
  [/biochem/i, ['Biochemistry']],
  [/patholog/i, ['Pathology']],
  [/microbiolog/i, ['Microbiology']],
  [/community|preventive|\bpsm\b/i, ['Community Medicine']],
  [/anatom/i, ['Anatomy']],
  [/general medicine|internal medicine/i, ['General Medicine']],
  [/surg/i, ['General Surgery']],
  [/obstet|gynae/i, ['Obstetrics & Gynaecology']],
  [/pediatric|paediatric/i, ['Pediatrics']],
  [/orthop/i, ['Orthopedics']],
  [/\bENT\b|oto-?rhino|otolaryng/i, ['ENT']],
  [/ophthalm/i, ['Ophthalmology']],
  [/dermatolog/i, ['Dermatology']],
  [/psychiatr/i, ['Psychiatry']],
  [/radio/i, ['Radiology']],
];

function librarySubjects(subject) {
  const s = String(subject || '');
  const hit = SUBJECT_MAP.find(([re]) => re.test(s));
  return hit ? hit[1] : [];
}

const STOP = new Set(['with', 'from', 'that', 'this', 'have', 'were', 'their', 'which', 'also', 'after', 'before', 'than', 'such', 'only', 'other', 'most', 'some', 'used', 'will', 'does', 'into', 'when', 'while', 'there', 'these', 'those', 'about', 'among', 'through', 'where', 'being', 'given', 'shows', 'patient', 'patients', 'should', 'could', 'would', 'they', 'them', 'been', 'make', 'makes', 'drug', 'drugs']);

/** Matching pages from the library for a query, on a subject (or every book when the subject is not mapped). */
export function searchLibrary(query, subject = '', limit = 2, excerptChars = 700) {
  const database = library();
  if (!database) return [];
  const terms = [...new Set(String(query || '').toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])].filter((t) => !STOP.has(t));
  if (!terms.length) return [];
  const subjects = librarySubjects(subject);
  const subjectSql = subjects.length ? ` AND b.subject IN (${subjects.map(() => '?').join(',')})` : '';
  const select = `SELECT b.id AS book_id, b.title AS title, p.page_no AS page_no, p.text AS text, bm25(pages_fts) AS rank
    FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid JOIN books b ON b.id = p.book_id
    WHERE pages_fts MATCH ?${subjectSql} ORDER BY rank LIMIT ?`;
  // Every word must appear on the page first; if nothing matches, any of the words may.
  const attempts = [terms.map((t) => `"${t}"`).join(' AND ')];
  if (terms.length > 1) attempts.push(terms.map((t) => `"${t}"`).join(' OR '));
  let rows = [];
  for (const match of attempts) {
    rows = database.prepare(select).all(match, ...subjects, limit);
    if (rows.length) break;
  }
  return rows.map((r) => {
    const lower = String(r.text).toLowerCase();
    // The excerpt starts a little before the first query word on the page.
    const hits = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
    const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 150);
    return {
      title: `${r.title}, page ${r.page_no}`,
      url: `book:${r.book_id}#page=${r.page_no}`,
      text: String(r.text).slice(start, start + excerptChars),
    };
  });
}

/** Passages from the library for a query, on a subject. Empty when the library file is not present. */
export function bookPassages(query, limit = 2, subject = '') {
  return searchLibrary(query, subject, limit);
}
