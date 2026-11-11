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

const IMAGE_SUBJECT_ALIASES: Record<string, string[]> = {
  Radiology: ['radiology', 'radiodiagnosis and radiotherapy'],
  Dermatology: ['dermatology', 'dermatology and venereology'],
  Ophthalmology: ['ophthalmology'],
  Pathology: ['pathology'],
  Cardiology: ['cardiology'],
  Orthopaedics: ['orthopaedics', 'orthopedics'],
};

const normalizeImageSubject = (value: string) => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

export function imageBankSubjectsForLabels(labels: string[]): string[] {
  const selected = new Set(labels.map(normalizeImageSubject));
  return Object.entries(IMAGE_SUBJECT_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => selected.has(normalizeImageSubject(alias))))
    .map(([subject]) => subject);
}

export function selectVerifiedImageQuestions(results: Array<ImageQuestionResult | null>, count: number): ClinicalQuestion[] {
  return results
    .filter((result): result is ImageQuestionResult => Boolean(
      result?.verification.pass && result.question.imageVerified === true && result.question.image,
    ))
    .slice(0, count)
    .map((result) => result.question);
}

export function unsupportedImageDetailCode(
  question: Pick<ClinicalQuestion, 'stem' | 'questionText' | 'options' | 'correctOption'>,
  image: BankImage,
): string | null {
  const keyedAnswer = question.options.find((option) => option.id === question.correctOption)?.text || '';
  const stemText = `${question.stem} ${question.questionText}`;
  const text = `${stemText} ${keyedAnswer}`;
  const trustedMetadata = `${image.ground_truth} ${image.body_part || ''} ${image.modality || ''}`;
  const planeClaim = /\b(axial|sagittal|coronal|transverse)\b/i.exec(text)?.[1]?.toLowerCase();
  const modalityAndPart = `${image.modality || ''} ${image.body_part || ''}`.toLowerCase();
  // These are conventional acquisition planes strongly implied by the study type;
  // arbitrary planes still need explicit support in the bank metadata.
  const impliedPlanes = /\b(?:ct|computed tomography)\b/.test(modalityAndPart) && /\b(?:brain|head)\b/.test(modalityAndPart)
    ? ['axial', 'transverse']
    : /\bmri\b/.test(modalityAndPart) && /\bspine\b/.test(modalityAndPart)
      ? ['sagittal', 'axial', 'transverse']
      : [];
  // A routine CT head/brain is conventionally acquired without IV contrast unless
  // the bank explicitly says otherwise. Other CT regions do not imply a phase.
  const impliedNonContrastHeadCt = /\b(?:ct|computed tomography)\b/.test(modalityAndPart)
    && /\b(?:brain|head)\b/.test(modalityAndPart);
  const claims: Array<[string, RegExp]> = [
    ['skin-surface', /\b(?:palm|palms|palmar|volar)\b/i],
    ['skin-surface', /\b(?:dorsum|dorsal|back of (?:the )?hand)\b/i],
    ['skin-surface', /\b(?:sole|soles|plantar)\b/i],
    ['scan-plane', /\b(?:axial|sagittal|coronal|transverse)\b/i],
    ['contrast-phase', /\b(?:non[- ]?contrast|contrast[- ]enhanced|pre[- ]contrast|post[- ]contrast)\b/i],
  ];
  const unsupportedDetail = claims.find(([code, claim]) => claim.test(text) && !claim.test(trustedMetadata)
    && !(code === 'scan-plane' && planeClaim && impliedPlanes.includes(planeClaim))
    && !(code === 'contrast-phase' && /\bnon[- ]?contrast\b/i.test(text) && impliedNonContrastHeadCt));
  if (unsupportedDetail) return unsupportedDetail[0];

  const sideClaim = /\b(?:left|right|bilateral|unilateral)\b/i;
  const visualNoun = '(?:image|radiograph|x-?ray|ct|mri|ecg|fundus|photograph|film|scan)';
  // A side named before the picture ("right-sided chest X-ray") or after it ("X-ray shows a left ...") is a claim about the picture.
  const visualSideClaim = new RegExp(`\\b(?:left|right|bilateral|unilateral)[- ]sided\\b[^.!?]{0,60}\\b${visualNoun}\\b`, 'i').test(stemText)
    || new RegExp(`\\b${visualNoun}\\b[^.!?]{0,120}\\b(?:left|right|bilateral)\\b`, 'i').test(stemText);
  const answerHasSide = sideClaim.test(keyedAnswer);
  return (visualSideClaim || answerHasSide) && !sideClaim.test(trustedMetadata) ? 'laterality' : null;
}

