import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  FileJson,
  Plus,
  RotateCw,
  Send,
  Shield,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';

type EventId =
  | 'usage.updated'
  | 'cost.alert'
  | 'reconciliation.alert'
  | 'error.occurred'
  | 'rate_limit.exceeded'
  | 'model.deprecated'
  | 'approval.requested'
  | 'approval.resolved';

type WebhookStatus = 'not_tested' | 'healthy' | 'failing' | 'disabled';
type DeliveryStatus = 'delivered' | 'failed';

type WebhookConfig = {
  id: string;
  url: string;
  events: EventId[];
  secret: string;
  status: WebhookStatus;
  createdAt: string;
  updatedAt: string;
  lastTestedAt?: string;
  lastDeliveryAt?: string;
  successCount: number;
  failureCount: number;
};

type DeliveryLog = {
  id: string;
  webhookId: string;
  event: EventId;
  endpoint: string;
  attemptedAt: string;
  status: DeliveryStatus;
  responseCode?: number;
  latencyMs?: number;
  note: string;
};

const EVENT_OPTIONS: Array<{ id: EventId; label: string; description: string }> = [
  { id: 'usage.updated', label: 'Usage Updated', description: 'Triggered when billable runtime usage changes.' },
  { id: 'cost.alert', label: 'Cost Alert', description: 'Triggered when spend crosses configured thresholds.' },
  { id: 'reconciliation.alert', label: 'Reconciliation Alert', description: 'Triggered when provider-reported spend drifts from observed spend.' },
  { id: 'error.occurred', label: 'Error Occurred', description: 'Triggered when platform or delivery errors happen.' },
  { id: 'rate_limit.exceeded', label: 'Rate Limit Exceeded', description: 'Triggered when a tenant or agent is rate limited.' },
  { id: 'model.deprecated', label: 'Model Deprecated', description: 'Triggered when an active model reaches deprecation or EOL.' },
  { id: 'approval.requested', label: 'Approval Requested', description: 'Triggered when an agent raises a new human-in-the-loop approval request.' },
  { id: 'approval.resolved', label: 'Approval Resolved', description: 'Triggered when an approval request is approved, denied, expired, or cancelled.' },
];

const SAMPLE_EVENT: Record<EventId, Record<string, unknown>> = {
  'usage.updated': {
    id: 'evt_usage_001',
    type: 'usage.updated',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      agent_id: 'agent_sales_support',
      requests: 124,
      spend_inr: 1820,
      model: 'gpt-4o-mini',
    },
  },
  'cost.alert': {
    id: 'evt_cost_001',
    type: 'cost.alert',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      threshold_percent: 85,
      projected_monthly_spend_inr: 248000,
      configured_limit_inr: 250000,
    },
  },
  'reconciliation.alert': {
    id: 'evt_reconciliation_001',
    type: 'reconciliation.alert',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      provider: 'openrouter',
      severity: 'warning',
      title: 'Provider-reported spend drift detected',
      message: 'The current provider-reported total differs from RASI-observed spend by 14.20 USD across the last 30-day window.',
    },
  },
  'error.occurred': {
    id: 'evt_error_001',
    type: 'error.occurred',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      agent_id: 'agent_sales_support',
      severity: 'high',
      message: 'Provider timeout while routing request',
    },
  },
  'rate_limit.exceeded': {
    id: 'evt_rate_001',
    type: 'rate_limit.exceeded',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      scope: 'organization',
      window: '1m',
      allowed: 1000,
      observed: 1174,
    },
  },
  'model.deprecated': {
    id: 'evt_model_001',
    type: 'model.deprecated',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      model: 'gpt-4',
      replacement: 'gpt-4.1',
      effective_date: '2026-05-31',
    },
  },
  'approval.requested': {
    id: 'evt_approval_001',
    type: 'approval.requested',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      approval_id: 'apr_abc123',
      agent_id: 'agent_sales_support',
      service: 'internal',
      action: 'sales.lead.create',
      requested_by: 'Sales Assistant',
      required_role: 'manager',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
  },
  'approval.resolved': {
    id: 'evt_approval_resolve_001',
    type: 'approval.resolved',
    created_at: new Date().toISOString(),
    organization_id: 'org_demo',
    data: {
      approval_id: 'apr_abc123',
      decision: 'approved',
      reviewer_id: 'usr_manager_001',
      service: 'internal',
      action: 'sales.lead.create',
    },
  },
};

