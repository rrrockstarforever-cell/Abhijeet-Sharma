// Merge -> clean up -> audit -> add missing -> strict ranking, all with ChatGPT Luna through the app server (port 3100).
// Usage: node tools/finalize-topics.mjs "<Subject>" <subject-file-slug> <ranking-page-slug>
import fs from 'node:fs';
const [SUBJ, SLUG, RSLUG] = process.argv.slice(2);
const D = 'docs/chapter-topics/';
const rankFile = 'docs/topic-ranking/' + RSLUG + '.md';
const rankText = fs.existsSync(rankFile) ? fs.readFileSync(rankFile, 'utf8').slice(0, 20000) : '';
const rankTopics = rankText.split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split('|')[2].trim());

// At most 8 requests at once per subject (5 subjects run together = about 40 in all, under Luna's limit).
let active = 0; const waiters = [];
const slot = async () => { while (active >= 8) await new Promise((r) => waiters.push(r)); active++; };
const free = () => { active--; const w = waiters.shift(); if (w) w(); };
const call = async (system, content) => {
  for (let a = 0; a < 6; a++) {
    await slot();
    try {
      const r = await fetch('http://localhost:3100/api/ai/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'chatgpt', model: 'gpt-6-luna', system, json: true, messages: [{ role: 'user', content }] }) });
      const j = await r.json();
      const m = String(j.text).match(/{[sS]*}/);
      return JSON.parse(m[0]);
    } catch (e) { /* retry after a pause (rate limit or bad reply) */ }
    finally { free(); }
    await new Promise((r) => setTimeout(r, 4000 * (a + 1)));
  }
  return null;
};
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const log = (m) => console.log(new Date().toLocaleTimeString() + ' ' + m);

// -1. before anything else, re-do any chunk that failed during collection (rate limit etc.)
import { execFileSync } from 'node:child_process';
for (const f of fs.readdirSync(D).filter((f) => f.startsWith(SLUG + '-') && f.endsWith('-pdf-raw.json') || f === SLUG + '-pdf-raw.json')) {
  let bad = 0; try { bad = JSON.parse(fs.readFileSync(D + f, 'utf8')).filter((c) => c.topics === null).length; } catch {}
  if (bad) { console.log('re-doing ' + bad + ' failed chunks in ' + f); try { execFileSync('node', ['tools/retry-failed-chunks.mjs', SUBJ, f, '6'], { stdio: 'inherit' }); } catch (e) { console.log('retry failed: ' + e.message); } }
}

// 0. load every topic file of this subject
const files = fs.readdirSync(D).filter((f) => f.startsWith(SLUG + '-') && f.endsWith('-pdf-topics.json'));
let all = [];
for (const f of files) {
  const src = f.slice(SLUG.length + 1, -'-pdf-topics.json'.length) || 'notes';
  for (const t of JSON.parse(fs.readFileSync(D + f, 'utf8'))) all.push({ src: src === 'pdf' ? 'notes' : src, topic: t.topic, group: t.group, imp: t.importance, how: t.how_asked });
}
if (SLUG === 'anatomy' || true) { /* plain files named <slug>-pdf-topics.json also match above via prefix + '-' */ }
const plain = D + SLUG + '-pdf-topics.json';
log('files: ' + files.join(', ') + ' | input topics ' + all.length);
if (!all.length) { console.log('NO INPUT'); process.exit(1); }

// 1. canonical group headings
const rawGroups = [...new Set(all.map((x) => x.group).filter(Boolean))];
const gv = await call('Propose a clean set of 12-25 broad chapter/system group headings for the subject ' + SUBJ + ' (NEET-PG / INI-CET) that cover every raw heading given. Reply ONLY JSON {"groups":["heading",...]}.', rawGroups.join('\n'));
const GROUPS = gv && gv.groups && gv.groups.length ? gv.groups : rawGroups.slice(0, 25);
log('canonical groups: ' + GROUPS.length);

// 2. merge in batches (sorted so near-duplicates sit together)
all.sort((a, b) => String(a.group).localeCompare(String(b.group)) || a.topic.localeCompare(b.topic));
const mergeSys = 'You merge topic lists for ' + SUBJ + ' (NEET-PG / INI-CET). Input lines: source | group | topic | importance | how asked. Merge duplicates and near-duplicates into ONE canonical topic; keep genuinely different topics separate. Put each in exactly one of these groups: ' + JSON.stringify(GROUPS) + '. Reply ONLY JSON {"topics":[{"topic":"canonical name","group":"one of the groups","sources":["source names"],"how_asked":"<=20 words"}]}.';
const per = 120, batches = [];
for (let i = 0; i < all.length; i += per) batches.push(all.slice(i, i + per));
const mres = [];
for (let i = 0; i < batches.length; i += 24) mres.push(...await Promise.all(batches.slice(i, i + 24).map((b) => call(mergeSys, b.map((x) => [x.src, x.group, x.topic, x.imp, x.how].join(' | ')).join('\n')))));
const seen = new Map();
for (const v of mres) for (const t of (v ? v.topics || [] : [])) { const k = norm(t.topic); if (!seen.has(k)) seen.set(k, t); else { const o = seen.get(k); o.sources = [...new Set([...(o.sources || []), ...(t.sources || [])])]; } }
let merged = [...seen.values()];
log('after merge: ' + merged.length);

// 3. clean-up: collapse near-duplicates left across batches
const byG = {};
for (const t of merged) (byG[t.group || 'Other'] = byG[t.group || 'Other'] || []).push(t);
const dupSys = 'Find topics in this ' + SUBJ + ' list that mean the same thing (or one is wholly inside the other) and should be ONE topic. Reply ONLY JSON {"clusters":[{"keep":"exact topic to keep","remove":["exact topic","..."]}]}. Only genuine duplicates; leave different topics alone.';
let removed = 0;
await Promise.all(Object.values(byG).map(async (list) => {
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150);
    const v = await call(dupSys, chunk.map((t) => t.topic).join('\n'));
    for (const c of (v ? v.clusters || [] : [])) {
      const keep = merged.find((t) => norm(t.topic) === norm(c.keep)); if (!keep) continue;
      for (const r of c.remove || []) { const k = norm(r); if (k === norm(keep.topic)) continue; const idx = merged.findIndex((t) => norm(t.topic) === k); if (idx >= 0) { keep.sources = [...new Set([...(keep.sources || []), ...(merged[idx].sources || [])])]; merged.splice(idx, 1); removed++; } }
    }
  }
}));
log('near-duplicates removed: ' + removed + ' -> ' + merged.length);

