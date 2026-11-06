// Client-side AI library for Pulse Med.
// Real provider calls only (via /api/ai/complete on the local Express server).
// No silent fallbacks: every failure is thrown as a typed AiError and must be shown in the UI.
import type { ClinicalQuestion, ExamType, DifficultyTier, DifficultySubLevel } from '../types.ts';

import { AMC_BLUEPRINT, getDifficultyDescription } from "./amcBlueprint";
import { findLiveImage, liveImageCaption, isLiveImageSearchEnabled } from '../utils/liveImages.ts';
import { DUPLICATE_SIMILARITY, stemSimilarity, toBenchItem } from './benchmark.ts';
import { COMMON_STYLE_RULES, EXAM_RULES, STYLES, combinationListMissing, inventedSource, explainsDistractors, explanationLeaks, leadInsFromChips, planSlots, spread, pointsAtMissingPicture, unpointDescribedPicture, styleProblem, stylesFromChips, subjectFromTopic, tierText, type Slot, type StyleId } from './questionStyles.ts';

/**
 * Two key facts this similar are the same fact (word overlap on the key-fact sentences). Set low because
 * paraphrases share few words: a repeat pair scored about 0.33, an unrelated pair 0.
 */
const KEY_FACT_SIMILARITY = 0.3;

/**
 * Shape of each item by its position in the set: mostly single best answer, one in four asks which
 * option is incorrect or NOT true, and only one in eight is a numbered-statements item.
 */
const SINGLE_BEST_ANSWER = 'Use a single best answer lead-in (diagnosis, next step, drug of choice or investigation). Do not use a numbered statements list.';

function itemShape(idx: number, exam: ExamType): string {
  // NEET-PG and AMC CAT papers are single-best-answer throughout (recall papers, sample items);
  // only INI-CET mixes in statement and incorrect-option items.
  if (exam !== 'INI_CET') return SINGLE_BEST_ANSWER;
  const slot = idx % 8;
  if (slot === 2 || slot === 6) return 'Ask which option is INCORRECT, FALSE or NOT true; exactly one option is the answer.';
  if (slot === 4) return 'Use a single best answer lead-in such as "Which is the most appropriate ...?". Do not use a numbered statements list.';
  if (slot === 7) return 'This item may use a numbered statements list (1, 2, 3, 4) with "1 and 3 only"-style options.';
  return 'Use a single best answer lead-in (diagnosis, next step, drug of choice or investigation). Do not use a numbered statements list.';
}

/** Patients rotated across a typed-topic set, so no two items share the same age, sex and setting. */
const PATIENT_PROFILES = [
  'a 68-year-old woman in a general medicine clinic',
  'a 9-month-old infant on a paediatric ward',
  'a 34-year-old man in the emergency department',
  'a 14-year-old girl seen at a school health check',
  'a 59-year-old farmer in a rural primary care centre',
  'a 26-year-old pregnant woman at an antenatal visit',
  'an 81-year-old man in a nursing home',
  'a 45-year-old woman after a surgical procedure',
];

/** Item types for a typed topic, rotated across the set. Case stems are only 2 in 8 (about a quarter), so the set is not mostly vignettes. */
/** The shape of one typed-topic question, with the letter its answer must sit at, so the correct letters are spread evenly. */
function typedShape(idx: number): string {
  return typedShapeBase(idx);
}

/**
 * Moves the correct option to a chosen letter by swapping it with the option now there, so the correct letters of a set
 * come out even (the writer favours C and D). Letters named in the explanation ("Option B is wrong") are swapped too.
 */
function placeCorrectAt(q: ClinicalQuestion, target: string): void {
  const from = q.correctOption;
  if (!from || from === target || !q.options.some((o) => o.id === target)) return;
  const swap = (l: string) => (l === from ? target : l === target ? from : l);
  type Letter = ClinicalQuestion['correctOption'];
  q.options = q.options.map((o) => ({ ...o, id: swap(o.id) as Letter })).sort((a, b) => a.id.localeCompare(b.id));
  q.correctOption = target as Letter;
  const fix = (text: string | undefined) => text?.replace(/\b([Oo]ptions?|[Cc]hoices?)\s+([A-E](?:\s*(?:,|and|or|&)\s*[A-E])*)\b/g, (_m, word: string, list: string) => `${word} ${list.replace(/[A-E]/g, swap)}`);
  q.explanation = fix(q.explanation) ?? q.explanation;
}

function typedShapeBase(idx: number): string {
  const slot = idx % 8;
  const patient = `If the item needs a patient, use ${PATIENT_PROFILES[idx % PATIENT_PROFILES.length]}.`;
  if (slot === 3 || slot === 6) return `Short case: at most three sentences (age, presentation, one question). The answer must be the named fact itself. ${patient}`;
  if (slot === 1 || slot === 5) return 'Negative lead-in: "Which of the following is NOT true about ...?" Exactly one option is false; the other three are true statements about the topic.';
  if (slot === 2) return 'Match-style: the stem names one feature, and the options name the agents or conditions. Exactly one option fits.';
  if (slot === 4) return 'Direct recall lead-in asking for the most characteristic feature or the most common cause. No patient case: the stem has no age, no sex and no "a patient" or "a child".';
  if (slot === 7) return 'Direct recall lead-in asking for the most useful test, monitoring step or first-line choice for the named topic. No patient case: the stem has no age, no sex and no "a patient" or "a child".';
  return 'Direct recall lead-in: "Which of the following is ...?" in one line. No patient case: the stem has no age, no sex and no "a patient" or "a child".';
}

/** Splits a subtopic such as "Anticancer Chemotherapy: Alkylating Agents, Antimetabolites & MAbs" into its parts. */
function focusParts(subtopic: string): string[] {
  const after = subtopic.includes(':') ? subtopic.split(':').slice(1).join(':') : subtopic;
  return after.split(/,|&| and /).map((s) => s.trim()).filter(Boolean);
}
export type AiProviderId = 'gemini' | 'chatgpt' | 'claude' | 'grok' | 'opencode' | 'nvidia' | 'vyce';

export const AI_PROVIDER_IDS: AiProviderId[] = ['gemini', 'chatgpt', 'claude', 'grok', 'opencode', 'nvidia', 'vyce'];

// Server defaults (mirrored in server.ts); models are user-selectable and persisted
// in localStorage as `ai.model.<provider>` and sent with every request.
export const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.8-flash',
  chatgpt: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
  // OpenCode Console / Go (https://opencode.ai/inference) — any model id the account has.
  opencode: 'deepseek-v4.1-flash',
  // Custom OpenAI-compatible endpoint — user supplies URL, model id and key.
  custom: 'gpt-4o-mini',
  // NVIDIA NIM API — OpenAI-compatible endpoint at integrate.api.nvidia.com/v1.
  nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  // VyceAI (https://vyceai.com/v1) — OpenAI-compatible, serves DeepSeek models.
  vyce: 'deepseek-v4.1',
};

// Console-only model ids a previous version of the app offered for OpenCode. They are not
// included in the Go plan and return "Model is unavailable" — drop them on read.
const NON_GO_OPENCODE_MODELS = new Set([
  'claude-sonnet-5-5',
  'gpt-6.1-sol',
  'gemini-3.8-flash',
  'kimi-k3',
  'claude-opus-4-5',
  'gpt-5.4',
]);

export const NOT_CONNECTED_MESSAGE = 'Connect an AI provider in Settings → AI Subscription Hub.';