export function hasUnsupportedImageDetailsClaim(
  question: Pick<ClinicalQuestion, 'stem' | 'questionText' | 'options' | 'correctOption'>,
  image: BankImage,
): boolean {
  return unsupportedImageDetailCode(question, image) !== null;
}

export function selectImageBankCandidates(candidateLists: BankImage[][], count: number): BankImage[] {
  const uniqueDiagnoses: BankImage[] = [];
  const sameDiagnosisAlternates: BankImage[] = [];
  const imageIds = new Set<string>();
  const diagnoses = new Set<string>();
  const maxLength = Math.max(0, ...candidateLists.map((list) => list.length));
  for (let i = 0; i < maxLength; i++) {
    for (const list of candidateLists) {
      const image = list[i];
      if (!image || imageIds.has(image.image_id)) continue;
      imageIds.add(image.image_id);
      const diagnosis = String(image.ground_truth ?? '').trim().toLowerCase();
      if (diagnosis && diagnoses.has(diagnosis)) sameDiagnosisAlternates.push(image);
      else {
        if (diagnosis) diagnoses.add(diagnosis);
        uniqueDiagnoses.push(image);
      }
    }
  }
  return [...uniqueDiagnoses, ...sameDiagnosisAlternates].slice(0, count);
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
    const err = new AiError(`A vision provider is not available. Connect a vision provider in Settings → AI Subscription Hub.`, 'not_connected');
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
  onReject?: (code: string) => void;
}): Promise<ImageQuestionResult | null> {
  const { image, exam, difficultyTier, difficultySubLevel, optionCount, provider, model, signal, onVerify, onReject } = opts;
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
        bodyPart: image.body_part || '',
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
    if (res.status === 422 || /image_mismatch/i.test(msg)) {
      onReject?.('image-mismatch');
      return null;
    }
    throw toAiError(res.status, msg);
  }

  const spec = body?.question;
  if (!spec || typeof spec.stem !== 'string' || !spec.stem.trim()) {
    onReject?.('empty-stem');
    return null;
  }

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
  if (entries.length !== optionCount) {
    onReject?.('incomplete-options');
    return null;
  }

  const correct = String(spec.correctOption || '').trim().toUpperCase() as ClinicalQuestion['correctOption'];
  if (!letters.includes(correct)) {
    onReject?.('invalid-answer-key');
    return null;
  }

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
    imageLicenceUrl: image.licenceUrl,
    imageGroundTruth: image.ground_truth,
    figureModality: image.modality,
  };

  const detailFailure = unsupportedImageDetailCode(question, image);
  if (detailFailure) {
    onReject?.(`unsupported-${detailFailure}`);
    return null;
  }

  // ---- Step 3: verify the finished item against the image before returning it ----
  const claim = `${image.ground_truth}${image.modality ? ` (${image.modality})` : ''}`;
  let verdict: { pass: boolean; reason: string } = { pass: false, reason: 'Verification not run.' };
  const controller = new AbortController();
  // The server's vision timeout is generous (a reasoning model can be slow); this is
  // only a safety net so a wedged request cannot hang the batch forever.
  const timer = setTimeout(() => controller.abort(), 200_000);
  let verificationErrored = false;
  try {
    const vres = await fetch('/api/images/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: image.imageUrl,
        claim,
        modality: image.modality || '',
        bodyPart: image.body_part || '',
        questionStem: question.stem,
        questionText: question.questionText,
        correctAnswer: question.options.find((option) => option.id === question.correctOption)?.text || '',
        explanation: question.explanation || '',
        boardPearl: question.boardPearl || '',
        provider,
        model,
      }),
      signal: controller.signal,
    });
    const vbody: any = await vres.json().catch(() => ({}));
    verdict = {
      pass: vres.ok && vbody?.pass === true,
      reason: typeof vbody?.reason === 'string' ? vbody.reason : vres.ok ? 'Not confirmed.' : `HTTP ${vres.status}`,
    };
  } catch (err: any) {
    verificationErrored = true;
    // Fail closed: an unverifiable image must never be attached.
    verdict = { pass: false, reason: err?.name === 'AbortError' ? 'Verification timed out.' : (err?.message || 'Verification failed.') };
  } finally {
    clearTimeout(timer);
  }

  question.imageVerified = verdict.pass;
  question.imageVerifyReason = verdict.reason;
  onVerify?.(verdict);

  if (!verdict.pass) {
    onReject?.(verificationErrored ? 'verification-error' : 'vision-rejected');
    return null;
  }

  return {
    question,
    imageId: image.image_id,
    groundTruth: image.ground_truth,
    modality: image.modality,
    verification: verdict,
  };
}
