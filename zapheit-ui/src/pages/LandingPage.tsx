import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Play, FileText, DollarSign, BarChart3,
  Shield, ZapOff, TrendingUp, Users, CheckCircle, Sparkles, Lock,
  Gauge, Target, ChevronDown, Building2, Award,
  Menu, X
} from 'lucide-react';

interface LandingPageProps {
  onSignUp: () => void;
  onLogin: () => void;
  onDemo?: () => void;
}

type SaaSPlan = {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: number | null;
  priceAnnual: number | null;
  agents: string;
  requests: string;
  members: string;
  audit: string;
  highlight: boolean;
};

const PLANS: SaaSPlan[] = [
  {
    id: 'free', name: 'Free', tagline: 'Try with 1 assistant, no credit card.',
    priceMonthly: 0, priceAnnual: 0,
    agents: '1', requests: '1,000/mo', members: '1', audit: '7 days', highlight: false,
  },
  {
    id: 'pro', name: 'Pro', tagline: 'Full visibility for small teams.',
    priceMonthly: 4999, priceAnnual: 49999,
    agents: '10', requests: '50,000/mo', members: '10', audit: '90 days', highlight: false,
  },
  {
    id: 'business', name: 'Business', tagline: 'Compliance + unlimited members + predictive alerts.',
    priceMonthly: 19999, priceAnnual: 199999,
    agents: '50', requests: '2,50,000/mo', members: 'Unlimited', audit: 'Unlimited', highlight: true,
  },
  {
    id: 'enterprise', name: 'Enterprise', tagline: 'SSO, VPC, dedicated support, custom SLAs.',
    priceMonthly: null, priceAnnual: null,
    agents: 'Unlimited', requests: 'Unlimited', members: 'Unlimited', audit: 'Unlimited', highlight: false,
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
          <span className="text-xs text-slate-500">www.zapheit.com · Demo Mode</span>
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

function useScrollReveal() {
  useEffect(() => {
    const prefersReduced = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in-view'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in-view'); }),
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

const PLATFORM_LOGOS = [
  'OpenAI', 'Anthropic', 'Google Gemini', 'LangChain', 'CrewAI',
  'Azure OpenAI', 'Llama 3', 'Mistral', 'OpenRouter', 'WhatsApp',
  'Slack', 'Jira', 'HubSpot', 'Notion', 'GitHub',
];

function PlatformMarquee() {
  const items = [...PLATFORM_LOGOS, ...PLATFORM_LOGOS];
  return (
    <div className="w-full overflow-hidden py-4 select-none" aria-hidden="true">
      <div className="flex gap-8 animate-marquee whitespace-nowrap">
        {items.map((name, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-300 transition-colors cursor-default"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage({ onSignUp, onLogin, onDemo }: LandingPageProps) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [monthlyConversations, setMonthlyConversations] = useState(8500);
  const [activeAgents, setActiveAgents] = useState(22);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [calcEmail, setCalcEmail] = useState('');
  const [calcEmailSent, setCalcEmailSent] = useState(false);
  const year = new Date().getFullYear();

  useScrollReveal();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const stats = [
    { icon: DollarSign, value: 42, label: 'average monthly savings per team', suffix: 'L+' },
    { icon: Shield, value: 3, label: 'AI problems caught before customers saw them (this week)' },
    { icon: TrendingUp, value: 22, label: 'seconds to approve or block an AI action', suffix: ' sec' },
    { icon: CheckCircle, value: 100, label: 'of decisions logged for compliance', suffix: '%' },
  ];

  const pillars = [
    {
      id: 1,
      icon: BarChart3,
      color: 'from-cyan-500 to-blue-600',
      bgColor: 'cyan',
      title: 'Know What Agents Are Doing',
      subtitle: 'AI message hub',
      problem: 'No visibility into what your agents are actually doing.',
      features: [
        'OpenAI-compatible proxy for any agent',
        'Every request & response logged',
        'Multi-provider routing across OpenAI, Anthropic, Google, and others',
        'Per-agent usage dashboards'
      ],
      impact: 'Full visibility'
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
      impact: 'Evidence ready'
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
      impact: 'Spend control'
    }
  ];

  const testimonials = [
    {
      name: 'Ops teams',
      role: 'Start with one governed workflow',
      text: 'Route risky actions into approval, keep everything logged, and give operators one place to intervene.',
      avatar: '🧭'
    },
    {
      name: 'Compliance teams',
      role: 'Package evidence faster',
      text: 'Move from scattered screenshots and ad hoc exports to one audit trail with incidents, approvals, and cost context attached.',
      avatar: '🛡️'
    },
    {
      name: 'Finance teams',
      role: 'See observed spend earlier',
      text: 'Track Zapheit-observed usage by agent and catch runaway prompts before they quietly become an end-of-month surprise.',
      avatar: '📊'
    }
  ];

  const recommendedPlan = useMemo((): SaaSPlan => {
    if (activeAgents > 50) return PLANS[3]; // Enterprise
    if (activeAgents > 10) return PLANS[2]; // Business
    if (activeAgents > 1)  return PLANS[1]; // Pro
    return PLANS[0];                        // Free
  }, [activeAgents]);

  const displayPrice = (plan: SaaSPlan): string => {
    if (plan.priceMonthly === null) return 'Custom';
    if (plan.priceMonthly === 0) return '₹0';
    const price = billingCycle === 'annual' ? Math.round((plan.priceAnnual ?? 0) / 12) : plan.priceMonthly;
    return `₹${price.toLocaleString('en-IN')}`;
  };

  const NAV_LINKS = [
    { href: '#how-it-works', label: 'How it works', page: false },
    { href: '#stats', label: 'Results', page: false },
    { href: '/features', label: 'Features', page: true },
    { href: '/pricing', label: 'Pricing', page: true },
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
            <div className="flex items-center">
              <img src="/logo-dark.png" alt="Zapheit" className="h-12 w-auto object-contain rounded-lg" />
            </div>

            {/* Desktop nav links */}
            <div className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((link) =>
                link.page ? (
                  <button key={link.href} onClick={() => navigate(link.href)} className="text-slate-300 hover:text-white transition-colors text-sm">
                    {link.label}
                  </button>
                ) : (
                  <a key={link.href} href={link.href} className="text-slate-300 hover:text-white transition-colors text-sm">
                    {link.label}
                  </a>
                )
              )}
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
              {NAV_LINKS.map((link) =>
                link.page ? (
                  <button
                    key={link.href}
                    onClick={() => { navigate(link.href); setMobileMenuOpen(false); }}
                    className="px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] transition-all text-sm font-medium text-left"
                  >
                    {link.label}
                  </button>
                ) : (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="px-3 py-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.07] transition-all text-sm font-medium"
                  >
                    {link.label}
                  </a>
                )
              )}
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
      <section className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden pt-20">
        {/* Animated mesh gradient background */}
        <div
          className="absolute inset-0 opacity-50"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.18) 0%, rgba(34,211,238,0.12) 35%, rgba(99,102,241,0.14) 65%, rgba(6,182,212,0.10) 100%)',
            backgroundSize: '200% 200%',
            animation: 'mesh-move 14s ease-in-out infinite',
          }}
        />
        {/* Ambient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-blue-500/14 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-32 right-16 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl animate-float delay-200" />
          <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-violet-500/08 rounded-full blur-[80px]" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/50 to-slate-950" />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-6">
          <div className="mx-auto max-w-5xl text-center">
            {/* Chip */}
            <div className="reveal inline-flex items-center gap-2 px-4 py-2 mb-8 rounded-full border border-cyan-500/25 bg-cyan-500/[0.07] backdrop-blur-md shadow-[0_0_30px_rgba(34,211,238,0.10)]">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <span className="text-sm text-slate-200 font-medium">The AI governance platform built for India</span>
            </div>

            {/* Headline — dramatically larger */}
            <h1 className="reveal reveal-delay-1 text-5xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-[5.5rem] font-black text-white mb-6 leading-[0.95] tracking-tight">
              See everything<br />
              <span className="gradient-text">your AI does.</span>
            </h1>

            <p className="reveal reveal-delay-2 text-lg sm:text-xl md:text-2xl font-semibold text-slate-300 mb-3 max-w-3xl mx-auto leading-snug">
              Stop problems before they reach your customers.
            </p>

            <p className="reveal reveal-delay-2 text-sm sm:text-base md:text-lg text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
              Zapheit is <span className="text-slate-200 font-semibold">HR for your AI workforce</span> — monitor performance, enforce rules, and review decisions in real time.
            </p>

            {/* CTAs */}
            <div className="reveal reveal-delay-3 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-8">
              <button
                onClick={onSignUp}
                className="btn-primary group w-full sm:w-auto text-base px-8 py-4 shadow-xl shadow-cyan-500/20"
              >
                Start Free — no credit card
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={onDemo}
                className="btn-secondary group w-full sm:w-auto text-base px-8 py-4"
              >
                <Play className="w-5 h-5" />
                See it live — no sign-up
              </button>
            </div>

            {/* Trust badges */}
            <div className="reveal reveal-delay-4 flex flex-wrap items-center justify-center gap-2 mb-0">
              {['SOC 2 in progress', 'DPDPA-ready', 'Data stored in India', 'Free tier always available'].map((badge) => (
                <span key={badge} className="flex items-center gap-1.5 text-xs text-slate-400 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.03]">
                  <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Platform marquee — connects to real-world ecosystem */}
        <div className="relative z-10 w-full mt-16 border-t border-b border-white/[0.05] bg-white/[0.01] py-1">
          <p className="text-center text-[10px] font-semibold tracking-[0.3em] uppercase text-slate-600 mb-1 mt-2">Works with every AI platform</p>
          <PlatformMarquee />
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce z-10">
          <ChevronDown className="w-6 h-6 text-cyan-400/60" />
        </div>
      </section>

      {/* Stats Section */}
      <section id="stats" className="py-24 px-6 relative">
        <div className="max-w-6xl mx-auto reveal">
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
          <div className="reveal mb-12 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end md:mb-16 lg:mb-20">
            <div>
              <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Live Preview</span>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">See what it looks like when nothing goes wrong</h2>
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
          <div className="reveal text-center mb-12 md:mb-16 lg:mb-20">
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
                title: 'Connect your AI',
                desc: 'Connect an app or point any AI assistant at Zapheit so traffic, actions, cost, and risk all come through one place.'
              },
              {
                step: 2,
                icon: BarChart3,
                title: 'See every decision in plain English',
                desc: 'Know what your assistants are doing, what they cost, and where behaviour is starting to drift — no technical jargon.'
              },
              {
                step: 3,
                icon: ZapOff,
                title: 'Stop problems automatically',
                desc: 'Catch risky output, require human approval where needed, and block bad behaviour before it reaches customers.'
              },
              {
                step: 4,
                icon: Shield,
                title: 'Prove compliance in one click',
                desc: 'Immutable audit logs, DPDPA-ready exports, and evidence packets ready whenever regulators or customers ask.'
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
          <div className="reveal text-center mb-12 md:mb-16 lg:mb-20">
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

          {/* Deep-dive link */}
          <div className="text-center mt-12">
            <button
              onClick={() => navigate('/features')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-all text-sm font-semibold"
            >
              See full feature breakdown
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-800/30 to-transparent" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-12 md:mb-16">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Common Operating Wins</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">Where teams start seeing value first</h2>
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
                <p className="text-slate-300">{testimonial.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Zapheit Section */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Built for India</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-4">Built with India-ready controls and workflows</h2>
            <p className="text-lg text-slate-400 mt-4 max-w-2xl mx-auto">INR pricing. DPDPA compliance. Aadhaar & PAN detection. India-specific integrations. No USD conversion surprises.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {[
              { icon: Lock, title: 'Works With Any AI', desc: 'Monitors any AI assistant — OpenAI, Anthropic, LangChain, Haptik, Yellow.ai, or custom-built. Zapheit doesn\'t replace your AI, it watches over it.' },
              { icon: Gauge, title: 'AI Message Hub', desc: 'One line of code to route any AI assistant through Zapheit. Safety alerts + usage tracking start immediately.' },
              { icon: Shield, title: 'India-Specific Privacy', desc: 'Detects Aadhaar numbers, PAN cards, UPI IDs, and Indian bank accounts in real-time — not just generic patterns.' },
              { icon: Target, title: 'Privacy Settings (DPDPA)', desc: 'Built for India\'s Digital Personal Data Protection Act 2023. Breach notifications, data rights management, and audit evidence — automated.' },
              { icon: TrendingUp, title: 'INR Pricing', desc: 'Plans in INR. No per-seat surprises and no USD conversion for Indian teams.' },
              { icon: Award, title: 'Runs In Your Network', desc: 'Run AI workers inside your own VPC. No inbound ports, no data leaving your network.' },
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
          {/* Header */}
          <div className="reveal text-center mb-12">
            <span className="text-cyan-400 font-semibold text-sm tracking-widest uppercase">Pricing</span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mt-4">Simple, honest pricing</h2>
            <p className="text-slate-400 mt-4 text-lg max-w-2xl mx-auto">
              Start free. Upgrade when you need more agents, requests, or compliance features. INR billing, no hidden fees.
            </p>

            {/* Billing toggle */}
            <div className="inline-flex items-center gap-1 mt-6 p-1 rounded-full border border-white/10 bg-white/[0.04]">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${billingCycle === 'monthly' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('annual')}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${billingCycle === 'annual' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                Annual
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">Save 17%</span>
              </button>
            </div>
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            {PLANS.map((plan) => {
              const isRecommended = plan.id === recommendedPlan.id;
              return (
                <div
                  key={plan.id}
                  className={[
                    'relative rounded-2xl border p-6 flex flex-col gap-5 transition-all',
                    plan.highlight
                      ? 'border-cyan-400/50 bg-[linear-gradient(160deg,rgba(34,211,238,0.10),rgba(8,47,73,0.25))] glow-pulse'
                      : 'border-white/10 bg-white/[0.03]',
                    isRecommended ? 'ring-2 ring-cyan-400/60 ring-offset-2 ring-offset-transparent' : '',
                  ].join(' ')}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 whitespace-nowrap">
                        Most Popular
                      </span>
                    </div>
                  )}
                  {isRecommended && !plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-700 text-slate-200 whitespace-nowrap border border-white/10">
                        Recommended for you
                      </span>
                    </div>
                  )}

                  <div>
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                    <p className="text-xs text-slate-500 mt-1">{plan.tagline}</p>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-white">{displayPrice(plan)}</span>
                      {plan.priceMonthly !== null && (
                        <span className="text-slate-500 text-sm">/mo</span>
                      )}
                    </div>
                    {billingCycle === 'annual' && plan.priceAnnual && plan.priceAnnual > 0 && (
                      <p className="text-xs text-emerald-400 mt-1">
                        ₹{plan.priceAnnual.toLocaleString('en-IN')}/yr · saves ₹{((plan.priceMonthly ?? 0) * 12 - plan.priceAnnual).toLocaleString('en-IN')}
                      </p>
                    )}
                    {plan.priceMonthly === null && (
                      <p className="text-xs text-slate-500 mt-1">Talk to us for pricing</p>
                    )}
                  </div>

                  <div className="border-t border-white/8" />

                  <ul className="space-y-2 flex-1 text-xs text-slate-400">
                    <li className="flex justify-between"><span>AI assistants</span><span className="text-white font-medium">{plan.agents}</span></li>
                    <li className="flex justify-between"><span>Requests/mo</span><span className="text-white font-medium">{plan.requests}</span></li>
                    <li className="flex justify-between"><span>Team members</span><span className="text-white font-medium">{plan.members}</span></li>
                    <li className="flex justify-between"><span>Audit log</span><span className="text-white font-medium">{plan.audit}</span></li>
                  </ul>

                  <button
                    onClick={() => {
                      if (plan.id === 'free' || plan.id === 'pro' || plan.id === 'business') {
                        onSignUp();
                      } else {
                        window.open(`https://wa.me/919433116259?text=${encodeURIComponent(`Hi, I'd like to discuss the Enterprise plan for Zapheit. Can we connect?`)}`, '_blank');
                      }
                    }}
                    className={[
                      'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
                      plan.highlight
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20'
                        : plan.id === 'enterprise'
                          ? 'border border-white/15 text-slate-300 hover:bg-white/[0.06]'
                          : 'bg-white/8 hover:bg-white/14 text-white border border-white/10',
                    ].join(' ')}
                  >
                    {plan.id === 'enterprise' ? 'Talk to Sales' : plan.id === 'free' ? 'Start Free' : 'Get Started'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Slider — updates recommendation */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm font-semibold text-white mb-1">Find your plan</p>
            <p className="text-xs text-slate-500 mb-5">Move the slider to see which plan fits your team. Recommended plan updates automatically.</p>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="flex items-center justify-between text-sm font-medium text-white mb-3">
                  <span>Active AI assistants</span>
                  <span className="text-cyan-300 font-bold">{activeAgents}</span>
                </div>
                <input type="range" min="1" max="150" step="1" value={activeAgents}
                  onChange={(e) => setActiveAgents(Number(e.target.value))}
                  className="w-full accent-cyan-400" />
                <div className="mt-2 flex justify-between text-xs text-slate-600"><span>1</span><span>75</span><span>150</span></div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm font-medium text-white mb-3">
                  <span>Monthly AI conversations</span>
                  <span className="text-emerald-300 font-bold">{monthlyConversations.toLocaleString()}</span>
                </div>
                <input type="range" min="500" max="50000" step="500" value={monthlyConversations}
                  onChange={(e) => setMonthlyConversations(Number(e.target.value))}
                  className="w-full accent-emerald-400" />
                <div className="mt-2 flex justify-between text-xs text-slate-600"><span>500</span><span>10k</span><span>50k</span></div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between pt-4 border-t border-white/8">
              <p className="text-sm text-slate-300">
                Recommended: <span className="font-bold text-white">{recommendedPlan.name}</span>
                {recommendedPlan.priceMonthly !== null && (
                  <span className="text-slate-500 ml-1">· {displayPrice(recommendedPlan)}/mo</span>
                )}
              </p>
              <button
                onClick={onSignUp}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold transition-all shadow-lg shadow-cyan-500/20"
              >
                Get started →
              </button>
            </div>
          </div>

          {/* Email capture */}
          <div className="mt-6">
            {calcEmailSent ? (
              <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-medium">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Got it — we'll reach out to {calcEmail} within one business day.
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
                <input
                  type="email"
                  value={calcEmail}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCalcEmail(e.target.value)}
                  placeholder="Not ready? Leave your email and we'll reach out"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-slate-500 outline-none focus:border-cyan-500/40 transition-colors"
                />
                <button
                  onClick={async () => {
                    if (!calcEmail.includes('@')) return;
                    await fetch('/public/contact', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        email: calcEmail,
                        agents: activeAgents,
                        conversations: monthlyConversations,
                        estimated_spend: recommendedPlan.name,
                      }),
                    });
                    setCalcEmailSent(true);
                  }}
                  disabled={!calcEmail.includes('@')}
                  className="px-5 py-2.5 rounded-xl bg-white/8 hover:bg-white/12 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-white text-sm font-semibold transition-all whitespace-nowrap"
                >
                  Send →
                </button>
              </div>
            )}
          </div>

          {/* Full pricing page link */}
          <div className="text-center mt-10">
            <button
              onClick={() => navigate('/pricing')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 text-slate-300 hover:bg-white/[0.06] hover:text-white transition-all text-sm font-semibold"
            >
              View full plan comparison
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="reveal text-center mb-12 md:mb-16">
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
                className="card-surface p-4 sm:p-6"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/15 to-blue-500/15 border border-cyan-500/20 flex items-center justify-center mb-4">
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

        <div className="reveal max-w-4xl mx-auto relative z-10 text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6">
            Start governing your AI in under 5 minutes.
          </h2>
          <p className="text-lg sm:text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
            Free tier, no credit card required. Works with any AI assistant — OpenAI, Anthropic, Gemini, or custom-built.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onSignUp}
              className="btn-primary group px-8 md:px-10 py-4 text-base"
            >
              Start Free — No Credit Card
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            {onDemo ? (
              <button
                onClick={onDemo}
                className="btn-secondary px-8 md:px-10 py-4 text-base"
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
              <div className="mb-4">
                <img src="/logo-dark.png" alt="Zapheit" className="h-12 w-auto object-contain rounded-lg" />
              </div>
              <p className="text-sm text-slate-400">The governance layer for your AI workforce.</p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="#how-it-works" className="hover:text-cyan-400 transition-colors">How it works</a></li>
                <li><a href="#stats" className="hover:text-cyan-400 transition-colors">Results</a></li>
                <li><a href="/features" className="hover:text-cyan-400 transition-colors">Features</a></li>
                <li><a href="/pricing" className="hover:text-cyan-400 transition-colors">Pricing</a></li>
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
                <li><a href="/pricing" className="hover:text-cyan-400 transition-colors">ROI Calculator</a></li>
                <li><a href="#security" className="hover:text-cyan-400 transition-colors">Deployment Notes</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-700 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">© {year} Zapheit. All rights reserved.</p>
            <div className="flex items-center gap-6 text-sm">
              <a href="#how-it-works" className="text-slate-400 hover:text-cyan-400 transition-colors">Overview</a>
              <a href="/features" className="text-slate-400 hover:text-cyan-400 transition-colors">Features</a>
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
