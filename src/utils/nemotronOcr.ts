// OCR with NVIDIA's hosted nemotron-ocr-v2, through the server (which holds the key).
// The API accepts at most about 180,000 base64 characters per image, so a page is shrunk until it fits.
// Word boxes come back in the pixel space of the image that was sent; they are mapped back to the page
// canvas so the existing text layer can use them unchanged.
import type { OcrWord } from './ocr.ts';

const MAX_BASE64 = 180_000;

export async function recognizeWithNemotron(canvas: HTMLCanvasElement): Promise<{ text: string; words: OcrWord[] }> {
  for (const width of [2000, 1600, 1400, 1200, 1000]) {
    for (const quality of [0.85, 0.7]) {
      const scale = Math.min(1, width / Math.max(1, canvas.width));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(canvas.width * scale));
      small.height = Math.max(1, Math.round(canvas.height * scale));
      small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
      const image = small.toDataURL('image/jpeg', quality);
      small.width = 0;
      small.height = 0;
      if (image.split(',')[1].length > MAX_BASE64) continue;

      const res = await fetch('/api/ocr/nemotron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `NVIDIA OCR failed (HTTP ${res.status}).`);

      // Boxes are in the sent image's pixels. If the API ever returns 0–1 coordinates, scale them up first.
      const raw: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] = Array.isArray(data?.words) ? data.words : [];
      const normalized = raw.length > 0 && raw.every((w) => Math.max(w.bbox.x1, w.bbox.y1) <= 1.5);
      const sentW = Math.max(1, Math.round(canvas.width * scale));
      const sentH = Math.max(1, Math.round(canvas.height * scale));
      // sent pixels -> original canvas pixels
      const toCanvas = (v: number, axis: 'x' | 'y') => (normalized ? v * (axis === 'x' ? sentW : sentH) : v) / scale;
      const words: OcrWord[] = raw.map((w) => ({
        text: w.text,
        confidence: w.confidence,
        bbox: {
          x0: toCanvas(w.bbox.x0, 'x'),
          y0: toCanvas(w.bbox.y0, 'y'),
          x1: toCanvas(w.bbox.x1, 'x'),
          y1: toCanvas(w.bbox.y1, 'y'),
        },
      }));
      return { text: words.map((w) => w.text).join('\n'), words };
    }
  }
  throw new Error('This page is too detailed for the NVIDIA OCR API even when shrunk. Use Tesseract for this page.');
}
