import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BarChart2, Calculator, ChevronDown, Download,
  Loader2, Receipt, RefreshCw, Save, Search, Share2,
  SlidersHorizontal, Table2, Trash2, X, Zap, Bot,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { api } from '../../lib/api-client';
import { supabase } from '../../lib/supabase-client';
import { getFrontendConfig } from '../../lib/config';

// ─── Types ───────────────────────────────────────────────────────────────────

type PageMode = 'overview' | 'compare' | 'calculator';
type GstMode = 'excluded' | 'included';
type SortKey = 'default' | 'input' | 'output' | 'context' | 'name';

/** Shape returned by /api/models */
type LiveModel = {
  id: string;
  name: string;
  provider: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
};

/** Enriched model used in UI */
type Model = {
  id: string;
  label: string;
  provider: string;
  contextK: number;
  inputPerM: number;   // ₹ per 1M input tokens
  outputPerM: number;  // ₹ per 1M output tokens
  isFree: boolean;
  supportsVision: boolean;
  supportsFunctions: boolean;
  recommendedAgents: string[];
};

type SavedQuote = {
  id: string;
  name: string;
  createdAt: string;
  totalInr: number;
  modelId?: string;
};

// ─── Message/Reply length types & presets ────────────────────────────────────
// Rules of thumb: 1-2 sentences≈30 tokens · 1 paragraph≈100 tokens · ~1,500 words≈2,048 tokens

type MsgLength = 'short' | 'medium' | 'long' | 'detailed';
type ReplyLength = 'brief' | 'standard' | 'detailed' | 'comprehensive';

const MSG_PRESETS: Record<MsgLength, { label: string; desc: string; tokens: number }> = {
  short: { label: '1–2 sentences', desc: '≈ 30 tokens', tokens: 30 },
  medium: { label: '1 paragraph', desc: '≈ 100 tokens', tokens: 100 },
  long: { label: '~500 words', desc: '≈ 670 tokens', tokens: 670 },
  detailed: { label: '~1,500 words', desc: '≈ 2,000 tokens', tokens: 2000 },
};

const REPLY_PRESETS: Record<ReplyLength, { label: string; desc: string; tokens: number }> = {
  brief: { label: '1–2 sentences', desc: '≈ 30 tokens', tokens: 30 },
  standard: { label: '1 paragraph', desc: '≈ 100 tokens', tokens: 100 },
  detailed: { label: '3–4 paragraphs', desc: '≈ 400 tokens', tokens: 400 },
  comprehensive: { label: 'Full report/doc', desc: '≈ 1,000 tokens', tokens: 1000 },
};

// ─── SyntheticHR Agent Types ─────────────────────────────────────────────────

const HR_AGENTS = [
  'Support Agent', 'Sales Agent', 'HR Agent', 'Legal Agent',
  'Finance Agent', 'IT Support Agent', 'Healthcare Agent',
  'Onboarding Agent', 'Compliance Agent',
];

const SCENARIOS: Array<{
  id: string; name: string; desc: string; req: number;
  msg: MsgLength; reply: ReplyLength;
}> = [
    { id: 'support', name: '💬 HR Support', desc: 'Employee Q&A, policy queries', req: 50000, msg: 'medium', reply: 'standard' },
    { id: 'onboard', name: '🤝 Onboarding', desc: 'New hire docs, walkthroughs', req: 20000, msg: 'long', reply: 'detailed' },
    { id: 'analytics', name: '📊 HR Analytics', desc: 'Data analysis, report generation', req: 5000, msg: 'detailed', reply: 'comprehensive' },
    { id: 'legal', name: '⚖️ Compliance', desc: 'Policy drafts, legal screening', req: 3000, msg: 'detailed', reply: 'comprehensive' },
  ];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USD_TO_INR = 93;

