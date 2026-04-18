import { useState, useEffect, useCallback, useRef } from 'react';
import type { AIAgent, ApiKey } from '../types';
import type { IntegrationSummaryRow, AgentConnectionDraft } from '../pages/dashboard/types';
import { guessPackForIntegration, type IntegrationPackId } from '../lib/integration-packs';
import { api } from '../lib/api-client';

// ── Storage helpers ───────────────────────────────────────────────────────────

const AGENT_WORKSPACE_FOCUS_STORAGE_KEY = 'synthetic_hr_agent_workspace_focus';

function getAgentConnectionStorageKey(orgName?: string | null) {
  return `synthetic_hr_agent_connections:${orgName || 'workspace'}`;
}

export function readAgentConnectionState(orgName?: string | null): Record<string, AgentConnectionDraft> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getAgentConnectionStorageKey(orgName));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, AgentConnectionDraft>) : {};
  } catch {
    return {};
  }
}

export function writeAgentConnectionState(
  orgName: string | null | undefined,
  state: Record<string, AgentConnectionDraft>,
) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getAgentConnectionStorageKey(orgName), JSON.stringify(state));
}

export function readFocusedAgentWorkspace(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { agentId?: string };
    return parsed?.agentId ? parsed.agentId : null;
  } catch {
    return null;
  }
}

