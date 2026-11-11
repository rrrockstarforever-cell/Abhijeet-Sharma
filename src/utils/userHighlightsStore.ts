// User highlights store — REAL user-created highlights & notes.
// Persisted in localStorage (key 'pulse.userHighlights.v1'). User items are always
// separate from the illustrative MOCK_HIGHLIGHTS in src/data/mockClinicalData.ts,
// which are only merged (user first) for display in the Highlights screen.
import type { SavedHighlight } from '../types.ts';
import { notifyDataChanged } from './dataEvents.ts';

export type UserHighlightKind = 'manual' | 'ai-reply' | 'pdf';

export interface UserHighlight extends SavedHighlight {
  kind: UserHighlightKind;
  createdAt: string;
  /** PDF reader extras */
  color?: string;
  note?: string;
  docId?: string;
  docTitle?: string;
  page?: number;
  /**
   * Normalised selection rectangles (0–1 of the page box) so the reader can paint
   * the highlight back onto the page at any zoom level.
   */
  rects?: { x: number; y: number; w: number; h: number }[];
}

const KEY = 'pulse.userHighlights.v1';

function readArray(): UserHighlight[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UserHighlight[]) : [];
  } catch {
    return [];
  }
}

function writeArray(items: UserHighlight[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    notifyDataChanged();
  } catch (err) {
    // localStorage full/unavailable — log it; the UI still works for this session.
    console.error('Could not save user highlights', err);
  }
}

export function listUserHighlights(): UserHighlight[] {
  return readArray();
}

export function listUserHighlightsForDoc(docId: string): UserHighlight[] {
  return readArray().filter((h) => h.docId === docId);
}

export function listUserHighlightsForAllDocs(): UserHighlight[] {
  return readArray().filter((h) => h.kind === 'pdf' && h.docId);
}

export function addUserHighlight(input: Omit<UserHighlight, 'id' | 'createdAt'> & { id?: string }): UserHighlight {
  const item: UserHighlight = {
    ...input,
    id: input.id || `UH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const items = readArray();
  items.unshift(item);
  writeArray(items);
  return item;
}

export function updateUserHighlight(id: string, patch: Partial<UserHighlight>): void {
  const items = readArray().map((h) => (h.id === id ? { ...h, ...patch } : h));
  writeArray(items);
}

export function removeUserHighlight(id: string): void {
  writeArray(readArray().filter((h) => h.id !== id));
}

/** Build a SavedHighlight-shaped entry from an AI tutor reply (for "Save as highlight"). */
export function highlightFromAiReply(args: {
  quote: string;
  subject?: string;
  subtopic?: string;
  citation?: string;
  note?: string;
  tags?: string[];
}): Omit<UserHighlight, 'id' | 'createdAt'> {
  return {
    kind: 'ai-reply',
    subject: args.subject || 'General',
    subtopic: args.subtopic || 'AI Tutor',
    yieldTier: 'HIGH',
    sourceContext: 'AI Tutor',
    citation: args.citation || 'AI-generated explanation',
    quote: args.quote,
    memoryAnchor: args.note,
    note: args.note,
    tags: args.tags?.length ? args.tags : ['ai'],
    srsIntervalDays: 1,
    lastReviewed: new Date().toISOString().slice(0, 10),
  };
}

/** Build a SavedHighlight-shaped entry from a PDF text selection. */
export function highlightFromPdfSelection(args: {
  docId: string;
  docTitle: string;
  page: number;
  quote: string;
  color: string;
  note?: string;
  rects?: { x: number; y: number; w: number; h: number }[];
}): Omit<UserHighlight, 'id' | 'createdAt'> {
  return {
    kind: 'pdf',
    subject: 'General',
    subtopic: 'PDF Reader',
    yieldTier: 'HIGH',
    sourceContext: `${args.docTitle} · p. ${args.page}`,
    citation: `${args.docTitle} — page ${args.page}`,
    quote: args.quote,
    color: args.color,
    note: args.note,
    memoryAnchor: args.note,
    docId: args.docId,
    docTitle: args.docTitle,
    page: args.page,
    rects: args.rects,
    tags: ['pdf'],
    srsIntervalDays: 1,
    lastReviewed: new Date().toISOString().slice(0, 10),
  };
}
