// Per-question AI tools (PARITY section 12): "Explain every option", "Notes for this
// question", "Notes for the whole topic", with Brief / Standard / Detailed length chips.
// All calls go to the ACTIVE provider via aiComplete(); errors surface, never faked.
// Notes are saved to the real user-highlights store.
import React, { useState } from 'react';
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

export const AiQuestionTools: React.FC<AiQuestionToolsProps> = ({ question, userChoice, className }) => {
  const [length, setLength] = useState<AiToolLength>('Standard');
  const [busy, setBusy] = useState<null | 'explain' | 'note' | 'topic'>(null);
  const [output, setOutput] = useState<{ kind: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlags, setSavedFlags] = useState<Partial<Record<'note' | 'topic', boolean>>>({});

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
      setOutput({ kind, text });

      // question notes save immediately to the highlights store
      if (kind === 'note') {
        addUserHighlight(highlightFromAiReply({
          quote: text,
          subject: question.subject,
          subtopic: question.subtopic,
          citation: `AI note · ${question.subtopic}`,
          tags: ['ai-note'],
        }));
        setSavedFlags((prev) => ({ ...prev, note: true }));
      }
    } catch (err: any) {
      setError(err?.message || 'AI request failed.');
    } finally {
      setBusy(null);
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
    setSavedFlags((prev) => ({ ...prev, topic: true }));
  };

  const lengthChip = (val: AiToolLength) =>
    `px-2 py-0.5 rounded-full text-[10px] font-bold border ${
      length === val
        ? 'bg-[#0f8b8d]/10 border-[#0f8b8d]/40 text-[#00696b]'
        : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
    }`;

  return (
    <div className={`p-3.5 rounded-xl border border-[#0f8b8d]/25 bg-teal-50/30 space-y-2.5 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0f8b8d] flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" /> AI tools
        </span>
        <span className="text-[9px] font-mono text-slate-400">{providerLabel}</span>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-slate-500 font-semibold mr-0.5">Length</span>
        {(['Brief', 'Standard', 'Detailed'] as AiToolLength[]).map((v) => (
          <button key={v} onClick={() => setLength(v)} className={lengthChip(v)}>{v}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => run('explain')}
          disabled={!!busy || !provider}
          className="px-2.5 py-1.5 rounded-lg bg-[#001432] text-white text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
        >
          {busy === 'explain' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3 text-[#8ff3f4]" />}
          Explain every option
        </button>
        <button
          onClick={() => run('note')}
          disabled={!!busy || !provider}
          className="px-2.5 py-1.5 rounded-lg bg-amber-500/90 hover:bg-amber-500 text-white text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
        >
          {busy === 'note' ? <Loader2 className="w-3 h-3 animate-spin" /> : <NotebookPen className="w-3 h-3" />}
          {savedFlags.note ? <><CheckCircle2 className="w-3 h-3" /> Note saved</> : 'Note for this question'}
        </button>
        <button
          onClick={() => run('topic')}
          disabled={!!busy || !provider}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-[#0f8b8d]/40 text-slate-700 text-[10px] font-bold disabled:opacity-40 flex items-center gap-1"
        >
          {busy === 'topic' ? <Loader2 className="w-3 h-3 animate-spin" /> : <NotebookPen className="w-3 h-3" />}
          {savedFlags.topic ? <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved</> : 'Notes for the whole topic'}
        </button>
        {output?.kind === 'topic' && !savedFlags.topic && (
          <button onClick={saveTopicNote} className="text-[10px] font-bold text-[#0f8b8d] underline">
            Save to Highlights
          </button>
        )}
      </div>

      {!provider && (
        <p className="text-[10px] text-rose-700">{NOT_CONNECTED_MESSAGE}</p>
      )}

      {error && (
        <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-800 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
        </div>
      )}

      {output && !busy && (
        <div className="rounded-lg bg-white border border-slate-200 max-h-80 overflow-y-auto">
          <div className="p-2.5">
            <RevisionNote
              text={output.text}
              topic={`${question.subject} ${question.subtopic}`}
            />
          </div>
          <div className="border-t border-slate-100 px-2.5 py-1.5 flex items-center justify-between">
            <span className="text-[9px] font-mono text-slate-400">
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
