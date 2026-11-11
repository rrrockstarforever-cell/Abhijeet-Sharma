import React, { useState, useMemo, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  PieChart,
  Trophy,
  ArrowRight,
  Download,
  AlertTriangle,
  Lightbulb,
  CheckCircle,
  FileCheck,
} from 'lucide-react';
import { AppView, ExamType } from '../types.ts';
import { summarizeAttempts, listAttempts, AttemptRecord } from '../utils/attemptStore.ts';
import { loadActiveTest } from '../utils/sessionStore.ts';
import { Card } from '../components/ui/card.tsx';

interface PerformanceAnalyticsViewProps {
  onNavigate: (view: AppView) => void;
  onLaunchRemediation: (subject: string) => void;
}

interface SubjectRow {
  name: string;
  sub: string;
  solved: number;
  incorrect: number;
  accuracy: number;
  status: 'Mastered' | 'Solid' | 'Steady' | 'Developing' | 'Needs Focus' | 'Red Flag';
  statusColor: string;
  barColor: string;
}

const statusConfig = {
  Mastered: { label: 'Mastered', color: 'bg-teal-50 text-teal-800 border-teal-200', bar: '' },
  Solid: { label: 'Solid', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: '' },
  Steady: { label: 'Steady', color: 'bg-slate-100 text-slate-700 border-slate-200', bar: '' },
  Developing: { label: 'Developing', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: '' },
 'Needs Focus': { label: 'Needs Focus', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: '' },
 'Red Flag': { label: 'Red Flag', color: 'bg-red-50 text-red-700 border-red-200', bar: '' },
};

function getStatus(accuracy: number, solved: number): keyof typeof statusConfig {
  if (solved === 0) return 'Needs Focus';
  if (accuracy >= 85) return 'Mastered';
  if (accuracy >= 75) return 'Solid';
  if (accuracy >= 70) return 'Steady';
  if (accuracy >= 60) return 'Developing';
  if (accuracy >= 50) return 'Needs Focus';
  return 'Red Flag';
}

function getExamDate(exam: ExamType): string | null {
  if (typeof window === 'undefined') return null;
  const key = `exam.date.${exam}`;
  const val = localStorage.getItem(key);
  return val || null;
}

