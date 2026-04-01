import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, BriefcaseBusiness, Building2, CheckCircle2, ChevronLeft, ChevronRight, Copy, Gavel, HandCoins, Headset, Key, Loader2, Rocket, ShieldCheck, ShoppingBag, Sparkles, Trash2, Wrench, Zap } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { AIAgent } from '../../types';
import { supabase } from '../../lib/supabase-client';
import { getFrontendConfig } from '../../lib/config';

type StepId = 'workspace' | 'agent' | 'apps' | 'test' | 'verify';
const STEP_ORDER: StepId[] = ['workspace', 'agent', 'apps', 'test', 'verify'];

type LiveModel = { id: string; name?: string; provider?: string };

function maskKey(value: string) {
  if (!value) return '';
  if (value.length <= 10) return value;
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function nowPlusHours(hours: number) {
  const dt = new Date(Date.now() + hours * 60 * 60 * 1000);
  return dt.toISOString();
}

export default function GettingStartedPage(props: {
  agents: AIAgent[];
  onNavigate: (page: string) => void;
  onRefresh: () => Promise<void>;
  storageScope: string;
}) {
  const [step, setStep] = useState<StepId>('workspace');
  const [isBusy, setIsBusy] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);

  const stepIndex = STEP_ORDER.indexOf(step);
  const goNext = () => { if (stepIndex < STEP_ORDER.length - 1) setStep(STEP_ORDER[stepIndex + 1]); };
  const goPrev = () => { if (stepIndex > 0) setStep(STEP_ORDER[stepIndex - 1]); };

  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<any | null>(null);

  const [models, setModels] = useState<LiveModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [apiKeyId, setApiKeyId] = useState<string | null>(null);
  const [apiKeySecret, setApiKeySecret] = useState<string | null>(null);
  const [gatewayModelsLoading, setGatewayModelsLoading] = useState(false);
  const [gatewayModelsOk, setGatewayModelsOk] = useState<boolean | null>(null);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(null);
  const [gatewayModelSample, setGatewayModelSample] = useState<string[]>([]);

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [newAgentName, setNewAgentName] = useState('HR Onboarding Assistant');
  const [newAgentType, setNewAgentType] = useState<'hr' | 'support' | 'sales' | 'legal' | 'finance' | 'custom'>('hr');
  const [newAgentPlatform, setNewAgentPlatform] = useState<'web' | 'slack' | 'whatsapp' | 'teams'>('web');
  const [selectedModelId, setSelectedModelId] = useState('google/gemini-2.0-flash');

  const [testPrompt, setTestPrompt] = useState('Write a short welcome message for a new employee joining today.');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [installedAppCount, setInstalledAppCount] = useState(0);

  const selectedAgent = useMemo(() => {
    return props.agents.find((agent) => agent.id === selectedAgentId) || null;
  }, [props.agents, selectedAgentId]);

  const canRunGatewayTest = Boolean(apiKeySecret && selectedModelId && (selectedAgentId || newAgentName.trim().length > 0));

  const loadCoverage = async () => {
    setCoverageLoading(true);
    setCoverageError(null);
    const res = await api.admin.getCoverageStatus();
    if (res.success && res.data) {
      setCoverage(res.data);
      setCoverageLoading(false);
      return;
    }
    setCoverage(null);
    setCoverageError(res.error || 'Unable to load coverage status');
    setCoverageLoading(false);
  };

  const loadModels = async () => {
    setModelsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch(`${apiUrl}/models`, { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const mapped = (json.data as any[]).map((model) => ({
            id: model.id,
            name: model.name || model.id,
            provider: model.provider || model.id.split('/')[0],
          }));
          setModels(mapped);
        }
      }
    } catch {
      // ignore and fallback below
    }

    setModels((prev) => (prev.length > 0 ? prev : [
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
      { id: 'anthropic/claude-3-haiku', name: 'Claude Haiku', provider: 'anthropic' },
      { id: 'google/gemini-2.0-flash', name: 'Gemini Flash', provider: 'google' },
    ]));
    setModelsLoading(false);
  };

  useEffect(() => {
    loadCoverage();
    loadModels();
    if (props.agents.length > 0) {
      setSelectedAgentId(props.agents[0].id);
    }
    api.marketplace.getInstalled().then((res) => {
      if (res.success && Array.isArray(res.data)) setInstalledAppCount(res.data.length);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label}`);
    }
  };

  const loadGatewayModels = async (key: string) => {
    setGatewayModelsLoading(true);
    setGatewayModelsOk(null);
    setGatewayModelsError(null);
    setGatewayModelSample([]);
    try {
      const res = await api.gateway.listModels({ apiKey: key });
      if (!res.success || !res.data) {
        setGatewayModelsOk(false);
        setGatewayModelsError(res.error || 'Unable to reach gateway /v1/models');
        return;
      }

      const ids = Array.isArray(res.data?.data)
        ? (res.data.data as any[]).map((item) => item?.id).filter(Boolean)
        : [];

      setGatewayModelsOk(true);
      setGatewayModelSample(ids.slice(0, 6));
    } finally {
      setGatewayModelsLoading(false);
    }
  };

  const explainGatewayError = (message: string) => {
    const text = message || '';
    if (text.toLowerCase().includes('provider key missing for openrouter')) {
      return 'Missing OpenRouter runtime key. Set RASI_OPENROUTER_API_KEY (or OPENROUTER_API_KEY) in the backend environment (Railway variables for prod, or synthetic-hr-api/.env for local) and restart/redeploy the backend.';
    }
    if (text.toLowerCase().includes('provider key missing for openai')) {
      return 'Missing OpenAI runtime key. Set RASI_OPENAI_API_KEY (or OPENAI_API_KEY) in the backend environment (Railway variables for prod, or synthetic-hr-api/.env for local) and restart/redeploy the backend.';
    }
    if (text.toLowerCase().includes('provider key missing for anthropic')) {
      return 'Missing Anthropic runtime key. Set RASI_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in the backend environment (Railway variables for prod, or synthetic-hr-api/.env for local) and restart/redeploy the backend.';
    }
    if (text.toLowerCase().includes('not authenticated')) {
      return 'Not authenticated. Refresh the page and sign in again.';
    }
    if (text.toLowerCase().includes('invalid api key') || text.toLowerCase().includes('api key')) {
      return 'The SyntheticHR API key may be invalid or revoked. Create a new temporary key and try again.';
    }
    return message;
  };

  const createTempKey = async () => {
    setIsBusy(true);
    setTestResult(null);
    try {
      const res = await api.apiKeys.create({
        name: 'Onboarding smoke key',
        environment: 'development',
        preset: 'full_access',
        description: 'Temporary key created by Getting Started wizard.',
        expiresAt: nowPlusHours(12),
        rateLimit: 120,
      });

      if (!res.success || !res.data) {
        toast.error(res.error || 'Unable to create key');
        return;
      }

      setApiKeyId((res.data as any).id);
      setApiKeySecret((res.data as any).key);
      toast.success('Temporary key created');
      await loadGatewayModels((res.data as any).key);
      setStep('test');
    } finally {
      setIsBusy(false);
    }
  };

  const revokeTempKey = async () => {
    if (!apiKeyId) return;
    setIsBusy(true);
    try {
      const res = await api.apiKeys.revoke(apiKeyId);
      if (!res.success) {
        toast.error(res.error || 'Unable to revoke key');
        return;
      }
      toast.success('Key revoked');
      setApiKeyId(null);
      setApiKeySecret(null);
    } finally {
      setIsBusy(false);
    }
  };

  const ensureAgent = async (): Promise<AIAgent | null> => {
    if (selectedAgent) return selectedAgent;

    const name = newAgentName.trim();
    if (!name) {
      toast.error('Agent name is required');
      return null;
    }

    const res = await api.agents.create({
      name,
      description: 'Created by Getting Started wizard.',
      agent_type: newAgentType,
      platform: newAgentPlatform,
      model_name: selectedModelId,
      system_prompt: 'You are an onboarding assistant for a company. Be concise, helpful, and policy-aware.',
      budget_limit: 0,
      config: {},
    });

    if (!res.success || !res.data) {
      toast.error(res.error || 'Unable to create agent');
      return null;
    }

    const created = res.data as any;
    toast.success('Agent created');
    await props.onRefresh();
    setSelectedAgentId(created.id);
    return created as AIAgent;
  };

  const runGatewayTest = async () => {
    if (!apiKeySecret) return;
    setIsBusy(true);
    setTestResult(null);

    try {
      const agent = await ensureAgent();
      if (!agent) return;

      const res = await api.gateway.chatCompletions({
        apiKey: apiKeySecret,
        model: selectedModelId,
        agentId: agent.id,
        messages: [
          { role: 'system', content: 'You are SyntheticHR. Respond as a helpful HR assistant.' },
          { role: 'user', content: testPrompt },
        ],
        temperature: 0.3,
      });

      if (!res.success || !res.data) {
        toast.error(explainGatewayError(res.error || 'Gateway test failed'));
        return;
      }

      const content = res.data?.choices?.[0]?.message?.content || '';
      setTestResult(content || '(No text returned)');
      toast.success('Gateway test succeeded');
      setStep('verify');
      await loadCoverage();
    } finally {
      setIsBusy(false);
    }
  };

  const finishSetup = async () => {
    setIsBusy(true);
    try {
      if (apiKeyId) {
        await api.apiKeys.revoke(apiKeyId);
      }
      localStorage.setItem(`synthetic_hr_onboarding_completed:${props.storageScope}`, new Date().toISOString());
      toast.success('Setup complete');
      props.onNavigate('overview');
    } finally {
      setIsBusy(false);
    }
  };

  const StepPill = (p: { id: StepId; label: string; icon: any; done?: boolean }) => {
    const active = step === p.id;
    return (
      <button
        type="button"
        onClick={() => setStep(p.id)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
          active
            ? 'bg-cyan-500/10 border-cyan-500/30 text-white'
            : 'bg-slate-900/20 border-slate-700 text-slate-300 hover:bg-slate-800/40'
        }`}
        aria-current={active ? 'step' : undefined}
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
          active ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-300'
        }`}>
          <p.icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{p.label}</span>
            {p.done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : null}
          </div>
        </div>
      </button>
    );
  };

  const hasGatewayTraffic = Boolean(coverage?.telemetry?.gatewayObserved);
  const hasAnyAgent = (coverage?.agents?.total ?? props.agents.length) > 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Get To First Value</h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Connect one agent, connect one app, run one tracked test, and confirm that SyntheticHR is giving you usable visibility.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => props.onNavigate('coverage')}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm border border-slate-700"
          >
            Open Coverage
          </button>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem(`synthetic_hr_onboarding_dismissed:${props.storageScope}`, new Date().toISOString());
              props.onNavigate('overview');
            }}
            className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
          >
            Skip for now
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Step {stepIndex + 1} of {STEP_ORDER.length}</span>
          <span>{Math.round(((stepIndex + 1) / STEP_ORDER.length) * 100)}% complete</span>
        </div>
        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full"
            initial={false}
            animate={{ width: `${((stepIndex + 1) / STEP_ORDER.length) * 100}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Confetti burst on completion */}
      <AnimatePresence>
        {showConfetti && (
          <motion.div
            key="confetti"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center"
          >
            <div className="text-center">
              {['🎉', '✨', '🚀', '🎊', '⭐'].map((emoji, i) => (
                <motion.span
                  key={i}
                  className="absolute text-4xl"
                  initial={{ opacity: 1, y: 0, x: 0 }}
                  animate={{
                    opacity: 0,
                    y: -120 - i * 20,
                    x: (i - 2) * 60,
                  }}
                  transition={{ duration: 1.4, delay: i * 0.08 }}
                  style={{ left: `calc(50% + ${(i - 2) * 40}px)` }}
                >
                  {emoji}
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          <StepPill id="workspace" label="Know your setup" icon={ShieldCheck} done={!coverageLoading && !coverageError} />
          <StepPill id="agent" label="Choose first agent" icon={Sparkles} done={Boolean(selectedAgentId) || hasAnyAgent} />
          <StepPill id="apps" label="Connect an app" icon={ShoppingBag} done={installedAppCount > 0} />
          <StepPill id="test" label="Run one test" icon={Rocket} done={Boolean(testResult)} />
          <StepPill id="verify" label="See first insight" icon={CheckCircle2} done={hasGatewayTraffic} />
        </div>

        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-6">
            {step === 'workspace' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">Know your setup</h2>
                  <button
                    type="button"
                    onClick={loadCoverage}
                    className="px-3 py-1.5 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                    disabled={coverageLoading}
                  >
                    {coverageLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>

                {coverageLoading ? (
                  <div className="flex items-center gap-3 text-slate-300">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading coverage status…
                  </div>
                ) : coverageError ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
                    {coverageError}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4">
                      <div className="text-xs text-slate-400">What is running?</div>
                      <div className="text-2xl font-bold text-white">{coverage?.agents?.total ?? props.agents.length}</div>
                      <div className="text-xs text-slate-400 mt-1">Active agents: {coverage?.agents?.active ?? 0}</div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4">
                      <div className="text-xs text-slate-400">What is visible?</div>
                      <div className={`text-2xl font-bold ${hasGatewayTraffic ? 'text-emerald-300' : 'text-slate-200'}`}>
                        {hasGatewayTraffic ? 'Yes' : 'No'}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">Coverage score: {coverage?.telemetry?.coverageScore ?? 0}</div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4">
                      <div className="text-xs text-slate-400">What needs setup?</div>
                      <div className="text-2xl font-bold text-white">{coverage?.apiKeys?.active ?? 0}</div>
                      <div className="text-xs text-slate-400 mt-1">Active runtime keys · Used 30d: {coverage?.apiKeys?.recentlyUsed30d ?? 0}</div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('agent')}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === 'agent' && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-white">Choose your first agent</h2>
                <p className="text-slate-400">Pick an existing agent or create one quickly so your first test has a clear owner.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4 space-y-3">
                    <div className="text-sm font-semibold text-white">Select existing</div>
                    <select
                      id="getting_started_agent_select"
                      name="getting_started_agent_select"
                      value={selectedAgentId}
                      onChange={(event) => setSelectedAgentId(event.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="">Create a new agent</option>
                      {props.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    {selectedAgent ? (
                      <div className="text-xs text-slate-400">
                        Using: <span className="text-slate-200">{selectedAgent.name}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4 space-y-3">
                    <div className="text-sm font-semibold text-white">New agent details</div>
                    <input
                      id="getting_started_agent_name"
                      name="getting_started_agent_name"
                      value={newAgentName}
                      onChange={(event) => setNewAgentName(event.target.value)}
                      placeholder="Agent name"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                      disabled={Boolean(selectedAgentId)}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        id="getting_started_agent_type"
                        name="getting_started_agent_type"
                        value={newAgentType}
                        onChange={(event) => setNewAgentType(event.target.value as any)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                        disabled={Boolean(selectedAgentId)}
                      >
                        <option value="hr">HR</option>
                        <option value="support">Support</option>
                        <option value="sales">Sales</option>
                        <option value="legal">Legal</option>
                        <option value="finance">Finance</option>
                        <option value="custom">Custom</option>
                      </select>
                      <select
                        id="getting_started_agent_platform"
                        name="getting_started_agent_platform"
                        value={newAgentPlatform}
                        onChange={(event) => setNewAgentPlatform(event.target.value as any)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                        disabled={Boolean(selectedAgentId)}
                      >
                        <option value="web">Web</option>
                        <option value="slack">Slack</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="teams">Teams</option>
                      </select>
                    </div>
                    <div className="text-xs text-slate-400">
                      Keep this simple. You can fine-tune the model and controls later.
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Model</div>
                    <button
                      type="button"
                      onClick={loadModels}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs border border-slate-700"
                      disabled={modelsLoading}
                    >
                      {modelsLoading ? 'Loading…' : 'Reload'}
                    </button>
                  </div>
                  <select
                    id="getting_started_model"
                    name="getting_started_model"
                    value={selectedModelId}
                    onChange={(event) => setSelectedModelId(event.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                    disabled={modelsLoading}
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {(model.provider ? `${model.provider} · ` : '')}{model.name || model.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('apps')}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm"
                  >
                    Continue to apps
                  </button>
                </div>
              </div>
            )}

            {step === 'apps' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-white">Connect an app</h2>
                  <p className="text-slate-400 mt-1 text-sm">
                    Apps give your agents real capabilities — like processing refunds, classifying support tickets, or sourcing candidates. Pick a use case to get started.
                  </p>
                </div>

                {installedAppCount > 0 ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-white">{installedAppCount} app{installedAppCount !== 1 ? 's' : ''} connected</p>
                      <p className="text-xs text-emerald-200/80 mt-0.5">Your agents are ready to use them.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { icon: BriefcaseBusiness, label: 'Hiring',            color: '#7C3AED', desc: 'LinkedIn + Greenhouse' },
                      { icon: Headset,           label: 'Support',           color: '#2563EB', desc: 'Zendesk + Freshdesk' },
                      { icon: HandCoins,         label: 'Finance',           color: '#DC2626', desc: 'Stripe + QuickBooks' },
                      { icon: Building2,         label: 'Sales',             color: '#059669', desc: 'HubSpot + Salesforce' },
                      { icon: Wrench,            label: 'IT / Access',       color: '#D97706', desc: 'Okta + Jira SM' },
                      { icon: Gavel,             label: 'Compliance',        color: '#0891B2', desc: 'ClearTax' },
                    ].map(({ icon: Icon, label, color, desc }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => props.onNavigate('apps')}
                        className="flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-700 bg-slate-900/30 hover:bg-slate-800/50 text-left transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color + '25', border: `1px solid ${color}40` }}>
                          <Icon className="w-4 h-4" style={{ color }} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white leading-tight">{label}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => props.onNavigate('apps')}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm flex items-center gap-2"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    Browse App Store
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep('test')}
                    className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700 flex items-center gap-2"
                  >
                    {installedAppCount > 0 ? (
                      <><Zap className="w-4 h-4 text-emerald-400" /> Continue to test</>
                    ) : (
                      <><ArrowRight className="w-4 h-4" /> Skip for now</>
                    )}
                  </button>
                </div>
              </div>
            )}

            {step === 'test' && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-white">Run one tracked test</h2>
                <p className="text-slate-400">
                  Send one safe test message through the runtime so SyntheticHR can prove it is capturing real visibility.
                </p>

                <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Secure test connection</div>
                      <div className="text-xs text-slate-400 mt-1">
                        We use a short-lived key for this test and revoke it when setup is complete.
                      </div>
                    </div>
                    {apiKeySecret ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                        Ready
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={createTempKey}
                        disabled={isBusy}
                        className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm flex items-center gap-2"
                      >
                        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                        Prepare test connection
                      </button>
                    )}
                  </div>

                  {apiKeySecret ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono text-slate-100">{maskKey(apiKeySecret)}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(apiKeySecret, 'Key')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setShowAdvancedSetup((value) => !value)}
                    className="text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
                  >
                    {showAdvancedSetup ? 'Hide advanced setup' : 'Show advanced setup'}
                  </button>

                  {showAdvancedSetup ? (
                    <div className="rounded-xl border border-slate-700/80 bg-black/20 p-4 space-y-3">
                      <p className="text-sm text-slate-300">
                        Advanced setup lets you inspect the temporary key and manually test the gateway before sending a tracked request.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => apiKeySecret ? loadGatewayModels(apiKeySecret) : createTempKey()}
                          disabled={gatewayModelsLoading || isBusy}
                          className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                        >
                          {gatewayModelsLoading ? 'Checking gateway…' : 'Check /v1/models'}
                        </button>
                        {apiKeySecret ? (
                          <button
                            type="button"
                            onClick={revokeTempKey}
                            disabled={isBusy}
                            className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            Revoke key
                          </button>
                        ) : null}
                      </div>

                      {gatewayModelsOk !== null ? (
                        <div className={`rounded-xl border p-3 text-sm ${
                          gatewayModelsOk
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                        }`}>
                          {gatewayModelsOk ? (
                            <div className="space-y-1">
                              <div className="font-semibold">Gateway reachable</div>
                              <div className="text-emerald-100/90">
                                Sample models: <span className="font-mono">{gatewayModelSample.join(', ') || 'n/a'}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="font-semibold">Gateway check failed</div>
                              <div className="text-rose-100/90">{explainGatewayError(gatewayModelsError || 'Unable to reach /v1/models')}</div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <textarea
                  id="getting_started_test_prompt"
                  name="getting_started_test_prompt"
                  value={testPrompt}
                  onChange={(event) => setTestPrompt(event.target.value)}
                  className="w-full min-h-[140px] bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white"
                />

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={runGatewayTest}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm flex items-center gap-2"
                    disabled={isBusy || !canRunGatewayTest}
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    Run tracked test
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep('verify')}
                    className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                  >
                    Skip test
                  </button>
                </div>

                {testResult ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100 whitespace-pre-wrap">
                    {testResult}
                  </div>
                ) : null}
              </div>
            )}

            {step === 'verify' && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-white">See your first insight</h2>

                <div className="rounded-xl border border-slate-700 bg-slate-900/30 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Status</div>
                    <button
                      type="button"
                      onClick={loadCoverage}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs border border-slate-700"
                      disabled={coverageLoading}
                    >
                      {coverageLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                  <div className="text-sm text-slate-300">
                    Visibility confirmed: <span className={hasGatewayTraffic ? 'text-emerald-300' : 'text-slate-200'}>{hasGatewayTraffic ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="text-sm text-slate-300">
                    Last tracked request: <span className="text-slate-200">{coverage?.telemetry?.lastTrackedAt ? new Date(coverage.telemetry.lastTrackedAt).toLocaleString() : 'Not yet'}</span>
                  </div>
                  <div className="text-sm text-slate-300">
                    Last model observed: <span className="text-slate-200">{coverage?.telemetry?.lastTrackedModel || 'Unknown'}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={finishSetup}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm flex items-center gap-2"
                    disabled={isBusy}
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Finish setup
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onNavigate('costs')}
                    className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                  >
                    Open costs
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onNavigate('overview')}
                    className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                  >
                    Open overview
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onNavigate('agents')}
                    className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                  >
                    Open agents
                  </button>
                </div>

                {apiKeySecret ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
                    <div className="flex items-center gap-2 font-semibold">
                      <Key className="w-4 h-4" />
                      Temporary key still active
                    </div>
                    <p className="text-sm text-amber-100/90 mt-1">
                      It will expire automatically, but you can revoke it now.
                    </p>
                    <button
                      type="button"
                      onClick={revokeTempKey}
                      className="mt-3 px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700"
                      disabled={isBusy}
                    >
                      Revoke key
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            {/* Prev / Next navigation */}
            <div className="mt-6 pt-4 border-t border-slate-700 flex items-center justify-between">
              <button
                type="button"
                onClick={goPrev}
                disabled={stepIndex === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 text-sm border border-slate-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="text-xs text-slate-500 hidden sm:block">
                {STEP_ORDER.map((id, i) => (
                  <button
                    key={id}
                    onClick={() => setStep(id)}
                    className={`inline-block w-2 h-2 rounded-full mx-0.5 transition-colors ${
                      id === step ? 'bg-cyan-400' : i < stepIndex ? 'bg-emerald-500' : 'bg-slate-700'
                    }`}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </span>
              {stepIndex < STEP_ORDER.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowConfetti(true);
                    setTimeout(() => setShowConfetti(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Complete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
