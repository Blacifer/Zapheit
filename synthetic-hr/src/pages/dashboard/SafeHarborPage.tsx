import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ExternalLink,
  FileText,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  FileUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAgents, useAuth, useIncidents } from '../../hooks/useData';
import { api } from '../../lib/api-client';

type ChecklistStatus = 'ready' | 'partial' | 'action';
type ContractStatus = 'standard' | 'requested' | 'under_review' | 'approved' | 'executed';

type IntegrationRecord = {
  id: string;
  name?: string;
  status?: string;
};

type CachingState = {
  policy: {
    enabled: boolean;
    minContextTokens: number;
    retentionHours: number;
    cacheScope: 'organization' | 'agent';
    matchMode: 'exact' | 'normalized';
  };
  telemetry: {
    stats: {
      lastUpdatedAt: string | null;
    };
  };
};

type SafeHarborState = {
  organization: {
    id: string;
    name: string;
    plan: string;
    updatedAt: string;
  };
  config: {
    slaOverrides: {
      tier: string;
      uptimeTarget: string;
      supportResponseTarget: string;
      incidentAlertTarget: string;
      auditRetentionDays: number;
    };
    updatedAt: string | null;
  };
  contract: {
    id: string;
    status: ContractStatus;
    reference: string;
    notes: string;
    attachments: Array<{
      id: string;
      name: string;
      contentType: string;
      path: string;
      uploadedAt: string;
    }>;
    updatedAt: string | null;
  };
  sla: {
    tier: string;
    uptimeTarget: string;
    supportResponseTarget: string;
    incidentAlertTarget: string;
    auditRetentionDays: number;
    source: string;
  };
  proofs: {
    lastWebhookDelivery: {
      id: string;
      webhookId: string;
      attemptedAt: string;
      event: string;
      status: string;
      endpoint: string;
      responseCode: number | null;
      latencyMs: number | null;
      note: string;
      sourcePage: string;
      sourceId: string;
    } | null;
    lastKillSwitchEvent: {
      createdAt: string;
      agentId: string | null;
      level: number | null;
      reason: string;
      sourcePage: string;
      sourceId: string | null;
    } | null;
    lastPolicySyncAt: string | null;
  };
};

const ALERT_ROUTE_PROVIDERS = [
  'slack',
  'pagerduty',
  'microsoft teams',
  'teams',
  'gupshup',
  'msg91',
  'suprsend',
  'custom webhook',
  'webhook',
  'discord',
  'email',
];

const POLICY_LABELS: Record<string, string> = {
  exact: 'Exact text only',
  normalized: 'Normalize whitespace and formatting',
  organization: 'Organization-wide',
  agent: 'Per agent',
};

const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  standard: 'Standard terms',
  requested: 'Requested',
  under_review: 'Under review',
  approved: 'Approved',
  executed: 'Executed',
};

