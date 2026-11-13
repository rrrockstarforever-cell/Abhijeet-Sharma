// Clinical AI Tutor — real provider chat with a ChatGPT/Grok-style UX.
// - Conversation list (left, localStorage), new/rename/delete, persisted across restarts.
// - Every reply comes from POST /api/ai/tutor-chat with the active provider/model and
// the last ~10 turns of history. No canned replies, ever; failures surface as error bubbles.
// - Sticky bottom composer: Enter = send, Shift+Enter = newline. Typing indicator while waiting.
// - Per-message actions: copy, regenerate, "Save as highlight" (writes to the user-highlights store).
// - Context question attaches as a removable chip; quick prompts for clinical use.
// - Replies are rendered as React elements (markdown-ish) — never raw HTML (no innerHTML).
import React, { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from 'react';
import {
  Sparkles,
  Send,
  Brain,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Bot,
  User,
  RotateCcw,
  ExternalLink,
  ShieldCheck,
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Copy,
  Check,
  BookmarkPlus,
  X,
  Loader2,
  ChevronDown,
  Paperclip,
  FileText,
  ImageIcon,
  Mic,
  MicOff
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useVoiceInput } from './useVoiceInput.ts';
import { AppView, ClinicalQuestion, ExamType } from '../types.ts';
import {
  getActiveProvider as getStoredActiveProvider,
  setActiveProvider as persistActiveProvider,
  getEffectiveModel,
  setModel as persistModel,
  fetchProviderStatus,
  NOT_CONNECTED_MESSAGE,
  AI_PROVIDER_IDS,
  pickDefaultActiveProvider,
  type AiProviderId,
} from '../lib/ai.ts';
import { addUserHighlight, highlightFromAiReply } from '../utils/userHighlightsStore.ts';
import { listCapturedQuestions, capturedToClinicalQuestion } from '../utils/mistakeStore.ts';
import { listLibraryDocuments } from '../utils/pdfLibraryDB.ts';
import { extractBookPageText, extractBookRangeText } from '../utils/bookPageText.ts';
import { adviseAttachment, estimateTokens, formatTokens } from '../utils/tokenEstimate.ts';
import {
  type ExplanationImage,
  extractImageCue,
  stripImageCue,
  expandDenseParagraph,
  resolveExplanationImage,
  isExplanationImagesEnabled,
  setExplanationImagesEnabled,
} from '../utils/explanationImages.ts';
import { ExplanationFigure } from './ExplanationFigure.tsx';
import { takeTutorSeed } from '../lib/tutorSeed.ts';
import { rewardForLesson } from '../utils/gameStore.ts';
import { KeyPoint } from './KeyText.tsx';

interface AITutorViewProps {
  initialQuestionId?: string;
  /** exact question object from the active test/bank (AI-generated ids are not in the sample set) */
  attachedQuestion?: ClinicalQuestion | null;
  onNavigate: (view: AppView, targetId?: string) => void;
  currentExam?: ExamType;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  isError?: boolean;
  /** Book pages sent with this turn; kept so follow-up history keeps the source text. */
  contextNote?: string;
  attachments?: { docTitle: string; pageNumber: number }[];
  reasoningSteps?: { step: string; detail: string }[];
  pearl?: string;
  citations?: string[];
  suggestedFollowups?: string[];
  /** VERIFIED illustration attached to this reply, resolved after the text arrived. */
  image?: ExplanationImage | null;
  /** true while the illustration lookup is still running */
  imageLoading?: boolean;
  /** why no illustration was attached (tutor only) */
  imageReason?: string;
}

/** A page (or contiguous run of pages) from the learner's own PDF library, attached as chat context. */
interface BookAttachment {
  id: string;
  docId: string;
  docTitle: string;
  /** 1-based inclusive start page */
  pageNumber: number;
  /** 1-based inclusive end page (equal to pageNumber for a single page) */
  endPage?: number;
  text: string;
  /** estimated tokens, shown so a large attach is never a surprise */
  tokens?: number;
  scale?: 'small' | 'medium' | 'large' | 'huge';
}

interface AttachDocOption {
  id: string;
  title: string;
  numPages: number;
  fileType?: 'pdf' | 'docx';
  subject?: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const CONVERSATIONS_KEY = 'pulse.aiTutor.conversations.v1';
const EFFORT_KEY = 'ai.effort';
const EFFORT_LEVELS = ['Min', 'Low', 'Medium', 'High', 'Ultra'] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];
/** One-tap prompts shown when a question is attached, so a learner does not have to type "explain". */
const QUICK_ACTIONS: { label: string; prompt: string }[] = [
  { label: 'Explain', prompt: 'Explain this question step by step, ending with the correct answer.' },
  { label: 'Why are the others wrong?', prompt: 'For each wrong option, say why it is wrong and name the trap it sets.' },
  { label: 'Mnemonic', prompt: 'Give a short mnemonic or memory hook for the key fact in this question.' },
  { label: 'Similar question', prompt: 'Write one similar MCQ on the same concept with four options, then give the answer and a one-line reason.' },
  { label: 'Drug interactions', prompt: 'List the important drug interactions and monitoring points relevant to this question.' },
];

const PERSONAS = [
  { id: 'BOARD_MASTER', label: 'Board Master', hint: 'Distractors & pearls' },
  { id: 'ATTENDING', label: 'Attending', hint: 'Socratic rounds' },
  { id: 'PHARMACOLOGIST', label: 'Pharmacologist', hint: 'Mechanisms & kinetics' },
] as const;

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(list.slice(0, 50)));
  } catch { /* storage full: keep the session in memory */ }
}

