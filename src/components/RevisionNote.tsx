// Revision-note renderer (PARITY section 12): high-yield and mnemonic callouts,
// page citations that jump back into the PDF reader, and a YouTube search link.
// Rendered as React nodes only — no dangerouslySetInnerHTML anywhere.
import React from 'react';
import { Sparkles, Brain, ExternalLink, FileText, Youtube } from 'lucide-react';

interface RevisionNoteProps {
  text: string;
  /** optional topic used for the YouTube search link */
  topic?: string;
  /** provided when the note refers to a page in an open book */
  onOpenPage?: (page: number) => void;
  className?: string;
}

/** Render **bold** inline markers and page citations without injecting HTML. */
function renderInline(text: string, keyPrefix: string, onOpenPage?: (page: number) => void): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // split on bold markers and page citations
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  boldParts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>);
      return;
    }
    // page citations: "p. 123", "page 123", "pp. 12–14"
    const re = /\b(p{1,2}\.\s*\d{1,4}|page\s+\d{1,4})\b/gi;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(part)) !== null) {
      if (match.index > last) nodes.push(<React.Fragment key={`${keyPrefix}-t${i}-${match.index}`}>{part.slice(last, match.index)}</React.Fragment>);
      const pageNum = Number((match[0].match(/\d+/) ?? ['0'])[0]);
      nodes.push(
        onOpenPage && pageNum > 0 ? (
          <button
            key={`${keyPrefix}-p${i}-${match.index}`}
            onClick={() => onOpenPage(pageNum)}
            className="mx-0.5 inline-flex items-center gap-1 rounded-full border  bg-teal-50 px-2 py-0.5 text-[11px] font-semibold  transition hover:bg-teal-100"
            title={`Open page ${pageNum} in the reader`}
          >
            <FileText className="h-3 w-3" /> {match[0]}
          </button>
        ) : (
          <span key={`${keyPrefix}-p${i}-${match.index}`} className="mx-0.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {match[0]}
          </span>
        ),
      );
      last = match.index + match[0].length;
    }
    if (last < part.length) nodes.push(<React.Fragment key={`${keyPrefix}-t${i}-end`}>{part.slice(last)}</React.Fragment>);
  });
  return nodes;
}

export const RevisionNote: React.FC<RevisionNoteProps> = ({ text, topic, onOpenPage, className }) => {
  if (!text.trim()) return null;
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];

  let buffer: string[] = [];
  let items: React.ReactNode[] = [];
  const flushParagraph = (key: string) => {
    if (!buffer.length) return;
    blocks.push(
      <p key={key} className="text-[13px] leading-7 text-slate-700">
        {renderInline(buffer.join(' '), key, onOpenPage)}
      </p>,
    );
    buffer = [];
  };
  const flushList = (key: string) => {
    if (!items.length) return;
    blocks.push(<ul key={key} className="space-y-2">{items}</ul>);
    items = [];
  };
  const flushAll = (key: string) => { flushParagraph(`${key}-p`); flushList(`${key}-l`); };

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) { flushAll(`g${index}`); return; }

    const isHighYield = /^(high[- ]yield|pearl|exam pearl)\b/i.test(trimmed) || /^(#+\s*)?high[- ]yield/i.test(trimmed);
    const isMnemonic = /^mnemonic\b/i.test(trimmed) || /^memory hook\b/i.test(trimmed);

    if (isHighYield || isMnemonic) {
      flushAll(`c${index}`);
      const clean = trimmed.replace(/^(high[- ]yield(\s+pearl)?|pearl|exam pearl|mnemonic|memory hook)\s*[:\-—]\s*/i, '');
      blocks.push(
        <div
          key={`callout${index}`}
          className={`relative overflow-hidden rounded-xl border p-3.5 shadow-sm ${isMnemonic
            ? 'border-amber-200 from-amber-50 to-white'
            : 'border-teal-200 from-teal-50 to-white'}`}
        >
          <span className={`absolute inset-y-0 left-0 w-1 ${isMnemonic ? 'bg-amber-400' : ''}`} />
          <div className={`mb-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider ${isMnemonic ? 'text-amber-800' : ''}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${isMnemonic ? 'bg-amber-200/70' : 'bg-teal-100'}`}>
              {isMnemonic ? <Brain className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
            </span>
            {isMnemonic ? 'Mnemonic' : 'High-yield'}
          </div>
          <div className="text-[13px] leading-6 text-slate-800">{renderInline(clean, `c${index}`, onOpenPage)}</div>
        </div>,
      );
      return;
    }

    if (/^#{1,4}\s+/.test(trimmed)) {
      flushAll(`h${index}`);
      const heading = trimmed.replace(/^#{1,4}\s+/, '');
      blocks.push(
        <h3 key={`h${index}`} className="flex items-center gap-2 pt-2 text-[14px] font-medium text-slate-900 first:pt-0">
          <span className="h-4 w-1 shrink-0 rounded-full " />
          {renderInline(heading, `h${index}`, onOpenPage)}
        </h3>,
      );
      return;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      flushParagraph(`li${index}-p`);
      items.push(
        <li key={`li${index}`} className="flex items-start gap-2.5 text-[13px] leading-6 text-slate-700">
          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full " />
          <span>{renderInline(trimmed.replace(/^[-*•]\s+/, ''), `li${index}`, onOpenPage)}</span>
        </li>,
      );
      return;
    }

    flushList(`t${index}-l`);
    buffer.push(trimmed);
  });
  flushAll('end');

  const searchTopic = (topic || text.split('\n')[0] || '').replace(/[*#]/g, '').slice(0, 80).trim();

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      {blocks}
      {searchTopic && (
        <a
          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${searchTopic} medical lecture`)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          <Youtube className="h-3.5 w-3.5" /> Search YouTube for this topic
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
};

/**
 * Download revision notes as a PDF using the browser's print-to-PDF dialog.
 * Opens a self-contained, print-styled document (headings + line breaks kept),
 * never injecting the notes as HTML into the React tree.
 */
export function downloadNotesPdf(title: string, text: string, providerLabel?: string): void {
  const win = window.open('', '_blank', 'width=860,height=1000');
  if (!win) {
    throw new Error('The browser blocked the print window. Allow pop-ups for Pulse Med and try again.');
  }
  const doc = win.document;
  const head = doc.createElement('head');
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  const style = doc.createElement('style');
  style.textContent = `
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 40px; line-height: 1.6; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #555; font-size: 12px; margin-bottom: 24px; }
    .note { white-space: pre-wrap; font-size: 14px; }
    .footer { margin-top: 32px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 11px; color: #666; }
    @media print { body { margin: 16mm; } }
 `;
  head.appendChild(meta);
  head.appendChild(style);
  doc.head.replaceWith(head);

  const body = doc.body;
  const h1 = doc.createElement('h1');
  h1.textContent = title || 'Pulse Med revision notes';
  const sub = doc.createElement('div');
  sub.className = 'sub';
  sub.textContent = `Pulse Med · generated ${new Date().toLocaleString()}${providerLabel ? ` · ${providerLabel}` : ''}`;
  const note = doc.createElement('div');
  note.className = 'note';
  note.textContent = text;
  const footer = doc.createElement('div');
  footer.className = 'footer';
  footer.textContent = 'Revision notes — verify clinical facts against the cited sources before use.';
  body.replaceChildren(h1, sub, note, footer);

  win.focus();
  setTimeout(() => win.print(), 300);
}
