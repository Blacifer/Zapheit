import type { MarketplaceApp } from '../../../lib/api-client';
import type { ConnectorCertification, ReadinessStatus } from '../../../lib/production-readiness';

export type AppStatus = 'connected' | 'syncing' | 'error' | 'expired' | 'disconnected';
export type ConnectorSource = 'marketplace' | 'integration';
export type AppConnectionType = 'native_connector' | 'oauth_connector' | 'mcp_server';
export type AppSetupMode = 'oauth' | 'direct' | 'api_key';
export type TrustTier = 'observe-only' | 'controlled-write' | 'high-trust-operational';
export type Maturity = 'connected' | 'read-ready' | 'action-ready' | 'governed';
export type GuardrailStatus = 'not_applicable' | 'missing' | 'partial' | 'applied';
export type HealthState = 'healthy' | 'degraded' | 'not_connected' | 'unsupported' | 'unknown';
export type DrawerTab = 'overview' | 'workspace' | 'agents' | 'capabilities' | 'approvals' | 'history' | 'slack' | 'permissions';

export interface RequiredField {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required: boolean;
}

export interface GovernanceSummary {
  readCount: number;
  actionCount: number;
  enabledActionCount: number;
}

export interface CapabilityPolicy {
  capability: string;
  requires_human_approval: boolean;
  risk_level: 'low' | 'medium' | 'high';
  enabled: boolean;
}

export interface UnifiedApp {
  id: string;
  appId: string;
  name: string;
  description: string;
  category: string;
  source: ConnectorSource;
  connectionType?: AppConnectionType;
  primarySetupMode?: AppSetupMode;
  advancedSetupModes?: AppSetupMode[];
  logoLetter: string;
  colorHex: string;
  badge?: string;
  installCount: number;
  comingSoon: boolean;
  connected: boolean;
  status: AppStatus;
  lastErrorMsg?: string | null;
  authType: 'free' | 'api_key' | 'oauth2';
  requiredFields?: RequiredField[];
  permissions?: string[];
  actionsUnlocked?: string[];
  setupTimeMinutes?: number;
  developer?: string;
  featured?: boolean;
  trustTier?: TrustTier;
  maturity?: Maturity;
  governanceSummary?: GovernanceSummary;
  wave?: number | null;
  wave1GuardrailsStatus?: GuardrailStatus;
  wave1GuardrailsApplied?: number;
  wave1GuardrailsTotal?: number;
  appData?: MarketplaceApp;
  integrationData?: any;
  rawCatalogData?: any;
  primaryServiceId?: string;
  linkedAgentCount?: number;
  supportsHealthTest?: boolean;
  healthStatus?: HealthState;
  healthTestMode?: 'direct' | 'adapter' | 'unsupported' | 'none' | string;
  logoUrl?: string | null;
  logoFallback?: string | null;
  agentCapabilities?: string[];
  capabilityPolicies?: CapabilityPolicy[];
  mcpTools?: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, any>;
    transport?: string;
    connector_id?: string;
  }>;
  secureCredentialHandling?: 'server_injected';
  readinessStatus?: ReadinessStatus;
  connectorCertification?: ConnectorCertification;
}

export interface ConnectionLog {
  id: string;
  action: string;
  status: string;
  message: string | null;
  created_at: string;
}

export interface ConnectorExecution {
  id: string;
  connector_id: string;
  action: string;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  approval_required: boolean;
  approval_id: string | null;
  params?: Record<string, any> | null;
  result?: Record<string, any> | null;
  requested_by?: string | null;
  policy_snapshot?: Record<string, any> | null;
  before_state?: Record<string, any> | null;
  after_state?: Record<string, any> | null;
  remediation?: Record<string, any> | null;
  governance?: {
    version: 1;
    source: 'gateway' | 'connector_console' | 'runtime';
    decision: 'executed' | 'pending_approval' | 'blocked';
    result: 'succeeded' | 'failed' | 'pending' | 'blocked';
    service: string;
    action: string;
    recorded_at: string;
    policy_id?: string | null;
    required_role?: string | null;
    approval_required?: boolean;
    approval_id?: string | null;
    block_reasons?: string[];
    approval_reasons?: string[];
    idempotency_key?: string | null;
    job_id?: string | null;
    agent_id?: string | null;
    requested_by?: string | null;
    delegated_actor?: string | null;
    audit_ref?: string | null;
    duration_ms?: number | null;
  } | null;
  decision?: 'allow' | 'block' | 'require_approval' | 'defer_reliability' | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
  delegated_actor?: string | null;
  audit_ref?: string | null;
  created_at: string;
}
