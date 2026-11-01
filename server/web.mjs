// Web research for the "Use web sources" option and for question evidence: DuckDuckGo results and Europe PMC
// abstracts, fetched here (not in the page). Every source is returned with its URL so the answer can cite it.
// Only public http(s) pages are fetched. PubMed is not used.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) PulseMed/0.2 (study tool)';
const TRUSTED = /(nih\.gov|ncbi\.nlm|who\.int|cdc\.gov|nice\.org\.uk|medlineplus|mayoclinic|msdmanuals|statpearls|radiopaedia|cochrane|bmj\.com|thelancet|nejm|jamanetwork|icmr|mohfw|aiims)/i;

const ents = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ents[m] ?? m);
const strip = (h) => decode(h.replace(/<(script|style|nav|header|footer|aside|svg|noscript|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function isPublicUrl(u) {
  let x;
  try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol)) return false;
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':')) return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

async function get(url, ms = 12000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json,application/xml' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}

async function ddg(q) {
  const html = await (await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q))).text();
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snip = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => strip(m[1]));
  let m, i = 0;
  while ((m = re.exec(html)) && out.length < 8) {
    let href = decode(m[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href);
      if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch { /* keep */ }
    if (isPublicUrl(href)) out.push({ title: strip(m[2]), url: href, snippet: snip[i] ?? '' });
    i++;
  }
  return out;
}

