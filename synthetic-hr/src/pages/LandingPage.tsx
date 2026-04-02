import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { supabase } from '../lib/supabase-client';
import {
  Brain, ArrowRight, Play, FileText, DollarSign, BarChart3,
  Shield, ZapOff, TrendingUp, Users, CheckCircle, Sparkles, Lock,
  Gauge, Target, ChevronDown, Building2, Award,
  TrendingDown, Menu, X
} from 'lucide-react';

interface LandingPageProps {
  onSignUp: () => void;
  onLogin: () => void;
  onDemo?: () => void;
}

type PricingProfile = {
  id: string;
  label: string;
  team: string;
  conversations: number;
  agents: number;
  governance: 'essentials' | 'scale' | 'command';
};

type PlanCard = {
  name: string;
  subtitle: string;
  price: string;
  cadence: string;
  bestFor: string;
  features: string[];
  cta: string;
  accent: string;
};

const PRICING_PROFILES: PricingProfile[] = [
  { id: 'pilot', label: 'Pilot Team', team: '2-10 people', conversations: 1800, agents: 6, governance: 'essentials' },
  { id: 'growth', label: 'Growth Ops', team: '10-50 people', conversations: 8500, agents: 22, governance: 'scale' },
  { id: 'enterprise', label: 'Enterprise Fleet', team: '50+ people', conversations: 24000, agents: 80, governance: 'command' },
];

const GOVERNANCE_OPTIONS = [
  { id: 'essentials', label: 'Essentials', multiplier: 1, note: 'Baseline audits and monthly governance' },
  { id: 'scale', label: 'Scale', multiplier: 1.35, note: 'Weekly reviews, cost controls, and incident ops' },
  { id: 'command', label: 'Command', multiplier: 1.8, note: 'Always-on control plane and executive reporting' },
] as const;

const PLAN_CARDS: PlanCard[] = [
  {
    name: 'The Audit',
    subtitle: 'One-time assessment',
    price: '₹25,000',
    cadence: '/one-time',
    bestFor: 'Teams validating a first AI rollout',
    features: ['AI Workforce Health Scan', 'Risk score and leakage report', '1-hour strategic review', 'Governance action plan'],
    cta: 'Book Audit',
    accent: 'border-white/12 bg-white/[0.04]',
  },
  {
    name: 'The Retainer',
    subtitle: 'Continuous governance',
    price: '₹40k-₹60k',
    cadence: '/month',
    bestFor: 'Operating teams with active agent fleets',
    features: ['Weekly behavioral reviews', 'Token cost optimization', 'Incident log and black box', 'Monthly performance report'],
    cta: 'Start Retainer',
    accent: 'border-cyan-400/50 bg-[linear-gradient(180deg,rgba(34,211,238,0.18),rgba(8,47,73,0.32))]',
  },
  {
    name: 'Enterprise',
    subtitle: 'Governance partnership',
    price: 'Custom',
    cadence: 'engagement',
    bestFor: 'Regulated orgs running business-critical AI',
    features: ['Policy enforcement planning', 'Real-time blocking and kill switch workflows', 'Dedicated governance manager', 'Executive-ready compliance layer'],
    cta: 'Contact Sales',
    accent: 'border-emerald-400/30 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(6,78,59,0.22))]',
  },
];

// Static color map to replace dynamic Tailwind class construction (JIT fix)
const pillarColorMap: Record<string, { bg: string; border: string; text: string }> = {
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-300' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-300' },
  // alias used by pillar 6

  red: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-300' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-300' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-300' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-300' },
  green: { bg: 'bg-green-500/10', border: 'border-green-500/20', text: 'text-green-300' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-300' },
};

// Animated counter component
function AnimatedCounter({ target, label, suffix = '' }: { target: number; label: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setIsVisible(true);
      return;
    }

    const element = elementRef.current;
    const supportsObserver = typeof window !== 'undefined' && typeof (window as any).IntersectionObserver === 'function';

    if (!supportsObserver || !element) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setIsVisible(true);
    }, { threshold: 0.1 });

    observer.observe(element);
    return () => observer.disconnect();
  }, [isVisible, label]);

  useEffect(() => {
    if (!isVisible) return;

    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setCount(target);
      return;
    }

    const duration = 2000;
    const steps = 60;
    const increment = target / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [isVisible, target]);

  return (
    <div ref={elementRef} className="text-center">
      <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
        {count.toLocaleString()}{suffix}
      </div>
      <p className="text-slate-400 mt-2">{label}</p>
    </div>
  );
}

const PREVIEW_TABS = ['Overview', 'Fleet', 'Incidents', 'Costs'] as const;
type PreviewTab = typeof PREVIEW_TABS[number];

const DEMO_AGENTS = [
  { name: 'Support Bot', type: 'support', model: 'GPT-4o', status: 'active', risk: 'low', riskScore: 23, conversations: 15420, spend: 462, budget: 1000 },
  { name: 'Sales Assistant', type: 'sales', model: 'Claude 3.5', status: 'active', risk: 'medium', riskScore: 45, conversations: 8932, spend: 267, budget: 500 },
  { name: 'HR Bot', type: 'hr', model: 'GPT-4o', status: 'active', risk: 'low', riskScore: 18, conversations: 4521, spend: 135, budget: 300 },
  { name: 'Refund Handler', type: 'finance', model: 'GPT-4o', status: 'paused', risk: 'high', riskScore: 78, conversations: 2341, spend: 70, budget: 200 },
  { name: 'Knowledge Base', type: 'support', model: 'Claude 3.5', status: 'active', risk: 'low', riskScore: 12, conversations: 28754, spend: 862, budget: 1500 },
];

