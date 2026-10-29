// Saved AI-instruction profiles for the Practice Module Builder.
// The builder's "AI instructions" box used to be a throwaway string. Profiles make a good
// prompt reusable: name it once, then apply it to any future generation. Stored in
// localStorage (per browser profile), alongside the current draft so a reload never loses it.

export interface InstructionProfile {
  id: string;
  name: string;
  text: string;
  /** Which exam the profile was written for (informational, not enforced). */
  exam?: string;
  createdAt: string;
  updatedAt: string;
}

const PROFILES_KEY = 'pulse.ai.instructionProfiles';
const DRAFT_KEY = 'pulse.ai.instructionDraft';
const ACTIVE_KEY = 'pulse.ai.instructionActive';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the in-memory state still works for this session */
  }
}

export function listProfiles(): InstructionProfile[] {
  const rows = readJson<InstructionProfile[]>(PROFILES_KEY, []);
  return Array.isArray(rows)
    ? rows
        .filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string')
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    : [];
}

function persist(rows: InstructionProfile[]): void {
  writeJson(PROFILES_KEY, rows);
}

export function createProfile(input: { name: string; text: string; exam?: string }): InstructionProfile {
  const now = new Date().toISOString();
  const profile: InstructionProfile = {
    id: `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim().slice(0, 80) || 'Untitled profile',
    text: input.text.trim(),
    exam: input.exam,
    createdAt: now,
    updatedAt: now,
  };
  persist([profile, ...listProfiles()]);
  return profile;
}

export function updateProfile(id: string, patch: { name?: string; text?: string }): InstructionProfile | null {
  const rows = listProfiles();
  const index = rows.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const next: InstructionProfile = {
    ...rows[index],
    ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || rows[index].name } : {}),
    ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  rows[index] = next;
  persist(rows);
  return next;
}

export function deleteProfile(id: string): void {
  persist(listProfiles().filter((p) => p.id !== id));
  if (getActiveProfileId() === id) setActiveProfileId(null);
}

export function getProfile(id: string | null): InstructionProfile | null {
  if (!id) return null;
  return listProfiles().find((p) => p.id === id) ?? null;
}

/** The profile applied to the next generation (survives reloads). */
export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** The unsaved text currently in the box. Persisted so a reload keeps the draft. */
export function getDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) || '';
  } catch {
    return '';
  }
}

export function setDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
