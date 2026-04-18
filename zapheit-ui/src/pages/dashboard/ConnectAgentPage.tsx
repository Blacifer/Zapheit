import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, PlugZap, RefreshCw, Rocket, ShieldCheck, Terminal, X } from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { supabase } from '../../lib/supabase-client';
import { getFrontendConfig } from '../../lib/config';
import { FALLBACK_MODELS, DEFAULT_MODEL_ID } from '../../lib/models';

type WizardStep = 1 | 2 | 3;

type ApiKeyRow = {
  id: string;
  name: string;
  status: 'active' | 'expired' | 'revoked';
  environment: 'production' | 'staging' | 'development';
  masked_key: string;
  key_prefix: string;
  rate_limit?: number | null;
  created_at?: string;
  last_used_at?: string | null;
};

type LiveModelRow = {
  id: string;
  name?: string;
  provider?: string;
};

function maskKey(value: string) {
  if (!value) return '';
  if (value.length <= 10) return value;
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function getGatewayBaseUrl() {
  const apiUrl = (getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string;
  const base = apiUrl.replace(/\/api\/?$/, '');
  return `${base}/v1`;
}

function getApiBaseUrl() {
  const apiUrl = (getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string;
  return apiUrl.replace(/\/+$/, '');
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label}`);
  }
}

function WizardSteps(props: { step: WizardStep; onChange: (step: WizardStep) => void }) {
  const items: Array<{ id: WizardStep; label: string }> = [
    { id: 1, label: 'Choose agent' },
    { id: 2, label: 'API key' },
    { id: 3, label: 'Integrate + verify' },
  ];

  return (
    <div className="flex items-center gap-2">
      {items.map((item) => {
        const active = props.step === item.id;
        const done = props.step > item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onChange(item.id)}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors',
              active ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-100' : 'bg-slate-900/30 border-slate-700 text-slate-300 hover:bg-slate-800/40 hover:text-white',
            ].join(' ')}
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={[
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                active ? 'bg-cyan-400 text-slate-950' : done ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-200',
              ].join(' ')}
            >
              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : item.id}
            </span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function CodeBlock(props: { title: string; language: string; code: string; onCopy: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Terminal className="w-4 h-4 text-cyan-300" />
          {props.title}
          <span className="text-xs font-semibold text-slate-400">({props.language})</span>
        </div>
        <button
          type="button"
          onClick={props.onCopy}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs border border-slate-700 flex items-center gap-2"
        >
          <Copy className="w-3.5 h-3.5" />
          Copy
        </button>
      </div>
      <pre className="p-4 text-xs md:text-sm overflow-auto text-slate-200">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

export default function ConnectAgentPage(props: {
  agents: AIAgent[];
  onNavigate: (page: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<WizardStep>(1);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedKeyId, setSelectedKeyId] = useState<string>('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyOutput, setVerifyOutput] = useState<string | null>(null);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [verifyKeyInput, setVerifyKeyInput] = useState('');
  const [showVerifyKey, setShowVerifyKey] = useState(false);
  const [useExistingKey, setUseExistingKey] = useState(false);
  const [confirmStoredKey, setConfirmStoredKey] = useState(false);
  const [showAdvancedModel, setShowAdvancedModel] = useState(false);

  const selectedAgent = useMemo(
    () => props.agents.find((agent) => agent.id === selectedAgentId) || null,
    [props.agents, selectedAgentId],
  );

  const selectedKey = useMemo(
    () => keys.find((key) => key.id === selectedKeyId) || null,
    [keys, selectedKeyId],
  );

  const gatewayBaseUrl = getGatewayBaseUrl();
  const apiBaseUrl = getApiBaseUrl();
  const activeSecret = createdSecret || verifyKeyInput.trim(); // created key is shown once; otherwise allow a temporary paste (not saved)

  const canContinueFromStep1 = Boolean(selectedAgentId);
  const canContinueFromStep2 = useExistingKey ? Boolean(selectedKeyId) : Boolean(createdSecret && confirmStoredKey);

  const refreshKeys = async () => {
    const res = await api.apiKeys.list();
    if (!res.success || !Array.isArray(res.data)) {
      setKeys([]);
      return;
    }
    setKeys(res.data as unknown as ApiKeyRow[]);
  };

  const refreshModels = async () => {
    setModelsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const response = await fetch(`${apiBaseUrl}/models`, { headers });
      if (response.ok) {
        const json = await response.json();
        if (json?.success && Array.isArray(json?.data)) {
          const mapped = (json.data as LiveModelRow[])
            .filter((row) => typeof row?.id === 'string' && row.id.includes('/'))
            .map((row) => ({
              id: row.id,
              name: (row.name || row.id).toString(),
              provider: (row.provider || row.id.split('/')[0] || 'unknown').toString(),
            }))
            .slice(0, 400);

          setModels(mapped);
          if (!mapped.find((m) => m.id === modelId) && mapped.length > 0) {
            setModelId(mapped[0].id);
          }
        }
      }
    } catch {
      // fall back below
    } finally {
      setModelsLoading(false);
    }

    setModels((prev) => (prev.length > 0 ? prev : FALLBACK_MODELS));
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refreshKeys();
      await refreshModels();
      if (props.agents.length > 0) {
        setSelectedAgentId(props.agents[0].id);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createKey = async () => {
    setCreatingKey(true);
    setVerifyOutput(null);
    try {
      const res = await api.apiKeys.create({
        name: `Agent runtime key (${new Date().toLocaleDateString('en-IN')})`,
        environment: 'production',
        preset: 'full_access',
        description: 'Created by Connect Agent wizard. Use server-side only.',
        rateLimit: 240,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || 'Unable to create key');
        return;
      }
      const row = res.data as any;
      setCreatedSecret(row.key);
      setSelectedKeyId(row.id);
      setVerifyKeyInput('');
      setConfirmStoredKey(false);
      setUseExistingKey(false);
      toast.success('Key created (shown once)');
      await refreshKeys();
    } finally {
      setCreatingKey(false);
    }
  };

  const verify = async () => {
    if (!selectedAgentId) {
      toast.error('Select an agent first');
      return;
    }
    if (!activeSecret) {
      toast.error('Paste an API key to run verification (or create a new one in step 2).');
      return;
    }

    setVerifying(true);
    setVerifyOutput(null);
    try {
      const res = await api.gateway.chatCompletions({
        apiKey: activeSecret,
        agentId: selectedAgentId,
        model: modelId,
        messages: [
          { role: 'system', content: 'Reply in one sentence.' },
          { role: 'user', content: 'Return: Zapheit agent connection verified.' },
        ],
        temperature: 0.2,
      });

      if (!res.success) {
        toast.error(res.error || 'Verification failed');
        setVerifyOutput(res.error || 'Verification failed');
        return;
      }

      const content = res.data?.choices?.[0]?.message?.content || '(no text returned)';
      setVerifyOutput(content);
      toast.success('Verified. Telemetry should appear in Coverage, Costs, and Usage.');
      await props.onRefresh();
    } finally {
      setVerifying(false);
    }
  };

  const filteredModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
  }, [models, modelFilter]);

  const envSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    const key = createdSecret ? createdSecret : '$ZAPHEIT_API_KEY';
    return `# Zapheit gateway\n` +
      `export ZAPHEIT_BASE_URL="${gatewayBaseUrl}"\n` +
      `export ZAPHEIT_API_KEY="${key}"\n` +
      `export ZAPHEIT_AGENT_ID="${agent}"\n`;
  }, [createdSecret, gatewayBaseUrl, selectedAgentId]);

  const nodeSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    return `// Node.js (OpenAI SDK) via Zapheit gateway\n` +
      `// 1) npm i openai\n` +
      `// 2) ${createdSecret ? 'Use the .env exports below (includes API key)' : 'export ZAPHEIT_API_KEY="sk_..."'}\n` +
      `// 3) export ZAPHEIT_AGENT_ID="${agent}"\n` +
      `\n` +
      `import OpenAI from "openai";\n` +
      `\n` +
      `const client = new OpenAI({\n` +
      `  apiKey: process.env.ZAPHEIT_API_KEY,\n` +
      `  baseURL: process.env.ZAPHEIT_BASE_URL || "${gatewayBaseUrl}",\n` +
      `  defaultHeaders: {\n` +
      `    "x-zapheit-agent-id": process.env.ZAPHEIT_AGENT_ID,\n` +
      `  },\n` +
      `});\n` +
      `\n` +
      `const res = await client.chat.completions.create({\n` +
      `  model: "${modelId}",\n` +
      `  messages: [{ role: "user", content: "Hello from a customer-hosted agent." }],\n` +
      `});\n` +
      `\n` +
      `console.log(res.choices[0].message.content);\n`;
  }, [createdSecret, gatewayBaseUrl, modelId, selectedAgentId]);

  const pythonSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    return `# Python (OpenAI SDK) via Zapheit gateway\n` +
      `# 1) pip install openai\n` +
      `# 2) ${createdSecret ? 'Use the .env exports below (includes API key)' : 'export ZAPHEIT_API_KEY="sk_..."'}\n` +
      `# 3) export ZAPHEIT_AGENT_ID="${agent}"\n` +
      `\n` +
      `from openai import OpenAI\n` +
      `import os\n` +
      `\n` +
      `client = OpenAI(\n` +
      `  api_key=os.environ["ZAPHEIT_API_KEY"],\n` +
      `  base_url=os.environ.get("ZAPHEIT_BASE_URL", "${gatewayBaseUrl}"),\n` +
      `  default_headers={\n` +
      `    "x-zapheit-agent-id": os.environ["ZAPHEIT_AGENT_ID"],\n` +
      `  },\n` +
      `)\n` +
      `\n` +
      `res = client.chat.completions.create(\n` +
      `  model="${modelId}",\n` +
      `  messages=[{"role": "user", "content": "Hello from a customer-hosted agent."}],\n` +
      `)\n` +
      `\n` +
      `print(res.choices[0].message.content)\n`;
  }, [createdSecret, gatewayBaseUrl, modelId, selectedAgentId]);

  const curlSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    return `curl "${'${ZAPHEIT_BASE_URL:-' + gatewayBaseUrl + '}'}/chat/completions" \\\n` +
      `  -H "Authorization: Bearer $ZAPHEIT_API_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -H "x-zapheit-agent-id: ${agent}" \\\n` +
      `  -d '{\n` +
      `    "model": "${modelId}",\n` +
      `    "messages": [{ "role": "user", "content": "Hello from a customer-hosted agent." }]\n` +
      `  }'\n`;
  }, [gatewayBaseUrl, modelId, selectedAgentId]);

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Advanced / Developer Setup</h1>
          <p className="mt-2 text-slate-400 max-w-3xl">
            This is the fallback path for admins or developers connecting a custom system through the Zapheit gateway.
            Non-technical users should publish agents from Fleet into Integrations instead of handling API keys or runtime code here.
          </p>
        </div>
        <div className="flex gap-2">
          <WizardSteps
            step={step}
            onChange={(next) => {
              if (next === 2 && !canContinueFromStep1) {
                toast.error('Choose an agent first');
                return;
              }
              if (next === 3 && !canContinueFromStep2) {
                toast.error('Finish API key setup first');
                return;
              }
              setStep(next);
            }}
          />
          <button
            type="button"
            onClick={() => props.onNavigate('coverage')}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm border border-slate-700 flex items-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            Open Coverage
          </button>
          <button
            type="button"
            onClick={() => props.onNavigate('api-analytics')}
            className="px-4 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700 flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            API Analytics
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-5 space-y-4">
            <div className="flex items-center gap-2 text-white font-semibold">
              <PlugZap className="w-4 h-4 text-cyan-300" />
              Step {step}: {step === 1 ? 'Choose agent' : step === 2 ? 'API key' : 'Integrate + verify'}
            </div>

            {step === 1 && (
              <>
                <label className="block">
                  <span className="text-xs text-slate-400">Agent</span>
                  <select
                    id="connect_agent_select"
                    name="connect_agent_select"
                    value={selectedAgentId}
                    onChange={(event) => {
                      setSelectedAgentId(event.target.value);
                      setVerifyOutput(null);
                    }}
                    className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="">Select an agent…</option>
                    {props.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                </label>

                {selectedAgent ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3">
                    <div className="text-xs text-slate-400">Selected agent</div>
                    <div className="mt-1 text-sm text-white font-semibold">{selectedAgent.name}</div>
                    <div className="mt-1 font-mono text-xs text-slate-300 break-all">{selectedAgent.id}</div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100 text-sm">
                    Choose the agent you want to attribute traffic to.
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!canContinueFromStep1) {
                        toast.error('Choose an agent first');
                        return;
                      }
                      setStep(2);
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-60"
                    disabled={!canContinueFromStep1}
                  >
                    Continue
                  </button>
                </div>

                <p className="text-xs text-slate-400">
                  If your “agent” is already deployed in Fleet and runs via the Runtime worker, you usually don’t need this page.
                  This is for external apps that call LLM APIs directly.
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3 space-y-3">
                  <div className="text-xs text-slate-400">Recommended</div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-white font-semibold">Create a new server key</div>
                      <div className="mt-1 text-xs text-slate-400">Best for copy/paste setup. Shown once, store it securely.</div>
                    </div>
                    <button
                      type="button"
                      onClick={createKey}
                      disabled={creatingKey}
                      className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
                    >
                      {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                      Create key
                    </button>
                  </div>

                  {createdSecret ? (
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3">
                      <div className="text-xs text-cyan-100/90">API key (shown once)</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-cyan-100 break-all">{createdSecret}</div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(createdSecret, 'API key')}
                          className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs border border-slate-700"
                        >
                          Copy
                        </button>
                      </div>

                      <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={confirmStoredKey}
                          onChange={(event) => setConfirmStoredKey(event.target.checked)}
                          className="accent-cyan-400"
                        />
                        I stored this key in a password manager or server secret store.
                      </label>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-400">Advanced</div>
                      <div className="text-sm text-white font-semibold">Use an existing key</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUseExistingKey((prev) => !prev);
                        setVerifyOutput(null);
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-xs border border-slate-700 font-semibold"
                    >
                      {useExistingKey ? 'Hide' : 'Choose key'}
                    </button>
                  </div>

                  {useExistingKey ? (
                    <>
                      <label className="block">
                        <span className="text-xs text-slate-400">Select existing key (masked)</span>
                        <select
                          id="connect_key_select"
                          name="connect_key_select"
                          value={selectedKeyId}
                          onChange={(event) => setSelectedKeyId(event.target.value)}
                          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                        >
                          <option value="">Select a key…</option>
                          {keys
                            .filter((key) => key.status === 'active')
                            .map((key) => (
                              <option key={key.id} value={key.id}>{key.name} · {key.masked_key || key.key_prefix}</option>
                            ))}
                        </select>
                      </label>
                      {selectedKey ? (
                        <div className="text-xs text-slate-400">
                          Secret can’t be re-shown. You’ll use the env var `ZAPHEIT_API_KEY` in your app.
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700 font-semibold"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canContinueFromStep2) {
                        if (useExistingKey) toast.error('Select an existing key');
                        else toast.error('Create a key and confirm it’s stored');
                        return;
                      }
                      setStep(3);
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-60"
                    disabled={!canContinueFromStep2}
                  >
                    Continue
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3">
                  <div className="text-xs text-slate-400">Gateway base URL</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="font-mono text-xs text-slate-200 truncate">{gatewayBaseUrl}</div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(gatewayBaseUrl, 'Gateway URL')}
                      className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs border border-slate-700"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <CodeBlock
                  title="Environment variables"
                  language="bash"
                  code={envSnippet}
                  onCopy={() => copyToClipboard(envSnippet, 'Env vars')}
                />

                <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-400">Optional: verify now</div>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedModel((prev) => !prev)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-xs border border-slate-700 font-semibold"
                    >
                      {showAdvancedModel ? 'Hide advanced' : 'Advanced'}
                    </button>
                  </div>

                  {!createdSecret ? (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-400">Paste API key (not saved)</div>
                      <div className="flex items-center gap-2">
                        <input
                          id="connect_verify_key"
                          name="connect_verify_key"
                          type={showVerifyKey ? 'text' : 'password'}
                          value={verifyKeyInput}
                          onChange={(event) => setVerifyKeyInput(event.target.value)}
                          placeholder="sk_..."
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowVerifyKey((prev) => !prev)}
                          className="px-3 py-2 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-xs border border-slate-700"
                          aria-label={showVerifyKey ? 'Hide key' : 'Show key'}
                        >
                          {showVerifyKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVerifyKeyInput('')}
                          className="px-3 py-2 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-xs border border-slate-700"
                          aria-label="Clear key"
                          disabled={verifyKeyInput.length === 0}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Using the newly created key for verification.</div>
                  )}

                  {showAdvancedModel ? (
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <div className="text-xs text-slate-400">Model (for sample call)</div>
                      <div className="flex items-center gap-2">
                        <input
                          id="connect_model_filter"
                          name="connect_model_filter"
                          value={modelFilter}
                          onChange={(event) => setModelFilter(event.target.value)}
                          placeholder="Search models (e.g. gpt-4o, gemini, claude)"
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                        />
                        <button
                          type="button"
                          onClick={refreshModels}
                          disabled={modelsLoading}
                          className="px-3 py-2 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-xs border border-slate-700 flex items-center gap-2"
                        >
                          {modelsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Catalog
                        </button>
                      </div>
                      <select
                        id="connect_model_select"
                        name="connect_model_select"
                        value={modelId}
                        onChange={(event) => setModelId(event.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                        disabled={modelsLoading}
                      >
                        {filteredModels.length === 0 ? (
                          <option value={modelId}>{modelId}</option>
                        ) : (
                          filteredModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.provider} · {model.name}
                            </option>
                          ))
                        )}
                      </select>
                      <div className="text-xs text-slate-500">Loaded {models.length || 0} models. This only affects the sample call and snippets.</div>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={verify}
                    disabled={verifying || !selectedAgentId || !activeSecret}
                    className="w-full px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm flex items-center justify-center gap-2"
                  >
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    Verify with one gateway request
                  </button>
                  <p className="text-xs text-slate-400">
                    Sends one request through the gateway and should update Coverage, Costs, and Usage.
                  </p>

                  {verifyOutput ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-100 text-sm whitespace-pre-wrap">
                      {verifyOutput}
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-4 py-2.5 rounded-xl bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-sm border border-slate-700 font-semibold"
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Integration contract</h2>
                <p className="mt-1 text-slate-400 text-sm">
                  Send all model calls through the gateway and include `x-zapheit-agent-id` so traffic is attributed to the right agent.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-cyan-300" />
                OpenAI-compatible `/v1`
              </div>
            </div>
          </div>

          {step < 3 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-800/20 p-8 text-slate-300">
              <div className="text-lg font-semibold text-white">Copy/paste snippets appear in step 3</div>
              <div className="mt-2 text-sm text-slate-400">
                Step 1 chooses the agent for attribution. Step 2 creates or selects a key. Step 3 gives you the exact code to paste and an optional verification call.
              </div>
            </div>
          ) : (
            <>
              <CodeBlock
                title="Node runtime snippet"
                language="TypeScript/ESM"
                code={nodeSnippet}
                onCopy={() => copyToClipboard(nodeSnippet, 'Node snippet')}
              />

              <CodeBlock
                title="Python runtime snippet"
                language="Python"
                code={pythonSnippet}
                onCopy={() => copyToClipboard(pythonSnippet, 'Python snippet')}
              />

              <CodeBlock
                title="cURL sanity check"
                language="bash"
                code={curlSnippet}
                onCopy={() => copyToClipboard(curlSnippet, 'cURL snippet')}
              />
            </>
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-5">
            <div className="flex items-center gap-2 text-white font-semibold">
              <ShieldCheck className="w-4 h-4 text-cyan-300" />
              Operational guidance
            </div>
            <ul className="mt-3 text-sm text-slate-300 space-y-2 list-disc list-inside">
              <li>Keep the API key server-side only. Never embed it in web/mobile clients.</li>
              <li>Use one key per environment (staging vs production) to keep telemetry clean.</li>
              <li>After first traffic, validate Coverage shows gateway observed, then confirm Costs and Usage update.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
