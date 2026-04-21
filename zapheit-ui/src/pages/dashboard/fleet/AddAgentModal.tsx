import { useState } from 'react';
import {
  BriefcaseBusiness, CheckCircle, ChevronDown, ChevronRight,
  Headset, Landmark, Laptop2, MessageSquare, Plus, Settings2,
  Shield, ShieldCheck, X, Zap,
} from 'lucide-react';

// ── Type config ──────────────────────────────────────────────────────────────

const AGENT_TYPES = [
  { id: 'hr',         icon: BriefcaseBusiness, label: 'HR',       desc: 'Leave, onboarding, policy Q&A' },
  { id: 'support',    icon: Headset,           label: 'Support',  desc: 'Tickets, FAQs, escalations' },
  { id: 'sales',      icon: Zap,               label: 'Sales',    desc: 'Leads, objections, follow-ups' },
  { id: 'finance',    icon: Landmark,          label: 'Finance',  desc: 'Expenses, invoices, reports' },
  { id: 'it_support', icon: Laptop2,           label: 'IT',       desc: 'Passwords, access, hardware' },
  { id: 'custom',     icon: Settings2,         label: 'Other',    desc: 'Anything else' },
] as const;

type AgentTypeId = typeof AGENT_TYPES[number]['id'];

const DEFAULT_NAMES: Record<AgentTypeId, string> = {
  hr:         'HR Assistant',
  support:    'Support Bot',
  sales:      'Sales Assistant',
  finance:    'Finance Helper',
  it_support: 'IT Helpdesk',
  custom:     'My Assistant',
};

const DEFAULT_DESCRIPTIONS: Record<AgentTypeId, string> = {
  hr:         'Answers employee questions about leave, onboarding, and HR policies.',
  support:    'Handles customer support tickets, FAQs, and escalation routing.',
  sales:      'Qualifies leads, handles objections, and schedules follow-ups.',
  finance:    'Processes expense reports, invoices, and financial summaries.',
  it_support: 'Helps employees with password resets, access requests, and hardware issues.',
  custom:     'A custom AI assistant for your specific needs.',
};

const DEFAULT_CAPABILITIES: Record<AgentTypeId, string[]> = {
  hr:         ['Policy Q&A', 'Leave Management', 'Onboarding Guidance'],
  support:    ['Ticket Routing', 'Knowledge Base Search', 'Sentiment Analysis'],
  sales:      ['Lead Qualification', 'Objection Handling', 'Meeting Scheduling'],
  finance:    ['Invoice Processing', 'Expense Categorization', 'Financial Reporting'],
  it_support: ['Password Reset', 'Access Management', 'Hardware Triage'],
  custom:     ['Data Extraction', 'API Integration'],
};

const SAFETY_RULES = [
  { id: 'block_pii',      label: 'Block sharing of private data', desc: 'Auto-detects Aadhaar, PAN, phone numbers and blocks responses.' },
  { id: 'approval_email', label: 'Require approval before sending emails', desc: 'All outbound emails need a human to approve first.' },
  { id: 'block_finance',  label: 'Block large financial actions', desc: 'Actions involving amounts over ₹50,000 need human approval.' },
  { id: 'audit_all',      label: 'Log every conversation', desc: 'Full transcript stored in activity history for 90 days.' },
];

const STEP_LABELS = ['What does it do?', 'What can it do?', 'Safety rules', 'Ready to go'];

// ── Component ────────────────────────────────────────────────────────────────

