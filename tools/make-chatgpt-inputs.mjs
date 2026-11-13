// Makes one upload file + one prompt per subject in exports/chatgpt-per-subject/.
import fs from 'node:fs';
const D = 'docs/chapter-topics/';
const OUT = 'exports/chatgpt-per-subject/';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const S = [['Pharmacology','pharmacology'],['Anatomy','anatomy'],['Physiology','physiology'],['Biochemistry','biochemistry'],['Pathology','pathology'],['Microbiology','microbiology'],['Forensic Medicine','forensic-medicine'],['Community Medicine (PSM)','community-medicine'],['General Medicine','general-medicine'],['General Surgery','general-surgery'],['Obstetrics and Gynaecology','obstetrics-and-gynaecology'],['Paediatrics','paediatrics'],['Orthopaedics','orthopaedics'],['ENT','ent'],['Ophthalmology','ophthalmology'],['Dermatology','dermatology'],['Psychiatry','psychiatry'],['Anaesthesiology','anaesthesiology'],['Radiodiagnosis','radiodiagnosis']];
const index = [];
for (const [name, slug] of S) {
  let finished = false, items = [];
  try { items = JSON.parse(fs.readFileSync(D + slug + '-final.json', 'utf8')); finished = items.length > 0; } catch {}
  if (finished) {
    items = items.map((t) => ({ topic: t.topic, group: t.group, score: t.score, tier: t.tier, sources: t.sources, how_asked: t.how_asked }));
  } else {
    const m = new Map();
    for (const f of fs.readdirSync(D).filter((f) => f.startsWith(slug + '-') && f.endsWith('-pdf-topics.json'))) {
      let a = []; try { a = JSON.parse(fs.readFileSync(D + f, 'utf8')); } catch {}
      for (const t of a) {
        const k = String(t.topic).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (!k) continue;
        const o = m.get(k);
        if (!o) m.set(k, { topic: t.topic, group: t.group || '', importance: t.importance || '', n_sources: (t.books || []).length || 1, how_asked: String(t.how_asked || '').slice(0, 100) });
        else o.n_sources += (t.books || []).length || 1;
      }
    }
    items = [...m.values()];
  }
  fs.writeFileSync(OUT + slug + '.json', JSON.stringify(items));
  const common = `Return: (1) one table with columns Rank, Topic, Group, Score (1-100, strict: about 10% at 80+, 25% at 60-79), Tier (Very high 80+, High 60-79, Medium 40-59, Low <40), Sources, How it is asked; (2) the same list as a JSON array with keys topic, group, score, tier, sources, how_asked, added (true/false); (3) a short list of what you added, merged, split and re-scored. Order by group in textbook chapter order, inside each group by score high to low. Keep topic names short and exam-style. Do not invent facts about past papers; if unsure, say so in Notes. Because the answer is long, give the table in parts of about 120 rows and continue when I say "next".`;
  const prompt = finished
    ? `I am preparing for NEET-PG and INI-CET. The attached file ${slug}.json is a ranked topic list for ${name} (about ${items.length} topics). Please improve it: add every exam-relevant topic that is missing (mark those added:true), fix the ranking by how often topics are really asked, merge duplicates, split topics that are too broad into units that questions really test, and keep group headings in textbook chapter order. ${common}`
    : `I am preparing for NEET-PG and INI-CET. The attached file ${slug}.json holds about ${items.length} RAW, unmerged ${name} topics collected from my notes and textbooks (fields: topic, group, importance, n_sources, how_asked). Please merge them into ONE clean list: combine duplicates and near-duplicates, assign each topic to one chapter-style group, then improve it: add every exam-relevant topic that is missing (mark those added:true), rank by how often topics are really asked, and split topics that are too broad. ${common}`;
  fs.writeFileSync(OUT + slug + '.prompt.txt', prompt);
  index.push(`${slug}\t${finished ? 'FINISHED' : 'RAW'}\t${items.length}\t${(fs.statSync(OUT + slug + '.json').size / 1024).toFixed(0)}KB`);
}
fs.writeFileSync(OUT + 'INDEX.tsv', index.join('\n'));
console.log(index.join('\n'));
