// A clinical image with click-to-zoom.
//
// Why this exists: radiographs, histology plates and fundus photos are useless at
// thumbnail size — the finding the question hinges on is often a few millimetres across.
// Clicking the image opens a full-screen overlay where the learner can zoom in/out, fit
// to width, or reset. Escape closes it.
//
// Presentational only: the caller decides WHAT image to show and whether it is safe to
// reveal (see safeImageCaption / safeSubtopic). This component never fetches anything.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react';

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** class names for the inline (non-zoomed) image itself */
  className?: string;
  /** class names for the wrapping element */
  wrapperClassName?: string;
  /** dark theme for the full-screen overlay chrome */
  dark?: boolean;
  /** optional caption shown under the image in the overlay */
  caption?: string;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const STEP = 0.5;

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  src,
  alt,
  className = '',
  wrapperClassName = '',
  dark = false,
  caption,
}) => {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setScale(1);
  }, []);

  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_SCALE, +(s + STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_SCALE, +(s - STEP).toFixed(2))), []);
  const reset = useCallback(() => setScale(1), []);

  // Escape to close, +/- to zoom while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-') zoomOut();
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    // Stop the page behind the overlay from scrolling while it is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, zoomIn, zoomOut, reset]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group relative block cursor-zoom-in ${wrapperClassName}`}
        title="Click to zoom"
        aria-label="Click to zoom image"
      >
        <img src={src} alt={alt} className={className} />
        <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3 w-3" /> Zoom
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Zoomed clinical image"
          // Clicking the backdrop (outside the image itself) closes the overlay.
          onClick={close}
        >
          <div
            className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate text-xs font-semibold text-white/90">{alt}</span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={zoomOut}
                disabled={scale <= MIN_SCALE}
                className="rounded-md border border-white/20 p-1.5 text-white hover:bg-white/10 disabled:opacity-40"
                title="Zoom out (−)"
                aria-label="Zoom out"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-14 text-center font-mono text-xs text-white/80">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                onClick={zoomIn}
                disabled={scale >= MAX_SCALE}
                className="rounded-md border border-white/20 p-1.5 text-white hover:bg-white/10 disabled:opacity-40"
                title="Zoom in (+)"
                aria-label="Zoom in"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={reset}
                className="ml-1 rounded-md border border-white/20 p-1.5 text-white hover:bg-white/10"
                title="Reset zoom (0)"
                aria-label="Reset zoom"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="ml-1 rounded-md border border-white/20 p-1.5 text-white hover:bg-white/10"
                title="Close (Esc)"
                aria-label="Close zoomed image"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-h-full min-w-full items-center justify-center">
              <img
                src={src}
                alt={alt}
                style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
                className={`rounded bg-white object-contain transition-transform duration-100 ${
                  dark ? 'bg-slate-950' : ''
                }`}
              />
            </div>
          </div>

          {caption && (
            <div
              className="border-t border-white/10 px-3 py-2 text-center text-[11px] text-white/70"
              onClick={(e) => e.stopPropagation()}
            >
              {caption}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ZoomableImage;
