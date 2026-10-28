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
  timeoutMs = 9000,
): Promise<LiveImage | null> {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q || !isLiveImageSearchEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    if (!res.ok) return null;
    const body: any = await res.json().catch(() => ({}));
    const rows: LiveImage[] = Array.isArray(body?.results) ? body.results : [];
    // Only accept a figure whose own title/caption mentions the requested finding, so a
    // loose search result cannot put an unrelated picture on a clinical item.
    const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    const relevant = (row: LiveImage) => {
      if (!tokens.length) return true;
      const hay = `${row.title} ${row.caption}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    };
    const pick = rows.find((row) =>
      typeof row?.proxyUrl === 'string' &&
      !(exclude?.has(row.id) || exclude?.has(row.imageUrl) || exclude?.has(row.proxyUrl)) &&
      relevant(row),
    );
    return pick ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One-line attribution for a live figure. */
export function liveImageCaption(image: LiveImage): string {
  const caption = image.caption || image.title || 'Clinical figure';
  return `${caption} — ${image.credit} · ${image.licence} · Open-i/NLM`;
}
