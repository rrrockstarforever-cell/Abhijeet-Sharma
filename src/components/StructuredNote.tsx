// Teaching notes as structured sections: a one-line idea, short explanations, step strips,
// comparison tables, exam traps and hidden self-check answers. The model returns JSON, so the
// layout comes from this view rather than from the model's prose.
// Rendered as React nodes only — no dangerouslySetInnerHTML anywhere.
import React from 'react';
import { AlertTriangle, Globe, Lightbulb, Loader2, Trash2 } from 'lucide-react';
import type { WebCheck, WebCheckItem } from '../lib/noteWebCheck.ts';

export type NoteBlock =
  | { type: 'text'; text: string }
  | { type: 'steps'; items: { title: string; detail: string; tag: string }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'trap'; text: string }
  | { type: 'hook'; text: string };

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
  'You are a warm, experienced medical teacher explaining a book chapter to a postgraduate exam student who has never seen it. Talk to them directly ("you", "notice that", "here is the trick"), like a person at a whiteboard. Never sound like a summary of the pages. Use simple, everyday English: short sentences, common words, and no dense textbook phrasing. The student reads these notes instead of the book, so they must be easy to follow on first reading.',
  '',
  'ACCURACY',
  '- The pages below are your only source of facts. Keep every number, ordinal, band, name and abbreviation exactly as written. MI stays MI. Never change a fact, and never fill a gap from memory. If a page says [unclear], say "unclear in source".',
  '- Put † straight after any sentence containing a fact or mechanism not stated on these pages. Be honest: most mechanisms you add will need it. Analogies need no mark.',
  '',
  'HOW TO TEACH',
  '- Every section opens with a "text" block that explains the idea in plain words before any jargon: what is happening, why it matters, why things are the way they are.',
  '- Write short sentences, one idea each. Prefer "use" to "utilise", "stops" to "inhibits", "builds" to "synthesises". Cut filler words and long chains of "which", "whereby" and "thereby".',
  '- The first time a technical term appears, add a short plain meaning in brackets, for example "enzyme (a protein that speeds up a reaction)". Do this only once per term.',
  '- Give each major idea one everyday analogy (a faulty brick, gum jammed in a lock), and use it in the section heading when it fits.',
  '- If the pages describe a process, the first section must include a "steps" block showing each step and what acts on it.',
  '- Text blocks are at most 4 sentences. Facts that can be compared go in tables with short cells. Include every item on the pages. A bare list of names goes in a sentence, not a table.',
  '- Connect ideas where the pages allow it, for example why a regimen changes for a younger child.',
  '- A "trap" must name the mistake students make, and goes right after what it is about. Do not use it to repeat a table row.',
  '- Use "hook" at most twice in a note, only for a memory aid that truly helps, and mark it † if it is yours.',
  '- Use **bold** sparingly for the words a student must not miss.',
  '',
  'Reply with ONLY this JSON object:',
  '{"title":"topic name","takeaway":"one sentence that gives the idea of the whole topic",',
  '"sections":[{"heading":"short heading","page":123,"blocks":[',
  '{"type":"text","text":"..."},',
  '{"type":"steps","items":[{"title":"1. Step","detail":"what happens","tag":"what acts here"}]},',
  '{"type":"table","columns":["Drug","Why you would use it","What to watch for"],"rows":[["..","..",".."]]},',
  '{"type":"trap","text":"..."},',
  '{"type":"hook","text":"..."}]}],',
  '"selfCheck":[{"q":"a short clinical question","a":"the answer and the reason"}]}',
  '"page" is the [page N] label where the section starts. Use "steps" only for a real sequence or process. Write 2 to 4 selfCheck questions.',
].join('\n');

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function toBlock(raw: any): NoteBlock | null {
  if (raw?.type === 'text' || raw?.type === 'trap' || raw?.type === 'hook') {
    const text = str(raw.text);
    return text ? { type: raw.type, text } : null;
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
    if (part === '†') return <sup key={i} className="font-bold text-[#00696b]" title="Not stated on these pages">†</sup>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

const Block: React.FC<{ block: NoteBlock }> = ({ block }) => {
  if (block.type === 'text') return <p className="text-[13.5px] leading-6 text-slate-700">{inline(block.text)}</p>;
  if (block.type === 'trap' || block.type === 'hook') {
    const trap = block.type === 'trap';
    return (
      <div className={`rounded-xl border p-3 ${trap ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${trap ? 'text-rose-700' : 'text-amber-800'}`}>
          {trap ? <AlertTriangle className="h-3 w-3" /> : <Lightbulb className="h-3 w-3" />}
          {trap ? 'Exam trap' : 'Memory hook'}
        </div>
        <p className="text-[13px] leading-5 text-slate-800">{inline(block.text)}</p>
      </div>
    );
  }
  if (block.type === 'steps') {
    return (
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-1.5">
        {block.items.map((item, i) => (
          <li key={i} className="rounded-lg bg-teal-50 p-2 text-[11.5px] leading-snug text-slate-700">
            <b className="mb-1 block text-[12px] text-slate-900">{inline(item.title)}</b>
            {inline(item.detail)}
            {item.tag && <span className="mt-1 block font-semibold text-[#00696b]">{inline(item.tag)}</span>}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px] leading-snug">
        <thead>
          <tr>
            {block.columns.map((c, i) => (
              <th key={i} className="border-b-2 border-slate-200 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={`border-b border-slate-100 px-2 py-2 align-top ${c === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{inline(cell)}</td>
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
          <button onClick={onRun} className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-slate-100">
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
}> = ({ note, range, readImages, onOpenPage, onDelete, webCheck, checking = false, onWebCheck }) => {
  const hasMarks = JSON.stringify(note).includes('†');
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="bg-[#0d3b3e] px-4 py-3.5 text-white">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-teal-200">{range}</p>
          {onDelete && (
            <button onClick={onDelete} title="Delete this note" aria-label="Delete this note" className="shrink-0 rounded p-1 text-teal-200 transition hover:bg-white/10 hover:text-white">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <h3 className="mt-0.5 text-[17px] font-bold leading-tight">{note.title || 'Notes'}</h3>
        {note.takeaway && <p className="mt-1.5 text-[13px] leading-5 text-teal-50">{note.takeaway.replace(/\*\*/g, '')}</p>}
      </header>
      <div className="space-y-5 p-4">
        <WebCheckPanel check={webCheck} checking={checking} onRun={onWebCheck} />
        {!readImages && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800">
            Written from the text layer only, without the page images. Check numbers and exceptions against the page.
          </p>
        )}
        {note.sections.map((section, i) => (
          <section key={i} className="space-y-2.5">
            <h4 className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold leading-snug text-slate-900">
              {inline(section.heading)}
              {section.page && (
                onOpenPage ? (
                  <button onClick={() => onOpenPage(section.page!)} className="text-[11px] font-medium text-slate-500 hover:text-[#00696b] hover:underline" title={`Open page ${section.page}`}>
                    p. {section.page}
                  </button>
                ) : (
                  <span className="text-[11px] font-medium text-slate-500">p. {section.page}</span>
                )
              )}
            </h4>
            {section.blocks.map((block, b) => <Block key={b} block={block} />)}
          </section>
        ))}
        {note.selfCheck.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-[15px] font-bold text-slate-900">Test yourself</h4>
            {note.selfCheck.map((c, i) => (
              <details key={i} className="rounded-lg border border-slate-200 px-3 py-2">
                <summary className="cursor-pointer text-[13px] font-semibold leading-5 text-slate-800">{inline(c.q)}</summary>
                <p className="mt-1.5 text-[13px] leading-5 text-slate-600">{inline(c.a)}</p>
              </details>
            ))}
          </section>
        )}
        <p className="border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-500">
          {hasMarks && (
            <>
              <sup className="font-bold text-[#00696b]">†</sup> Not stated on these pages. Added by the AI, so verify it.{' '}
            </>
          )}
          The AI can misread handwriting, so check numbers and exceptions against the page.
        </p>
      </div>
    </article>
  );
};
