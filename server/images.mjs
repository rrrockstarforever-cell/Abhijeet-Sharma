// Live clinical-image search for image-based questions.
//
// Sources and why only some are embedded:
//   • Open-i (NLM) — searches open-access PubMed Central figures and exposes each figure's
//     licence and article. Only CC BY / CC BY-SA / CC0 / public-domain figures are returned,
//     so the picture can be shown with attribution. This is the live provider.
//   • Wikimedia Commons (CDC PHIL, Radiopaedia-style cases, etc.) — the curated local
//     library in public/medical-images/ already comes from here.
//   • Radiopaedia, DermNet, RSNA Case Collection, Columbia Ophthalmology Atlas, LITFL,
//     MedPix — copyrighted / "personal use only" terms. They are offered as reference
//     links in the UI, never scraped into the app.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_ROOT = process.env.PULSE_DATA_DIR || join(homedir(), '.pulse-med');
const CACHE_DIR = join(DATA_ROOT, 'image-cache');
const OPENI = 'https://openi.nlm.nih.gov';
// Wikimedia asks automated clients to say who they are, and answers anonymous ones more slowly.
const UA = 'PulseMed-Education/1.0 (exam study app; https://github.com/rrrockstarforever-cell/Abhijeet-Sharma)';

// Search results are cached in memory: a query costs 5–12 s against two live APIs, and
// generation asks for the same topic across batches. 30-minute TTL keeps it fresh.
const SEARCH_TTL_MS = 30 * 60 * 1000;
const searchCache = new Map();
// Searches that found pictures are also kept on disk for a week, so repeated runs (and tests) do not ask Wikimedia again.
// An empty answer is remembered for ten minutes only.
const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 10 * 60 * 1000;
const DISK_FILE = join(CACHE_DIR, 'search-results.json');
let diskCache = null;
function diskGet(key) {
  try {
    if (!diskCache) diskCache = existsSync(DISK_FILE) ? JSON.parse(readFileSync(DISK_FILE, 'utf8')) : {};
    const hit = diskCache[key];
    return hit && Date.now() - hit.at < DISK_TTL_MS ? hit.results : null;
  } catch { diskCache = {}; return null; }
}
function diskSet(key, results) {
  try {
    if (!diskCache) diskCache = {};
    diskCache[key] = { at: Date.now(), results };
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(DISK_FILE, JSON.stringify(diskCache));
  } catch { /* the cache is an optimisation only */ }
}

const stripHtml = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Only licences that allow redistribution inside a study app. */
function licenceOf(entry) {
  const cc = String(entry.ccLicense || '').toLowerCase();
  const url = String(entry.licenseURL || '');
  if (cc === 'by' || /creativecommons\.org\/licenses\/by\//i.test(url)) {
    return { label: 'CC BY', url };
  }
  if (cc === 'bysa' || cc === 'by-sa' || /creativecommons\.org\/licenses\/by-sa\//i.test(url)) {
    return { label: 'CC BY-SA', url };
  }
  if (/publicdomain\/zero/i.test(url)) return { label: 'CC0', url };
  if (/publicdomain\/mark/i.test(url)) return { label: 'Public domain', url };
  return null; // NC / ND / unknown — not reusable here
}

