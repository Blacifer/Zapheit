import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, RefreshCw, Search, CheckCircle2, LineChart, MessageSquare, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase-client';
import { toast } from '../../lib/toast';
import { USD_TO_INR } from '../../lib/currency';
import { AGENT_TEMPLATES, AGENT_TEMPLATE_INDUSTRIES, type AgentTemplate } from '../../config/agentTemplates';
import { getFrontendConfig } from '../../lib/config';

interface LiveModel {
  id: string;
  name: string;
  provider: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

type MonthlyCost =
  | { status: 'priced'; usd: number; inr: number }
  | { status: 'free' }
  | { status: 'unknown' };

type TemplateReadinessItem = {
  label: string;
  detail: string;
  ready: boolean;
};

interface AgentTemplatesPageProps {
  onDeploy: (template: AgentTemplate & { system_prompt?: string; integration_ids?: string[] }) => Promise<void>;
  onLaunchInChat: (template: AgentTemplate & { system_prompt?: string; integration_ids?: string[] }) => Promise<void>;
}

export default function AgentTemplatesPage({ onDeploy, onLaunchInChat }: AgentTemplatesPageProps) {
  const [searchParams] = useSearchParams();
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedModel, setSelectedModel] = useState<LiveModel | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'configure' | 'readiness'>('configure');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [pendingAction, setPendingAction] = useState<'fleet' | 'chat' | null>(null);
  const WORKLOAD_PRESETS = useMemo(() => [1_000_000, 10_000_000, 100_000_000], []);
  const MIN_MONTHLY_TOKENS = 1_000_000;
  const MAX_MONTHLY_TOKENS = 100_000_000;
  const [monthlyTokensMillions, setMonthlyTokensMillions] = useState<number>(10);

  // Fetch live model list on mount
  useEffect(() => {
    const load = async () => {
      setModelsLoading(true);
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
      } catch { /* fall through to defaults */ }
      // Fallback core list
      const fallback: LiveModel[] = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', pricing: { prompt: '0.000005', completion: '0.000015' } },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
        { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', pricing: { prompt: '0.000003', completion: '0.000015' } },
        { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic', pricing: { prompt: '0.00000025', completion: '0.00000125' } },
        { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'google', pricing: { prompt: '0.0000001', completion: '0.0000004' } },
        { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'meta-llama', pricing: { prompt: '0.0000008', completion: '0.0000008' } },
        { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'mistralai', pricing: { prompt: '0.000002', completion: '0.000006' } },
      ];
      setLiveModels(fallback);
    };
    load().finally(() => setModelsLoading(false));
  }, []);

  // Static marketplace social proof per template
  const TEMPLATE_META: Record<string, { teams: number; setupMins: number; featured?: boolean }> = {
    'hr-policy-assistant':      { teams: 412,  setupMins: 5,  featured: true },
    'support-triage-bot':       { teams: 891,  setupMins: 3,  featured: true },
    'interview-scheduler':      { teams: 278,  setupMins: 8,  featured: true },
    'expense-approver':         { teams: 634,  setupMins: 5,  featured: true },
    'meeting-note-taker':       { teams: 567,  setupMins: 4,  featured: true },
    'leave-management':         { teams: 321,  setupMins: 6  },
    'performance-review':       { teams: 198,  setupMins: 10 },
    'it-helpdesk':              { teams: 445,  setupMins: 5  },
    'sales-lead-qualifier':     { teams: 388,  setupMins: 7  },
    'finance-invoice':          { teams: 256,  setupMins: 8  },
  };
  const FEATURED_IDS = Object.entries(TEMPLATE_META).filter(([, v]) => v.featured).map(([k]) => k);

  const resolveModel = useCallback((modelId: string) =>
    (() => {
      const direct = liveModels.find(m => m.id === modelId);
      if (direct) return direct;

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const key = normalize(modelId);

      return liveModels.find(m => normalize(m.id).includes(key) || key.includes(normalize(m.id)));
    })(), [liveModels]);

  // Auto-select template from URL param (?template=hr-assistant)
  useEffect(() => {
    const templateParam = searchParams.get('template');
    if (!templateParam) return;
    const match = AGENT_TEMPLATES.find(
      (t) => t.id === templateParam || t.name.toLowerCase().replace(/\s+/g, '-') === templateParam,
    );
    if (match) setSelectedTemplate(match);
  }, [searchParams]);

