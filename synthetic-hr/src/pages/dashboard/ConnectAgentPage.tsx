import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, PlugZap, RefreshCw, Rocket, ShieldCheck, Terminal, X } from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { supabase } from '../../lib/supabase-client';

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
  const apiUrl = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api') as string;
  const base = apiUrl.replace(/\/api\/?$/, '');
  return `${base}/v1`;
}

function getApiBaseUrl() {
  const apiUrl = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api') as string;
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
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedKeyId, setSelectedKeyId] = useState<string>('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdKeyId, setCreatedKeyId] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyOutput, setVerifyOutput] = useState<string | null>(null);
  const [modelId, setModelId] = useState('google/gemini-2.0-flash');
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [verifyKeyInput, setVerifyKeyInput] = useState('');
  const [showVerifyKey, setShowVerifyKey] = useState(false);

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

    setModels((prev) => (prev.length > 0 ? prev : [
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai' },
      { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic' },
    ]));
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
        environment: 'development',
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
      setCreatedKeyId(row.id);
      setSelectedKeyId(row.id);
      setVerifyKeyInput('');
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
      toast.error('Create a new key here, or paste a key temporarily to run verification.');
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
          { role: 'user', content: 'Return: SyntheticHR agent connection verified.' },
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

  const nodeSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    return `// Node.js (OpenAI SDK) via SyntheticHR gateway\n` +
      `// 1) npm i openai\n` +
      `// 2) export RASI_API_KEY="sk_..."\n` +
      `// 3) export RASI_AGENT_ID="${agent}"\n` +
      `\n` +
      `import OpenAI from "openai";\n` +
      `\n` +
      `const client = new OpenAI({\n` +
      `  apiKey: process.env.RASI_API_KEY,\n` +
      `  baseURL: "${gatewayBaseUrl}",\n` +
      `  defaultHeaders: {\n` +
      `    "x-rasi-agent-id": process.env.RASI_AGENT_ID,\n` +
      `  },\n` +
      `});\n` +
      `\n` +
      `const res = await client.chat.completions.create({\n` +
      `  model: "${modelId}",\n` +
      `  messages: [{ role: "user", content: "Hello from a customer-hosted agent." }],\n` +
      `});\n` +
      `\n` +
      `console.log(res.choices[0].message.content);\n`;
  }, [gatewayBaseUrl, modelId, selectedAgentId]);

  const pythonSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    return `# Python (OpenAI SDK) via SyntheticHR gateway\n` +
      `# 1) pip install openai\n` +
      `# 2) export RASI_API_KEY="sk_..."\n` +
      `# 3) export RASI_AGENT_ID="${agent}"\n` +
      `\n` +
      `from openai import OpenAI\n` +
      `import os\n` +
      `\n` +
      `client = OpenAI(\n` +
      `  api_key=os.environ["RASI_API_KEY"],\n` +
      `  base_url="${gatewayBaseUrl}",\n` +
      `  default_headers={\n` +
      `    "x-rasi-agent-id": os.environ["RASI_AGENT_ID"],\n` +
      `  },\n` +
      `)\n` +
      `\n` +
      `res = client.chat.completions.create(\n` +
      `  model="${modelId}",\n` +
      `  messages=[{"role": "user", "content": "Hello from a customer-hosted agent."}],\n` +
      `)\n` +
      `\n` +
      `print(res.choices[0].message.content)\n`;
  }, [gatewayBaseUrl, modelId, selectedAgentId]);

  const curlSnippet = useMemo(() => {
    const agent = selectedAgentId || '<AGENT_ID>';
    return `curl "${gatewayBaseUrl}/chat/completions" \\\n` +
      `  -H "Authorization: Bearer $RASI_API_KEY" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -H "x-rasi-agent-id: ${agent}" \\\n` +
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
          <h1 className="text-3xl font-bold text-white">Connect Existing Agent</h1>
          <p className="mt-2 text-slate-400 max-w-3xl">
            Route your existing agent traffic through the SyntheticHR gateway so we can capture costs, conversations, incidents, and black box evidence.
            Use the snippets below in your server-side agent runtime.
          </p>
        </div>
        <div className="flex gap-2">
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
              Runtime target
            </div>

            <label className="block">
              <span className="text-xs text-slate-400">Agent</span>
              <select
                id="connect_agent_select"
                name="connect_agent_select"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="">Select an agent…</option>
                {props.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-slate-400">Model (for sample call)</span>
              <div className="mt-1 flex items-center gap-2">
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
                className="mt-2 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
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
              <p className="mt-2 text-xs text-slate-400">
                Loaded {models.length || 0} models. This only affects the sample call and snippets.
              </p>
            </label>

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
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-semibold">
                <KeyRound className="w-4 h-4 text-cyan-300" />
                API key
              </div>
              <button
                type="button"
                onClick={refreshKeys}
                className="px-3 py-1.5 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 text-slate-200 text-xs border border-slate-700 flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            <label className="block">
              <span className="text-xs text-slate-400">Select existing key (masked)</span>
              <select
                id="connect_key_select"
                name="connect_key_select"
                value={selectedKeyId}
                onChange={(event) => setSelectedKeyId(event.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="">Create a new runtime key</option>
                {keys
                  .filter((key) => key.status === 'active')
                  .map((key) => (
                    <option key={key.id} value={key.id}>{key.name} · {key.masked_key || key.key_prefix}</option>
                  ))}
              </select>
              <p className="mt-2 text-xs text-slate-400">
                We can’t re-show secret keys after creation. Use “Create a new runtime key” for copy/paste snippets.
              </p>
            </label>

            {!selectedKeyId ? (
              <button
                type="button"
                onClick={createKey}
                disabled={creatingKey}
                className="w-full px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm flex items-center justify-center gap-2"
              >
                {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Create runtime key (shown once)
              </button>
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3">
                <div className="text-xs text-slate-400">Selected key</div>
                <div className="mt-1 text-sm text-white">{selectedKey?.name || 'Key selected'}</div>
                {createdKeyId === selectedKeyId && createdSecret ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="font-mono text-xs text-slate-200">{maskKey(createdSecret)}</div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(createdSecret, 'API key')}
                      className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs border border-slate-700"
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-amber-200/90">
                    Secret not available. Create a new key in this wizard if you need copy/paste.
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3 space-y-2">
              <div className="text-xs text-slate-400">Temporary key for verification (not saved)</div>
              <div className="flex items-center gap-2">
                <input
                  id="connect_verify_key"
                  name="connect_verify_key"
                  type={showVerifyKey ? 'text' : 'password'}
                  value={verifyKeyInput}
                  onChange={(event) => setVerifyKeyInput(event.target.value)}
                  placeholder={createdSecret ? 'Using newly created key' : 'Paste a key if you selected an existing masked key'}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  disabled={Boolean(createdSecret)}
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
                  disabled={Boolean(createdSecret) || verifyKeyInput.length === 0}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Safer option: create a new key above so you never need to paste secrets here.
              </p>
            </div>

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
              This runs a single request through the gateway and should update Coverage, Costs, and Usage.
            </p>

            {verifyOutput ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-100 text-sm whitespace-pre-wrap">
                {verifyOutput}
              </div>
            ) : null}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/30 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Integration contract</h2>
                <p className="mt-1 text-slate-400 text-sm">
                  Send all model calls through `baseURL = {gatewayBaseUrl}` and include `x-rasi-agent-id` so the request is attributed to the right agent.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-cyan-300" />
                OpenAI-compatible `/v1`
              </div>
            </div>
          </div>

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
