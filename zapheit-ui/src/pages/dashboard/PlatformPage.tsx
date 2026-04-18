import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Server, Cpu, Database, Layers } from 'lucide-react';
import { cn } from '../../lib/utils';

const ModelCatalogPage = lazy(() => import('./ModelCatalogPage'));
const ModelFineTuningPage = lazy(() => import('./ModelFineTuningPage'));
const RuntimeWorkersPage = lazy(() => import('./RuntimeWorkersPage'));
const CachingPage = lazy(() => import('./CachingPage'));
const BatchProcessingPage = lazy(() => import('./BatchProcessingPage'));

const TABS = [
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'fine-tuning', label: 'Fine-tuning', icon: Layers },
  { id: 'runtime', label: 'Runtime', icon: Server },
  { id: 'caching', label: 'Caching', icon: Database },
  { id: 'batch', label: 'Batch Jobs', icon: Layers },
] as const;

type TabId = typeof TABS[number]['id'];

function PlatformLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/15 border-t-cyan-300" />
    </div>
  );
}

export default function PlatformPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'models',
  );

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
          <Server className="w-5 h-5 text-amber-300" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Platform</h1>
          <p className="text-sm text-slate-400">Models, runtime, caching, and batch infrastructure</p>
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
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/25 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <Suspense fallback={<PlatformLoading />}>
        {activeTab === 'models' && <ModelCatalogPage />}
        {activeTab === 'fine-tuning' && <ModelFineTuningPage />}
        {activeTab === 'runtime' && <RuntimeWorkersPage />}
        {activeTab === 'caching' && <CachingPage />}
        {activeTab === 'batch' && <BatchProcessingPage />}
      </Suspense>
    </div>
  );
}
