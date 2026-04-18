import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Info,
  Link2,
  Loader2,
  Play,
  Plus,
  ShoppingBag,
  X,
  XCircle,
} from 'lucide-react';
import type { AIAgent } from '../../../types';
import type { IntegrationPackId } from '../../../lib/integration-packs';
import { api } from '../../../lib/api-client';

type AvailableIntegration = {
  id: string;
  name: string;
  category: string;
  status: string;
  capabilities?: {
    writes: Array<{ id: string; label: string; risk: string }>;
  };
};

type ConnectedTarget = NonNullable<AIAgent['connectedTargets']>[number];

interface WorkspaceIntegrationsSectionProps {
  activeWorkspaceAgent: AIAgent;
  availableIntegrations: AvailableIntegration[];
  setAvailableIntegrations: React.Dispatch<React.SetStateAction<AvailableIntegration[]>>;
  addIntegrationLoading: boolean;
  showAddIntegration: boolean;
  setShowAddIntegration: React.Dispatch<React.SetStateAction<boolean>>;
  expandedActions: Set<string>;
  setExpandedActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  actionCatalog: Array<{ service: string; action: string; enabled: boolean }>;
  setActionCatalog: React.Dispatch<React.SetStateAction<Array<{ service: string; action: string; enabled: boolean }>>>;
  savingAction: string | null;
  actionBusy: string | null;
  getPublishChecklist: (agent: AIAgent) => Array<{ label: string; ok: boolean }>;
  openAddIntegrationPanel: (agent: AIAgent) => Promise<void>;
  assignIntegration: (agent: AIAgent, integrationId: string) => Promise<void>;
  removeIntegration: (agent: AIAgent, integrationId: string) => Promise<void>;
  toggleIntegrationAction: (service: string, action: string, currentEnabled: boolean) => Promise<void>;
  runAgentAction: (
    agentId: string,
    actionKey: string,
    action: () => Promise<any>,
    successMessage: string
  ) => Promise<void>;
  onPublishAgent?: (agent: AIAgent, packId?: IntegrationPackId | null) => void;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
}