const DEMO_INCIDENTS = [
  { title: 'Unauthorized Refund Approved', agent: 'Refund Handler', severity: 'critical', status: 'open', time: '2h ago' },
  { title: 'Potential PII Exposure', agent: 'Support Bot', severity: 'high', status: 'open', time: '1d ago' },
  { title: 'Incorrect Pricing Information', agent: 'Sales Assistant', severity: 'low', status: 'resolved', time: '2d ago' },
];

function PreviewOverview() {
  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Active Agents', value: '5', sub: '1 paused', color: 'text-cyan-400' },
          { label: 'Open Incidents', value: '2', sub: '1 critical', color: 'text-red-400' },
          { label: 'Monthly Cost', value: '$1,797', sub: '↑ 8% vs last mo', color: 'text-emerald-400' },
          { label: 'Fleet Uptime', value: '99.4%', sub: 'last 30 days', color: 'text-blue-400' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl bg-white/[0.06] border border-white/10 p-4">
            <div className="text-xs text-slate-400 mb-1">{card.label}</div>
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-xs text-slate-500 mt-1">{card.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 rounded-xl bg-white/[0.06] border border-white/10 p-4">
          <div className="text-xs text-slate-400 mb-3">Recent Activity</div>
          <div className="space-y-2">
            {[
              { dot: 'bg-red-400', text: 'Refund Handler flagged for policy override', time: '2h ago' },
              { dot: 'bg-yellow-400', text: 'Support Bot cost alert — 92% of budget used', time: '5h ago' },
              { dot: 'bg-emerald-400', text: 'Knowledge Base passed shadow mode test (96%)', time: '1d ago' },
              { dot: 'bg-blue-400', text: 'Sales Assistant integrated with HubSpot', time: '2d ago' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`w-2 h-2 rounded-full ${item.dot} flex-shrink-0 mt-1.5`} />
                <span className="text-xs text-slate-300 flex-1">{item.text}</span>
                <span className="text-xs text-slate-500 flex-shrink-0">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.06] border border-white/10 p-4">
          <div className="text-xs text-slate-400 mb-3">Risk Distribution</div>
          <div className="space-y-2">
            {[{ label: 'Low', count: 3, color: 'bg-emerald-400', pct: 60 }, { label: 'Medium', count: 1, color: 'bg-yellow-400', pct: 20 }, { label: 'High', count: 1, color: 'bg-red-400', pct: 20 }].map((r) => (
              <div key={r.label}>
                <div className="flex justify-between text-xs text-slate-400 mb-1"><span>{r.label}</span><span>{r.count}</span></div>
                <div className="h-1.5 rounded-full bg-white/10"><div className={`h-1.5 rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewFleet() {
  return (
    <div className="p-5 space-y-2">
      {DEMO_AGENTS.map((agent) => (
        <div key={agent.name} className="flex items-center gap-4 rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-3 hover:bg-white/[0.08] transition-colors">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${agent.status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{agent.name}</div>
            <div className="text-xs text-slate-400">{agent.model} · {agent.conversations.toLocaleString()} conversations</div>
          </div>
          <div className={`text-xs font-semibold px-2 py-0.5 rounded-full ${agent.risk === 'low' ? 'bg-emerald-400/15 text-emerald-400' : agent.risk === 'medium' ? 'bg-yellow-400/15 text-yellow-400' : 'bg-red-400/15 text-red-400'}`}>
            {agent.risk} risk
          </div>
          <div className="w-24">
            <div className="flex justify-between text-xs text-slate-400 mb-1"><span>${agent.spend}</span><span>${agent.budget}</span></div>
            <div className="h-1.5 rounded-full bg-white/10"><div className={`h-1.5 rounded-full ${agent.spend / agent.budget > 0.8 ? 'bg-red-400' : 'bg-cyan-400'}`} style={{ width: `${(agent.spend / agent.budget) * 100}%` }} /></div>
          </div>
          <div className={`text-xs px-2 py-0.5 rounded-md border ${agent.status === 'active' ? 'border-emerald-400/30 text-emerald-400' : 'border-slate-600 text-slate-500'}`}>
            {agent.status}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewIncidents() {
  return (
    <div className="p-5 space-y-3">
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[{ label: 'Total', value: '3', color: 'text-white' }, { label: 'Open', value: '2', color: 'text-red-400' }, { label: 'Resolved', value: '1', color: 'text-emerald-400' }].map((s) => (
          <div key={s.label} className="rounded-xl bg-white/[0.06] border border-white/10 p-3 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      {DEMO_INCIDENTS.map((inc) => (
        <div key={inc.title} className="flex items-start gap-4 rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${inc.severity === 'critical' ? 'bg-red-400' : inc.severity === 'high' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white">{inc.title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{inc.agent} · {inc.time}</div>
          </div>
          <div className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${inc.severity === 'critical' ? 'bg-red-400/15 text-red-400' : inc.severity === 'high' ? 'bg-orange-400/15 text-orange-400' : 'bg-yellow-400/15 text-yellow-400'}`}>
            {inc.severity}
          </div>
          <div className={`text-xs px-2 py-0.5 rounded-md border flex-shrink-0 ${inc.status === 'open' ? 'border-red-400/30 text-red-400' : 'border-emerald-400/30 text-emerald-400'}`}>
            {inc.status}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewCosts() {
  const total = DEMO_AGENTS.reduce((sum, a) => sum + a.spend, 0);
  return (
    <div className="p-5 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'This Month', value: `$${total.toLocaleString()}`, color: 'text-cyan-400' }, { label: 'Projected', value: `$${Math.round(total * 1.08).toLocaleString()}`, color: 'text-yellow-400' }, { label: 'Saved vs. Unmanaged', value: '$847', color: 'text-emerald-400' }].map((s) => (
          <div key={s.label} className="rounded-xl bg-white/[0.06] border border-white/10 p-4">
            <div className="text-xs text-slate-400 mb-1">{s.label}</div>
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-white/[0.06] border border-white/10 p-4">
        <div className="text-xs text-slate-400 mb-4">Cost by Agent</div>
        <div className="space-y-3">
          {[...DEMO_AGENTS].sort((a, b) => b.spend - a.spend).map((agent) => (
            <div key={agent.name} className="flex items-center gap-3">
              <div className="w-28 text-xs text-slate-300 truncate">{agent.name}</div>
              <div className="flex-1 h-5 rounded-md bg-white/[0.06] overflow-hidden relative">
                <div
                  className="h-full rounded-md bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                  style={{ width: `${(agent.spend / total) * 100}%` }}
                />
              </div>
              <div className="w-14 text-right text-xs text-slate-300">${agent.spend}</div>
              <div className="w-10 text-right text-xs text-slate-500">{Math.round((agent.spend / total) * 100)}%</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductPreview({ onDemo, onSignUp }: { onDemo?: () => void; onSignUp: () => void }) {
  const [activeTab, setActiveTab] = useState<PreviewTab>('Overview');

  return (
    <div className="rounded-2xl overflow-hidden border border-white/15 shadow-2xl shadow-blue-900/30 bg-slate-950/80 backdrop-blur-xl">
      {/* Fake browser chrome */}
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-white/10">
        <span className="w-3 h-3 rounded-full bg-red-400/70" />
        <span className="w-3 h-3 rounded-full bg-yellow-400/70" />
        <span className="w-3 h-3 rounded-full bg-emerald-400/70" />
        <div className="flex-1 mx-4 h-6 rounded-md bg-white/[0.06] border border-white/10 flex items-center px-3">
          <span className="text-xs text-slate-500">app.rasi.ai · Demo Mode</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/30">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-xs text-cyan-400 font-medium">Live Preview</span>
        </div>
      </div>

      {/* Mock sidebar + content */}
      <div className="flex" style={{ minHeight: '380px' }}>
        {/* Mini sidebar — hidden on very small screens */}
        <div className="hidden sm:flex w-40 bg-slate-900/60 border-r border-white/[0.07] p-3 flex-col gap-1 flex-shrink-0">
          {(PREVIEW_TABS as unknown as PreviewTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab
                  ? 'bg-white/[0.1] text-white border border-white/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }`}
            >
              {tab}
            </button>
          ))}
          <div className="mt-auto pt-4 border-t border-white/[0.07] space-y-1">
            {['Integrations', 'Costs', 'Settings'].map((item) => (
              <div key={item} className="px-3 py-1.5 text-xs text-slate-600">{item}</div>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {/* Mobile tab bar */}
          <div className="flex sm:hidden border-b border-white/10 bg-slate-900/60">
            {(PREVIEW_TABS as unknown as PreviewTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-medium transition-all ${
                  activeTab === tab
                    ? 'text-white border-b-2 border-cyan-400'
                    : 'text-slate-400'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          {activeTab === 'Overview' && <PreviewOverview />}
          {activeTab === 'Fleet' && <PreviewFleet />}
          {activeTab === 'Incidents' && <PreviewIncidents />}
          {activeTab === 'Costs' && <PreviewCosts />}
        </div>
      </div>

      {/* Bottom CTA strip */}
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-900/80 to-blue-950/60 border-t border-white/10">
        <span className="text-xs text-slate-400">Sample data only — sign up to connect your real AI agents</span>
        <div className="flex items-center gap-3">
          {onDemo && (
            <button onClick={onDemo} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium flex items-center gap-1">
              <Play className="w-3.5 h-3.5" /> Full Interactive Demo
            </button>
          )}
          <button onClick={onSignUp} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/30 transition-colors font-medium">
            Sign Up Free
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage({ onSignUp, onLogin, onDemo }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<PricingProfile['id']>('growth');
  const [monthlyConversations, setMonthlyConversations] = useState(8500);
  const [activeAgents, setActiveAgents] = useState(22);
  const [governanceLayer, setGovernanceLayer] = useState<(typeof GOVERNANCE_OPTIONS)[number]['id']>('scale');
  const [calcEmail, setCalcEmail] = useState('');
  const [calcEmailSent, setCalcEmailSent] = useState(false);
  const year = new Date().getFullYear();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const stats = [
    { icon: Users, value: 500, label: 'AI Agents Governed' },
    { icon: DollarSign, value: 15, label: 'Million Tokens Managed', suffix: 'M' },
    { icon: TrendingDown, value: 40, label: 'Avg Cost Reduction', suffix: '%' },
    { icon: Award, value: 50, label: 'Enterprise Clients' },
  ];

  const pillars = [
    {
      id: 1,
      icon: BarChart3,
      color: 'from-cyan-500 to-blue-600',
      bgColor: 'cyan',
      title: 'Know What Agents Are Doing',
      subtitle: 'Real-time LLM Gateway',
      problem: 'No visibility into what your agents are actually doing.',
      features: [
        'OpenAI-compatible proxy for any agent',
        'Every request & response logged',
        'Multi-provider: OpenAI, Anthropic, 340+ models',
        'Per-agent usage dashboards'
      ],
      impact: '100% Visibility'
    },
    {
      id: 2,
      icon: Shield,
      color: 'from-red-500 to-red-600',
      bgColor: 'red',
      title: 'Catch Risk Before Users Do',
      subtitle: 'Real-time Incident Detection',
      problem: 'PII leaks, hallucinations, and policy violations reaching users.',
      features: [
        'Aadhaar, PAN, UPI ID detection',
        'Hallucination & prompt injection alerts',
        'Toxic output & refund abuse detection',
        'Severity scoring: low → critical'
      ],
      impact: '⚡ Real-time Protection'
    },
    {
      id: 3,
      icon: ZapOff,
      color: 'from-amber-500 to-orange-600',
      bgColor: 'amber',
      title: 'Keep Humans In Control',
      subtitle: 'Action Policies & Kill Switch',
      problem: 'Rogue agents with no approval gates or circuit breakers.',
      features: [
        'Action policies with conditional routing',
        'Human-in-the-loop approval workflows',
        'Instant kill switch — 3-level escalation',
        'Budget caps & rate limiting per agent'
      ],
      impact: '⚡ Instant Control'
    },
    {
      id: 4,
      icon: FileText,
      color: 'from-purple-500 to-purple-600',
      bgColor: 'purple',
      title: 'Show Evidence Fast',
      subtitle: 'Black Box & Audit Trails',
      problem: 'No defensible evidence when regulators or customers ask.',
      features: [
        'Downloadable Black Box evidence payloads',
        'Immutable audit logs for every action',
        'Safe Harbor SLA & contract management',
        'DPDPA & NIST AI RMF compliance mapping'
      ],
      impact: '100% Auditable'
    },
    {
      id: 5,
      icon: Target,
      color: 'from-violet-500 to-violet-600',
      bgColor: 'violet',
      title: 'Test Before You Trust',
      subtitle: 'Shadow Mode Adversarial Testing',
      problem: 'Agents that look safe in dev but fail in production.',
      features: [
        'Prompt injection attack simulations',
        'PII exfiltration resistance tests',
        'Policy override & jailbreak probes',
        'Pre-production behavioral scoring'
      ],
      impact: 'Test Before Harm'
    },
    {
      id: 6,
      icon: DollarSign,
      color: 'from-emerald-500 to-green-600',
      bgColor: 'emerald',
      title: 'Control Spend Early',
      subtitle: 'Multi-provider Cost Optimization',
      problem: 'Token leakage and no visibility into AI spend by agent.',
      features: [
        'Cost tracking across OpenAI, Anthropic, OpenRouter',
        'Prompt caching for repeat queries',
        'Budget alerts & auto-throttling',
        'Model comparison: cost vs performance'
      ],
      impact: '↓47% Avg Cost'
    }
  ];

  const testimonials = [
    {
      name: 'Sarah Chen',
      role: 'CTO at FinTech Corp',
      text: 'Reduced our AI operational costs by 47% in the first month. The governance framework is a game-changer.',
      avatar: '👩‍💼'
    },
    {
      name: 'Michael Rodriguez',
      role: 'VP Ops at SaaS Platform',
      text: 'Finally have visibility into what our 80+ AI agents are doing. This is infrastructure we should have built years ago.',
      avatar: '👨‍💼'
    },
    {
      name: 'Priya Patel',
      role: 'Founder at AI Agency',
      text: 'Our clients love the transparency and control. We charge more, deliver better, and sleep better at night.',
      avatar: '👩‍💻'
    }
  ];

  const calculator = useMemo(() => {
    const profile = PRICING_PROFILES.find((item) => item.id === selectedProfile) || PRICING_PROFILES[1];
    const governanceConfig = GOVERNANCE_OPTIONS.find((item) => item.id === governanceLayer) || GOVERNANCE_OPTIONS[1];
    const opsLoad = monthlyConversations * 1.6 + activeAgents * 220;
    const estimatedHours = Math.round((opsLoad / 1800) * governanceConfig.multiplier);
    const rawInvestment = Math.round((18000 + estimatedHours * 1450) * governanceConfig.multiplier);
    // Never quote below the actual Retainer floor (₹40,000/month)
    const monthlyInvestment = Math.max(rawInvestment, 40000);
    const costLeakage = Math.round(monthlyInvestment * 0.42);
    const savingsWindow = {
      low: Math.round(costLeakage * 0.7),
      high: Math.round(costLeakage * 1.15),
    };

    let recommendation = PLAN_CARDS[0];
    if (monthlyInvestment >= 70000 || governanceLayer === 'command' || activeAgents >= 60) {
      recommendation = PLAN_CARDS[2];
    } else if (monthlyInvestment >= 40000 || governanceLayer === 'scale' || monthlyConversations >= 5000) {
      recommendation = PLAN_CARDS[1];
    }

    return {
      profile,
      governanceConfig,
      monthlyInvestment,
      estimatedHours,
      savingsWindow,
      recommendation,
      coverageScore: Math.min(98, Math.round(58 + activeAgents / 2 + governanceConfig.multiplier * 12)),
    };
  }, [activeAgents, governanceLayer, monthlyConversations, selectedProfile]);

  const applyPricingProfile = (profileId: PricingProfile['id']) => {
    const profile = PRICING_PROFILES.find((item) => item.id === profileId);
    if (!profile) return;

    setSelectedProfile(profileId);
    setMonthlyConversations(profile.conversations);
    setActiveAgents(profile.agents);
    setGovernanceLayer(profile.governance);
  };

  const NAV_LINKS = [
    { href: '#how-it-works', label: 'How it works' },
    { href: '#stats', label: 'Results' },
    { href: '#pillars', label: 'Features' },
    { href: '#pricing', label: 'Pricing' },
  ];

  return (
    <div className="min-h-screen app-bg overflow-hidden text-slate-50">
      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-slate-950/70 backdrop-blur-xl border-b border-white/10'
          : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">RASI</span>
                <span className="text-xs text-blue-300 block -mt-1">AI Agent Governance</span>
              </div>
            </div>

            {/* Desktop nav links */}
            <div className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="text-slate-300 hover:text-white transition-colors text-sm">
                  {link.label}
                </a>
              ))}
              <button
                onClick={onLogin}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors text-sm"
              >
                Sign In
              </button>
              <button
                onClick={onSignUp}
                className="btn-primary text-sm px-5 py-2.5"
              >
                Start Free
              </button>
            </div>

            {/* Hamburger button — mobile only */}
            <button
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="md:hidden p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile dropdown menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-3 pb-4 border-t border-white/10 pt-4 flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] transition-all text-sm font-medium"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-3 flex flex-col gap-2 pt-3 border-t border-white/10">
                <button
                  onClick={() => { setMobileMenuOpen(false); onLogin(); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] transition-all text-sm font-medium"
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setMobileMenuOpen(false); onSignUp(); }}
                  className="btn-primary text-sm w-full justify-center"
                >
                  Start Free
                </button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center relative overflow-hidden pt-20">
        {/* Animated background elements — single blob, no animate-pulse for performance */}
        <div className="absolute inset-0">
          <div className="absolute top-20 left-10 w-80 h-80 bg-blue-500/14 rounded-full blur-3xl" />
        </div>

        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/55 to-slate-950" />

        <div className="relative z-10 max-w-6xl mx-auto px-6">
          <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-blue-300" />
            <span className="text-sm text-slate-200">AI control plane for teams running live agents in production</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-black text-white mb-6 leading-tight">
            Your AI agents are already working.
            <br />
            <span className="gradient-text">Give your team one place to watch, protect, and control them.</span>
          </h1>

          <p className="text-sm sm:text-base md:text-lg lg:text-xl text-slate-300 mb-12 max-w-3xl mx-auto leading-relaxed">
            Rasi gives your team one place to <span className="text-slate-100 font-semibold">see live activity, catch risky behavior, and stay in control</span> without slowing down delivery —
            <br className="hidden md:block" />
            whether the agents run in your app, your support stack, or your internal workflows.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-8 sm:mb-12 md:mb-16">
            <button
              onClick={onSignUp}
              className="btn-primary group w-full sm:w-auto"
            >
              Start Free
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            {onDemo ? (
              <button
                onClick={onDemo}
                className="btn-secondary group w-full sm:w-auto"
              >
                <Play className="w-5 h-5" />
                Try Demo
              </button>
            ) : null}
          </div>

          {/* Floating stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { value: '1 View', label: 'for agents, incidents, apps, and spend' },
              { value: '<10 min', label: 'to first useful signal' },
              { value: '-47%', label: 'average cost reduction' },
              { value: 'DPDPA', label: 'India-ready controls' }
            ].map((stat, i) => (
              <div
                key={i}
                className="p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 transition-all"
              >
                <div className="text-2xl font-bold text-cyan-400">{stat.value}</div>
                <div className="mt-1 text-sm leading-5 text-slate-400">{stat.label}</div>
              </div>
            ))}
          </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-cyan-400" />
        </div>
      </section>

      {/* Stats Section */}
      <section id="stats" className="py-24 px-6 relative">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {stats.map((stat, i) => (
              <AnimatedCounter
                key={i}
                target={stat.value}
                label={stat.label}
                suffix={stat.suffix || ''}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Product Preview Section */}
      <section id="preview" className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-900/10 to-transparent" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="mb-12 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end md:mb-16 lg:mb-20">
            <div>
              <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Live Preview</span>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">See what a calmer control plane feels like</h2>
              <p className="text-slate-400 mt-4 text-lg max-w-2xl">
                Browse the product the way an operator would: what is running, what needs attention, and what to do next.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">What you should notice</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  { title: 'One recommended next step', detail: 'The interface should tell operators where to act first.' },
                  { title: 'Clear status without noise', detail: 'Important signals should stand out without turning into a wall of cards.' },
                  { title: 'Progressive depth', detail: 'Advanced controls should appear when needed, not all at once.' },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <ProductPreview onDemo={onDemo} onSignUp={onSignUp} />

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
            {onDemo && (
              <button
                onClick={onDemo}
                className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:from-cyan-600 hover:to-blue-700 transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30"
              >
                <Play className="w-5 h-5" />
                Enter Interactive Demo
              </button>
            )}
            <button
              onClick={onSignUp}
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl border border-white/15 bg-white/[0.05] text-white font-semibold hover:bg-white/[0.09] transition-all backdrop-blur-md"
            >
              Start Free
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-transparent to-cyan-500/5" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-12 md:mb-16 lg:mb-20">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">How it works</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">Connect once. Get visibility, protection, and control.</h2>
            <p className="text-lg sm:text-xl text-slate-400 mt-6 max-w-3xl mx-auto">
              The default path is simple: connect an agent, connect an app, run one test, and see exactly what is happening.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {[
              {
                step: 1,
                icon: FileText,
                title: 'Connect',
                desc: 'Point any AI agent at the Rasi gateway so traffic, cost, and risk all have one home.'
              },
              {
                step: 2,
                icon: BarChart3,
                title: 'See',
                desc: 'Know what agents are doing, what they cost, and where behavior is starting to drift.'
              },
              {
                step: 3,
                icon: ZapOff,
                title: 'Protect',
                desc: 'Catch risky output, require approvals where needed, and intervene before bad behavior reaches customers.'
              },
              {
                step: 4,
                icon: Shield,
                title: 'Control',
                desc: 'Use evidence, audit trails, and operational controls when the stakes or complexity increase.'
              }
            ].map((item, i) => (
              <div
                key={i}
                className="group relative p-4 sm:p-6 lg:p-8 rounded-2xl bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-cyan-400/50 transition-all overflow-hidden"
              >
                <div className="relative">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center group-hover:shadow-lg group-hover:shadow-cyan-500/30 transition-all">
                      <item.icon className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-3xl font-black text-white/10">0{item.step}</span>
                  </div>

                  <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-400 mb-2">Step {item.step}</div>
                  <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
                  <p className="text-slate-400 leading-6">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The 4 Pillars Section */}
      <section id="pillars" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-16 lg:mb-20">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Core outcomes</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">Built to give you visibility, protection, and control</h2>
            <p className="text-lg text-slate-400 mt-4 max-w-2xl mx-auto">The product stays simple first, then reveals deeper governance and operator tooling when you need it.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {pillars.map((pillar) => {
              const colors = pillarColorMap[pillar.bgColor] ?? { bg: 'bg-white/5', border: 'border-white/10', text: 'text-slate-300' };
              return (
                <div
                  key={pillar.id}
                  className="group relative p-4 sm:p-6 lg:p-8 rounded-2xl transition-all duration-300 cursor-pointer overflow-hidden"
                >
                  <div className={`absolute inset-0 rounded-2xl border border-white/10 transition-all group-hover:${colors.border}`} />
                  <div className={`absolute inset-0 rounded-2xl ${colors.bg} opacity-0 transition-opacity group-hover:opacity-100`} />
                  <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-xl rounded-2xl" />

                  <div className="relative z-10">
                    <div className="mb-6 flex items-start justify-between gap-4">
                      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${pillar.color} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all group-hover:scale-110`}>
                        <pillar.icon className="w-7 h-7 text-white" />
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate-300">
                        {pillar.impact}
                      </span>
                    </div>

                    <h3 className="text-2xl font-bold text-white mb-1">{pillar.title}</h3>
                    <p className="text-sm text-cyan-400 font-semibold mb-4">{pillar.subtitle}</p>

                    <p className="text-slate-400 mb-6"><span className="font-semibold text-slate-300">Problem:</span> {pillar.problem}</p>

                    <ul className="space-y-3">
                      {pillar.features.slice(0, 3).map((feature, j) => (
                        <li key={j} className="flex items-start gap-3">
                          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                          <span className="text-slate-300">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-800/30 to-transparent" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-12 md:mb-16">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Trusted by Teams</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">Real Results, Real Impact</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {testimonials.map((testimonial, i) => (
              <div
                key={i}
                className="p-4 sm:p-6 lg:p-8 rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-cyan-400/30 transition-all hover:bg-white/[0.12]"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="text-4xl">{testimonial.avatar}</div>
                  <div>
                    <p className="font-semibold text-white">{testimonial.name}</p>
                    <p className="text-sm text-slate-400">{testimonial.role}</p>
                  </div>
                </div>
                <p className="text-slate-300 italic">"{testimonial.text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why RASI Section */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Built for India</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">The Only AI Governance Platform That's India-Native</h2>
            <p className="text-lg text-slate-400 mt-4 max-w-2xl mx-auto">INR pricing. DPDPA compliance. Aadhaar & PAN detection. India-specific integrations. No USD conversion surprises.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {[
              { icon: Lock, title: 'Agent-Agnostic', desc: 'Governs ANY agent — OpenAI, Anthropic, LangChain, Haptik, Yellow.ai, or custom-built. Rasi doesn\'t replace your agents, it governs them.' },
              { icon: Gauge, title: 'LLM Gateway Proxy', desc: 'OpenAI-compatible endpoint. One line of code to route any agent through Rasi. Incident detection + cost tracking starts immediately.' },
              { icon: Shield, title: 'India-Specific PII', desc: 'Detects Aadhaar numbers, PAN cards, UPI IDs, and Indian bank accounts in real-time — not just generic SSN/credit card patterns.' },
              { icon: Target, title: 'DPDPA Compliance', desc: 'Mapping to India\'s Digital Personal Data Protection Act 2023. Built-in breach notification, data principal rights, and audit evidence.' },
              { icon: TrendingUp, title: 'INR Pricing', desc: 'From ₹0 (free tier) to ₹15K–₹60K/month. No per-seat pricing. No USD conversion. Designed for Indian mid-market teams.' },
              { icon: Award, title: 'VPC-Ready Runtime', desc: 'Run governance workers inside your own VPC. Secure outbound-only polling — no inbound ports, no data leaving your network.' },
            ].map((item, i) => (
              <div
                key={i}
                className="p-4 sm:p-6 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/[0.08] hover:border-cyan-400/30 transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Pricing Calculator</span>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mt-4">Estimate governance cost like an operating model</h2>
              <p className="text-slate-400 mt-4 text-lg">
                Inspired by model pricing directories, but built around RASI: active agents, governance intensity, and the operational load your AI workforce creates.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-5 py-4 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Recommended Plan</p>
              <p className="mt-2 text-2xl font-bold text-white">{calculator.recommendation.name}</p>
              <p className="text-sm text-cyan-100/80">{calculator.recommendation.bestFor}</p>
            </div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 md:p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
            <div>
              <div className="rounded-[28px] border border-white/10 bg-slate-950/65 p-4 sm:p-6 backdrop-blur-xl">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">Live Calculator</p>
                    <h3 className="mt-2 text-3xl font-bold text-white">Governance workload estimator</h3>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Coverage Score</p>
                    <p className="mt-1 text-3xl font-bold text-white">{calculator.coverageScore}%</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {PRICING_PROFILES.map((profile) => {
                    const active = profile.id === selectedProfile;
                    return (
                      <button
                        key={profile.id}
                        onClick={() => applyPricingProfile(profile.id)}
                        className={`rounded-2xl border p-4 text-left transition-all ${active ? 'border-cyan-400 bg-cyan-500/12 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]' : 'border-white/10 bg-white/[0.03] hover:border-cyan-400/30'}`}
                      >
                        <p className="text-sm font-semibold text-white">{profile.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{profile.team}</p>
                        <p className="mt-4 text-sm text-slate-300">{profile.agents} agents · {profile.conversations.toLocaleString()} monthly conversations</p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between text-sm font-medium text-white">
                      <span>Monthly AI conversations</span>
                      <span className="text-cyan-300">{monthlyConversations.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min="500"
                      max="50000"
                      step="500"
                      value={monthlyConversations}
                      onChange={(e) => setMonthlyConversations(Number(e.target.value))}
                      className="mt-4 w-full accent-cyan-400"
                    />
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>500</span>
                      <span>10k</span>
                      <span>50k</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between text-sm font-medium text-white">
                      <span>Active AI agents</span>
                      <span className="text-emerald-300">{activeAgents}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="150"
                      step="1"
                      value={activeAgents}
                      onChange={(e) => setActiveAgents(Number(e.target.value))}
                      className="mt-4 w-full accent-emerald-400"
                    />
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>1</span>
                      <span>75</span>
                      <span>150</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Governance layer</p>
                      <p className="mt-1 text-sm text-slate-400">{calculator.governanceConfig.note}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {GOVERNANCE_OPTIONS.map((option) => {
                        const active = option.id === governanceLayer;
                        return (
                          <button
                            key={option.id}
                            onClick={() => setGovernanceLayer(option.id)}
                            className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${active ? 'bg-cyan-400 text-slate-950' : 'border border-white/10 bg-slate-900/80 text-slate-300 hover:border-cyan-400/30'}`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">Estimated Monthly Spend</p>
                    <p className="mt-3 text-3xl font-bold text-white">₹{calculator.monthlyInvestment.toLocaleString('en-IN')}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Governance Hours</p>
                    <p className="mt-3 text-3xl font-bold text-white">{calculator.estimatedHours}h</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">Likely Savings Window</p>
                    <p className="mt-3 text-lg font-bold text-white">₹{calculator.savingsWindow.low.toLocaleString('en-IN')} to ₹{calculator.savingsWindow.high.toLocaleString('en-IN')}</p>
                  </div>
                </div>

                {/* CTA after results */}
                <div className="mt-6 flex flex-col sm:flex-row items-center gap-3 pt-5 border-t border-white/10">
                  <button
                    onClick={() => {
                      const msg = `Hi, I used the Rasi workload estimator. My setup: ${activeAgents} agents, ${monthlyConversations.toLocaleString('en-IN')} monthly conversations, estimated ₹${calculator.monthlyInvestment.toLocaleString('en-IN')}/month. I'd like to discuss the right plan.`;
                      window.open(`https://wa.me/919433116259?text=${encodeURIComponent(msg)}`, '_blank');
                    }}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-500/20"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.85L.057 23.571a.5.5 0 0 0 .61.61l5.757-1.485A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.523-5.17-1.432l-.37-.22-3.818.985.998-3.75-.242-.386A9.956 9.956 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                    Talk to us — ₹{calculator.monthlyInvestment.toLocaleString('en-IN')}/mo estimated
                  </button>
                  <p className="text-xs text-slate-500 text-center sm:text-left">We'll recommend the right plan based on your numbers.</p>
                </div>

                {/* Email capture — for people not ready to WhatsApp */}
                <div className="mt-4">
                  {calcEmailSent ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                      <svg viewBox="0 0 20 20" className="w-4 h-4 fill-current flex-shrink-0"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                      Got it — we'll reach out to {calcEmail} within one business day.
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="email"
                        value={calcEmail}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setCalcEmail(e.target.value)}
                        placeholder="Not ready to chat? Leave your email"
                        className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-slate-500 outline-none focus:border-cyan-500/40 transition-colors"
                      />
                      <button
                        onClick={async () => {
                          if (!calcEmail.includes('@')) return;
                          await supabase.from('contact_leads').insert({
                            email: calcEmail,
                            agents: activeAgents,
                            conversations: monthlyConversations,
                            estimated_spend: `₹${calculator.monthlyInvestment.toLocaleString('en-IN')}/month`,
                          });
                          setCalcEmailSent(true);
                        }}
                        disabled={!calcEmail.includes('@')}
                        className="px-5 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-white text-sm font-semibold transition-all whitespace-nowrap"
                      >
                        Send me the plan →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Security</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">Enterprise-ready by default</h2>
            <p className="text-lg sm:text-xl text-slate-400 mt-6 max-w-3xl mx-auto">
              Least-privilege access, auditability, and safe deployment patterns built for real operations.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            {[
              {
                icon: Lock,
                title: 'Least-privilege access',
                body: 'Role-based access control and scoped API keys for services and automation.',
              },
              {
                icon: Shield,
                title: 'Audit trails + observability',
                body: 'Request IDs, structured logs, and OpenTelemetry support for production monitoring.',
              },
              {
                icon: Building2,
                title: 'Customer-managed deployment',
                body: 'Self-host with Docker/Kubernetes and configure the frontend at runtime (no rebuilds).',
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="p-4 sm:p-6 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-cyan-400/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center mb-4">
                  <item.icon className="w-6 h-6 text-cyan-300" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-blue-500/10" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl -z-10" />

        <div className="max-w-4xl mx-auto relative z-10 text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
            Your AI agents are already running. Is anyone watching?
          </h2>
          <p className="text-lg sm:text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
            Route your first agent through Rasi in 5 minutes. Free tier, no credit card required. Works with any AI agent — OpenAI, Anthropic, LangChain, or custom-built.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onSignUp}
              className="group px-6 sm:px-8 md:px-10 py-3 sm:py-4 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-bold rounded-xl hover:shadow-2xl hover:shadow-blue-500/30 transition-all transform hover:scale-105 flex items-center gap-2"
            >
              Start Free — No Credit Card
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            {onDemo ? (
              <button
                onClick={onDemo}
                className="px-6 sm:px-8 md:px-10 py-3 sm:py-4 bg-white/10 backdrop-blur-md border border-white/20 text-white font-semibold rounded-xl hover:bg-white/20 transition-all"
              >
                Schedule Demo
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-6 md:gap-8 mb-8 md:mb-12">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <span className="text-lg font-bold text-white">RASI</span>
              </div>
              <p className="text-sm text-slate-400">The governance layer for your AI workforce.</p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="#how-it-works" className="hover:text-cyan-400 transition-colors">How it works</a></li>
                <li><a href="#stats" className="hover:text-cyan-400 transition-colors">Results</a></li>
                <li><a href="#pillars" className="hover:text-cyan-400 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-cyan-400 transition-colors">Pricing</a></li>
                <li><a href="#security" className="hover:text-cyan-400 transition-colors">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Get Started</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li>
                  <button onClick={onLogin} className="hover:text-cyan-400 transition-colors">
                    Sign In
                  </button>
                </li>
                <li>
                  <button onClick={onSignUp} className="hover:text-cyan-400 transition-colors">
                    Start Free
                  </button>
                </li>
                {onDemo ? (
                  <li>
                    <button onClick={onDemo} className="hover:text-cyan-400 transition-colors">
                      Schedule Demo
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="#pricing" className="hover:text-cyan-400 transition-colors">ROI Calculator</a></li>
                <li><a href="#security" className="hover:text-cyan-400 transition-colors">Deployment Notes</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-700 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">© {year} Rasi Solutions. All rights reserved.</p>
            <div className="flex items-center gap-6 text-sm">
              <a href="#how-it-works" className="text-slate-400 hover:text-cyan-400 transition-colors">Overview</a>
              <a href="#pillars" className="text-slate-400 hover:text-cyan-400 transition-colors">Features</a>
              <a href="#security" className="text-slate-400 hover:text-cyan-400 transition-colors">Security</a>
              <a href="/terms" className="text-slate-400 hover:text-cyan-400 transition-colors">Terms</a>
              <a href="/privacy" className="text-slate-400 hover:text-cyan-400 transition-colors">Privacy</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Add smooth scroll behavior */}
      <style>{`
        html {
          scroll-behavior: smooth;
        }
        section {
          scroll-margin-top: 96px;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
