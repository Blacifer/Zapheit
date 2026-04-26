import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, MessageCircle, BarChart3, Shield,
  ZapOff, FileText, Target, DollarSign, CheckCircle, XCircle,
  Sparkles, Play, Lock, Globe, Zap,
} from 'lucide-react';

const CONTACT_WA = '919433116259';
function openWhatsApp(msg: string) {
  window.open(`https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(msg)}`, '_blank');
}

const FEATURES = [
  {
    id: 'visibility',
    badge: 'AI Message Hub',
    icon: BarChart3,
    gradient: 'from-cyan-500 to-blue-600',
    accent: 'cyan',
    title: 'Complete visibility into every AI decision',
    tagline: 'Your agents are making thousands of decisions a day. Do you know what any of them are?',
    bullets: [
      { icon: CheckCircle, text: 'OpenAI-compatible proxy — point any agent at Zapheit with one line change' },
      { icon: CheckCircle, text: 'Every request, response, and reasoning trace logged in plain English' },
      { icon: CheckCircle, text: 'Multi-provider routing — OpenAI, Anthropic, Gemini, Llama, custom models' },
      { icon: CheckCircle, text: 'Per-agent dashboards: conversations, latency, cost, risk score' },
      { icon: CheckCircle, text: 'Real-time activity feed — see what every agent is doing right now' },
      { icon: CheckCircle, text: 'Semantic search across all historical conversations' },
    ],
    without: 'Blind to what your agents are doing. Something breaks → you find out from a customer.',
    with: 'One dashboard. Every agent. Every decision. Nothing hidden.',
    stat: { value: '100%', label: 'of AI decisions logged and searchable' },
  },
  {
    id: 'safety',
    badge: 'Incident Detection',
    icon: Shield,
    gradient: 'from-red-500 to-rose-600',
    accent: 'red',
    title: 'Catch every safety risk before your customers do',
    tagline: 'PII leaks, hallucinations, and policy violations that reach users destroy trust in seconds.',
    bullets: [
      { icon: CheckCircle, text: 'Aadhaar, PAN, UPI ID, mobile number — India-specific PII detection' },
      { icon: CheckCircle, text: 'Hallucination detection: flags factually inconsistent or overconfident responses' },
      { icon: CheckCircle, text: 'Prompt injection & jailbreak attempt detection in real time' },
      { icon: CheckCircle, text: 'Toxic output, refund abuse, and policy violation classification' },
      { icon: CheckCircle, text: 'Severity scoring from low → critical with escalation rules' },
      { icon: CheckCircle, text: 'Instant alerts via Slack, WhatsApp, or email when something goes wrong' },
    ],
    without: 'Incidents reach customers. You hear about it on Twitter or from an angry support ticket.',
    with: 'Problems flagged and blocked before they leave the system. You fix it before anyone knows.',
    stat: { value: '< 1 sec', label: 'average detection time per message' },
  },
  {
    id: 'control',
    badge: 'Action Policies & Kill Switch',
    icon: ZapOff,
    gradient: 'from-amber-500 to-orange-600',
    accent: 'amber',
    title: 'Keep humans in control of every high-stakes action',
    tagline: 'AI agents that can send emails, issue refunds, or modify records need approval gates — not just hope.',
    bullets: [
      { icon: CheckCircle, text: 'Action policies — define exactly which actions auto-approve vs require review' },
      { icon: CheckCircle, text: 'Human-in-the-loop approval workflows with 24hr auto-block fallback' },
      { icon: CheckCircle, text: 'Instant kill switch — pause one agent, all agents in a category, or your entire fleet' },
      { icon: CheckCircle, text: 'Budget caps & rate limiting per agent — no runaway spend' },
      { icon: CheckCircle, text: 'Risk score auto-routing: <30 auto-approve, >70 auto-escalate, middle requires review' },
      { icon: CheckCircle, text: 'Bulk approval for similar low-risk actions — approve 12 at once' },
    ],
    without: "Agents act autonomously. One bad policy decision or misconfiguration and there's no circuit breaker.",
    with: 'Every risky action gated. One button to pause everything. You stay in control.',
    stat: { value: '22 sec', label: 'average time to approve or block an action' },
  },
  {
    id: 'compliance',
    badge: 'Audit & Compliance',
    icon: FileText,
    gradient: 'from-purple-500 to-violet-600',
    accent: 'purple',
    title: 'Compliance evidence that\'s ready before anyone asks',
    tagline: 'Regulators don\'t give you time to assemble evidence after an incident. It has to already exist.',
    bullets: [
      { icon: CheckCircle, text: 'Immutable, append-only audit log — no edits, no deletes, court-admissible' },
      { icon: CheckCircle, text: 'One-click DPDPA compliance export — PDF with incident timeline' },
      { icon: CheckCircle, text: 'Black box evidence packets — downloadable proof for any decision' },
      { icon: CheckCircle, text: 'Session recording with configurable retention: 30d / 90d / 1yr / unlimited' },
      { icon: CheckCircle, text: 'NIST AI RMF and DPDPA compliance mapping built in' },
      { icon: CheckCircle, text: 'Chain-of-custody documentation for AI-assisted HR, finance, and legal decisions' },
    ],
    without: 'Manual screenshot collection. Spreadsheets. Weeks to respond to a regulator request.',
    with: 'One click. PDF ready. Every incident, approval, and cost event timestamped and signed.',
    stat: { value: '1 click', label: 'to generate a DPDPA compliance report' },
  },
  {
    id: 'testing',
    badge: 'Shadow Mode Testing',
    icon: Target,
    gradient: 'from-violet-500 to-purple-700',
    accent: 'violet',
    title: 'Test your agents in the wild before you trust them',
    tagline: 'Agents that look safe in development fail in production in ways you didn\'t anticipate.',
    bullets: [
      { icon: CheckCircle, text: 'Run agents in shadow mode — real traffic, no live consequences' },
      { icon: CheckCircle, text: 'Prompt injection attack simulations across 40+ adversarial patterns' },
      { icon: CheckCircle, text: 'PII exfiltration resistance tests — does the agent leak data it shouldn\'t?' },
      { icon: CheckCircle, text: 'Policy override and jailbreak probes — does it stay in role under pressure?' },
      { icon: CheckCircle, text: 'Pre-production behavioral scoring — pass threshold → promote to live' },
      { icon: CheckCircle, text: 'Regression tests on every agent update before it goes live' },
    ],
    without: 'Deploy to production and hope for the best. Find out the agent misbehaves from a real customer.',
    with: 'Shadow test on real traffic. Fix problems before promotion. Ship with confidence.',
    stat: { value: '40+', label: 'adversarial attack patterns tested per agent' },
  },
  {
    id: 'costs',
    badge: 'Cost Optimization',
    icon: DollarSign,
    gradient: 'from-emerald-500 to-green-600',
    accent: 'emerald',
    title: 'See exactly what your AI costs and cut waste immediately',
    tagline: 'Unmonitored AI spend compounds silently. One runaway agent can blow a monthly budget in hours.',
    bullets: [
      { icon: CheckCircle, text: 'Cost tracking per agent across OpenAI, Anthropic, Gemini, OpenRouter' },
      { icon: CheckCircle, text: 'Prompt caching for repeat queries — reduces API spend 30–60%' },
      { icon: CheckCircle, text: 'Budget alerts at 50%, 80%, and 100% of monthly limits' },
      { icon: CheckCircle, text: 'Auto-throttling when an agent approaches its budget cap' },
      { icon: CheckCircle, text: 'Model comparison: cost vs. performance across all providers' },
      { icon: CheckCircle, text: 'Token-to-rupee conversion — no more guessing what usage costs' },
    ],
    without: 'Monthly invoice surprise. No visibility into which agent or workflow is burning money.',
    with: '₹4.2L+ average monthly savings per team. Every rupee tracked, every spike caught early.',
    stat: { value: '₹4.2L+', label: 'average monthly savings identified per team' },
  },
];

