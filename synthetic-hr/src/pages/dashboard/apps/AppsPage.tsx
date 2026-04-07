import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { cn } from '../../../lib/utils';
import type { AIAgent } from '../../../types';
import type { UnifiedApp, DrawerTab } from './types';
import { useAppsData } from './hooks/useAppsData';
import { useAppActions } from './hooks/useAppActions';
import { StatsBar } from './components/StatsBar';
import { AgentContextBanner } from './components/AgentContextBanner';
import { CategorySidebar } from './components/CategorySidebar';
import { ConnectedAppRow } from './components/ConnectedAppRow';
import { ConnectWizard } from './connect-wizard/ConnectWizard';
import { BrowseView } from './components/BrowseView';
import { MobileBottomSheet } from './components/MobileBottomSheet';
import { DetailDrawer } from './drawer/DetailDrawer';
import { PageHero } from '../../../components/dashboard/PageHero';
import { getAppServiceId } from './helpers';

interface AppsPageProps {
  agents?: AIAgent[];
  onNavigate?: (route: string) => void;
}

export default function AppsPage({ agents = [], onNavigate }: AppsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL params
  const agentIdParam = searchParams.get('agentId');
  const domainParam = searchParams.get('domain');
  const serviceParam = searchParams.get('service');
  const drawerTabParam = searchParams.get('drawerTab') as DrawerTab | null;
  const oauthConnected = searchParams.get('marketplace_connected') === 'true';
  const oauthApp = searchParams.get('marketplace_app');
  const intOauthStatus = searchParams.get('status');
  const intOauthProvider = searchParams.get('provider');
  const oauthError = searchParams.get('marketplace_error') || (intOauthStatus === 'error' ? searchParams.get('message') : null);

  // Data
  const {
    allApps, browseList, connectedList, myApps, featured,
    loading, reload, markConnected, markDisconnected,
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

  // Health summary: maps appId → 'ok' | 'error' | null
  const [healthMap, setHealthMap] = useState<Map<string, 'ok' | 'error'>>(new Map());
  const [testingAll, setTestingAll] = useState(false);

  const loadHealthSummary = useCallback(async () => {
    const res = await api.integrations.getHealthSummary();
    if (res.success && res.data) {
      const m = new Map<string, 'ok' | 'error'>();
      for (const entry of res.data) {
        if (entry.last_test_result === 'ok' || entry.last_test_result === 'error') {
          m.set(entry.service, entry.last_test_result as 'ok' | 'error');
        }
      }
      setHealthMap(m);
    }
  }, []);

  useEffect(() => { void loadHealthSummary(); }, [loadHealthSummary]);

  const testAll = async () => {
    if (connectedList.length === 0) { toast.info('No connected apps to test'); return; }
    setTestingAll(true);
    let ok = 0; let fail = 0; let skipped = 0;
    for (const app of connectedList) {
      if (!app.supportsHealthTest) {
        skipped++;
        continue;
      }
      const res = app.source === 'marketplace'
        ? await api.marketplace.testConnection(app.appId)
        : await api.integrations.test(app.appId);
      const result: 'ok' | 'error' = res.success ? 'ok' : 'error';
      if (res.success) ok++; else fail++;
      setHealthMap((prev) => new Map(prev).set(app.appId, result));
    }
    toast.success(`Health check done — ${ok} healthy, ${fail} failed, ${skipped} skipped`);
    setTestingAll(false);
  };

  const linkedAgent = agentIdParam ? agents.find((a) => a.id === agentIdParam) : null;

  // Actions
  const { handleConnect, handleDisconnect } = useAppActions({
    reload,
    markConnected,
    markDisconnected,
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
  const recommendedAction = linkedAgent
    ? {
      label: 'Recommended next step',
      title: `Connect one useful capability for ${linkedAgent.name}`,
      detail: 'Start with one app that makes the agent more useful in a real workflow, then return to Agents to run or supervise it.',
    }
    : connectedList.length === 0
      ? {
        label: 'Recommended next step',
        title: 'Connect the first app',
        detail: 'Pick one app that unlocks a real workflow. You do not need a full stack of integrations before the product becomes useful.',
      }
      : {
        label: 'Recommended next step',
        title: 'Review unhealthy or underused connections',
        detail: 'Use My Apps to spot weak routing, test connection health, and keep the most useful capabilities connected.',
      };

  useEffect(() => {
    if (!serviceParam) return;
    const target = connectedList.find((app) => {
      const rawId = getAppServiceId(app);
      return rawId === serviceParam || app.appId === serviceParam;
    });
    if (!target) return;
    setActiveTab('my');
    setDrawerApp((current) => current?.id === target.id ? current : target);
  }, [connectedList, serviceParam]);

  const clearDeepLinkParams = useCallback(() => {
    setSearchParams((params) => {
      params.delete('service');
      params.delete('drawerTab');
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const closeDrawer = useCallback(() => {
    setDrawerApp(null);
    if (serviceParam || drawerTabParam) {
      clearDeepLinkParams();
    }
  }, [clearDeepLinkParams, drawerTabParam, serviceParam]);

  return (
    <div className="flex h-full overflow-hidden bg-[#080f1a]">
      {/* Left sidebar */}
      <CategorySidebar
        search={search}
        onSearchChange={setSearch}
        selectedCat={selectedCat}
        onSelectCat={(cat) => { setSelectedCat(cat); setActiveTab('browse'); }}
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
        <div className="px-6 pt-6 pb-3 shrink-0">
          <PageHero
            eyebrow="Connect useful capabilities"
            title="Connect apps once, then work from Rasi"
            subtitle="Every connected app becomes one governed workspace for your operators and agents, so work can be read, updated, and supervised without hopping across tools."
            recommendation={recommendedAction}
            actions={[
              ...(activeTab === 'my' && connectedList.length > 0
                ? [{
                  label: testingAll ? 'Testing…' : 'Test All',
                  onClick: () => void testAll(),
                  variant: 'secondary' as const,
                  icon: testingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />,
                }]
                : []),
              { label: 'Refresh', onClick: () => void reload(), variant: 'secondary' as const, icon: <RefreshCw className="w-4 h-4" /> },
            ]}
            stats={[
              { label: 'Connected', value: `${connectedList.length}`, detail: 'Apps ready for agents or operators' },
              { label: 'Approval-aware apps', value: `${governedCount}`, detail: 'Connected apps with approval or policy controls' },
              { label: 'Health issues', value: `${errorCount}`, detail: 'Connections needing attention' },
            ]}
          />
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
                    onClick={(_a) => {
                      if (app.appId === 'slack' && onNavigate) {
                        onNavigate('/dashboard/apps/slack/workspace');
                      } else if (app.appId === 'jira' && onNavigate) {
                        onNavigate('/dashboard/apps/jira/workspace');
                      } else if (app.appId === 'github' && onNavigate) {
                        onNavigate('/dashboard/apps/github/workspace');
                      } else {
                        setDrawerApp(app);
                      }
                    }}
                    onConfigure={(_a) => setConnectTarget(app)}
                    onDisconnect={(_a) => void handleDisconnect(app)}
                    healthResult={healthMap.get(app.appId) ?? null}
                  />
                ))
              )}
            </div>
          ) : (
            <BrowseView
              apps={browseList}
              agents={agents}
              featured={featured}
              initialCategory={selectedCat}
              onConnect={(app) => setConnectTarget(app)}
              onManage={(app) => setDrawerApp(app)}
            />
          )}
        </div>
      </div>

      {/* Connect wizard */}
      {connectTarget && (
        <ConnectWizard
          app={connectTarget}
          agents={agents}
          onConnect={async (app, creds) => {
            await handleConnect(app, creds);
          }}
          onClose={() => setConnectTarget(null)}
          onOpenWorkspace={(app) => {
            setConnectTarget(null);
            if (app.appId === 'slack' && onNavigate) {
              onNavigate('/dashboard/apps/slack/workspace');
            } else if (app.appId === 'jira' && onNavigate) {
              onNavigate('/dashboard/apps/jira/workspace');
            } else if (app.appId === 'github' && onNavigate) {
              onNavigate('/dashboard/apps/github/workspace');
            } else {
              setDrawerApp(app);
            }
          }}
        />
      )}

      {/* Detail drawer — desktop */}
      {drawerApp && (
        <div className="hidden md:block">
          <DetailDrawer
            app={drawerApp}
            agents={agents}
            initialTab={drawerTabParam || 'overview'}
            onClose={closeDrawer}
            onConfigure={(app) => { setDrawerApp(null); setConnectTarget(app); clearDeepLinkParams(); }}
            onDisconnect={async (app) => { await handleDisconnect(app); setDrawerApp(null); clearDeepLinkParams(); }}
          />
        </div>
      )}

      {/* Detail drawer — mobile bottom sheet */}
      {drawerApp && (
        <MobileBottomSheet onClose={closeDrawer}>
          <DetailDrawer
            app={drawerApp}
            agents={agents}
            initialTab={drawerTabParam || 'overview'}
            onClose={closeDrawer}
            onConfigure={(app) => { setDrawerApp(null); setConnectTarget(app); clearDeepLinkParams(); }}
            onDisconnect={async (app) => { await handleDisconnect(app); setDrawerApp(null); clearDeepLinkParams(); }}
          />
        </MobileBottomSheet>
      )}
    </div>
  );
}
