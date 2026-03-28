import { useNavigate } from 'react-router-dom';
import { Check, ArrowLeft, Zap, Shield, Building2, MessageCircle } from 'lucide-react';

// Replace with your WhatsApp number (country code + number, no + or spaces)
const CONTACT_WA = '919999999999';

function openWhatsApp(planName: string, note?: string) {
  const text = note ?? `Hi, I'm interested in ${planName} by Rasi. Can we connect?`;
  window.open(`https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(text)}`, '_blank');
}

const PLANS = [
  {
    name: 'The Audit',
    subtitle: 'One-time assessment',
    price: '₹25,000',
    cadence: 'one-time',
    bestFor: 'Teams validating a first AI rollout',
    icon: Zap,
    accent: 'border-slate-700/60 bg-slate-900/60',
    iconBg: 'from-violet-500 to-purple-600',
    features: [
      'AI Workforce Health Scan',
      'Risk score and leakage report',
      '1-hour strategic review session',
      'Governance action plan',
      'Up to 5 agents assessed',
    ],
    cta: 'Book an Audit',
    waText: "Hi, I'd like to book an AI Governance Audit with Rasi. Can we connect?",
    ctaStyle: 'bg-slate-700 hover:bg-slate-600 text-white',
  },
  {
    name: 'The Retainer',
    subtitle: 'Continuous governance',
    price: '₹40k–₹60k',
    cadence: '/month',
    bestFor: 'Operating teams with active agent fleets',
    icon: Shield,
    accent: 'border-cyan-500/40 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(8,47,73,0.28))]',
    iconBg: 'from-cyan-500 to-blue-600',
    badge: 'Most popular',
    features: [
      'Everything in The Audit',
      '200,000 gateway requests/month',
      'Real-time PII & hallucination detection',
      'Action policies & kill switch',
      'HITL approval workflows',
      'Weekly behavioral reviews',
      'Incident log & Black Box forensics',
      'Monthly performance report',
      'Slack alerts & webhook integrations',
    ],
    cta: 'Talk to us',
    waText: "Hi, I'm interested in The Retainer plan by Rasi for continuous AI governance. Can we connect?",
    ctaStyle: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20',
  },
  {
    name: 'Enterprise',
    subtitle: 'Governance partnership',
    price: 'Custom',
    cadence: 'engagement',
    bestFor: 'Regulated orgs running business-critical AI',
    icon: Building2,
    accent: 'border-emerald-500/30 bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(6,78,59,0.18))]',
    iconBg: 'from-emerald-500 to-teal-600',
    features: [
      'Everything in The Retainer',
      'Unlimited gateway requests',
      'VPC / on-prem runtime workers',
      'Policy enforcement planning',
      'DPDPA & NIST AI RMF mapping',
      'Custom compliance report generation',
      'Dedicated governance manager',
      'Executive-ready compliance layer',
      'SLA with response-time guarantees',
      'Priority support & onboarding',
    ],
    cta: 'Contact Sales',
    waText: "Hi, I'd like to discuss Enterprise pricing with Rasi. We're a regulated org and need a governance partnership.",
    ctaStyle: 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20',
  },
];

const COMPARISON = [
  { feature: 'Gateway requests/month', audit: '—', retainer: '200,000', enterprise: 'Unlimited' },
  { feature: 'Agents governed', audit: 'Up to 5', retainer: 'Up to 50', enterprise: 'Unlimited' },
  { feature: 'PII & hallucination detection', audit: 'Audit only', retainer: 'Real-time', enterprise: 'Real-time' },
  { feature: 'Action policies & kill switch', audit: false, retainer: true, enterprise: true },
  { feature: 'HITL approval workflows', audit: false, retainer: true, enterprise: true },
  { feature: 'Black Box forensics', audit: false, retainer: true, enterprise: true },
  { feature: 'Slack alerts & webhooks', audit: false, retainer: true, enterprise: true },
  { feature: 'Shadow Mode adversarial testing', audit: false, retainer: true, enterprise: true },
  { feature: 'Multi-provider cost tracking', audit: false, retainer: true, enterprise: true },
  { feature: 'VPC / on-prem runtime', audit: false, retainer: false, enterprise: true },
  { feature: 'DPDPA / NIST AI RMF mapping', audit: false, retainer: false, enterprise: true },
  { feature: 'Dedicated governance manager', audit: false, retainer: false, enterprise: true },
  { feature: 'SLA guarantees', audit: false, retainer: 'Standard', enterprise: 'Custom' },
];

function CellValue({ val }: { val: boolean | string }) {
  if (val === true) return <Check className="w-4 h-4 text-emerald-400 mx-auto" />;
  if (val === false) return <span className="text-slate-600 mx-auto block text-center">—</span>;
  return <span className="text-slate-300 text-sm text-center block">{val}</span>;
}

