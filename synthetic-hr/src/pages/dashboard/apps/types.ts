import type { MarketplaceApp } from '../../../lib/api-client';

export type AppStatus = 'connected' | 'syncing' | 'error' | 'expired' | 'disconnected';
export type ConnectorSource = 'marketplace' | 'integration';
export type TrustTier = 'observe-only' | 'controlled-write' | 'high-trust-operational';
export type Maturity = 'connected' | 'read-ready' | 'action-ready' | 'governed';
export type GuardrailStatus = 'not_applicable' | 'missing' | 'partial' | 'applied';
export type DrawerTab = 'overview' | 'agents' | 'history' | 'actions' | 'slack' | 'permissions';

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

export interface UnifiedApp {
  id: string;
  appId: string;
  name: string;
  description: string;
  category: string;
  source: ConnectorSource;
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
    duration_ms?: number | null;
  } | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
  created_at: string;
}