export function WorkspaceIntegrationsSection({
  activeWorkspaceAgent,
  availableIntegrations,
  setAvailableIntegrations,
  addIntegrationLoading,
  showAddIntegration,
  setShowAddIntegration,
  expandedActions,
  setExpandedActions,
  actionCatalog,
  setActionCatalog,
  savingAction,
  actionBusy,
  getPublishChecklist,
  openAddIntegrationPanel,
  assignIntegration,
  removeIntegration,
  toggleIntegrationAction,
  runAgentAction,
  onPublishAgent,
  onOpenOperationsPage,
}: WorkspaceIntegrationsSectionProps) {
  const connectedTargets = activeWorkspaceAgent.connectedTargets || [];

  const toggleActionsPanel = (target: ConnectedTarget) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(target.integrationId)) {
        next.delete(target.integrationId);
      } else {
        next.add(target.integrationId);
        void api.integrations.getActionCatalog().then((res) => {
          if (res.success && Array.isArray(res.data)) {
            setActionCatalog(res.data as Array<{ service: string; action: string; enabled: boolean }>);
          }
        });
        void api.integrations.getAll().then((res) => {
          if (res.success && Array.isArray(res.data)) {
            setAvailableIntegrations((res.data as any[]).filter((integration: any) => integration.status === 'connected'));
          }
        });
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-white">Where this agent works</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenOperationsPage?.(`apps?agentId=${activeWorkspaceAgent.id}`)}
            className="rounded-xl bg-violet-500/15 border border-violet-400/25 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/25 inline-flex items-center gap-1.5"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Connect data sources
          </button>
          <button
            onClick={() => void openAddIntegrationPanel(activeWorkspaceAgent)}
            className="rounded-xl bg-blue-500/20 border border-blue-400/30 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-500/25 inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Connect a channel
          </button>
        </div>
      </div>

      {activeWorkspaceAgent.publishStatus !== 'live' && (() => {
        const checklist = getPublishChecklist(activeWorkspaceAgent);
        const allGreen = checklist.every((item) => item.ok);
        return (
          <div className={`rounded-2xl border p-4 ${allGreen ? 'border-emerald-400/20 bg-emerald-400/[0.06]' : 'border-amber-400/20 bg-amber-400/[0.06]'}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] mb-3 ${allGreen ? 'text-emerald-300' : 'text-amber-300'}`}>
              {allGreen ? 'Ready to go live' : 'Before going live'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {checklist.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  {item.ok ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  )}
                  <span className={`text-xs ${item.ok ? 'text-slate-300' : 'text-slate-400'}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {connectedTargets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-200 mb-1">What is publishing?</p>
              <p className="text-xs text-slate-400 mb-3">Publishing connects your agent to a channel, like Slack or email, so it can send and receive real messages.</p>
              <button
                onClick={() => onPublishAgent?.(activeWorkspaceAgent, activeWorkspaceAgent.primaryPack || null)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-400/30 text-blue-300 text-xs font-semibold hover:bg-blue-500/25 transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
                Connect a channel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {connectedTargets.map((target) => {
            const actionsForService = availableIntegrations.find((integration) => integration.id === target.integrationId)?.capabilities?.writes || [];
            const isExpanded = expandedActions.has(target.integrationId);

            return (
              <div key={target.integrationId} className="rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${target.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <div>
                      <h4 className="font-semibold text-white text-sm">{target.integrationName}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {target.packId} · {target.lastSyncAt ? `synced ${new Date(target.lastSyncAt).toLocaleDateString()}` : 'no sync yet'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      target.status === 'connected'
                        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                        : 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                    }`}>
                      {target.status}
                    </span>
                    <button
                      onClick={() => toggleActionsPanel(target)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-white/10 inline-flex items-center gap-1"
                    >
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      Actions
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-white/10 px-4 py-3">
                    {actionsForService.length === 0 ? (
                      <p className="text-xs text-slate-500">No configurable actions for this integration.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Enabled actions</p>
                        {actionsForService.map((write) => {
                          const catalogEntry = actionCatalog.find((item) => item.service === target.integrationId && item.action === write.id);
                          const enabled = catalogEntry ? catalogEntry.enabled : false;
                          const key = `${target.integrationId}:${write.id}`;
                          const riskColors: Record<string, string> = {
                            low: 'text-slate-400',
                            medium: 'text-amber-400',
                            high: 'text-rose-400',
                            money: 'text-orange-400',
                          };
                          return (
                            <div key={write.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2">
                              <div>
                                <span className="text-xs text-white">{write.label}</span>
                                <span className={`ml-2 text-[10px] ${riskColors[write.risk] || 'text-slate-500'}`}>{write.risk} risk</span>
                              </div>
                              <button
                                onClick={() => void toggleIntegrationAction(target.integrationId, write.id, enabled)}
                                disabled={savingAction === key}
                                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-cyan-500' : 'bg-slate-700'} ${savingAction === key ? 'opacity-50' : ''}`}
                              >
                                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!window.confirm(`Disconnecting ${target.integrationName} will stop this agent from sending and receiving messages through it. Continue?`)) return;
                      void runAgentAction(
                        activeWorkspaceAgent.id,
                        `disconnect:${target.integrationId}`,
                        async () => {
                          const disconnect = await api.integrations.disconnect(target.integrationId);
                          if (!disconnect.success) return disconnect;
                          await removeIntegration(activeWorkspaceAgent, target.integrationId);
                          return { success: true, data: { id: activeWorkspaceAgent.id } };
                        },
                        `${target.integrationName} disconnected.`
                      );
                    }}
                    className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/15"
                    disabled={actionBusy === `disconnect:${target.integrationId}`}
                  >
                    {actionBusy === `disconnect:${target.integrationId}` ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                  {activeWorkspaceAgent.publishStatus !== 'live' ? (
                    <button
                      onClick={() => void runAgentAction(
                        activeWorkspaceAgent.id,
                        `live:${activeWorkspaceAgent.id}`,
                        () => api.agents.goLive(activeWorkspaceAgent.id),
                        `${activeWorkspaceAgent.name} is now live.`
                      )}
                      className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/15 inline-flex items-center gap-1.5"
                      disabled={actionBusy === `live:${activeWorkspaceAgent.id}`}
                    >
                      <Play className="w-3 h-3" />
                      {actionBusy === `live:${activeWorkspaceAgent.id}` ? 'Going live…' : 'Go live'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddIntegration && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddIntegration(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/10">
              <div>
                <p className="font-semibold text-white text-sm">Connect a channel</p>
                <p className="text-xs text-slate-400 mt-0.5">Assign a connected provider to this agent</p>
              </div>
              <button onClick={() => setShowAddIntegration(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {addIntegrationLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading integrations…</span>
                </div>
              ) : availableIntegrations.length === 0 ? (
                <div className="py-6 px-2 text-center space-y-3">
                  <p className="text-sm text-slate-300 font-medium">No providers connected yet</p>
                  <p className="text-xs text-slate-400 leading-relaxed">Connect Slack, email, or another service first, then come back here to assign it to this agent.</p>
                  <button
                    onClick={() => { setShowAddIntegration(false); onPublishAgent?.(activeWorkspaceAgent, activeWorkspaceAgent.primaryPack || null); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-400/30 text-blue-300 text-xs font-semibold hover:bg-blue-500/25 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    Go to Integration Hub →
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableIntegrations.map((integration) => {
                    const alreadyAssigned = (activeWorkspaceAgent.integrationIds || []).includes(integration.id);
                    return (
                      <div key={integration.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                        <div>
                          <p className="text-sm font-medium text-white">{integration.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-wider">{integration.category}</p>
                        </div>
                        {alreadyAssigned ? (
                          <span className="text-xs text-emerald-400 font-medium">Assigned</span>
                        ) : (
                          <button
                            onClick={() => void assignIntegration(activeWorkspaceAgent, integration.id)}
                            className="rounded-lg bg-cyan-500/20 border border-cyan-400/30 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
                          >
                            Assign
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="pt-2 border-t border-white/10 text-center">
                    <button
                      onClick={() => { setShowAddIntegration(false); onPublishAgent?.(activeWorkspaceAgent, activeWorkspaceAgent.primaryPack || null); }}
                      className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      Don't see what you need? <span className="underline">Connect a new provider →</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
