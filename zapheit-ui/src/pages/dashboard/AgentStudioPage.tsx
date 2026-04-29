import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, Bot, FileText, Wand2, Plus, Eye, ShieldCheck, ArrowRight, Loader2, IndianRupee, TimerReset, BriefcaseBusiness } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';
import type { IntegrationPackId } from '../../lib/integration-packs';
import type { AgentTemplate } from '../../config/agentTemplates';
import type { TemplateLaunchPackage } from '../../lib/template-launch-package';
import { AddAgentModal } from './fleet/AddAgentModal';

const AgentTemplatesPage = lazy(() => import('./AgentTemplatesPage'));
const DomainAgentLibraryPage = lazy(() => import('./DomainAgentLibraryPage'));
const PlaybooksPage = lazy(() => import('./PlaybooksPage'));

const TABS = [
  { id: 'templates', label: 'Templates', icon: Zap },
  { id: 'library', label: 'Agent Library', icon: Bot },
  { id: 'playbooks', label: 'Playbooks', icon: FileText },
] as const;

const BUNDLE_SUGGESTIONS = [
  {
    id: 'finance',
    name: 'Finance & Accounting',
    detail: 'Tally, Razorpay, Cashfree, GST summaries, and payment approvals.',
  },
  {
    id: 'hr',
    name: 'HR',
    detail: 'greytHR, Keka, Darwinbox, onboarding, leave, payroll exceptions.',
  },
  {
    id: 'support',
    name: 'Support',
    detail: 'Freshdesk, Zendesk, WhatsApp, SLA routing, refunds, and replies.',
  },
];

type TabId = typeof TABS[number]['id'];
type ShadowWorkflowId = 'hiring' | 'hr' | 'finance' | 'support' | 'sales' | 'devops' | string;

interface AgentStudioPageProps {
  onDeployTemplate: (template: AgentTemplate & { system_prompt?: string; integration_ids?: string[]; launch_package?: TemplateLaunchPackage }) => Promise<void>;
  onLaunchTemplateChat: (template: AgentTemplate & { system_prompt?: string; integration_ids?: string[]; launch_package?: TemplateLaunchPackage }) => Promise<void>;
  onDeployLibraryAgent: (agentData: any) => Promise<void>;
  agents: AIAgent[];
  onNavigate?: (page: string) => void;
  initialPackId?: IntegrationPackId | null;
  initialAgentId?: string | null;
  initialTab?: TabId;
}

function StudioLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/15 border-t-cyan-300" />
    </div>
  );
}

const SHADOW_WORKFLOW_PACK: Record<string, string> = {
  hiring: 'recruitment',
  hr: 'recruitment',
  finance: 'finance',
  support: 'support',
  sales: 'sales',
  devops: 'it',
};

const SHADOW_WORKFLOW_TYPE: Record<string, string> = {
  hiring: 'recruiting',
  hr: 'hr',
  finance: 'finance',
  support: 'customer_support',
  sales: 'sales',
  devops: 'devops',
};

function parseCsvParam(value: string | null): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)));
}

