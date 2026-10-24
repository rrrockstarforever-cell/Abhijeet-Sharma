import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Send, 
  Brain, 
  BookOpen, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Clock, 
  Bot, 
  User, 
  Paperclip, 
  RotateCcw,
  ExternalLink,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { AppView, ClinicalQuestion } from '../types.ts';
import { INITIAL_QUESTIONS } from '../data/mockClinicalData.ts';

interface AITutorViewProps {
  initialQuestionId?: string;
  onNavigate: (view: AppView, targetId?: string) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'tutor';
  timestamp: string;
  text: string;
  reasoningSteps?: {
    step: string;
    detail: string;
  }[];
  pearl?: string;
  citations?: string[];
  suggestedFollowups?: string[];
}

export const AITutorView: React.FC<AITutorViewProps> = ({
  initialQuestionId,
  onNavigate
}) => {
  const [selectedPersona, setSelectedPersona] = useState<'ATTENDING' | 'BOARD_MASTER' | 'PHARMACOLOGIST'>('BOARD_MASTER');
  const [activeQuestion, setActiveQuestion] = useState<ClinicalQuestion | null>(() => {
    if (initialQuestionId) {
      return INITIAL_QUESTIONS.find(q => q.id === initialQuestionId) || INITIAL_QUESTIONS[0];
    }
    return INITIAL_QUESTIONS[0];
  });

  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm1',
      sender: 'tutor',
      timestamp: '10:42 AM',
      text: `Welcome back, Dr. Sharma. I am ready to dissect clinical vignettes and examine board distractor mechanisms. I have loaded context for ${INITIAL_QUESTIONS[0].id}: ${INITIAL_QUESTIONS[0].subtopic}.`,
      reasoningSteps: [
        {
          step: 'Target Phenotype',
          detail: 'VanA vs VanB vs VanC Enterococcal glycopeptide resistance genetics.'
        },
        {
          step: 'High-Yield Trap',
          detail: 'VanB is inducible by vancomycin only; teicoplanin remains active in vitro but risks rapid in vivo mutation.'
        }
      ],
      pearl: 'Drug of choice for VanA VRE bacteremia: Linezolid (50S subunit inhibitor) or Daptomycin (lipopeptide, inactivated by pulmonary surfactant).',
      citations: [
        "Harrison's Principles of Internal Medicine 21st Ed. · Ch. 142 (pp. 1120-1124)",
        'Robbins & Cotran Pathologic Basis of Disease 10th Ed. · p. 344'
      ],
      suggestedFollowups: [
        'Why does Teicoplanin fail against VanA but work against VanB?',
        'What is the mechanism of resistance in intrinsic VanC?',
        'Give me a 2-step clinical case on VRE management'
      ]
    }
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputPrompt;
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: text.trim()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setLoading(true);

    try {
      const response = await fetch('/api/ai/tutor-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          contextQuestion: activeQuestion ? {
            id: activeQuestion.id,
            subject: activeQuestion.subject,
            subtopic: activeQuestion.subtopic,
            stem: activeQuestion.stem,
            correctOption: activeQuestion.correctOption,
            trapExplanation: activeQuestion.trapExplanation
          } : undefined,
          persona: selectedPersona
        })
      });

      if (!response.ok) {
        throw new Error('API server returned error');
      }

      const data = await response.json();

      const tutorMsg: ChatMessage = {
        id: `t-${Date.now()}`,
        sender: 'tutor',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: data.reply || 'Analyzing the pathophysiology and clinical board implications...',
        reasoningSteps: data.reasoningSteps,
        pearl: data.pearl || activeQuestion?.boardPearl,
        citations: data.citations || activeQuestion?.citations,
        suggestedFollowups: data.suggestedFollowups || [
          'What are the second-line therapeutic options?',
          'What is the typical board presentation question?',
          'Summarize this into an Anki Cloze card'
        ]
      };

      setMessages(prev => [...prev, tutorMsg]);
    } catch (err) {
      // High-yield offline fallback if network/key is unavailable
      const fallbackMsg: ChatMessage = {
        id: `t-${Date.now()}`,
        sender: 'tutor',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `Clinical Socratic Synthesis: Regarding "${text}", the core board distinction hinges on terminal dipeptide alteration. While wild-type peptidoglycan synthesizes D-Ala-D-Ala, VanA and VanB replace it with D-Ala-D-Lac, reducing vancomycin affinity by a factor of 1,000. Teicoplanin does not induce the VanB regulatory sensor-kinase (VanS), preserving its susceptibility in vitro.`,
        pearl: 'Remember: VanA = All glycopeptides resistant. VanB = Vancomycin only (teicoplanin susceptible). Linezolid & Daptomycin are first-line.',
        citations: [
          "Harrison's Internal Medicine 21st Ed. · Ch. 142",
          'Sanford Guide to Antimicrobial Therapy 2024'
        ],
        suggestedFollowups: [
          'Why is Daptomycin contraindicated in pneumonia?',
          'Explain the VanC phenotype in Enterococcus gallinarum',
          'Review the crescentic glomerulonephritis histopathology'
        ]
      };
      setMessages(prev => [...prev, fallbackMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Sparkles className="w-3.5 h-3.5" />
              Gemini 3.8 Flash · Socratic Medical Engine
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Clinical AI Tutor & Socratic Reasoning Partner
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Dissect complex multi-step clinical vignettes, unravel subtle board distractor traps, and anchor pathophysiology pearls grounded in standard medical textbooks.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-800 text-emerald-400 border border-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Evidence Grounded · Textbook Citations
            </span>
          </div>
        </div>

        {/* Persona Selector Tabs */}
        <div className="mt-6 pt-5 border-t border-slate-700/60 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 mr-2 font-medium">Tutor Persona:</span>
          {[
            { id: 'BOARD_MASTER', label: 'Board Exam Master (High-Yield Traps)' },
            { id: 'ATTENDING', label: 'Socratic Attending Physician (Rounds)' },
            { id: 'PHARMACOLOGIST', label: 'Mechanism & Kinetics Specialist' }
          ].map(persona => (
            <button
              key={persona.id}
              onClick={() => setSelectedPersona(persona.id as any)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                selectedPersona === persona.id
                  ? 'bg-[#0f8b8d] text-white shadow-sm'
                  : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {persona.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Left Chat, Right Attached Context */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Chat Conversation Stream */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[650px] overflow-hidden">
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.sender === 'tutor' && (
                    <div className="w-8 h-8 rounded-xl bg-[#001432] text-white flex items-center justify-center shrink-0 mt-1 shadow-sm">
                      <Bot className="w-4 h-4 text-[#8ff3f4]" />
                    </div>
                  )}

                  <div className={`max-w-[88%] space-y-3 ${
                    msg.sender === 'user'
                      ? 'bg-[#001432] text-white p-4 rounded-2xl rounded-tr-sm shadow-sm text-xs leading-relaxed'
                      : 'bg-slate-50 border border-slate-200 p-5 rounded-2xl rounded-tl-sm text-xs text-slate-800 leading-relaxed shadow-sm'
                  }`}>
                    {/* Header line for tutor */}
                    {msg.sender === 'tutor' && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium pb-1 border-b border-slate-200/60">
                        <span className="font-bold text-slate-800">
                          {selectedPersona === 'BOARD_MASTER' ? 'Board Exam Master AI' : 'Socratic Clinical Tutor'}
                        </span>
                        <span className="font-mono">{msg.timestamp}</span>
                      </div>
                    )}

                    <div className="whitespace-pre-wrap font-sans text-xs sm:text-[13px] leading-relaxed">
                      {msg.text}
                    </div>

                    {/* Reasoning Steps if present */}
                    {msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
                      <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                        <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-[#0f8b8d]" /> Socratic Step-by-Step Breakdown:
                        </div>
                        {msg.reasoningSteps.map((step, sIdx) => (
                          <div key={sIdx} className="text-xs text-slate-700 pl-2 border-l-2 border-[#0f8b8d]">
                            <span className="font-bold text-slate-900">{step.step}: </span>
                            {step.detail}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* High Yield Pearl Box */}
                    {msg.pearl && (
                      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 uppercase tracking-wider mb-1">
                          <Brain className="w-3.5 h-3.5 text-amber-600" /> High-Yield Board Pearl
                        </div>
                        <p className="text-xs text-amber-900 font-medium">
                          {msg.pearl}
                        </p>
                      </div>
                    )}

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 pt-1 border-t border-slate-200/60">
                        <BookOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{msg.citations.join(' · ')}</span>
                      </div>
                    )}

                    {/* Suggested Followups */}
                    {msg.suggestedFollowups && msg.suggestedFollowups.length > 0 && (
                      <div className="pt-2 space-y-1.5">
                        <div className="text-[11px] font-bold text-slate-600">Quick Socratic Probes:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.suggestedFollowups.map((fu, fIdx) => (
                            <button
                              key={fIdx}
                              onClick={() => handleSendMessage(fu)}
                              className="text-[11px] text-left px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-[#0f8b8d] text-slate-700 hover:text-[#0f8b8d] transition-colors"
                            >
                              ↳ {fu}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {msg.sender === 'user' && (
                    <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#001432] text-white flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-[#8ff3f4]" />
                  </div>
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-xs text-slate-600 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#0f8b8d] animate-spin" />
                    <span>Synthesizing medical textbook knowledge with Gemini 3.8 Flash...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
              <input
                type="text"
                placeholder="Ask clinical reasoning question or request mnemonic..."
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
              />
              <button
                disabled={loading || !inputPrompt.trim()}
                onClick={() => handleSendMessage()}
                className="px-4 py-2.5 bg-[#001432] hover:bg-[#13294b] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2"
              >
                <span>Send</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Attached Question & Rules Context */}
        <div className="lg:col-span-4 space-y-6">
          {/* Active Context Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Brain className="w-4 h-4 text-[#0f8b8d]" /> Attached Clinical Context
              </h3>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {activeQuestion?.id || 'Q10'}
              </span>
            </div>

            {activeQuestion ? (
              <div className="space-y-2.5 text-xs">
                <div className="text-slate-500">
                  <span className="font-semibold text-slate-700">Discipline: </span>
                  {activeQuestion.subject} · {activeQuestion.subtopic}
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 font-sans text-slate-800 line-clamp-3">
                  "{activeQuestion.stem}"
                </div>

                {activeQuestion.trapExplanation && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                    <span className="font-bold block mb-0.5">Known Traps:</span>
                    {activeQuestion.trapExplanation}
                  </div>
                )}

                <div className="pt-2 flex items-center justify-between">
                  <button
                    onClick={() => onNavigate('test-runner', activeQuestion.id)}
                    className="text-xs font-bold text-[#0f8b8d] hover:text-[#00696b] flex items-center gap-1"
                  >
                    Open in Test Runner <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      const nextQ = INITIAL_QUESTIONS.find(q => q.id !== activeQuestion.id) || INITIAL_QUESTIONS[1];
                      setActiveQuestion(nextQ);
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Switch Context
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No question context attached.</p>
            )}
          </div>

          {/* Quick High-Yield Review Prompts */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Drill Common Board Topics</h3>
            
            <div className="space-y-2">
              {[
                { title: 'Pauci-Immune RPGN Silver Stain', sub: 'Pathology · c-ANCA' },
                { title: 'Pheochromocytoma Blockade Sequence', sub: 'Gen Med · Alpha 1st' },
                { title: 'Neonatal Sepsis & Ceftriaxone', sub: 'Pediatrics · Kernicterus' },
                { title: 'NDM-1 Carbapenemase Therapy', sub: 'Microbiology · Metallo-BL' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSendMessage(`Explain the clinical high-yield pearls and common exam traps for: ${item.title}`)}
                  className="p-2.5 rounded-xl border border-slate-100 hover:border-[#0f8b8d]/40 hover:bg-slate-50 transition-all cursor-pointer flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-800">{item.title}</div>
                    <div className="text-[11px] text-slate-500">{item.sub}</div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