function normalise(entry) {
  const licence = licenceOf(entry);
  if (!licence) return null;
  const large = entry.imgLarge || entry.imgThumbLarge || entry.imgThumb;
  if (!large || !/^\/imgs\//.test(large)) return null;

  const caption = stripHtml(entry.image?.caption) || stripHtml(entry.image?.mention);
  if (!caption) return null;

  const imageUrl = `${OPENI}${large}`;
  const authors = stripHtml(entry.authors);
  const journal = stripHtml(entry.journal_abbr || entry.journal_title);
  const credit = [authors, journal].filter(Boolean).join(' · ').slice(0, 160) || 'PubMed Central';

  return {
    id: createHash('sha1').update(imageUrl).digest('hex').slice(0, 16),
    provider: 'Open-i · NLM',
    title: stripHtml(entry.title).slice(0, 160),
    caption: caption.slice(0, 400),
    credit,
    licence: licence.label,
    licenceUrl: licence.url,
    articleUrl: entry.pmc_url || entry.pubMed_url || '',
    modality: entry.image?.modalityMajor || '',
    imageUrl,
    proxyUrl: `/api/images/proxy?u=${encodeURIComponent(imageUrl)}`,
    thumbUrl: entry.imgGrid150 ? `${OPENI}${entry.imgGrid150}` : `${OPENI}${large}`,
  };
}


// Wikimedia answers HTTP 429 when many searches arrive together (several questions look for pictures at once), so its
// requests go through one small queue: two at a time, a short gap between starts, and a patient retry on 429 or 503.
const WIKI_CONCURRENCY = 2;
const WIKI_GAP_MS = 250;
let wikiActive = 0;
let wikiLastStart = 0;
const wikiWaiting = [];
async function wikiFetch(url, init = {}) {
  if (wikiActive >= WIKI_CONCURRENCY) await new Promise((resolve) => wikiWaiting.push(resolve));
  wikiActive += 1;
  try {
    for (let attempt = 0; ; attempt++) {
      const wait = wikiLastStart + WIKI_GAP_MS - Date.now();
      wikiLastStart = Math.max(Date.now(), wikiLastStart) + (wait > 0 ? wait : 0);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1)))));
        continue;
      }
      return res;
    }
  } finally {
    wikiActive -= 1;
    wikiWaiting.shift()?.();
  }
}

/** Search Open-i for reusable figures. Returns [] on no match; throws only on network errors. */
export async function searchImages(query, { limit = 10, noExtra = false } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return { results: [], errors: [] };
  const cacheKey = `${q.toLowerCase()}::${limit}`;
  const hit = searchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < (hit.results.length ? SEARCH_TTL_MS : EMPTY_TTL_MS)) {
    return { results: hit.results, errors: [], cached: true };
  }
  const onDisk = noExtra ? null : diskGet(cacheKey);
  if (onDisk?.length) {
    searchCache.set(cacheKey, { at: Date.now(), results: onDisk });
    return { results: onDisk, errors: [], cached: true };
  }
  const errors = [];
  // Both providers run in parallel, but a slow/unreachable one must not hold the whole
  // search hostage: after the soft deadline we keep whatever has already arrived.
  let commons = [];
  let openi = [];
  let article = [];
  let category = [];
  // The article and the category are named after the condition, so they are searched with the diagnosis words only
  // (the modality word and trailing "photo" would not be part of a title).
  const core = q.split(/\s+/).filter((w) => !/^(histology|histological|histopathology|biopsy|micrograph|ecg|ekg|x-ray|xray|radiograph|ct|mri|ultrasound|smear|fundus|photo|photograph|clinical|image|picture)$/i.test(w)).join(' ') || q;
  const articleP = (noExtra ? Promise.resolve([]) : searchWikipediaArticle(core, { limit }))
    .then((rows) => { article = rows; return rows; })
    .catch((err) => { errors.push(`Wikipedia: ${err?.message || err}`); return []; });
  const categoryP = (noExtra ? Promise.resolve([]) : searchCommonsCategory(core, { limit }))
    .then((rows) => { category = rows; return rows; })
    .catch((err) => { errors.push(`Commons category: ${err?.message || err}`); return []; });
  const openiP = searchOpenI(q, { limit })
    .then((rows) => { openi = rows; return rows; })
    .catch((err) => {
      errors.push(`Open-i: ${err?.message || err}`);
      return [];
    });
  // Stage 1: the condition's own article and category (two quick requests). Stage 2, only when these found fewer than
  // three pictures: the Commons text search. Fewer requests also means fewer HTTP 429 answers from Wikimedia.
  const within = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
  await within(Promise.all([articleP, categoryP]), 6000);
  if (category.length + article.length < 3) {
    // The full phrase must match every word in a Commons title or description; if it finds nothing, the diagnosis alone is tried.
    const commonsP = searchCommons(q, { limit: Math.ceil(limit / 2) })
      .then(async (rows) => (rows.length || core === q ? rows : searchCommons(core, { limit: Math.ceil(limit / 2) })))
      .then((rows) => { commons = rows; return rows; })
      .catch((err) => { errors.push(`Wikimedia Commons: ${err?.message || err}`); return []; });
    await within(commonsP, 6000);
  }
  // Open-i has been running the whole time; it only gets a short extra wait.
  await within(openiP, 1500);
  const seen = new Set();
  const merged = [];
  // The condition's own category and article first, then Commons search, then journal figures (often multi-panel).
  for (const item of [...category, ...article, ...commons, ...openi]) {
    if (seen.has(item.imageUrl)) continue;
    seen.add(item.imageUrl);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  imageLog({
    query: q,
    commons: commons.length,
    openi: openi.length,
    total: merged.length,
    top: merged[0] ? `${merged[0].provider}: ${merged[0].title}`.slice(0, 160) : null,
    errors,
  });
  searchCache.set(cacheKey, { at: Date.now(), results: merged });
  if (merged.length && !noExtra) diskSet(cacheKey, merged);
  return { results: merged, errors };
}