// 4. audit: against the exam-weightage ranking page and against the syllabus; add what is missing
const names = () => merged.map((t) => t.topic).join('\n');
const added = [];
const missRef = rankTopics.length ? await call('Audit a ' + SUBJ + ' topic list for completeness. For each REFERENCE topic say if the MERGED LIST covers it (same or broader). Reply ONLY JSON {"missing":[{"topic":"reference topic as a clear topic name","group":"one of ' + JSON.stringify(GROUPS) + '","how_asked":"<=20 words"}]} with only topics NOT covered.', 'MERGED LIST:\n' + names() + '\n\nREFERENCE:\n' + rankTopics.join('\n')) : null;
const missSyl = await call('You are a senior ' + SUBJ + ' teacher for NEET-PG / INI-CET. List important exam topics from the full syllabus that the given list does NOT cover (not even under a broader entry). Reply ONLY JSON {"missing":[{"topic":"clear topic name","group":"one of ' + JSON.stringify(GROUPS) + '","how_asked":"<=20 words"}]}.', 'TOPIC LIST:\n' + names());
for (const v of [missRef, missSyl]) for (const t of (v ? v.missing || [] : [])) { if (!t.topic || seen.has(norm(t.topic)) || merged.some((m) => norm(m.topic) === norm(t.topic))) continue; const nt = { topic: t.topic, group: t.group || 'Other', sources: ['added by audit'], how_asked: t.how_asked || '', added: true }; merged.push(nt); added.push(nt.topic); }
log('added by audit: ' + added.length);

// 5. strict scoring by group, using the ranking page as guidance
const scoreSys = 'You rank ' + SUBJ + ' topics by how often NEET-PG / INI-CET asks them. Reference ranking for guidance:\n' + rankText + '\nGive each topic a score 1-100 (100 = asked almost every year). Be strict: at most 10% of topics 80+, about 25% 60-79, the rest lower. Reply ONLY JSON {"scores":[{"topic":"exact topic text","score":number}]}.';
const byG2 = {};
for (const t of merged) (byG2[t.group || 'Other'] = byG2[t.group || 'Other'] || []).push(t);
await Promise.all(Object.values(byG2).map(async (list) => {
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const v = await call(scoreSys, chunk.map((t) => t.topic).join('\n'));
    const m = new Map((v ? v.scores || [] : []).map((s) => [norm(s.topic), s.score]));
    for (const t of chunk) t.score = m.get(norm(t.topic)) ?? null;
  }
}));
merged.forEach((t) => { if (t.score == null) t.score = 45; t.tier = t.score >= 80 ? 'Very high' : t.score >= 60 ? 'High' : t.score >= 40 ? 'Medium' : 'Low'; });
merged.sort((a, b) => b.score - a.score);
fs.writeFileSync(D + SLUG + '-final.json', JSON.stringify(merged, null, 1));
const md = '# ' + SUBJ + ' - final topic list (merged, audited, ranked)\n\nBuilt from: ' + files.map((f) => f.replace('-pdf-topics.json', '')).join(', ') + '. After merging and removing duplicates, an audit against the exam-weightage page and the full syllabus added ' + added.length + ' missing topics (marked "added by audit").\n\nTotal topics: ' + merged.length + '. Score 1-100, higher = asked more often. Tiers: 80+ Very high, 60-79 High, 40-59 Medium, below 40 Low.\n\n| Rank | Topic | Group | Score | Tier | Sources | How it is asked |\n|---|---|---|---|---|---|---|\n' + merged.map((t, i) => '| ' + (i + 1) + ' | ' + t.topic + ' | ' + t.group + ' | ' + t.score + ' | ' + t.tier + ' | ' + ((t.sources || []).length) + (t.added ? ' (added by audit)' : '') + ' | ' + String(t.how_asked || '').replace(/\|/g, '/') + ' |').join('\n') + '\n';
fs.writeFileSync(D + SLUG + '-final.md', md);
console.log('DONE ' + merged.length + ' very-high ' + merged.filter((t) => t.tier === 'Very high').length + ' added ' + added.length);