function newConversation(): Conversation {
  const now = new Date().toISOString();
  const c: Conversation = {
    id: `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New clinical chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  return c;
}

// ---------- minimal markdown-to-React rendering (no raw HTML) ----------

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <KeyPoint key={key}>{part.slice(2, -2)}</KeyPoint>;
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code key={key} className="px-1 py-0.5 rounded-[6px] bg-teal-50 font-mono text-[11px] border border-[#0f8b8d]/25 text-[#0f8b8d]">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  let listKey = '';
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1 my-1.5">
          {list}
        </ul>
      );
      list = [];
      listKey = '';
    }
  };
  lines.forEach((rawLine, i) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const key = `md-${i}`;
    if (!trimmed) {
      flushList();
      return;
    }
    const bullet = trimmed.match(/^(?:[-*])\s+(.*)$/);
    const ordered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (bullet) {
      if (listKey !== 'ul') flushList();
      listKey = 'ul';
      list.push(<li key={key}>{renderInline(bullet[1], key)}</li>);
      return;
    }
    if (ordered) {
      if (listKey !== 'ol') flushList();
      listKey = 'ol';
      list.push(<li key={key}>{renderInline(ordered[2], key)}</li>);
      return;
    }
    if (heading) {
      flushList();
      blocks.push(
        <div key={key} className={`font-medium text-slate-900  mt-3 mb-1 ${heading[1].length <= 2 ? 'text-sm' : 'text-xs'}`}>
          {renderInline(heading[2], key)}
        </div>
      );
      return;
    }
    flushList();
    blocks.push(<p key={key} className="my-2.5 leading-7 text-slate-900 ">{renderInline(line, key)}</p>);
  });
  flushList();
  return <>{blocks}</>;
}

// ---------- component ----------

// ----- shared chat store -----
// Replies keep arriving after the learner leaves the tutor (the request is still running on the
// server). The conversation list and the set of conversations awaiting a reply therefore live
// outside the component, so a reply that arrives later is still saved and shown on return.
let conversationStore: Conversation[] | null = null;
const pendingConversations = new Set<string>();
const storeListeners = new Set<() => void>();

function getConversationStore(): Conversation[] {
  if (!conversationStore) {
    const loaded = loadConversations();
    conversationStore = loaded.length ? loaded : [newConversation()];
  }
  return conversationStore;
}

function notifyStore(): void {
  storeListeners.forEach((listener) => listener());
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => { storeListeners.delete(listener); };
}

function setConversationStore(updater: (prev: Conversation[]) => Conversation[]): void {
  conversationStore = updater(getConversationStore());
  saveConversations(conversationStore);
  notifyStore();
}

function setConversationPending(id: string, pending: boolean): void {
  if (pending) pendingConversations.add(id);
  else pendingConversations.delete(id);
  notifyStore();
}

/** The conversation list, with a setter that behaves like useState's. */
function useConversationStore(): [Conversation[], (updater: (prev: Conversation[]) => Conversation[]) => void] {
  const list = useSyncExternalStore(subscribeStore, getConversationStore);
  return [list, setConversationStore];
}

/** True while the given conversation is waiting for a reply. */
function useConversationPending(id: string): boolean {
  return useSyncExternalStore(subscribeStore, () => pendingConversations.has(id));
}

function ConversationPendingDot({ id }: { id: string }) {
  const pending = useConversationPending(id);
  return pending ? (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
      aria-label="Awaiting reply"
    />
  ) : null;
}

export const AITutorView: React.FC<AITutorViewProps> = ({ initialQuestionId, attachedQuestion, onNavigate, currentExam = 'NEET_PG' }) => {
  const reduceMotion = useReducedMotion();

  // ----- conversations -----
  const [conversations, setConversations] = useConversationStore();
  const [activeId, setActiveId] = useState<string>('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>('');

  // ----- provider / model state -----
  const [providerMap, setProviderMap] = useState<Record<string, { connected?: boolean }>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AiProviderId | null>(() => getStoredActiveProvider());
  const [model, setModel] = useState<string>('');

  // ----- chat state -----
  const [input, setInput] = useState<string>('');
  // Voice input: see useVoiceInput (records here, transcribes on this device with Whisper).
  const { recording, status: voiceStatus, toggle: toggleVoice } = useVoiceInput((text) => {
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  });
  // Waiting for a reply in the active conversation (kept in the store, so it survives navigation).
  const loading = useConversationPending(activeId);
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]['id']>('BOARD_MASTER');
  const [effort, setEffort] = useState<EffortLevel>(() => {
    try {
      const saved = localStorage.getItem(EFFORT_KEY) as EffortLevel | null;
      return saved && EFFORT_LEVELS.includes(saved) ? saved : 'Medium';
    } catch {
      return 'Medium';
    }
  });
  const [contextRemoved, setContextRemoved] = useState<boolean>(false);
  const [contextOpen, setContextOpen] = useState<boolean>(false);
  const [imageEnabled, setImageEnabled] = useState<boolean>(() => isExplanationImagesEnabled());
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [savedHighlightId, setSavedHighlightId] = useState<string | null>(null);

  // ----- book-page attachments (real page text from the local PDF library) -----
  const [attachments, setAttachments] = useState<BookAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState<boolean>(false);
  const [attachDocs, setAttachDocs] = useState<AttachDocOption[]>([]);
  const [attachDocsBusy, setAttachDocsBusy] = useState<boolean>(false);
  const [attachDocId, setAttachDocId] = useState<string>('');
  const [attachPage, setAttachPage] = useState<string>('1');
  const [attachEndPage, setAttachEndPage] = useState<string>('1');
  const [attachBusy, setAttachBusy] = useState<boolean>(false);
  const [attachProgress, setAttachProgress] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // initialise active conversation id after first render
  useEffect(() => {
    setActiveId((prev) => prev || conversations[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  const messages = activeConversation?.messages ?? [];


  // fetch REAL provider connection status on mount; pick a connected provider
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const providers = await fetchProviderStatus();
        if (cancelled) return;
        setProviderMap(providers);
        setStatusError(null);
        const stored = getStoredActiveProvider();
        if (stored && providers[stored]?.connected) {
          // Honour the learner's explicit choice when it is actually connected.
          setProvider(stored);
          if (providers[stored]) setModel((m) => m || getEffectiveModel(stored));
        } else {
          // Otherwise fall back to ANY connected provider. Previously a stale
          // hard-coded provider list could omit a working provider, making the app
          // appear to have no provider at all and leaving the whole composer disabled.
          const first = pickDefaultActiveProvider(providers);
          if (first) {
            setProvider(first);
            persistActiveProvider(first);
          } else if (stored) {
            setProvider(stored); // keep the stored choice; requests will surface the real error
          }
        }
        // Model must be resolved for whichever provider actually won, not whichever was
        // stored — otherwise an inactive provider's model is shown against the active one.
        const chosen = stored && providers[stored]?.connected ? stored : pickDefaultActiveProvider(providers);
        if (chosen) setModel((m) => m || getEffectiveModel(chosen));
      } catch (err: any) {
        if (!cancelled) setStatusError(err?.message || 'Could not check AI provider status.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the model text in sync with the selected provider
  useEffect(() => {
    if (provider) setModel(getEffectiveModel(provider));
  }, [provider]);

  // auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  const contextQuestion: ClinicalQuestion | null = useMemo(() => {
    if (contextRemoved) return null;
    if (attachedQuestion) return attachedQuestion;
    if (!initialQuestionId) return null;
    // Resolve the id against real sources only: the launched question handed over by
    // the app, or a question the learner captured in the Mistake Notebook. If the id
    // matches nothing real, no context chip is shown — never a sample stand-in.
    const captured = listCapturedQuestions().find((c) => c.id === initialQuestionId);
    return captured ? capturedToClinicalQuestion(captured) : null;
  }, [initialQuestionId, attachedQuestion, contextRemoved]);

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  /** Patch one message in place (used to drop the image cue, then attach the figure). */
  const updateMessage = useCallback((convId: string, msgId: string, patch: Partial<ChatMessage>) => {
    updateConversation(convId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
    }));
  }, [updateConversation]);

  const appendMessage = useCallback((convId: string, msg: ChatMessage) => {
    updateConversation(convId, (c) => ({
      ...c,
      updatedAt: new Date().toISOString(),
      messages: [...c.messages, msg],
    }));
  }, [updateConversation]);

  // ----- provider/model controls -----
  // Derived from the canonical provider list so a newly added provider
  // can never again be silently excluded from the tutor.
  const connectedProviders = AI_PROVIDER_IDS.filter((id) => providerMap[id]?.connected);

  const handleProviderChange = (id: AiProviderId) => {
    setProvider(id);
    persistActiveProvider(id);
  };

  const handleModelChange = (value: string) => {
    setModel(value);
    if (provider) persistModel(provider, value);
  };

  const handleEffortChange = (value: EffortLevel) => {
    setEffort(value);
    try { localStorage.setItem(EFFORT_KEY, value); } catch { /* storage unavailable */ }
  };

  // ----- attach a page from the learner's own PDF library -----
  const loadAttachDocs = async () => {
    setAttachDocsBusy(true);
    setAttachError(null);
    try {
      const docs = await listLibraryDocuments();
      const options = docs.map((d) => ({
        id: d.id,
        title: d.title,
        numPages: d.numPages,
        fileType: d.fileType,
        subject: d.subject,
      }));
      setAttachDocs(options);
      setAttachDocId((prev) => (prev && options.some((o) => o.id === prev) ? prev : options[0]?.id || ''));
    } catch (err: any) {
      setAttachError(err?.message || 'Could not read the PDF library on this device.');
    } finally {
      setAttachDocsBusy(false);
    }
  };

  const openAttachPanel = () => {
    if (attachOpen) {
      setAttachOpen(false);
      return;
    }
    setAttachOpen(true);
    setAttachError(null);
    if (!attachDocs.length) void loadAttachDocs();
  };

  const attachSelectedPage = async () => {
    const doc = attachDocs.find((d) => d.id === attachDocId);
    if (!doc) {
      setAttachError('Import a PDF or DOCX in the PDF Reader first, then attach its pages here.');
      return;
    }
    const from = Math.round(Number(attachPage));
    const to = Math.round(Number(attachEndPage || attachPage));
    if (!Number.isFinite(from) || from < 1) {
      setAttachError('Enter a page number of 1 or more.');
      return;
    }
    if (!Number.isFinite(to) || to < from) {
      setAttachError('The end page must be the same as, or after, the start page.');
      return;
    }
    const isRange = to > from;
    if (!isRange && attachments.some((a) => a.docId === doc.id && a.pageNumber === from)) {
      setAttachError(`Page ${from} of "${doc.title}" is already attached.`);
      return;
    }
    setAttachBusy(true);
    setAttachError(null);
    setAttachProgress(null);
    try {
      if (isRange) {
        const result = await extractBookRangeText(doc.id, from, to, {
          onProgress: (done, total) => setAttachProgress(`Reading page ${from + done - 1} of ${to} (${done}/${total})…`),
        });
        const advice = adviseAttachment(result.text);
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            docId: result.docId,
            docTitle: result.docTitle,
            pageNumber: result.fromPage,
            endPage: result.toPage,
            text: result.text,
            tokens: advice.tokens,
            scale: advice.scale,
          },
        ]);
      } else {
        const result = await extractBookPageText(doc.id, from);
        // One page is small by definition, but keep the same shape as a range attach so
        // the chip and the estimator behave identically for both.
        const text = result.text.slice(0, 6000);
        const advice = adviseAttachment(text);
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            docId: result.docId,
            docTitle: result.docTitle,
            pageNumber: result.pageNumber,
            endPage: result.pageNumber,
            text,
            tokens: advice.tokens,
            scale: advice.scale,
          },
        ]);
      }
      setAttachOpen(false);
      setAttachPage(String(to + 1));
      setAttachEndPage(String(to + 1));
      setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (err: any) {
      setAttachError(err?.message || 'Could not read those pages.');
    } finally {
      setAttachBusy(false);
      setAttachProgress(null);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  /** Context block prepended to the prompt (never shown as the chat bubble text). */
  const buildAttachmentContext = (): string => {
    if (!attachments.length) return '';
    const body = attachments
      .map((a) => {
        const range = a.endPage && a.endPage !== a.pageNumber ? `pages ${a.pageNumber}–${a.endPage}` : `page ${a.pageNumber}`;
        const size = a.tokens ? ` (${formatTokens(a.tokens)})` : '';
        return `Source: ${a.docTitle}, ${range}${size}\n"""\n${a.text}\n"""`;
      })
      .join('\n\n');
    return `[Attached book pages from the learner's own library — treat these as the primary source and cite the page]\n\n${body}`;
  };

  const selectedAttachDoc = attachDocs.find((d) => d.id === attachDocId);

  // ----- send -----
  const send = async (
    text: string,
    opts?: {
      replaceFromIndex?: number;
      /** regenerate: reuse the original turn's attached source instead of the current chips */
      contextNote?: string;
      attachments?: { docTitle: string; pageNumber: number }[];
    },
  ) => {
    const trimmed = text.trim();
    const conv = conversations.find((c) => c.id === activeId) ?? conversations[0];
    if (!trimmed || loading || !conv) return;

    if (!provider) {
      setStatusError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`);
      return;
    }

    // Attach real page text for THIS turn only; a regenerate reuses the turn's own source.
    const contextNote = opts && 'contextNote' in opts
      ? opts.contextNote
      : buildAttachmentContext() || undefined;
    const attachmentLabels = opts && 'attachments' in opts
      ? opts.attachments
      : attachments.length
        ? attachments.map((a) => ({ docTitle: a.docTitle, pageNumber: a.pageNumber }))
        : undefined;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
      ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      contextNote,
      attachments: attachmentLabels,
    };

    // Regeneration path: replace the existing assistant bubble, keeping earlier history.
    const replaceIndex = opts?.replaceFromIndex;
    const historyMessages = replaceIndex !== undefined ? conv.messages.slice(0, replaceIndex) : conv.messages;

    if (replaceIndex !== undefined) {
      const other: ChatMessage = { ...userMsg, id: `u-${Date.now()}-r` };
      updateConversation(conv.id, (c) => ({ ...c, messages: [...historyMessages, other] }));
    } else {
      appendMessage(conv.id, userMsg);
      // auto-title from first exchange
      if (conv.messages.length === 0) {
        // With a question attached, the subtopic is the useful part of the title ("explain" alone says nothing).
        const title = contextQuestion?.subtopic
          ? `${trimmed.slice(0, 24)} · ${contextQuestion.subtopic.slice(0, 40)}`
          : trimmed.slice(0, 40);
        updateConversation(conv.id, (c) => ({ ...c, title: title || 'New clinical chat' }));
      }
    }

    setInput('');
    if (!opts) setAttachments([]);
    setConversationPending(conv.id, true);

    // history for the API: last ~10 non-error turns BEFORE this message, without the
    // just-added user bubble (the server appends the current message itself).
    //
    // IMPORTANT: a turn's attached source is normally replayed so follow-ups can still
    // refer to it. That is fine for a page, but a large attach (a whole chapter or book)
    // would then be re-sent on EVERY later turn — 8 turns x 300k tokens overflows even a
    // 1M window. So a big source is replaced by a short marker: the model still knows an
    // excerpt was supplied, without the transcript ballooning.
    const HISTORY_REPLAY_LIMIT = 8000; // chars (~2k tokens) of attached text worth replaying
    const history = historyMessages
      .filter((m) => !m.isError)
      .slice(-10)
      .map((m) => {
        let note = m.contextNote;
        if (note && note.length > HISTORY_REPLAY_LIMIT) {
          note = `[Earlier turn: a large source excerpt (${formatTokens(estimateTokens(note))}) was attached and is not repeated here.]`;
        }
        return {
          role: m.role,
          content: note ? `${note}\n\n${m.content}` : m.content,
        };
      });

    try {
      const res = await fetch('/api/ai/tutor-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: contextNote ? `${contextNote}\n\n${trimmed}` : trimmed,
          history,
          persona,
          provider,
          model,
          effort,
          exam: currentExam,
          requestImage: imageEnabled,
          contextQuestion: contextQuestion
            ? {
                id: contextQuestion.id,
                subject: contextQuestion.subject,
                subtopic: contextQuestion.subtopic,
                stem: contextQuestion.stem,
                correctOption: contextQuestion.correctOption,
                trapExplanation: contextQuestion.trapExplanation,
              }
            : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const srvError = typeof data?.error === 'string' && data.error.trim()
          ? data.error
          : `AI request failed (HTTP ${res.status}).`;
        const prefix = res.status === 401 ? `${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected. ` : '';
        throw new Error(prefix + srvError);
      }

      const replyRaw = typeof data.reply === 'string' && data.reply.trim()
        ? data.reply
        : 'The AI provider returned an empty response. Try rephrasing your prompt.';

      // The model may end with an `IMAGE_CUE:` line describing a figure that would help.
      // That directive is machine-readable only — it must never reach the learner.
      const cue = extractImageCue(replyRaw);
      // stripImageCue removes the directive; expandDenseParagraph also inserts paragraph
      // breaks when the model returned one dense JSON string with no newlines, so the
      // answer does not render as a single tightly packed block.
      const replyText = expandDenseParagraph(replyRaw);

      const msgId = `a-${Date.now()}`;
      const tutorMsg: ChatMessage = {
        id: msgId,
        role: 'assistant',
        content: replyText,
        ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        reasoningSteps: Array.isArray(data.reasoningSteps) && data.reasoningSteps.length > 0 ? data.reasoningSteps : undefined,
        pearl: typeof data.pearl === 'string' && data.pearl.trim() ? data.pearl : undefined,
        citations: Array.isArray(data.citations) && data.citations.length > 0 ? data.citations : undefined,
        suggestedFollowups: Array.isArray(data.suggestedFollowups) && data.suggestedFollowups.length > 0 ? data.suggestedFollowups : undefined,
        // Only a cue resolves to a figure, and it will already be vision-verified on arrival.
        imageLoading: Boolean(cue) && imageEnabled,
      };

      if (replaceIndex !== undefined) {
        updateConversation(conv.id, (c) => ({
          ...c,
          messages: [...historyMessages, { ...userMsg, id: `u-${Date.now()}-r` }, tutorMsg],
        }));
      } else {
        appendMessage(conv.id, tutorMsg);
      }

      // Resolve the illustration AFTER the text is already on screen: a vision check can
      // take tens of seconds, and the explanation must never wait for it.
      if (cue && imageEnabled) {
        const subjectForSearch = contextQuestion?.subject;
        void resolveExplanationImage(cue, subjectForSearch).then((image) => {
          updateMessage(conv.id, msgId, {
            image,
            imageLoading: false,
            // In the tutor the learner benefits from knowing why no figure appeared.
            imageReason: image ? undefined : 'No verified illustration matched this explanation.',
          });
        });
      }
    } catch (err: any) {
      const message = err?.message || 'AI request failed.';
      appendMessage(conv.id, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: message,
        ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
      });
    } finally {
      setConversationPending(conv.id, false);
    }
  };

  const regenerate = (index: number) => {
    // find the user message that produced this assistant reply
    let userIdx = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx === -1) return;
    send(messages[userIdx].content, {
      replaceFromIndex: userIdx,
      contextNote: messages[userIdx].contextNote,
      attachments: messages[userIdx].attachments,
    });
  };

  const saveAsHighlight = (msg: ChatMessage) => {
    if (msg.isError) return;
    const citation = msg.citations?.length ? msg.citations[0] : undefined;
    addUserHighlight(highlightFromAiReply({
      quote: msg.content.slice(0, 1200),
      subject: contextQuestion?.subject,
      subtopic: contextQuestion?.subtopic,
      citation,
      note: msg.pearl,
    }));
    setSavedHighlightId(msg.id);
    setTimeout(() => setSavedHighlightId(null), 2000);
  };

  const copyMessage = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedMsgId(msg.id);
    setTimeout(() => setCopiedMsgId(null), 1500);
  };

  // ----- conversation list controls -----
  const createConversation = () => {
    const c = newConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const fallback = next.length ? next : [newConversation()];
      if (id === activeId) setActiveId(fallback[0].id);
      return fallback;
    });
  };

  const commitRename = () => {
    if (renamingId) {
      const title = renameText.trim() || 'Untitled chat';
      updateConversation(renamingId, (c) => ({ ...c, title }));
      setRenamingId(null);
    }
  };

  // ----- quick prompts -----
  const quickPrompts = [
 'Explain the trap in this question',
 'Make an Anki cloze from the key fact',
 'Give a 5-question quiz on this topic',
  ];

  const connectedCount = connectedProviders.length;

  // A lesson requested from another screen (for example "Teach me" on the performance review) is sent once, when the tutor opens.
  const seedDone = useRef(false);
  useEffect(() => {
    if (seedDone.current || !activeId || !provider) return;
    const seed = takeTutorSeed();
    seedDone.current = true;
    if (!seed) return;
    rewardForLesson();
    window.setTimeout(() => { void send(seed); }, 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, provider]);

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col max-w-7xl mx-auto w-full px-2">
      {/* Hero band */}
      <div className="relative overflow-hidden mt-2 rounded-[20px] border border-slate-200 bg-gradient-to-br from-teal-50 via-white to-white shadow-sm dark:border-[#1f3a52] dark:from-[#0e2a3a] dark:via-[#0b1f33] dark:to-[#0b1f33]">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10] dark:opacity-[0.12]" />
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 opacity-[0.05] dark:opacity-[0.10] [mask-image:radial-gradient(circle_at_center,transparent_18%,black_115%)] ${reduceMotion ? 'hidden' : ''}`}
        />
        <div className="relative p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-[16px] border border-[#0f8b8d]/40 bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-[#00696b]" />
              </div>
              <div className="min-w-0">
                <div className=" tracking-wide text-[10px] uppercase text-[#00696b] dark:text-teal-300">Clinical AI Tutor</div>
                <h1 className=" text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-tight truncate">Ask anything clinical</h1>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                  {provider && providerMap[provider]?.connected
                    ? `Live · ${provider} · ${model || getEffectiveModel(provider)}`
                    : `No connected provider · ${NOT_CONNECTED_MESSAGE}`}
                </p>
              </div>
            </div>
            <button
              onClick={createConversation}
              className="inline-flex items-center justify-center gap-1.5 rounded-[14px] border border-slate-900/80 dark:border-slate-500 bg-white dark:bg-slate-800 px-3.5 py-2 text-[11px] font-medium text-slate-900 dark:text-white hover:-translate-y-0.5 transition-transform shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> New chat
            </button>
          </div>

          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Persona segmented */}
              <div className="inline-flex rounded-[14px] border border-slate-200 bg-white/80 p-0.5 dark:border-slate-700 dark:bg-slate-900/70">
                {PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPersona(p.id)}
                    title={p.hint}
                    className={`px-2.5 py-1.5 rounded-[11px] text-[10px] font-medium transition-colors ${
                      persona === p.id
                        ? 'bg-[#001432] text-white dark:bg-teal-600'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Provider (only connected ones) */}
              <div className="relative">
                <select
                  value={provider ?? ''}
                  onChange={(e) => handleProviderChange(e.target.value as AiProviderId)}
                  className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-[11px] font-semibold text-slate-800 dark:text-slate-100 rounded-[12px] pl-2.5 pr-7 py-2 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d] disabled:opacity-50"
                  disabled={connectedCount === 0}
                >
                  {connectedCount === 0 && <option value="">No provider connected</option>}
                  {connectedProviders.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {/* Model (editable, persisted per provider) */}
              <input
                value={model || (provider ? getEffectiveModel(provider) : '')}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={!provider}
                list="tutor-model-options"
                placeholder="model id"
                title={model || (provider ? getEffectiveModel(provider) : '')}
                className="w-56 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-[11px] font-mono text-slate-800 dark:text-slate-100 rounded-[12px] px-2 py-2 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d] disabled:opacity-50 placeholder-slate-500"
              />
              <datalist id="tutor-model-options">
                {provider && providerMap[provider]?.connected && (
                  <option value={getEffectiveModel(provider)} />
                )}
              </datalist>
            </div>

            {/* Effort segmented (Min..Ultra), persisted */}
            <div className="inline-flex rounded-[14px] border border-slate-200 bg-white/80 p-0.5 dark:border-slate-700 dark:bg-slate-900/70 shrink-0" title="Reasoning effort (subscription providers)">
              {EFFORT_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => handleEffortChange(level)}
                  className={`px-2.5 py-1.5 rounded-[11px] text-[10px] font-medium transition-colors ${
                    effort === level
                      ? 'bg-[#001432] text-white dark:bg-teal-600'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Context question chip */}
      {contextQuestion && !contextRemoved && (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[20px] bg-amber-50  border border-amber-300  text-xs text-amber-900  min-w-0 transition-transform hover:-">
              <BookOpen className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="font-semibold truncate max-w-[320px] lg:max-w-[480px]">
                Context: {contextQuestion.subtopic} — {contextQuestion.stem.slice(0, 80)}{contextQuestion.stem.length > 80 ? '…' : ''}
              </span>
              <button
                onClick={() => setContextOpen((open) => !open)}
                className="font-bold text-[#00696b] hover:underline shrink-0"
                aria-expanded={contextOpen}
              >
                {contextOpen ? 'Hide' : 'Show full question'}
              </button>
              <button
                onClick={() => setContextRemoved(true)}
                title="Remove attached question from context"
                className="text-amber-700 hover:text-amber-900 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {contextOpen && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-white p-3 text-xs text-slate-800 space-y-2 max-h-56 overflow-y-auto">
              <p className="whitespace-pre-line leading-relaxed">{contextQuestion.stem}</p>
              {contextQuestion.questionText && contextQuestion.questionText !== contextQuestion.stem && (
                <p className="font-semibold">{contextQuestion.questionText}</p>
              )}
              <ol className="space-y-1">
                {contextQuestion.options.map((o) => (
                  <li key={o.id}><span className="font-medium mr-1.5">{o.id}.</span>{o.text}</li>
                ))}
              </ol>
              <p className="text-[10px] text-slate-400">The answer key is not shown here, so the tutor's reasoning is yours to check.</p>
            </div>
          )}
        </div>
      )}

      {/* Main row: conversation list + chat */}
      <div className="flex-1 min-h-0 flex gap-3 mt-2 pb-2">
        {/* Conversation list */}
        <div className="hidden md:flex flex-col w-60 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <button
            onClick={createConversation}
            className="m-3 mb-2 px-3 py-2 rounded-xl bg-[#001432] hover:bg-[#13294b] text-white text-xs font-medium flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> New chat
          </button>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {conversations.map((c, index) => {
              const isActive = c.id === activeConversation?.id;
              return (
                <motion.div
                  key={c.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut", delay: reduceMotion ? 0 : Math.min(index * 0.03, 0.2) }}
                >
                <div
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`group flex items-center justify-between px-3 py-2.5 rounded-[20px] cursor-pointer text-xs transition-all duration-200 border ${
                    isActive
                      ? 'bg-teal-50 border-[#0f8b8d]/30 text-[#00696b]'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:translate-x-1'
                  }`}
                >
                  {renamingId === c.id ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                      className="flex-1 min-w-0 bg-white border border-slate-200 rounded-[8px] px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#0f8b8d]' : 'text-slate-400'}`} />
                        <span className="truncate font-medium">{c.title}</span>
                        <ConversationPendingDot id={c.id} />
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenamingId(c.id); setRenameText(c.title); }}
                          className="p-1 rounded-[8px] hover:bg-slate-200 text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                          title="Rename"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                          className="p-1 rounded-[8px] hover:bg-rose-100 text-slate-500 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-300"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                </motion.div>
              );
            })}
          </div>
          <div className="p-3 border-t border-slate-100 text-[10px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            Chats stored locally on this device
          </div>
        </div>

        {/* Chat column */}
        <div className="flex-1 min-w-0 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm">
          {/* Status error banner */}
          {statusError && (
            <div className="m-3 mb-0 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{statusError}</div>
              <button onClick={() => onNavigate('settings')} className="text-rose-700 hover:text-rose-900 underline shrink-0">
                Settings
              </button>
              <button onClick={() => setStatusError(null)} className="text-rose-500 hover:text-rose-700 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="relative h-full flex flex-col items-center justify-center text-center space-y-3 py-10 overflow-hidden rounded-[20px] border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10] dark:opacity-[0.12]" />
                <div aria-hidden className={`pointer-events-none absolute inset-0 opacity-[0.05] dark:opacity-[0.10] [mask-image:radial-gradient(circle_at_center,transparent_20%,black_120%)] ${reduceMotion ? 'hidden' : ''}`} />
                <div className="relative w-12 h-12 rounded-[16px] bg-teal-50 dark:bg-teal-900/40 border border-[#0f8b8d]/20 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-[#0f8b8d]" />
                </div>
                <h3 className="relative text-xl font-semibold text-slate-900 dark:text-white">Ask anything clinical</h3>
                <p className="relative text-xs text-slate-600 dark:text-slate-300 max-w-sm leading-relaxed">
                  Replies are generated live by your connected provider ({provider ? `currently ${provider}` : 'none connected'})
                  with the last 10 turns of this conversation as context. Attach an exam question with the chip above, attach
                  a real page from your PDF library with the paperclip, or start with a quick prompt below.
                </p>
              </div>
            )}

            {messages.map((msg, index) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`group max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div
                    className={`px-4 py-3 rounded-[20px] text-xs leading-relaxed ${msg.role === 'user'
                      ? 'bg-white border border-slate-200 text-slate-900 rounded-tr-sm'
                      : msg.isError
                        ? 'bg-rose-50 border border-rose-300 text-rose-900 dark:text-rose-100 rounded-tl-sm ring-4 ring-[rgba(255,95,109,0.15)]'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-tl-sm'}`}
                  >
                    {msg.role === 'assistant' && !msg.isError && msg.citations && msg.citations.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-1.5 border-b border-slate-200/70">
                        {msg.citations.map((cite, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600"
                            title="AI-cited reference"
                          >
                            <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                            {cite.slice(0, 60)}{cite.length > 60 ? '…' : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.role === 'user' ? (
                      <div>
                        <div className="whitespace-pre-wrap font-sans">{msg.content}</div>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {msg.attachments.map((a, i) => (
                              <span
                                key={`${a.docTitle}-${a.pageNumber}-${i}`}
                                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-teal-100"
                              >
                                <FileText className="w-2.5 h-2.5" />
                                {a.docTitle} · p.{a.pageNumber}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="font-sans [&_p]:my-2.5">{renderMarkdown(msg.content)}</div>
                    )}

                    {msg.role === 'assistant' && !msg.isError && (msg.image || msg.imageLoading) && (
                      <ExplanationFigure
                        image={msg.image ?? null}
                        loading={msg.imageLoading}
                        reason={msg.imageReason}
                      />
                    )}

                    {msg.isError && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => regenerate(index)}
                          disabled={loading}
                          className="inline-flex items-center gap-1.5 rounded-[12px] border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:-translate-y-0.5 disabled:opacity-40 transition-transform"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Retry
                        </button>
                        <button onClick={() => onNavigate('settings')} className="text-rose-700  hover:text-rose-900 dark:hover:text-white underline font-semibold">
                          Open Settings → AI Subscription Hub
                        </button>
                      </div>
                    )}
                  </div>

                  {/* reasoning steps / pearl from the server (rendered only when present) */}
                  {msg.role === 'assistant' && !msg.isError && msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
                    <div className="w-full p-3 bg-teal-50/60 border border-[#0f8b8d]/20 rounded-xl text-[11px] text-slate-700 space-y-1.5">
                      <div className="font-bold uppercase tracking-wider text-[#0f8b8d] flex items-center gap-1.5">
                        <Layers className="w-3 h-3" /> Reasoning trace
                      </div>
                      {msg.reasoningSteps.map((s, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="font-medium text-slate-800 shrink-0">{s.step}:</span>
                          <span className="leading-relaxed">{s.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' && !msg.isError && msg.pearl && (
                    <div className="w-full p-3 bg-[#001432] text-white rounded-xl text-[11px] flex gap-2">
                      <Brain className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">
                        <span className="font-medium text-amber-400 uppercase tracking-wider mr-1">Board pearl:</span>
                        {msg.pearl}
                      </span>
                    </div>
                  )}

                  {/* per-message actions */}
                  {msg.role === 'assistant' && !msg.isError && (
                    <div className="hidden group-hover:flex items-center gap-1 pt-0.5">
                      <button
                        onClick={() => copyMessage(msg)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                        title="Copy"
                      >
                        {copiedMsgId === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => regenerate(index)}
                        disabled={loading}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-40"
                        title="Regenerate reply"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => saveAsHighlight(msg)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-amber-600"
                        title="Save as highlight"
                      >
                        {savedHighlightId === msg.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}

                  {/* follow-ups (only what the server actually returned) */}
                  {msg.role === 'assistant' && !msg.isError && msg.suggestedFollowups && msg.suggestedFollowups.length > 0 && index === messages.length - 1 && !loading && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {msg.suggestedFollowups.map((f, i) => (
                        <button
                          key={i}
                          onClick={() => send(f)}
                          className="text-[11px] px-3 py-1.5 rounded-full bg-white border border-slate-200  hover:bg-teal-50 text-slate-700"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* typing indicator (streaming not implemented — the reply arrives whole) */}
            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-slate-50 border border-slate-200 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0f8b8d]" />
                  <span className="text-[11px] text-slate-500">
                    Synthesising with {provider ? `${provider} · ${model || getEffectiveModel(provider)}` : 'AI'}…
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts */}
          {messages.length === 0 && !loading && (
            <div className="px-4 pb-2 flex flex-wrap gap-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  disabled={!provider || connectedCount === 0}
                  className="text-[11px] px-3 py-1.5 rounded-[12px] border border-slate-900/70 bg-white text-slate-900 font-medium hover:bg-teal-50 hover:-translate-y-0.5 transition-transform disabled:opacity-40 [clip-path:polygon(0%_15%,8%_0%,20%_12%,32%_0%,45%_10%,58%_0%,72%_10%,86%_0%,100%_14%,92%_30%,100%_48%,90%_62%,100%_80%,84%_92%,70%_84%,56%_100%,42%_88%,28%_100%,14%_88%,0%_100%,8%_78%,0%_60%,10%_44%)]"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Attached book pages + picker */}
          {(attachments.length > 0 || attachOpen) && (
            <div className="px-3 pb-2 space-y-2">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((a) => {
                    const range = a.endPage && a.endPage !== a.pageNumber ? `pp.${a.pageNumber}–${a.endPage}` : `p.${a.pageNumber}`;
                    const big = a.scale === 'large' || a.scale === 'huge';
                    return (
                      <span
                        key={a.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[14px] border text-[10px] transition-transform hover:-translate-y-0.5 ${
                          big
                            ? 'border-amber-300 bg-amber-50 text-amber-800 ring-4 ring-[rgba(255,95,109,0.15)]'
                            : 'border-[#0f8b8d]/30 bg-teal-50 text-[#00696b]'
                        }`}
                        title={a.tokens ? `Approx ${formatTokens(a.tokens)} of context` : undefined}
                      >
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="font-semibold truncate max-w-[220px]">{a.docTitle}</span>
                        <span className="font-mono">{range}</span>
                        {a.tokens ? <span className="font-mono opacity-70">{formatTokens(a.tokens)}</span> : null}
                        <button
                          onClick={() => removeAttachment(a.id)}
                          title="Remove this source from context"
                          className="text-[#0f8b8d] hover:text-rose-600 shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {attachOpen && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-medium text-slate-700 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-[#0f8b8d]" />
                      Attach pages from your PDF library
                    </div>
                    <button
                      onClick={() => setAttachOpen(false)}
                      className="text-slate-400 hover:text-slate-700"
                      title="Close"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {attachDocsBusy ? (
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the local library…
                    </div>
                  ) : attachDocs.length === 0 ? (
                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      No documents in the library yet. The PDF Reader &amp; OCR importer is temporarily hidden, so
                      document attachment is unavailable for now.
                    </div>
                  ) : (
                    <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={attachDocId}
                        onChange={(e) => {
                          setAttachDocId(e.target.value);
                          setAttachPage('1');
                          setAttachEndPage('1');
                          setAttachError(null);
                        }}
                        className="max-w-[300px] flex-1 min-w-[160px] text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                      >
                        {attachDocs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}{d.subject ? ` — ${d.subject}` : ''}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1 text-[11px] text-slate-500">
                        <span>pages</span>
                        <input
                          type="number"
                          min={1}
                          max={selectedAttachDoc?.numPages || undefined}
                          value={attachPage}
                          onChange={(e) => {
                            setAttachPage(e.target.value);
                            // keep the end at/after the start so a range is never inverted
                            const s = Number(e.target.value);
                            if (Number.isFinite(s) && s > Number(attachEndPage || 1)) setAttachEndPage(String(s));
                            setAttachError(null);
                          }}
                          className="w-16 text-[11px] font-mono px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                        />
                        <span>to</span>
                        <input
                          type="number"
                          min={1}
                          max={selectedAttachDoc?.numPages || undefined}
                          value={attachEndPage}
                          onChange={(e) => { setAttachEndPage(e.target.value); setAttachError(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); attachSelectedPage(); } }}
                          className="w-16 text-[11px] font-mono px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                        />
                        <span>of {selectedAttachDoc?.numPages ?? '?'}</span>
                      </div>
                      <button
                        onClick={attachSelectedPage}
                        disabled={attachBusy}
                        className="px-3 py-1.5 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-white text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
                      >
                        {attachBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                        {attachBusy ? 'Attaching…' : 'Attach'}
                      </button>
                      <button
                        onClick={() => { void loadAttachDocs(); }}
                        className="text-[10px] text-slate-500 hover:text-slate-800 underline"
                        title="Re-read the library (after adding a document)"
                      >
                        Refresh
                      </button>
                    </div>

                    {/* Honest size estimate BEFORE sending: the window is 1M tokens, but a
                        big attach still delays the first reply, so say so up front. */}
                    {(() => {
                      const n = Number(attachEndPage) - Number(attachPage) + 1;
                      if (!Number.isFinite(n) || n <= 0) return null;
                      const advice = adviseAttachment('x'.repeat(n * 3_000));
                      return (
                        <div className="text-[10px] text-slate-500 leading-relaxed">
                          <span className="font-mono font-medium text-slate-600">{n}</span> page{n === 1 ? '' : 's'}
                          {' · approx '}
                          <span className="font-mono font-medium text-slate-600">{advice.label}</span>
                          {n > 1 && <span className="opacity-70"> (varies with text density)</span>}
                          {advice.warning && (
                            <span className="block mt-1 text-amber-700">{advice.warning}</span>
                          )}
                        </div>
                      );
                    })()}
                    </>
                  )}

                  {attachProgress && (
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <Loader2 className="w-3 h-3 animate-spin" /> {attachProgress}
                    </div>
                  )}

                  {attachError && (
                    <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-800 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{attachError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sticky composer */}
          <div className="sticky bottom-0 z-10 p-3 border-t border-slate-100  bg-white  flex items-end gap-2 rounded-b-2xl">
            <button
              onClick={() => {
                const next = !imageEnabled;
                setImageEnabled(next);
                setExplanationImagesEnabled(next);
              }}
              title={imageEnabled
                ? 'Illustrations ON — a verified clinical image may be added to explanations. Click to turn off.'
                : 'Illustrations OFF — explanations will be text only. Click to turn on.'}
              aria-pressed={imageEnabled}
              className={`p-2.5 rounded-[14px] border text-xs font-medium flex items-center gap-1.5 shrink-0 transition-transform hover:-translate-y-0.5 ${
                imageEnabled
                  ? 'border-[#0f8b8d]/40 bg-teal-50 text-[#00696b]'
                  : 'bg-slate-50  border-slate-200  text-slate-400   '
              }`}
            >
              <ImageIcon className="w-4 h-4" />
            </button>
            <button
              onClick={toggleVoice}
              disabled={loading}
              title={recording ? 'Stop recording and transcribe' : 'Speak your question (transcribed on this device)'}
              aria-pressed={recording}
              className={`p-2.5 rounded-[14px] border text-xs font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-40 transition-transform hover:-translate-y-0.5 ${
                recording
                  ? 'bg-rose-50  border-rose-300  text-rose-700  animate-pulse'
                  : 'bg-slate-50  border-slate-200  text-slate-500   '
              }`}
            >
              {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={openAttachPanel}
              title="Attach a page from your PDF library as context"
              className={`p-2.5 rounded-[14px] border text-xs font-medium flex items-center gap-1.5 shrink-0 transition-transform hover:-translate-y-0.5 ${
                attachOpen || attachments.length
                  ? 'border-[#0f8b8d]/40 bg-teal-50 text-[#00696b]'
                  : 'bg-slate-50  border-slate-200  text-slate-500   '
              }`}
            >
              <Paperclip className="w-4 h-4" />
              {attachments.length > 0 && <span className=" text-[12px] text-[#00696b]">{attachments.length}</span>}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder={connectedCount === 0
                ? 'Connect an AI provider in Settings to start chatting…'
                : attachments.length > 0
                  ? `Ask about page ${attachments[0].pageNumber} of ${attachments[0].docTitle.slice(0, 40)}… (Enter to send)`
                  : contextQuestion ? 'Ask about the attached question… (Enter to send, Shift+Enter for a new line)' : 'Type a clinical question… (Enter to send, Shift+Enter for a new line)'}
              className="flex-1 resize-none text-xs text-slate-900 px-3.5 py-2.5 rounded-[16px] bg-slate-50 border border-slate-200 focus:outline-none focus:border-[#0f8b8d]/60 focus:ring-4 focus:ring-[rgba(142,197,252,0.15)] placeholder-slate-400 dark:placeholder-[#8B8580]"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim() || connectedCount === 0}
              className="px-4 py-2.5 rounded-[14px] bg-[#0f8b8d] hover:bg-[#00696b] text-white hover:-translate-y-[3px] hover:scale-[1.03] disabled:opacity-40 text-xs font-medium flex items-center gap-2 shrink-0 transition-transform"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </div>
          {voiceStatus && (
            <p className={`mt-1.5 text-[11px] ${recording ? 'text-rose-700' : 'text-slate-500'}`}>{voiceStatus}</p>
          )}
          {contextQuestion && !contextRemoved && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => send(action.prompt)}
                  disabled={loading || connectedCount === 0}
                  className="px-2.5 py-1.5 rounded-full border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:text-[#00696b] hover:border-[#0f8b8d]/40 disabled:opacity-40"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
