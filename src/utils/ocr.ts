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
