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
}

export type OcrSource = HTMLCanvasElement | HTMLImageElement | Blob | string;

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
    logger: (m: any) => {
      if (!onProgress) return;
      const status = typeof m?.status === 'string' ? m.status : 'recognising';
      const progress = typeof m?.progress === 'number' ? m.progress : 0;
      onProgress({ progress, status });
    },
  });

  try {
    const result = await worker.recognize(source);
    const text = typeof result?.data?.text === 'string' ? result.data.text.trim() : '';
    const confidence = typeof result?.data?.confidence === 'number' ? result.data.confidence : null;
    return { text, confidence };
  } finally {
    try { await worker.terminate(); } catch { /* worker already gone */ }
  }
}

/**
 * A small pool of tesseract workers that is created ONCE and reused for every page.
 *
 * The previous code created and terminated a worker per page: every page paid the
 * language-data load, and one throw anywhere aborted the caller's whole loop (so a book
 * "only OCR'd one page"). Pages are handled concurrently here — bounded on purpose,
 * because each worker holds its own WASM heap and a 500-page book would exhaust memory.
 */
export interface OcrPool {
  size: number;
  recognize(source: OcrSource, onProgress?: (p: OcrProgress) => void): Promise<OcrResult>;
  terminate(): Promise<void>;
}

export function ocrConcurrency(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(3, cores - 1));
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
  const n = Math.max(1, Math.min(4, workerCount));

  for (let i = 0; i < n; i++) {
    const slot = { busy: false } as Slot;
    slot.worker = await createWorker('eng', 1, {
      logger: (m: any) => {
        if (!slot.cb) return;
        slot.cb({
          progress: typeof m?.progress === 'number' ? m.progress : 0,
          status: typeof m?.status === 'string' ? m.status : 'recognising',
        });
      },
    });
    slots.push(slot);
  }

  const acquire = async (): Promise<Slot> => {
    for (;;) {
      const free = slots.find((s) => !s.busy);
      if (free) { free.busy = true; return free; }
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
        const result = await slot.worker.recognize(source);
        return {
          text: typeof result?.data?.text === 'string' ? result.data.text.trim() : '',
          confidence: typeof result?.data?.confidence === 'number' ? result.data.confidence : null,
        };
      } finally {
        release(slot);
      }
    },
    async terminate() {
      for (const slot of slots) {
        try { await slot.worker.terminate(); } catch { /* already gone */ }
      }
    },
  };
}
