// Teaching notes as structured sections: a one-line idea, short explanations, step strips,
// comparison tables, exam traps and hidden self-check answers. The model returns JSON, so the
// layout comes from this view rather than from the model's prose.
// Rendered as React nodes only — no dangerouslySetInnerHTML anywhere.
import { KeyPoint } from './KeyText.tsx';
import React from 'react';
import { AlertTriangle, Brain, CheckCircle2, ChevronDown, Globe, Lightbulb, Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { WebCheck, WebCheckItem } from '../lib/noteWebCheck.ts';

export type NoteBlock =
  | { type: 'text'; text: string }
  | { type: 'steps'; items: { title: string; detail: string; tag: string }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'trap'; text: string }
  | { type: 'hook'; text: string }
  /** A figure from the book: the page is drawn from the PDF when the note is shown, so no picture is stored. */
  | { type: 'figure'; page: number; caption: string };

/** Draws one page of the book as an image (a data URL), or null when it cannot. */
export type RenderPage = (page: number, caption?: string) => Promise<string | null>;

export interface NoteSection {
  heading: string;
  /** PDF page the section starts on, used for the jump link */
  page: number | null;
  blocks: NoteBlock[];
}

export interface TeachingNote {
  title: string;
  takeaway: string;
  sections: NoteSection[];
  selfCheck: { q: string; a: string }[];
}

// Step 1: one page image becomes an exact transcript, with no teaching and no interpretation.
export const PAGE_TRANSCRIBE_SYSTEM = [
 'You transcribe one page of a medical book from its image, including handwriting. Output only the transcript.',
 'Copy every word, number, ordinal (1st, 2nd, 3rd), unit, age and weight band, drug name, enzyme name and symbol (↑ ↓ →) exactly as written. Look twice at small digits and at lookalike names such as CYP2C9 and CYP2C19.',
 'Keep the structure: headings, bullets, and tables as rows with " | " between cells. Show which label sits under which heading. For a diagram, list what it shows, in order.',
 'Abbreviations stay as written (D/t, C/I, MI, DOC). Do not explain, correct or add anything. Write [unclear] for anything you cannot read; never guess.',
 'Skip watermarks, website names, video timestamps, page numbers and the words "Active space".',
].join('\n');

// Step 2: the transcripts become a teaching note.
export const TEACHING_NOTE_SYSTEM = [
 'You are a patient medical teacher writing for a reader with no prior medical knowledge. Assume they have never met this subject. Explain the selected chapter, topic, or paragraph from the beginning. Never use an undefined term. The first time any medical word, abbreviation, acronym, symbol, unit, normal value, anatomical name, drug class, test, or mechanism appears, define it in plain English; expand abbreviations (e.g., "MI (myocardial infarction, heart attack)"). Start each section with the simplest definition: what it is and why it matters. Then give one simple, everyday, non-medical example. Then state the clinical meaning: when and why it matters for patients. Use short sentences and common words. Explain every step of a process and what acts at each step. Use the pages for all book-specific facts, numbers, names, and exceptions; keep them exact. You may add basic definitions and everyday examples needed for a first-time reader; mark any added clinical fact or mechanism not on the pages with †. Never invent or contradict source facts. If the source says [unclear], say "unclear in source." Use tables only for simple comparisons, traps for named exam mistakes, and hooks at most twice. Reply only with JSON: {"title":"...","takeaway":"...","sections":[{"heading":"...","page":123,"blocks":[{"type":"text","text":"..."},{"type":"steps","items":[{"title":"...","detail":"...","tag":"..."}]},{"type":"table","columns":["..."],"rows":[["..."]]},{"type":"trap","text":"..."},{"type":"figure","page":123,"caption":"..."},{"type":"hook","text":"..."}]}],"selfCheck":[{"q":"...","a":"..."}]}. Write 2-4 selfCheck questions that test first-time understanding.',
 'Use **bold** sparingly: at most one or two short phrases per paragraph, only for the fact a reader must remember. Too much bold hides what matters. Write the selfCheck questions so the reader has to recall the answer, not just recognise it.',
].join('\n');

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function toBlock(raw: any): NoteBlock | null {
  if (raw?.type === 'text' || raw?.type === 'trap' || raw?.type === 'hook') {
    const text = str(raw.text);
    return text ? { type: raw.type, text } : null;
  }
  if (raw?.type === 'figure') {
    const page = Number(raw.page);
    return Number.isInteger(page) && page > 0 ? { type: 'figure', page, caption: str(raw.caption) } : null;
  }
  if (raw?.type === 'steps' && Array.isArray(raw.items)) {
    const items = raw.items
      .map((i: any) => ({ title: str(i?.title), detail: str(i?.detail), tag: str(i?.tag) }))
      .filter((i: { title: string; detail: string }) => i.title || i.detail);
    return items.length ? { type: 'steps', items } : null;
  }
  if (raw?.type === 'table' && Array.isArray(raw.columns) && Array.isArray(raw.rows)) {
    const columns = raw.columns.map(str);
    const rows = raw.rows.filter(Array.isArray).map((r: unknown[]) => columns.map((_: string, i: number) => str(r[i])));
    return columns.length && rows.length ? { type: 'table', columns, rows } : null;
  }
  return null;
}

/** Checks a model reply field by field, dropping anything malformed. Null when no section survives. */
export function toTeachingNote(raw: any): TeachingNote | null {
  const sections: NoteSection[] = (Array.isArray(raw?.sections) ? raw.sections : [])
    .map((s: any) => ({
      heading: str(s?.heading),
      page: Number.isInteger(Number(s?.page)) && Number(s?.page) > 0 ? Number(s.page) : null,
      blocks: (Array.isArray(s?.blocks) ? s.blocks : []).map(toBlock).filter(Boolean) as NoteBlock[],
    }))
    .filter((s: NoteSection) => s.blocks.length > 0);
  if (!sections.length) return null;
  return {
    title: str(raw.title),
    takeaway: str(raw.takeaway),
    sections,
    selfCheck: (Array.isArray(raw.selfCheck) ? raw.selfCheck : [])
      .map((c: any) => ({ q: str(c?.q), a: str(c?.a) }))
      .filter((c: { q: string; a: string }) => c.q && c.a),
  };
}

export interface SavedNote {
  id: string;
  range: string;
  note: TeachingNote;
  /** true when the model read the page images, false when it had only the text layer */
  readImages: boolean;
  webCheck?: WebCheck;
}

const notesKey = (docId: string) => `pulse.notes.v1.${docId}`;

/** The saved notes of one book, oldest first. Anything malformed is skipped. */
export function readSavedNotes(docId: string): SavedNote[] {
  try {
    const list = JSON.parse(localStorage.getItem(notesKey(docId)) || '[]');
    if (!Array.isArray(list)) return [];
    return list.flatMap((item: any) => {
      const note = toTeachingNote(item?.note);
      return note && typeof item?.id === 'string'
        ? [{
            id: item.id,
            range: str(item.range),
            note,
            readImages: item.readImages === true,
            webCheck: item.webCheck && Array.isArray(item.webCheck.items) ? item.webCheck : undefined,
          }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Returns false when the browser refused the write (storage full), so the caller can say so. */
export function writeSavedNotes(docId: string, notes: SavedNote[]): boolean {
  try {
    if (notes.length) localStorage.setItem(notesKey(docId), JSON.stringify(notes));
    else localStorage.removeItem(notesKey(docId));
    return true;
  } catch {
    return false;
  }
}

/** The note as plain text, for the printable PDF. */
export function teachingNoteToText(note: TeachingNote): string {
  const lines: string[] = [note.title, note.takeaway, ''];
  for (const s of note.sections) {
    lines.push(`${s.heading}${s.page ? ` (p. ${s.page})` : ''}`);
    for (const b of s.blocks) {
      if (b.type === 'text') lines.push(b.text);
      if (b.type === 'trap') lines.push(`Exam trap: ${b.text}`);
      if (b.type === 'hook') lines.push(`Memory hook: ${b.text}`);
      if (b.type === 'figure') lines.push(`Figure (p. ${b.page}): ${b.caption}`);
      if (b.type === 'steps') b.items.forEach((i) => lines.push(`- ${[i.title, i.detail, i.tag].filter(Boolean).join(': ')}`));
      if (b.type === 'table') {
        lines.push(b.columns.join(' | '));
        b.rows.forEach((r) => lines.push(r.join(' | ')));
      }
    }
    lines.push('');
  }
  if (note.selfCheck.length) {
    lines.push('Test yourself');
    note.selfCheck.forEach((c) => lines.push(`Q: ${c.q}`, `A: ${c.a}`));
  }
  return lines.join('\n').replace(/\*\*/g, '');
}

/** **bold** and the † "not from the book" mark. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|†)/g).filter(Boolean).map((part, i) => {
    if (part === '†') return <sup key={i} className="font-medium " title="Not stated on these pages">†</sup>;
    if (part.startsWith('**') && part.endsWith('**')) return <KeyPoint key={i}>{part.slice(2, -2)}</KeyPoint>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/** The book page that holds a figure, drawn on demand. Click to enlarge. */
const FigureBlock: React.FC<{ page: number; caption: string; renderPage?: RenderPage; onOpenPage?: (page: number) => void }> = ({ page, caption, renderPage, onOpenPage }) => {
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [big, setBig] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    if (!renderPage) { setFailed(true); return; }
    renderPage(page, caption).then((url) => { if (!live) return; if (url) setSrc(url); else setFailed(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [page, caption, renderPage]);
  return (
    <figure className="rounded-xl border border-slate-200 bg-slate-50 p-2">
      {src ? (
        <img src={src} alt={caption || `Book page ${page}`} onClick={() => setBig((v) => !v)} className={`mx-auto cursor-zoom-in rounded-md border border-slate-200 bg-white ${big ? 'w-full' : 'max-h-96'}`} />
      ) : (
        <div className="flex h-24 items-center justify-center text-[11px] text-slate-500">
          {failed ? (onOpenPage ? <button onClick={() => onOpenPage(page)} className="font-semibold text-[#00696b] hover:underline">Open page {page} to see the figure</button> : `See page ${page}`) : <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      )}
      <figcaption className="mt-1.5 text-[11.5px] leading-snug text-slate-600">{caption ? inline(caption) : null} <span className="text-slate-400">(page {page})</span></figcaption>
    </figure>
  );
};

/** Section colours, one after another, so a long note reads as a set of friendly cards. Written out in full so Tailwind keeps them. */
const ACCENTS = [
  { chip: 'bg-teal-500', tint: 'bg-teal-50/70 dark:bg-teal-950/25', border: 'border-teal-200 dark:border-teal-900/60', head: 'text-teal-900 dark:text-teal-100' },
  { chip: 'bg-sky-500', tint: 'bg-sky-50/70 dark:bg-sky-950/25', border: 'border-sky-200 dark:border-sky-900/60', head: 'text-sky-900 dark:text-sky-100' },
  { chip: 'bg-emerald-500', tint: 'bg-emerald-50/70 dark:bg-emerald-950/25', border: 'border-emerald-200 dark:border-emerald-900/60', head: 'text-emerald-900 dark:text-emerald-100' },
  { chip: 'bg-amber-500', tint: 'bg-amber-50/70 dark:bg-amber-950/25', border: 'border-amber-200 dark:border-amber-900/60', head: 'text-amber-900 dark:text-amber-100' },
  { chip: 'bg-cyan-500', tint: 'bg-cyan-50/70 dark:bg-cyan-950/25', border: 'border-cyan-200 dark:border-cyan-900/60', head: 'text-cyan-900 dark:text-cyan-100' },
];

const Block: React.FC<{ block: NoteBlock; renderPage?: RenderPage; onOpenPage?: (page: number) => void }> = ({ block, renderPage, onOpenPage }) => {
  if (block.type === 'figure') return <FigureBlock page={block.page} caption={block.caption} renderPage={renderPage} onOpenPage={onOpenPage} />;
  if (block.type === 'text') {
    // Lines that start with "-" or "•" are a list: each one gets its own row with a dot. Other lines are paragraphs.
    const lines = block.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const isItem = (l: string) => /^[-•*]\s+/.test(l);
    if (lines.length > 1 || (lines.length === 1 && isItem(lines[0]))) {
      const groups: { list: boolean; rows: string[] }[] = [];
      for (const l of lines) {
        const list = isItem(l);
        const last = groups[groups.length - 1];
        const text = l.replace(/^[-•*]\s+/, '');
        if (last && last.list === list) last.rows.push(text); else groups.push({ list, rows: [text] });
      }
      return (
        <div className="space-y-2.5">
          {groups.map((g, gi) => g.list ? (
            <ul key={gi} className="space-y-2">
              {g.rows.map((r, ri) => (
                <li key={ri} className="flex gap-2.5 rounded-xl bg-white/70 px-3 py-2 text-[14.5px] leading-6 text-slate-700 shadow-sm dark:bg-slate-900/60 dark:text-slate-200">
                  <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                  <span className="min-w-0">{inline(r)}</span>
                </li>
              ))}
            </ul>
          ) : g.rows.map((r, ri) => <p key={`${gi}-${ri}`} className="text-[14.5px] leading-7 text-slate-700 dark:text-slate-200">{inline(r)}</p>))}
        </div>
      );
    }
    return <p className="text-[14.5px] leading-7 text-slate-700 dark:text-slate-200">{inline(block.text)}</p>;
  }
  if (block.type === 'trap' || block.type === 'hook') {
    const trap = block.type === 'trap';
    return (
      <div className={`flex gap-3 rounded-2xl border p-3.5 shadow-sm ${trap ? 'border-rose-200 bg-gradient-to-br from-rose-50 to-white dark:border-rose-900/60 dark:from-rose-950/40 dark:to-slate-900' : 'border-amber-200 bg-gradient-to-br from-amber-50 to-white dark:border-amber-900/60 dark:from-amber-950/40 dark:to-slate-900'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${trap ? 'bg-rose-500 text-white' : 'bg-amber-400 text-amber-950'}`}>
          {trap ? <AlertTriangle className="h-[18px] w-[18px]" /> : <Lightbulb className="h-[18px] w-[18px]" />}
        </span>
        <div className="min-w-0">
          <div className={`text-[11px] font-bold uppercase tracking-wider ${trap ? 'text-rose-700 dark:text-rose-300' : 'text-amber-800 dark:text-amber-300'}`}>{trap ? 'Watch out: exam trap' : 'Memory hook'}</div>
          <p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100">{inline(block.text)}</p>
        </div>
      </div>
    );
  }
  if (block.type === 'steps') {
    return (
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
        {block.items.map((item, i) => (
          <li key={i} className="relative rounded-xl border border-teal-200 bg-white p-3 pt-4 text-[12.5px] leading-snug text-slate-700 shadow-sm dark:border-teal-900/60 dark:bg-slate-900 dark:text-slate-200">
            <span className="absolute -top-2.5 left-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#0f8b8d] text-[11px] font-bold text-white">{i + 1}</span>
            <b className="mb-1 block text-[13px] text-slate-900 dark:text-white">{inline(item.title)}</b>
            {inline(item.detail)}
            {item.tag && <span className="mt-1.5 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-[#00696b] dark:bg-teal-900/50 dark:text-teal-200">{inline(item.tag)}</span>}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full border-collapse text-[13px] leading-snug">
        <thead>
          <tr className="bg-teal-50 dark:bg-slate-800">
            {block.columns.map((c, i) => (
              <th key={i} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#00696b] dark:text-teal-300">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="odd:bg-white even:bg-slate-50/80 dark:odd:bg-slate-900 dark:even:bg-slate-800/50">
              {row.map((cell, c) => (
                <td key={c} className={`px-3 py-2.5 align-top ${c === 0 ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const CheckItem: React.FC<{ item: WebCheckItem }> = ({ item }) => (
  <li className="text-[12px] leading-snug text-slate-700">
    <p className="font-semibold text-slate-800">{item.claim}</p>
    {item.explanation && <p className="mt-0.5">{item.explanation}</p>}
    {item.quote && <p className="mt-0.5 italic text-slate-500">"{item.quote}"</p>}
    {item.source && /^https?:\/\//.test(item.source.url) && (
      <a href={item.source.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block font-semibold text-[#00696b] hover:underline">
        {item.source.title}
      </a>
    )}
  </li>
);

const WebCheckPanel: React.FC<{ check?: WebCheck; checking: boolean; onRun?: () => void }> = ({ check, checking, onRun }) => {
  const by = (v: WebCheckItem['verdict']) => (check?.items ?? []).filter((i) => i.verdict === v);
  const conflicts = by('conflict');
  const summary = checking
    ? 'Checking claims on the web…'
    : !check
      ? 'Not checked on the web yet.'
      : check.status === 'failed'
        ? `The web check failed, so this note is unchecked. ${check.error ?? ''}`
        : `Web check: ${by('confirmed').length} confirmed, ${conflicts.length} conflicting, ${by('no-evidence').length} not settled, out of ${check.items.length} claims.`;
  return (
    <div className={`rounded-xl border p-3 ${conflicts.length || check?.status === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-start gap-2">
        {checking ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#00696b]" /> : <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00696b]" />}
        <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-slate-800">{summary}</p>
        {onRun && !checking && (
          <button onClick={onRun} className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100">
            {check ? 'Check again' : 'Check on the web'}
          </button>
        )}
      </div>
      {conflicts.length > 0 && (
        <>
          <ul className="mt-2 space-y-2">{conflicts.map((item, i) => <CheckItem key={i} item={item} />)}</ul>
          <p className="mt-2 text-[11px] leading-snug text-slate-600">A conflict is not proof the note is wrong. Compare the page and the source, because web sources can be wrong or follow other guidelines.</p>
        </>
      )}
      {by('confirmed').length + by('no-evidence').length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">See the other claims</summary>
          <ul className="mt-2 space-y-2">
            {[...by('confirmed'), ...by('no-evidence')].map((item, i) => <CheckItem key={i} item={item} />)}
          </ul>
        </details>
      )}
      {check?.status === 'done' && (
        <p className="mt-2 text-[11px] leading-snug text-slate-500">Only these claims were checked, not the whole note.</p>
      )}
    </div>
  );
};

export const StructuredNote: React.FC<{
  note: TeachingNote;
  range: string;
  /** true when the model read the page images, false when it had only the text layer */
  readImages: boolean;
  onOpenPage?: (page: number) => void;
  onDelete?: () => void;
  webCheck?: WebCheck;
  checking?: boolean;
  onWebCheck?: () => void;
  renderPage?: RenderPage;
  /** A note the AI wrote from the learner's missed questions (not from book pages): no web check, no handwriting warning. */
  plain?: boolean;
}> = ({ note, range, readImages, onOpenPage, onDelete, webCheck, checking = false, onWebCheck, renderPage, plain = false }) => {
  const hasMarks = JSON.stringify(note).includes('†');
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-slate-900">
      <header className="relative overflow-hidden bg-gradient-to-br from-[#0d3b3e] via-[#0f6b6d] to-[#14a8a3] px-5 py-5 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-14 right-16 h-28 w-28 rounded-full bg-white/10" />
        <div className="relative flex items-center justify-between gap-2">
          <p className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-teal-50">{range}</p>
          {onDelete && (
            <button onClick={onDelete} title="Delete this note" aria-label="Delete this note" className="shrink-0 rounded-lg p-1.5 text-teal-100 transition hover:bg-white/15 hover:text-white">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <h3 className="relative mt-2 text-[22px] font-semibold leading-tight tracking-tight">{note.title || 'Notes'}</h3>
        {note.takeaway && (
          <div className="relative mt-3 flex gap-2.5 rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-100">The big idea</div>
              <p className="mt-0.5 text-[14px] leading-6 text-white">{note.takeaway.replace(/\*\*/g, '')}</p>
            </div>
          </div>
        )}
      </header>
      <div className="space-y-5 p-4 sm:p-5">
        {!plain && <WebCheckPanel check={webCheck} checking={checking} onRun={onWebCheck} />}
        {!plain && !readImages && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Written from the text layer only, without the page images. Check numbers and exceptions against the page.
          </p>
        )}
        {note.sections.map((section, i) => {
          const a = ACCENTS[i % ACCENTS.length];
          return (
            <section key={i} className={`page-enter space-y-3 rounded-2xl border p-4 [animation-fill-mode:backwards] ${a.border} ${a.tint}`} style={{ animationDelay: `${Math.min(i, 6) * 70}ms` }}>
              <h4 className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[16px] font-semibold leading-snug ${a.head}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${a.chip}`}>{i + 1}</span>
                <span className="min-w-0">{inline(section.heading)}</span>
                {section.page && (
                  onOpenPage ? (
                    <button onClick={() => onOpenPage(section.page!)} className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-[#00696b] hover:underline dark:bg-slate-800/70 dark:text-slate-300" title={`Open page ${section.page}`}>
                      p. {section.page}
                    </button>
                  ) : (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">p. {section.page}</span>
                  )
                )}
              </h4>
              {section.blocks.map((block, b) => <Block key={b} block={block} renderPage={renderPage} onOpenPage={onOpenPage} />)}
            </section>
          );
        })}
        {note.selfCheck.length > 0 && (
          <section className="space-y-2 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-slate-900">
            <h4 className="flex items-center gap-2 text-[16px] font-semibold text-emerald-900 dark:text-emerald-100"><Brain className="h-5 w-5" /> Test yourself</h4>
            <p className="text-[12.5px] text-emerald-800/80 dark:text-emerald-200/70">Try to answer in your head first, then tap to check. Trying to recall is what makes it stick.</p>
            {note.selfCheck.map((c, i) => (
              <details key={i} className="group rounded-xl border border-emerald-200 bg-white px-3.5 py-2.5 shadow-sm open:ring-2 open:ring-emerald-300/50 dark:border-emerald-900/60 dark:bg-slate-900">
                <summary className="flex cursor-pointer list-none items-start gap-2 text-[14px] font-semibold leading-6 text-slate-800 dark:text-slate-100">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">?</span>
                  <span className="min-w-0 flex-1">{inline(c.q)}</span>
                  <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
                </summary>
                <p className="mt-2 flex gap-2 rounded-lg bg-emerald-50 p-2.5 text-[14px] leading-6 text-slate-700 dark:bg-emerald-950/30 dark:text-slate-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span className="min-w-0">{inline(c.a)}</span></p>
              </details>
            ))}
          </section>
        )}
        <p className="border-t border-slate-100 pt-3 text-[11.5px] leading-snug text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {hasMarks && (
            <>
              <sup className="font-medium ">†</sup> Not stated on these pages. Added by the AI, so verify it.{' '}
            </>
          )}
          {plain ? 'Written by the AI from what you missed. Check exact numbers and doses against your book.' : 'The AI can misread handwriting, so check numbers and exceptions against the page.'}
        </p>
      </div>
    </article>
  );
};
