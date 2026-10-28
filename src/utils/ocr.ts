// Real OCR via tesseract.js (PARITY section 5). Used by:
//   - the PDF reader's "Read with OCR" action (scanned pages / Force OCR)
//   - the Mistake Notebook screenshot capture
// Language data is downloaded by tesseract itself on first use; nothing is faked.
// The module is imported dynamically so the editor runs without OCR assets until
// the user actually starts a recognition job.

export interface OcrProgress {
  /** 0 – 1 */
  progress: number;
  status: string;
}

export interface OcrResult {
  text: string;
  confidence: number | null;
  words?: OcrWord[];
}

export interface OcrWord {
  text: string;
  /** Fractions of the page (0–1) once normalised, so the overlay needs no scale maths. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
  /** Horizontal fit: box width ÷ measured text width, applied as scaleX. */
  sx?: number;
}

export type OcrSource = HTMLCanvasElement | HTMLImageElement | Blob | string;

// tesseract.js otherwise fetches the worker, the wasm core and eng.traineddata.gz from
// jsdelivr. In a packaged app with no internet that hangs at "Loading the OCR engine" until
// the timeout. tools/copy-tesseract-assets.mjs puts all three under public/tesseract/, which
// vite copies to dist/ and express serves at the app root.
const TESS_BASE = new URL('/tesseract/', location.href).href;
const TESS_PATHS = {
  workerPath: `${TESS_BASE}worker.min.js`,
  corePath: `${TESS_BASE}core`,
  langPath: `${TESS_BASE}lang`,
  gzip: true,
};

const withTimeout = <T>(
  p: Promise<T>,
  ms: number,
  what: string,
): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms)),
  ]);

function parseHocrWords(hocr: string): OcrWord[] {
  // tesseract.js emits single-quoted HOCR attributes (class='ocrx_word'), and some builds put
  // title before class, so match the tag first and read the attributes out of it.
  const words: OcrWord[] = [];
  const tagRe = /<span\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(hocr)) !== null) {
    const tag = m[0];
    if (!/ocrx_word/.test(tag)) continue;
    const bbox = tag.match(/bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (!bbox) continue;
    const conf = tag.match(/x_wconf\s+(\d+)/i);
    const textEnd = hocr.indexOf('</span>', m.index + tag.length);
    if (textEnd === -1) continue;
    const raw = hocr.slice(m.index + tag.length, textEnd).replace(/<[^>]*>/g, '');
    const text = raw
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    if (!text) continue;
    const [, x0, y0, x1, y1] = bbox;
    words.push({
      text,
      bbox: { x0: +x0, y0: +y0, x1: +x1, y1: +y1 },
      confidence: conf ? +conf[1] : 0,
    });
  }
  return words;
}

/**
 * Recognise English text in an image.
 * @param source canvas, image, blob, object URL or data URL
 * @param onProgress called by tesseract with real recognition progress
 */
export async function ocrImage(
  source: OcrSource,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const mod: any = await import('tesseract.js');
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  if (typeof createWorker !== 'function') {
    throw new Error('tesseract.js is not available. Run npm install and restart the app.');
  }

  const worker = await createWorker('eng', 1, {
    ...TESS_PATHS,
    logger: (m: any) => {
      if (!onProgress) return;
      const status = typeof m?.status === 'string' ? m.status : 'recognising';
      const progress = typeof m?.progress === 'number' ? m.progress : 0;
      onProgress({ progress, status });
    },
  });

  try {
    // Request HOCR output so we get word bounding boxes for the text layer overlay.
    const result: any = await withTimeout(
      worker.recognize(source, {}, { hocr: true }),
      120_000,
      'Recognising a page',
    );
    const text = typeof result?.data?.text === 'string' ? result.data.text.trim() : '';
    const confidence =
      typeof result?.data?.confidence === 'number' ? result.data.confidence : null;
    const hocr = typeof result?.data?.hocr === 'string' ? result.data.hocr : undefined;
    const words = hocr ? parseHocrWords(hocr) : [];
    return { text, confidence, words };
  } finally {
    try {
      await worker.terminate();
    } catch {
      /* worker already gone */
    }
  }
}

