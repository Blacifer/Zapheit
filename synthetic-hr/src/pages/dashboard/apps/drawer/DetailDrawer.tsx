import { useState, useCallback, useEffect, useMemo } from 'react';
import { AlertCircle, CheckCircle2, Key, Loader2, RefreshCw, X, Zap } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { cn } from '../../../../lib/utils';
import type { AIAgent } from '../../../../types';
import type { UnifiedApp, ConnectionLog, ConnectorExecution, DrawerTab } from '../types';
import { isSlackRail } from '../helpers';
import { AppLogo } from '../components/AppLogo';
import { OverviewTab } from './OverviewTab';
import { AgentsTab } from './AgentsTab';
import { HistoryTab } from './HistoryTab';
import { ActionsTab } from './ActionsTab';
import { SlackTab } from './SlackTab';
import { PermissionsTab } from './PermissionsTab';

interface DetailDrawerProps {
  app: UnifiedApp;
  agents: AIAgent[];
  onClose: () => void;
  onConfigure: (app: UnifiedApp) => void;
  onDisconnect: (app: UnifiedApp) => void;
}

export function DetailDrawer({ app, agents, onClose, onConfigure, onDisconnect }: DetailDrawerProps) {
  const rawConnectorId = app.source === 'marketplace' ? app.appData?.id : app.integrationData?.id;
  const isSlack = isSlackRail(rawConnectorId);

  const [tab, setTab] = useState<DrawerTab>('overview');
  const [logs, setLogs] = useState<ConnectionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [executions, setExecutions] = useState<ConnectorExecution[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [seedingPolicies, setSeedingPolicies] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const linkedAgentIds = useState<Set<string>>(() => {
    if (!rawConnectorId) return new Set<string>();
    return new Set(agents.filter((a) => ((a as any).integrationIds || []).includes(rawConnectorId)).map((a) => a.id));
  })[0];

  const agentNames = useMemo(() => {
    if (app.source === 'marketplace' && app.appData) {
      const ids = new Set(app.appData.relatedAgentIds);
      return agents.filter((a) => ids.has(a.id)).map((a) => a.name);
    }
    if (app.source === 'integration') {
      const sid = app.integrationData?.id;
      return agents.filter((a) => ((a as any).integrationIds || []).includes(sid)).map((a) => a.name);
    }
    return [];
  }, [app, agents]);

  const toActionLabel = (name: string) =>
    name.split('__').pop()!.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const loadLogs = useCallback(async () => {
    if (app.source !== 'integration' || !app.integrationData?.id) return;
    setLogsLoading(true);
    const res = await api.integrations.getLogs(app.integrationData.id, 20);
    if (res.success) setLogs((res.data as ConnectionLog[]) || []);
    setLogsLoading(false);
  }, [app]);

  const loadExecutions = useCallback(async () => {
    if (!rawConnectorId) return;
    setExecutionsLoading(true);
    const res = await api.integrations.getExecutionHistory(rawConnectorId, 12);
    if (res.success) setExecutions((res.data as ConnectorExecution[]) || []);
    setExecutionsLoading(false);
  }, [rawConnectorId]);

  const loadCatalog = useCallback(async () => {
    if (!rawConnectorId) return;
    setCatalogLoading(true);
    if (app.source === 'marketplace') {
      const res = await api.unifiedConnectors.getActions(rawConnectorId);
      if (res.success) {
        const tools = (res.data as any[]) || [];
        setCatalog(tools.map((t: any) => ({
          action: t.function?.name?.split('__').pop() ?? t.function?.name,
          label: toActionLabel(t.function?.name ?? ''),
          description: t.function?.description,
          enabled: true,
          service: rawConnectorId,
        })));
      }
    } else {
      const res = await api.integrations.getActionCatalog();
      if (res.success) {
        const sid = app.integrationData?.id;
        setCatalog(((res.data as any[]) || []).filter((a) => !sid || a.service === sid || !a.service));
      }
    }
    setCatalogLoading(false);
  }, [app, rawConnectorId]);

  useEffect(() => {
    if (tab === 'history') {
      void loadLogs();
      void loadExecutions();
    }
    if (tab === 'actions') void loadCatalog();
  }, [tab, loadLogs, loadExecutions, loadCatalog]);

  const testConnection = async () => {
    if (!app.integrationData?.id) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await api.integrations.test(app.integrationData.id);
      setTestResult({ ok: !!res.success, msg: res.success ? 'Connection is healthy' : ((res as any).error || 'Test failed') });
    } catch { setTestResult({ ok: false, msg: 'Test failed' }); }
    setTesting(false);
  };

  const refreshToken = async () => {
    if (!app.integrationData?.id) return;
    setRefreshing(true);
    const res = await api.integrations.refresh(app.integrationData.id);
    if (res.success) toast.success('Token refreshed');
    else toast.error((res as any).error || 'Refresh failed');
    setRefreshing(false);
  };

  const toggleAction = async (item: any) => {
    const res = await api.integrations.upsertActions([{
      service: item.service || app.integrationData?.id,
      action: item.action,
      enabled: !item.enabled,
    }]);
    if (res.success) setCatalog((p: any[]) => p.map((a: any) => a.action === item.action ? { ...a, enabled: !a.enabled } : a));
    else toast.error('Failed to update action');
  };

  const seedWave1Policies = async () => {
    if (!rawConnectorId) return;
    setSeedingPolicies(true);
    const res = await api.integrations.seedWave1Policies([rawConnectorId]);
    if (res.success) {
      toast.success('Recommended Wave 1 guardrails applied');
      await loadCatalog();
    } else {
      toast.error((res as any).error || 'Failed to apply recommended guardrails');
    }
    setSeedingPolicies(false);
  };

  const handleDisconnect = async () => {
    await onDisconnect(app);
    onClose();
  };

  const TABS: Array<{ id: DrawerTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    ...(app.connected ? [{ id: 'agents' as DrawerTab, label: `Agents (${linkedAgentIds.size})` }] : []),
    ...(app.connected ? [{ id: 'history' as DrawerTab, label: 'Execution History' }] : []),
    ...(rawConnectorId ? [{ id: 'actions' as DrawerTab, label: 'Actions' }] : []),
    ...(isSlack && app.connected ? [{ id: 'slack' as DrawerTab, label: 'Slack Inbox' }] : []),
    ...(app.connected && app.actionsUnlocked && app.actionsUnlocked.length > 0 ? [{ id: 'permissions' as DrawerTab, label: 'Permissions' }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button className="flex-1 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />

      {/* Panel */}
      <div className="w-[480px] max-w-[95vw] h-full bg-[#0e1117] border-l border-white/10 flex flex-col">

        {/* Header */}
        <div className="flex items-start gap-4 p-5 border-b border-white/8 shrink-0">
          <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-bold text-white">{app.name}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-500 font-medium">
                {app.source === 'marketplace' ? 'App' : 'Integration'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {app.status === 'connected' && (
                <span className="text-xs font-medium text-emerald-400">Connected</span>
              )}
              {app.status === 'syncing' && (
                <span className="flex items-center gap-1 text-xs text-amber-300 font-medium">
                  <Loader2 className="w-3 h-3 animate-spin" />Syncing
                </span>
              )}
              {(app.status === 'error' || app.status === 'expired') && (
                <span className="flex items-center gap-1 text-xs text-rose-300 font-medium">
                  <AlertCircle className="w-3 h-3" />
                  {app.status === 'expired' ? 'Token expired' : 'Error'}
                </span>
              )}
              {app.actionsUnlocked && app.actionsUnlocked.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Zap className="w-3 h-3 text-amber-400" />{app.actionsUnlocked.length} actions
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-5 py-3 border-b border-white/8 shrink-0">
          {app.connected ? (
            <>
              <button
                onClick={() => onConfigure(app)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                {app.authType === 'oauth2' ? 'Reauthorize' : 'Update credentials'}
              </button>
              {app.source === 'integration' && (
                <button
                  onClick={() => void testConnection()}
                  disabled={testing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Test
                </button>
              )}
              {app.source === 'integration' && app.authType === 'oauth2' && (
                <button
                  onClick={() => void refreshToken()}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Refresh token
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => onConfigure(app)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />Connect
            </button>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn(
            'mx-5 mt-3 px-3 py-2 rounded-xl border text-xs',
            testResult.ok
              ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-400/20 bg-rose-500/10 text-rose-200'
          )}>
            {testResult.msg}
          </div>
        )}

        {/* Tabs */}
        {TABS.length > 1 && (
          <div className="flex gap-1 px-5 pt-3 shrink-0 flex-wrap">
            {TABS.map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  tab === id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                )}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'overview' && (
            <OverviewTab
              app={app}
              agentNames={agentNames}
              onConfigure={onConfigure}
              onDisconnect={(_a) => handleDisconnect()}
            />
          )}
          {tab === 'agents' && (
            <AgentsTab
              agents={agents}
              rawConnectorId={rawConnectorId}
              initialLinkedIds={linkedAgentIds}
            />
          )}
          {tab === 'history' && (
            <HistoryTab
              app={app}
              executions={executions}
              logs={logs}
              executionsLoading={executionsLoading}
              logsLoading={logsLoading}
              onRefresh={() => { void loadLogs(); void loadExecutions(); }}
            />
          )}
          {tab === 'actions' && (
            <ActionsTab
              app={app}
              catalog={catalog}
              catalogLoading={catalogLoading}
              seedingPolicies={seedingPolicies}
              onToggleAction={(item) => void toggleAction(item)}
              onSeedWave1={() => void seedWave1Policies()}
            />
          )}
          {tab === 'slack' && rawConnectorId && (
            <SlackTab serviceId={rawConnectorId} />
          )}
          {tab === 'permissions' && (
            <PermissionsTab app={app} />
          )}
        </div>
      </div>
    </div>
  );
}
