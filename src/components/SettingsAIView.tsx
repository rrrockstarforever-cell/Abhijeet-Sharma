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
import {
  AI_PROVIDER_IDS,
  DEFAULT_MODELS,
  NOT_CONNECTED_MESSAGE,
  getActiveProvider,
  setActiveProvider as persistActiveProvider,
  pickDefaultActiveProvider,
  getModel,
  setModel as persistModel,
  getEffectiveModel,
} from '../lib/ai.ts';
import { DataBackupPanel } from './DataBackupPanel.tsx';

// Local provider catalog for the 4 REAL providers (no mock latency/verified numbers).
// Connection state is always fetched live from GET /api/oauth/status.
const REAL_PROVIDERS: AIProvider[] = [
  {
    id: 'gemini',
    name: 'Gemini (Google AI)',
    brand: 'google',
    model: DEFAULT_MODELS.gemini,
    status: 'ready',
    type: 'API Key (user-supplied)',
    features: ['API Key in Settings', 'Flash & Pro models'],
    isDefault: true,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.gemini, name: 'Gemini 3.8 Flash', description: 'Default fast model', latencyEstimate: '—', contextWindow: '—' },
      { id: 'gemini-3.8-pro', name: 'Gemini 3.8 Pro', description: 'Deep reasoning', latencyEstimate: '—', contextWindow: '—' },
    ]
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT (OpenAI Subscription)',
    brand: 'openai',
    model: DEFAULT_MODELS.chatgpt,
    status: 'ready',
    type: 'Device Code Sign-In',
    features: ['Device Code Sign-In', 'Subscription Tokens'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.chatgpt, name: 'GPT 6.1 Sol (Default)', description: 'Current default', latencyEstimate: '—', contextWindow: '—' },
    ]
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic Subscription)',
    brand: 'anthropic',
    model: DEFAULT_MODELS.claude,
    status: 'ready',
    type: 'PKCE Sign-In (paste code)',
    features: ['Paste-Code Sign-In', 'Subscription Tokens'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.claude, name: 'Claude Sonnet 5.5 (Default)', description: 'Current default', latencyEstimate: '—', contextWindow: '—' },
    ]
  },
  {
    id: 'grok',
    name: 'Grok (xAI SuperGrok)',
    brand: 'xai',
    model: DEFAULT_MODELS.grok,
    status: 'ready',
    type: 'Device Code Sign-In',
    features: ['Device Code Sign-In', 'Subscription Tokens'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.grok, name: 'Grok 4.7 (Default)', description: 'Current default', latencyEstimate: '—', contextWindow: '—' },
    ]
  },
];

function getClientSessionId(): string {
  let sid = localStorage.getItem('pulse_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
    localStorage.setItem('pulse_session_id', sid);
  }
  return sid;
}

