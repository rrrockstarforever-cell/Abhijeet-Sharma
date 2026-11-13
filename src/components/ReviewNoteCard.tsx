import React from 'react';
import { AlertTriangle, Brain, CheckCircle2, ChevronDown, Lightbulb, Sparkles, XCircle } from 'lucide-react';
import type { ClinicalQuestion } from '../types.ts';
import { renderKeyPoints } from './KeyText.tsx';

// The note shown after a question is answered. It is written to be pleasant to read: a warm result line, the one big idea,
// why each wrong option is wrong, a memory hook, a trap to watch for, and a short recall check at the end.
// Each marker keeps one meaning: yellow = key point, teal = the big idea, rose = wrong or a trap, amber = remember this.

const HIGH_YIELD = /^\s*(?:[-•]\s*)?(?:\*\*)?(high[- ]yield|exam tip|remember|pearl|trap)\b[:\-–]?(?:\*\*)?[:\-–]?\s*/i;
const BULLET = /^\s*[-•*]\s+/;
const strip = (s: string) => s.replace(/\*\*/g, '').trim();

interface Parsed { bigIdea: string; wrong: string[]; focus: string[]; more: string[] }

function parse(q: ClinicalQuestion): Parsed {
  const correct = q.options.find((o) => o.id === q.correctOption)?.text ?? '';
  const lines = String(q.explanation || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: Parsed = { bigIdea: '', wrong: [], focus: [], more: [] };
  lines.forEach((line, i) => {
    if (HIGH_YIELD.test(line)) out.focus.push(line.replace(HIGH_YIELD, ''));
    else if (i === 0 && /^\*\*/.test(line) && !out.bigIdea) out.bigIdea = line;
    else if (BULLET.test(line)) out.wrong.push(line.replace(BULLET, ''));
    else out.more.push(line);
  });
  if (!out.bigIdea) out.bigIdea = (q.keyFact || '').trim() || (correct ? `The answer is ${correct}.` : '');
  // When the explanation has no bullets, the per-option reasons (NEET PG / INI-CET questions carry them) say why each
  // wrong option is wrong.
  if (!out.wrong.length && q.optionReasons) {
    for (const o of q.options) {
      const why = q.optionReasons[o.id];
      if (o.id !== q.correctOption && why) out.wrong.push(`**${o.text}:** ${why}`);
    }
  }
  return out;
}

export const ReviewNoteCard: React.FC<{ q: ClinicalQuestion; userChoice?: string; onTeach?: () => void }> = ({ q, userChoice, onTeach }) => {
  const p = parse(q);
  const answered = !!userChoice;
  const right = answered && userChoice === q.correctOption;
  const correctText = q.options.find((o) => o.id === q.correctOption)?.text ?? '';
  const trap = (q.trapExplanation || '').trim();

  return (
    <div className="space-y-4">
      {/* Result */}
      <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${right ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-white dark:border-emerald-800/60 dark:from-emerald-950/40 dark:to-slate-900' : answered ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-white dark:border-amber-800/60 dark:from-amber-950/30 dark:to-slate-900' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${right ? 'bg-emerald-500 text-white' : answered ? 'bg-amber-400 text-amber-950' : 'bg-slate-300 text-slate-700'}`}>
          {right ? <CheckCircle2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <div className={`text-[15px] font-semibold ${right ? 'text-emerald-900 dark:text-emerald-100' : 'text-slate-900 dark:text-white'}`}>
            {right ? 'Nice work, you got it.' : answered ? 'Not this time, and that is how it sticks.' : 'Here is the idea.'}
          </div>
          <div className="text-[12.5px] text-slate-600 dark:text-slate-300">{right ? 'Read the idea once more so it is easy to find again.' : 'Read the big idea below, then try the recall check at the end.'}</div>
        </div>
        {answered && !right && onTeach && (
          <button onClick={onTeach} className="ml-auto inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-[#0f8b8d] px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0b6b6d]"><Sparkles className="h-4 w-4" /> Teach me this</button>
        )}
      </div>

      {/* Big idea */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d3b3e] via-[#0f6b6d] to-[#14a8a3] p-4 text-white shadow-md">
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="relative flex gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-100">The big idea</div>
            <p className="mt-1 text-[16px] leading-7 text-white">{strip(p.bigIdea)}</p>
          </div>
        </div>
      </div>

      {/* Why the others are wrong */}
      {p.wrong.length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
          <h4 className="flex items-center gap-2 text-[14px] font-semibold text-rose-900 dark:text-rose-100"><XCircle className="h-4 w-4" /> Why the other options are wrong</h4>
          <ul className="mt-2.5 space-y-2">
            {p.wrong.map((line, i) => (
              <li key={i} className="flex gap-2.5 rounded-xl bg-white px-3 py-2 text-[14px] leading-6 text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-400" />
                <span className="min-w-0">{renderKeyPoints(line, `w${i}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.more.map((line, i) => <p key={i} className="text-[14.5px] leading-7 text-slate-700 dark:text-slate-200">{renderKeyPoints(line, `m${i}`)}</p>)}

      {/* Focus */}
      {p.focus.map((line, i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-3.5 shadow-sm dark:border-amber-700/50 dark:from-amber-950/40 dark:to-slate-900">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950"><Lightbulb className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">Focus on this</div><p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100">{renderKeyPoints(line, `f${i}`)}</p></div>
        </div>
      ))}

      {/* Trap */}
      {(trap || q.trapType) && (
        <div className="flex gap-3 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-3.5 shadow-sm dark:border-rose-900/60 dark:from-rose-950/40 dark:to-slate-900">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white"><AlertTriangle className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Watch out{q.trapType ? `: ${q.trapType}` : ''}</div><p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100">{trap || 'The other options look reasonable but do not fit this case.'}</p></div>
        </div>
      )}

      {/* Memory hook */}
      {q.boardPearl && (
        <div className="flex gap-3 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-3.5 shadow-sm dark:border-teal-900/60 dark:from-teal-950/40 dark:to-slate-900">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f8b8d] text-white"><Brain className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-[#00696b] dark:text-teal-300">Memory hook</div><p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100">{renderKeyPoints(q.boardPearl, 'pearl')}</p></div>
        </div>
      )}

      {/* Recall check */}
      <details className="group rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 open:ring-2 open:ring-emerald-300/50 dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-slate-900">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-emerald-900 dark:text-emerald-100">
          <Brain className="h-5 w-5" />
          <span className="min-w-0 flex-1">Recall check: say it back in one sentence</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <p className="mt-2 text-[13px] text-emerald-800/90 dark:text-emerald-200/80">Close your eyes and explain why this is the answer. Trying to recall it is what makes it stick. Then tap to compare.</p>
        <p className="mt-2 flex gap-2 rounded-xl bg-white p-3 text-[14px] leading-6 text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="min-w-0">{correctText ? <><b>{correctText}</b>. </> : null}{strip(p.bigIdea)}</span>
        </p>
      </details>
    </div>
  );
};
