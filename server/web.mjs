// Web research for the "Use web sources" option: DuckDuckGo results + PubMed abstracts, fetched here (not in the page).
// Every source is returned with its URL so the answer can cite it. Only public http(s) pages are fetched.
// Ported from C:\ad\amc-app\server\web.mjs (the old app's working implementation).
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

async function pubmed(q) {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  const ids = (await (await get(`${base}esearch.fcgi?db=pubmed&retmode=json&retmax=3&sort=relevance&term=${encodeURIComponent(q)}`)).json()).esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const xml = await (await get(`${base}efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}`)).text();
  return [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)].map((m) => {
    const a = m[1];
    const pick = (re) => strip((a.match(re) || [])[1] || '');
    const abs = [...a.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map((x) => {
      const label = (x[1].match(/Label="([^"]+)"/) || [])[1];
      return (label ? label + ': ' : '') + strip(x[2]);
    }).join(' ');
    const id = pick(/<PMID[^>]*>(\d+)<\/PMID>/);
    return { title: pick(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/), url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, text: `${pick(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/)} ${pick(/<PubDate>[\s\S]*?<Year>(\d+)<\/Year>/)}. ${abs}`.slice(0, 2500) };
  }).filter((s) => s.text.length > 40);
}

async function pageText(url) {
  const r = await get(url);
  const type = r.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|xml/.test(type)) throw new Error('not a web page');
  return strip((await r.text()).slice(0, 1_500_000)).slice(0, 2500);
}

export async function research(query) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new Error('Nothing to search for.');
  const [w, p] = await Promise.allSettled([ddg(q), pubmed(q)]);
  const web = (w.status === 'fulfilled' ? w.value : []).sort((a, b) => Number(TRUSTED.test(b.url)) - Number(TRUSTED.test(a.url))).slice(0, 3);
  const pm = p.status === 'fulfilled' ? p.value : [];
  const pages = await Promise.allSettled(web.map((x) => pageText(x.url)));
  const sources = [
    ...web.map((x, i) => ({ title: x.title, url: x.url, text: (pages[i].status === 'fulfilled' && pages[i].value.length > 200 ? pages[i].value : x.snippet) || x.snippet, kind: 'web' })),
    ...pm.map((x) => ({ ...x, kind: 'pubmed' })),
  ].filter((s) => s.text).map((s, i) => ({ n: i + 1, ...s }));
  if (!sources.length) throw new Error('No sources found (check your internet connection, or try different wording).');
  return { sources, retrievedAt: new Date().toISOString().slice(0, 10) };
}
