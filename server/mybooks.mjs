// "My books": the 19 rebuilt study books (one per subject), stored as chapters and sections in one SQLite file.
// Practice Builder uses them as the only source for the questions it writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.PULSE_DATA_DIR || path.join(os.homedir(), '.pulse-med');
export const MYBOOKS_PATH = process.env.PULSE_MYBOOKS_DB || path.join(DATA_DIR, 'books', 'pulse-mybooks.db');

let db = null;
function open() {
  if (db) return db;
  if (!fs.existsSync(MYBOOKS_PATH)) return null;
  db = new DatabaseSync(MYBOOKS_PATH, { readOnly: true });
  return db;
}

// App subject label → the subject name stored in the books. A subject that is not listed searches every book.
const SUBJECT_MAP = [
  [/forensic/i, 'Forensic Medicine'],
  [/pharmacolog/i, 'Pharmacology'],
  [/physiolog/i, 'Physiology'],
  [/biochem/i, 'Biochemistry'],
  [/patholog/i, 'Pathology'],
  [/microbiolog/i, 'Microbiology'],
  [/community|preventive|\bpsm\b/i, 'Community Medicine'],
  [/anatom/i, 'Anatomy'],
  [/general medicine|internal medicine/i, 'General Medicine'],
  [/surg/i, 'General Surgery'],
  [/obstet|gynae|gynec/i, 'Obstetrics and Gynaecology'],
  [/pediatric|paediatric/i, 'Paediatrics'],
  [/orthop/i, 'Orthopaedics'],
  [/\bENT\b|oto-?rhino|otolaryng/i, 'ENT'],
  [/ophthalm/i, 'Ophthalmology'],
  [/dermatolog/i, 'Dermatology'],
  [/psychiatr/i, 'Psychiatry'],
  [/radio/i, 'Radiodiagnosis'],
  [/anaesth|anesth/i, 'Anaesthesiology'],
];

export function myBooksSubject(label) {
  const s = String(label || '');
  const hit = SUBJECT_MAP.find(([re]) => re.test(s));
  return hit ? hit[1] : '';
}

const STOP = new Set(['with', 'from', 'that', 'this', 'have', 'were', 'their', 'which', 'also', 'after', 'before', 'than', 'such', 'only', 'other', 'most', 'some', 'used', 'will', 'does', 'into', 'when', 'while', 'there', 'these', 'those', 'about', 'among', 'through', 'where', 'being', 'given', 'shows', 'patient', 'patients', 'should', 'could', 'would', 'they', 'them', 'been', 'make', 'makes']);

// Words that mark a point on which the books themselves say their sources differ.
const DISPUTE = /\b(books? differ|sources? differ|differs? (?:between|by|from book)|disagree|disputed|controvers|conflicting|varies (?:between|by)|not agreed)\w*/i;

export function myBooksStatus() {
  const database = open();
  if (!database) return { available: false, books: [] };
  const books = database.prepare('SELECT subject, title, words, chapter_count, section_count FROM books ORDER BY subject').all();
  return { available: true, books };
}

/**
 * The sections of the books that best match a query, on one subject (or every book when the subject is not mapped).
 * Each result names its book and chapter, and says whether the book itself marks the point as disputed.
 */
export function searchMyBooks(query, subject = '', limit = 4, excerptChars = 1800) {
  const database = open();
  if (!database) return [];
  const terms = [...new Set(String(query || '').toLowerCase().match(/[a-z][a-z-]{2,}/g) || [])].filter((t) => !STOP.has(t)).slice(0, 12);
  if (!terms.length) return [];
  const bookSubject = myBooksSubject(subject);
  const select = (withSubject, op) => `SELECT s.subject AS subject, s.chapter_no AS chapter_no, s.chapter_title AS chapter_title, s.heading AS heading,
      s.text AS text, bm25(sections_fts, 4.0, 1.0) AS rank
    FROM sections_fts JOIN sections s ON s.id = sections_fts.rowid
    WHERE sections_fts MATCH ? AND s.subject ${op} ? ORDER BY rank LIMIT ?`;
  // Every word first; if nothing matches, any of the words.
  const attempts = [terms.map((t) => `"${t}"`).join(' AND ')];
  if (terms.length > 1) attempts.push(terms.map((t) => `"${t}"`).join(' OR '));
  const run = (op, value) => {
    for (const match of attempts) {
      try {
        const found = database.prepare(select(true, op)).all(match, value, limit);
        if (found.length) return found;
      } catch { /* a bad search phrase finds nothing */ }
    }
    return [];
  };
  // The learner's subject is read first. Only when it gives fewer passages than asked for are the other books read.
  let rows = [];
  if (bookSubject) {
    rows = run('=', bookSubject);
    if (rows.length < limit) rows = [...rows, ...run('!=', bookSubject).slice(0, limit - rows.length)];
  } else {
    rows = run('!=', '');
  }
  return rows.map((r) => {
    const text = String(r.text);
    const lower = text.toLowerCase();
    const hits = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
    const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 200);
    return {
      subject: r.subject,
      title: `${r.subject} (my notes), chapter ${r.chapter_no}: ${r.chapter_title}`,
      heading: r.heading,
      disputed: DISPUTE.test(text),
      text: text.slice(start, start + excerptChars),
    };
  });
}
