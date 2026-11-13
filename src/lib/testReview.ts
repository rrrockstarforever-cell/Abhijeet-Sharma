// Performance reviews of submitted tests, kept permanently on this device (localStorage 'pulse.reviews.v1'),
// so a review can be opened again later and the weak topics of all tests can be added up.
import type { ClinicalQuestion } from '../types.ts';
import { notifyDataChanged } from '../utils/dataEvents.ts';

export interface TopicStat {
  key: string;
  subject: string;
  topic: string;
  total: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  missedFacts: string[];
}

export interface ReviewAdvice { summary: string; topics: Record<string, string> }

export interface ReviewRecord {
  id: string;
  at: string;
  exam: string;
  total: number;
  answered: number;
  correct: number;
  topics: TopicStat[];
  advice?: ReviewAdvice;
  /** XP this test earned, and any badges it unlocked. */
  xp?: number;
  leveledUp?: boolean;
  newBadges?: string[];
}

export const WEAK_BELOW = 60;
const KEY = 'pulse.reviews.v1';

const correctText = (q: ClinicalQuestion): string => q.options.find((o) => o.id === q.correctOption)?.text ?? '';

export function analyseTopics(questions: ClinicalQuestion[], answers: Record<string, string>): TopicStat[] {
  const map = new Map<string, TopicStat>();
  for (const q of questions) {
    const topic = (q.subtopic || q.subject || 'General').trim();
    const subject = (q.subject || '').trim();
    const key = `${subject}|${topic}`;
    const s = map.get(key) ?? { key, subject, topic, total: 0, wrong: 0, skipped: 0, accuracy: 0, missedFacts: [] };
    s.total += 1;
    const chosen = answers[q.id];
    if (!chosen) s.skipped += 1;
    else if (chosen !== q.correctOption) s.wrong += 1;
    if (!chosen || chosen !== q.correctOption) {
      const fact = (q.keyFact || '').trim() || correctText(q);
      if (fact && s.missedFacts.length < 3) s.missedFacts.push(fact.slice(0, 200));
    }
    map.set(key, s);
  }
  return [...map.values()].map((s) => ({ ...s, accuracy: Math.round(((s.total - s.wrong - s.skipped) / s.total) * 100) }));
}

export function buildReview(id: string, questions: ClinicalQuestion[], answers: Record<string, string>, at = new Date().toISOString()): ReviewRecord {
  return {
    id,
    at,
    exam: questions[0]?.examType ?? 'NEET_PG',
    total: questions.length,
    answered: questions.filter((q) => answers[q.id]).length,
    correct: questions.filter((q) => answers[q.id] === q.correctOption).length,
    topics: analyseTopics(questions, answers),
  };
}

export function weakTopics(topics: TopicStat[], limit = 6): TopicStat[] {
  return topics
    .filter((s) => s.accuracy < WEAK_BELOW)
    .sort((a, b) => (b.wrong + b.skipped) - (a.wrong + a.skipped) || a.accuracy - b.accuracy)
    .slice(0, limit);
}

export function lessonMessage(list: TopicStat[]): string {
  const parts = list.map((s) => {
    const facts = s.missedFacts.length ? ` Facts I missed: ${s.missedFacts.join(' | ')}.` : '';
    return `- ${s.topic}${s.subject && s.subject !== s.topic ? ` (${s.subject})` : ''}: I got ${s.total - s.wrong - s.skipped} of ${s.total} right.${facts}`;
  });
  return `I just finished a practice test and these are my weak topics:\n${parts.join('\n')}\n\nTeach me ${list.length > 1 ? 'these one by one, starting with the first' : 'this'} in simple words, as if I am meeting it for the first time. Cover what to remember, the typical exam traps, and then ask me 3 short check questions.`;
}

export function listReviews(): ReviewRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as ReviewRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveReview(review: ReviewRecord): void {
  try {
    const list = listReviews().filter((r) => r.id !== review.id);
    list.unshift(review);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
    notifyDataChanged();
  } catch { /* storage full: the review is still shown, just not kept */ }
}

export function saveAdvice(id: string, advice: ReviewAdvice): void {
  const list = listReviews();
  const hit = list.find((r) => r.id === id);
  if (!hit) return;
  hit.advice = advice;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full */ }
}

/** The topics added up over every saved review: right and wrong counts per topic, weakest first. */
export function weakAcrossTests(reviews: ReviewRecord[], limit = 8): TopicStat[] {
  const map = new Map<string, TopicStat>();
  for (const r of reviews) {
    for (const t of r.topics) {
      const s = map.get(t.key) ?? { ...t, total: 0, wrong: 0, skipped: 0, missedFacts: [] };
      s.total += t.total;
      s.wrong += t.wrong;
      s.skipped += t.skipped;
      for (const f of t.missedFacts) if (s.missedFacts.length < 3 && !s.missedFacts.includes(f)) s.missedFacts.push(f);
      map.set(t.key, s);
    }
  }
  const all = [...map.values()].map((s) => ({ ...s, accuracy: Math.round(((s.total - s.wrong - s.skipped) / s.total) * 100) }));
  return weakTopics(all, limit);
}
