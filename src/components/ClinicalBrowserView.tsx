import React, { useState } from 'react';
import { 
  Globe, 
  Search, 
  BookOpen, 
  ExternalLink, 
  FileText, 
  Copy, 
  Check, 
  Sparkles, 
  Bookmark, 
  ShieldCheck, 
  Share2, 
  Clock, 
  Layers,
  ArrowRight
} from 'lucide-react';
import { AppView } from '../types.ts';

interface ClinicalBrowserViewProps {
  onNavigate: (view: AppView, targetId?: string) => void;
}

export const ClinicalBrowserView: React.FC<ClinicalBrowserViewProps> = ({ onNavigate }) => {
  const [searchUrl, setSearchUrl] = useState<string>('https://pubmed.ncbi.nlm.nih.gov/?term=vanA+enterococcus+teicoplanin');
  const [selectedSource, setSelectedSource] = useState<string>('ALL');
  const [scratchpadText, setScratchpadText] = useState<string>(
`# Bedside & Board Notes: Enterococcal Glycopeptides
- VanA: High-level resistance to both Vancomycin & Teicoplanin (MIC >=64 and >=16).
- VanB: Inducible strictly by Vancomycin. In vitro Teicoplanin remains active, but avoid monotherapy due to breakout mutations.
- Transposon Tn1546 carries VanA cluster on conjugative plasmids (transferable to S. aureus -> VRSA).
- Drug of choice: Linezolid or Daptomycin (not for pneumonia).`
  );
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopyScratchpad = () => {
    navigator.clipboard.writeText(scratchpadText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAppendArticle = (title: string, pmid: string) => {
    setScratchpadText(prev => `${prev}\n\n[Citation Added] ${title} (${pmid})`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Globe className="w-3.5 h-3.5" />
              Evidence Triage & Medical Search Tunnel
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Clinical Evidence Browser & Live Research Sandbox
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Cross-reference board questions against live peer-reviewed evidence (PubMed, The Lancet, NEJM, WHO Guidelines) with a docked resident clinical scratchpad.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-800 text-emerald-400 border border-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Med-Tunnel Secure
            </span>
          </div>
        </div>

        {/* Address & Search Input */}
        <div className="mt-6 pt-5 border-t border-slate-700/60 flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Globe className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchUrl}
              onChange={e => setSearchUrl(e.target.value)}
              className="w-full bg-slate-900/90 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-400 font-mono focus:outline-none focus:border-[#0f8b8d]"
            />
          </div>
          <button
            onClick={() => alert(`Querying peer-reviewed literature for: ${searchUrl}`)}
            className="w-full sm:w-auto px-5 py-2.5 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl transition-all shadow-md shrink-0 flex items-center justify-center gap-2"
          >
            <Search className="w-3.5 h-3.5" /> Fetch Evidence
          </button>
        </div>

        {/* Filter Pills */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          {[
            { id: 'ALL', label: 'All Primary Sources' },
            { id: 'PUBMED', label: 'PubMed / NCBI (3,410)' },
            { id: 'LANCET', label: 'The Lancet Infectious Diseases' },
            { id: 'NEJM', label: 'NEJM Clinical Pathology' },
            { id: 'WHO', label: 'WHO Guidelines' },
          ].map(source => (
            <button
              key={source.id}
              onClick={() => setSelectedSource(source.id)}
              className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-colors ${
                selectedSource === source.id
                  ? 'bg-[#0f8b8d] text-white shadow-sm'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {source.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Left Evidence Passages, Right Docked Scratchpad */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Retrieved Evidence Cards */}
        <div className="lg:col-span-7 space-y-4">
          {/* Article Card 1 */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 hover:border-slate-300 transition-all">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                The Lancet Infectious Diseases · Vol. 24, Issue 4
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                PMID: 38491023 · DOI: 10.1016/S1473-3099
              </span>
            </div>

            <h3 className="text-base font-bold text-slate-900 leading-snug">
              Genomic Heterogeneity and Phenotypic Divergence in Enterococcal VanA vs VanB Glycopeptide Resistance Clusters: Clinical Outcomes in 1,240 ICU Patients
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>Abstract:</strong> Analysis of clinical isolates demonstrates that while VanA operons mediate constitutive or high-level inducible resistance to both vancomycin (MIC ≥64 µg/mL) and teicoplanin (MIC ≥16 µg/mL) via D-Ala-D-Lac dipeptide synthesis, VanB operons are selectively triggered by vancomycin alone. However, emergent promoter mutations in VanB strains under teicoplanin challenge lead to therapeutic failure in 18.4% of monotherapy cohorts.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <span className="font-bold text-slate-800 block mb-1">Key Clinical Takeaway for Exam Boards:</span>
              <span className="text-slate-700">
                Never prescribe Teicoplanin monotherapy for confirmed VanB bacteremia despite in vitro susceptibility; use Linezolid, Tedizolid, or high-dose Daptomycin + synergistic Ampicillin/Ceftaroline.
              </span>
            </div>

            <div className="pt-2 flex items-center justify-between text-xs">
              <button
                onClick={() => handleAppendArticle('The Lancet: VanA vs VanB Resistance in ICU Bacteremia', 'PMID: 38491023')}
                className="text-[#0f8b8d] hover:text-[#00696b] font-bold flex items-center gap-1.5 transition-colors"
              >
                <Bookmark className="w-3.5 h-3.5" /> Append Citation to Scratchpad
              </button>
              <button
                onClick={() => onNavigate('ai-tutor')}
                className="text-slate-600 hover:text-[#0f8b8d] font-semibold flex items-center gap-1 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Synthesize with AI Tutor
              </button>
            </div>
          </div>

          {/* Article Card 2 */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 hover:border-slate-300 transition-all">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                NEJM Clinical Pathology · Vol. 388, Issue 19
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                PMID: 36981240
              </span>
            </div>

            <h3 className="text-base font-bold text-slate-900 leading-snug">
              Histopathological Biomarkers in Rapidly Progressive Glomerulonephritis: Rupture of Glomerular Basement Membrane on Methenamine Silver
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>Pathology Summary:</strong> In crescentic glomerulonephritis, Jones methenamine silver (JMS) or periodic acid-methenamine silver precisely highlights breaks in Bowman's capsule and capillary loops. In Pauci-immune RPGN (ANCA-associated vasculitis), fibrinoid necrosis precipitates parietal cell proliferation forming cellular crescents without linear (Type I) or granular (Type II) immune complexes.
            </p>

            <div className="pt-2 flex items-center justify-between text-xs">
              <button
                onClick={() => handleAppendArticle('NEJM: Methenamine Silver in Crescentic Glomerulonephritis', 'PMID: 36981240')}
                className="text-[#0f8b8d] hover:text-[#00696b] font-bold flex items-center gap-1.5 transition-colors"
              >
                <Bookmark className="w-3.5 h-3.5" /> Append Citation to Scratchpad
              </button>
              <button
                onClick={() => onNavigate('test-runner', 'Q-PA-1049')}
                className="text-slate-600 hover:text-[#0f8b8d] font-semibold flex items-center gap-1 transition-colors"
              >
                Test in Q-PA-1049 <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Docked Clinical Scratchpad */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3 sticky top-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#0f8b8d]" />
                <h3 className="text-sm font-bold text-slate-900">Resident Clinical Scratchpad</h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyScratchpad}
                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs flex items-center gap-1"
                  title="Copy notes"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <textarea
              value={scratchpadText}
              onChange={e => setScratchpadText(e.target.value)}
              rows={14}
              className="w-full font-mono text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
            />

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-emerald-500" /> Auto-saved to Resident Profile
              </span>
              <button
                onClick={() => onNavigate('ai-tutor')}
                className="text-xs font-bold text-[#0f8b8d] hover:text-[#00696b] flex items-center gap-1"
              >
                Send to AI Reasoning Tutor <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
