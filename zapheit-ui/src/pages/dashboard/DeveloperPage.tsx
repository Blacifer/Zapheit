import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Key,
  Plug,
  Radio,
  Webhook,
  Zap,
} from 'lucide-react';
import { getFrontendConfig } from '../../lib/config';
import { cn } from '../../lib/utils';

interface DeveloperPageProps {
  onNavigate?: (page: string) => void;
}

const SNIPPET_CURL = (baseUrl: string, apiKey: string) =>
  `curl -X POST ${baseUrl}/events/inbound \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event_type": "refund.requested",
    "source": "stripe",
    "idempotency_key": "ref_abc123",
    "payload": {
      "amount": 4999,
      "currency": "inr",
      "reason": "duplicate_charge",
      "customer_email": "user@example.com"
    }
  }'`;

const SNIPPET_NODE = (baseUrl: string, apiKey: string) =>
  `const res = await fetch('${baseUrl}/events/inbound', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${apiKey}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    event_type: 'refund.requested',
    source: 'stripe',
    idempotency_key: 'ref_abc123',
    payload: { amount: 4999, currency: 'inr' },
  }),
});
const data = await res.json();
// { success: true, event_id: "evt_...", work_item_id: "..." }`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
        <span className="text-xs font-mono text-slate-400">{label}</span>
        <div className="flex items-center gap-1">
          <CopyButton text={code} />
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <pre
        className={cn(
          'text-xs text-slate-300 font-mono px-4 py-3 overflow-x-auto transition-all',
          expanded ? '' : 'max-h-28 overflow-hidden',
        )}
      >
        {code}
      </pre>
    </div>
  );
}

function QuickLinkCard({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] p-5 flex items-start gap-4 transition-colors"
    >
      <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-blue-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
      <span className="text-xs text-blue-400 group-hover:text-blue-300 flex items-center gap-1 shrink-0 mt-0.5">
        {action}
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

export default function DeveloperPage({ onNavigate }: DeveloperPageProps) {
  const rawApiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
  // The events endpoint is mounted at /events (not under /api), so strip the /api suffix.
  const eventsBaseUrl = rawApiUrl.replace(/\/api$/, '');
  const inboundEndpoint = `${eventsBaseUrl}/events/inbound`;
  const apiDocsUrl = `${eventsBaseUrl}/api/docs`;

  const [placeholderKey] = useState('sk_your_api_key');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Plug className="w-6 h-6 text-blue-300" />
          <h1 className="text-2xl font-bold text-white">Developer Portal</h1>
        </div>
        <p className="text-slate-400 text-sm">
          Connect your systems to Zapheit — push agent events in, receive governance notifications out.
        </p>
      </div>

      {/* Inbound Events Section */}
      <section className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.04] p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-blue-300" />
          <div>
            <h2 className="text-base font-semibold text-white">Inbound Event Endpoint</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              POST agent events from your external systems here. Zapheit classifies them and surfaces work items in the dashboard.
            </p>
          </div>
        </div>

        {/* Endpoint URL */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Endpoint</p>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-mono font-semibold border border-emerald-500/20">
              POST
            </span>
            <code className="flex-1 text-sm font-mono text-slate-200 truncate">{inboundEndpoint}</code>
            <CopyButton text={inboundEndpoint} />
          </div>
        </div>

        {/* Auth note */}
        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] px-4 py-3 flex items-start gap-3">
          <Key className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-300">
            Authenticate using{' '}
            <code className="text-amber-300 font-mono">Authorization: Bearer sk_…</code> with any active API key
            from your organisation.{' '}
            <button
              className="text-blue-400 hover:text-blue-300 underline"
              onClick={() => onNavigate?.('api-access')}
            >
              Manage API keys →
            </button>
          </p>
        </div>

        {/* Request schema */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Request Body</p>
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-xs font-mono text-slate-300 space-y-1">
            <p><span className="text-blue-300">event_type</span>  <span className="text-slate-500">string — required</span>  <span className="text-slate-400 ml-2">e.g. "refund.requested", "lead.created"</span></p>
            <p><span className="text-blue-300">source</span>      <span className="text-slate-500">string — required</span>  <span className="text-slate-400 ml-2">e.g. "stripe", "hubspot", "custom"</span></p>
            <p><span className="text-blue-300">payload</span>     <span className="text-slate-500">object — optional</span>  <span className="text-slate-400 ml-2">arbitrary event data</span></p>
            <p><span className="text-blue-300">agent_id</span>    <span className="text-slate-500">string — optional</span>  <span className="text-slate-400 ml-2">link to a Zapheit agent</span></p>
            <p><span className="text-blue-300">idempotency_key</span> <span className="text-slate-500">string — optional</span> <span className="text-slate-400 ml-2">deduplicate retries</span></p>
          </div>
        </div>

        {/* Code snippets */}
        <div className="space-y-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Code Samples</p>
          <CodeBlock code={SNIPPET_CURL(eventsBaseUrl, placeholderKey)} label="cURL" />
          <CodeBlock code={SNIPPET_NODE(eventsBaseUrl, placeholderKey)} label="Node.js" />
        </div>
      </section>

      {/* Quick Links */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-white">Quick Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickLinkCard
            icon={Key}
            title="API Keys"
            description="Create and manage keys used to authenticate your integrations."
            action="Manage"
            onClick={() => onNavigate?.('api-access')}
          />
          <QuickLinkCard
            icon={Webhook}
            title="Outbound Webhooks"
            description="Subscribe to Zapheit events like cost alerts and incidents delivered to your URL."
            action="Configure"
            onClick={() => onNavigate?.('webhooks')}
          />
          <QuickLinkCard
            icon={BookOpen}
            title="API Reference"
            description="Full OpenAPI documentation for every Zapheit endpoint."
            action="Open docs"
            onClick={() => window.open(apiDocsUrl, '_blank', 'noopener')}
          />
        </div>
      </section>

      {/* Event Types Cheat-sheet */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-blue-300" />
          <h2 className="text-base font-semibold text-white">Supported Event Types</h2>
        </div>
        <p className="text-xs text-slate-400">
          Zapheit automatically classifies events into work items based on the <code className="text-slate-200">event_type</code> prefix.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {[
            { prefix: 'refund.* / payment.* / payout.*', result: 'Support Ticket', color: 'text-rose-300' },
            { prefix: 'lead.* / deal.* / crm.*', result: 'Sales Lead', color: 'text-emerald-300' },
            { prefix: 'access.* / provision.* / identity.*', result: 'Access Request', color: 'text-amber-300' },
            { prefix: 'Everything else', result: 'Support Ticket (default)', color: 'text-slate-400' },
          ].map(({ prefix, result, color }) => (
            <div key={prefix} className="flex items-center gap-3 py-1.5 border-b border-white/5">
              <code className="text-xs font-mono text-blue-200 flex-1">{prefix}</code>
              <span className={cn('text-xs font-medium', color)}>{result}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Inbound events are surfaced as Work Items */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 flex items-center gap-5">
        <Radio className="w-8 h-8 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Inbound events appear in Work Items</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Each POST to <code className="text-slate-200 font-mono">/events/inbound</code> creates a classified work item (support ticket, lead, or access request) visible to your team.
          </p>
        </div>
        <button
          onClick={() => onNavigate?.('work-items')}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold transition-colors"
        >
          Open Work Items <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </section>
    </div>
  );
}
