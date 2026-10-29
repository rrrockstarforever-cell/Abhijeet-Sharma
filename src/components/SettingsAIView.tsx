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
  Radio,
  RefreshCw,
  Search,
  ScanText,
  Boxes,
  Images,
  Plus,
  Pencil,
  Zap,
  Save
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
import {
  MIN_OCR_WORKERS,
  MAX_OCR_WORKERS,
  defaultOcrWorkers,
  getOcrWorkers,
  setOcrWorkers,
} from '../utils/ocr.ts';
import { isLiveImageSearchEnabled, setLiveImageSearchEnabled } from '../utils/liveImages.ts';

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
  {
    id: 'custom',
    name: 'Custom (OpenAI-Compatible)',
    brand: 'openai',
    model: DEFAULT_MODELS.custom,
    status: 'ready',
    type: 'API Key (custom endpoint)',
    features: ['API Key in Settings', 'Custom base URL & model', 'OpenAI-compatible /chat/completions'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.custom, name: 'Custom Model (Default)', description: 'Set your own model id in Settings', latencyEstimate: '—', contextWindow: '—' },
    ]
  },
  {
    id: 'opencode',
    name: 'OpenCode (Console / Go)',
    brand: 'opencode',
    model: DEFAULT_MODELS.opencode,
    status: 'ready',
    type: 'API Key (OpenCode Console)',
    features: ['Console / Go API key', 'OpenAI-compatible gateway'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.opencode, name: 'DeepSeek V4.1 Flash (Default)', description: 'Default fast model', latencyEstimate: '—', contextWindow: '—' },
      { id: 'grok-4.7', name: 'Grok 4.7', description: 'Go-included', latencyEstimate: '—', contextWindow: '—' },
      { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', description: 'Go-included', latencyEstimate: '—', contextWindow: '—' },
      { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', description: 'Go-included', latencyEstimate: '—', contextWindow: '—' },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', description: 'Go-included (Anthropic)', latencyEstimate: '—', contextWindow: '—' },
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', description: 'Go-included (Google)', latencyEstimate: '—', contextWindow: '—' },
    ]
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM API',
    brand: 'openai',
    model: DEFAULT_MODELS.nvidia,
    status: 'ready',
    type: 'API Key (NVIDIA NIM)',
    features: ['API Key in Settings', 'NVIDIA NIM models', 'OpenAI-compatible /chat/completions'],
    isDefault: false,
    isSignedIn: false,
    hasTokenConfigured: false,
    availableModels: [
      { id: DEFAULT_MODELS.nvidia, name: 'Nemotron 3.5 Super VL 120B A12B', description: 'NVIDIA NIM default model', latencyEstimate: '—', contextWindow: '—' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B Instruct', description: 'NVIDIA NIM', latencyEstimate: '—', contextWindow: '—' },
      { id: 'nvidia/nemotron-4-340b-instruct', name: 'Nemotron 4 340B Instruct', description: 'NVIDIA NIM', latencyEstimate: '—', contextWindow: '—' },
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
  const [customModelEdit, setCustomModelEdit] = useState<Record<string, boolean>>({});
  
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

  // Key-based providers (Gemini, OpenCode): the pasted key never leaves the local server.
  const [keyInput, setKeyInput] = useState<string>('');
  const [isSavingKey, setIsSavingKey] = useState<boolean>(false);
  const [keySavedMsg, setKeySavedMsg] = useState<string | null>(null);

  // Custom endpoints (user-configurable OpenAI-compatible endpoints)
  const [customEndpoints, setCustomEndpoints] = useState<{
    id: string;
    name: string;
    providerId: string;
    endpointUrl: string;
    apiMode: string;
    defaultModel: string;
    context: string;
    apiKey: string;
    useForNewChats: boolean;
    discoverModels: boolean;
  }[]>([]);
  const [editingEndpoint, setEditingEndpoint] = useState<{
    id: string;
    name: string;
    providerId: string;
    endpointUrl: string;
    apiMode: string;
    defaultModel: string;
    context: string;
    apiKey: string;
    useForNewChats: boolean;
    discoverModels: boolean;
  } | null>(null);
  const [isSavingEndpoint, setIsSavingEndpoint] = useState<boolean>(false);
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [endpointTestResult, setEndpointTestResult] = useState<{ ok: boolean; reply?: string; error?: string } | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<{ id: string; name: string }[]>([]);
  const [isSearchingModels, setIsSearchingModels] = useState<boolean>(false);
  const [modelsSearchError, setModelsSearchError] = useState<string | null>(null);

  // OCR worker pool (1–16) — persisted so whole-book OCR keeps the chosen parallelism.
  const [ocrWorkers, setOcrWorkersState] = useState<number>(() => getOcrWorkers());
  const cpuThreads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 0 : 0;
  const recommendedWorkers = defaultOcrWorkers();
  const updateOcrWorkers = (n: number) => {
    setOcrWorkersState(setOcrWorkers(n));
  };

  // Live image sources: Open-i (licence-filtered) is embedded; several popular atlases are
  // reference links only because their terms do not allow redistribution.
  const [liveImages, setLiveImages] = useState<boolean>(() => isLiveImageSearchEnabled());
  const [imageSources, setImageSources] = useState<{
    embedded: { name: string; url: string; note: string }[];
    reference: { name: string; url: string; note: string }[];
  } | null>(null);

  useEffect(() => {
    fetch('/api/images/sources')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setImageSources(data); })
      .catch(() => {});
  }, []);

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
  const [accountAt, setAccountAt] = useState<string | null>(null);

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

  const loadAccountModels = async (refresh = false, provider?: string) => {
    setAccountBusy(true);
    try {
      const params = new URLSearchParams();
      if (refresh) params.set('refresh', '1');
      if (provider) params.set('provider', provider);
      const res = await fetch(`/api/models/available${params.size ? `?${params.toString()}` : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      setAccountModels(prev => ({ ...prev, ...(data.providers ?? {}) }));
      setAccountErrors(prev => {
        const next = { ...prev };
        for (const id of Object.keys(data.providers ?? {})) delete next[id];
        return { ...next, ...(data.errors ?? {}) };
      });
      setAccountAt(typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString());
    } catch (err: any) {
      setAccountErrors(prev => ({ ...prev, _global: err?.message || 'Could not list the models on your account.' }));
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
    fetchCustomEndpoints();
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
    loadAccountModels(true);
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
    setKeyInput('');
    setEditingEndpoint(null);
    setEndpointError(null);
    setEndpointTestResult(null);
    setDeviceCodeData(null);
    setPkceData(null);

    if (provider.id === 'gemini' || provider.id === 'opencode' || provider.id === 'nvidia') {
      // Key-based providers: the pasted key is handled inside the modal.
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

  // Save the pasted key (Gemini or OpenCode); the server stores it in the user's data dir.
  const handleSaveKey = async () => {
    const key = keyInput.trim();
    if (!key || !selectedProvider) return;
    const endpoint = selectedProvider.id === 'opencode' ? '/api/settings/opencode-key'
      : selectedProvider.id === 'nvidia' ? '/api/settings/nvidia-key'
      : '/api/settings/gemini-key';
    const label = selectedProvider.id === 'opencode' ? 'OpenCode'
      : selectedProvider.id === 'nvidia' ? 'NVIDIA'
      : 'Gemini';
    setIsSavingKey(true);
    setAuthError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify({ apiKey: key })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save the API key.');
      setKeySavedMsg(`API key saved and active. ${label} is now connected.`);
      setKeyInput('');
      await fetchOAuthStatus();
      await loadAccountModels(true, selectedProvider.id);
      setTimeout(() => setSelectedProvider(null), 1200);
    } catch (err: any) {
      setAuthError(err.message || 'Could not save the API key.');
    } finally {
      setIsSavingKey(false);
    }
  };

  // Fetch saved custom endpoints from the server.
  const fetchCustomEndpoints = async () => {
    try {
      const res = await fetch('/api/settings/custom-endpoints', {
        headers: { 'x-session-id': getClientSessionId() }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load custom endpoints.');
      setCustomEndpoints(data.endpoints || []);
    } catch (err: any) {
      setEndpointError(err?.message || 'Could not load custom endpoints.');
    }
  };

  // Save (create or update) a custom endpoint.
  const saveCustomEndpoint = async () => {
    if (!editingEndpoint) return;
    if (!editingEndpoint.name.trim() || !editingEndpoint.endpointUrl.trim() || !editingEndpoint.apiKey.trim()) {
      setEndpointError('Name, Endpoint URL and API Key are required.');
      return;
    }
    setIsSavingEndpoint(true);
    setEndpointError(null);
    try {
      const res = await fetch(`/api/settings/custom-endpoints/${editingEndpoint.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        },
        body: JSON.stringify(editingEndpoint)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save custom endpoint.');
      setEditingEndpoint(null);
      await fetchCustomEndpoints();
      await fetchOAuthStatus();
    } catch (err: any) {
      setEndpointError(err?.message || 'Could not save custom endpoint.');
    } finally {
      setIsSavingEndpoint(false);
    }
  };

  // Search for available models from the custom endpoint.
  const searchCustomModels = async () => {
    if (!editingEndpoint?.endpointUrl.trim() || !editingEndpoint?.apiKey.trim()) {
      setModelsSearchError('Enter Endpoint URL and API Key first.');
      return;
    }
    setIsSearchingModels(true);
    setModelsSearchError(null);
    setDiscoveredModels([]);
    try {
      const res = await fetch('/api/models/custom', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': getClientSessionId()
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Model search failed.');
      setDiscoveredModels(data.models || []);
    } catch (err: any) {
      setModelsSearchError(err?.message || 'Could not search for models.');
    } finally {
      setIsSearchingModels(false);
    }
  };

  // Delete a custom endpoint.
  const deleteCustomEndpoint = async (id: string) => {
    if (!window.confirm('Delete this custom endpoint?')) return;
    try {
      const res = await fetch(`/api/settings/custom-endpoints/${id}`, {
        method: 'DELETE',
        headers: { 'x-session-id': getClientSessionId() }
      });
      if (!res.ok) throw new Error('Could not delete endpoint.');
      await fetchCustomEndpoints();
      await fetchOAuthStatus();
    } catch (err: any) {
      setEndpointError(err?.message || 'Could not delete custom endpoint.');
    }
  };

  // Test a custom endpoint connection.
  const testCustomEndpoint = async (id: string) => {
    setTestingEndpoint(id);
    setEndpointTestResult(null);
    try {
      const res = await fetch(`/api/settings/custom-endpoints/${id}/test`, {
        method: 'POST',
        headers: { 'x-session-id': getClientSessionId() }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Test failed.');
      setEndpointTestResult({ ok: true, reply: data.reply });
    } catch (err: any) {
      setEndpointTestResult({ ok: false, error: err?.message || 'Test failed.' });
    } finally {
      setTestingEndpoint(null);
    }
  };

  // Start adding a new custom endpoint.
  const addNewCustomEndpoint = () => {
    const customProvider = REAL_PROVIDERS.find((p) => p.id === 'custom');
    setSelectedProvider(customProvider ?? null);
    setEditingEndpoint({
      id: '',
      name: '',
      providerId: '',
      endpointUrl: '',
      apiMode: 'auto-detect',
      defaultModel: '',
      context: 'Auto',
      apiKey: '',
      useForNewChats: true,
      discoverModels: true,
    });
    setEndpointError(null);
    setEndpointTestResult(null);
  };

  // Edit an existing custom endpoint.
  const editCustomEndpoint = (endpoint: typeof customEndpoints[number]) => {
    setEditingEndpoint({ ...endpoint });
    setEndpointError(null);
    setEndpointTestResult(null);
  };

  // Cancel editing.
  const cancelEditCustomEndpoint = () => {
    setEditingEndpoint(null);
    setEndpointError(null);
    setEndpointTestResult(null);
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
          // A normal one-line clinical question, not "reply with exactly OK": several
          // subscription models (Grok 4.7 among them) refuse literal echo instructions.
          messages: [{ role: 'user', content: 'Name the first-line drug for anaphylaxis in one word.' }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (text) {
        setTestState({ id: providerId, status: 'ok', detail: text.slice(0, 80) });
      } else {
        setTestState({ id: providerId, status: 'fail', detail: 'The provider returned an empty reply.' });
      }
    } catch (err: any) {
      setTestState({ id: providerId, status: 'fail', detail: err?.message || 'Test request failed.' });
    } finally {
      // Keep the verdict visible long enough to read and copy the provider's reason.
      setTimeout(() => setTestState(null), 15000);
    }
  };

  const handleCloseModal = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setIsPolling(false);
    setKeySavedMsg(null);
    setKeyInput('');
    setEditingEndpoint(null);
    setEndpointError(null);
    setEndpointTestResult(null);
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
              Sign in with your Claude Pro, ChatGPT Plus, or Grok subscription, paste a Gemini key, or route through OpenCode (Console / Go) — then route every AI feature through your active model.
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

          {/* OCR engine pool — whole-book OCR runs this many Tesseract workers in parallel */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ScanText className="w-4 h-4 text-[#0f8b8d]" /> OCR Engine & Worker Pool
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tesseract workers used for scanned pages and whole-book OCR
                </p>
              </div>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {ocrWorkers} / {MAX_OCR_WORKERS}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-semibold">Parallel workers</span>
                <span className="font-mono font-bold text-[#0f8b8d]">{ocrWorkers}</span>
              </div>
              <input
                type="range"
                min={MIN_OCR_WORKERS}
                max={MAX_OCR_WORKERS}
                step={1}
                value={ocrWorkers}
                onChange={(e) => updateOcrWorkers(Number(e.target.value))}
                className="w-full accent-[#0f8b8d] cursor-pointer"
                aria-label="OCR worker count"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>{MIN_OCR_WORKERS}</span>
                <span>{MAX_OCR_WORKERS} (max)</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => updateOcrWorkers(n)}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${
                    ocrWorkers === n
                      ? 'bg-[#0f8b8d] text-white border-[#0f8b8d]'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-500">
                Detected CPU threads: <span className="font-mono font-bold text-slate-700">{cpuThreads || 'unknown'}</span>
              </span>
              <button
                type="button"
                onClick={() => updateOcrWorkers(recommendedWorkers)}
                className="font-bold text-[#0f8b8d] hover:underline"
              >
                Use recommended ({recommendedWorkers})
              </button>
            </div>

            <p className="text-[10px] leading-relaxed text-slate-500">
              More workers scan a book faster. Each worker loads its own Tesseract engine (roughly 60–100 MB of RAM),
              so stay near your spare CPU threads. The new pool size applies to the next OCR job.
            </p>
          </div>

          {/* Live clinical-image sources for image-based questions */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Images className="w-4 h-4 text-[#0f8b8d]" /> Image Sources for Questions
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Where image-based items get their pictures
                </p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                liveImages
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
                {liveImages ? 'LIVE SEARCH ON' : 'LOCAL ONLY'}
              </span>
            </div>

            <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <div className="text-[11px] font-bold text-slate-800">Live search at generation time</div>
                <p className="text-[10px] leading-snug text-slate-500">
                  When no verified picture matches, search Wikimedia Commons (including CDC PHIL material) and
                  Open-i (NLM / PubMed Central) for the diagnosis. Only CC BY / CC BY-SA / CC0 / public-domain
                  results are used, proxied and cached locally, with attribution under the image.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !liveImages;
                  setLiveImages(next);
                  setLiveImageSearchEnabled(next);
                }}
                aria-pressed={liveImages}
                className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors ${liveImages ? 'bg-[#0f8b8d]' : 'bg-slate-300'}`}
                title={liveImages ? 'Live search is on' : 'Live search is off'}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${liveImages ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">How images are chosen</div>
              <p className="text-[10px] text-slate-600 leading-snug">
                No images are bundled. Each image-based question searches Wikimedia Commons (including CDC PHIL
                material) and Open-i at generation time, keeps the best licence-clean match, and never shows the
                same picture twice in a module.
              </p>
            </div>

            {imageSources?.reference?.length ? (
              <div className="space-y-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Reference atlases (open on their site)</div>
                <div className="space-y-1">
                  {imageSources.reference.map((src) => (
                    <a
                      key={src.name}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={src.note}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:border-[#0f8b8d]/40 group"
                    >
                      <span className="text-[10px] font-semibold text-slate-700 group-hover:text-[#0f8b8d] truncate">{src.name}</span>
                      <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-[#0f8b8d] shrink-0" />
                    </a>
                  ))}
                </div>
                <p className="text-[9px] leading-relaxed text-slate-400">
                  These atlases are copyrighted (or personal-use only), so their images are not copied into the app.
                </p>
              </div>
            ) : null}
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
                Sign in with your Claude, ChatGPT, or Grok subscription, paste a Gemini key, or use an OpenCode key
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              {providers.filter(p => p.hasTokenConfigured).length} of {providers.length} Connected
            </span>
          </div>

          {/* Live model catalog + account library status */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-500">
            <span>
              {accountBusy
                ? 'Searching each subscription’s model library…'
                : Object.keys(accountModels).length
                  ? `Account library: ${Object.values(accountModels).reduce((n, list) => n + list.length, 0)} models across ${Object.values(accountModels).filter((l) => l.length).length} connected provider(s)${accountAt ? ` · found ${new Date(accountAt).toLocaleTimeString()}` : ''}`
                  : 'Account model library has not been searched yet.'}
              {catalogInfo.error
                ? ` · models.dev catalog unavailable (${catalogInfo.error})`
                : catalogInfo.at
                  ? ` · models.dev catalog: ${Object.values(modelCatalog).reduce((n, list) => n + list.length, 0)} suggestions`
                  : ''}
            </span>
            <span className="flex items-center gap-3">
              <button
                onClick={() => loadAccountModels(true)}
                disabled={accountBusy}
                className="font-bold text-[#0f8b8d] hover:underline disabled:opacity-40 flex items-center gap-1"
              >
                <Search className="w-3 h-3" />
                {accountBusy ? 'Searching…' : 'Find all models'}
              </button>
              <button
                onClick={loadModelCatalog}
                disabled={catalogInfo.busy}
                className="font-bold text-[#0f8b8d] hover:underline disabled:opacity-40"
              >
                {catalogInfo.busy ? 'Refreshing…' : 'Refresh catalog'}
              </button>
            </span>
          </div>

          {/* If the active engine is connected but its plan exposes no models, say so honestly
              and offer the working alternative instead of leaving the user with failed sends. */}
          {(() => {
            const active = providers.find((p) => p.id === activeProviderId);
            if (!active?.hasTokenConfigured) return null;
            const activeCount = accountModels[activeProviderId]?.length;
            if (activeCount !== 0) return null;
            const alternate = providers.find((p) => p.id !== activeProviderId && p.hasTokenConfigured && (accountModels[p.id]?.length ?? 0) > 0);
            if (!alternate) return null;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <span>
                  <strong>{active.name}</strong> is connected but its subscription lists <strong>0 usable models</strong> here. AI features will fail until you switch engines.
                </span>
                <button
                  onClick={() => handleSetActive(alternate)}
                  className="font-bold px-2.5 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                >
                  Use {alternate.name.split(' ')[0]} ({accountModels[alternate.id].length} models)
                </button>
              </div>
            );
          })()}

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
                              : p.id === 'opencode'
                                ? 'bg-gradient-to-br from-[#0f8b8d] to-[#001432] text-white'
                              : p.id === 'custom'
                                ? 'bg-gradient-to-br from-violet-600 to-purple-800 text-white'
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

                        {/* Per-provider model library. The account's real list is fetched from
                            the provider with its own token; any id can still be typed manually. */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <label className="text-[11px] text-slate-500 font-semibold">Model</label>
                          {liveAccountModels.length > 0 && !customModelEdit[p.id] ? (
                            <select
                              value={selectedModelId}
                              onChange={(e) => {
                                if (e.target.value === '__custom__') {
                                  setCustomModelEdit((prev) => ({ ...prev, [p.id]: true }));
                                } else {
                                  handleModelChange(p.id, e.target.value);
                                }
                              }}
                              title={`${liveAccountModels.length} model${liveAccountModels.length === 1 ? '' : 's'} found on this account`}
                              className="max-w-[340px] text-[11px] font-mono px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                            >
                              {!liveAccountModels.some((m) => m.id === selectedModelId) && (
                                <option value={selectedModelId}>{selectedModelId} (current)</option>
                              )}
                              {liveAccountModels.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name && m.name !== m.id ? `${m.name} — ${m.id}` : m.id}
                                </option>
                              ))}
                              <option value="__custom__">Custom model id…</option>
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={models[p.id] ?? p.model}
                              onChange={(e) => handleModelChange(p.id, e.target.value)}
                              className="w-52 text-[11px] font-mono px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                              list={`models-${p.id}`}
                              placeholder={p.model}
                            />
                          )}
                          <datalist id={`models-${p.id}`}>
                            {suggestions.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </datalist>
                          {liveAccountModels.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setCustomModelEdit((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                              className="text-[10px] font-semibold text-slate-500 hover:text-[#0f8b8d] underline decoration-dotted"
                              title={customModelEdit[p.id] ? 'Back to the models found on this account' : 'Type a model id that is not in the list'}
                            >
                              {customModelEdit[p.id] ? 'Use library' : 'Custom id'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => loadAccountModels(true, p.id)}
                            disabled={accountBusy || !isConnected}
                            title="Ask this provider which models your subscription can use"
                            className="text-[10px] font-bold px-2 py-1 rounded-md border bg-white border-slate-200 text-slate-600 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d] disabled:opacity-40 flex items-center gap-1"
                          >
                            <RefreshCw className={`w-3 h-3 ${accountBusy ? 'animate-spin' : ''}`} />
                            Find models
                          </button>
                          <span className="text-[9px] font-mono text-slate-400">
                            {!isConnected
                              ? 'not signed in'
                              : liveAccountModels.length > 0
                                ? `${liveAccountModels.length} model${liveAccountModels.length === 1 ? '' : 's'} in library`
                                : accountBusy
                                  ? 'searching library…'
                                  : 'no models listed'}
                          </span>
                          {isConnected && accountError && (
                            <span className="basis-full text-[10px] leading-snug text-amber-600" title={accountError}>
                              {accountError.length > 220 ? accountError.slice(0, 217) + '…' : accountError}
                            </span>
                          )}
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

                        {/* The Test verdict, including the provider's exact refusal, stays
                            visible briefly so a plan limitation is never a silent failure. */}
                        {testState?.id === p.id && testState.status !== 'busy' && (
                          <p className={`text-[10px] leading-snug mt-1.5 ${testState.status === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {testState.status === 'ok'
                              ? 'Test passed — the model answered OK.'
                              : `Test failed: ${testState.detail ?? 'unknown error'}`}
                          </p>
                        )}

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
                      {(p.id === 'gemini' || p.id === 'opencode') ? (
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
                      ) : p.id === 'custom' ? (
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                            customEndpoints.length > 0
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}>
                            {customEndpoints.length > 0 ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Endpoint Saved</span>
                              </>
                            ) : (
                              <>
                                <Key className="w-3.5 h-3.5 text-slate-400" />
                                <span>No Endpoint</span>
                              </>
                            )}
                          </span>
                          <button
                            onClick={addNewCustomEndpoint}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:border-[#0f8b8d]/40 hover:text-[#0f8b8d] flex items-center gap-1.5 transition-colors"
                          >
                            <Key className="w-3.5 h-3.5 text-[#0f8b8d]" />
                            <span>{customEndpoints.length > 0 ? 'Update Endpoint' : 'Add Endpoint'}</span>
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
                      : selectedProvider.id === 'opencode'
                        ? 'OpenCode API Key'
                        : selectedProvider.id === 'nvidia'
                          ? 'NVIDIA API Key'
                          : selectedProvider.id === 'custom' && editingEndpoint
                            ? 'Edit Endpoint'
                            : selectedProvider.id === 'custom'
                              ? 'Custom API Key'
                              : `Sign in with ${selectedProvider.name}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedProvider.id === 'claude' 
                      ? 'Paste-Code Authorization Flow' 
                      : selectedProvider.id === 'gemini'
                        ? 'Key saved locally — never shown again'
                        : selectedProvider.id === 'opencode'
                          ? 'Console / Go key saved locally — never shown again'
                          : selectedProvider.id === 'nvidia'
                            ? 'Key saved locally — never shown again'
                            : selectedProvider.id === 'custom' && editingEndpoint
                              ? 'Configure your custom endpoint below.'
                              : selectedProvider.id === 'custom'
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

            {/* This is the real local flow, not a web demo: the code comes from the
                provider right now and the token is stored on this computer only. */}
            {selectedProvider.id !== 'gemini' && selectedProvider.id !== 'opencode' && selectedProvider.id !== 'custom' && (
              <p className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                {selectedProvider.id === 'claude'
                  ? 'Open the Claude approval page, sign in, then paste the code Claude shows you. The token stays on this computer.'
                  : `A one-time code is requested from ${selectedProvider.name.split(' ')[0]} now. Approve it on their page; this window polls until your subscription is connected. Your password is never entered here.`}
              </p>
            )}

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

            {/* Custom Endpoint: Edit Endpoint form */}
            {selectedProvider.id === 'custom' && editingEndpoint && (
              <div className="space-y-4 py-2">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Edit Endpoint</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    Configure a custom OpenAI-compatible endpoint. Saved to your user data directory (.env, outside the repo) and never displayed again or sent back to the browser.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">Name</label>
                  <input
                    type="text"
                    value={editingEndpoint.name}
                    onChange={(e) => setEditingEndpoint({ ...editingEndpoint, name: e.target.value })}
                    placeholder="e.g. My Custom Endpoint"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">Provider ID</label>
                  <input
                    type="text"
                    value={editingEndpoint.providerId}
                    onChange={(e) => setEditingEndpoint({ ...editingEndpoint, providerId: e.target.value })}
                    placeholder="e.g. vyceai"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">Endpoint URL</label>
                  <input
                    type="text"
                    value={editingEndpoint.endpointUrl}
                    onChange={(e) => setEditingEndpoint({ ...editingEndpoint, endpointUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">API Mode</label>
                  <div className="flex items-center gap-1 border border-slate-200 rounded-xl bg-slate-50 p-0.5">
                    {['auto-detect', 'chat-completions', 'responses-api', 'anthropic-messages'].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setEditingEndpoint({ ...editingEndpoint, apiMode: mode })}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
                          editingEndpoint.apiMode === mode
                            ? 'bg-[#0f8b8d] text-white'
                            : 'bg-transparent text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {mode === 'auto-detect' ? 'Auto-detect'
                         : mode === 'chat-completions' ? 'Chat Completions'
                         : mode === 'responses-api' ? 'Responses API'
                         : 'Anthropic Messages'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-700 block">Default Model</label>
                    <button
                      onClick={searchCustomModels}
                      disabled={isSearchingModels || !editingEndpoint.endpointUrl.trim() || !editingEndpoint.apiKey.trim()}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${
                        isSearchingModels ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-[#0f8b8d] text-white border-[#0f8b8d] hover:bg-[#0f8b8d]/90'
                      }`}
                    >
                      {isSearchingModels ? (
                        <Activity className="w-3 h-3 animate-spin" />
                      ) : (
                        <Search className="w-3 h-3" />
                      )}
                      {' '}
                      {isSearchingModels ? 'Searching…' : 'Search Models'}
                    </button>
                  </div>
                  {modelsSearchError && (
                    <div className="p-2 bg-rose-50 border border-rose-200 text-rose-800 text-[10px] rounded-xl">
                      {modelsSearchError}
                    </div>
                  )}
                  {discoveredModels.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Discovered Models</label>
                      <select
                        value={editingEndpoint.defaultModel}
                        onChange={(e) => setEditingEndpoint({ ...editingEndpoint, defaultModel: e.target.value })}
                        className="w-full text-xs font-mono p-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                      >
                        <option value="">Select a model…</option>
                        {discoveredModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-500">
                        Or type a custom model ID below:
                      </p>
                    </div>
                  )}
                  <input
                    type="text"
                    value={editingEndpoint.defaultModel}
                    onChange={(e) => setEditingEndpoint({ ...editingEndpoint, defaultModel: e.target.value })}
                    placeholder="e.g. deepseek-v4.1"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">Context</label>
                  <select
                    value={editingEndpoint.context}
                    onChange={(e) => setEditingEndpoint({ ...editingEndpoint, context: e.target.value })}
                    className="w-full text-xs font-mono p-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  >
                    <option value="Auto">Auto</option>
                    <option value="system">System</option>
                    <option value="developer">Developer</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">API Key</label>
                  <input
                    type="password"
                    value={editingEndpoint.apiKey}
                    onChange={(e) => setEditingEndpoint({ ...editingEndpoint, apiKey: e.target.value })}
                    placeholder="Leave blank to keep current key"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingEndpoint.useForNewChats}
                      onChange={(e) => setEditingEndpoint({ ...editingEndpoint, useForNewChats: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d]"
                    />
                    <span className="text-slate-600">Use for new chats</span>
                  </label>
                  <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editingEndpoint.discoverModels}
                      onChange={(e) => setEditingEndpoint({ ...editingEndpoint, discoverModels: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-[#0f8b8d] focus:ring-[#0f8b8d]"
                    />
                    <span className="text-slate-600">Discover models</span>
                  </label>
                </div>

                {endpointError && (
                  <div className="p-2 bg-rose-50 border border-rose-200 text-rose-800 text-[10px] rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                    <span>{endpointError}</span>
                  </div>
                )}

                {endpointTestResult && (
                  <div className={`p-2 rounded-xl text-[10px] flex items-center gap-2 ${
                    endpointTestResult.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'
                  }`}>
                    {endpointTestResult.ok ? <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" /> : <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />}
                    <span>{endpointTestResult.ok ? `✓ ${endpointTestResult.reply}` : `✗ ${endpointTestResult.error}`}</span>
                  </div>
                )}

                <div className="pt-2 flex items-center justify-between gap-2">
                  <button
                    onClick={cancelEditCustomEndpoint}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  {editingEndpoint.id ? (
                    <button
                      onClick={() => deleteCustomEndpoint(editingEndpoint.id)}
                      disabled={isSavingEndpoint}
                      className="px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl"
                    >
                      Delete
                    </button>
                  ) : null}
                  <button
                    onClick={() => testingEndpoint === editingEndpoint.id ? null : testCustomEndpoint(editingEndpoint.id)}
                    disabled={isSavingEndpoint || testingEndpoint === editingEndpoint.id}
                    className="px-4 py-2 text-xs font-semibold border border-slate-300 rounded-xl hover:bg-slate-50"
                  >
                    {testingEndpoint === editingEndpoint.id ? <Activity className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}{testingEndpoint === editingEndpoint.id ? ' Testing…' : ' Test'}
                  </button>
                  <button
                    onClick={saveCustomEndpoint}
                    disabled={isSavingEndpoint || !editingEndpoint.name.trim() || !editingEndpoint.endpointUrl.trim() || !editingEndpoint.apiKey.trim()}
                    className="px-4 py-2 text-xs font-bold bg-[#001432] hover:bg-[#13294b] disabled:opacity-40 text-white rounded-xl"
                  >
                    {isSavingEndpoint ? <Activity className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}{isSavingEndpoint ? ' Saving…' : ' Save'}
                  </button>
                </div>
              </div>
            )}

            {/* Custom Endpoint: Saved endpoints list */}
            {selectedProvider.id === 'custom' && !editingEndpoint && customEndpoints.length > 0 && (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-700">Saved Endpoints</span>
                  <button
                    onClick={addNewCustomEndpoint}
                    className="text-xs font-bold text-[#0f8b8d] hover:underline"
                  >
                    + New endpoint
                  </button>
                </div>
                <div className="space-y-1">
                  {customEndpoints.map((ep) => (
                    <div key={ep.id} className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 truncate">
                          <span>{ep.name}</span>
                          {ep.useForNewChats && <span className="px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-bold border border-emerald-200">Active</span>}
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-500">
                          <span>{ep.providerId}</span>
                          <span>•</span>
                          <span>{ep.apiMode}</span>
                          <span>•</span>
                          <span>{ep.defaultModel || '—'}</span>
                        </div>
                        <div className="text-[9px] font-mono text-slate-400 truncate">{ep.endpointUrl}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => editCustomEndpoint(ep)}
                          className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => testCustomEndpoint(ep.id)}
                          disabled={testingEndpoint === ep.id}
                          className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"
                          title="Test"
                        >
                          {testingEndpoint === ep.id ? <Activity className="w-2.5 h-2.5 animate-spin" /> : <Zap className="w-2.5 h-2.5" />}
                        </button>
                        <button
                          onClick={() => deleteCustomEndpoint(ep.id)}
                          className="p-1 hover:bg-rose-50 rounded text-rose-400 hover:text-rose-600"
                          title="Delete"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Endpoint: Empty state */}
            {selectedProvider.id === 'custom' && !editingEndpoint && customEndpoints.length === 0 && (
              <div className="space-y-4 py-2">
                <button
                  onClick={addNewCustomEndpoint}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-[#0f8b8d] hover:bg-slate-50 rounded-xl border border-slate-200"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Custom Endpoint</span>
                </button>
                <p className="text-[10px] text-slate-500">
                  No custom endpoints configured. Click "+ New endpoint" to add one.
                </p>
              </div>
            )}

            {/* Key-based providers: Gemini, OpenCode, NVIDIA */}
            {(selectedProvider.id === 'gemini' || selectedProvider.id === 'opencode' || selectedProvider.id === 'nvidia') && (
              <div className="space-y-4 py-2">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Server-Side Key Handling</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    {selectedProvider.id === 'opencode'
                      ? 'Create an API key in the OpenCode Console (console.opencode.ai) and paste it here. It is saved by the local server to your user data directory (.env, outside the repo) and is never displayed again or sent back to the browser. If you already use the OpenCode CLI on this machine, its stored key is used automatically.'
                      : selectedProvider.id === 'nvidia'
                        ? 'Create an API key in the NVIDIA build portal (build.nvidia.com) and paste it here. It is saved by the local server to your user data directory (.env, outside the repo) and is never displayed again or sent back to the browser.'
                        : 'Create the key in Google AI Studio and paste it here. It is saved by the local server to your user data directory (.env, outside the repo) and is never displayed again or sent back to the browser.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">
                    {selectedProvider.id === 'opencode'
                      ? 'OpenCode API Key'
                      : selectedProvider.id === 'nvidia'
                        ? 'NVIDIA API Key'
                        : 'Gemini API Key'}
                  </label>
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={selectedProvider.id === 'opencode' ? 'sk-… / your OpenCode Console API key'
                      : selectedProvider.id === 'nvidia'
                        ? 'nvapi-… / your NVIDIA API key'
                        : 'AIza… / your Gemini API key'}
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
                    onClick={handleSaveKey}
                    disabled={isSavingKey || !keyInput.trim()}
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
