import React, { useState } from 'react';
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

interface PerformanceAnalyticsViewProps {
  onNavigate: (view: AppView) => void;
  onLaunchRemediation: (subject: string) => void;
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({
  onNavigate,
  onLaunchRemediation,
}) => {
  const [activeCohort, setActiveCohort] = useState<'NEET_PG' | 'INI_CET' | 'AMC_CAT'>('NEET_PG');
  const [sortBy, setSortBy] = useState<'lowest' | 'highest' | 'solved'>('lowest');
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const getCohortSubjects = () => {
    if (activeCohort === 'AMC_CAT') {
      return [
        {
          name: 'Adult Health – Medicine',
          sub: 'Cardiology, Pulmonology, eTG Protocols (30%)',
          solved: 1350,
          incorrect: 320,
          accuracy: 76,
          status: 'Solid',
          statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          barColor: 'bg-[#1f9d55]',
        },
        {
          name: 'Adult Health – Surgery',
          sub: 'Acute Abdomen, Trauma, Pre-Op (20%)',
          solved: 920,
          incorrect: 240,
          accuracy: 73,
          status: 'Steady',
          statusColor: 'bg-slate-100 text-slate-700 border-slate-200',
          barColor: 'bg-[#0f8b8d]',
        },
        {
          name: "Women's Health (O&G)",
          sub: 'Antenatal, Eclampsia, Contraception (12.5%)',
          solved: 580,
          incorrect: 180,
          accuracy: 69,
          status: 'Needs Focus',
          statusColor: 'bg-amber-50 text-amber-700 border-amber-200',
          barColor: 'bg-[#f2a541]',
        },
        {
          name: 'Child Health (Paediatrics)',
          sub: 'Neonatal Sepsis, Milestones, Aus Schedule (12.5%)',
          solved: 540,
          incorrect: 130,
          accuracy: 76,
          status: 'Solid',
          statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          barColor: 'bg-[#1f9d55]',
        },
        {
          name: 'Mental Health (Psychiatry)',
          sub: 'Self-Harm Triage, Psychosis, Mental Health Act (12.5%)',
          solved: 490,
          incorrect: 98,
          accuracy: 80,
          status: 'Mastered',
          statusColor: 'bg-teal-50 text-teal-800 border-teal-200',
          barColor: 'bg-[#0f8b8d]',
        },
        {
          name: 'Population Health & Ethics',
          sub: 'RACGP Preventive, Notification, Legal (12.5%)',
          solved: 480,
          incorrect: 110,
          accuracy: 77,
          status: 'Solid',
          statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          barColor: 'bg-[#1f9d55]',
        },
      ];
    }

    if (activeCohort === 'INI_CET') {
      return [
        {
          name: 'Applied Basic Sciences & Genetics',
          sub: 'Molecular Pathology, Transposons, Receptors',
          solved: 720,
          incorrect: 270,
          accuracy: 62,
          status: 'Needs Focus',
          statusColor: 'bg-amber-50 text-amber-700 border-amber-200',
          barColor: 'bg-[#f2a541]',
        },
        {
          name: 'Systemic Therapeutics & Critical Care',
          sub: 'Sepsis, Inotropes, Anti-arrhythmics, ICU',
          solved: 1140,
          incorrect: 280,
          accuracy: 75,
          status: 'Solid',
          statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          barColor: 'bg-[#1f9d55]',
        },
        {
          name: 'Surgical Specialties & Trauma',
          sub: 'ATLS, Operative Anatomy, Vascular Staging',
          solved: 840,
          incorrect: 220,
          accuracy: 74,
          status: 'Steady',
          statusColor: 'bg-slate-100 text-slate-700 border-slate-200',
          barColor: 'bg-[#0f8b8d]',
        },
        {
          name: 'Maternal & Child Health',
          sub: 'Neonatal Sepsis, PPH, Eclampsia, IEM',
          solved: 680,
          incorrect: 150,
          accuracy: 78,
          status: 'Solid',
          statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          barColor: 'bg-[#1f9d55]',
        },
        {
          name: 'Diagnostic Sciences & Imaging',
          sub: 'Silver Stains, IF Patterns, CT Signs',
          solved: 620,
          incorrect: 190,
          accuracy: 69,
          status: 'Developing',
          statusColor: 'bg-amber-50 text-amber-700 border-amber-200',
          barColor: 'bg-[#f2a541]',
        },
      ];
    }

    // Default: NEET_PG 19 NMC Disciplines
    return [
      {
        name: 'Biochemistry',
        sub: 'Metabolic Pathways, Inborn Errors, Genetics',
        solved: 510,
        incorrect: 214,
        accuracy: 58,
        status: 'Red Flag',
        statusColor: 'bg-red-50 text-red-700 border-red-200',
        barColor: 'bg-[#d64545]',
      },
      {
        name: 'Pharmacology',
        sub: 'Autonomic, Antimicrobial Resistance, Kinetics',
        solved: 608,
        incorrect: 218,
        accuracy: 64,
        status: 'Needs Focus',
        statusColor: 'bg-amber-50 text-amber-700 border-amber-200',
        barColor: 'bg-[#f2a541]',
      },
      {
        name: 'General Surgery',
        sub: 'General, Polytrauma, Acute Abdomen, Oncology',
        solved: 838,
        incorrect: 243,
        accuracy: 71,
        status: 'Developing',
        statusColor: 'bg-slate-100 text-slate-700 border-slate-200',
        barColor: 'bg-[#0f8b8d]',
      },
      {
        name: 'Anatomy',
        sub: 'Head & Neck, Brachial Plexus, Embryology',
        solved: 620,
        incorrect: 155,
        accuracy: 75,
        status: 'Steady',
        statusColor: 'bg-slate-100 text-slate-700 border-slate-200',
        barColor: 'bg-[#0f8b8d]',
      },
      {
        name: 'Obstetrics & Gynaecology',
        sub: 'Labor Complications, CTG, Contraception',
        solved: 676,
        incorrect: 162,
        accuracy: 76,
        status: 'Solid',
        statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        barColor: 'bg-[#1f9d55]',
      },
      {
        name: 'Pathology & Microbiology',
        sub: 'Neoplasia, RPGN Crescents, Bacteriology',
        solved: 1021,
        incorrect: 224,
        accuracy: 78,
        status: 'Solid',
        statusColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        barColor: 'bg-[#1f9d55]',
      },
      {
        name: 'General Medicine',
        sub: 'Cardiology, Neurology, Nephrology, Endocrine',
        solved: 1164,
        incorrect: 209,
        accuracy: 82,
        status: 'Mastered',
        statusColor: 'bg-teal-50 text-teal-800 border-teal-200',
        barColor: 'bg-[#0f8b8d]',
      },
    ];
  };

  const subjectData = getCohortSubjects();

  const sortedSubjects = [...subjectData].sort((a, b) => {
    if (sortBy === 'lowest') return a.accuracy - b.accuracy;
    if (sortBy === 'highest') return b.accuracy - a.accuracy;
    return b.solved - a.solved;
  });

  const handleExportPDF = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

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
            Detailed clinical performance across 19 specialties, difficulty tiers, and multi-exam cohorts.
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
              12,450
            </span>
            <span className="text-xs text-slate-500 font-medium">/ 18,000 Qs</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-medium pt-2 border-t border-slate-100">
            <span className="text-emerald-700 font-semibold">69.2% Syllabus covered</span>
            <span className="text-slate-500">5,550 Remaining</span>
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
              76.4%
            </span>
            <span className="text-xs font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
              ↗+2.3%
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">vs national cohort average (74.1%)</p>
          <div className="mt-2 flex items-center gap-3 text-xs font-medium pt-2 border-t border-slate-100">
            <span className="flex items-center gap-1 text-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <strong className="font-mono">9,512</strong> Correct
            </span>
            <span className="flex items-center gap-1 text-slate-700">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <strong className="font-mono">2,410</strong> Wrong
            </span>
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
              <div className="text-base font-bold text-emerald-700 font-mono">9,512</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Incorrect</div>
              <div className="text-base font-bold text-red-600 font-mono">2,410</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Skipped</div>
              <div className="text-base font-bold text-slate-600 font-mono">528</div>
            </div>
          </div>
          {/* Multi-segmented bar */}
          <div className="mt-3 w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div className="h-full bg-emerald-500" style={{ width: '76.4%' }} title="Correct: 76.4%"></div>
            <div className="h-full bg-red-500" style={{ width: '19.4%' }} title="Incorrect: 19.4%"></div>
            <div className="h-full bg-slate-400" style={{ width: '4.2%' }} title="Skipped: 4.2%"></div>
          </div>
        </div>

        {/* National Standing */}
        {/* National Standing or AMC Scaled Score */}
        <div className="bg-white border border-[#e3e7ee] rounded-xl p-4 shadow-xs bg-linear-to-br from-white to-slate-50/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            <span>
              {activeCohort === 'AMC_CAT' ? 'AMC CAT SCALED SCORE' : activeCohort === 'INI_CET' ? 'INI-CET STANDING' : 'NATIONAL STANDING'}
            </span>
            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
              activeCohort === 'AMC_CAT' ? 'bg-emerald-100 text-emerald-800' : 'bg-teal-100 text-teal-800'
            }`}>
              {activeCohort === 'AMC_CAT' ? 'PASS (>=250)' : 'PROJECTION'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#13294b] font-mono tabular-nums tracking-tight">
              {activeCohort === 'AMC_CAT' ? '284 / 500' : activeCohort === 'INI_CET' ? '98.4 %ile' : 'AIR 1,450'}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 font-medium mt-1">
            {activeCohort === 'AMC_CAT' 
              ? 'Required Pass Threshold: 250 (Exceeded by +34 pts)' 
              : activeCohort === 'INI_CET' 
                ? 'AIIMS New Delhi Merit Benchmark (Top 1.6%)' 
                : 'Top 3.2% percentile cohort benchmark'}
          </p>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-xs text-slate-700 font-semibold">
            <Trophy className="w-3.5 h-3.5 text-[#f2a541]" />
            {activeCohort === 'AMC_CAT' ? 'Target: Safe Margin > 300' : 'Target: Sub-1,000 for Clinical Seat'}
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
                Continuous mastery tracking across core clinical & pre-clinical curricula
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
                {sortedSubjects.map((sub) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column (1 Col wide): Difficulty & Synthesis Cards */}
        <div className="space-y-4">
          {/* Difficulty Tier Accuracy Card */}
          <div className="bg-white border border-[#e3e7ee] rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-bold text-[#13294b]">Difficulty Tier Accuracy</h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Accuracy performance segregated across clinical cognitive load
            </p>

            <div className="space-y-4">
              {/* Tier 1 */}
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-teal-600"></span>
                    Tier 1: Direct Recall
                  </span>
                  <span className="font-mono text-teal-700 font-bold">85%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-600 rounded-full" style={{ width: '85%' }}></div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                  <span>5,120 Solved</span>
                  <span className="text-emerald-700 font-semibold">Target met</span>
                </div>
              </div>

              {/* Tier 2 */}
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#0f8b8d]"></span>
                    Tier 2: Clinical 2-Step
                  </span>
                  <span className="font-mono text-[#0f8b8d] font-bold">72%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#0f8b8d] rounded-full" style={{ width: '72%' }}></div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                  <span>5,480 Solved</span>
                  <span className="text-slate-600 font-medium">Optimal pace</span>
                </div>
              </div>

              {/* Tier 3 */}
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#d64545]"></span>
                    Tier 3: Multi-Step & IBQ
                  </span>
                  <span className="font-mono text-red-600 font-bold">48%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#d64545] rounded-full" style={{ width: '48%' }}></div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                  <span>1,850 Solved</span>
                  <span className="text-red-600 font-bold">Urgent remediation</span>
                </div>
              </div>
            </div>
          </div>

          {/* Cognitive Synthesis Insight Callout */}
          <div className="bg-[#f8f9ff] border border-[#e3e7ee] rounded-xl p-4 shadow-xs">
            <div className="flex items-start gap-2.5">
              <Lightbulb className="w-4 h-4 text-[#0f8b8d] shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-[#13294b]">Cognitive Synthesis Insight</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  IBQs (Image-Based Questions) in Tier 3 account for <strong>41% of errors</strong>. Prioritize Robbins slide evaluations in Pathology before the next mock test.
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
                <div className="text-[11px] text-slate-500">2,410 questions queued for spaced review</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#0f8b8d] group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Completed Modules History */}
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
          {/* Row 1 */}
          <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-slate-400 font-mono">Today, 08:30 AM</div>
              <div className="font-bold text-sm text-[#13294b] flex items-center gap-2">
                <span>INI-CET: Antimicrobial Resistance 20 Qs</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800">
                  Exam Mode
                </span>
              </div>
              <div className="text-xs text-slate-500">Pharmacology + Microbiology Integrated</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="font-mono font-bold text-sm text-[#13294b]">16 / 20</span>
                <span className="ml-1.5 font-bold text-emerald-700">(80%)</span>
              </div>
              <button
                onClick={() => onNavigate('test-runner')}
                className="text-xs font-semibold text-[#0f8b8d] hover:underline flex items-center gap-1"
              >
                Review Answers →
              </button>
            </div>
          </div>

          {/* Row 2 */}
          <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-slate-400 font-mono">Yesterday, 04:15 PM</div>
              <div className="font-bold text-sm text-[#13294b] flex items-center gap-2">
                <span>AMC CAT: Emergency Triage Vignettes 50 Qs</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                  Practice
                </span>
              </div>
              <div className="text-xs text-slate-500">Surgery & Critical Care Cohort</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="font-mono font-bold text-sm text-[#13294b]">38 / 50</span>
                <span className="ml-1.5 font-bold text-teal-700">(76%)</span>
              </div>
              <button
                onClick={() => onNavigate('test-runner')}
                className="text-xs font-semibold text-[#0f8b8d] hover:underline flex items-center gap-1"
              >
                Review Answers →
              </button>
            </div>
          </div>

          {/* Row 3 */}
          <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-[11px] text-slate-400 font-mono">22 Oct, 11:00 AM</div>
              <div className="font-bold text-sm text-[#13294b] flex items-center gap-2">
                <span>NEET PG: High-Yield Cardiology Grand Drill</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800">
                  Exam Mode
                </span>
              </div>
              <div className="text-xs text-slate-500">General Medicine (ECGs & Murmurs)</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="font-mono font-bold text-sm text-[#13294b]">82 / 100</span>
                <span className="ml-1.5 font-bold text-emerald-700">(82%)</span>
              </div>
              <button
                onClick={() => onNavigate('test-runner')}
                className="text-xs font-semibold text-[#0f8b8d] hover:underline flex items-center gap-1"
              >
                Review Answers →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
