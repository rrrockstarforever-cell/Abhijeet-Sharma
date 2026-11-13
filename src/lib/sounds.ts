// Soft interface sounds, made in the browser with the Web Audio API (no sound files). A short, quiet tone plays when
// the learner moves between pages. The sound can be switched off; the choice is kept on this device.
const KEY = 'pulse-sounds';
let ctx: AudioContext | null = null;
let lastAt = 0;

export function soundsOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundsOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* the choice lasts until the page closes */ }
  if (on) playTone([660, 880], 0.07);
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** A short rising or falling pair of soft tones. Quiet on purpose. */
function playTone(freqs: number[], gain = 0.05): void {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;
  freqs.forEach((f, i) => {
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now + i * 0.06);
    amp.gain.setValueAtTime(0.0001, now + i * 0.06);
    amp.gain.exponentialRampToValueAtTime(gain, now + i * 0.06 + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.06 + 0.16);
    osc.connect(amp).connect(c.destination);
    osc.start(now + i * 0.06);
    osc.stop(now + i * 0.06 + 0.18);
  });
}

/** Moving to another page: a soft two-note chime. Rapid switches do not pile up. */
export function playPageSwitch(): void {
  if (!soundsOn()) return;
  const t = Date.now();
  if (t - lastAt < 120) return;
  lastAt = t;
  playTone([520, 780], 0.04);
}

/** A small tick for a tab or option change inside a page. */
export function playTick(): void {
  if (!soundsOn()) return;
  const t = Date.now();
  if (t - lastAt < 60) return;
  lastAt = t;
  playTone([740], 0.03);
}

/** A reward: a short rising three-note arpeggio, a little louder than the page chime. */
export function playReward(): void {
  if (!soundsOn()) return;
  playTone([523, 659, 784, 1047], 0.06);
}