/** Wikimedia Commons search (also covers CDC PHIL material). Licence-filtered. */
async function searchCommons(q, { limit = 3 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '1000',
  });
  const res = await wikiFetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Commons returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return mapCommonsPages(body?.query?.pages ? Object.values(body.query.pages) : [], limit, 'Wikimedia Commons');
}

/** Turns MediaWiki imageinfo pages into reusable figures (size, type and licence are checked). */
function mapCommonsPages(pages, limit, provider) {
  const out = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp|gif)$/i.test(info.mime || '')) continue;
    if ((info.width || 0) < 400 || (info.height || 0) < 250) continue;
    const meta = info.extmetadata || {};
    const licenceName = stripHtml(meta.LicenseShortName?.value);
    if (!/public domain|cc0|cc by(?!-nc|-nd)/i.test(licenceName)) continue;
    if (/non-?commercial|-nc|no-?deriv|-nd/i.test(licenceName)) continue;
    const imageUrl = info.thumburl || info.url;
    if (!imageUrl) continue;
    out.push({
      id: createHash('sha1').update(imageUrl).digest('hex').slice(0, 16),
      provider,
      title: stripHtml(page.title.replace(/^File:/, '')).slice(0, 160),
      caption: stripHtml(meta.ImageDescription?.value).slice(0, 400),
      credit: stripHtml(meta.Artist?.value).slice(0, 160) || 'Wikimedia Commons contributor',
      licence: licenceName,
      licenceUrl: info.descriptionurl || '',
      articleUrl: info.descriptionurl || '',
      modality: '',
      imageUrl,
      proxyUrl: `/api/images/proxy?u=${encodeURIComponent(imageUrl)}`,
      thumbUrl: info.thumburl || imageUrl,
    });
    if (out.length >= limit) break;
  }
  return out;
}