function buildShadowAgentDraft(input: {
  workflow: ShadowWorkflowId;
  department: string;
  agentName: string;
  apps: string[];
  appIds: string[];
  confidence: number | null;
  savingsInr: number | null;
}) {
  const workflowLabel = input.department || input.workflow || 'Operations';
  const appsText = input.apps.length ? input.apps.join(', ') : 'connected business apps';
  const savingsText = input.savingsInr && input.savingsInr > 0 ? formatInr(input.savingsInr) : 'the measured monthly upside';
  const confidenceText = input.confidence ? `${input.confidence}% discovery confidence` : 'discovery confidence';
  const name = input.agentName || `${workflowLabel} Shadow Agent`;

  const systemPrompt = [
    `You are ${name}, a Zapheit-managed AI agent running in SHADOW MODE for ${workflowLabel}.`,
    `Primary systems observed: ${appsText}.`,
    'You must operate read-only by default. Do not write, send, delete, approve, update, refund, message, or trigger external side effects unless Zapheit has routed a human approval and the approval decision is allowed.',
    'For every proposed action, produce: business reason, affected app, affected record, risk level, required approval role, expected outcome, rollback note, and audit evidence.',
    'If information is incomplete, ask for clarification instead of guessing. Never expose secrets, Aadhaar, PAN, passwords, tokens, bank details, or private employee/customer data.',
    `The first rollout goal is a 7-day shadow run proving ${savingsText} of opportunity with ${confidenceText}.`,
  ].join('\n\n');

  return {
    name,
    description: `Read-only ${workflowLabel} shadow agent generated from Zapheit Workforce Discovery. It drafts actions, evidence, and approval packets before any live write is allowed.`,
    agent_type: SHADOW_WORKFLOW_TYPE[input.workflow] || 'custom',
    primary_pack: SHADOW_WORKFLOW_PACK[input.workflow] || null,
    platform: 'api',
    model_name: 'gpt-4o-mini',
    system_prompt: systemPrompt,
    budget_limit: 5000,
    integration_ids: input.appIds,
    status: 'active',
    lifecycle_state: 'idle',
    risk_level: 'medium',
    risk_score: 45,
    conversations: 0,
    satisfaction: 0,
    uptime: 100,
    current_spend: 0,
    auto_throttle: true,
    config: {
      deployment_mode: 'shadow',
      shadow_mode: true,
      source: 'workforce_discovery',
      workflow: input.workflow,
      department: workflowLabel,
      connected_apps: input.apps,
      connector_ids: input.appIds,
      discovery_confidence: input.confidence,
      estimated_monthly_savings_inr: input.savingsInr,
      rollout_plan: {
        duration_days: 7,
        phase: 'read_only_shadow',
        promote_after: [
          'At least 20 observed workflow events',
          'No critical policy violations',
          'Human reviewers approve the proposed action quality',
          'Budget cap and approval policy confirmed',
        ],
      },
      safety_controls: {
        read_only_first: true,
        human_approval_before_writes: true,
        auto_disable_on_incident: true,
        pii_redaction_required: true,
        budget_cap_inr: 5000,
      },
      success_metrics: [
        'Actions drafted',
        'Human approvals required',
        'Estimated time saved',
        'Estimated INR saved',
        'Policy violations avoided',
      ],
      display_provider: 'Zapheit AI',
    },
  };
}

