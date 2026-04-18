import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission, hasPermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsUser, supabaseRest, supabaseRestAsService } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserId = (req: any): string | null => req.user?.id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function nowIso() {
  return new Date().toISOString();
}

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('Playbooks route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

// ─── Playbook settings ───────────────────────────────────────────────────────

const upsertSchema = z.object({
  enabled: z.boolean().optional(),
  overrides: z.record(z.any()).optional(),
  api_enabled: z.boolean().optional(),
  api_slug: z.string().max(80).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens').optional().nullable(),
});

router.get('/settings', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'updated_at.desc');

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_settings', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.patch('/settings/:playbookId', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const playbookId = String(req.params.playbookId || '').trim();
    if (!playbookId) return res.status(400).json({ success: false, error: 'playbookId is required' });

    const parsed = upsertSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const existingQ = new URLSearchParams();
    existingQ.set('organization_id', eq(orgId));
    existingQ.set('playbook_id', eq(playbookId));
    existingQ.set('select', '*');
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'playbook_settings', existingQ)) as any[];
    const row = existing?.[0] || null;

    const now = nowIso();
    if (row?.id) {
      const patchQ = new URLSearchParams();
      patchQ.set('id', eq(row.id));
      patchQ.set('organization_id', eq(orgId));

      const patched = (await supabaseRestAsUser(getUserJwt(req), 'playbook_settings', patchQ, {
        method: 'PATCH',
        body: {
          ...(typeof parsed.data.enabled === 'boolean' ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.overrides ? { overrides: parsed.data.overrides } : {}),
          ...(typeof parsed.data.api_enabled === 'boolean' ? { api_enabled: parsed.data.api_enabled } : {}),
          ...(parsed.data.api_slug !== undefined ? { api_slug: parsed.data.api_slug } : {}),
          updated_by: userId,
          updated_at: now,
        },
      })) as any[];

      const updated = patched?.[0] || null;
      if (!updated) return res.status(500).json({ success: false, error: 'Failed to update playbook setting' });

      await auditLog.log({
        user_id: userId,
        action: 'playbook.setting.updated',
        resource_type: 'playbook_setting',
        resource_id: updated.id,
        organization_id: orgId,
        ip_address: req.ip || (req.socket as any)?.remoteAddress,
        user_agent: req.get('user-agent') || undefined,
        metadata: { playbook_id: playbookId, enabled: updated.enabled },
      });

      return res.json({ success: true, data: updated });
    }

    const created = (await supabaseRestAsUser(getUserJwt(req), 'playbook_settings', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        playbook_id: playbookId,
        enabled: typeof parsed.data.enabled === 'boolean' ? parsed.data.enabled : true,
        overrides: parsed.data.overrides || {},
        updated_by: userId,
        updated_at: now,
      },
    })) as any[];

    const createdRow = created?.[0] || null;
    if (!createdRow) return res.status(500).json({ success: false, error: 'Failed to create playbook setting' });

    await auditLog.log({
      user_id: userId,
      action: 'playbook.setting.created',
      resource_type: 'playbook_setting',
      resource_id: createdRow.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { playbook_id: playbookId, enabled: createdRow.enabled },
    });

    return res.status(201).json({ success: true, data: createdRow });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── AI form filling: generate inputs from free-form text ────────────────────

router.post('/:playbookId/generate-inputs', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const { context, field_extractor_prompt, fields } = req.body || {};
    if (!context || typeof context !== 'string') {
      return res.status(400).json({ success: false, error: 'context string is required' });
    }

    const extractorPrompt = String(field_extractor_prompt || 'Extract key information from the text and return a JSON object with the field values.');
    const fieldKeys = Array.isArray(fields) ? fields.map((f: any) => String(f.key || '')).filter(Boolean) : [];

    const apiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, error: 'LLM not configured for field extraction' });
    }

    const systemPrompt = `${extractorPrompt}\n\nReturn ONLY a valid JSON object. Keys should be: ${fieldKeys.join(', ')}. Do not include markdown, explanations, or any text outside the JSON object.`;

    const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: context },
        ],
      }),
    });

    if (!llmResponse.ok) {
      const errBody = await llmResponse.text().catch(() => '');
      logger.error('LLM field extraction failed', { status: llmResponse.status, body: errBody });
      return res.status(502).json({ success: false, error: 'Field extraction failed — LLM error' });
    }

    const llmData = await llmResponse.json() as any;
    const raw = llmData?.choices?.[0]?.message?.content || '{}';

    let fields_result: Record<string, string> = {};
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      fields_result = JSON.parse(cleaned);
    } catch {
      // Best-effort: return empty
      fields_result = {};
    }

    return res.json({ success: true, data: { fields: fields_result } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── Playbook schedules ──────────────────────────────────────────────────────

router.get('/schedules', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_schedules', q)) as any[];
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) {
    return safeError(res, err);
  }
});

