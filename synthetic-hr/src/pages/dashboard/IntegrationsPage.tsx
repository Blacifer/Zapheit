import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api-client';
import type { SlackMessage } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { INTEGRATION_PACKS, PACK_DOMAIN_AGENTS, guessPackForIntegration, packDisplayBadge, type IntegrationPackId } from '../../lib/integration-packs';
import type { AIAgent } from '../../types';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  KeyRound,
  FileText,
  Fingerprint,
  Info,
  Link2,
  Mail,
  Shield,
  ShoppingBag,
  Sparkles,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

type CapabilityWrite = { id: string; label: string; risk: 'low' | 'medium' | 'high' | 'money' };
type Capabilities = { reads: string[]; writes: CapabilityWrite[] };

type RequiredField = {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required: boolean;
  description?: string;
};

type IntegrationRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  authType: 'api_key' | 'oauth2' | string;
  tags: string[];
  color?: string;
  priority?: number;
  requiredFields: RequiredField[];
  capabilities?: Capabilities;
  status: 'disconnected' | 'connected' | 'error' | 'syncing' | 'expired' | string;
  lifecycleStatus?: 'not_configured' | 'configured' | 'connected' | 'error' | 'syncing' | 'expired' | string;
  oauth?: { ready: boolean; missingEnv: string[] } | null;
  readiness?: {
    expectedRedirectUrl: string | null;
    items: Array<{ id: string; label: string; status: 'ok' | 'todo' | 'blocked'; detail?: string | null }>;
  } | null;
  tokenExpiresAt?: string | null;
  tokenExpired?: boolean;
  tokenExpiresSoon?: boolean;
  lastSyncAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
  connectionId?: string | null;
  specStatus?: 'READY' | 'COMING_SOON' | string;
};

type ConnectionLog = {
  id: string;
  action: string;
  status: string;
  message: string | null;
  metadata?: any;
  created_at: string;
};

type SampleCandidate = {
  id: string;
  source: string;
  full_name: string;
  headline: string;
  location: string;
  experience_years: number;
  skills: string[];
  match_score: number;
  summary: string;
  last_updated_at: string;
};

type SamplePullResponse = { candidates: SampleCandidate[]; jds: Array<{ id: string; title: string; location: string; seniority: string }> };
type IntegrationsPageProps = {
  selectedAgent?: AIAgent | null;
  recommendedPackId?: IntegrationPackId | null;
  entryMode?: 'publish' | 'browse';
  onNavigate?: (page: string) => void;
  onActivateDomainAgent?: (packId: IntegrationPackId, agentId: string) => void;
  onIntegrationConnected?: (payload: {
    agentId: string;
    integrationId: string;
    integrationName: string;
    packId: IntegrationPackId;
    status: string;
    lastSyncAt?: string | null;
  }) => void;
  onIntegrationDisconnected?: () => void;
};
const PUBLISH_CONTEXT_STORAGE_KEY = 'synthetic_hr_publish_context';
const AGENT_WORKSPACE_FOCUS_STORAGE_KEY = 'synthetic_hr_agent_workspace_focus';

function statusTone(status: string): 'connected' | 'pending' | 'error' | 'neutral' {
  if (status === 'connected') return 'connected';
  if (status === 'syncing') return 'pending';
  if (status === 'error' || status === 'expired') return 'error';
  return 'neutral';
}

const statusToneClasses: Record<ReturnType<typeof statusTone>, string> = {
  connected: 'border-emerald-400/20 bg-emerald-400/12 text-emerald-100',
  pending: 'border-amber-400/20 bg-amber-400/12 text-amber-100',
  error: 'border-rose-400/20 bg-rose-400/12 text-rose-100',
  neutral: 'border-white/10 bg-white/[0.05] text-slate-300',
};

function formatStatusLabel(status: string): string {
  switch (status) {
    case 'not_configured':
      return 'Not configured';
    case 'configured':
      return 'Configured';
    case 'connected':
      return 'Connected';
    case 'syncing':
      return 'Syncing';
    case 'expired':
      return 'Expired';
    case 'error':
      return 'Needs attention';
    default:
      return 'Disconnected';
  }
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function parseOAuthToastFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  const service = params.get('service');
  const message = params.get('message');

  if (!status) return null;

  if (status === 'connected') {
    toast.success(`Connected ${service || 'integration'}.`);
  } else if (status === 'error') {
    toast.error(message ? String(message) : `Failed to connect ${service || 'integration'}.`);
  } else {
    toast.info('Integration flow updated.');
  }

  try {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
  } catch {
    // ignore
  }

  return { status, service, message };
}

function readLabel(readId: string): { label: string; icon: any } {
  switch (readId) {
    case 'candidate_profiles':
      return { label: 'Read candidates', icon: Users };
    case 'candidate_profiles_lite':
      return { label: 'Read profiles (lite)', icon: Users };
    case 'job_descriptions':
      return { label: 'Read jobs/JDs', icon: FileText };
    case 'user_profile':
      return { label: 'Identity', icon: Fingerprint };
    default:
      return { label: readId.replace(/_/g, ' '), icon: Database };
  }
}

function riskBadge(risk: CapabilityWrite['risk']) {
  switch (risk) {
    case 'low':
      return { label: 'Low', cls: 'border-white/10 bg-white/5 text-slate-200' };
    case 'medium':
      return { label: 'Medium', cls: 'border-amber-400/20 bg-amber-400/12 text-amber-200' };
    case 'high':
      return { label: 'High', cls: 'border-rose-400/20 bg-rose-400/12 text-rose-200' };
    case 'money':
      return { label: 'Money', cls: 'border-rose-400/25 bg-rose-400/15 text-rose-100' };
    default:
      return { label: '—', cls: 'border-white/10 bg-white/5 text-slate-200' };
  }
}

