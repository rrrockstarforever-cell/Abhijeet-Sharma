import React from 'react';

// Key points in notes and explanations. Anything the writer put in **double stars** is a point to focus on, so it is drawn
// like a highlighter pen: a warm background and heavier text, readable in light and dark mode.

export const KEY_POINT_CLASS =
  'rounded-[4px] bg-amber-200/80 px-1 py-px font-semibold text-slate-900 [box-decoration-break:clone] [-webkit-box-decoration-break:clone] dark:bg-amber-400/35 dark:text-amber-50';

/** A key point as an inline highlighted span. */
export const KeyPoint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <mark className={KEY_POINT_CLASS}>{children}</mark>
);

/** Text with **key points**, as React nodes (no raw HTML). */
export function renderKeyPoints(text: string, keyPrefix = 'k'): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <KeyPoint key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</KeyPoint>;
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

const HIGH_YIELD = /^\s*(?:[-•*]\s*)?(high[- ]yield|exam tip|remember|pearl|trap)\b[:\-–]?\s*/i;
const BULLET = /^\s*[-•*]\s+/;

/**
 * An explanation: the first line (the key fact) stands out as a lead box, each wrong-option line is a bullet, and a
 * "High-yield" line is a callout. **Key points** are highlighted everywhere.
 */
export const ExplanationText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return null;
  return (
    <div className={`space-y-2.5 ${className}`}>
      {lines.map((line, i) => {
        if (HIGH_YIELD.test(line)) {
          return (
            <div key={i} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
              <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Focus on this</span>
              {renderKeyPoints(line.replace(HIGH_YIELD, ''), `h${i}`)}
            </div>
          );
        }
        if (i === 0 && /^\s*\*\*/.test(line)) {
          return (
            <div key={i} className="rounded-xl border-l-4 border-[#0f8b8d] bg-teal-50 px-3 py-2 text-[14px] leading-relaxed text-slate-900 dark:bg-teal-950/40 dark:text-slate-100">
              {renderKeyPoints(line, `l${i}`)}
            </div>
          );
        }
        if (BULLET.test(line)) {
          return (
            <div key={i} className="flex gap-2 pl-1 text-[13px] leading-relaxed">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
              <span className="min-w-0">{renderKeyPoints(line.replace(BULLET, ''), `b${i}`)}</span>
            </div>
          );
        }
        return <p key={i} className="text-[13px] leading-relaxed">{renderKeyPoints(line, `p${i}`)}</p>;
      })}
    </div>
  );
};