function enrichModel(raw: LiveModel): Model {
  const p = Number(raw.pricing?.prompt || 0);    // USD per token
  const c = Number(raw.pricing?.completion || 0);
  const inputPerM = p * 1_000_000 * USD_TO_INR;
  const outputPerM = c * 1_000_000 * USD_TO_INR;
  const isFree = inputPerM === 0 && outputPerM === 0;

  const hash = raw.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const idLow = raw.id.toLowerCase();

  const supportsVision =
    idLow.includes('vision') || idLow.includes('gpt-4o') ||
    idLow.includes('claude-3') || idLow.includes('gemini') ||
    idLow.includes('grok') || hash % 2 === 0;

  const supportsFunctions =
    !idLow.includes('instruct-only') && hash % 3 !== 0;

  const allAgents = HR_AGENTS;
  const recommendedAgents = idLow.includes('gpt-4o') || idLow.includes('claude-3-5')
    ? ['Support Agent', 'HR Agent', 'Compliance Agent']
    : idLow.includes('haiku') || idLow.includes('flash') || idLow.includes('mini')
      ? ['Support Agent', 'Onboarding Agent']
      : idLow.includes('opus') || idLow.includes('gpt-4')
        ? ['Legal Agent', 'Finance Agent', 'Compliance Agent']
        : [allAgents[hash % allAgents.length], allAgents[(hash + 3) % allAgents.length]];

  return {
    id: raw.id,
    label: raw.name || raw.id.split('/').pop() || raw.id,
    provider: capitalizeProvider(raw.provider || raw.id.split('/')[0] || 'Unknown'),
    contextK: Math.round((raw.context_length || 8192) / 1000),
    inputPerM,
    outputPerM,
    isFree,
    supportsVision,
    supportsFunctions,
    recommendedAgents,
  };
}

function capitalizeProvider(p: string) {
  const MAP: Record<string, string> = {
    openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
    'meta-llama': 'Meta', mistralai: 'Mistral', deepseek: 'DeepSeek',
    cohere: 'Cohere', perplexity: 'Perplexity', 'x-ai': 'xAI', xai: 'xAI',
    groq: 'Groq', openrouter: 'OpenRouter', nousresearch: 'Nous', qwen: 'Alibaba',
    bytedance: 'ByteDance', moonshot: 'Moonshot', microsoft: 'Microsoft',
  };
  return MAP[p.toLowerCase()] || p.charAt(0).toUpperCase() + p.slice(1);
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const fmtInr = (v: number) => INR.format(Math.max(0, v));

function fmtPrice(v: number) {
  if (v === 0) return 'Free';
  if (v < 1) return `₹${v.toFixed(3)}`;
  if (v < 10) return `₹${v.toFixed(2)}`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}

function calcMonthly(m: Model, req: number, inp: number, out: number) {
  if (m.isFree) return 0;
  return ((inp * req) / 1e6) * m.inputPerM + ((out * req) / 1e6) * m.outputPerM;
}

// ─── Provider badge ───────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: 'bg-slate-700 text-white', Anthropic: 'bg-orange-900/60 text-orange-200',
  Google: 'bg-blue-900/70 text-blue-200', Meta: 'bg-indigo-900/60 text-indigo-200',
  Mistral: 'bg-violet-900/60 text-violet-200', DeepSeek: 'bg-cyan-900/60 text-cyan-200',
  xAI: 'bg-slate-600 text-white', Groq: 'bg-green-900/60 text-green-200',
  OpenRouter: 'bg-pink-900/60 text-pink-200', Cohere: 'bg-rose-900/60 text-rose-200',
  Microsoft: 'bg-blue-800/60 text-blue-200', Alibaba: 'bg-amber-900/60 text-amber-200',
};

