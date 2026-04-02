import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Users, DollarSign, Shield, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Activity, Zap, Lock, Server, Eye, Phone, Bot,
  Brain, Target, TrendingUp, X, Plus, Search, Filter, Download, Copy, Trash2, Key,
  ShieldAlert, ShoppingBag, ZapOff, Play, Rocket, Link2, MessageSquare, BarChart3, PauseCircle, Loader2, Clock3,
  Globe, Code2, Terminal, ArrowLeft, RefreshCw, Info, Ban
} from 'lucide-react';
import type { AIAgent, AgentPackId, AgentWorkspaceAnalytics, AgentWorkspaceConversation, AgentWorkspaceIncident, AgentWorkspaceSummary } from '../../types';
import { toast } from '../../lib/toast';
import { api } from '../../lib/api-client';
import { getFrontendConfig } from '../../lib/config';
import { supabase } from '../../lib/supabase-client';
import { packDisplayBadge, type IntegrationPackId } from '../../lib/integration-packs';
import { SkeletonAgentCard } from '../../components/Skeleton';
import { PageHero } from '../../components/dashboard/PageHero';
const AddAgentModal = lazy(async () => {
  const mod = await import('./fleet/AddAgentModal');
  return { default: mod.AddAgentModal };
});
const WorkspaceSettingsPanel = lazy(async () => {
  const mod = await import('./fleet/WorkspaceSettingsPanel');
  return { default: mod.WorkspaceSettingsPanel };
});
const WorkspaceOverviewSection = lazy(async () => {
  const mod = await import('./fleet/WorkspaceOverviewSection');
  return { default: mod.WorkspaceOverviewSection };
});
const WorkspaceConversationsSection = lazy(async () => {
  const mod = await import('./fleet/WorkspaceConversationsSection');
  return { default: mod.WorkspaceConversationsSection };
});
const WorkspacePoliciesSection = lazy(async () => {
  const mod = await import('./fleet/WorkspacePoliciesSection');
  return { default: mod.WorkspacePoliciesSection };
});
const WorkspaceAnalyticsSection = lazy(async () => {
  const mod = await import('./fleet/WorkspaceAnalyticsSection');
  return { default: mod.WorkspaceAnalyticsSection };
});
const WorkspaceIntegrationsSection = lazy(async () => {
  const mod = await import('./fleet/WorkspaceIntegrationsSection');
  return { default: mod.WorkspaceIntegrationsSection };
});
const DeployAgentModal = lazy(async () => {
  const mod = await import('./fleet/DeployAgentModal');
  return { default: mod.DeployAgentModal };
});

interface FleetPageProps {
  agents: AIAgent[];
  setAgents: (agents: AIAgent[] | ((currentAgents: AIAgent[]) => AIAgent[])) => void | Promise<void>;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string | null) => void;
  onPublishAgent?: (agent: AIAgent, packId?: IntegrationPackId | null) => void;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
  isLoading?: boolean;
}

