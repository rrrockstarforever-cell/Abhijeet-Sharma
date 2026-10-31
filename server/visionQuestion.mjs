// Write an exam-standard MCQ FROM a single clinical image (image-first generation).
//
// Why this exists: the previous pipeline wrote the question first and then searched
// for "a picture to fit" — which produced unrelated images (a tangerine for a corneal
// question). Here the image is the primary source of truth and the question is derived
// from it, so the correct answer genuinely depends on what the image shows.
//
// The caller supplies the authoritative diagnosis/finding (from the curated bank), and
// the prompt forbids the model from changing it. The model must return an
// {"error":"image_mismatch"} object instead of inventing a question when it cannot
// actually see the claimed finding in the image.
import { fetchImage } from './images.mjs';

export const DEFAULT_VISION_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const EXAM_LABEL = {
  NEET_PG: 'NEET-PG (NBEMS, India)',
  INI_CET: 'INI-CET (AIIMS, India)',
  AMC_CAT: 'AMC CAT (Australia)',
};

const SYSTEM = [
  'You are a senior item writer for Indian and Australian postgraduate medical entrance exams (NEET-PG, INI-CET, AMC CAT).',
  'You are shown a REAL clinical image. The image is the primary source of truth.',
  'Write questions that DISCRIMINATE between well-prepared candidates: exactly one defensible best answer, and distractors that are real, plausible close mimics of the same category — never absurd, never obviously wrong.',
  'Always respond with ONLY a single valid JSON object (no markdown fences, no commentary).',
].join(' ');

const INSTRUCTION_TEMPLATE = (o) => [
  `You are shown a real clinical image (modality: ${o.modality || 'clinical image'}; subject: ${o.subject || 'medicine'}).`,
  `The authoritative diagnosis/finding this image shows is: "${o.groundTruth}". You MUST keep this exact diagnosis — never change, soften or replace it.`,
  `Exam: ${o.examLabel}. Write ONE exam-standard MCQ whose correct answer can be reached ONLY by correctly interpreting THIS image.`,
  'Rules:',
  '- The stem must describe the relevant clinical context WITHOUT giving the answer away, and must NOT name the diagnosis directly.',
  '- Exactly one option must be the correct diagnosis/finding; every other option must be a plausible close mimic of the SAME category (no obviously wrong fillers).',
  '- The explanation MUST explicitly reference the visual features in THIS image that point to the answer (e.g. "the radiograph shows a dense right lower zone opacity with air bronchograms...").',
  `- Return exactly ${o.optionCount} options, keyed "A".."${'ABCDE'[o.optionCount - 1]}", with a single correct one.`,
  '- If you cannot actually see the claimed finding in this image, DO NOT invent a question. Return exactly {"error":"image_mismatch"}.',
  'Return ONLY this JSON object:',
  `{"stem":"...","questionText":"...","options":{${Array.from({ length: o.optionCount }, (_, i) => `"${'ABCDE'[i]}":"..."`).join(',')}},"correctOption":"A","explanation":"...","boardPearl":"...","citations":["..."]}`,
].join('\n');

