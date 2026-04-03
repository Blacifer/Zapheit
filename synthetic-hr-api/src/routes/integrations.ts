import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '../lib/logger';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, in_, supabaseRestAsService, supabaseRestAsUser } from '../lib/supabase-rest';
import { encryptSecret, decryptSecret } from '../lib/integrations/encryption';
import { IMPLEMENTED_INTEGRATIONS, getIntegrationSpec } from '../lib/integrations/spec-registry';
import { getAdapter } from '../lib/integrations/adapters';
import { normalizeGovernedActionSummary } from '../lib/governed-actions';
import type {
  IntegrationActionOperation,
  IntegrationActionRisk,
  IntegrationMaturity,
  IntegrationPackId,
  IntegrationTrustTier,
  IntegrationWriteCapability,
} from '../lib/integrations/spec-types';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

type RestOptions = { method?: string; body?: any; headers?: Record<string, string> };
type RestFn = (table: string, query: string | URLSearchParams, options?: RestOptions) => Promise<any>;

const restAsUser = (req: any): RestFn => {
  const jwt = getUserJwt(req);
  return (table, query, options = {}) => supabaseRestAsUser(jwt, table, query, options);
};

const restAsService: RestFn = (table, query, options = {}) => supabaseRestAsService(table, query, options);

type IntegrationStatus = 'disconnected' | 'configured' | 'connected' | 'error' | 'syncing' | 'expired';

type StoredIntegrationRow = {
  id: string;
  organization_id: string;
  service_type: string;
  service_name: string;
  category: string;
  status: IntegrationStatus;
  auth_type: string;
  ai_enabled: boolean;
  last_sync_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  enabled_capabilities: string[] | null;
  created_at: string;
  updated_at: string;
};

type StoredCredentialRow = {
  id: string;
  integration_id: string;
  key: string;
  value: string;
  is_sensitive: boolean;
  expires_at: string | null;
  label: string | null;
  last_rotated: string | null;
  created_at: string;
  updated_at: string;
};

type StoredConnectionLogRow = {
  id: string;
  integration_id: string;
  action: string;
  status: string;
  message: string | null;
  metadata: any;
  created_at: string;
};

type StoredActionPolicyRow = {
  id: string;
  organization_id: string;
  service: string;
  action: string;
  enabled: boolean;
  require_approval: boolean;
  required_role: string;
  notes: string | null;
  policy_constraints?: Record<string, any> | null;
  updated_by: string | null;
  updated_at: string;
};

type Wave1PolicySeed = {
  service: string;
  action: string;
  enabled: boolean;
  require_approval: boolean;
  required_role: 'viewer' | 'manager' | 'admin' | 'super_admin';
  notes: string;
  policy_constraints?: Record<string, any>;
};

type Wave1GuardrailStatus = 'not_applicable' | 'missing' | 'partial' | 'applied';

type StoredConnectorExecutionRow = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  integration_id: string | null;
  connector_id: string;
  action: string;
  params: Record<string, any> | null;
  result: Record<string, any> | null;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  approval_required: boolean;
  approval_id: string | null;
  requested_by?: string | null;
  policy_snapshot?: Record<string, any> | null;
  before_state?: Record<string, any> | null;
  after_state?: Record<string, any> | null;
  remediation?: Record<string, any> | null;
  created_at: string;
  reliability_state?: 'queued_for_retry' | 'paused_by_circuit_breaker' | 'recovered' | 'ok' | null;
  retry_count?: number | null;
  next_retry_at?: string | null;
  breaker_open?: boolean | null;
  recovered_at?: string | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
  decision?: 'allow' | 'block' | 'require_approval' | 'defer_reliability' | null;
  delegated_actor?: string | null;
  audit_ref?: string | null;
};

type StoredRetryQueueRow = {
  connector_id: string;
  action: string;
  attempt_count: number | null;
  next_attempt_at: string | null;
  status: string;
  updated_at: string | null;
};

type StoredCircuitBreakerRow = {
  connector_id: string;
  state: 'closed' | 'open' | 'half_open';
  opened_at: string | null;
};

type StoredAgentRow = {
  id: string;
  organization_id: string;
  metadata?: Record<string, any> | null;
};

type AgentPublishStatus = 'not_live' | 'ready' | 'live';
type AgentPackId = IntegrationPackId;

function operationForCapability(capability: Pick<IntegrationWriteCapability, 'id' | 'label' | 'operation'>): IntegrationActionOperation {
  if (capability.operation) return capability.operation;
  const text = `${capability.id} ${capability.label}`.toLowerCase();
  if (text.includes('reconcile') || text.includes('settlement')) return 'reconcile';
  if (text.includes('approve') || text.includes('decide')) return 'approve';
  if (text.includes('create') || text.includes('send') || text.includes('file') || text.includes('post') || text.includes('initiate')) return 'create';
  if (text.includes('update') || text.includes('status') || text.includes('assign') || text.includes('revoke') || text.includes('suspend')) return 'update';
  if (text.includes('delete') || text.includes('remove')) return 'delete';
  if (text.includes('search') || text.includes('get') || text.includes('check')) return 'read';
  return 'execute';
}

function objectTypeForCapability(capability: Pick<IntegrationWriteCapability, 'id' | 'label' | 'objectType'>): string {
  if (capability.objectType) return capability.objectType;
  const text = `${capability.id} ${capability.label}`.toLowerCase();
  if (text.includes('refund')) return 'refund';
  if (text.includes('payout')) return 'payout';
  if (text.includes('ticket')) return 'ticket';
  if (text.includes('lead')) return 'lead';
  if (text.includes('user')) return 'user';
  if (text.includes('access')) return 'access';
  if (text.includes('candidate')) return 'candidate';
  if (text.includes('filing') || text.includes('gst') || text.includes('tds')) return 'filing';
  return 'record';
}

function trustTierForRisk(risk: IntegrationActionRisk): IntegrationTrustTier {
  if (risk === 'high' || risk === 'money') return 'high-trust-operational';
  if (risk === 'medium') return 'controlled-write';
  return 'observe-only';
}

function defaultConstraintsForCapability(capability: Pick<IntegrationWriteCapability, 'risk' | 'constraints'>, category: string): string[] {
  if (capability.constraints?.length) return capability.constraints;
  const constraints: string[] = [];
  if (capability.risk === 'money') constraints.push('Requires monetary threshold policy');
  if (capability.risk === 'high') constraints.push('Recommended dual approval for privileged actions');
  const normalizedCategory = String(category || '').toUpperCase();
  if (normalizedCategory === 'FINANCE' || normalizedCategory === 'PAYMENTS') constraints.push('Log sanitized before/after transaction evidence');
  if (normalizedCategory === 'IAM' || normalizedCategory === 'IDENTITY') constraints.push('Restrict to approved identities or groups');
  if (normalizedCategory === 'COMPLIANCE') constraints.push('Capture approval rationale and evidence export metadata');
  return constraints;
}

function maturityForIntegration(args: {
  lifecycleStatus: string;
  specTrustTier: IntegrationTrustTier;
  writes: IntegrationWriteCapability[];
  policyEnabledCount: number;
}): IntegrationMaturity {
  const { lifecycleStatus, specTrustTier, writes, policyEnabledCount } = args;
  if (lifecycleStatus === 'not_configured') return 'connected';
  if (writes.length === 0) return 'read-ready';
  if (specTrustTier === 'high-trust-operational' && policyEnabledCount > 0) return 'governed';
  if (lifecycleStatus === 'connected' || lifecycleStatus === 'configured') return 'action-ready';
  return 'connected';
}

function sanitizeIntegrationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function packIdFromCategory(category: string | null | undefined): AgentPackId {
  const normalized = String(category || '').toUpperCase();
  if (normalized === 'COMPLIANCE') return 'compliance';
  if (normalized === 'FINANCE' || normalized === 'PAYROLL' || normalized === 'GLOBAL_PAYROLL' || normalized === 'PAYMENTS') return 'finance';
  if (normalized === 'SUPPORT' || normalized === 'ITSM' || normalized === 'COMMUNICATION') return 'support';
  if (normalized === 'CRM') return 'sales';
  if (normalized === 'IAM' || normalized === 'IDENTITY' || normalized === 'COLLABORATION' || normalized === 'PRODUCTIVITY') return 'it';
  if (normalized === 'RECRUITMENT' || normalized === 'ATS' || normalized === 'HRMS') return 'recruitment';
  return 'it';
}

function readAgentPublish(agent: StoredAgentRow) {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
  const publish = metadata.publish && typeof metadata.publish === 'object' ? metadata.publish : {};
  return {
    publish_status: publish.publish_status as AgentPublishStatus | undefined,
    primary_pack: (publish.primary_pack ?? null) as AgentPackId | null,
    integration_ids: sanitizeIntegrationIds(publish.integration_ids),
  };
}

function writeAgentPublish(agent: StoredAgentRow, updates: {
  publish_status: AgentPublishStatus;
  primary_pack: AgentPackId | null;
  integration_ids: string[];
}) {
  const metadata = agent?.metadata && typeof agent.metadata === 'object' ? { ...agent.metadata } : {};
  metadata.publish = updates;
  return metadata;
}

const WAVE1_POLICY_DEFAULTS: Wave1PolicySeed[] = [
  {
    service: 'razorpay',
    action: 'finance.payment.list',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: allow finance operators to inspect Razorpay payments without extra approval.',
  },
  {
    service: 'razorpay',
    action: 'finance.settlement.check',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: settlement review is enabled for reconciliation workflows.',
  },
  {
    service: 'razorpay',
    action: 'finance.refund.create',
    enabled: true,
    require_approval: true,
    required_role: 'manager',
    notes: 'Wave 1 default: Razorpay refunds require approval and threshold-based escalation.',
    policy_constraints: {
      amount_field: 'amount',
      amount_threshold: 500000,
      threshold_required_role: 'admin',
      business_hours: { start: '09:00', end: '20:00', utc_offset: '+05:30' },
    },
  },
  {
    service: 'paytm',
    action: 'finance.payment.status',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: Paytm payment status checks are enabled for finance monitoring.',
  },
  {
    service: 'paytm',
    action: 'finance.refund.create',
    enabled: true,
    require_approval: true,
    required_role: 'manager',
    notes: 'Wave 1 default: Paytm refunds require approval and finance thresholds.',
    policy_constraints: {
      amount_field: 'amount',
      amount_threshold: 500000,
      threshold_required_role: 'admin',
      business_hours: { start: '09:00', end: '20:00', utc_offset: '+05:30' },
    },
  },
  {
    service: 'paytm',
    action: 'finance.payout.initiate',
    enabled: true,
    require_approval: true,
    required_role: 'admin',
    notes: 'Wave 1 default: Paytm payouts require dual approval and strict finance oversight.',
    policy_constraints: {
      amount_field: 'amount',
      amount_threshold: 1000000,
      threshold_required_role: 'super_admin',
      business_hours: { start: '09:00', end: '18:00', utc_offset: '+05:30' },
      dual_approval: true,
    },
  },
  {
    service: 'tally',
    action: 'finance.ledger.read',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: ledger reads are enabled for finance investigation and reconciliation.',
  },
  {
    service: 'tally',
    action: 'finance.voucher.reconcile',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: voucher reconciliation is enabled with audit evidence.',
    policy_constraints: {
      business_hours: { start: '08:00', end: '20:00', utc_offset: '+05:30' },
    },
  },
  {
    service: 'tally',
    action: 'finance.voucher.post',
    enabled: true,
    require_approval: true,
    required_role: 'admin',
    notes: 'Wave 1 default: posting vouchers requires dual approval and threshold controls.',
    policy_constraints: {
      amount_field: 'amount',
      amount_threshold: 250000,
      threshold_required_role: 'super_admin',
      dual_approval: true,
      business_hours: { start: '09:00', end: '18:00', utc_offset: '+05:30' },
    },
  },
  {
    service: 'slack',
    action: 'comms.channel.history',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: allow governed channel history reads for investigations.',
  },
  {
    service: 'slack',
    action: 'comms.message.send',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: controlled Slack outbound communication is enabled for operators.',
    policy_constraints: {
      business_hours: { start: '08:00', end: '22:00', utc_offset: '+05:30' },
    },
  },
  {
    service: 'slack',
    action: 'comms.channel.create',
    enabled: true,
    require_approval: true,
    required_role: 'admin',
    notes: 'Wave 1 default: new Slack channels require admin review.',
  },
  {
    service: 'naukri',
    action: 'recruitment.candidate.search',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: candidate search is enabled for recruiters.',
  },
  {
    service: 'naukri',
    action: 'recruitment.resume.parse',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: resume parsing is enabled with evidence capture.',
  },
  {
    service: 'naukri',
    action: 'recruitment.job.publish',
    enabled: true,
    require_approval: true,
    required_role: 'admin',
    notes: 'Wave 1 default: publishing jobs requires recruiter/admin approval.',
    policy_constraints: {
      business_hours: { start: '09:00', end: '19:00', utc_offset: '+05:30' },
    },
  },
  {
    service: 'cleartax',
    action: 'compliance.status.check',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: compliance posture checks are enabled for operators.',
  },
  {
    service: 'cleartax',
    action: 'compliance.notice.read',
    enabled: true,
    require_approval: false,
    required_role: 'admin',
    notes: 'Wave 1 default: tax notice review is enabled and auditable.',
  },
  {
    service: 'cleartax',
    action: 'compliance.tds.calculate',
    enabled: true,
    require_approval: false,
    required_role: 'manager',
    notes: 'Wave 1 default: TDS calculation is enabled with request/result evidence.',
  },
  {
    service: 'cleartax',
    action: 'compliance.gst.file',
    enabled: true,
    require_approval: true,
    required_role: 'admin',
    notes: 'Wave 1 default: GST filing requires dual approval and compliance evidence.',
    policy_constraints: {
      dual_approval: true,
      business_hours: { start: '09:00', end: '18:00', utc_offset: '+05:30' },
    },
  },
];

