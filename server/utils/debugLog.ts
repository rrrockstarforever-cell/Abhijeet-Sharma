// Server-side debug logger: appends to {project_root}/.agents/debug.log.
// Mirror of the browser-side writer; both route through /api/debug/log so the
// client (Practice Builder) can record evidence without console.log.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEBUG_LOG_PATH = 'C:/Users/Abhijeet Sharma/PulseMed-105/.agents/debug.log';

export function serverDebugLog(hypothesis: string, message: string): void {
  try {
    mkdirSync('C:/Users/Abhijeet Sharma/PulseMed-105/.agents', { recursive: true });
    appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] [DEBUG ${hypothesis}] ${message}\n`, 'utf8');
  } catch {
    /* never throw from a debug path */
  }
}