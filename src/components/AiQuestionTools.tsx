// Per-question AI tools (PARITY section 12): "Explain every option", "Notes for this
// question", "Notes for the whole topic", with Brief / Standard / Detailed length chips.
// All calls go to the ACTIVE provider via aiComplete(); errors surface, never faked.
// Notes are saved to the real user-highlights store.
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Brain, NotebookPen, Loader2, AlertCircle, CheckCircle2, X, Download } from 'lucide-react';
import type { ClinicalQuestion } from '../types.ts';
import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from '../lib/ai.ts';
import { addUserHighlight, highlightFromAiReply } from '../utils/userHighlightsStore.ts';
import { RevisionNote, downloadNotesPdf } from './RevisionNote.tsx';

export type AiToolLength = 'Brief' | 'Standard' | 'Detailed';

interface AiQuestionToolsProps {
  question: ClinicalQuestion;
  /** the option the user picked in the test (for tailored explanations) */
  userChoice?: string;
  className?: string;
  /** renders the cockpit (night) skin used inside the Test Runner */
  dark?: boolean;
}

const buildExplanationPrompt = (q: ClinicalQuestion, userChoice: string | undefined, length: AiToolLength): string => {
  const optionLines = q.options.map((o) => `${o.id}. ${o.text}`).join('\n');
  return [
    `Question (subject: ${q.subject}, subtopic: ${q.subtopic}):`,
    q.stem ? `Stem: ${q.stem}` : '',
    `Task: ${q.questionText}`,
    `Options:`,
    optionLines,
    `Correct answer: ${q.correctOption}`,
    userChoice && userChoice !== q.correctOption ? `The student selected ${userChoice} (a trap).` : '',
    q.trapType ? `Known trap: ${q.trapType} — ${q.trapExplanation ?? ''}` : '',
    '',
    length === 'Brief' ? 'Answer in 3-4 short sentences total: the key discriminator and one line per decisive option.' :
    length === 'Detailed' ? 'Answer thoroughly: first principles, then a dedicated 1-3 sentence verdict on EVERY option (why right or why wrong, with the classic mistake each distractor catches), then one board pearl. Include 1-2 textbook citations.' :
    'Answer in two parts: (1) the core reasoning leading to the correct option; (2) a one-line verdict on every option. Include one textbook citation.',
  ].filter(Boolean).join('\n');
};

// Fresh generation: AI-tool output is NOT cached and is NOT generated while the
// questions are being written. Every click on Explain / Note / Topic produces a brand
// new response from the active provider. Saved "Note / Topic" highlights still land in
// the user-highlights store, but the widget itself always starts empty for each question.

