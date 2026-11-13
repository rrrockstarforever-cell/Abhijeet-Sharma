// Waits for each subject's topic runs to finish, runs the merge/audit/rank step, then zips the final lists.
// Usage: node tools/finalize-all.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const TMP = process.env.TEMP;
const D = 'docs/chapter-topics/';
// [Subject, file slug, ranking-page slug, [logs that must say DONE]]
const SUBJECTS = [
  ['Pharmacology', 'pharmacology', 'pharmacology', []],
  ['Anatomy', 'anatomy', 'anatomy', ['notes-anatomy', 'mbbs-anat2', 'mbbs-os-anat']],
  ['Physiology', 'physiology', 'physiology', ['notes-physiology']],
  ['Biochemistry', 'biochemistry', 'biochemistry', ['notes-biochemistry', 'mbbs-os-bio', 'mbbs-os-chem']],
  ['Pathology', 'pathology', 'pathology', ['notes-pathology', 'mbbs-path']],
  ['Microbiology', 'microbiology', 'microbiology', ['notes-microbiology', 'mbbs-micro', 'mbbs-os-micro']],
  ['Forensic Medicine', 'forensic-medicine', 'forensic-medicine', ['notes-forensic-medicine', 'mbbs-forensic']],
  ['Community Medicine', 'community-medicine', 'psm', ['notes-community-medicine', 'mbbs-psm']],
  ['General Medicine', 'general-medicine', 'general-medicine', ['notes-general-medicine', 'mbbs-med', 'mbbs-davidson']],
  ['General Surgery', 'general-surgery', 'general-surgery', ['notes-general-surgery', 'mbbs-surg', 'notes2-surgery']],
  ['Obstetrics and Gynaecology', 'obstetrics-and-gynaecology', 'obg', ['notes-obstetrics-and-gynaecology', 'mbbs-obg']],
  ['Paediatrics', 'paediatrics', 'pediatrics', ['notes-paediatrics', 'mbbs-peds']],
  ['Orthopaedics', 'orthopaedics', 'orthopedics', ['notes-orthopaedics', 'mbbs-ortho']],
  ['ENT', 'ent', 'ent', ['notes-ent', 'mbbs-ent']],
  ['Ophthalmology', 'ophthalmology', 'ophthalmology', ['notes-ophthalmology', 'mbbs-oph']],
  ['Dermatology', 'dermatology', 'dermatology', ['notes-dermatology', 'mbbs-derm', 'mbbs-iadvl']],
  ['Psychiatry', 'psychiatry', 'psychiatry', ['notes-psychiatry', 'mbbs-psy', 'mbbs-os-psych']],
  ['Anaesthesiology', 'anaesthesiology', 'anesthesiology', ['notes-anaesthesiology']],
  ['Radiodiagnosis', 'radiodiagnosis', 'radiology', ['notes-radiodiagnosis', 'mbbs-radio', 'notes2-radiology']],
];
const logDone = (n) => { try { return /^DONE \d+/m.test(fs.readFileSync(path.join(TMP, n + '.log'), 'utf8')); } catch { return false; } };
const state = {}; // slug -> waiting | running | done | failed
for (const s of SUBJECTS) state[s[1]] = fs.existsSync(D + s[1] + '-final.md') ? 'done' : 'waiting';
const status = () => fs.writeFileSync(path.join(TMP, 'finalize-all.status.json'), JSON.stringify(state, null, 1));
let running = 0;
// A merge started by an earlier copy of this driver may still be going: do not start it twice.
const ext = new Set();
try {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'finalize-topics' } | ForEach-Object { $_.CommandLine }"]).toString();
  for (const s of SUBJECTS) if (state[s[1]] === 'waiting' && out.includes('"' + s[0] + '" ') || out.includes('finalize-topics.mjs ' + s[0] + ' ' + s[1])) if (state[s[1]] === 'waiting') { state[s[1]] = 'running'; ext.add(s[1]); running++; }
} catch {}

