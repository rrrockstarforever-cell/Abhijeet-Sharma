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

/** Render **bold** and `code` inline markers without injecting HTML. */
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
            className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded bg-teal-50 border border-[#0f8b8d]/30 text-[#00696b] font-semibold hover:bg-teal-100"
            title={`Open page ${pageNum} in the reader`}
          >
            <FileText className="w-3 h-3" /> {match[0]}
          </button>
        ) : (
          <span key={`${keyPrefix}-p${i}-${match.index}`} className="text-slate-500">{match[0]}</span>
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
  const flush = (key: string) => {
    if (!buffer.length) return;
    const body = buffer.join(' ');
    blocks.push(
      <p key={key} className="text-[11px] leading-relaxed text-slate-700">
        {renderInline(body, key, onOpenPage)}
      </p>,
    );
    buffer = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { flush(`p${index}`); return; }

    const isHighYield = /^(high[- ]yield|pearl|exam pearl)\b/i.test(trimmed) || /^(#+\s*)?high[- ]yield/i.test(trimmed);
    const isMnemonic = /^mnemonic\b/i.test(trimmed) || /^memory hook\b/i.test(trimmed);

    if (isHighYield || isMnemonic) {
      flush(`p${index}`);
      const clean = trimmed.replace(/^(high[- ]yield(\s+pearl)?|pearl|exam pearl|mnemonic|memory hook)\s*[:\-—]\s*/i, '');
      blocks.push(
        <div
          key={`callout${index}`}
          className={isMnemonic
            ? 'p-2 rounded-lg bg-amber-50 border border-amber-200'
            : 'p-2 rounded-lg bg-teal-50 border border-[#0f8b8d]/25'}
        >
          <div className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 mb-0.5 ${isMnemonic ? 'text-amber-800' : 'text-[#00696b]'}`}>
            {isMnemonic ? <Brain className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            {isMnemonic ? 'Mnemonic' : 'High-yield'}
          </div>
          <div className="text-[11px] leading-relaxed text-slate-800">{renderInline(clean, `c${index}`, onOpenPage)}</div>
        </div>,
      );
      return;
    }

    if (/^#{1,4}\s+/.test(trimmed)) {
      flush(`p${index}`);
      const heading = trimmed.replace(/^#{1,4}\s+/, '');
      blocks.push(
        <div key={`h${index}`} className="text-[11px] font-bold text-slate-900 pt-1">
          {renderInline(heading, `h${index}`, onOpenPage)}
        </div>,
      );
      return;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      flush(`p${index}`);
      blocks.push(
        <div key={`li${index}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-700">
          <span className="text-[#0f8b8d] mt-0.5">•</span>
          <span>{renderInline(trimmed.replace(/^[-*•]\s+/, ''), `li${index}`, onOpenPage)}</span>
        </div>,
      );
      return;
    }

    buffer.push(trimmed);
  });
  flush('pend');

  const searchTopic = (topic || text.split('\n')[0] || '').replace(/[*#]/g, '').slice(0, 80).trim();

  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      {blocks}
      {searchTopic && (
        <a
          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${searchTopic} medical lecture`)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 hover:underline pt-1"
        >
          <Youtube className="w-3.5 h-3.5" /> Search YouTube for this topic
          <ExternalLink className="w-2.5 h-2.5" />
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
