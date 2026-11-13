import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Minus, Send, Sparkles, TextQuote } from 'lucide-react';
import { aiComplete, getActiveProvider, getEffectiveModel, type AiMessage } from '../lib/ai.ts';
import type { TeachingNote } from './StructuredNote.tsx';

interface Props {
  note: TeachingNote;
  topicLabel: string;
  /** Scroll container of the note, used to catch text the learner selects. */
  noteRootRef: React.RefObject<HTMLElement | null>;
}

const CHAT_SYSTEM = [
  'You are a kind, clear tutor for a medical exam learner (NEET-PG / INI-CET). The learner is reading a teaching note and asks follow-up questions about it.',
  'Answer in plain, everyday words with short sentences. Explain any medical word the first time. Lead with the direct answer in one or two lines, then give 3 to 5 short bullet points (start each with "- ") only if they help. Mention the usual exam angle when it is useful.',
  'If the question goes beyond the note (other uses, other drugs, comparisons), answer from standard textbooks and say so briefly. Never invent doses or numbers: if unsure, say to check the book.',
].join('\n');

const SUGGESTIONS = ['Where else is this used?', 'Explain it more simply', 'Give me a memory trick', 'What do exams ask about this?'];

function noteText(note: TeachingNote): string {
  const parts = [`Note: ${note.title}`, `Big idea: ${note.takeaway}`];
  for (const s of note.sections) {
    parts.push(`## ${s.heading}`);
    for (const b of s.blocks as Array<{ type: string; text?: string; rows?: string[][] }>) {
      if (b.text) parts.push(b.text);
      else if (b.rows) parts.push(b.rows.map((r) => r.join(' | ')).join('\n'));
    }
  }
  return parts.join('\n').slice(0, 9000);
}

/** Bold "**x**" and "- " bullets, the only formatting the tutor uses. */
const Reply: React.FC<{ text: string }> = ({ text }) => {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i} className="font-bold text-slate-900 dark:text-white">{p.slice(2, -2)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>));
  return (
    <div className="space-y-1.5">
      {text.split('\n').filter((l) => l.trim()).map((l, i) => /^\s*[-•*]\s+/.test(l)
        ? <div key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" /><span>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</span></div>
        : <p key={i}>{inline(l)}</p>)}
    </div>
  );
};

/** A floating chat for the Teach me note. It shrinks to a small round button (and back) and keeps the conversation while shrunk. */
export const TeachChat: React.FC<Props> = ({ note, topicLabel, noteRootRef }) => {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<{ text: string; x: number; y: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, open]);

  // Selecting text in the note offers "Ask about this".
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      const root = noteRootRef.current;
      if (!sel || !text || text.length < 3 || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) { setPicked(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPicked({ text: text.slice(0, 400), x: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90), y: Math.max(rect.top - 10, 60) });
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('keyup', onUp); };
  }, [noteRootRef]);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    const provider = getActiveProvider();
    if (!provider) { setError('No AI provider is connected. Connect one in Settings.'); return; }
    const next: AiMessage[] = [...msgs, { role: 'user', content: question }];
    setMsgs(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const withNote: AiMessage[] = next.map((m, i) => (i === 0 ? { ...m, content: `The note the learner is reading (topics: ${topicLabel}):\n"""\n${noteText(note)}\n"""\n\nLearner's question: ${m.content}` } : m));
      const reply = await aiComplete({ system: CHAT_SYSTEM, messages: withNote, purpose: 'teach-chat', provider, model: getEffectiveModel(provider) });
      setMsgs([...next, { role: 'assistant', content: reply.trim() }]);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const askAbout = () => {
    if (!picked) return;
    setOpen(true);
    setInput(`About "${picked.text}": `);
    setPicked(null);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => inputRef.current?.focus(), 60);
  };

  return (
    <>
      {picked && (
        <button onMouseDown={(e) => e.preventDefault()} onClick={askAbout} style={{ left: picked.x, top: picked.y }} className="fixed z-[70] -translate-x-1/2 -translate-y-full inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg ring-1 ring-white/30 hover:brightness-110">
          <TextQuote className="h-3.5 w-3.5" /> Ask about this
        </button>
      )}

      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Open the question chat" className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 py-3 pl-4 pr-5 text-sm font-bold text-white shadow-2xl ring-1 ring-white/30 transition hover:scale-105">
          <span className="relative flex h-6 w-6 items-center justify-center"><MessageCircle className="h-5 w-5" />{msgs.length > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-teal-600" />}</span>
          Ask a question
        </button>
      )}

      {open && (
        <div role="complementary" aria-label="Question chat" className="fixed bottom-4 right-4 z-[70] flex h-[min(540px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-teal-300/40 bg-white shadow-2xl shadow-black/40 dark:border-teal-500/30 dark:bg-slate-900">
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">Ask about this note</p>
              <p className="truncate text-[11px] text-white/80">{topicLabel}</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Shrink the chat" title="Shrink" className="rounded-full bg-white/20 p-1.5 hover:bg-white/30"><Minus className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13.5px] leading-6 text-slate-700 dark:text-slate-200">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="rounded-2xl bg-teal-50 px-3.5 py-3 text-slate-700 dark:bg-teal-950/40 dark:text-slate-200">Ask anything about what you are reading, like where else a drug is used. You can also <b>select any text in the note</b> and tap “Ask about this”.</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-teal-300/60 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 dark:border-teal-500/40 dark:bg-slate-800 dark:text-teal-200 dark:hover:bg-slate-700">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-gradient-to-br from-teal-600 to-cyan-600 px-3.5 py-2.5 text-white shadow-sm">{m.content}</div>
              : <div key={i} className="mr-6 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800"><Reply text={m.content} /></div>)}
            {busy && <div className="mr-6 inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" /> Thinking…</div>}
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} rows={1} placeholder="Type your question…" className="max-h-28 min-h-[40px] flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      )}
    </>
  );
};