const scheduleSchema = z.object({
  playbook_id: z.string().min(1),
  agent_id: z.string().uuid(),
  input_template: z.record(z.any()).optional(),
  cron_expression: z.string().min(1),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
});

router.post('/schedules', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_schedules', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        playbook_id: parsed.data.playbook_id,
        agent_id: parsed.data.agent_id,
        input_template: parsed.data.input_template || {},
        cron_expression: parsed.data.cron_expression,
        timezone: parsed.data.timezone || 'UTC',
        enabled: parsed.data.enabled !== false,
        created_by: userId,
        created_at: nowIso(),
        updated_at: nowIso(),
      },
    })) as any[];

    const row = rows?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create schedule' });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.patch('/schedules/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(req.params.id));
    patchQ.set('organization_id', eq(orgId));

    const allowed = ['input_template', 'cron_expression', 'timezone', 'enabled'];
    const body: Record<string, any> = { updated_at: nowIso() };
    for (const k of allowed) {
      if (req.body[k] !== undefined) body[k] = req.body[k];
    }

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_schedules', patchQ, { method: 'PATCH', body })) as any[];
    return res.json({ success: true, data: rows?.[0] || null });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.delete('/schedules/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('id', eq(req.params.id));
    q.set('organization_id', eq(orgId));
    await supabaseRestAsUser(getUserJwt(req), 'playbook_schedules', q, { method: 'DELETE' });
    return res.json({ success: true });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── Event triggers ──────────────────────────────────────────────────────────

router.get('/triggers', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_triggers', q)) as any[];
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) {
    return safeError(res, err);
  }
});

const triggerSchema = z.object({
  name: z.string().min(1),
  playbook_id: z.string().min(1),
  agent_id: z.string().uuid(),
  event_type: z.string().min(1),
  event_filter: z.record(z.any()).optional(),
  field_mappings: z.record(z.string()).default({}),
  enabled: z.boolean().optional(),
});

router.post('/triggers', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_triggers', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        name: parsed.data.name,
        playbook_id: parsed.data.playbook_id,
        agent_id: parsed.data.agent_id,
        event_type: parsed.data.event_type,
        event_filter: parsed.data.event_filter || {},
        field_mappings: parsed.data.field_mappings,
        enabled: parsed.data.enabled !== false,
        created_by: userId,
        created_at: nowIso(),
      },
    })) as any[];

    const row = rows?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create trigger' });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.patch('/triggers/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(req.params.id));
    patchQ.set('organization_id', eq(orgId));

    const allowed = ['name', 'field_mappings', 'event_filter', 'enabled'];
    const body: Record<string, any> = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) body[k] = req.body[k];
    }

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'playbook_triggers', patchQ, { method: 'PATCH', body })) as any[];
    return res.json({ success: true, data: rows?.[0] || null });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.delete('/triggers/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('id', eq(req.params.id));
    q.set('organization_id', eq(orgId));
    await supabaseRestAsUser(getUserJwt(req), 'playbook_triggers', q, { method: 'DELETE' });
    return res.json({ success: true });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── Custom playbooks ────────────────────────────────────────────────────────

router.get('/custom', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    if (req.query.enabled === 'true') q.set('enabled', eq('true'));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'custom_playbooks', q)) as any[];
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) {
    return safeError(res, err);
  }
});

const customPlaybookSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  output_description: z.string().optional(),
  field_extractor_prompt: z.string().optional(),
  category: z.enum(['hr', 'support', 'sales', 'it', 'custom']).default('custom'),
  icon_name: z.string().optional(),
  fields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    placeholder: z.string().optional(),
    kind: z.enum(['text', 'textarea']),
  })),
  workflow: z.object({
    type: z.enum(['chat_turn', 'workflow_run']).optional(), // optional in v2 step-based format
    steps: z.array(z.any()).optional(),
    messages: z.array(z.any()).optional(),
    final_step: z.string().optional(),
    start: z.string().optional(),
    version: z.number().optional(),
  }),
  enabled: z.boolean().optional(),
});

router.post('/custom', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = customPlaybookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const d = parsed.data;
    const now = nowIso();
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'custom_playbooks', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        name: d.name,
        description: d.description || null,
        output_description: d.output_description || null,
        field_extractor_prompt: d.field_extractor_prompt || null,
        category: d.category,
        icon_name: d.icon_name || null,
        fields: d.fields,
        workflow: d.workflow,
        version: 1,
        version_history: [],
        test_cases: [],
        enabled: d.enabled !== false,
        created_by: userId,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = rows?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create custom playbook' });

    await auditLog.log({
      user_id: userId,
      action: 'custom_playbook.created',
      resource_type: 'custom_playbook',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { name: row.name, category: row.category },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.patch('/custom/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    // Load current version for history
    const existQ = new URLSearchParams();
    existQ.set('id', eq(req.params.id));
    existQ.set('organization_id', eq(orgId));
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'custom_playbooks', existQ)) as any[];
    const current = existing?.[0];
    if (!current) return res.status(404).json({ success: false, error: 'Custom playbook not found' });

    // Snapshot current workflow into version_history
    const history = Array.isArray(current.version_history) ? current.version_history : [];
    history.push({ version: current.version, workflow: current.workflow, fields: current.fields, updated_at: current.updated_at });
    if (history.length > 20) history.splice(0, history.length - 20); // keep last 20

    const allowed = ['name', 'description', 'output_description', 'field_extractor_prompt', 'category', 'icon_name', 'fields', 'workflow', 'enabled', 'test_cases'];
    const body: Record<string, any> = {
      version: current.version + 1,
      version_history: history,
      updated_at: nowIso(),
    };
    for (const k of allowed) {
      if (req.body[k] !== undefined) body[k] = req.body[k];
    }

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(req.params.id));
    patchQ.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'custom_playbooks', patchQ, { method: 'PATCH', body })) as any[];
    return res.json({ success: true, data: rows?.[0] || null });
  } catch (err: any) {
    return safeError(res, err);
  }
});