const IMAGEINFO = { prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1000' };

/** The pictures used in the Wikipedia article that best matches the query: relevant by construction. */
async function searchWikipediaArticle(q, { limit = 6 } = {}) {
  const find = new URLSearchParams({ action: 'query', format: 'json', list: 'search', srsearch: q, srlimit: '1', srnamespace: '0' });
  const hit = await wikiFetch(`https://en.wikipedia.org/w/api.php?${find}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!hit.ok) throw new Error(`Wikipedia returned HTTP ${hit.status}`);
  const title = (await hit.json().catch(() => ({})))?.query?.search?.[0]?.title;
  if (!title) return [];
  const params = new URLSearchParams({ action: 'query', format: 'json', generator: 'images', titles: title, gimlimit: '40', redirects: '1', ...IMAGEINFO });
  const res = await wikiFetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return mapCommonsPages(body?.query?.pages ? Object.values(body.query.pages) : [], limit, 'Wikipedia article');
}

/** The files in the Commons category named after the condition (for example "Category:Caseous necrosis"). */
async function searchCommonsCategory(q, { limit = 6 } = {}) {
  const name = q.trim().replace(/\s+/g, ' ');
  const title = `Category:${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const params = new URLSearchParams({ action: 'query', format: 'json', generator: 'categorymembers', gcmtitle: title, gcmtype: 'file', gcmlimit: '30', ...IMAGEINFO });
  const res = await wikiFetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Commons category returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return mapCommonsPages(body?.query?.pages ? Object.values(body.query.pages) : [], limit, 'Wikimedia Commons');
}

async function searchOpenI(q, { limit = 6 } = {}) {
  const params = new URLSearchParams({ query: q, m: '1', n: String(Math.max(12, limit * 4)) });
  const res = await fetch(`${OPENI}/api/search?${params}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Open-i returned HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const list = Array.isArray(body?.list) ? body.list : [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const item = normalise(row);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Metadata-only diagnostics for image lookups (query, counts, top title — never bytes). */
function imageLog(entry) {
  try {
    const dir = join(DATA_ROOT, 'logs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'images.log'),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      { flag: 'a' },
    );
  } catch { /* logging must never break a search */ }
}

/** Fetch (and cache) one external figure so the app never hotlinks the source site. */
export async function fetchImage(url) {
  const target = String(url || '');
  const allowed =
    /^https:\/\/openi\.nlm\.nih\.gov\/imgs\/[\w./%\-]+$/.test(target) ||
    /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/[\w./%\-]+(?:\?[\w=&.%\-]+)?$/.test(target);
  if (!allowed) {
    throw new Error('Unsupported image host.');
  }
  const key = createHash('sha1').update(target).digest('hex');
  const file = join(CACHE_DIR, key);
  if (existsSync(file)) {
    return { buffer: readFileSync(file), type: sniffType(file) };
  }
  const res = await fetch(target, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Image fetch failed (HTTP ${res.status})`);
  const type = res.headers.get('content-type') || 'image/png';
  if (!/^image\//.test(type)) throw new Error('Upstream did not return an image.');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Image too large.');
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, buffer);
  return { buffer, type };
}

function sniffType(file) {
  const head = readFileSync(file).subarray(0, 4);
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  return 'image/png';
}

/** Reference-only sources (never scraped) shown in Settings. */
export const REFERENCE_SOURCES = [
  { name: 'Radiopaedia', url: 'https://radiopaedia.org/', note: 'Radiologist-reviewed cases. Copyright — open the case on their site.' },
  { name: 'DermNet', url: 'https://dermnetnz.org/images', note: 'Dermatology atlas. Copyright — reference only.' },
  { name: 'RSNA Case Collection', url: 'https://cases.rsna.org/', note: 'Peer-reviewed radiology cases. Copyright — reference only.' },
  { name: 'MedPix (NLM)', url: 'https://medpix.nlm.nih.gov/', note: 'Personal/local teaching use only; permission needed for redistribution.' },
  { name: 'Columbia Ophthalmology Atlas', url: 'https://www.vagelos.columbia.edu/departments-centers/ophthalmology/education/digital-reference-ophthalmology', note: 'Fundus/eye atlas. Reference only.' },
  { name: 'Life in the Fast Lane', url: 'https://litfl.com/library/', note: 'ECGs and emergency cases. Copyright — reference only.' },
  { name: 'CDC PHIL', url: 'https://wwwn.cdc.gov/phil/', note: 'Public-health images; many are public domain, surfaced here via Wikimedia Commons.' },
];