/** A small pool of tesseract workers created ONCE and reused for every page. */
export interface OcrPool {
  size: number;
  recognize(source: OcrSource, onProgress?: (p: OcrProgress) => void): Promise<OcrResult>;
  terminate(): Promise<void>;
}

export async function createOcrPool(workerCount = ocrConcurrency()): Promise<OcrPool> {
  const mod: any = await import('tesseract.js');
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  if (typeof createWorker !== 'function') {
    throw new Error('tesseract.js is not available. Run npm install and restart the app.');
  }

  type Slot = { worker: any; busy: boolean; cb?: (p: OcrProgress) => void };
  const slots: Slot[] = [];
  const waiters: (() => void)[] = [];
  const n = Math.max(MIN_OCR_WORKERS, Math.min(MAX_OCR_WORKERS, Math.round(workerCount)));

  // Build the workers in PARALLEL and with a deadline. Sequentially awaiting three CDN
  // fetches is what made a whole-book run look frozen with no progress and no error.
  const makeSlot = async (): Promise<Slot> => {
    const slot = { busy: false } as Slot;
    slot.worker = await withTimeout(
      createWorker('eng', 1, {
        ...TESS_PATHS,
        logger: (m: any) => {
          if (!slot.cb) return;
          slot.cb({
            progress: typeof m?.progress === 'number' ? m.progress : 0,
            status: typeof m?.status === 'string' ? m.status : 'recognising',
          });
        },
      }),
      60_000,
      'Loading the OCR engine',
    );
    return slot;
  };
  const built = await Promise.all(Array.from({ length: n }, () => makeSlot()));
  slots.push(...built);

  const acquire = async (): Promise<Slot> => {
    for (;;) {
      const free = slots.find((s) => !s.busy);
      if (free) {
        free.busy = true;
        return free;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const release = (slot: Slot) => {
    slot.busy = false;
    slot.cb = undefined;
    const next = waiters.shift();
    if (next) next();
  };

  return {
    size: slots.length,
    async recognize(source, onProgress) {
      const slot = await acquire();
      slot.cb = onProgress;
      try {
        const result: any = await withTimeout(
          slot.worker.recognize(source, {}, { hocr: true }),
          120_000,
          'Recognising a page',
        );
        const text = typeof result?.data?.text === 'string' ? result.data.text.trim() : '';
        const confidence =
          typeof result?.data?.confidence === 'number' ? result.data.confidence : null;
        const hocr = typeof result?.data?.hocr === 'string' ? result.data.hocr : undefined;
        const words = hocr ? parseHocrWords(hocr) : [];
        return { text, confidence, words };
      } finally {
        release(slot);
      }
    },
    async terminate() {
      for (const slot of slots) {
        try {
          await slot.worker.terminate();
        } catch {
          /* already gone */
        }
      }
    },
  };
}

export function ocrConcurrency(): number {
  return getOcrWorkers();
}

// ---------- OCR worker pool preference ----------
// The panel in Settings → AI Subscription & OCR lets the learner raise the pool above the
// old hard cap of 4. Every worker is a separate Tesseract engine (worker + wasm core +
// English data) and costs roughly 60–100 MB of RAM, so 16 is a hard ceiling and the
// default stays conservative. Persisted per browser profile; new OCR jobs pick it up.

export const MIN_OCR_WORKERS = 1;
export const MAX_OCR_WORKERS = 16;
const OCR_WORKERS_KEY = 'pulse.ocr.workers';

/** Conservative default: one worker per spare CPU thread, never more than four. */
export function defaultOcrWorkers(): number {
  return Math.max(MIN_OCR_WORKERS, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
}

export function getOcrWorkers(): number {
  try {
    const raw = localStorage.getItem(OCR_WORKERS_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return defaultOcrWorkers();
    return Math.max(MIN_OCR_WORKERS, Math.min(MAX_OCR_WORKERS, Math.round(n)));
  } catch {
    return defaultOcrWorkers();
  }
}

export function setOcrWorkers(count: number): number {
  const clamped = Math.max(MIN_OCR_WORKERS, Math.min(MAX_OCR_WORKERS, Math.round(count)));
  try {
    localStorage.setItem(OCR_WORKERS_KEY, String(clamped));
  } catch {
    /* private mode: fall back to the in-memory default */
  }
  return clamped;
}