/** Europe PMC abstracts, optionally limited to some journals. Each result: title, url and abstract text. */
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
async function europePmc(query, journals = []) {
  const terms = String(query || '').replace(/["\\]/g, ' ').trim().slice(0, 300);
  if (!terms) return [];
  const journalPart = journals.length ? `(${journals.map((j) => `JOURNAL:"${j}"`).join(' OR ')}) AND ` : '';
  const url = `${EUROPE_PMC}?query=${encodeURIComponent(`${journalPart}(${terms}) AND HAS_ABSTRACT:y`)}&format=json&pageSize=3&resultType=core`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data?.resultList?.result || [])
    .filter((r) => r.abstractText)
    .map((r) => ({
      title: strip(r.title || '').slice(0, 300),
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source || 'MED'}/${r.id}`,
      text: `${r.journalTitle || ''} ${r.pubYear || ''}. ${strip(r.abstractText)}`.slice(0, 1500),
    }));
}

async function pageText(url, chars = 2500) {
  const r = await get(url);
  const type = r.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|xml/.test(type)) throw new Error('not a web page');
  return strip((await r.text()).slice(0, 1_500_000)).slice(0, chars);
}

// pageChars: how much of each page to keep. The start of a page is often menus, so a fact check asks for more.
export async function research(query, pageChars = 2500) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new Error('Nothing to search for.');
  const [w, p] = await Promise.allSettled([ddg(q), europePmc(q)]);
  const web = (w.status === 'fulfilled' ? w.value : []).sort((a, b) => Number(TRUSTED.test(b.url)) - Number(TRUSTED.test(a.url))).slice(0, 3);
  const papers = p.status === 'fulfilled' ? p.value : [];
  const pages = await Promise.allSettled(web.map((x) => pageText(x.url, pageChars)));
  const sources = [
    ...web.map((x, i) => ({ title: x.title, url: x.url, text: (pages[i].status === 'fulfilled' && pages[i].value.length > 200 ? pages[i].value : x.snippet) || x.snippet, kind: 'web' })),
    ...papers.map((x) => ({ ...x, kind: 'europepmc' })),
  ].filter((s) => s.text).map((s, i) => ({ n: i + 1, ...s }));
  if (!sources.length) throw new Error('No sources found (check your internet connection, or try different wording).');
  return { sources, retrievedAt: new Date().toISOString().slice(0, 10) };
}

/**
 * Indian journals that Europe PMC indexes, per subject. A subject searches only its own journals, so a
 * pharmacology question never pulls surgery papers. Anatomy has no indexed Indian journal and searches all of Europe PMC.
 */
const SUBJECT_JOURNALS = [
  [/physiolog/i, ['Indian J Physiol Pharmacol']],
  [/biochem/i, ['Indian J Biochem Biophys']],
  [/patholog/i, ['Indian J Pathol Microbiol']],
  [/pharmacolog/i, ['Indian J Pharmacol']],
  [/microbiolog/i, ['Indian J Med Microbiol']],
  [/forensic/i, ['Indian J Forensic Med Toxicol']],
  [/community|preventive|\bpsm\b/i, ['Indian J Community Med']],
  [/general medicine|internal medicine/i, ['J Assoc Physicians India', 'Indian J Med Res']],
  [/surg/i, ['Indian J Surg']],
  [/obstet|gynae/i, ['J Obstet Gynaecol India']],
  [/pediatric|paediatric/i, ['Indian Pediatr']],
  [/orthop/i, ['Indian J Orthop']],
  [/\bENT\b|oto-?rhino|otolaryng/i, ['Indian J Otolaryngol Head Neck Surg']],
  [/ophthalm/i, ['Indian J Ophthalmol']],
  [/dermatolog/i, ['Indian J Dermatol Venereol Leprol']],
  [/psychiatr/i, ['Indian J Psychiatry']],
  [/anesth|anaesth/i, ['Indian J Anaesth']],
  [/radio/i, ['Indian J Radiol Imaging']],
];

export function journalsFor(subject) {
  const s = String(subject || '');
  const hit = SUBJECT_JOURNALS.find(([re]) => re.test(s));
  return hit ? hit[1] : [];
}

/** Drug-label text from openFDA for a query, when a label's indications mention it. Used for drug and medicine questions. */
async function openFdaLabel(query) {
  const phrase = String(query || '').replace(/["\\]/g, ' ').trim();
  if (!phrase) return [];
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`indications_and_usage:"${phrase}"`)}&limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const hit = data?.results?.[0];
  if (!hit) return [];
  const name = hit.openfda?.generic_name?.[0] || hit.openfda?.brand_name?.[0] || 'Drug label';
  const text = [hit.indications_and_usage?.[0], hit.warnings?.[0] || hit.boxed_warning?.[0]]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  if (!text) return [];
  return [{ title: `${name} (FDA drug label)`, url: 'https://open.fda.gov/apis/drug/label/', text: text.slice(0, 1200) }];
}

/** Drug and medicine subjects, plus unknown subjects (the tutor), also read openFDA labels. */
function usesDrugLabels(subject) {
  return !subject || /pharmacolog|medicine|therap|drug|anesth|anaesth|toxicolog/i.test(String(subject));
}

/**
 * Evidence for a question on a subject: the subject's Indian journals on Europe PMC, plus an openFDA
 * drug label where the subject uses drugs. Capped at four items. Each source fails on its own.
 */
export async function literatureSources(query, subject) {
  const [label, papers] = await Promise.all([
    usesDrugLabels(subject) ? openFdaLabel(query).catch(() => []) : Promise.resolve([]),
    europePmc(query, journalsFor(subject)).catch(() => []),
  ]);
  return [...label, ...papers].slice(0, 4);
}

/**
 * The sources the question writer and checker may read, with the licence and status of each.
 * "live" sources are searched when a question is written or checked; "reference" pages are not searchable yet.
 */
export const SOURCE_REGISTRY = [
  { id: 'europepmc', name: 'Europe PMC abstracts (subject Indian journals)', licence: 'Abstracts free; full text varies by article', fetch: 'Europe PMC REST API', status: 'live' },
  { id: 'openfda', name: 'openFDA drug labels', licence: 'US government data (openFDA terms)', fetch: 'api.fda.gov', status: 'live' },
  { id: 'bookshelf', name: 'NCBI Bookshelf (StatPearls and open textbooks)', licence: 'Varies per book; StatPearls is free to read', fetch: 'NCBI web pages', status: 'blocked: NCBI shows a bot check instead of chapter text' },
  { id: 'reference-pages', name: 'Reference websites (TeachMeAnatomy, CV Physiology, LibreTexts, WebPath, DermNet, EyeWiki, NHSRC treatment guidelines and others)', licence: 'Varies per site; check before quoting', fetch: 'page text only; no search yet', status: 'reference: readable pages, not searched per question' },
];

/** Question-writing and checking evidence (kept for the older route name). */
export async function topicSources(query, subject) {
  return literatureSources(query, subject);
}