type WorkspaceTab = 'overview' | 'deployment' | 'conversations' | 'integrations' | 'policies' | 'analytics' | 'controls' | 'settings' | 'compliance';
type DeployMethod = 'website' | 'api' | 'terminal' | 'advanced';
type DeployCodeTab = 'curl' | 'python' | 'nodejs' | 'php';
const FLEET_AUTO_REFRESH_MS = 5000;
type WorkspaceState = {
  summary: AgentWorkspaceSummary | null;
  conversations: AgentWorkspaceConversation[];
  loadingConversations: boolean;
  conversationsError: string | null;
  incidents: AgentWorkspaceIncident[];
  loadingIncidents: boolean;
  incidentsError: string | null;
  analytics: AgentWorkspaceAnalytics | null;
  loadingAnalytics: boolean;
  analyticsError: string | null;
};

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <span className="ml-1 inline-flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-slate-600 text-[9px] font-bold text-slate-500 hover:border-slate-400 hover:text-slate-300 transition-colors">?</span>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-48 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-300 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function ComplianceScorecardTab({ agentId }: { agentId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.compliance.getAgentScorecard(agentId)
      .then(res => { if (res.success) setData(res.data); })
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
    </div>
  );

  if (!data) return (
    <div className="py-12 text-center text-slate-400 text-sm">No compliance data available.</div>
  );

  const scoreColor = data.score >= 80 ? 'text-emerald-400' : data.score >= 50 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="space-y-6">
      {/* Score overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Compliance Score', value: `${data.score}/100`, color: scoreColor },
          { label: 'Total Runs', value: data.total_runs?.toLocaleString() ?? '0', color: 'text-white' },
          { label: 'Violations', value: data.violation_count ?? 0, color: data.violation_count > 0 ? 'text-rose-400' : 'text-emerald-400' },
          { label: 'Blocks', value: data.block_count ?? 0, color: data.block_count > 0 ? 'text-rose-400' : 'text-emerald-400' },
        ].map(m => (
          <div key={m.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">{m.label}</div>
            <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Top violations */}
      {data.top_violations?.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-rose-400" /> Top Policy Violations
          </h3>
          <div className="space-y-2">
            {data.top_violations.map((v: any) => (
              <div key={v.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-300 truncate">{v.name}</span>
                <span className="text-rose-400 font-medium ml-4">{v.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risk trend */}
      {data.risk_trend?.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" /> Risk Score Trend ({data.days}d)
          </h3>
          <div className="flex items-end gap-1 h-20">
            {data.risk_trend.map((p: any) => {
              const h = Math.round((p.avg_risk ?? 0) * 100);
              return (
                <div key={p.date} className="flex-1 flex flex-col items-center gap-1" title={`${p.date}: ${(p.avg_risk * 100).toFixed(0)}%`}>
                  <div
                    className={`w-full rounded-sm ${h >= 70 ? 'bg-rose-500/60' : h >= 40 ? 'bg-amber-500/60' : 'bg-emerald-500/60'}`}
                    style={{ height: `${Math.max(2, h)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>{data.risk_trend[0]?.date}</span>
            <span>{data.risk_trend[data.risk_trend.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FleetPage({
  agents,
  setAgents,
  selectedAgentId,
  onSelectAgent,
  onPublishAgent,
  onOpenOperationsPage,
  isLoading = false,
}: FleetPageProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [agentLimit, setAgentLimit] = useState<number>(-1);
  const fetchAgentLimit = useCallback(async () => {
    try {
      const { authenticatedFetch } = await import('../../lib/api/_helpers');
      const res = await authenticatedFetch<{ agentLimit?: number }>('/usage');
      if (res.success && res.data?.agentLimit !== undefined) setAgentLimit(res.data.agentLimit);
    } catch { /* non-blocking */ }
  }, []);
  useEffect(() => { void fetchAgentLimit(); }, [fetchAgentLimit]);
  const activeAgentCount = agents.filter(a => a.status !== 'terminated').length;
  const atAgentLimit = agentLimit !== -1 && activeAgentCount >= agentLimit;
  type PolicyRec = { service: string; action: string; require_approval: boolean; required_role: 'manager' | 'admin'; reason: string; notes: string };
  const [policyRecs, setPolicyRecs] = useState<PolicyRec[] | null>(null);
  const [applyingRec, setApplyingRec] = useState<string | null>(null);
  const [killSwitchAgent, setKillSwitchAgent] = useState<string | null>(null);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [wsSettingsBudget, setWsSettingsBudget] = useState(0);
  const [wsSettingsAutoThrottle, setWsSettingsAutoThrottle] = useState(false);
  const [wsSettingsModel, setWsSettingsModel] = useState('gpt-4o');
  const [wsSettingsPlatform, setWsSettingsPlatform] = useState('');
  const [wsModels, setWsModels] = useState<{ id: string; name: string; provider: string; pricing?: { prompt?: string; completion?: string } }[]>([]);
  const [wsModelsLoading, setWsModelsLoading] = useState(false);
  const [wsSettingsSaving, setWsSettingsSaving] = useState(false);
  const [workspaceAgentId, setWorkspaceAgentId] = useState<string | null>(
    selectedAgentId && (agents.length === 0 || agents.some((a) => a.id === selectedAgentId))
      ? selectedAgentId
      : null
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    summary: null,
    conversations: [],
    loadingConversations: false,
    conversationsError: null,
    incidents: [],
    loadingIncidents: false,
    incidentsError: null,
    analytics: null,
    loadingAnalytics: false,
    analyticsError: null,
  });
  const [policyDraft, setPolicyDraft] = useState({ systemPrompt: '', operationalPolicy: '' });
  const [policySaving, setPolicySaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'paused' | 'terminated'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [deployAgentId, setDeployAgentId] = useState<string | null>(null);
  const [deployMethod, setDeployMethod] = useState<DeployMethod | null>(null);
  const [deployCodeTab, setDeployCodeTab] = useState<DeployCodeTab>('curl');
  const [deployApiKey, setDeployApiKey] = useState<string | null>(null);
  const [deployApiKeyId, setDeployApiKeyId] = useState<string | null>(null);
  const [deployApiKeyMasked, setDeployApiKeyMasked] = useState<string | null>(null);
  const [deployApiKeyLoading, setDeployApiKeyLoading] = useState(false);
  const [deployWebsiteOrigin, setDeployWebsiteOrigin] = useState('');
  const [wsKeyRegenerating, setWsKeyRegenerating] = useState(false);
  const [wsKeyNew, setWsKeyNew] = useState<string | null>(null);
  const [runtimesLoading, setRuntimesLoading] = useState(false);
  const [runtimes, setRuntimes] = useState<Array<{ id: string; name: string; mode: string; status: string; last_heartbeat_at: string | null }>>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>('');
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [currentDeployment, setCurrentDeployment] = useState<any | null>(null);
  const [newRuntimeName, setNewRuntimeName] = useState('');
  const [createdEnrollment, setCreatedEnrollment] = useState<{ runtimeId: string; token: string; expiresAt: string } | null>(null);
  const [testJob, setTestJob] = useState<any | null>(null);
  const [suggestedApps, setSuggestedApps] = useState<any[]>([]);
  const [testJobBusy, setTestJobBusy] = useState(false);
  const pollRef = useRef<number | null>(null);
  const [driftAlerts, setDriftAlerts] = useState<Record<string, { prevRisk: number; currentRisk: number; prevModel: string; currentModel: string; reason: string }>>({});

  const lazyFallback = (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
    </div>
  );

  const pollJob = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const r = await api.jobs.get(jobId).catch(() => null);
      if (!r?.success || !r.data?.job) return;
      setTestJob((p: any) => p ? { ...p, job: r.data!.job } : p);
      if (['succeeded', 'failed', 'canceled'].includes(r.data.job.status)) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 2000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Behavioral drift detection: compare current agent state against stored baseline
  useEffect(() => {
    if (isLoading || agents.length === 0) return;
    const newAlerts: typeof driftAlerts = {};
    for (const a of agents) {
      const key = `rasi_drift_baseline_${a.id}`;
      const stored = localStorage.getItem(key);
      if (!stored) {
        localStorage.setItem(key, JSON.stringify({ risk_score: a.risk_score, model_name: a.model_name }));
        continue;
      }
      const baseline = JSON.parse(stored) as { risk_score: number; model_name: string };
      const riskJump = a.risk_score - baseline.risk_score;
      const modelChanged = baseline.model_name && a.model_name !== baseline.model_name;
      if (riskJump >= 15 || modelChanged) {
        const reasons: string[] = [];
        if (riskJump >= 15) reasons.push(`risk score jumped +${riskJump} pts (${baseline.risk_score} → ${a.risk_score})`);
        if (modelChanged) reasons.push(`model changed from ${baseline.model_name} to ${a.model_name}`);
        newAlerts[a.id] = {
          prevRisk: baseline.risk_score,
          currentRisk: a.risk_score,
          prevModel: baseline.model_name,
          currentModel: a.model_name,
          reason: reasons.join('; '),
        };
      }
    }
    setDriftAlerts(newAlerts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, agents.length]);

  const dismissDrift = (agentId: string) => {
    const a = agents.find((ag) => ag.id === agentId);
    if (a) localStorage.setItem(`rasi_drift_baseline_${agentId}`, JSON.stringify({ risk_score: a.risk_score, model_name: a.model_name }));
    setDriftAlerts((prev: typeof driftAlerts) => { const next = { ...prev }; delete next[agentId]; return next; });
  };
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Integration Assignment Panel
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [availableIntegrations, setAvailableIntegrations] = useState<Array<{ id: string; name: string; category: string; status: string; capabilities?: { writes: Array<{ id: string; label: string; risk: string }> } }>>([]);
  const [addIntegrationLoading, setAddIntegrationLoading] = useState(false);
  // Action Mapper
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  const [actionCatalog, setActionCatalog] = useState<Array<{ service: string; action: string; enabled: boolean }>>([]);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void> | void;
    type: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => { },
    type: 'warning'
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rasi_safe_harbor_focus');
      if (!raw) return;

      const parsed = JSON.parse(raw) as { page?: string; id?: string };
      if (parsed.page !== 'fleet' || !parsed.id) return;

      setHighlightedAgentId(parsed.id);
      localStorage.removeItem('rasi_safe_harbor_focus');

      const timer = window.setTimeout(() => setHighlightedAgentId(null), 5000);
      return () => window.clearTimeout(timer);
    } catch {
      localStorage.removeItem('rasi_safe_harbor_focus');
      return;
    }
  }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    setWorkspaceAgentId(selectedAgentId);
    setWorkspaceTab('overview');
  }, [selectedAgentId]);

  useEffect(() => {
    const agent = workspaceAgentId ? agents.find((item) => item.id === workspaceAgentId) : null;
    setPolicyDraft({
      systemPrompt: agent?.system_prompt || '',
      operationalPolicy: String((agent as any)?.config?.operational_policy || ''),
    });
  }, [agents, workspaceAgentId]);

  useEffect(() => {
    if (!workspaceAgentId) return;
    const agent = agents.find((a) => a.id === workspaceAgentId);
    if (!agent) return;
    api.marketplace.getAll().then((res) => {
      if (!res.success || !res.data) return;
      const pack = agent.primaryPack || '';
      const packToCategory: Record<string, string[]> = {
        recruitment: ['recruitment', 'hr'],
        support: ['communication', 'support'],
        finance: ['finance', 'payroll'],
        sales: ['sales', 'analytics'],
        it: ['it', 'security'],
        compliance: ['compliance'],
      };
      const cats = packToCategory[pack] || [];
      const uninstalled = (res.data as any[]).filter(
        (app) => !app.connectionStatus && (cats.length === 0 || cats.includes(app.category))
      );
      setSuggestedApps(uninstalled.slice(0, 3));
    }).catch(() => {});
  }, [workspaceAgentId]);

  const loadWorkspace = useCallback(async (agentId: string) => {
    setWorkspaceState((current) => ({
      ...current,
      loadingConversations: true,
      conversationsError: null,
      loadingIncidents: true,
      incidentsError: null,
      loadingAnalytics: true,
      analyticsError: null,
    }));

    const workspaceResponse = await api.agents.getWorkspace(agentId);
    if (!workspaceResponse.success || !workspaceResponse.data) {
      if (workspaceResponse.error?.toLowerCase().includes('not found')) {
        setWorkspaceAgentId(null);
        onSelectAgent?.(null);
        return;
      }
      setWorkspaceState({
        summary: null,
        conversations: [],
        loadingConversations: false,
        conversationsError: workspaceResponse.error || 'Failed to load recent conversations.',
        incidents: [],
        loadingIncidents: false,
        incidentsError: workspaceResponse.error || 'Failed to load incidents.',
        analytics: null,
        loadingAnalytics: false,
        analyticsError: workspaceResponse.error || 'Failed to load analytics.',
      });
      return;
    }

    await setAgents((currentAgents) => currentAgents.map((agent) => (
      agent.id === agentId ? workspaceResponse.data!.agent : agent
    )));

    setWorkspaceState({
      summary: workspaceResponse.data.summary,
      conversations: workspaceResponse.data.conversations || [],
      loadingConversations: false,
      conversationsError: null,
      incidents: workspaceResponse.data.incidents || [],
      loadingIncidents: false,
      incidentsError: null,
      analytics: workspaceResponse.data.analytics || null,
      loadingAnalytics: false,
      analyticsError: null,
    });
  }, [agents, onSelectAgent, setAgents]);

  const loadDeploymentState = useCallback(async (agentId: string) => {
    setRuntimesLoading(true);
    setCreatedEnrollment(null);
    try {
      const [rt, deps] = await Promise.all([
        api.runtimes.list(),
        api.runtimes.listDeployments(agentId),
      ]);

      if (rt.success && Array.isArray(rt.data)) {
        const items = (rt.data as any[]).map((r) => ({
          id: r.id,
          name: r.name,
          mode: r.mode,
          status: r.status,
          last_heartbeat_at: r.last_heartbeat_at || null,
        }));
        setRuntimes(items);
        setSelectedRuntimeId((current) => (
          current && items.find((r) => r.id === current)
            ? current
            : items[0]?.id || ''
        ));
      } else {
        setRuntimes([]);
      }

      if (deps.success && Array.isArray(deps.data)) {
        const dep = (deps.data as any[]).find((d) => d.agent_id === agentId) || null;
        setCurrentDeployment(dep);
        if (dep?.runtime_instance_id) setSelectedRuntimeId(dep.runtime_instance_id);
      } else {
        setCurrentDeployment(null);
      }
    } catch (err) {
      console.error(err);
      setRuntimes([]);
      setCurrentDeployment(null);
    } finally {
      setRuntimesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workspaceAgentId) {
      setWorkspaceState({
        summary: null,
        conversations: [],
        loadingConversations: false,
        conversationsError: null,
        incidents: [],
        loadingIncidents: false,
        incidentsError: null,
        analytics: null,
        loadingAnalytics: false,
        analyticsError: null,
      });
      return;
    }

    // If the agents list has loaded and this ID isn't in it, it's stale — skip the request
    if (agents.length > 0 && !agents.find((a) => a.id === workspaceAgentId)) {
      setWorkspaceAgentId(null);
      onSelectAgent?.(null);
      return;
    }

    void loadWorkspace(workspaceAgentId);
    const intervalId = window.setInterval(() => {
      void loadWorkspace(workspaceAgentId);
    }, FLEET_AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [agents, loadWorkspace, onSelectAgent, workspaceAgentId]);

  useEffect(() => {
    if (!deployAgentId) return;
    void loadDeploymentState(deployAgentId);
    const intervalId = window.setInterval(() => {
      void loadDeploymentState(deployAgentId);
    }, FLEET_AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [deployAgentId, loadDeploymentState]);

  const computePolicyRecs = (agent: Omit<AIAgent, 'id' | 'created_at'>) => {
    const desc = (agent.description || '').toLowerCase();
    const name = (agent.name || '').toLowerCase();
    const model = (agent.model_name || '').toLowerCase();
    const type = (agent.agent_type || '').toLowerCase();
    const text = `${desc} ${name} ${type}`;
    const recs: Array<{ service: string; action: string; require_approval: boolean; required_role: 'manager' | 'admin'; reason: string; notes: string }> = [];

    if (/payment|refund|razorpay|stripe|cashfree/.test(text))
      recs.push({ service: 'razorpay', action: 'create_refund', require_approval: true, required_role: 'manager', reason: 'This agent handles payments — refunds should be human-approved.', notes: 'Prevents agents from issuing unauthorized refunds autonomously.' });

    if (/payroll|salary|compensation|gusto|deel|contractor/.test(text))
      recs.push({ service: 'gusto', action: 'run_payroll', require_approval: true, required_role: 'admin', reason: 'Payroll/compensation actions are irreversible — require admin approval.', notes: 'High-value, irreversible action — always require a human in the loop.' });

    if (/hr|employee|onboard|offboard|terminat|hire|offer/.test(text))
      recs.push({ service: 'internal', action: 'hr.employee.terminate', require_approval: true, required_role: 'admin', reason: 'HR agents performing offboarding must have admin oversight.', notes: 'Irreversible — requires human oversight at all times.' });

    if (/support|ticket|zendesk|freshdesk/.test(text))
      recs.push({ service: 'zendesk', action: 'create_ticket', require_approval: true, required_role: 'manager', reason: 'This agent creates support tickets — PII fields should be reviewed.', notes: 'Prevents leaking PII fields into unreviewed support tickets.' });

    if (/data|export|report|download|csv/.test(text))
      recs.push({ service: 'internal', action: 'data.records.export', require_approval: true, required_role: 'manager', reason: 'Bulk data export should require manager sign-off.', notes: 'SOC2 CC6.3 — Data egress control.' });

    if (/gpt-4|claude-3-opus|gemini-1\.5-pro/.test(model) && !recs.some(r => r.service === 'internal' && r.action === 'data.records.export'))
      recs.push({ service: 'internal', action: 'data.records.export', require_approval: false, required_role: 'manager', reason: `${agent.model_name} is an expensive model — add cost guardrails.`, notes: 'SOC2 CC6.3 — Data egress control.' });

    return recs.slice(0, 3);
  };

  const addAgent = async (agent: Omit<AIAgent, 'id' | 'created_at'>) => {
    try {
      // Explicitly create via API first to get real backend UUID
      const created = await api.agents.create({
        name: agent.name,
        description: agent.description,
        agent_type: agent.agent_type,
        platform: agent.platform,
        model_name: agent.model_name,
        budget_limit: agent.budget_limit || 0,
        system_prompt: agent.system_prompt || '',
        config: (agent as any).config || {},
      });

      if (created.success && created.data) {
        const newId = (created.data as any).id;
        if (newId) {
          const newAgent: AIAgent = {
            ...agent,
            id: newId,
            created_at: new Date().toISOString(),
          };
          setAgents([...agents, newAgent]);
          toast.success(`Agent ${agent.name} added to fleet.`);
          setShowAddModal(false);
          // Compute and show policy recommendations
          const recs = computePolicyRecs(agent);
          if (recs.length > 0) setPolicyRecs(recs);
          return;
        }
      }
      const errMsg = (created as any)?.error;
      if (errMsg && String(errMsg).includes('plan')) {
        toast.error(errMsg);
      } else {
        toast.error('Failed to create agent properly.');
      }
    } catch (err) {
      console.error('Add agent error:', err);
      toast.error('An error occurred while adding the agent to fleet.');
    }
    setShowAddModal(false);
  };

  const mergeAgent = async (updatedAgent: AIAgent) => {
    await setAgents((currentAgents) => currentAgents.map((agent) => (
      agent.id === updatedAgent.id
        ? {
            ...agent,
            ...updatedAgent,
            config: {
              ...((agent as any).config || {}),
              ...((updatedAgent as any).config || {}),
            },
          }
        : agent
    )));
  };

  const syncAgentPublishState = async (agentId: string) => {
    const response = await api.agents.getPublishState(agentId);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to refresh publish state.');
    }

    const currentAgent = agents.find((agent) => agent.id === agentId);
    if (!currentAgent) return;

    await mergeAgent({
      ...currentAgent,
      publishStatus: response.data.publishStatus,
      primaryPack: (response.data.primaryPack || currentAgent.primaryPack || null) as IntegrationPackId | null,
      integrationIds: response.data.integrationIds || [],
      connectedTargets: (response.data.connectedTargets || []).map((target) => ({
        ...target,
        packId: target.packId as AgentPackId,
      })),
      lastIntegrationSyncAt: response.data.lastIntegrationSyncAt || null,
    });
  };

  const openAddIntegrationPanel = async (_agent: AIAgent) => {
    setShowAddIntegration(true);
    setAddIntegrationLoading(true);
    const intRes = await api.integrations.getAll();
    if (intRes.success && Array.isArray(intRes.data)) {
      setAvailableIntegrations((intRes.data as any[]).filter((i: any) => i.status === 'connected'));
    }
    setAddIntegrationLoading(false);
  };

  const assignIntegration = async (agent: AIAgent, serviceId: string) => {
    const currentIds = agent.integrationIds || [];
    if (currentIds.includes(serviceId)) return;
    const res = await api.agents.updatePublishState(agent.id, { integration_ids: [...currentIds, serviceId] });
    if (!res.success) { toast.error(res.error || 'Failed to assign integration.'); return; }
    await syncAgentPublishState(agent.id);
    toast.success('Integration assigned to agent.');
  };

  const removeIntegration = async (agent: AIAgent, serviceId: string) => {
    const newIds = (agent.integrationIds || []).filter((id) => id !== serviceId);
    const res = await api.agents.updatePublishState(agent.id, { integration_ids: newIds });
    if (!res.success) { toast.error(res.error || 'Failed to remove integration.'); return; }
    await syncAgentPublishState(agent.id);
  };

  const toggleIntegrationAction = async (service: string, action: string, currentEnabled: boolean) => {
    const key = `${service}:${action}`;
    setSavingAction(key);
    await api.integrations.upsertActions([{ service, action, enabled: !currentEnabled }]);
    setActionCatalog((prev) => {
      const exists = prev.some((a) => a.service === service && a.action === action);
      if (exists) return prev.map((a) => a.service === service && a.action === action ? { ...a, enabled: !currentEnabled } : a);
      return [...prev, { service, action, enabled: !currentEnabled }];
    });
    setSavingAction(null);
  };

  const getPublishChecklist = (agent: AIAgent) => [
    { label: 'System prompt set', ok: Boolean((agent as any).config?.systemPrompt || (agent as any).systemPrompt) },
    { label: 'Model selected', ok: Boolean(agent.model_name) },
    { label: 'Integration connected', ok: (agent.connectedTargets?.length || 0) > 0 },
    { label: 'Actions enabled', ok: (agent.integrationIds?.length || 0) > 0 || actionCatalog.some((a) => a.enabled) },
  ];

  const runAgentAction = async (
    agentId: string,
    actionKey: string,
    action: () => Promise<{ success: boolean; data?: any; error?: string }>,
    successMessage: string
  ) => {
    setActionBusy(actionKey);
    try {
      const response = await action();
      if (!response.success) {
        throw new Error(response.error || 'Action failed.');
      }

      const payload = response.data;
      if (payload?.agent) {
        await mergeAgent(payload.agent as AIAgent);
      } else if (payload?.id) {
        await mergeAgent(payload as AIAgent);
      }

      if (workspaceAgentId === agentId) {
        await loadWorkspace(agentId);
      }

      toast.success(successMessage);
      return payload;
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmAction = (
    title: string,
    message: string,
    type: 'danger' | 'warning',
    action: () => Promise<void> | void
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      type,
      action: async () => {
        setConfirming(true);
        try {
          await action();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Action failed.';
          toast.error(message);
        } finally {
          setConfirming(false);
        }
      }
    });
  };

  const handleKillSwitch = (agentId: string, level: 1 | 2 | 3) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    switch (level) {
      case 1:
        handleConfirmAction(
          'Issue Warning (Level 1)',
          `Are you sure you want to pause ${agent.name} and issue a warning?`,
          'warning',
          async () => {
            await runAgentAction(
              agentId,
              `pause:${agentId}`,
              () => api.agents.pause(agentId, 'Level 1 warning issued from fleet workspace'),
              `${agent.name} paused.`
            );
          }
        );
        break;
      case 2:
        handleConfirmAction(
          'Escalate to Human (Level 2)',
          `🚨 LEVEL 2 ESCALATION: ${agent.name} requires human review. This will increase its risk score. Continue?`,
          'warning',
          async () => {
            await runAgentAction(
              agentId,
              `escalate:${agentId}`,
              () => api.agents.escalate(agentId, { notes: 'Escalated from fleet workspace for human review' }),
              `${agent.name} escalated for human review.`
            );
          }
        );
        break;
      case 3:
        handleConfirmAction(
          'Terminate Agent (Level 3)',
          `🛑 LEVEL 3 SHUTDOWN: This will permanently terminate ${agent.name}. Are you absolutely sure?`,
          'danger',
          async () => {
            await runAgentAction(
              agentId,
              `kill:${agentId}`,
              () => api.agents.kill(agentId, {
                level: 3,
                reason: 'Emergency kill switch triggered from fleet workspace',
              }),
              `${agent.name} terminated.`
            );
          }
        );
        break;
    }
    setKillSwitchAgent(null);
  };

  const deleteAgent = (id: string) => {
    const agent = agents.find(a => a.id === id);
    handleConfirmAction(
      'Delete Agent',
      `Are you sure you want to delete ${agent?.name}? This cannot be undone.`,
      'danger',
      async () => {
        const response = await api.agents.delete(id);
        if (!response.success) {
          throw new Error(response.error || 'Failed to delete agent.');
        }
        await setAgents(agents.filter(a => a.id !== id));
        toast.success(`${agent?.name || 'Agent'} deleted successfully.`);
      }
    );
  };

  const saveWsSettings = async () => {
    if (!activeWorkspaceAgent) return;
    const agent = activeWorkspaceAgent;
    if (wsSettingsBudget === 0 && !window.confirm(`Setting the budget to ₹0 will immediately stop ${agent.name} from processing any requests. Continue?`)) return;
    setWsSettingsSaving(true);
    try {
      const response = await api.agents.update(agent.id, {
        budget_limit: wsSettingsBudget,
        model_name: wsSettingsModel,
        config: {
          ...((agent as any).config || {}),
          auto_throttle: wsSettingsAutoThrottle,
        },
      });
      if (!response.success || !response.data) throw new Error(response.error || 'Failed to save settings.');
      await mergeAgent({
        ...(response.data as AIAgent),
        auto_throttle: wsSettingsAutoThrottle,
        budget_limit: wsSettingsBudget,
        model_name: wsSettingsModel,
      });
      toast.success('Settings saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setWsSettingsSaving(false);
    }
  };

  const saveWorkspacePolicies = async () => {
    if (!activeWorkspaceAgent) return;
    setPolicySaving(true);
    try {
      const response = await api.agents.update(activeWorkspaceAgent.id, {
        system_prompt: policyDraft.systemPrompt,
        config: {
          ...((activeWorkspaceAgent as any).config || {}),
          operational_policy: policyDraft.operationalPolicy,
        },
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save policy changes.');
      }
      const updatedAgent = response.data as AIAgent;
      await mergeAgent({
        ...updatedAgent,
        system_prompt: updatedAgent.system_prompt ?? policyDraft.systemPrompt,
      });
      await loadWorkspace(activeWorkspaceAgent.id);
      toast.success('Persona and policy updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save policy changes.';
      toast.error(message);
    } finally {
      setPolicySaving(false);
    }
  };

  const openDeploy = async (agent: AIAgent) => {
    setDeployAgentId(agent.id);
    setDeployMethod(null);
    setDeployApiKey(null);
    setDeployApiKeyId(null);
    setDeployApiKeyMasked(null);
    setDeployApiKeyLoading(false);
    setDeployWebsiteOrigin('');
  };

  const closeDeploy = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setDeployAgentId(null);
    setDeployMethod(null);
    setDeployApiKey(null);
    setDeployApiKeyId(null);
    setDeployApiKeyMasked(null);
    setDeployWebsiteOrigin('');
    setCreatedEnrollment(null);
    setCurrentDeployment(null);
    setSelectedRuntimeId('');
    setNewRuntimeName('');
    setTestJob(null);
  };

  const createRuntime = async (agentName: string) => {
    setRuntimesLoading(true);
    setCreatedEnrollment(null);
    try {
      const name = newRuntimeName.trim() || `${agentName} runtime (${new Date().toLocaleDateString('en-IN')})`;
      const res = await api.runtimes.create({ name, mode: 'vpc' });
      const token = (res as any).enrollment_token as string | undefined;
      const expiresAt = (res as any).enrollment_expires_at as string | undefined;
      if (!res.success || !res.data || !token || !expiresAt) {
        toast.error(res.error || 'Failed to create runtime');
        return;
      }

      const runtimeRow = res.data as any;
      setRuntimes((prev) => [{
        id: runtimeRow.id,
        name: runtimeRow.name,
        mode: runtimeRow.mode,
        status: runtimeRow.status,
        last_heartbeat_at: runtimeRow.last_heartbeat_at || null,
      }, ...prev]);
      setSelectedRuntimeId(runtimeRow.id);
      setCreatedEnrollment({ runtimeId: runtimeRow.id, token, expiresAt });
      setNewRuntimeName('');
      toast.success('Runtime created (enrollment token shown once)');
    } finally {
      setRuntimesLoading(false);
    }
  };

  const deleteRuntime = async (id: string) => {
    if (!confirm('Delete this runtime? Any deployments using it will stop working.')) return;
    try {
      const res = await api.runtimes.delete(id);
      if (!res.success) { toast.error(res.error || 'Failed to delete'); return; }
      setRuntimes((prev) => prev.filter((r) => r.id !== id));
      if (selectedRuntimeId === id) setSelectedRuntimeId(runtimes.find((r) => r.id !== id)?.id || '');
      toast.success('Runtime deleted');
    } catch { toast.error('Failed to delete runtime'); }
  };

  const deployToRuntime = async () => {
    if (!deployAgentId || !selectedRuntimeId) {
      toast.error('Select a runtime first');
      return;
    }
    setDeploymentLoading(true);
    try {
      const res = await api.runtimes.deployAgent({
        agent_id: deployAgentId,
        runtime_instance_id: selectedRuntimeId,
      });
      if (!res.success) {
        toast.error(res.error || 'Deployment failed');
        return;
      }
      setCurrentDeployment(res.data || null);
      await syncAgentPublishState(deployAgentId);
      await loadDeploymentState(deployAgentId);
      toast.success('Deployment saved.');
    } finally {
      setDeploymentLoading(false);
    }
  };

  const createTestChatJob = async () => {
    if (!deployAgentId) return;
    setTestJobBusy(true);
    try {
      const res = await api.jobs.create({
        agent_id: deployAgentId,
        type: 'chat_turn',
        input: {
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Reply in one short sentence.' },
            { role: 'user', content: 'Return: SyntheticHR runtime connection verified.' },
          ],
          temperature: 0.2,
        }
      });
      if (!res.success || !res.data?.job) {
        toast.error(res.error || 'Failed to create test job');
        return;
      }
      setTestJob(res.data);
      toast.success('Test job created (pending approval)');
    } finally {
      setTestJobBusy(false);
    }
  };

  const approveTestJob = async () => {
    const jobId = testJob?.job?.id;
    if (!jobId) return;
    setTestJobBusy(true);
    try {
      const res = await api.jobs.decide(jobId, 'approved');
      if (!res.success) {
        toast.error(res.error || 'Approval failed');
        return;
      }
      if (res.data?.job) {
        setTestJob((prev: any) => prev ? { ...prev, job: res.data!.job } : prev);
      }
      toast.success('Approved. Runtime will pick it up shortly.');
      pollJob(jobId);
    } finally {
      setTestJobBusy(false);
    }
  };

  const openWorkspace = (agentId: string, tab: WorkspaceTab = 'overview') => {
    setWorkspaceAgentId(agentId);
    setWorkspaceTab(tab);
    onSelectAgent?.(agentId);
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      setWsSettingsBudget(agent.budget_limit ?? 0);
      setWsSettingsAutoThrottle(agent.auto_throttle ?? false);
      setWsSettingsModel(agent.model_name || 'gpt-4o');
      setWsSettingsPlatform('');
    }
  };

  const closeWorkspace = () => {
    setWorkspaceAgentId(null);
    onSelectAgent?.(null);
  };

  // Lazy-load models when user opens the Settings tab
  useEffect(() => {
    if (workspaceTab !== 'settings' || wsModels.length > 0 || wsModelsLoading) return;
    const load = async () => {
      setWsModelsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
          const res = await fetch(`${apiUrl}/models`, { headers: { Authorization: `Bearer ${session.access_token}` } });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              const fetched = json.data.map((m: any) => ({
                id: m.id, name: m.name || m.id,
                provider: m.provider || m.id.split('/')[0] || 'Unknown',
                pricing: m.pricing,
              }));
              setWsModels(fetched);
              const match = fetched.find((m: any) => m.id === wsSettingsModel);
              setWsSettingsPlatform(match ? match.provider : fetched[0].provider);
              setWsModelsLoading(false);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load models for workspace settings', err);
      }
      const fallback = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', pricing: { prompt: '0.000005', completion: '0.000015' } },
        { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', pricing: { prompt: '0.000003', completion: '0.000015' } },
        { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'google', pricing: { prompt: '0.0000001', completion: '0.0000004' } },
      ];
      setWsModels(fallback);
      const match = fallback.find(m => m.id === wsSettingsModel);
      setWsSettingsPlatform(match ? match.provider : fallback[0].provider);
      setWsModelsLoading(false);
    };
    void load();
  }, [workspaceTab, wsModels.length, wsModelsLoading, wsSettingsModel]);

  const activeWorkspaceAgent = workspaceAgentId ? agents.find((agent) => agent.id === workspaceAgentId) || null : null;
  const openIncidentCount = workspaceState.incidents.filter((incident) => incident.status !== 'resolved' && incident.status !== 'false_positive').length;
  const criticalIncidentCount = workspaceState.incidents.filter((incident) => incident.severity === 'critical').length;
  const liveAgentCount = agents.filter((agent) => agent.publishStatus === 'live').length;
  const attentionAgentCount = agents.filter((agent) => agent.risk_level === 'high' || (agent.risk_score ?? 0) >= 70).length;
  const disconnectedAgentCount = agents.filter((agent) => (agent.connectedTargets?.length || 0) === 0).length;
  const readyToDeployAgent = agents.find((agent) => agent.publishStatus !== 'live' && (agent.connectedTargets?.length || 0) > 0) || null;
  const firstDisconnectedAgent = agents.find((agent) => (agent.connectedTargets?.length || 0) === 0) || null;
  const firstLiveAgent = agents.find((agent) => agent.publishStatus === 'live') || null;

  const handoffCard = (() => {
    if (agents.length === 0 || activeWorkspaceAgent) return null;

    if (readyToDeployAgent) {
      return {
        eyebrow: 'Recommended next step',
        title: `Deploy ${readyToDeployAgent.name}`,
        description: 'You already have an agent with a connected channel. Going live is the fastest way to move from setup into real operations.',
        primaryLabel: 'Open deployment',
        primaryAction: () => openWorkspace(readyToDeployAgent.id, 'deployment'),
        secondaryLabel: 'Open workspace',
        secondaryAction: () => openWorkspace(readyToDeployAgent.id, 'overview'),
      };
    }

    if (firstDisconnectedAgent) {
      return {
        eyebrow: 'Recommended next step',
        title: `Connect the first channel for ${firstDisconnectedAgent.name}`,
        description: 'This agent is configured but still cold. Connect one channel or app so you can send the first real test and watch the workspace come alive.',
        primaryLabel: 'Connect channel',
        primaryAction: () => onPublishAgent?.(firstDisconnectedAgent, firstDisconnectedAgent.primaryPack || null),
        secondaryLabel: 'Open workspace',
        secondaryAction: () => openWorkspace(firstDisconnectedAgent.id, 'overview'),
      };
    }

    if (firstLiveAgent) {
      return {
        eyebrow: 'Recommended next step',
        title: `Operate ${firstLiveAgent.name}`,
        description: 'You already have a live agent. Open its workspace to review recent conversations, confirm risk, and decide what to do next.',
        primaryLabel: 'Open workspace',
        primaryAction: () => openWorkspace(firstLiveAgent.id, 'overview'),
        secondaryLabel: 'Review conversations',
        secondaryAction: () => openWorkspace(firstLiveAgent.id, 'conversations'),
      };
    }

    return null;
  })();

  const filteredAgents = agents.filter(a => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.model_name.toLowerCase().includes(q) || a.agent_type.toLowerCase().includes(q);
    const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
    const matchesType = filterType === 'all' || a.agent_type === filterType;
    return matchesSearch && matchesStatus && matchesType;
  });

  const controlPlaneBaseUrl = (((getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string))
    .toString()
    .replace(/\/api\/?$/, '');

  const exportCSV = () => {
    const headers = ['ID', 'Name', 'Type', 'Model', 'Status', 'Risk Score', 'Conversations', 'Budget Limit (INR)', 'Current Spend (INR)', 'Created At'].join(',');
    const rows = filteredAgents.map((a) => [
      a.id,
      `"${a.name.replace(/"/g, '""')}"`,
      a.agent_type,
      a.model_name,
      a.status,
      a.risk_score ?? '',
      a.conversations ?? 0,
      a.budget_limit ?? '',
      a.current_spend ?? '',
      a.created_at ? new Date(a.created_at).toISOString() : '',
    ].join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'rasi_agents.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Agent data exported');
  };

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Operate your agents"
        title="Know what is running, risky, and ready for action"
        subtitle="Use Agents as the operating surface for setup, supervision, and go-live decisions without losing track of cost, risk, or channel readiness."
        recommendation={handoffCard ? {
          label: handoffCard.eyebrow,
          title: handoffCard.title,
          detail: handoffCard.description,
        } : {
          label: 'Recommended next step',
          title: 'Create the first agent',
          detail: 'Start with one simple agent and one useful channel. The rest of the workspace can stay advanced until it matters.',
        }}
        actions={[
          ...(filteredAgents.length > 0 ? [{ label: 'Export CSV', onClick: exportCSV, variant: 'secondary' as const, icon: <Download className="w-4 h-4" /> }] : []),
          { label: 'Add Agent', onClick: () => !atAgentLimit && setShowAddModal(true), icon: <Plus className="w-4 h-4" /> },
        ]}
        stats={[
          { label: 'Active agents', value: `${agents.filter((agent) => agent.status === 'active').length}`, detail: 'Currently running right now' },
          { label: 'Live agents', value: `${liveAgentCount}`, detail: 'Handling traffic on connected channels' },
          { label: 'Need attention', value: `${attentionAgentCount}`, detail: 'High-risk or elevated governance attention' },
        ]}
      />

      {agentLimit !== -1 && (
        <div className="flex justify-end">
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${atAgentLimit ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : 'border-white/10 bg-white/[0.04] text-slate-400'}`}>
            {activeAgentCount}/{agentLimit} agents used
          </span>
        </div>
      )}

      {agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Active agents</div>
            <div className="mt-2 text-2xl font-semibold text-white">{agents.filter((agent) => agent.status === 'active').length}</div>
            <div className="mt-1 text-xs text-slate-500">Currently running right now</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Live agents</div>
            <div className="mt-2 text-2xl font-semibold text-white">{liveAgentCount}</div>
            <div className="mt-1 text-xs text-slate-500">Handling traffic on connected channels</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Need attention</div>
            <div className="mt-2 text-2xl font-semibold text-white">{attentionAgentCount}</div>
            <div className="mt-1 text-xs text-slate-500">High-risk or elevated governance attention</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Not connected</div>
            <div className="mt-2 text-2xl font-semibold text-white">{disconnectedAgentCount}</div>
            <div className="mt-1 text-xs text-slate-500">Ready for a first channel or deploy step</div>
          </div>
        </div>
      )}

      {handoffCard && (
        <div className="rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_45%),rgba(8,47,73,0.45)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{handoffCard.eyebrow}</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{handoffCard.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">{handoffCard.description}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handoffCard.primaryAction}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {handoffCard.primaryLabel}
              </button>
              <button
                onClick={handoffCard.secondaryAction}
                className="btn-secondary px-4 py-2.5 text-sm"
              >
                {handoffCard.secondaryLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      {agents.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="fleet-search"
                name="fleet-search"
                type="text"
                placeholder="Search agents by name, model, or description…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-9 py-2.5 text-sm focus:ring-blue-500/30"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'active', 'paused', 'terminated'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all border ${filterStatus === s
                    ? s === 'all' ? 'bg-white/[0.06] text-white border-white/10'
                      : s === 'active' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : s === 'paused' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-white'
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(agents.map(a => a.agent_type))).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? 'all' : type)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all border ${filterType === type
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-white'
                  }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{filteredAgents.length} agent{filteredAgents.length === 1 ? '' : 's'} shown</span>
            {(searchQuery || filterStatus !== 'all' || filterType !== 'all') ? (
              <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterType('all'); }} className="text-cyan-400 transition hover:text-cyan-300">Clear filters</button>
            ) : null}
          </div>
        </div>
      )}

      {isLoading && agents.length === 0 ? (
        <div className="grid gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonAgentCard key={i} />)}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/30 p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
            <Bot className="h-8 w-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white">No governed agents yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
            Create one agent, connect one channel, and run one safe test. That is enough to unlock live telemetry, spend visibility, and incident monitoring.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={() => onOpenOperationsPage?.('getting-started')}
              className="btn-primary px-4 py-2.5 text-sm"
            >
              <Rocket className="h-4 w-4" /> Start guided setup
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
            >
              <Plus className="h-4 w-4" /> Create first agent
            </button>
          </div>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/30 p-10 text-center">
          <Filter className="mx-auto mb-3 h-9 w-9 text-slate-600" />
          <p className="font-medium text-white">No agents match your filters</p>
          <p className="mt-1 text-sm text-slate-400">Try a different search term or status filter.</p>
          <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterType('all'); }} className="mt-4 text-xs text-cyan-400 transition hover:text-cyan-300">Clear filters</button>
        </div>
      ) : (
        <motion.div
          className="grid gap-4"
          variants={{ show: { transition: { staggerChildren: 0.05 } } }}
          initial="hidden"
          animate="show"
        >
          {filteredAgents.map((agent) => {
            const connectedTargetCount = agent.connectedTargets?.length || 0;
            const providerLabel = (() => {
              const prefix = (agent.model_name || '').split('/')[0].toLowerCase();
              const labels: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', meta: 'Meta', mistral: 'Mistral', openrouter: 'OpenRouter' };
              return labels[prefix] || prefix || 'Unknown';
            })();
            const nextActionLabel = agent.publishStatus === 'live'
              ? 'Open workspace'
              : connectedTargetCount > 0
                ? 'Deploy agent'
                : 'Connect channel';
            const nextAction = () => {
              if (agent.publishStatus === 'live') {
                openWorkspace(agent.id);
                return;
              }
              if (connectedTargetCount > 0) {
                void openDeploy(agent);
                return;
              }
              onPublishAgent?.(agent, agent.primaryPack || null);
            };
            const whatIsHappening = agent.publishStatus === 'live'
              ? `${agent.name} is live and can be supervised from its workspace.`
              : connectedTargetCount > 0
                ? `${agent.name} is connected and almost ready. The next step is to deploy it live.`
                : `${agent.name} is configured but still needs its first channel before it can operate.`;
            return (
              <motion.div
                key={agent.id}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                whileHover={{ y: agent.status !== 'terminated' ? -2 : 0, transition: { duration: 0.15 } }}
                className={`relative border rounded-2xl overflow-hidden transition-colors backdrop-blur-sm ${highlightedAgentId === agent.id
                  ? 'border-cyan-400/60 ring-1 ring-cyan-400/40 bg-cyan-500/5'
                  : 'border-slate-700/60 bg-slate-900/60 shadow-[0_4px_16px_rgba(0,0,0,0.2)]'
                  } ${agent.status === 'terminated' ? 'opacity-60' : ''}`}
              >
                {/* Main card row */}
                <div className="p-5">
                  <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-base font-semibold text-white">{agent.name}</h3>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${agent.status === 'active' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                          agent.status === 'paused' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' :
                            'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>
                          <span className="relative flex-shrink-0 w-1.5 h-1.5">
                            {agent.status === 'active' && (
                              <motion.span
                                className="absolute inset-0 rounded-full bg-emerald-400"
                                animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
                                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                              />
                            )}
                            <span className={`absolute inset-0 rounded-full ${agent.status === 'active' ? 'bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]' : agent.status === 'paused' ? 'bg-amber-400' : 'bg-red-400'}`} />
                          </span>
                          {agent.status}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${agent.risk_level === 'low' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                          agent.risk_level === 'medium' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' :
                            'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>Risk {agent.risk_score}/100</span>
                        {agent.publishStatus === 'live' ? (
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-400/10 text-emerald-300 border border-emerald-400/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live
                          </span>
                        ) : agent.publishStatus === 'ready' ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-400/10 text-amber-300 border border-amber-400/20" title="Agent has connected channels — deploy to go live">
                            Ready to go live
                          </span>
                        ) : (
                          <button
                            onClick={() => void openDeploy(agent)}
                            className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-400/10 text-slate-400 border border-slate-400/20 hover:bg-cyan-500/10 hover:text-cyan-300 hover:border-cyan-400/30 transition-colors cursor-pointer"
                            title="Deploy this agent to make it available"
                          >
                            Not live yet
                          </button>
                        )}
                      </div>
                      <p className="text-slate-300 text-sm">{whatIsHappening}</p>
                      <p className="text-slate-500 text-sm mt-1">{agent.description}</p>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Model</div>
                          <div className="mt-2 text-sm font-medium text-white truncate">{providerLabel}</div>
                          <div className="mt-1 text-xs text-slate-500 font-mono truncate">{agent.model_name}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Activity</div>
                          <div className="mt-2 text-sm font-medium text-white">{agent.conversations.toLocaleString()} conversations</div>
                          <div className="mt-1 text-xs text-slate-500">{connectedTargetCount} connected target{connectedTargetCount === 1 ? '' : 's'}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Controls</div>
                          <div className="mt-2 text-sm font-medium text-white">
                            {agent.budget_limit > 0 ? `₹${agent.budget_limit.toLocaleString()} budget cap` : 'No budget cap set'}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 capitalize">{agent.agent_type.replace('_', ' ')}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {agent.primaryPack ? (
                          <span>Domain: <span className="text-slate-300">{agent.primaryPack}</span></span>
                        ) : null}
                        {(() => {
                          const method = (agent as any).metadata?.deploy_method as string | undefined;
                          if (!method) return null;
                          const methodLabels: Record<string, string> = {
                            website: 'Website',
                            api: 'API',
                            terminal: 'Terminal',
                          };
                          return <span>Deploy method: <span className="text-slate-300">{methodLabels[method] || method}</span></span>;
                        })()}
                      </div>
                    </div>

                    <div className="xl:w-64 shrink-0 space-y-3">
                      <button
                        onClick={nextAction}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all bg-blue-500/20 text-blue-100 border border-blue-400/30 hover:bg-blue-500/25"
                      >
                        {agent.publishStatus === 'live' ? <Eye className="w-4 h-4" /> : connectedTargetCount > 0 ? <Rocket className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                        {nextActionLabel}
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => openWorkspace(agent.id)}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Workspace
                        </button>
                        {agent.publishStatus !== 'live' ? (
                          <button
                            onClick={() => void openDeploy(agent)}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10"
                          >
                            <Rocket className="w-3.5 h-3.5" />
                            Deploy
                          </button>
                        ) : (
                          <button
                            onClick={() => onPublishAgent?.(agent, agent.primaryPack || null)}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            Add channel
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        {agent.status !== 'terminated' && (
                          agent.status === 'active' ? (
                            <button
                              onClick={() => handleConfirmAction(
                                'Pause Agent',
                                `Are you sure you want to pause ${agent.name}?`,
                                'warning',
                                async () => {
                                  await runAgentAction(agent.id, `pause:${agent.id}`, () => api.agents.pause(agent.id, 'Paused from fleet list'), `${agent.name} paused.`);
                                }
                              )}
                              className="flex-1 p-2 text-slate-400 hover:text-amber-400 transition-colors rounded-lg hover:bg-amber-400/10 border border-white/10"
                              title="Pause Agent"
                              disabled={actionBusy === `pause:${agent.id}`}
                            >
                              {actionBusy === `pause:${agent.id}` ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <ZapOff className="w-4 h-4 mx-auto" />}
                            </button>
                          ) : (
                            <button
                              onClick={() => void runAgentAction(agent.id, `resume:${agent.id}`, () => api.agents.resume(agent.id, 'Resumed from fleet list'), `${agent.name} resumed.`)}
                              className="flex-1 p-2 text-slate-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-emerald-400/10 border border-white/10"
                              title="Activate Agent"
                              disabled={actionBusy === `resume:${agent.id}`}
                            >
                              {actionBusy === `resume:${agent.id}` ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <Play className="w-4 h-4 mx-auto" />}
                            </button>
                          )
                        )}
                        {agent.status === 'active' && (
                          <button
                            onClick={() => handleConfirmAction(
                              'Activate Kill Switch',
                              `This will immediately stop ${agent.name} from processing any new requests. The agent can be reactivated at any time.`,
                              'danger',
                              async () => {
                                await runAgentAction(agent.id, `pause:${agent.id}`, () => api.agents.pause(agent.id, 'Kill switch activated — emergency stop'), `Kill switch activated for ${agent.name}.`);
                              }
                            )}
                            className="flex-1 p-2 text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all rounded-lg"
                            title="Kill Switch — immediately stop this agent"
                            disabled={actionBusy === `pause:${agent.id}`}
                          >
                            {actionBusy === `pause:${agent.id}` ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <Ban className="w-4 h-4 mx-auto" />}
                          </button>
                        )}
                        <button
                          onClick={() => deleteAgent(agent.id)}
                          className="p-2 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10 border border-white/10"
                          title="Delete Agent"
                          aria-label={`Delete agent ${agent.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Behavioral drift alert */}
                {driftAlerts[agent.id] && (
                  <div className="mx-5 mb-4 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-300">This agent has changed</p>
                      <p className="text-xs text-amber-400/70 mt-0.5">{driftAlerts[agent.id].reason}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openWorkspace(agent.id)}
                        className="text-xs font-semibold text-amber-300 hover:text-amber-200 transition-colors"
                      >
                        Review →
                      </button>
                      <button
                        onClick={() => dismissDrift(agent.id)}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        title="Dismiss drift alert"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

              </motion.div>
            );
          })}
        </motion.div>
      )}

      {activeWorkspaceAgent ? (
        <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.04] overflow-hidden">
          <div className="flex items-start justify-between gap-4 p-6 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-semibold text-white">{activeWorkspaceAgent.name} workspace</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${packDisplayBadge((activeWorkspaceAgent.primaryPack || 'it') as IntegrationPackId).cls}`}>
                  {(activeWorkspaceAgent.primaryPack || 'it').replace('_', ' ')}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                  {activeWorkspaceAgent.connectedTargets?.length || 0} connected target{(activeWorkspaceAgent.connectedTargets?.length || 0) === 1 ? '' : 's'}
                </span>
              </div>
              </div>
            <button onClick={closeWorkspace} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 pt-4 flex flex-wrap gap-2">
            {([
              ['overview', 'Overview'],
              ['deployment', 'Deployment'],
              ['conversations', 'Conversations'],
              ['integrations', 'Integrations'],
              ['policies', 'Policies / Persona'],
              ['analytics', 'Analytics / Usage'],
              ['compliance', 'Compliance'],
              ['controls', 'Controls'],
              ['settings', 'Settings'],
            ] as Array<[WorkspaceTab, string]>).map(([tabId, label]) => (
              <button
                key={tabId}
                onClick={() => setWorkspaceTab(tabId)}
                className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                  workspaceTab === tabId
                    ? 'border-blue-400/30 bg-blue-500/15 text-blue-100'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {workspaceTab === 'deployment' ? (() => {
              const deployMethod = (activeWorkspaceAgent as any).metadata?.deploy_method as string | undefined;
              const gatewayBase = controlPlaneBaseUrl;
              const isDeployed = !!deployMethod;
              const methodMeta: Record<string, { label: string; icon: typeof Globe; color: string; desc: string }> = {
                website: { label: 'Website Embed', icon: Globe, color: 'text-teal-400', desc: 'Embedded via JavaScript widget on a website' },
                api: { label: 'API Integration', icon: Code2, color: 'text-blue-400', desc: 'Called via REST API from an application' },
                terminal: { label: 'Terminal', icon: Terminal, color: 'text-purple-400', desc: 'Accessed via curl or terminal script' },
              };
              const meta = deployMethod ? methodMeta[deployMethod] : null;
              const chatEndpoint = `${gatewayBase}/v1/agents/${activeWorkspaceAgent.id}/chat`;
              const copyText = (text: string, label = 'Copied') =>
                void navigator.clipboard.writeText(text).then(() => toast.success(label)).catch(() => toast.error('Copy failed'));
              const createScopedWorkspaceKey = async () => {
                if (deployMethod === 'website') {
                  await openDeploy(activeWorkspaceAgent);
                  toast.info('Use the Website deploy flow to generate a website key with an allowed origin.');
                  return;
                }
                const target: 'api' | 'terminal' = deployMethod === 'terminal' ? 'terminal' : 'api';
                setWsKeyRegenerating(true);
                setWsKeyNew(null);
                try {
                  const created = await api.apiKeys.create({
                    name: target === 'terminal' ? `Terminal key — ${activeWorkspaceAgent.name}` : `API key — ${activeWorkspaceAgent.name}`,
                    environment: 'production',
                    preset: 'custom',
                    permissions: ['agents.read'],
                    description: target === 'terminal' ? 'Scoped terminal deployment key' : 'Scoped API deployment key',
                    rateLimit: target === 'terminal' ? 1000 : 1000,
                    allowedAgentIds: [activeWorkspaceAgent.id],
                    deploymentType: target,
                  });
                  if (created.success && (created.data as any)?.key) {
                    setWsKeyNew((created.data as any).key);
                    toast.success(target === 'terminal' ? 'New terminal key generated' : 'New API key generated');
                  } else {
                    toast.error('Failed to generate new key');
                  }
                } catch {
                  toast.error('Something went wrong');
                } finally {
                  setWsKeyRegenerating(false);
                }
              };

              return (
                <div className="space-y-4">
                  {isDeployed && meta ? (() => {
                    const Icon = meta.icon;
                    return (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                            <Icon className={`w-4 h-4 ${meta.color}`} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{meta.label}</p>
                            <p className="text-xs text-slate-500">{meta.desc}</p>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                          <code className="text-xs text-slate-300 font-mono truncate">{chatEndpoint}</code>
                          <button onClick={() => copyText(chatEndpoint, 'Endpoint copied')} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => void openDeploy(activeWorkspaceAgent)}
                            className="text-xs text-slate-400 hover:text-slate-200 transition-colors underline"
                          >
                            Switch deployment method
                          </button>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/20 p-8 text-center">
                      <Rocket className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-300 mb-1">Not deployed yet</p>
                      <p className="text-xs text-slate-500 mb-4">Deploy this agent to use it on your website, in your app, or from your terminal.</p>
                      <button
                        onClick={() => void openDeploy(activeWorkspaceAgent)}
                        className="px-4 py-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-sm font-semibold hover:bg-cyan-500/25 transition-colors"
                      >
                        Deploy Now
                      </button>
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-3">API Endpoint</p>
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                      <code className="text-xs text-slate-300 font-mono truncate">POST {chatEndpoint}</code>
                      <button onClick={() => copyText(`POST ${chatEndpoint}`, 'Endpoint copied')} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950/60 p-3 relative">
                      <pre className="text-xs text-slate-300 font-mono whitespace-pre overflow-x-auto">{`curl -X POST ${chatEndpoint} \\\n  -H "Authorization: Bearer sk_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`}</pre>
                      <button onClick={() => copyText(`curl -X POST ${chatEndpoint} \\\n  -H "Authorization: Bearer sk_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message": "Hello"}'`, 'Command copied')} className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Key className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        {wsKeyNew ? (
                          <span className="text-xs text-emerald-300 font-mono truncate">{wsKeyNew} <span className="text-amber-400">(shown once — copy it now)</span></span>
                        ) : (
                          <span className="text-xs text-slate-500 truncate">API key · <button onClick={() => onOpenOperationsPage?.('api-keys')} className="underline hover:text-slate-300 transition-colors">manage keys</button></span>
                        )}
                      </div>
                      <button
                        disabled={wsKeyRegenerating}
                        onClick={() => void createScopedWorkspaceKey()}
                        className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-400 text-xs font-medium hover:text-white hover:border-slate-600 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${wsKeyRegenerating ? 'animate-spin' : ''}`} />
                        {wsKeyRegenerating ? 'Generating…' : 'Regenerate'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })() : workspaceTab === 'overview' ? (
              <Suspense fallback={lazyFallback}>
                <WorkspaceOverviewSection
                  activeWorkspaceAgent={activeWorkspaceAgent}
                  conversations={workspaceState.conversations}
                  conversationsError={workspaceState.conversationsError}
                  incidents={workspaceState.incidents}
                  incidentsError={workspaceState.incidentsError}
                  openIncidentCount={openIncidentCount}
                  criticalIncidentCount={criticalIncidentCount}
                  suggestedApps={suggestedApps}
                  onPublishAgent={onPublishAgent}
                  onOpenOperationsPage={onOpenOperationsPage}
                  onOpenWorkspaceTab={(tab) => setWorkspaceTab(tab)}
                />
              </Suspense>
            ) : null}

            {workspaceTab === 'conversations' ? (
              <Suspense fallback={lazyFallback}>
                <WorkspaceConversationsSection
                  agentId={activeWorkspaceAgent.id}
                  conversations={workspaceState.conversations}
                  conversationsError={workspaceState.conversationsError}
                  loadingConversations={workspaceState.loadingConversations}
                  onOpenOperationsPage={onOpenOperationsPage}
                />
              </Suspense>
            ) : null}

            {workspaceTab === 'integrations' ? (
              <Suspense fallback={lazyFallback}>
                <WorkspaceIntegrationsSection
                  activeWorkspaceAgent={activeWorkspaceAgent}
                  availableIntegrations={availableIntegrations}
                  setAvailableIntegrations={setAvailableIntegrations}
                  addIntegrationLoading={addIntegrationLoading}
                  showAddIntegration={showAddIntegration}
                  setShowAddIntegration={setShowAddIntegration}
                  expandedActions={expandedActions}
                  setExpandedActions={setExpandedActions}
                  actionCatalog={actionCatalog}
                  setActionCatalog={setActionCatalog}
                  savingAction={savingAction}
                  actionBusy={actionBusy}
                  getPublishChecklist={getPublishChecklist}
                  openAddIntegrationPanel={openAddIntegrationPanel}
                  assignIntegration={assignIntegration}
                  removeIntegration={removeIntegration}
                  toggleIntegrationAction={toggleIntegrationAction}
                  runAgentAction={runAgentAction}
                  onPublishAgent={onPublishAgent}
                  onOpenOperationsPage={onOpenOperationsPage}
                />
              </Suspense>
            ) : null}

            {workspaceTab === 'policies' ? (
              <Suspense fallback={lazyFallback}>
                <WorkspacePoliciesSection
                  agentId={activeWorkspaceAgent.id}
                  policyDraft={policyDraft}
                  setPolicyDraft={setPolicyDraft}
                  policySaving={policySaving}
                  saveWorkspacePolicies={saveWorkspacePolicies}
                  onOpenOperationsPage={onOpenOperationsPage}
                />
              </Suspense>
            ) : null}

            {workspaceTab === 'analytics' ? (
              <Suspense fallback={lazyFallback}>
                <WorkspaceAnalyticsSection
                  activeWorkspaceAgent={activeWorkspaceAgent}
                  analytics={workspaceState.analytics}
                  analyticsError={workspaceState.analyticsError}
                  loadingAnalytics={workspaceState.loadingAnalytics}
                  onOpenOperationsPage={onOpenOperationsPage}
                />
              </Suspense>
            ) : null}

            {workspaceTab === 'compliance' ? (
              <ComplianceScorecardTab agentId={activeWorkspaceAgent.id} />
            ) : null}

            {workspaceTab === 'controls' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Agent state</div>
                    <div className="mt-3 text-2xl font-semibold text-white capitalize">{activeWorkspaceAgent.status}</div>
                    <div className="mt-2 text-sm text-slate-400">Current lifecycle: {activeWorkspaceAgent.lifecycle_state}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-center text-xs uppercase tracking-[0.16em] text-slate-500">Risk score<InfoTip text="Composite score (0–100) based on open incident count, severity, and policy violations. Higher = more governance attention needed." /></div>
                    <div className="mt-3 text-2xl font-semibold text-white">{activeWorkspaceAgent.risk_score}/100</div>
                    <div className="mt-2 text-sm text-slate-400">Risk level: {activeWorkspaceAgent.risk_level}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Incident pressure</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{openIncidentCount}</div>
                    <div className="mt-2 text-sm text-slate-400">{criticalIncidentCount} critical incidents currently on record</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => activeWorkspaceAgent.status === 'active'
                      ? handleConfirmAction(
                        'Pause Agent',
                        `Are you sure you want to pause ${activeWorkspaceAgent.name}?`,
                        'warning',
                        async () => {
                          await runAgentAction(activeWorkspaceAgent.id, `pause:${activeWorkspaceAgent.id}`, () => api.agents.pause(activeWorkspaceAgent.id, 'Paused from controls workspace'), `${activeWorkspaceAgent.name} paused.`);
                        }
                      )
                      : void runAgentAction(activeWorkspaceAgent.id, `resume:${activeWorkspaceAgent.id}`, () => api.agents.resume(activeWorkspaceAgent.id, 'Resumed from controls workspace'), `${activeWorkspaceAgent.name} resumed.`)
                    }
                    className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5 text-left"
                    disabled={actionBusy === `pause:${activeWorkspaceAgent.id}` || actionBusy === `resume:${activeWorkspaceAgent.id}`}
                  >
                    <PauseCircle className="w-5 h-5 text-amber-300" />
                    <div className="mt-3 text-sm font-semibold text-white">{activeWorkspaceAgent.status === 'active' ? 'Pause agent' : 'Resume agent'}</div>
                    <div className="mt-1 text-sm text-amber-100/80">Temporarily stop or resume live traffic.</div>
                  </button>
                  <button
                    onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 2)}
                    className="rounded-2xl border border-orange-400/20 bg-orange-400/10 p-5 text-left"
                    disabled={actionBusy === `escalate:${activeWorkspaceAgent.id}`}
                  >
                    <AlertTriangle className="w-5 h-5 text-orange-300" />
                    <div className="mt-3 text-sm font-semibold text-white">Escalate to human</div>
                    <div className="mt-1 text-sm text-orange-100/80">Increase scrutiny and force review for risky behavior.</div>
                  </button>
                  {activeWorkspaceAgent.publishStatus !== 'live' ? (
                    <button
                      onClick={() => void runAgentAction(activeWorkspaceAgent.id, `live:${activeWorkspaceAgent.id}`, () => api.agents.goLive(activeWorkspaceAgent.id), `${activeWorkspaceAgent.name} is now live.`)}
                      className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5 text-left"
                      disabled={actionBusy === `live:${activeWorkspaceAgent.id}`}
                    >
                      <Play className="w-5 h-5 text-emerald-300" />
                      <div className="mt-3 text-sm font-semibold text-white">Go live</div>
                      <div className="mt-1 text-sm text-emerald-100/80">Enable live traffic on connected channels.</div>
                    </button>
                  ) : null}
                  <button
                    onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 3)}
                    className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-left"
                  >
                    <ShieldAlert className="w-5 h-5 text-rose-300" />
                    <div className="mt-3 text-sm font-semibold text-white">Kill switch</div>
                    <div className="mt-1 text-sm text-rose-100/80">Immediately shut down the agent if it is unsafe.</div>
                  </button>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Recent incidents</h3>
                      <p className="text-sm text-slate-400 mt-1">Use this to decide whether to pause, escalate, or fully stop the agent.</p>
                    </div>
                    <button
                      onClick={() => onOpenOperationsPage?.('incidents', { agentId: activeWorkspaceAgent.id })}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                    >
                      Open incidents
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {workspaceState.loadingIncidents ? (
                      <div className="text-sm text-slate-300 inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading incidents...
                      </div>
                    ) : workspaceState.incidentsError ? (
                      <div className="text-sm text-rose-200">{workspaceState.incidentsError}</div>
                    ) : workspaceState.incidents.length === 0 ? (
                      <div className="text-sm text-slate-400">No incidents recorded for this agent.</div>
                    ) : (
                      workspaceState.incidents.slice(0, 4).map((incident) => (
                        <div key={incident.id} className="rounded-xl border border-white/10 bg-slate-950/30 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-white">{incident.title}</div>
                            <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                              {incident.status}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            {incident.type} • {incident.severity} • {new Date(incident.createdAt).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : workspaceTab === 'settings' ? (
              <Suspense fallback={lazyFallback}>
                <WorkspaceSettingsPanel
                  activeWorkspaceAgent={activeWorkspaceAgent}
                  wsModels={wsModels}
                  wsModelsLoading={wsModelsLoading}
                  wsSettingsPlatform={wsSettingsPlatform}
                  setWsSettingsPlatform={setWsSettingsPlatform}
                  wsSettingsModel={wsSettingsModel}
                  setWsSettingsModel={setWsSettingsModel}
                  wsSettingsBudget={wsSettingsBudget}
                  setWsSettingsBudget={setWsSettingsBudget}
                  wsSettingsAutoThrottle={wsSettingsAutoThrottle}
                  setWsSettingsAutoThrottle={setWsSettingsAutoThrottle}
                  handleKillSwitch={handleKillSwitch}
                  wsSettingsSaving={wsSettingsSaving}
                  saveWsSettings={saveWsSettings}
                  resetWsSettings={() => {
                    setWsSettingsBudget(activeWorkspaceAgent.budget_limit ?? 0);
                    setWsSettingsAutoThrottle(activeWorkspaceAgent.auto_throttle ?? false);
                    setWsSettingsModel(activeWorkspaceAgent.model_name || 'gpt-4o');
                    setWsSettingsPlatform('');
                  }}
                  InfoTip={InfoTip}
                />
              </Suspense>
            ) : null}
          </div>
        </div>
      ) : null}


      {deployAgentId && (
        <Suspense fallback={lazyFallback}>
          <DeployAgentModal
            deployAgent={agents.find((agent) => agent.id === deployAgentId) || null}
            deployAgentId={deployAgentId}
            deployMethod={deployMethod}
            setDeployMethod={setDeployMethod}
            deployCodeTab={deployCodeTab}
            setDeployCodeTab={setDeployCodeTab}
            deployApiKey={deployApiKey}
            setDeployApiKey={setDeployApiKey}
            setDeployApiKeyId={setDeployApiKeyId}
            setDeployApiKeyMasked={setDeployApiKeyMasked}
            deployApiKeyLoading={deployApiKeyLoading}
            setDeployApiKeyLoading={setDeployApiKeyLoading}
            deployWebsiteOrigin={deployWebsiteOrigin}
            setDeployWebsiteOrigin={setDeployWebsiteOrigin}
            controlPlaneBaseUrl={controlPlaneBaseUrl}
            closeDeploy={closeDeploy}
            setAgents={setAgents}
            syncAgentPublishState={syncAgentPublishState}
            loadDeploymentState={loadDeploymentState}
            runtimes={runtimes}
            selectedRuntimeId={selectedRuntimeId}
            setSelectedRuntimeId={setSelectedRuntimeId}
            deploymentLoading={deploymentLoading}
            currentDeployment={currentDeployment}
            deployToRuntime={deployToRuntime}
            createTestChatJob={createTestChatJob}
            approveTestJob={approveTestJob}
            testJobBusy={testJobBusy}
            testJob={testJob}
            onOpenOperationsPage={onOpenOperationsPage}
          />
        </Suspense>
      )}

      {showAddModal && (
        <Suspense fallback={lazyFallback}>
          <AddAgentModal onClose={() => setShowAddModal(false)} onAdd={addAgent} />
        </Suspense>
      )}

      {/* Policy Recommendations Modal */}
      {policyRecs && policyRecs.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-cyan-400" />
                <h3 className="text-lg font-bold text-white">Recommended Policies</h3>
              </div>
              <button onClick={() => setPolicyRecs(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-5">Based on this agent's description, Rasi suggests these governance policies. Apply in one click.</p>
            <div className="space-y-3">
              {policyRecs.map((rec: PolicyRec, i: number) => (
                <div key={i} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{rec.service} → {rec.action}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{rec.reason}</p>
                      <div className="mt-2 flex gap-1.5 flex-wrap text-[10px]">
                        {rec.require_approval && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">Requires Approval</span>}
                        <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-400">{rec.required_role}</span>
                      </div>
                    </div>
                    <button
                      disabled={applyingRec === `${rec.service}:${rec.action}`}
                      onClick={async () => {
                        setApplyingRec(`${rec.service}:${rec.action}`);
                        try {
                          const res = await api.actionPolicies.upsert({ service: rec.service, action: rec.action, enabled: true, require_approval: rec.require_approval, required_role: rec.required_role, notes: rec.notes });
                          if (res.success) toast.success('Policy applied.');
                          else toast.error(res.error || 'Failed to apply policy.');
                        } catch { toast.error('Failed to apply policy.'); }
                        setApplyingRec(null);
                        setPolicyRecs((prev: PolicyRec[] | null) => prev ? prev.filter((_: PolicyRec, j: number) => j !== i) : null);
                      }}
                      className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 transition"
                    >
                      {applyingRec === `${rec.service}:${rec.action}` ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={() => setPolicyRecs(null)} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition">
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-300 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmModal.action()}
                disabled={confirming}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-white ${confirmModal.type === 'danger'
                  ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/60'
                  : 'bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/60'
                  }`}
              >
                {confirming ? 'Working...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
