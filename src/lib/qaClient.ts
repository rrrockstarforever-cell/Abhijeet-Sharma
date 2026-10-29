// Client for the QA pipeline (server/qa). Runs the server-side review and keeps the
// approved bank in localStorage so the dashboard survives reloads.
import type { QAReview, ClinicalQuestion } from '../types.ts';
import { getActiveProvider, getEffectiveModel } from './ai.ts';

const BANK_KEY = 'pulse.qa.bank';
const REVIEWS_KEY = 'pulse.qa.reviews';

export interface BankEntry {
  id: string;
  subject: string;
  subtopic: string;
  status: string;
  totalScore: number;
  reviewedAt: string;
  question: ClinicalQuestion;
  review: QAReview;
}

export function loadBank(): BankEntry[] {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

function persistBank(rows: BankEntry[]): void {
  try { localStorage.setItem(BANK_KEY, JSON.stringify(rows.slice(0, 500))); } catch { /* quota */ }
}

export function reviewQuestion(question: ClinicalQuestion, runLlm = false): Promise<QAReview> {
  return fetch('/api/qa/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: {
        id: question.id,
        stem: question.stem,
        questionText: question.questionText,
        options: question.options,
        correctOption: question.correctOption,
        explanation: question.explanation,
        subject: question.subject,
        subtopic: question.subtopic,
        examType: question.examType,
        image: question.image,
        imageCaption: question.imageCaption,
      },
      runLlm,
      provider: getActiveProvider() ?? 'opencode',
      model: getActiveProvider() ? getEffectiveModel(getActiveProvider()!) : undefined,
    }),
  }).then((r) => r.json().then((j) => (r.ok ? (j.review as QAReview) : Promise.reject(new Error(j.error || 'QA review failed.')))));
}

export function reviewBatch(questions: ClinicalQuestion[]): Promise<QAReview[]> {
  return fetch('/api/qa/review-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      questions: questions.map((q) => ({
        id: q.id, stem: q.stem, questionText: q.questionText, options: q.options,
        correctOption: q.correctOption, explanation: q.explanation, subject: q.subject,
        subtopic: q.subtopic, examType: q.examType, image: q.image, imageCaption: q.imageCaption,
      })),
      runLlm: false,
      provider: getActiveProvider() ?? 'opencode',
      model: getActiveProvider() ? getEffectiveModel(getActiveProvider()!) : undefined,
    }),
  }).then((r) => r.json().then((j) => (r.ok ? (j.reviews as QAReview[]) : Promise.reject(new Error(j.error || 'QA batch failed.')))));
}

/** Second mechanism: refine generated questions before QA. Removes answer leakage,
 *  obvious hints, and option-structure telegraphing. Falls back to the original list. */
export function refineBatch(questions: ClinicalQuestion[]): Promise<ClinicalQuestion[]> {
  return fetch('/api/qa/refine-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      questions,
      provider: getActiveProvider() ?? 'opencode',
      model: getActiveProvider() ? getEffectiveModel(getActiveProvider()!) : undefined,
    }),
  }).then((r) => r.json().then((j) => (r.ok ? (j.questions as ClinicalQuestion[]) : Promise.reject(new Error(j.error || 'Refinement failed.')))));
}

/** Persist a batch of generated questions with their (deterministic) QA records. */
export function recordReviewBatch(questions: ClinicalQuestion[], reviews: QAReview[]): void {
  const bank = loadBank();
  for (const q of questions) {
    const review = reviews.find((r) => r.questionId === q.id);
    if (!review) continue;
    q.qaReview = review;
    q.status = review.status;
    const existing = bank.find((b) => b.id === q.id);
    const entry: BankEntry = {
      id: q.id,
      subject: q.subject,
      subtopic: q.subtopic,
      status: review.status,
      totalScore: review.adjudication.totalScore,
      reviewedAt: review.reviewedAt,
      question: q,
      review,
    };
    if (existing) Object.assign(existing, entry);
    else bank.push(entry);
  }
  persistBank(bank);
}

export function updateReviewStatus(id: string, status: string): void {
  const bank = loadBank().map((b) => (b.id === id ? { ...b, status, review: { ...b.review, status: status as QAReview['status'] } } : b));
  persistBank(bank);
}

export function loadReviews(): QAReview[] {
  try {
    const raw = localStorage.getItem(REVIEWS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