export default function AgentStudioPage({
  onDeployTemplate,
  onLaunchTemplateChat,
  onDeployLibraryAgent,
  agents,
  onNavigate,
  initialPackId,
  initialAgentId,
  initialTab,
}: AgentStudioPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const shadowSource = searchParams.get('source') === 'shadow';
  const shadowAgent = searchParams.get('agent');
  const shadowDepartment = searchParams.get('department');
  const shadowApps = searchParams.get('apps');
  const shadowAppIds = searchParams.get('appIds');
  const shadowConfidence = searchParams.get('confidence');
  const shadowWorkflow = searchParams.get('workflow') || 'custom';
  const shadowSavings = searchParams.get('savings');
  const bundleParam = searchParams.get('bundle');
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab || (tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'templates'),
  );
  const [showWizard, setShowWizard] = useState(false);
  const [shadowDeploying, setShadowDeploying] = useState(false);
  const [shadowDeployError, setShadowDeployError] = useState<string | null>(null);

  const shadowAppsList = parseCsvParam(shadowApps);
  const shadowAppIdList = parseCsvParam(shadowAppIds);
  const shadowConfidenceValue = shadowConfidence ? Number(shadowConfidence) : null;
  const shadowSavingsValue = shadowSavings ? Number(shadowSavings) : null;
  const shadowDraft = shadowSource
    ? buildShadowAgentDraft({
      workflow: shadowWorkflow,
      department: shadowDepartment || 'Operations',
      agentName: shadowAgent || `${shadowDepartment || 'Operations'} Shadow Agent`,
      apps: shadowAppsList,
      appIds: shadowAppIdList,
      confidence: Number.isFinite(shadowConfidenceValue) ? shadowConfidenceValue : null,
      savingsInr: Number.isFinite(shadowSavingsValue) ? shadowSavingsValue : null,
    })
    : null;

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  const deployShadowAgent = async () => {
    if (!shadowDraft || shadowDeploying) return;
    setShadowDeploying(true);
    setShadowDeployError(null);
    try {
      await onDeployLibraryAgent(shadowDraft);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to deploy shadow agent';
      setShadowDeployError(message);
    } finally {
      setShadowDeploying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/20 flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-violet-300" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-white">Create an Assistant</h1>
              <span className="inline-flex items-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                Core
              </span>
            </div>
            <p className="text-sm text-slate-400">Launch governed agents, reusable templates, and playbook automation from one workspace.</p>
          </div>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-semibold transition-colors shadow-lg shadow-cyan-500/20"
        >
          <Plus className="w-4 h-4" />
          Build from scratch
        </button>
      </div>

      {shadowSource && (
        <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                  <Eye className="h-3.5 w-3.5" />
                  Shadow launch brief
                </span>
                {shadowConfidence && (
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                    {shadowConfidence}% discovery confidence
                  </span>
                )}
              </div>
              <p className="mt-2 text-base font-semibold text-white">
                Deploy {shadowDraft?.name || shadowAgent || 'a governed shadow agent'}{shadowDepartment ? ` for ${shadowDepartment}` : ''}.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                One click creates a read-only agent with approval-before-write controls, a ₹5,000 budget cap, connector context, and a 7-day promotion checklist.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {shadowAppsList.length > 0 && (
                  <span className="rounded-full border border-slate-700 bg-slate-950/50 px-2.5 py-1 text-slate-300">
                    Apps: <span className="text-slate-100">{shadowAppsList.join(', ')}</span>
                  </span>
                )}
                {shadowSavingsValue != null && Number.isFinite(shadowSavingsValue) && shadowSavingsValue > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                    <IndianRupee className="h-3.5 w-3.5" />
                    {formatInr(shadowSavingsValue || 0)} monthly upside
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-blue-200">
                  <TimerReset className="h-3.5 w-3.5" />
                  7-day shadow run
                </span>
              </div>
              {shadowDeployError && (
                <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {shadowDeployError}
                </p>
              )}
            </div>
            <div className="grid min-w-[220px] gap-2 text-xs text-slate-300">
              {['Read-only for 7 days', 'Approval required before writes', 'Budget cap before live rollout'].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-slate-950/40 px-3 py-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{item}</span>
                </div>
              ))}
              <button
                onClick={deployShadowAgent}
                disabled={shadowDeploying}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {shadowDeploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {shadowDeploying ? 'Deploying shadow agent...' : 'Deploy shadow agent'}
              </button>
              <button
                onClick={() => setShowWizard(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-950/40 px-3 py-2 font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                Customize first
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {!shadowSource && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
                <BriefcaseBusiness className="h-4 w-4" />
                Recommended bundle path
              </div>
              <p className="mt-1 text-sm text-slate-300">
                {bundleParam
                  ? `Continue from the ${bundleParam} vertical bundle, or compare it with the top India-first bundles below.`
                  : 'For faster production rollout, start from a vertical bundle instead of building a standalone agent.'}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[620px]">
              {BUNDLE_SUGGESTIONS.map((bundle) => (
                <button
                  key={bundle.id}
                  onClick={() => onNavigate?.(`bundles/${bundle.id}`)}
                  className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-left transition hover:border-cyan-500/35 hover:bg-cyan-500/[0.04]"
                >
                  <p className="text-sm font-semibold text-white">{bundle.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{bundle.detail}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all',
              activeTab === id
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 shadow-[0_0_12px_rgba(139,92,246,0.1)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <Suspense fallback={<StudioLoading />}>
        {activeTab === 'templates' && (
          <AgentTemplatesPage onDeploy={onDeployTemplate} onLaunchInChat={onLaunchTemplateChat} />
        )}
        {activeTab === 'library' && (
          <DomainAgentLibraryPage
            initialPackId={initialPackId}
            initialAgentId={initialAgentId}
            onDeploy={onDeployLibraryAgent}
            onNavigate={onNavigate}
          />
        )}
        {activeTab === 'playbooks' && (
          <PlaybooksPage agents={agents} onNavigate={onNavigate} />
        )}
      </Suspense>

      {showWizard && (
        <AddAgentModal
          onClose={() => setShowWizard(false)}
          onAdd={async (agentData) => {
            await onDeployLibraryAgent(agentData);
            setShowWizard(false);
            onNavigate?.('agents');
          }}
        />
      )}
    </div>
  );
}