router.delete('/custom/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const q = new URLSearchParams();
    q.set('id', eq(req.params.id));
    q.set('organization_id', eq(orgId));
    await supabaseRestAsUser(getUserJwt(req), 'custom_playbooks', q, { method: 'DELETE' });
    return res.json({ success: true });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── Analytics ───────────────────────────────────────────────────────────────

router.get('/analytics', requirePermission('agents.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const days = Math.min(90, Math.max(7, Number(req.query.days || 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch playbook jobs in window.
    const jobQ = new URLSearchParams();
    jobQ.set('organization_id', eq(orgId));
    jobQ.set('created_at', `gte.${since}`);
    jobQ.set('select', 'id,playbook_id,status,feedback,created_at,type');
    jobQ.set('limit', '2000');
    jobQ.set('order', 'created_at.asc');
    const jobs = (await supabaseRestAsUser(getUserJwt(req), 'agent_jobs', jobQ)) as Array<{
      id: string;
      playbook_id: string | null;
      status: string;
      feedback: number | null;
      created_at: string;
      type: string;
    }>;

    // Fetch cost tracking for those jobs.
    const costQ = new URLSearchParams();
    costQ.set('organization_id', eq(orgId));
    costQ.set('created_at', `gte.${since}`);
    costQ.set('select', 'job_id,cost_usd,total_tokens');
    costQ.set('limit', '2000');
    const costs = (await supabaseRestAsUser(getUserJwt(req), 'cost_tracking', costQ)) as Array<{
      job_id: string | null;
      cost_usd: number;
      total_tokens: number;
    }>;

    const costByJobId = new Map<string, { cost: number; tokens: number }>();
    for (const c of costs || []) {
      if (c.job_id) costByJobId.set(c.job_id, { cost: Number(c.cost_usd) || 0, tokens: Number(c.total_tokens) || 0 });
    }

    // Aggregate by playbook_id.
    const byPlaybook = new Map<string, { runs: number; succeeded: number; failed: number; thumbsUp: number; thumbsDown: number; totalCostUsd: number }>();
    for (const job of jobs || []) {
      const pid = job.playbook_id || '__untracked__';
      const entry = byPlaybook.get(pid) || { runs: 0, succeeded: 0, failed: 0, thumbsUp: 0, thumbsDown: 0, totalCostUsd: 0 };
      entry.runs++;
      if (job.status === 'succeeded') entry.succeeded++;
      if (job.status === 'failed') entry.failed++;
      if (job.feedback === 1) entry.thumbsUp++;
      if (job.feedback === -1) entry.thumbsDown++;
      const jobCost = costByJobId.get(job.id);
      if (jobCost) entry.totalCostUsd += jobCost.cost;
      byPlaybook.set(pid, entry);
    }

    const playbookStats = Array.from(byPlaybook.entries())
      .filter(([pid]) => pid !== '__untracked__')
      .map(([playbook_id, stats]) => ({
        playbook_id,
        ...stats,
        avg_cost_usd: stats.runs > 0 ? stats.totalCostUsd / stats.runs : 0,
        success_rate: stats.runs > 0 ? Math.round((stats.succeeded / stats.runs) * 100) : 0,
      }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 20);

    // Daily volume time series.
    const dailyMap = new Map<string, number>();
    for (const job of jobs || []) {
      const day = job.created_at.slice(0, 10); // YYYY-MM-DD
      dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
    }
    // Fill gaps with 0.
    const dailySeries: Array<{ date: string; runs: number }> = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailySeries.push({ date: key, runs: dailyMap.get(key) || 0 });
    }

    // Totals.
    const totalRuns = (jobs || []).length;
    const totalSucceeded = (jobs || []).filter((j) => j.status === 'succeeded').length;
    const totalCostUsd = Array.from(costByJobId.values()).reduce((s, c) => s + c.cost, 0);

    return res.json({
      success: true,
      data: {
        totals: { runs: totalRuns, succeeded: totalSucceeded, cost_usd: totalCostUsd, days },
        by_playbook: playbookStats,
        daily_series: dailySeries,
      },
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── Public share endpoint (no auth) ─────────────────────────────────────────
// Note: mounted OUTSIDE auth middleware in index.ts as /share/:token

export async function handleShareToken(req: Request, res: Response) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ success: false, error: 'Token required' });

    const q = new URLSearchParams();
    q.set('token', eq(token));
    q.set('select', '*');
    q.set('limit', '1');
    const links = (await supabaseRest('playbook_share_links', q)) as any[];
    const link = links?.[0];

    if (!link) return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    if (new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Share link has expired' });
    }

    const jobQ = new URLSearchParams();
    jobQ.set('id', eq(link.job_id));
    jobQ.set('select', 'id,type,status,input,output,playbook_id,created_at,finished_at');
    const jobs = (await supabaseRest('agent_jobs', jobQ)) as any[];
    const job = jobs?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    return res.json({ success: true, data: { job, expires_at: link.expires_at } });
  } catch (err: any) {
    logger.error('Share token lookup error', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

// ─── Public API endpoint (API key auth, mounted at /public/playbooks/:slug) ───
// Mounted OUTSIDE user auth middleware in index.ts.
// Caller authenticates with an `sk_...` API key in Authorization header.

export async function handlePublicPlaybookRun(req: Request, res: Response) {
  try {
    const apiKey = (req as any).apiKey as { id: string; organization_id: string; name: string } | undefined;
    if (!apiKey?.organization_id) {
      return res.status(401).json({ success: false, error: 'Valid API key required' });
    }

    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ success: false, error: 'Playbook slug required' });

    // Look up a playbook_setting with api_enabled = true and api_slug = slug.
    const settingQ = new URLSearchParams();
    settingQ.set('organization_id', eq(apiKey.organization_id));
    settingQ.set('api_slug', eq(slug));
    settingQ.set('api_enabled', eq('true'));
    settingQ.set('limit', '1');
    const settings = (await supabaseRestAsService('playbook_settings', settingQ)) as any[];
    const setting = settings?.[0];

    if (!setting) {
      return res.status(404).json({
        success: false,
        error: `No API-enabled playbook found for slug "${slug}". Enable "Expose as API" on the playbook first.`,
      });
    }

    // Find an active agent for this org.
    const agentId: string | null = req.body?.agent_id || null;
    let resolvedAgentId = agentId;
    if (!resolvedAgentId) {
      const agentQ = new URLSearchParams();
      agentQ.set('organization_id', eq(apiKey.organization_id));
      agentQ.set('status', eq('active'));
      agentQ.set('order', 'created_at.asc');
      agentQ.set('limit', '1');
      const agents = (await supabaseRestAsService('ai_agents', agentQ)) as any[];
      resolvedAgentId = agents?.[0]?.id || null;
    }

    if (!resolvedAgentId) {
      return res.status(422).json({ success: false, error: 'No active agent found for this organization' });
    }

    // Find an online runtime.
    const runtimeQ = new URLSearchParams();
    runtimeQ.set('organization_id', eq(apiKey.organization_id));
    runtimeQ.set('status', eq('online'));
    runtimeQ.set('order', 'last_heartbeat_at.desc');
    runtimeQ.set('limit', '1');
    const runtimes = (await supabaseRestAsService('runtime_instances', runtimeQ)) as any[];
    const runtimeId = runtimes?.[0]?.id || null;

    // Build job input from request body fields (excluding agent_id).
    const { agent_id: _ignored, ...inputFields } = req.body || {};
    const now = nowIso();

    const jobInput = {
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are running the "${setting.playbook_id}" playbook via the Zapheit API.`,
        },
        {
          role: 'user',
          content: `Execute the ${setting.playbook_id} playbook with the following inputs:\n\n${
            Object.entries(inputFields).map(([k, v]) => `${k}: ${String(v)}`).join('\n')
          }`,
        },
      ],
    };

    // Create the queued job.
    const created = (await supabaseRestAsService('agent_jobs', '', {
      method: 'POST',
      body: {
        organization_id: apiKey.organization_id,
        agent_id: resolvedAgentId,
        runtime_instance_id: runtimeId,
        type: 'chat_turn',
        status: 'queued',
        input: jobInput,
        playbook_id: setting.playbook_id,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const job = created?.[0];
    if (!job?.id) return res.status(500).json({ success: false, error: 'Failed to create job' });

    // Pre-approve for audit trail.
    await supabaseRestAsService('agent_job_approvals', '', {
      method: 'POST',
      body: {
        organization_id: apiKey.organization_id,
        job_id: job.id,
        status: 'approved',
        decided_by: null,
        decision_note: `Auto-approved: public API call (key: ${apiKey.name})`,
        created_at: now,
        updated_at: now,
      },
    }).catch(() => void 0);

    // Record API key usage.
    try {
      const usageQ = new URLSearchParams();
      usageQ.set('id', eq(apiKey.id));
      await supabaseRestAsService('api_keys', usageQ, {
        method: 'PATCH',
        body: { last_used: now },
      });
    } catch { /* non-fatal */ }

    const syncMode = req.query.sync === 'true';
    if (!syncMode) {
      return res.status(202).json({ success: true, job_id: job.id, status: 'queued' });
    }

    // Synchronous mode: poll up to 30s for completion.
    const timeoutMs = Math.min(60_000, Math.max(5_000, Number(req.query.timeout || 30) * 1000));
    const deadline = Date.now() + timeoutMs;
    let finalJob: any = job;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollQ = new URLSearchParams();
      pollQ.set('id', eq(job.id));
      pollQ.set('select', 'id,status,output,error,finished_at');
      const rows = (await supabaseRestAsService('agent_jobs', pollQ)) as any[];
      const polled = rows?.[0];
      if (polled) finalJob = polled;
      if (polled?.status === 'succeeded' || polled?.status === 'failed' || polled?.status === 'canceled') break;
    }

    const output = finalJob.output as any;
    const resultText = output?.message || output?.final?.message || '';

    return res.json({
      success: true,
      job_id: finalJob.id,
      status: finalJob.status,
      result: resultText || null,
      output: finalJob.output || null,
      error: finalJob.error || null,
    });
  } catch (err: any) {
    logger.error('Public playbook run error', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
}

export default router;