const WAVE1_SERVICES = new Set(Array.from(new Set(WAVE1_POLICY_DEFAULTS.map((seed) => seed.service))));

async function pruneDisconnectedIntegrationFromAgents(rest: RestFn, orgId: string, serviceType: string) {
  const agentsQuery = new URLSearchParams();
  agentsQuery.set('organization_id', eq(orgId));
  agentsQuery.set('select', 'id,organization_id,metadata');
  const agents = await safeQuery<StoredAgentRow>(rest, 'ai_agents', agentsQuery);
  if (!agents.length) return;

  const integrationQuery = new URLSearchParams();
  integrationQuery.set('organization_id', eq(orgId));
  integrationQuery.set('select', 'service_type,status,category');
  const integrations = await safeQuery<Array<{ service_type: string; status: string; category: string }>[number]>(rest, 'integrations', integrationQuery);
  const integrationMap = new Map(integrations.map((row) => [row.service_type, row]));

  await Promise.all(agents.map(async (agent) => {
    const publish = readAgentPublish(agent);
    if (!publish.integration_ids.includes(serviceType)) return;

    const remainingIntegrationIds = publish.integration_ids.filter((integrationId) => integrationId !== serviceType);
    const remainingRows = remainingIntegrationIds
      .map((integrationId) => integrationMap.get(integrationId))
      .filter(Boolean) as Array<{ service_type: string; status: string; category: string }>;

    const publishStatus: AgentPublishStatus = remainingRows.length === 0
      ? 'not_live'
      : remainingRows.some((row) => row.status === 'connected')
        ? 'live'
        : 'ready';

    const primaryPack = remainingRows[0] ? packIdFromCategory(remainingRows[0].category) : null;
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(agent.id));
    patchQuery.set('organization_id', eq(orgId));
    await rest('ai_agents', patchQuery, {
      method: 'PATCH',
      body: {
        metadata: writeAgentPublish(agent, {
          publish_status: publishStatus,
          primary_pack: primaryPack,
          integration_ids: remainingIntegrationIds,
        }),
        updated_at: new Date().toISOString(),
      },
    });
  }));
}

async function safeQuery<T>(rest: RestFn, table: string, query: URLSearchParams): Promise<T[]> {
  try {
    return (await rest(table, query)) as T[];
  } catch (err: any) {
    if (err instanceof SupabaseRestError) {
      // Missing table (migration not applied) or policy issues should not crash the UI.
      logger.warn('Integration route supabase query failed', { table, status: err.status });
      return [];
    }
    logger.warn('Integration route query failed', { table, error: err?.message || String(err) });
    return [];
  }
}

async function upsertIntegration(rest: RestFn, orgId: string, serviceType: string, updates: Partial<StoredIntegrationRow>) {
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(serviceType));
  query.set('select', '*');
  const existing = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);

  const now = new Date().toISOString();
  if (existing.length > 0) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(existing[0].id));
    const patched = await rest('integrations', patchQuery, {
      method: 'PATCH',
      body: {
        ...updates,
        updated_at: now,
      },
    }) as any[];
    return patched?.[0] || existing[0];
  }

  const spec = getIntegrationSpec(serviceType);
  const created = await rest('integrations', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      service_type: serviceType,
      service_name: spec?.name || serviceType,
      category: spec?.category || 'OTHER',
      status: 'connected',
      auth_type: spec?.authType || 'api_key',
      ai_enabled: Boolean(spec?.aiFeatures?.enabled),
      ...updates,
      created_at: now,
      updated_at: now,
    },
  }) as any[];
  return created?.[0] || null;
}

async function upsertCredential(rest: RestFn, integrationId: string, key: string, value: string, isSensitive = true, expiresAt?: string | null) {
  const query = new URLSearchParams();
  query.set('integration_id', eq(integrationId));
  query.set('key', eq(key));
  query.set('select', '*');
  const existing = await safeQuery<StoredCredentialRow>(rest, 'integration_credentials', query);
  const now = new Date().toISOString();
  const payload = {
    integration_id: integrationId,
    key,
    value,
    is_sensitive: isSensitive,
    expires_at: expiresAt || null,
    updated_at: now,
  };

  if (existing.length > 0) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(existing[0].id));
    const patched = await rest('integration_credentials', patchQuery, { method: 'PATCH', body: payload }) as any[];
    return patched?.[0] || existing[0];
  }

  const created = await rest('integration_credentials', '', {
    method: 'POST',
    body: {
      ...payload,
      created_at: now,
    },
  }) as any[];

  return created?.[0] || null;
}

async function readCredentials(rest: RestFn, integrationId: string) {
  const query = new URLSearchParams();
  query.set('integration_id', eq(integrationId));
  query.set('select', 'key,value,is_sensitive,expires_at');
  const rows = await safeQuery<Pick<StoredCredentialRow, 'key' | 'value' | 'is_sensitive' | 'expires_at'>>(rest, 'integration_credentials', query);
  const out: Record<string, string> = {};
  rows.forEach((row) => {
    out[row.key] = row.is_sensitive ? decryptSecret(row.value) : row.value;
  });
  return out;
}

function toServiceAliases(service: string) {
  const normalized = String(service || '').trim();
  const aliases = new Set<string>([normalized]);
  if (normalized.includes('_')) aliases.add(normalized.replace(/_/g, '-'));
  if (normalized.includes('-')) aliases.add(normalized.replace(/-/g, '_'));
  return Array.from(aliases);
}

async function writeConnectionLog(
  rest: RestFn,
  integrationId: string,
  action: string,
  status: 'success' | 'failed',
  message?: string,
  metadata?: Record<string, any>
) {
  try {
    await rest('integration_connection_logs', '', {
      method: 'POST',
      body: {
        integration_id: integrationId,
        action,
        status,
        message: message || null,
        metadata: metadata || {},
        created_at: new Date().toISOString(),
      },
    }) as StoredConnectionLogRow[];
  } catch (err: any) {
    // Never break primary flows for logging failures.
    logger.warn('Failed to write integration connection log', { integrationId, action, error: err?.message || String(err) });
  }
}

async function upsertActionPolicy(
  rest: RestFn,
  orgId: string,
  service: string,
  action: string,
  updates: Partial<StoredActionPolicyRow>
) {
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service', eq(service));
  query.set('action', eq(action));
  query.set('select', '*');
  const existing = await safeQuery<StoredActionPolicyRow>(rest, 'action_policies', query);

  const now = new Date().toISOString();
  if (existing.length > 0) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(existing[0].id));
    const patched = await rest('action_policies', patchQuery, {
      method: 'PATCH',
      body: {
        ...updates,
        updated_at: now,
      },
    }) as any[];
    return patched?.[0] || existing[0];
  }

  const created = await rest('action_policies', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      service,
      action,
      enabled: updates.enabled ?? true,
      require_approval: updates.require_approval ?? true,
      required_role: updates.required_role ?? 'manager',
      notes: updates.notes ?? null,
      policy_constraints: updates.policy_constraints ?? {},
      updated_by: (updates as any).updated_by ?? null,
      updated_at: now,
    },
  }) as any[];
  return created?.[0] || null;
}

async function applyWave1Policies(
  rest: RestFn,
  orgId: string,
  userId: string | null,
  services?: string[],
) {
  const serviceFilter = services?.length ? new Set(services) : null;
  const selectedSeeds = WAVE1_POLICY_DEFAULTS.filter((seed) => !serviceFilter || serviceFilter.has(seed.service));
  const updatedPolicies: any[] = [];

  for (const seed of selectedSeeds) {
    const row = await upsertActionPolicy(rest, orgId, seed.service, seed.action, {
      enabled: seed.enabled,
      require_approval: seed.require_approval,
      required_role: seed.required_role,
      notes: seed.notes,
      policy_constraints: seed.policy_constraints || {},
      updated_by: userId,
    });
    if (row) updatedPolicies.push(row);
  }

  return updatedPolicies;
}

function getApiBaseUrl(req: any): string {
  const fromEnv = process.env.API_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.replace(/\/+$/, '');

  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.startsWith('//')) return null;
  return trimmed;
}

function normalizeDomainInput(value: string): string {
  let v = value.trim();
  v = v.replace(/^https?:\/\//i, '');
  v = v.replace(/\/.*$/, '');
  return v;
}

function resolveUrlTemplate(template: string, connection: Record<string, string>) {
  let out = template;
  Object.entries(connection).forEach(([k, v]) => {
    out = out.split(`{${k}}`).join(encodeURIComponent(v));
  });
  return out;
}

async function signOAuthState(payload: Record<string, any>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret);
}

async function verifyOAuthState(token: string): Promise<Record<string, any> | null> {
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
    const verified = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return verified.payload as any;
  } catch (err: any) {
    logger.warn('OAuth state verification failed', { error: err?.message || String(err) });
    return null;
  }
}

async function postForm(url: string, data: Record<string, string>, extraHeaders?: Record<string, string>): Promise<any> {
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => body.set(k, v));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(extraHeaders || {}) },
    body,
  });

  const raw = await res.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = { raw };
  }

  if (!res.ok || (json && json.error && !json.access_token)) {
    const message = json?.error_description || json?.error || json?.message || `Token exchange failed (${res.status})`;
    logger.warn('OAuth token exchange error', { url, status: res.status, body: raw.slice(0, 500) });
    throw new Error(message);
  }

  return json;
}

