import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Key, Webhook } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ApiKey } from '../../types';

const ApiKeysPage = lazy(() => import('./ApiKeysPage'));
const WebhooksPage = lazy(() => import('./WebhooksPage'));

const TABS = [
  { id: 'keys', label: 'API Keys', icon: Key },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
] as const;

type TabId = typeof TABS[number]['id'];

interface ApiWebhooksPageProps {
  apiKeys: ApiKey[];
  setApiKeys: (keys: ApiKey[]) => void;
  onNavigate?: (route: string) => void;
  initialTab?: TabId;
}

function SectionLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/15 border-t-cyan-300" />
    </div>
  );
}

export default function ApiWebhooksPage({
  apiKeys,
  setApiKeys,
  onNavigate,
  initialTab,
}: ApiWebhooksPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(
    initialTab || (tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'keys'),
  );

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20 flex items-center justify-center">
          <Key className="w-5 h-5 text-emerald-300" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">API & Webhooks</h1>
          <p className="text-sm text-slate-400">Manage API keys and webhook subscriptions</p>
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
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
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
        {activeTab === 'keys' && (
          <ApiKeysPage
            apiKeys={apiKeys}
            setApiKeys={setApiKeys}
            onNavigate={onNavigate}
          />
        )}
        {activeTab === 'webhooks' && <WebhooksPage />}
      </Suspense>
    </div>
  );
}
