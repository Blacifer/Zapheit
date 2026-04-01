import {
  ArrowLeft,
  Code2,
  Copy,
  Globe,
  Info,
  Key,
  Loader2,
  RefreshCw,
  Rocket,
  Server,
  Terminal,
  X,
} from 'lucide-react';
import type { AIAgent } from '../../../types';
import { api } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';

type DeployMethod = 'website' | 'api' | 'terminal' | 'advanced';
type DeployCodeTab = 'curl' | 'python' | 'nodejs' | 'php';

type RuntimeItem = {
  id: string;
  name: string;
  mode: string;
  status: string;
  last_heartbeat_at: string | null;
};

interface DeployAgentModalProps {
  deployAgent: AIAgent | null;
  deployAgentId: string;
  deployMethod: DeployMethod | null;
  setDeployMethod: (method: DeployMethod | null) => void;
  deployCodeTab: DeployCodeTab;
  setDeployCodeTab: (tab: DeployCodeTab) => void;
  deployApiKey: string | null;
  setDeployApiKey: (key: string | null) => void;
  setDeployApiKeyId: (id: string | null) => void;
  setDeployApiKeyMasked: (masked: string | null) => void;
  deployApiKeyLoading: boolean;
  setDeployApiKeyLoading: (loading: boolean) => void;
  deployWebsiteOrigin: string;
  setDeployWebsiteOrigin: (origin: string) => void;
  controlPlaneBaseUrl: string;
  closeDeploy: () => void;
  setAgents: (agents: AIAgent[] | ((currentAgents: AIAgent[]) => AIAgent[])) => void | Promise<void>;
  syncAgentPublishState: (agentId: string) => Promise<void>;
  loadDeploymentState: (agentId: string) => Promise<void>;
  runtimes: RuntimeItem[];
  selectedRuntimeId: string;
  setSelectedRuntimeId: (runtimeId: string) => void;
  deploymentLoading: boolean;
  currentDeployment: any | null;
  deployToRuntime: () => Promise<void>;
  createTestChatJob: () => Promise<void>;
  approveTestJob: () => Promise<void>;
  testJobBusy: boolean;
  testJob: any | null;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
}