function launch(s) {
  state[s[1]] = 'running'; running++;
  const out = fs.openSync(path.join(TMP, 'final-' + s[1] + '.log'), 'w');
  const p = spawn('node', ['tools/finalize-topics.mjs', s[0], s[1], s[2]], { stdio: ['ignore', out, out] });
  p.on('exit', () => { running--; state[s[1]] = fs.existsSync(D + s[1] + '-final.md') ? 'done' : 'failed'; status(); });
}

while (Object.values(state).some((v) => v === 'waiting' || v === 'running')) {
  for (const k of [...ext]) if (fs.existsSync(D + k + '-final.md')) { ext.delete(k); state[k] = 'done'; running--; }
  for (const s of SUBJECTS) {
    if (running >= 5) break;
    if (state[s[1]] === 'waiting' && s[3].every(logDone)) launch(s);
  }
  status();
  await new Promise((r) => setTimeout(r, 15000));
}

// zip for ChatGPT
const pack = 'exports/topic-lists-for-chatgpt';
fs.rmSync(pack, { recursive: true, force: true });
fs.mkdirSync(pack + '/lists', { recursive: true });
fs.mkdirSync(pack + '/exam-weightage-reference', { recursive: true });
for (const s of SUBJECTS) {
  for (const ext of ['md', 'json']) if (fs.existsSync(D + s[1] + '-final.' + ext)) fs.copyFileSync(D + s[1] + '-final.' + ext, pack + '/lists/' + s[1] + '-final.' + ext);
  if (fs.existsSync('docs/topic-ranking/' + s[2] + '.md')) fs.copyFileSync('docs/topic-ranking/' + s[2] + '.md', pack + '/exam-weightage-reference/' + s[2] + '.md');
}
for (const ext of ['md', 'json']) { const f = D + 'mixed-subjects-notespaedia-pdf-topics.' + ext; if (fs.existsSync(f)) fs.copyFileSync(f, pack + '/lists/EXTRA-mixed-subjects-notespaedia-drug-and-investigation-of-choice.' + ext); }
fs.writeFileSync(pack + '/README_FOR_CHATGPT.md', `# NEET-PG / INI-CET topic lists - please improve

This zip has one ranked topic list for each of 19 subjects (folder \`lists/\`, each as .md for reading and .json for data).

How the lists were made
- Topics were collected chunk by chunk from the student's scanned notes/PDFs (Marrow, PrepLadder, Cerebellum, Snapshots etc.) and from standard MBBS textbooks (BD Chaurasia, Guyton, KD Tripathi, Park, Robbins, Harrison, Bailey & Love and others) with a smaller AI model.
- The results were merged, near-duplicates removed, audited against an exam-weightage page (folder \`exam-weightage-reference/\`, built from web search, not official data) and against the syllabus. Topics found missing were added and marked "added by audit".
- Each topic has a score 1-100 (higher = asked more often), a tier, a group heading, how many sources contained it, and how it is usually asked.

What I would like you to do (per subject, best available knowledge of past NEET-PG / INI-CET papers)
1. Check completeness: add any exam-relevant topic that is missing (drugs, syndromes, signs, scoring systems, landmark studies, recent guideline changes).
2. Fix ranking: re-score and reorder by how often each topic is really asked; be strict with the top tier (about 10 percent).
3. Merge duplicates and near-duplicates; make the topic names short and exam-style; keep group headings consistent.
4. Split topics that are too broad into the units that exam questions actually test.
5. Keep the same table columns (Rank, Topic, Group, Score, Tier, Sources, How it is asked) and return one corrected file per subject, plus a short list of what you added, merged, and re-scored.

Please do not invent facts about past papers; if unsure, say so in a Notes line.
`);
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.resolve(pack)}\\*' -DestinationPath '${path.resolve('exports/topic-lists-for-chatgpt.zip')}' -Force`]);
console.log('ZIP READY exports/topic-lists-for-chatgpt.zip');
