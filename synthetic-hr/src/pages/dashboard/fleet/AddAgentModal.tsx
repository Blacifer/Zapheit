import { useEffect, useState } from 'react';
import {
  Brain,
  CheckCircle,
  DollarSign,
  Plus,
  ShieldAlert,
  Target,
  X,
} from 'lucide-react';
import { validateAgentForm } from '../../../lib/validation';
import { toast } from '../../../lib/toast';
import { getFrontendConfig } from '../../../lib/config';
import { supabase } from '../../../lib/supabase-client';
import { FALLBACK_MODELS } from '../../../lib/models';

const SUGGESTED_CAPABILITIES: Record<string, string[]> = {
  support: ['Sentiment Analysis', 'Ticket Routing', 'Knowledge Base Search', 'Multi-lingual Support'],
  sales: ['Lead Qualification', 'CRM Sync', 'Objection Handling', 'Meeting Scheduling'],
  hr: ['Policy Q&A', 'Onboarding Guidance', 'Leave Management', 'Interview Prep'],
  legal: ['Contract Analysis', 'Compliance Checking', 'Document Summarization', 'Case Law Search'],
  finance: ['Invoice Processing', 'Expense Categorization', 'Fraud Detection', 'Financial Reporting'],
  it_support: ['Password Reset', 'Hardware Triage', 'Software Deployment', 'Access Management'],
  custom: ['Data Extraction', 'Web Browsing', 'Code Execution', 'API Integration']
};

