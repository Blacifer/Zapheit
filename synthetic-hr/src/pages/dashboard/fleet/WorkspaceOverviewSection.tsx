import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock3,
  Link2,
  MessageSquare,
  ShoppingBag,
  Shield,
  Zap,
} from 'lucide-react';
import type { AIAgent, AgentWorkspaceConversation, AgentWorkspaceIncident } from '../../../types';
import type { IntegrationPackId } from '../../../lib/integration-packs';

type SuggestedApp = {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  setupTimeMinutes?: number;
};

interface WorkspaceOverviewSectionProps {
  activeWorkspaceAgent: AIAgent;
  conversations: AgentWorkspaceConversation[];
  conversationsError: string | null;
  incidents: AgentWorkspaceIncident[];
  incidentsError: string | null;
  openIncidentCount: number;
  criticalIncidentCount: number;
  suggestedApps: SuggestedApp[];
  onPublishAgent?: (agent: AIAgent, packId?: IntegrationPackId | null) => void;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
  onOpenWorkspaceTab?: (tab: 'deployment' | 'conversations' | 'integrations') => void;
}

export function WorkspaceOverviewSection({
  activeWorkspaceAgent,
  conversations,
  conversationsError,
  incidents,
  incidentsError,
  openIncidentCount,
  criticalIncidentCount,
  suggestedApps,
  onPublishAgent,
  onOpenOperationsPage,
  onOpenWorkspaceTab,
}: WorkspaceOverviewSectionProps) {
  const connectedTargets = activeWorkspaceAgent.connectedTargets || [];
  const isLive = activeWorkspaceAgent.publishStatus === 'live';
  const needsConnection = connectedTargets.length === 0;
  const latestConversation = conversations[0] || null;
  const latestIncident = incidents[0] || null;

  const nextAction = (() => {
    if (criticalIncidentCount > 0) {
      return {
        title: 'Review critical incident',
        detail: `${criticalIncidentCount} critical incident${criticalIncidentCount === 1 ? '' : 's'} need attention before expanding traffic.`,
        cta: 'Open incidents',
        action: () => onOpenOperationsPage?.('incidents', { agentId: activeWorkspaceAgent.id }),
        tone: 'rose',
      };
    }
    if (needsConnection) {
      return {
        title: 'Connect the first channel',
        detail: 'This agent is configured but not yet connected to a real place where it can work.',
        cta: 'Publish agent',
        action: () => onPublishAgent?.(activeWorkspaceAgent, activeWorkspaceAgent.primaryPack || null),
        tone: 'blue',
      };
    }
    if (!isLive) {
      return {
        title: 'Go live on connected channels',
        detail: 'The channel is connected. The next step is letting the agent handle real traffic.',
        cta: 'Open deployment',
        action: () => onOpenWorkspaceTab?.('deployment'),
        tone: 'emerald',
      };
    }
    return {
      title: 'Review recent conversations',
      detail: 'The agent is live. The highest-value habit now is checking a few real interactions.',
      cta: 'Open conversations',
      action: () => onOpenWorkspaceTab?.('conversations'),
      tone: 'cyan',
    };
  })();

  const toneStyles: Record<string, string> = {
    rose: 'border-rose-400/20 bg-rose-400/10 text-rose-100',
    blue: 'border-blue-400/20 bg-blue-400/10 text-blue-100',
    emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
    cyan: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">What is happening</p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {isLive
                  ? 'This agent is live and handling traffic.'
                  : needsConnection
                    ? 'This agent is ready, but not connected yet.'
                    : 'This agent is connected, but not live yet.'}
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                {isLive
                  ? 'Use this view to confirm the current status, spot risk, and decide the next operator action.'
                  : needsConnection
                    ? 'The fastest path to value is connecting one real channel, then testing one interaction.'
                    : 'One more step remains before this agent can operate on connected systems.'}
              </p>
            </div>
            <div className={`shrink-0 rounded-2xl border px-3 py-2 text-sm font-semibold ${
              isLive
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : needsConnection
                  ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                  : 'border-blue-400/20 bg-blue-400/10 text-blue-100'
            }`}>
              {isLive ? 'Live' : needsConnection ? 'Needs connection' : 'Ready to go live'}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Conversations</div>
              <div className="mt-2 text-2xl font-semibold text-white">{activeWorkspaceAgent.conversations.toLocaleString()}</div>
              <div className="mt-1 text-xs text-slate-500">Real traffic handled so far</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Risk score</div>
              <div className="mt-2 text-2xl font-semibold text-white">{activeWorkspaceAgent.risk_score}/100</div>
              <div className="mt-1 text-xs text-slate-500 capitalize">{activeWorkspaceAgent.risk_level} governance attention</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Connected channels</div>
              <div className="mt-2 text-2xl font-semibold text-white">{connectedTargets.length}</div>
              <div className="mt-1 text-xs text-slate-500">
                {activeWorkspaceAgent.lastIntegrationSyncAt ? `Last sync ${new Date(activeWorkspaceAgent.lastIntegrationSyncAt).toLocaleString()}` : 'No sync yet'}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">What should I do next</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{nextAction.title}</h3>
          <p className="mt-2 text-sm text-slate-400">{nextAction.detail}</p>
          <button
            onClick={nextAction.action}
            className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${toneStyles[nextAction.tone]}`}
          >
            {nextAction.cta}
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="mt-4 space-y-2">
            <div className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Shield className="w-4 h-4 text-amber-300" />
                Needs attention
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {openIncidentCount > 0
                  ? `${openIncidentCount} incident${openIncidentCount === 1 ? '' : 's'} are open right now.`
                  : 'No open incidents are currently recorded.'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <CheckCircle className="w-4 h-4 text-emerald-300" />
                Working well
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {connectedTargets.length > 0
                  ? `${connectedTargets.length} channel${connectedTargets.length === 1 ? ' is' : 's are'} connected and ready to supervise.`
                  : 'The agent itself is set up and ready for a first channel.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Where this agent works</p>
              <p className="mt-1 text-sm text-slate-400">Connected channels and current availability.</p>
            </div>
            <Link2 className="w-4 h-4 text-blue-200" />
          </div>
          <div className="mt-4 space-y-3">
            {connectedTargets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/20 px-3 py-4 text-sm text-slate-400">
                No channels connected yet.
              </div>
            ) : (
              connectedTargets.slice(0, 3).map((target) => (
                <div key={target.integrationId} className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{target.integrationName}</div>
                      <div className="mt-1 text-xs text-slate-500 truncate">
                        {target.packId} • {target.lastSyncAt ? new Date(target.lastSyncAt).toLocaleString() : 'No sync yet'}
                      </div>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      target.status === 'connected'
                        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                        : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                    }`}>
                      {target.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <button
            onClick={() => onOpenOperationsPage?.('apps', { agentId: activeWorkspaceAgent.id })}
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-200 hover:text-blue-100"
          >
            Open apps and channels
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Recent conversation</p>
              <p className="mt-1 text-sm text-slate-400">The latest customer or operator interaction.</p>
            </div>
            <MessageSquare className="w-4 h-4 text-slate-300" />
          </div>
          <div className="mt-4">
            {conversationsError ? (
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                {conversationsError}
              </div>
            ) : !latestConversation ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/20 px-3 py-4 text-sm text-slate-400">
                No recent conversations yet.
              </div>
            ) : (
              <button
                onClick={() => onOpenOperationsPage?.('conversations', { agentId: activeWorkspaceAgent.id })}
                className="w-full rounded-xl border border-white/10 bg-slate-950/30 px-3 py-4 text-left transition-colors hover:bg-slate-950/50"
              >
                <div className="text-sm font-medium text-white truncate">{latestConversation.topic}</div>
                <div className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                  <Clock3 className="w-3.5 h-3.5" />
                  {new Date(latestConversation.timestamp).toLocaleString()}
                </div>
                <p className="mt-3 text-sm text-slate-300 line-clamp-3">{latestConversation.preview}</p>
              </button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Latest risk signal</p>
              <p className="mt-1 text-sm text-slate-400">The most recent issue or a clean status if nothing is open.</p>
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-300" />
          </div>
          <div className="mt-4">
            {incidentsError ? (
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                {incidentsError}
              </div>
            ) : !latestIncident ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-4">
                <div className="text-sm font-medium text-emerald-100">No incidents recorded</div>
                <p className="mt-1 text-xs text-emerald-200/80">Nothing is currently flagged for this agent.</p>
              </div>
            ) : (
              <button
                onClick={() => onOpenOperationsPage?.('incidents', { agentId: activeWorkspaceAgent.id })}
                className="w-full rounded-xl border border-white/10 bg-slate-950/30 px-3 py-4 text-left transition-colors hover:bg-slate-950/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white">{latestIncident.title}</div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    latestIncident.severity === 'critical'
                      ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                      : latestIncident.severity === 'high'
                        ? 'border-orange-400/20 bg-orange-400/10 text-orange-100'
                        : latestIncident.severity === 'medium'
                          ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                          : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                  }`}>
                    {latestIncident.severity}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(latestIncident.createdAt).toLocaleString()} • {latestIncident.status}
                </p>
              </button>
            )}
          </div>
        </div>
      </div>

      {suggestedApps.length > 0 && (
        <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.04] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-violet-300" />
              <h3 className="text-sm font-semibold text-white">Suggested apps</h3>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/20 text-violet-300">
                For this agent
              </span>
            </div>
            <button
              onClick={() => onOpenOperationsPage?.('apps')}
              className="text-xs font-semibold text-violet-300 hover:text-violet-100 transition-colors inline-flex items-center gap-1"
            >
              Browse apps
              <Zap className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {suggestedApps.map((app) => (
              <div key={app.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {app.logoUrl ? (
                    <img src={app.logoUrl} alt={app.name} className="w-6 h-6 rounded object-contain" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                      <ShoppingBag className="w-3 h-3 text-slate-400" />
                    </div>
                  )}
                  <span className="text-sm font-medium text-white truncate">{app.name}</span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-2">{app.description}</p>
                {app.setupTimeMinutes ? (
                  <span className="text-[11px] text-slate-500">{app.setupTimeMinutes} min setup</span>
                ) : null}
                <button
                  onClick={() => onOpenOperationsPage?.('apps')}
                  className="mt-auto pt-2 text-xs font-semibold text-violet-300 hover:text-violet-100 transition-colors text-left inline-flex items-center gap-1"
                >
                  Open in apps
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
