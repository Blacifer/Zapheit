import { useState, useEffect, useMemo } from 'react';
import { X, Zap, Headphones, Users, RefreshCw, Server, Search, Loader2, CheckCircle2, LineChart, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase-client';
import { AGENT_TEMPLATES, AGENT_TEMPLATE_INDUSTRIES, type AgentTemplate } from '../../config/agentTemplates';

interface LiveModel {
  id: string;
  name: string;
  provider: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

interface AgentTemplatesPageProps {
  onDeploy: (template: AgentTemplate) => void;
}

export default function AgentTemplatesPage({ onDeploy }: AgentTemplatesPageProps) {
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedModel, setSelectedModel] = useState<LiveModel | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'configure' | 'sandbox'>('configure');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [sandboxMessage, setSandboxMessage] = useState('');
  const [sandboxChat, setSandboxChat] = useState<{ role: 'user' | 'agent', content: string }[]>([]);
  const [deploymentStep, setDeploymentStep] = useState<'configure' | 'channel'>('configure');
  const [estimatedTokens, setEstimatedTokens] = useState<number>(10);

  // Fetch live model list on mount
  useEffect(() => {
    const load = async () => {
      setModelsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const apiUrl = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
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

  const resolveModel = (modelId: string) =>
    liveModels.find(m => m.id === modelId) ??
    liveModels.find(m => m.id.includes(modelId) || modelId.includes(m.id));

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
      setSandboxChat([{ role: 'agent', content: `Hi! I'm your ${selectedTemplate.name}. Send me a message to test how I respond in the sandbox.` }]);
      setSandboxMessage('');
      setDeploymentStep('configure');
    }
  }, [selectedTemplate, liveModels]);

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
    const costINR = costUSD * 93;

    return `₹${Math.round(costINR).toLocaleString('en-IN')}/1M blended`;
  };

  // Monthly cost estimator
  const USD_TO_INR = 93;

  const calcMonthlyCost = (model: LiveModel | null, tokens: number) => {
    if (!model) return null;
    const p = Number(model.pricing?.prompt || 0);
    const c = Number(model.pricing?.completion || 0);
    if (!p && !c) return null; // free/open model
    // Assume 50/50 prompt vs completion split
    const costUSD = (p * tokens * 0.5) + (c * tokens * 0.5);
    const costINR = costUSD * USD_TO_INR;
    return { usd: costUSD, inr: costINR };
  };

  const estimatedMonthlyTokens = estimatedTokens * 1_000_000;
  const monthlyCost = calcMonthlyCost(selectedModel, estimatedMonthlyTokens);
  const templates = AGENT_TEMPLATES;
  const industries = [...AGENT_TEMPLATE_INDUSTRIES];

  const filteredTemplates = useMemo(() => {
    let result = templates;
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
          <p className="text-slate-400 mt-1">Pre-built agent starting points for your governed fleet</p>
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

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map(template => {
          const colors = getColorClasses(template.color);
          const Icon = template.icon;
          const baseModel = resolveModel(template.model);
          const baseModelLabel = baseModel ? `${baseModel.name} (${baseModel.provider})` : template.model;

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
                  <span className={`px-2 py-1 rounded text-xs font-medium ${colors.light} ${colors.text}`}>
                    {template.industry}
                  </span>
                </div>

                <h3 className="text-lg font-semibold text-white mb-2">{template.name}</h3>
                <p className="text-slate-400 text-sm mb-3 line-clamp-2">{template.description}</p>
                <p className="text-xs text-slate-500 mb-3">
                  Default model: <span className="text-slate-300">{baseModelLabel}</span>
                </p>

                {template.roi && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-2 mb-4">
                    <p className="text-emerald-400 text-xs font-medium flex items-center gap-1.5"><LineChart className="w-3.5 h-3.5" /> {template.roi}</p>
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
                              return cost ? `₹${Math.round(cost.inr).toLocaleString('en-IN')}/month` : 'Free / Open Source';
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

              {/* Tabs */}
              <div className="flex gap-4 border-b border-slate-700/50 mb-6">
                <button
                  onClick={() => setActiveTab('configure')}
                  className={`pb-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'configure' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}
                >
                  Configuration & Channel Setup
                </button>
                <button
                  onClick={() => setActiveTab('sandbox')}
                  className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'sandbox' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}
                >
                  <Zap className="w-4 h-4" /> Sandbox Preview
                </button>
              </div>

              {activeTab === 'sandbox' ? (
                <div className="bg-slate-900 border border-slate-700 rounded-xl flex flex-col h-[400px] mb-6">
                  <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700 flex items-center justify-between rounded-t-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-sm font-medium text-white">{selectedTemplate.name} <span className="text-slate-500">- Preview Mode</span></span>
                    </div>
                    <button className="text-xs text-cyan-400 hover:text-cyan-300" onClick={() => setSandboxChat([{ role: 'agent', content: `Hi! I'm your ${selectedTemplate.name}. Send me a message to test how I respond in the sandbox.` }])}>Reset</button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                    {sandboxChat.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-cyan-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'}`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-slate-700 bg-slate-800/50 rounded-b-xl">
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (!sandboxMessage.trim()) return;

                      const msg = sandboxMessage.trim();
                      const lowerMsg = msg.toLowerCase();
                      let reply = '';

                      if (lowerMsg.includes('hi') || lowerMsg.includes('hello') || lowerMsg.includes('hey')) {
                        reply = `Hello! I'm your ${selectedTemplate.name} running in sandbox mode. How can I assist you with your ${selectedTemplate.industry.toLowerCase()} tasks today?`;
                      } else if (lowerMsg.includes('help') || lowerMsg.includes('what can you do')) {
                        reply = `As your ${selectedTemplate.name}, I can help you with: ${selectedTemplate.features.join(', ')}.`;
                      } else if (lowerMsg.includes('price') || lowerMsg.includes('cost')) {
                        reply = `I am estimated to cost ${selectedTemplate.price} once added to your fleet, depending on usage.`;
                      } else {
                        const defaultResponses = [
                          `That's a great question. In a live workflow, my response would be processed by ${selectedModel?.name || 'this model'} using your selected instructions.`,
                          `I understand you're testing my capabilities. Once added to your fleet, this template can be governed alongside your other agents.`,
                          `I'm currently running in Sandbox Preview mode. Your message "${msg}" was received clearly!`,
                        ];
                        reply = defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
                      }

                      setSandboxChat([...sandboxChat, { role: 'user', content: msg }, { role: 'agent', content: reply }]);
                      setSandboxMessage('');
                    }} className="relative">
                      <input
                        id="sandboxMessageInput"
                        name="sandboxMessageInput"
                        type="text"
                        value={sandboxMessage}
                        onChange={(e) => setSandboxMessage(e.target.value)}
                        placeholder="Message your agent..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-10 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
                      />
                      <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 text-cyan-400 hover:text-cyan-300 transition-colors">
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                deploymentStep === 'configure' ? (
                  // STEP 1: Configure Agent details (Model, Context, Sandbox)
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
                                    <span className={`capitalize ${model.provider === 'openai' ? 'text-emerald-400' :
                                      model.provider === 'anthropic' ? 'text-orange-400' :
                                        model.provider === 'google' ? 'text-blue-400' :
                                          model.provider === 'meta-llama' ? 'text-indigo-400' :
                                            'text-purple-400'
                                      }`}>
                                      {model.provider}
                                    </span>
                                    {model.pricing && (
                                      <span className="text-slate-500 border-l border-slate-700 pl-2">
                                        ${parseFloat(model.pricing.prompt || '0').toFixed(2)}/1M
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
                    <div className="mt-6 p-4 bg-slate-800 rounded-xl border border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-white font-semibold">Workload Parameters</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-sm">Monthly Volume Est:</span>
                          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
                            {[10, 50, 100].map(vol => (
                              <button
                                key={vol}
                                onClick={() => setEstimatedTokens(vol)}
                                className={`px-2 py-1 text-xs font-semibold rounded-md transition-all ${estimatedTokens === vol
                                  ? 'bg-slate-700 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-400 hover:bg-slate-800'
                                  }`}
                              >
                                {vol}M
                              </button>
                            ))}
                          </div>
                          <span className="text-xs font-semibold text-slate-400">Selected: {estimatedTokens}M</span>
                        </div>
                      </div>

                      {/* Cost display */}
                      {!selectedModel ? (
                        <p className="text-slate-500 text-xs text-center py-2">Select a model above to see estimated cost</p>
                      ) : monthlyCost === null ? (
                        <div className="flex items-center justify-between py-2">
                          <span className="text-slate-400 text-sm">Estimated monthly cost</span>
                          <span className="text-emerald-400 font-semibold">Free / Open source</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-3 mt-1">
                          <div className="text-center">
                            <p className="text-xs text-slate-500 mb-1">USD / month</p>
                            <p className="text-white font-bold text-base">${monthlyCost.usd.toFixed(2)}</p>
                          </div>
                          <div className="text-center border-x border-slate-700">
                            <p className="text-xs text-slate-500 mb-1">INR / month <span className="text-slate-600">(1$=₹{USD_TO_INR})</span></p>
                            <p className="text-cyan-400 font-bold text-base">₹{Math.round(monthlyCost.inr).toLocaleString('en-IN')}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-slate-500 mb-1">Budget limit</p>
                            <p className="text-slate-300 font-bold text-base">₹{selectedTemplate.budget.toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                      )}
                      {selectedModel && (
                        <p className="text-xs text-slate-500 text-center mt-2">
                          Pricing for <span className="text-slate-300">{selectedModel.name}</span> (<span className="text-slate-400">{selectedModel.provider}</span>)
                        </p>
                      )}
                      {monthlyCost && (
                        <p className="text-xs text-slate-600 text-center mt-2">
                          Assumes 50/50 prompt/completion split · $1 = ₹{USD_TO_INR} · Pricing from RasiAI Gateway
                        </p>
                      )}

                      {/* Over-budget warning */}
                      {monthlyCost && selectedTemplate.budget > 0 && monthlyCost.inr > selectedTemplate.budget && (
                        <div className="mt-3 flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <span className="text-amber-400 text-xs">⚠️ Estimated cost exceeds budget limit — consider fewer tokens or a cheaper model.</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 mt-6">
                      <button
                        onClick={() => setDeploymentStep('channel')}
                        className={`w-full py-3 rounded-xl font-bold text-white transition-all shadow-lg ${getColorClasses(selectedTemplate.color).bg} hover:brightness-110 active:scale-[0.98]`}
                      >
                        Continue to Channel Setup
                      </button>
                      <button
                        onClick={() => setSelectedTemplate(null)}
                        className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  // STEP 2: Channel Setup
                  <div className="space-y-6 animate-in slide-in-from-right-8 duration-300">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`p-2 rounded-xl ${getColorClasses(selectedTemplate.color).bg} bg-opacity-20`}>
                        <selectedTemplate.icon className={`w-6 h-6 ${getColorClasses(selectedTemplate.color).text}`} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">Select Deployment Channel</h3>
                        <p className="text-sm text-slate-400">Choose how {selectedTemplate.name} should be added to your operating stack.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Channel Option: Slack */}
                      <button
                        onClick={() => {
                          const toDeploy = selectedModel
                            ? { ...selectedTemplate, model: selectedModel.id, platform: 'Slack' }
                            : { ...selectedTemplate, platform: 'Slack' };
                          onDeploy(toDeploy);
                          setSelectedTemplate(null);
                        }}
                        className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-800 border border-slate-700 hover:border-[#E01E5A]/50 hover:bg-[#4A154B]/10 rounded-2xl transition-all group"
                      >
                        <div className="w-12 h-12 rounded-full bg-slate-900 group-hover:bg-[#4A154B]/30 flex items-center justify-center transition-colors">
                          <MessageSquare className="w-6 h-6 text-slate-400 group-hover:text-[#E01E5A] transition-colors" />
                        </div>
                        <span className="font-semibold text-slate-300 group-hover:text-white transition-colors">Slack Workspace</span>
                      </button>

                      {/* Channel Option: Teams */}
                      <button
                        onClick={() => {
                          const toDeploy = selectedModel
                            ? { ...selectedTemplate, model: selectedModel.id, platform: 'Microsoft Teams' }
                            : { ...selectedTemplate, platform: 'Microsoft Teams' };
                          onDeploy(toDeploy);
                          setSelectedTemplate(null);
                        }}
                        className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-800 border border-slate-700 hover:border-indigo-500/50 hover:bg-indigo-500/10 rounded-2xl transition-all group"
                      >
                        <div className="w-12 h-12 rounded-full bg-slate-900 group-hover:bg-indigo-900/50 flex items-center justify-center transition-colors">
                          <Users className="w-6 h-6 text-slate-400 group-hover:text-indigo-400 transition-colors" />
                        </div>
                        <span className="font-semibold text-slate-300 group-hover:text-white transition-colors">MS Teams</span>
                      </button>

                      {/* Channel Option: Zendesk */}
                      <button
                        onClick={() => {
                          const toDeploy = selectedModel
                            ? { ...selectedTemplate, model: selectedModel.id, platform: 'Zendesk' }
                            : { ...selectedTemplate, platform: 'Zendesk' };
                          onDeploy(toDeploy);
                          setSelectedTemplate(null);
                        }}
                        className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-800 border border-slate-700 hover:border-emerald-500/50 hover:bg-emerald-500/10 rounded-2xl transition-all group"
                      >
                        <div className="w-12 h-12 rounded-full bg-slate-900 group-hover:bg-emerald-900/50 flex items-center justify-center transition-colors">
                          <Headphones className="w-6 h-6 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                        </div>
                        <span className="font-semibold text-slate-300 group-hover:text-white transition-colors">Zendesk Agent</span>
                      </button>

                      {/* Channel Option: Native Dashboard */}
                      <button
                        onClick={() => {
                          const toDeploy = selectedModel
                            ? { ...selectedTemplate, model: selectedModel.id, platform: 'Native API' }
                            : { ...selectedTemplate, platform: 'Native API' };
                          onDeploy(toDeploy);
                          setSelectedTemplate(null);
                        }}
                        className="flex flex-col items-center justify-center gap-3 p-6 bg-slate-800 border border-slate-700 hover:border-cyan-500/50 hover:bg-cyan-500/10 rounded-2xl transition-all group"
                      >
                        <div className="w-12 h-12 rounded-full bg-slate-900 group-hover:bg-cyan-900/50 flex items-center justify-center transition-colors">
                          <Server className="w-6 h-6 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                        </div>
                        <span className="font-semibold text-slate-300 group-hover:text-white transition-colors">Native API (Fleet Only)</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setDeploymentStep('configure')}
                      className="w-full mt-4 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors"
                    >
                      Back to Configuration
                    </button>
                  </div>
                )
              )}

              <p className="text-center text-slate-500 text-xs mt-3">
                Adding this template to fleet will create a governed agent record with the selected channel and model settings.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