function formatDateTime(value?: string | null) {
  if (!value) return 'No evidence yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No evidence yet';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatRelative(value?: string | null) {
  if (!value) return 'No evidence yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No evidence yet';
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.max(0, Math.round(diffMs / 36e5));
  if (diffHours < 1) return 'within the last hour';
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function ChecklistBadge({ status }: { status: ChecklistStatus }) {
  const styles =
    status === 'ready'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
      : status === 'partial'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
        : 'border-rose-500/20 bg-rose-500/10 text-rose-300';
  const label = status === 'ready' ? 'Ready' : status === 'partial' ? 'Partial' : 'Action needed';
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}>{label}</span>;
}

function SectionCard({ title, description, children, icon: Icon }: { title: string; description: string; children: React.ReactNode; icon: any }) {
  return (
    <section className="rounded-[28px] border border-slate-800/90 bg-slate-900/50 p-6 shadow-[0_10px_40px_rgba(2,6,23,0.18)]">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
          <Icon className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <h2 className="text-[1.75rem] font-bold leading-tight text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function SafeHarborPage({ onNavigate, userRole }: { onNavigate?: (page: string) => void; userRole?: string }) {
  const { user } = useAuth();
  const { agents, loading: agentsLoading } = useAgents();
  const { incidents, loading: incidentsLoading } = useIncidents();

  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [cachingState, setCachingState] = useState<CachingState | null>(null);
  const [safeHarborState, setSafeHarborState] = useState<SafeHarborState | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [downloadingType, setDownloadingType] = useState<'sla' | 'dpa' | 'security' | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingContract, setSavingContract] = useState(false);
  const [configDraft, setConfigDraft] = useState<SafeHarborState['config'] | null>(null);
  const [contractDraft, setContractDraft] = useState<SafeHarborState['contract'] | null>(null);
  const [newAttachments, setNewAttachments] = useState<File[]>([]);
  const [activeComplianceTab, setActiveComplianceTab] = useState<'dpdpa' | 'nist' | 'india_ai'>('dpdpa');

  const canEdit = ['super_admin', 'admin'].includes(String(userRole || '').toLowerCase());

  useEffect(() => {
    let cancelled = false;
    const loadSignals = async () => {
      const [integrationResponse, cachingResponse, safeHarborResponse] = await Promise.all([
        api.connectors.getIntegrations(),
        api.caching.getState(),
        api.safeHarbor.getState(),
      ]);

      if (cancelled) return;

      if (integrationResponse.success && Array.isArray(integrationResponse.data)) setIntegrations(integrationResponse.data);
      if (cachingResponse.success && cachingResponse.data) setCachingState(cachingResponse.data as CachingState);
      if (safeHarborResponse.success && safeHarborResponse.data) {
        setSafeHarborState(safeHarborResponse.data as SafeHarborState);
        setConfigDraft((safeHarborResponse.data as SafeHarborState).config);
        setContractDraft((safeHarborResponse.data as SafeHarborState).contract);
      }

      if (!integrationResponse.success && !cachingResponse.success && !safeHarborResponse.success) {
        setPageError('Unable to load live Safe Harbor signals right now.');
      } else {
        setPageError(null);
      }
    };

    void loadSignals();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedIntegrations = useMemo(
    () => integrations.filter((integration) => ['connected', 'active', 'live'].includes((integration.status || '').toLowerCase())),
    [integrations],
  );

  const alertRoutes = useMemo(
    () => connectedIntegrations.filter((integration) => ALERT_ROUTE_PROVIDERS.some((provider) => (integration.name || '').toLowerCase().includes(provider))),
    [connectedIntegrations],
  );

  const activeAgents = agents.filter((agent: any) => agent.status === 'active');
  const agentsWithBudgets = agents.filter((agent: any) => Number(agent.budget_limit || 0) > 0);
  const openIncidents = incidents.filter((incident: any) => ['open', 'investigating'].includes((incident.status || '').toLowerCase()));
  const severeOpenIncidents = openIncidents.filter((incident: any) => ['high', 'critical'].includes((incident.severity || '').toLowerCase()));

  const latestEvidenceAt = useMemo(() => {
    const timestamps = [
      safeHarborState?.proofs.lastWebhookDelivery?.attemptedAt || null,
      safeHarborState?.proofs.lastKillSwitchEvent?.createdAt || null,
      safeHarborState?.proofs.lastPolicySyncAt || null,
      safeHarborState?.contract.updatedAt || null,
      safeHarborState?.config.updatedAt || null,
    ]
      .filter(Boolean)
      .map((value) => new Date(value as string).getTime())
      .filter((value) => !Number.isNaN(value));
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  }, [safeHarborState]);

  const checklist = useMemo(() => {
    const budgetStatus: ChecklistStatus =
      agents.length === 0 ? 'action' : agentsWithBudgets.length === agents.length ? 'ready' : agentsWithBudgets.length > 0 ? 'partial' : 'action';
    const alertStatus: ChecklistStatus = alertRoutes.length > 0 ? 'ready' : connectedIntegrations.length > 0 ? 'partial' : 'action';
    const cacheStatus: ChecklistStatus = cachingState?.policy.enabled ? 'ready' : 'action';
    const incidentStatus: ChecklistStatus = severeOpenIncidents.length === 0 ? 'ready' : openIncidents.length > 0 ? 'partial' : 'action';
    const contractStatus: ChecklistStatus =
      safeHarborState?.contract.status === 'executed'
        ? 'ready'
        : ['approved', 'under_review'].includes(safeHarborState?.contract.status || '')
          ? 'partial'
          : 'action';

    return [
      {
        title: 'Budget caps configured',
        description: agents.length === 0 ? 'No agents are in fleet yet.' : `${agentsWithBudgets.length}/${agents.length} agents have enforced budget limits.`,
        status: budgetStatus,
      },
      {
        title: 'Alert route connected',
        description: alertRoutes.length > 0 ? `${alertRoutes.length} notification route(s) can receive incident alerts.` : 'No alert route is connected for live incident routing.',
        status: alertStatus,
      },
      {
        title: 'Prompt governance policy',
        description: cachingState?.policy.enabled
          ? `Caching policy is active at ${POLICY_LABELS[cachingState.policy.cacheScope].toLowerCase()} scope.`
          : 'Prompt governance is disabled, so reuse telemetry is not enforced.',
        status: cacheStatus,
      },
      {
        title: 'Incident review path',
        description: severeOpenIncidents.length > 0
          ? `${severeOpenIncidents.length} severe incident(s) are still open.`
          : openIncidents.length > 0
            ? `${openIncidents.length} lower-severity incident(s) are open.`
            : 'No open incidents are waiting for review.',
        status: incidentStatus,
      },
      {
        title: 'Contract record',
        description: safeHarborState?.contract.reference
          ? `${CONTRACT_STATUS_LABELS[safeHarborState.contract.status]} · ${safeHarborState.contract.reference}`
          : 'No negotiated contract reference has been recorded yet.',
        status: contractStatus,
      },
    ];
  }, [agents.length, agentsWithBudgets.length, alertRoutes.length, cachingState, connectedIntegrations.length, openIncidents.length, safeHarborState, severeOpenIncidents.length]);

  const readinessScore = useMemo(() => {
    const score = checklist.reduce((sum, item) => sum + (item.status === 'ready' ? 1 : item.status === 'partial' ? 0.5 : 0), 0);
    return Math.round((score / checklist.length) * 100);
  }, [checklist]);

  const statusTone = readinessScore >= 80 ? 'Ready' : readinessScore >= 45 ? 'Partial' : 'At Risk';
  const orgLabel = safeHarborState?.organization.name || user?.user_metadata?.organization_name || user?.email || 'Your organization';

  const summaryCards = [
    { label: 'Coverage', value: `${readinessScore}%`, note: statusTone, tone: 'text-cyan-300' },
    { label: 'SLA tier', value: safeHarborState?.sla.tier || '—', note: safeHarborState?.sla.source === 'organization_override' ? 'Custom policy' : 'Plan policy', tone: 'text-white' },
    { label: 'Governed agents', value: `${agentsWithBudgets.length}/${Math.max(agents.length, 1)}`, note: agents.length === 0 ? 'No active fleet' : 'Budget-controlled', tone: 'text-emerald-300' },
    { label: 'Last evidence', value: formatRelative(latestEvidenceAt), note: formatDateTime(latestEvidenceAt), tone: 'text-violet-300' },
  ];

  const handleDownload = async (docType: 'sla' | 'dpa' | 'security') => {
    setDownloadingType(docType);
    const response = await api.safeHarbor.downloadDocument(docType);
    setDownloadingType(null);
    if (!response.success) {
      toast.error(response.error || 'Document download failed.');
      return;
    }
    toast.success(`${response.data?.filename || 'Document'} downloaded.`);
  };

  const readFileAsBase64 = (file: File) =>
    new Promise<{ name: string; contentType: string; contentBase64: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({ name: file.name, contentType: file.type || 'application/octet-stream', contentBase64: base64 });
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const handleSaveConfig = async () => {
    if (!configDraft) return;
    setSavingConfig(true);
    const response = await api.safeHarbor.updateConfig({
      slaOverrides: {
        tier: configDraft.slaOverrides.tier || undefined,
        uptimeTarget: configDraft.slaOverrides.uptimeTarget || undefined,
        supportResponseTarget: configDraft.slaOverrides.supportResponseTarget || undefined,
        incidentAlertTarget: configDraft.slaOverrides.incidentAlertTarget || undefined,
        auditRetentionDays: configDraft.slaOverrides.auditRetentionDays || undefined,
      },
    });
    setSavingConfig(false);
    if (!response.success || !response.data) {
      toast.error(response.error || 'SLA policy could not be saved.');
      return;
    }
    const next = response.data as SafeHarborState;
    setSafeHarborState(next);
    setConfigDraft(next.config);
    toast.success('SLA policy saved.');
  };

  const handleSaveContract = async () => {
    if (!contractDraft) return;
    setSavingContract(true);
    try {
      const attachments = await Promise.all(newAttachments.map(readFileAsBase64));
      const response = await api.safeHarbor.updateContract({
        status: contractDraft.status,
        reference: contractDraft.reference,
        notes: contractDraft.notes,
        attachments,
      });
      if (!response.success || !response.data) {
        toast.error(response.error || 'Contract record could not be saved.');
        setSavingContract(false);
        return;
      }
      const next = response.data as SafeHarborState;
      setSafeHarborState(next);
      setContractDraft(next.contract);
      setNewAttachments([]);
      toast.success('Contract record saved.');
    } catch (error: any) {
      toast.error(error.message || 'Failed to read contract attachment.');
    } finally {
      setSavingContract(false);
    }
  };

  const navigateToSource = (page?: string, id?: string | null) => {
    if (!page || !id) return;
    localStorage.setItem('rasi_safe_harbor_focus', JSON.stringify({ page, id }));
    onNavigate?.(page);
  };

  const handleContactLegal = () => {
    const subject = 'Safe Harbor and contract review';
    const body = `Hello legal team,%0D%0A%0D%0AOrganization: ${encodeURIComponent(orgLabel)}%0D%0AStatus: ${encodeURIComponent(statusTone)}%0D%0AContract status: ${encodeURIComponent(CONTRACT_STATUS_LABELS[safeHarborState?.contract.status || 'standard'])}`;
    window.location.href = `mailto:legal@rasisolutions.com?subject=${encodeURIComponent(subject)}&body=${body}`;
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-800/90 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_30%),linear-gradient(135deg,rgba(12,20,38,0.98),rgba(6,12,24,0.98))] p-6 shadow-[0_18px_60px_rgba(2,6,23,0.22)]">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
          <div className="max-w-2xl">
            <button
              onClick={() => onNavigate?.('settings')}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-300 transition hover:border-cyan-400/30 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Settings
            </button>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white xl:text-5xl">Safe Harbor</h1>
            <p className="mt-3 max-w-xl text-base leading-8 text-slate-300">
              One place to review live governance coverage, contract-backed commitments, source evidence, and the controls your team still owns.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-cyan-200">{orgLabel}</span>
              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-slate-200">{statusTone}</span>
              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-slate-300">Contract: {CONTRACT_STATUS_LABELS[safeHarborState?.contract.status || 'standard']}</span>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-3">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-slate-800/90 bg-slate-950/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{card.label}</p>
                <p className={`mt-3 text-3xl font-bold tabular-nums ${card.tone}`}>{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {pageError ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">{pageError}</div> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Coverage" description="What is evidenced today vs what still depends on your team." icon={ShieldCheck}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <p className="text-sm font-semibold text-white">Covered by RASI</p>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li>{agentsWithBudgets.length}/{agents.length || 0} agents have budget guardrails.</li>
                <li>{connectedIntegrations.length} integrations are inside monitored scope.</li>
                <li>{openIncidents.length} incidents are in the governance queue.</li>
                <li>Prompt policy is {cachingState?.policy.enabled ? 'active' : 'inactive'}.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <p className="text-sm font-semibold text-white">Customer-owned controls</p>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li>Prompt, persona, and knowledge accuracy</li>
                <li>Integration credentials and downstream permissions</li>
                <li>Legal review of outputs and business actions</li>
                <li>Third-party API and model behavior</li>
              </ul>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Readiness Checklist" description="The controls most likely to change the Safe Harbor posture." icon={Shield}>
          <div className="space-y-3">
            {checklist.map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{item.description}</p>
                  </div>
                  <ChecklistBadge status={item.status} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <SectionCard title="Operational Commitments" description="Published commitments and the current live signals supporting them." icon={Siren}>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5 min-h-[190px]">
              <p className="text-sm text-slate-400">Uptime target</p>
              <p className="mt-3 text-4xl font-bold tabular-nums text-white">{safeHarborState?.sla.uptimeTarget || '—'}</p>
              <p className="mt-2 text-sm text-slate-500">{safeHarborState?.sla.source === 'organization_override' ? 'Admin override' : 'Default plan policy'}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5 min-h-[190px]">
              <p className="text-sm text-slate-400">Support response</p>
              <p className="mt-3 text-4xl font-bold tabular-nums text-white">{safeHarborState?.sla.supportResponseTarget || '—'}</p>
              <p className="mt-2 text-sm text-slate-500">Tier: {safeHarborState?.sla.tier || 'Unknown'}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5 min-h-[190px]">
              <p className="text-sm text-slate-400">Incident alert objective</p>
              <p className="mt-3 text-4xl font-bold tabular-nums text-white">{safeHarborState?.sla.incidentAlertTarget || '—'}</p>
              <p className="mt-2 text-sm text-slate-500">{alertRoutes.length > 0 ? `${alertRoutes.length} alert route(s) connected` : 'No route connected'}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Evidence & Documents" description="Source-backed proof and account-specific document downloads." icon={FileText}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5">
              <p className="text-sm text-slate-400">Latest webhook delivery</p>
              <p className="mt-2 text-lg font-semibold text-white">{formatDateTime(safeHarborState?.proofs.lastWebhookDelivery?.attemptedAt)}</p>
              <p className="mt-1 text-sm text-slate-500">{safeHarborState?.proofs.lastWebhookDelivery ? `${safeHarborState.proofs.lastWebhookDelivery.event} · ${safeHarborState.proofs.lastWebhookDelivery.status} · ${safeHarborState.proofs.lastWebhookDelivery.id}` : 'No delivery recorded yet.'}</p>
              {safeHarborState?.proofs.lastWebhookDelivery?.sourceId ? (
                <button onClick={() => navigateToSource('webhooks', safeHarborState.proofs.lastWebhookDelivery?.sourceId)} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
                  Open delivery log #{safeHarborState.proofs.lastWebhookDelivery.sourceId.slice(0, 8)}
                  <ExternalLink className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5">
              <p className="text-sm text-slate-400">Latest kill switch event</p>
              <p className="mt-2 text-lg font-semibold text-white">{formatDateTime(safeHarborState?.proofs.lastKillSwitchEvent?.createdAt)}</p>
              <p className="mt-1 text-sm text-slate-500">{safeHarborState?.proofs.lastKillSwitchEvent ? `Agent ${safeHarborState.proofs.lastKillSwitchEvent.agentId || 'unknown'} · level ${safeHarborState.proofs.lastKillSwitchEvent.level || 'n/a'}` : 'No kill switch event recorded yet.'}</p>
              {safeHarborState?.proofs.lastKillSwitchEvent?.sourceId ? (
                <button onClick={() => navigateToSource('fleet', safeHarborState.proofs.lastKillSwitchEvent?.sourceId)} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
                  Open agent #{safeHarborState.proofs.lastKillSwitchEvent.sourceId?.slice(0, 8)}
                  <ExternalLink className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button onClick={() => handleDownload('sla')} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:bg-cyan-500/10">{downloadingType === 'sla' ? 'Downloading SLA summary...' : 'Download SLA Summary'}</button>
            <button onClick={() => handleDownload('security')} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:bg-cyan-500/10">{downloadingType === 'security' ? 'Downloading security overview...' : 'Download Security Overview'}</button>
            <button onClick={() => handleDownload('dpa')} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:bg-cyan-500/10">{downloadingType === 'dpa' ? 'Downloading DPA overview...' : 'Download DPA Overview'}</button>
            <button onClick={handleContactLegal} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:bg-cyan-500/10">Request Custom Terms</button>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard title="SLA Policy" description="Editable backend policy for account-level SLA defaults and overrides." icon={Save}>
          {canEdit && configDraft ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Tier label</span>
                  <input value={configDraft.slaOverrides.tier} onChange={(event) => setConfigDraft((current) => current ? { ...current, slaOverrides: { ...current.slaOverrides, tier: event.target.value } } : current)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Audit retention days</span>
                  <input type="number" min={0} value={configDraft.slaOverrides.auditRetentionDays || ''} onChange={(event) => setConfigDraft((current) => current ? { ...current, slaOverrides: { ...current.slaOverrides, auditRetentionDays: Number(event.target.value || 0) } } : current)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Uptime target</span>
                  <input value={configDraft.slaOverrides.uptimeTarget} onChange={(event) => setConfigDraft((current) => current ? { ...current, slaOverrides: { ...current.slaOverrides, uptimeTarget: event.target.value } } : current)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Support response</span>
                  <input value={configDraft.slaOverrides.supportResponseTarget} onChange={(event) => setConfigDraft((current) => current ? { ...current, slaOverrides: { ...current.slaOverrides, supportResponseTarget: event.target.value } } : current)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-white">Incident alert target</span>
                  <input value={configDraft.slaOverrides.incidentAlertTarget} onChange={(event) => setConfigDraft((current) => current ? { ...current, slaOverrides: { ...current.slaOverrides, incidentAlertTarget: event.target.value } } : current)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
                </label>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">Last updated: {formatDateTime(safeHarborState?.config.updatedAt)}</p>
                <button onClick={handleSaveConfig} disabled={savingConfig} className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-400 disabled:opacity-50">{savingConfig ? 'Saving...' : 'Save Policy'}</button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5 text-sm text-slate-400">
              Only admins can edit Safe Harbor SLA policy. Current tier is {safeHarborState?.sla.tier || 'not configured'}.
            </div>
          )}
        </SectionCard>

        <SectionCard title="Contract Record" description="Negotiated terms status and attachments stored separately from org settings." icon={FileUp}>
          {canEdit && contractDraft ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Contract status</span>
                  <select value={contractDraft.status} onChange={(event) => setContractDraft((current) => current ? { ...current, status: event.target.value as ContractStatus } : current)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50">
                    {Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white">Contract reference</span>
                  <input value={contractDraft.reference} onChange={(event) => setContractDraft((current) => current ? { ...current, reference: event.target.value } : current)} placeholder="MSA-2026-014" className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
                </label>
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-white">Negotiation notes</span>
                <textarea value={contractDraft.notes} onChange={(event) => setContractDraft((current) => current ? { ...current, notes: event.target.value } : current)} rows={4} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-white">Attach contract files</span>
                <input type="file" multiple onChange={(event) => setNewAttachments(Array.from(event.target.files || []))} className="w-full rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300" />
              </label>
              {contractDraft.attachments.length > 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                  <p className="text-sm font-medium text-white">Stored attachments</p>
                  <div className="mt-3 space-y-2">
                    {contractDraft.attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300">
                        <span className="truncate">{attachment.name}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(attachment.uploadedAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {newAttachments.length > 0 ? <p className="text-sm text-slate-400">{newAttachments.length} new attachment(s) ready to upload.</p> : null}
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">Last contract update: {formatDateTime(contractDraft.updatedAt)}</p>
                <button onClick={handleSaveContract} disabled={savingContract} className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-400 disabled:opacity-50">{savingContract ? 'Saving...' : 'Save Contract Record'}</button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5 text-sm text-slate-400">
              Contract records are admin-only. Current status is {CONTRACT_STATUS_LABELS[safeHarborState?.contract.status || 'standard']}.
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Regulatory Compliance" description="How Rasi's governance features map to India and international AI regulatory frameworks." icon={Shield}>
        {/* Tab bar */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {([
            { id: 'dpdpa', label: 'DPDPA (India)' },
            { id: 'nist', label: 'NIST AI RMF' },
            { id: 'india_ai', label: 'India AI Governance 2025' },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveComplianceTab(tab.id as 'dpdpa' | 'nist' | 'india_ai')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                activeComplianceTab === tab.id
                  ? 'bg-cyan-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* DPDPA */}
        {activeComplianceTab === 'dpdpa' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400 mb-4">Digital Personal Data Protection Act (India, 2023) — maps Rasi features to Data Fiduciary obligations.</p>
            {([
              { requirement: 'Data Principal rights & consent', feature: 'Audit logs + action policies', status: 'covered' },
              { requirement: 'PII detection & Data Fiduciary obligations', feature: 'Real-time Aadhaar, PAN, UPI ID, email, phone detection', status: 'covered' },
              { requirement: 'Breach notification', feature: 'Kill switch + incident webhooks + alert routing', status: 'covered' },
              { requirement: 'Purpose limitation', feature: 'Action policies with scope restrictions', status: 'covered' },
              { requirement: 'Data localization', feature: 'VPC/On-prem runtime workers (Enterprise)', status: 'partial' },
              { requirement: 'Data Protection Officer obligations', feature: 'Evidence export for DPO reporting (Black Box)', status: 'partial' },
              { requirement: 'Consent Manager integration', feature: 'Not yet implemented', status: 'gap' },
            ]).map((item) => (
              <div key={item.requirement} className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-950/55 px-4 py-3">
                <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${item.status === 'covered' ? 'bg-green-400' : item.status === 'partial' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{item.requirement}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{item.feature}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg shrink-0 ${item.status === 'covered' ? 'bg-green-400/10 text-green-400' : item.status === 'partial' ? 'bg-yellow-400/10 text-yellow-400' : 'bg-red-400/10 text-red-400'}`}>
                  {item.status === 'covered' ? 'Covered' : item.status === 'partial' ? 'Partial' : 'Gap'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* NIST AI RMF */}
        {activeComplianceTab === 'nist' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400 mb-4">NIST AI Risk Management Framework — maps Rasi capabilities to the four core functions.</p>
            {([
              { function: 'GOVERN', requirement: 'Policies, roles & accountability', feature: 'Action policies, RBAC (admin/manager/viewer), audit logs', status: 'covered' },
              { function: 'GOVERN', requirement: 'Organizational AI risk strategy', feature: 'Safe Harbor config, SLA tiers, contract records', status: 'partial' },
              { function: 'MAP', requirement: 'AI system inventory', feature: 'Agent fleet registry with metadata', status: 'covered' },
              { function: 'MAP', requirement: 'Integration & dependency tracking', feature: 'Integration catalog (100+ connectors)', status: 'covered' },
              { function: 'MEASURE', requirement: 'Incident detection & monitoring', feature: 'Real-time PII, hallucination, toxicity, prompt injection detection', status: 'covered' },
              { function: 'MEASURE', requirement: 'Adversarial testing', feature: 'Shadow Mode red-teaming', status: 'covered' },
              { function: 'MEASURE', requirement: 'Cost & performance tracking', feature: 'Multi-provider cost dashboard (OpenAI, Anthropic, OpenRouter)', status: 'covered' },
              { function: 'MANAGE', requirement: 'Incident response & controls', feature: 'Kill switch, approval workflows (HITL), action policies', status: 'covered' },
              { function: 'MANAGE', requirement: 'Automated remediation', feature: 'Not yet implemented', status: 'gap' },
            ]).map((item) => (
              <div key={`${item.function}-${item.requirement}`} className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-950/55 px-4 py-3">
                <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${item.status === 'covered' ? 'bg-green-400' : item.status === 'partial' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-cyan-400 mb-0.5">{item.function}</p>
                  <p className="text-sm font-medium text-white">{item.requirement}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{item.feature}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg shrink-0 ${item.status === 'covered' ? 'bg-green-400/10 text-green-400' : item.status === 'partial' ? 'bg-yellow-400/10 text-yellow-400' : 'bg-red-400/10 text-red-400'}`}>
                  {item.status === 'covered' ? 'Covered' : item.status === 'partial' ? 'Partial' : 'Gap'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* India AI Governance Framework */}
        {activeComplianceTab === 'india_ai' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400 mb-4">India AI Governance Framework 2025–26 (MeitY) — maps Rasi capabilities to core principles.</p>
            {([
              { principle: 'Human-centricity', requirement: 'Human oversight of AI decisions', feature: 'HITL approval workflows, kill switch', status: 'covered' },
              { principle: 'Accountability', requirement: 'Audit trails & evidence', feature: 'Black Box forensics, immutable audit logs, Safe Harbor evidence export', status: 'covered' },
              { principle: 'Transparency', requirement: 'Explainability of AI agent actions', feature: 'Conversation history, incident details, cost attribution per agent', status: 'covered' },
              { principle: 'Risk proportionality', requirement: 'Risk-based incident response', feature: 'Severity-based incident classification (critical/high/medium/low)', status: 'covered' },
              { principle: 'Privacy & data protection', requirement: 'India-specific PII safeguards', feature: 'Aadhaar, PAN, UPI ID, Passport detection in real time', status: 'covered' },
              { principle: 'Inclusion & accessibility', requirement: 'Multi-provider, multi-framework support', feature: 'OpenAI + Anthropic + OpenRouter + custom agents', status: 'covered' },
              { principle: 'Security', requirement: 'Adversarial robustness testing', feature: 'Shadow Mode prompt injection & policy override testing', status: 'covered' },
              { principle: 'Regulatory framework mapping', requirement: 'Automated compliance reporting', feature: 'Not yet implemented', status: 'gap' },
            ]).map((item) => (
              <div key={item.principle} className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-950/55 px-4 py-3">
                <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${item.status === 'covered' ? 'bg-green-400' : item.status === 'partial' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-cyan-400 mb-0.5">{item.principle}</p>
                  <p className="text-sm font-medium text-white">{item.requirement}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{item.feature}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg shrink-0 ${item.status === 'covered' ? 'bg-green-400/10 text-green-400' : item.status === 'partial' ? 'bg-yellow-400/10 text-yellow-400' : 'bg-red-400/10 text-red-400'}`}>
                  {item.status === 'covered' ? 'Covered' : item.status === 'partial' ? 'Partial' : 'Gap'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Covered</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Partial</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Gap</span>
        </div>
      </SectionCard>

      <SectionCard title="Legal Limits" description="Keep the legal boundary short on the page and evidence-backed everywhere else." icon={ShieldAlert}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5">
            <p className="font-semibold text-white">RASI boundary</p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
              <li>Governance controls, monitoring, audit evidence, and emergency controls</li>
              <li>Policy enforcement inside the RASI layer where configured</li>
              <li>Operational telemetry and observability for the account</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5">
            <p className="font-semibold text-white">Customer and third-party boundary</p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
              <li>Prompts, training data, integrations, and output review remain customer-owned</li>
              <li>Third-party model and API behavior remains outside the RASI liability envelope</li>
              <li>Commercial remedies stay contract-bound</li>
            </ul>
          </div>
        </div>
      </SectionCard>

      {(agentsLoading || incidentsLoading) && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/55 px-5 py-4 text-sm text-slate-400">Loading live governance signals...</div>
      )}
    </div>
  );
}