export const AiQuestionTools: React.FC<AiQuestionToolsProps> = ({ question, userChoice, className, dark = false }) => {
  const [length, setLength] = useState<AiToolLength>('Standard');
  const [busy, setBusy] = useState<null | 'explain' | 'note' | 'topic'>(null);
  const [output, setOutput] = useState<{ kind: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlags, setSavedFlags] = useState<Partial<Record<'note' | 'topic', boolean>>>({});
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const provider = getActiveProvider();
  const providerLabel = provider ? `${provider} · ${getEffectiveModel(provider)}` : 'no active provider';

  const run = async (kind: 'explain' | 'note' | 'topic') => {
    if (!provider || busy) return;
    setBusy(kind);
    setError(null);
    setSavedFlags({} as Partial<Record<'note' | 'topic', boolean>>);
    try {
      let prompt: string;
      let system: string;
      if (kind === 'explain') {
        system = 'You are a rigorous clinical exam tutor. Explain exactly what is asked; be accurate, cite standard textbooks/guidelines. Plain readable text (may use **bold** and short lists). No JSON.';
        prompt = buildExplanationPrompt(question, userChoice, length);
      } else if (kind === 'note') {
        system = 'Write a compact revision note card for a postgraduate medical exam student. Start with a one-line bold title, then 3-6 high-yield bullet points (fact + mechanism/discriminator), then one "High-yield:" line, then a "Mnemonic:" line if natural, then a citation. Keep it dense, no JSON.';
        prompt = buildExplanationPrompt(question, undefined, 'Brief') + '\n\nDistill this into a revision NOTE CARD (not an explanation).';
      } else {
        system = 'You are a high-yield medical educator. Write a revision summary of the given exam topic. Plain readable text, bold headers, short bullets, mark the key takeaway with a line beginning "High-yield:" and any memory device with "Mnemonic:", end with 2-3 exam pearls and a citation. No JSON.';
        prompt = `Topic: ${question.subject} — ${question.subtopic}\n\nWrite a revision summary of this topic oriented to postgraduate medical exams (NEET-PG / INI-CET / AMC CAT): core concepts, must-know facts, classic traps, 2-3 pearls, one citation.`;
      }

      const text = await aiComplete({
        system,
        messages: [{ role: 'user', content: prompt }],
        provider,
        model: getEffectiveModel(provider),
      });

      // question notes save immediately to the highlights store
      if (kind === 'note') {
        addUserHighlight(highlightFromAiReply({
          quote: text,
          subject: question.subject,
          subtopic: question.subtopic,
          citation: `AI note · ${question.subtopic}`,
          tags: ['ai-note'],
        }));
      }

      if (mountedRef.current) {
        setOutput({ kind, text });
        if (kind === 'note') setSavedFlags((prev) => ({ ...prev, note: true }));
      }
    } catch (err: any) {
      const message = err?.message || 'AI request failed.';
      if (mountedRef.current) setError(message);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const saveTopicNote = () => {
    if (!output || output.kind !== 'topic') return;
    addUserHighlight(highlightFromAiReply({
      quote: output.text,
      subject: question.subject,
      subtopic: question.subtopic,
      citation: `AI topic summary · ${question.subtopic}`,
      tags: ['ai-note'],
    }));
    const nextFlags = { ...savedFlags, topic: true };
    setSavedFlags(nextFlags);
  };

  const lengthChip = (val: AiToolLength) =>
    `px-2 py-0.5 rounded-full text-[10px] font-bold border ${
      length === val
        ? dark
          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
          : 'bg-[#0f8b8d]/10 border-[#0f8b8d]/40 text-[#00696b]'
        : dark
          ? 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'
          : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
    }`;

  return (
    <div className={`space-y-2.5 rounded-xl border p-3.5 ${
      dark ? 'border-slate-700/80 bg-[#151F30]' : 'border-[#0f8b8d]/25 bg-teal-50/30'
    } ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
          dark ? 'text-teal-300' : 'text-[#0f8b8d]'
        }`}>
          <Sparkles className="h-3 w-3" /> AI tools
        </span>
        <span className={`font-mono text-[9px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{providerLabel}</span>
      </div>

      <div className="flex items-center gap-1">
        <span className={`mr-0.5 text-[10px] font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Length</span>
        {(['Brief', 'Standard', 'Detailed'] as AiToolLength[]).map((v) => (
          <button key={v} onClick={() => setLength(v)} className={lengthChip(v)}>{v}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => run('explain')}
          disabled={!!busy || !provider}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${
            dark ? 'bg-teal-600 text-white hover:bg-teal-500' : 'bg-[#001432] text-white'
          }`}
        >
          {busy === 'explain' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3 text-[#8ff3f4]" />}
          Explain every option
        </button>
        <button
          onClick={() => run('note')}
          disabled={!!busy || !provider}
          className="flex items-center gap-1 rounded-lg bg-amber-500/90 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
        >
          {busy === 'note' ? <Loader2 className="w-3 h-3 animate-spin" /> : <NotebookPen className="w-3 h-3" />}
          {savedFlags.note ? <><CheckCircle2 className="w-3 h-3" /> Note saved</> : 'Note for this question'}
        </button>
        <button
          onClick={() => run('topic')}
          disabled={!!busy || !provider}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40 ${
            dark
              ? 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-teal-500/50'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-[#0f8b8d]/40'
          }`}
        >
          {busy === 'topic' ? <Loader2 className="w-3 h-3 animate-spin" /> : <NotebookPen className="w-3 h-3" />}
          {savedFlags.topic ? <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved</> : 'Notes for the whole topic'}
        </button>
        {output?.kind === 'topic' && !savedFlags.topic && (
          <button onClick={saveTopicNote} className={`text-[10px] font-bold underline ${dark ? 'text-teal-300' : 'text-[#0f8b8d]'}`}>
            Save to Highlights
          </button>
        )}
      </div>

      {!provider && (
        <p className={`text-[10px] ${dark ? 'text-rose-300' : 'text-rose-700'}`}>{NOT_CONNECTED_MESSAGE}</p>
      )}

      {error && (
        <div className={`flex items-start gap-1.5 rounded-lg border p-2 text-[10px] ${
          dark ? 'border-rose-800/70 bg-rose-950/30 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}>
          <AlertCircle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${dark ? 'text-rose-300' : 'text-rose-600'}`} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
        </div>
      )}

      {output && !busy && (
        <div className={`overflow-hidden rounded-lg border ${dark ? 'border-slate-700 bg-white' : 'border-slate-200 bg-white'}`}>
          <div className="max-h-80 overflow-y-auto p-2.5">
            <RevisionNote
              text={output.text}
              topic={`${question.subject} ${question.subtopic}`}
            />
          </div>
          <div className={`flex items-center justify-between border-t px-2.5 py-1.5 ${dark ? 'border-slate-200 bg-slate-50' : 'border-slate-100'}`}>
            <span className="font-mono text-[9px] text-slate-400">
              {output.kind === 'explain' ? 'Explanation' : output.kind === 'note' ? 'Question note' : 'Topic notes'}
            </span>
            <button
              onClick={() => {
                try {
                  downloadNotesPdf(
                    `${question.subject} — ${question.subtopic}`,
                    output.text,
                    providerLabel,
                  );
                } catch (err: any) {
                  setError(err?.message || 'Could not open the print window.');
                }
              }}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-[#0f8b8d] hover:underline"
            >
              <Download className="w-3 h-3" /> Download PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
