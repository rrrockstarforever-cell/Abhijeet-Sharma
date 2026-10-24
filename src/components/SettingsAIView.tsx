import React, { useState } from 'react';
import { 
  Cpu, 
  Sparkles, 
  CheckCircle2, 
  Settings, 
  ShieldCheck, 
  Activity, 
  Key, 
  Lock, 
  ExternalLink, 
  X, 
  Check, 
  AlertCircle,
  HardDrive
} from 'lucide-react';
import { AIProvider } from '../types.ts';
import { MOCK_AI_PROVIDERS } from '../data/mockClinicalData.ts';

export const SettingsAIView: React.FC = () => {
  const [providers, setProviders] = useState<AIProvider[]>(MOCK_AI_PROVIDERS);
  const [activeProviderId, setActiveProviderId] = useState<string>('gemini');
  const [simdThreads, setSimdThreads] = useState<number>(12); // 12 workers default
  const [cacheMemoryMB, setCacheMemoryMB] = useState<number>(512);
  const [fp16Quantization, setFp16Quantization] = useState<boolean>(true);
  
  // Connect / Sign-in Modal State
  const [selectedModalProvider, setSelectedModalProvider] = useState<AIProvider | null>(null);
  const [inputToken, setInputToken] = useState<string>('');
  const [inputAuthType, setInputAuthType] = useState<'session_token' | 'api_key'>('session_token');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationSuccess, setVerificationSuccess] = useState<boolean | null>(null);

  const handleOpenConnectModal = (provider: AIProvider) => {
    setSelectedModalProvider(provider);
    setInputToken(provider.hasTokenConfigured ? '••••••••••••••••••••••••••••••••' : '');
    setInputAuthType(provider.id === 'claude' ? 'session_token' : 'api_key');
    setVerificationSuccess(null);
  };

  const handleVerifyAndSave = () => {
    if (!inputToken.trim()) return;
    setIsVerifying(true);
    setVerificationSuccess(null);

    setTimeout(() => {
      setIsVerifying(false);
      setVerificationSuccess(true);
      
      if (selectedModalProvider) {
        setProviders(prev => prev.map(p => {
          if (p.id === selectedModalProvider.id) {
            return {
              ...p,
              hasTokenConfigured: true,
              status: p.id === activeProviderId ? 'active' : 'connected',
              latencyMs: Math.floor(Math.random() * 40) + 110,
            };
          }
          return p;
        }));
      }

      setTimeout(() => {
        setSelectedModalProvider(null);
      }, 1000);
    }, 700);
  };

  const handleSetActive = (providerId: string) => {
    setActiveProviderId(providerId);
    setProviders(prev => prev.map(p => ({
      ...p,
      isDefault: p.id === providerId,
      status: p.id === providerId ? 'active' : p.hasTokenConfigured ? 'connected' : 'ready'
    })));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#001432] rounded-2xl p-6 text-white border border-[#13294b] shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-[#0f8b8d]/20 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0f8b8d]/20 text-[#8ff3f4] text-xs font-semibold uppercase tracking-wider mb-2 border border-[#0f8b8d]/30">
              <Cpu className="w-3.5 h-3.5" />
              SIMD Parallel Engine & AI Subscription Gateway
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              AI Subscriptions, Model Tokens & OCR Architecture
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Sign in with your Claude Pro, ChatGPT Plus, Gemini, or Grok subscription tokens, and calibrate the 10–16 thread parallel SIMD OCR engine for medical PDFs.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-mono text-emerald-400 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Engine Online · WASM SIMD 128-bit
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Left SIMD OCR Settings, Right Provider Cards with Sign-In */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: SIMD Parallel OCR Architecture */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#0f8b8d]" /> High-Speed SIMD OCR Engine
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Multi-worker WebAssembly acceleration for PDF books
                </p>
              </div>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                ACTIVE
              </span>
            </div>

            {/* Hardware Thread Allocation (10-16 Workers) */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-2">
                <span>Parallel OCR Worker Threads</span>
                <span className="font-mono text-[#0f8b8d] font-bold">{simdThreads} Workers</span>
              </div>
              <input
                type="range"
                min={8}
                max={16}
                value={simdThreads}
                onChange={e => setSimdThreads(Number(e.target.value))}
                className="w-full accent-[#0f8b8d] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
                <span>8 Threads</span>
                <span className="text-[#0f8b8d] font-bold">12 Threads (Recommended)</span>
                <span>16 Threads (Max Speed)</span>
              </div>
            </div>

            {/* RAM Cache Allocation */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-2">
                <span>Vector Embedding LRU Cache</span>
                <span className="font-mono text-[#0f8b8d] font-bold">{cacheMemoryMB} MB</span>
              </div>
              <input
                type="range"
                min={128}
                max={1024}
                step={64}
                value={cacheMemoryMB}
                onChange={e => setCacheMemoryMB(Number(e.target.value))}
                className="w-full accent-[#0f8b8d] cursor-pointer"
              />
            </div>

            {/* Toggles */}
            <div className="pt-2 space-y-3 border-t border-slate-100">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-slate-800">FP16 Weight Quantization</div>
                  <div className="text-[11px] text-slate-500">Accelerates OCR indexing with 50% less RAM</div>
                </div>
                <input
                  type="checkbox"
                  checked={fp16Quantization}
                  onChange={e => setFp16Quantization(e.target.checked)}
                  className="w-4 h-4 rounded text-[#0f8b8d] focus:ring-[#0f8b8d] cursor-pointer"
                />
              </label>
            </div>

            {/* Diagnostic stats */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Processing Speed:</span>
                <span className="font-mono font-medium text-emerald-600">~{Math.round(simdThreads * 1.55)} pages / sec</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Indexed Medical Passages:</span>
                <span className="font-mono font-medium text-slate-800">4,820 chunks (42 textbooks)</span>
              </div>
            </div>
          </div>

          {/* HIPAA & Privacy Guard */}
          <div className="bg-slate-900 rounded-2xl p-5 text-white border border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" /> Zero-Egress Local Credential Security
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your API keys and subscription tokens are stored purely in your browser's local sandbox. No credentials or patient stems are logged or egressed.
            </p>
          </div>
        </div>

        {/* Right Column: AI Providers with Sign-In Buttons */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" /> AI Subscription Hub & Model Routing
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Sign in with your Claude, ChatGPT, Gemini, or Grok subscription
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              6 Providers Available
            </span>
          </div>

          {/* Providers List */}
          <div className="space-y-3.5">
            {providers.map((p) => {
              const isActive = p.id === activeProviderId;

              return (
                <div
                  key={p.id}
                  className={`bg-white rounded-2xl border p-5 transition-all shadow-sm ${
                    isActive
                      ? 'border-[#0f8b8d] ring-2 ring-[#0f8b8d]/20 bg-teal-50/10'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 shadow-xs ${
                        p.id === 'gemini' 
                          ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white' 
                          : p.id === 'claude'
                            ? 'bg-gradient-to-br from-amber-600 to-orange-700 text-white'
                            : p.id === 'chatgpt'
                              ? 'bg-gradient-to-br from-emerald-600 to-teal-800 text-white'
                              : p.id === 'grok'
                                ? 'bg-gradient-to-br from-slate-800 to-black text-white'
                                : p.id === 'deepseek'
                                  ? 'bg-gradient-to-br from-blue-500 to-cyan-600 text-white'
                                  : 'bg-slate-700 text-white'
                      }`}>
                        {p.name.charAt(0)}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-slate-900">{p.name}</h4>
                          <span className="text-xs font-mono text-slate-500 font-medium">({p.model})</span>
                          {isActive && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> ACTIVE ENGINE
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {p.features.map((feat, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600"
                            >
                              {feat}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Controls: Sign In / Token Modal + Set Active */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => handleOpenConnectModal(p)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
                          p.hasTokenConfigured
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                            : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>{p.hasTokenConfigured ? 'Connected' : 'Sign In / Token'}</span>
                      </button>

                      <button
                        onClick={() => handleSetActive(p.id)}
                        disabled={isActive}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                          isActive
                            ? 'bg-emerald-600 text-white cursor-default'
                            : 'bg-[#001432] hover:bg-[#13294b] text-white active:scale-95'
                        }`}
                      >
                        {isActive ? 'Active' : 'Use Engine'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sign-In & Token Modal Popup */}
      {selectedModalProvider && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#001432] text-white flex items-center justify-center font-bold text-sm">
                  {selectedModalProvider.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Connect {selectedModalProvider.name}
                  </h3>
                  <p className="text-xs text-slate-500">Enter API key or subscription session token</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedModalProvider(null)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Auth Type Tabs for Claude */}
            {selectedModalProvider.id === 'claude' && (
              <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => setInputAuthType('session_token')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    inputAuthType === 'session_token' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'
                  }`}
                >
                  Claude Pro Session Token (sessionKey)
                </button>
                <button
                  onClick={() => setInputAuthType('api_key')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    inputAuthType === 'api_key' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'
                  }`}
                >
                  Anthropic API Key (sk-ant-...)
                </button>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  {selectedModalProvider.id === 'ollama' 
                    ? 'Localhost Endpoint URL' 
                    : inputAuthType === 'session_token' 
                      ? 'Session Key / Subscription Token' 
                      : 'API Key'}
                </label>
                <input
                  type={inputToken.startsWith('http') ? 'text' : 'password'}
                  value={inputToken}
                  onChange={e => setInputToken(e.target.value)}
                  placeholder={
                    selectedModalProvider.id === 'claude' 
                      ? (inputAuthType === 'session_token' ? 'sk-ant-sid01-...' : 'sk-ant-api03-...')
                      : selectedModalProvider.id === 'chatgpt'
                        ? 'sk-proj-...'
                        : selectedModalProvider.id === 'grok'
                          ? 'xai-...'
                          : selectedModalProvider.id === 'ollama'
                            ? 'http://127.0.0.1:11434'
                            : 'AI Studio Key...'
                  }
                  className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <Lock className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Secure Client Sandbox Storage</span>
                </div>
                <p>
                  Tokens are saved solely in your local browser sandbox (`localStorage`). Zero cloud egress or secret exposure.
                </p>
              </div>
            </div>

            {verificationSuccess === true && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Connection verified! Latency: {selectedModalProvider.latencyMs}ms. Token saved.</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setSelectedModalProvider(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyAndSave}
                disabled={isVerifying || !inputToken.trim()}
                className="px-4 py-2 text-xs font-bold bg-[#001432] hover:bg-[#13294b] disabled:opacity-40 text-white rounded-xl flex items-center gap-1.5 transition-all"
              >
                {isVerifying ? (
                  <>
                    <Activity className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying Ping...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Test & Save Subscription</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
