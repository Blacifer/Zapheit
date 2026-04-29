import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, Bot, FileText, Wand2, Plus, Eye, ShieldCheck, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';
import type { IntegrationPackId } from '../../lib/integration-packs';
import type { AgentTemplate } from '../../config/agentTemplates';
import { AddAgentModal } from './fleet/AddAgentModal';

const AgentTemplatesPage = lazy(() => import('./AgentTemplatesPage'));
const DomainAgentLibraryPage = lazy(() => import('./DomainAgentLibraryPage'));
const PlaybooksPage = lazy(() => import('./PlaybooksPage'));

const TABS = [
  { id: 'templates', label: 'Templates', icon: Zap },
  { id: 'library', label: 'Agent Library', icon: Bot },
  { id: 'playbooks', label: 'Playbooks', icon: FileText },
] as const;

type TabId = typeof TABS[number]['id'];

interface AgentStudioPageProps {
  onDeployTemplate: (template: AgentTemplate & { system_prompt?: string; integration_ids?: string[] }) => Promise<void>;
  onLaunchTemplateChat: (template: AgentTemplate & { system_prompt?: string; integration_ids?: string[] }) => Promise<void>;
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
  const shadowConfidence = searchParams.get('confidence');
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab || (tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'templates'),
  );
  const [showWizard, setShowWizard] = useState(false);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
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
                Start with {shadowAgent || 'a governed agent'}{shadowDepartment ? ` for ${shadowDepartment}` : ''}.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                Deploy this first in read-only mode, require human approval before writes, set a budget cap, then run Shadow Mode safety testing before production traffic.
              </p>
              {shadowApps && (
                <p className="mt-2 text-xs text-slate-400">
                  Source apps detected: <span className="text-slate-200">{shadowApps}</span>
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
                onClick={() => setShowWizard(true)}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 font-semibold text-white transition-colors hover:bg-cyan-500"
              >
                Build from this brief
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
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
