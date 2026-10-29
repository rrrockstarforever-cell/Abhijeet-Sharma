// Capture a question from any mock test (PARITY section 8):
// paste a screenshot with Ctrl+V (or choose an image), OCR it with tesseract.js,
// then "Structure with AI" turns the raw text into a real question. Everything is
// editable before saving. Errors are shown; nothing is silently faked.
import React, { useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste, ImagePlus, Loader2, Sparkles, AlertCircle, CheckCircle2, X, ScanText, Save, Trash2,
} from 'lucide-react';
import type { ClinicalQuestion, ExamType } from '../types.ts';
import { aiComplete, extractJson, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from '../lib/ai.ts';
import { addCapturedQuestion } from '../utils/mistakeStore.ts';
import { ocrImage } from '../utils/ocr.ts';
import { startJob, stopJob, type JobControl } from '../utils/jobRegistry.ts';

interface QuestionCaptureModalProps {
  exam: ExamType;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

interface StructuredDraft {
  stem: string;
  questionText: string;
  options: { id: 'A' | 'B' | 'C' | 'D' | 'E'; text: string }[];
  correctOption: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation: string;
  subject: string;
  subtopic: string;
  boardPearl: string;
  citations: string[];
}

const EMPTY_DRAFT: StructuredDraft = {
  stem: '',
  questionText: '',
  options: [
    { id: 'A', text: '' },
    { id: 'B', text: '' },
    { id: 'C', text: '' },
    { id: 'D', text: '' },
  ],
  correctOption: 'A',
  explanation: '',
  subject: '',
  subtopic: '',
  boardPearl: '',
  citations: [],
};

export const QuestionCaptureModal: React.FC<QuestionCaptureModalProps> = ({ exam, onClose, onSaved }) => {
  const [image, setImage] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [structBusy, setStructBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StructuredDraft>(EMPTY_DRAFT);
  const [source, setSource] = useState('');
  const [topic, setTopic] = useState('');
  const [markedCorrect, setMarkedCorrect] = useState<boolean>(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<JobControl | null>(null);

  // Ctrl+V anywhere in the modal pastes a screenshot
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            setImage(typeof reader.result === 'string' ? reader.result : null);
            setOcrText('');
            setOcrConfidence(null);
            setError(null);
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          return;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Closing the modal while OCR is running must cancel the job (the banner would
  // otherwise show a task with no owner).
  useEffect(() => () => {
    if (jobRef.current) stopJob(jobRef.current.id);
  }, []);

  const pickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(typeof reader.result === 'string' ? reader.result : null);
      setOcrText('');
      setOcrConfidence(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const runOcr = async () => {
    if (!image || ocrBusy) return;
    setOcrBusy(true);
    setError(null);
    const job = startJob('Mistake screenshot OCR', 'Preparing tesseract.js…');
    jobRef.current = job;
    try {
      const result = await ocrImage(image, (p) => {
        job.update({
          progress: Math.round(p.progress * 100),
          detail: `${p.status} · ${Math.round(p.progress * 100)}%`,
        });
        if (job.isCancelled()) throw new Error('OCR stopped by the user.');
      });
      if (job.isCancelled()) throw new Error('OCR stopped by the user.');
      if (!result.text.trim()) throw new Error('No readable text was found in the screenshot.');
      setOcrText(result.text);
      setOcrConfidence(result.confidence);
      job.done(`Recognised ${result.text.length} characters`);
    } catch (err: any) {
      const message = err?.message || 'OCR failed.';
      setError(message);
      job.fail(message);
    } finally {
      setOcrBusy(false);
    }
  };

  const structureWithAi = async () => {
    const provider = getActiveProvider();
    if (!provider) { setError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`); return; }
    const text = ocrText.trim();
    if (!text) { setError('Run OCR or paste the question text first.'); return; }
    setStructBusy(true);
    setError(null);
    try {
      const raw = await aiComplete({
        system:
          'You convert raw OCR text from a medical exam question into structured JSON. ' +
          'Never invent clinical content that is not present in the text; leave fields empty when unclear. ' +
          'Respond with ONLY a JSON object, no markdown.',
        messages: [{
          role: 'user',
          content:
            `Exam: ${exam.replace('_', '-')}\n\nRaw text:\n"""\n${text.slice(0, 8000)}\n"""\n\n` +
            'Return exactly: {"stem":"vignette / scenario","questionText":"the actual question sentence",' +
            '"options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],' +
            '"correctOption":"A","explanation":"why the answer is correct and the main distractor is wrong",' +
            '"subject":"discipline","subtopic":"topic","boardPearl":"one-line pearl","citations":["source if present"]}',
        }],
        json: true,
        provider,
        model: getEffectiveModel(provider),
      });
      const parsed = extractJson<any>(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('The AI response was not valid JSON. Try again.');

      const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
      const options = rawOptions
        .map((o: any, i: number) => {
          const id = (typeof o?.id === 'string' ? o.id : String.fromCharCode(65 + i)).toUpperCase();
          const text = typeof o?.text === 'string' ? o.text.trim() : '';
          return ['A', 'B', 'C', 'D', 'E'].includes(id) && text ? { id: id as StructuredDraft['correctOption'], text } : null;
        })
        .filter(Boolean)
        .slice(0, 5) as StructuredDraft['options'];

      if (options.length < 2) throw new Error('The AI could not find at least two answer options. Edit the OCR text or fill the fields manually.');

      const correct = String(parsed.correctOption || 'A').trim().toUpperCase();
      setDraft({
        stem: typeof parsed.stem === 'string' ? parsed.stem.trim() : '',
        questionText: typeof parsed.questionText === 'string' ? parsed.questionText.trim() : '',
        options,
        correctOption: (options.some((o) => o.id === correct) ? correct : options[0].id) as StructuredDraft['correctOption'],
        explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
        subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
        subtopic: typeof parsed.subtopic === 'string' ? parsed.subtopic.trim() : '',
        boardPearl: typeof parsed.boardPearl === 'string' ? parsed.boardPearl.trim() : '',
        citations: Array.isArray(parsed.citations)
          ? parsed.citations.filter((c: any) => typeof c === 'string' && c.trim()).slice(0, 4)
          : [],
      });
    } catch (err: any) {
      setError(err?.message || 'Could not structure the question.');
    } finally {
      setStructBusy(false);
    }
  };

  const updateOption = (id: string, text: string) => {
    setDraft((d) => ({ ...d, options: d.options.map((o) => (o.id === id ? { ...o, text } : o)) }));
  };

  const save = () => {
    if (savedId) return;
    if (!draft.stem.trim() || !draft.questionText.trim()) {
      setError('The question needs a stem and a question sentence.');
      return;
    }
    const cleaned = draft.options.filter((o) => o.text.trim());
    if (cleaned.length < 2) {
      setError('Add at least two answer options.');
      return;
    }
    const correct = cleaned.some((o) => o.id === draft.correctOption) ? draft.correctOption : cleaned[0].id;
    const id = `CAP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const question: ClinicalQuestion = {
      id,
      examType: exam,
      subject: draft.subject.trim() || 'General Medicine',
      subtopic: draft.subtopic.trim() || topic.trim() || 'Captured question',
      cognitiveTier: 'Clinical 2-Step',
      difficultyTier: 'MEDIUM',
      stem: draft.stem.trim(),
      questionText: draft.questionText.trim(),
      options: cleaned,
      correctOption: correct,
      selectedOption: markedCorrect ? correct : undefined,
      boardPearl: draft.boardPearl.trim(),
      citations: draft.citations.length ? draft.citations : draft.explanation ? ['AI-structured capture — verify against the original source'] : [],
      targetAccuracy: 60,
      isRemediated: false,
      timesFailed: 1,
    };

    try {
      addCapturedQuestion({
        id,
        source: source.trim() || 'Captured from a mock test',
        ocrText: ocrText.trim() || undefined,
        imageDataUrl: image ?? undefined,
        status: markedCorrect ? 'remediated' : 'unresolved',
        markedCorrect,
        explanation: draft.explanation.trim() || undefined,
        topic: topic.trim() || draft.subtopic.trim() || undefined,
        question,
      });
      setSavedId(id);
      onSaved?.(id);
    } catch (err: any) {
      setError(err?.message || 'Could not save the captured question.');
    }
  };

  const providerLabel = getActiveProvider()
    ? `${getActiveProvider()} · ${getEffectiveModel(getActiveProvider()!)}`
    : 'no active provider';

  const field = 'w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full my-6 p-5 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4 text-[#0f8b8d]" /> Capture a question
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Paste a screenshot with <strong>Ctrl+V</strong> (or choose an image), OCR it, then structure it with your active AI.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>

        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] rounded-xl flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-3 h-3" /></button>
          </div>
        )}
        {savedId && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved to the Mistake Notebook as {savedId}.
            <button onClick={onClose} className="ml-auto font-bold underline">Close</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Screenshot + OCR */}
          <div className="space-y-2">
            <div
              onDrop={(e) => { e.preventDefault(); pickImage(e.dataTransfer.files?.[0] ?? null); }}
              onDragOver={(e) => e.preventDefault()}
              className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 min-h-36 flex flex-col items-center justify-center p-3 text-center"
            >
              {image ? (
                <div className="space-y-2 w-full">
                  <img src={image} alt="Pasted question screenshot" className="max-h-56 w-full object-contain rounded-lg border border-slate-200 bg-white" />
                  <button
                    onClick={() => { setImage(null); setOcrText(''); setOcrConfidence(null); }}
                    className="text-[10px] text-slate-500 hover:text-rose-600 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Remove image
                  </button>
                </div>
              ) : (
                <>
                  <ClipboardPaste className="w-6 h-6 text-slate-300 mb-1" />
                  <p className="text-[11px] text-slate-600 font-semibold">Paste a screenshot (Ctrl+V)</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">or drop an image here / choose a file</p>
                  <button onClick={() => fileRef.current?.click()} className="mt-2 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-700 flex items-center gap-1">
                    <ImagePlus className="w-3 h-3" /> Choose image
                  </button>
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickImage(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={runOcr}
                disabled={!image || ocrBusy}
                className="flex-1 py-1.5 rounded-lg bg-[#001432] text-white text-[10px] font-bold disabled:opacity-40 flex items-center justify-center gap-1"
              >
                {ocrBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanText className="w-3 h-3 text-[#8ff3f4]" />}
                {ocrBusy ? 'Recognising…' : 'Run OCR'}
              </button>
              <button
                onClick={structureWithAi}
                disabled={!ocrText.trim() || structBusy}
                className="flex-1 py-1.5 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-white text-[10px] font-bold disabled:opacity-40 flex items-center justify-center gap-1"
              >
                {structBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Structure with AI
              </button>
            </div>
            <div className="text-[9px] font-mono text-slate-400 text-right">{providerLabel}</div>

            <label className="text-[10px] font-bold text-slate-600 block">OCR text (editable)</label>
            <textarea
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              rows={6}
              placeholder="Paste the question text here if you prefer not to use OCR…"
              className={`${field} resize-y`}
            />
            {ocrConfidence !== null && (
              <div className="text-[9px] text-slate-500 font-mono">tesseract confidence: {Math.round(ocrConfidence)}%</div>
            )}
          </div>

          {/* Structured fields */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Source / test</label>
                <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. AMC CAT mock 3" className={field} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Subject</label>
                <input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} placeholder="e.g. Cardiology" className={field} />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Topic</label>
              <input value={draft.subtopic} onChange={(e) => setDraft((d) => ({ ...d, subtopic: e.target.value }))} placeholder="e.g. Acute coronary syndrome" className={field} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Stem</label>
              <textarea value={draft.stem} onChange={(e) => setDraft((d) => ({ ...d, stem: e.target.value }))} rows={3} className={`${field} resize-y`} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Question</label>
              <input value={draft.questionText} onChange={(e) => setDraft((d) => ({ ...d, questionText: e.target.value }))} className={field} />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-600 block">Options (select the correct one)</label>
              {draft.options.map((o) => (
                <div key={o.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => setDraft((d) => ({ ...d, correctOption: o.id }))}
                    className={`w-6 h-6 rounded-full text-[10px] font-bold shrink-0 ${
                      draft.correctOption === o.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                    title="Mark as correct answer"
                  >
                    {o.id}
                  </button>
                  <input value={o.text} onChange={(e) => updateOption(o.id, e.target.value)} className={`${field} flex-1`} placeholder={`Option ${o.id}`} />
                </div>
              ))}
              {draft.options.length < 5 && (
                <button
                  onClick={() => setDraft((d) => ({ ...d, options: [...d.options, { id: 'E', text: '' }] }))}
                  className="text-[10px] font-semibold text-[#0f8b8d] underline"
                >
                  + Add option E
                </button>
              )}
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Explanation (optional)</label>
              <textarea value={draft.explanation} onChange={(e) => setDraft((d) => ({ ...d, explanation: e.target.value }))} rows={3} className={`${field} resize-y`} />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] font-bold text-slate-600">In the source test I got this:</span>
              <button
                onClick={() => setMarkedCorrect(false)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${!markedCorrect ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
              >
                Incorrect
              </button>
              <button
                onClick={() => setMarkedCorrect(true)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${markedCorrect ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
              >
                Correct
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-[10px] text-slate-400">Saved locally — no question banks or screenshots leave this machine.</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 rounded-lg hover:bg-slate-100">Cancel</button>
            <button
              onClick={save}
              disabled={!!savedId}
              className="px-3 py-1.5 text-[11px] font-bold bg-[#001432] hover:bg-[#13294b] text-white rounded-lg flex items-center gap-1.5 disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5 text-[#8ff3f4]" /> Save to notebook
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
