import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';
import { PageHero } from '../../../components/dashboard/PageHero';
import { useAppsData } from './hooks/useAppsData';
import { useAppActions } from './hooks/useAppActions';
import { AppLogo } from './components/AppLogo';
import type { UnifiedApp } from './types';
import { getAppServiceId } from './helpers';

interface AppsPageProps {
  agents?: AIAgent[];
  onNavigate?: (route: string) => void;
}

type SupportedAppConfig = {
  appId: 'google-workspace' | 'slack';
  serviceId: 'google_workspace' | 'slack';
  name: string;
  description: string;
  logoLetter: string;
  colorHex: string;
};

const SUPPORTED_APPS: SupportedAppConfig[] = [
  {
    appId: 'google-workspace',
    serviceId: 'google_workspace',
    name: 'Google Workspace',
    description: 'Open Gmail and Calendar directly inside Zapheit, with full inbox and scheduling control.',
    logoLetter: 'G',
    colorHex: '#4285F4',
  },
  {
    appId: 'slack',
    serviceId: 'slack',
    name: 'Slack',
    description: 'Connect Slack so Zapheit can read channels and write messages.',
    logoLetter: 'S',
    colorHex: '#4A154B',
  },
];

function buildFallbackApp(config: SupportedAppConfig): UnifiedApp {
  return {
    id: `integration:${config.appId}`,
    appId: config.appId,
    name: config.name,
    description: config.description,
    category: 'productivity',
    source: 'integration',
    connectionType: 'oauth_connector',
    primarySetupMode: 'oauth',
    advancedSetupModes: ['oauth'],
    logoLetter: config.logoLetter,
    colorHex: config.colorHex,
    installCount: 0,
    comingSoon: false,
    connected: false,
    status: 'disconnected',
    authType: 'oauth2',
    integrationData: { id: config.serviceId },
    primaryServiceId: config.serviceId,
    supportsHealthTest: false,
    healthStatus: 'not_connected',
    healthTestMode: 'none',
  };
}

function getConnectionStatus(app: UnifiedApp): 'Connected' | 'Disconnected' | 'Error' {
  if (app.status === 'connected') return 'Connected';
  if (app.status === 'error' || app.status === 'expired') return 'Error';
  return 'Disconnected';
}

function statusTone(status: 'Connected' | 'Disconnected' | 'Error') {
  if (status === 'Connected') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300';
  if (status === 'Error') return 'border-rose-400/20 bg-rose-500/10 text-rose-300';
  return 'border-white/10 bg-white/[0.04] text-slate-300';
}

function ConnectionCard({
  app,
  busy,
  onOpenWorkspace,
  onConnect,
  onDisconnect,
}: {
  app: UnifiedApp;
  busy: boolean;
  onOpenWorkspace: (app: UnifiedApp) => void;
  onConnect: (app: UnifiedApp) => void;
  onDisconnect: (app: UnifiedApp) => void;
}) {
  const status = getConnectionStatus(app);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_20px_80px_rgba(2,6,23,0.28)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} logoUrl={app.logoUrl} size="md" />
          <div>
            <h3 className="text-lg font-semibold text-white">{app.name}</h3>
            <p className="mt-1 max-w-xl text-sm text-slate-400">{app.description}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(status)}`}>
          {status}
        </span>
      </div>

      {app.lastErrorMsg && status === 'Error' && (
        <p className="mt-4 rounded-2xl border border-rose-400/15 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {app.lastErrorMsg}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="text-xs text-slate-500">
          {app.appId === 'google-workspace'
            ? 'Scopes: gmail.modify, gmail.send, calendar'
            : 'Scopes: channels:read, chat:write'}
        </div>
        {status === 'Connected' ? (
          <div className="flex items-center gap-2">
            {app.appId === 'google-workspace' && (
              <button
                type="button"
                onClick={() => onOpenWorkspace(app)}
                disabled={busy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Open workspace
              </button>
            )}
            <button
              type="button"
              onClick={() => onDisconnect(app)}
              disabled={busy}
              className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onConnect(app)}
            disabled={busy}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Redirecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AppsPage({ agents = [], onNavigate }: AppsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingService, setPendingService] = useState<string | null>(null);
  const oauthStatus = searchParams.get('status');
  const oauthService = searchParams.get('service') || searchParams.get('provider');
  const oauthMessage = searchParams.get('message');

  const {
    allApps,
    loading,
    reload,
    markConnected,
    markDisconnected,
  } = useAppsData(agents);

  const {
    handleDisconnect,
    handleInitOAuth,
  } = useAppActions({
    reload,
    markConnected,
    markDisconnected,
  });

  useEffect(() => {
    if (!oauthStatus || !oauthService) return;

    if (oauthStatus === 'connected') {
      void reload().then(() => {
        const label = oauthService === 'google_workspace' ? 'Google Workspace' : 'Slack';
        setPendingService(null);
        toast.success(`${label} connected`);
        if (oauthService === 'google_workspace' && onNavigate) {
          onNavigate('apps/google-workspace/workspace');
        }
      });
    } else if (oauthStatus === 'error') {
      void reload().then(() => {
        setPendingService(null);
        toast.error(oauthMessage || 'OAuth connection failed');
      });
    }

    setSearchParams((params) => {
      params.delete('status');
      params.delete('service');
      params.delete('provider');
      params.delete('message');
      return params;
    }, { replace: true });
  }, [oauthMessage, oauthService, oauthStatus, reload, setSearchParams]);

  const apps = useMemo(() => {
    return SUPPORTED_APPS.map((config) => {
      const existing = allApps.find((app) => {
        const serviceId = getAppServiceId(app);
        return app.appId === config.appId || serviceId === config.serviceId;
      });
      return existing ?? buildFallbackApp(config);
    });
  }, [allApps]);

  const openWorkspace = (app: UnifiedApp) => {
    if (app.appId === 'google-workspace' && onNavigate) {
      onNavigate('apps/google-workspace/workspace');
    }
  };

  return (
    <div className="min-h-full bg-[#080f1a] px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <PageHero
          eyebrow="Connected Apps"
          title="Google Workspace and Slack"
          subtitle="Google Workspace now opens into Zapheit’s Gmail and Calendar operating shell, while Slack remains a connection-layer integration."
          stats={[
            { label: 'Apps in scope', value: '2', detail: 'Google Workspace and Slack' },
            { label: 'Auth method', value: 'OAuth 2.0', detail: 'Redirect to provider and return to Zapheit' },
            { label: 'Stored fields', value: '5', detail: 'Token fields plus connection audit fields' },
          ]}
        />

        <div className="mt-8 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-16">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            apps.map((app) => (
              <ConnectionCard
                key={app.id}
                app={app}
                busy={pendingService === getAppServiceId(app)}
                onOpenWorkspace={openWorkspace}
                onConnect={(target) => {
                  const serviceId = getAppServiceId(target);
                  setPendingService(serviceId);
                  void handleInitOAuth(target).finally(() => setPendingService((current) => current === serviceId ? null : current));
                }}
                onDisconnect={(target) => {
                  const serviceId = getAppServiceId(target);
                  setPendingService(serviceId);
                  void handleDisconnect(target).finally(() => setPendingService((current) => current === serviceId ? null : current));
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
