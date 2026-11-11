// Checks the riskiest claims in a teaching note against live web sources. The result is shown beside
// the note and never rewrites it: the web can be wrong too, and the student's exam follows their book.
import { aiComplete, extractJson, type AiCompleteOptions } from './ai.ts';

export interface WebCheckItem {
  claim: string;
  verdict: 'confirmed' | 'conflict' | 'no-evidence';
  explanation: string;
  /** Exact words from the source. A verdict without a quote found in the source becomes no-evidence. */
  quote?: string;
  source?: { title: string; url: string };
}

export interface WebCheck {
  status: 'done' | 'failed';
  checkedAt: string;
  items: WebCheckItem[];
  error?: string;
}

interface Source {
  title: string;
  url: string;
  text: string;
}

const MAX_CLAIMS = 8;
const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const PICK_CLAIMS_SYSTEM =
  `You choose which facts in a medical revision note most need checking. Pick up to ${MAX_CLAIMS} specific claims that would do the most harm if wrong: ` +
  'numbers, age and weight bands, lines of therapy, drugs of choice, exceptions, enzyme and gene names, contraindications, and sentences marked †. ' +
  'Copy each claim as one standalone sentence that names its subject. Write a short web search query for each. ' +
  'Reply with ONLY JSON: {"claims":[{"claim":"...","query":"..."}]}';

const JUDGE_SYSTEM =
  'You compare claims from a medical revision note with web sources. Use ONLY the source text given, never your own memory. ' +
  'For each claim choose: "confirmed" if a source states the same fact; "conflict" if a source states something different; "no-evidence" if the sources do not settle it. ' +
  'For confirmed or conflict, give the source id and "quote": words copied exactly from that source that show it. ' +
  '"explanation" is one plain sentence; for a conflict, say what the source says instead. ' +
  'Reply with ONLY JSON: {"results":[{"claim":1,"verdict":"confirmed","source":"1.2","quote":"...","explanation":"..."}]}';

async function search(query: string, claim: string): Promise<Source[]> {
  const res = await fetch('/api/web/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pageChars: 30000 }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return (Array.isArray(data?.sources) ? data.sources : [])
    .filter((s: any) => typeof s?.url === 'string' && typeof s?.text === 'string' && s.text.trim())
    .slice(0, 3)
    .map((s: any) => ({ title: String(s.title || s.url), url: s.url, text: bestPassage(s.text, claim) }));
}

/** The 1500-character stretch mentioning the most words from the claim. The relevant part of a long page is rarely at the start. */
function bestPassage(text: string, claim: string): string {
  const size = 1500;
  if (text.length <= size) return text;
  const lower = text.toLowerCase();
  const words = [...new Set(claim.toLowerCase().match(/[a-z0-9-]{4,}/g) ?? [])];
  let best = 0;
  let bestHits = -1;
  for (let at = 0; at < text.length; at += 250) {
    const stretch = lower.slice(at, at + size);
    const hits = words.filter((w) => stretch.includes(w)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = at;
    }
  }
  return text.slice(best, best + size);
}

/** The provider rate-limits bursts (HTTP 429), so wait and try again before giving up. */
async function completeWithRetry(options: AiCompleteOptions): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await aiComplete(options);
    } catch (err: any) {
      if (attempt >= 3 || !/429/.test(err?.message || '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10000 * (attempt + 1)));
    }
  }
}

/** Never throws: a failure comes back as status "failed", so the note can say it was not checked. */
export async function runWebCheck(noteText: string, ai: Pick<AiCompleteOptions, 'provider' | 'model'>): Promise<WebCheck> {
  const checkedAt = new Date().toISOString();
  try {
    const picked = extractJson<{ claims?: any[] }>(await completeWithRetry({
      ...ai,
      system: PICK_CLAIMS_SYSTEM,
      messages: [{ role: 'user', content: noteText.slice(0, 24000) }],
      json: true,
      effort: 'low',
    }));
    const claims = (Array.isArray(picked?.claims) ? picked.claims : [])
      .filter((c) => typeof c?.claim === 'string' && typeof c?.query === 'string' && c.claim.trim() && c.query.trim())
      .slice(0, MAX_CLAIMS) as { claim: string; query: string }[];
    if (!claims.length) throw new Error('The AI did not pick any claims to check.');

    const sources: Source[][] = [];
    for (const c of claims) sources.push(await search(c.query, c.claim).catch(() => []));
    if (!sources.some((s) => s.length)) throw new Error('The web search returned no sources. Check your internet connection.');

    const evidence = claims
      .map((c, i) => {
        const found = sources[i].map((s, j) => `[source ${i + 1}.${j + 1}] ${s.title}\n${s.text}`).join('\n\n');
        return `CLAIM ${i + 1}: ${c.claim}\n${found || '(no sources found)'}`;
      })
      .join('\n\n---\n\n');
    const judged = extractJson<{ results?: any[] }>(await completeWithRetry({
      ...ai,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: evidence }],
      json: true,
      effort: 'low',
    }));
    const results = Array.isArray(judged?.results) ? judged.results : [];
    if (!results.length) throw new Error('The AI reply could not be read as a check result.');

    const items = claims.map((c, i): WebCheckItem => {
      const r = results.find((x) => Number(x?.claim) === i + 1);
      const unsettled: WebCheckItem = { claim: c.claim, verdict: 'no-evidence', explanation: 'The sources found did not settle this.' };
      if (r?.verdict !== 'confirmed' && r?.verdict !== 'conflict') return unsettled;
      const source = sources[i][Number(String(r.source ?? '').split('.')[1]) - 1];
      const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
      // The model must show its evidence: a quote that is not in the source does not count.
      if (!source || squeeze(quote).length < 8 || !squeeze(source.text).includes(squeeze(quote))) return unsettled;
      return {
        claim: c.claim,
        verdict: r.verdict,
        explanation: typeof r.explanation === 'string' ? r.explanation.trim() : '',
        quote,
        source: { title: source.title, url: source.url },
      };
    });
    return { status: 'done', checkedAt, items };
  } catch (err: any) {
    return { status: 'failed', checkedAt, items: [], error: err?.message || 'The web check failed.' };
  }
}

/** The check as plain text, so a printed note keeps its warnings. */
export function webCheckToText(check?: WebCheck): string {
  if (!check) return 'Web check: not run.';
  if (check.status === 'failed') return `Web check: failed. ${check.error ?? ''}`;
  const conflicts = check.items.filter((i) => i.verdict === 'conflict');
  const lines = [`Web check: ${check.items.length} claims checked, ${conflicts.length} conflicting.`];
  conflicts.forEach((i) => lines.push(`CONFLICT: ${i.claim} ${i.explanation} Source: ${i.source?.url ?? ''}`));
  return lines.join('\n');
}