/** Tolerant JSON extraction: handles fences, surrounding prose and unquoted values. */
export function parseLooseJson(text) {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (end > -1) t = t.slice(0, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to the tolerant passes */
  }
  // Brace-matching scan: pull out the first balanced {...} block.
  const first = t.indexOf('{');
  if (first >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = first; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(t.slice(first, i + 1)); } catch { /* keep trying */ }
          break;
        }
      }
    }
  }
  // Last resort: quote bare (unquoted) string values, e.g. "reason": hello world
  const patched = t
    .replace(/:\s*([A-Za-z][^,{}\[\]"]*?)(?=\s*[,}])/g, (_m, v) => `: ${JSON.stringify(v.trim())}`);
  try { return JSON.parse(patched); } catch { return null; }
}

function contentToText(message) {
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
    if (joined.trim()) return joined;
  }
  // Reasoning models sometimes place the whole answer in reasoning_content.
  if (typeof message?.reasoning_content === 'string') return message.reasoning_content;
  return '';
}

/**
 * Write one MCQ from a single verified image. Throws a plain Error with an actionable
 * message on any failure (missing key, unsupported type, model refusal, bad JSON), so
 * the caller can fall back to a text-only question.
 */
export async function generateQuestionFromImage(opts) {
  const {
    imageUrl,
    groundTruth,
    modality = '',
    subject = '',
    exam = 'NEET_PG',
    difficultyTier = 'MEDIUM',
    optionCount = 4,
    apiKey,
    model,
    timeoutMs = Number(process.env.VISION_TIMEOUT_MS || 180000),
  } = opts || {};

  if (!imageUrl) throw new Error('imageUrl is required.');
  if (!groundTruth || !String(groundTruth).trim()) throw new Error('groundTruth is required.');
  if (!apiKey) throw new Error('No vision provider connected — cannot write from image.');

  const count = optionCount === 5 ? 5 : 4;
  const { buffer, type } = await fetchImage(imageUrl);
  if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
    throw new Error(`Unsupported image type (${type}) for vision generation.`);
  }
  const dataUrl = `data:${type};base64,${buffer.toString('base64')}`;

  const instruction = INSTRUCTION_TEMPLATE({
    groundTruth: String(groundTruth).slice(0, 300),
    modality: String(modality || '').slice(0, 40),
    subject: String(subject || '').slice(0, 60),
    examLabel: EXAM_LABEL[exam] || exam,
    optionCount: count,
  });

  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];

  /** One vision call. `maxTokens` only differs between the first try and the retry. */
  const callVision = async (maxTokens) => {
    const payload = JSON.stringify({
      model: model || DEFAULT_VISION_MODEL,
      messages,
      // The vision model card recommends temperature 0.6 / top_p 0.95 for images.
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: maxTokens,
      // This is a reasoning model whose hidden trace is billed against max_tokens, which
      // is exactly why a modest cap produced finish_reason:"length" and empty content.
      // Writing a full clinical MCQ does benefit from some reasoning, so keep the trace
      // but trim it with medium_effort rather than letting it run unbounded.
      chat_template_kwargs: { enable_thinking: true, medium_effort: true },
    });
    const res = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await res.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const err = new Error(`Vision generation failed (HTTP ${res.status}): ${body?.error?.message || body?.message || raw.slice(0, 160)}`);
      err.status = res.status;
      throw err;
    }
    const choice = body?.choices?.[0];
    return { text: contentToText(choice?.message), finish: choice?.finish_reason };
  };

  // Transient upstream failures (5xx / connection errors) are not the caller's fault and
  // are usually gone a moment later, so one spaced retry is worth it rather than
  // dropping the image and falling back to text.
  const isTransient = (err) =>
    err?.status >= 500 || /inference connection|ECONNRESET|socket hang up|fetch failed|EAI_AGAIN/i.test(String(err?.message || ''));

  const callVisionWithRetry = async (maxTokens) => {
    try {
      return await callVision(maxTokens);
    } catch (err) {
      if (!isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      return await callVision(maxTokens);
    }
  };

  // A reasoning model spends part of the budget on hidden reasoning; too small a cap
  // yields finish_reason 'length' with EMPTY content. A full MCQ + explanation needs
  // generous headroom, so the default is deliberately large.
  let budget = Number(process.env.VISION_MAX_TOKENS || 8192);
  let { text, finish } = await callVisionWithRetry(budget);
  let parsed = parseLooseJson(text);

  // The reply was cut off before it could answer: the work is still viable, we simply
  // starved it. Retry ONCE with a doubled budget rather than reporting a failure — this
  // is the one case where a second request genuinely salvages the question.
  if ((!parsed || typeof parsed !== 'object' || parsed.error === 'image_mismatch') && finish === 'length') {
    budget *= 2;
    ({ text, finish } = await callVisionWithRetry(budget));
    parsed = parseLooseJson(text);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      finish === 'length'
        ? `Vision model ran out of tokens before answering (even at ${budget}).`
        : 'Vision model did not return usable JSON.',
    );
  }
  if (parsed.error === 'image_mismatch') {
    throw new Error('image_mismatch');
  }

  const stem = typeof parsed.stem === 'string' ? parsed.stem.trim() : '';
  if (!stem) throw new Error('Vision model returned no stem.');

  // Normalise options to {"A":"..."} and validate the correct key is present.
  const options = {};
  if (parsed.options && typeof parsed.options === 'object' && !Array.isArray(parsed.options)) {
    for (const [k, v] of Object.entries(parsed.options)) {
      if (typeof v === 'string' && v.trim()) options[String(k).trim().toUpperCase()] = v.trim();
    }
  } else if (Array.isArray(parsed.options)) {
    for (const o of parsed.options) {
      if (o && typeof o.text === 'string' && o.text.trim()) {
        options[String(o.id ?? '').trim().toUpperCase()] = o.text.trim();
      }
    }
  }
  const keys = ['A', 'B', 'C', 'D', 'E'].slice(0, count);
  for (const k of keys) {
    if (!options[k]) throw new Error(`Vision model returned an incomplete option set (missing ${k}).`);
  }
  const correctOption = String(parsed.correctOption || '').trim().toUpperCase();
  if (!keys.includes(correctOption)) throw new Error('Vision model returned an invalid correctOption.');

  const citations = Array.isArray(parsed.citations)
    ? parsed.citations.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim()).slice(0, 5)
    : [];

  return {
    stem,
    questionText: typeof parsed.questionText === 'string' && parsed.questionText.trim() ? parsed.questionText.trim() : stem,
    options: Object.fromEntries(keys.map((k) => [k, options[k]])),
    correctOption,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
    boardPearl: typeof parsed.boardPearl === 'string' ? parsed.boardPearl.trim() : '',
    citations,
  };
}