const BEFORE_AFTER = [
  { area: 'Incident discovery', before: 'Customer complaint or Twitter mention', after: 'Caught in < 1 second, before it reaches the user' },
  { area: 'Compliance report', before: '2–4 weeks of manual work', after: '1 click — PDF generated from audit log' },
  { area: 'Rogue agent', before: 'No kill switch — have to redeploy to stop', after: 'Pause one agent or the entire fleet instantly' },
  { area: 'Cost overrun', before: 'Discovered at month-end invoice', after: 'Alerted at 50%, 80%, 100% spend thresholds' },
  { area: 'Agent approval', before: 'No approval gates — everything auto-executes', after: 'Configurable rules: auto-approve low-risk, escalate high-risk' },
  { area: 'Audit evidence', before: 'Screenshots, Slack exports, spreadsheets', after: 'Immutable log with timestamps, chain-of-custody, export ready' },
];

const INTEGRATIONS = [
  'OpenAI', 'Anthropic', 'Google Gemini', 'LangChain', 'CrewAI',
  'Azure OpenAI', 'Llama 3', 'Mistral', 'OpenRouter',
  'Slack', 'WhatsApp', 'GitHub', 'Jira', 'HubSpot', 'Notion',
];

export default function FeaturesPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#020617] text-white">

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] px-6 py-4 bg-[#020617]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Zapheit
          </button>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <button onClick={() => navigate('/features')} className="text-white font-medium">Features</button>
            <button onClick={() => navigate('/pricing')} className="text-slate-400 hover:text-white transition-colors">Pricing</button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-slate-400 hover:text-white transition-colors px-4 py-2"
            >
              Log in
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Start Free
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 space-y-32 pb-32">

        {/* Hero */}
        <div className="pt-20 text-center space-y-6 max-w-4xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Features</p>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black leading-[0.95] tracking-tight">
            Everything Zapheit<br />
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">
              gives your team.
            </span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Six capabilities that give you full visibility, real-time protection, and compliance proof for every AI agent in your organisation.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => navigate('/signup')}
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20"
            >
              Start Free — no credit card
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => openWhatsApp("Hi, I'd like a live demo of Zapheit's features. Can we connect?")}
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl border border-white/15 text-slate-300 hover:bg-white/[0.06] transition-all font-semibold"
            >
              <Play className="w-4 h-4" />
              See a live demo
            </button>
          </div>
        </div>

        {/* Feature sections */}
        {FEATURES.map((feature, idx) => {
          const isReversed = idx % 2 === 1;
          return (
            <section key={feature.id} className="scroll-mt-24">
              <div className={`grid lg:grid-cols-2 gap-12 lg:gap-20 items-center ${isReversed ? 'lg:[direction:rtl]' : ''}`}>

                {/* Content */}
                <div className={isReversed ? '[direction:ltr]' : ''}>
                  <div className="flex items-center gap-3 mb-5">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center flex-shrink-0`}>
                      <feature.icon className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{feature.badge}</span>
                  </div>

                  <h2 className="text-3xl sm:text-4xl font-black leading-tight mb-4 text-white">
                    {feature.title}
                  </h2>
                  <p className="text-slate-400 text-lg leading-relaxed mb-8">{feature.tagline}</p>

                  <ul className="space-y-3 mb-8">
                    {feature.bullets.map((bullet, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <bullet.icon className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <span className="text-slate-300 text-sm leading-relaxed">{bullet.text}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Stat highlight */}
                  <div className={`inline-flex items-center gap-3 px-5 py-3 rounded-2xl border bg-gradient-to-r ${feature.gradient} bg-opacity-10 border-white/10`}>
                    <span className="text-2xl font-black text-white">{feature.stat.value}</span>
                    <span className="text-sm text-slate-300">{feature.stat.label}</span>
                  </div>
                </div>

                {/* Visual card */}
                <div className={isReversed ? '[direction:ltr]' : ''}>
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    {/* Card header bar */}
                    <div className={`px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r ${feature.gradient} bg-opacity-5 flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${feature.gradient} flex items-center justify-center`}>
                          <feature.icon className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-sm font-semibold text-white">{feature.badge}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs text-emerald-400 font-medium">Active</span>
                      </div>
                    </div>

                    {/* Before/after comparison */}
                    <div className="p-6 space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-5">Without vs. with Zapheit</p>

                      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-4">
                        <div className="flex items-start gap-3">
                          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-red-300 mb-1">Without Zapheit</p>
                            <p className="text-sm text-slate-400 leading-relaxed">{feature.without}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                        <div className="flex items-start gap-3">
                          <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-emerald-300 mb-1">With Zapheit</p>
                            <p className="text-sm text-slate-300 leading-relaxed font-medium">{feature.with}</p>
                          </div>
                        </div>
                      </div>

                      {/* Mini feature list */}
                      <div className="pt-2 space-y-2">
                        {feature.bullets.slice(0, 3).map((b, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="w-1 h-1 rounded-full bg-slate-500 flex-shrink-0" />
                            {b.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        {/* Before/After master comparison table */}
        <section>
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400 mb-3">The difference</p>
            <h2 className="text-4xl sm:text-5xl font-black text-white">What changes when you add Zapheit</h2>
            <p className="text-slate-400 mt-4 max-w-xl mx-auto">Six situations. What you deal with today vs. what happens with Zapheit in place.</p>
          </div>

          <div className="rounded-3xl border border-white/10 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-3 bg-white/[0.03] border-b border-white/10 text-xs font-bold uppercase tracking-[0.15em]">
              <div className="px-6 py-4 text-slate-400">Situation</div>
              <div className="px-6 py-4 text-red-400 border-l border-white/[0.06] flex items-center gap-2">
                <XCircle className="w-3.5 h-3.5" /> Without Zapheit
              </div>
              <div className="px-6 py-4 text-emerald-400 border-l border-white/[0.06] flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5" /> With Zapheit
              </div>
            </div>
            {BEFORE_AFTER.map((row, i) => (
              <div
                key={row.area}
                className={`grid grid-cols-3 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors ${i === BEFORE_AFTER.length - 1 ? 'border-b-0' : ''}`}
              >
                <div className="px-6 py-5 text-sm font-semibold text-white">{row.area}</div>
                <div className="px-6 py-5 text-sm text-slate-400 border-l border-white/[0.06] leading-relaxed">{row.before}</div>
                <div className="px-6 py-5 text-sm text-emerald-300 border-l border-white/[0.06] font-medium leading-relaxed">{row.after}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Integrations */}
        <section className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-3">Works with every platform</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-10">
            Connect any AI. <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">One integration.</span>
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            {INTEGRATIONS.map((name) => (
              <span
                key={name}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/[0.03] text-sm text-slate-300 hover:border-cyan-500/30 hover:text-white transition-all"
              >
                <Zap className="w-3 h-3 text-cyan-400" />
                {name}
              </span>
            ))}
          </div>
          <p className="text-slate-500 text-sm mt-6">
            OpenAI-compatible — if your agent calls an LLM, Zapheit intercepts it with one URL change.
          </p>
        </section>

        {/* Security callout */}
        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-10 sm:p-14">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            {[
              { icon: Lock, title: 'Data stored in India', body: 'All data stays in Indian data centres by default. No cross-border transfers without your consent.' },
              { icon: Shield, title: 'DPDPA-ready out of the box', body: 'Consent lifecycle, data minimisation, and breach notification workflows — pre-built, not bolted on.' },
              { icon: Globe, title: 'SOC 2 in progress', body: 'Security controls documented and audited. SOC 2 Type II certification underway — on track for Q4.' },
            ].map((item) => (
              <div key={item.title} className="space-y-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 flex items-center justify-center mx-auto">
                  <item.icon className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="font-bold text-white">{item.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="text-center space-y-6">
          <h2 className="text-4xl sm:text-5xl font-black text-white leading-tight">
            Ready to see it<br />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">working for your team?</span>
          </h2>
          <p className="text-xl text-slate-400 max-w-xl mx-auto">
            Free tier. No credit card. Your first governed agent live in under 5 minutes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate('/signup')}
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:from-cyan-400 hover:to-blue-500 transition-all shadow-xl shadow-cyan-500/20 text-base"
            >
              Start Free
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => openWhatsApp("Hi, I'd like to learn more about Zapheit's features for my team.")}
              className="flex items-center gap-2 px-8 py-4 rounded-xl border border-white/15 text-slate-300 hover:bg-white/[0.06] transition-all font-semibold text-base"
            >
              <MessageCircle className="w-5 h-5" />
              Talk to us on WhatsApp
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            {['Free tier, no credit card', 'INR billing', 'DPDPA-ready', 'Data stored in India'].map((badge) => (
              <span key={badge} className="flex items-center gap-1.5 text-xs text-slate-500">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                {badge}
              </span>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