async function buildOAuthAuthorizeUrl(params: {
  req: any;
  orgId: string;
  userId: string | null;
  service: string;
  returnTo: string;
  spec: any;
  connection: Record<string, string>;
}): Promise<{ url: string }> {
  const { req, orgId, userId, service, returnTo, spec, connection } = params;
  const apiBase = getApiBaseUrl(req);
  const redirectUri = `${apiBase}${spec.oauthConfig.redirectPath}`;

  const needsPkce = service === 'salesforce';
  const codeVerifier = needsPkce ? crypto.randomBytes(32).toString('base64url') : undefined;

  const state = await signOAuthState({
    orgId,
    userId,
    service,
    returnTo,
    connection,
    nonce: crypto.randomUUID(),
    ...(codeVerifier ? { codeVerifier } : {}),
  });

  const oauthResolvedAuthUrl = resolveUrlTemplate(spec.oauthConfig.authorizationUrl, connection);
  const authUrl = new URL(oauthResolvedAuthUrl);

  let clientIdEnv = '';
  const needsOffline = ['zoho_people', 'zoho_recruit', 'zoho_learn', 'google_workspace', 'microsoft_365', 'teams', 'deel', 'gusto', 'flock', 'okta', 'digilocker'].includes(service);

  if (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') clientIdEnv = 'ZOHO_CLIENT_ID';
  else if (service === 'linkedin') clientIdEnv = 'LINKEDIN_CLIENT_ID';
  else if (service === 'digilocker') clientIdEnv = 'DIGILOCKER_CLIENT_ID';
  else if (service === 'google_workspace') clientIdEnv = 'GOOGLE_CLIENT_ID';
  else if (service === 'microsoft_365' || service === 'teams') clientIdEnv = 'MICROSOFT_CLIENT_ID';
  else if (service === 'slack') clientIdEnv = 'SLACK_CLIENT_ID';
  else if (service === 'deel') clientIdEnv = 'DEEL_CLIENT_ID';
  else if (service === 'gusto') clientIdEnv = 'GUSTO_CLIENT_ID';
  else if (service === 'flock') clientIdEnv = 'FLOCK_CLIENT_ID';
  else if (service === 'okta') clientIdEnv = 'OKTA_CLIENT_ID';
  else if (service === 'salesforce') clientIdEnv = 'SALESFORCE_CLIENT_ID';
  else if (service === 'intercom') clientIdEnv = 'INTERCOM_CLIENT_ID';
  else if (service === 'quickbooks') clientIdEnv = 'QUICKBOOKS_CLIENT_ID';
  else throw new Error('OAuth provider not implemented');

  const clientId = process.env[clientIdEnv];
  if (!clientId) throw new Error(`${clientIdEnv} is not configured`);

  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  if (spec.oauthConfig.scopes.length > 0) {
    authUrl.searchParams.set('scope', spec.oauthConfig.scopes.join(' '));
  }

  if (service === 'google_workspace') {
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
  }
  if (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') {
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
  }
  if (needsOffline && (service === 'microsoft_365' || service === 'teams')) {
    authUrl.searchParams.set('prompt', 'consent');
  }
  if (service === 'okta') {
    authUrl.searchParams.set('nonce', crypto.randomUUID());
  }
  if (needsPkce && codeVerifier) {
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
  }

  return { url: authUrl.toString() };
}

function oauthEnvKeysForService(service: string): string[] {
  switch (service) {
    case 'zoho_people':
    case 'zoho_recruit':
    case 'zoho_learn':
      return ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET'];
    case 'linkedin':
      return ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'];
    case 'digilocker':
      return ['DIGILOCKER_CLIENT_ID', 'DIGILOCKER_CLIENT_SECRET'];
    case 'google_workspace':
      return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    case 'microsoft_365':
    case 'teams':
      return ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'];
    case 'slack':
      return ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'];
    case 'deel':
      return ['DEEL_CLIENT_ID', 'DEEL_CLIENT_SECRET'];
    case 'gusto':
      return ['GUSTO_CLIENT_ID', 'GUSTO_CLIENT_SECRET'];
    case 'flock':
      return ['FLOCK_CLIENT_ID', 'FLOCK_CLIENT_SECRET'];
    case 'okta':
      return ['OKTA_CLIENT_ID', 'OKTA_CLIENT_SECRET'];
    case 'salesforce':
      return ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'];
    case 'intercom':
      return ['INTERCOM_CLIENT_ID', 'INTERCOM_CLIENT_SECRET'];
    case 'quickbooks':
      return ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'];
    default:
      return [];
  }
}

type ReadinessItemStatus = 'ok' | 'todo' | 'blocked';

type IntegrationReadinessItem = {
  id: string;
  label: string;
  status: ReadinessItemStatus;
  detail?: string | null;
};

// Catalog: registry only
router.get('/catalog', requirePermission('connectors.read'), async (_req, res) => {
  return res.json({
    success: true,
    data: {
      phase: 4,
      integrations: IMPLEMENTED_INTEGRATIONS,
    },
  });
});

// List: registry merged with org state
router.get('/', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('order', 'created_at.desc');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);

  const byType = new Map(rows.map((row) => [row.service_type, row]));

  const integrationIds = rows.map((r) => r.id).filter(Boolean);
  const credentialIntegrationIdSet = new Set<string>();
  const accessTokenExpiryByIntegrationId = new Map<string, string | null>();
  if (integrationIds.length > 0) {
    const credQuery = new URLSearchParams();
    credQuery.set('integration_id', in_(integrationIds));
    credQuery.set('select', 'integration_id');
    const creds = await safeQuery<Pick<StoredCredentialRow, 'integration_id'>>(rest, 'integration_credentials', credQuery);
    (creds || []).forEach((c) => {
      if (c.integration_id) credentialIntegrationIdSet.add(String(c.integration_id));
    });

    // Access token expiry is stored on the credential row where key=access_token.
    const expQuery = new URLSearchParams();
    expQuery.set('integration_id', in_(integrationIds));
    expQuery.set('key', eq('access_token'));
    expQuery.set('select', 'integration_id,expires_at');
    const expRows = await safeQuery<Pick<StoredCredentialRow, 'integration_id' | 'expires_at'>>(rest, 'integration_credentials', expQuery);
    (expRows || []).forEach((r) => {
      if (!r.integration_id) return;
      accessTokenExpiryByIntegrationId.set(String(r.integration_id), r.expires_at || null);
    });
  }

  const lifecycleFromRow = (row: StoredIntegrationRow | undefined | null): 'not_configured' | 'configured' | IntegrationStatus => {
    if (!row?.id) return 'not_configured';
    const hasCredentials = credentialIntegrationIdSet.has(row.id);
    if (!hasCredentials) return 'not_configured';
    if ((row.status as any) === 'configured') return 'configured';
    return row.status;
  };

  const policyQuery = new URLSearchParams();
  policyQuery.set('organization_id', eq(orgId));
  policyQuery.set('select', 'service,action,enabled');
  const actionPolicies = await safeQuery<Pick<StoredActionPolicyRow, 'service' | 'action' | 'enabled'>>(
    rest,
    'action_policies',
    policyQuery,
  );
  const enabledActionPolicyMap = new Map(actionPolicies.map((policy) => [`${policy.service}:${policy.action}`, Boolean(policy.enabled)]));
  const configuredPolicyKeys = new Set(actionPolicies.map((policy) => `${policy.service}:${policy.action}`));

  const data = IMPLEMENTED_INTEGRATIONS.map((spec) => {
    const row = byType.get(spec.id);
    const lifecycleStatus = spec.id === 'internal' ? 'connected' : lifecycleFromRow(row);
    const oauthKeys = spec.authType === 'oauth2' ? oauthEnvKeysForService(spec.id) : [];
    const oauthMissingEnv = oauthKeys.filter((k) => !(process.env[k] && String(process.env[k]).trim().length > 0));
    const oauthMeta = spec.authType === 'oauth2'
      ? { ready: oauthMissingEnv.length === 0, missingEnv: oauthMissingEnv }
      : null;

    const expectedRedirectUrl =
      spec.authType === 'oauth2' && spec.oauthConfig
        ? `${getApiBaseUrl(req)}${spec.oauthConfig.redirectPath}`
        : null;

    const missingCoreEnv = ['JWT_SECRET', 'FRONTEND_URL'].filter((k) => !(process.env[k] && String(process.env[k]).trim().length > 0));
    const coreEnvReady = missingCoreEnv.length === 0;

    const requiredFields = spec.apiKeyConfig?.requiredFields || spec.connectionFields || [];
    const credentialHint = requiredFields.length > 0 ? requiredFields.map((f) => f.label).join(', ') : '—';
    const writes = spec.capabilities?.writes || [];
    const enabledActionCount = writes.filter((write) => enabledActionPolicyMap.get(`${spec.id}:${write.id}`)).length;
    const wave1Seeds = WAVE1_POLICY_DEFAULTS.filter((seed) => seed.service === spec.id);
    const appliedSeedCount = wave1Seeds.filter((seed) => configuredPolicyKeys.has(`${seed.service}:${seed.action}`)).length;
    const wave1GuardrailsStatus: Wave1GuardrailStatus =
      wave1Seeds.length === 0
        ? 'not_applicable'
        : appliedSeedCount === 0
          ? 'missing'
          : appliedSeedCount === wave1Seeds.length
            ? 'applied'
            : 'partial';
    const trustTier: IntegrationTrustTier = spec.trustTier
      || (writes.some((write) => write.risk === 'high' || write.risk === 'money')
        ? 'high-trust-operational'
        : writes.length > 0
          ? 'controlled-write'
          : 'observe-only');

    const readiness: { expectedRedirectUrl: string | null; items: IntegrationReadinessItem[] } = {
      expectedRedirectUrl,
      items: [],
    };

    readiness.items.push({
      id: 'core_env',
      label: 'Backend env configured',
      status: coreEnvReady ? 'ok' : 'blocked',
      detail: coreEnvReady ? null : `Missing: ${missingCoreEnv.join(', ')}`,
    });

    if (spec.id === 'internal') {
      readiness.items.push({
        id: 'credentials',
        label: 'Credentials saved',
        status: 'ok',
        detail: 'Not required (built-in).',
      });
      readiness.items.push({
        id: 'validated',
        label: 'Connection validated',
        status: 'ok',
        detail: 'Built-in provider.',
      });
    } else if (spec.authType === 'oauth2') {
      readiness.items.push({
        id: 'oauth_app',
        label: 'OAuth app keys set',
        status: oauthMeta?.ready ? 'ok' : 'blocked',
        detail: oauthMeta?.ready ? null : `Missing: ${(oauthMeta?.missingEnv || []).join(', ')}`,
      });
      readiness.items.push({
        id: 'redirect_url',
        label: 'Redirect URL added in provider console',
        // If already connected the redirect URL is clearly registered — mark ok.
        status: lifecycleStatus === 'connected' ? 'ok' : (expectedRedirectUrl ? 'todo' : 'blocked'),
        detail: lifecycleStatus === 'connected' ? null : (expectedRedirectUrl || 'Could not compute redirect URL'),
      });
      readiness.items.push({
        id: 'validated',
        label: 'Connection validated',
        status: lifecycleStatus === 'connected' ? 'ok' : lifecycleStatus === 'error' || lifecycleStatus === 'expired' ? 'blocked' : 'todo',
        detail: lifecycleStatus === 'connected' ? null : (row?.last_error_msg || null),
      });
    } else {
      readiness.items.push({
        id: 'credentials',
        label: 'Credentials saved',
        status: lifecycleStatus === 'not_configured' ? 'todo' : 'ok',
        detail: lifecycleStatus === 'not_configured' ? `Required: ${credentialHint}` : null,
      });
      readiness.items.push({
        id: 'validated',
        label: 'Connection validated',
        status: lifecycleStatus === 'connected' ? 'ok' : lifecycleStatus === 'error' || lifecycleStatus === 'expired' ? 'blocked' : 'todo',
        detail: lifecycleStatus === 'connected' ? null : (row?.last_error_msg || null),
      });
    }

    const tokenExpiresAt = row?.id ? (accessTokenExpiryByIntegrationId.get(row.id) || null) : null;
    const tokenExpiresAtMs = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : NaN;
    const nowMs = Date.now();
    const tokenExpired = Number.isFinite(tokenExpiresAtMs) ? tokenExpiresAtMs <= nowMs : false;
    const tokenExpiresSoon = Number.isFinite(tokenExpiresAtMs) ? (tokenExpiresAtMs - nowMs) <= 1000 * 60 * 60 * 24 * 7 : false;
    const maturity = maturityForIntegration({
      lifecycleStatus,
      specTrustTier: trustTier,
      writes,
      policyEnabledCount: enabledActionCount,
    });

    return {
      id: spec.id,
      name: spec.name,
      category: spec.category,
      description: spec.description,
      authType: spec.authType,
      tags: spec.tags,
      color: spec.color,
      priority: spec.priority,
      requiredFields: spec.apiKeyConfig?.requiredFields || spec.connectionFields || [],
      capabilities: spec.capabilities || { reads: [], writes: [] },
      trustTier,
      maturity,
      categoryPack: packIdFromCategory(spec.category),
      wave:
        ['razorpay', 'paytm', 'tally', 'slack', 'naukri', 'cleartax'].includes(spec.id) ? 1
        : ['payu', 'zoho_recruit', 'google_workspace', 'microsoft_365', 'freshdesk', 'hubspot', 'zoho_crm'].includes(spec.id) ? 2
        : null,
      governanceSummary: {
        readCount: spec.capabilities?.reads?.length || 0,
        actionCount: writes.length,
        enabledActionCount,
      },
      wave1GuardrailsStatus,
      wave1GuardrailsApplied: appliedSeedCount,
      wave1GuardrailsTotal: wave1Seeds.length,
      oauth: oauthMeta,
      readiness,
      tokenExpiresAt,
      tokenExpired,
      tokenExpiresSoon,
      // Backwards-compatible field for older UIs.
      status: spec.id === 'internal' ? 'connected' : (row?.status || 'disconnected'),
      // New lifecycle field: use this in UIs to show "visible but disabled until configured".
      lifecycleStatus,
      lastSyncAt: row?.last_sync_at || null,
      lastErrorAt: row?.last_error_at || null,
      lastErrorMsg: row?.last_error_msg || null,
      aiEnabled: row?.ai_enabled ?? Boolean(spec.aiFeatures?.enabled),
      connectionId: row?.id || null,
      specStatus: spec.status,
      enabledCapabilities: row?.enabled_capabilities || [],
    };
  });

  return res.json({ success: true, data });
});

// Action catalog: spec-driven write capabilities merged with org enablement (action_policies).
router.get('/actions', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('select', 'service,action,enabled,require_approval,required_role,policy_constraints,updated_at');
  const policies = await safeQuery<Pick<StoredActionPolicyRow, 'service' | 'action' | 'enabled' | 'require_approval' | 'required_role' | 'policy_constraints' | 'updated_at'>>(
    rest,
    'action_policies',
    query
  );
  const policyMap = new Map(policies.map((p) => [`${p.service}:${p.action}`, p]));

  const actions = IMPLEMENTED_INTEGRATIONS.flatMap((spec) => {
    const writes = spec.capabilities?.writes || [];
    return writes.map((w) => {
      const key = `${spec.id}:${w.id}`;
      const policy = policyMap.get(key);
      const operation = operationForCapability(w);
      const objectType = objectTypeForCapability(w);
      const trustTier = w.trustTier || trustTierForRisk(w.risk);
      const approvalDefault = w.approvalDefault ?? (w.risk !== 'low');
      return {
        service: spec.id,
        providerName: spec.name,
        providerCategory: spec.category,
        action: w.id,
        label: w.label,
        risk: w.risk,
        operation,
        objectType,
        reversible: w.reversible ?? false,
        trustTier,
        approvalDefault,
        evidenceMode: w.evidenceMode || (w.risk === 'money' || w.risk === 'high' ? 'before-after' : 'request-result'),
        constraints: policy?.policy_constraints && Object.keys(policy.policy_constraints).length > 0
          ? policy.policy_constraints
          : defaultConstraintsForCapability(w, spec.category),
        pack: w.pack || null,
        enabled: policy ? Boolean(policy.enabled) : false,
        requireApproval: policy ? Boolean(policy.require_approval) : approvalDefault,
        requiredRole: policy?.required_role || 'manager',
        updatedAt: policy?.updated_at || null,
        policySummary: policy
          ? `${policy.enabled ? 'Enabled' : 'Blocked'} · ${policy.require_approval ? 'Approval required' : 'Direct execution'}`
          : 'No org policy configured yet',
      };
    });
  });

  return res.json({ success: true, data: actions });
});

