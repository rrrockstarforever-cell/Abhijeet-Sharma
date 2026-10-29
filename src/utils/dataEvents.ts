// Tiny app-wide change bus for locally stored study data.
// Every store that writes to localStorage calls notifyDataChanged() so shell
// badges (due cards, unresolved mistakes) refresh immediately instead of only
// after a screen change. No polling, no fake timers.
export const DATA_CHANGED_EVENT = 'pulse:data-changed';

export function notifyDataChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  } catch {
    // Dispatched during teardown — nothing to refresh.
  }
}

export function subscribeDataChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(DATA_CHANGED_EVENT, listener);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, listener);
}
