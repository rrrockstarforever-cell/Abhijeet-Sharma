// "Teach me": a teaching note for the topics a learner got wrong, written from their own books when the books have the topic.
// The result is the same structured note the PDF Reader makes (big idea, numbered sections, traps, hooks, test yourself).
// Notes are kept on this device, so opening the same topics again is instant.
import { aiComplete, extractJson, getActiveProvider, getEffectiveModel } from './ai.ts';
import { toTeachingNote, type TeachingNote } from '../components/StructuredNote.tsx';
import type { TopicStat } from './testReview.ts';

export interface TeachResult { note: TeachingNote; fromBooks: boolean; label: string; at: string }

const KEY = 'pulse.teachNotes.v1';
const keyFor = (topics: TopicStat[]): string => topics.map((t) => t.key).sort().join('||').slice(0, 300);
export const labelFor = (topics: TopicStat[]): string => topics.map((t) => t.topic).join(', ').slice(0, 120);

function readAll(): Record<string, TeachResult> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, TeachResult>; } catch { return {}; }
}

export function getCachedTeachNote(topics: TopicStat[]): TeachResult | null {
  return readAll()[keyFor(topics)] ?? null;
}

function save(topics: TopicStat[], result: TeachResult): void {
  try {
    const all = readAll();
    all[keyFor(topics)] = result;
    // Keep the 60 newest.
    const entries = Object.entries(all).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, 60);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage full: the note is shown but not kept */ }
}

async function bookPassages(topic: string): Promise<{ title: string; text: string }[]> {
  try {
    const res = await fetch('/api/web/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: topic, books: true }) });
    const data = await res.json().catch(() => ({}));
    const list = res.ok && Array.isArray(data.sources) ? data.sources : [];
    return list.filter((s: { kind?: string; text?: string }) => s?.kind === 'book' && s.text).slice(0, 2);
  } catch {
    return [];
  }
}

// This note TEACHES the topic from zero, in easy words, so a first-time reader understands it. It is not a list of the answers the
// learner missed: it explains what the thing is and why it happens, marks the points to remember, and adds the closely related
// high-yield facts for the same topic.
const TEACH_SYSTEM = [
  'You are a kind teacher. A learner got exam questions wrong on some topics. TEACH each topic so a person who has never studied it understands it, then add what else matters for the exam. Do not just repeat the right answer: explain it.',
  'Language: plain, everyday words, like talking to a friend. Short sentences (about 12 words). Explain every medical word in a few plain words in brackets the first time. Use a small real-life comparison when it helps (for example "a key that fits a lock"). No jargon dumps.',
  'For EACH topic write THREE separate entries in "sections" (so a topic gives three sections), in this order. Write each heading as "<Topic name>: what it is", "<Topic name>: why it happens", "<Topic name>: also remember". Never put two of them in one section, and never repeat the heading words inside the text.',
  '1) "what it is": 2 or 3 sentences. Say simply what the thing is or does.',
  '2) "why it happens": 2 to 4 short sentences as a cause-and-effect chain ("this blocks that, so this happens"). This is the part that makes it stick. Connect it to the facts the learner missed.',
  '3) "also remember" (extra high-yield facts about the SAME topic that exams ask next: other side effects, uses, comparisons, usual traps, numbers that matter): 3 to 5 short lines in ONE "text" block, each line starting with "- ". Add a "table" instead if two or more things must be compared (2 to 4 short rows). End the section with ONE "hook" block (a memory trick) or ONE "trap" block (the usual exam mistake), only if it is genuinely useful and new.',
  'About 150 to 220 words per topic. Marking: put **bold** on the 1 to 3 words or phrases in each block that the learner must remember (never whole sentences), so the key points stand out.',
  'If a MY BOOKS block follows, take the facts from it and keep them exact, and call the source "your book". Add extra related facts from standard textbook knowledge and put a single † at the END of a block when it contains a fact that is not from the book; never start a line with † and never put † on every sentence. If the books have nothing on the topic, teach from standard textbooks and put no † at all. Never write a block that talks about the books themselves.',
  'Set the note "title" to the topic names. The "takeaway" is ONE short sentence with the single idea to remember. Set every section "page" to null; never use a "figure" or "steps" block.',
  'Write 3 selfCheck questions that test understanding of the WHY, not just the answer; each answer is one short sentence.',
  'Reply only with JSON: {"title":"...","takeaway":"...","sections":[{"heading":"...","page":null,"blocks":[{"type":"text","text":"..."},{"type":"trap","text":"..."},{"type":"hook","text":"..."},{"type":"table","columns":["..."],"rows":[["..."]]}]}],"selfCheck":[{"q":"...","a":"..."}]}.',
].join('\n');

export async function generateTeachNote(topics: TopicStat[], force = false): Promise<TeachResult> {
  if (!force) {
    const cached = getCachedTeachNote(topics);
    if (cached) return cached;
  }
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider is connected. Connect one in Settings.');

  const passages = await Promise.all(topics.map(async (t) => ({ topic: t.topic, found: await bookPassages(`${t.topic} ${t.subject}`.trim()) })));
  const books = passages.flatMap((p) => p.found.map((f) => `[${p.topic}] ${f.title}\n${f.text}`)).join('\n\n');
  const missed = topics.map((t) => `- ${t.topic}${t.subject ? ` (${t.subject})` : ''}: ${t.total - t.wrong - t.skipped} of ${t.total} right.${t.missedFacts.length ? ` Facts missed: ${t.missedFacts.join(' | ')}.` : ''}`).join('\n');
  const content = `The learner's weak topics:\n${missed}${books ? `\n\nMY BOOKS (the learner's own books):\n"""\n${books.slice(0, 9000)}\n"""` : ''}`;

  const raw = await aiComplete({
    system: TEACH_SYSTEM,
    messages: [{ role: 'user', content }],
    json: true,
    purpose: 'teach-note',
    provider,
    model: getEffectiveModel(provider),
  });
  const note = toTeachingNote(extractJson(raw));
  if (!note) throw new Error('The AI did not return a usable note. Try again.');
  const result: TeachResult = { note, fromBooks: Boolean(books), label: labelFor(topics), at: new Date().toISOString() };
  save(topics, result);
  return result;
}