const listGovernedActions = async (req: any, res: any) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = typeof req.query.service === 'string' ? req.query.service.trim() : '';
  const decision = typeof req.query.decision === 'string' ? req.query.decision.trim() : '';
  const source = typeof req.query.source === 'string' ? req.query.source.trim() : '';
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 25;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('order', 'created_at.desc');
  query.set('limit', String(limit));
  query.set('select', 'id,organization_id,agent_id,integration_id,connector_id,action,params,result,success,error_message,duration_ms,approval_required,approval_id,requested_by,policy_snapshot,before_state,after_state,remediation,created_at');
  if (service) query.set('connector_id', eq(service));

  const rows = await safeQuery<StoredConnectorExecutionRow>(rest, 'connector_action_executions', query);
  const connectorIds = Array.from(new Set((rows || []).map((row) => row.connector_id).filter(Boolean)));

  const queueByExecution = new Map<string, StoredRetryQueueRow>();
  const breakerByConnector = new Map<string, StoredCircuitBreakerRow>();

  if (connectorIds.length > 0) {
    const retryQuery = new URLSearchParams();
    retryQuery.set('organization_id', eq(orgId));
    retryQuery.set('status', 'in.(pending,queued_for_retry)');
    retryQuery.set('connector_id', in_(connectorIds));
    retryQuery.set('select', 'connector_id,action,attempt_count,next_attempt_at,status,updated_at');
    retryQuery.set('order', 'updated_at.desc');
    retryQuery.set('limit', '500');
    const retryRows = await safeQuery<StoredRetryQueueRow>(rest, 'connector_retry_queue', retryQuery);
    for (const retryRow of retryRows || []) {
      const key = `${retryRow.connector_id}:${retryRow.action}`;
      if (!queueByExecution.has(key)) queueByExecution.set(key, retryRow);
    }

    const breakerQuery = new URLSearchParams();
    breakerQuery.set('organization_id', eq(orgId));
    breakerQuery.set('connector_id', in_(connectorIds));
    breakerQuery.set('select', 'connector_id,state,opened_at');
    const breakerRows = await safeQuery<StoredCircuitBreakerRow>(rest, 'connector_circuit_breakers', breakerQuery);
    for (const breakerRow of breakerRows || []) {
      breakerByConnector.set(breakerRow.connector_id, breakerRow);
    }
  }

  let data = (rows || []).map((row) => {
    const retry = queueByExecution.get(`${row.connector_id}:${row.action}`);
    const breaker = breakerByConnector.get(row.connector_id);

    const queuedForRetry = Boolean(retry);
    const breakerOpen = breaker?.state === 'open';
    const recoveredAt = row.success && breaker?.opened_at && new Date(row.created_at) > new Date(breaker.opened_at)
      ? row.created_at
      : null;
    const reliabilityState: StoredConnectorExecutionRow['reliability_state'] = queuedForRetry
      ? 'queued_for_retry'
      : recoveredAt
        ? 'recovered'
        : breakerOpen
          ? 'paused_by_circuit_breaker'
          : 'ok';

    const governed = normalizeGovernedActionSummary(row);
    const reason = (() => {
      if (reliabilityState === 'queued_for_retry') {
        return {
          decision: 'defer_reliability' as const,
          reason_category: 'reliability_degraded' as const,
          reason_message: 'Action is queued for retry because the connector rail is unstable.',
          recommended_next_action: 'Wait for the scheduled retry or inspect connector health before retrying manually.',
        };
      }
      if (reliabilityState === 'paused_by_circuit_breaker') {
        return {
          decision: 'defer_reliability' as const,
          reason_category: 'reliability_degraded' as const,
          reason_message: 'Execution is paused because the connector circuit breaker is open.',
          recommended_next_action: 'Resolve connector/provider errors, then allow the breaker to recover.',
        };
      }
      if (governed.decision === 'blocked') {
        return {
          decision: 'block' as const,
          reason_category: 'policy_blocked' as const,
          reason_message: governed.block_reasons?.[0] || row.error_message || 'Action was blocked by governance policy.',
          recommended_next_action: 'Review policy constraints, payload, or connector capabilities before retrying.',
        };
      }
      if (governed.decision === 'pending_approval' || row.approval_required) {
        return {
          decision: 'require_approval' as const,
          reason_category: 'approval_required' as const,
          reason_message: governed.approval_reasons?.[0] || 'Human approval is required before this action can execute.',
          recommended_next_action: 'Approve, deny, or escalate the request in the approvals queue.',
        };
      }
      if (!row.success) {
        return {
          decision: 'allow' as const,
          reason_category: 'execution_failed' as const,
          reason_message: row.error_message || 'Execution failed after passing governance checks.',
          recommended_next_action: 'Inspect connector logs and provider state, then retry safely.',
        };
      }
      return {
        decision: 'allow' as const,
        reason_category: null,
        reason_message: null,
        recommended_next_action: null,
      };
    })();

    return {
      ...row,
      reliability_state: reliabilityState,
      retry_count: retry?.attempt_count ?? null,
      next_retry_at: retry?.next_attempt_at ?? null,
      breaker_open: breakerOpen,
      recovered_at: recoveredAt,
      ...reason,
      delegated_actor: governed.delegated_actor ?? null,
      audit_ref: governed.audit_ref ?? null,
      governance: governed,
    };
  });
  if (decision) data = data.filter((row) => row.governance?.decision === decision);
  if (source) data = data.filter((row) => row.governance?.source === source);
  return res.json({ success: true, data });
};

router.get('/executions', requirePermission('connectors.read'), listGovernedActions);
router.get('/governed-actions', requirePermission('connectors.read'), listGovernedActions);

router.post('/governed-actions/:executionId/rollback-request', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
  const rest = restAsUser(req);
  const executionId = req.params.executionId;
  const q = new URLSearchParams();
  q.set('id', eq(executionId));
  q.set('organization_id', eq(orgId));
  q.set('select', 'id,connector_id,action,before_state,after_state,remediation,requested_by,policy_snapshot');
  q.set('limit', '1');
  const rows = await safeQuery<StoredConnectorExecutionRow>(rest, 'connector_action_executions', q);
  const row = rows?.[0];
  if (!row) return res.status(404).json({ success: false, error: 'Governed action not found' });
  if (!row.after_state || Object.keys(row.after_state).length === 0) {
    return res.status(400).json({ success: false, error: 'No execution state available for rollback request' });
  }

  const now = new Date().toISOString();
  const requiredRole = 'manager';
  const approvalRows = await rest('approval_requests', '', {
    method: 'POST',
    body: {
      organization_id: orgId,
      service: row.connector_id,
      action: `${row.action}.rollback`,
      action_payload: {
        target_execution_id: row.id,
        connector_id: row.connector_id,
        action: row.action,
        before_state: row.before_state || {},
        after_state: row.after_state || {},
        rollback_mode: 'operator_review',
      },
      requested_by: req.user?.id || 'user',
      required_role: requiredRole,
      status: 'pending',
      assigned_to: null,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      sla_deadline: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      created_at: now,
      updated_at: now,
    },
  }) as Array<{ id: string }>;
  const approvalId = approvalRows?.[0]?.id || null;

  const patch = new URLSearchParams();
  patch.set('id', eq(row.id));
  patch.set('organization_id', eq(orgId));
  await rest('connector_action_executions', patch, {
    method: 'PATCH',
    body: {
      remediation: {
        ...(row.remediation || {}),
        rollback_requested: true,
        rollback_requested_at: now,
        rollback_approval_id: approvalId,
        rollback_recommended_next_action: 'Review rollback request in approvals and execute only after validation.',
      },
    },
  });

  return res.json({
    success: true,
    data: {
      approval_id: approvalId,
      required_role: requiredRole,
      message: 'Rollback request created and routed for approval.',
    },
  });
});

