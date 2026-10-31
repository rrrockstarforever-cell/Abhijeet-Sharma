// Local speech-to-text for the tutor's mic button. Whisper runs on this machine (WASM), so audio
// never leaves the app. The model is downloaded once on first use and then cached by the browser.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { correctMedicalTerms } from './medicalTerms.ts';

const MODEL_ID = 'onnx-community/whisper-small';
const SAMPLE_RATE = 16000;

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/** Loads the recogniser once; later calls reuse it. */
export function loadTranscriber(onProgress?: (message: string) => void): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriber) {
    transcriber = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (p: any) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') onProgress?.(`Downloading speech model… ${Math.round(p.progress)}%`);
      },
    }).catch((err) => {
      transcriber = null; // allow a retry after a failed download
      throw err;
    });
  }
  return transcriber;
}

/** Decodes a recorded blob to mono 16 kHz samples, the rate Whisper expects. */
export async function blobToSamples(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    await context.close();
  }
}

/** Transcribes one recording. Returns plain text with surrounding spaces trimmed. */
export async function transcribe(blob: Blob, onProgress?: (message: string) => void): Promise<string> {
  const asr = await loadTranscriber(onProgress);
  const samples = await blobToSamples(blob);
  if (samples.length < SAMPLE_RATE / 4) return ''; // under a quarter second: nothing was said
  const result = await asr(samples, { language: 'english', task: 'transcribe' });
  const text = Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text;
  return correctMedicalTerms(text.trim());
}
