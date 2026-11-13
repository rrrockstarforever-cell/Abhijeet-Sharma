// A message handed from one screen to the Clinical AI Tutor: the tutor reads it once when it opens and sends it.
const KEY = 'pulse-tutor-seed';

export function setTutorSeed(text: string): void {
  try { sessionStorage.setItem(KEY, text); } catch { /* storage blocked: the tutor simply opens empty */ }
}

export function takeTutorSeed(): string {
  try {
    const text = sessionStorage.getItem(KEY) || '';
    if (text) sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return '';
  }
}