export class AiError extends Error {
  kind: 'not_connected' | 'api' | 'network' | 'invalid' | 'aborted';
  /** HTTP status when the failure came from the local server. */
  status?: number;
  /** Server-suggested wait (from Retry-After), capped. */
  retryAfterMs?: number;
  constructor(message: string, kind: AiError['kind'] = 'api') {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

// ---------- localStorage persistence ----------

export function getActiveProvider(): AiProviderId | null {
  const value = localStorage.getItem('ai.activeProvider');
  return value && (AI_PROVIDER_IDS as string[]).includes(value) ? (value as AiProviderId) : null;
}

export function setActiveProvider(provider: AiProviderId): void {
  localStorage.setItem('ai.activeProvider', provider);
}

/** Pick the first connected provider (called after fetching /api/oauth/status). */
export function pickDefaultActiveProvider(status: Record<string, { connected?: boolean }>): AiProviderId | null {
  const connected = AI_PROVIDER_IDS.filter((id) => Boolean(status[id]?.connected));
  return connected[0] ?? null;
}

export function getModel(provider: AiProviderId): string | null {
  const value = localStorage.getItem(`ai.model.${provider}`);
  return value && value.trim() ? value.trim() : null;
}

export function setModel(provider: AiProviderId, model: string): void {
  localStorage.setItem(`ai.model.${provider}`, model.trim());
}

export function getEffectiveModel(provider: AiProviderId): string {
  const stored = getModel(provider);
  if (provider === 'opencode' && stored && NON_GO_OPENCODE_MODELS.has(stored)) {
    // A previous version of the app listed Console-only model ids as if they were
    // OpenCode Go models; those return "Model is unavailable" on a Go subscription.
    try { localStorage.removeItem('ai.model.opencode'); } catch { /* ignore */ }
    return DEFAULT_MODELS.opencode;
  }
  return stored ?? DEFAULT_MODELS[provider];
}

/** The provider and model that write questions and refine or review them: always the engine you selected. */
export function writeRoute(): { provider: AiProviderId; model: string } | null {
  const active = getActiveProvider();
  return active ? { provider: active, model: getEffectiveModel(active) } : null;
}

/** The provider and model fields for a question-writing request body. */
export function workBody(): { provider: AiProviderId | 'opencode'; model?: string } {
  const route = writeRoute();
  return { provider: route?.provider ?? 'opencode', model: route?.model };
}

/**
 * How many question requests run at once. NVIDIA alone rate-limits bursts, so it gets 3. When another
 * engine is in use (shared work, or an engine with no rate limit) the limit is wider.
 */
export function parallelRequestLimit(): number {
  // Test override: localStorage 'pulse.parallelLimit' sets how many questions run at once.
  try {
    const forced = Number(localStorage.getItem('pulse.parallelLimit'));
    if (Number.isFinite(forced) && forced >= 1) return forced;
  } catch { /* storage unavailable */ }
  // Mixed mode: 4 DeepSeek lanes plus 1 NVIDIA lane, so 5 questions at once. NVIDIA alone gets 40 at a time; refused
  // calls move to the next model in the spread, then wait 5 seconds and retry on the server. Other providers take 30.
  if (isMixedMode()) return 5;
  // OpenCode runs 20 questions at a time. Other paid providers get 5, so each call costs what it must and no more.
  if (getActiveProvider() === 'opencode') return 20;
  // Nemotron Bolt E4B is small and fast, so it runs 20 questions at a time.
  if (getActiveProvider() === 'nvidia' && /bolt/i.test(getEffectiveModel('nvidia'))) return 20;
  // Claude (Haiku) and the other paid models take 15 at once; the rewrite lane below still runs one rewrite at a time.
  if (getActiveProvider() === 'claude') return 15;
  return getActiveProvider() === 'nvidia' ? 5 : 5;
}

// ---------- provider status ----------

export interface ProviderStatusResponse {
  providers: Record<string, { connected?: boolean; userEmail?: string }>;
}

export async function fetchProviderStatus(): Promise<ProviderStatusResponse['providers']> {
  try {
    const res = await fetch('/api/oauth/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ProviderStatusResponse = await res.json();
    return data.providers ?? {};
  } catch (err: any) {
    throw new AiError(`Could not reach the local AI server (${err?.message || 'network error'}).`, 'network');
  }
}

// ---------- completion ----------

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiCompleteOptions {
  system?: string;
  messages: AiMessage[];
  json?: boolean;
  effort?: string;
  /** Internet sources for this topic are searched by the server and read with the request, so the answer is checked in the same call. */
  groundOn?: { query: string; subject: string };
  provider?: AiProviderId;
  model?: string;
  /** Question writing and repair: sent to the selected engine. See writeRoute. */
  work?: boolean;
  /** Cancels the HTTP request; the server also drops the upstream call (see /api/ai/complete). */
  signal?: AbortSignal;
}

// Stable conversation id for providers that cache/route per session (OpenCode Go).
// Stored in sessionStorage so each tab/instance keeps its own session — running several
// instances in parallel then maps to several distinct sessions on the provider gateway.
function openCodeSessionId(): string {
  try {
    let id = sessionStorage.getItem('pulse.opencode.session');
    if (!id) {
      id = localStorage.getItem('pulse.opencode.session') ||
        `pulsemed-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem('pulse.opencode.session', id);
      try { localStorage.setItem('pulse.opencode.session', id); } catch { /* ignore */ }
    }
    return id;
  } catch {
    return `pulsemed-${Math.random().toString(36).slice(2)}`;
  }
}

/** One planned question slot: the subject, subtopic, the part of it to focus on, and the difficulty. */
interface PlannedTopic { subject: string; subtopic: string; focus?: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH'; assigned?: AssignedFact; slot?: Slot }

/** Splits a typed topic into its distinct subtopics with the selected engine. Falls back to the topic itself. */
export async function splitTopic(topic: string, exam: string): Promise<{ subtopics: string[]; priorities: number[]; facts: number[] }> {
  const fallback = { subtopics: [topic], priorities: [10], facts: [1] };
  const provider = getActiveProvider();
  if (!provider) return fallback;
  try {
    const res = await fetch('/api/ai/split-topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, exam, ...currentRoute(provider) }),
    });
    const data = await res.json().catch(() => ({}));
    const list: string[] = Array.isArray(data?.subtopics) ? data.subtopics : [];
    if (!list.length) return fallback;
    const priorities: number[] = list.map((_, i) => Number(data?.priorities?.[i]) || 10);
    const facts: number[] = list.map((_, i) => Math.min(6, Math.max(1, Number(data?.facts?.[i]) || 1)));
    return { subtopics: list, priorities, facts };
  } catch {
    return fallback;
  }
}

const FACT_PICK_SYSTEM =
  'You pick one specific fact about the topic that one of the sources states. Prefer a fact about the focus if the sources have one. ' +
  'Copy the supporting words exactly from that source. Reply with ONLY JSON: ' +
  '{"fact":"one sentence stating the fact","quote":"exact words from that source","source":<source number>}. ' +
  'Reply {"fact":"","quote":"","source":0} only if no source states any fact about the topic.';

const squeezeText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// Search results kept for a few minutes, so picks for the same topic do not search again.
const researchCache = new Map<string, { at: number; sources: { title: string; text: string }[] }>();
const RESEARCH_TTL_MS = 5 * 60_000;

/**
 * Fact first: finds one fact on the topic in the sources, and checks that the quote is really in the source.
 * The question is then written around that fact, so its answer can be checked by construction. Returns null when no sourced fact is found.
 */
export async function pickSourcedFact(
  topic: string,
  focus: string | undefined,
  provider: AiProviderId,
  signal?: AbortSignal,
  avoid: string[] = [],
): Promise<{ fact: string; quote: string; source: string } | null> {
  // The search uses the topic alone: the focus alone often finds thin abstracts that do not state the fact.
  const cacheKey = topic.toLowerCase();
  const cached = researchCache.get(cacheKey);
  let sources: { title: string; text: string }[] = cached && Date.now() - cached.at < RESEARCH_TTL_MS ? cached.sources : [];
  if (!sources.length) {
    try {
      const res = await fetch('/api/web/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: topic }),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.sources)) sources = data.sources;
      if (sources.length) researchCache.set(cacheKey, { at: Date.now(), sources });
    } catch {
      return null;
    }
  }
  if (!sources.length) return null;
  // The drug label, then textbook passages, are full text and tried first. If they give no usable fact, all sources are tried.
  const kindOf = (s: unknown) => (s as { kind?: string }).kind;
  const priority = sources.filter((s) => kindOf(s) === 'label' || kindOf(s) === 'book');
  const groups = priority.length && priority.length < sources.length ? [priority, sources] : [sources];
  for (const group of groups) {
    const evidence = group.map((s, i) => `[source ${i + 1}] ${s.title}\n${s.text}`).join('\n\n').slice(0, 9000);
    const raw = await aiComplete({
      system: FACT_PICK_SYSTEM,
      messages: [{ role: 'user', content: `Topic: ${topic}${focus ? `\nFocus: ${focus}` : ''}${avoid.length ? `\nAlready used, pick a different fact: ${avoid.slice(-20).map((f) => f.slice(0, 120)).join(' | ')}` : ''}\n\nSources:\n${evidence}` }],
      json: true,
      effort: 'low',
      provider,
      model: getEffectiveModel(provider),
    }).catch((err) => { console.warn(`[fact] call failed: ${err?.message || err}`); return ''; });
    const pick = extractJson<{ fact?: string; quote?: string; source?: number }>(raw);
    const fact = String(pick?.fact ?? '').trim();
    const quote = String(pick?.quote ?? '').trim();
    const src = group[Number(pick?.source ?? 0) - 1];
    if (!fact || !src || squeezeText(quote).length < 20) continue;
    // The quote must be in the source. A quote the model made up is not a fact from the source.
    if (!squeezeText(src.text).includes(squeezeText(quote))) continue;
    return { fact, quote, source: src.title };
  }
  return null;
}

/** Normalises a fact or answer for comparison: "CT" is computed tomography, and generic words are dropped. */
export function factKey(s: string): string {
  return s.toLowerCase()
    .replace(/\bct\b/g, 'computed tomography')
    .replace(/\b(serum|level|levels|assay|test|the|of|and|in|a|an|with|for|is|are|on|at|slightly|more|than|most|likely)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A fact planned for one question slot: it is quoted from a source, and the question is written around it. */
export interface AssignedFact { subtopic: string; fact: string; quote: string; source: string; /** Where the fact came from: the user's own library ('book') or the web and papers ('web'). */ origin?: 'book' | 'web'; /** The finding has a typical picture (X-ray, histology, ECG, smear, clinical photo). */ picturable?: boolean }

const PLAN_FACTS_SYSTEM =
  'You list distinct, high-yield, exam-testable facts about one subtopic that the sources state. Do not repeat a fact already planned. ' +
  'Each fact must be a definite statement a student can be tested on (a cause, a feature, a number, a test, a drug effect, a warning), never an uncertain or open one ("may", "remains uncertain", "has been evaluated"). Prefer statements from an official drug label or textbook over research papers. ' +
  'Copy the supporting words exactly from one source. Reply with ONLY JSON: ' +
  '{"facts":[{"fact":"one sentence","quote":"exact words from that source","source":<source number>}]}. ' +
  'Give at most the number of facts asked for; give fewer if the sources do not support that many.';

/**
 * Fact assignment: plans the set before any question is written. For each important subtopic, the sources give up to
 * that many distinct facts, each quoted from a source. Each planned fact becomes one question slot, so questions do not
 * repeat one another. Facts whose quote is not in the source are dropped.
 */
export async function planTopicFacts(
  topic: string,
  subtopics: string[],
  facts: number[],
  provider: AiProviderId,
): Promise<AssignedFact[]> {
  const kindOf = (s: unknown) => (s as { kind?: string }).kind;
  // Each subtopic is searched on its own, so its facts come from text about that subtopic and not from one narrow
  // set of results for the whole topic. The searches run together.
  const [topicSources, ...subSourceLists] = await Promise.all([
    fetchTopicSources(topic),
    ...subtopics.map((s) => fetchTopicSources(`${topic} ${s.split(':')[0].trim()}`)),
  ]);
  const planned: AssignedFact[] = [];
  const usedFacts: string[] = [];
  // The model calls for all subtopics run together; their answers are then filtered one subtopic after another, so
  // a fact repeated under two subtopics is still caught by the comparison below.
  const extractions = await Promise.all(subtopics.map(async (_, i) => {
    const found = subSourceLists[i];
    const sources = found.length ? found : topicSources;
    if (!sources.length) return null;
    const ordered = [...sources.filter((s) => kindOf(s) === 'label' || kindOf(s) === 'book'), ...sources.filter((s) => kindOf(s) !== 'label' && kindOf(s) !== 'book')];
    const evidence = ordered.map((s, n) => `[source ${n + 1}] ${s.title}\n${s.text}`).join('\n\n').slice(0, 9000);
    // Spare facts (about half again) let a slot whose question fails its checks be replaced by another planned fact.
    // At most four facts per subtopic, so one detail (for example MRCP) does not fill the set.
    const want = Math.min(4, Math.max(1, facts[i] ?? 1));
    const ask = want + Math.ceil(want / 2);
    const raw = await aiComplete({
      system: PLAN_FACTS_SYSTEM,
      messages: [{ role: 'user', content: `Topic: ${topic}\nSubtopic: ${subtopics[i]}\nNumber of facts: ${ask}\n\nSources:\n${evidence}` }],
      json: true,
      effort: 'low',
      provider,
      model: getEffectiveModel(provider),
    }).catch(() => '');
    return { ordered, ask, raw, parsed: extractJson<{ facts?: { fact?: string; quote?: string; source?: number }[] }>(raw) };
  }));
  for (let i = 0; i < subtopics.length; i++) {
    const got = extractions[i];
    if (!got) continue;
    const { ordered, ask, raw: rawText, parsed } = got;
    let kept = 0;
    const why: Record<string, number> = {};
    const skip = (reason: string) => { why[reason] = (why[reason] ?? 0) + 1; };
    for (const f of parsed?.facts ?? []) {
      if (kept >= ask) break;
      const fact = String(f?.fact ?? '').trim();
      const quote = String(f?.quote ?? '').trim();
      const src = ordered[Number(f?.source ?? 0) - 1];
      if (!fact || !src || squeezeText(quote).length < 20) { skip('no-fact-or-short-quote'); continue; }
      if (!squeezeText(src.text).includes(squeezeText(quote))) { skip('quote-not-in-source'); continue; }
      // A single case report or a paediatric study is not a general exam fact.
      if (/case report|case series|a case of|successful management|fatal|pediatric|paediatric|in children/i.test(src.title)) { skip('case-report'); continue; }
      // Research-paper detail (statistics, gene or protein expression, open questions) is not a high-yield exam fact.
      if (/\b(AUC|expression|interleukin|odds ratio|hazard ratio|cohort|95% ?CI|biomarker|incompletely characteri[sz]ed|not well characteri[sz]ed|further studies|remain unclear|protocol|this study|the study|trial|muscle density|sample size|banked|enrol(l)?ed|follow-up|mendelian|randomi[sz]ation|subjects|participants|were reported|studied|analysis|meta-analysis|observational|compared with|compared to|committee|hospitali[sz]ation|significantly (more|less|higher|lower)|no association|reporting rate|MedDRA|incidence of \d|uncertain|unclear|(has|have) been evaluated|raising the question|awareness|whether|potentially|were more commonly|retrospective|umbrella|meta-analyses|no significant|between groups|few and mostly)\b|\d+\.\d+ ?%/i.test(fact)) continue;
      // Hedged or rarity statements ("is described as encouraging", "may be septate or nonseptate", "is very rare") have no
      // clear exam answer, and the examiner rejects every question built on them.
      if (/\b(described as|has been described|have been described|encouraging|promising|investigational|experimental|has been reported|have been reported|may be (?:either )?\w+ or (?:non|un)\w+|(?:is|are) very rare|anecdotal)\b/i.test(fact)) { skip('hedged'); continue; }
      // The same fact planned under two subtopics is one fact: compare with abbreviations and generic words normalised.
      if (usedFacts.some((u) => stemSimilarity(factKey(u), factKey(fact)) >= 0.5)) { skip('duplicate'); continue; }
      planned.push({ subtopic: subtopics[i], fact, quote, source: src.title, origin: kindOf(src) === 'book' ? 'book' : 'web' });
      usedFacts.push(fact);
      kept += 1;
    }
    // For the quality tests: why a subtopic gave few facts (reply not JSON, quotes not in the sources, trivia filter, ...).
    (globalThis as { __planDebug?: unknown[] }).__planDebug?.push({ subtopic: subtopics[i].slice(0, 50), asked: ask, replyChars: rawText.length, parsed: Array.isArray(parsed?.facts) ? parsed!.facts!.length : -1, kept, why, sources: ordered.length });
  }
  return tagPicturable(await dedupePlan(planned, provider), provider);
}

/**
 * One pass over the whole plan: a fact that makes the same point as an earlier fact (in different words) is removed.
 * Word matching cannot see that two sentences say the same thing, so the model decides.
 */
/** The model for simple steps (subject, picture planning, explanation repair, duplicate check): Haiku on Claude, the active model otherwise. */
function cheapModel(provider: AiProviderId): string {
  return provider === 'claude' ? 'claude-haiku-5-5' : getEffectiveModel(provider);
}

async function dedupePlan(plan: AssignedFact[], provider: AiProviderId): Promise<AssignedFact[]> {
  if (plan.length < 2) return plan;
  const list = plan.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
  const raw = await aiComplete({
    system: 'You check a numbered list of exam facts. Some facts make the same point as an earlier fact, in different words. ' +
      'Reply with ONLY JSON: {"duplicates":[<numbers of the later facts that repeat an earlier one>]}. Reply {"duplicates":[]} if none.',
    messages: [{ role: 'user', content: list }],
    json: true,
    effort: 'low',
    provider,
    model: cheapModel(provider),
  }).catch(() => '');
  const drop = new Set((extractJson<{ duplicates?: number[] }>(raw)?.duplicates ?? []).map((n) => Number(n) - 1));
  return plan.filter((_, i) => !drop.has(i));
}

/**
 * Picks the questions (about one in four at most) whose key finding has a real picture and sets figureModality and
 * figureQuery on them. A question about a drug effect or a mechanism gets none. The picture search and the picture
 * check then run as usual, so a picture is attached only when it is found and verified.
 */
const subjectCache = new Map<string, string | undefined>();
/** The exam subject a typed topic belongs to (words first, then one cheap model call), for the subject's own style mix. */
async function guessSubject(topic: string): Promise<string | undefined> {
  const key = topic.trim().toLowerCase();
  if (subjectCache.has(key)) return subjectCache.get(key);
  let subject = subjectFromTopic(topic);
  if (!subject) {
    const provider = getActiveProvider();
    if (provider) {
      const raw = await aiComplete({
        system: 'Name the MBBS subject of an exam topic. Choose exactly one of: Anatomy, Physiology, Biochemistry, Pathology, Pharmacology, Microbiology, Forensic, PSM, Medicine, Surgery, OBG, Paediatrics, Orthopedics, ENT, Ophthalmology, Dermatology, Psychiatry, Radiology, Anaesthesia. Reply with ONLY JSON: {"subject":"..."}.',
        messages: [{ role: 'user', content: topic }], json: true, effort: 'low', provider, model: cheapModel(provider),
      }).catch(() => '');
      subject = String(extractJson<{ subject?: string }>(raw)?.subject ?? '').trim() || undefined;
    }
  }
  subjectCache.set(key, subject);
  return subject;
}

/** Rewrites an explanation that does not say why the other options are wrong. The question itself is not changed. */
async function repairExplanation(q: ClinicalQuestion, signal?: AbortSignal): Promise<void> {
  const provider = getActiveProvider();
  if (!provider) return;
  const raw = await aiComplete({
    system: 'You improve the explanation of one exam MCQ. Write 90 to 150 words of clinical reasoning only: start with the key fact in **bold**, then one bullet per other option saying why it is wrong, naming the option by its text and never by its letter, then one line "High-yield: ...". Never mention sources, pages, attachments, the examiner or the question itself. Keep every fact and the marked answer exactly as they are; add no new claims. Reply with ONLY JSON: {"explanation":"..."}.',
    messages: [{ role: 'user', content: [q.stem, (q as { questionText?: string }).questionText ?? '', ...q.options.map((o) => `${o.id}) ${o.text}`), `Marked answer: ${q.correctOption}`, `Current explanation: ${String(q.explanation ?? '')}`].join('\n') }],
    json: true,
    effort: 'low',
    provider,
    model: cheapModel(provider),
    signal,
  }).catch(() => '');
  const better = String(extractJson<{ explanation?: string }>(raw)?.explanation ?? '').trim();
  if (better.length >= 80) q.explanation = better;
}

/** Marks the planned facts whose finding has a typical picture, so picture slots go to facts that can carry one. */
async function tagPicturable(plan: AssignedFact[], provider: AiProviderId): Promise<AssignedFact[]> {
  if (!plan.length) return plan;
  const raw = await aiComplete({
    system: 'You mark which exam facts have a typical, recognisable picture: an X-ray, CT, MRI, ultrasound, ECG, histology slide, blood smear, fundus photo, clinical photo or gross specimen. A drug effect, a mechanism, a number or a management step has none. Reply with ONLY JSON: {"picturable":[<fact numbers>]}.',
    messages: [{ role: 'user', content: plan.map((f, i) => `${i + 1}. ${f.fact}`).join('\n') }],
    json: true,
    effort: 'low',
    provider,
    model: getEffectiveModel(provider),
  }).catch(() => '');
  const picks = new Set((extractJson<{ picturable?: number[] }>(raw)?.picturable ?? []).map((n) => Number(n) - 1));
  return plan.map((f, i) => ({ ...f, picturable: picks.has(i) }));
}

/** Null when the examiner accepts the item, otherwise its one-sentence reason for rejecting it. */
async function examinerRejects(q: ClinicalQuestion, topic: string, signal?: AbortSignal): Promise<string | null> {
  const provider = getActiveProvider();
  if (!provider) return null;
  const raw = await aiComplete({
    system:
      'You are an examiner checking one MCQ before it is used. Mark ok=false only when you are sure of a problem: ' +
      '(1) the marked answer is wrong by standard textbooks and guidelines; (2) more than one option is defensible; ' +
      '(3) the answer only holds for one particular study, cohort, hospital, country or textbook layout, or it is a research detail no exam would ask; ' +
      '(4) the stem or options are incomplete or contradict themselves. A NOT or EXCEPT question with a correct standard textbook key is ok=true. Otherwise ok=true. ' +
      'Reply with ONLY JSON: {"ok":true,"problem":""} or {"ok":false,"problem":"one short sentence"}.',
    messages: [{
      role: 'user',
      content: `Topic: ${topic}\n${q.stem}\n${q.questionText}\n` + q.options.map((o) => `${o.id}) ${o.text}`).join('\n') + `\nMarked answer: ${q.correctOption}\nExplanation: ${String(q.explanation ?? '').slice(0, 300)}`,
    }],
    json: true,
    effort: 'low',
    provider,
    model: getEffectiveModel(provider),
    signal,
  }).catch(() => '');
  // A failed check never blocks a question: only a clear "ok": false drops it.
  const verdict = extractJson<{ ok?: boolean; problem?: string }>(raw);
  if (verdict?.ok !== false) return null;
  return String(verdict.problem ?? '').trim().slice(0, 240) || 'the examiner found a problem with the key or the options';
}

/**
 * Orders the planned facts so a set follows the exam's frequency: each subtopic gets slots in proportion to its PYQ
 * count (a class asked more often in the papers gets more questions). Facts keep their planned order within a subtopic.
 */
function weightedOrder<T extends { subtopic: string }>(facts: T[], weights: Record<string, number>): T[] {
  const groups = new Map<string, T[]>();
  for (const f of facts) groups.set(f.subtopic, [...(groups.get(f.subtopic) ?? []), f]);
  const weighted: [string, number][] = [...groups.keys()].map((k) => [k, Math.max(1, weights[k] ?? 1)]);
  const order = spread(facts.length, weighted);
  const left = new Map([...groups].map(([k, v]) => [k, [...v]] as [string, T[]]));
  const out: T[] = [];
  for (const label of order) {
    const list = left.get(label);
    if (list && list.length) out.push(list.shift()!);
  }
  // A subtopic can run out before its share; its leftover facts follow in plan order.
  for (const list of left.values()) out.push(...list);
  return out;
}

/**
 * The source split of a set: about 70% of the questions come from the user's own library (books), 30% from the web
 * and papers. Facts keep their order within each group. When one group runs out, the other fills the rest.
 */
function mixByOrigin<T extends { origin?: 'book' | 'web' }>(facts: T[], bookShare = 0.7): T[] {
  const books = facts.filter((f) => f.origin !== 'web');
  const web = facts.filter((f) => f.origin === 'web');
  const out: T[] = [];
  let b = 0;
  let w = 0;
  while (b < books.length || w < web.length) {
    const wantBook = out.length === 0 || (b / Math.max(1, out.length)) < bookShare;
    if ((wantBook && b < books.length) || w >= web.length) out.push(books[b++]);
    else out.push(web[w++]);
  }
  return out;
}

/** PYQ frequency for each subtopic of the plan. Falls back to an even spread (weight 1) when the server has no bundle. */
async function fetchPyqWeights(subtopics: string[], exam: string): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/pyq/weights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subtopics, exam }) });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.weights ? data.weights : {};
  } catch {
    return {};
  }
}

/** Drops that a small fix can repair: the draft is kept and only the named part is rewritten. */
// A drop that only needs wording fixed keeps its draft (and its fact) and is repaired, which passes far more often than
// a fresh rewrite. 'repeat-answer' is not here: the repair keeps the same answer, so it could never pass that check.
const REPAIRABLE_DROPS = new Set([
  'generic-lead-in', 'style-one-liner-too-long', 'examiner',
  'hint-stem-words', 'hint-absolute', 'hint-length', 'similar-options',
  'stem-incomplete', 'stem-thin', 'stem-repeats-question', 'missing-statements', 'combination-list-missing',
  'refers-to-missing-picture', 'treatment-drift',
]);

/** What the writer is told when a question was dropped by the hint check, so the rewrite does not repeat the clue. */
const HINT_REASONS: Record<string, string> = {
  'hint-stem-words': 'the correct option repeated the words of the stem, which gives the answer away; reword the key so it does not echo the stem',
  'hint-absolute': 'only the correct option used an absolute word (always, never, only, all, none); remove it or use such words evenly',
  'hint-length': 'the correct option was much longer than the others; make all options about the same length',
};

/** Repairs one drafted question for the problem a check named. Returns the fixed item, or null when the repair fails. */
async function repairDraft(draft: ClinicalQuestion, problem: string, provider: AiProviderId): Promise<BatchQuestionSpec | null> {
  const answer = draft.options.find((o) => o.id === draft.correctOption)?.text ?? '';
  const line = (draft as { questionText?: string }).questionText ?? '';
  // The shape keeps the draft's option count: a 4-option template made every AMC (5-option) repair fail as 'invalid'.
  const optionShape = draft.options.map((o) => `{"id":"${o.id}","text":""}`).join(',');
  const raw = await aiComplete({
    system: `You repair one exam MCQ. Fix ONLY the problem named. Keep the same fact, the same correct answer and exactly ${draft.options.length} options. Reply with ONLY JSON: {"stem":"","questionText":"","options":[${optionShape}],"correctOption":"A","explanation":""}.`,
    messages: [{ role: 'user', content: ['Problem to fix: ' + problem, '', 'Stem: ' + draft.stem, 'Question line: ' + line, draft.options.map((o) => `${o.id}) ${o.text}`).join(String.fromCharCode(10)), 'Correct answer: ' + draft.correctOption + ') ' + answer, 'Explanation: ' + (draft.explanation ?? '')].join(String.fromCharCode(10)) }],
    json: true,
    effort: 'low',
    provider,
    model: getEffectiveModel(provider),
  }).catch(() => '');
  const fixed = extractJson<{ stem?: string; questionText?: string; options?: { id: string; text: string }[]; correctOption?: string; explanation?: string }>(raw);
  if (!fixed?.stem || !fixed.options?.length || !fixed.correctOption) return null;
  return { ...fixed, sourceCheck: 'supported' } as unknown as BatchQuestionSpec;
}

async function planFigure(q: ClinicalQuestion, topic: string, signal?: AbortSignal): Promise<void> {
  const provider = getActiveProvider();
  if (!provider) return;
  const answer = q.options.find((o) => o.id === q.correctOption)?.text ?? '';
  const raw = await aiComplete({
    system:
      'You decide whether one exam question should carry a real medical picture. It qualifies only if its answer is a finding or condition that has a typical, recognisable picture: an X-ray, CT, MRI, ultrasound, ECG, histology slide, blood smear, fundus photo or clinical photo. ' +
      'A question about a drug effect, a mechanism, a number or a management step does not qualify. The picture must not give the answer away. ' +
      'Reply with ONLY JSON: {"modality":"ECG | X-ray | CT | MRI | ultrasound | histology | smear | fundus | clinical photo","query":"3-6 English words: the finding or diagnosis plus the modality"}, or {"modality":"","query":""} if it does not qualify.',
    messages: [{ role: 'user', content: `Topic: ${topic}\n${q.stem} ${q.questionText}\nAnswer: ${answer}` }],
    json: true,
    effort: 'low',
    provider,
    model: cheapModel(provider),
    signal,
  }).catch(() => '');
  const pick = extractJson<{ modality?: string; query?: string }>(raw);
  const query = String(pick?.query ?? '').trim();
  if (!query) return;
  q.figureQuery = query;
  q.figureModality = String(pick?.modality ?? '').trim() || undefined;
}

/** The web and library sources for a topic, from the research endpoint, kept for a few minutes. */
async function fetchTopicSources(topic: string): Promise<{ title: string; text: string; kind?: string }[]> {
  const cacheKey = topic.toLowerCase();
  const cached = researchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESEARCH_TTL_MS) return cached.sources;
  try {
    const res = await fetch('/api/web/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: topic }) });
    const data = await res.json().catch(() => ({}));
    const sources = res.ok && Array.isArray(data.sources) ? data.sources : [];
    if (sources.length) researchCache.set(cacheKey, { at: Date.now(), sources });
    return sources;
  } catch {
    return [];
  }
}

/** Calls POST /api/ai/complete with the active (or given) provider. Throws typed AiError on failure. */
/** Time taken by each step of question generation. Read it in the browser console: window.__stageLog */
export interface StageTiming { stage: string; lane?: string; ms: number; endedAt: string; detail?: Record<string, number> }
export const stageLog: StageTiming[] = [];
(globalThis as { __stageLog?: StageTiming[] }).__stageLog = stageLog;

export function logStage(stage: string, ms: number, lane?: string, detail?: Record<string, number>): void {
  stageLog.push({ stage, lane, ms: Math.round(ms), endedAt: new Date().toISOString().slice(11, 23), detail });
}

/** Records a dropped question: the reason, and the question itself when it was written, so it can be examined later. */
function dropQ(ctx: { reason?: string; draft?: ClinicalQuestion; dropKey?: string; fact?: string; planned?: boolean } | undefined, reason: string): void {
  logStage(`drop:${reason}`, 0);
  if (ctx) ctx.dropKey = reason;
  const d = ctx?.draft;
  // The planned fact the attempt was written for, so each rejected question can be traced to its fact.
  const fact = ctx?.fact;
  // `why` is the reason the rewrite is told (for the examiner, its own sentence), so a drop can be checked later.
  reportQuestion('dropped', reason, d ? { why: ctx?.reason ?? null, planned: ctx?.planned ?? null, fact, stem: d.stem, questionText: (d as { questionText?: string }).questionText, options: d.options, correctOption: d.correctOption, explanation: d.explanation, subtopic: (d as { subtopic?: string }).subtopic } : (fact ? { fact } : undefined));
}

/** Counts a repair on the progress page: attempted (sent), accepted (kept after its checks) or failed (no repair returned). */
export function reportRepair(outcome: 'attempted' | 'accepted' | 'failed'): void {
  void fetch('/api/ai/nvidia-stats/repair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome }),
  }).catch(() => {});
}

/** Tells the server whether a question was kept, so the progress page counts the same questions the app shows. */
export function reportQuestion(outcome: 'accepted' | 'dropped', reason?: string, draft?: unknown): void {
  void fetch('/api/ai/nvidia-stats/question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, reason, draft }),
  }).catch(() => {});
}

/** Runs one step and records how long it took. */
export async function timed<T>(stage: string, fn: () => Promise<T>, lane?: string): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    logStage(stage, performance.now() - t0, lane);
  }
}

// Mixed mode (DeepSeek selected): writing and checking use two lanes at once. DeepSeek takes up to 4 calls,
// NVIDIA takes one call at a time, so the NVIDIA lane never bursts past its limit.
const laneCapacity: Record<'vyce' | 'nvidia', number> = { vyce: 4, nvidia: 3 };
const laneBusy: Record<'vyce' | 'nvidia', number> = { vyce: 0, nvidia: 0 };
const laneWaiters: (() => void)[] = [];

export function isMixedMode(): boolean {
  return getActiveProvider() === 'vyce';
}

/** Waits for a free lane and returns it. Call release() when the call is finished. */
export async function acquireLane(only?: 'vyce' | 'nvidia'): Promise<{ provider: AiProviderId; model: string; release: () => void }> {
  for (;;) {
    const order: ('vyce' | 'nvidia')[] = only ? [only] : ['vyce', 'nvidia'];
    for (const p of order) {
      if (laneBusy[p] < laneCapacity[p]) {
        laneBusy[p] += 1;
        return {
          provider: p,
          model: getEffectiveModel(p),
          release: () => {
            laneBusy[p] -= 1;
            laneWaiters.splice(0).forEach((wake) => wake());
          },
        };
      }
    }
    await new Promise<void>((resolve) => laneWaiters.push(resolve));
  }
}

/** Calls the completion route. In mixed mode, writing calls take a free lane; otherwise the selected engine is used. */
export async function aiComplete(options: AiCompleteOptions): Promise<string> {
  if (options.work && !options.provider && isMixedMode()) {
    // Writing always goes to DeepSeek: NVIDIA refuses the large writing requests, and its lane is kept for checks.
    const lane = await timed('lane-wait', () => acquireLane('vyce'));
    try {
      return await timed('write', () => completeOn(lane.provider, lane.model, options), lane.provider);
    } finally {
      lane.release();
    }
  }
  const route = options.work ? writeRoute() : null;
  const provider = route?.provider ?? options.provider ?? getActiveProvider();
  if (!provider) {
    throw new AiError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`, 'not_connected');
  }
  // When the OpenCode plan is used up, calls go to Claude Haiku 5.5 instead (if Claude is connected), and the plan
  // is not tried again for ten minutes, so each call does not first fail on OpenCode.
  const useHaiku = () => completeOn('claude', HAIKU_FALLBACK_MODEL, { ...options, provider: 'claude', model: HAIKU_FALLBACK_MODEL });
  if (provider === 'opencode' && Date.now() < opencodeExhaustedUntil) {
    try { return await timed('write', useHaiku, 'claude'); } catch { /* Claude is not available: try OpenCode anyway */ }
  }
  try {
    return await timed('write', () => completeOn(provider, options.model ?? route?.model ?? getEffectiveModel(provider), options), provider);
  } catch (err: any) {
    if (provider !== 'opencode' || !/usage limit/i.test(String(err?.message || err))) throw err;
    opencodeExhaustedUntil = Date.now() + 10 * 60 * 1000;
    try {
      return await timed('write', useHaiku, 'claude');
    } catch {
      opencodeExhaustedUntil = 0;
      throw err;
    }
  }
}