export function DeployAgentModal({
  deployAgent,
  deployAgentId,
  deployMethod,
  setDeployMethod,
  deployCodeTab,
  setDeployCodeTab,
  deployApiKey,
  setDeployApiKey,
  setDeployApiKeyId,
  setDeployApiKeyMasked,
  deployApiKeyLoading,
  setDeployApiKeyLoading,
  deployWebsiteOrigin,
  setDeployWebsiteOrigin,
  controlPlaneBaseUrl,
  closeDeploy,
  setAgents,
  syncAgentPublishState,
  loadDeploymentState,
  runtimes,
  selectedRuntimeId,
  setSelectedRuntimeId,
  deploymentLoading,
  currentDeployment,
  deployToRuntime,
  createTestChatJob,
  approveTestJob,
  testJobBusy,
  testJob,
  onOpenOperationsPage,
}: DeployAgentModalProps) {
  const agentName = deployAgent?.name || 'Agent';
  const widgetSrc = typeof window !== 'undefined' ? `${window.location.origin}/widget.js` : '/widget.js';
  const hasFullKey = !!deployApiKey;
  const websiteKeyDisplay = deployApiKey || 'YOUR_WEBSITE_KEY';
  const apiKeyDisplay = deployApiKey || 'YOUR_API_KEY';
  const chatEndpoint = `${controlPlaneBaseUrl}/v1/agents/${deployAgentId}/chat`;

  const copyText = (text: string, label = 'Copied') =>
    void navigator.clipboard.writeText(text).then(() => toast.success(label)).catch(() => toast.error('Copy failed'));

  const normalizeWebsiteOrigin = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      return new URL(withScheme).origin;
    } catch {
      return '';
    }
  };

  const generateFreshKey = async (target: 'website' | 'api' | 'terminal') => {
    setDeployApiKeyLoading(true);
    try {
      const normalizedOrigin = target === 'website' ? normalizeWebsiteOrigin(deployWebsiteOrigin) : '';
      if (target === 'website' && deployWebsiteOrigin.trim() && !normalizedOrigin) {
        toast.error('Enter a valid website origin like https://www.example.com');
        return;
      }
      const created = await api.apiKeys.create({
        name: target === 'website' ? `Website key - ${agentName}` : `Deployment key - ${agentName}`,
        environment: 'production',
        preset: 'custom',
        permissions: ['agents.read'],
        description: target === 'website' ? 'Scoped website widget key' : 'Scoped deployment key for agent chat',
        rateLimit: target === 'website' ? 120 : 1000,
        allowedOrigins: target === 'website' && normalizedOrigin ? [normalizedOrigin] : [],
        allowedAgentIds: [deployAgentId],
        deploymentType: target,
      });
      if (created.success && (created.data as any)?.key) {
        setDeployApiKey((created.data as any).key);
        setDeployApiKeyId((created.data as any).id || null);
        setDeployApiKeyMasked(null);
        toast.success(target === 'website' ? 'Website key ready - copy it now' : 'Fresh key ready - copy it now');
      } else {
        toast.error('Failed to generate key');
      }
    } finally {
      setDeployApiKeyLoading(false);
    }
  };

  const handleMethodSelect = (method: Exclude<DeployMethod, 'advanced'>) => {
    setDeployMethod(method);
    void api.agents.updatePublishState(deployAgentId, { deploy_method: method }).then((res) => {
      if (!res.success) return;
      setAgents((prev) => (prev as AIAgent[]).map((agent) => (
        agent.id === deployAgentId
          ? { ...agent, metadata: { ...(agent as any).metadata, deploy_method: method } }
          : agent
      )));
      void syncAgentPublishState(deployAgentId);
      void loadDeploymentState(deployAgentId);
    });
  };

  const scriptTag = `<script\n  src="${widgetSrc}"\n  data-agent-id="${deployAgentId}"\n  data-public-key="${websiteKeyDisplay}"\n></script>`;
  const codeSnippets: Record<DeployCodeTab, string> = {
    curl: `curl -X POST ${chatEndpoint} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKeyDisplay}" \\\n  -d '{"message": "Hello"}'`,
    python: `import requests\n\nresponse = requests.post(\n    "${chatEndpoint}",\n    headers={"Authorization": "Bearer ${apiKeyDisplay}"},\n    json={"message": "Hello"}\n)\nprint(response.json()["reply"])`,
    nodejs: `const res = await fetch("${chatEndpoint}", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer ${apiKeyDisplay}",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ message: "Hello" })\n});\nconst { reply } = await res.json();\nconsole.log(reply);`,
    php: `<?php\n$ch = curl_init("${chatEndpoint}");\ncurl_setopt($ch, CURLOPT_POST, 1);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "Authorization: Bearer ${apiKeyDisplay}",\n  "Content-Type: application/json"\n]);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(["message" => "Hello"]));\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$body = json_decode(curl_exec($ch), true);\necho $body["reply"];`,
  };
  const terminalChat = `curl -fsSL ${window.location.origin}/chat.sh | bash -s -- ${apiKeyDisplay} ${deployAgentId}`;
  const terminalCurl = `curl -X POST ${chatEndpoint} \\\n  -H "Authorization: Bearer ${apiKeyDisplay}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`w-full ${deployMethod === 'advanced' ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] rounded-3xl border border-slate-700 bg-slate-950/95 shadow-2xl overflow-hidden flex flex-col transition-all`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            {deployMethod && (
              <button
                onClick={() => setDeployMethod(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors mr-1"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="h-9 w-9 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
              <Rocket className="w-4 h-4 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {!deployMethod ? 'Deploy Agent' : deployMethod === 'website' ? 'Website' : deployMethod === 'api' ? 'In My App' : deployMethod === 'terminal' ? 'Terminal' : 'Advanced (Self-Host)'}
              </h2>
              <p className="text-xs text-slate-500">{agentName}</p>
            </div>
          </div>
          <button onClick={closeDeploy} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!deployMethod && (
            <div className="p-6">
              <p className="text-sm text-slate-400 mb-5">Where do you want to use <span className="text-white font-medium">{agentName}</span>?</p>

              {deployApiKeyLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                  <Loader2 className="w-3 h-3 animate-spin" />Preparing your access key...
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 mb-6">
                {([
                  { id: 'website', icon: Globe, label: 'Website', desc: 'Use on any site with custom code', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20 hover:border-teal-400/40' },
                  { id: 'api', icon: Code2, label: 'In My App', desc: 'Python, JS, curl - your code', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20 hover:border-blue-400/40' },
                  { id: 'terminal', icon: Terminal, label: 'Terminal', desc: 'Chat from your computer', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20 hover:border-purple-400/40' },
                ] as const).map(({ id, icon: Icon, label, desc, color, bg }) => (
                  <button
                    key={id}
                    onClick={() => handleMethodSelect(id)}
                    className={`flex flex-col items-center text-center p-4 rounded-2xl border ${bg} transition-all cursor-pointer group`}
                  >
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-3 ${bg}`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <p className="text-sm font-semibold text-white mb-1">{label}</p>
                    <p className="text-xs text-slate-500 leading-snug">{desc}</p>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setDeployMethod('advanced')}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
              >
                Need to self-host on your own server? <span className="underline">Advanced -&gt;</span>
              </button>
            </div>
          )}

          {deployMethod === 'website' && (
            <div className="p-6 space-y-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
                <p className="text-xs text-slate-400 mb-2">Allowed website origin</p>
                <input
                  type="text"
                  value={deployWebsiteOrigin}
                  onChange={(e) => setDeployWebsiteOrigin(e.target.value)}
                  placeholder="https://www.example.com"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-teal-500"
                />
                <p className="mt-2 text-xs text-slate-500">Recommended: enter the live website origin where this widget will run. This website key will only work there.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400 mb-1">Paste this into any website builder or HTML site that supports custom JavaScript, before <code className="text-slate-300">&lt;/body&gt;</code>:</p>
                <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                  <pre className="text-xs text-teal-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{scriptTag}</pre>
                </div>
                <button
                  onClick={() => copyText(scriptTag, 'Code copied!')}
                  className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500/15 border border-teal-500/25 text-teal-300 text-xs font-semibold hover:bg-teal-500/25 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />Copy code
                </button>
              </div>

              {hasFullKey ? (
                <div className="space-y-2">
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-300">Your website key is already in the code above. <strong>Copy it now</strong> - it won't be shown again.</p>
                  </div>
                  <p className="text-xs text-slate-500 pl-1">Your website key does not expire unless you revoke it.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex items-start gap-3">
                  <Key className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-amber-300 mb-2">The code above has a placeholder - <code className="bg-slate-800 px-1 rounded">YOUR_WEBSITE_KEY</code>. Generate a website key to replace it with the real value.</p>
                    <button
                      onClick={() => void generateFreshKey('website')}
                      disabled={deployApiKeyLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${deployApiKeyLoading ? 'animate-spin' : ''}`} />
                      {deployApiKeyLoading ? 'Generating...' : 'Generate website key'}
                    </button>
                    <p className="text-xs text-slate-500 mt-2">This key is scoped to this agent and, if provided, to the website origin above.</p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300">What happens next:</p>
                <p>- The same embed works for Wix, Webflow, WordPress, Shopify, or custom HTML</p>
                <p>- A chat bubble appears in the bottom-right corner of your site</p>
                <p>- Visitors can message your agent directly and conversations appear in your Workspace</p>
              </div>
            </div>
          )}

          {deployMethod === 'api' && (
            <div className="p-6 space-y-4">
              {hasFullKey ? (
                <div className="flex gap-2">
                  <div className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-emerald-400/80 mb-0.5">Your API Key <span className="text-amber-400">(shown once - copy it now)</span></p>
                      <code className="text-xs text-emerald-200 font-mono break-all">{deployApiKey}</code>
                    </div>
                    <button onClick={() => copyText(deployApiKey!, 'API key copied')} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500 mb-0.5">Agent ID</p>
                      <code className="text-xs text-slate-300 font-mono">{deployAgentId.slice(0, 8)}...</code>
                    </div>
                    <button onClick={() => copyText(deployAgentId, 'Agent ID copied')} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Key className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white mb-0.5">Your key is hidden for security</p>
                    <p className="text-xs text-slate-400 mb-3">API keys can only be seen once when first created. Generate a fresh key to copy it and use it in your code.</p>
                    <button
                      onClick={() => void generateFreshKey('api')}
                      disabled={deployApiKeyLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${deployApiKeyLoading ? 'animate-spin' : ''}`} />
                      {deployApiKeyLoading ? 'Generating...' : 'Generate a fresh key'}
                    </button>
                    <p className="text-xs text-slate-500 mt-2">Once generated, your key does not expire unless you revoke it.</p>
                  </div>
                </div>
              )}

              <div>
                <div className="flex gap-1 mb-2">
                  {(['curl', 'python', 'nodejs', 'php'] as DeployCodeTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setDeployCodeTab(tab)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${deployCodeTab === tab ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {tab === 'nodejs' ? 'Node.js' : tab}
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                  <pre className="text-xs text-slate-200 font-mono whitespace-pre overflow-x-auto leading-relaxed">{codeSnippets[deployCodeTab]}</pre>
                  <button
                    onClick={() => copyText(codeSnippets[deployCodeTab], 'Code copied!')}
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {hasFullKey && (
                <div className="space-y-2">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <p className="text-xs text-emerald-300">Your key is already in the code above. <strong>Copy it now</strong> - it won't be shown again.</p>
                  </div>
                  <p className="text-xs text-slate-500 pl-1">Your API key does not expire unless you revoke it.</p>
                </div>
              )}
            </div>
          )}

          {deployMethod === 'terminal' && (
            <div className="p-6 space-y-5">
              {!hasFullKey && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 flex items-start gap-3">
                  <Key className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-amber-300 mb-2">The commands below use <code className="bg-slate-800 px-1 rounded">YOUR_API_KEY</code> as a placeholder. Generate a real key first.</p>
                    <button
                      onClick={() => void generateFreshKey('terminal')}
                      disabled={deployApiKeyLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${deployApiKeyLoading ? 'animate-spin' : ''}`} />
                      {deployApiKeyLoading ? 'Generating...' : 'Generate API key'}
                    </button>
                  </div>
                </div>
              )}
              {hasFullKey && (
                <div className="space-y-2">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <p className="text-xs text-emerald-300">Your key is already in the commands below. <strong>Copy and run them now</strong> - the key won't be shown again.</p>
                  </div>
                  <p className="text-xs text-slate-500 pl-1">Your API key does not expire unless you revoke it.</p>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-400 mb-2">Open your terminal and run this to start chatting:</p>
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                  <pre className="text-xs text-purple-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{terminalChat}</pre>
                  <button
                    onClick={() => copyText(terminalChat, 'Command copied!')}
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">No installation needed. Works on Mac, Linux, and WSL.</p>
              </div>

              <div>
                <p className="text-xs text-slate-400 mb-2">Or send a single message:</p>
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                  <pre className="text-xs text-slate-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{terminalCurl}</pre>
                  <button
                    onClick={() => copyText(terminalCurl, 'Command copied!')}
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {deployMethod === 'advanced' && (
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 flex items-start gap-2 mb-2">
                <Info className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-slate-400">For self-hosting on your own server or VPC. Register a runtime worker first in <span className="text-cyan-400 font-medium">Settings -&gt; Runtime Workers</span>, then select it below to deploy your agent.</p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current deployment</p>
                  {currentDeployment ? (
                    <p className="mt-2 text-sm text-slate-200">
                      Runtime: <span className="font-mono text-cyan-200">{currentDeployment.runtime_instance_id}</span>
                      <span className="ml-3 px-2 py-0.5 rounded-full text-xs border border-slate-700 bg-slate-900 text-slate-300">{currentDeployment.status}</span>
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">Not deployed yet.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-xs font-bold text-cyan-300">1</span>
                  <p className="text-sm font-semibold text-white">Select a runtime worker</p>
                </div>
                {runtimes.length > 0 ? (
                  <select value={selectedRuntimeId} onChange={(e) => setSelectedRuntimeId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500">
                    {runtimes.map((runtime) => (
                      <option key={runtime.id} value={runtime.id}>
                        {runtime.name} - {runtime.mode} - {runtime.status}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-center">
                    <p className="text-sm text-slate-400 mb-3">No runtime workers registered yet.</p>
                    <button
                      type="button"
                      onClick={() => { closeDeploy(); onOpenOperationsPage?.('runtime-workers'); }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-sm font-semibold hover:bg-cyan-500/25 transition-colors"
                    >
                      <Server className="w-3.5 h-3.5" />
                      Go to Runtime Workers -&gt;
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/15 border border-blue-500/25 text-xs font-bold text-blue-300">2</span>
                  <p className="text-sm font-semibold text-white">Deploy agent to runtime</p>
                </div>
                <button type="button" onClick={() => void deployToRuntime()} disabled={deploymentLoading || !selectedRuntimeId} className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold text-sm hover:from-blue-600 hover:to-cyan-500 disabled:opacity-40 transition-all">
                  {deploymentLoading ? 'Deploying...' : !selectedRuntimeId ? 'Select a runtime first' : `Deploy to ${runtimes.find((runtime) => runtime.id === selectedRuntimeId)?.name || 'runtime'}`}
                </button>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-2">Test execution</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void createTestChatJob()} disabled={testJobBusy || !currentDeployment} className="flex-1 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60">
                    {testJobBusy ? 'Working...' : 'Create test job'}
                  </button>
                  <button type="button" onClick={() => void approveTestJob()} disabled={testJobBusy || !testJob?.job?.id} className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-white text-sm font-semibold disabled:opacity-60">
                    {testJobBusy ? 'Working...' : 'Approve test job'}
                  </button>
                </div>
                {testJob?.job?.id && (() => {
                  const status = testJob.job.status as string;
                  const statusMap: Record<string, [string, string]> = {
                    pending_approval: ['text-amber-400', 'approval required'],
                    queued: ['text-blue-400', 'waiting for runtime'],
                    running: ['text-cyan-400 animate-pulse', 'executing...'],
                    succeeded: ['text-emerald-400', 'done!'],
                    failed: ['text-red-400', 'failed'],
                    canceled: ['text-slate-400', 'canceled'],
                  };
                  const [color, label] = statusMap[status] || ['text-slate-200', status];
                  return (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300">
                      <div>Job: <span className="font-mono text-cyan-200">{testJob.job.id}</span></div>
                      <div className="mt-1">Status: <span className={`font-semibold ${color}`}>{status}</span> <span className="text-slate-500">({label})</span></div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
