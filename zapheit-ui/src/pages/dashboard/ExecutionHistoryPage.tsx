import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, GitBranch } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';

const JobsInboxPage = lazy(() => import('./JobsInboxPage'));
const ReasoningTracesPage = lazy(() => import('./ReasoningTracesPage'));

const TABS = [
  { id: 'runs', label: 'Run History', icon: ClipboardList },
  { id: 'traces', label: 'Reasoning Traces', icon: GitBranch },
] as const;

type TabId = typeof TABS[number]['id'];

interface ExecutionHistoryPageProps {
  agents: AIAgent[];
  initialTab?: TabId;
}

function SectionLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/15 border-t-cyan-300" />
    </div>
  );
}

export default function ExecutionHistoryPage({
  agents,
  initialTab,
}: ExecutionHistoryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab || (tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'runs'),
  );

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/20 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-blue-300" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Execution History</h1>
          <p className="text-sm text-slate-400">Run history and reasoning traces</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              activeTab === id
                ? 'bg-blue-500/15 text-blue-300 border border-blue-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <Suspense fallback={<SectionLoading />}>
        {activeTab === 'runs' && <JobsInboxPage agents={agents} />}
        {activeTab === 'traces' && <ReasoningTracesPage agents={agents} />}
      </Suspense>
    </div>
  );
}
