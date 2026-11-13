// Packs everything made so far (finished lists AND unfinished pieces) into exports/topic-lists-for-chatgpt.zip,
// with a status table and a ready-to-paste prompt for ChatGPT.
// Usage: node tools/pack-zip.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const D = 'docs/chapter-topics/';
// [Subject, file slug, ranking-page slug]
const SUBJECTS = [
  ['Pharmacology', 'pharmacology', 'pharmacology'], ['Anatomy', 'anatomy', 'anatomy'], ['Physiology', 'physiology', 'physiology'],
  ['Biochemistry', 'biochemistry', 'biochemistry'], ['Pathology', 'pathology', 'pathology'], ['Microbiology', 'microbiology', 'microbiology'],
  ['Forensic Medicine', 'forensic-medicine', 'forensic-medicine'], ['Community Medicine (PSM)', 'community-medicine', 'psm'],
  ['General Medicine', 'general-medicine', 'general-medicine'], ['General Surgery', 'general-surgery', 'general-surgery'],
  ['Obstetrics and Gynaecology', 'obstetrics-and-gynaecology', 'obg'], ['Paediatrics', 'paediatrics', 'pediatrics'],
  ['Orthopaedics', 'orthopaedics', 'orthopedics'], ['ENT', 'ent', 'ent'], ['Ophthalmology', 'ophthalmology', 'ophthalmology'],
  ['Dermatology', 'dermatology', 'dermatology'], ['Psychiatry', 'psychiatry', 'psychiatry'], ['Anaesthesiology', 'anaesthesiology', 'anesthesiology'],
  ['Radiodiagnosis', 'radiodiagnosis', 'radiology'],
];
const pack = 'exports/topic-lists-for-chatgpt';
fs.rmSync(pack, { recursive: true, force: true });
for (const d of ['lists', 'unfinished', 'exam-weightage-reference']) fs.mkdirSync(`${pack}/${d}`, { recursive: true });

const rows = [];
for (const [name, slug, rslug] of SUBJECTS) {
  const finalJson = D + slug + '-final.json';
  let n = 0;
  try { n = JSON.parse(fs.readFileSync(finalJson, 'utf8')).length; } catch { /* not there */ }
  const pieces = fs.readdirSync(D).filter((f) => (f.startsWith(slug + '-') || f === slug + '-pdf-topics.json') && /-pdf-topics\.(json|md)$/.test(f));
  if (n > 0) {
    for (const ext of ['md', 'json']) fs.copyFileSync(D + slug + '-final.' + ext, `${pack}/lists/${slug}-final.${ext}`);
    rows.push({ name, slug, status: 'FINISHED', detail: `${n} ranked topics in lists/${slug}-final.md and .json` });
  } else {
    fs.mkdirSync(`${pack}/unfinished/${slug}`, { recursive: true });
    let items = 0;
    for (const f of pieces) {
      fs.copyFileSync(D + f, `${pack}/unfinished/${slug}/${f}`);
      if (f.endsWith('.json')) { try { items += JSON.parse(fs.readFileSync(D + f, 'utf8')).length; } catch { /* skip */ } }
    }
    rows.push({ name, slug, status: 'NOT FINISHED', detail: pieces.length ? `${items} raw topics from ${pieces.filter((f) => f.endsWith('.json')).length} source file(s) in unfinished/${slug}/ - needs merging, ranking and audit` : 'no topic files yet - build the list from your own knowledge (see prompt)' });
  }
  if (fs.existsSync(`docs/topic-ranking/${rslug}.md`)) fs.copyFileSync(`docs/topic-ranking/${rslug}.md`, `${pack}/exam-weightage-reference/${rslug}.md`);
}
for (const ext of ['md', 'json']) {
  const f = D + 'mixed-subjects-notespaedia-pdf-topics.' + ext;
  if (fs.existsSync(f)) fs.copyFileSync(f, `${pack}/lists/EXTRA-mixed-subjects-notespaedia-drug-and-investigation-of-choice.${ext}`);
}

const table = '| Subject | Status | What is in the zip |\n|---|---|---|\n' + rows.map((r) => `| ${r.name} | ${r.status} | ${r.detail} |`).join('\n');
fs.writeFileSync(`${pack}/STATUS.md`, `# What is finished and what is not\n\nMade ${new Date().toLocaleString()}.\n\n${table}\n\nHow the lists were made: topics were collected chunk by chunk from the student's scanned notes (Marrow, PrepLadder, Cerebellum, Snapshots and others) and from standard MBBS textbooks (BD Chaurasia, Guyton, KD Tripathi, Park, Robbins, Harrison, Bailey and Love and others) by a smaller AI model, merged, de-duplicated, audited against an exam-weightage page (folder exam-weightage-reference/, built from web search, not official data) and scored 1-100 (higher = asked more often).\n`);

fs.writeFileSync(`${pack}/PROMPT_FOR_CHATGPT.md`, `# Paste this into ChatGPT, then attach the zip (or the files named in each step)

I am preparing for NEET-PG and INI-CET. The attached zip holds topic lists for 19 subjects that were made by a smaller AI model from my scanned notes and MBBS textbooks. Read STATUS.md first: it says which subjects are FINISHED (a ranked list in lists/) and which are NOT FINISHED (raw topic pieces in unfinished/<subject>/).

Please work on ONE subject at a time, and start the next only when I say "next". Use your best knowledge of past NEET-PG and INI-CET papers. Do not invent facts about past papers; if you are unsure, say so in a Notes line.

## For a FINISHED subject (file lists/<subject>-final.json or .md)
1. Check completeness: add every exam-relevant topic that is missing (drugs, syndromes, signs, scoring systems, landmark studies, recent guideline changes). Mark the ones you add with "added": true.
2. Fix the ranking: re-score each topic 1-100 by how often it is really asked, and be strict - about 10 percent of topics at 80 or more, about 25 percent at 60-79, the rest lower.
3. Merge duplicates and near-duplicates. Split topics that are too broad into the units that exam questions really test. Keep topic names short and exam-style.
4. Keep group headings consistent and arranged in textbook chapter order.

## For a NOT FINISHED subject (files in unfinished/<subject>/)
1. Read all the pieces for that subject. They are lists of raw topics from different books (fields: topic, group, importance, books, how_asked) that were never merged.
2. Merge them into ONE list: combine duplicates and near-duplicates, assign each topic to one chapter-style group, and count in how many sources it appeared.
3. Then do everything in the FINISHED steps above (add missing topics, strict 1-100 score, split broad topics).
4. If a subject has no pieces at all, build the complete ranked list from your own knowledge and say so.

## What to return for each subject
- One table with columns: Rank, Topic, Group, Score, Tier (Very high 80+, High 60-79, Medium 40-59, Low below 40), Sources, How it is asked.
- The same list as a JSON array of objects with keys: topic, group, score, tier, sources, how_asked, added (true or false).
- A short list of what you added, merged, split and re-scored, and any Notes.
- Order: by group in textbook chapter order, and inside each group by score high to low.

The lists will be used to generate NEET-PG / INI-CET style MCQs chapter by chapter, so completeness and sensible chapter grouping matter more than length.
`);

execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.resolve(pack)}\\*' -DestinationPath '${path.resolve('exports/topic-lists-for-chatgpt.zip')}' -Force`]);
const mb = (fs.statSync('exports/topic-lists-for-chatgpt.zip').size / 1048576).toFixed(1);
console.log(table);
console.log(`\nZIP WRITTEN exports/topic-lists-for-chatgpt.zip (${mb} MB)`);
