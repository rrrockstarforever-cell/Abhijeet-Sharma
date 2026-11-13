import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Info, Search, Sparkles, Target } from 'lucide-react';
import type { AppView, ExamType } from '../types.ts';
import { SUBTOPICS } from '../data/subtopics.ts';
import { TOPIC_IMPORTANCE } from '../data/topicImportance.ts';
import { toAppSubject } from '../data/subjectAliases.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';
import {
  getDoneTopics,
  getSyllabusProgress,
  setSubjectTopicsDone,
  setTopicDone,
} from '../utils/syllabusStore.ts';
import type { SyllabusSubjectProgress } from '../utils/syllabusStore.ts';

interface HighYieldTopic {
  topic: string;
  unit: string;
  percent: number;
  verified: boolean;
}

interface SubjectRow {
  progress: SyllabusSubjectProgress;
  topics: string[];
}

const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function examMatchesRow(rowExam: string, exam: ExamType): boolean {
  const value = typeof rowExam === 'string' ? rowExam.toLowerCase() : '';
  if (exam === 'NEET_PG') return value.includes('neet');
  return value.includes('ini');
}

export const SyllabusTrackerView: React.FC<{ exam: ExamType; onNavigate: (v: AppView) => void }> = ({
  exam,
  onNavigate,
}) => {
  const [progress, setProgress] = useState<SyllabusSubjectProgress[]>(() => getSyllabusProgress(exam));
  const [doneMap, setDoneMap] = useState<Record<string, string[]>>(() => getDoneTopics(exam));
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const refresh = useCallback(() => {
    setProgress(getSyllabusProgress(exam));
    setDoneMap(getDoneTopics(exam));
  }, [exam]);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeDataChanged(refresh);
    return unsubscribe;
  }, [refresh]);

  useEffect(() => {
    setExpanded({});
    setQuery('');
  }, [exam]);

  const doneSets = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const [subject, topics] of Object.entries(doneMap)) {
      result[subject] = new Set(topics);
    }
    return result;
  }, [doneMap]);

  const overall = useMemo(() => {
    let done = 0;
    let total = 0;
    let weightSum = 0;
    let weightedDone = 0;
    for (const entry of progress) {
      done += entry.done;
      total += entry.total;
      if (entry.weightPercent > 0 && entry.total > 0) {
        weightSum += entry.weightPercent;
        weightedDone += entry.weightPercent * (entry.done / entry.total);
      }
    }
    return {
      done,
      total,
      percent: total > 0 ? (done / total) * 100 : 0,
      weightedPercent: weightSum > 0 ? (weightedDone / weightSum) * 100 : null,
    };
  }, [progress]);

  const sortedProgress = useMemo(() => {
    return [...progress].sort((a, b) => {
      if (b.weightPercent !== a.weightPercent) return b.weightPercent - a.weightPercent;
      const aCompletion = a.total > 0 ? a.done / a.total : 0;
      const bCompletion = b.total > 0 ? b.done / b.total : 0;
      if (aCompletion !== bCompletion) return aCompletion - bCompletion;
      return a.subject.localeCompare(b.subject);
    });
  }, [progress]);

  const highYieldBySubject = useMemo(() => {
    const collected = new Map<string, HighYieldTopic[]>();
    for (const row of TOPIC_IMPORTANCE) {
      if (
        typeof row.topic !== 'string' ||
        typeof row.subject !== 'string' ||
        typeof row.exam !== 'string'
      ) {
        continue;
      }
      if (row.topic.trim().toLowerCase().startsWith('subject total')) continue;
      if (!examMatchesRow(row.exam, exam)) continue;
      const subject = toAppSubject(row.subject);
      if (!subject || !(subject in SUBTOPICS)) continue;
      const percent = typeof row.percent === 'number' && Number.isFinite(row.percent) ? row.percent : 0;
      const list = collected.get(subject) ?? [];
      list.push({
        topic: row.topic,
        unit: typeof row.unit === 'string' ? row.unit : '',
        percent,
        verified: row.verified === true,
      });
      collected.set(subject, list);
    }
    const result = new Map<string, HighYieldTopic[]>();
    for (const [subject, list] of collected) {
      list.sort((a, b) => {
        if (b.percent !== a.percent) return b.percent - a.percent;
        return a.topic.localeCompare(b.topic);
      });
      result.set(subject, list.slice(0, 5));
    }
    return result;
  }, [exam]);

  const normalizedQuery = query.trim().toLowerCase();

  const visibleSubjects = useMemo<SubjectRow[]>(() => {
    return sortedProgress
      .map((entry) => {
        const allTopics = SUBTOPICS[entry.subject] ?? [];
        if (!normalizedQuery) return { progress: entry, topics: allTopics };
        const subjectMatches = entry.subject.toLowerCase().includes(normalizedQuery);
        const topics = subjectMatches
          ? allTopics
          : allTopics.filter((topic) => topic.toLowerCase().includes(normalizedQuery));
        return { progress: entry, topics };
      })
      .filter((row) => row.topics.length > 0);
  }, [sortedProgress, normalizedQuery]);

  const handleToggleTopic = useCallback(
    (subject: string, topic: string, checked: boolean) => {
      setTopicDone(exam, subject, topic, checked);
      refresh();
    },
    [exam, refresh],
  );

  const handleMarkAll = useCallback(
    (subject: string) => {
      setSubjectTopicsDone(exam, subject, SUBTOPICS[subject] ?? [], true);
      refresh();
    },
    [exam, refresh],
  );

  const handleClear = useCallback(
    (subject: string) => {
      const confirmed =
        typeof window === 'undefined' || typeof window.confirm !== 'function'
          ? true
          : window.confirm(`Clear all covered topics for ${subject}?`);
      if (!confirmed) return;
      setSubjectTopicsDone(exam, subject, SUBTOPICS[subject] ?? [], false);
      refresh();
    },
    [exam, refresh],
  );

  const toggleExpanded = useCallback((subject: string) => {
    setExpanded((prev) => ({ ...prev, [subject]: !prev[subject] }));
  }, []);

  const examLabel = exam === 'NEET_PG' ? 'NEET PG' : 'INI-CET';
  const ringPercent = Math.max(0, Math.min(100, overall.percent));
  const ringDash = (ringPercent / 100) * RING_CIRCUMFERENCE;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex shrink-0 justify-center">
            <svg
              width="132"
              height="132"
              viewBox="0 0 120 120"
              role="img"
              aria-label={`Overall syllabus coverage ${Math.round(overall.percent)} percent`}
              className="text-slate-800 dark:text-slate-100"
              style={{ filter: 'drop-shadow(3px 3px 0 rgba(15,139,141,0.25))' }}
            >
              <circle
                cx="60"
                cy="60"
                r={RING_RADIUS}
                fill="none"
                stroke="#0f8b8d"
                strokeWidth="13"
                opacity="0.15"
              />
              <circle
                cx="60"
                cy="60"
                r={RING_RADIUS}
                fill="none"
                stroke="#0f8b8d"
                strokeWidth="13"
                strokeLinecap="round"
                strokeDasharray={`${ringDash} ${RING_CIRCUMFERENCE}`}
                transform="rotate(-90 60 60)"
              />
              <circle
                cx="60"
                cy="60"
                r={RING_RADIUS - 9}
                fill="#0f8b8d"
                fillOpacity="0.08"
                stroke="#0f8b8d"
                strokeOpacity="0.25"
                strokeWidth="2.5"
              />
              <text
                x="60"
                y="58"
                textAnchor="middle"
                fontSize="24"
                fontWeight="900"
                fill="currentColor"
              >
                {Math.round(overall.percent)}%
              </text>
              <text
                x="60"
                y="76"
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="currentColor"
                opacity="0.7"
              >
                COVERED
              </text>
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[#0f8b8d]/30 bg-[#0f8b8d]/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#0f8b8d]">
                {examLabel}
              </span>
              <h2 className="text-xl font-medium tracking-tight text-slate-800 sm:text-2xl">
                Syllabus coverage
              </h2>
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Tick off topics as you finish them. Everything is stored on this device and is included
              in your sync backup.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                <Target size={14} />
                {overall.done} / {overall.total} topics
              </span>
              {overall.weightedPercent !== null ? (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                  Weighted coverage ~{formatPercent(overall.weightedPercent)}%
                </span>
              ) : (
                <span className="text-xs font-medium text-slate-500">
                  No exam-weight data available yet.
                </span>
              )}
            </div>
            <div className="mt-4">
              <label htmlFor="syllabus-search" className="sr-only">
                Search subjects and topics
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 opacity-70"
                />
                <input
                  id="syllabus-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search subjects and topics…"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold text-slate-800 shadow-sm placeholder:text-slate-400 placeholder:opacity-50 focus:border-[#0f8b8d] focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/40"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {visibleSubjects.length === 0 ? (
        <div className="rounded-[20px] border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-600">
            {normalizedQuery
              ? `No subjects or topics match “${query.trim()}”.`
              : 'No syllabus topics found in this build.'}
          </p>
          {normalizedQuery ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4">
          {visibleSubjects.map(({ progress: entry, topics }) => {
            const subject = entry.subject;
            const subjectDone = doneSets[subject];
            const completion = entry.total > 0 ? (entry.done / entry.total) * 100 : 0;
            const isOpen = normalizedQuery.length > 0 || expanded[subject] === true;
            const panelId = `syllabus-panel-${slugify(subject)}`;
            const highYield = highYieldBySubject.get(subject) ?? [];

            return (
              <article
                key={subject}
                className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(subject)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="block w-full p-4 text-left text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2"
                >
                  <span className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium text-slate-900">
                          {subject}
                        </span>
                        {entry.weightPercent > 0 ? (
                          <span className="rounded-md border border-[#0f8b8d]/30 bg-[#0f8b8d]/10 px-2 py-0.5 text-[11px] font-medium text-[#0f8b8d]">
                            ~{formatPercent(entry.weightPercent)}% of exam
                          </span>
                        ) : (
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 opacity-70">
                            weight n/a
                          </span>
                        )}
                      </span>
                      <span
                        className="mt-2 block h-3 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full rounded-full bg-[#0f8b8d] transition-[width] duration-300 motion-reduce:transition-none"
                          style={{ width: `${completion}%` }}
                        />
                      </span>
                      <span className="mt-1.5 flex items-center justify-between gap-3 text-xs font-medium text-slate-600">
                        <span>
                          {entry.done} / {entry.total} topics done
                        </span>
                        <span>{Math.round(completion)}%</span>
                      </span>
                    </span>
                    <span className="mt-1 shrink-0 text-slate-400">
                      {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </span>
                  </span>
                </button>

                {isOpen ? (
                  <div id={panelId} className="border-t border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleMarkAll(subject)}
                        className="rounded-lg border border-[#0f8b8d] bg-[#0f8b8d] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#00696b]"
                      >
                        Mark all
                      </button>
                      <button
                        type="button"
                        onClick={() => handleClear(subject)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate('practice')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#0f8b8d]/40 bg-[#0f8b8d]/10 px-3 py-1.5 text-xs font-medium text-[#0f8b8d] hover:bg-[#0f8b8d]/20"
                      >
                        Practice this subject
                        <ArrowRight size={14} />
                      </button>
                    </div>

                    <section className="mt-4">
                      <h4 className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                        <Sparkles size={15} className="text-[#0f8b8d]" />
                        High-yield topics
                      </h4>
                      {highYield.length > 0 ? (
                        <ul className="mt-2 space-y-1.5">
                          {highYield.map((item, index) => (
                            <li
                              key={`${item.topic}-${item.unit}-${index}`}
                              className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700"
                            >
                              <span className="min-w-0 flex-1">{item.topic}</span>
                              <span className="rounded-md border border-[#0f8b8d]/30 bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#0f8b8d]">
                                ~{formatPercent(item.percent)}%
                              </span>
                              {!item.verified ? (
                                <span className="rounded-md border border-dashed border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 opacity-80">
                                  estimate
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          No topic-level importance data for this subject yet.
                        </p>
                      )}
                    </section>

                    <section className="mt-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-medium text-slate-800">Topics</h4>
                        <span className="text-xs font-medium text-slate-500">
                          {topics.length} shown
                        </span>
                      </div>
                      {topics.length === 0 ? (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          No topics match your search in this subject.
                        </p>
                      ) : (
                        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                          {topics.map((topic) => {
                            const checked = subjectDone?.has(topic) ?? false;
                            return (
                              <li key={topic}>
                                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-200 hover:bg-white motion-reduce:transition-none">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) =>
                                      handleToggleTopic(subject, topic, event.target.checked)
                                    }
                                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#0f8b8d]"
                                  />
                                  <span className={checked ? 'opacity-60 line-through' : ''}>
                                    {topic}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-500">
        <Info size={16} className="mt-0.5 shrink-0 text-[#0f8b8d]" />
        <p className="text-xs font-semibold leading-relaxed text-slate-600">
          Importance percentages come from recalled-question analysis and are approximate. Treat them
          as a study guide, not a prediction of exactly what your exam will contain.
        </p>
      </div>
    </div>
  );
};
