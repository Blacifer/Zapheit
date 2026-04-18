import { useState, useEffect } from 'react';
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Gavel,
  HandCoins,
  Headset,
  Loader2,
  Search,
  Shield,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  INTEGRATION_PACKS,
  PACK_DOMAIN_AGENTS,
  type DomainAgentType,
  type IntegrationPackId,
} from '../../lib/integration-packs';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase-client';
import { getFrontendConfig } from '../../lib/config';
import { toast } from '../../lib/toast';

type LiveModel = {
  id: string;
  name: string;
  provider: string;
  pricing?: { prompt?: string; completion?: string };
};

const FALLBACK_MODELS: LiveModel[] = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', pricing: { prompt: '0.000005', completion: '0.000015' } },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic', pricing: { prompt: '0.00000025', completion: '0.00000125' } },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'google', pricing: { prompt: '0.0000001', completion: '0.0000004' } },
];

interface DomainAgentLibraryPageProps {
  initialPackId?: IntegrationPackId | null;
  initialAgentId?: string | null;
  onDeploy: (agentData: {
    name: string;
    description: string;
    agent_type: string;
    platform: string;
    model_name: string;
    system_prompt: string;
    primary_pack?: string | null;
    integration_ids?: string[];
    config: Record<string, any>;
  }) => Promise<void>;
  onNavigate?: (page: string) => void;
}

const PACK_ICONS: Record<IntegrationPackId, React.ElementType> = {
  recruitment: BriefcaseBusiness,
  support: Headset,
  sales: Building2,
  it: Wrench,
  finance: HandCoins,
  compliance: Gavel,
};

const PACK_COLORS: Record<IntegrationPackId, string> = {
  recruitment: 'text-violet-300',
  support: 'text-blue-300',
  sales: 'text-emerald-300',
  it: 'text-amber-300',
  finance: 'text-rose-300',
  compliance: 'text-sky-300',
};

const PACK_BORDER: Record<IntegrationPackId, string> = {
  recruitment: 'border-violet-400/20 bg-violet-500/[0.04]',
  support: 'border-blue-400/20 bg-blue-500/[0.04]',
  sales: 'border-emerald-400/20 bg-emerald-500/[0.04]',
  it: 'border-amber-400/20 bg-amber-500/[0.04]',
  finance: 'border-rose-400/20 bg-rose-500/[0.04]',
  compliance: 'border-sky-400/20 bg-sky-500/[0.04]',
};

const PACK_ICON_BG: Record<IntegrationPackId, string> = {
  recruitment: 'border-violet-400/25 bg-violet-500/15',
  support: 'border-blue-400/25 bg-blue-500/15',
  sales: 'border-emerald-400/25 bg-emerald-500/15',
  it: 'border-amber-400/25 bg-amber-500/15',
  finance: 'border-rose-400/25 bg-rose-500/15',
  compliance: 'border-sky-400/25 bg-sky-500/15',
};