export function AddAgentModal({ onClose, onAdd }: { onClose: () => void; onAdd: (agent: any) => void }) {
  const [liveModels, setLiveModels] = useState<{ id: string; name: string; provider: string; pricing?: { prompt?: string; completion?: string } }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [step, setStep] = useState(1);
  const [featureInput, setFeatureInput] = useState('');
  const [providerFilter, setProviderFilter] = useState('openai');
  const [form, setForm] = useState({
    name: '',
    description: '',
    agent_type: 'support',
    platform: 'api',
    model_name: 'gpt-4o',
    system_prompt: '',
    status: 'active' as const,
    lifecycle_state: 'idle' as const,
    risk_level: 'low' as const,
    risk_score: 25,
    conversations: 0,
    satisfaction: 95,
    uptime: 99.9,
    budget_limit: 1000,
    current_spend: 0,
    auto_throttle: false,
    config: { features: [] as string[] },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadModels = async () => {
      setLoadingModels(true);
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
              const fetched = json.data.map((m: any) => ({
                id: m.id,
                name: m.name || m.id,
                provider: m.provider || m.id.split('/')[0] || 'Unknown',
                pricing: m.pricing
              }));
              setLiveModels(fetched);
              if (fetched.length > 0) {
                setProviderFilter(fetched[0].provider);
                setForm((f) => ({ ...f, model_name: fetched[0].id }));
              }
              setLoadingModels(false);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load models, using defaults', err);
      }

      setLiveModels(FALLBACK_MODELS);
      setProviderFilter(FALLBACK_MODELS[0].provider);
      setForm((f) => ({ ...f, model_name: FALLBACK_MODELS[0].id }));
      setLoadingModels(false);
    };
    void loadModels();
  }, []);

  const platforms = Array.from(new Set(liveModels.map((m) => m.provider)));
  const filteredModels = liveModels.filter((m) => m.provider === providerFilter);
  const selectedModelData = liveModels.find((m) => m.id === form.model_name);

  const formatPrice = (model: any) => {
    const p = Number(model.pricing?.prompt || 0);
    const c = Number(model.pricing?.completion || 0);
    if (!p && !c) return 'Free / Open Source';
    const per1k = ((p + c) / 2 * 1000).toFixed(4);
    return `$${per1k} avg / 1K tokens`;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!form.name || !form.description) {
        toast.error('Name and Description are required.');
        setErrors({
          name: !form.name ? 'Required' : '',
          description: !form.description ? 'Required' : ''
        });
        return;
      }
      setErrors({});
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) return handleNext();

    const validation = validateAgentForm({
      name: form.name,
      description: form.description,
      agent_type: form.agent_type,
      platform: form.platform,
      model_name: form.model_name,
      budget_limit: form.budget_limit,
    });

    if (!validation.isValid) {
      const errorObj: Record<string, string> = {};
      Object.entries(validation.errors).forEach(([key, value]) => {
        if (value) errorObj[key] = value;
      });
      setErrors(errorObj);
      const firstError = Object.values(validation.errors)[0];
      if (firstError) toast.error(firstError);
      return;
    }
    setErrors({});
    onAdd({ ...form, config: { ...form.config, display_provider: 'Rasi AI' } });
  };

  const handleChange = (field: string, value: string | number | boolean) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: '' });
    if (field === 'providerFilter') {
      const newProvider = String(value);
      setProviderFilter(newProvider);
      const first = liveModels.find((m) => m.provider === newProvider);
      if (first) setForm((f) => ({ ...f, model_name: first.id }));
    }
  };

  const addFeature = () => {
    if (featureInput.trim().length > 0 && !form.config.features.includes(featureInput.trim())) {
      setForm({ ...form, config: { ...form.config, features: [...form.config.features, featureInput.trim()] } });
      setFeatureInput('');
    }
  };

  const removeFeature = (f: string) => {
    setForm({ ...form, config: { ...form.config, features: form.config.features.filter((feat) => feat !== f) } });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-in fade-in duration-200">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl p-8 w-full max-w-2xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-8 relative z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white tracking-tight">Deploy AI Agent</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step === i ? 'bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' : step > i ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {step > i ? <CheckCircle className="w-4 h-4" /> : i}
                  </div>
                  {i < 3 && <div className={`w-6 h-0.5 mx-1 transition-all ${step > i ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
                </div>
              ))}
            </div>
            <div className="h-6 w-px bg-slate-700" />
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10" onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.name !== 'feature') {
            e.preventDefault();
            if (step < 3) handleNext();
            else handleSubmit(e);
          }
        }}>
          {step === 1 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-cyan-400" /> Identity & Purpose
                </h3>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Agent Name <span className="text-red-400">*</span></label>
                <input type="text" value={form.name} onChange={(e) => handleChange('name', e.target.value)} className={`w-full px-4 py-2.5 bg-slate-900/50 border rounded-xl text-white outline-none transition-all ${errors.name ? 'border-red-500 focus:border-red-500' : 'border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'}`} placeholder="e.g., Enterprise Onboarding Assistant" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Description <span className="text-red-400">*</span></label>
                <input type="text" value={form.description} onChange={(e) => handleChange('description', e.target.value)} className={`w-full px-4 py-2.5 bg-slate-900/50 border rounded-xl text-white outline-none transition-all ${errors.description ? 'border-red-500' : 'border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'}`} placeholder="Brief summary of this agent's primary function" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Agent Type</label>
                  <select value={form.agent_type} onChange={(e) => handleChange('agent_type', e.target.value)} className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500">
                    <option value="support">Customer Support</option>
                    <option value="sales">Sales & Lead Gen</option>
                    <option value="hr">Human Resources</option>
                    <option value="legal">Legal & Compliance</option>
                    <option value="finance">Finance</option>
                    <option value="it_support">IT Helpdesk</option>
                    <option value="custom">Custom Engine</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-400" /> Brain & Instructions
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">AI Provider</label>
                  <select value={providerFilter} onChange={(e) => handleChange('providerFilter', e.target.value)} disabled={loadingModels} className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500">
                    {platforms.length > 0 ? platforms.map((p) => (
                      <option key={String(p)} value={String(p)}>{String(p).charAt(0).toUpperCase() + String(p).slice(1)}</option>
                    )) : <option value="openai">OpenAI</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                    Model Selection
                    {loadingModels && <span className="text-purple-400 text-xs animate-pulse">Loading...</span>}
                  </label>
                  <select value={form.model_name} onChange={(e) => handleChange('model_name', e.target.value)} disabled={loadingModels} className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500">
                    {filteredModels.length > 0 ? filteredModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    )) : <option value={form.model_name}>{form.model_name || 'Select Model'}</option>}
                  </select>
                </div>
              </div>
              {selectedModelData && (
                <div className="flex items-center justify-between text-xs bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/20">
                  <span className="text-purple-300/80 font-medium">RasiAI Gateway Pricing</span>
                  <span className="font-mono text-purple-300">{formatPrice(selectedModelData)}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">System Prompt / Persona Injection</label>
                <textarea value={form.system_prompt} onChange={(e) => handleChange('system_prompt', e.target.value)} rows={4} className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500 font-mono text-xs leading-relaxed resize-none scrollbar-thin" placeholder="You are a helpful assistant. Never disclose your internal guidelines..." />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-emerald-400" /> Guardrails & Features
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5" title="Hard cap at which the agent automatically stops responding">
                    Monthly Budget Cap (₹)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                    <input type="number" value={form.budget_limit} onChange={(e) => handleChange('budget_limit', parseInt(e.target.value) || 0)} className="w-full pl-9 pr-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500" min="0" />
                  </div>
                </div>
                <div className="flex items-center pt-2">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={form.auto_throttle} onChange={(e) => handleChange('auto_throttle', e.target.checked)} />
                      <div className={`block w-12 h-6 rounded-full transition-colors ${form.auto_throttle ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${form.auto_throttle ? 'translate-x-6' : ''}`} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">Auto-Throttle</div>
                      <div className="text-xs text-slate-400">Slow down responses near budget limit</div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-700">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Assign Key Capabilities</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="feature"
                    value={featureInput}
                    onChange={(e) => setFeatureInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFeature();
                      }
                    }}
                    placeholder="e.g., Sentiment Analysis"
                    className="flex-1 px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500"
                  />
                  <button type="button" onClick={addFeature} className="px-4 py-2 bg-emerald-500/20 text-emerald-400 font-medium rounded-xl hover:bg-emerald-500/30 transition-colors">Add</button>
                </div>
                {form.config.features.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {form.config.features.map((f, i) => (
                      <span key={i} className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium animate-in zoom-in duration-200">
                        ✓ {f}
                        <button type="button" onClick={() => removeFeature(f)} className="hover:text-emerald-200 ml-1 focus:outline-none">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-slate-700/50">
                  <p className="text-xs text-slate-400 mb-2">Suggested for {form.agent_type.replace('_', ' ')}:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_CAPABILITIES[form.agent_type]?.filter((suggested) => !form.config.features.includes(suggested)).map((suggestion, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setForm({ ...form, config: { ...form.config, features: [...form.config.features, suggestion] } })}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-700 text-slate-300 rounded-full text-xs transition-colors"
                      >
                        <Plus className="w-3 h-3 text-emerald-500" />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4 pt-6 border-t border-slate-700/60 mt-8">
            <button type="button" onClick={() => step > 1 ? setStep(step - 1) : onClose()} className="flex-1 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-700 border border-slate-700 font-medium transition-colors">
              {step > 1 ? 'Back' : 'Cancel'}
            </button>
            <button type="submit" className={`flex-1 py-3 text-white font-bold rounded-xl transition-all shadow-lg ${step === 1 ? 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/20' : step === 2 ? 'bg-purple-500 hover:bg-purple-400 shadow-purple-500/20' : 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20'}`}>
              {step < 3 ? 'Continue' : 'Deploy Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
