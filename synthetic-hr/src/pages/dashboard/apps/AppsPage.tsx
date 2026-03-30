import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from '../../../lib/toast';
import { cn } from '../../../lib/utils';
import type { AIAgent } from '../../../types';
import type { UnifiedApp } from './types';
import { useAppsData } from './hooks/useAppsData';
import { useAppActions } from './hooks/useAppActions';
import { StatsBar } from './components/StatsBar';
import { AgentContextBanner } from './components/AgentContextBanner';
import { CategorySidebar } from './components/CategorySidebar';
import { ConnectedAppRow } from './components/ConnectedAppRow';
import { ConnectModal } from './components/ConnectModal';
import { BrowseView } from './components/BrowseView';
import { MobileBottomSheet } from './components/MobileBottomSheet';
import { DetailDrawer } from './drawer/DetailDrawer';

interface AppsPageProps {
  agents?: AIAgent[];
  onNavigate?: (route: string) => void;
}

export default function AppsPage({ agents = [], onNavigate }: AppsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL params
  const agentIdParam = searchParams.get('agentId');
  const domainParam = searchParams.get('domain');
  const oauthConnected = searchParams.get('marketplace_connected') === 'true';
  const oauthApp = searchParams.get('marketplace_app');
  const intOauthStatus = searchParams.get('status');
  const intOauthProvider = searchParams.get('provider');
  const oauthError = searchParams.get('marketplace_error') || (intOauthStatus === 'error' ? searchParams.get('message') : null);

  // Data
  const {
    allApps, browseList, connectedList, myApps, featured, bundles,
    loading, reload, markConnected,
    agentNamesFor, totalActions, errorCount, governedCount,
  } = useAppsData(agents);

  // View state
  const [activeTab, setActiveTab] = useState<'my' | 'browse'>('my');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [showMyApps, setShowMyApps] = useState(false);
  const [showCategories, setShowCategories] = useState(true);
  const [search, setSearch] = useState('');

  // Overlay state
  const [drawerApp, setDrawerApp] = useState<UnifiedApp | null>(null);
  const [connectTarget, setConnectTarget] = useState<UnifiedApp | null>(null);

  const linkedAgent = agentIdParam ? agents.find((a) => a.id === agentIdParam) : null;

  // Actions
  const { handleConnect, handleDisconnect } = useAppActions({
    reload,
    markConnected,
    onPostConnect: (app) => {
      setConnectTarget(null);
      setDrawerApp(app);
    },
  });

  // OAuth callback: marketplace
  useEffect(() => {
    if (!oauthConnected && !oauthApp && !oauthError) return;
    if (oauthError) {
      toast.error(`Connection failed: ${oauthError}`);
    } else if (oauthApp) {
      void reload().then(() => {
        toast.success(`${oauthApp.charAt(0).toUpperCase() + oauthApp.slice(1)} connected successfully`);
      });
    }
    setSearchParams((p) => {
      p.delete('marketplace_connected'); p.delete('marketplace_app'); p.delete('marketplace_error');
      return p;
    }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // OAuth callback: integration (connectors.ts)
  useEffect(() => {
    if (!intOauthStatus) return;
    if (intOauthStatus === 'connected' && intOauthProvider) {
      void reload().then(() => {
        toast.success(`${intOauthProvider.charAt(0).toUpperCase() + intOauthProvider.slice(1)} connected`);
      });
    } else if (intOauthStatus === 'error') {
      toast.error(`Connection failed: ${searchParams.get('message') || 'Unknown error'}`);
    }
    setSearchParams((p) => { p.delete('status'); p.delete('provider'); p.delete('message'); return p; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Domain param: jump to category
  useEffect(() => {
    if (domainParam) setSelectedCat(domainParam);
  }, [domainParam]);

  // Open drawer when agentId redirects us here
  const agentFilteredList = useMemo(() => {
    if (!agentIdParam) return connectedList;
    return connectedList.filter((app) => agentNamesFor(app).length > 0);
  }, [connectedList, agentIdParam, agentNamesFor]);

  const displayList = agentIdParam ? agentFilteredList : connectedList;

  return (
    <div className="flex h-full overflow-hidden bg-[#080f1a]">
      {/* Left sidebar */}
      <CategorySidebar
        search={search}
        onSearchChange={setSearch}
        selectedCat={selectedCat}
        onSelectCat={setSelectedCat}
        showMyApps={showMyApps}
        onToggleMyApps={() => setShowMyApps((v) => !v)}
        myApps={myApps}
        allApps={allApps}
        onSelectApp={(app) => setDrawerApp(app)}
        showCategories={showCategories}
        onToggleCategories={() => setShowCategories((v) => !v)}
        onNavigate={onNavigate}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-3 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white">Apps</h1>
            <p className="text-slate-400 text-xs mt-0.5">
              Connect external apps to your agents with governed access, approvals, and evidence.
            </p>
          </div>
          <button
            onClick={() => void reload()}
            className="p-2 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Agent context banner */}
        {linkedAgent && (
          <div className="mx-6 mb-2">
            <AgentContextBanner agent={linkedAgent} />
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-6 py-2 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/8 w-fit">
            <button
              onClick={() => setActiveTab('my')}
              className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors', activeTab === 'my' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200')}
            >
              My Apps{displayList.length > 0 ? ` (${displayList.length})` : ''}
            </button>
            <button
              onClick={() => setActiveTab('browse')}
              className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors', activeTab === 'browse' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200')}
            >
              Browse All
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'my' ? (
            <div className="h-full overflow-y-auto px-6 pb-6 space-y-4 pt-2">
              {/* Stats bar */}
              {!loading && connectedList.length > 0 && (
                <StatsBar
                  totalConnected={connectedList.length}
                  errorCount={errorCount}
                  totalActions={totalActions}
                  governedCount={governedCount}
                />
              )}

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                </div>
              ) : displayList.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-slate-400 text-sm mb-4">
                    {agentIdParam ? 'No apps linked to this agent yet.' : 'No apps connected yet.'}
                  </p>
                  <button
                    onClick={() => setActiveTab('browse')}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                  >
                    Browse apps
                  </button>
                </div>
              ) : (
                displayList.map((app) => (
                  <ConnectedAppRow
                    key={app.id}
                    app={app}
                    agentNames={agentNamesFor(app)}
                    onClick={(_a) => setDrawerApp(app)}
                    onConfigure={(_a) => setConnectTarget(app)}
                    onDisconnect={(_a) => void handleDisconnect(app)}
                  />
                ))
              )}
            </div>
          ) : (
            <BrowseView
              apps={browseList}
              bundles={bundles as any}
              agents={agents}
              initialCategory={selectedCat}
              onConnect={(app) => setConnectTarget(app)}
              onManage={(app) => setDrawerApp(app)}
            />
          )}
        </div>
      </div>

      {/* Connect modal */}
      {connectTarget && (
        <ConnectModal
          app={connectTarget}
          onConnect={async (app, creds) => {
            await handleConnect(app, creds);
            setConnectTarget(null);
          }}
          onDisconnect={async (app) => {
            await handleDisconnect(app);
            setConnectTarget(null);
          }}
          onClose={() => setConnectTarget(null)}
        />
      )}

      {/* Detail drawer — desktop */}
      {drawerApp && (
        <div className="hidden md:block">
          <DetailDrawer
            app={drawerApp}
            agents={agents}
            onClose={() => setDrawerApp(null)}
            onConfigure={(app) => { setDrawerApp(null); setConnectTarget(app); }}
            onDisconnect={async (app) => { await handleDisconnect(app); setDrawerApp(null); }}
          />
        </div>
      )}

      {/* Detail drawer — mobile bottom sheet */}
      {drawerApp && (
        <MobileBottomSheet onClose={() => setDrawerApp(null)}>
          <DetailDrawer
            app={drawerApp}
            agents={agents}
            onClose={() => setDrawerApp(null)}
            onConfigure={(app) => { setDrawerApp(null); setConnectTarget(app); }}
            onDisconnect={async (app) => { await handleDisconnect(app); setDrawerApp(null); }}
          />
        </MobileBottomSheet>
      )}
    </div>
  );
}
