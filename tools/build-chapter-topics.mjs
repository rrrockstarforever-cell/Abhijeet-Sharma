// Builds src/data/chapterTopics.json from the 19 ChatGPT PYQ-updated topic files (exports/chatgpt-results/<slug>.json).
// Output per app subject: [[chapter, [[topic, tier 0-3, score, pyqCount, predictedProbability], ...]], ...] in book order.
import fs from 'node:fs';
const dir = 'exports/chatgpt-results/';
const SUBJECT = {
  anatomy: 'Anatomy', physiology: 'Physiology', biochemistry: 'Biochemistry', pathology: 'Pathology',
  pharmacology: 'Pharmacology', microbiology: 'Microbiology', 'forensic-medicine': 'Forensic Medicine & Toxicology',
  'community-medicine': 'Preventive & Social Medicine (PSM)', 'general-medicine': 'General Medicine',
  'general-surgery': 'General Surgery', obg: 'Obstetrics & Gynaecology', paediatrics: 'Pediatrics',
  orthopaedics: 'Orthopedics', ent: 'Oto-Rhino-Laryngology (ENT)', ophthalmology: 'Ophthalmology',
  dermatology: 'Dermatology & Venereology', psychiatry: 'Psychiatry', anaesthesiology: 'Anesthesiology',
  radiodiagnosis: 'Radiodiagnosis & Radiotherapy',
};
const TIER = { 'Very high': 3, High: 2, Medium: 1, Low: 0 };
const out = {};
let total = 0;
for (const [slug, subject] of Object.entries(SUBJECT)) {
  const rows = JSON.parse(fs.readFileSync(dir + slug + '.json', 'utf8'));
  const chapters = new Map();
  const seen = new Set();
  for (const r of rows) {
    const topic = String(r.topic).trim();
    const key = topic.toLowerCase();
    if (!topic || seen.has(key)) continue;
    seen.add(key);
    const no = parseFloat(r.chapter_no);
    const ck = r.chapter;
    if (!chapters.has(ck)) chapters.set(ck, { no: Number.isFinite(no) ? no : 9999, topics: [] });
    chapters.get(ck).topics.push([topic, TIER[r.tier] ?? 1, Math.round(Number(r.score) || 0), Number(r.pyq_count ?? r.pyq_count) || 0, Math.round(Number(r.predicted_probability) || 0), String(r.how_asked || '').trim()]);
  }
  out[subject] = [...chapters.entries()].sort((a, b) => a[1].no - b[1].no)
    .map(([chapter, c]) => [chapter, c.topics.sort((a, b) => b[2] - a[2])]);
  total += seen.size;
  console.log(subject.padEnd(36), seen.size, 'topics', out[subject].length, 'chapters');
}
fs.writeFileSync('src/data/chapterTopics.json', JSON.stringify(out));
console.log('total', total, 'bytes', fs.statSync('src/data/chapterTopics.json').size);
