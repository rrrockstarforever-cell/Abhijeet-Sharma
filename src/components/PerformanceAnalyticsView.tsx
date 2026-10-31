import React, { useState, useMemo, useEffect } from 'react';
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
  Developing: { label: 'Developing', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-[#f2a541]' },
  'Needs Focus': { label: 'Needs Focus', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-[#f2a541]' },
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
  // Open on the exam the user practised last (the active test), not always NEET-PG, which is
  // often empty and makes the page look blank.
  const [activeCohort, setActiveCohort] = useState<'NEET_PG' | 'INI_CET' | 'AMC_CAT'>(() => {
    const last = loadActiveTest()?.exam;
    return last === 'INI_CET' || last === 'AMC_CAT' || last === 'NEET_PG' ? last : 'NEET_PG';
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
        else if (name.toLowerCase().includes('adult health') && name.toLowerCase().includes('medicine')) sub = 'Cardiology, Pulmonology, eTG Protocols (30%)';
        else if (name.toLowerCase().includes('adult health') && name.toLowerCase().includes('surgery')) sub = 'Acute Abdomen, Trauma, Pre-Op (20%)';
        else if (name.toLowerCase().includes('women') || name.toLowerCase().includes('o&g')) sub = 'Antenatal, Eclampsia, Contraception (12.5%)';
        else if (name.toLowerCase().includes('child') || name.toLowerCase().includes('paediatr')) sub = 'Neonatal Sepsis, Milestones, Aus Schedule (12.5%)';
        else if (name.toLowerCase().includes('mental') || name.toLowerCase().includes('psych')) sub = 'Self-Harm Triage, Psychosis, Mental Health Act (12.5%)';
        else if (name.toLowerCase().includes('population') || name.toLowerCase().includes('ethic')) sub = 'RACGP Preventive, Notification, Legal (12.5%)';
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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header & Cohort Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1">
            <span>Performance Analytics</span>
            <span>›</span>
            <span className="text-[#0f8b8d]">Accuracy & Subject Matrix</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#13294b] tracking-tight">
            Comprehensive Learning Progress & Accuracy Matrix
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Detailed clinical performance across specialties, difficulty tiers, and multi-exam cohorts.
          </p>
        </div>

        {/* Cohort Tabs */}
        <div className="flex items-center p-1 bg-slate-200/80 rounded-lg text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveCohort('NEET_PG')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeCohort === 'NEET_PG'
                ? 'bg-white text-[#13294b] shadow-xs font-bold'
                : 'text-slate-600 hover:text-[#13294b]'
            }`}
          >
            NEET PG
          </button>
          <button
            onClick={() => setActiveCohort('INI_CET')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeCohort === 'INI_CET'
                ? 'bg-white text-[#13294b] shadow-xs font-bold'
                : 'text-slate-600 hover:text-[#13294b]'
            }`}
          >
            INI-CET
          </button>
          <button
            onClick={() => setActiveCohort('AMC_CAT')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeCohort === 'AMC_CAT'
                ? 'bg-white text-[#13294b] shadow-xs font-bold'
                : 'text-slate-600 hover:text-[#13294b]'
            }`}
          >
            AMC CAT MCQ
          </button>
        </div>
      </div>

      {/* 4-Stat Metric Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Coverage Velocity */}
        <div className="bg-white border border-[#e3e7ee] rounded-xl p-4 shadow-xs relative">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            <span>COVERAGE VELOCITY</span>
            <button className="text-slate-400 hover:text-[#0f8b8d] transition-colors" title="Sync">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-[#13294b] font-mono tabular-nums tracking-tight">
              {hasData ? summary.questionsAnswered.toLocaleString() : '—'}
            </span>
            <span className="text-xs text-slate-500 font-medium">questions answered</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-medium pt-2 border-t border-slate-100">
            <span className={hasData ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
              {hasData
                ? `${summary.accuracyPercent}% accuracy`
                : 'No marked questions yet'}
            </span>
            <span className="text-slate-500">
              {hasData ? `${summary.correct.toLocaleString()} correct` : '—'}
            </span>
          </div>
        </div>

        {/* Cumulative Accuracy */}
        <div className="bg-white border border-[#e3e7ee] rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            <span>CUMULATIVE ACCURACY</span>
            <ShieldCheck className="w-4 h-4 text-[#0f8b8d]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#13294b] font-mono tabular-nums tracking-tight">
              {hasData ? `${summary.accuracyPercent}%` : '—'}
            </span>
            {hasData && summary.accuracyPercent !== null && summary.accuracyPercent >= 70 && (
              <span className="text-xs font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                ↗ On track
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {hasData
              ? `Based on ${summary.questionsAnswered.toLocaleString()} real attempts across ${summary.modules} modules`
              : 'Complete practice modules to see cumulative accuracy'}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs font-medium pt-2 border-t border-slate-100">
            {hasData && (
              <>
                <span className="flex items-center gap-1 text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <strong className="font-mono">{summary.correct.toLocaleString()}</strong> Correct
                </span>
                <span className="flex items-center gap-1 text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <strong className="font-mono">
                    {(summary.questionsAnswered - summary.correct).toLocaleString()}
                  </strong> Wrong
                </span>
              </>
            )}
          </div>
        </div>

        {/* Response Partition */}
        <div className="bg-white border border-[#e3e7ee] rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            <span>RESPONSE PARTITION</span>
            <PieChart className="w-4 h-4 text-slate-400" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center mt-1">
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Correct</div>
              <div className="text-base font-bold text-emerald-700 font-mono">
                {hasData ? summary.correct.toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Incorrect</div>
              <div className="text-base font-bold text-red-600 font-mono">
                {hasData ? (summary.questionsAnswered - summary.correct).toLocaleString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Skipped</div>
              <div className="text-base font-bold text-slate-600 font-mono">—</div>
            </div>
          </div>
          {/* Multi-segmented bar */}
          <div className="mt-3 w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
            {hasData && summary.accuracyPercent !== null && (
              <>
                <div className="h-full bg-emerald-500" style={{ width: `${summary.accuracyPercent}%` }} title={`Correct: ${summary.accuracyPercent}%`}></div>
                <div className="h-full bg-red-500" style={{ width: `${100 - summary.accuracyPercent}%` }} title={`Incorrect: ${100 - summary.accuracyPercent}%`}></div>
              </>
            )}
          </div>
        </div>

        {/* National Standing / Exam Date Countdown */}
        <div className="bg-white border border-[#e3e7ee] rounded-xl p-4 shadow-xs bg-linear-to-br from-white to-slate-50/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            <span>EXAM COUNTDOWN</span>
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-teal-100 text-teal-800">
              {activeCohort}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#13294b] font-mono tabular-nums tracking-tight">
              {daysToExam !== null && daysToExam > 0 ? `${daysToExam}d` : daysToExam !== null && daysToExam <= 0 ? 'TODAY' : '—'}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 font-medium mt-1">
            {examDate
              ? daysToExam !== null && daysToExam > 0
                ? `${daysToExam} days until ${activeCohort} (${formatDateForCountdown(examDate)})`
                : daysToExam !== null && daysToExam <= 0
                ? `Exam date reached (${formatDateForCountdown(examDate)})`
                : `Set exam date for ${activeCohort} in Sidebar`
              : `Set exam date for ${activeCohort} in Sidebar`}
          </p>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-xs text-slate-700 font-semibold">
            <Trophy className="w-3.5 h-3.5 text-[#f2a541]" />
            {hasData ? `Accuracy: ${summary.accuracyPercent}%` : 'No data yet'}
          </div>
        </div>
      </div>

      {/* Main Split: Subject Accuracy Table (Left) + Difficulty & Synthesis Insights (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols wide): Specialty & Subject Table */}
        <div className="lg:col-span-2 bg-white border border-[#e3e7ee] rounded-xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
            <div>
              <h2 className="text-base font-bold text-[#13294b]">Specialty & Subject Accuracy Table</h2>
              <p className="text-xs text-slate-500">
                Continuous mastery tracking from real attempts
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">SORT BY:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#0f8b8d]"
              >
                <option value="lowest">Lowest Accuracy</option>
                <option value="highest">Highest Accuracy</option>
                <option value="solved">Most Solved</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs mt-2">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Subject</th>
                  <th className="py-2.5 px-3">Solved / Wrong</th>
                  <th className="py-2.5 px-3">Accuracy Band</th>
                  <th className="py-2.5 px-3">Evaluation</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cohortHasData && sortedSubjects.length > 0 ? (
                  sortedSubjects.map((sub) => (
                    <tr key={sub.name} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-sm text-[#13294b]">{sub.name}</div>
                        <div className="text-[11px] text-slate-500">{sub.sub}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono font-bold text-slate-800">{sub.solved} Qs</div>
                        <div className="text-[11px] text-red-600 font-mono font-medium">
                          {sub.incorrect} Incorrect
                        </div>
                      </td>
                      <td className="py-3 px-3 min-w-36">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${sub.barColor} rounded-full`}
                              style={{ width: `${sub.accuracy}%` }}
                            ></div>
                          </div>
                          <span className="font-mono font-bold text-slate-800 text-xs w-8 text-right">
                            {sub.accuracy}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${sub.statusColor}`}
                        >
                          {sub.status === 'Red Flag' && '● '}
                          {sub.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => onLaunchRemediation(sub.name)}
                          className={`px-3 py-1 rounded-md text-xs font-semibold transition-all shadow-xs ${
                            sub.accuracy < 65
                              ? 'bg-[#d64545] hover:bg-red-700 text-white'
                              : 'bg-[#0f8b8d] hover:bg-[#00696b] text-white'
                          }`}
                        >
                          Remediate
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 text-sm">
                      No marked questions yet for {activeCohort}
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
          <div className="bg-white border border-[#e3e7ee] rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-bold text-[#13294b]">Weak Subjects (Focus Areas)</h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Subjects with accuracy below 70% (minimum 3 questions)
            </p>

            {weakSubjects.length > 0 ? (
              <div className="space-y-3">
                {weakSubjects.map((w, idx) => (
                  <div key={`${w.subject}-${idx}`}>
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#d64545]"></span>
                        {w.subject}
                      </span>
                      <span className="font-mono text-red-600 font-bold">{w.accuracy}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#d64545] rounded-full" style={{ width: `${w.accuracy}%` }}></div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span>{w.correct} / {w.total} correct</span>
                      <button
                        onClick={() => onLaunchRemediation(w.subject)}
                        className="text-xs font-semibold text-[#d64545] hover:underline"
                      >
                        Remediate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm">
                {hasData ? 'No weak subjects detected (all ≥ 70%)' : 'Complete practice modules to identify weak areas'}
              </div>
            )}
          </div>

          {/* Cognitive Synthesis Insight Callout */}
          <div className="bg-[#f8f9ff] border border-[#e3e7ee] rounded-xl p-4 shadow-xs">
            <div className="flex items-start gap-2.5">
              <Lightbulb className="w-4 h-4 text-[#0f8b8d] shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-[#13294b]">Cognitive Synthesis Insight</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {hasData && weakSubjects.length > 0
                    ? `Your weakest area is <strong>${weakSubjects[0].subject}</strong> at ${weakSubjects[0].accuracy}%. Prioritize remediation before the next mock test.`
                    : hasData
                    ? 'All subjects are above 70% accuracy. Maintain consistency across all topics.'
                    : 'Complete practice modules to generate personalized insights.'}
                </p>
              </div>
            </div>
          </div>

          {/* Mistake Notebook Sync Action Card */}
          <div
            onClick={() => onNavigate('mistakes')}
            className="p-4 rounded-xl bg-white border border-[#e3e7ee] hover:border-[#0f8b8d] shadow-xs cursor-pointer transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-[#0f8b8d] group-hover:scale-105 transition-transform">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#13294b]">Mistake Notebook Sync</div>
                <div className="text-[11px] text-slate-500">
                  {hasData
                    ? `${summary.questionsAnswered - summary.correct} questions queued for spaced review`
                    : 'No mistakes recorded yet'}
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#0f8b8d] group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Completed Modules History (from real attempts) */}
      <div className="bg-white border border-[#e3e7ee] rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-[#13294b]">Recent Completed Modules History</h3>
            <p className="text-xs text-slate-500">Log of recently completed mock tests, timed blocks, and tutor sessions</p>
          </div>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>{downloadSuccess ? 'Report Downloaded!' : 'Export Report (PDF)'}</span>
          </button>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          {cohortAttempts.length > 0 ? (
            cohortAttempts.slice(0, 10).map((a, idx) => (
              <div key={`${a.id}-${idx}`} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {new Date(a.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="font-bold text-sm text-[#13294b] flex items-center gap-2">
                    <span>{a.exam}: {a.mode} ({a.total} Qs)</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      a.mode === 'EXAM' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-800'
                    }`}>
                      {a.mode}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {Object.entries(a.subjects)
                      .map(([s, v]) => `${s}: ${v.correct}/${v.total}`)
                      .join(', ')}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="font-mono font-bold text-sm text-[#13294b]">
                      {a.correct} / {a.attempted}
                    </span>
                    <span className="ml-1.5 font-bold text-emerald-700">
                      ({a.attempted > 0 ? Math.round((a.correct / a.attempted) * 100) : 0}%)
                    </span>
                  </div>
                  <button
                    onClick={() => onNavigate('test-runner')}
                    className="text-xs font-semibold text-[#0f8b8d] hover:underline flex items-center gap-1"
                  >
                    Review Answers →
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-slate-500 text-sm">
              No completed modules for {activeCohort} yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
};