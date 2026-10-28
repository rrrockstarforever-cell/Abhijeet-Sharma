// Client-side debug logger: routes to the server's /api/debug/log so the evidence
// lands in {project_root}/.agents/debug.log (no console.log / no stdout).
export function debugLog(hypothesis: string, message: string): void {
  try {
    void fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hypothesis, message }),
      keepalive: true,
    });
  } catch {
    /* never throw from a debug path */
  }
}