function formatDateForCountdown(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({
  onNavigate,
  onLaunchRemediation,
}) => {
  const reduceMotion = useReducedMotion();

  // Open on the exam the user practised last (the active test), not always NEET-PG, which is
  // often empty and makes the page look blank.
  const [activeCohort, setActiveCohort] = useState<'NEET_PG' | 'INI_CET'>(() => {
    const last = loadActiveTest()?.exam;
    return last === 'INI_CET' || last === 'NEET_PG' ? last : 'NEET_PG';
  });
  const [sortBy, setSortBy] = useState<'lowest' | 'highest' | 'solved'>('lowest');
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [summary, setSummary] = useState<ReturnType<typeof summarizeAttempts>>({
    modules: 0,
    questionsAnswered: 0,
    correct: 0,
    accuracyPercent: null,
    weakSubjects: [],
    lastAttemptAt: null,
  });
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);

  useEffect(() => {
    setSummary(summarizeAttempts());
    setAttempts(listAttempts());
  }, [activeCohort]);

  // Filter attempts for current cohort
  const cohortAttempts = useMemo(() => attempts.filter(a => a.exam === activeCohort), [attempts, activeCohort]);

  // Build subject rows from cohort attempts
  const subjectRows = useMemo((): SubjectRow[] => {
    const agg: Record<string, { total: number; correct: number }> = {};
    for (const a of cohortAttempts) {
      for (const [subject, s] of Object.entries(a.subjects)) {
        const cur = agg[subject] ?? (agg[subject] = { total: 0, correct: 0 });
        cur.total += s.total;
        cur.correct += s.correct;
      }
    }
    return Object.entries(agg)
      .filter(([, s]) => s.total > 0)
      .map(([name, s]) => {
        const solved = s.total;
        const correct = s.correct;
        const incorrect = solved - correct;
        const accuracy = Math.round((correct / solved) * 100);
        const status = getStatus(accuracy, solved);
        const cfg = statusConfig[status];
        // Try to infer a sub-description from subject name
        let sub = '';
        if (name.toLowerCase().includes('biochem')) sub = 'Metabolic Pathways, Inborn Errors, Genetics';
        else if (name.toLowerCase().includes('pharma')) sub = 'Autonomic, Antimicrobial Resistance, Kinetics';
        else if (name.toLowerCase().includes('surgery')) sub = 'General, Polytrauma, Acute Abdomen, Oncology';
        else if (name.toLowerCase().includes('anatomy')) sub = 'Head & Neck, Brachial Plexus, Embryology';
        else if (name.toLowerCase().includes('obstet') || name.toLowerCase().includes('gyn')) sub = 'Labor Complications, CTG, Contraception';
        else if (name.toLowerCase().includes('patholog') || name.toLowerCase().includes('micro')) sub = 'Neoplasia, RPGN Crescents, Bacteriology';
        else if (name.toLowerCase().includes('medicine')) sub = 'Cardiology, Neurology, Nephrology, Endocrine';
        else if (name.toLowerCase().includes('applied basic')) sub = 'Molecular Pathology, Transposons, Receptors';
        else if (name.toLowerCase().includes('systemic')) sub = 'Sepsis, Inotropes, Anti-arrhythmics, ICU';
        else if (name.toLowerCase().includes('surgical special')) sub = 'ATLS, Operative Anatomy, Vascular Staging';
        else if (name.toLowerCase().includes('maternal') || name.toLowerCase().includes('child')) sub = 'Neonatal Sepsis, PPH, Eclampsia, IEM';
        else if (name.toLowerCase().includes('diagnostic') || name.toLowerCase().includes('imag')) sub = 'Silver Stains, IF Patterns, CT Signs';
        else sub = 'Core topics';

        return { name, sub, solved, incorrect, accuracy, status, statusColor: cfg.color, barColor: cfg.bar };
      });
  }, [cohortAttempts]);

  const sortedSubjects = useMemo(() => {
    const arr = [...subjectRows];
    if (sortBy === 'lowest') return arr.sort((a, b) => a.accuracy - b.accuracy);
    if (sortBy === 'highest') return arr.sort((a, b) => b.accuracy - a.accuracy);
    return arr.sort((a, b) => b.solved - a.solved);
  }, [subjectRows, sortBy]);

  const weakSubjects = summary.weakSubjects.filter(w => w.accuracy < 70).slice(0, 5);

  const handleExportPDF = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  const examDate = getExamDate(activeCohort);
  const daysToExam = examDate ? Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000) : null;

  const hasData = summary.questionsAnswered > 0;
  const cohortHasData = cohortAttempts.length > 0;
  const cohortQuestions = cohortAttempts.reduce((sum, a) => sum + a.attempted, 0);
  const cohortCorrect = cohortAttempts.reduce((sum, a) => sum + a.correct, 0);
  const cohortWrong = Math.max(cohortQuestions - cohortCorrect, 0);
  const cohortAccuracy = cohortQuestions > 0 ? Math.round((cohortCorrect / cohortQuestions) * 100) : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 font-['M_PLUS_Rounded_1c'] text-[16px] leading-[1.7]  ">
      {/* Top Header & Cohort Switcher */}
      <div className="relative overflow-hidden rounded-[24px] border   p-5   dark:">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] dark:" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold  ">
              <span>Performance Analytics</span>
              <span>›</span>
              <span className="rounded-full border   px-2 py-0.5 font-[''] text-[11px] uppercase tracking-wider  ">
                Accuracy Matrix
              </span>
            </div>
            <div className="mb-1 inline-flex items-center rounded-lg border   px-2.5 py-1 font-[''] text-sm uppercase tracking-[0.18em]   dark:">
              Training Arc
            </div>
            <h1 className="font-['Cormorant'] text-3xl font-medium leading-tight tracking-tight   md:text-4xl">
              Comprehensive Learning Progress & Accuracy Matrix
            </h1>
            <p className="mt-1 max-w-2xl text-sm  ">
              Cohort-scoped attempts, accuracy bands, and remediation targets from saved practice.
            </p>
          </div>

          {/* Cohort Tabs */}
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border   p-1.5  ">
            <button
              onClick={() => setActiveCohort('NEET_PG')}
              className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                activeCohort === 'NEET_PG'
                  ? 'border    dark:'
                  : 'border border-transparent    '
              }`}
            >
              NEET PG
            </button>
            <button
              onClick={() => setActiveCohort('INI_CET')}
              className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                activeCohort === 'INI_CET'
                  ? 'border    dark:'
                  : 'border border-transparent    '
              }`}
            >
              INI-CET
            </button>
          </div>
        </div>
      </div>

      {/* 4-Stat Metric Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Coverage Velocity */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border   p-4   dark:">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-[0.08] dark:" />
          <div className="relative flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider  ">
            <span>Coverage Velocity</span>
            <span className="rounded-full border   px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal    ">
              From saved attempts
            </span>
          </div>
          <div className="relative mt-4 flex items-baseline gap-1.5">
            <span className="font-[''] text-5xl leading-none tracking-wide  ">
              {cohortHasData ? cohortQuestions.toLocaleString() : '—'}
            </span>
            <span className="text-xs font-semibold  ">
              questions in {activeCohort}
            </span>
          </div>
          <p className="relative mt-2 text-xs  ">
            Saved answers from completed practice modules for the active cohort.
          </p>
          <div className="relative mt-3 border-t-2  pt-2 ">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className={cohortAccuracy !== null ? ' ' : ' '}>
                {cohortAccuracy !== null ? `${cohortAccuracy}% accuracy` : 'No answers marked yet'}
              </span>
              <span className=" ">
                {cohortHasData ? `${cohortCorrect.toLocaleString()} correct` : '—'}
              </span>
            </div>
            {!cohortHasData && (
              <div className="mt-2">
                <p className="text-xs  ">
                  Finish a practice set for {activeCohort} and your results will show here.
                </p>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  mt-2 px-3 py-1.5 text-sm"
                >
                  Start practice
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* Cumulative Accuracy */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border   p-4   dark:">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-[0.08] dark:" />
          <div className="relative flex items-center justify-between text-[11px] font-medium uppercase tracking-wider  ">
            <span>Cumulative Accuracy</span>
            <ShieldCheck className="h-4 w-4  " />
          </div>
          <div className="relative mt-4 flex items-center gap-2">
            <span className="font-[''] text-5xl leading-none tracking-wide  ">
              {cohortAccuracy !== null ? `${cohortAccuracy}%` : '—'}
            </span>
            {cohortAccuracy !== null && cohortAccuracy >= 70 && (
              <span className="rounded-md border   px-2 py-0.5 font-[''] text-xs uppercase tracking-wider   dark:">
                On track
              </span>
            )}
          </div>
          <p className="relative mt-2 text-xs  ">
            {cohortAccuracy !== null
              ? `Based on ${cohortQuestions.toLocaleString()} saved answers for ${activeCohort}`
              : `No saved answers yet for ${activeCohort}. Finish a practice set to see your overall accuracy.`}
          </p>
          {cohortAccuracy === null && (
            <button
              onClick={() => onNavigate('practice')}
              className="  relative mt-2 px-3 py-1.5 text-sm"
            >
              Start practice
            </button>
          )}
          <div className="relative mt-3 flex items-center gap-3 border-t-2  pt-2 text-xs font-semibold ">
            {cohortHasData ? (
              <>
                <span className="flex items-center gap-1  ">
                  <span className="h-2 w-2 rounded-full "></span>
                  <strong className="font-mono">{cohortCorrect.toLocaleString()}</strong> Correct
                </span>
                <span className="flex items-center gap-1  ">
                  <span className="h-2 w-2 rounded-full "></span>
                  <strong className="font-mono">{cohortWrong.toLocaleString()}</strong> Wrong
                </span>
              </>
            ) : (
              <div className="flex w-full flex-wrap items-center gap-2">
                <span className=" ">No answers marked yet for {activeCohort}.</span>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  px-3 py-1.5 text-sm"
                >
                  Practice now
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* Response Partition */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border   p-4   dark:">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-[0.08] dark:" />
          <div className="relative flex items-center justify-between text-[11px] font-medium uppercase tracking-wider  ">
            <span>Response Partition</span>
            <PieChart className="h-4 w-4  " />
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] font-semibold  ">Correct</div>
              <div className="font-[''] text-2xl  ">
                {cohortHasData ? cohortCorrect.toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold  ">Incorrect</div>
              <div className="font-[''] text-2xl ">
                {cohortHasData ? cohortWrong.toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold  ">Skipped</div>
              <div className="font-[''] text-2xl ">—</div>
            </div>
          </div>
          <div className="relative mt-4 flex h-3 w-full overflow-hidden rounded-full border    ">
            {cohortAccuracy !== null && (
              <>
                <div className="h-full " style={{ width: `${cohortAccuracy}%` }} title={`Correct: ${cohortAccuracy}%`}></div>
                <div className="h-full " style={{ width: `${100 - cohortAccuracy}%` }} title={`Incorrect: ${100 - cohortAccuracy}%`}></div>
              </>
            )}
          </div>
          <p className="relative mt-2 text-[11px] font-medium  ">
            Skipped data is not tracked in saved attempts.
          </p>
        </Card>

        {/* Exam Countdown */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border   p-4   dark:">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-[0.08] dark:" />
          <div className="relative flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider  ">
            <span>Exam Countdown</span>
            <span className="rounded-full border   px-2 py-0.5 text-[10px] font-medium tracking-normal  ">
              {activeCohort}
            </span>
          </div>
          <div className="relative mt-4 flex items-baseline gap-2">
            <span className="font-[''] text-5xl leading-none tracking-wide  ">
              {daysToExam !== null && daysToExam > 0 ? `${daysToExam}d` : daysToExam !== null && daysToExam <= 0 ? 'TODAY' : '—'}
            </span>
          </div>
          <p className="relative mt-2 text-xs font-semibold  ">
            {examDate
              ? daysToExam !== null && daysToExam > 0
                ? `${daysToExam} days until ${activeCohort} (${formatDateForCountdown(examDate)})`
                : daysToExam !== null && daysToExam <= 0
                ? `Exam date reached (${formatDateForCountdown(examDate)})`
                : `No exam date set for ${activeCohort}. Add it in Sidebar to see the countdown.`
              : `No exam date set for ${activeCohort}. Add it in Sidebar to see the countdown.`}
          </p>
          <div className="relative mt-3 border-t-2  pt-2 text-xs font-semibold   ">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 " />
              {cohortAccuracy !== null ? `Cohort accuracy: ${cohortAccuracy}%` : 'No answers yet for this cohort'}
            </div>
            {cohortAccuracy === null && (
              <div className="mt-2">
                <p className="text-xs  ">Finish a practice set to see cohort accuracy.</p>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  mt-2 px-3 py-1.5 text-sm"
                >
                  Start practice
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Main Split: Subject Accuracy Table (Left) + Difficulty & Synthesis Insights (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols wide): Specialty & Subject Table */}
        <div className="lg:col-span-2 overflow-hidden rounded-[20px] border   p-5   dark:">
          <div className="flex flex-col gap-3 border-b-2  pb-4 sm:flex-row sm:items-center sm:justify-between ">
            <div>
              <div className="mb-1 inline-flex rounded-md border   px-2 py-0.5 font-[''] text-xs uppercase tracking-[0.16em]   dark:">
                Subject Matrix
              </div>
              <h2 className="font-['Cormorant'] text-2xl font-medium  ">
                Specialty & Subject Accuracy Table
              </h2>
              <p className="text-sm  ">
                Continuous mastery tracking from saved {activeCohort} attempts
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold  ">SORT BY:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="min-h-[44px] rounded-xl border   px-3 py-2 text-xs font-medium  focus:outline-none focus:ring-4 focus:   "
              >
                <option value="lowest">Lowest Accuracy</option>
                <option value="highest">Highest Accuracy</option>
                <option value="solved">Most Solved</option>
              </select>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[15px] leading-6">
              <thead>
                <tr className="border-b-2  text-[11px] font-medium uppercase tracking-wider   ">
                  <th className="px-3 py-2.5">Subject</th>
                  <th className="px-3 py-2.5">Solved / Wrong</th>
                  <th className="px-3 py-2.5">Accuracy Band</th>
                  <th className="px-3 py-2.5">Evaluation</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-[#543828]/10 dark:divide-[#A9A9C4]/20">
                {cohortHasData && sortedSubjects.length > 0 ? (
                  sortedSubjects.map((sub) => (
                    <tr key={sub.name} className="transition-colors  ">
                      <td className="px-3 py-3">
                        <div className="text-sm font-medium  ">{sub.name}</div>
                        <div className="text-[11px] font-medium  ">{sub.sub}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-sm font-medium  ">{sub.solved} Qs</div>
                        <div className="font-mono text-[11px] font-semibold ">
                          {sub.incorrect} Incorrect
                        </div>
                      </td>
                      <td className="min-w-36 px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-3 flex-1 overflow-hidden rounded-full border    ">
                            <div
                              className={`h-full rounded-full ${sub.barColor}`}
                              style={{ width: `${sub.accuracy}%` }}
                            ></div>
                          </div>
                          <span className="w-9 text-right font-mono text-xs font-medium  ">
                            {sub.accuracy}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                            sub.status === 'Red Flag' || sub.status === 'Needs Focus'
                              ? '   '
                              : sub.status === 'Developing'
                              ? '   '
                              : '   '
                          }`}
                        >
                          {sub.status === 'Red Flag' && '● '}
                          {sub.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => onLaunchRemediation(sub.name)}
                          title="Opens the Question Bank filtered to this subject"
                          className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                            sub.accuracy < 65
                              ? '     dark:'
                              : '  hover:brightness-105  dark:'
                          }`}
                        >
                          Remediate
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-8">
                      <div className="mx-auto max-w-md rounded-[20px] border   p-4 text-center   dark:">
                        <div className="font-[''] text-lg uppercase tracking-wider  ">
                          No marked questions yet
                        </div>
                        <p className="mt-1 text-sm  ">
                          You have not finished a practice set for {activeCohort} yet. Finish one to fill this table.
                        </p>
                        <button
                          onClick={() => onNavigate('practice')}
                          className="  mt-3 px-3 py-1.5 text-sm"
                        >
                          Start practice
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (1 Col wide): Weak Subjects & Synthesis Cards */}
        <div className="space-y-4">
          {/* Weak Subjects Card (from summarizeAttempts) */}
          <div className="relative overflow-hidden rounded-[20px] border   p-5   dark:">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-[0.08] dark:" />
            <div className="relative">
              <h3 className="font-['Cormorant'] text-xl font-medium  ">Weak Subjects (All-time Focus Areas)</h3>
              <p className="mb-4 text-xs font-medium  ">
                Subjects with accuracy below 70% (minimum 3 questions)
              </p>

              {weakSubjects.length > 0 ? (
                <div className="space-y-3">
                  {weakSubjects.map((w, idx) => (
                    <div key={`${w.subject}-${idx}`} className="rounded-xl border   p-3  ">
                      <div className="mb-1 flex items-center justify-between text-xs font-medium  ">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full "></span>
                          {w.subject}
                        </span>
                        <span className="font-mono font-medium ">{w.accuracy}%</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full border    ">
                        <div className="h-full rounded-full " style={{ width: `${w.accuracy}%` }}></div>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] font-medium  ">
                        <span>{w.correct} / {w.total} correct</span>
                        <button
                          onClick={() => onLaunchRemediation(w.subject)}
                          title="Opens the Question Bank filtered to this subject"
                          className="text-xs font-medium  hover:underline "
                        >
                          Remediate
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mx-auto max-w-xs rounded-[20px] border   p-4 text-center   dark:">
                  <div className="font-[''] text-lg uppercase tracking-wider  ">
                    {hasData ? 'No weak subjects detected' : 'No practice results yet'}
                  </div>
                  <p className="mt-1 text-sm  ">
                    {hasData
                      ? 'All tracked subjects are at or above 70%. Keep going to stay on track.'
                      : 'You have not finished a practice set yet. Finish one to find weak areas.'}
                  </p>
                  {!hasData && (
                    <button
                      onClick={() => onNavigate('practice')}
                      className="  mt-3 px-3 py-1.5 text-sm"
                    >
                      Start practice
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cognitive Synthesis Insight Callout */}
          <div className="rounded-[20px] border   p-4   dark:">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border    ">
                <Lightbulb className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-['Cormorant'] text-lg font-medium  ">Cognitive Synthesis Insight</h4>
                <p className="mt-1 text-sm leading-relaxed  ">
                  {hasData && weakSubjects.length > 0
                    ? `Your weakest area is ${weakSubjects[0].subject} at ${weakSubjects[0].accuracy}%. Prioritize remediation before the next mock test.`
                    : hasData
                    ? 'All subjects are above 70% accuracy. Maintain consistency across all topics.'
                    : 'No practice results yet. Finish a practice set to get a personal insight.'}
                </p>
                {!hasData && (
                  <button
                    onClick={() => onNavigate('practice')}
                    className="  mt-2 px-3 py-1.5 text-sm"
                  >
                    Start practice
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Mistake Notebook Sync Action Card */}
          <div
            onClick={() => onNavigate('mistakes')}
            className="group flex cursor-pointer items-center justify-between rounded-[20px] border   p-4 transition-all hover:-translate-y-0.5   dark:"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border    transition-transform group-hover:scale-105 ">
                <FileCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium  ">Mistake Notebook Sync</div>
                <div className="text-xs  ">
                  {hasData
                    ? `${summary.questionsAnswered - summary.correct} questions queued for spaced review`
                    : 'No mistakes saved yet. Finish a practice set and wrong answers will appear here.'}
                </div>
                {!hasData && (
                  <button
                    onClick={() => onNavigate('mistakes')}
                    className="  mt-2 px-3 py-1.5 text-sm"
                  >
                    Open mistakes
                  </button>
                )}
              </div>
            </div>
            <ArrowRight className="h-4 w-4  transition-all group-hover:translate-x-1 group-hover:  dark:group-hover:" />
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Completed Modules History (from real attempts) */}
      <div className="overflow-hidden rounded-[20px] border   p-5   dark:">
        <div className="flex flex-col gap-3 border-b-2  pb-3 sm:flex-row sm:items-center sm:justify-between ">
          <div>
            <div className="mb-1 inline-flex rounded-md border   px-2 py-0.5 font-[''] text-xs uppercase tracking-[0.16em]   dark:">
              History
            </div>
            <h3 className="font-['Cormorant'] text-2xl font-medium  ">Recent Completed Modules History</h3>
            <p className="text-sm  ">Log of recently completed mock tests, timed blocks, and tutor sessions</p>
          </div>
          <button
            onClick={handleExportPDF}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border  px-4 py-2 text-sm font-medium  transition-all hover:brightness-105 focus:outline-none focus:ring-4 focus:  dark:"
          >
            <Download className="h-4 w-4" />
            <span>{downloadSuccess ? 'Export ready' : 'Export summary'}</span>
          </button>
        </div>

        <div className="divide-y-2 divide-[#543828]/10 text-sm dark:divide-[#A9A9C4]/20">
          {cohortAttempts.length > 0 ? (
            cohortAttempts.slice(0, 10).map((a, idx) => (
              <motion.div
                key={`${a.id}-${idx}`}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: "easeOut", delay: reduceMotion ? 0 : Math.min(idx * 0.03, 0.2) }}
              >
                <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-mono text-[11px] font-semibold  ">
                      {new Date(a.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium  ">
                      <span>{a.exam}: {a.mode} ({a.total} Qs)</span>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                        a.mode === 'EXAM'
                          ? '   '
                          : '     '
                      }`}>
                        {a.mode}
                      </span>
                    </div>
                    <div className="text-xs  ">
                      {Object.entries(a.subjects)
                        .map(([s, v]) => `${s}: ${v.correct}/${v.total}`)
                        .join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="font-mono text-sm font-medium  ">
                        {a.correct} / {a.attempted}
                      </span>
                      <span className="ml-1.5 font-medium  ">
                        ({a.attempted > 0 ? Math.round((a.correct / a.attempted) * 100) : 0}%)
                      </span>
                    </div>
                    <button
                      onClick={() => onNavigate('test-runner')}
                      className="flex items-center gap-1 text-xs font-medium  hover:underline "
                    >
                      Review Answers →
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="py-8">
              <div className="mx-auto max-w-md rounded-[20px] border   p-4 text-center   dark:">
                <div className="font-[''] text-lg uppercase tracking-wider  ">
                  No completed modules yet
                </div>
                <p className="mt-1 text-sm  ">
                  You have not finished a practice set for {activeCohort} yet. Finish one to start this history.
                </p>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  mt-3 px-3 py-1.5 text-sm"
                >
                  Start practice
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {downloadSuccess && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-xs rounded-[20px] border   p-4 backdrop-blur-[14px]  "
        >
          <div className="font-[''] text-lg uppercase tracking-wider  ">
            Export ready
          </div>
          <p className="mt-1 text-sm  ">
            Saved attempt summary prepared. No PDF download is triggered in this demo.
          </p>
        </div>
      )}
    </div>
  );
};