function readinessBadge(status: 'ok' | 'todo' | 'blocked') {
  switch (status) {
    case 'ok':
      return { label: 'OK', cls: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' };
    case 'blocked':
      return { label: 'Blocked', cls: 'border-rose-400/20 bg-rose-400/10 text-rose-100' };
    default:
      return { label: 'Todo', cls: 'border-amber-400/20 bg-amber-400/10 text-amber-100' };
  }
}

function providerIcon(id: string) {
  const key = id.toLowerCase();
  if (key.includes('google')) return Mail;
  if (key.includes('microsoft') || key.includes('teams')) return CalendarDays;
  if (key.includes('linkedin')) return Users;
  if (key.includes('naukri')) return Users;
  if (key.includes('zendesk') || key.includes('freshdesk')) return Users;
  if (key.includes('jira')) return Wrench;
  if (key.includes('hubspot')) return Building2;
  if (key.includes('stripe') || key.includes('razorpay') || key.includes('paytm')) return Database;
  return Building2;
}

function Modal({
  title,
  children,
  onClose,
  widthClass = 'max-w-3xl',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  widthClass?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close modal" />
      <div className={`relative w-full ${widthClass} rounded-2xl border border-white/10 bg-slate-950/95 backdrop-blur-xl shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-300" />
            <h2 className="text-base font-semibold text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close drawer" />
      <div className="ml-auto w-full max-w-xl h-full border-l border-white/10 bg-slate-950/95 backdrop-blur-xl shadow-2xl relative">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-auto h-[calc(100%-64px)]">{children}</div>
      </div>
    </div>
  );
}

export default function IntegrationsPage({
  selectedAgent,
  recommendedPackId,
  entryMode = 'browse',
  onNavigate,
  onActivateDomainAgent,
  onIntegrationConnected,
  onIntegrationDisconnected,
}: IntegrationsPageProps) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IntegrationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState<ConnectionLog[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedNaukri, setSelectedNaukri] = useState(true);
  const [selectedLinkedIn, setSelectedLinkedIn] = useState(true);
  const [outreachChoice, setOutreachChoice] = useState<'google_workspace' | 'microsoft_365'>('google_workspace');
  const [governanceConfirmed, setGovernanceConfirmed] = useState(false);
  const [connecting, setConnecting] = useState<Record<string, boolean>>({});
  const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({});
  const [connectModalProviderId, setConnectModalProviderId] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState('');

  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleCandidates, setSampleCandidates] = useState<SampleCandidate[]>([]);
  const [sampleJds, setSampleJds] = useState<SamplePullResponse['jds']>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);

  const [activePack, setActivePack] = useState<IntegrationPackId>('recruitment');
  const [persistedContext, setPersistedContext] = useState<{ agentId?: string; agentName?: string; recommendedPackId?: IntegrationPackId } | null>(null);

  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultQuery, setVaultQuery] = useState('');
  const [vaultFocus, setVaultFocus] = useState<'pack' | 'all'>('pack');
  const [vaultPackId, setVaultPackId] = useState<IntegrationPackId>('recruitment');
  const [vaultBusy, setVaultBusy] = useState<Record<string, 'connecting' | 'testing' | 'disconnecting' | null>>({});
  const [bulkJson, setBulkJson] = useState('');
  const [bulkBusy, setBulkBusy] = useState<null | 'save' | 'save_test'>(null);

  const [actionCatalogLoading, setActionCatalogLoading] = useState(false);
  const [actionCatalogError, setActionCatalogError] = useState<string | null>(null);

  // Slack Inbox
  const [slackInboxOpen, setSlackInboxOpen] = useState(false);
  const [slackMessages, setSlackMessages] = useState<SlackMessage[]>([]);
  const [slackMessagesLoading, setSlackMessagesLoading] = useState(false);
  const [slackFilter, setSlackFilter] = useState<'all' | 'new' | 'reviewed' | 'replied' | 'dismissed'>('all');
  const [slackReplyingTo, setSlackReplyingTo] = useState<string | null>(null);
  const [slackReplyText, setSlackReplyText] = useState('');
  const [slackReplying, setSlackReplying] = useState(false);
  const [actionCatalog, setActionCatalog] = useState<Array<{
    service: string;
    providerName: string;
    providerCategory: string;
    action: string;
    label: string;
    risk: 'low' | 'medium' | 'high' | 'money';
    pack?: IntegrationPackId | null;
    enabled: boolean;
    requireApproval: boolean;
    requiredRole: string;
    updatedAt: string | null;
  }>>([]);

  const selectedIntegration = useMemo(() => {
    if (!activeProviderId) return null;
    return items.find((it) => it.id === activeProviderId) || null;
  }, [items, activeProviderId]);

  const providersByPack = useMemo(() => {
    const map = new Map<IntegrationPackId, IntegrationRow[]>();
    INTEGRATION_PACKS.forEach((p) => map.set(p.id, []));
    items.forEach((it) => {
      // Built-in/internal provider is used to populate Action Catalog; keep it out of provider cards + pack stats to avoid confusion.
      if (it.id === 'internal') return;
      // Coming soon integrations are rendered in a separate section below.
      if (it.specStatus === 'COMING_SOON') return;
      const packId = guessPackForIntegration(it);
      const list = map.get(packId) || [];
      list.push(it);
      map.set(packId, list);
    });
    // stable ordering
    Array.from(map.entries()).forEach(([k, list]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      map.set(k, list);
    });
    return map;
  }, [items]);

  const comingSoonByPack = useMemo(() => {
    const map = new Map<IntegrationPackId, IntegrationRow[]>();
    INTEGRATION_PACKS.forEach((p) => map.set(p.id, []));
    items.forEach((it) => {
      if (it.specStatus !== 'COMING_SOON') return;
      const packId = guessPackForIntegration(it);
      const list = map.get(packId) || [];
      list.push(it);
      map.set(packId, list);
    });
    return map;
  }, [items]);

  const activePackProviders = useMemo(() => providersByPack.get(activePack) || [], [providersByPack, activePack]);

  const filteredPackProviders = useMemo(() => {
    if (!providerSearch.trim()) return activePackProviders;
    const q = providerSearch.toLowerCase();
    return activePackProviders.filter((p) =>
      `${p.name} ${p.category} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(q)
    );
  }, [activePackProviders, providerSearch]);

  const effectiveStatus = useCallback((it: IntegrationRow): string => it.lifecycleStatus || it.status || 'disconnected', []);
  const isConfiguredLike = useCallback((it: IntegrationRow): boolean => effectiveStatus(it) !== 'not_configured', [effectiveStatus]);
  const isConnectedLike = useCallback((it: IntegrationRow): boolean => effectiveStatus(it) === 'connected', [effectiveStatus]);

  const packStats = useMemo(() => {
    const stats = new Map<IntegrationPackId, { total: number; configured: number; connected: number; needsAttention: number }>();
    INTEGRATION_PACKS.forEach((p) => {
      const list = providersByPack.get(p.id) || [];
      stats.set(p.id, {
        total: list.length,
        configured: list.filter(isConfiguredLike).length,
        connected: list.filter(isConnectedLike).length,
        needsAttention: list.filter((it) => ['error', 'expired'].includes(effectiveStatus(it))).length,
      });
    });
    return stats;
  }, [effectiveStatus, isConfiguredLike, isConnectedLike, providersByPack]);

  const selectedProviders = useMemo(() => {
    const list: string[] = [];
    if (selectedNaukri) list.push('naukri');
    if (selectedLinkedIn) list.push('linkedin');
    list.push(outreachChoice);
    return list;
  }, [selectedNaukri, selectedLinkedIn, outreachChoice]);

  const providerMap = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const activeCandidate = useMemo(() => {
    if (!activeCandidateId) return null;
    return sampleCandidates.find((c) => c.id === activeCandidateId) || null;
  }, [sampleCandidates, activeCandidateId]);

  const effectiveAgentContext = selectedAgent || persistedContext || null;
  const effectiveAgentId = selectedAgent?.id || persistedContext?.agentId || null;
  const effectiveAgentName = selectedAgent?.name || persistedContext?.agentName || null;

  const focusAgentWorkspace = useCallback((agentId: string | null | undefined) => {
    if (!agentId) return;
    localStorage.setItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY, JSON.stringify({ agentId }));
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const res = await api.integrations.getAll();
    if (!res.success) {
      setItems([]);
      setLoadError(res.error || 'Failed to load integrations');
      setLoading(false);
      return;
    }
    setItems((res.data as IntegrationRow[]) || []);
    setLoading(false);
  }

  async function loadActionCatalog() {
    setActionCatalogLoading(true);
    setActionCatalogError(null);
    const res = await api.integrations.getActionCatalog();
    if (!res.success) {
      setActionCatalog([]);
      setActionCatalogError(res.error || 'Failed to load action catalog');
      setActionCatalogLoading(false);
      return;
    }
    setActionCatalog((res.data as any[]) || []);
    setActionCatalogLoading(false);
  }

  async function loadSlackMessages(filter: typeof slackFilter) {
    setSlackMessagesLoading(true);
    const res = await api.slack.getMessages(filter === 'all' ? {} : { status: filter });
    if (res.success) setSlackMessages((res.data as SlackMessage[]) || []);
    setSlackMessagesLoading(false);
  }

  async function sendSlackReply(messageId: string) {
    if (!slackReplyText.trim()) return;
    setSlackReplying(true);
    const res = await api.slack.reply(messageId, slackReplyText.trim());
    if (res.success) {
      toast.success('Reply sent to Slack.');
      setSlackMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status: 'replied' } : m)),
      );
      setSlackReplyingTo(null);
      setSlackReplyText('');
    } else {
      toast.error(res.error || 'Failed to send reply');
    }
    setSlackReplying(false);
  }

  async function updateSlackStatus(messageId: string, status: SlackMessage['status']) {
    const res = await api.slack.updateStatus(messageId, status);
    if (res.success) {
      setSlackMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status } : m)),
      );
    } else {
      toast.error(res.error || 'Failed to update status');
    }
  }

  async function loadLogs(serviceId: string) {
    setLogsLoading(true);
    setLogsError(null);
    const res = await api.integrations.getLogs(serviceId, 20);
    if (!res.success) {
      setLogs([]);
      setLogsError(res.error || 'Failed to load connection history');
      setLogsLoading(false);
      return;
    }
    setLogs((res.data as ConnectionLog[]) || []);
    setLogsLoading(false);
  }

  const openDetails = async (providerId: string) => {
    setActiveProviderId(providerId);
    setDetailsOpen(true);
    await loadLogs(providerId);
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    setActiveProviderId(null);
    setLogs([]);
    setLogsError(null);
    setLogsLoading(false);
  };

  const openWizard = (step?: 1 | 2 | 3 | 4 | 5) => {
    setWizardOpen(true);
    setWizardStep(step || 1);
    setGovernanceConfirmed(false);
    setSampleError(null);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardStep(1);
    setSampleError(null);
  };

  const openVault = (focus?: 'pack' | 'all', packId?: IntegrationPackId) => {
    setVaultFocus(focus || 'pack');
    if (packId) setVaultPackId(packId);
    setVaultOpen(true);
  };

  const closeVault = () => {
    setVaultOpen(false);
    setVaultQuery('');
  };

  const openConnectModal = (providerId: string) => {
    ensureCredentialSeed(providerId);
    setConnectModalProviderId(providerId);
  };

  const closeConnectModal = () => {
    setConnectModalProviderId(null);
  };

  const connectFromModal = async (providerId: string) => {
    await connectApiKey(providerId);
    closeConnectModal();
  };

  const ensureCredentialSeed = (providerId: string) => {
    const provider = providerMap.get(providerId);
    if (!provider) return;
    if (provider.authType !== 'api_key') return;
    setCredentials((prev) => {
      if (prev[providerId]) return prev;
      const seed: Record<string, string> = {};
      provider.requiredFields.forEach((f) => {
        seed[f.name] = '';
      });
      return { ...prev, [providerId]: seed };
    });
  };

  const startConnectProvider = (providerId: string) => {
    if (providerId === 'naukri') setSelectedNaukri(true);
    if (providerId === 'linkedin') setSelectedLinkedIn(true);
    if (providerId === 'google_workspace' || providerId === 'microsoft_365') setOutreachChoice(providerId);
    openWizard(3);
    ensureCredentialSeed(providerId);
  };

  const connectOAuth = async (providerId: string) => {
    const provider = providerMap.get(providerId);
    if (provider?.oauth && provider.oauth.ready === false) {
      toast.error(`OAuth is not ready. Missing env: ${(provider.oauth.missingEnv || []).join(', ')}`);
      return;
    }
    setConnecting((prev) => ({ ...prev, [providerId]: true }));

    // Persist agent context before the OAuth redirect (same as before).
    if (effectiveAgentContext) {
      localStorage.setItem(PUBLISH_CONTEXT_STORAGE_KEY, JSON.stringify({
        agentId: effectiveAgentId,
        agentName: effectiveAgentName,
        recommendedPackId: activePack,
      }));
    }

    let init: Awaited<ReturnType<typeof api.integrations.initOAuth>>;
    try {
      init = await api.integrations.initOAuth(providerId, '/dashboard/integrations', {}, true);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to start OAuth connection');
      setConnecting((prev) => ({ ...prev, [providerId]: false }));
      return;
    }

    if (!init.success || !init.data?.url) {
      toast.error(init.error || 'Failed to start OAuth connection');
      setConnecting((prev) => ({ ...prev, [providerId]: false }));
      return;
    }

    const popupUrl = init.data.url;
    const popup = window.open(
      popupUrl,
      'oauth_popup',
      'width=600,height=700,top=100,left=100,resizable=yes,scrollbars=yes,status=yes',
    );

    // Popup was blocked by the browser — fall back to full-page redirect.
    if (!popup || popup.closed) {
      toast.info('Popup was blocked. Redirecting instead…');
      window.location.href = popupUrl;
      return;
    }

    const resetConnecting = () => setConnecting((prev) => ({ ...prev, [providerId]: false }));

    // Backend poll: checks the API every 3s — works regardless of cross-tab messaging.
    let backendPollId: ReturnType<typeof setInterval>;
    // Guard against double-firing when multiple signals deliver the result.
    let oauthCompleted = false;
    let bc: BroadcastChannel | null = null;

    const handleOAuthResult = (data: { type: string; status: string; service: string; message?: string }) => {
      if (oauthCompleted) return;
      oauthCompleted = true;
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleWindowFocus);
      bc?.close();
      clearInterval(backendPollId);
      localStorage.removeItem('synthetic_hr_oauth_result');
      resetConnecting();

      const { status, service, message: errMsg } = data;

      if (status === 'connected') {
        const connectedProvider = providerMap.get(service);
        toast.success(`Connected ${connectedProvider?.name || service}.`);
        void load();
        void loadActionCatalog();

        if (effectiveAgentId && service) {
          void api.agents.updatePublishState(effectiveAgentId, {
            publish_status: 'live',
            primary_pack: activePack,
            integration_ids: Array.from(new Set([...(selectedAgent?.integrationIds || []), service])),
          });
          focusAgentWorkspace(effectiveAgentId);
          onIntegrationConnected?.({
            agentId: effectiveAgentId,
            integrationId: service,
            integrationName: connectedProvider?.name || service,
            packId: activePack,
            status: 'connected',
            lastSyncAt: new Date().toISOString(),
          });
        }
      } else {
        toast.error(errMsg || `Failed to connect ${provider?.name || providerId}.`);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'OAUTH_COMPLETE') return;
      handleOAuthResult(event.data);
    };

    // BroadcastChannel: secondary cross-tab signal (popup flow).
    try {
      bc = new BroadcastChannel('synthetic_hr_oauth');
      bc.onmessage = (event) => {
        if (!event.data || event.data.type !== 'OAUTH_COMPLETE') return;
        handleOAuthResult(event.data);
      };
    } catch { /* BroadcastChannel not supported */ }

    // localStorage storage event: most reliable cross-tab signal — fires on all
    // other tabs when OAuthCallbackPage writes the result, regardless of browser.
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'synthetic_hr_oauth_result' || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue);
        if (data?.type === 'OAUTH_COMPLETE') handleOAuthResult(data);
      } catch { /* malformed value */ }
    };
    window.addEventListener('storage', handleStorage);

    window.addEventListener('message', handleMessage);

    // Backend poll — most reliable fallback. Checks every 3s whether the
    // integration flipped to 'connected' in the DB. Stops after 5 minutes.
    backendPollId = setInterval(async () => {
      try {
        const list = await api.integrations.getAll();
        const found = (list.data as IntegrationRow[])?.find(
          (i) => i.id === providerId && i.status === 'connected',
        );
        if (found) {
          handleOAuthResult({ type: 'OAUTH_COMPLETE', status: 'connected', service: providerId });
        }
      } catch { /* network error — keep polling */ }
    }, 3000);
    setTimeout(() => clearInterval(backendPollId), 5 * 60 * 1000);

    // Use window focus event for abandonment detection instead of popup.closed.
    // OAuth providers (Microsoft, Google) set Cross-Origin-Opener-Policy headers that
    // block popup.closed checks — using it causes console errors every second.
    const handleWindowFocus = () => {
      // User returned to this window. Give the backend poll 3s to confirm success,
      // then if still not completed treat it as a cancellation.
      setTimeout(async () => {
        if (oauthCompleted) return;
        try {
          const list = await api.integrations.getAll();
          const found = (list.data as IntegrationRow[])?.find(
            (i) => i.id === providerId && i.status === 'connected',
          );
          if (found) {
            handleOAuthResult({ type: 'OAUTH_COMPLETE', status: 'connected', service: providerId });
            return;
          }
        } catch { /* ignore */ }
        // Not connected — user likely cancelled.
        window.removeEventListener('focus', handleWindowFocus);
        window.removeEventListener('message', handleMessage);
        window.removeEventListener('storage', handleStorage);
        bc?.close();
        clearInterval(backendPollId);
        resetConnecting();
        toast.info('Connection cancelled.');
      }, 3000);
    };
    window.addEventListener('focus', handleWindowFocus);

  };

  const connectApiKey = async (providerId: string) => {
    const provider = providerMap.get(providerId);
    if (!provider) return;
    ensureCredentialSeed(providerId);
    const creds = credentials[providerId] || {};

    const missing = provider.requiredFields.filter((f) => f.required && !String(creds[f.name] || '').trim());
    if (missing.length > 0) {
      toast.error(`Missing required field: ${missing[0].label}`);
      return;
    }

    setConnecting((prev) => ({ ...prev, [providerId]: true }));
    try {
      const res = await api.integrations.connect(providerId, creds);
      if (!res.success) {
        toast.error(res.error || 'Failed to connect integration');
        return;
      }
      toast.success(`Connected ${provider.name}.`);
      setCredentials((prev) => ({ ...prev, [providerId]: {} }));
      await load();
      if (selectedAgent && onIntegrationConnected) {
        onIntegrationConnected({
          agentId: selectedAgent.id,
          integrationId: providerId,
          integrationName: provider.name,
          packId: guessPackForIntegration(provider),
          status: 'connected',
          lastSyncAt: new Date().toISOString(),
        });
      }
      setWizardStep(5);
    } finally {
      setConnecting((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const configureApiKey = async (providerId: string) => {
    const provider = providerMap.get(providerId);
    if (!provider) return;
    ensureCredentialSeed(providerId);
    const creds = credentials[providerId] || {};

    const missing = provider.requiredFields.filter((f) => f.required && !String(creds[f.name] || '').trim());
    if (missing.length > 0) {
      toast.error(`Missing required field: ${missing[0].label}`);
      return;
    }

    setVaultBusy((prev) => ({ ...prev, [providerId]: 'connecting' }));
    try {
      const res = await api.integrations.configure(providerId, creds);
      if (!res.success) {
        toast.error(res.error || 'Failed to save credentials');
        return;
      }
      toast.success(`Configured ${provider.name}.`);
      setCredentials((prev) => ({ ...prev, [providerId]: {} }));
      await load();
    } finally {
      setVaultBusy((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  const connectApiKeyFromVault = async (providerId: string) => {
    setVaultBusy((prev) => ({ ...prev, [providerId]: 'connecting' }));
    try {
      await connectApiKey(providerId);
    } finally {
      setVaultBusy((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  const connectOAuthFromVault = async (providerId: string) => {
    setVaultBusy((prev) => ({ ...prev, [providerId]: 'connecting' }));
    try {
      await connectOAuth(providerId);
    } finally {
      setVaultBusy((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  const disconnectProvider = async (providerId: string) => {
    const ok = window.confirm('Disconnecting will remove stored credentials for this integration. Continue?');
    if (!ok) return;
    setVaultBusy((prev) => ({ ...prev, [providerId]: 'disconnecting' }));
    try {
      const res = await api.integrations.disconnect(providerId);
      if (!res.success) {
        toast.error(res.error || 'Failed to disconnect');
        return;
      }
      toast.success('Disconnected.');
      await load();
      onIntegrationDisconnected?.();
    } finally {
      setVaultBusy((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  const testProvider = async (providerId: string) => {
    setVaultBusy((prev) => ({ ...prev, [providerId]: 'testing' }));
    try {
      const res = await api.integrations.test(providerId);
      if (!res.success) {
        toast.error(res.error || 'Test failed');
        await load();
        return;
      }
      toast.success('Test successful.');
      await load();
    } finally {
      setVaultBusy((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  const refreshOAuthToken = async (providerId: string) => {
    setVaultBusy((prev) => ({ ...prev, [providerId]: 'testing' }));
    try {
      const res = await api.integrations.refresh(providerId);
      if (!res.success) {
        toast.error(res.error || 'Failed to refresh token');
        return;
      }
      toast.success('Token refreshed.');
      await load();
    } finally {
      setVaultBusy((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  const runSamplePull = async (providerId: string) => {
    setSampleLoading(true);
    setSampleError(null);
    try {
      const res = await api.integrations.samplePull(providerId);
      if (!res.success) {
        setSampleCandidates([]);
        setSampleJds([]);
        setSampleError(res.error || 'Sample pull failed');
        return;
      }
      const data = (res.data || {}) as SamplePullResponse;
      setSampleCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setSampleJds(Array.isArray(data.jds) ? data.jds : []);
      if (Array.isArray(data.candidates) && data.candidates.length > 0) {
        setActiveCandidateId(data.candidates[0].id);
      }
      toast.success('Sample data loaded.');
    } finally {
      setSampleLoading(false);
    }
  };

  useEffect(() => {
    const oauthResult = parseOAuthToastFromQuery();
    if (oauthResult?.status === 'connected' && oauthResult.service && effectiveAgentId) {
      const connectedProvider = providerMap.get(oauthResult.service);
      void api.agents.updatePublishState(effectiveAgentId, {
        publish_status: 'live',
        primary_pack: activePack,
        integration_ids: Array.from(new Set([...(selectedAgent?.integrationIds || []), oauthResult.service])),
      });
      focusAgentWorkspace(effectiveAgentId);
      onIntegrationConnected?.({
        agentId: effectiveAgentId,
        integrationId: oauthResult.service,
        integrationName: connectedProvider?.name || oauthResult.service,
        packId: activePack,
        status: 'connected',
        lastSyncAt: new Date().toISOString(),
      });
    }
    void load();
    void loadActionCatalog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePack, effectiveAgentId, focusAgentWorkspace, onIntegrationConnected, selectedAgent?.integrationIds]);

  useEffect(() => {
    if (selectedAgent) {
      const next = {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        recommendedPackId: recommendedPackId || selectedAgent.primaryPack || null,
      };
      setPersistedContext(next);
      localStorage.setItem(PUBLISH_CONTEXT_STORAGE_KEY, JSON.stringify(next));
      return;
    }

    try {
      const raw = localStorage.getItem(PUBLISH_CONTEXT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { agentId?: string; agentName?: string; recommendedPackId?: IntegrationPackId };
      setPersistedContext(parsed);
    } catch {
      setPersistedContext(null);
    }
  }, [recommendedPackId, selectedAgent]);

  useEffect(() => {
    const preferredPack = recommendedPackId || selectedAgent?.primaryPack || persistedContext?.recommendedPackId;
    if (preferredPack) {
      setActivePack(preferredPack);
    }
  }, [persistedContext?.recommendedPackId, recommendedPackId, selectedAgent?.primaryPack]);

  // Auto-refresh Slack inbox every 30s while open
  useEffect(() => {
    if (!slackInboxOpen) return;
    void loadSlackMessages(slackFilter);
    const id = setInterval(() => void loadSlackMessages(slackFilter), 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slackInboxOpen, slackFilter]);

  const recruitmentProviders = useMemo(() => providersByPack.get('recruitment') || [], [providersByPack]);

  const connectedCandidateSources = useMemo(() => {
    return recruitmentProviders
      .filter((p) => isConnectedLike(p))
      .filter((p) => (p.capabilities?.reads || []).some((r) => String(r).includes('candidate_profiles')))
      .map((p) => p.id);
  }, [isConnectedLike, recruitmentProviders]);

  const defaultSampleProviderId = connectedCandidateSources[0] || null;

  const vaultProviders = useMemo(() => {
    const q = vaultQuery.trim().toLowerCase();
    const base = vaultFocus === 'pack' ? (providersByPack.get(vaultPackId) || []) : items;
    const filtered = base.filter((it) => {
      if (!q) return true;
      const hay = `${it.name} ${it.id} ${it.category} ${it.description}`.toLowerCase();
      return hay.includes(q);
    });
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [vaultQuery, vaultFocus, providersByPack, vaultPackId, items]);

  const actionsByPack = useMemo(() => {
    const map = new Map<IntegrationPackId, typeof actionCatalog>();
    INTEGRATION_PACKS.forEach((p) => map.set(p.id, []));
    actionCatalog.forEach((a) => {
      const packId = (a.pack as IntegrationPackId | null | undefined) || guessPackForIntegration({ id: a.service, name: a.providerName, category: a.providerCategory, tags: [] });
      const list = map.get(packId) || [];
      list.push(a);
      map.set(packId, list);
    });
    Array.from(map.entries()).forEach(([k, list]) => {
      list.sort((left, right) => left.providerName.localeCompare(right.providerName) || left.label.localeCompare(right.label));
      map.set(k, list);
    });
    return map;
  }, [actionCatalog]);

  const activePackActions = useMemo(() => actionsByPack.get(activePack) || [], [actionsByPack, activePack]);

  const enabledActionCountByPack = useMemo(() => {
    const out = new Map<IntegrationPackId, number>();
    INTEGRATION_PACKS.forEach((p) => out.set(p.id, 0));
    actionCatalog.forEach((a) => {
      if (!a.enabled) return;
      const packId = (a.pack as IntegrationPackId | null | undefined) || guessPackForIntegration({ id: a.service, name: a.providerName, category: a.providerCategory, tags: [] });
      out.set(packId, (out.get(packId) || 0) + 1);
    });
    return out;
  }, [actionCatalog]);

  const upsertActionEnabled = async (service: string, action: string, enabled: boolean) => {
    const provider = providerMap.get(service);
    const providerStatus = provider ? effectiveStatus(provider) : 'not_configured';
    const item = actionCatalog.find((a) => a.service === service && a.action === action);
    const risk = item?.risk || 'medium';

    if (providerStatus === 'not_configured') {
      toast.error('Configure this provider first in Credentials Vault.');
      openVault('pack', guessPackForIntegration({ id: service, name: provider?.name || service, category: provider?.category || 'OTHER', tags: provider?.tags || [] }));
      setVaultQuery(provider?.name || service);
      ensureCredentialSeed(service);
      return;
    }
    if (risk === 'money' && providerStatus !== 'connected') {
      toast.error('Money actions require a validated connection. Click “Test & connect” first.');
      return;
    }

    // Optimistic update
    setActionCatalog((prev) => prev.map((a) => (a.service === service && a.action === action ? { ...a, enabled } : a)));
    const res = await api.integrations.upsertActions([{ service, action, enabled }]);
    if (!res.success) {
      toast.error(res.error || 'Failed to update action setting');
      // rollback
      setActionCatalog((prev) => prev.map((a) => (a.service === service && a.action === action ? { ...a, enabled: !enabled } : a)));
      return;
    }
    toast.success(enabled ? 'Action enabled.' : 'Action disabled.');
    void loadActionCatalog();
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-300" />
            <h1 className="text-2xl font-bold text-white">Integration Hub</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            {entryMode === 'publish' && effectiveAgentContext
              ? `Choose where ${effectiveAgentName || 'this agent'} should work. Connect the provider here, then manage the live agent back in Fleet.`
              : 'Connect third-party apps with clear capabilities, safe defaults, and an immediate “see it” moment.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openVault('pack', activePack)}
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm font-semibold inline-flex items-center gap-2"
          >
            <KeyRound className="w-4 h-4" />
            Credentials Vault
          </button>
          <button
            onClick={() => openWizard(entryMode === 'publish' ? 3 : 1)}
            className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
          >
            {entryMode === 'publish' && effectiveAgentContext
              ? `Connect ${effectiveAgentName || 'agent'}`
              : 'Set up a pack'}
          </button>
        </div>
      </div>

      {/* App Store discovery banner */}
      <div className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-4 h-4 text-violet-300" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Looking for more integrations?</div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">
              Browse the App Store to add partner apps — they appear here once connected.
            </div>
          </div>
        </div>
        <button
          onClick={() => onNavigate?.('marketplace')}
          className="shrink-0 px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-400/30 text-violet-200 hover:bg-violet-500/30 transition-colors text-sm font-semibold inline-flex items-center gap-2"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          Browse App Store
        </button>
      </div>

      {entryMode === 'publish' && effectiveAgentContext ? (
        <div className="mt-6 rounded-2xl border border-blue-400/20 bg-blue-500/[0.07] p-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-blue-200/80">Publish flow</div>
              <h2 className="text-lg font-semibold text-white mt-2">{effectiveAgentName || 'Selected agent'} is ready to connect</h2>
              <p className="text-sm text-blue-100/75 mt-1 max-w-3xl">
                Step 1: choose where it should work. Step 2: connect the provider. Step 3: go back to Fleet to supervise conversations, persona, analytics, and controls from one workspace.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => openWizard(3)}
                className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-100 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
              >
                Start guided setup
              </button>
              <button
                onClick={() => onNavigate?.('fleet')}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm font-semibold"
              >
                Back to Fleet
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-rose-100 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <div className="font-semibold">Could not load integrations</div>
            <div className="text-sm text-rose-100/80">{loadError}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {INTEGRATION_PACKS.map((pack) => {
          const stats = packStats.get(pack.id) || { total: 0, configured: 0, connected: 0, needsAttention: 0 };
          const badge = packDisplayBadge(pack.id);
          const Icon = pack.icon as any;
          const isActive = activePack === pack.id;
          const enableTone = stats.configured === 0 ? 'border-amber-400/20 bg-amber-400/10 text-amber-100' : stats.needsAttention > 0 ? 'border-rose-400/20 bg-rose-400/10 text-rose-100' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100';
          const enableLabel = stats.configured === 0 ? 'Disabled until configured' : stats.needsAttention > 0 ? 'Needs attention' : 'Enabled';

          return (
            <div
              key={pack.id}
              className={`rounded-2xl border border-white/10 p-5 transition-colors ${isActive ? 'bg-white/[0.04]' : 'bg-white/[0.02] hover:bg-white/[0.03]'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${pack.id === 'recruitment' ? 'text-emerald-300' : 'text-slate-300'}`} />
                  <div className="font-semibold text-white">{pack.name}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
              </div>
              <p className="text-sm text-slate-400 mt-2">{pack.description}</p>
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-1">
                  <BadgeCheck className="w-3.5 h-3.5 text-slate-300" />
                  Capability-first
                </span>
                <span className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-blue-300" />
                  Approval-first
                </span>
                <span className={`text-xs px-2 py-1 rounded-lg border ${enableTone} inline-flex items-center gap-1`}>
                  {stats.needsAttention > 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
                  {enableLabel}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                  {stats.configured}/{stats.total} configured
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                    {(enabledActionCountByPack.get(pack.id) || 0)} actions enabled
                  </span>
                  <button
                    onClick={() => {
                      setActivePack(pack.id);
                      openVault('pack', pack.id);
                    }}
                    className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                  >
                    Configure
                  </button>
                  <button
                    onClick={() => setActivePack(pack.id)}
                    className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
                      isActive ? 'border-blue-400/30 bg-blue-500/15 text-blue-200' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    View
                  </button>
                </div>
              </div>
              {stats.configured === 0 && (
                <button
                  onClick={() => onNavigate?.('marketplace')}
                  className="mt-3 w-full py-2 rounded-xl border border-dashed border-violet-400/25 bg-violet-500/[0.05] text-violet-300 hover:bg-violet-500/10 transition-colors text-xs font-medium inline-flex items-center justify-center gap-1.5"
                >
                  <ShoppingBag className="w-3 h-3" />
                  Add apps from App Store
                </button>
              )}
            </div>
          );
          })}
      </div>

      {/* Domain Agents for this pack */}
      {(() => {
        const agents = PACK_DOMAIN_AGENTS[activePack] || [];
        if (agents.length === 0) return null;
        return (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-300" />
                  <h2 className="text-lg font-semibold text-white">
                    Domain Agents • {INTEGRATION_PACKS.find((p) => p.id === activePack)?.name || 'Pack'}
                  </h2>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Pre-built agents optimised for this pack. Connect one to start automating across your integrations.
                </p>
              </div>
              <button
                onClick={() => onNavigate?.('agent-library')}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm font-semibold shrink-0"
              >
                Browse all agents
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-2xl border border-blue-400/15 bg-blue-500/[0.04] p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg border border-blue-400/20 bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-blue-300" />
                      </div>
                      <div className="font-semibold text-white">{agent.name}</div>
                    </div>
                    <button
                      onClick={() => onActivateDomainAgent
                        ? onActivateDomainAgent(activePack as any, agent.id)
                        : onNavigate?.('agent-library')}
                      className="px-3 py-1.5 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-xs font-semibold shrink-0"
                    >
                      Deploy
                    </button>
                  </div>
                  <p className="text-sm text-slate-400">{agent.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.sampleActions.map((action) => (
                      <span
                        key={action}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-300"
                      >
                        <Zap className="w-3 h-3 text-amber-300/70" />
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Providers • {INTEGRATION_PACKS.find((p) => p.id === activePack)?.name || 'Pack'}</h2>
            <p className="text-sm text-slate-400 mt-1">
              {entryMode === 'publish' && effectiveAgentContext
                ? `Recommended providers for ${effectiveAgentName || 'this agent'}. The main user flow stays code-free.`
                : 'Visible to everyone. Disabled until credentials are configured.'}
            </p>
          </div>
          {loading ? (
            <div className="text-sm text-slate-400 inline-flex items-center gap-2">
              <Clock className="w-4 h-4 animate-pulse" />
              Loading…
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <input
            value={providerSearch}
            onChange={(e) => setProviderSearch(e.target.value)}
            placeholder="Search integrations…"
            className="w-full max-w-xs px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
          />
          {providerSearch ? (
            <button
              onClick={() => setProviderSearch('')}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          ) : null}
          {filteredPackProviders.length !== activePackProviders.length ? (
            <span className="text-xs text-slate-500">{filteredPackProviders.length} of {activePackProviders.length}</span>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          {filteredPackProviders.map((provider) => {
            const Icon = providerIcon(provider.id);
            const caps = provider.capabilities || { reads: [], writes: [] };
            const readBadges = (caps.reads || []).slice(0, 2);
            const writeBadges = (caps.writes || []).slice(0, 2);
            const status = effectiveStatus(provider);

            return (
              <div key={provider.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-slate-200" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-white truncate">{provider.name}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${statusToneClasses[statusTone(status)]}`}>
                          {formatStatusLabel(status)}
                        </span>
                      </div>
                      <div className="text-sm text-slate-400 mt-1 line-clamp-2">{provider.description}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {readBadges.map((readId) => {
                          const meta = readLabel(readId);
                          const ReadIcon = meta.icon;
                          return (
                            <span
                              key={readId}
                              className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-1"
                            >
                              <ReadIcon className="w-3.5 h-3.5 text-slate-300" />
                              {meta.label}
                            </span>
                          );
                        })}
                        {writeBadges.map((w) => {
                          const risk = riskBadge(w.risk);
                          return (
                            <span
                              key={w.id}
                              className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-2"
                            >
                              <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                              {w.label}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${risk.cls}`}>{risk.label}</span>
                            </span>
                          );
                        })}
                        {(readBadges.length === 0 && writeBadges.length === 0) ? (
                          <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                            <Info className="w-3.5 h-3.5" />
                            Capabilities coming soon
                          </span>
                        ) : null}
                      </div>
                      {status === 'connected' ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-300/80 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] px-2.5 py-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Connected — agents can now use this integration
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {status === 'connected' ? (
                      <>
                        {(caps.reads || []).some((r) => String(r).includes('candidate_profiles')) ? (
                          <button
                            onClick={() => runSamplePull(provider.id)}
                            className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/20 transition-colors text-sm font-semibold"
                            disabled={sampleLoading}
                          >
                            {sampleLoading ? 'Loading…' : 'Sample pull'}
                          </button>
                        ) : null}
                        <button
                          onClick={() => openDetails(provider.id)}
                          className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                        >
                          Manage
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => openDetails(provider.id)}
                          className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => openConnectModal(provider.id)}
                          className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                        >
                          Connect
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Coming Soon integrations */}
        {(comingSoonByPack.get(activePack) || []).length > 0 ? (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-slate-400">Coming Soon</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-slate-600/50 bg-slate-700/30 text-slate-500">
                {(comingSoonByPack.get(activePack) || []).length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {(comingSoonByPack.get(activePack) || []).map((provider) => {
                const Icon = providerIcon(provider.id);
                return (
                  <div key={provider.id} className="rounded-2xl border border-white/5 bg-white/[0.015] p-4 opacity-60">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl border border-white/5 bg-white/[0.03] flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-slate-400 truncate">{provider.name}</div>
                            <span className="text-xs px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-700/20 text-slate-500">
                              Coming Soon
                            </span>
                          </div>
                          <div className="text-sm text-slate-600 mt-1 line-clamp-2">{provider.description}</div>
                        </div>
                      </div>
                      <button
                        disabled
                        className="px-3 py-2 rounded-xl border border-white/5 bg-white/[0.02] text-slate-600 text-sm cursor-not-allowed shrink-0"
                      >
                        Connect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Action Catalog • {INTEGRATION_PACKS.find((p) => p.id === activePack)?.name || 'Pack'}</h2>
            <p className="text-sm text-slate-400 mt-1">Enable the exact actions you want users/agents to run. Writes are approval-first.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadActionCatalog()}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
              disabled={actionCatalogLoading}
            >
              {actionCatalogLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {actionCatalogError ? (
          <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-rose-100">
            <div className="font-semibold">Could not load Action Catalog</div>
            <div className="text-sm text-rose-100/80 mt-1">{actionCatalogError}</div>
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 text-sm text-slate-300 flex items-center justify-between">
            <span>{activePackActions.length} actions</span>
            <span className="text-xs text-slate-500">Toggle enablement</span>
          </div>
          {activePackActions.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">
              No write actions registered for this pack yet. Add `capabilities.writes` in the integration registry to populate this list.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {activePackActions.map((a) => {
                const provider = providerMap.get(a.service);
                const providerStatus = provider ? effectiveStatus(provider) : 'not_configured';
                const canToggle = providerStatus !== 'not_configured' && !(a.risk === 'money' && providerStatus !== 'connected');
                const risk = riskBadge(a.risk);
                const tone = readinessBadge(a.enabled ? 'ok' : 'todo');
                const disabledReason =
                  providerStatus === 'not_configured'
                    ? 'Configure provider first'
                    : a.risk === 'money' && providerStatus !== 'connected'
                      ? 'Requires validated connection'
                      : null;

                return (
                  <div key={`${a.service}:${a.action}`} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-white truncate">{a.label}</div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md border ${risk.cls}`}>{risk.label}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-md border border-blue-400/20 bg-blue-400/10 text-blue-100">
                          Approval required
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md border ${tone.cls}`}>{a.enabled ? 'Enabled' : 'Disabled'}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 truncate">
                        {a.providerName} • {a.service}:{a.action} • Provider status: {formatStatusLabel(providerStatus)}
                      </div>
                      {disabledReason ? <div className="text-xs text-amber-200 mt-1">{disabledReason}</div> : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => void openDetails(a.service)}
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                      >
                        Provider
                      </button>
                      <button
                        onClick={() => void upsertActionEnabled(a.service, a.action, !a.enabled)}
                        className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                          a.enabled
                            ? 'border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15'
                            : 'border-emerald-400/25 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20'
                        }`}
                        disabled={!canToggle}
                        title={!canToggle ? disabledReason || 'Not available' : undefined}
                      >
                        {a.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Recruitment browser (preview)</h2>
            <p className="text-sm text-slate-400 mt-1">A fast “see it” view. V1 uses sample pulls; real sync comes next.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (defaultSampleProviderId) {
                  void runSamplePull(defaultSampleProviderId);
                } else {
                  openWizard(3);
                }
              }}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
            >
              {defaultSampleProviderId ? 'Refresh preview' : 'Connect & preview'}
            </button>
          </div>
        </div>

        {sampleError ? (
          <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-rose-100">
            <div className="font-semibold">Preview unavailable</div>
            <div className="text-sm text-rose-100/80 mt-1">{sampleError}</div>
          </div>
        ) : null}

        {sampleCandidates.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-blue-300 mt-0.5" />
              <div>
                <div className="font-semibold text-white">No preview data yet</div>
                <div className="text-sm text-slate-400 mt-1">
                  Connect Naukri or LinkedIn, then run a sample pull to instantly see candidate cards inside SyntheticHR.
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => openWizard(1)}
                    className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                  >
                    Start setup
                  </button>
                  <button
                    onClick={() => openWizard(3)}
                    className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                  >
                    Connect providers
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 text-sm text-slate-300 flex items-center justify-between">
                <span>{sampleCandidates.length} candidates</span>
                <span className="text-xs text-slate-500">Preview data</span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-white/10">
                    <tr className="text-left text-slate-400">
                      <th className="px-4 py-2 font-medium">Candidate</th>
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium">Experience</th>
                      <th className="px-4 py-2 font-medium">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleCandidates.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-b border-white/5 hover:bg-white/5 cursor-pointer ${activeCandidateId === c.id ? 'bg-white/5' : ''}`}
                        onClick={() => setActiveCandidateId(c.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">{c.full_name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{c.headline}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{c.source}</td>
                        <td className="px-4 py-3 text-slate-300">{c.experience_years} yrs</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                            {c.match_score}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              {activeCandidate ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-white">{activeCandidate.full_name}</div>
                      <div className="text-sm text-slate-400 mt-1">{activeCandidate.headline}</div>
                      <div className="text-xs text-slate-500 mt-1">{activeCandidate.location}</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-100">
                      {activeCandidate.match_score}%
                    </span>
                  </div>

                  <div className="mt-4 text-sm text-slate-300">{activeCandidate.summary}</div>

                  <div className="mt-4">
                    <div className="text-xs text-slate-400 font-semibold">Skills</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {activeCandidate.skills.map((s) => (
                        <span key={s} className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2 text-sm text-white font-semibold">
                      <FileText className="w-4 h-4 text-blue-300" />
                      Suggested JDs (stub)
                    </div>
                    <div className="mt-2 space-y-2">
                      {(sampleJds || []).slice(0, 3).map((jd, idx) => (
                        <div key={jd.id} className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm text-slate-100 truncate">{jd.title}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {jd.location} • {jd.seniority}
                            </div>
                          </div>
                          <span className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200">
                            {Math.max(55, activeCandidate.match_score - idx * 6)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2 text-sm text-white font-semibold">
                      <Shield className="w-4 h-4 text-emerald-300" />
                      Actions (approval-first)
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      In V1, outreach/shortlist actions are shown as a preview. Execution will route through Jobs &amp; Approvals.
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => toast.info('Action preview: Shortlist request (coming next).')}
                        className="flex-1 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                      >
                        Request shortlist
                      </button>
                      <button
                        onClick={() => toast.info('Action preview: Outreach draft (coming next).')}
                        className="flex-1 px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                      >
                        Draft outreach
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-slate-500 inline-flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" />
                    Updated {formatTime(activeCandidate.last_updated_at)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-400">Select a candidate to view details.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {detailsOpen && selectedIntegration ? (
        <Drawer title={`${selectedIntegration.name} • Details`} onClose={closeDetails}>
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-white">Status</div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${statusToneClasses[statusTone(effectiveStatus(selectedIntegration))]}`}>
                  {formatStatusLabel(effectiveStatus(selectedIntegration))}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Last sync</div>
                  <div className="text-slate-200">{formatTime(selectedIntegration.lastSyncAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Last error</div>
                  <div className="text-slate-200">{formatTime(selectedIntegration.lastErrorAt)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-slate-500">Error message</div>
                  <div className="text-slate-200">{selectedIntegration.lastErrorMsg || '—'}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {effectiveStatus(selectedIntegration) === 'connected' || effectiveStatus(selectedIntegration) === 'error' ? (
                  <>
                    {selectedIntegration.authType === 'oauth2' ? (
                      <button
                        onClick={() => { closeDetails(); void connectOAuth(selectedIntegration.id); }}
                        className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                      >
                        Reconnect
                      </button>
                    ) : null}
                    <button
                      onClick={() => { closeDetails(); void disconnectProvider(selectedIntegration.id); }}
                      className="px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15 transition-colors text-sm"
                    >
                      Disconnect
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {selectedIntegration.readiness ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white">Readiness checklist</div>
                  {selectedIntegration.readiness.expectedRedirectUrl ? (
                    <button
                      onClick={() => {
                        const value = selectedIntegration.readiness?.expectedRedirectUrl;
                        if (!value) return;
                        void navigator.clipboard?.writeText(value);
                        toast.success('Redirect URL copied.');
                      }}
                      className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors"
                    >
                      Copy redirect URL
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  {(selectedIntegration.readiness.items || []).map((it) => {
                    const badge = readinessBadge(it.status);
                    return (
                      <div key={it.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm text-slate-100">{it.label}</div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-md border ${badge.cls}`}>{badge.label}</span>
                        </div>
                        {it.detail ? <div className="text-xs text-slate-400 mt-1 break-words">{it.detail}</div> : null}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => {
                      closeDetails();
                      openVault('pack', guessPackForIntegration(selectedIntegration));
                      setVaultQuery(selectedIntegration.name);
                      ensureCredentialSeed(selectedIntegration.id);
                    }}
                    className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                  >
                    Open vault
                  </button>
                  {effectiveStatus(selectedIntegration) !== 'connected' ? (
                    selectedIntegration.authType === 'oauth2' && !selectedIntegration.connectionId ? (
                      <button
                        onClick={() => { closeDetails(); void connectOAuth(selectedIntegration.id); }}
                        className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/20 transition-colors text-sm font-semibold"
                      >
                        Connect via OAuth
                      </button>
                    ) : (
                      <button
                        onClick={() => void testProvider(selectedIntegration.id)}
                        className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/20 transition-colors text-sm font-semibold"
                      >
                        Test & connect
                      </button>
                    )
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="font-semibold text-white">Capabilities</div>
              <div className="mt-3">
                <div className="text-xs text-slate-500 font-semibold">Reads</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(selectedIntegration.capabilities?.reads || []).length === 0 ? (
                    <span className="text-xs text-slate-500">—</span>
                  ) : (
                    (selectedIntegration.capabilities?.reads || []).map((r) => {
                      const meta = readLabel(r);
                      const ReadIcon = meta.icon;
                      return (
                        <span key={r} className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-1">
                          <ReadIcon className="w-3.5 h-3.5 text-slate-300" />
                          {meta.label}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs text-slate-500 font-semibold">Writes</div>
                <div className="mt-2 space-y-2">
                  {(selectedIntegration.capabilities?.writes || []).length === 0 ? (
                    <div className="text-xs text-slate-500">—</div>
                  ) : (
                    (selectedIntegration.capabilities?.writes || []).map((w) => {
                      const risk = riskBadge(w.risk);
                      return (
                        <div key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                          <div className="text-sm text-slate-100 flex items-center gap-2">
                            <ArrowRight className="w-4 h-4 text-slate-300" />
                            {w.label}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-md border ${risk.cls}`}>{risk.label}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md border border-blue-400/20 bg-blue-400/10 text-blue-100">
                              Approval required
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {selectedIntegration.authType === 'oauth2' && selectedIntegration.oauth && selectedIntegration.oauth.ready === false ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">
                <div className="font-semibold">OAuth not ready</div>
                <div className="text-sm text-amber-100/80 mt-1">
                  Missing backend env vars: {(selectedIntegration.oauth.missingEnv || []).join(', ')}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-white">Connection logs</div>
                <button
                  onClick={() => void loadLogs(selectedIntegration.id)}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors"
                  disabled={logsLoading}
                >
                  {logsLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              {logsError ? <div className="mt-2 text-sm text-rose-200">{logsError}</div> : null}
              <div className="mt-3 space-y-2">
                {logs.length === 0 ? (
                  <div className="text-sm text-slate-500">No logs yet.</div>
                ) : (
                  logs.slice(0, 10).map((log) => (
                    <div key={log.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm text-slate-200">
                          <span className="font-semibold">{log.action}</span>{' '}
                          <span className="text-slate-500">• {log.status}</span>
                        </div>
                        <div className="text-xs text-slate-500">{formatTime(log.created_at)}</div>
                      </div>
                      {log.metadata?.actor_email ? (
                        <div className="text-xs text-slate-500 mt-1">By: {String(log.metadata.actor_email)}</div>
                      ) : null}
                      {log.message ? <div className="text-xs text-slate-400 mt-1">{log.message}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Drawer>
      ) : null}

      {connectModalProviderId ? (() => {
        const provider = providerMap.get(connectModalProviderId);
        if (!provider) return null;
        const isBusy = Boolean(connecting[connectModalProviderId]);
        const oauthReady = provider.authType !== 'oauth2' ? true : (provider.oauth?.ready !== false);
        const Icon = providerIcon(provider.id);

        return (
          <Modal title={`Connect ${provider.name}`} onClose={closeConnectModal} widthClass="max-w-lg">
            <div className="space-y-5">
              {/* Provider header */}
              <div className="flex items-center gap-4 p-4 rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="w-12 h-12 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
                  <Icon className="w-6 h-6 text-slate-200" />
                </div>
                <div>
                  <div className="font-semibold text-white">{provider.name}</div>
                  <div className="text-sm text-slate-400 mt-0.5 line-clamp-2">{provider.description}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {provider.authType === 'oauth2' ? 'OAuth 2.0' : provider.authType === 'api_key' ? 'API Key' : provider.authType} · {provider.category}
                  </div>
                </div>
              </div>

              {/* OAuth not ready warning */}
              {provider.authType === 'oauth2' && !oauthReady ? (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">
                  <div className="font-semibold">OAuth not configured on server</div>
                  <div className="text-sm text-amber-100/80 mt-1">
                    Missing env: {(provider.oauth?.missingEnv || []).join(', ')}
                  </div>
                </div>
              ) : null}

              {/* OAuth flow */}
              {provider.authType === 'oauth2' ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-300">
                    You'll be redirected to {provider.name} to authorize access. Once done you'll return here automatically.
                  </p>
                  {(provider.readiness?.items || []).length > 0 ? (
                    <div className="space-y-2">
                      {(provider.readiness!.items).map((it) => {
                        const badge = readinessBadge(it.status);
                        return (
                          <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                            <div className="text-sm text-slate-200">{it.label}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-md border ${badge.cls}`}>{badge.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <button
                    onClick={() => void connectOAuth(provider.id)}
                    disabled={isBusy || !oauthReady}
                    className="w-full px-4 py-3 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors font-semibold disabled:opacity-50"
                  >
                    {isBusy ? 'Redirecting…' : `Continue to ${provider.name}`}
                  </button>
                </div>
              ) : (
                /* API key / client_credentials flow */
                <div className="space-y-4">
                  <p className="text-sm text-slate-400">
                    Enter your {provider.name} credentials. They'll be encrypted and stored securely.
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    {provider.requiredFields.map((field) => (
                      <label key={field.name} className="block">
                        <div className="text-xs text-slate-400 font-semibold mb-1">
                          {field.label}{field.required ? ' *' : ''}
                        </div>
                        <input
                          type={field.type === 'password' ? 'password' : 'text'}
                          value={(credentials[provider.id]?.[field.name] || '') as string}
                          onChange={(e) =>
                            setCredentials((prev) => ({
                              ...prev,
                              [provider.id]: { ...(prev[provider.id] || {}), [field.name]: e.target.value },
                            }))
                          }
                          placeholder={field.placeholder || ''}
                          className="w-full px-3 py-2.5 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                        {field.description ? (
                          <div className="text-xs text-slate-500 mt-1">{field.description}</div>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={closeConnectModal}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void connectFromModal(provider.id)}
                      disabled={isBusy}
                      className="flex-[2] px-4 py-2.5 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold disabled:opacity-50"
                    >
                      {isBusy ? 'Connecting…' : 'Connect'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Modal>
        );
      })() : null}

      {wizardOpen ? (
        <Modal title="Recruitment pack setup" onClose={closeWizard} widthClass="max-w-4xl">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-slate-400">
              Step <span className="text-slate-200 font-semibold">{wizardStep}</span> / 5
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWizardStep((s) => (s > 1 ? ((s - 1) as any) : s))}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                disabled={wizardStep === 1}
              >
                Back
              </button>
              <button
                onClick={() => setWizardStep((s) => (s < 5 ? ((s + 1) as any) : s))}
                className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                disabled={wizardStep === 4 && !governanceConfirmed}
              >
                Next
              </button>
            </div>
          </div>

          {wizardStep === 1 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-white">Choose pack</div>
                  <div className="text-sm text-slate-400 mt-1">V1 ships Recruitment end-to-end. Payments and ERP come next.</div>
                </div>
                <span className="text-xs px-2 py-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-100 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Enabled
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <div className="font-semibold text-white">Recruitment</div>
                  <div className="text-sm text-emerald-100/80 mt-1">Sources + outreach</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 opacity-60">
                  <div className="font-semibold text-white">Payments</div>
                  <div className="text-sm text-slate-400 mt-1">Coming soon</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 opacity-60">
                  <div className="font-semibold text-white">Finance / ERP</div>
                  <div className="text-sm text-slate-400 mt-1">Coming soon</div>
                </div>
              </div>
            </div>
          ) : null}

          {wizardStep === 2 ? (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="font-semibold text-white">Candidate sources</div>
                <div className="text-sm text-slate-400 mt-1">Pick where candidate data will come from.</div>
                <div className="mt-4 space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={selectedNaukri} onChange={(e) => setSelectedNaukri(e.target.checked)} />
                    <div>
                      <div className="text-sm font-semibold text-white">Naukri</div>
                      <div className="text-xs text-slate-500">API key based</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={selectedLinkedIn} onChange={(e) => setSelectedLinkedIn(e.target.checked)} />
                    <div>
                      <div className="text-sm font-semibold text-white">LinkedIn</div>
                      <div className="text-xs text-slate-500">OAuth (official scopes only)</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="font-semibold text-white">Outreach tool</div>
                <div className="text-sm text-slate-400 mt-1">Pick one tool for email/calendar outreach in V1.</div>
                <div className="mt-4 space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="radio" className="mt-1" checked={outreachChoice === 'google_workspace'} onChange={() => setOutreachChoice('google_workspace')} />
                    <div>
                      <div className="text-sm font-semibold text-white">Google Workspace</div>
                      <div className="text-xs text-slate-500">OAuth (Gmail + Calendar)</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="radio" className="mt-1" checked={outreachChoice === 'microsoft_365'} onChange={() => setOutreachChoice('microsoft_365')} />
                    <div>
                      <div className="text-sm font-semibold text-white">Microsoft 365</div>
                      <div className="text-xs text-slate-500">OAuth (Graph)</div>
                    </div>
                  </label>
                </div>
                <div className="mt-4 text-xs text-slate-500 inline-flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  Writes will require approvals by default.
                </div>
              </div>
            </div>
          ) : null}

          {wizardStep === 3 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-white">Connect providers</div>
                  <div className="text-sm text-slate-400 mt-1">Connect each selected provider. You can come back anytime.</div>
                </div>
                <button
                  onClick={() => void load()}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors"
                >
                  Refresh status
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {selectedProviders.map((providerId) => {
                  const provider = providerMap.get(providerId);
                  if (!provider) return null;
                  const isBusy = Boolean(connecting[providerId]);
                  const isConnected = effectiveStatus(provider) === 'connected';
                  const oauthReady = provider.authType !== 'oauth2' ? true : (provider.oauth?.ready !== false);
                  return (
                    <div key={providerId} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-white">{provider.name}</div>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusToneClasses[statusTone(effectiveStatus(provider))]}`}>
                              {formatStatusLabel(effectiveStatus(provider))}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {provider.authType === 'oauth2' ? 'OAuth' : provider.authType === 'api_key' ? 'API key' : provider.authType}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openDetails(provider.id)}
                            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                          >
                            Details
                          </button>
                          {isConnected ? (
                            <span className="text-xs px-2 py-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-100 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Connected
                            </span>
                          ) : provider.authType === 'oauth2' ? (
                            <button
                              onClick={() => void connectOAuth(provider.id)}
                              className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                              disabled={isBusy || !oauthReady}
                              title={!oauthReady ? `Missing env: ${(provider.oauth?.missingEnv || []).join(', ')}` : undefined}
                            >
                              {!oauthReady ? 'OAuth not ready' : isBusy ? 'Starting…' : 'Connect OAuth'}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                ensureCredentialSeed(provider.id);
                                void connectApiKey(provider.id);
                              }}
                              className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                              disabled={isBusy}
                            >
                              {isBusy ? 'Connecting…' : 'Connect'}
                            </button>
                          )}
                        </div>
                      </div>

                      {provider.authType === 'api_key' && provider.requiredFields.length > 0 && effectiveStatus(provider) !== 'connected' ? (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          {provider.requiredFields.map((field) => (
                            <label key={field.name} className="block">
                              <div className="text-xs text-slate-400 font-semibold">{field.label}</div>
                              <input
                                type={field.type === 'password' ? 'password' : 'text'}
                                value={(credentials[provider.id]?.[field.name] || '') as string}
                                onChange={(e) =>
                                  setCredentials((prev) => ({
                                    ...prev,
                                    [provider.id]: { ...(prev[provider.id] || {}), [field.name]: e.target.value },
                                  }))
                                }
                                placeholder={field.placeholder || ''}
                                className="mt-1 w-full px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                              />
                              {field.description ? <div className="text-xs text-slate-500 mt-1">{field.description}</div> : null}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {selectedProviders.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">Select providers in Step 2.</div>
              ) : null}
            </div>
          ) : null}

          {wizardStep === 4 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="font-semibold text-white">Governance defaults</div>
              <div className="text-sm text-slate-400 mt-1">
                V1 defaults to being strict: reads are role-gated, and writes require approvals. You can tune these later in the sidebar’s “Action Policies”.
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Users className="w-4 h-4 text-slate-200" />
                    Who can connect
                  </div>
                  <div className="text-sm text-slate-400 mt-2">Users with `connectors.manage` permission.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <FileText className="w-4 h-4 text-slate-200" />
                    Who can read
                  </div>
                  <div className="text-sm text-slate-400 mt-2">Users with `connectors.read` permission.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Shield className="w-4 h-4 text-emerald-300" />
                    Writes
                  </div>
                  <div className="text-sm text-slate-400 mt-2">Approval required by default (safe).</div>
                </div>
              </div>

              <label className="mt-5 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={governanceConfirmed}
                  onChange={(e) => setGovernanceConfirmed(e.target.checked)}
                />
                <div>
                  <div className="text-sm text-white font-semibold">Confirm safe defaults</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    I understand that writes are approval-first and that this pack is a preview of the full governed workflow.
                  </div>
                </div>
              </label>
            </div>
          ) : null}

          {wizardStep === 5 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="font-semibold text-white">
                {entryMode === 'publish' && effectiveAgentContext ? 'Connection complete' : 'Test + Sample pull'}
              </div>
              <div className="text-sm text-slate-400 mt-1">
                {entryMode === 'publish' && effectiveAgentContext
                  ? `${effectiveAgentName || 'This agent'} can now be operated from Fleet. You can still validate the connection here.`
                  : 'Instantly see candidate cards inside SyntheticHR (no full sync required yet).'}
              </div>

              {entryMode === 'publish' && effectiveAgentContext ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      focusAgentWorkspace(effectiveAgentId);
                      onNavigate?.('fleet');
                    }}
                    className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                  >
                    Open agent workspace
                  </button>
                  <button
                    onClick={() => closeWizard()}
                    className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                  >
                    Stay in Integrations
                  </button>
                </div>
              ) : null}

              {defaultSampleProviderId ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="min-w-0">
                    <div className="text-sm text-white font-semibold">Preview source</div>
                    <div className="text-sm text-slate-400 mt-1 truncate">
                      {providerMap.get(defaultSampleProviderId)?.name || defaultSampleProviderId}
                    </div>
                  </div>
                  <button
                    onClick={() => void runSamplePull(defaultSampleProviderId)}
                    className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/20 transition-colors text-sm font-semibold"
                    disabled={sampleLoading}
                  >
                    {sampleLoading ? 'Loading…' : 'Run sample pull'}
                  </button>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100 flex items-start gap-3">
                  <Info className="w-5 h-5 mt-0.5" />
                  <div>
                    <div className="font-semibold">No connected candidate source yet</div>
                    <div className="text-sm text-amber-100/80 mt-1">Connect Naukri or LinkedIn in Step 3, then come back here.</div>
                  </div>
                </div>
              )}

              {sampleError ? <div className="mt-3 text-sm text-rose-200">{sampleError}</div> : null}
              {sampleCandidates.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="text-sm text-white font-semibold">Preview loaded</div>
                  <div className="text-sm text-slate-400 mt-1">
                    {sampleCandidates.length} candidates are now visible in the Recruitment browser on this page.
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => {
                        closeWizard();
                        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                      }}
                      className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                    >
                      View candidates
                    </button>
                    <button
                      onClick={() => toast.info('Next: wire preview actions into Jobs & Approvals execution.')}
                      className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                    >
                      Next steps
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}

      {vaultOpen ? (
        <Modal title="Credentials Vault" onClose={closeVault} widthClass="max-w-5xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Bulk import (API keys)</div>
                <div className="text-sm text-slate-400 mt-1">
                  Paste JSON keyed by provider id. OAuth providers are skipped.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (!bulkJson.trim()) return toast.error('Paste JSON first.');
                    let parsed: any = null;
                    try {
                      parsed = JSON.parse(bulkJson);
                    } catch {
                      return toast.error('Invalid JSON.');
                    }
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return toast.error('JSON must be an object keyed by provider id.');

                    setBulkBusy('save');
                    let ok = 0;
                    let failed = 0;
                    let skipped = 0;
                    for (const [serviceId, creds] of Object.entries(parsed)) {
                      const provider = providerMap.get(serviceId);
                      if (!provider || provider.authType === 'oauth2') {
                        skipped += 1;
                        continue;
                      }
                      if (!creds || typeof creds !== 'object' || Array.isArray(creds)) {
                        skipped += 1;
                        continue;
                      }
                      const res = await api.integrations.configure(serviceId, creds as Record<string, string>);
                      if (!res.success) failed += 1;
                      else ok += 1;
                    }
                    setBulkBusy(null);
                    await load();
                    toast.success(`Bulk import: ${ok} saved, ${failed} failed, ${skipped} skipped.`);
                  }}
                  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                  disabled={bulkBusy !== null}
                >
                  {bulkBusy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={async () => {
                    if (!bulkJson.trim()) return toast.error('Paste JSON first.');
                    let parsed: any = null;
                    try {
                      parsed = JSON.parse(bulkJson);
                    } catch {
                      return toast.error('Invalid JSON.');
                    }
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return toast.error('JSON must be an object keyed by provider id.');

                    setBulkBusy('save_test');
                    let ok = 0;
                    let failed = 0;
                    let skipped = 0;
                    for (const [serviceId, creds] of Object.entries(parsed)) {
                      const provider = providerMap.get(serviceId);
                      if (!provider || provider.authType === 'oauth2') {
                        skipped += 1;
                        continue;
                      }
                      if (!creds || typeof creds !== 'object' || Array.isArray(creds)) {
                        skipped += 1;
                        continue;
                      }
                      const saved = await api.integrations.configure(serviceId, creds as Record<string, string>);
                      if (!saved.success) {
                        failed += 1;
                        continue;
                      }
                      const tested = await api.integrations.test(serviceId);
                      if (!tested.success) failed += 1;
                      else ok += 1;
                    }
                    setBulkBusy(null);
                    await load();
                    toast.success(`Bulk save+test: ${ok} connected, ${failed} failed, ${skipped} skipped.`);
                  }}
                  className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/20 transition-colors text-sm font-semibold"
                  disabled={bulkBusy !== null}
                  title="Saves credentials then runs Test & connect"
                >
                  {bulkBusy === 'save_test' ? 'Working…' : 'Save + Test'}
                </button>
              </div>
            </div>
            <textarea
              value={bulkJson}
              onChange={(e) => setBulkJson(e.target.value)}
              placeholder='{"stripe":{"secret_key":"sk_..."}, "zendesk":{"subdomain":"acme","email":"agent@acme.com","api_token":"..."}}'
              className="mt-3 w-full min-h-[96px] px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-400">
              Visible to everyone. Only users with permissions can actually connect/disconnect.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setVaultFocus('pack');
                  setVaultPackId(activePack);
                }}
                className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
                  vaultFocus === 'pack'
                    ? 'border-blue-400/30 bg-blue-500/15 text-blue-200'
                    : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                }`}
              >
                This pack
              </button>
              <button
                onClick={() => setVaultFocus('all')}
                className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
                  vaultFocus === 'all'
                    ? 'border-blue-400/30 bg-blue-500/15 text-blue-200'
                    : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                }`}
              >
                All providers
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <input
              value={vaultQuery}
              onChange={(e) => setVaultQuery(e.target.value)}
              placeholder="Search providers…"
              className="w-full px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              onClick={() => void load()}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
            >
              Refresh
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 max-h-[60vh] overflow-auto pr-1">
            {vaultProviders.map((provider) => {
              const busy = vaultBusy[provider.id] || null;
              const status = effectiveStatus(provider);
              const isConnected = status === 'connected';
              const isConfigured = status === 'configured';
              const isError = status === 'error' || status === 'expired';
              const caps = provider.capabilities || { reads: [], writes: [] };

              return (
                <div key={provider.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-white">{provider.name}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${statusToneClasses[statusTone(status)]}`}>
                          {formatStatusLabel(status)}
                        </span>
                        {provider.tokenExpired ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md border border-rose-400/20 bg-rose-400/10 text-rose-100">
                            Token expired
                          </span>
                        ) : provider.tokenExpiresSoon ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-100">
                            Token expiring soon
                          </span>
                        ) : null}
                        {isError && provider.lastErrorMsg ? (
                          <span className="text-xs text-rose-200 truncate max-w-[420px]">• {provider.lastErrorMsg}</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{provider.category} • {provider.id}</div>
                      {provider.authType === 'oauth2' && provider.tokenExpiresAt ? (
                        <div className="text-xs text-slate-500 mt-1">Access token expiry: {formatTime(provider.tokenExpiresAt)}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(caps.reads || []).slice(0, 3).map((r) => {
                          const meta = readLabel(r);
                          const ReadIcon = meta.icon;
                          return (
                            <span key={r} className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-1">
                              <ReadIcon className="w-3.5 h-3.5 text-slate-300" />
                              {meta.label}
                            </span>
                          );
                        })}
                        {(caps.writes || []).slice(0, 2).map((w) => {
                          const risk = riskBadge(w.risk);
                          return (
                            <span key={w.id} className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-200 inline-flex items-center gap-2">
                              <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                              {w.label}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${risk.cls}`}>{risk.label}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openDetails(provider.id)}
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                      >
                        Details
                      </button>
                      {isConnected ? (
                        <>
                          {provider.id === 'slack' ? (
                            <button
                              onClick={() => setSlackInboxOpen(true)}
                              className="px-3 py-2 rounded-xl bg-purple-500/15 border border-purple-400/30 text-purple-100 hover:bg-purple-500/20 transition-colors text-sm font-semibold"
                            >
                              Inbox
                            </button>
                          ) : null}
                          {provider.authType === 'oauth2' ? (
                            <button
                              onClick={() => void refreshOAuthToken(provider.id)}
                              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                              disabled={busy !== null}
                            >
                              Refresh token
                            </button>
                          ) : null}
                          <button
                            onClick={() => void testProvider(provider.id)}
                            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                            disabled={busy !== null}
                          >
                            {busy === 'testing' ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            onClick={() => void disconnectProvider(provider.id)}
                            className="px-3 py-2 rounded-xl border border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15 transition-colors text-sm"
                            disabled={busy !== null}
                          >
                            {busy === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
                          </button>
                        </>
                      ) : isConfigured || isError ? (
                        <>
                          <button
                            onClick={() => void testProvider(provider.id)}
                            className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/20 transition-colors text-sm font-semibold"
                            disabled={busy !== null}
                          >
                            {busy === 'testing' ? 'Testing…' : 'Test & connect'}
                          </button>
                          {provider.authType === 'oauth2' ? (
                            <button
                              onClick={() => void connectOAuthFromVault(provider.id)}
                              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors text-sm"
                              disabled={busy !== null}
                            >
                              Reconnect
                            </button>
                          ) : null}
                          <button
                            onClick={() => void disconnectProvider(provider.id)}
                            className="px-3 py-2 rounded-xl border border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15 transition-colors text-sm"
                            disabled={busy !== null}
                          >
                            {busy === 'disconnecting' ? 'Disconnecting…' : 'Clear'}
                          </button>
                        </>
                      ) : provider.authType === 'oauth2' ? (
                        <button
                          onClick={() => void connectOAuthFromVault(provider.id)}
                          className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                          disabled={busy !== null}
                        >
                          Connect OAuth
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            ensureCredentialSeed(provider.id);
                            void configureApiKey(provider.id);
                          }}
                          className="px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/25 transition-colors text-sm font-semibold"
                          disabled={busy !== null}
                        >
                          {busy === 'connecting' ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </div>
                  </div>

                  {provider.authType === 'api_key' && provider.requiredFields.length > 0 && !isConnected ? (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {provider.requiredFields.map((field) => (
                        <label key={field.name} className="block">
                          <div className="text-xs text-slate-400 font-semibold">{field.label}</div>
                          <input
                            type={field.type === 'password' ? 'password' : 'text'}
                            value={(credentials[provider.id]?.[field.name] || '') as string}
                            onChange={(e) =>
                              setCredentials((prev) => ({
                                ...prev,
                                [provider.id]: { ...(prev[provider.id] || {}), [field.name]: e.target.value },
                              }))
                            }
                            placeholder={field.placeholder || ''}
                            className="mt-1 w-full px-3 py-2 rounded-xl bg-slate-900/60 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          />
                          {field.description ? <div className="text-xs text-slate-500 mt-1">{field.description}</div> : null}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Modal>
      ) : null}

      {/* ── Slack Inbox drawer ─────────────────────────────────────── */}
      {slackInboxOpen ? (
        <Drawer
          title="Slack Inbox"
          onClose={() => {
            setSlackInboxOpen(false);
            setSlackReplyingTo(null);
            setSlackReplyText('');
          }}
        >
          <div className="space-y-4">
            {/* Filter tabs */}
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'new', 'reviewed', 'replied', 'dismissed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSlackFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${
                    slackFilter === f
                      ? 'bg-purple-500/20 border-purple-400/40 text-purple-100'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f}
                </button>
              ))}
              <button
                onClick={() => void loadSlackMessages(slackFilter)}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
                disabled={slackMessagesLoading}
              >
                {slackMessagesLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {/* Message list */}
            {slackMessages.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-slate-500 text-sm">
                {slackMessagesLoading ? 'Loading messages…' : 'No messages yet. Messages from Slack will appear here once events are enabled.'}
              </div>
            ) : (
              <div className="space-y-3">
                {slackMessages.map((msg) => {
                  const statusColors: Record<SlackMessage['status'], string> = {
                    new: 'border-blue-400/25 bg-blue-400/10 text-blue-200',
                    reviewed: 'border-white/10 bg-white/5 text-slate-400',
                    replied: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
                    dismissed: 'border-white/10 bg-white/5 text-slate-500',
                  };
                  const isReplying = slackReplyingTo === msg.id;
                  const channel = msg.slack_channel_name ? `#${msg.slack_channel_name}` : msg.slack_channel_id;
                  const sender = msg.slack_user_name || msg.slack_user_id;
                  return (
                    <div
                      key={msg.id}
                      className={`rounded-2xl border bg-white/[0.03] p-4 space-y-3 ${msg.status === 'dismissed' ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-slate-200">{sender}</span>
                            <span className="text-xs text-slate-500">{channel}</span>
                            <span className="text-xs text-slate-600">{new Date(msg.created_at).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-slate-300 break-words whitespace-pre-wrap">{msg.text}</p>
                        </div>
                        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border capitalize ${statusColors[msg.status]}`}>
                          {msg.status}
                        </span>
                      </div>

                      {/* Reply textarea */}
                      {isReplying ? (
                        <div className="space-y-2">
                          <textarea
                            value={slackReplyText}
                            onChange={(e) => setSlackReplyText(e.target.value)}
                            placeholder="Type your reply…"
                            rows={3}
                            className="w-full rounded-xl border border-white/10 bg-white/5 text-slate-200 text-sm px-3 py-2 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-400/50 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void sendSlackReply(msg.id)}
                              disabled={slackReplying || !slackReplyText.trim()}
                              className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/30 text-purple-100 hover:bg-purple-500/25 transition-colors text-xs font-semibold disabled:opacity-50"
                            >
                              {slackReplying ? 'Sending…' : 'Send'}
                            </button>
                            <button
                              onClick={() => { setSlackReplyingTo(null); setSlackReplyText(''); }}
                              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 transition-colors text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          {msg.status !== 'dismissed' && msg.status !== 'replied' ? (
                            <button
                              onClick={() => { setSlackReplyingTo(msg.id); setSlackReplyText(''); }}
                              className="px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-400/25 text-purple-100 hover:bg-purple-500/20 transition-colors text-xs font-semibold"
                            >
                              Reply
                            </button>
                          ) : null}
                          {msg.status === 'new' ? (
                            <button
                              onClick={() => void updateSlackStatus(msg.id, 'reviewed')}
                              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white transition-colors text-xs"
                            >
                              Mark reviewed
                            </button>
                          ) : null}
                          {msg.status !== 'dismissed' ? (
                            <button
                              onClick={() => void updateSlackStatus(msg.id, 'dismissed')}
                              className="px-3 py-1.5 rounded-lg border border-rose-400/20 bg-rose-400/10 text-rose-300 hover:bg-rose-400/15 transition-colors text-xs"
                            >
                              Dismiss
                            </button>
                          ) : (
                            <button
                              onClick={() => void updateSlackStatus(msg.id, 'new')}
                              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 transition-colors text-xs"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
