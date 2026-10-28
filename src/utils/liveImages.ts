import { debugLog } from './debugLog.ts';
// Live clinical-image lookup for image-based questions.
// The local server queries Open-i (NLM) and returns only reusable licences
// (CC BY / CC BY-SA / CC0 / public domain), proxied through /api/images/proxy so the
// page never hotlinks NLM and the picture still works offline after the first fetch.

export interface LiveImage {
  id: string;
  provider: string;
  title: string;
  caption: string;
  credit: string;
  licence: string;
  licenceUrl: string;
  articleUrl: string;
  modality: string;
  imageUrl: string;
  proxyUrl: string;
  thumbUrl: string;
}

const LIVE_KEY = 'pulse.images.live';

// Session cache: image search is slow (Commons + Open-i), so the same query is only
// ever fetched once per page load.
const rowsCache = new Map<string, LiveImage[]>();

export function isLiveImageSearchEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setLiveImageSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIVE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Best **unused** reusable figure for a query, or null (never throws — generation must
 * not fail). Pass the ids of images already used in this run so a module never repeats one.
 */
export async function findLiveImage(
  query: string,
  exclude?: Set<string>,
  timeoutMs = 12000,
): Promise<LiveImage | null> {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q || !isLiveImageSearchEnabled()) return null;

  // Build a list of progressively simpler queries to try. Long, highly-specific
  // phrases (e.g. "acute angle closure mid-dilated pupil hazy cornea") almost
  // never match anything in Open-i / Commons, so we fall back to shorter
  // variants that name the modality + the core finding.
  const variants: string[] = [q];
  const words = q.split(/\s+/);
  if (words.length > 4) {
    // Last 3-4 words usually carry the modality + key finding.
    variants.push(words.slice(-4).join(' '));
    variants.push(words.slice(-3).join(' '));
    variants.push(words.slice(-2).join(' '));
  }
  if (words.length > 2) {
    // Drop leading adjective-heavy words.
    variants.push(words.slice(1).join(' '));
  }
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const tries = variants.filter((v) => {
    const k = v.toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const deadline = Date.now() + Math.max(timeoutMs, 12000);
  for (const tryQ of tries) {
    const remaining = deadline - Date.now();
    if (remaining < 2500) break;
    debugLog('H8', `trying query: "${tryQ}" (${Math.round(remaining / 1000)}s left)`);
    const controller = new AbortController();
    // Each variant gets its own budget: a cold search (Commons + Open-i + licence
    // check) can take 5–15 s, so a short per-variant timeout made every attempt abort.
    const timer = setTimeout(() => controller.abort(), Math.min(15000, remaining));
    try {
      const cacheKey = tryQ.toLowerCase();
      let rows: LiveImage[] = rowsCache.get(cacheKey) ?? [];
      if (!rowsCache.has(cacheKey)) {
        const res = await fetch(`/api/images/search?q=${encodeURIComponent(tryQ)}`, { signal: controller.signal });
        debugLog('H8', `query "${tryQ}" -> status ${res.status}`);
        if (!res.ok) continue;
        const body: any = await res.json().catch(() => ({}));
        rows = Array.isArray(body?.results) ? body.results : [];
        rowsCache.set(cacheKey, rows);
      } else {
        debugLog('H8', `query "${tryQ}" -> cache hit (${rows.length} rows)`);
      }
      debugLog('H8', `query "${tryQ}" -> ${rows.length} results`);
      const expanded = tryQ.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 || ['ecg', 'ct', 'mri', 'xray'].includes(t));
      const MODALITY_ALIASES: Record<string, string[]> = {
        ecg: ['ecg', 'ekg', 'electrocardiogram', 'electrocardiography'],
        'x-ray': ['x-ray', 'xray', 'radiograph', 'chest film'],
        xray: ['x-ray', 'xray', 'radiograph'],
        ct: ['ct', 'computed tomography'],
        mri: ['mri', 'magnetic resonance'],
        ultrasound: ['ultrasound', 'sonograph', 'echograph'],
        histology: ['histology', 'histological', 'biopsy', 'micrograph'],
        fundus: ['fundus', 'fundal', 'retina'],
      };
      const expandedTokens = expanded.flatMap((t) => [t, ...(MODALITY_ALIASES[t] ?? [])]);
      const modalityTokens = expandedTokens.filter((t) =>
        ['ecg', 'ekg', 'electrocardiogram', 'electrocardiography', 'x-ray', 'xray',
         'radiograph', 'ct', 'mri', 'ultrasound', 'histology', 'fundus', 'retina'].includes(t),
      );
      const relevant = (row: LiveImage) => {
        const hay = `${row.title} ${row.caption}`.toLowerCase();
        const matches = (t: string) =>
          t.length <= 3 ? new RegExp(`\\b${t}\\b`, 'i').test(hay) : hay.includes(t);
        // Topic tokens are the non-modality words of the query.
        const topicTokens = expandedTokens.filter((t) => !modalityTokens.includes(t));
        const topicOk = topicTokens.length === 0 || topicTokens.some(matches);
        if (modalityTokens.length > 0) {
          // Both the modality AND at least one topic word must appear in the figure's
          // own title/caption — a histology slide of an adrenal tumour is not a
          // verified picture for a hypertension question.
          return topicOk && modalityTokens.some(matches);
        }
        // No modality: require ALL topic tokens to match (stricter verification).
        const topicMatches = expandedTokens.filter(matches).length;
        return topicMatches === expandedTokens.length && expandedTokens.length > 0;
      };
      const unused = rows.filter((row) =>
        typeof row?.proxyUrl === 'string' &&
        !(exclude?.has(row.id) || exclude?.has(row.imageUrl) || exclude?.has(row.proxyUrl)),
      );
      debugLog('H8', `query "${tryQ}" -> unused=${unused.length} expandedTokens=${expandedTokens.join(',')}`);
      // Only accept a figure whose own text names the finding — never fall back to an
      // unrelated picture just to have one. "Verified images" means relevant images.
      const found = unused.find(relevant);
      if (found) {
        debugLog('H8', `query "${tryQ}" -> FOUND ${found.id} ${found.title}`);
        return found;
      }
      // Nothing reusable for this variant: remember whether the backend gave us rows
      // at all so a total outage is distinguishable from "no matching figure".
      debugLog('H8', `query "${tryQ}" -> no verified figure (rows=${rows.length})`);
    } catch (e: any) {
      debugLog('H8', `query "${tryQ}" -> ERROR: ${e.message}`);
      // try next variant
    } finally {
      clearTimeout(timer);
    }
  }
  debugLog('H8', 'all variants exhausted -> null');
  return null;
}

/** One-line attribution for a live figure. */
export function liveImageCaption(image: LiveImage): string {
  const caption = image.caption || image.title || 'Clinical figure';
  return `${caption} — ${image.credit} · ${image.licence} · Open-i/NLM`;
}