// Upsert action enablement for spec actions (writes only).
router.post('/actions', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const schema = z.object({
    items: z.array(z.object({
      service: z.string().min(1),
      action: z.string().min(1),
      enabled: z.boolean(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const implemented = new Set(IMPLEMENTED_INTEGRATIONS.map((i) => i.id));
  const writeSet = new Set<string>();
  IMPLEMENTED_INTEGRATIONS.forEach((spec) => {
    (spec.capabilities?.writes || []).forEach((w) => writeSet.add(`${spec.id}:${w.id}`));
  });

  for (const item of parsed.data.items) {
    if (!implemented.has(item.service)) {
      return res.status(400).json({ success: false, error: `Unknown integration service: ${item.service}` });
    }
    if (!writeSet.has(`${item.service}:${item.action}`)) {
      return res.status(400).json({ success: false, error: `Unknown action for service: ${item.service}:${item.action}` });
    }

    await upsertActionPolicy(rest, orgId, item.service, item.action, {
      enabled: item.enabled,
      require_approval: true,
      required_role: 'manager',
      updated_by: req.user?.id || null,
      notes: null,
    });
  }

  return res.json({ success: true, data: { updated: parsed.data.items.length } });
});

router.post('/actions/seed-wave1', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const schema = z.object({
    services: z.array(z.string().min(1)).max(20).optional(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const serviceFilter = parsed.data.services?.length
    ? new Set(parsed.data.services.map((service) => String(service).trim()).filter(Boolean))
    : null;

  const selectedSeeds = WAVE1_POLICY_DEFAULTS.filter((seed) => !serviceFilter || serviceFilter.has(seed.service));
  if (selectedSeeds.length === 0) {
    return res.status(400).json({ success: false, error: 'No Wave 1 policies matched the requested services' });
  }

  const updatedPolicies = await applyWave1Policies(rest, orgId, req.user?.id || null, serviceFilter ? Array.from(serviceFilter) : undefined);

  return res.json({
    success: true,
    data: {
      updated: updatedPolicies.length,
      services: Array.from(new Set(updatedPolicies.map((row) => row.service))),
      policies: updatedPolicies,
    },
  });
});

// OAuth init: returns provider authorization URL (JWT-authenticated; frontend then redirects).
router.post('/oauth/init', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const schema = z.object({
    service: z.string().min(1),
    returnTo: z.string().optional(),
    connection: z.record(z.string(), z.string()).optional(),
    popup: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const service = parsed.data.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const returnTo = parsed.data.popup
    ? '/oauth/popup'
    : (safeReturnPath(parsed.data.returnTo) || '/dashboard/apps');
  const connection: Record<string, string> = {};
  Object.entries(parsed.data.connection || {}).forEach(([k, v]) => {
    if (!v) return;
    connection[k] = k.includes('domain') || k.includes('subdomain') ? normalizeDomainInput(v) : v.trim();
  });

  // Enforce required connection fields, if any.
  for (const field of spec.connectionFields || []) {
    if (field.required && !connection[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  try {
    const out = await buildOAuthAuthorizeUrl({
      req,
      orgId,
      userId: req.user?.id || null,
      service,
      returnTo,
      spec,
      connection,
    });
    return res.json({ success: true, data: out });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to start OAuth flow' });
  }
});

// Connection logs for a specific integration
router.get('/:service/logs', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;

  const iQuery = new URLSearchParams();
  iQuery.set('organization_id', eq(orgId));
  iQuery.set('service_type', eq(service));
  iQuery.set('select', 'id');
  const rows = await safeQuery<Pick<StoredIntegrationRow, 'id'>>(rest, 'integrations', iQuery);
  const integrationId = rows?.[0]?.id;

  if (!integrationId) {
    return res.json({ success: true, data: [] });
  }

  const logQuery = new URLSearchParams();
  logQuery.set('integration_id', eq(integrationId));
  logQuery.set('order', 'created_at.desc');
  logQuery.set('limit', String(limit));
  logQuery.set('select', 'id,action,status,message,metadata,created_at');
  const logs = await safeQuery<Pick<StoredConnectionLogRow, 'id' | 'action' | 'status' | 'message' | 'metadata' | 'created_at'>>(
    rest,
    'integration_connection_logs',
    logQuery
  );

  return res.json({ success: true, data: logs });
});

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stableSeed(orgId: string, service: string): number {
  const hex = crypto.createHash('sha256').update(`${orgId}:${service}`).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function sampleCandidateData(orgId: string, service: string) {
  const rng = mulberry32(stableSeed(orgId, service));
  const firstNames = ['Aarav', 'Diya', 'Ishaan', 'Meera', 'Kabir', 'Ananya', 'Rohan', 'Sara', 'Vikram', 'Naina', 'Arjun', 'Priya'];
  const lastNames = ['Sharma', 'Patel', 'Gupta', 'Iyer', 'Singh', 'Reddy', 'Khan', 'Verma', 'Nair', 'Mehta', 'Bose', 'Kapoor'];
  const cities = ['Bengaluru', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi', 'Chennai', 'Kolkata', 'Ahmedabad'];
  const roles = ['Software Engineer', 'HR Generalist', 'Talent Acquisition', 'Accountant', 'Payroll Specialist', 'Data Analyst', 'Customer Success'];
  const skillPool = ['React', 'Node.js', 'TypeScript', 'Python', 'PostgreSQL', 'Recruiting', 'Sourcing', 'Excel', 'Tally', 'Payroll', 'Communication', 'Stakeholder management'];

  const now = Date.now();
  const candidates = Array.from({ length: 20 }).map((_, idx) => {
    const name = `${pick(rng, firstNames)} ${pick(rng, lastNames)}`;
    const role = pick(rng, roles);
    const skills = Array.from({ length: 6 }).map(() => pick(rng, skillPool));
    const uniqueSkills = Array.from(new Set(skills)).slice(0, 5);
    const experienceYears = Math.max(0, Math.round(rng() * 10));
    const score = Math.round(55 + rng() * 40);
    const updatedAt = new Date(now - Math.floor(rng() * 1000 * 60 * 60 * 24 * 14)).toISOString();

    return {
      id: `${service}_cand_${idx + 1}`,
      source: service,
      full_name: name,
      headline: `${role} • ${experienceYears} yrs`,
      location: pick(rng, cities),
      experience_years: experienceYears,
      skills: uniqueSkills,
      match_score: score,
      summary:
        experienceYears >= 5
          ? 'Senior profile with strong delivery ownership and cross-functional collaboration.'
          : 'Early-career profile with high learning velocity and good fundamentals.',
      last_updated_at: updatedAt,
    };
  });

  const jds = [
    { id: 'jd_1', title: 'Senior Software Engineer (React/Node)', location: 'Bengaluru', seniority: 'Senior' },
    { id: 'jd_2', title: 'Talent Acquisition Specialist', location: 'Hyderabad', seniority: 'Mid' },
    { id: 'jd_3', title: 'Payroll & Compliance Associate', location: 'Pune', seniority: 'Junior' },
  ];

  return { candidates, jds };
}

// Sample pull: a fast "see it" endpoint used by the new Integrations Hub.
router.post('/:service/sample-pull', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const iQuery = new URLSearchParams();
  iQuery.set('organization_id', eq(orgId));
  iQuery.set('service_type', eq(service));
  iQuery.set('select', 'id,status');
  const rows = await safeQuery<Pick<StoredIntegrationRow, 'id' | 'status'>>(rest, 'integrations', iQuery);
  const integrationId = rows?.[0]?.id || null;
  const status = rows?.[0]?.status || 'disconnected';
  if (!integrationId || status !== 'connected') {
    return res.status(400).json({ success: false, error: 'Integration not connected' });
  }

  const sample = sampleCandidateData(orgId, service);
  await writeConnectionLog(rest, integrationId, 'sample_pull', 'success', 'Generated sample pull preview', {
    service,
    count: sample.candidates.length,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, data: sample });
});

router.get('/:service/workspace-preview', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const aliases = toServiceAliases(service);
  const spec = getIntegrationSpec(service) || aliases.map((alias) => getIntegrationSpec(alias)).find(Boolean);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const iQuery = new URLSearchParams();
  iQuery.set('organization_id', eq(orgId));
  iQuery.set('service_type', in_(aliases));
  iQuery.set('select', 'id,service_type,status,service_name');
  const rows = await safeQuery<Pick<StoredIntegrationRow, 'id' | 'service_type' | 'status' | 'service_name'>>(rest, 'integrations', iQuery);
  const connected = (rows || []).find((row) => row.status === 'connected');
  if (!connected) {
    return res.status(400).json({ success: false, error: 'Integration not connected' });
  }

  const credentials = await readCredentials(rest, connected.id);
  const token = credentials.access_token || credentials.accessToken;
  if (!token) {
    return res.status(400).json({ success: false, error: 'Integration credentials are missing an access token' });
  }

  const preview: Record<string, any> = {
    service: connected.service_type,
    profile: null,
    events: [],
    users: [],
    notes: [],
    suggested_next_action: null,
  };

  if (aliases.includes('google-workspace') || aliases.includes('google_workspace')) {
    const [profileRes, calendarRes, usersRes] = await Promise.allSettled([
      fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&orderBy=startTime&singleEvents=true&timeMin=${encodeURIComponent(new Date().toISOString())}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      fetch('https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=5&orderBy=email', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
    ]);

    if (profileRes.status === 'fulfilled') {
      const body: any = await profileRes.value.json().catch(() => null);
      if (profileRes.value.ok && body) {
        preview.profile = {
          email: body.email ?? null,
          name: body.name ?? null,
          picture: body.picture ?? null,
        };
      }
    }

    if (calendarRes.status === 'fulfilled') {
      const body: any = await calendarRes.value.json().catch(() => null);
      if (calendarRes.value.ok && Array.isArray(body?.items)) {
        preview.events = body.items.map((item: any) => ({
          id: item.id,
          title: item.summary || 'Untitled event',
          start: item.start?.dateTime || item.start?.date || null,
          end: item.end?.dateTime || item.end?.date || null,
          organizer: item.organizer?.email || null,
        }));
      } else if (!calendarRes.value.ok) {
        preview.notes.push('Calendar preview is unavailable with the current Google scope set.');
      }
    }

    if (usersRes.status === 'fulfilled') {
      const body: any = await usersRes.value.json().catch(() => null);
      if (usersRes.value.ok && Array.isArray(body?.users)) {
        preview.users = body.users.map((item: any) => ({
          id: item.id,
          email: item.primaryEmail || null,
          name: item.name?.fullName || item.primaryEmail || 'Unknown user',
          suspended: Boolean(item.suspended),
        }));
      } else if (!usersRes.value.ok) {
        preview.notes.push('Directory preview is unavailable with the current Google scope set.');
      }
    }

    preview.suggested_next_action = preview.events.length > 0
      ? 'Review upcoming calendar commitments before allowing agents to send or schedule changes.'
      : 'Reconnect with broader collaboration scopes if you want inbox and calendar work to happen fully inside Rasi.';
  } else if (aliases.includes('microsoft-365') || aliases.includes('microsoft_365')) {
    const [profileRes, calendarRes] = await Promise.allSettled([
      fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      fetch(`https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(new Date().toISOString())}&endDateTime=${encodeURIComponent(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())}&$top=5`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
    ]);

    if (profileRes.status === 'fulfilled') {
      const body: any = await profileRes.value.json().catch(() => null);
      if (profileRes.value.ok && body) {
        preview.profile = {
          email: body.mail || body.userPrincipalName || null,
          name: body.displayName || null,
          title: body.jobTitle || null,
        };
      }
    }

    if (calendarRes.status === 'fulfilled') {
      const body: any = await calendarRes.value.json().catch(() => null);
      if (calendarRes.value.ok && Array.isArray(body?.value)) {
        preview.events = body.value.map((item: any) => ({
          id: item.id,
          title: item.subject || 'Untitled event',
          start: item.start?.dateTime || null,
          end: item.end?.dateTime || null,
          organizer: item.organizer?.emailAddress?.address || null,
        }));
      } else if (!calendarRes.value.ok) {
        preview.notes.push('Calendar preview needs broader Microsoft Graph scopes than the current connection provides.');
      }
    }

    preview.suggested_next_action = preview.events.length > 0
      ? 'Review meetings and profile details before enabling agents to draft or schedule collaboration actions.'
      : 'Reconnect with broader Microsoft Graph scopes if you want inbox and calendar work to happen fully inside Rasi.';
  } else if (aliases.includes('zendesk')) {
    const subdomain = String(credentials.subdomain || '').replace(/\.zendesk\.com$/i, '');
    const email = String(credentials.email || '');
    const apiToken = String(credentials.apiToken || credentials.api_token || '');
    if (!subdomain || !email || !apiToken) {
      return res.status(400).json({ success: false, error: 'Zendesk credentials are incomplete for workspace preview' });
    }

    const auth = Buffer.from(`${email}/token:${apiToken}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
    const [meRes, ticketsRes] = await Promise.allSettled([
      fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, { headers }),
      fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/recent.json`, { headers }),
    ]);

    if (meRes.status === 'fulfilled') {
      const body: any = await meRes.value.json().catch(() => null);
      if (meRes.value.ok && body?.user) {
        preview.profile = {
          email: body.user.email ?? null,
          name: body.user.name ?? null,
          role: body.user.role ?? null,
        };
      }
    }

    if (ticketsRes.status === 'fulfilled') {
      const body: any = await ticketsRes.value.json().catch(() => null);
      if (ticketsRes.value.ok && Array.isArray(body?.tickets)) {
        preview.conversations = body.tickets.slice(0, 8).map((ticket: any) => ({
          id: String(ticket.id),
          subject: ticket.subject || 'Untitled ticket',
          status: ticket.status || 'open',
          priority: ticket.priority || null,
          updated_at: ticket.updated_at || null,
          requester_id: ticket.requester_id || null,
        }));
        preview.metrics = {
          open_count: body.tickets.filter((ticket: any) => ticket.status !== 'closed' && ticket.status !== 'solved').length,
          total_loaded: body.tickets.length,
        };
      } else if (!ticketsRes.value.ok) {
        preview.notes.push('Recent Zendesk tickets could not be loaded with the current credentials.');
      }
    }

    preview.suggested_next_action = Array.isArray(preview.conversations) && preview.conversations.length > 0
      ? 'Review urgent tickets and decide which replies should stay human-approved before enabling agent responses.'
      : 'Connect a Zendesk admin token with ticket access if you want live support inbox data inside Rasi.';
  } else if (aliases.includes('freshdesk')) {
    const subdomain = String(credentials.subdomain || '').replace(/\.freshdesk\.com$/i, '');
    const apiKey = String(credentials.apiKey || credentials.api_key || '');
    if (!subdomain || !apiKey) {
      return res.status(400).json({ success: false, error: 'Freshdesk credentials are incomplete for workspace preview' });
    }

    const auth = Buffer.from(`${apiKey}:X`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
    const ticketsRes = await fetch(`https://${subdomain}.freshdesk.com/api/v2/tickets?per_page=8&order_by=updated_at&order_type=desc`, { headers });
    const body: any = await ticketsRes.json().catch(() => null);
    if (ticketsRes.ok && Array.isArray(body)) {
      preview.conversations = body.map((ticket: any) => ({
        id: String(ticket.id),
        subject: ticket.subject || 'Untitled ticket',
        status: String(ticket.status || ''),
        priority: String(ticket.priority || ''),
        updated_at: ticket.updated_at || null,
        requester_id: ticket.requester_id || null,
      }));
      preview.metrics = {
        open_count: body.filter((ticket: any) => ![4, 5, 'resolved', 'closed'].includes(ticket.status)).length,
        total_loaded: body.length,
      };
    } else {
      preview.notes.push('Recent Freshdesk tickets could not be loaded with the current credentials.');
    }

    preview.suggested_next_action = Array.isArray(preview.conversations) && preview.conversations.length > 0
      ? 'Triage recent Freshdesk tickets and confirm which ones should allow agent-written responses.'
      : 'Reconnect Freshdesk with ticket-read permissions if you want live support inbox data inside Rasi.';
  } else if (aliases.includes('intercom')) {
    const accessToken = String(credentials.accessToken || credentials.access_token || '');
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Intercom credentials are incomplete for workspace preview' });
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Intercom-Version': '2.10',
    };
    const [adminsRes, conversationsRes] = await Promise.allSettled([
      fetch('https://api.intercom.io/admins', { headers }),
      fetch('https://api.intercom.io/conversations?per_page=8', { headers }),
    ]);

    if (adminsRes.status === 'fulfilled') {
      const body: any = await adminsRes.value.json().catch(() => null);
      const admin = Array.isArray(body?.admins) ? body.admins[0] : null;
      if (adminsRes.value.ok && admin) {
        preview.profile = {
          email: admin.email ?? null,
          name: admin.name ?? null,
          type: admin.type ?? 'admin',
        };
      }
    }

    if (conversationsRes.status === 'fulfilled') {
      const body: any = await conversationsRes.value.json().catch(() => null);
      if (conversationsRes.value.ok && Array.isArray(body?.conversations)) {
        preview.conversations = body.conversations.map((conversation: any) => ({
          id: String(conversation.id),
          subject: conversation.title || conversation.source?.subject || 'Conversation',
          status: conversation.state || 'open',
          priority: conversation.priority || null,
          updated_at: conversation.updated_at ? new Date(Number(conversation.updated_at) * 1000).toISOString() : null,
          requester_id: conversation.source?.author?.id || null,
        }));
        preview.metrics = {
          open_count: body.conversations.filter((conversation: any) => conversation.state !== 'closed').length,
          total_loaded: body.conversations.length,
        };
      } else if (!conversationsRes.value.ok) {
        preview.notes.push('Recent Intercom conversations could not be loaded with the current token.');
      }
    }

    preview.suggested_next_action = Array.isArray(preview.conversations) && preview.conversations.length > 0
      ? 'Review open Intercom conversations and decide which replies should require human approval.'
      : 'Reconnect Intercom with conversation-read access if you want live support inbox data inside Rasi.';
  } else if (aliases.includes('stripe')) {
    const secretKey = String(credentials.secretKey || credentials.secret_key || '');
    if (!secretKey) {
      return res.status(400).json({ success: false, error: 'Stripe credentials are incomplete for workspace preview' });
    }

    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };
    const [accountRes, payoutsRes, chargesRes] = await Promise.allSettled([
      fetch('https://api.stripe.com/v1/account', { headers }),
      fetch('https://api.stripe.com/v1/payouts?limit=5', { headers }),
      fetch('https://api.stripe.com/v1/charges?limit=5', { headers }),
    ]);

    if (accountRes.status === 'fulfilled') {
      const body: any = await accountRes.value.json().catch(() => null);
      if (accountRes.value.ok && body) {
        preview.profile = {
          name: body.business_profile?.name || body.settings?.dashboard?.display_name || body.email || 'Stripe account',
          email: body.email || null,
          country: body.country || null,
        };
      }
    }

    if (chargesRes.status === 'fulfilled') {
      const body: any = await chargesRes.value.json().catch(() => null);
      if (chargesRes.value.ok && Array.isArray(body?.data)) {
        preview.records = body.data.map((charge: any) => ({
          id: charge.id,
          label: charge.description || charge.billing_details?.name || 'Charge',
          amount: charge.amount || 0,
          currency: charge.currency || 'usd',
          status: charge.status || 'unknown',
          updated_at: charge.created ? new Date(Number(charge.created) * 1000).toISOString() : null,
        }));
      } else if (!chargesRes.value.ok) {
        preview.notes.push('Recent Stripe charges could not be loaded with the current credentials.');
      }
    }

    if (payoutsRes.status === 'fulfilled') {
      const body: any = await payoutsRes.value.json().catch(() => null);
      if (payoutsRes.value.ok && Array.isArray(body?.data)) {
        preview.metrics = {
          payouts_loaded: body.data.length,
          pending_payouts: body.data.filter((payout: any) => payout.status === 'pending').length,
        };
      }
    }

    preview.suggested_next_action = Array.isArray(preview.records) && preview.records.length > 0
      ? 'Review recent charges and payout state before allowing agents to approve refunds or payment operations.'
      : 'Reconnect Stripe with a live secret key if you want payment activity inside Rasi.';
  } else if (aliases.includes('razorpay')) {
    const keyId = String(credentials.key_id || credentials.keyId || '');
    const keySecret = String(credentials.key_secret || credentials.keySecret || '');
    if (!keyId || !keySecret) {
      return res.status(400).json({ success: false, error: 'Razorpay credentials are incomplete for workspace preview' });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
    const [paymentsRes, settlementsRes] = await Promise.allSettled([
      fetch('https://api.razorpay.com/v1/payments?count=8', { headers }),
      fetch('https://api.razorpay.com/v1/settlements?count=5', { headers }),
    ]);

    if (paymentsRes.status === 'fulfilled') {
      const body: any = await paymentsRes.value.json().catch(() => null);
      if (paymentsRes.value.ok && Array.isArray(body?.items)) {
        preview.records = body.items.map((payment: any) => ({
          id: payment.id,
          label: payment.description || payment.email || 'Payment',
          amount: payment.amount || 0,
          currency: payment.currency || 'INR',
          status: payment.status || 'unknown',
          updated_at: payment.created_at ? new Date(Number(payment.created_at) * 1000).toISOString() : null,
        }));
        preview.metrics = {
          captured_count: body.items.filter((payment: any) => payment.status === 'captured').length,
          total_loaded: body.items.length,
        };
      } else if (!paymentsRes.value.ok) {
        preview.notes.push('Recent Razorpay payments could not be loaded with the current credentials.');
      }
    }

    if (settlementsRes.status === 'fulfilled') {
      const body: any = await settlementsRes.value.json().catch(() => null);
      if (settlementsRes.value.ok && Array.isArray(body?.items)) {
        preview.settlements = body.items.map((settlement: any) => ({
          id: settlement.id,
          amount: settlement.amount || 0,
          status: settlement.status || 'processed',
          updated_at: settlement.created_at ? new Date(Number(settlement.created_at) * 1000).toISOString() : null,
        }));
      }
    }

    preview.suggested_next_action = Array.isArray(preview.records) && preview.records.length > 0
      ? 'Review captured payments and settlements before letting agents trigger refunds or payout operations.'
      : 'Reconnect Razorpay with valid API keys if you want payment activity inside Rasi.';
  } else if (aliases.includes('paytm')) {
    const merchantId = String(credentials.merchant_id || '');
    const merchantKey = String(credentials.merchant_key || '');
    const channelId = String(credentials.channel_id || '');
    if (!merchantId || !merchantKey || !channelId) {
      return res.status(400).json({ success: false, error: 'Paytm credentials are incomplete for workspace preview' });
    }

    const headers = {
      'X-Merchant-Id': merchantId,
      'X-Merchant-Key': merchantKey,
      'X-Channel-Id': channelId,
      Accept: 'application/json',
    };
    const transactionsRes = await fetch('https://api.paytm.com/v1/transactions?limit=8', { headers });
    const body: any = await transactionsRes.json().catch(() => null);
    if (transactionsRes.ok) {
      const transactions = Array.isArray(body?.transactions) ? body.transactions : Array.isArray(body) ? body : [];
      preview.records = transactions.map((transaction: any) => ({
        id: transaction.id || transaction.txn_id || transaction.order_id,
        label: transaction.order_id || transaction.id || 'Transaction',
        amount: transaction.amount || 0,
        currency: transaction.currency || 'INR',
        status: transaction.status || transaction.txn_status || 'unknown',
        updated_at: transaction.updated_at || transaction.txn_date || null,
      }));
      preview.metrics = {
        success_count: transactions.filter((transaction: any) => ['success', 'successful', 'txn_success'].includes(String(transaction.status || transaction.txn_status || '').toLowerCase())).length,
        total_loaded: transactions.length,
      };
    } else {
      preview.notes.push('Recent Paytm transactions could not be loaded with the current credentials.');
    }

    preview.suggested_next_action = Array.isArray(preview.records) && preview.records.length > 0
      ? 'Review recent Paytm transactions before allowing agents to trigger finance follow-ups or exception actions.'
      : 'Reconnect Paytm with transaction-read access if you want finance activity inside Rasi.';
  } else if (aliases.includes('cleartax')) {
    const apiKey = String(credentials.api_key || credentials.apiKey || '');
    const gstin = String(credentials.gstin || '');
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'ClearTax credentials are incomplete for workspace preview' });
    }

    const headers = {
      'X-Cleartax-Api-Key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const [statusRes, noticesRes] = await Promise.allSettled([
      gstin
        ? fetch(`https://api.cleartax.in/v1/compliance/status?gstin=${encodeURIComponent(gstin)}`, { headers })
        : Promise.resolve(null as any),
      fetch('https://api.cleartax.in/v1/notices?limit=8', { headers }),
    ]);

    if (statusRes.status === 'fulfilled' && statusRes.value) {
      const body: any = await statusRes.value.json().catch(() => null);
      if (statusRes.value.ok && body) {
        preview.profile = {
          gstin: gstin || null,
          filing_status: body.filing_status || body.status || null,
          legal_name: body.legal_name || body.trade_name || null,
        };
        preview.metrics = {
          filing_status: body.filing_status || body.status || 'unknown',
          notices_open: Array.isArray(body.notices) ? body.notices.length : undefined,
        };
      } else if (!statusRes.value.ok) {
        preview.notes.push('Compliance status could not be loaded with the current ClearTax credentials.');
      }
    } else if (!gstin) {
      preview.notes.push('Add a GSTIN to this connection if you want live filing status inside Rasi.');
    }

    if (noticesRes.status === 'fulfilled') {
      const body: any = await noticesRes.value.json().catch(() => null);
      const notices = Array.isArray(body?.notices) ? body.notices : Array.isArray(body) ? body : [];
      if (noticesRes.value.ok) {
        preview.records = notices.map((notice: any) => ({
          id: notice.id || notice.notice_id || notice.reference_id,
          label: notice.title || notice.notice_type || 'Compliance notice',
          status: notice.status || notice.state || 'open',
          updated_at: notice.updated_at || notice.created_at || null,
        }));
        preview.metrics = {
          ...(preview.metrics || {}),
          notices_loaded: notices.length,
          open_notices: notices.filter((notice: any) => !['closed', 'resolved', 'completed'].includes(String(notice.status || notice.state || '').toLowerCase())).length,
        };
      } else {
        preview.notes.push('Recent ClearTax notices could not be loaded with the current credentials.');
      }
    }

    preview.suggested_next_action = Array.isArray(preview.records) && preview.records.length > 0
      ? 'Review open notices and filing posture before allowing agents to submit or remediate compliance actions.'
      : 'Reconnect ClearTax with notice and filing access if you want live compliance context inside Rasi.';
  } else {
    return res.status(400).json({ success: false, error: 'Workspace preview is not supported for this integration' });
  }

  await writeConnectionLog(rest, connected.id, 'workspace_preview', 'success', 'Loaded workspace preview', {
    service: connected.service_type,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, data: preview });
});

// Manual token refresh (OAuth only)
router.post('/refresh/:service', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2') return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  const row = rows?.[0];
  if (!row?.id) return res.status(400).json({ success: false, error: 'Integration not connected' });

  const adapter = getAdapter(service);
  if (!adapter?.refreshToken) return res.status(501).json({ success: false, error: 'Refresh token not implemented for this provider' });

  const creds = await readCredentials(rest, row.id);
  if (!creds.refresh_token) return res.status(400).json({ success: false, error: 'No refresh token stored. Please reconnect.' });

  try {
    const token = await adapter.refreshToken(creds);
    const expiresIn = Number(token?.expires_in || 0);
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await upsertCredential(rest, row.id, 'access_token', encryptSecret(String(token.access_token)), true, expiresAt);
    if (token.refresh_token) {
      await upsertCredential(rest, row.id, 'refresh_token', encryptSecret(String(token.refresh_token)), true, null);
    }

    await writeConnectionLog(rest, row.id, 'refresh', 'success', 'Token refreshed', { service });
    return res.json({ success: true, data: { refreshed: true, expiresAt } });
  } catch (err: any) {
    await writeConnectionLog(rest, row.id, 'refresh', 'failed', err?.message || 'Token refresh failed', { service });
    return res.status(500).json({ success: false, error: err?.message || 'Token refresh failed' });
  }
});

// OAuth authorize: redirects the user to the provider.
router.get('/oauth/authorize/:service', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(400).json({ success: false, error: 'Integration is not OAuth2 based' });

  const returnTo = safeReturnPath(req.query.return_to) || '/dashboard/apps';
  const connection: Record<string, string> = {};
  (spec.connectionFields || []).forEach((field) => {
    const raw = req.query[field.name];
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    connection[field.name] = field.name.includes('domain') || field.name.includes('subdomain')
      ? normalizeDomainInput(trimmed)
      : trimmed;
  });

  for (const field of spec.connectionFields || []) {
    if (field.required && !connection[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  try {
    const out = await buildOAuthAuthorizeUrl({
      req,
      orgId,
      userId: req.user?.id || null,
      service,
      returnTo,
      spec,
      connection,
    });
    return res.redirect(302, out.url);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to start OAuth flow' });
  }
});

// OAuth callback: public endpoint invoked by provider redirects.
router.get('/oauth/callback/:service', async (req, res) => {
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec || spec.authType !== 'oauth2' || !spec.oauthConfig) return res.status(404).send('Integration not found');

  const frontendUrl = getFrontendUrl();
  const error = typeof req.query.error === 'string' ? req.query.error : null;
  const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : null;
  if (error) {
    const params = new URLSearchParams({
      status: 'error',
      service,
      message: errorDescription || error,
    });
    return res.redirect(302, `${frontendUrl}/dashboard/apps?${params.toString()}`);
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  if (!code || !state) {
    const params = new URLSearchParams({ status: 'error', service, message: 'Missing code/state' });
    return res.redirect(302, `${frontendUrl}/dashboard/apps?${params.toString()}`);
  }

  const parsedState = await verifyOAuthState(state);
  if (!parsedState?.orgId || parsedState?.service !== service) {
    const params = new URLSearchParams({ status: 'error', service, message: 'Invalid state' });
    return res.redirect(302, `${frontendUrl}/dashboard/apps?${params.toString()}`);
  }

  const orgId = String(parsedState.orgId);
  const connection = (parsedState.connection && typeof parsedState.connection === 'object') ? (parsedState.connection as Record<string, string>) : {};
  const pkceVerifier = typeof parsedState.codeVerifier === 'string' ? parsedState.codeVerifier : undefined;
  const apiBase = getApiBaseUrl(req);
  const redirectUri = `${apiBase}${spec.oauthConfig.redirectPath}`;

  // Zoho sends a `location` query param (e.g. "in", "eu", "au") indicating which DC the
  // user's account lives in. The token exchange MUST go to accounts.zoho.{location} — if we
  // always use accounts.zoho.com Zoho returns invalid_code for non-US accounts.
  const zohoLocation = typeof req.query.location === 'string' ? req.query.location.trim().toLowerCase() : null;

  try {
    const rest = restAsService;
    let token: any = null;
    let tokenUrl = resolveUrlTemplate(spec.oauthConfig.tokenUrl, connection);

    // Override Zoho token URL to match the DC that issued the authorization code.
    if (zohoLocation && (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn')) {
      const zohoDomain = zohoLocation === 'com' ? 'zoho.com' : `zoho.${zohoLocation}`;
      tokenUrl = `https://accounts.${zohoDomain}/oauth/v2/token`;
      logger.info('Zoho DC-aware token exchange', { service, location: zohoLocation, tokenUrl });
    }
    const secretOrNull = (name: string) => {
      const v = process.env[name];
      return v && v.trim().length > 0 ? v : null;
    };

    if (service === 'slack') {
      const clientId = secretOrNull('SLACK_CLIENT_ID');
      const clientSecret = secretOrNull('SLACK_CLIENT_SECRET');
      if (!clientId || !clientSecret) throw new Error('Slack OAuth env vars are not configured');

      // Slack returns {ok, access_token, ...}
      const slack = await postForm(tokenUrl, {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      });
      if (!slack?.ok) throw new Error(slack?.error || 'Slack token exchange failed');
      token = slack;
    } else {
      // Standard OAuth2 code exchange
      let clientIdEnv = '';
      let clientSecretEnv: string | null = null;

      if (service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') {
        clientIdEnv = 'ZOHO_CLIENT_ID';
        clientSecretEnv = 'ZOHO_CLIENT_SECRET';
      } else if (service === 'linkedin') {
        clientIdEnv = 'LINKEDIN_CLIENT_ID';
        clientSecretEnv = 'LINKEDIN_CLIENT_SECRET';
      } else if (service === 'digilocker') {
        clientIdEnv = 'DIGILOCKER_CLIENT_ID';
        clientSecretEnv = 'DIGILOCKER_CLIENT_SECRET';
      } else if (service === 'google_workspace') {
        clientIdEnv = 'GOOGLE_CLIENT_ID';
        clientSecretEnv = 'GOOGLE_CLIENT_SECRET';
      } else if (service === 'microsoft_365' || service === 'teams') {
        clientIdEnv = 'MICROSOFT_CLIENT_ID';
        clientSecretEnv = 'MICROSOFT_CLIENT_SECRET';
      } else if (service === 'deel') {
        clientIdEnv = 'DEEL_CLIENT_ID';
        clientSecretEnv = 'DEEL_CLIENT_SECRET';
      } else if (service === 'gusto') {
        clientIdEnv = 'GUSTO_CLIENT_ID';
        clientSecretEnv = 'GUSTO_CLIENT_SECRET';
      } else if (service === 'flock') {
        clientIdEnv = 'FLOCK_CLIENT_ID';
        clientSecretEnv = 'FLOCK_CLIENT_SECRET';
      } else if (service === 'okta') {
        clientIdEnv = 'OKTA_CLIENT_ID';
        clientSecretEnv = 'OKTA_CLIENT_SECRET';
      } else if (service === 'salesforce') {
        clientIdEnv = 'SALESFORCE_CLIENT_ID';
        clientSecretEnv = 'SALESFORCE_CLIENT_SECRET';
      } else if (service === 'intercom') {
        clientIdEnv = 'INTERCOM_CLIENT_ID';
        clientSecretEnv = 'INTERCOM_CLIENT_SECRET';
      } else if (service === 'quickbooks') {
        clientIdEnv = 'QUICKBOOKS_CLIENT_ID';
        clientSecretEnv = 'QUICKBOOKS_CLIENT_SECRET';
      } else {
        throw new Error('OAuth provider not implemented');
      }

      const clientId = secretOrNull(clientIdEnv);
      const clientSecret = clientSecretEnv ? secretOrNull(clientSecretEnv) : null;
      if (!clientId || !clientSecret) throw new Error('OAuth env vars are not configured');

      // QuickBooks (Intuit) requires credentials in Authorization: Basic header, not the POST body.
      if (service === 'quickbooks') {
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        token = await postForm(tokenUrl, {
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code,
        }, { Authorization: `Basic ${basic}` });
      } else {
        token = await postForm(tokenUrl, {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          ...(pkceVerifier ? { code_verifier: pkceVerifier } : {}),
        });
      }
    }

    const accessToken = token?.access_token;
    const refreshToken = token?.refresh_token;
    const expiresIn = Number(token?.expires_in || token?.expires_in_sec || token?.expires || 0);

    if (!accessToken) {
      // Log the sanitised token response to aid debugging (no secret values)
      const safeToken = token ? Object.fromEntries(
        Object.entries(token).filter(([k]) => !['access_token','refresh_token','id_token'].includes(k))
      ) : null;
      logger.error('No access token in provider response', { service, safeToken });
      throw new Error(token?.error_description || token?.error || 'No access token returned by provider');
    }

    const integration = await upsertIntegration(rest, orgId, spec.id, {
      status: 'connected',
      auth_type: spec.authType,
      category: spec.category,
      service_name: spec.name,
      last_error_at: null,
      last_error_msg: null,
      last_sync_at: null,
    });

    if (!integration?.id) throw new Error('Failed to store integration');

    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    await upsertCredential(rest, integration.id, 'access_token', encryptSecret(String(accessToken)), true, expiresAt);
    if (refreshToken) {
      await upsertCredential(rest, integration.id, 'refresh_token', encryptSecret(String(refreshToken)), true, null);
    }
    // Persist connection fields (non-sensitive) such as domain for Okta.
    await Promise.all(Object.entries(connection).map(async ([k, v]) => {
      if (!v) return;
      const stored = k === 'domain' || k === 'subdomain' ? normalizeDomainInput(String(v)) : String(v);
      await upsertCredential(rest, integration.id, k, stored, false, null);
    }));

    // For Slack: store team_id so the inbound webhook can route events to the correct org.
    if (service === 'slack' && token?.team?.id) {
      await upsertCredential(rest, integration.id, 'team_id', String(token.team.id), false, null);
    }

    // For Zoho: store api_domain returned in the token response (required for API calls).
    if ((service === 'zoho_people' || service === 'zoho_recruit' || service === 'zoho_learn') && token?.api_domain) {
      await upsertCredential(rest, integration.id, 'api_domain', String(token.api_domain), false, null);
    }

    await writeConnectionLog(rest, integration.id, 'connect', 'success', 'OAuth integration connected', { service, authType: 'oauth2' });
    if (WAVE1_SERVICES.has(service)) {
      await applyWave1Policies(rest, orgId, parsedState.userId || null, [service]);
    }

    const returnTo = safeReturnPath(parsedState.returnTo) || '/dashboard/apps';
    const params = new URLSearchParams({ status: 'connected', service });
    return res.redirect(302, `${frontendUrl}${returnTo}?${params.toString()}`);
  } catch (err: any) {
    logger.warn('OAuth callback failed', { service, error: err?.message || String(err) });
    const params = new URLSearchParams({ status: 'error', service, message: err?.message || 'OAuth failed' });
    const errReturnTo = safeReturnPath((parsedState as any)?.returnTo) || '/dashboard/apps';
    return res.redirect(302, `${frontendUrl}${errReturnTo}?${params.toString()}`);
  }
});

// Connect (API key style)
router.post('/:service/connect', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'api_key' && spec.authType !== 'client_credentials') {
    return res.status(400).json({ success: false, error: 'Integration is not connectable via credentials' });
  }

  const schema = z.object({
    credentials: z.record(z.string(), z.string()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const required = spec.apiKeyConfig?.requiredFields || spec.connectionFields || [];
  for (const field of required) {
    if (field.required && !parsed.data.credentials[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  // Prepare stored credentials and a test payload (adapters expect sensitive fields to be encrypted).
  const storedCredentials: Record<string, string> = {};
  Object.entries(parsed.data.credentials).forEach(([key, value]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    storedCredentials[key] = sensitive
      ? encryptSecret(value)
      : (key.includes('domain') || key.includes('subdomain') ? normalizeDomainInput(value) : value);
  });

  const integration = await upsertIntegration(rest, orgId, spec.id, {
    // Optimistically connect; validation below can downgrade to error if needed.
    status: 'connected',
    auth_type: spec.authType,
    category: spec.category,
    service_name: spec.name,
    last_error_at: null,
    last_error_msg: null,
  });

  if (!integration?.id) return res.status(500).json({ success: false, error: 'Failed to store integration' });

  await Promise.all(Object.entries(storedCredentials).map(async ([key, stored]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    await upsertCredential(rest, integration.id, key, stored, sensitive);
  }));

  // Validate credentials with the adapter when available to avoid false "Connected" states.
  const adapter = getAdapter(service);
  if (!adapter) {
  await writeConnectionLog(rest, integration.id, 'connect', 'success', 'Credential integration stored (no adapter validation)', {
    service: spec.id,
    authType: spec.authType,
    validation: 'adapter_missing',
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });
    return res.json({ success: true, message: 'Integration stored', data: { id: integration.id, service: spec.id, validated: false } });
  }

  const testResult = await adapter.testConnection(storedCredentials);
  if (!testResult.success) {
    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(integration.id));
    await rest('integrations', patchQuery, {
      method: 'PATCH',
      body: {
        status: 'error',
        last_error_at: new Date().toISOString(),
        last_error_msg: testResult.message || 'Credential validation failed',
        updated_at: new Date().toISOString(),
      },
    });

    await writeConnectionLog(rest, integration.id, 'connect', 'failed', testResult.message || 'Credential validation failed', {
      service: spec.id,
      authType: spec.authType,
      actor_user_id: req.user?.id || null,
      actor_email: req.user?.email || null,
    });
    return res.status(400).json({ success: false, error: testResult.message || 'Credential validation failed' });
  }

  const patchQuery = new URLSearchParams();
  patchQuery.set('id', eq(integration.id));
  await rest('integrations', patchQuery, {
    method: 'PATCH',
    body: {
      status: 'connected',
      last_error_at: null,
      last_error_msg: null,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

  await writeConnectionLog(rest, integration.id, 'connect', 'success', 'Credential integration connected (validated)', {
    service: spec.id,
    authType: spec.authType,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });
  const guardrailsApplied = WAVE1_SERVICES.has(spec.id)
    ? (await applyWave1Policies(rest, orgId, req.user?.id || null, [spec.id])).length
    : 0;

  return res.json({ success: true, message: 'Integration connected', data: { id: integration.id, service: spec.id, validated: true, guardrailsApplied } });
});

// Configure (store credentials without validation)
router.post('/:service/configure', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });
  if (spec.authType !== 'api_key' && spec.authType !== 'client_credentials') {
    return res.status(400).json({ success: false, error: 'Integration is not configurable via credentials' });
  }

  const schema = z.object({
    credentials: z.record(z.string(), z.string()),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

  const required = spec.apiKeyConfig?.requiredFields || spec.connectionFields || [];
  for (const field of required) {
    if (field.required && !parsed.data.credentials[field.name]) {
      return res.status(400).json({ success: false, error: `Missing required field: ${field.name}` });
    }
  }

  const storedCredentials: Record<string, string> = {};
  Object.entries(parsed.data.credentials).forEach(([key, value]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    storedCredentials[key] = sensitive
      ? encryptSecret(value)
      : (key.includes('domain') || key.includes('subdomain') ? normalizeDomainInput(value) : value);
  });

  const integration = await upsertIntegration(rest, orgId, spec.id, {
    status: 'configured' as any,
    auth_type: spec.authType,
    category: spec.category,
    service_name: spec.name,
    last_error_at: null,
    last_error_msg: null,
  });

  if (!integration?.id) return res.status(500).json({ success: false, error: 'Failed to store integration' });

  await Promise.all(Object.entries(storedCredentials).map(async ([key, stored]) => {
    const descriptor = required.find((f) => f.name === key);
    const sensitive = descriptor ? descriptor.type === 'password' : true;
    await upsertCredential(rest, integration.id, key, stored, sensitive);
  }));

  await writeConnectionLog(rest, integration.id, 'configure', 'success', 'Credentials stored (not validated)', {
    service: spec.id,
    authType: spec.authType,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });
  const guardrailsApplied = WAVE1_SERVICES.has(spec.id)
    ? (await applyWave1Policies(rest, orgId, req.user?.id || null, [spec.id])).length
    : 0;

  return res.json({ success: true, message: 'Integration configured', data: { id: integration.id, service: spec.id, guardrailsApplied } });
});

// Disconnect
router.post('/:service/disconnect', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  const row = rows?.[0];
  if (!row?.id) return res.json({ success: true, message: 'Already disconnected' });

  const patchQuery = new URLSearchParams();
  patchQuery.set('id', eq(row.id));
  await rest('integrations', patchQuery, {
    method: 'PATCH',
    body: {
      status: 'disconnected',
      last_error_at: null,
      last_error_msg: null,
      updated_at: new Date().toISOString(),
    },
  });

  // Best-effort remove credentials.
  try {
    const credQuery = new URLSearchParams();
    credQuery.set('integration_id', eq(row.id));
    await rest('integration_credentials', credQuery, { method: 'DELETE' });
  } catch (err) {
    logger.warn('Failed to delete integration credentials', { service, error: (err as any)?.message });
  }

  await writeConnectionLog(rest, row.id, 'disconnect', 'success', 'Integration disconnected', {
    service,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  try {
    await pruneDisconnectedIntegrationFromAgents(rest, orgId, service);
  } catch (err: any) {
    logger.warn('Failed to prune disconnected integration from agent publish state', {
      service,
      org_id: orgId,
      error: err?.message || String(err),
    });
  }

  return res.json({ success: true, message: 'Integration disconnected' });
});

// Test connection
router.post('/test/:service', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const service = req.params.service;
  const spec = getIntegrationSpec(service);
  if (!spec) return res.status(404).json({ success: false, error: 'Integration not found' });

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('service_type', eq(service));
  query.set('select', '*');
  const rows = await safeQuery<StoredIntegrationRow>(rest, 'integrations', query);
  let row = rows?.[0];

  // Built-in SyntheticHR integration does not require external adapter/credentials.
  if (service === 'internal') {
    if (!row?.id) {
      row = await upsertIntegration(rest, orgId, service, {
        status: 'connected',
        auth_type: 'api_key',
        category: 'OTHER',
        service_name: spec.name,
        last_error_at: null,
        last_error_msg: null,
      });
    }

    if (!row?.id) return res.status(500).json({ success: false, error: 'Failed to initialize internal integration' });

    const patchQuery = new URLSearchParams();
    patchQuery.set('id', eq(row.id));
    await rest('integrations', patchQuery, {
      method: 'PATCH',
      body: {
        status: 'connected',
        last_error_at: null,
        last_error_msg: null,
        last_sync_at: new Date().toISOString(),
        last_tested_at: new Date().toISOString(),
        last_test_result: 'ok',
        updated_at: new Date().toISOString(),
      },
    });

    await writeConnectionLog(rest, row.id, 'test', 'success', 'Internal integration test passed', {
      service: spec.id,
      actor_user_id: req.user?.id || null,
      actor_email: req.user?.email || null,
    });

    return res.json({
      success: true,
      data: {
        service,
        result: {
          success: true,
          message: 'Internal integration is healthy',
        },
      },
    });
  }

  if (!row?.id) return res.status(400).json({ success: false, error: 'Integration not connected' });

  const creds = await readCredentials(rest, row.id);
  const adapter = getAdapter(service);
  if (!adapter) return res.status(501).json({ success: false, error: 'Adapter not implemented' });

  let result = await adapter.testConnection(creds);

  // If an OAuth token is expired and we have a refresh path, attempt one refresh then retry once.
  const maybeExpired = !result.success && /expired/i.test(result.message);
  if (maybeExpired && adapter.refreshToken && creds.refresh_token) {
    try {
      const token = await adapter.refreshToken(creds);
      const expiresIn = Number(token?.expires_in || 0);
      const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

      await upsertCredential(rest, row.id, 'access_token', encryptSecret(String(token.access_token)), true, expiresAt);
      if (token.refresh_token) {
        await upsertCredential(rest, row.id, 'refresh_token', encryptSecret(String(token.refresh_token)), true, null);
      }
      await writeConnectionLog(rest, row.id, 'refresh', 'success', 'Token refreshed during test', { service });

      result = await adapter.testConnection({ ...creds, access_token: String(token.access_token) });
    } catch (err: any) {
      await writeConnectionLog(rest, row.id, 'refresh', 'failed', err?.message || 'Token refresh failed during test', { service });
    }
  }

  const patchQuery = new URLSearchParams();
  patchQuery.set('id', eq(row.id));
  await rest('integrations', patchQuery, {
    method: 'PATCH',
    body: {
      status: result.success ? 'connected' : 'error',
      last_error_at: result.success ? null : new Date().toISOString(),
      last_error_msg: result.success ? null : result.message,
      last_tested_at: new Date().toISOString(),
      last_test_result: result.success ? 'ok' : 'error',
      updated_at: new Date().toISOString(),
    },
  });

  await writeConnectionLog(rest, row.id, 'test', result.success ? 'success' : 'failed', result.message, {
    service,
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
  });

  return res.json({ success: true, data: result });
});

// ─── Slack Inbox ──────────────────────────────────────────────────────────────

// GET /api/integrations/slack/messages
// List inbound Slack messages for the authenticated org.
router.get('/slack/messages', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const rest = restAsUser(req);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;

  const query = new URLSearchParams();
  query.set('organization_id', eq(orgId));
  query.set('order', 'created_at.desc');
  query.set('limit', String(limit));
  query.set('offset', String(offset));
  query.set('select', 'id,slack_channel_id,slack_channel_name,slack_user_id,slack_user_name,slack_ts,thread_ts,text,event_type,status,metadata,created_at,updated_at');
  if (statusFilter) query.set('status', eq(statusFilter));

  const messages = await safeQuery<Record<string, any>>(rest, 'slack_messages', query);
  return res.json({ success: true, data: messages });
});

// POST /api/integrations/slack/messages/:id/reply
// Send a reply into the Slack thread and mark the message as replied.
router.post('/slack/messages/:id/reply', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const messageId = req.params.id;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ success: false, error: 'text is required' });

  const rest = restAsUser(req);

  // Load the target message (RLS enforces org ownership)
  const messages = await safeQuery<Record<string, any>>(
    rest,
    'slack_messages',
    new URLSearchParams({ id: eq(messageId), organization_id: eq(orgId), select: '*', limit: '1' }),
  );
  if (!messages.length) return res.status(404).json({ success: false, error: 'Message not found' });
  const message = messages[0];

  // Load Slack integration for this org
  const integrations = await safeQuery<StoredIntegrationRow>(
    restAsService,
    'integrations',
    new URLSearchParams({ organization_id: eq(orgId), service_type: eq('slack'), status: eq('connected'), select: 'id', limit: '1' }),
  );
  if (!integrations.length) return res.status(400).json({ success: false, error: 'Slack integration not connected' });

  // Load access_token credential
  const creds = await safeQuery<StoredCredentialRow>(
    restAsService,
    'integration_credentials',
    new URLSearchParams({ integration_id: eq(integrations[0].id), key: eq('access_token'), select: 'value', limit: '1' }),
  );
  if (!creds.length) return res.status(400).json({ success: false, error: 'Slack access token not found' });

  const accessToken = decryptSecret(creds[0].value);

  // Post to Slack as a threaded reply
  const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: message.slack_channel_id,
      text,
      thread_ts: message.slack_ts,
    }),
  });
  const slackJson: any = await slackRes.json().catch(() => null);
  if (!slackJson?.ok) {
    return res.status(502).json({ success: false, error: slackJson?.error || 'Slack API error' });
  }

  // Mark message as replied
  await restAsService(
    'slack_messages',
    new URLSearchParams({ id: eq(messageId), organization_id: eq(orgId) }),
    { method: 'PATCH', body: { status: 'replied', updated_at: new Date().toISOString() } },
  );

  return res.json({ success: true, data: { slack_ts: slackJson.ts } });
});

// POST /api/integrations/slack/actions
// Receives interactive component callbacks (button clicks) from Slack.
// Handles rasi_approve / rasi_deny actions by calling the approvals endpoint.
router.post('/slack/actions', async (req, res) => {
  // Slack sends interactive payloads as URL-encoded body with key "payload"
  const rawPayload = typeof req.body?.payload === 'string' ? req.body.payload : null;
  if (!rawPayload) return res.status(400).json({ ok: false, error: 'Missing payload' });

  let payload: any;
  try { payload = JSON.parse(rawPayload); } catch { return res.status(400).json({ ok: false, error: 'Invalid payload JSON' }); }

  const action = payload?.actions?.[0];
  if (!action) return res.status(200).send(''); // Ack unknown event immediately

  const { action_id, value: approvalId } = action;
  if (!approvalId || (action_id !== 'rasi_approve' && action_id !== 'rasi_deny')) {
    return res.status(200).send('');
  }

  // Ack Slack immediately (must respond within 3s)
  res.status(200).json({ text: `Processing ${action_id === 'rasi_approve' ? 'approval' : 'denial'}…` });

  // Look up approval to get org_id
  try {
    const approvalRows = await safeQuery<{ id: string; organization_id: string }>(
      restAsService,
      'approval_requests',
      new URLSearchParams({ id: eq(approvalId), select: 'id,organization_id', limit: '1' }),
    );
    if (!approvalRows.length) return;

    const orgId = approvalRows[0].organization_id;
    const slackUserId = payload?.user?.id;
    const slackUserName = payload?.user?.name || slackUserId;

    // Perform approve/deny using service role
    const endpoint = action_id === 'rasi_approve' ? 'approve' : 'deny';
    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`;
    await fetch(`${apiUrl}/api/approvals/${approvalId}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rasi-service-action': 'slack-interactive',
        'x-rasi-org-id': orgId,
      },
      body: JSON.stringify({ reviewer_notes: `${action_id === 'rasi_approve' ? 'Approved' : 'Denied'} via Slack by @${slackUserName}` }),
    }).catch((err) => logger.warn('Slack action relay error', { error: err?.message }));

    // Update the original Slack message via response_url
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: true,
          text: action_id === 'rasi_approve'
            ? `:white_check_mark: *Approved* by @${slackUserName}`
            : `:x: *Denied* by @${slackUserName}`,
        }),
      }).catch(() => null);
    }
  } catch (err: any) {
    logger.warn('Slack action handler error', { error: err?.message });
  }
});

