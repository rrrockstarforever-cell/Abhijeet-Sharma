// Renders one VERIFIED illustration inside an AI explanation.
//
// The image was resolved and vision-verified by the server before it arrived here, so this
// component is presentational only. It shows attribution + licence + source link (required
// by the CC BY / BY-SA licences) and can be collapsed by the learner.
import React, { useState } from 'react';
import { ExternalLink, ImageIcon, Loader2 } from 'lucide-react';
import type { ExplanationImage } from '../utils/explanationImages.ts';
import { ZoomableImage } from './ZoomableImage.tsx';

interface ExplanationFigureProps {
  image: ExplanationImage | null;
  /** true while the lookup is still running */
  loading?: boolean;
  /** reason returned when no image was found (shown only in the tutor, never in exams) */
  reason?: string;
  dark?: boolean;
}

export const ExplanationFigure: React.FC<ExplanationFigureProps> = ({
  image,
  loading = false,
  reason,
  dark = false,
}) => {
  const [open, setOpen] = useState(true);

  if (loading) {
    return (
      <div className={`mt-2.5 flex items-center gap-1.5 rounded-lg border p-2.5 text-[10px] ${
        dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'
      }`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Looking for a verified illustration…
      </div>
    );
  }

  if (!image) {
    if (!reason) return null;
    return (
      <p className={`mt-2 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{reason}</p>
    );
  }

  const credit = [image.attribution, image.source].filter(Boolean).join(' · ');

  return (
    <figure className={`mt-2.5 overflow-hidden rounded-lg border ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
          dark ? 'bg-slate-900 text-teal-300 hover:text-teal-200' : 'bg-slate-50 text-[#0f8b8d] hover:text-[#00696b]'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <ImageIcon className="h-3 w-3" />
          Illustration
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
            ✓ Verified
          </span>
        </span>
        <span className="font-mono text-[9px] normal-case tracking-normal opacity-70">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="p-2.5">
          <ZoomableImage
            src={image.imageUrl}
            alt={image.modality ? `${image.modality} clinical illustration` : 'Clinical illustration'}
            className={`max-h-72 w-full rounded object-contain ${dark ? 'bg-slate-950' : 'bg-white'}`}
            dark={dark}
            caption={credit}
          />
          <figcaption className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>
            {image.modality && (
              <span className={`rounded border px-1.5 py-0.5 font-mono uppercase ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
                {image.modality}
              </span>
            )}
            {credit && <span>{credit}</span>}
            {image.licence && <span className="opacity-70">· {image.licence}</span>}
            {image.sourceUrl && (
              <a
                href={image.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-semibold text-cyan-600 hover:underline dark:text-cyan-400"
              >
                <ExternalLink className="h-2.5 w-2.5" /> Source
              </a>
            )}
          </figcaption>
        </div>
      )}
    </figure>
  );
};