const validateWebhook = (url: string, events: EventId[], existing: WebhookConfig[], editingId?: string) => {
  const errors: { url?: string; events?: string } = {};
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    errors.url = 'Webhook URL is required.';
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(trimmedUrl);
    } catch {
      errors.url = 'Enter a valid webhook URL.';
    }

    if (parsed) {
      if (parsed.protocol !== 'https:') {
        errors.url = 'Webhook URL must use HTTPS.';
      } else if (['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        errors.url = 'Webhook URL must be publicly reachable, not localhost.';
      }
    }

    const duplicate = existing.find((item) => item.url === trimmedUrl && item.id !== editingId);
    if (!errors.url && duplicate) {
      errors.url = 'This webhook URL is already configured.';
    }
  }

  if (events.length === 0) {
    errors.events = 'Select at least one event.';
  }

  return errors;
};

const formatDateTime = (value?: string) => {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const getStatusBadge = (status: WebhookStatus) => {
  switch (status) {
    case 'healthy':
      return 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'failing':
      return 'border border-rose-500/30 bg-rose-500/10 text-rose-300';
    case 'disabled':
      return 'border border-slate-600 bg-slate-800/70 text-slate-300';
    default:
      return 'border border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
};

export default function WebhooksPage() {
  const [newWebhook, setNewWebhook] = useState<{ url: string; events: EventId[] }>({ url: '', events: [] });
  const [errors, setErrors] = useState<{ url?: string; events?: string }>({});
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLog[]>([]);
  const [highlightedLogId, setHighlightedLogId] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [selectedTestEvent, setSelectedTestEvent] = useState<EventId>('usage.updated');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const response = await api.webhooks.list();
      if (cancelled) return;

      if (!response.success || !response.data) {
        toast.error(response.error || 'Failed to load webhooks.');
        setLoading(false);
        return;
      }

      setWebhooks((response.data.webhooks || []) as WebhookConfig[]);
      setDeliveryLogs(((response.data.logs || []) as DeliveryLog[]).map((log) => ({
        ...log,
        event: log.event as EventId,
        status: log.status as DeliveryStatus,
      })));
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rasi_safe_harbor_focus');
      if (!raw) return;

      const parsed = JSON.parse(raw) as { page?: string; id?: string };
      if (parsed.page !== 'webhooks' || !parsed.id) return;

      setHighlightedLogId(parsed.id);
      localStorage.removeItem('rasi_safe_harbor_focus');

      const timer = window.setTimeout(() => setHighlightedLogId(null), 5000);
      return () => window.clearTimeout(timer);
    } catch {
      localStorage.removeItem('rasi_safe_harbor_focus');
      return;
    }
  }, []);

  const summary = useMemo(() => {
    const active = webhooks.filter((webhook) => webhook.status !== 'disabled').length;
    const failing = webhooks.filter((webhook) => webhook.status === 'failing').length;
    const subscribedEvents = new Set(webhooks.flatMap((webhook) => webhook.events)).size;
    const last24h = deliveryLogs.filter((log) => Date.now() - new Date(log.attemptedAt).getTime() <= 24 * 60 * 60 * 1000).length;
    return { active, failing, subscribedEvents, last24h };
  }, [deliveryLogs, webhooks]);

  const createWebhook = async () => {
    const nextErrors = validateWebhook(newWebhook.url, newWebhook.events, webhooks);
    setErrors(nextErrors);
    if (nextErrors.url || nextErrors.events) {
      toast.error('Fix the validation errors before creating the webhook.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.webhooks.create({
        url: newWebhook.url.trim(),
        events: newWebhook.events,
      });

      if (!response.success || !response.data) {
        toast.error(response.error || 'Failed to create webhook.');
        return;
      }

      const webhook = response.data as WebhookConfig;
      setWebhooks((prev) => [webhook, ...prev]);
      setNewWebhook({ url: '', events: [] });
      setErrors({});
      setTestingWebhookId(webhook.id);
      setSelectedTestEvent(webhook.events[0] || 'usage.updated');
      toast.success('Webhook created. Run a server-side test next.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteWebhook = async (id: string) => {
    const response = await api.webhooks.delete(id);
    if (!response.success) {
      toast.error(response.error || 'Failed to delete webhook.');
      return;
    }

    setWebhooks((prev) => prev.filter((webhook) => webhook.id !== id));
    setDeliveryLogs((prev) => prev.filter((log) => log.webhookId !== id));
    if (testingWebhookId === id) setTestingWebhookId(null);
    toast.success('Webhook removed.');
  };

  const rotateSecret = async (id: string) => {
    const response = await api.webhooks.rotateSecret(id);
    if (!response.success || !response.data) {
      toast.error(response.error || 'Failed to rotate secret.');
      return;
    }

    const updatedWebhook = response.data as WebhookConfig;
    setWebhooks((prev) => prev.map((webhook) => (webhook.id === id ? updatedWebhook : webhook)));
    toast.success('Signing secret rotated. Re-run your receiver verification flow.');
  };

  const toggleWebhookStatus = async (id: string) => {
    const current = webhooks.find((webhook) => webhook.id === id);
    if (!current) return;

    const response = await api.webhooks.update(id, {
      status: current.status === 'disabled' ? 'not_tested' : 'disabled',
    });

    if (!response.success || !response.data) {
      toast.error(response.error || 'Failed to update webhook.');
      return;
    }

    const updatedWebhook = response.data as WebhookConfig;
    setWebhooks((prev) => prev.map((webhook) => (webhook.id === id ? updatedWebhook : webhook)));
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  const openTestStudio = (webhookId: string) => {
    const webhook = webhooks.find((item) => item.id === webhookId);
    setTestingWebhookId(webhookId);
    if (webhook?.events?.length) {
      setSelectedTestEvent(webhook.events[0]);
    }
  };

  const selectedWebhook = webhooks.find((webhook) => webhook.id === testingWebhookId) || null;
  const selectedPayload = selectedWebhook ? SAMPLE_EVENT[selectedTestEvent] : null;
  const curlCommand = selectedWebhook
    ? [
        `curl -X POST '${selectedWebhook.url}'`,
        `  -H 'Content-Type: application/json'`,
        `  -H 'X-Rasi-Event: ${selectedTestEvent}'`,
        `  -H 'X-Rasi-Delivery-Id: dlv_<uuid>'`,
        `  -H 'X-Rasi-Timestamp: <unix-seconds>'`,
        `  -H 'X-Rasi-Signature: sha256=<HMAC-SHA256(secret, "<timestamp>.<body>")>'`,
        `  -d '${JSON.stringify(selectedPayload)}'`,
        `# Secret: ${selectedWebhook.secret}`,
      ].join(' \\\n')
    : '';

  const testDelivery = async () => {
    if (!selectedWebhook) return;

    setTesting(true);
    try {
      const response = await api.webhooks.test(selectedWebhook.id, { event: selectedTestEvent });
      if (!response.success || !response.data) {
        toast.error(response.error || 'Failed to test webhook delivery.');
        return;
      }

      setWebhooks((prev) => prev.map((webhook) => (
        webhook.id === selectedWebhook.id ? (response.data?.webhook as WebhookConfig) : webhook
      )));
      setDeliveryLogs((prev) => [response.data!.log as DeliveryLog, ...prev].slice(0, 30));
      toast.success('Server-side webhook test completed.');
    } finally {
      setTesting(false);
    }
  };

  const recentLogs = deliveryLogs.slice(0, 12);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Webhook Events</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Configure outbound event destinations, verify endpoint readiness, and inspect delivery activity. Webhook configs and test logs are now persisted on the backend, and test deliveries are sent as real signed POST requests from the server.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">Server-side test relay live</span>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-cyan-300">Persisted in org settings</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <SummaryCard title="Active webhooks" value={String(summary.active)} detail="Enabled destinations ready for verification" icon={Webhook} accent="emerald" />
        <SummaryCard title="Failing endpoints" value={String(summary.failing)} detail="Endpoints currently marked degraded" icon={XCircle} accent="rose" />
        <SummaryCard title="Subscribed event types" value={String(summary.subscribedEvents)} detail="Unique event families across all endpoints" icon={Activity} accent="cyan" />
        <SummaryCard title="Recent log entries" value={String(summary.last24h)} detail="Activity captured in the last 24 hours" icon={CheckCircle2} accent="violet" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.25fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.35)]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                <Plus className="h-5 w-5 text-cyan-400" />
                Create Webhook Endpoint
              </h2>
              <p className="mt-1 text-sm text-slate-400">Define the destination URL, event subscriptions, and signing secret.</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-white">Webhook URL</label>
              <input
                type="url"
                placeholder="https://example.com/webhooks/rasi"
                value={newWebhook.url}
                onChange={(event) => {
                  setNewWebhook((prev) => ({ ...prev, url: event.target.value }));
                  if (errors.url) setErrors((prev) => ({ ...prev, url: undefined }));
                }}
                className={`w-full rounded-2xl border bg-slate-950/80 px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-600 ${errors.url ? 'border-rose-500/50 focus:border-rose-500' : 'border-slate-800 focus:border-cyan-500/50'}`}
              />
              <p className="mt-2 text-xs text-slate-500">Must be HTTPS, publicly accessible, and capable of verifying `X-Rasi-Signature`.</p>
              {errors.url && <p className="mt-2 text-sm text-rose-300">{errors.url}</p>}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium text-white">Subscribe to events</label>
                <span className="text-xs text-slate-500">Choose at least one</span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {EVENT_OPTIONS.map((eventOption) => {
                  const selected = newWebhook.events.includes(eventOption.id);
                  return (
                    <label
                      key={eventOption.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${selected ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          setNewWebhook((prev) => ({
                            ...prev,
                            events: event.target.checked
                              ? [...prev.events, eventOption.id]
                              : prev.events.filter((item) => item !== eventOption.id),
                          }));
                          if (errors.events) setErrors((prev) => ({ ...prev, events: undefined }));
                        }}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-semibold text-white">{eventOption.label}</p>
                        <p className="mt-1 text-xs text-slate-400">{eventOption.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
              {errors.events && <p className="mt-2 text-sm text-rose-300">{errors.events}</p>}
            </div>

            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
              <p className="font-semibold">What happens after creation</p>
              <p className="mt-1 text-cyan-100/80">The endpoint is persisted on the backend and given a signing secret. Use the Test Delivery studio to send a real signed POST from the server before relying on it in production flows.</p>
            </div>

            <button
              onClick={() => void createWebhook()}
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 font-semibold text-slate-950 transition-colors hover:bg-slate-100 disabled:bg-slate-300"
            >
              <Plus className="h-4 w-4" />
              {submitting ? 'Creating...' : 'Create Webhook'}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                <Send className="h-5 w-5 text-emerald-400" />
                Test Delivery Studio
              </h2>
              <p className="mt-1 text-sm text-slate-400">Prepare the exact payload, signature header, and curl command for endpoint verification.</p>
            </div>
          </div>
          <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">Manual test checklist</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
              <li>Create an endpoint and pick at least one event.</li>
              <li>Select the webhook below and click “Send Test Delivery”.</li>
              <li>Validate the signature using the signing secret.</li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">If your receiver is local, expose it with a public HTTPS tunnel (ngrok/Cloudflare Tunnel), then retry.</p>
          </div>

          {!selectedWebhook ? (
            <EmptyState
              icon={Send}
              title="No webhook selected for testing"
              description="Create a webhook or choose one from the list below. The test studio will then show the payload and curl command your backend relay sends."
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Selected endpoint</p>
                    <p className="mt-2 break-all font-mono text-sm text-cyan-300">{selectedWebhook.url}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${getStatusBadge(selectedWebhook.status)}`}>
                    {selectedWebhook.status.replace('_', ' ')}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-white">Sample event</label>
                <select
                  value={selectedTestEvent}
                  onChange={(event) => setSelectedTestEvent(event.target.value as EventId)}
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-white outline-none focus:border-cyan-500/50"
                >
                  {selectedWebhook.events.map((eventId) => {
                    const eventMeta = EVENT_OPTIONS.find((item) => item.id === eventId);
                    return <option key={eventId} value={eventId}>{eventMeta?.label || eventId}</option>;
                  })}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Payload preview</p>
                    <button onClick={() => copyText(JSON.stringify(selectedPayload, null, 2), 'Payload')} className="text-slate-400 transition-colors hover:text-white">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(selectedPayload, null, 2)}</pre>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Verification curl</p>
                    <button onClick={() => copyText(curlCommand, 'Curl command')} className="text-slate-400 transition-colors hover:text-white">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">{curlCommand}</pre>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <p className="font-semibold">Delivery mode</p>
                <p className="mt-1 text-emerald-100/80">This test sends a real signed POST from the backend. The curl command is still shown so you can verify signatures locally or compare payload handling during debugging.</p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => void testDelivery()}
                  disabled={testing}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 font-semibold text-slate-950 transition-colors hover:bg-slate-100 disabled:bg-slate-300"
                >
                  <FileJson className="h-4 w-4" />
                  {testing ? 'Sending Test...' : 'Send Test Delivery'}
                </button>
                <button
                  onClick={() => copyText(selectedWebhook.secret, 'Signing secret')}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 font-semibold text-white transition-colors hover:bg-slate-900"
                >
                  <Shield className="h-4 w-4" />
                  Copy Signing Secret
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Your Webhooks</h2>
            <p className="mt-1 text-sm text-slate-400">Configured destinations, signing secrets, and readiness state.</p>
          </div>
        </div>

        {loading ? (
          <EmptyState
            icon={Activity}
            title="Loading webhooks"
            description="Fetching saved endpoints and delivery history from the backend."
          />
        ) : webhooks.length === 0 ? (
          <EmptyState
            icon={Webhook}
            title="No webhooks configured yet"
            description="Create your first endpoint, select the events you care about, and send a server-side test delivery before wiring production workflows."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {webhooks.map((webhook) => (
              <div key={webhook.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm text-white">{webhook.id}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadge(webhook.status)}`}>
                        {webhook.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs text-cyan-300">{webhook.url}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openTestStudio(webhook.id)} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-900 hover:text-white" title="Open test studio">
                      <Send className="h-4 w-4" />
                    </button>
                    <button onClick={() => void rotateSecret(webhook.id)} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-900 hover:text-white" title="Rotate secret">
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <button onClick={() => void deleteWebhook(webhook.id)} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-900 hover:text-rose-300" title="Delete webhook">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">Signing secret</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate text-xs text-slate-300">{showSecret === webhook.id ? webhook.secret : '••••••••••••••••••••••••••'}</code>
                    <button onClick={() => setShowSecret(showSecret === webhook.id ? null : webhook.id)} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-950 hover:text-white">
                      {showSecret === webhook.id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button onClick={() => copyText(webhook.secret, 'Signing secret')} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-950 hover:text-white">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {webhook.events.map((eventId) => (
                    <span key={eventId} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-300">
                      {EVENT_OPTIONS.find((item) => item.id === eventId)?.label || eventId}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4 text-sm text-slate-400">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last tested</p>
                    <p className="mt-1 text-white">{formatDateTime(webhook.lastTestedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last delivery</p>
                    <p className="mt-1 text-white">{formatDateTime(webhook.lastDeliveryAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Succeeded</p>
                    <p className="mt-1 text-white">{webhook.successCount}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Failed</p>
                    <p className="mt-1 text-white">{webhook.failureCount}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => openTestStudio(webhook.id)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 font-semibold text-slate-950 transition-colors hover:bg-slate-100">
                    <Send className="h-4 w-4" />
                    Test Delivery
                  </button>
                  <button onClick={() => void toggleWebhookStatus(webhook.id)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-slate-900">
                    {webhook.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Delivery Logs</h2>
            <p className="mt-1 text-sm text-slate-400">Recent webhook attempts and response outcomes from the backend relay.</p>
          </div>
        </div>

        {loading ? (
          <EmptyState
            icon={Activity}
            title="Loading delivery logs"
            description="Fetching recent delivery attempts from the backend."
          />
        ) : recentLogs.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No delivery activity yet"
            description="Once you send a test delivery, recent attempts will appear here with timestamps, event types, response codes, and delivery outcomes."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-[0.18em] text-slate-500">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Endpoint</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Response</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr
                    key={log.id}
                    className={`border-b border-slate-800/70 text-sm text-slate-300 transition-colors ${
                      highlightedLogId === log.id ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/40' : ''
                    }`}
                  >
                    <td className="px-4 py-4 font-medium text-white">{EVENT_OPTIONS.find((item) => item.id === log.event)?.label || log.event}</td>
                    <td className="px-4 py-4 font-mono text-xs text-cyan-300">{log.endpoint}</td>
                    <td className="px-4 py-4">{formatDateTime(log.attemptedAt)}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        log.status === 'delivered'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-rose-500/10 text-rose-300'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">{log.responseCode || 'n/a'}{log.latencyMs ? ` • ${log.latencyMs}ms` : ''}</td>
                    <td className="px-4 py-4 text-slate-400">{log.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
        <button
          onClick={() => setDocsExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <h2 className="text-xl font-bold text-white">Developer Examples</h2>
            <p className="mt-1 text-sm text-slate-400">Reference payloads and verification notes, demoted below the operational sections.</p>
          </div>
          <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${docsExpanded ? 'rotate-180' : ''}`} />
        </button>

        {docsExpanded && (
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <DocCard
              title="Slack workflow"
              body="Use the webhook relay to forward cost or incident events into Slack after your receiver acknowledges signatures."
              code={`POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL`}
            />
            <DocCard
              title="Discord workflow"
              body="Route low-severity events or usage digests into Discord channels with the same signed payload structure."
              code={`POST https://discord.com/api/webhooks/YOUR/WEBHOOK`}
            />
            <DocCard
              title="Custom endpoint"
              body="Verify the signature header, store the event id for idempotency, then respond with HTTP 2xx before async processing."
              code={`POST /webhooks/rasi\nX-Rasi-Signature: whsec_...`}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'emerald' | 'rose' | 'cyan' | 'violet';
}) {
  const accentClasses = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  }[accent];

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/55 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-3 text-3xl font-bold text-white">{value}</p>
          <p className="mt-2 text-sm text-slate-400">{detail}</p>
        </div>
        <div className={`rounded-2xl border p-3 ${accentClasses}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-6 py-8 text-center">
      <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
        <Icon className="h-6 w-6 text-slate-500" />
      </div>
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-xl text-sm text-slate-400">{description}</p>
    </div>
  );
}

function DocCard({ title, body, code }: { title: string; body: string; code: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm text-slate-400">{body}</p>
      <pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">{code}</pre>
    </div>
  );
}
