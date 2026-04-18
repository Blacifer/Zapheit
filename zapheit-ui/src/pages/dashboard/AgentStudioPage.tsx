import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, Bot, FileText, Wand2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';
import type { IntegrationPackId } from '../../lib/integration-packs';
import type { AgentTemplate } from '../../config/agentTemplates';

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
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab || (tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'templates'),
  );

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/20 flex items-center justify-center">
          <Wand2 className="w-5 h-5 text-violet-300" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-white">Templates</h1>
            <span className="inline-flex items-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Core
            </span>
          </div>
          <p className="text-sm text-slate-400">Launch governed agents, reusable templates, and playbook automation from one workspace.</p>
        </div>
      </div>

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
    </div>
  );
}