export default function PricingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#020617] text-white">
      {/* Nav */}
      <nav className="border-b border-white/8 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Rasi
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-slate-400 hover:text-white transition-colors px-4 py-2"
          >
            Log in
          </button>
          <button
            onClick={() => navigate('/signup')}
            className="text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:from-cyan-400 hover:to-blue-500 transition-all"
          >
            Get started free
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-16 space-y-20">
        {/* Header */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Pricing</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Govern your AI agents.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
              From day one.
            </span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Start with a health scan. Scale to continuous governance. Every plan includes India-native PII detection, INR billing, and no per-seat surprises.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.name}
                className={`relative rounded-3xl border p-8 flex flex-col gap-6 backdrop-blur-sm ${plan.accent}`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500 text-white shadow-lg shadow-cyan-500/30">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="space-y-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${plan.iconBg} flex items-center justify-center`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{plan.name}</h2>
                    <p className="text-sm text-slate-400">{plan.subtitle}</p>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold font-mono text-white">{plan.price}</span>
                    {plan.cadence !== 'engagement' && (
                      <span className="text-slate-500 text-sm">{plan.cadence}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">{plan.bestFor}</p>
                </div>

                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => openWhatsApp(plan.name, plan.waText)}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${plan.ctaStyle}`}
                >
                  <MessageCircle className="w-4 h-4" />
                  {plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        {/* Feature comparison table */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-center">Full feature comparison</h2>
          <div className="rounded-2xl border border-slate-800/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-900/60">
                  <th className="text-left px-6 py-4 text-slate-400 font-medium w-1/2">Feature</th>
                  <th className="px-4 py-4 text-center text-slate-300 font-semibold">The Audit</th>
                  <th className="px-4 py-4 text-center text-cyan-300 font-semibold">The Retainer</th>
                  <th className="px-4 py-4 text-center text-emerald-300 font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={`border-b border-slate-800/40 ${i % 2 === 0 ? 'bg-slate-950/20' : ''}`}
                  >
                    <td className="px-6 py-3.5 text-slate-300">{row.feature}</td>
                    <td className="px-4 py-3.5"><CellValue val={row.audit} /></td>
                    <td className="px-4 py-3.5"><CellValue val={row.retainer} /></td>
                    <td className="px-4 py-3.5"><CellValue val={row.enterprise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* India callout */}
        <div className="rounded-3xl border border-slate-700/50 bg-slate-900/50 p-10 text-center space-y-4 max-w-3xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Built for India</p>
          <h3 className="text-2xl font-bold">No USD conversion surprises.</h3>
          <p className="text-slate-400 leading-relaxed">
            All plans billed in INR. Aadhaar, PAN, and UPI ID detection built-in. DPDPA compliance mapping included in Enterprise. Servers can run in your VPC.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {['Aadhaar detection', 'PAN card protection', 'UPI ID masking', 'DPDPA compliance', 'INR billing'].map((tag) => (
              <span key={tag} className="px-3 py-1.5 rounded-full text-xs font-medium border border-slate-700/50 bg-slate-800/50 text-slate-300">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center">Common questions</h2>
          <div className="space-y-4">
            {[
              {
                q: 'What counts as a gateway request?',
                a: 'Each call to the Rasi LLM gateway counts as one request — regardless of model, token count, or provider. Streaming responses count as one request.',
              },
              {
                q: 'Can I use Rasi without routing traffic through the gateway?',
                a: 'Yes. The Audit plan and standalone governance features (fleet management, audit logs, policy editor) work without the gateway. The gateway is required for real-time incident detection and cost tracking.',
              },
              {
                q: 'Which LLM providers does Rasi support?',
                a: 'OpenAI (GPT-4o family), Anthropic (Claude 3.5/3 Haiku), and 300+ models via OpenRouter including Gemini, Llama, and Mistral.',
              },
              {
                q: 'Can I self-host or run Rasi in my VPC?',
                a: 'Yes — the Runtime Worker can be deployed inside your private network. The agent jobs are pulled from the queue securely without inbound firewall rules. Enterprise plan includes VPC deployment support.',
              },
              {
                q: 'How does the Audit-to-Retainer upgrade work?',
                a: 'After an Audit, your governance action plan maps directly to Retainer setup tasks. We can usually complete onboarding in under a week. Audit fee is credited toward the first Retainer month.',
              },
            ].map(({ q, a }) => (
              <div key={q} className="rounded-2xl border border-slate-800/50 bg-slate-900/40 p-6 space-y-2">
                <p className="font-semibold text-white">{q}</p>
                <p className="text-sm text-slate-400 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA footer */}
        <div className="text-center space-y-4 pb-8">
          <h2 className="text-2xl font-bold">Not sure where to start?</h2>
          <p className="text-slate-400">Book a 30-minute governance review. We'll map your current AI footprint and recommend the right plan.</p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => openWhatsApp('Rasi', "Hi, I'd like to book a 30-minute AI governance review with Rasi. Can we find a time?")}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Talk to us on WhatsApp
            </button>
            <button
              onClick={() => navigate('/login')}
              className="px-8 py-3 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:border-slate-600 hover:text-white transition-all"
            >
              Log in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