function AgentCard({
  agent,
  packId,
  isActivating,
  isActivated,
  onActivate,
}: {
  agent: DomainAgentType;
  packId: IntegrationPackId;
  isActivating: boolean;
  isActivated: boolean;
  onActivate: (agent: DomainAgentType, name: string, model: string, systemPrompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const [editModel, setEditModel] = useState(agent.modelName);
  const [editSystemPrompt, setEditSystemPrompt] = useState(agent.systemPrompt);
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  const PackIcon = PACK_ICONS[packId];
  const colorClass = PACK_COLORS[packId];
  const borderClass = PACK_BORDER[packId];
  const iconBgClass = PACK_ICON_BG[packId];

  useEffect(() => {
    if (!expanded || liveModels.length > 0) return;
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
          const res = await fetch(`${apiUrl}/models`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              setLiveModels(json.data);
              return;
            }
          }
        }
      } catch { /* fall through */ }
      setLiveModels(FALLBACK_MODELS);
    };
    load();
  }, [expanded]);

  const selectedModelData = liveModels.find(m => m.id === editModel || m.name === editModel);
  const monthlyCostUsd = selectedModelData?.pricing
    ? 10_000_000 * (parseFloat(selectedModelData.pricing.prompt || '0') * 0.5 + parseFloat(selectedModelData.pricing.completion || '0') * 0.5)
    : null;
  const filteredModels = liveModels.filter(m =>
    !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.provider.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <div className={cn('rounded-2xl border p-5 flex flex-col gap-3 transition-all', borderClass)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-xl border flex items-center justify-center shrink-0', iconBgClass)}>
            <Bot className={cn('w-4.5 h-4.5', colorClass)} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{agent.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <PackIcon className={cn('w-3 h-3', colorClass)} />
              <span className={cn('text-xs font-medium', colorClass)}>
                {INTEGRATION_PACKS.find((p) => p.id === packId)?.name}
              </span>
            </div>
          </div>
        </div>
        {isActivated ? (
          <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Activated
          </span>
        ) : (
          <button
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
              expanded
                ? 'bg-white/10 border border-white/20 text-slate-200'
                : 'bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25',
            )}
          >
            {expanded ? 'Close' : 'Configure & Deploy'}
          </button>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-slate-400">{agent.description}</p>

      {/* Sample actions */}
      <div className="flex flex-wrap gap-1.5">
        {agent.sampleActions.map((action) => (
          <span
            key={action}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-300"
          >
            <Zap className="w-3 h-3 text-amber-300/70" />
            {action}
          </span>
        ))}
      </div>

      {/* Expanded config panel */}
      {expanded && !isActivated && (
        <div className="mt-1 rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
          <>
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Configure Agent</p>

              {/* Name */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Agent Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                />
              </div>

              {/* Model picker */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Model</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 min-w-0">
                    <p className="text-sm text-slate-100 font-mono truncate">{selectedModelData?.name || editModel}</p>
                    {editModel === agent.modelName && (
                      <span className="text-[10px] font-semibold text-emerald-400">Recommended</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowModelPicker((v) => !v)}
                    className="shrink-0 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 border border-white/10 text-xs text-slate-300 font-medium transition-colors"
                  >
                    {showModelPicker ? 'Close' : 'Change'}
                  </button>
                </div>
                {showModelPicker && (
                  <div className="mt-2 rounded-xl border border-white/10 bg-slate-900 p-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models…"
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {filteredModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setEditModel(m.id); setShowModelPicker(false); setModelSearch(''); }}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors',
                            editModel === m.id
                              ? 'bg-blue-500/20 border border-blue-400/30 text-blue-200'
                              : 'hover:bg-white/5 text-slate-300'
                          )}
                        >
                          <span>
                            <span className="font-medium">{m.name}</span>
                            <span className="text-cyan-400 ml-1.5">Zapheit AI</span>
                            {m.id === agent.modelName && (
                              <span className="ml-2 text-[10px] font-semibold text-emerald-400">Recommended</span>
                            )}
                          </span>
                          {m.pricing?.prompt && (
                            <span className="text-slate-500 shrink-0 ml-2">${parseFloat(m.pricing.prompt) * 1_000_000}/M</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {monthlyCostUsd !== null && (
                  <p className="text-[11px] text-slate-500 mt-1.5">≈ ${monthlyCostUsd.toFixed(2)} / mo at 10M tokens</p>
                )}
              </div>

              {/* System prompt (editable) */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">System Prompt</label>
                <textarea
                  value={editSystemPrompt}
                  onChange={(e) => setEditSystemPrompt(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
                />
              </div>

              {/* Add to Fleet */}
              <button
                disabled={isActivating}
                onClick={() => onActivate(agent, editName.trim() || agent.name, editModel.trim() || agent.modelName, editSystemPrompt)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isActivating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Deploying…</>
                  : <><Sparkles className="w-4 h-4" /> Add to Fleet →</>
                }
              </button>
            </>
        </div>
      )}
    </div>
  );
}

export default function DomainAgentLibraryPage({
  initialPackId,
  initialAgentId,
  onDeploy,
  onNavigate,
}: DomainAgentLibraryPageProps) {
  const [activePack, setActivePack] = useState<IntegrationPackId | 'all'>(initialPackId || 'all');
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [activatedIds, setActivatedIds] = useState<Set<string>>(new Set());

  const visiblePacks = activePack === 'all'
    ? INTEGRATION_PACKS
    : INTEGRATION_PACKS.filter((p) => p.id === activePack);

  const handleActivate = async (packId: IntegrationPackId, agent: DomainAgentType, name: string, model: string, systemPrompt: string) => {
    const key = `${packId}:${agent.id}`;
    setActivatingId(key);
    try {
      await onDeploy({
        name,
        description: agent.description,
        agent_type: agent.agentType,
        platform: 'api',
        model_name: model,
        system_prompt: systemPrompt,
        primary_pack: packId,
        integration_ids: [],
        config: { pack_id: packId, domain_agent_id: agent.id },
      });
      setActivatedIds((prev) => new Set([...prev, key]));
    } finally {
      setActivatingId(null);
    }
  };

  // Auto-expand the agent matching initialAgentId (handled by default expand logic)
  void initialAgentId; // consumed by AgentCard default state if needed

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Bot className="w-6 h-6 text-blue-300" />
          <h1 className="text-2xl font-bold text-white">Domain Agent Library</h1>
        </div>
        <p className="text-slate-400 text-sm">
          Pre-built agents optimised for each integration vertical. Deploy one to your fleet in seconds.
        </p>
      </div>

      {/* Pack filter tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActivePack('all')}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-medium transition-colors border',
            activePack === 'all'
              ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
              : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200',
          )}
        >
          All Verticals
        </button>
        {INTEGRATION_PACKS.map((pack) => {
          const Icon = PACK_ICONS[pack.id];
          const isActive = activePack === pack.id;
          return (
            <button
              key={pack.id}
              onClick={() => setActivePack(pack.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors border',
                isActive
                  ? `border-white/20 bg-white/10 ${PACK_COLORS[pack.id]}`
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {pack.name}
            </button>
          );
        })}
      </div>

      {/* Agent grid per pack */}
      {visiblePacks.map((pack) => {
        const agents = PACK_DOMAIN_AGENTS[pack.id];
        if (!agents || agents.length === 0) return null;
        const PackIcon = PACK_ICONS[pack.id];
        const colorClass = PACK_COLORS[pack.id];
        return (
          <section key={pack.id}>
            <div className="flex items-center gap-2 mb-4">
              <div className={cn('w-7 h-7 rounded-lg border flex items-center justify-center', PACK_ICON_BG[pack.id])}>
                <PackIcon className={cn('w-4 h-4', colorClass)} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">{pack.name}</h2>
                <p className="text-xs text-slate-500">{pack.description}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.map((agent) => {
                const key = `${pack.id}:${agent.id}`;
                return (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    packId={pack.id}
                    isActivating={activatingId === key}
                    isActivated={activatedIds.has(key)}
                    onActivate={(a, name, model, systemPrompt) =>
                      handleActivate(pack.id, a, name, model, systemPrompt)
                    }
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Footer CTA */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex items-center gap-5">
        <Shield className="w-8 h-8 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">All domain agents are governed by Zapheit</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Every activated agent is automatically monitored for incidents, cost overruns, and policy violations.
          </p>
        </div>
        <button
          onClick={() => onNavigate?.('fleet')}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold transition-colors"
        >
          View Fleet <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
