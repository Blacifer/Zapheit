import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnifiedConnectorEntry = {
  /** Unique connector identifier, e.g. "salesforce", "zendesk" */
  id: string;
  app_key?: string;
  display_name?: string;
  name: string;
  description: string;
  category: string;
  logo: string;
  authType: 'oauth' | 'oauth2' | 'api_key' | 'free' | 'none';
  auth_type?: 'oauth' | 'oauth2' | 'api_key' | 'free' | 'none';
  /** Whether this connector has an OAuth install flow (marketplace) */
  hasOAuth: boolean;
  /** Whether this org has installed/connected this connector */
  installed: boolean;
  is_connected?: boolean;
  /** Connection status for installed connectors */
  connectionStatus: 'connected' | 'error' | 'expired' | 'syncing' | 'disconnected' | null;
  connection_status?: 'connected' | 'error' | 'expired' | 'syncing' | 'disconnected' | null;
  health_status?: 'healthy' | 'degraded' | 'not_connected' | 'unsupported' | string | null;
  supports_health_test?: boolean;
  health_test_mode?: 'direct' | 'adapter' | 'unsupported' | 'none' | string | null;
  /** Number of org agents linked to this connector */
  agentCount: number;
  linked_agent_count?: number;
  /** Last sync timestamp for installed connectors */
  lastSync: string | null;
  lastSyncAt?: string | null;
  lastErrorMsg?: string | null;
  /** Underlying integration record id (if installed via integrations system) */
  integrationId: string | null;
  /** Underlying marketplace app id (if installed via marketplace) */
  appId: string | null;
  /** Bundles this connector belongs to */
  bundles: string[];
  /** Source system: "marketplace" or "integration" */
  source: 'marketplace' | 'integration';
  comingSoon?: boolean;
  featured?: boolean;
  badge?: string;
  requiredFields?: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; required: boolean }>;
  permissions?: string[];
  actionsUnlocked?: string[];
  installCount?: number;
  setupTimeMinutes?: number;
  developer?: string;
  logoLetter?: string;
  colorHex?: string;
  connection_type?: 'native_connector' | 'oauth_connector' | 'mcp_server';
  supports_governed_actions?: boolean;
  supports_permissions?: boolean;
  supports_agent_linking?: boolean;
  linked_agent_ids?: string[];
  agent_capabilities?: string[];
  capability_policies?: Array<{
    capability: string;
    requires_human_approval: boolean;
    risk_level: 'low' | 'medium' | 'high';
    enabled: boolean;
  }>;
  mcp_tools?: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, any>;
    transport?: string;
    connector_id?: string;
  }>;
  logo_url?: string | null;
  logo_fallback?: string | null;
  credential_handling?: 'server_injected';
  primary_setup_mode?: 'oauth' | 'direct' | 'api_key';
  advanced_setup_modes?: Array<'oauth' | 'direct' | 'api_key'>;
  canonical_sources?: string[];
  primary_service_id?: string;
};

export type ConnectorAction = {
  name: string;
  label: string;
  description: string;
  requiresApproval: boolean;
  enabled: boolean;
  parameters: Record<string, {
    type: string;
    description: string;
    required: boolean;
    enum?: string[];
  }>;
};

export type ConnectorActionResult = {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  pending?: boolean;
  approvalId?: string;
};

export type ConnectorToolCallResult = {
  success: boolean;
  paused?: boolean;
  queued?: boolean;
  state?: 'pending_approval' | 'blocked' | 'executed' | string;
  approvalId?: string | null;
  decision?: 'allow' | 'block' | 'require_approval' | 'defer_reliability' | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
  audit_ref?: string | null;
  message?: string;
  result?: Record<string, any> | null;
  error?: string;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const unifiedConnectorsApi = {
  /**
   * Fetch the full connector catalog enriched with org install status.
   * Pass `domain` to filter by category (e.g. "hr", "sales", "it").
   */
  async getCatalog(domain?: string): Promise<ApiResponse<UnifiedConnectorEntry[]>> {
    const params = domain ? `?domain=${encodeURIComponent(domain)}` : '';
    return authenticatedFetch(`/connectors/catalog/unified${params}`, { method: 'GET' });
  },

  /**
   * Get the tool definitions available for a connector.
   * Returns an empty array for connectors without an action registry entry.
   */
  async getActions(connectorId: string): Promise<ApiResponse<ConnectorAction[]>> {
    return authenticatedFetch(`/connectors/${encodeURIComponent(connectorId)}/actions`, {
      method: 'GET',
    });
  },

  async getMcpTools(connectorId: string): Promise<ApiResponse<Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, any>;
    transport?: string;
    connector_id?: string;
  }>>> {
    return authenticatedFetch(`/connectors/${encodeURIComponent(connectorId)}/mcp-tools`, {
      method: 'GET',
    });
  },

  /**
   * Execute an action on a connected app on behalf of an agent or user.
   * Returns immediately with `pending: true` if the action requires approval.
   */
  async executeAction(
    connectorId: string,
    action: string,
    params: Record<string, any>,
    agentId?: string,
  ): Promise<ApiResponse<ConnectorActionResult>> {
    return authenticatedFetch(`/connectors/${encodeURIComponent(connectorId)}/execute`, {
      method: 'POST',
      body: JSON.stringify({ action, params, agentId }),
    });
  },

  async toolCall(
    connectorId: string,
    data: {
      action: string;
      params?: Record<string, any>;
      agentId?: string;
      toolName?: string;
    },
  ): Promise<ApiResponse<ConnectorToolCallResult>> {
    return authenticatedFetch(`/connectors/${encodeURIComponent(connectorId)}/tool-call`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Link or unlink a set of connectors to/from an agent.
   * Pass the full desired list of connector ids — backend replaces the current set.
   */
  async updateAgentConnectors(
    agentId: string,
    connectorIds: string[],
  ): Promise<ApiResponse<{ connectorIds: string[] }>> {
    return authenticatedFetch(`/agents/${encodeURIComponent(agentId)}/connectors`, {
      method: 'PATCH',
      body: JSON.stringify({ connectorIds }),
    });
  },
};