export function AddAgentModal({ onClose, onAdd }: { onClose: () => void; onAdd: (agent: any) => void }) {
  const [step, setStep] = useState(1);
  const [agentType, setAgentType] = useState<AgentTypeId>('support');
  const [name, setName] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [safetyRules, setSafetyRules] = useState<string[]>(['block_pii', 'audit_all']);
  const [documents, setDocuments] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState('gpt-4o-mini');
  const [temperature, setTemperature] = useState(0.7);
  const [budgetLimit, setBudgetLimit] = useState(1000);

  // When type changes seed defaults
  const selectType = (id: AgentTypeId) => {
    setAgentType(id);
    if (!name || Object.values(DEFAULT_NAMES).includes(name)) setName(DEFAULT_NAMES[id]);
    setCapabilities(DEFAULT_CAPABILITIES[id]);
  };

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);
  };

  const toggleSafetyRule = (id: string) => {
    setSafetyRules((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
  };

  const handleNext = () => {
    if (step === 1 && !name.trim()) { setName(DEFAULT_NAMES[agentType]); }
    if (step < 4) { setStep(step + 1); return; }
    // Submit
    const systemPromptParts = [
      `You are ${name.trim() || DEFAULT_NAMES[agentType]}, an AI assistant.`,
      DEFAULT_DESCRIPTIONS[agentType],
      capabilities.length > 0 ? `Your capabilities include: ${capabilities.join(', ')}.` : '',
      safetyRules.includes('block_pii') ? 'Never share personally identifiable information such as Aadhaar numbers, PAN cards, phone numbers, or financial details.' : '',
      documents.trim() ? `Reference knowledge base:\n${documents.trim()}` : '',
    ].filter(Boolean).join('\n');

    onAdd({
      name: name.trim() || DEFAULT_NAMES[agentType],
      description: DEFAULT_DESCRIPTIONS[agentType],
      agent_type: agentType,
      platform: 'api',
      model_name: model,
      system_prompt: systemPromptParts,
      temperature,
      status: 'active',
      lifecycle_state: 'idle',
      risk_level: 'low',
      risk_score: 25,
      conversations: 0,
      satisfaction: 95,
      uptime: 99.9,
      budget_limit: budgetLimit,
      current_spend: 0,
      auto_throttle: true,
      config: {
        features: capabilities,
        safety_rules: safetyRules,
        display_provider: 'Zapheit AI',
      },
    });
  };

  const effectiveName = name.trim() || DEFAULT_NAMES[agentType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-800 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/60 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-white">Create an AI assistant</h2>
            <p className="mt-0.5 text-xs text-slate-400">Step {step} of 4 — {STEP_LABELS[step - 1]}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i < step ? 'w-6 bg-emerald-500' : i === step ? 'w-8 bg-cyan-400' : 'w-4 bg-slate-700'
                  }`}
                />
              ))}
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-6">

          {/* ── Step 1: What ── */}
          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-400">Pick what this assistant will handle. You can rename it below.</p>
              <div className="grid grid-cols-3 gap-3">
                {AGENT_TYPES.map(({ id, icon: Icon, label, desc }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectType(id)}
                    className={`rounded-xl border p-3 text-left transition ${
                      agentType === id
                        ? 'border-cyan-500/50 bg-cyan-500/10 text-white ring-1 ring-cyan-500/30'
                        : 'border-slate-700 bg-slate-900/50 text-slate-300 hover:border-slate-600 hover:bg-slate-900'
                    }`}
                  >
                    <Icon className={`mb-2 h-5 w-5 ${agentType === id ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{desc}</p>
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Name your assistant</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={DEFAULT_NAMES[agentType]}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Tools / capabilities ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">Select what <span className="font-semibold text-white">{effectiveName}</span> can do. You can change this later.</p>
              <div className="space-y-2">
                {DEFAULT_CAPABILITIES[agentType].map((cap) => (
                  <label key={cap} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 transition hover:border-slate-600">
                    <input
                      type="checkbox"
                      checked={capabilities.includes(cap)}
                      onChange={() => toggleCapability(cap)}
                      className="h-4 w-4 rounded accent-cyan-400"
                    />
                    <span className="text-sm text-white">{cap}</span>
                    {capabilities.includes(cap) && <CheckCircle className="ml-auto h-4 w-4 shrink-0 text-emerald-400" />}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 3: Safety rules ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">Choose which safety checks apply to <span className="font-semibold text-white">{effectiveName}</span>. We recommend keeping all of them on.</p>
              <div className="space-y-2">
                {SAFETY_RULES.map((rule) => (
                  <label key={rule.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 transition hover:border-slate-600">
                    <input
                      type="checkbox"
                      checked={safetyRules.includes(rule.id)}
                      onChange={() => toggleSafetyRule(rule.id)}
                      className="mt-0.5 h-4 w-4 rounded accent-cyan-400"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{rule.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{rule.desc}</p>
                    </div>
                    {safetyRules.includes(rule.id) ? (
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 4: Review + Advanced ── */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 shrink-0 text-emerald-400" />
                  <div>
                    <p className="font-semibold text-white">{effectiveName} is ready to deploy</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {capabilities.length} {capabilities.length === 1 ? 'capability' : 'capabilities'} · {safetyRules.length} safety {safetyRules.length === 1 ? 'rule' : 'rules'} · Model: {model}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Knowledge base <span className="text-slate-500">(optional)</span>
                </label>
                <textarea
                  value={documents}
                  onChange={(e) => setDocuments(e.target.value)}
                  rows={4}
                  placeholder="Paste any text your assistant should know — FAQs, policies, product info..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-2.5 text-xs leading-relaxed text-white placeholder-slate-500 outline-none transition focus:border-cyan-500 resize-none"
                />
              </div>

              {/* Advanced accordion */}
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center gap-2 text-sm text-slate-400 transition hover:text-slate-200"
              >
                {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Advanced settings
              </button>
              {showAdvanced && (
                <div className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">AI model</label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
                    >
                      <option value="gpt-4o-mini">GPT-4o mini (recommended)</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="claude-3-5-haiku-20241022">Claude Haiku</option>
                      <option value="claude-3-5-sonnet-20241022">Claude Sonnet</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-400">
                      <span>Creativity level</span>
                      <span className="text-slate-300">{temperature === 0 ? 'Precise' : temperature <= 0.4 ? 'Focused' : temperature <= 0.7 ? 'Balanced' : 'Creative'} ({temperature})</span>
                    </label>
                    <input
                      type="range"
                      min={0} max={1} step={0.1}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                      <span>Precise</span><span>Balanced</span><span>Creative</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">Monthly budget cap (₹)</label>
                    <input
                      type="number"
                      value={budgetLimit}
                      onChange={(e) => setBudgetLimit(Number(e.target.value) || 0)}
                      min={0}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-slate-700/60 px-6 py-4">
          <button
            type="button"
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
          >
            {step < 4 ? (
              <>Continue <ChevronRight className="h-4 w-4" /></>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <MessageSquare className="h-4 w-4" />
                Deploy assistant
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