// POST /api/integrations/slack/messages/:id/status
// Update the status of a Slack message (reviewed / dismissed / new).
router.post('/slack/messages/:id/status', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const messageId = req.params.id;
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  const validStatuses = ['new', 'reviewed', 'replied', 'dismissed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const rest = restAsUser(req);
  await rest(
    'slack_messages',
    new URLSearchParams({ id: eq(messageId), organization_id: eq(orgId) }),
    { method: 'PATCH', body: { status, updated_at: new Date().toISOString() } },
  );

  return res.json({ success: true });
});

// ---------------------------------------------------------------------------
// PATCH /api/integrations/:service/capabilities
// Toggle which capabilities are enabled for a connected integration.
// Body: { enabled: string[] } — list of capability IDs to enable.
// An empty array means all capabilities are permitted (backwards-compatible default).
// ---------------------------------------------------------------------------
router.patch('/:service/capabilities', requirePermission('connectors.manage'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  const { service } = req.params;
  const { enabled } = req.body as { enabled?: unknown };

  if (!Array.isArray(enabled) || enabled.some((c) => typeof c !== 'string')) {
    return res.status(400).json({ success: false, error: 'enabled must be an array of capability ID strings' });
  }

  try {
    const rest = restAsUser(req);
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('service_type', eq(service));
    const rows = await safeQuery<{ id: string }>(rest, 'integrations', q);
    if (!rows?.length) return res.status(404).json({ success: false, error: 'Integration not connected' });

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(rows[0].id));
    await rest('integrations', patchQ, {
      method: 'PATCH',
      body: { enabled_capabilities: enabled, updated_at: new Date().toISOString() },
    });

    logger.info('Integration capabilities updated', { orgId, service, enabled });
    return res.json({ success: true, data: { service, enabled_capabilities: enabled } });
  } catch (err: any) {
    logger.error('Failed to update integration capabilities', { orgId, service, error: err?.message });
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/health-summary
// Returns status + last test result for all integrations in the org.
// Used by the App Hub health dashboard.
// ---------------------------------------------------------------------------
router.get('/health-summary', requirePermission('connectors.read'), async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

  try {
    const rest = restAsUser(req);
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('select', 'service_type,status,last_error_msg,last_error_at,last_tested_at,last_test_result');
    q.set('order', 'service_type.asc');
    const rows = (await safeQuery<any>(rest, 'integrations', q)) ?? [];

    const summary = rows.map((r: any) => ({
      service: r.service_type,
      status: r.status,
      last_error_msg: r.last_error_msg ?? null,
      last_error_at: r.last_error_at ?? null,
      last_tested_at: r.last_tested_at ?? null,
      last_test_result: r.last_test_result ?? null,
    }));

    return res.json({ success: true, data: summary });
  } catch (err: any) {
    logger.error('Failed to fetch integration health summary', { orgId, error: err?.message });
    return res.status(500).json({ success: false, error: err?.message });
  }
});

export default router;
