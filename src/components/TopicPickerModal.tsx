import React, { useMemo, useState } from 'react';
import { X, Check } from 'lucide-react';

export interface TopicPickerModalProps {
  /** Subject / domain the topics belong to (shown in the header). */
  subject: string;
  topics: string[];
  /** Already-chosen topics for this subject; empty means "all topics". */
  selected: string[];
  /** Is this subject ticked in the module? Unticked subjects open on "Choose" with nothing ticked. */
  subjectPicked?: boolean;
  onApply: (topics: string[], mode: 'ALL' | 'CHOOSE') => void;
  onClose: () => void;
}

/**
 * Marrow-style topic picker: "Select topics for {subject}" with an All / Choose radio,
 * a scrollable checkbox list and a single Done button.
 * `ALL` is kept as an explicit mode so a subject does not store a 40-item array just
 * because the learner wanted everything.
 */
export const TopicPickerModal: React.FC<TopicPickerModalProps> = ({
  subject,
  topics,
  selected,
  subjectPicked = true,
  onApply,
  onClose,
}) => {
  // Only a subject that is already part of the module defaults to "All". A subject the
  // learner has not picked yet opens on "Choose" with nothing ticked, so opening the
  // picker never silently selects anything.
  const initiallyAll = subjectPicked && (selected.length === 0 || selected.length === topics.length);
  const [mode, setMode] = useState<'ALL' | 'CHOOSE'>(initiallyAll ? 'ALL' : 'CHOOSE');
  const [chosen, setChosen] = useState<string[]>(
    initiallyAll ? [...topics] : subjectPicked ? topics.filter((t) => selected.includes(t)) : [],
  );

  const allChecked = useMemo(() => chosen.length === topics.length, [chosen, topics]);

  const toggle = (topic: string) => {
    setMode('CHOOSE');
    setChosen((prev) => (prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]));
  };

  const pickAll = () => {
    setMode('ALL');
    setChosen([...topics]);
  };

  const pickNone = () => {
    setMode('CHOOSE');
    setChosen([]);
  };

  const done = () => {
    if (mode === 'ALL' || chosen.length === topics.length) {
      onApply([], 'ALL');
    } else {
      onApply(chosen, 'CHOOSE');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Select topics for ${subject}`}
        className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col max-h-[80vh]"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <h2 className="text-base font-bold text-slate-900 leading-snug">
            Select topics for {subject.toLowerCase()}
          </h2>
          <button
            onClick={onClose}
            className="p-1 -mt-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-3 flex items-center gap-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="topic-mode"
              checked={mode === 'ALL'}
              onChange={pickAll}
              className="h-4 w-4 accent-[#0f8b8d]"
            />
            <span className="text-xs font-semibold text-slate-700">All</span>
            <span className="text-[10px] text-slate-400">({topics.length})</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="topic-mode"
              checked={mode === 'CHOOSE'}
              onChange={() => setMode('CHOOSE')}
              className="h-4 w-4 accent-[#0f8b8d]"
            />
            <span className="text-xs font-semibold text-slate-700">Choose</span>
            {mode === 'CHOOSE' && chosen.length > 0 && (
              <span className="text-[10px] text-[#0f8b8d] font-bold">({chosen.length})</span>
            )}
          </label>
          {mode === 'CHOOSE' && (
            <button
              onClick={mode === 'CHOOSE' && allChecked ? pickNone : pickAll}
              className="ml-auto text-[10px] font-bold text-[#0f8b8d] hover:underline"
            >
              {mode === 'CHOOSE' && allChecked ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>

        <div className="mx-5 mb-4 rounded-lg border border-slate-200 overflow-y-auto">
          {topics.length === 0 && (
            <p className="p-4 text-xs text-slate-500">No topics are defined for this subject yet.</p>
          )}
          {topics.map((topic) => {
            const checked = mode === 'ALL' ? true : chosen.includes(topic);
            return (
              <label
                key={topic}
                className="flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer"
              >
                <span
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
                    checked ? 'bg-[#0f8b8d] border-[#0f8b8d]' : 'bg-white border-slate-300'
                  }`}
                >
                  {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggle(topic)}
                />
                <span className="text-xs text-slate-800 leading-snug">{topic}</span>
              </label>
            );
          })}
        </div>

        <div className="px-5 pb-5 flex items-center justify-between gap-3">
          <p className="text-[10px] text-slate-500 leading-snug">
            {mode === 'ALL'
              ? 'Every topic for this subject is included.'
              : chosen.length === 0
                ? 'Nothing chosen — this subject will be left out.'
                : `${chosen.length} of ${topics.length} topics included.`}
          </p>
          <button
            onClick={done}
            className="px-6 py-2 rounded-lg bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold transition-colors shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default TopicPickerModal;