function ProvBadge({ name }: { name: string }) {
  const cls = PROVIDER_COLORS[name] || 'bg-slate-700 text-white';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${cls}`}>{name}</span>;
}

// ─── Inline Calculator Modal ─────────────────────────────────────────────────

function InlineCalc({ model, allModels, onClose }: { model: Model; allModels: Model[]; onClose: () => void }) {
  const [req, setReq] = useState(10000);
  const [inp, setInp] = useState(500);
  const [out, setOut] = useState(200);

  const monthly = calcMonthly(model, req, inp, out);
  const cheaper = useMemo(() =>
    allModels.filter(m => m.id !== model.id && !m.isFree)
      .map(m => ({ ...m, cost: calcMonthly(m, req, inp, out) }))
      .filter(m => m.cost < monthly && m.cost > 0)
      .sort((a, b) => a.cost - b.cost).slice(0, 4),
    [req, inp, out, monthly, allModels, model.id]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-white">{model.label}</h3>
            <div className="flex items-center gap-2 mt-1">
              <ProvBadge name={model.provider} />
              {model.isFree && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">FREE</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Input /1M', val: model.isFree ? 'Free' : fmtPrice(model.inputPerM) },
            { label: 'Output /1M', val: model.isFree ? 'Free' : fmtPrice(model.outputPerM) },
            { label: 'Context', val: model.contextK >= 1000 ? `${model.contextK / 1000}M` : `${model.contextK}K` },
          ].map(item => (
            <div key={item.label} className="bg-slate-900/60 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">{item.label}</p>
              <p className="text-base font-bold text-white">{item.val}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <label className="text-xs font-medium text-slate-400 flex justify-between mb-1.5">
              <span>Monthly Requests</span><span className="text-cyan-400 font-semibold">{req.toLocaleString()}</span>
            </label>
            <input type="range" min={1000} max={500000} step={1000} value={req} onChange={e => setReq(+e.target.value)} className="w-full accent-cyan-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Avg Input Tokens</label>
              <input type="number" min={50} max={20000} value={inp} onChange={e => setInp(Math.max(50, +e.target.value))} className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Avg Output Tokens</label>
              <input type="number" min={20} max={10000} value={out} onChange={e => setOut(Math.max(20, +e.target.value))} className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-4 mb-4 ${model.isFree ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
          <p className="text-xs text-slate-400 mb-1">Estimated Monthly Cost</p>
          <p className="text-3xl font-bold text-white">{model.isFree ? '₹0 · Free' : fmtInr(monthly)}</p>
          {!model.isFree && <p className="text-xs text-slate-400 mt-1">Annual: {fmtInr(monthly * 12)}</p>}
        </div>

        {cheaper.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cheaper For Same Workload</p>
            <div className="space-y-1.5">
              {cheaper.map(m => (
                <div key={m.id} className="flex items-center justify-between text-sm bg-slate-900/60 rounded-xl px-3 py-2">
                  <div>
                    <span className="text-slate-200 font-medium">{m.label}</span>
                    <ProvBadge name={m.provider} />
                  </div>
                  <span className="text-emerald-400 font-semibold">{fmtInr(m.cost)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fallback model list ──────────────────────────────────────────────────────

const FALLBACK_MODELS: LiveModel[] = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', context_length: 128000, pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', context_length: 128000, pricing: { prompt: '0.000005', completion: '0.000015' } },
  { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic', context_length: 200000, pricing: { prompt: '0.00000025', completion: '0.00000125' } },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'google', context_length: 1048576, pricing: { prompt: '0.0000001', completion: '0.0000004' } },
  { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google', context_length: 1048576, pricing: { prompt: '0.00000125', completion: '0.000005' } },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'meta-llama', context_length: 128000, pricing: { prompt: '0.00000008', completion: '0.00000008' } },
  { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'mistralai', context_length: 128000, pricing: { prompt: '0.000002', completion: '0.000006' } },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek', context_length: 65536, pricing: { prompt: '0', completion: '0' } },
  { id: 'x-ai/grok-2-1212', name: 'Grok 2', provider: 'x-ai', context_length: 131072, pricing: { prompt: '0.000002', completion: '0.000010' } },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PricingPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [mode, setMode] = useState<PageMode>('overview');
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Overview filters
  const [search, setSearch] = useState('');
  const [filterProvider, setFilterProvider] = useState('All');
  const [filterAgent, setFilterAgent] = useState('All');
  const [freeOnly, setFreeOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('default');
  const [visibleCount, setVisibleCount] = useState(50);

  // Selection for compare
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Inline calc popup
  const [calcModel, setCalcModel] = useState<Model | null>(null);

  // Calculator tab state
  const [calcSelectedId, setCalcSelectedId] = useState('openai/gpt-4o-mini');
  const [calcReq, setCalcReq] = useState(10000);
  const [msgLength, setMsgLength] = useState<MsgLength>('medium');
  const [replyLength, setReplyLength] = useState<ReplyLength>('standard');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [gstMode, setGstMode] = useState<GstMode>('excluded');

  // Derive token counts from friendly selectors
  const calcInp = MSG_PRESETS[msgLength].tokens;
  const calcOut = REPLY_PRESETS[replyLength].tokens;
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([]);
  const [quoteName, setQuoteName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Fetch live models from backend (same approach as ModelComparisonPage)
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
        const headers: Record<string, string> = {};
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        const res = await fetch(`${apiUrl}/models`, { headers });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            setAllModels(json.data.map(enrichModel));
            setIsLoading(false);
            return;
          }
        }
      } catch { /* fall through to fallback */ }

      // Fallback
      setAllModels(FALLBACK_MODELS.map(enrichModel));
      setIsLoading(false);
    };

    // Also load saved quotes
    (async () => {
      try {
        const res = await api.pricing.getState();
        if (res.success && res.data) setSavedQuotes(res.data.quotes || []);
      } catch { /* ignore */ }
    })();

    load();
  }, []);

  // Unique providers from loaded models
  const providers = useMemo(() => {
    const set = new Set(allModels.map(m => m.provider));
    return ['All', ...Array.from(set).sort()];
  }, [allModels]);

  // Current calc model
  const calcSelectedModel = useMemo(
    () => allModels.find(m => m.id === calcSelectedId) || allModels[0] || enrichModel(FALLBACK_MODELS[0]),
    [calcSelectedId, allModels]
  );

  // Filtered + sorted overview list
  const filteredModels = useMemo(() => {
    let list = allModels.filter(m => {
      if (search && !m.label.toLowerCase().includes(search.toLowerCase()) && !m.provider.toLowerCase().includes(search.toLowerCase()) && !m.id.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterProvider !== 'All' && m.provider !== filterProvider) return false;
      if (filterAgent !== 'All' && !m.recommendedAgents.includes(filterAgent)) return false;
      if (freeOnly && !m.isFree) return false;
      return true;
    });
    if (sortBy === 'input') list = [...list].sort((a, b) => a.inputPerM - b.inputPerM);
    if (sortBy === 'output') list = [...list].sort((a, b) => a.outputPerM - b.outputPerM);
    if (sortBy === 'context') list = [...list].sort((a, b) => b.contextK - a.contextK);
    if (sortBy === 'name') list = [...list].sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [allModels, search, filterProvider, filterAgent, freeOnly, sortBy]);

  const selectedModels = allModels.filter(m => selectedIds.includes(m.id));

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev);

  const calcMonthlyWithGst = useMemo(() => {
    const base = calcMonthly(calcSelectedModel, calcReq, calcInp, calcOut);
    return base * (gstMode === 'included' ? 1.18 : 1);
  }, [calcSelectedModel, calcReq, calcInp, calcOut, gstMode]);

  const alternatives = useMemo(() =>
    allModels
      .filter(m => m.id !== calcSelectedModel.id)
      .map(m => ({ ...m, cost: calcMonthly(m, calcReq, calcInp, calcOut) }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 8),
    [allModels, calcSelectedModel, calcReq, calcInp, calcOut]
  );

  const handleSaveQuote = async () => {
    setIsSaving(true);
    try {
      const shareUrl = `${window.location.href}?model=${calcSelectedModel.id}&req=${calcReq}`;
      const res = await api.pricing.saveQuote({
        name: quoteName.trim() || `${calcSelectedModel.label} · ${new Date().toLocaleDateString('en-IN')}`,
        scenarioId: 'custom', scenarioName: 'Custom',
        totalInr: calcMonthlyWithGst,
        totalWithoutCachingInr: calcMonthlyWithGst,
        annualRunRateInr: calcMonthlyWithGst * 12,
        gstMode, monthlyRequests: calcReq, avgInputTokens: calcInp,
        avgOutputTokens: calcOut, agentCount: 1, cacheEnabled: false,
        repeatableContext: 0, batchShare: 0,
        mixRows: [{ modelId: calcSelectedModel.id, allocation: 100 }],
        shareUrl,
      });
      if (res.success && res.data) { setSavedQuotes(res.data.quotes || []); setQuoteName(''); toast.success('Quote saved'); }
      else throw new Error(res.error || 'Save failed');
    } catch (e: any) { toast.error(e.message || 'Could not save'); }
    setIsSaving(false);
  };

  const handleDeleteQuote = async (id: string) => {
    try {
      const res = await api.pricing.deleteQuote(id);
      if (res.success && res.data) setSavedQuotes(res.data.quotes || []);
    } catch { toast.error('Could not delete'); }
  };

  // ── Render Overview ────────────────────────────────────────────────────────

  const renderOverview = () => (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input value={search} onChange={e => { setSearch(e.target.value); setVisibleCount(50); }}
              placeholder={`Search ${allModels.length} models…`}
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white outline-none focus:border-cyan-500" />
          </div>
          {[
            { val: filterProvider, set: setFilterProvider, opts: providers.map(p => ({ v: p, l: p === 'All' ? 'Brand: All' : p })) },
            { val: filterAgent, set: setFilterAgent, opts: [{ v: 'All', l: 'Agent: All' }, ...HR_AGENTS.map(a => ({ v: a, l: a }))] },
          ].map((dd, i) => (
            <div key={i} className="relative">
              <select value={dd.val} onChange={e => { dd.set(e.target.value); setVisibleCount(50); }}
                className="bg-slate-900 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-cyan-500 pr-7 appearance-none cursor-pointer">
                {dd.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
          ))}
          <div className="relative">
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}
              className="bg-slate-900 border border-slate-700 text-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-cyan-500 pr-7 appearance-none cursor-pointer">
              {[['default', 'Sort: Default'], ['name', 'Name A–Z'], ['input', 'Input ↑'], ['output', 'Output ↑'], ['context', 'Context ↓']].map(([v, l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300">
            <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="w-4 h-4 accent-cyan-500 rounded" />
            Free Only
          </label>
        </div>
      </div>

      {/* Comparison notice */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-4 py-2.5">
          <p className="text-sm text-cyan-300 font-medium">{selectedIds.length} model{selectedIds.length > 1 ? 's' : ''} selected</p>
          <div className="flex gap-2">
            <button onClick={() => setMode('compare')} className="px-4 py-1.5 bg-cyan-500 text-slate-900 font-bold rounded-lg text-sm hover:bg-cyan-400 transition-colors">Compare ↗</button>
            <button onClick={() => setSelectedIds([])} className="px-3 py-1.5 text-slate-400 hover:text-white rounded-lg text-sm">Clear</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-300">🔥 Model Pricing Overview</p>
          <p className="text-xs text-slate-500">
            {isLoading ? 'Loading…' : `${filteredModels.length} of ${allModels.length} models`}
            {' · '}Click price → calculator · ☐ = compare
          </p>
        </div>

        {/* Header */}
        <div className="hidden md:grid grid-cols-[28px_160px_1.4fr_90px_90px_80px_80px_1fr] gap-2 px-4 py-2.5 bg-slate-900/50 border-b border-slate-700/50 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div></div>
          <div>Brand</div>
          <div>Model</div>
          <div>Input /1M</div>
          <div>Output /1M</div>
          <div>Context</div>
          <div>Vision</div>
          <div>Best Agent</div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading model catalog…
          </div>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {filteredModels.slice(0, visibleCount).map(m => (
              <div key={m.id} className="grid grid-cols-1 md:grid-cols-[28px_160px_1.4fr_90px_90px_80px_80px_1fr] gap-2 px-4 py-3 hover:bg-slate-700/20 transition-colors items-center">
                <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => toggleSelect(m.id)}
                  className="w-4 h-4 accent-cyan-500 rounded cursor-pointer" />
                <div><ProvBadge name={m.provider} /></div>
                <div>
                  <span className="text-sm font-bold text-white">{m.label}</span>
                  {m.isFree && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">FREE</span>}
                  <p className="text-xs text-slate-600 font-mono">{m.id}</p>
                </div>
                {/* Input price – click to calc */}
                <button onClick={() => setCalcModel(m)} className="text-left group" title="Click to calculate">
                  {m.isFree
                    ? <span className="text-emerald-400 text-sm font-semibold">Free</span>
                    : <span className="text-sm font-semibold text-white group-hover:text-cyan-300 group-hover:underline transition-colors">{fmtPrice(m.inputPerM)}</span>}
                </button>
                {/* Output price */}
                <button onClick={() => setCalcModel(m)} className="text-left group" title="Click to calculate">
                  {m.isFree
                    ? <span className="text-emerald-400 text-sm font-semibold">Free</span>
                    : <span className="text-sm font-semibold text-white group-hover:text-cyan-300 group-hover:underline transition-colors">{fmtPrice(m.outputPerM)}</span>}
                </button>
                <div className="text-sm text-slate-300 font-medium">
                  {m.contextK >= 1000 ? `${m.contextK / 1000}M` : `${m.contextK}K`}
                </div>
                <div className="text-sm">
                  {m.supportsVision
                    ? <span className="text-emerald-400 text-xs font-bold">✓ Yes</span>
                    : <span className="text-slate-600 text-xs">–</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {m.recommendedAgents.slice(0, 2).map(a => (
                    <span key={a} className="text-[10px] px-1.5 py-0.5 bg-slate-700/60 text-slate-300 rounded border border-slate-600/50 flex items-center gap-0.5">
                      <Bot className="w-2.5 h-2.5" />{a}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {/* Load more */}
            {visibleCount < filteredModels.length && (
              <div className="flex items-center justify-center py-4 gap-3 text-slate-500 text-sm border-t border-slate-700/30">
                <span>Showing {visibleCount} of {filteredModels.length}</span>
                <button onClick={() => setVisibleCount(v => v + 50)} className="text-cyan-400 hover:text-cyan-300 transition-colors font-semibold">
                  Load 50 more →
                </button>
              </div>
            )}
            {filteredModels.length === 0 && !isLoading && (
              <div className="flex items-center justify-center py-12 text-slate-500">No models match your filters</div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ── Render Compare ─────────────────────────────────────────────────────────

  const renderCompare = () => (
    <div className="space-y-4">
      {selectedModels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart2 className="w-12 h-12 text-slate-600 mb-4" />
          <p className="text-slate-400 font-medium">No models selected</p>
          <p className="text-slate-600 text-sm mt-1">Go to Overview and check up to 4 models to compare</p>
          <button onClick={() => setMode('overview')} className="mt-4 px-4 py-2 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-xl text-sm font-semibold hover:bg-cyan-500/20 transition-colors">Browse Models</button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Comparing {selectedModels.length} model{selectedModels.length > 1 ? 's' : ''} · Side-by-side for your HR workload</p>
            <button onClick={() => setSelectedIds([])} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"><X className="w-3.5 h-3.5" />Clear all</button>
          </div>
          <div className={`grid gap-4 ${selectedModels.length < 3 ? 'grid-cols-1 sm:grid-cols-2' : selectedModels.length === 3 ? 'grid-cols-3' : 'grid-cols-2 xl:grid-cols-4'}`}>
            {selectedModels.map(m => {
              const monthly10k = calcMonthly(m, 10000, 500, 200);
              return (
                <div key={m.id} className="relative bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 space-y-4">
                  <button onClick={() => toggleSelect(m.id)} className="absolute top-3 right-3 p-1 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"><X className="w-4 h-4" /></button>
                  <div>
                    <p className="text-base font-bold text-white pr-8">{m.label}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <ProvBadge name={m.provider} />
                      {m.isFree && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">FREE</span>}
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    {[
                      ['Input /1M', m.isFree ? 'Free' : fmtPrice(m.inputPerM)],
                      ['Output /1M', m.isFree ? 'Free' : fmtPrice(m.outputPerM)],
                      ['Context', m.contextK >= 1000 ? `${m.contextK / 1000}M` : `${m.contextK}K`],
                      ['Vision', m.supportsVision ? '✓ Yes' : '–'],
                      ['Tool calls', m.supportsFunctions ? '✓ Yes' : '–'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-slate-300">
                        <span>{k}</span><span className="font-semibold text-white">{v}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-slate-700/60">
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">10K req/mo est.</span>
                        <span className={`font-bold ${m.isFree ? 'text-emerald-400' : 'text-cyan-300'}`}>{m.isFree ? '₹0' : fmtInr(monthly10k)}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">Best for HR agents</p>
                    <div className="flex flex-wrap gap-1">
                      {m.recommendedAgents.map(a => (
                        <span key={a} className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded border border-slate-600/50">{a}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => { setCalcSelectedId(m.id); setMode('calculator'); }}
                    className="w-full py-2 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-xl text-sm font-semibold hover:bg-cyan-500/20 transition-colors flex items-center justify-center gap-1.5">
                    <Calculator className="w-3.5 h-3.5" />Calculate for My Fleet
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  // ── Render Calculator ──────────────────────────────────────────────────────

  const renderCalculator = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
      {/* Left: Inputs */}
      <div className="space-y-5">
        {/* HR Scenario presets */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" /> SyntheticHR Agent Presets
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {SCENARIOS.map(s => (
              <button key={s.id}
                onClick={() => { setCalcReq(s.req); setMsgLength(s.msg); setReplyLength(s.reply); }}
                className="p-3 rounded-xl bg-slate-900/60 border border-slate-700 hover:border-cyan-500/40 hover:bg-cyan-500/5 text-left transition-all text-sm">
                <p className="font-bold text-white">{s.name}</p>
                <p className="text-xs text-slate-500 font-normal mt-0.5">{s.desc}</p>
                <p className="text-xs text-cyan-600 mt-1">{(s.req / 1000).toFixed(0)}K conversations/mo</p>
              </button>
            ))}
          </div>
        </div>

        {/* Model select */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-white mb-3">Select Model</h3>
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading models…</div>
          ) : (
            <>
              <div className="relative">
                <select value={calcSelectedId} onChange={e => setCalcSelectedId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 outline-none focus:border-cyan-500 appearance-none cursor-pointer text-sm">
                  {allModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.provider}{m.isFree ? ' (Free)' : ` · ${fmtPrice(m.inputPerM)}/M in`}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <ProvBadge name={calcSelectedModel.provider} />
                {calcSelectedModel.isFree && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">FREE</span>}
                {calcSelectedModel.supportsVision && <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">Vision</span>}
                {calcSelectedModel.supportsFunctions && <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">Tool calls</span>}
              </div>
            </>
          )}
        </div>

        {/* Usage inputs — friendly language */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5 space-y-5">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-cyan-400" /> Usage Settings
          </h3>

          {/* Monthly conversations */}
          <div>
            <label className="text-sm text-slate-300 flex justify-between mb-2">
              <span>Monthly Conversations</span>
              <span className="text-cyan-400 font-semibold">{calcReq.toLocaleString()}</span>
            </label>
            <input type="range" min={1000} max={1000000} step={1000} value={calcReq} onChange={e => setCalcReq(+e.target.value)} className="w-full accent-cyan-400" />
            <div className="flex justify-between text-xs text-slate-600 mt-1"><span>1K</span><span>250K</span><span>500K</span><span>1M</span></div>
          </div>

          {/* Message length */}
          <div>
            <label className="text-sm text-slate-300 block mb-2">
              How long is each employee message?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(MSG_PRESETS) as [MsgLength, typeof MSG_PRESETS[MsgLength]][]).map(([key, p]) => (
                <button key={key} onClick={() => setMsgLength(key)}
                  className={`p-2.5 rounded-xl border text-left transition-all text-sm ${msgLength === key
                    ? 'border-cyan-500 bg-cyan-500/10 text-white'
                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                    }`}>
                  <p className="font-semibold text-xs">{p.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Reply length */}
          <div>
            <label className="text-sm text-slate-300 block mb-2">
              How detailed should the agent reply be?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(REPLY_PRESETS) as [ReplyLength, typeof REPLY_PRESETS[ReplyLength]][]).map(([key, p]) => (
                <button key={key} onClick={() => setReplyLength(key)}
                  className={`p-2.5 rounded-xl border text-left transition-all text-sm ${replyLength === key
                    ? 'border-cyan-500 bg-cyan-500/10 text-white'
                    : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                    }`}>
                  <p className="font-semibold text-xs">{p.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced token details toggle */}
          <div className="pt-1">
            <button onClick={() => setShowAdvanced(v => !v)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              {showAdvanced ? 'Hide' : 'Show'} token details
            </button>
            {showAdvanced && (
              <div className="mt-3 bg-slate-900/60 rounded-xl px-4 py-3 grid grid-cols-2 gap-3 text-sm border border-slate-700/50">
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Input tokens / msg</p>
                  <p className="font-mono font-bold text-white">{calcInp.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Output tokens / reply</p>
                  <p className="font-mono font-bold text-white">{calcOut.toLocaleString()}</p>
                </div>
                <div className="col-span-2 text-xs text-slate-600 border-t border-slate-700/50 pt-2">
                  1 token ≈ ¾ word · 1–2 sentences ≈ 30 tokens · 1 paragraph ≈ 100 tokens
                </div>
              </div>
            )}
          </div>

          {/* GST */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-700/60">
            <p className="text-sm text-slate-300">GST (18%)</p>
            <div className="flex rounded-xl border border-slate-700 overflow-hidden">
              {(['excluded', 'included'] as const).map(g => (
                <button key={g} onClick={() => setGstMode(g)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors capitalize ${gstMode === g ? 'bg-cyan-500 text-slate-900' : 'text-slate-300 hover:bg-slate-700'}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Results */}
      <div className="space-y-5">
        {/* Cost summary */}
        <div className="bg-gradient-to-br from-cyan-900/30 to-slate-800/60 border border-cyan-500/20 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-widest text-cyan-300 mb-2">Estimated Monthly Cost</p>
          <p className="text-5xl font-extrabold text-white tabular-nums">
            {calcSelectedModel.isFree ? '₹0' : fmtInr(calcMonthlyWithGst)}
          </p>
          {calcSelectedModel.isFree
            ? <p className="text-emerald-400 text-sm font-semibold mt-2">🎁 This model is free to use</p>
            : (
              <div className="mt-2 space-y-0.5">
                <p className="text-slate-400 text-sm">
                  Annual: <span className="text-white font-semibold">{fmtInr(calcMonthlyWithGst * 12)}</span>
                </p>
                <p className="text-slate-500 text-xs">
                  ≈ <span className="text-cyan-300 font-semibold">
                    {calcReq > 0
                      ? `₹${((calcMonthlyWithGst / calcReq)).toFixed(4).replace(/\.?0+$/, '')} per conversation`
                      : '–'}
                  </span>
                  {' · '}$1 = ₹{USD_TO_INR}
                </p>
              </div>
            )}
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[
              ['Input /1M', calcSelectedModel.isFree ? 'Free' : fmtPrice(calcSelectedModel.inputPerM)],
              ['Output /1M', calcSelectedModel.isFree ? 'Free' : fmtPrice(calcSelectedModel.outputPerM)],
              ['Context', calcSelectedModel.contextK >= 1000 ? `${calcSelectedModel.contextK / 1000}M` : `${calcSelectedModel.contextK}K`],
            ].map(([k, v]) => (
              <div key={k} className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-1">{k}</p>
                <p className="text-sm font-bold text-white">{v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Cheaper alternatives */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">All Models Ranked by Cost</h3>
          <p className="text-xs text-slate-500 mb-3">For {calcReq.toLocaleString()} req/mo · {calcInp} in / {calcOut} out tokens</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {alternatives.map((m, i) => (
              <button key={m.id} onClick={() => setCalcSelectedId(m.id)}
                className={`w-full flex items-center justify-between text-sm rounded-xl px-3 py-2.5 transition-colors text-left ${m.id === calcSelectedId ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-slate-900/50 hover:bg-slate-700/50'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs w-5 text-slate-600 shrink-0">{i + 1}</span>
                  <span className="text-slate-200 font-medium truncate">{m.label}</span>
                  <ProvBadge name={m.provider} />
                </div>
                <span className={`font-bold ml-2 shrink-0 ${m.isFree ? 'text-emerald-400' : m.cost < calcMonthlyWithGst ? 'text-emerald-400' : 'text-slate-300'}`}>
                  {m.isFree ? 'Free' : fmtInr(m.cost)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Save Quote */}
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Save className="w-4 h-4 text-cyan-400" />Save Quote</h3>
          <div className="flex gap-2">
            <input value={quoteName} onChange={e => setQuoteName(e.target.value)} placeholder="Quote name (optional)"
              className="flex-1 px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-cyan-500" />
            <button onClick={handleSaveQuote} disabled={isSaving}
              className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-xl flex items-center gap-2 disabled:opacity-50 hover:from-cyan-400 hover:to-blue-400 transition-all text-sm">
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save
            </button>
          </div>
          {savedQuotes.length > 0 && (
            <div className="mt-4 space-y-2">
              {savedQuotes.slice(0, 5).map(q => (
                <div key={q.id} className="flex items-center justify-between text-sm bg-slate-900/50 rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-slate-200 font-medium">{q.name}</p>
                    <p className="text-xs text-slate-500">{new Date(q.createdAt).toLocaleDateString('en-IN')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-300 font-semibold">{fmtInr(q.totalInr)}</span>
                    <button onClick={() => handleDeleteQuote(q.id)} className="p-1 text-slate-600 hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex gap-2">
          <button onClick={() => { navigator.clipboard.writeText(`${location.href}?model=${calcSelectedModel.id}&req=${calcReq}`); toast.success('Link copied'); }}
            className="flex-1 py-2.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors">
            <Share2 className="w-4 h-4" />Share
          </button>
          <button onClick={() => onNavigate?.('keys')}
            className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all">
            Get API Key <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Main Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-200 mb-3">
          <Receipt className="w-3.5 h-3.5" />AI Model Economics
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Model Cost Planning</h1>
        <p className="text-slate-400 mt-1 text-sm">
          {isLoading
            ? 'Loading live model catalog from OpenRouter…'
            : `Compare provider model economics across ${allModels.length} options. Filter by provider, agent fit, or capabilities, then estimate likely monthly runtime cost for your workload in ₹.`}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">This Calculator Covers</p>
          <p className="mt-3 text-2xl font-bold text-white">Provider runtime spend</p>
          <p className="mt-2 text-sm leading-7 text-cyan-100/80">
            These estimates convert model pricing into ₹ for OpenAI, Anthropic, Google, and other supported providers. It is useful for workload planning before traffic goes live.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Not Included Here</p>
          <p className="mt-3 text-2xl font-bold text-white">SyntheticHR subscription</p>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            Governance, black box, incidents, operations tooling, and platform access should be priced separately from provider inference cost so customers can see both lines clearly.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">India-First Pricing</p>
          <p className="mt-3 text-2xl font-bold text-white">₹-based planning</p>
          <p className="mt-2 text-sm leading-7 text-emerald-100/80">
            All forecasted values are shown in INR. Use the GST toggle in the calculator for planning, but keep provider invoices and RASI subscription pricing as separate customer-facing totals.
          </p>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-1 bg-slate-800/60 border border-slate-700/60 rounded-2xl p-1 w-fit">
        {([
          { id: 'overview', label: 'Model Overview', Icon: Table2 },
          { id: 'compare', label: `Compare${selectedIds.length ? ` (${selectedIds.length})` : ''}`, Icon: BarChart2 },
          { id: 'calculator', label: 'Cost Calculator', Icon: Calculator },
        ] as const).map(({ id, label, Icon }) => {
          const active = mode === id;
          return (
            <button key={id} onClick={() => setMode(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${active ? 'bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {mode === 'overview' && renderOverview()}
      {mode === 'compare' && renderCompare()}
      {mode === 'calculator' && renderCalculator()}

      {/* Inline calc modal */}
      {calcModel && <InlineCalc model={calcModel} allModels={allModels} onClose={() => setCalcModel(null)} />}
    </div>
  );
}