  // Update selected model when template changes or live models load
  useEffect(() => {
    if (selectedTemplate && liveModels.length > 0) {
      const def = resolveModel(selectedTemplate.model);
      if (def) setSelectedModel(def);

      // Reset selection filters when template opens
      setSelectedProvider('all');
      setModelSearch('');
      setActiveTab('configure');
      setSystemPrompt(`You are an advanced AI assistant tailored for ${selectedTemplate.industry} tasks, specializing as a ${selectedTemplate.name}.`);
    }
  }, [selectedTemplate, liveModels, resolveModel]);

  // Unique providers derived from live model list
  const providers = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; label: string }[] = [{ id: 'all', label: 'All Providers' }];
    for (const m of liveModels) {
      if (!seen.has(m.provider)) {
        seen.add(m.provider);
        list.push({ id: m.provider, label: m.provider.charAt(0).toUpperCase() + m.provider.slice(1) });
      }
    }
    return list;
  }, [liveModels]);

  // Filtered + searched model list
  const visibleModels = useMemo(() => {
    let ms = selectedProvider === 'all' ? liveModels : liveModels.filter(m => m.provider === selectedProvider);
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      ms = ms.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
    }
    return ms; // Removed the artificial 80 limit
  }, [liveModels, selectedProvider, modelSearch]);

  const formatPrice = (model: LiveModel) => {
    const p = Number(model.pricing?.prompt || 0);
    const c = Number(model.pricing?.completion || 0);
    if (!p && !c) return 'Free / Open';

    // Calculate blended cost for 1M tokens (500k prompt, 500k completion) in INR
    const costUSD = (p * 500_000) + (c * 500_000);
    const costINR = costUSD * USD_TO_INR;

    return `₹${Math.round(costINR).toLocaleString('en-IN')}/1M blended`;
  };

  const formatTokensShort = (tokens: number) => {
    if (!Number.isFinite(tokens)) return '';
    const abs = Math.abs(tokens);
    if (abs >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
    if (abs >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return `${Math.round(tokens)}`;
  };

  const clampMonthlyTokens = (tokens: number) =>
    Math.min(MAX_MONTHLY_TOKENS, Math.max(MIN_MONTHLY_TOKENS, Math.round(tokens)));

  // Monthly cost estimator
  const calcMonthlyCost = (model: LiveModel | null, tokens: number): MonthlyCost => {
    if (!model) return { status: 'unknown' };
    const p = Number(model.pricing?.prompt || 0);
    const c = Number(model.pricing?.completion || 0);
    const hasPricing = Number.isFinite(p) && Number.isFinite(c) && (p > 0 || c > 0);
    const isLikelyFreeOpen =
      (!model.pricing || (!p && !c)) && (model.provider === 'meta-llama' || model.id.toLowerCase().includes('llama'));

    if (!hasPricing) return isLikelyFreeOpen ? { status: 'free' } : { status: 'unknown' };
    // Assume 50/50 prompt vs completion split
    const costUSD = (p * tokens * 0.5) + (c * tokens * 0.5);
    const costINR = costUSD * USD_TO_INR;
    return { status: 'priced', usd: costUSD, inr: costINR };
  };

  const monthlyTokens = clampMonthlyTokens(monthlyTokensMillions * 1_000_000);
  const monthlyCost = calcMonthlyCost(selectedModel, monthlyTokens);
  const industries = [...AGENT_TEMPLATE_INDUSTRIES];

  const filteredTemplates = useMemo(() => {
    let result = AGENT_TEMPLATES;
    if (selectedIndustry !== 'all') {
      result = result.filter(t => t.industry === selectedIndustry);
    }
    if (templateSearchQuery.trim()) {
      const q = templateSearchQuery.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.features.some(f => f.toLowerCase().includes(q))
      );
    }
    return result;
  }, [selectedIndustry, templateSearchQuery]);

  const selectedTemplateReadiness = useMemo<TemplateReadinessItem[]>(() => {
    if (!selectedTemplate) return [];

    const requiredSystems = selectedTemplate.requiredSystems ?? [];
    const hasBudget = selectedTemplate.budget > 0;
    const budgetOverrun =
      monthlyCost.status === 'priced' && hasBudget && monthlyCost.inr > selectedTemplate.budget;

    return [
      {
        label: 'Live model selected',
        ready: Boolean(selectedModel),
        detail: selectedModel
          ? `${selectedModel.name} via ${selectedModel.provider}`
          : 'Select a model from the live catalog before deploying.',
      },
      {
        label: 'Budget guardrail',
        ready: hasBudget && !budgetOverrun,
        detail: budgetOverrun
          ? `Estimated monthly spend is above the ₹${selectedTemplate.budget.toLocaleString('en-IN')} budget.`
          : hasBudget
            ? `Budget cap set at ₹${selectedTemplate.budget.toLocaleString('en-IN')}/month.`
            : 'Add a monthly budget before production launch.',
      },
      {
        label: 'Required systems declared',
        ready: requiredSystems.length > 0,
        detail: requiredSystems.length > 0
          ? requiredSystems.join(', ')
          : 'Add the real apps, data sources, and permission scopes this agent needs.',
      },
      {
        label: 'Approval policy default',
        ready: Boolean(selectedTemplate.approvalDefault),
        detail: selectedTemplate.approvalDefault || 'Define which actions are advisory, approval-gated, or blocked.',
      },
      {
        label: 'Risk and purpose documented',
        ready: Boolean(selectedTemplate.riskLevel && selectedTemplate.businessPurpose),
        detail: selectedTemplate.riskLevel
          ? `${selectedTemplate.riskLevel} risk with a documented business purpose.`
          : 'Set risk level and business purpose before production review.',
      },
      {
        label: 'Audit evidence path',
        ready: Boolean(selectedTemplate.certifications?.length || selectedTemplate.maturity === 'Core'),
        detail: selectedTemplate.certifications?.length
          ? `Evidence labels: ${selectedTemplate.certifications.join(', ')}`
          : 'Attach compliance or audit evidence labels for paid-pilot review.',
      },
    ];
  }, [monthlyCost, selectedModel, selectedTemplate]);

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; border: string; text: string; light: string }> = {
      blue: { bg: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-400', light: 'bg-blue-500/10' },
      green: { bg: 'bg-green-500', border: 'border-green-500', text: 'text-green-400', light: 'bg-green-500/10' },
      purple: { bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-400', light: 'bg-purple-500/10' },
      red: { bg: 'bg-red-500', border: 'border-red-500', text: 'text-red-400', light: 'bg-red-500/10' },
      amber: { bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-400', light: 'bg-amber-500/10' },
      cyan: { bg: 'bg-cyan-500', border: 'border-cyan-500', text: 'text-cyan-400', light: 'bg-cyan-500/10' },
      emerald: { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-400', light: 'bg-emerald-500/10' },
      orange: { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-400', light: 'bg-orange-500/10' },
      teal: { bg: 'bg-teal-500', border: 'border-teal-500', text: 'text-teal-400', light: 'bg-teal-500/10' },
      rose: { bg: 'bg-rose-500', border: 'border-rose-500', text: 'text-rose-400', light: 'bg-rose-500/10' },
      pink: { bg: 'bg-pink-500', border: 'border-pink-500', text: 'text-pink-400', light: 'bg-pink-500/10' },
      indigo: { bg: 'bg-indigo-500', border: 'border-indigo-500', text: 'text-indigo-400', light: 'bg-indigo-500/10' },
      sky: { bg: 'bg-sky-500', border: 'border-sky-500', text: 'text-sky-400', light: 'bg-sky-500/10' },
      slate: { bg: 'bg-slate-500', border: 'border-slate-500', text: 'text-slate-300', light: 'bg-slate-500/20' },
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Templates</h1>
          <p className="text-slate-400 mt-1">Pre-built governed agent starting points that can go directly into operator chat or fleet deployment.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              id="templateSearch"
              name="templateSearch"
              type="text"
              placeholder="Search templates..."
              value={templateSearchQuery}
              onChange={(e) => setTemplateSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
          <select
            id="industrySelect"
            name="industrySelect"
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
            className="w-full sm:w-auto bg-slate-800 border border-slate-600 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
          >
            {industries.map(ind => (
              <option key={ind} value={ind}>{ind === 'all' ? 'All Industries' : ind}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Industry Badges */}
      <div className="flex flex-wrap gap-2">
        {industries.map(ind => (
          <button
            key={ind}
            onClick={() => setSelectedIndustry(ind)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedIndustry === ind
              ? 'bg-cyan-500 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
          >
            {ind === 'all' ? 'All' : ind}
          </button>
        ))}
      </div>

      {/* Featured strip — shown only on "All" with no search */}
      {selectedIndustry === 'all' && !templateSearchQuery && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Most popular</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {AGENT_TEMPLATES.filter((t) => FEATURED_IDS.includes(t.id)).map((t) => {
              const meta = TEMPLATE_META[t.id];
              const Icon = t.icon;
              const colors = (() => {
                const all: Record<string, { text: string; light: string }> = {
                  blue: { text: 'text-blue-400', light: 'bg-blue-500/10' },
                  cyan: { text: 'text-cyan-400', light: 'bg-cyan-500/10' },
                  violet: { text: 'text-violet-400', light: 'bg-violet-500/10' },
                  emerald: { text: 'text-emerald-400', light: 'bg-emerald-500/10' },
                  amber: { text: 'text-amber-400', light: 'bg-amber-500/10' },
                  purple: { text: 'text-purple-400', light: 'bg-purple-500/10' },
                  orange: { text: 'text-orange-400', light: 'bg-orange-500/10' },
                };
                return all[t.color] || all.blue;
              })();
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplate(t)}
                  className="flex shrink-0 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3 text-left transition hover:border-slate-600 hover:bg-slate-900"
                >
                  <div className={`rounded-lg p-2 ${colors.light}`}>
                    <Icon className={`h-4 w-4 ${colors.text}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white whitespace-nowrap">{t.name}</p>
                    {(t.usedBy || t.setupMinutes) && (
                      <p className="text-[11px] text-slate-500">
                        {t.usedBy ? `${t.usedBy.toLocaleString()} teams` : ''}
                        {t.usedBy && t.setupMinutes ? ' · ' : ''}
                        {t.setupMinutes ? `~${t.setupMinutes} min` : ''}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map(template => {
          const colors = getColorClasses(template.color);
          const Icon = template.icon;
          const baseModel = resolveModel(template.model);
          const baseModelLabel = baseModel ? `${baseModel.name} · Zapheit AI` : template.model;

          return (
            <div
              key={template.id}
              className={`bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 hover:border-${template.color}-500/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-${template.color}-500/10 overflow-hidden flex flex-col`}
            >
              <div className={`h-2 ${colors.bg}`} />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-lg ${colors.light}`}>
                    <Icon className={`w-6 h-6 ${colors.text}`} />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${colors.light} ${colors.text}`}>
                      {template.industry}
                    </span>
                    {template.maturity ? (
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${
                        template.maturity === 'Core'
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                          : template.maturity === 'Beta'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                            : 'border-slate-600 bg-slate-700/40 text-slate-300'
                      }`}>
                        {template.maturity}
                      </span>
                    ) : null}
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-white mb-2">{template.name}</h3>
                <p className="text-slate-400 text-sm mb-3 line-clamp-2">{template.description}</p>
                {template.businessPurpose ? (
                  <p className="text-xs text-slate-500 mb-3 line-clamp-2">
                    Purpose: <span className="text-slate-300">{template.businessPurpose}</span>
                  </p>
                ) : null}
                <p className="text-xs text-slate-500 mb-3">
                  Default model: <span className="text-slate-300">{baseModelLabel}</span>
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {template.riskLevel ? (
                    <span className={`px-2 py-1 rounded text-[11px] font-semibold ${
                      template.riskLevel === 'High'
                        ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                        : template.riskLevel === 'Medium'
                          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                    }`}>
                      {template.riskLevel} risk
                    </span>
                  ) : null}
                  {template.approvalDefault ? (
                    <span className="px-2 py-1 rounded text-[11px] font-semibold bg-slate-700/60 text-slate-200 border border-slate-600/60">
                      Approval defaults set
                    </span>
                  ) : null}
                </div>

                {template.roi && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-2 mb-4">
                    <p className="text-emerald-400 text-xs font-medium flex items-center gap-1.5"><LineChart className="w-3.5 h-3.5" /> {template.roi}</p>
                  </div>
                )}

                {template.certifications && template.certifications.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {template.certifications.map((cert) => (
                      <span key={cert} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                        <CheckCircle2 className="w-2.5 h-2.5" />{cert}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mb-4">
                  {template.features.slice(0, 3).map((feature, idx) => (
                    <span key={idx} className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300">
                      {feature}
                    </span>
                  ))}
                  {template.features.length > 3 && (
                    <span className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-400">
                      +{template.features.length - 3} more
                    </span>
                  )}
                </div>

                <div className="flex-1"></div>

                {/* Social proof + setup time */}
                {(template.usedBy || template.setupMinutes) && (
                  <p className="mb-3 text-[11px] text-slate-500">
                    {template.usedBy ? `Used by ${template.usedBy.toLocaleString()} teams` : ''}
                    {template.usedBy && template.setupMinutes ? ' · ' : ''}
                    {template.setupMinutes ? `~${template.setupMinutes} min to set up` : ''}
                  </p>
                )}

                {/* Connectors required */}
                {template.requiredSystems && template.requiredSystems.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {template.requiredSystems.slice(0, 3).map((sys) => (
                      <span key={sys} className="rounded-full border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[10px] text-slate-400">
                        {sys}
                      </span>
                    ))}
                    {template.requiredSystems.length > 3 && (
                      <span className="rounded-full border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[10px] text-slate-400">
                        +{template.requiredSystems.length - 3} more
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-700/60">
                  <div>
                    {modelsLoading ? (
                      <div>
                        <div className="h-6 w-28 bg-slate-700/50 rounded animate-pulse mb-1"></div>
                        <div className="h-4 w-36 bg-slate-700/30 rounded animate-pulse"></div>
                      </div>
                    ) : (
                      <>
                        <p className="text-lg font-bold text-white">
                          {liveModels.length > 0 ? (
                            (() => {
                              const cost = calcMonthlyCost(baseModel || null, 500_000);
                              if (!baseModel) return 'Pricing Unavailable';
                              if (cost.status === 'priced') return `₹${Math.round(cost.inr).toLocaleString('en-IN')}/month`;
                              if (cost.status === 'free') return 'Free / Open Source';
                              return 'Pricing Unavailable';
                            })()
                          ) : (
                            'Pricing Unavailable'
                          )}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Based on ~500k tokens/month on {baseModel?.name ?? template.model}</p>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setSelectedTemplate(template)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${colors.light
                      } ${colors.text} hover:opacity-80`}
                  >
                    View Details
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Template Detail Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 z-50 transition-opacity">
          <div className="bg-slate-800/95 shadow-2xl rounded-2xl border border-slate-600/50 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
            <div className={`h-2 ${getColorClasses(selectedTemplate.color).bg} shadow-[0_0_15px_rgba(0,0,0,0.5)] shadow-${selectedTemplate.color}-500/50`} />
            <div className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-xl ${getColorClasses(selectedTemplate.color).light}`}>
                    <selectedTemplate.icon className={`w-8 h-8 ${getColorClasses(selectedTemplate.color).text}`} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{selectedTemplate.name}</h2>
                    <p className="text-slate-400">{selectedTemplate.industry} • {selectedTemplate.type.replace('_', ' ').toUpperCase()}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Default model: <span className="text-slate-300">{resolveModel(selectedTemplate.model)?.name ?? selectedTemplate.model}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="p-2 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-slate-300 mb-6">{selectedTemplate.description}</p>
              <div className="grid gap-3 md:grid-cols-2 mb-6">
                {selectedTemplate.businessPurpose ? (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Business purpose</p>
                    <p className="mt-2 text-sm text-slate-200">{selectedTemplate.businessPurpose}</p>
                  </div>
                ) : null}
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Governance defaults</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedTemplate.maturity ? (
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                        {selectedTemplate.maturity}
                      </span>
                    ) : null}
                    {selectedTemplate.riskLevel ? (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        selectedTemplate.riskLevel === 'High'
                          ? 'border border-rose-500/20 bg-rose-500/10 text-rose-300'
                          : selectedTemplate.riskLevel === 'Medium'
                            ? 'border border-amber-500/20 bg-amber-500/10 text-amber-300'
                            : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                      }`}>
                        {selectedTemplate.riskLevel} risk
                      </span>
                    ) : null}
                  </div>
                  {selectedTemplate.approvalDefault ? (
                    <p className="mt-3 text-sm text-slate-300">{selectedTemplate.approvalDefault}</p>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">Add approval defaults for this template before rolling it into higher-risk workflows.</p>
                  )}
                </div>
              </div>
              {(selectedTemplate.requiredSystems?.length || selectedTemplate.samplePrompts?.length) ? (
                <div className="grid gap-3 md:grid-cols-2 mb-6">
                  {selectedTemplate.requiredSystems?.length ? (
                    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Required systems</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedTemplate.requiredSystems.map((system) => (
                          <span key={system} className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                            {system}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedTemplate.samplePrompts?.length ? (
                    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Sample prompts</p>
                      <ul className="mt-2 space-y-2 text-sm text-slate-300">
                        {selectedTemplate.samplePrompts.slice(0, 2).map((prompt) => (
                          <li key={prompt} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                            {prompt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Tabs */}
              <div className="flex gap-4 border-b border-slate-700/50 mb-6">
                <button
                  onClick={() => setActiveTab('configure')}
                  className={`pb-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'configure' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}
                >
                  Configuration & Channel Setup
                </button>
                <button
                  onClick={() => setActiveTab('readiness')}
                  className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'readiness' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}
                >
                  <ShieldCheck className="w-4 h-4" /> Production Readiness
                </button>
              </div>

              {activeTab === 'readiness' ? (
                <div className="mb-6 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Production launch package</p>
                      <h3 className="mt-1 text-lg font-semibold text-white">{selectedTemplate.name}</h3>
                      <p className="mt-1 text-sm text-slate-400">
                        This checklist is based on configured template data. Missing items must be completed before externally visible or write-capable work.
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                      selectedTemplateReadiness.every((item) => item.ready)
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    }`}>
                      {selectedTemplateReadiness.every((item) => item.ready) ? 'Ready for governed launch' : 'Needs production setup'}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedTemplateReadiness.map((item) => (
                      <div
                        key={item.label}
                        className={`rounded-xl border p-3 ${
                          item.ready
                            ? 'border-emerald-500/20 bg-emerald-500/5'
                            : 'border-amber-500/20 bg-amber-500/5'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {item.ready ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-300" />
                          )}
                          <p className="text-sm font-semibold text-white">{item.label}</p>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-slate-400">{item.detail}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <p className="text-sm font-semibold text-cyan-100">Launch contract</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      Deploying creates a governed agent record with model, budget, policy context, and audit trail. Connector access still depends on real app connections and certified connector actions.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                    <div className="space-y-6">
                        {/* Model Browser UI */}
                        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
                          {/* Provider Filter */}
                          <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                            {providers.map(p => (
                              <button
                                key={p.id}
                                onClick={() => setSelectedProvider(p.id)}
                                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${selectedProvider === p.id
                                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                                  }`}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>

                          {/* Model Search & Grid */}
                          <div className="relative mb-3">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                              type="text"
                              placeholder="Search live models (e.g., 'gpt-4o', 'llama')..."
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                            {modelsLoading ? (
                              <div className="col-span-2 flex flex-col items-center justify-center py-8 text-slate-500">
                                <RefreshCw className="w-6 h-6 animate-spin mb-2" />
                                <p className="text-sm">Loading live model catalog...</p>
                              </div>
                            ) : visibleModels.length === 0 ? (
                              <div className="col-span-2 text-center py-6 text-slate-500 text-sm">No models found</div>
                            ) : (
                              visibleModels.map(model => (
                                <button
                                  key={model.id}
                                  onClick={() => setSelectedModel(model)}
                                  className={`p-3 rounded-lg border text-left flex flex-col transition-all ${selectedModel?.id === model.id
                                    ? 'border-cyan-500 bg-cyan-500/10'
                                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                                    }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-sm font-semibold ${selectedModel?.id === model.id ? 'text-white' : 'text-slate-300'}`}>
                                      {model.name}
                                    </span>
                                    {selectedModel?.id === model.id && <CheckCircle2 className="w-4 h-4 text-cyan-400" />}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-cyan-400">
                                      Zapheit AI
                                    </span>
                                    {model.pricing && (
                                      <span className="text-slate-500 border-l border-slate-700 pl-2">
                                        {(() => {
                                          const p = Number(model.pricing?.prompt || 0);
                                          const c = Number(model.pricing?.completion || 0);
                                          if (!p && !c) return 'pricing unknown';
                                          const inCost = p ? `$${(p * 1_000_000).toFixed(2)}/1M in` : null;
                                          const outCost = c ? `$${(c * 1_000_000).toFixed(2)}/1M out` : null;
                                          return [inCost, outCost].filter(Boolean).join(' · ');
                                        })()}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>

                        {/* System Prompt Tuner */}
                        <div>
                          <label className="block text-sm font-semibold text-slate-300 mb-2 flex justify-between">
                            System Prompt Tuning
                            <span className="text-xs text-slate-500 font-normal">Context Windows: {selectedModel?.context_length ? `${selectedModel.context_length / 1000}k` : '128k'}</span>
                          </label>
                          <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            className="w-full h-32 bg-slate-800/50 border border-slate-700 rounded-xl p-3 text-sm text-slate-300 font-mono focus:outline-none focus:border-cyan-500 resize-none transition-colors"
                            placeholder="You are a helpful AI assistant..."
                          />
                        </div>
                    </div>

	                    {/* Footer Configuration Metrics */}
	                    <div className="mt-6 rounded-2xl border border-slate-700/60 bg-gradient-to-b from-slate-900/40 to-slate-800/50 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]">
	                      <div className="flex items-center justify-between mb-4">
	                        <div>
	                          <h4 className="text-white font-semibold">Workload</h4>
	                          <p className="text-xs text-slate-500 mt-0.5">Adjust volume to estimate monthly spend</p>
	                        </div>
	                        <div className="flex items-center gap-2">
	                          <span className="px-2 py-1 rounded-lg bg-slate-900/60 border border-slate-700 text-xs text-slate-200 font-semibold">
	                            {formatTokensShort(monthlyTokens).toUpperCase()} tokens/mo
	                          </span>
	                        </div>
	                      </div>

	                      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,0.8fr] gap-4">
	                        {/* Controls */}
	                        <div className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
	                          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
	                            <div className="flex items-center gap-2">
	                              <span className="text-sm font-semibold text-slate-200">Monthly tokens</span>
	                              <span className="text-xs text-slate-500">min 1M · max 100M</span>
	                            </div>
	                            <div className="flex items-center gap-2">
	                              <input
	                                aria-label="Monthly tokens (millions)"
	                                type="number"
	                                min={1}
	                                max={100}
	                                step={1}
	                                value={monthlyTokensMillions}
	                                onChange={(e) => {
	                                  const next = Number(e.target.value);
	                                  if (!Number.isFinite(next)) return;
	                                  setMonthlyTokensMillions(Math.min(100, Math.max(1, Math.round(next))));
	                                }}
	                                className="w-16 bg-slate-950/50 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
	                              />
	                              <span className="text-xs text-slate-500">M</span>
	                            </div>
	                          </div>

	                          <div className="flex flex-wrap gap-2 mb-3">
	                            {[1, 10, 100].map((m) => {
	                              const active = monthlyTokensMillions === m;
	                              return (
	                                <button
	                                  key={m}
	                                  type="button"
	                                  onClick={() => setMonthlyTokensMillions(m)}
	                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
	                                    active
	                                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
	                                      : 'bg-slate-950/30 border-slate-700 text-slate-300 hover:border-slate-600'
	                                  }`}
	                                >
	                                  {m}M
	                                </button>
	                              );
	                            })}
	                          </div>

	                          <div className="relative">
	                            <input
	                              aria-label="Monthly tokens slider"
	                              type="range"
	                              min={1}
	                              max={100}
	                              step={1}
	                              value={monthlyTokensMillions}
	                              onChange={(e) => setMonthlyTokensMillions(Math.min(100, Math.max(1, Number(e.target.value))))}
	                              className="w-full accent-cyan-500"
	                            />
	                            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
	                              <span>1M</span>
	                              <span>50M</span>
	                              <span>100M</span>
	                            </div>
	                          </div>
	                        </div>

	                        {/* Cost summary */}
	                        <div className="rounded-xl border border-slate-700/60 bg-slate-900/30 p-3">
	                          {!selectedModel ? (
	                            <p className="text-slate-500 text-xs text-center py-8">Select a model above to see estimated cost</p>
	                          ) : monthlyCost.status === 'free' ? (
	                            <div className="flex items-center justify-between py-2">
	                              <span className="text-slate-400 text-sm">Estimated monthly cost</span>
	                              <span className="text-emerald-400 font-semibold">Free / Open source</span>
	                            </div>
	                          ) : monthlyCost.status === 'unknown' ? (
	                            <div className="flex items-center justify-between py-2">
	                              <span className="text-slate-400 text-sm">Estimated monthly cost</span>
	                              <span className="text-slate-400 font-semibold">Pricing unavailable</span>
	                            </div>
	                          ) : (
	                            <>
	                              <div className="grid grid-cols-3 gap-3">
	                                <div className="text-center">
	                                  <p className="text-[11px] text-slate-500 mb-1">USD / mo</p>
	                                  <p className="text-white font-bold text-base">${monthlyCost.usd.toFixed(2)}</p>
	                                </div>
	                                <div className="text-center border-x border-slate-700/60">
	                                  <p className="text-[11px] text-slate-500 mb-1">INR / mo <span className="text-slate-600">(₹{USD_TO_INR}/$)</span></p>
	                                  <p className="text-cyan-300 font-bold text-base">₹{Math.round(monthlyCost.inr).toLocaleString('en-IN')}</p>
	                                </div>
	                                <div className="text-center">
	                                  <p className="text-[11px] text-slate-500 mb-1">Budget</p>
	                                  <p className="text-slate-200 font-bold text-base">₹{selectedTemplate.budget.toLocaleString('en-IN')}</p>
	                                </div>
	                              </div>

	                              {selectedTemplate.budget > 0 && (
	                                <div className="mt-3">
	                                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
	                                    <span>Budget usage</span>
	                                    <span>
	                                      {Math.min(999, Math.round((monthlyCost.inr / selectedTemplate.budget) * 100))}%</span>
	                                  </div>
	                                  <div className="h-2 rounded-full bg-slate-800 border border-slate-700/60 overflow-hidden">
	                                    <div
	                                      className={`h-full ${monthlyCost.inr > selectedTemplate.budget ? 'bg-amber-400' : 'bg-cyan-500'}`}
	                                      style={{ width: `${Math.min(100, (monthlyCost.inr / selectedTemplate.budget) * 100)}%` }}
	                                    />
	                                  </div>
	                                </div>
	                              )}
	                            </>
	                          )}

	                          {selectedModel && (
	                            <p className="text-[11px] text-slate-500 text-center mt-3">
                                Pricing for <span className="text-slate-300">{selectedModel.name}</span> via <span className="text-cyan-400">Zapheit AI</span>
	                            </p>
	                          )}
	                          {selectedModel && monthlyCost.status === 'priced' && (
	                            <p className="text-[11px] text-slate-600 text-center mt-2">
                                Assumes 50/50 prompt/completion split · Pricing from Zapheit Gateway
	                            </p>
	                          )}
	                        </div>
	                      </div>

	                      {/* Over-budget warning */}
	                      {monthlyCost.status === 'priced' && selectedTemplate.budget > 0 && monthlyCost.inr > selectedTemplate.budget && (
	                        <div className="mt-4 flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
	                          <span className="text-amber-300 text-xs">⚠️ Estimated cost exceeds budget — reduce tokens or choose a cheaper model.</span>
	                        </div>
	                      )}
	                    </div>

                    <div className="flex gap-3 mt-6">
                      <button
                        onClick={async () => {
                          setPendingAction('chat');
                          try {
                            await onLaunchInChat({
                              ...selectedTemplate,
                              model: selectedModel?.id ?? selectedTemplate.model,
                              platform: selectedModel?.provider ?? selectedTemplate.platform,
                              system_prompt: systemPrompt,
                              integration_ids: [],
                            });
                            toast.success(`${selectedTemplate.name} deployed and opened in governed Chat`);
                            setSelectedTemplate(null);
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : 'Failed to launch template in chat');
                          } finally {
                            setPendingAction(null);
                          }
                        }}
                        disabled={pendingAction !== null}
                        className="flex-1 py-3 rounded-xl font-bold text-slate-950 bg-cyan-300 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60 transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                        <MessageSquare className="w-4 h-4" />
                        {pendingAction === 'chat' ? 'Deploying...' : 'Deploy to Governed Chat'}
                      </button>
                      <button
                        onClick={async () => {
                          setPendingAction('fleet');
                          try {
                            await onDeploy({
                              ...selectedTemplate,
                              model: selectedModel?.id ?? selectedTemplate.model,
                              platform: selectedModel?.provider ?? selectedTemplate.platform,
                              system_prompt: systemPrompt,
                              integration_ids: [],
                            });
                            toast.success(`${selectedTemplate.name} added to Fleet — connect a channel from the workspace to go live`);
                            setSelectedTemplate(null);
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : 'Failed to add template to fleet');
                          } finally {
                            setPendingAction(null);
                          }
                        }}
                        disabled={pendingAction !== null}
                        className={`flex-1 py-3 rounded-xl font-bold text-white transition-all shadow-lg ${getColorClasses(selectedTemplate.color).bg} hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {pendingAction === 'fleet' ? 'Adding...' : 'Add to Production Fleet'}
                      </button>
                      <button
                        onClick={() => setSelectedTemplate(null)}
                        disabled={pendingAction !== null}
                        className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                </>
              )}

              <p className="text-center text-slate-500 text-xs mt-3">
                Governed Chat creates a real agent-backed operator session. Production Fleet keeps the agent in inventory until channels, connector permissions, and runtime policies are complete.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
