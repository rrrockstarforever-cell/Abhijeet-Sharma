// Repairs a question that failed its answer check, using the reasons it failed, instead of
// throwing it away and writing a new one. The repaired question keeps its topic and exam pattern.
import type { ClinicalQuestion } from '../types.ts';
import { aiComplete, extractJson, getActiveProvider, getEffectiveModel } from './ai.ts';
import type { ProofRecord } from './answerProof.ts';

/** The reasons a checked question failed, in words the writer can act on. */
export function reasonsFor(q: ClinicalQuestion, proof: ProofRecord | null): string[] {
  if (!proof) return ['its answer was never checked'];
  const reasons: string[] = [];
  const solvers = proof.solves ?? [];
  if (solvers.some((s) => s !== q.correctOption)) {
    reasons.push(`independent solvers chose ${solvers.join(' and ')} instead of the key ${q.correctOption}; make the correct option the single unambiguous answer`);
  }
  if (proof.evidence?.verdict !== 'SUPPORTED') {
    reasons.push('no published evidence directly supports the key; make the key rest on one standard, citable textbook or guideline fact and state that fact in keyFact');
  }
  if (proof.wellFormed === false) reasons.push('the item is not well formed');
  for (const issue of (proof.issues ?? []).slice(0, 3)) reasons.push(issue);
  return reasons;
}

/** Asks the writer to rewrite one question so it fixes the listed reasons. Null when the reply is unusable. */
export async function repairQuestion(q: ClinicalQuestion, reasons: string[]): Promise<ClinicalQuestion | null> {
  if (!getActiveProvider()) return null;
  const current = {
    stem: q.stem,
    questionText: q.questionText,
    options: Object.fromEntries(q.options.map((o) => [o.id, o.text])),
    correctOption: q.correctOption,
    explanation: q.explanation ?? '',
  };
  const request = {
    work: true,
    effort: 'min',
    spread: true,
    json: true,
    system: 'You repair one exam multiple-choice question. Keep the same subject, subtopic and exam pattern. Return ONLY the corrected JSON object.',
    messages: [{
      role: 'user' as const,
      content:
        `This question failed our checks for these reasons:\n- ${reasons.join('\n- ')}\n\n` +
        `Current question:\n${JSON.stringify(current, null, 2)}\n\n` +
        'Rewrite it so that it has exactly one defensible best answer, fixes every reason above, and states in keyFact the one textbook or guideline fact that makes the correct option right. ' +
        `Return JSON {"stem":"...","questionText":"...","options":{${q.options.map((o) => `"${o.id}":"..."`).join(', ')}},"correctOption":"${q.options.map((o) => o.id).join('|')}","explanation":"...","keyFact":"..."}.`,
    }],
  };
  // The provider rate-limits bursts (HTTP 429): wait and try again rather than losing the question.
  let reply = '';
  for (let attempt = 0; ; attempt++) {
    try {
      reply = await aiComplete(request);
      break;
    } catch (err: any) {
      if (attempt >= 3 || !/429/.test(err?.message || '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, 15000 * (attempt + 1)));
    }
  }
  const raw = extractJson<any>(reply);
  if (!raw || typeof raw.stem !== 'string' || !raw.stem.trim() || !raw.options || typeof raw.correctOption !== 'string') return null;
  const options = q.options.map((o) => ({ id: o.id, text: String(raw.options[o.id] ?? '').trim() }));
  if (options.some((o) => !o.text)) return null;
  const correct = raw.correctOption.trim().toUpperCase();
  if (!options.some((o) => o.id === correct)) return null;
  return {
    ...q,
    id: `${q.id}-r${Date.now().toString(36)}`,
    stem: raw.stem.trim(),
    questionText: typeof raw.questionText === 'string' && raw.questionText.trim() ? raw.questionText.trim() : raw.stem.trim(),
    options,
    correctOption: correct as ClinicalQuestion['correctOption'],
    explanation: typeof raw.explanation === 'string' && raw.explanation.trim() ? raw.explanation.trim() : q.explanation,
    keyFact: typeof raw.keyFact === 'string' && raw.keyFact.trim() ? raw.keyFact.trim().slice(0, 400) : undefined,
  };
}
