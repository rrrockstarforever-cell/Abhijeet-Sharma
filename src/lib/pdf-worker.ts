// PDF worker configuration
import { GlobalWorkerOptions } from 'pdfjs-dist';

// Set worker path for Electron
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
