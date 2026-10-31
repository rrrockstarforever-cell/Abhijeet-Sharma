// Image-first MCQ generation (client half).
//
// Inverts the old pipeline: instead of writing a question and *then* hunting for a
// picture to fit it (which produced unrelated images), we start from a curated bank
// image whose diagnosis is already known, ask a vision model to write the question
// FROM that image, then verify the result before it is ever shown.
import type { ClinicalQuestion, ExamType, DifficultyTier, DifficultySubLevel } from '../types.ts';
import { AiError, type AiProviderId } from './ai.ts';

/** One curated bank image, with the trusted metadata the bank guarantees. */
export interface BankImage {
  image_id: string;
  source: string;
  sourceUrl: string;
  imageUrl: string;
  previewUrl: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  ground_truth: string;
  modality: string;
  subject: string;
  body_part?: string;
}

export interface ImageQuestionResult {
  question: ClinicalQuestion;
  imageId: string;
  groundTruth: string;
  modality: string;
  verification: { pass: boolean; reason: string };
}

/**
 * One-line attribution for a bank image.
 *
 * SECURITY/EXAM-INTEGRITY: this string is rendered ABOVE the image, before the student
 * answers. It must therefore never contain the ground-truth diagnosis (which IS the
 * answer) — an earlier version prefixed it and leaked "PANCREATITIS — HELLERHOFF…" on
 * every item. Attribution and licence only; the diagnosis stays in `imageGroundTruth`
 * for verification and post-answer review.
 */
function bankImageCaption(image: BankImage): string {
  const bits = [image.attribution, image.licence].filter(Boolean);
  return bits.join(' · ').slice(0, 240) || 'Licensed clinical image';
}

/** Map a non-OK response to a typed AiError, matching aiComplete's behaviour. */
function toAiError(status: number, serverMsg: string): AiError {
  if (status === 401) {
    const err = new AiError(`NVIDIA is not connected. Connect a vision provider in Settings → AI Subscription Hub.`, 'not_connected');
    err.status = 401;
    return err;
  }
  const err = new AiError(serverMsg, 'api');
  err.status = status;
  return err;
}

/**
 * Generate ONE image-first question from a bank image, then verify it.
 * Returns null when the model refuses (image mismatch), the reply is unusable, or the
 * verification fails — so the caller can fall back to a plain text-only question.
 * Genuine provider/network failures are thrown as AiError.
 */
