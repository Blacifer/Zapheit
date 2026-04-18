import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { parseOpenApiToCapabilities } from '../lib/openapi-ingest';
import { appendAuditChainEvent, verifyAuditChain } from '../lib/trust-audit-chain';
import { runPreflightGate } from '../lib/preflight-gate';
import { logger } from '../lib/logger';

const router = Router();

type RestFn = (table: string, query: string | URLSearchParams, options?: { method?: string; body?: any }) => Promise<any>;
const restAsUser = (req: any): RestFn => {
  const jwt = req.userJwt as string;
  return (table, query, options = {}) => supabaseRestAsUser(jwt, table, query, options);
};

const openApiIngestSchema = z.object({
  service_id: z.string().min(2),
  source_url: z.string().url().optional(),
  spec_json: z.record(z.any()).optional(),
});

router.post('/openapi/ingest', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const parsed = openApiIngestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid payload' });

    const { service_id, source_url, spec_json } = parsed.data;
    let spec = spec_json as Record<string, any> | undefined;
    if (!spec && source_url) {
      const response = await fetch(source_url);
      if (!response.ok) return res.status(400).json({ success: false, error: `Failed to fetch spec: ${response.status}` });
      spec = (await response.json()) as Record<string, any>;
    }
    if (!spec) return res.status(400).json({ success: false, error: 'Either source_url or spec_json is required' });

    const ingest = parseOpenApiToCapabilities(spec, service_id);
    const rest = restAsUser(req);
    await rest('integration_openapi_specs', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        service_id,
        source_url: source_url || null,
        title: ingest.title,
        version: ingest.version,
        spec_hash: ingest.spec_hash,
        raw_spec: spec,
        capability_map: { capabilities: ingest.capabilities },
        created_by: req.user?.id || null,
      },
    });

    for (const capability of ingest.capabilities) {
      if (capability.operation === 'read') continue;
      await rest('action_policies', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          service: service_id,
          action: capability.operation_id,
          enabled: true,
          require_approval: capability.requires_approval_default,
          required_role: capability.requires_approval_default ? 'manager' : 'viewer',
          notes: `Auto-generated from OpenAPI ingest (${ingest.title} ${ingest.version})`,
          policy_constraints: {
            openapi_method: capability.method,
            openapi_path: capability.path,
            openapi_operation: capability.operation,
            openapi_risk: capability.risk,
            openapi_schema: capability.schema,
          },
          updated_by: req.user?.id || null,
        },
      }).catch(() => undefined);
    }

    await appendAuditChainEvent({
      organization_id: orgId,
      event_type: 'openapi.ingest.completed',
      entity_type: 'integration_service',
      entity_id: service_id,
      payload: {
        source_url: source_url || null,
        title: ingest.title,
        version: ingest.version,
        capabilities: ingest.capabilities.length,
      },
    });

    return res.json({ success: true, data: ingest });
  } catch (err: any) {
    logger.error('OpenAPI ingest failed', { error: err?.message });
    return res.status(500).json({ success: false, error: err?.message || 'Failed to ingest OpenAPI spec' });
  }
});

router.get('/openapi/specs', requirePermission('connectors.read'), async (req, res) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const rest = restAsUser(req);
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('order', 'created_at.desc');
  q.set('select', 'id,service_id,title,version,source_url,spec_hash,created_by,created_at,updated_at');
  const rows = await rest('integration_openapi_specs', q);
  return res.json({ success: true, data: rows || [] });
});

router.post('/audit-chain/verify', requirePermission('compliance.log'), async (req, res) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const limitRaw = typeof req.body?.limit === 'number' ? req.body.limit : 500;
  const result = await verifyAuditChain(orgId, limitRaw);
  return res.json({ success: true, data: result });
});

router.get('/evidence/export/:executionId', requirePermission('compliance.export'), async (req, res) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const executionId = req.params.executionId;
  const rest = restAsUser(req);

  const executionQ = new URLSearchParams();
  executionQ.set('id', eq(executionId));
  executionQ.set('organization_id', eq(orgId));
  executionQ.set('select', 'id,connector_id,action,params,result,success,error_message,approval_id,requested_by,policy_snapshot,before_state,after_state,remediation,created_at');
  executionQ.set('limit', '1');
  const rows = await rest('connector_action_executions', executionQ);
  const execution = Array.isArray(rows) ? rows[0] : null;
  if (!execution) return res.status(404).json({ success: false, error: 'Governed action not found' });

  const chain = await verifyAuditChain(orgId, 500);
  const bundle = {
    exported_at: new Date().toISOString(),
    organization_id: orgId,
    execution,
    audit_chain_verification: chain,
  };
  return res.json({ success: true, data: bundle });
});

router.post('/red-team/run', requirePermission('connectors.manage'), async (req, res) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const rest = restAsUser(req);
    const scenarios = [
      { connector: 'slack', action: 'send_message', params: { channel: '#general', text: 'Aadhaar 1234 5678 9123' } },
      { connector: 'razorpay', action: 'refund_payment', params: { amount: 5000000, currency: 'INR' } },
      { connector: 'internal', action: 'compliance.sensitive_data.access', params: { subject: 'employee_records' } },
    ];
    const findings: Array<Record<string, any>> = [];
    for (const scenario of scenarios) {
      const preflight = await runPreflightGate(orgId, scenario.connector, scenario.action, scenario.params, null);
      findings.push({
        scenario,
        decision: preflight.decision,
        reason_category: preflight.reasonCategory,
        reason_message: preflight.reasonMessage,
        recommended_next_action: preflight.recommendedNextAction,
      });
    }
    const blocked = findings.filter((f) => f.decision !== 'allow').length;
    const runRows = await rest('redteam_runs', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        status: 'completed',
        scenario_count: scenarios.length,
        blocked_count: blocked,
        findings,
        triggered_by: req.user?.id || null,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      },
    });
    const run = Array.isArray(runRows) ? runRows[0] : null;

    await appendAuditChainEvent({
      organization_id: orgId,
      event_type: 'redteam.run.completed',
      entity_type: 'redteam_run',
      entity_id: run?.id || 'unknown',
      payload: { scenario_count: scenarios.length, blocked_count: blocked },
    });

    return res.json({ success: true, data: { run_id: run?.id || null, scenario_count: scenarios.length, blocked_count: blocked, findings } });
  } catch (err: any) {
    logger.error('Red-team run failed', { error: err?.message });
    return res.status(500).json({ success: false, error: err?.message || 'Failed to run red-team simulation' });
  }
});

router.get('/red-team/runs', requirePermission('connectors.read'), async (req, res) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const rest = restAsUser(req);
  const q = new URLSearchParams();
  q.set('organization_id', eq(orgId));
  q.set('select', 'id,status,scenario_count,blocked_count,triggered_by,started_at,finished_at,created_at');
  q.set('order', 'created_at.desc');
  q.set('limit', '50');
  const rows = await rest('redteam_runs', q);
  return res.json({ success: true, data: rows || [] });
});

export default router;
