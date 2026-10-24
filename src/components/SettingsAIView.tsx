import React, { useState, useEffect, useRef } from 'react';
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
  HardDrive,
  Copy,
  LogOut,
  Radio
} from 'lucide-react';
import { AIProvider } from '../types.ts';
import { MOCK_AI_PROVIDERS } from '../data/mockClinicalData.ts';

function getClientSessionId(): string {
  let sid = localStorage.getItem('pulse_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
    localStorage.setItem('pulse_session_id', sid);
  }
  return sid;
}

export const SettingsAIView: React.FC = () => {
  const [providers, setProviders] = useState<AIProvider[]>(MOCK_AI_PROVIDERS);
  const [activeProviderId, setActiveProviderId] = useState<string>('gemini');
  const [simdThreads, setSimdThreads] = useState<number>(12); // 12 workers default
  const [cacheMemoryMB, setCacheMemoryMB] = useState<number>(512);
  const [fp16Quantization, setFp16Quantization] = useState<boolean>(true);
  
  // Real OAuth Sign-In Modal State
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(null);
  const [isLoadingFlow, setIsLoadingFlow] = useState<boolean>(false);
  const [deviceCodeData, setDeviceCodeData] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [pkceData, setPkceData] = useState<{
    authUrl: string;
    state: string;
  } | null>(null);
  const [claudeInputCode, setClaudeInputCode] = useState<string>('');
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const pollTimerRef = useRef<any>(null);

  // Poll or fetch status on mount to display real server connection state
  const fetchOAuthStatus = async () => {
    try {
      const res = await fetch('/api/oauth/status', {
        headers: {
          'x-session-id': getClientSessionId()
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.providers) {
          setProviders(prev => prev.map(p => {
            const providerStatus = data.providers[p.id];
            if (providerStatus) {
              const isConn = Boolean(providerStatus.connected);
              return {
                ...p,
                hasTokenConfigured: isConn,
                status: isConn ? (p.id === activeProviderId ? 'active' : 'connected') : 'ready',
                userEmail: providerStatus.userEmail || p.userEmail
              };
            }
            return p;
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching OAuth status:', err);
    }
  };

  useEffect(() => {
    fetchOAuthStatus();
  }, [activeProviderId]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Initiate OAuth Sign-In
  const handleOpenSignInModal = async (provider: AIProvider) => {
    setSelectedProvider(provider);
    setAuthError(null);
    setAuthSuccess(false);
    setCopied(false);
    setClaudeInputCode('');
    setDeviceCodeData(null);
    setPkceData(null);
    setIsLoadingFlow(true);

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    if (provider.id === 'gemini') {
      setIsLoadingFlow(false);
      return;
    }

    try {
      const res = await fetch('/api/oauth/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({ provider: provider.id })
      });

      if (!res.ok) {
        throw new Error(`Failed to start ${provider.name} sign-in flow.`);
      }

      const data = await res.json();
      setIsLoadingFlow(false);

      if (data.flow === 'device_code') {
        setDeviceCodeData({
          userCode: data.userCode,
          verificationUri: data.verificationUri,
          deviceCode: data.deviceCode,
          interval: data.interval || 2
        });
        startDeviceCodePolling(provider.id, data.deviceCode);
      } else if (data.flow === 'pkce') {
        setPkceData({
          authUrl: data.authUrl,
          state: data.state
        });
      }
    } catch (err: any) {
      setIsLoadingFlow(false);
      setAuthError(err.message || 'Failed to start authorization flow.');
    }
  };

  // Device Code Polling: polls /api/oauth/poll every 2 seconds
  const startDeviceCodePolling = (providerId: string, deviceCode: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsPolling(true);

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/oauth/poll', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': getClientSessionId()
          },
          body: JSON.stringify({ provider: providerId, deviceCode })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.connected) {
            clearInterval(pollTimerRef.current);
            setIsPolling(false);
            setAuthSuccess(true);
            await fetchOAuthStatus();
            setTimeout(() => {
              setSelectedProvider(null);
            }, 1200);
          } else if (data.status === 'expired') {
            clearInterval(pollTimerRef.current);
            setIsPolling(false);
            setAuthError('Device authorization code has expired. Please restart sign-in.');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000);
  };

  // Manual approval trigger for device code
  const handleCompleteDeviceCode = async () => {
    if (!selectedProvider || !deviceCodeData) return;
    setIsVerifying(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/oauth/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({
          provider: selectedProvider.id,
          deviceCode: deviceCodeData.deviceCode
        })
      });

      if (!res.ok) {
        throw new Error('Device approval completion failed.');
      }

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setIsPolling(false);
      setIsVerifying(false);
      setAuthSuccess(true);
      await fetchOAuthStatus();
      setTimeout(() => {
        setSelectedProvider(null);
      }, 1200);
    } catch (err: any) {
      setIsVerifying(false);
      setAuthError(err.message || 'Verification failed.');
    }
  };

  // Complete Claude PKCE by pasting approval code
  const handleCompleteClaudePKCE = async () => {
    if (!selectedProvider || !claudeInputCode.trim()) return;
    setIsVerifying(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/oauth/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({
          provider: 'claude',
          code: claudeInputCode.trim(),
          state: pkceData?.state
        })
      });

      if (!res.ok) {
        throw new Error('Failed to verify Claude authorization code.');
      }

      setIsVerifying(false);
      setAuthSuccess(true);
      await fetchOAuthStatus();
      setTimeout(() => {
        setSelectedProvider(null);
      }, 1200);
    } catch (err: any) {
      setIsVerifying(false);
      setAuthError(err.message || 'Authorization failed.');
    }
  };

  // Revoke token on server
  const handleLogout = async (providerId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await fetch('/api/oauth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({ provider: providerId })
      });
      await fetchOAuthStatus();
      if (activeProviderId === providerId) {
        setActiveProviderId('gemini');
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleCopyCode = () => {
    if (deviceCodeData?.userCode) {
      navigator.clipboard.writeText(deviceCodeData.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSetActive = (providerId: string) => {
    setActiveProviderId(providerId);
    setProviders(prev => prev.map(p => ({
      ...p,
      isDefault: p.id === providerId,
      status: p.id === providerId ? 'active' : p.hasTokenConfigured ? 'connected' : 'ready'
    })));
  };

  const handleCloseModal = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsPolling(false);
    setSelectedProvider(null);
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
              <ShieldCheck className="w-4 h-4" /> Server-Keyed Session Security
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tokens live strictly on the server keyed to your user session. They are never returned to the browser and never committed to repository storage.
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
              {providers.filter(p => p.hasTokenConfigured).length} of {providers.length} Connected
            </span>
          </div>

          {/* Providers List */}
          <div className="space-y-3.5">
            {providers.map((p) => {
              const isActive = p.id === activeProviderId;
              const isConnected = Boolean(p.hasTokenConfigured);

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

                    {/* Controls: Sign In Button or Connected State + Set Active */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {p.id === 'gemini' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Connected (API Key)</span>
                          </span>
                        </div>
                      ) : isConnected ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Connected</span>
                          </span>
                          <button
                            onClick={(e) => handleLogout(p.id, e)}
                            title="Disconnect subscription"
                            className="text-xs text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleOpenSignInModal(p)}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-teal-50 border-[#0f8b8d]/30 text-[#00696b] hover:bg-[#0f8b8d]/10 flex items-center gap-1.5 transition-colors"
                        >
                          <Key className="w-3.5 h-3.5 text-[#0f8b8d]" />
                          <span>
                            {p.id === 'chatgpt' 
                              ? 'Sign in with ChatGPT' 
                              : p.id === 'claude' 
                                ? 'Sign in with Claude' 
                                : p.id === 'grok' 
                                  ? 'Sign in with Grok' 
                                  : 'Sign In / Connect'}
                          </span>
                        </button>
                      )}

                      <button
                        onClick={() => handleSetActive(p.id)}
                        disabled={isActive || (!isConnected && p.id !== 'gemini')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                          isActive
                            ? 'bg-emerald-600 text-white cursor-default'
                            : isConnected || p.id === 'gemini'
                              ? 'bg-[#001432] hover:bg-[#13294b] text-white active:scale-95'
                              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
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

      {/* Interactive OAuth Sign-In Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#001432] text-white flex items-center justify-center font-bold text-sm">
                  {selectedProvider.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {selectedProvider.id === 'gemini' 
                      ? 'Gemini API Key Status'
                      : `Sign in with ${selectedProvider.name}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedProvider.id === 'claude' 
                      ? 'PKCE Browser Authorization Flow' 
                      : selectedProvider.id === 'gemini'
                        ? 'Server Environment Authentication'
                        : 'Device Authorization Flow (RFC 8628)'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {authError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            {/* Success Message */}
            {authSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-semibold">Successfully Connected to {selectedProvider.name}! Server token secured.</span>
              </div>
            )}

            {/* Gemini View */}
            {selectedProvider.id === 'gemini' && (
              <div className="space-y-4 py-2">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Gemini Native Engine Integration</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    Gemini 3.8 Flash connects via the server-side environment key (<code className="font-mono text-[#0f8b8d]">process.env.GEMINI_API_KEY</code>). All prompts and reasoning requests are proxied securely on the backend without browser client key exposure.
                  </p>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleCloseModal}
                    className="px-4 py-2 text-xs font-bold bg-[#001432] text-white rounded-xl hover:bg-[#13294b]"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* Device Code Flow for ChatGPT & Grok */}
            {(selectedProvider.id === 'chatgpt' || selectedProvider.id === 'grok') && (
              <div className="space-y-4">
                {isLoadingFlow ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                    <Activity className="w-5 h-5 animate-spin text-[#0f8b8d]" />
                    <span>Requesting authorization code from server...</span>
                  </div>
                ) : deviceCodeData ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 block">
                        Step 1: Your One-Time Authorization Code
                      </label>
                      <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="font-mono text-xl font-extrabold tracking-wider text-[#001432]">
                          {deviceCodeData.userCode}
                        </span>
                        <button
                          onClick={handleCopyCode}
                          className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 rounded-lg flex items-center gap-1.5 text-slate-700 transition-colors shadow-2xs"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700 font-bold">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              <span>Copy Code</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 block">
                        Step 2: Approve on {selectedProvider.name}
                      </label>
                      <a
                        href={deviceCodeData.verificationUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2.5 px-4 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs"
                      >
                        <span>Open {selectedProvider.name} Approval Page</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Sign in to your subscription in the opened tab, paste the code <strong className="font-mono text-slate-800">{deviceCodeData.userCode}</strong>, and click Approve.
                      </p>
                    </div>

                    {/* Active Polling Status */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0f8b8d] opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0f8b8d]" />
                        </span>
                        <span className="text-slate-600 font-medium">Waiting for authorization on provider...</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">Polling /api/oauth/poll</span>
                    </div>

                    {/* Action buttons */}
                    <div className="pt-2 flex items-center justify-end gap-2.5">
                      <button
                        onClick={handleCloseModal}
                        className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCompleteDeviceCode}
                        disabled={isVerifying}
                        className="px-4 py-2 text-xs font-bold bg-[#001432] hover:bg-[#13294b] text-white rounded-xl flex items-center gap-1.5 transition-all shadow-xs"
                      >
                        {isVerifying ? (
                          <>
                            <Activity className="w-3.5 h-3.5 animate-spin" />
                            <span>Verifying...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#8ff3f4]" />
                            <span>I've Approved on Provider</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {/* PKCE Browser URL Flow for Claude */}
            {selectedProvider.id === 'claude' && (
              <div className="space-y-4">
                {isLoadingFlow ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                    <Activity className="w-5 h-5 animate-spin text-[#0f8b8d]" />
                    <span>Preparing Claude PKCE authorization URL...</span>
                  </div>
                ) : pkceData ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 block">
                        Step 1: Authorize on Anthropic Claude
                      </label>
                      <a
                        href={pkceData.authUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2.5 px-4 bg-[#0f8b8d] hover:bg-[#00696b] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs"
                      >
                        <span>Open Claude Authorization Page</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Log in with your Claude Pro or Team subscription in the new tab to approve access.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 block">
                        Step 2: Paste Approval Code or Callback URL
                      </label>
                      <input
                        type="text"
                        value={claudeInputCode}
                        onChange={e => setClaudeInputCode(e.target.value)}
                        placeholder="Paste code (e.g. claude_auth_code_... or full redirect URL)"
                        className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                      />
                      <p className="text-[11px] text-slate-400">
                        The code is validated server-side using cryptographic S256 PKCE verification.
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="pt-2 flex items-center justify-end gap-2.5">
                      <button
                        onClick={handleCloseModal}
                        className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCompleteClaudePKCE}
                        disabled={isVerifying || !claudeInputCode.trim()}
                        className="px-4 py-2 text-xs font-bold bg-[#001432] hover:bg-[#13294b] disabled:opacity-40 text-white rounded-xl flex items-center gap-1.5 transition-all shadow-xs"
                      >
                        {isVerifying ? (
                          <>
                            <Activity className="w-3.5 h-3.5 animate-spin" />
                            <span>Verifying PKCE...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#8ff3f4]" />
                            <span>Complete Claude Sign-In</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