export async function generateImageFirstQuestion(opts: {
  image: BankImage;
  exam: ExamType;
  difficultyTier: DifficultyTier;
  difficultySubLevel?: DifficultySubLevel;
  optionCount: number;
  provider?: AiProviderId;
  model?: string;
  signal?: AbortSignal;
  onVerify?: (v: { pass: boolean; reason: string }) => void;
}): Promise<ImageQuestionResult | null> {
  const { image, exam, difficultyTier, difficultySubLevel, optionCount, provider, model, signal, onVerify } = opts;
  const tier = difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier;

  // ---- Step 1: write the question FROM the image (server builds the prompt) ----
  let res: Response;
  try {
    res = await fetch('/api/images/generate-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: image.imageUrl,
        groundTruth: image.ground_truth,
        // Lets the server remember a rejected image so a later run does not spend
        // another slow vision call on the same bad candidate.
        imageId: image.image_id,
        modality: image.modality,
        subject: image.subject,
        exam,
        difficultyTier: tier,
        optionCount,
        provider,
        model,
      }),
      signal,
    });
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') throw new AiError('Generation stopped.', 'aborted');
    throw new AiError(`Could not reach the local AI server (${err?.message || 'network error'}).`, 'network');
  }

  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const msg = typeof body?.error === 'string' ? body.error : `Image-first generation failed (HTTP ${res.status}).`;
    // The model telling us the image does not show the claimed finding is a normal,
    // expected outcome — not a provider failure. Fall back to text-only.
    if (res.status === 422 || /image_mismatch/i.test(msg)) return null;
    throw toAiError(res.status, msg);
  }

  const spec = body?.question;
  if (!spec || typeof spec.stem !== 'string' || !spec.stem.trim()) return null;

  // ---- Step 2: normalise options to the app's { id, text } shape ----
  const rawOptions = spec.options;
  const byLetter: Record<string, string> = {};
  if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
    for (const [k, v] of Object.entries(rawOptions)) {
      if (typeof v === 'string' && v.trim()) byLetter[String(k).trim().toUpperCase()] = v.trim();
    }
  } else if (Array.isArray(rawOptions)) {
    for (const o of rawOptions) {
      if (o && typeof o.text === 'string' && o.text.trim()) {
        byLetter[String(o.id ?? '').trim().toUpperCase()] = o.text.trim();
      }
    }
  }
  const letters = ['A', 'B', 'C', 'D', 'E'].slice(0, optionCount) as ('A' | 'B' | 'C' | 'D' | 'E')[];
  const entries = letters.filter((k) => byLetter[k]).map((k) => ({ id: k, text: byLetter[k] }));
  if (entries.length !== optionCount) return null; // incomplete option set => unusable

  const correct = String(spec.correctOption || '').trim().toUpperCase() as ClinicalQuestion['correctOption'];
  if (!letters.includes(correct)) return null;

  const question: ClinicalQuestion = {
    id: `IMG-${exam.replace('_', '')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    moduleCode: `${exam.replace('_', '-')} · Image-First Module`,
    sourceType: 'ai-generator',
    examType: exam,
    subject: image.subject,
    // The subtopic is DISPLAYED in the runner header, so it must not name the diagnosis
    // (the answer). Use the modality/topic family instead; the exact finding is kept in
    // imageGroundTruth for verification and post-answer review only.
    subtopic: image.modality ? `${image.modality} interpretation` : 'Image interpretation',
    cognitiveTier: 'Multi-Step & IBQ',
    difficultyTier: tier,
    difficultySubLevel: difficultySubLevel ?? 'M1',
    stem: spec.stem.trim(),
    questionText: typeof spec.questionText === 'string' && spec.questionText.trim() ? spec.questionText.trim() : spec.stem.trim(),
    options: entries,
    correctOption: correct,
    boardPearl: typeof spec.boardPearl === 'string' ? spec.boardPearl.trim() : '',
    explanation: typeof spec.explanation === 'string' && spec.explanation.trim() ? spec.explanation.trim() : undefined,
    citations: Array.isArray(spec.citations)
      ? spec.citations.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim()).slice(0, 5)
      : [],
    targetAccuracy: 60,
    // Image fields come from the BANK, never from the model — no invented URLs.
    image: image.previewUrl,
    imageSourceUrl: image.sourceUrl,
    imageCaption: bankImageCaption(image),
    imageId: image.image_id,
    imageLicence: image.licence,
    imageGroundTruth: image.ground_truth,
    figureModality: image.modality,
  };

  // ---- Step 3: verify the finished item against the image before returning it ----
  const claim = `${image.ground_truth}${image.modality ? ` (${image.modality})` : ''}`;
  let verdict: { pass: boolean; reason: string } = { pass: false, reason: 'Verification not run.' };
  const controller = new AbortController();
  // The server's vision timeout is generous (a reasoning model can be slow); this is
  // only a safety net so a wedged request cannot hang the batch forever.
  const timer = setTimeout(() => controller.abort(), 200_000);
  try {
    const vres = await fetch('/api/images/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: image.imageUrl, claim, modality: image.modality }),
      signal: controller.signal,
    });
    const vbody: any = await vres.json().catch(() => ({}));
    verdict = {
      pass: vbody?.pass === true,
      reason: typeof vbody?.reason === 'string' ? vbody.reason : vres.ok ? 'Not confirmed.' : `HTTP ${vres.status}`,
    };
  } catch (err: any) {
    // Fail closed: an unverifiable image must never be attached.
    verdict = { pass: false, reason: err?.name === 'AbortError' ? 'Verification timed out.' : (err?.message || 'Verification failed.') };
  } finally {
    clearTimeout(timer);
  }

  question.imageVerified = verdict.pass;
  question.imageVerifyReason = verdict.reason;
  onVerify?.(verdict);

  // Only a verified image may be returned; otherwise the caller falls back to text-only.
  if (!verdict.pass) return null;

  return {
    question,
    imageId: image.image_id,
    groundTruth: image.ground_truth,
    modality: image.modality,
    verification: verdict,
  };
}