export function writeFocusedAgentWorkspace(agentId: string | null | undefined) {
  if (typeof window === 'undefined') return;
  if (!agentId) {
    localStorage.removeItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AGENT_WORKSPACE_FOCUS_STORAGE_KEY, JSON.stringify({ agentId }));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseDashboardAgentConnectionsProps {
  orgName: string | null | undefined;
  agents: AIAgent[];
  liveAgents: AIAgent[];
  isDemoMode: boolean;
  mounted: boolean;
  navigateTo: (page: string, options?: { userInitiated?: boolean }) => void;
}

export function useDashboardAgentConnections({
  orgName,
  agents,
  liveAgents,
  isDemoMode,
  mounted,
  navigateTo,
}: UseDashboardAgentConnectionsProps) {
  const [agentConnections, setAgentConnections] = useState<Record<string, AgentConnectionDraft>>({});
  const [integrationRows, setIntegrationRows] = useState<IntegrationSummaryRow[]>([]);
  const [fleetWorkspaceAgentId, setFleetWorkspaceAgentId] = useState<string | null>(null);
  const [domainAgentPreselect, setDomainAgentPreselect] = useState<{
    packId: IntegrationPackId;
    agentId: string;
  } | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  const agentConnectionsInitialized = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (!mounted) return;
    setAgentConnections(readAgentConnectionState(orgName));
  }, [mounted, orgName]);

  // Initialise from live API data on first successful load
  useEffect(() => {
    if (isDemoMode || liveAgents.length === 0 || agentConnectionsInitialized.current) return;
    agentConnectionsInitialized.current = true;
    setAgentConnections(
      Object.fromEntries(
        liveAgents.map((agent) => [
          agent.id,
          {
            integrationIds: agent.integrationIds || [],
            primaryPack: agent.primaryPack || suggestPackForAgent(agent),
          },
        ]),
      ),
    );
  }, [liveAgents, isDemoMode]);

  // Load focused workspace on mount
  useEffect(() => {
    if (!mounted) return;
    const focusedAgentId = readFocusedAgentWorkspace();
    if (focusedAgentId) setFleetWorkspaceAgentId(focusedAgentId);
  }, [mounted]);

  // Persist focused workspace on change
  useEffect(() => {
    if (!mounted) return;
    writeFocusedAgentWorkspace(fleetWorkspaceAgentId);
  }, [fleetWorkspaceAgentId, mounted]);

  // Persist connections on change (live mode only)
  useEffect(() => {
    if (!mounted || isDemoMode) return;
    writeAgentConnectionState(orgName, agentConnections);
  }, [agentConnections, isDemoMode, mounted, orgName]);

  const suggestPackForAgent = useCallback((agent: AIAgent): IntegrationPackId => {
    const text = `${String(agent.agent_type || '').toLowerCase()} ${String(agent.name || '').toLowerCase()}`;
    if (text.includes('support') || text.includes('customer')) return 'support';
    if (text.includes('sales') || text.includes('lead') || text.includes('revenue')) return 'sales';
    if (text.includes('refund') || text.includes('finance') || text.includes('billing') || text.includes('payment')) return 'finance';
    if (text.includes('recruit') || text.includes('talent') || text.includes('hiring') || text.includes('hr')) return 'recruitment';
    if (text.includes('compliance') || text.includes('legal') || text.includes('policy')) return 'compliance';
    return 'it';
  }, []);

  const openIntegrationsForAgent = useCallback(
    (agent: AIAgent, _packId?: IntegrationPackId | null) => {
      setFleetWorkspaceAgentId(agent.id);
      writeFocusedAgentWorkspace(agent.id);
      navigateTo(`apps?agentId=${agent.id}`, { userInitiated: false });
    },
    [navigateTo],
  );

  const handleIntegrationConnected = useCallback(
    (payload: {
      agentId: string;
      integrationId: string;
      integrationName: string;
      packId: IntegrationPackId;
      status: string;
      lastSyncAt?: string | null;
    }) => {
      void api.agents.updatePublishState(payload.agentId, {
        publish_status: payload.status === 'connected' ? 'live' : 'ready',
        primary_pack: payload.packId,
        integration_ids: Array.from(
          new Set([
            ...(agentConnections[payload.agentId]?.integrationIds ||
              agents.find((a) => a.id === payload.agentId)?.integrationIds ||
              []),
            payload.integrationId,
          ]),
        ),
      });
      setAgentConnections((current) => {
        const existing = current[payload.agentId] || { integrationIds: [], primaryPack: payload.packId };
        const next = {
          ...current,
          [payload.agentId]: {
            integrationIds: Array.from(new Set([...existing.integrationIds, payload.integrationId])),
            primaryPack: existing.primaryPack || payload.packId,
          },
        };
        writeAgentConnectionState(orgName, next);
        return next;
      });
      setFleetWorkspaceAgentId(payload.agentId);
      writeFocusedAgentWorkspace(payload.agentId);
    },
    [agentConnections, agents, orgName],
  );

  // Derived: enrichedAgents merges live agent data with connection state
  const enrichedAgents = agents.map((agent) => {
    const connectionState = agentConnections[agent.id] || {
      integrationIds: agent.integrationIds || [],
      primaryPack: agent.primaryPack || suggestPackForAgent(agent),
    };
    const linkedIntegrations = connectionState.integrationIds
      .map((id) => integrationRows.find((row) => row.id === id))
      .filter(Boolean) as IntegrationSummaryRow[];
    const connectedTargets = linkedIntegrations.map((integration) => ({
      integrationId: integration.id,
      integrationName: integration.name,
      packId: guessPackForIntegration(integration),
      status: integration.lifecycleStatus || integration.status || 'disconnected',
      lastSyncAt: integration.lastSyncAt || null,
      lastActivityAt: integration.lastSyncAt || null,
    }));
    const connectedCount = connectedTargets.filter((t) => t.status === 'connected').length;
    const publishStatus =
      connectedTargets.length === 0 ? 'not_live' : connectedCount > 0 ? 'live' : 'ready';

    return {
      ...agent,
      publishStatus,
      primaryPack: connectionState.primaryPack || suggestPackForAgent(agent),
      integrationIds: connectionState.integrationIds,
      connectedTargets,
      lastIntegrationSyncAt: connectedTargets[0]?.lastSyncAt || null,
    } as AIAgent;
  });

  return {
    agentConnections,
    setAgentConnections,
    integrationRows,
    setIntegrationRows,
    fleetWorkspaceAgentId,
    setFleetWorkspaceAgentId,
    domainAgentPreselect,
    setDomainAgentPreselect,
    apiKeys,
    setApiKeys,
    suggestPackForAgent,
    openIntegrationsForAgent,
    handleIntegrationConnected,
    enrichedAgents,
  };
}