export const SettingsAIView: React.FC = () => {
  const [providers, setProviders] = useState<AIProvider[]>(REAL_PROVIDERS);
  const [activeProviderId, setActiveProviderId] = useState<string>(() => getActiveProvider() ?? 'gemini');
  const [models, setModels] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    REAL_PROVIDERS.forEach(p => { initial[p.id] = getEffectiveModel(p.id as any); });
    return initial;
  });
  
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

  // Gemini API key state (the one provider that uses a key)
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>('');
  const [isSavingKey, setIsSavingKey] = useState<boolean>(false);
  const [keySavedMsg, setKeySavedMsg] = useState<string | null>(null);

  // Optional live model catalog (models.dev via the local server) — suggestions only,
  // any model id can still be typed manually.
  const [modelCatalog, setModelCatalog] = useState<Record<string, { id: string; name: string; context: number | null; released: string | null }[]>>({});
  const [catalogInfo, setCatalogInfo] = useState<{ busy: boolean; error: string | null; at: string | null }>({
    busy: false, error: null, at: null,
  });

  // The models THIS account may actually use, asked of each provider with its own
  // token (GET /api/models/available). The models.dev catalogue above is not
  // account-aware, so it suggests ids a subscription login cannot call.
  const [accountModels, setAccountModels] = useState<Record<string, { id: string; name: string }[]>>({});
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const [accountBusy, setAccountBusy] = useState<boolean>(false);

  const loadModelCatalog = async () => {
    setCatalogInfo((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await fetch('/api/models/catalog');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      setModelCatalog(data.providers ?? {});
      setCatalogInfo({ busy: false, error: null, at: typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString() });
    } catch (err: any) {
      setCatalogInfo({ busy: false, error: err?.message || 'Could not load the live model catalog.', at: null });
    }
  };

  const loadAccountModels = async () => {
    setAccountBusy(true);
    try {
      const res = await fetch('/api/models/available');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      setAccountModels(data.providers ?? {});
      setAccountErrors(data.errors ?? {});
    } catch (err: any) {
      setAccountErrors({ _global: err?.message || 'Could not list the models on your account.' });
    } finally {
      setAccountBusy(false);
    }
  };

  const pollTimerRef = useRef<any>(null);

  // Fetch REAL connection state from the server on mount / active change
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
            const isConn = Boolean(providerStatus?.connected);
            return {
              ...p,
              hasTokenConfigured: isConn,
              status: isConn ? (p.id === activeProviderId ? 'active' : 'connected') : 'ready',
              userEmail: providerStatus?.userEmail || undefined
            };
          }));

          // First-run default: active provider = first connected provider
          const persisted = getActiveProvider();
          if (!persisted) {
            const firstConnected = pickDefaultActiveProvider(data.providers);
            if (firstConnected) {
              setActiveProviderId(firstConnected);
              persistActiveProvider(firstConnected);
            }
          }
        }
      } else if (res.status !== 200) {
        console.error('OAuth status fetch failed:', res.status);
      }
    } catch (err) {
      console.error('Error fetching OAuth status:', err);
    }
  };

  useEffect(() => {
    fetchOAuthStatus();
  }, [activeProviderId]);

  useEffect(() => {
    loadModelCatalog();
    loadAccountModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the account lists when a provider's connection state changes.
  // Derived as a string so the effect only re-runs when the set actually changes.
  const connectedProviderKey = providers
    .filter((p) => p.hasTokenConfigured)
    .map((p) => p.id)
    .sort()
    .join(',');

  useEffect(() => {
    loadAccountModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderId, connectedProviderKey]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Initiate OAuth Sign-In (real device-code / PKCE flows from the server)
  const handleOpenSignInModal = async (provider: AIProvider) => {
    setSelectedProvider(provider);
    setAuthError(null);
    setAuthSuccess(false);
    setKeySavedMsg(null);
    setCopied(false);
    setClaudeInputCode('');
    setDeviceCodeData(null);
    setPkceData(null);

    if (provider.id === 'gemini') {
      // Gemini uses a user-pasted API key handled inside the modal.
      setIsLoadingFlow(false);
      return;
    }

    setIsLoadingFlow(true);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    try {
      const res = await fetch('/api/oauth/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({ provider: provider.id })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Failed to start ${provider.name} sign-in flow.`);
      }

      setIsLoadingFlow(false);

      if (data.flow === 'device_code') {
        setDeviceCodeData({
          userCode: data.userCode,
          verificationUri: data.verificationUri,
          deviceCode: data.deviceCode,
          interval: data.interval || 5
        });
        startDeviceCodePolling(provider.id, data.deviceCode, data.interval || 5);
      } else if (data.flow === 'pkce') {
        setPkceData({
          authUrl: data.authUrl,
          state: data.state
        });
      } else {
        throw new Error('Unexpected sign-in flow response.');
      }
    } catch (err: any) {
      setIsLoadingFlow(false);
      setAuthError(err.message || 'Failed to start authorization flow.');
    }
  };

  // Device Code Polling: polls /api/oauth/poll using the provider-provided interval
  const startDeviceCodePolling = (providerId: string, deviceCode: string, intervalSeconds: number) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsPolling(true);
    const pollEveryMs = Math.max(2, intervalSeconds || 3) * 1000;

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
          } else if (data.status === 'error') {
            clearInterval(pollTimerRef.current);
            setIsPolling(false);
            setAuthError(data?.error || 'Authorization failed. Please restart sign-in.');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, pollEveryMs);
  };

  // Verify device approval against the real provider via /api/oauth/complete
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

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Not approved yet. Approve the code on the provider page, then click Verify again.');
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

  // Complete Claude PKCE by pasting the approval code (validated with real PKCE on the server)
  const handleCompleteClaudePKCE = async () => {
    if (!selectedProvider || !claudeInputCode.trim() || !pkceData) return;
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
          state: pkceData.state
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to verify Claude authorization code.');
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

  // Save the Gemini API key (server stores it in the user's data dir, never in the repo)
  const handleSaveGeminiKey = async () => {
    const key = geminiKeyInput.trim();
    if (!key) return;
    setIsSavingKey(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/settings/gemini-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({ apiKey: key })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save the API key.');
      setKeySavedMsg('API key saved and active. Gemini is now connected.');
      setGeminiKeyInput('');
      await fetchOAuthStatus();
      setTimeout(() => setSelectedProvider(null), 1200);
    } catch (err: any) {
      setAuthError(err.message || 'Could not save the API key.');
    } finally {
      setIsSavingKey(false);
    }
  };

  // Revoke subscription tokens on the server (real logout of stored tokens)
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

  // Set Active: persists to localStorage and is only allowed for connected providers
  const handleSetActive = (provider: AIProvider) => {
    if (!provider.hasTokenConfigured) {
      setAuthError(null);
      return;
    }
    setActiveProviderId(provider.id);
    persistActiveProvider(provider.id as any);
  };

  const handleModelChange = (providerId: string, model: string) => {
    setModels(prev => ({ ...prev, [providerId]: model }));
    persistModel(providerId as any, model);
  };

  // Real "Test connection": sends "Reply with exactly: OK" through the provider and
  // verifies the exact response (same behaviour as the old app's model check).
  const [testState, setTestState] = useState<{
    id: string;
    status: 'busy' | 'ok' | 'fail';
    detail: string | null;
  } | null>(null);

  const handleTestConnection = async (providerId: string) => {
    if (testState?.status === 'busy') return;
    setTestState({ id: providerId, status: 'busy', detail: null });
    try {
      const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          model: models[providerId] || getEffectiveModel(providerId as any),
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (text === 'OK') {
        setTestState({ id: providerId, status: 'ok', detail: null });
      } else {
        setTestState({ id: providerId, status: 'fail', detail: `Unexpected reply: ${text.slice(0, 60) || '(empty)'}` });
      }
    } catch (err: any) {
      setTestState({ id: providerId, status: 'fail', detail: err?.message || 'Test request failed.' });
    } finally {
      setTimeout(() => setTestState(null), 6000);
    }
  };

  const handleCloseModal = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsPolling(false);
    setKeySavedMsg(null);
    setGeminiKeyInput('');
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
              AI Subscription & Model Routing
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              AI Subscriptions, Model Tokens & Local Engine
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Sign in with your Claude Pro, ChatGPT Plus, or Grok subscription, or add your Gemini API key — then route every AI feature through your active model.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-mono text-emerald-400 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Local Server Routing · Tokens Never Leave This Machine
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Left Info/Security, Right Provider Cards with Sign-In */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Server-Keyed Security & Model Routing Info */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#0f8b8d]" /> Active Engine & Model Routing
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every AI feature uses the active provider and model below
                </p>
              </div>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                LIVE
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-semibold">Active Provider:</span>
                <span className="font-mono font-bold text-[#0f8b8d] truncate max-w-[60%] text-right">
                  {activeProviderId} · {models[activeProviderId] || getEffectiveModel(activeProviderId as any)}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                The active engine is used by the AI Tutor, Practice Module Builder, and any other AI action. Change it with “Use Engine” on any connected provider card.
              </p>
            </div>

            {/* Privacy note */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Subscription tokens stored:</span>
                <span className="font-mono font-medium text-slate-800">~\.neet-pg-prep\oauth.json (local only)</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Gemini key stored:</span>
                <span className="font-mono font-medium text-slate-800">user data dir \.env</span>
              </div>
            </div>
          </div>

          {/* Privacy Guard */}
          <div className="bg-slate-900 rounded-2xl p-5 text-white border border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" /> Server-Keyed Session Security
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Subscription tokens and your Gemini key live only on this machine, managed by the local server. They are never returned to the browser and never committed to repository storage.
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
                Sign in with your Claude, ChatGPT, or Grok subscription — or paste a Gemini API key
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              {providers.filter(p => p.hasTokenConfigured).length} of {providers.length} Connected
            </span>
          </div>

          {/* Live model catalog status (models.dev) */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-500">
            <span>
              {catalogInfo.error
                ? `Live catalog unavailable — static suggestions shown (${catalogInfo.error})`
                : catalogInfo.at
                  ? `Live model catalog loaded ${new Date(catalogInfo.at).toLocaleString()} · ${Object.values(modelCatalog).reduce((n, list) => n + list.length, 0)} models`
                  : 'Loading live model catalog…'}
            </span>
            <button
              onClick={loadModelCatalog}
              disabled={catalogInfo.busy}
              className="font-bold text-[#0f8b8d] hover:underline disabled:opacity-40"
            >
              {catalogInfo.busy ? 'Refreshing…' : 'Refresh catalog'}
            </button>
          </div>

          {/* Providers List */}
          <div className="space-y-3.5">
            {providers.map((p) => {
              const isActive = p.id === activeProviderId;
              const isConnected = Boolean(p.hasTokenConfigured);
              const catalogModels = modelCatalog[p.id] ?? [];
              const liveAccountModels = accountModels[p.id] ?? [];
              const accountError = accountErrors[p.id];
              const selectedModelId = models[p.id] ?? p.model;
              const selectedMeta = catalogModels.find((m) => m.id === selectedModelId);
              // NEW / OLD badge from the models.dev release date (only when known).
              const releaseBadge: 'NEW' | 'OLD' | null = (() => {
                const released = selectedMeta?.released ? Date.parse(selectedMeta.released) : NaN;
                if (!Number.isFinite(released)) return null;
                const days = (Date.now() - released) / 86_400_000;
                return days <= 120 ? 'NEW' : days >= 540 ? 'OLD' : null;
              })();
              // Prefer what THIS account can really call; the public catalogue is only
              // a fallback, and static defaults only if the live list is unavailable.
              const suggestions = liveAccountModels.length
                ? liveAccountModels.map((m) => ({ id: m.id, label: m.name || m.id }))
                : catalogModels.length
                  ? catalogModels.map((m) => ({
                      id: m.id,
                      label: `${m.name}${m.context ? ` · ${Math.round(m.context / 1000)}k context` : ''}`,
                    }))
                  : p.availableModels.map((m) => ({ id: m.id, label: m.name }));

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
                              : 'bg-gradient-to-br from-slate-800 to-black text-white'
                      }`}>
                        {p.name.charAt(0)}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-slate-900">{p.name}</h4>
                          {isActive && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> ACTIVE ENGINE
                            </span>
                          )}
                          {isConnected ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Connected
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                              Not connected
                            </span>
                          )}
                        </div>

                        {/* Per-provider model selector (persisted, user-selectable) */}
                        <div className="flex items-center gap-2 mt-2">
                          <label className="text-[11px] text-slate-500 font-semibold">Model</label>
                          <input
                            type="text"
                            value={models[p.id] ?? p.model}
                            onChange={(e) => handleModelChange(p.id, e.target.value)}
                            className="w-52 text-[11px] font-mono px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                            list={`models-${p.id}`}
                            placeholder={p.model}
                          />
                          <datalist id={`models-${p.id}`}>
                            {suggestions.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </datalist>
                          <span className="text-[9px] font-mono text-slate-400 max-w-[130px] truncate" title={selectedMeta?.released ? `Released ${selectedMeta.released}` : undefined}>
                            {selectedMeta?.context ? `${Math.round(selectedMeta.context / 1000)}k ctx` : 'any model id'}
                          </span>
                          {releaseBadge && (
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                releaseBadge === 'NEW'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                  : 'bg-slate-100 border-slate-200 text-slate-500'
                              }`}
                              title={selectedMeta?.released ? `Released ${selectedMeta.released}` : undefined}
                            >
                              {releaseBadge}
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
                          <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                            isConnected
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}>
                            {isConnected ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Key Saved</span>
                              </>
                            ) : (
                              <>
                                <Key className="w-3.5 h-3.5 text-slate-400" />
                                <span>No Key</span>
                              </>
                            )}
                          </span>
                          <button
                            onClick={() => handleOpenSignInModal(p)}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d] flex items-center gap-1.5 transition-colors"
                          >
                            <Key className="w-3.5 h-3.5 text-[#0f8b8d]" />
                            <span>{isConnected ? 'Update Key' : 'Add API Key'}</span>
                          </button>
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
                                : 'Sign in with Grok'}
                          </span>
                        </button>
                      )}

                      {isConnected && (
                        <button
                          onClick={() => handleTestConnection(p.id)}
                          disabled={testState?.status === 'busy' && testState.id === p.id}
                          title={testState?.id === p.id && testState.status === 'fail'
                            ? `Test failed: ${testState.detail ?? 'unknown error'}`
                            : 'Send "Reply with exactly: OK" through this provider'}
                          className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                            testState?.id === p.id && testState.status === 'ok'
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                              : testState?.id === p.id && testState.status === 'fail'
                                ? 'bg-rose-50 border-rose-300 text-rose-800'
                                : 'bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d]'
                          }`}
                        >
                          {testState?.id === p.id && testState.status === 'busy' ? (
                            <Activity className="w-3.5 h-3.5 animate-spin" />
                          ) : testState?.id === p.id && testState.status === 'ok' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Activity className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>
                            {testState?.id === p.id && testState.status === 'ok'
                              ? 'OK'
                              : testState?.id === p.id && testState.status === 'fail'
                                ? 'Failed'
                                : 'Test'}
                          </span>
                        </button>
                      )}

                      <button
                        onClick={() => handleSetActive(p)}
                        disabled={isActive || !isConnected}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                          isActive
                            ? 'bg-emerald-600 text-white cursor-default'
                            : isConnected
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

      {/* Data & exports — real stores, versioned backup, merge import */}
      <div className="mt-6">
        <DataBackupPanel />
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
                      ? 'Gemini API Key'
                      : `Sign in with ${selectedProvider.name}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedProvider.id === 'claude' 
                      ? 'Paste-Code Authorization Flow' 
                      : selectedProvider.id === 'gemini'
                        ? 'Key saved locally — never shown again'
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
                <span className="font-semibold">Successfully Connected to {selectedProvider.name}!</span>
              </div>
            )}

            {keySavedMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-semibold">{keySavedMsg}</span>
              </div>
            )}

            {/* Gemini API Key View */}
            {selectedProvider.id === 'gemini' && (
              <div className="space-y-4 py-2">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Server-Side Key Handling</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    Create the key in Google AI Studio and paste it here. It is saved by the local server to your user data directory (<code className="font-mono text-[#0f8b8d]">.env</code>, outside the repo) and is never displayed again or sent back to the browser.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">
                    Gemini API Key
                  </label>
                  <input
                    type="password"
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    placeholder="AIza… / your Gemini API key"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    onClick={handleCloseModal}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveGeminiKey}
                    disabled={isSavingKey || !geminiKeyInput.trim()}
                    className="px-4 py-2 text-xs font-bold bg-[#001432] hover:bg-[#13294b] disabled:opacity-40 text-white rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    {isSavingKey ? (
                      <>
                        <Activity className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#8ff3f4]" />
                        <span>Save & Connect</span>
                      </>
                    )}
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
                    <span>Requesting real device code from {selectedProvider.name}...</span>
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
                            <span>Verifying with provider...</span>
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

            {/* Paste-Code Flow for Claude */}
            {selectedProvider.id === 'claude' && (
              <div className="space-y-4">
                {isLoadingFlow ? (
                  <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                    <Activity className="w-5 h-5 animate-spin text-[#0f8b8d]" />
                    <span>Preparing Claude authorization URL...</span>
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
                        Log in with your Claude Pro or Team subscription, approve access, then copy the code shown on the page.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 block">
                        Step 2: Paste the Approval Code
                      </label>
                      <input
                        type="text"
                        value={claudeInputCode}
                        onChange={e => setClaudeInputCode(e.target.value)}
                        placeholder="Paste the code shown by Claude (format: code#state)"
                        className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                      />
                      <p className="text-[11px] text-slate-400">
                        The code is verified server-side with S256 PKCE and exchanged for tokens stored locally on this machine.
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
                            <span>Verifying code...</span>
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
