// Stage 1 - StructuralValidator. Deterministic code, no LLM.
import type { ExamProfile } from './examProfiles.ts';

export interface StructuralInput {
  stem?: string;
  questionText?: string;
  options?: { id: string; text: string }[];
  correctOption?: string;
  explanation?: string;
  subject?: string;
  subtopic?: string;
  examType?: string;
  image?: string;
  imageCaption?: string;
  statements?: unknown[];
}

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface StructuralFinding {
  stage: string;
  severity: Severity;
  category: string;
  message: string;
  detail?: string;
}

export interface StructuralResult {
  passed: boolean;
  repairable: boolean;
  findings: StructuralFinding[];
}

const VALID_OPTION_IDS = ['A', 'B', 'C', 'D', 'E'];

export function validateStructure(input: StructuralInput, profile: ExamProfile | null): StructuralResult {
  const findings: StructuralFinding[] = [];
  const add = (severity: Severity, category: string, message: string, detail?: string) =>
    findings.push({ stage: 'structural', severity, category, message, detail });

  if (!input || typeof input !== 'object') {
    return { passed: false, repairable: false, findings: [{ stage: 'structural', severity: 'critical', category: 'shape', message: 'Question object is missing or malformed.' }] };
  }

  const stem = String(input.stem ?? '').trim();
  const leadIn = String(input.questionText ?? '').trim();
  const options = Array.isArray(input.options) ? input.options : [];
  const correct = String(input.correctOption ?? '').trim().toUpperCase();

  if (!stem) add('critical', 'stem', 'Stem is empty.');
  if (!leadIn) add('critical', 'lead_in', 'Lead-in / task is empty.');
  if (stem.length > 4000) add('warning', 'stem', 'Stem is unusually long.', `${stem.length} chars`);

  const texts = options.map((o) => String(o.text ?? '').trim());
  if (options.length === 0) {
    add('critical', 'options', 'No answer options present.');
  } else if (profile && options.length !== profile.options) {
    add('error', 'options', `Expected ${profile.options} options (${profile.id}), found ${options.length}.`, 'incorrect answer-set size');
  }

  const ids = options.map((o) => String(o.id ?? '').toUpperCase());
  for (const id of ids) {
    if (id && !VALID_OPTION_IDS.includes(id)) add('error', 'options', `Invalid option identifier "${id}".`);
  }
  if (options.length && ids.some((id) => !id)) add('error', 'options', 'One or more options are missing an identifier.');
  for (let i = 0; i < texts.length; i++) {
    if (!texts[i]) add('error', 'options', `Option ${ids[i] || i + 1} is blank.`);
  }

  const uniqueTexts = new Set(texts.map((t) => t.toLowerCase().replace(/\s+/g, ' ')));
  if (texts.length > 0 && uniqueTexts.size !== texts.length) add('critical', 'options', 'Duplicate answer options detected.');

  if (!correct) {
    add('critical', 'answer_key', 'Correct answer is missing.');
  } else if (options.length && !ids.includes(correct)) {
    add('critical', 'answer_key', `Correct answer "${correct}" is not among the option identifiers.`);
  }
  if (profile && !profile.multipleCorrect && correct.length !== 1) {
    add('error', 'answer_key', 'Single-best-answer question has a multi-character key.', correct);
  }

  const explanation = String(input.explanation ?? '').trim();
  if (!explanation) add('warning', 'explanation', 'Explanation is empty.');
  else if (explanation.length < 40) add('warning', 'explanation', 'Explanation is very short.', `${explanation.length} chars`);

  if (!input.subject || !String(input.subject).trim()) add('error', 'classification', 'Subject is missing.');
  if (!input.subtopic || !String(input.subtopic).trim()) add('warning', 'classification', 'Subtopic is missing.');

  if (input.image && !/^(https?:|\/|data:image\/)/.test(String(input.image))) add('error', 'media', 'Image reference is not a valid URL/path.');
  if (input.image && !String(input.imageCaption ?? '').trim()) add('info', 'media', 'Image has no caption.');

  if (/[\uFFFD]/.test(stem + leadIn + texts.join(' '))) add('warning', 'rendering', 'Replacement character found - possible encoding corruption.');

  const critical = findings.filter((x) => x.severity === 'critical').length;
  const errors = findings.filter((x) => x.severity === 'error').length;
  const passed = critical === 0 && errors === 0;
  const repairable = Boolean(stem) && options.length >= 2 && ids.includes(correct) && critical === 0;

  return { passed, repairable, findings };
}