/** The model used when the OpenCode plan has no usage left. */
const HAIKU_FALLBACK_MODEL = 'claude-haiku-5-5';
let opencodeExhaustedUntil = 0;

/** The provider and model a call should use now: Claude Haiku 5.5 while the OpenCode plan is used up, else the active one. */
function currentRoute(provider: AiProviderId): { provider: AiProviderId; model: string } {
  if (provider === 'opencode' && Date.now() < opencodeExhaustedUntil) return { provider: 'claude', model: HAIKU_FALLBACK_MODEL };
  return { provider, model: getEffectiveModel(provider) };
}

/**
 * Runs a writing call as a server job: starts it, then checks it every 400 ms with a short request. The browser
 * holds only a short connection at a time, so many questions can wait on the server at once. Returns the same
 * kind of response /api/ai/complete would, so the caller reads it the same way.
 */
async function runCompletionJob(body: unknown, signal?: AbortSignal): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'x-opencode-session': openCodeSessionId() };
  const start = await fetch('/api/ai/jobs', { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!start.ok) return start;
  const { id } = await start.json();
  const pause = (ms: number) => new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  let failures = 0;
  for (;;) {
    await pause(400);
    try {
      const check = await fetch(`/api/ai/jobs/${id}`, { signal });
      if (!check.ok) throw new Error(`job check failed (HTTP ${check.status})`);
      failures = 0;
      const data = await check.json();
      if (!data.done) continue;
      return new Response(JSON.stringify(data.body), {
        status: data.status,
        headers: data.retryAfter ? { 'retry-after': data.retryAfter } : undefined,
      });
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        void fetch(`/api/ai/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
        throw err;
      }
      if (++failures >= 5) throw err;
    }
  }
}

async function completeOn(provider: AiProviderId, model: string, options: AiCompleteOptions): Promise<string> {
  const body = {
    provider,
    model,
    system: options.system,
    messages: options.messages,
    json: options.json,
    effort: options.effort,
    groundOn: options.groundOn,
  };

  let res: Response;
  try {
    res = options.work
      ? await runCompletionJob(body, options.signal)
      : await fetch('/api/ai/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-opencode-session': openCodeSessionId() },
          body: JSON.stringify(body),
          signal: options.signal,
        });
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw new AiError('Generation stopped.', 'aborted');
    }
    throw new AiError(`Could not reach the local AI server (${err?.message || 'network error'}).`, 'network');
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const srvMsg = typeof data?.error === 'string' ? data.error : `AI request failed (HTTP ${res.status}).`;
    if (res.status === 401) throw new AiError(`${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. ${NOT_CONNECTED_MESSAGE}`, 'not_connected');
    const err = new AiError(srvMsg, 'api');
    err.status = res.status;
    const ra = res.headers.get('retry-after');
    if (ra) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) err.retryAfterMs = Math.min(30_000, Math.max(0, secs * 1000));
    }
    throw err;
  }
  const text = typeof data?.text === 'string' ? data.text : '';
  if (!text.trim()) throw new AiError('The AI provider returned an empty response. Try again.', 'api');
  return text;
}

/** Same as aiComplete, with images (data URLs) attached to the last message. Throws if they cannot be sent. */
export async function aiCompleteWithImages(options: AiCompleteOptions, images: string[]): Promise<string> {
  const provider = options.provider ?? getActiveProvider();
  const res = await fetch('/api/ai/complete-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      model: options.model ?? (provider ? getEffectiveModel(provider) : undefined),
      system: options.system,
      messages: options.messages,
      json: options.json,
      effort: options.effort,
      images,
    }),
    signal: options.signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(typeof data?.error === 'string' ? data.error : `AI request failed (HTTP ${res.status}).`, 'api');
  const text = typeof data?.text === 'string' ? data.text : '';
  if (!text.trim()) throw new AiError('The AI provider returned an empty response. Try again.', 'api');
  return text;
}

// ---------- JSON helpers ----------

/** Extract the first JSON value from raw model output (tolerates markdown fences and surrounding prose). */
export function extractJson<T = any>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end > -1) text = text.slice(0, end + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * A reply cut off mid-item (token limit, dropped connection) is invalid JSON as a whole,
 * but every item before the cut is intact. Walk the "questions" array and keep each
 * COMPLETE object so one truncated tail never throws away a whole batch.
 */
export function salvageQuestionObjects(text: string): any[] {
  if (!text) return [];
  const key = text.indexOf('"questions"');
  const open = text.indexOf('[', key >= 0 ? key : 0);
  if (open < 0) return [];
  const items: any[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { items.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip a malformed item */ }
        start = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return items;
}

// ---------- AI exam-question generation ----------

const GENERATOR_SYSTEM = `You are a senior item writer for the Indian and Australian postgraduate medical entrance exams (NEET-PG, INI-CET, AMC CAT).
Your questions are written to DISCRIMINATE between well-prepared candidates, not to confirm what everyone already knows. An item that a candidate can answer from a single buzzword is a failed item.
Every question has exactly one defensible best answer. Distractors are real, plausible entities that a half-prepared candidate would genuinely choose, never absurd or obviously wrong.
Always respond with ONLY a single valid JSON object (no markdown fences, no commentary).`;

/**
 * Per-exam item patterns, ported from the original app's generator (its `__cmExam`
 * table). These, not a one-line label, are what keep the questions exam-standard.
 */
const EXAM_PATTERNS: Record<ExamType, { name: string; opts: number; pat: string }> = {
  NEET_PG: {
    name: 'NEET PG',
    opts: 4,
    pat: "NEET PG (NBEMS) pattern. Exactly 4 options (A-D), one correct; +4 for correct, -1 for wrong. Mostly 2-5 line clinical vignettes giving age, sex, presenting complaint, key examination findings and results, ending with ONE lead-in such as 'What is the most likely diagnosis?', 'What is the next best step in management?', 'What is the investigation of choice?', 'What is the drug of choice?' or 'Identify the structure/condition shown'. Mix in one-liner factual recall items, about one in five image-based items (describe the X-ray, CT, histology slide, instrument, ECG or clinical photo finding in words, then ask to identify it), integrated items linking two subjects, and PSM/biostatistics calculations where relevant. Every item is single best answer: no numbered-statement, match-the-following or assertion-reason items. Options must be homogeneous and close; avoid 'all of the above', 'none of the above' and 'all except' wording.",
  },
  INI_CET: {
    name: 'INI-CET',
    opts: 4,
    pat: "INI-CET (AIIMS) pattern. Exactly 4 options (A-D); +1 correct, -1/3 wrong. Most items (about seven in eight) are single-best-answer items: clinical vignettes, drug of choice, next step, or factual recall. About one item in five asks which option is INCORRECT, FALSE or NOT true (for example 'Which of the following is NOT a feature of ...?'). Numbered multiple-statement items ('Which of the following statements is/are correct? 1. ... 2. ... 3. ... 4. ...' with options such as '1 and 3 only', '2, 3 and 4 only') are rare, at most one item in eight. Match-the-following (List I with List II, options as code combinations like 'A-2, B-4, C-1, D-3'), assertion-reason (Assertion A / Reason R with the four standard options), arrange-in-correct-sequence, and recent-advances or guideline facts. Image-heavy topics describe the image in words. Distractors must be very close; elimination should be hard.",
  },
  AMC_CAT: {
    name: 'AMC CAT MCQ',
    opts: 5,
    pat: "AMC CAT MCQ pattern (Australia). Exactly 5 options (A-E), one best answer, no negative marking. Every item is a patient vignette set in Australian practice (general practice, emergency department, ward, rural or remote clinic) giving age, sex, history, examination and relevant results, ending with ONE lead-in such as 'What is the most appropriate next step in management?', 'What is the most likely diagnosis?', 'Which investigation is most appropriate?', 'What is the most appropriate advice?'. Test data gathering, data interpretation and management, favouring safe guideline-based next steps. Follow Australian sources: Therapeutic Guidelines (eTG), Australian Medicines Handbook, RACGP Red Book, John Murtagh's General Practice (safe diagnostic strategy: probability diagnosis, serious disorders not to be missed, pitfalls, masquerades, is the patient trying to tell me something), National Immunisation Program, state Mental Health Acts, consent and Gillick competence, mandatory reporting, Aboriginal and Torres Strait Islander health. Options must be homogeneous (all diagnoses, or all management steps).",
  },
};

const TIER_BEHAVIOUR: Record<string, string> = {
  LOW: 'EASY: still a short clinical vignette (never a bare one-line fact). One inferential step. Distractors are plausible and share the same category as the key, but the key is clearly best to a well-prepared candidate.',
  MEDIUM: 'MEDIUM: a full vignette. The candidate must first infer the diagnosis or mechanism, then choose the correct next step. Distractors are close mimickers or classic confusions, so recognising the buzzword alone does not give the answer.',
  HIGH: 'HARD: a long vignette with two or three reasoning steps, an atypical or overlapping presentation, and a recent-guideline or evidence-based decision point. Every distractor is individually defensible in some other scenario; only the exact details of THIS patient make one option best. Elimination must be hard and the key must not be guessable from keywords.',
};

const GENERATION_RULES =
  'Rules: medically accurate and current; do not invent doses or values; no two questions on the same fact; ' +
  'the stem must not contain a clue that gives the answer away; options must be homogeneous and of similar length; ' +
  'vary which option is correct across the batch (do not favour B or C). ' +
  'No hints: the stem and lead-in must not name the drug class, drug, mechanism or diagnosis that the correct option names, ' +
  'and must not repeat its distinctive words; the correct option must not be the only option with absolute wording ' +
  '(absolutely, always, never, only, must, all, none) and must not be noticeably longer or more detailed than the others; ' +
  'distractors must be as specific and as carefully worded as the key. ' +
  'Use only real, named drugs, trials, guidelines and numbers that you are sure of: never invent a drug code, trial name, percentage or fold-change. ' +
  'Any item about statements (1, 2, 3, 4) must list every statement inside the stem, and the options refer only to those statements. ' +
  'The stem must contain the facts needed to answer the question, and the keyed option must be the one the sources support.';

// A topic whose question failed or was dropped is written again this many times before it is given up.
const MAX_TOPIC_RETRIES = 6;
// How often one draft is re-sent to the source checker after the checker itself failed (network, provider error).
const MAX_VERIFY_ERRORS = 2;
// Rewrites of one topic that may repair the previous draft instead of writing a new question.
const MAX_REPAIRS = 2;

// Copies of the same question request sent at once. The first copy that passes every check is kept.
const QUESTION_COPIES = 2;


// Words that carry no meaning for the hint check.
const HINT_STOP = new Set(['patient', 'patients', 'therapy', 'treatment', 'regimen', 'clinical', 'should', 'would', 'could', 'which', 'after', 'before', 'during', 'between', 'within', 'without', 'present', 'presents', 'presenting', 'history', 'known', 'reported', 'showing', 'additional', 'following', 'highest', 'lowest', 'maximum', 'minimum', 'most', 'least', 'first', 'second', 'third', 'current', 'currently', 'recent', 'recently', 'initial', 'initially', 'likely', 'appropriate', 'correct']);
const ABSOLUTE_WORDS = /\b(absolutely|always|never|only|solely|exclusively|must|all|none)\b/i;

/**
 * Catches a question whose stem gives the answer away: the key's distinctive words repeat in the stem, the key alone
 * uses absolute wording, or the key is much longer than the other options. Returns the drop reason, or null.
 */
/**
 * Asks the server to check a candidate against the sources: the keyed answer must be correct, and every fact it
 * relies on must be supported. Anything it cannot confirm is dropped. A failed check counts as not verified.
 */
// Checks run a few at a time, so they do not flood the provider and get refused.
const VERIFY_LANES = 4;
let verifyBusy = 0;
const verifyWaiting: (() => void)[] = [];
async function withVerifyLane<T>(task: () => Promise<T>): Promise<T> {
  if (verifyBusy >= VERIFY_LANES) await new Promise<void>((resolve) => verifyWaiting.push(resolve));
  verifyBusy += 1;
  try {
    return await task();
  } finally {
    verifyBusy -= 1;
    verifyWaiting.shift()?.();
  }
}

/**
 * Asks the server to check a candidate against the sources. Returns 'supported' or 'unsupported' from the verdict.
 * A check that the server could not complete (refused or failed) is retried, so a busy provider does not count as
 * a wrong answer. Returns 'error' only if every try fails.
 */
async function verifyItem(q: ClinicalQuestion, groundOn: { query: string; subject: string }, signal?: AbortSignal): Promise<'supported' | 'unsupported' | 'error'> {
  const provider = getActiveProvider();
  if (!provider) return 'error';
  return withVerifyLane(async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) return 'error';
      try {
        const res = await fetch('/api/ai/verify-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The checker is a stronger model than the writer, so a weak writer cannot approve its own mistakes.
      body: JSON.stringify({ ...(provider === 'nvidia' ? { provider, model: DEFAULT_MODELS.nvidia } : currentRoute(provider)), question: q, groundOn }),
          signal,
        });
        if (res.ok) {
          const data = await res.json();
          return data?.verdict === 'supported' ? 'supported' : 'unsupported';
        }
      } catch (err: any) {
        if (signal?.aborted || err?.name === 'AbortError') return 'error';
      }
      await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    }
    return 'error';
  });
}

/**
 * Catches a question that cannot be answered as written: an empty or one-line stem with no vignette, or options that
 * refer to numbered statements that the question does not list. Returns the drop reason, or null.
 */
export function structureReason(q: ClinicalQuestion): string | null {
  const text = `${q.stem ?? ''} ${(q as { questionText?: string }).questionText ?? ''}`.trim();
  if ((q.stem ?? '').trim().length < 20 && text.length < 80) return 'empty-stem';
  // A stem that ends mid-sentence (":", ",", ";") was cut off before the question.
  if (/[:,;]\s*$/.test((q.stem ?? '').trim())) return 'stem-incomplete';
  // A stem that only repeats the question gives the student no case or context.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const questionOnly = (q as { questionText?: string }).questionText ?? '';
  if (questionOnly && norm(q.stem ?? '') === norm(questionOnly)) return 'stem-repeats-question';
  const optionText = q.options.map((o) => o.text).join(' ');
  const refersToStatements = /\bstatements?\b|\b\d\s*(,|and|&)\s*\d\b.*\bonly\b/i.test(optionText);
  const listsStatements = /(^|\s)1[.)]\s/.test(text) || /\bstatements?\s+(1|one)\b/i.test(text);
  if (refersToStatements && !listsStatements) return 'missing-statements';
  return null;
}

export function hintReason(q: ClinicalQuestion): string | null {
  const key = q.options.find((o) => o.id === q.correctOption);
  const others = q.options.filter((o) => o.id !== q.correctOption);
  if (!key || others.length === 0) return null;
  const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z-]{5,}/g) || []).filter((w) => !HINT_STOP.has(w));
  const stemWords = new Set(words(`${q.stem} ${(q as { questionText?: string }).questionText ?? ''}`));
  const keyWords = [...new Set(words(key.text))];
  const shared = keyWords.filter((w) => stemWords.has(w));
  // The key's words mostly repeat the stem's: a clue. Shared subject words alone (the drug or disease both name) are normal.
  if (shared.length >= 3 && shared.length / Math.max(1, keyWords.length) >= 0.5) return 'hint-stem-words';
  if (ABSOLUTE_WORDS.test(key.text) && !others.some((o) => ABSOLUTE_WORDS.test(o.text))) return 'hint-absolute';
  const avgOther = others.reduce((sum, o) => sum + o.text.length, 0) / others.length;
  if (key.text.length > avgOther * 1.5 && key.text.length - avgOther > 40) return 'hint-length';
  return null;
}

// Options that must keep their order (combination codes, "all of the above", ...) are never shuffled.
const NO_SHUFFLE = /\b(all|none|both|neither)\b.*\b(above|these|of the)\b|\b(a|b|c|d|e)\s*(and|&|,)\s*(a|b|c|d|e)\b|^\s*(a|b|c|d|e)\s*[,&]|\bonly\s*$|^\s*\d(\s*(,|and|&)\s*\d)+/i;

/** Models over-use B/C for the key. Shuffle so the position is not a tell. */
export function shuffleOptions(entries: { id: string; text: string }[], correctId: string): { entries: { id: string; text: string }[]; correct: string } {
  if (entries.length < 3 || entries.some((e) => NO_SHUFFLE.test(e.text))) return { entries, correct: correctId };
  const order = entries.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const ids = ['A', 'B', 'C', 'D', 'E'];
  const origCorrect = entries.findIndex((e) => e.id === correctId);
  return {
    entries: order.map((o, i) => ({ id: ids[i], text: entries[o].text })),
    correct: ids[order.indexOf(origCorrect)],
  };
}

interface BatchQuestionSpec {
  examType: string;
  subject: string;
  subtopic: string;
  cognitiveTier: string;
  difficultyTier: string;
  difficultySubLevel?: string;
  stem: string;
  questionText: string;
  options: Record<string, string>;
  correctOption: string;
  boardPearl: string;
  explanation?: string;
  citations: string[];
  trapType?: string;
  trapExplanation?: string;
  targetAccuracy?: number;
  figureModality?: string;
  figureQuery?: string;
  /** "supported" when the keyed option is backed by the internet sources the writer read; otherwise a question is not kept. */
  sourceCheck?: string;
}

export interface GenerateQuestionsOptions {
  exam: ExamType;
  count: number;
  subjectSubtopics: { subject: string; subtopics: string[] }[];
  /** The learner's typed topic, exactly as they wrote it. Every item must test that content itself. */
  requestedTopic?: string;
  /** Facts planned before writing (fact assignment): one question slot per planned fact. */
  factPlan?: AssignedFact[];
  difficultyTier: DifficultyTier;
  difficultySubLevel?: DifficultySubLevel;
  effort?: string;
  /** Section-14 options: question types / stem patterns / evidence sources / patient context */
  questionTypes?: string[];
  stemPatterns?: string[];
  /** Explicit style ids (vignette, one-liner, negative, match, multi-statement, assertion-reason, calculation, mechanism, image). */
  styles?: string[];
  /** Explicit lead-ins (next-step, drug-of-choice, investigation-of-choice, treatment-of-choice, diagnosis, advice). */
  leadIns?: string[];
  evidenceSources?: string[];
  patientGroup?: string;
  presentingProblems?: string[];
  /** "My notes" source: real saved highlights/notes the questions must be derived from. */
  sourceMaterial?: string;
  /**
   * Ask for image-based items (~1 in 5) and attach a verified picture from the local
   * medical-image library when one matches the item's diagnosis.
   */
  includeImages?: boolean;
  /**
   * Learner's temporary generation profile (suggestion box in Practice Builder).
   * Sent as a user-message instruction for THIS run only; never persisted, never edited
   * into the system prompt.
   */
  customInstructions?: string;
  /** Progress after each completed batch: ready count, target total, batch number (1-based), planned batch count. */
  onProgress?: (ready: number, total: number, batch: number, totalBatches: number) => void;
  /** Called with the questions of each completed batch (after image attachment). */
  onBatch?: (batchQuestions: ClinicalQuestion[]) => Promise<void> | void;
  /** Shared array the caller uses to await all per-batch post-processing. */
  batchPromises?: Promise<void>[];
  /** Checked between batches; return true to stop early and keep everything generated so far. */
  shouldStop?: () => boolean;
  /** Questions already kept in this module; new questions must not repeat them. */
  existing?: ClinicalQuestion[];
  /** Topic units ("subtopic|focus") already written in this module. Shared across rounds and updated here. */
  usedUnits?: Set<string>;
  /** Aborts the in-flight batch request immediately (Stop button) and ends the loop. */
  signal?: AbortSignal;
  /** Called when a batch is being retried: 1-based attempt, attempt limit, and why. */
  onRetry?: (attempt: number, maxAttempts: number, reason: string) => void;
}

const SUB_LEVEL_DEFAULT: Record<'LOW' | 'MEDIUM' | 'HIGH', DifficultySubLevel> = {
  LOW: 'L1',
  MEDIUM: 'M1',
  HIGH: 'H1',
};

const TIER_ACCURACY: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 82,
  MEDIUM: 64,
  HIGH: 48,
};

const validCogTiers = ['Direct Recall', 'Clinical 2-Step', 'Multi-Step & IBQ'];
const tierToCog: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'Direct Recall',
  MEDIUM: 'Clinical 2-Step',
  HIGH: 'Multi-Step & IBQ',
};

/** setTimeout that resolves early (and harmlessly) when the run is aborted. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** Turns a provider error into one sentence a learner can act on. */
export function describeFailure(err: any): string {
  if (!err) return 'the provider returned nothing';
  const msg = String(err?.message || err).replace(/\s+/g, ' ').trim();
  if (/content[_ ]?filter|safety/i.test(msg)) {
    return 'the provider’s safety filter blocked that batch — retrying with clinical-only wording';
  }
  return msg.length > 220 ? msg.slice(0, 217) + '…' : msg;
}

/** Empty replies, 5xx and throttling are worth retrying; a missing login is not. */
function isRetryable(err: any): boolean {
  if (err instanceof AiError) return err.kind === 'api' || err.kind === 'network';
  return true;
}

let globalSeq = 0;
function nextId(exam: ExamType): string {
  globalSeq += 1;
  return `AI-${exam.replace('_', '')}-${Date.now().toString(36)}-${globalSeq}`;
}

/** Validate/repair one raw question from the model; null when it must be dropped. */
function buildQuestion(raw: any, exam: ExamType, pool: { subject: string; subtopic: string }[], tier: 'LOW' | 'MEDIUM' | 'HIGH', subLevel: DifficultySubLevel | undefined, requiredOptions: number): ClinicalQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const stem = typeof raw.stem === 'string' ? raw.stem.trim() : '';
  if (!stem) return null; // non-empty stem required

  // options: accept {"A": "...", ...} or [{id,text}]
  const entries: { id: string; text: string }[] = [];
  if (Array.isArray(raw.options)) {
    raw.options.forEach((o: any) => {
      if (o && typeof o.text === 'string' && o.text.trim()) {
        const id = (typeof o.id === 'string' ? o.id : '').trim().toUpperCase();
        if (['A', 'B', 'C', 'D', 'E'].includes(id)) entries.push({ id: id as any, text: o.text.trim() });
      }
    });
  } else if (raw.options && typeof raw.options === 'object') {
    for (const key of ['A', 'B', 'C', 'D', 'E']) {
      const text = raw.options[key];
      if (typeof text === 'string' && text.trim()) entries.push({ id: key as any, text: text.trim() });
    }
  }
  if (entries.length !== requiredOptions) return null; // each exam has a fixed option count

  const keyed = String(raw.correctOption ?? '').trim().toUpperCase();
  if (!entries.some((o) => o.id === keyed)) return null; // correctOption must exist among options
  const shuffled = shuffleOptions(entries, keyed);
  const correct = shuffled.correct;

  const requested = pool[Math.floor(Math.random() * pool.length)];
  // The learner selected a specific topic; trust that over whatever subtopic string the
  // model chose to put in its JSON. The model frequently "drifts" to a neighbouring
  // subtopic (e.g. you ask for "Antifungal & Antiviral Drugs" and it returns "Antibiotics"),
  // which is why question pools came out mixed. Subject is honoured the same way.
  const subject = typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : requested.subject;
  const subtopic = requested.subtopic;

  const cogTier =
    validCogTiers.includes(raw.cognitiveTier) ? raw.cognitiveTier : tierToCog[tier];
  const aiTier: 'LOW' | 'MEDIUM' | 'HIGH' = ['LOW', 'MEDIUM', 'HIGH'].includes(raw.difficultyTier) ? raw.difficultyTier : tier;
  const targetAccuracy =
    typeof raw.targetAccuracy === 'number' && raw.targetAccuracy > 5 && raw.targetAccuracy < 100
      ? Math.round(raw.targetAccuracy)
      : TIER_ACCURACY[aiTier];

  return {
    id: nextId(exam),
    moduleCode: `${exam.replace('_', '-')} · AI Generated Module`,
    examType: exam,
    subject,
    subtopic,
    cognitiveTier: cogTier as ClinicalQuestion['cognitiveTier'],
    difficultyTier: aiTier,
    difficultySubLevel: subLevel || SUB_LEVEL_DEFAULT[aiTier],
    stem,
    questionText: typeof raw.questionText === 'string' && raw.questionText.trim() ? raw.questionText.trim() : stem,
    options: shuffled.entries.map((o) => ({ id: o.id as 'A' | 'B' | 'C' | 'D' | 'E', text: o.text })),
    correctOption: correct as ClinicalQuestion['correctOption'],
    boardPearl: typeof raw.boardPearl === 'string' ? raw.boardPearl.trim() : '',
    keyFact: typeof raw.keyFact === 'string' && raw.keyFact.trim() ? raw.keyFact.trim().slice(0, 400) : undefined,
    explanation: typeof raw.explanation === 'string' && raw.explanation.trim() ? raw.explanation.trim() : undefined,
    citations: Array.isArray(raw.citations)
      ? raw.citations.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim()).slice(0, 5)
      : [],
    trapType: typeof raw.trapType === 'string' && raw.trapType.trim() ? raw.trapType.trim() : undefined,
    trapExplanation: typeof raw.trapExplanation === 'string' && raw.trapExplanation.trim() ? raw.trapExplanation.trim() : undefined,
    targetAccuracy,
    figureModality: typeof raw.figureModality === 'string' && raw.figureModality.trim() ? raw.figureModality.trim() : undefined,
    figureQuery: typeof raw.figureQuery === 'string' && raw.figureQuery.trim() ? raw.figureQuery.trim() : undefined,
  };
}

/**
 * Generate `count` MCQs with the user's ACTIVE AI provider, in batches of <=10.
 * Returns validated ClinicalQuestion[] tagged sourceType:'ai-generator' plus the number dropped.
 */
export async function generateExamQuestions(options: GenerateQuestionsOptions): Promise<{ questions: ClinicalQuestion[]; dropped: number; stopped: boolean; failure: string | null; imagesAttached: number }> {
  const {
    exam, count, subjectSubtopics, requestedTopic, factPlan, difficultyTier, difficultySubLevel, effort,
    onProgress, onBatch, batchPromises, shouldStop, existing, usedUnits: unitsUsed, signal, onRetry,
    questionTypes, stemPatterns, styles: explicitStyles, leadIns: explicitLeadIns, evidenceSources, patientGroup, presentingProblems,
    sourceMaterial, customInstructions, includeImages,
  } = options;
  const learnerProfile = typeof customInstructions === 'string' ? customInstructions.trim().slice(0, 1500) : '';
  // Every picture comes from the internet at generation time (Wikimedia Commons + Open-i).
  // The lookup can be switched off in Settings.
  const activeProvider = getActiveProvider();
  const liveImages = includeImages && isLiveImageSearchEnabled();
  let attachedImages = 0;
  const usedImages = new Set<string>();
  let figuresPlanned = 0;

  const tier: 'LOW' | 'MEDIUM' | 'HIGH' = difficultyTier === 'ALL' ? 'MEDIUM' : difficultyTier;
  const pattern = EXAM_PATTERNS[exam];
  const questions: ClinicalQuestion[] = [];
  let dropped = 0;

  let stopped = false;
  let failure: string | null = null;
  const seenStems = new Set<string>();
  const acceptedStems: string[] = [];
  // Correct-letter counts, raised when a letter is placed (not when the question is accepted), so questions finishing
  // at the same time get different letters. The least-used letter wins; ties go round A, B, C, D.
  const placedLetters: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  let placementTurn = 0;
  const nextLetter = (): string => {
    const min = Math.min(...Object.values(placedLetters));
    const order = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i += 1) {
      const letter = order[(placementTurn + i) % 4];
      if (placedLetters[letter] === min) { placementTurn += 1; placedLetters[letter] += 1; return letter; }
    }
    return 'A';
  };
  // Key facts of accepted questions: the same fact asked in other words is still a repeat.
  const acceptedKeyFacts: string[] = [];
  // Planned facts already accepted: a planned fact is tested once in a set.
  const acceptedPlannedFacts = new Set<string>();
  // How often the examiner has rejected a question built on each planned fact. A fact rejected twice is usually wrong,
  // hedged or too obscure in the source itself, so it is retired instead of being rewritten again and again.
  const examinerFactFails = new Map<string, number>();
  const MAX_EXAMINER_FAILS_PER_FACT = 2;
  // Any planned fact rejected three times (a toxin fact given a treatment lead-in, a trivia fact whose options come out
  // alike) is retired too: its later rewrites almost never pass, and each one costs a writer call.
  const factDrops = new Map<string, number>();
  const MAX_DROPS_PER_FACT = 3;
  const factRetired = (topic: unknown, dropKey?: string): boolean => {
    const fact = (topic as { assigned?: AssignedFact }).assigned?.fact;
    // Network, verify and over-target drops say nothing about the fact.
    if (!fact || !dropKey || ['verify-error', 'over-target', 'unparsed'].includes(dropKey)) return false;
    const drops = (factDrops.get(fact) ?? 0) + 1;
    factDrops.set(fact, drops);
    return drops >= MAX_DROPS_PER_FACT || (dropKey === 'examiner' && (examinerFactFails.get(fact) ?? 0) >= MAX_EXAMINER_FAILS_PER_FACT);
  };
  // Correct answers kept so far in this set (checked so one answer is not asked twice).
  const acceptedAnswers: string[] = [];
  // The same answers as written, for telling a rewrite which answers are taken (the normalised keys are unreadable).
  const acceptedAnswerTexts: string[] = [];
  // The most recent entries of a list, short, for a rewrite prompt: enough to steer away, without a long prompt.
  const usedList = (items: string[]) => items.slice(-12).map((t) => `"${t.slice(0, 70)}"`).join('; ') || 'none';
  const stemKey = (stem: string) =>
    stem.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 140);
  // Topic units already written: "subtopic|focus". Planning in a later round skips them.
  const used = unitsUsed ?? new Set<string>();
  // Questions already kept in this module (from an earlier round): new ones must not repeat them.
  for (const prior of existing ?? []) {
    seenStems.add(stemKey(prior.stem));
    acceptedStems.push(toBenchItem(prior).stem);
    if (prior.keyFact) acceptedKeyFacts.push(prior.keyFact);
  }

  // ---------- Step 1: Topic Planning ----------
  // Ask the backend to plan topic distribution with importance weighting.
  // Higher priority topics are repeated more often across concurrent batches.
  // The first plan lists exactly one topic per question. Later plans list twice the number, so there are spare
  // topics when some questions fail their check.
  const planTopics = async (size = count * 2): Promise<PlannedTopic[] | null> => {
    try {
      const res = await fetch('/api/ai/plan-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectSubtopics,
          count: size,
          difficultyTier,
          provider: activeProvider || 'gemini',
          model: getEffectiveModel(activeProvider || 'gemini'),
          exam,
          effort,
          exclude: [...used],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.topics)) return null;
      return data.topics.map((t: any) => ({
        subject: t.subject,
        subtopic: t.subtopic,
        focus: typeof t.focus === 'string' && t.focus.trim() ? t.focus.trim() : undefined,
        difficultyTier: (t.difficultyTier ?? tier) as 'LOW' | 'MEDIUM' | 'HIGH',
      }));
    } catch {
      return null;
    }
  };

  // The progress page counts one run, so the NVIDIA counts start again here.
  void fetch('/api/ai/nvidia-stats/reset', { method: 'POST' }).catch(() => {});
  // A typed topic is spread evenly across its categories, so the priority weighting is skipped: the planner
  // would keep choosing the top-priority category, and one category would fill the whole set.
  // With a fact plan, each planned fact is one slot (facts already used in this module are skipped on later rounds).
  // The plan lists each subtopic's facts together, so taking slots in order would fill a set from the top subtopic.
  // Interleaving gives every subtopic one question before any subtopic gets a second: a 10-question set from 30
  // subtopics covers 10 subtopics, and a 50-question set covers each subtopic about evenly.
  // Each subtopic's share of the set follows its PYQ frequency for this exam (see server/pyqFrequency.mjs).
  const pyqWeightsForPlan = requestedTopic && factPlan?.length
    ? await fetchPyqWeights([...new Set(factPlan.map((f) => f.subtopic))], exam)
    : {};
  const plannedFacts = requestedTopic && factPlan?.length
    ? weightedOrder(factPlan.filter((f) => !used.has(`${f.subtopic}|${f.fact}`)), pyqWeightsForPlan)
    : [];
  // Every planned fact gets a slot: its style (vignette, one-liner, NOT, match, statements, ...), lead-in and difficulty,
  // from the styles the learner picked or, when none, the exam's own mix.
  const subjectGuess = plannedFacts.length && requestedTopic ? await guessSubject(requestedTopic) : undefined;
  const slots: Slot[] = plannedFacts.length
    ? planSlots(plannedFacts.map((f) => ({ fact: f.fact, subtopic: f.subtopic, picturable: f.picturable })), exam, stylesFromChips(questionTypes, explicitStyles), leadInsFromChips(stemPatterns, explicitLeadIns), difficultyTier, subjectGuess)
    : [];
  const plannedTopics = plannedFacts.length
    ? plannedFacts.map((f, i) => ({ subject: requestedTopic ?? '', subtopic: f.subtopic, focus: f.fact, difficultyTier: slots[i].tier, assigned: f, slot: slots[i] }))
    : requestedTopic ? null : await planTopics(count);

  // Build the subject/subtopic pool as fallback.
  const pool: { subject: string; subtopic: string }[] = [];
  const subjectEntries = subjectSubtopics.map((s) => ({ subject: s.subject, subs: s.subtopics.filter((t) => typeof t === 'string' && t.trim()) }));
  const maxLen = Math.max(0, ...subjectEntries.map((s) => s.subs.length));
  for (let i = 0; i < maxLen; i++) {
    for (const entry of subjectEntries) {
      if (entry.subs[i]) pool.push({ subject: entry.subject, subtopic: entry.subs[i] });
    }
  }
  const workingPool = pool.length ? pool : [{ subject: subjectSubtopics[0]?.subject ?? 'General Medicine', subtopic: 'General Clinical Sciences' }];

  // ---------- Step 2: Select topic subsets for concurrent batches ----------
  // For 50-100 questions, we select subsets of 10 topics per concurrent batch.
  // Important topics (higher priority) appear more often in the topic list.
  const topics: PlannedTopic[] = plannedTopics ??
    Array.from({ length: count * 2 }, (_, i) => ({
      ...workingPool[i % workingPool.length],
      difficultyTier: tier,
    }));

  // ---------- Step 3: Single-question generation ----------
  const generateSingleQuestion = async (topic: { subject: string; subtopic: string; difficultyTier: 'LOW' | 'MEDIUM' | 'HIGH' }, attempt: number, focus?: string, shape?: string, ctx?: { reason?: string; draft?: ClinicalQuestion; dropKey?: string; fact?: string; planned?: boolean }, slotOverride?: Slot, repaired?: BatchQuestionSpec): Promise<ClinicalQuestion | null> => {
    if (ctx) ctx.fact = focus ?? topic.subtopic;
    if (signal?.aborted || shouldStop?.()) { stopped = true; return null; }

    // Fact first (typed topics) where the sources have facts: the question is written around a fact the sources state.
    // If picks keep failing with no success, the fact step is switched off and the earlier writer path is used.
    // A slot with an assigned fact (from the fact plan) already has its fact, so no per-question pick runs.
    const assigned = (topic as { assigned?: AssignedFact }).assigned;
    // The slot (style, lead-in, difficulty) this question was planned for; a slot given by the worker replaces it on a fallback.
    const slot = slotOverride ?? (topic as { slot?: Slot }).slot;
    const factStepOn = !assigned && Boolean(requestedTopic && activeProvider) && (factHits > 0 || factTries < 6);
    if (ctx) ctx.planned = Boolean(assigned);
    const sourced = assigned ?? (factStepOn
      ? await pickSourcedFact(requestedTopic!, focus, activeProvider!, signal ?? undefined, acceptedKeyFacts)
      : null);
    if (factStepOn) { if (sourced) factHits += 1; else factTries += 1; }

    // The server reads the internet on this topic with the request, and the writer checks its key against
    // those sources in the same call, so no separate check runs afterwards.
    const groundQuery = focus ?? focusParts(topic.subtopic)[0] ?? topic.subtopic;
    const prompt = [
      `Write ONE exam-standard MCQ for ${pattern.name}.`,
      `Subject: ${topic.subject}`,
      `Subtopic: ${topic.subtopic}`,
      // Rotate the set across the subtopic's parts (drug classes, systems) so one regimen
      // is not written again and again.
      focus ? `Focus this item on: ${focus}. Use a different drug, regimen or scenario from the usual textbook example.` : '',
      // A typed topic is what the learner wants to learn: the item must ask about that content, not a downstream decision.
      sourced ? `Base the correct option on this fact, which source "${sourced.source}" states: "${sourced.fact}". The question must test that fact, and the stem must not give the answer away. Set keyFact to this fact and sourceCheck to "supported".` : '',
      requestedTopic && slot
        ? `The learner asked for exactly: "${requestedTopic}". The item must test that content itself (the named effect, feature, drug or fact) in the style given below. The stem must give real context (a subject, a setting or a finding), never a topic label, and must not name or hint at the answer. Never refer to a picture, list or table that the stem does not contain ("this biopsy", "shown here") unless the style is image-based and the stem says what the picture shows. The options must be clearly different from each other, with only one defensible answer. Use "confirms" or "diagnostic" only when the finding really settles the diagnosis.`
        : requestedTopic ? `The learner asked for exactly: "${requestedTopic}". Each item must test that content itself (the named effect, feature, drug or fact). Test mechanism only if the request asks for it, and do not test a workup, diagnosis or management step that follows from it. Keep the stem short and direct; a brief case is fine only when the answer is that fact. The stem must give real context (a patient, a setting or a finding), never a topic label, and must not name or hint at the answer. Stay inside the request: do not write treatment, management or investigation items unless the request names them. Use a patient case in at most one item in three; the other items are one-line questions about the fact. Never use a generic lead-in such as "the most likely diagnosis" or "the most appropriate investigation" without naming the condition or the finding it is about. The four options must be clearly different from each other, with only one defensible answer. Use "confirms" or "diagnostic" only when the finding really settles the diagnosis; otherwise ask for a supporting or most likely finding.` : '',
      requestedTopic && acceptedStems.length ? `Already in this set, so do not reuse these patients, scenarios or drugs: ${acceptedStems.slice(-25).map((s) => s.slice(0, 110)).join(' | ')}` : '',
      // Told up front, the writer picks a different answer instead of being rejected for a repeat afterwards (picture
      // facts otherwise all become "the most likely diagnosis", with the same answer again and again).
      requestedTopic && acceptedAnswerTexts.length ? `These are already correct answers in this set, so your correct option must be something else; if the fact's condition is among them, ask about the fact's feature, test or finding instead of the diagnosis: ${[...new Set(acceptedAnswerTexts.map((t) => t.slice(0, 50)))].slice(-40).join('; ')}` : '',
      requestedTopic ? 'Put the question only in questionText. The stem ends with the last finding, never with a question.' : '',
      requestedTopic && slot && !/treat|manag|therap|drug|dose|regimen|rescue|prevent/i.test(requestedTopic) && !(slot.leadIn && ['next-step', 'drug-of-choice', 'treatment-of-choice', 'advice'].includes(slot.leadIn))
        ? 'The request does not ask about treatment, so the question line must not ask for a treatment, regimen, drug of choice or management step; ask for the diagnosis, finding, organism, stain, test or feature instead.'
        : '',
      requestedTopic && acceptedKeyFacts.length ? `Key facts already tested in this set. Do not test any of them again, not even in other words: ${acceptedKeyFacts.slice(-20).map((f) => f.slice(0, 120)).join(' | ')}` : '',
      shape ?? '',
      slot && STYLES[slot.style].codedOptions ? '' : `Make the ${pattern.opts} options similar in length and detail. The correct option must not be the longest or the most detailed.`,
      `Difficulty: ${topic.difficultyTier}. ${slot ? tierText(slot.style, topic.difficultyTier) : TIER_BEHAVIOUR[topic.difficultyTier]}`,
      slot ? `${EXAM_RULES[exam]} ${COMMON_STYLE_RULES}` : pattern.pat,
      !slot && questionTypes?.length ? `Question type focus: ${questionTypes.join('; ')}.` : '',
      !slot && stemPatterns?.length ? `Stem pattern: ${stemPatterns.join('; ')}.` : '',
      evidenceSources?.length ? `Ground answers in: ${evidenceSources.join('; ')}.` : '',
      patientGroup ? `Patient group: ${patientGroup}.` : '',
      presentingProblems?.length ? `Presenting problems: ${presentingProblems.join('; ')}.` : '',
      sourceMaterial ? `Base on these notes: """${sourceMaterial.slice(0, 6000)}""".` : '',
      'Internet sources on this topic are attached after this request. Base the correct option on them where they apply, state the fact in keyFact, and do not copy their wording. Set "sourceCheck" to "supported" only if one of those sources directly backs the keyed option; otherwise set it to "not supported" and change the item to a fact that they do back. sourceCheck concerns only the keyed option and keyFact: patient details in a vignette and the reasons given for the wrong options may use standard textbook knowledge.',
      slot && slot.style !== 'image'
        ? 'This item is not image-based: set "figureModality" and "figureQuery" to empty strings, and never refer to a picture.'
        : includeImages
        ? 'If this item is image-based (about one in five items must be), describe the finding in the stem AND set "figureModality" and "figureQuery" so a real picture can be fetched: "figureModality" is one of ECG | X-ray | CT | MRI | ultrasound | histology | fundus | clinical photo, and "figureQuery" is a 3-6 word English search phrase naming the diagnosis + modality (e.g. "atrial fibrillation ECG", "lobar pneumonia chest X-ray", "membranous nephropathy histology"). For items that are NOT image-based, set both to an empty string — never invent a picture.'
        : '',
      `JSON shape — return exactly one object: { "examType": "${exam}", "subject": "${topic.subject}", "subtopic": "${topic.subtopic}", "cognitiveTier": "Direct Recall | Clinical 2-Step | Multi-Step & IBQ", "difficultyTier": "${topic.difficultyTier}", "stem": "...", "questionText": "...", "options": {${'ABCDE'.slice(0, pattern.opts).split('').map(k => `"${k}": "text"`).join(', ')}}, "correctOption": "A|B|C|D|E", "explanation": "...", "keyFact": "one sentence: the textbook or guideline fact that makes the correct option right, stated so a student could look it up", "boardPearl": "...", "citations": [...], "trapType": "...", "trapExplanation": "...", "targetAccuracy": 0-100, "sourceCheck": "supported|not supported"${includeImages ? ', "figureModality": "", "figureQuery": ""' : ''} }`,
      learnerProfile ? `Learner instructions: """${learnerProfile}"""` : '',
      'Output ONLY the JSON object.',
    ].join('\n');

    // Several copies of the same request run at once. The first copy that passes every check is kept, and the others are stopped.
    const outerSignal = signal;
    // NVIDIA sends several copies and keeps the first that passes. Paid providers send one copy, to keep cost down.
    const paid = getActiveProvider() !== 'nvidia';
    const copies = Array.from({ length: paid ? 1 : QUESTION_COPIES }, () => new AbortController());
    let claimed = false;
    const runCopy = async (own: AbortController): Promise<ClinicalQuestion | null> => {
    const signal = outerSignal ? AbortSignal.any([outerSignal, own.signal]) : own.signal;
    const MAX_ATTEMPTS = 3;
    for (let a = attempt; a <= MAX_ATTEMPTS; a++) {
      if (outerSignal?.aborted || shouldStop?.()) { stopped = true; return null; }
      if (own.signal.aborted) return null;
      try {
        const raw = repaired ? JSON.stringify(repaired) : await aiComplete({
          system: GENERATOR_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
          json: true,
          work: true,
          // The thinking pass writes the item and checks its key against the internet sources in one call.
          // Paid providers reason less: the sources are already in the request, so long reasoning mostly adds cost.
          effort: getActiveProvider() === 'nvidia' ? 'high' : 'low',
          groundOn: { query: groundQuery, subject: topic.subject },
          signal,
        });
        const parsed = extractJson<BatchQuestionSpec>(raw);
        if (!parsed) { if (ctx) ctx.reason = 'the reply was not one valid JSON object in the shape given; return only that object'; dropQ(ctx, 'unparsed'); return null; }
        if (String(parsed.sourceCheck ?? '').trim().toLowerCase() === 'not supported') { if (ctx) ctx.reason = 'your own source check found the key not supported by the sources; test a fact the sources state plainly'; dropQ(ctx, 'unsupported'); return null; }

        const q = buildQuestion(parsed, exam, [{ subject: topic.subject, subtopic: topic.subtopic }], topic.difficultyTier, difficultySubLevel, pattern.opts);
        if (!q) { if (ctx) ctx.reason = `the item had the wrong shape: give exactly ${pattern.opts} non-empty options with ids ${'ABCDE'.slice(0, pattern.opts).split('').join(', ')}, and a correctOption that is one of them`; dropQ(ctx, 'invalid'); return null; }
        if (ctx) ctx.draft = q;
        // The writer often repeats the question at the end of the stem as well as in the question line. That is a
        // formatting slip, not a bad item: the trailing question is cut from the stem when a question line exists.
        {
          const line = ((q as { questionText?: string }).questionText ?? '').trim();
          const stemText = (q.stem ?? '').trim();
          if (line && /\?\s*$/.test(stemText)) {
            const cut = stemText.replace(/(^|[.!]\s+)[^.!?]*\?\s*$/, '$1').trim();
            if (cut.split(/\s+/).length >= 6) q.stem = cut;
          }
        }
        // A non-picture slot whose stem already describes its picture in words keeps the item ("this section" becomes
        // "the section"); a picture slot keeps its pointer until the picture search has run.
        if (!(slot?.style === 'image' && q.figureQuery)) unpointDescribedPicture(q);
        // For a typed topic a stem under six words is usually just a label, not context for the question.
        const thinStem = requestedTopic && (q.stem ?? '').trim().split(/\s+/).filter(Boolean).length < 6;
        // Two options that say nearly the same thing make the item ambiguous, so the item is dropped.
        const optionTexts = (q.options || []).map((o) => o.text);
        const twinOptions = optionTexts.some((a, i) => optionTexts.some((b, j) => j > i && stemSimilarity(a, b) >= 0.7));
        // The same age and sex as a patient already in the set makes the items look alike, so the item is dropped.
        const patientOf = (s: string) => (s.match(/\b\d{1,3}[- ](?:year|month)s?[- ]old\s+(?:man|woman|boy|girl|infant|child|male|female)\b/i)?.[0] ?? '').toLowerCase();
        const myPatient = patientOf(q.stem ?? '');
        // Same age and sex is only a repeat when the cases also share the condition or setting: two different diseases in
        // two 58-year-old men are different cases.
        const GENERIC_CASE_WORDS = new Set(['presents', 'presented', 'patient', 'history', 'years', 'after', 'develops', 'developed', 'complains', 'examination', 'shows', 'culture', 'grows', 'infection', 'treatment', 'therapy', 'antibiotic', 'antibiotics', 'following', 'symptoms', 'fever', 'pained', 'chronic', 'acute', 'known', 'receives', 'received', 'admitted', 'brought', 'department', 'emergency', 'hospital', 'intensive', 'current', 'several', 'weeks', 'months', 'before', 'during', 'there', 'which', 'their', 'being', 'having', 'started', 'despite']);
        const caseWords = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 6 && !GENERIC_CASE_WORDS.has(w)));
        const myWords = caseWords(q.stem ?? '');
        const sharesCondition = (other: string): boolean => { let n = 0; for (const w of caseWords(other)) if (myWords.has(w)) n += 1; return n >= 2; };
        const repeatedPatient = requestedTopic && myPatient !== '' && acceptedStems.some((s) => patientOf(s) === myPatient && sharesCondition(s));
        // Patient stems are capped at half the set, so the set is not mostly vignettes. A stricter cap made most attempts fail.
        const isCase = requestedTopic && /\b\d{1,3}[- ](?:year|month)s?[- ]old\b/i.test(q.stem ?? '');
        const casesSoFar = acceptedStems.filter((s) => /\b\d{1,3}[- ](?:year|month)s?[- ]old\b/i.test(s)).length;
        // The cap starts once 8 items are kept; from the first item it stalled sets on topics the verifier finds harder.
        const tooManyCases = Boolean(isCase) && acceptedStems.length >= 8 && casesSoFar >= Math.ceil(0.6 * (acceptedStems.length + 1));
        // A typed topic that does not name treatment gets no treatment or management items (hard filter, not a prompt hint).
        const topicNamesTreatment = /treat|manag|therap|drug|dose|regimen|rescue|prevent/i.test(requestedTopic ?? '');
        // Only clear treatment phrases count; words like "therapy" or "dose" also appear in side-effect questions.
        // Only what the question asks counts: case history ("no response to antibiotics", "on first-line therapy") and
        // laboratory questions ("antibiotic sensitivity testing") are not treatment items.
        const askLine = ((q as { questionText?: string }).questionText ?? '').trim() || (q.stem ?? '').split(/(?<=[.!])\s+/).pop() || '';
        const treatmentItem = /\b(management|manage|treat(?:ed|ment)?\b(?! response)|first-line (?:drug|treatment|therapy|agent)|next step|initial therapy|rescue therapy|drug of choice|prophylaxis|regimen|which (?:antibiotic|antimicrobial|drug|agent)s? (?:should|would|is (?:most )?(?:appropriate|indicated|preferred))|should be (?:started|given|prescribed)|appropriate (?:now|next|initial)|resuscitation)\b/i.test(askLine.replace(/\b(?:antibiotic|antimicrobial|drug) (?:sensitivity|susceptibility|resistance)\b/gi, ''));
        const driftsIntoTreatment = Boolean(requestedTopic) && !topicNamesTreatment && treatmentItem;
        // A generic lead-in ("Choose the single best answer") or a very short question line does not name the fact it tests.
        const qLine = ((q as { questionText?: string }).questionText ?? '').trim();
        // A question must stand on its own stem: it cannot point to a list or item the stem does not give.
        const dependsOnOutside = /\b(that|those|this|these) (list|group|set|pattern|eruption|statement)s?\b|\blisted\b|\bon that\b|\bthat list\b|\bthat statement\b/i.test(`${q.stem ?? ''} ${qLine}`) && !/\b(list|statement|pattern)\b/i.test(q.stem ?? '');
        // A stem that is itself a question (ends with "?") is not a stem: it gives no case or context.
        const stemIsQuestion = Boolean(requestedTopic) && /\?\s*$/.test((q.stem ?? '').trim());
        // Styles with a fixed question line ("Choose the correct combination.", "Which statements are correct?") are short by design.
        const shortLineOk = Boolean(slot);
        const codedOptions = Boolean(slot) && STYLES[slot!.style].codedOptions;
        // A management lead-in (next step, drug of choice, advice) is the style asked for, not drift.
        const managesByDesign = Boolean(slot?.leadIn) && ['next-step', 'drug-of-choice', 'treatment-of-choice', 'advice'].includes(slot!.leadIn!);
        const genericLeadIn = Boolean(requestedTopic) && (stemIsQuestion || (!shortLineOk && qLine.length < 40) || /^(choose|select) the (single )?best answer/i.test(qLine) && !shortLineOk || (/^which of the following is the most likely diagnosis\??$/i.test(qLine) && slot?.leadIn !== 'diagnosis' && slot?.style !== 'image') || dependsOnOutside);
        // With a planned style mix the slots decide how many cases there are, so the case cap is off.
        const shape = structureReason(q) ?? (combinationListMissing(q) ? 'combination-list-missing' : null) ?? (inventedSource(q) ? 'invented-source' : null) ?? (genericLeadIn ? 'generic-lead-in' : null) ?? (thinStem ? 'stem-thin' : null) ?? (twinOptions && !codedOptions ? 'similar-options' : null) ?? (repeatedPatient ? 'repeat-patient' : null) ?? (tooManyCases && !slot ? 'too-many-cases' : null) ?? (driftsIntoTreatment && !managesByDesign ? 'treatment-drift' : null);
        const SHAPE_HINTS: Record<string, string> = {
          'generic-lead-in': 'the question line must name the fact or finding it asks about; do not end the stem with a question mark',
          'invented-source': 'do not cite a guideline, survey, study or shortage; describe the case itself, with no source the stem does not give',
          'combination-list-missing': 'the question asks for a combination or a match, so the stem must list the items: "A. ...", "B. ...", "C. ...", "D. ..." and "1. ...", "2. ...", "3. ...", "4. ..." each on its own line',
          'stem-thin': 'the stem needs real context, not a label',
          'similar-options': 'two options said nearly the same thing; make every option clearly different',
          'repeat-patient': 'use a different patient (age and sex) from those already in the set',
          'treatment-drift': 'stay on the requested content; do not turn it into a treatment question',
          'stem-incomplete': 'the stem ended mid-sentence; finish it',
          'stem-repeats-question': 'the stem repeated the question; give the case or context',
          'missing-statements': 'list the numbered statements inside the stem',
        };
        if (shape) { if (ctx) ctx.reason = SHAPE_HINTS[shape] ?? shape; dropQ(ctx, `${shape}`); return null; }
        // The style asked for must really be delivered (match lists, numbered statements, numbers, lead-in, and so on).
        const styleIssue = styleProblem(q, slot, pattern.opts, true);
        if (styleIssue) { if (ctx) ctx.reason = styleIssue; dropQ(ctx, `style-${styleIssue.split(':')[0]}`); return null; }
        const hint = hintReason(q);
        if (hint) { if (ctx) ctx.reason = HINT_REASONS[hint] ?? hint; dropQ(ctx, `${hint}`); return null; }

        // The first copy to pass the structure checks claims the question. The claim is then checked against the
        // sources once, so the checker runs once per question, not once per copy. A rejected claim releases the question.
        if (claimed) { dropQ(ctx, 'late-copy'); return null; }
        claimed = true;
        // Dedup against already-accepted questions: exact stems, then near-identical scenarios
        // (same patient and regimen with the words reshuffled).
        const key = stemKey(q.stem);
        if (seenStems.has(key)) { claimed = false; if (ctx) ctx.reason = 'this exact stem is already in the set; write a different case or context'; dropQ(ctx, 'repeat-stem'); return null; }
        const fullStem = toBenchItem(q).stem;
        if (acceptedStems.some((s) => stemSimilarity(s, fullStem) >= DUPLICATE_SIMILARITY)) { claimed = false; if (ctx) ctx.reason = 'the scenario is nearly the same as one already in the set; use a different patient, setting and wording'; dropQ(ctx, 'similar-stem'); return null; }
        // The same key fact asked in other words (same drug, same finding) is a repeat, even when the stem differs.
        // Without a written key fact, the correct option's text stands in, so repeats are still caught.
        // A planned slot keeps its planned fact as the key fact. The planner already kept those facts distinct.
        const keyFact = sourced ? sourced.fact : ((q.keyFact || '').trim() || (q.options.find((o) => o.id === q.correctOption)?.text ?? '').trim());
        if (assigned && acceptedPlannedFacts.has(assigned.fact)) { dropQ(ctx, 'repeat-planned-fact'); return null; }
        if (!sourced && keyFact && acceptedKeyFacts.some((k) => stemSimilarity(k, keyFact) >= KEY_FACT_SIMILARITY)) { claimed = false; if (ctx) ctx.reason = `the set already tests this fact. Test a different fact of the topic. Facts already used: ${usedList(acceptedKeyFacts)}`; dropQ(ctx, 'repeat-fact'); return null; }
        // The same correct answer asked again in other words (for example the same imaging test) is also a repeat.
        // Abbreviations and generic words are normalised first, so "CT" and "computed tomography", or "serum lipase level"
        // and "lipase assay", count as the same answer.
        const answerKey = (s: string) => s.toLowerCase()
          .replace(/\bct\b/g, 'computed tomography')
          .replace(/\b(serum|level|levels|assay|test|the|of|and|in|a|an|with|for|is|are|on|at)\b/g, ' ')
          .replace(/\s+/g, ' ').trim();
        const correctText = (q.options.find((o) => o.id === q.correctOption)?.text ?? '').trim();
        const correctKey = answerKey(correctText);
        if (correctKey && requestedTopic && !codedOptions && acceptedAnswers.some((a) => stemSimilarity(a, correctKey) >= 0.5)) { claimed = false; if (ctx) ctx.reason = `the correct answer "${correctText.slice(0, 80)}" is already the answer of another question in the set; pick a fact with a different answer. Answers already used: ${usedList(acceptedAnswerTexts)}`; dropQ(ctx, 'repeat-answer'); return null; }
        const verdict = await verifyItem(q, { query: groundQuery, subject: topic.subject }, signal);
        if (verdict !== 'supported') {
          claimed = false;
          if (verdict === 'error') {
            // The checker could not be reached: the question was not judged, so it is checked again later
            // (the worker re-sends this draft) instead of being thrown away and costing one of the topic's rewrites.
            providerErrorStreak += 1;
            logStage('drop:verify-error', 0);
            if (ctx) ctx.dropKey = 'verify-error';
            return null;
          }
          if (ctx) ctx.reason = 'the independent source check could not confirm the marked answer; test a fact the sources state plainly and make the key match it exactly';
          dropQ(ctx, 'unverified');
          return null;
        }
        copies.forEach((c) => { if (c !== own) c.abort(); });

        // A last look by a second reader: a wrong key, two defensible answers, or a fact that only one study, place or
        // textbook layout makes true. Such a question is dropped and another is written in its place.
        const examinerProblem = requestedTopic ? await examinerRejects(q, requestedTopic, signal) : null;
        if (examinerProblem) {
          // The examiner's own words go to the rewrite and to the drop file, so a rewrite fixes that problem.
          if (ctx) ctx.reason = `the examiner rejected it: ${examinerProblem}`;
          if (assigned) examinerFactFails.set(assigned.fact, (examinerFactFails.get(assigned.fact) ?? 0) + 1);
          dropQ(ctx, 'examiner');
          return null;
        }
        // The explanation must say why the key is right and why the others are wrong; if it does not, it is rewritten.
        if (requestedTopic && ((slot?.style !== 'calculation' && !explainsDistractors(q)) || explanationLeaks(q))) await repairExplanation(q, signal);
        // The correct letters rotate through A-D over the accepted questions, so no letter dominates the set.
        // Coded options (combinations, numbers, assertion-reason) keep their order.
        if (requestedTopic && !codedOptions) placeCorrectAt(q, nextLetter());

        // Pictures. An image-style slot always asks for one; other slots only when the fact has a typical picture, for at
        // most about one question in four. Without a slot (a plain subject run) the earlier rule applies.
        const wantsPicture = Boolean(includeImages && liveImages) && (
          slot ? (slot.style === 'image' || (assigned?.picturable === true && figuresPlanned < Math.ceil((acceptedStems.length + 1) / 4)))
            : (!q.figureQuery && figuresPlanned < Math.ceil((acceptedStems.length + 1) / 4)));
        if (wantsPicture && !q.figureQuery) {
          await planFigure(q, requestedTopic ?? topic.subject, signal);
          if (q.figureQuery) figuresPlanned += 1;
        }
        let attachedHere: string | null = null;
        if (includeImages && liveImages && q.figureQuery) {
          const live = await findLiveImage(q.figureQuery, usedImages);
          if (live && !usedImages.has(live.id)) {
            usedImages.add(live.id);
            attachedHere = live.id;
            q.image = live.proxyUrl;
            q.imageSourceUrl = live.articleUrl;
            q.imageCaption = liveImageCaption(live);
            q.imageId = live.id;
            q.imageLicence = live.licence;
            q.imageGroundTruth = q.figureQuery;
            q.imageVerified = live.verified === true;
            q.imageVerifyReason = live.verifyReason;
          }
        }
        // A stem that points at a picture ("this biopsy") must have one; otherwise the item cannot be answered.
        // When no picture was found but the stem describes it in words, the item is kept as a picture-description item.
        if (pointsAtMissingPicture(q) && !unpointDescribedPicture(q)) {
          if (attachedHere) usedImages.delete(attachedHere);
          if (ctx) ctx.reason = 'the stem points at a picture that is not there; describe the finding in words instead';
          dropQ(ctx, 'refers-to-missing-picture');
          return null;
        }
        if (attachedHere) attachedImages += 1;

        if (correctKey) { acceptedAnswers.push(correctKey); acceptedAnswerTexts.push(correctText); }
        seenStems.add(key);
        acceptedStems.push(fullStem);
        if (keyFact) acceptedKeyFacts.push(keyFact);
        if (assigned) acceptedPlannedFacts.add(assigned.fact);

        used.add(`${topic.subtopic}|${focus ?? ''}`);
        return q;
      } catch (err: any) {
        // A copy stopped because another copy won is not a stop of the whole run.
        if (own.signal.aborted && !outerSignal?.aborted) return null;
        providerErrorStreak += 1;
        if (outerSignal?.aborted || (err instanceof AiError && err.kind === 'aborted') || err?.name === 'AbortError') {
          stopped = true;
          return null;
        }
        if (err instanceof AiError && err.kind === 'not_connected') throw err;
        if (!isRetryable(err)) break;
        // Rate limited by the provider: wait longer before the next attempt.
        if (/429|rate.?limit|too many requests/i.test(String(err?.message || err))) {
          await new Promise((resolve) => setTimeout(resolve, 4000 * (a + 1)));
        }
      }
    }
    return null;
    };
    // The first copy to return a question wins. If every copy fails, the question is null.
    return new Promise<ClinicalQuestion | null>((resolve) => {
      let pending = copies.length;
      let done = false;
      const settle = (q: ClinicalQuestion | null) => {
        pending -= 1;
        if (done) return;
        if (q) { done = true; resolve(q); }
        else if (pending === 0) { done = true; resolve(null); }
      };
      copies.forEach((own) => { runCopy(own).then(settle, () => settle(null)); });
    });
  };

  // ---------- Step 4: Fire all question-generation requests in parallel ----------
  // Use a completion counter that updates progress as each question finishes.
  let completedCount = 0;
  let questionsInProgress = 0;
  // At most GENERATION_CONCURRENCY question requests run at once, so the provider does not rate-limit them.
  const GENERATION_CONCURRENCY = parallelRequestLimit();
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const limited = <T,>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const start = () => {
      inFlight += 1;
      task().then(resolve, reject).finally(() => {
        inFlight -= 1;
        waiting.shift()?.();
      });
    };
    if (inFlight < GENERATION_CONCURRENCY) start();
    else waiting.push(start);
  });
  // A pool of workers takes planned topics from a queue. When the queue runs low, more topics are planned right
  // away, so a question starts as soon as a lane is free, while others are still in progress.
  type QueueItem = { topic: PlannedTopic; idx: number; retries: number; hint?: string; slot?: Slot; repaired?: BatchQuestionSpec; verifyErrors?: number };
  const queue: QueueItem[] = topics.map((topic, idx) => ({ topic, idx, retries: 0 }));
  let slotCounter = topics.length;
  let refilling: Promise<boolean> | null = null;
  const refill = (): Promise<boolean> => {
    if (!refilling) {
      refilling = (async () => {
        if (shouldStop?.() || signal?.aborted) return false;
        // With a fact plan every slot is a planned fact. A generic refill would add questions with no fact and no style
        // (off-topic or the wrong shape), so a planned set ends when its facts do.
        if (requestedTopic && plannedFacts.length) return false;
        const more = await planTopics();
        const extra: PlannedTopic[] = more && more.length ? more : Array.from({ length: count }, (_, i) => ({
          ...workingPool[(slotCounter + i) % workingPool.length],
          difficultyTier: tier,
        }));
        for (const topic of extra) queue.push({ topic, idx: slotCounter++, retries: 0 });
        return extra.length > 0;
      })().finally(() => { refilling = null; });
    }
    return refilling;
  };
  // Fact-first counters for this run: how many picks worked and how many were tried.
  const styleExplicit = stylesFromChips(questionTypes, explicitStyles).length > 0;
  const leadInExplicit = leadInsFromChips(stemPatterns, explicitLeadIns).length > 0;
  let factHits = 0;
  let factTries = 0;
  // Consecutive provider errors (not rejected questions): when the provider is down, the run stops with a message.
  let providerErrorStreak = 0;
  const MAX_NULL_STREAK = 40;
  let markTargetReached: () => void = () => {};
  const targetReached = new Promise<void>((resolve) => { markTargetReached = resolve; });
  const worker = async (): Promise<void> => {
    // The item this lane must try next: a repaired question goes straight back to the lane that found the defect.
    let pending: QueueItem | null = null;
    for (;;) {
      if (stopped || shouldStop?.() || signal?.aborted || questions.length >= count) return;
      // Plan more topics as soon as the queue is shorter than the number of lanes, so every lane has a topic to start on.
      if (queue.length < GENERATION_CONCURRENCY && questions.length < count) void refill();
      if (queue.length === 0 && !pending) {
        if (questionsInProgress > 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
        if (!(await refill())) return;
        continue;
      }
      // Every worker lane runs a question at once, so the speed does not drop as the set nears its full count.
      if (questionsInProgress >= GENERATION_CONCURRENCY) { await new Promise((r) => setTimeout(r, 300)); continue; }
      // A rewrite goes back into the queue only after its own attempt has finished, so one question is never written twice
      // at once; rewrites of different questions run in parallel with the other lanes.
      if (!pending && questions.length + questionsInProgress >= count) { await new Promise((r) => setTimeout(r, 300)); continue; }
      const next: QueueItem = pending ?? queue.shift()!;
      pending = null;
      const { topic, idx, retries, hint, slot: slotOverride, repaired, verifyErrors = 0 } = next;
      const slot = slotOverride ?? topic.slot;
      const parts = focusParts(topic.subtopic);
      // A planned topic carries its own focus (one drug class, one part of a subtopic); otherwise rotate the parts.
      const focus = topic.focus ?? (parts.length > 1 ? parts[idx % parts.length] : undefined);
      questionsInProgress += 1;
      // A rewrite is told why the last attempt was rejected.
      const ctx: { reason?: string; draft?: ClinicalQuestion; dropKey?: string; fact?: string; planned?: boolean } = {};
      const shapeText = slot
        ? `${STYLES[slot.style].instruction(slot, pattern.opts)}${hint ? ` Your previous attempt was rejected because: ${hint}. Fix exactly that.` : ''}`
        : requestedTopic ? typedShape(idx) : itemShape(idx, exam);
      const q = await generateSingleQuestion(topic, 0, focus, shapeText, ctx, slotOverride, repaired).finally(() => { questionsInProgress -= 1; });
      completedCount += 1;
      // Circuit breaker: when the provider is down every slot fails, and a run that keeps refilling its queue would
      // send thousands of calls. A long unbroken streak of failures ends the run with a message instead.
      if (providerErrorStreak >= MAX_NULL_STREAK && questions.length < count && !stopped) {
        failure = 'The AI provider kept returning errors, so this set was stopped. Check the connection and try again.';
        stopped = true;
        markTargetReached();
        return;
      }
      if (q && questions.length >= count) {
        // Questions still in flight when the target was reached are discarded, so the set never goes over the count asked for.
        dropQ(ctx, 'over-target');
      } else if (q) {
        questions.push(q);
        reportQuestion('accepted');
        if (repaired) reportRepair('accepted');
        if (questions.length >= count) markTargetReached();
      } else if (ctx.dropKey === 'verify-error' && ctx.draft && verifyErrors < MAX_VERIFY_ERRORS && !stopped && !signal?.aborted) {
        // The source checker failed for network or provider reasons, not because of the question. The same draft is
        // checked again without using up a rewrite; the provider-error breaker above still ends a run whose provider is down.
        pending = { topic, idx, retries, hint, slot: slotOverride, repaired: ctx.draft as unknown as BatchQuestionSpec, verifyErrors: verifyErrors + 1 };
      } else if (factRetired(topic, ctx.dropKey)) {
        // The planned fact keeps failing (the examiner rejected it twice, or any check rejected it three times): the
        // slot is given up (the drop is already counted), and the lane moves on to the next fact.
      } else if (retries < MAX_TOPIC_RETRIES && !stopped && !signal?.aborted) {
        // The call failed or the question was dropped: the same topic goes back in the queue, so it is written again.
        // The last rewrite of a demanding style (match, statements, calculation, picture) falls back to a plain style, so the slot is not lost.
        const plain: StyleId[] = ['one-liner', 'short-case', 'vignette'];
        const fallbackStyle: StyleId = exam === 'AMC_CAT' ? 'vignette' : exam === 'NEET_PG' ? 'one-liner' : 'short-case';
        // A style the learner picked is never swapped for another: a calculation item that cannot be written is left out.
        const styleFallback = slot && !styleExplicit && retries + 1 >= MAX_TOPIC_RETRIES && !plain.includes(slot.style) ? { ...slot, style: fallbackStyle } : slotOverride;
        // A planned lead-in the fact does not fit ("treatment of choice" for a toxin fact) is dropped on the rewrite, unless
        // the learner chose that lead-in.
        const nextSlot = ctx.dropKey === 'style-wrong-lead-in' && slot?.leadIn && !leadInExplicit ? { ...(styleFallback ?? slot), leadIn: undefined } : styleFallback;
        // A rejected question goes to the front of the queue: the next free lane regenerates it before any fresh question.
        // The repair starts at the moment the defect is found, in this lane: it is not put behind the queue.
        // Up to two repairs per topic: a second repair, told the new problem, still keeps the fact and is cheaper than a rewrite.
        const canRepair = retries < MAX_REPAIRS && Boolean(ctx.draft) && Boolean(ctx.dropKey) && REPAIRABLE_DROPS.has(ctx.dropKey!);
        const fixed = canRepair
          ? await repairDraft(ctx.draft!, ctx.reason ?? ctx.dropKey!, getActiveProvider() ?? 'nvidia').catch(() => null)
          : null;
        if (fixed === null && canRepair) reportRepair('failed');
        else if (fixed) reportRepair('attempted');
        pending = { topic, idx, retries: retries + 1, hint: ctx.reason, slot: nextSlot, repaired: fixed ?? undefined };
      }
      onProgress?.(questions.length, count, completedCount, Math.max(completedCount, slotCounter));
      if (onBatch && questions.length > 0 && completedCount % Math.max(1, Math.floor(count / 2)) === 0) {
        const p = onBatch(questions.slice());
        if (p && batchPromises) batchPromises.push(Promise.resolve(p));
      }
    }
  };
  // The run ends as soon as the target is reached. Calls still in flight would only be discarded, so they are not waited for.
  await Promise.race([Promise.all(Array.from({ length: GENERATION_CONCURRENCY }, () => worker())), targetReached]);

  // Dedup by stem (already done in generateSingleQuestion, but double-check).
  const unique = questions.filter((q, i) => questions.findIndex((x) => x.stem === q.stem) === i);
  questions.length = 0;
  questions.push(...unique);

  // Count dropped (questions requested but not delivered).
  dropped = count - questions.length;

  // ---------- Step 5: Attach images for any remaining image-based items ----------
  // Only items the model marked image-based (non-empty figureQuery) get a picture.
  // The old code fell back to `stem.slice(0, 48)` and so attached a loosely-related
  // (or irrelevant) figure to EVERY question — that is why images looked "messed up".
  if (includeImages && liveImages && questions.length > 0) {
    // Process images sequentially to avoid rate limiting.
    for (const q of questions) {
      if (signal?.aborted || shouldStop?.()) { stopped = true; break; }
      if (q.image) continue;      // already has an image
      if (!q.figureQuery) continue; // not an image-based item — leave it text-only

      const live = await findLiveImage(q.figureQuery, usedImages);
      if (live && !usedImages.has(live.id)) {
        usedImages.add(live.id);
        q.image = live.proxyUrl;
        q.imageSourceUrl = live.articleUrl;
        q.imageCaption = liveImageCaption(live);
        q.imageId = live.id;
        q.imageLicence = live.licence;
        q.imageGroundTruth = q.figureQuery;
        q.imageVerified = live.verified === true;
        q.imageVerifyReason = live.verifyReason;
        attachedImages += 1;
      }
    }
  }

  return { questions, dropped, stopped, failure, imagesAttached: attachedImages };
}
