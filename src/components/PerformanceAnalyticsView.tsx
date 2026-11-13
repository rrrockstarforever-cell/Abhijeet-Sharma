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
  Mastered: { label: 'Mastered', color: 'bg-teal-50 text-teal-800 border-teal-200', bar: 'bg-[#0f8b8d]' },
  Solid: { label: 'Solid', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-[#1f9d55]' },
  Steady: { label: 'Steady', color: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-[#0f8b8d]' },
  Developing: { label: 'Developing', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400' },
  'Needs Focus': { label: 'Needs Focus', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400' },
  'Red Flag': { label: 'Red Flag', color: 'bg-red-50 text-red-700 border-red-200', bar: 'bg-[#d64545]' },
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
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-[16px] leading-[1.7] text-slate-900 dark:text-slate-100">
      {/* Top Header & Cohort Switcher */}
      <div className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
        <div className="pointer-events-none absolute inset-0  [background-size:8px_8px] opacity-[0.08] " />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <span>Performance Analytics</span>
              <span>›</span>
              <span className="rounded-full border-2 border-slate-200 bg-teal-50 px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-900 dark:border-slate-700">
                Accuracy Matrix
              </span>
            </div>
            <div className="mb-1 inline-flex items-center rounded-lg border border-slate-200 bg-amber-100 px-2.5 py-1 text-sm uppercase tracking-[0.18em] text-slate-900 shadow-sm dark:border-slate-700 shadow-sm">
              Training Arc
            </div>
            <h1 className=" text-3xl font-medium leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">
              Comprehensive Learning Progress & Accuracy Matrix
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Cohort-scoped attempts, accuracy bands, and remediation targets from saved practice.
            </p>
          </div>

          {/* Cohort Tabs */}
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 p-1.5 dark:border-slate-600 dark:bg-[#0a1220]">
            <button
              onClick={() => setActiveCohort('NEET_PG')}
              className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                activeCohort === 'NEET_PG'
                              ? 'border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm dark:border-slate-700 shadow-sm'
                  : 'border border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              NEET PG
            </button>
            <button
              onClick={() => setActiveCohort('INI_CET')}
              className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-medium uppercase tracking-wider transition-all ${
                activeCohort === 'INI_CET'
                              ? 'border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm dark:border-slate-700 shadow-sm'
                  : 'border border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
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
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16  [background-size:8px_8px] opacity-[0.08] " />
          <div className="relative flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <span>Coverage Velocity</span>
            <span className="rounded-full border-2 border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-600 dark:border-slate-600 dark:bg-[#0a1220] dark:text-slate-100">
              From saved attempts
            </span>
          </div>
          <div className="relative mt-4 flex items-baseline gap-1.5">
            <span className=" text-5xl leading-none tracking-wide text-slate-900 dark:text-slate-100">
              {cohortHasData ? cohortQuestions.toLocaleString() : '—'}
            </span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              questions in {activeCohort}
            </span>
          </div>
          <p className="relative mt-2 text-xs text-slate-600 dark:text-slate-300">
            Saved answers from completed practice modules for the active cohort.
          </p>
          <div className="relative mt-3 border-t-2 border-slate-200 pt-2 dark:border-slate-700">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className={cohortAccuracy !== null ? 'text-[#1f9d55] dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>
                {cohortAccuracy !== null ? `${cohortAccuracy}% accuracy` : 'No answers marked yet'}
              </span>
            <span className="text-slate-600 dark:text-slate-300">
                {cohortHasData ? `${cohortCorrect.toLocaleString()} correct` : '—'}
              </span>
            </div>
            {!cohortHasData && (
              <div className="mt-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                  Finish a practice set for {activeCohort} and your results will show here.
                </p>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
                >
                  Start practice
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* Cumulative Accuracy */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16  [background-size:8px_8px] opacity-[0.08] " />
          <div className="relative flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <span>Cumulative Accuracy</span>
            <ShieldCheck className="h-4 w-4 text-[#0f8b8d] dark:text-teal-300" />
          </div>
          <div className="relative mt-4 flex items-center gap-2">
            <span className=" text-5xl leading-none tracking-wide text-slate-900 dark:text-slate-100">
              {cohortAccuracy !== null ? `${cohortAccuracy}%` : '—'}
            </span>
            {cohortAccuracy !== null && cohortAccuracy >= 70 && (
              <span className="rounded-md border border-slate-200 bg-teal-50 px-2 py-0.5 text-xs uppercase tracking-wider text-slate-900 shadow-sm dark:border-slate-700 shadow-sm">
                On track
              </span>
            )}
          </div>
          <p className="relative mt-2 text-xs text-slate-600 dark:text-slate-300">
            {cohortAccuracy !== null
              ? `Based on ${cohortQuestions.toLocaleString()} saved answers for ${activeCohort}`
              : `No saved answers yet for ${activeCohort}. Finish a practice set to see your overall accuracy.`}
          </p>
          {cohortAccuracy === null && (
            <button
              onClick={() => onNavigate('practice')}
              className="  relative mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
            >
              Start practice
            </button>
          )}
          <div className="relative mt-3 flex items-center gap-3 border-t-2 border-slate-200 pt-2 text-xs font-semibold dark:border-slate-700">
            {cohortHasData ? (
              <>
                <span className="flex items-center gap-1 text-slate-900 dark:text-slate-100">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  <strong className="font-mono">{cohortCorrect.toLocaleString()}</strong> Correct
                </span>
                <span className="flex items-center gap-1 text-slate-900 dark:text-slate-100">
                  <span className="h-2 w-2 rounded-full bg-rose-100"></span>
                  <strong className="font-mono">{cohortWrong.toLocaleString()}</strong> Wrong
                </span>
              </>
            ) : (
              <div className="flex w-full flex-wrap items-center gap-2">
                <span className="text-slate-600 dark:text-slate-300">No answers marked yet for {activeCohort}.</span>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
                >
                  Practice now
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* Response Partition */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16  [background-size:8px_8px] opacity-[0.08] " />
          <div className="relative flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <span>Response Partition</span>
            <PieChart className="h-4 w-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Correct</div>
              <div className=" text-2xl text-[#1f9d55] dark:text-emerald-400">
                {cohortHasData ? cohortCorrect.toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Incorrect</div>
              <div className=" text-2xl text-rose-600">
                {cohortHasData ? cohortWrong.toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Skipped</div>
              <div className=" text-2xl text-amber-600">—</div>
            </div>
          </div>
          <div className="relative mt-4 flex h-3 w-full overflow-hidden rounded-full border-2 border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-[#0a1220]">
            {cohortAccuracy !== null && (
              <>
                <div className="h-full bg-emerald-500" style={{ width: `${cohortAccuracy}%` }} title={`Correct: ${cohortAccuracy}%`}></div>
                <div className="h-full bg-rose-100" style={{ width: `${100 - cohortAccuracy}%` }} title={`Incorrect: ${100 - cohortAccuracy}%`}></div>
              </>
            )}
          </div>
          <p className="relative mt-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
            Skipped data is not tracked in saved attempts.
          </p>
        </Card>

        {/* Exam Countdown */}
        <Card className="relative min-h-[190px] overflow-hidden rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16  [background-size:8px_8px] opacity-[0.08] " />
          <div className="relative flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <span>Exam Countdown</span>
            <span className="rounded-full border-2 border-slate-200 bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-900 dark:border-slate-700">
              {activeCohort}
            </span>
          </div>
          <div className="relative mt-4 flex items-baseline gap-2">
            <span className=" text-5xl leading-none tracking-wide text-slate-900 dark:text-slate-100">
              {daysToExam !== null && daysToExam > 0 ? `${daysToExam}d` : daysToExam !== null && daysToExam <= 0 ? 'TODAY' : '—'}
            </span>
          </div>
          <p className="relative mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {examDate
              ? daysToExam !== null && daysToExam > 0
                ? `${daysToExam} days until ${activeCohort} (${formatDateForCountdown(examDate)})`
                : daysToExam !== null && daysToExam <= 0
                ? `Exam date reached (${formatDateForCountdown(examDate)})`
                : `No exam date set for ${activeCohort}. Add it in Sidebar to see the countdown.`
              : `No exam date set for ${activeCohort}. Add it in Sidebar to see the countdown.`}
          </p>
          <div className="relative mt-3 border-t-2 border-slate-200 pt-2 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-amber-600" />
              {cohortAccuracy !== null ? `Cohort accuracy: ${cohortAccuracy}%` : 'No answers yet for this cohort'}
            </div>
            {cohortAccuracy === null && (
              <div className="mt-2">
                <p className="text-xs text-slate-600 dark:text-slate-300">Finish a practice set to see cohort accuracy.</p>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
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
        <div className="lg:col-span-2 overflow-hidden rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
          <div className="flex flex-col gap-3 border-b-2 border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
            <div>
              <div className="mb-1 inline-flex rounded-md border border-slate-200 bg-teal-50 px-2 py-0.5 text-xs uppercase tracking-[0.16em] text-slate-900 shadow-sm dark:border-slate-700 shadow-sm">
                Subject Matrix
              </div>
              <h2 className=" text-2xl font-medium text-slate-900 dark:text-slate-100">
                Specialty & Subject Accuracy Table
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Continuous mastery tracking from saved {activeCohort} attempts
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600 dark:text-slate-300">SORT BY:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-4 focus:ring-[#8EC5FC]/30 dark:border-slate-600 dark:bg-[#0a1220] dark:text-slate-100"
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
                <tr className="border-b-2 border-slate-200/30 text-[11px] font-medium uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:text-slate-300">
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
                    <tr key={sub.name} className="transition-colors hover:bg-slate-100/80 dark:hover:bg-[#090F12]/60">
                      <td className="px-3 py-3">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{sub.name}</div>
                        <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{sub.sub}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{sub.solved} Qs</div>
                        <div className="font-mono text-[11px] font-semibold text-rose-600">
                          {sub.incorrect} Incorrect
                        </div>
                      </td>
                      <td className="min-w-36 px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-slate-200 bg-slate-100 dark:border-slate-600 dark:bg-[#0a1220]">
                            <div
                              className={`h-full rounded-full ${sub.barColor}`}
                              style={{ width: `${sub.accuracy}%` }}
                            ></div>
                          </div>
                          <span className="w-9 text-right font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                            {sub.accuracy}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-md border-2 px-2 py-0.5 text-[11px] font-medium ${
                            sub.status === 'Red Flag' || sub.status === 'Needs Focus'
                              ? 'border-[#FF5F6D] bg-rose-100/15 text-rose-600 dark:text-rose-600'
                              : sub.status === 'Developing'
                              ? 'border-[#D4982B] bg-amber-100/20 text-[#8a5a00] dark:text-[#FFB703]'
                              : 'border-[#1f9d55] bg-emerald-500/15 text-[#1f9d55] dark:text-emerald-400'
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
                              ? 'border-slate-200 bg-rose-100 text-slate-900 shadow-sm hover:bg-rose-200 dark:border-slate-700 shadow-sm'
                              : 'border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm'
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
                      <div className="mx-auto max-w-md rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm text-center">
                        <div className=" text-lg uppercase tracking-wider text-slate-900 dark:text-slate-100">
                          No marked questions yet
                        </div>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          You have not finished a practice set for {activeCohort} yet. Finish one to fill this table.
                        </p>
                        <button
                          onClick={() => onNavigate('practice')}
                          className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
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
          <div className="relative overflow-hidden rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-16  [background-size:8px_8px] opacity-[0.08] " />
            <div className="relative">
              <h3 className=" text-xl font-medium text-slate-900 dark:text-slate-100">Weak Subjects (All-time Focus Areas)</h3>
              <p className="mb-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                Subjects with accuracy below 70% (minimum 3 questions)
              </p>

              {weakSubjects.length > 0 ? (
                <div className="space-y-3">
                  {weakSubjects.map((w, idx) => (
                    <div key={`${w.subject}-${idx}`} className="rounded-xl border-2 border-slate-200 bg-slate-100/70 p-3 dark:border-slate-700 dark:bg-[#0a1220]/50">
                      <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-900 dark:text-slate-100">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-rose-100"></span>
                          {w.subject}
                        </span>
                        <span className="font-mono font-medium text-rose-600">{w.accuracy}%</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full border-2 border-slate-200 bg-white dark:border-slate-600 dark:bg-[#0f1a2b]">
                      <div className="h-full rounded-full bg-rose-100" style={{ width: `${w.accuracy}%` }}></div>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        <span>{w.correct} / {w.total} correct</span>
                        <button
                          onClick={() => onLaunchRemediation(w.subject)}
                          title="Opens the Question Bank filtered to this subject"
                          className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-600"
                        >
                          Remediate
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mx-auto max-w-xs rounded-[20px] border border-slate-200 bg-white p-4 text-center shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
                  <div className=" text-lg uppercase tracking-wider text-slate-900 dark:text-slate-100">
                    {hasData ? 'No weak subjects detected' : 'No practice results yet'}
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {hasData
                      ? 'All tracked subjects are at or above 70%. Keep going to stay on track.'
                      : 'You have not finished a practice set yet. Finish one to find weak areas.'}
                  </p>
                  {!hasData && (
                    <button
                      onClick={() => onNavigate('practice')}
                      className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
                    >
                      Start practice
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cognitive Synthesis Insight Callout */}
          <div className="rounded-[20px] border border-slate-200 bg-slate-100 p-4 shadow-sm dark:border-slate-600 dark:bg-[#0a1220] shadow-sm">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-slate-200 bg-amber-100 text-slate-900 dark:border-slate-700">
                <Lightbulb className="h-4 w-4" />
              </div>
              <div>
                <h4 className=" text-lg font-medium text-slate-900 dark:text-slate-100">Cognitive Synthesis Insight</h4>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {hasData && weakSubjects.length > 0
                    ? `Your weakest area is ${weakSubjects[0].subject} at ${weakSubjects[0].accuracy}%. Prioritize remediation before the next mock test.`
                    : hasData
                    ? 'All subjects are above 70% accuracy. Maintain consistency across all topics.'
                    : 'No practice results yet. Finish a practice set to get a personal insight.'}
                </p>
                {!hasData && (
                  <button
                    onClick={() => onNavigate('practice')}
                    className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
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
            className="group flex cursor-pointer items-center justify-between rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-slate-200 bg-teal-50 text-slate-900 transition-transform group-hover:scale-105 dark:border-slate-700">
                <FileCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Mistake Notebook Sync</div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {hasData
                    ? `${summary.questionsAnswered - summary.correct} questions queued for spaced review`
                    : 'No mistakes saved yet. Finish a practice set and wrong answers will appear here.'}
                </div>
                {!hasData && (
                  <button
                    onClick={() => onNavigate('mistakes')}
                    className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
                  >
                    Open mistakes
                  </button>
                )}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-600 transition-all group-hover:translate-x-1 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-[#EEEEED]" />
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Completed Modules History (from real attempts) */}
      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm">
        <div className="flex flex-col gap-3 border-b-2 border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
          <div>
            <div className="mb-1 inline-flex rounded-md border border-slate-200 bg-teal-50 px-2 py-0.5 text-xs uppercase tracking-[0.16em] text-slate-900 shadow-sm dark:border-slate-700 shadow-sm">
              History
            </div>
            <h3 className=" text-2xl font-medium text-slate-900 dark:text-slate-100">Recent Completed Modules History</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">Log of recently completed mock tests, timed blocks, and tutor sessions</p>
          </div>
          <button
            onClick={handleExportPDF}
            className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-[#0f8b8d] px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition-all hover:brightness-105 focus:outline-none focus:ring-4 focus:ring-[#8EC5FC]/30 dark:border-slate-700 shadow-sm"
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
                    <div className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {new Date(a.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                      <span>{a.exam}: {a.mode} ({a.total} Qs)</span>
                      <span className={`rounded-md border-2 px-2 py-0.5 text-[10px] font-medium ${
                        a.mode === 'EXAM'
                              ? 'border-[#0f8b8d] bg-teal-50/20 text-[#0f8b8d] dark:text-teal-300'
                          : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-[#0a1220] dark:text-slate-300'
                      }`}>
                        {a.mode}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {Object.entries(a.subjects)
                        .map(([s, v]) => `${s}: ${v.correct}/${v.total}`)
                        .join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                        {a.correct} / {a.attempted}
                      </span>
                      <span className="ml-1.5 font-medium text-[#1f9d55] dark:text-emerald-400">
                        ({a.attempted > 0 ? Math.round((a.correct / a.attempted) * 100) : 0}%)
                      </span>
                    </div>
                    <button
                      onClick={() => onNavigate('test-runner')}
                      className="flex items-center gap-1 text-xs font-medium text-[#0f8b8d] hover:underline dark:text-teal-300"
                    >
                      Review Answers →
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="py-8">
              <div className="mx-auto max-w-md rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-[#0f1a2b] shadow-sm text-center">
                <div className=" text-lg uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  No completed modules yet
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  You have not finished a practice set for {activeCohort} yet. Finish one to start this history.
                </p>
                <button
                  onClick={() => onNavigate('practice')}
                  className="  mt-2 px-3 py-1.5 text-sm border border-slate-200 bg-[#0f8b8d] text-slate-900 shadow-sm hover:brightness-105 dark:border-slate-700 shadow-sm"
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
          className="fixed bottom-6 right-6 z-50 max-w-xs rounded-[20px] border border-slate-200 bg-white/95 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur-[14px] dark:border-slate-600 dark:bg-[#0f1a2b]/95"
        >
          <div className=" text-lg uppercase tracking-wider text-slate-900 dark:text-slate-100">
            Export ready
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Saved attempt summary prepared. No PDF download is triggered in this demo.
          </p>
        </div>
      )}
    </div>
  );
};
