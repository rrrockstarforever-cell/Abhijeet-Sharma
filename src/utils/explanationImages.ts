// Illustrations for AI explanations.
//
// Design constraints (same rules as the question pipeline):
//  - The model is only ever allowed to describe WHAT it wants ("chest X-ray of a tension
//    pneumothorax"). It never writes a URL, so it cannot invent, hotlink or hallucinate an
//    image address.
//  - The server matches that description against the curated bank and vision-verifies the
//    winner before returning it. Unverified => no image; the explanation stays text-only.
//  - The reply text is never delayed by a vision call: the explanation is returned first
//    and the illustration is resolved afterwards, so a slow model cannot stall the answer.

/** One resolved, already-verified illustration. */
export interface ExplanationImage {
  imageId: string;
  imageUrl: string;
  source: string;
  sourceUrl: string;
  licence: string;
  attribution: string;
  modality: string;
  subject: string;
  /** the verifier's one-line reason (not shown to students) */
  verification: string;
}

const TOGGLE_KEY = 'pulse.explanations.images.v1';

/**
 * Whether explanations may attach an illustration. Defaults ON; the learner can switch it
 * off per browser, and in that case no lookup (and no vision call) is ever made.
 */
export function isExplanationImagesEnabled(): boolean {
  try {
    const raw = localStorage.getItem(TOGGLE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setExplanationImagesEnabled(enabled: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, enabled ? '1' : '0'); } catch { /* storage unavailable */ }
}

/**
 * Pull the machine-readable image request out of a reply. The model is asked to end its
 * answer with a line `IMAGE_CUE: <description>` (or `IMAGE_CUE: NONE`). Returns '' when
 * there is nothing usable, so the caller simply shows no image.
 */
export function extractImageCue(text: string): string {
  const m = String(text || '').match(/^[ \t>*-]*IMAGE[_ ]CUE\s*:\s*(.+)$/im);
  if (!m) return '';
  const raw = m[1].trim().replace(/^["'`]|["'`]$/g, '').trim();
  if (!raw || /^(none|n\/?a|no image|null|-)$/i.test(raw)) return '';
  // A URL is never a valid cue — that would mean the model is choosing the picture.
  if (/^https?:\/\//i.test(raw) || /\/api\/images\//i.test(raw)) return '';
  return raw.slice(0, 300);
}

/** Remove the `IMAGE_CUE:` directive so it is never shown to the learner. */
export function stripImageCue(text: string): string {
  return String(text || '')
    .split('\n')
    .filter((line) => !/^[ \t>*-]*IMAGE[_ ]CUE\s*:/i.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * When the model returns a single dense paragraph (common for JSON-mode replies that omit
 * newlines), insert soft paragraph breaks at natural sentence boundaries so the answer does
 * not render as one tightly packed wall of text. Existing newlines/blank lines are preserved.
 */
export function expandDenseParagraph(text: string): string {
  const cleaned = stripImageCue(text);
  if (cleaned.includes('\n')) return cleaned; // already has paragraph structure
  if (cleaned.length < 240) return cleaned; // short answer — no need to split

  // Split into sentences, keeping the terminating punctuation.
  const sentences = cleaned.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g);
  if (!sentences || sentences.length < 3) return cleaned;

  // Group ~3 sentences per paragraph so the answer breathes without becoming a
  // ragged list of one-line paragraphs.
  const PER_PARAGRAPH = 3;
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += PER_PARAGRAPH) {
    paras.push(sentences.slice(i, i + PER_PARAGRAPH).join(' ').trim());
  }
  return paras.join('\n\n');
}

// Verification is slow and a cue repeats across turns ("chest X-ray"), so results are
// memoised per cue for the lifetime of the page.
const cueCache = new Map<string, ExplanationImage | null>();

/**
 * Resolve a cue to a VERIFIED bank image. Fail-closed: any error, no provider, no match or
 * a failed vision check yields null and the explanation simply has no illustration.
 */
export async function resolveExplanationImage(cue: string, subject?: string): Promise<ExplanationImage | null> {
  const description = String(cue || '').trim();
  if (!description || !isExplanationImagesEnabled()) return null;
  const key = `${(subject || '').toLowerCase()}::${description.toLowerCase()}`;
  if (cueCache.has(key)) return cueCache.get(key) ?? null;
  try {
    const res = await fetch('/api/images/find-for-explanation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cue: description, subject }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.found !== true || typeof body.imageUrl !== 'string') {
      // Cache the negative too — a fruitless lookup should not be retried every turn.
      cueCache.set(key, null);
      return null;
    }
    const image: ExplanationImage = {
      imageId: String(body.imageId || ''),
      imageUrl: body.imageUrl,
      source: String(body.source || ''),
      sourceUrl: String(body.sourceUrl || ''),
      licence: String(body.licence || ''),
      attribution: String(body.attribution || ''),
      modality: String(body.modality || ''),
      subject: String(body.subject || ''),
      verification: String(body.verification || ''),
    };
    cueCache.set(key, image);
    return image;
  } catch {
    return null;
  }
}

/**
 * Append the image-request instruction to a prompt. `cue` is the wording handed to the
 * model; it is told to describe, never to link.
 */
export function imageCueInstruction(): string {
  return [
    '',
    'IMAGE REQUEST (optional): if — and only if — a figure would materially help this explanation,',
    'end your reply with one final line exactly like:',
    'IMAGE_CUE: <a short description of the single most useful image, e.g. "chest X-ray of tension pneumothorax">',
    'Describe only the FINDING and MODALITY. Never output a URL, filename, link or markdown image.',
    'If no image would genuinely help, end with: IMAGE_CUE: NONE',
  ].join('\n');
}
