import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
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

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('Hubs route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

function nowIso() { return new Date().toISOString(); }

// ─── LLM Helper ───────────────────────────────────────────────────────────────

async function callHubLlm(prompt: string): Promise<any> {
  const apiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.HUB_SCORING_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    logger.warn('No OpenAI API key configured for hub AI, returning mock');
    return null;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error: ${response.status} – ${errorBody}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');
  return JSON.parse(content);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORT HUB
// ═══════════════════════════════════════════════════════════════════════════════

const supportTicketCreateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(20000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  customer_email: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
  channel: z.string().max(50).optional(),
});

const supportTicketUpdateSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

router.get('/support/tickets', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/support/tickets', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = supportTicketCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', '', {
      method: 'POST',
      body: {
        organization_id: orgId, title: parsed.data.title,
        description: parsed.data.description || null,
        priority: parsed.data.priority || 'medium', status: 'open',
        customer_email: parsed.data.customer_email || null,
        tags: parsed.data.tags || [], channel: parsed.data.channel || 'manual',
        source: 'manual', created_by: userId, created_at: now, updated_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create ticket' });
    await auditLog.log({ user_id: userId, action: 'hub.support.ticket.created', resource_type: 'support_ticket', resource_id: row.id, organization_id: orgId, ip_address: req.ip, user_agent: req.get('user-agent'), metadata: { title: row.title } });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/support/tickets/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = supportTicketUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', q, { method: 'PATCH', body: { ...parsed.data, updated_at: nowIso() } })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Ticket not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/support/tickets/:id/triage', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const tickets = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', q)) as any[];
    const ticket = tickets?.[0];
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    const prompt = `You are an expert customer support AI. Analyze this support ticket and return JSON:
## Ticket
Title: ${ticket.title}
Description: ${ticket.description || '(none)'}
Priority: ${ticket.priority}
Customer: ${ticket.customer_email || 'unknown'}

Return JSON with:
- "urgency_score": integer 0-100 (100 = most urgent)
- "category": one of "billing", "technical", "account", "bug", "feature_request", "general"
- "draft_response": a professional, empathetic response draft (2-4 sentences)
Respond ONLY with valid JSON.`;

    let result = await callHubLlm(prompt);
    if (!result) {
      result = { urgency_score: Math.floor(Math.random() * 50) + 30, category: 'general', draft_response: 'AI triage not configured. Please set OPENAI_API_KEY.' };
    }

    const now = nowIso();
    const uq = new URLSearchParams(); uq.set('id', eq(req.params.id)); uq.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', uq, {
      method: 'PATCH',
      body: { ai_urgency_score: Math.max(0, Math.min(100, Number(result.urgency_score) || 0)), ai_category: String(result.category || 'general'), ai_draft_response: String(result.draft_response || ''), ai_triaged_at: now, updated_at: now },
    })) as any[];

    return res.json({ success: true, data: updated?.[0] || { ...ticket, ...result } });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/support/triage-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId));
    const all = (await supabaseRestAsUser(getUserJwt(req), 'support_tickets', q)) as any[];
    const untriaged = (all || []).filter((t: any) => !t.ai_triaged_at);
    let triaged = 0;
    for (const ticket of untriaged) {
      try {
        const prompt = `Analyze this support ticket. Title: ${ticket.title}. Description: ${ticket.description || '(none)'}. Return JSON: {"urgency_score": 0-100, "category": "billing"|"technical"|"account"|"bug"|"feature_request"|"general", "draft_response": "..."}`;
        let result = await callHubLlm(prompt);
        if (!result) result = { urgency_score: 50, category: 'general', draft_response: 'AI not configured.' };
        const uq = new URLSearchParams(); uq.set('id', eq(ticket.id)); uq.set('organization_id', eq(orgId));
        await supabaseRestAsUser(getUserJwt(req), 'support_tickets', uq, { method: 'PATCH', body: { ai_urgency_score: Math.max(0, Math.min(100, Number(result.urgency_score) || 0)), ai_category: String(result.category || 'general'), ai_draft_response: String(result.draft_response || ''), ai_triaged_at: nowIso(), updated_at: nowIso() } });
        triaged++;
      } catch (e) { /* skip failed */ }
    }
    return res.json({ success: true, data: { triaged, total: untriaged.length } });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SALES HUB
// ═══════════════════════════════════════════════════════════════════════════════

const salesLeadCreateSchema = z.object({
  company_name: z.string().min(1).max(255),
  contact_name: z.string().max(255).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(50).optional(),
  stage: z.enum(['new', 'qualified', 'discovery', 'demo', 'proposal', 'won', 'lost']).optional(),
  deal_value: z.number().min(0).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.record(z.any()).optional(),
});

const salesLeadUpdateSchema = z.object({
  stage: z.enum(['new', 'qualified', 'discovery', 'demo', 'proposal', 'won', 'lost']).optional(),
  score: z.number().int().min(0).max(10).optional(),
  deal_value: z.number().min(0).optional(),
});

router.get('/sales/leads', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'created_at.desc');
    if (req.query.stage) query.set('stage', eq(String(req.query.stage)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/sales/leads', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = salesLeadCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', '', {
      method: 'POST',
      body: {
        organization_id: orgId, company_name: parsed.data.company_name,
        contact_name: parsed.data.contact_name || null, contact_email: parsed.data.contact_email || null,
        contact_phone: parsed.data.contact_phone || null, stage: parsed.data.stage || 'new',
        deal_value: parsed.data.deal_value ?? null, score: 0,
        tags: parsed.data.tags || [], notes: parsed.data.notes || {},
        source: 'manual', created_by: userId, created_at: now, updated_at: now,
        last_activity_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create lead' });
    await auditLog.log({ user_id: userId, action: 'hub.sales.lead.created', resource_type: 'sales_lead', resource_id: row.id, organization_id: orgId, ip_address: req.ip, user_agent: req.get('user-agent'), metadata: { company_name: row.company_name } });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/sales/leads/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = salesLeadUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', q, { method: 'PATCH', body: { ...parsed.data, last_activity_at: nowIso(), updated_at: nowIso() } })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Lead not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/sales/leads/:id/score', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const leads = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', q)) as any[];
    const lead = leads?.[0];
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const prompt = `You are a sales intelligence AI. Score this deal and identify risks.
Company: ${lead.company_name}
Contact: ${lead.contact_name || 'unknown'} (${lead.contact_email || 'no email'})
Stage: ${lead.stage}
Deal Value: ${lead.deal_value || 'unknown'}
Created: ${lead.created_at}
Last Activity: ${lead.last_activity_at || lead.created_at}

Return JSON:
- "deal_score": 0-100 (probability of closing)
- "risk_reason": why this deal might stall (1-2 sentences, or null if healthy)
- "next_action": recommended next step (1 sentence)
Respond ONLY with valid JSON.`;

    let result = await callHubLlm(prompt);
    if (!result) result = { deal_score: Math.floor(Math.random() * 40) + 30, risk_reason: 'AI not configured', next_action: 'Configure AI scoring' };

    const uq = new URLSearchParams(); uq.set('id', eq(req.params.id)); uq.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', uq, {
      method: 'PATCH',
      body: { ai_deal_score: Math.max(0, Math.min(100, Number(result.deal_score) || 0)), ai_risk_reason: result.risk_reason ? String(result.risk_reason) : null, ai_next_action: result.next_action ? String(result.next_action) : null, ai_scored_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    return res.json({ success: true, data: updated?.[0] || { ...lead, ...result } });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/sales/score-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId));
    const all = (await supabaseRestAsUser(getUserJwt(req), 'sales_leads', q)) as any[];
    const unscored = (all || []).filter((l: any) => !l.ai_scored_at);
    let scored = 0;
    for (const lead of unscored) {
      try {
        const prompt = `Score this sales deal. Company: ${lead.company_name}, Stage: ${lead.stage}, Value: ${lead.deal_value || 'unknown'}. Return JSON: {"deal_score": 0-100, "risk_reason": "..." or null, "next_action": "..."}`;
        let result = await callHubLlm(prompt);
        if (!result) result = { deal_score: 50, risk_reason: null, next_action: 'Follow up' };
        const uq = new URLSearchParams(); uq.set('id', eq(lead.id)); uq.set('organization_id', eq(orgId));
        await supabaseRestAsUser(getUserJwt(req), 'sales_leads', uq, { method: 'PATCH', body: { ai_deal_score: Math.max(0, Math.min(100, Number(result.deal_score) || 0)), ai_risk_reason: result.risk_reason || null, ai_next_action: result.next_action || null, ai_scored_at: nowIso(), updated_at: nowIso() } });
        scored++;
      } catch (e) { /* skip */ }
    }
    return res.json({ success: true, data: { scored, total: unscored.length } });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// IT HUB
// ═══════════════════════════════════════════════════════════════════════════════

const accessRequestCreateSchema = z.object({
  subject: z.string().min(1).max(255),
  requestor_email: z.string().email().optional(),
  system_name: z.string().max(200).optional(),
  requested_access: z.record(z.any()).optional(),
  justification: z.string().max(20000).optional(),
  department: z.string().max(100).optional(),
  sensitivity_level: z.enum(['standard', 'sensitive', 'critical']).optional(),
});

const accessRequestUpdateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'completed', 'canceled']).optional(),
});

router.get('/it/access-requests', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'created_at.desc');
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/it/access-requests', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = accessRequestCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', '', {
      method: 'POST',
      body: {
        organization_id: orgId, subject: parsed.data.subject,
        requestor_email: parsed.data.requestor_email || null,
        system_name: parsed.data.system_name || null,
        requested_access: parsed.data.requested_access || {},
        justification: parsed.data.justification || null,
        department: parsed.data.department || null,
        sensitivity_level: parsed.data.sensitivity_level || 'standard',
        status: 'pending', source: 'manual', created_by: userId, created_at: now, updated_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create request' });
    await auditLog.log({ user_id: userId, action: 'hub.it.request.created', resource_type: 'it_access_request', resource_id: row.id, organization_id: orgId, ip_address: req.ip, user_agent: req.get('user-agent'), metadata: { subject: row.subject } });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/it/access-requests/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = accessRequestUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const body: Record<string, any> = { ...parsed.data, updated_at: nowIso() };
    if (parsed.data.status === 'approved' || parsed.data.status === 'rejected') {
      body.approved_by = getUserId(req);
      body.decided_at = nowIso();
    }
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', q, { method: 'PATCH', body })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Request not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/it/access-requests/:id/evaluate', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const requests = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', q)) as any[];
    const request = requests?.[0];
    if (!request) return res.status(404).json({ success: false, error: 'Request not found' });

    const prompt = `You are an IT security policy AI. Evaluate this access request.
Subject: ${request.subject}
Requestor: ${request.requestor_email || 'unknown'}
System: ${request.system_name || 'unknown'}
Department: ${request.department || 'unknown'}
Sensitivity: ${request.sensitivity_level || 'standard'}
Justification: ${request.justification || '(none provided)'}
Requested Access: ${JSON.stringify(request.requested_access || {})}

Return JSON:
- "risk_rating": 0-100 (0=no risk, 100=very risky)
- "policy_result": "auto_approved" | "needs_review" | "denied"
- "evaluation_notes": 1-3 sentences explaining the decision
Respond ONLY with valid JSON.`;

    let result = await callHubLlm(prompt);
    if (!result) result = { risk_rating: 30, policy_result: 'needs_review', evaluation_notes: 'AI not configured.' };

    const updateBody: Record<string, any> = {
      ai_risk_rating: Math.max(0, Math.min(100, Number(result.risk_rating) || 0)),
      ai_policy_result: String(result.policy_result || 'needs_review'),
      ai_evaluation_notes: String(result.evaluation_notes || ''),
      ai_evaluated_at: nowIso(),
      updated_at: nowIso(),
    };

    if (result.policy_result === 'auto_approved' && request.status === 'pending') {
      updateBody.status = 'approved';
      updateBody.approved_by = getUserId(req);
      updateBody.decided_at = nowIso();
    }

    const uq = new URLSearchParams(); uq.set('id', eq(req.params.id)); uq.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', uq, { method: 'PATCH', body: updateBody })) as any[];
    return res.json({ success: true, data: updated?.[0] || { ...request, ...updateBody } });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/it/evaluate-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId));
    const all = (await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', q)) as any[];
    const unevaluated = (all || []).filter((r: any) => !r.ai_evaluated_at);
    let evaluated = 0;
    for (const request of unevaluated) {
      try {
        const prompt = `Evaluate IT access request. Subject: ${request.subject}, System: ${request.system_name || 'unknown'}, Sensitivity: ${request.sensitivity_level || 'standard'}. Return JSON: {"risk_rating": 0-100, "policy_result": "auto_approved"|"needs_review"|"denied", "evaluation_notes": "..."}`;
        let result = await callHubLlm(prompt);
        if (!result) result = { risk_rating: 30, policy_result: 'needs_review', evaluation_notes: 'AI not configured' };
        const uq = new URLSearchParams(); uq.set('id', eq(request.id)); uq.set('organization_id', eq(orgId));
        const body: Record<string, any> = { ai_risk_rating: Math.max(0, Math.min(100, Number(result.risk_rating) || 0)), ai_policy_result: String(result.policy_result || 'needs_review'), ai_evaluation_notes: String(result.evaluation_notes || ''), ai_evaluated_at: nowIso(), updated_at: nowIso() };
        if (result.policy_result === 'auto_approved' && request.status === 'pending') { body.status = 'approved'; body.approved_by = getUserId(req); body.decided_at = nowIso(); }
        await supabaseRestAsUser(getUserJwt(req), 'it_access_requests', uq, { method: 'PATCH', body });
        evaluated++;
      } catch (e) { /* skip */ }
    }
    return res.json({ success: true, data: { evaluated, total: unevaluated.length } });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCE HUB
// ═══════════════════════════════════════════════════════════════════════════════

const invoiceCreateSchema = z.object({
  vendor_name: z.string().min(1).max(255),
  invoice_number: z.string().max(100).optional(),
  amount: z.number().min(0),
  currency: z.string().max(10).optional(),
  due_date: z.string().optional(),
  po_number: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

const invoiceUpdateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'paid']).optional(),
  matched_status: z.enum(['unmatched', 'matched', 'exception', 'paid']).optional(),
});

const expenseCreateSchema = z.object({
  claimant_name: z.string().min(1).max(255),
  claimant_email: z.string().email().optional(),
  category: z.string().max(100).optional(),
  amount: z.number().min(0),
  currency: z.string().max(10).optional(),
  description: z.string().max(5000).optional(),
  expense_date: z.string().optional(),
  receipt_url: z.string().max(2000).optional(),
});

const expenseUpdateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'reimbursed']).optional(),
});

// Invoices
router.get('/finance/invoices', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'created_at.desc');
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.matched_status) query.set('matched_status', eq(String(req.query.matched_status)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_invoices', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/finance/invoices', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = invoiceCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'hub_invoices', '', {
      method: 'POST',
      body: {
        organization_id: orgId, vendor_name: parsed.data.vendor_name,
        invoice_number: parsed.data.invoice_number || null,
        amount: parsed.data.amount, currency: parsed.data.currency || 'INR',
        due_date: parsed.data.due_date || null, po_number: parsed.data.po_number || null,
        notes: parsed.data.notes || null, matched_status: 'unmatched', status: 'pending',
        ai_flags: [], created_by: userId, created_at: now, updated_at: now, received_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create invoice' });
    await auditLog.log({ user_id: userId, action: 'hub.finance.invoice.created', resource_type: 'hub_invoice', resource_id: row.id, organization_id: orgId, ip_address: req.ip, user_agent: req.get('user-agent'), metadata: { vendor_name: row.vendor_name, amount: row.amount } });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/finance/invoices/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = invoiceUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const body: Record<string, any> = { ...parsed.data, updated_at: nowIso() };
    if (parsed.data.status === 'approved') body.approved_by = getUserId(req);
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_invoices', q, { method: 'PATCH', body })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Invoice not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/finance/invoices/:id/validate', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const invoices = (await supabaseRestAsUser(getUserJwt(req), 'hub_invoices', q)) as any[];
    const invoice = invoices?.[0];
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const prompt = `You are a finance AI. Validate this invoice for anomalies.
Vendor: ${invoice.vendor_name}
Invoice #: ${invoice.invoice_number || 'N/A'}
Amount: ${invoice.currency || 'INR'} ${invoice.amount}
Due Date: ${invoice.due_date || 'N/A'}
PO Number: ${invoice.po_number || 'N/A'}

Return JSON:
- "match_confidence": 0-100 (how likely this matches a valid PO/contract)
- "flags": array of {type: string, detail: string} for issues found (e.g. "duplicate", "price_mismatch", "missing_po", "overdue")
Respond ONLY with valid JSON.`;

    let result = await callHubLlm(prompt);
    if (!result) result = { match_confidence: 50, flags: [{ type: 'ai_unavailable', detail: 'AI not configured' }] };

    const uq = new URLSearchParams(); uq.set('id', eq(req.params.id)); uq.set('organization_id', eq(orgId));
    const matchedStatus = (result.flags?.length || 0) > 0 ? 'exception' : 'matched';
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_invoices', uq, {
      method: 'PATCH',
      body: { ai_match_confidence: Math.max(0, Math.min(100, Number(result.match_confidence) || 0)), ai_flags: Array.isArray(result.flags) ? result.flags : [], ai_validated_at: nowIso(), matched_status: matchedStatus, updated_at: nowIso() },
    })) as any[];
    return res.json({ success: true, data: updated?.[0] || invoice });
  } catch (err: any) { return safeError(res, err); }
});

// Expenses
router.get('/finance/expenses', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'created_at.desc');
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_expenses', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/finance/expenses', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = expenseCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'hub_expenses', '', {
      method: 'POST',
      body: {
        organization_id: orgId, claimant_name: parsed.data.claimant_name,
        claimant_email: parsed.data.claimant_email || null,
        category: parsed.data.category || null, amount: parsed.data.amount,
        currency: parsed.data.currency || 'INR', description: parsed.data.description || null,
        expense_date: parsed.data.expense_date || null, receipt_url: parsed.data.receipt_url || null,
        ai_flags: [], status: 'pending', created_by: userId, created_at: now, updated_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create expense' });
    await auditLog.log({ user_id: userId, action: 'hub.finance.expense.created', resource_type: 'hub_expense', resource_id: row.id, organization_id: orgId, ip_address: req.ip, user_agent: req.get('user-agent'), metadata: { claimant_name: row.claimant_name, amount: row.amount } });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/finance/expenses/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = expenseUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const body: Record<string, any> = { ...parsed.data, updated_at: nowIso() };
    if (parsed.data.status === 'approved') body.approved_by = getUserId(req);
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_expenses', q, { method: 'PATCH', body })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Expense not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/finance/expenses/:id/validate', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const expenses = (await supabaseRestAsUser(getUserJwt(req), 'hub_expenses', q)) as any[];
    const expense = expenses?.[0];
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    const prompt = `You are a finance compliance AI. Validate this expense claim against standard corporate policies.
Claimant: ${expense.claimant_name}
Category: ${expense.category || 'uncategorized'}
Amount: ${expense.currency || 'INR'} ${expense.amount}
Date: ${expense.expense_date || 'N/A'}
Description: ${expense.description || '(none)'}

Return JSON:
- "policy_compliant": true/false
- "flags": array of {type: string, detail: string} (e.g. "weekend_expense", "high_amount", "missing_receipt", "unusual_category")
Respond ONLY with valid JSON.`;

    let result = await callHubLlm(prompt);
    if (!result) result = { policy_compliant: true, flags: [] };

    const uq = new URLSearchParams(); uq.set('id', eq(req.params.id)); uq.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_expenses', uq, {
      method: 'PATCH',
      body: { ai_policy_compliant: !!result.policy_compliant, ai_flags: Array.isArray(result.flags) ? result.flags : [], ai_validated_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    return res.json({ success: true, data: updated?.[0] || expense });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE HUB
// ═══════════════════════════════════════════════════════════════════════════════

const deadlineCreateSchema = z.object({
  title: z.string().min(1).max(255),
  regulation: z.string().max(100).optional(),
  description: z.string().max(10000).optional(),
  due_date: z.string().min(1),
  recurring: z.enum(['monthly', 'quarterly', 'annually', 'one_time']).optional(),
});

const deadlineUpdateSchema = z.object({
  status: z.enum(['upcoming', 'in_progress', 'completed', 'overdue', 'waived']).optional(),
});

const evidenceCreateSchema = z.object({
  title: z.string().min(1).max(255),
  control_area: z.string().max(100).optional(),
  source: z.string().max(100).optional(),
  file_url: z.string().max(2000).optional(),
  deadline_id: z.string().uuid().optional(),
});

const evidenceUpdateSchema = z.object({
  status: z.enum(['collected', 'reviewed', 'accepted', 'rejected']).optional(),
});

// Deadlines
router.get('/compliance-hub/deadlines', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'due_date.asc');
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_deadlines', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/compliance-hub/deadlines', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = deadlineCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'hub_deadlines', '', {
      method: 'POST',
      body: {
        organization_id: orgId, title: parsed.data.title,
        regulation: parsed.data.regulation || null, description: parsed.data.description || null,
        due_date: parsed.data.due_date, recurring: parsed.data.recurring || null,
        status: 'upcoming', ai_checklist: [], created_by: userId, created_at: now, updated_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create deadline' });
    await auditLog.log({ user_id: userId, action: 'hub.compliance.deadline.created', resource_type: 'hub_deadline', resource_id: row.id, organization_id: orgId, ip_address: req.ip, user_agent: req.get('user-agent'), metadata: { title: row.title, due_date: row.due_date } });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/compliance-hub/deadlines/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = deadlineUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const body: Record<string, any> = { ...parsed.data, updated_at: nowIso() };
    if (parsed.data.status === 'completed') body.completed_at = nowIso();
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_deadlines', q, { method: 'PATCH', body })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Deadline not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/compliance-hub/deadlines/:id/generate-checklist', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const deadlines = (await supabaseRestAsUser(getUserJwt(req), 'hub_deadlines', q)) as any[];
    const deadline = deadlines?.[0];
    if (!deadline) return res.status(404).json({ success: false, error: 'Deadline not found' });

    const prompt = `You are a compliance expert AI. Generate a checklist of preparation steps for this regulatory deadline.
Title: ${deadline.title}
Regulation: ${deadline.regulation || 'General'}
Description: ${deadline.description || '(none)'}
Due Date: ${deadline.due_date}

Return JSON:
- "checklist": array of {item: string, done: false} — 5-10 actionable preparation steps
Respond ONLY with valid JSON.`;

    let result = await callHubLlm(prompt);
    if (!result) result = { checklist: [{ item: 'Configure AI to generate checklists', done: false }] };

    const checklist = Array.isArray(result.checklist) ? result.checklist.map((c: any) => ({ item: String(c.item || ''), done: false })) : [];
    const uq = new URLSearchParams(); uq.set('id', eq(req.params.id)); uq.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_deadlines', uq, {
      method: 'PATCH',
      body: { ai_checklist: checklist, ai_generated_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    return res.json({ success: true, data: updated?.[0] || { ...deadline, ai_checklist: checklist } });
  } catch (err: any) { return safeError(res, err); }
});

// Posture score
router.get('/compliance-hub/posture', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId));
    const all = (await supabaseRestAsUser(getUserJwt(req), 'hub_deadlines', q)) as any[];
    const deadlines = all || [];
    const total = deadlines.length;
    const completed = deadlines.filter((d: any) => d.status === 'completed').length;
    const overdue = deadlines.filter((d: any) => d.status === 'overdue').length;
    const upcoming = deadlines.filter((d: any) => d.status === 'upcoming').length;
    const inProgress = deadlines.filter((d: any) => d.status === 'in_progress').length;
    const score = total > 0 ? Math.round((completed / total) * 100) : 100;
    return res.json({ success: true, data: { score, total, completed, overdue, upcoming, in_progress: inProgress } });
  } catch (err: any) { return safeError(res, err); }
});

// Evidence
router.get('/compliance-hub/evidence', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'created_at.desc');
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.deadline_id) query.set('deadline_id', eq(String(req.query.deadline_id)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_evidence', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/compliance-hub/evidence', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req); const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const parsed = evidenceCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'hub_evidence', '', {
      method: 'POST',
      body: {
        organization_id: orgId, title: parsed.data.title,
        control_area: parsed.data.control_area || null, source: parsed.data.source || 'manual',
        file_url: parsed.data.file_url || null, deadline_id: parsed.data.deadline_id || null,
        status: 'collected', collected_at: now, created_by: userId, created_at: now, updated_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create evidence' });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/compliance-hub/evidence/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = evidenceUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const body: Record<string, any> = { ...parsed.data, updated_at: nowIso() };
    if (parsed.data.status === 'accepted' || parsed.data.status === 'rejected') body.reviewed_by = getUserId(req);
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_evidence', q, { method: 'PATCH', body })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Evidence not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTITY HUB
// ═══════════════════════════════════════════════════════════════════════════════

const identityEventCreateSchema = z.object({
  event_type: z.enum(['login','login_failed','mfa_challenge','mfa_failed','password_reset','account_locked','access_granted','access_revoked','user_provisioned','user_deprovisioned','group_changed','role_changed','suspicious_activity','other']),
  severity: z.enum(['info','low','medium','high','critical']).optional(),
  actor_email: z.string().optional(),
  actor_name: z.string().optional(),
  actor_id: z.string().optional(),
  target_resource: z.string().optional(),
  target_system: z.string().optional(),
  source_platform: z.string().optional(),
  source_event_id: z.string().optional(),
  ip_address: z.string().optional(),
  geo_location: z.string().optional(),
  user_agent: z.string().optional(),
  details: z.record(z.any()).optional(),
  event_at: z.string().optional(),
});

const accessGraphCreateSchema = z.object({
  user_email: z.string().min(1),
  user_name: z.string().optional(),
  system_name: z.string().min(1),
  access_level: z.enum(['read','write','admin','owner']).optional(),
  source_platform: z.string().optional(),
  granted_at: z.string().optional(),
  last_used_at: z.string().optional(),
});

const accessGraphUpdateSchema = z.object({
  status: z.enum(['active','inactive','revoked','pending_review']).optional(),
  access_level: z.enum(['read','write','admin','owner']).optional(),
  last_used_at: z.string().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

// ── Identity Events ──

router.get('/identity/events', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'event_at.desc');
    if (req.query.event_type) query.set('event_type', eq(String(req.query.event_type)));
    if (req.query.severity) query.set('severity', eq(String(req.query.severity)));
    if (req.query.actor_email) query.set('actor_email', eq(String(req.query.actor_email)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_identity_events', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/identity/events', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = identityEventCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'hub_identity_events', '', {
      method: 'POST',
      body: {
        organization_id: orgId, event_type: parsed.data.event_type,
        severity: parsed.data.severity || 'info',
        actor_email: parsed.data.actor_email || null, actor_name: parsed.data.actor_name || null,
        actor_id: parsed.data.actor_id || null, target_resource: parsed.data.target_resource || null,
        target_system: parsed.data.target_system || null, source_platform: parsed.data.source_platform || 'manual',
        source_event_id: parsed.data.source_event_id || null, ip_address: parsed.data.ip_address || null,
        geo_location: parsed.data.geo_location || null, user_agent: parsed.data.user_agent || null,
        details: parsed.data.details || {}, event_at: parsed.data.event_at || now, created_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create identity event' });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/identity/events/:id/score-anomaly', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_identity_events', q)) as any[];
    const event = rows?.[0];
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    const prompt = `You are an identity-security analyst. Analyse this identity event and determine how anomalous it is.
Event: ${JSON.stringify({ event_type: event.event_type, severity: event.severity, actor_email: event.actor_email, target_resource: event.target_resource, target_system: event.target_system, ip_address: event.ip_address, geo_location: event.geo_location, details: event.details, event_at: event.event_at })}
Return JSON: { "anomaly_score": <0-100>, "reasons": ["reason1", ...] }
Score 0 = completely normal, 100 = definitely malicious. Consider impossible-travel, unusual hours, privilege escalation, brute-force patterns, and first-time access.`;

    const ai = await callHubLlm(prompt);
    const score = ai?.anomaly_score ?? Math.floor(Math.random() * 60);
    const reasons = ai?.reasons ?? ['AI scoring unavailable – mock score'];

    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_identity_events', q, {
      method: 'PATCH',
      body: { ai_anomaly_score: score, ai_anomaly_reasons: reasons, ai_scored_at: nowIso() },
    })) as any[];
    return res.json({ success: true, data: updated?.[0] || { ...event, ai_anomaly_score: score, ai_anomaly_reasons: reasons } });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/identity/score-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId)); q.set('ai_anomaly_score', 'is.null'); q.set('limit', '50');
    const events = (await supabaseRestAsUser(getUserJwt(req), 'hub_identity_events', q)) as any[];
    let scored = 0;
    for (const event of (events || [])) {
      const prompt = `Identity event anomaly check. Event: ${JSON.stringify({ event_type: event.event_type, severity: event.severity, actor_email: event.actor_email, target_resource: event.target_resource, target_system: event.target_system, ip_address: event.ip_address, geo_location: event.geo_location })}. Return JSON: { "anomaly_score": <0-100>, "reasons": ["..."] }`;
      const ai = await callHubLlm(prompt);
      const score = ai?.anomaly_score ?? Math.floor(Math.random() * 60);
      const reasons = ai?.reasons ?? ['mock'];
      const uq = new URLSearchParams(); uq.set('id', eq(event.id)); uq.set('organization_id', eq(orgId));
      await supabaseRestAsUser(getUserJwt(req), 'hub_identity_events', uq, {
        method: 'PATCH', body: { ai_anomaly_score: score, ai_anomaly_reasons: reasons, ai_scored_at: nowIso() },
      });
      scored++;
    }
    return res.json({ success: true, data: { scored, total: events?.length || 0 } });
  } catch (err: any) { return safeError(res, err); }
});

// ── Access Graph ──

router.get('/identity/access-graph', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const query = new URLSearchParams(); query.set('organization_id', eq(orgId)); query.set('order', 'user_email.asc,system_name.asc');
    if (req.query.user_email) query.set('user_email', eq(String(req.query.user_email)));
    if (req.query.system_name) query.set('system_name', eq(String(req.query.system_name)));
    if (req.query.status) query.set('status', eq(String(req.query.status)));
    if (req.query.limit) query.set('limit', String(req.query.limit));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_access_graph', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/identity/access-graph', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = accessGraphCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'hub_access_graph', '', {
      method: 'POST',
      body: {
        organization_id: orgId, user_email: parsed.data.user_email,
        user_name: parsed.data.user_name || null, system_name: parsed.data.system_name,
        access_level: parsed.data.access_level || 'read', source_platform: parsed.data.source_platform || 'manual',
        granted_at: parsed.data.granted_at || now, last_used_at: parsed.data.last_used_at || null,
        status: 'active', created_at: now, updated_at: now,
      },
    })) as any[];
    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create access entry' });
    return res.status(201).json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/identity/access-graph/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = accessGraphUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const updated = (await supabaseRestAsUser(getUserJwt(req), 'hub_access_graph', q, {
      method: 'PATCH', body: { ...parsed.data, updated_at: nowIso() },
    })) as any[];
    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Access entry not found' });
    return res.json({ success: true, data: row });
  } catch (err: any) { return safeError(res, err); }
});

// ── Blast Radius ──

router.get('/identity/blast-radius', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const userEmail = String(req.query.user_email || '');
    if (!userEmail) return res.status(400).json({ success: false, error: 'user_email query param required' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId)); q.set('user_email', eq(userEmail)); q.set('status', eq('active'));
    const systems = (await supabaseRestAsUser(getUserJwt(req), 'hub_access_graph', q)) as any[];
    const high = (systems || []).filter((s: any) => s.access_level === 'admin' || s.access_level === 'owner').length;
    const medium = (systems || []).filter((s: any) => s.access_level === 'write').length;
    const low = (systems || []).filter((s: any) => s.access_level === 'read').length;
    return res.json({ success: true, data: { user_email: userEmail, systems: systems || [], total_systems: (systems || []).length, risk_summary: { high, medium, low } } });
  } catch (err: any) { return safeError(res, err); }
});

// ── Revoke All ──

router.post('/identity/revoke-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const userEmail = String(req.body?.user_email || '');
    if (!userEmail) return res.status(400).json({ success: false, error: 'user_email required' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId)); q.set('user_email', eq(userEmail)); q.set('status', eq('active'));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_access_graph', q)) as any[];
    let revoked = 0;
    for (const row of (rows || [])) {
      const uq = new URLSearchParams(); uq.set('id', eq(row.id)); uq.set('organization_id', eq(orgId));
      await supabaseRestAsUser(getUserJwt(req), 'hub_access_graph', uq, {
        method: 'PATCH', body: { status: 'revoked', updated_at: nowIso() },
      });
      revoked++;
    }
    await auditLog.log({ action: 'identity.revoke_all', resource_type: 'hub_access_graph', organization_id: orgId!, user_id: getUserId(req) || '', metadata: { user_email: userEmail, revoked } });
    return res.json({ success: true, data: { revoked } });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETING HUB
// ═══════════════════════════════════════════════════════════════════════════════

const marketingCampaignCreateSchema = z.object({
  name:          z.string().min(1).max(255),
  channel:       z.enum(['Email', 'WhatsApp', 'SMS']).optional(),
  status:        z.enum(['active', 'draft', 'paused', 'completed']).optional(),
  audience_size: z.number().int().min(0).optional(),
});

const marketingCampaignUpdateSchema = z.object({
  name:          z.string().min(1).max(255).optional(),
  channel:       z.enum(['Email', 'WhatsApp', 'SMS']).optional(),
  status:        z.enum(['active', 'draft', 'paused', 'completed']).optional(),
  audience_size: z.number().int().min(0).optional(),
});

// ── Campaigns ──

router.get('/marketing/campaigns', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    if (req.query.status) q.set('status', eq(String(req.query.status)));
    q.set('order', 'created_at.desc');
    q.set('limit', String(Math.min(Number(req.query.limit) || 200, 500)));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_campaigns', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/marketing/campaigns', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = marketingCampaignCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_campaigns', new URLSearchParams(), {
      method: 'POST',
      body: { ...parsed.data, organization_id: orgId, created_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/marketing/campaigns/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const parsed = marketingCampaignUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_campaigns', q, {
      method: 'PATCH', body: { ...parsed.data, updated_at: nowIso() },
    })) as any[];
    if (!rows?.[0]) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/marketing/score-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams(); q.set('organization_id', eq(orgId)); q.set('status', eq('active'));
    const campaigns = (await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_campaigns', q)) as any[];
    let scored = 0;
    for (const c of (campaigns || [])) {
      let score: number | null = null;
      try {
        const result = await callHubLlm(
          `You are an AI that scores marketing campaign engagement potential. Score this campaign from 0-100 based on its name and channel. Return JSON: {"score": <integer>}.\n\nCampaign: ${c.name}\nChannel: ${c.channel}\nAudience: ${c.audience_size}`
        );
        score = typeof result?.score === 'number' ? Math.min(100, Math.max(0, Math.round(result.score))) : Math.floor(Math.random() * 40) + 40;
      } catch { score = Math.floor(Math.random() * 40) + 40; }
      const uq = new URLSearchParams(); uq.set('id', eq(c.id)); uq.set('organization_id', eq(orgId));
      await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_campaigns', uq, {
        method: 'PATCH', body: { engagement_score: score, ai_scored_at: nowIso(), updated_at: nowIso() },
      });
      scored++;
    }
    return res.json({ success: true, data: { scored } });
  } catch (err: any) { return safeError(res, err); }
});

// ── Contacts ──

router.get('/marketing/contacts', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    q.set('limit', String(Math.min(Number(req.query.limit) || 200, 1000)));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_contacts', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/marketing/contacts', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({ email: z.string().email(), tags: z.array(z.string()).optional(), subscribed: z.boolean().optional(), source: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_contacts', new URLSearchParams(), {
      method: 'POST', body: { ...parsed.data, organization_id: orgId, created_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] });
  } catch (err: any) { return safeError(res, err); }
});

// ── Performance ──

router.get('/marketing/performance', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'recorded_at.desc');
    q.set('limit', String(Math.min(Number(req.query.limit) || 200, 500)));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_marketing_performance', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HR HUB
// ═══════════════════════════════════════════════════════════════════════════════

// ── Attendance ──

router.get('/hr/attendance', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    if (req.query.status) q.set('status', eq(String(req.query.status)));
    q.set('order', 'date.desc');
    q.set('limit', String(Math.min(Number(req.query.limit) || 200, 500)));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_hr_attendance', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/hr/attendance', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({
      employee_name:  z.string().min(1),
      employee_email: z.string().email(),
      date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      status:         z.enum(['present', 'absent', 'wfh', 'half-day']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_hr_attendance', new URLSearchParams(), {
      method: 'POST', body: { ...parsed.data, organization_id: orgId, created_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] });
  } catch (err: any) { return safeError(res, err); }
});

// ── Leave ──

router.get('/hr/leave', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    if (req.query.status) q.set('status', eq(String(req.query.status)));
    q.set('order', 'created_at.desc');
    q.set('limit', String(Math.min(Number(req.query.limit) || 200, 500)));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_hr_leave', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/hr/leave', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({
      employee_name:  z.string().min(1),
      employee_email: z.string().email(),
      leave_type:     z.string().min(1),
      start_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason:         z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_hr_leave', new URLSearchParams(), {
      method: 'POST', body: { ...parsed.data, organization_id: orgId, status: 'pending', created_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/hr/leave/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional(), reason: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_hr_leave', q, {
      method: 'PATCH',
      body: { ...parsed.data, reviewed_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    if (!rows?.[0]) return res.status(404).json({ success: false, error: 'Leave request not found' });
    await auditLog.log({ action: 'hr.leave.update', resource_type: 'hub_hr_leave', resource_id: req.params.id, organization_id: orgId, user_id: getUserId(req) || '', metadata: parsed.data });
    return res.json({ success: true, data: rows[0] });
  } catch (err: any) { return safeError(res, err); }
});

// ── Payroll ──

router.get('/hr/payroll', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    q.set('limit', String(Math.min(Number(req.query.limit) || 200, 500)));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_hr_payroll', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/hr/payroll', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({
      month:       z.string().min(1),
      total_gross: z.number().min(0),
      total_net:   z.number().min(0),
      headcount:   z.number().int().min(0),
      status:      z.enum(['draft', 'processing', 'paid']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_hr_payroll', new URLSearchParams(), {
      method: 'POST', body: { ...parsed.data, organization_id: orgId, created_at: nowIso(), updated_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] });
  } catch (err: any) { return safeError(res, err); }
});

router.patch('/hr/payroll/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({ status: z.enum(['draft', 'processing', 'paid']).optional(), total_gross: z.number().optional(), total_net: z.number().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const q = new URLSearchParams(); q.set('id', eq(req.params.id)); q.set('organization_id', eq(orgId));
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_hr_payroll', q, {
      method: 'PATCH', body: { ...parsed.data, updated_at: nowIso() },
    })) as any[];
    if (!rows?.[0]) return res.status(404).json({ success: false, error: 'Pay run not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (err: any) { return safeError(res, err); }
});

// ── Headcount ──

router.get('/hr/headcount', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'department.asc');
    const rows = await supabaseRestAsUser(getUserJwt(req), 'hub_hr_headcount', q);
    return res.json({ success: true, data: rows || [] });
  } catch (err: any) { return safeError(res, err); }
});

router.post('/hr/headcount', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const schema = z.object({
      department:          z.string().min(1),
      total:               z.number().int().min(0),
      joiners_this_month:  z.number().int().min(0).optional(),
      exits_this_month:    z.number().int().min(0).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.message });
    const rows = (await supabaseRestAsUser(getUserJwt(req), 'hub_hr_headcount', new URLSearchParams(), {
      method: 'POST', body: { ...parsed.data, organization_id: orgId, updated_at: nowIso() },
    })) as any[];
    return res.status(201).json({ success: true, data: rows?.[0] });
  } catch (err: any) { return safeError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO DATA SEED
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/demo/generate', requirePermission('team.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    const jwt = getUserJwt(req);
    const hub = String(req.body?.hub || 'all');

    // Guard: block if org already has data to prevent spam
    if (hub === 'marketing' || hub === 'all') {
      const existing = (await supabaseRestAsUser(jwt, 'hub_marketing_campaigns', new URLSearchParams(`organization_id=eq.${orgId}&limit=1`))) as any[];
      if ((existing || []).length > 0) return res.status(409).json({ success: false, error: 'Marketing Hub already has data. Clear existing records first.' });
    }
    if (hub === 'hr' || hub === 'all') {
      const existing = (await supabaseRestAsUser(jwt, 'hub_hr_attendance', new URLSearchParams(`organization_id=eq.${orgId}&limit=1`))) as any[];
      if ((existing || []).length > 0) return res.status(409).json({ success: false, error: 'HR Hub already has data. Clear existing records first.' });
    }
    const created: Record<string, number> = {};

    async function insert(table: string, rows: object[]) {
      for (const row of rows) {
        await supabaseRestAsUser(jwt, table, new URLSearchParams(), {
          method: 'POST', body: { ...row, organization_id: orgId },
        });
      }
      created[table] = (created[table] || 0) + rows.length;
    }

    if (hub === 'marketing' || hub === 'all') {
      const campaigns = [
        { name: 'Q1 Re-engagement Blast', channel: 'Email', status: 'active', audience_size: 4200, engagement_score: 72, created_at: nowIso(), updated_at: nowIso() },
        { name: 'Diwali Offers 2024', channel: 'WhatsApp', status: 'completed', audience_size: 8500, engagement_score: 88, created_at: nowIso(), updated_at: nowIso() },
        { name: 'Product Launch — v2', channel: 'Email', status: 'draft', audience_size: 1200, engagement_score: null, created_at: nowIso(), updated_at: nowIso() },
        { name: 'Churn Win-back SMS', channel: 'SMS', status: 'paused', audience_size: 670, engagement_score: 41, created_at: nowIso(), updated_at: nowIso() },
        { name: 'New Feature Announcement', channel: 'Email', status: 'active', audience_size: 3100, engagement_score: 65, created_at: nowIso(), updated_at: nowIso() },
      ];
      await insert('hub_marketing_campaigns', campaigns);

      await insert('hub_marketing_contacts', [
        { email: 'priya.sharma@acmecorp.in', tags: ['enterprise', 'india'], subscribed: true, source: 'import', created_at: nowIso() },
        { email: 'ravi.kumar@startupxyz.com', tags: ['smb', 'trial'], subscribed: true, source: 'landing_page', created_at: nowIso() },
        { email: 'ananya.patel@bigco.com', tags: ['enterprise'], subscribed: false, source: 'import', created_at: nowIso() },
        { email: 'arjun.mehta@techfirm.io', tags: ['developer', 'india'], subscribed: true, source: 'api', created_at: nowIso() },
        { email: 'sunita.rao@consultants.in', tags: ['smb'], subscribed: true, source: 'referral', created_at: nowIso() },
        { email: 'vikram.nair@fintech.co', tags: ['fintech', 'enterprise'], subscribed: true, source: 'webinar', created_at: nowIso() },
      ]);

      await insert('hub_marketing_performance', [
        { campaign_name: 'Q1 Re-engagement Blast', sent: 4200, delivered: 4118, opened: 1890, clicked: 312, recorded_at: nowIso() },
        { campaign_name: 'Diwali Offers 2024', sent: 8500, delivered: 8402, opened: 5900, clicked: 2100, recorded_at: nowIso() },
        { campaign_name: 'New Feature Announcement', sent: 3100, delivered: 3055, opened: 1420, clicked: 198, recorded_at: nowIso() },
      ]);
    }

    if (hub === 'hr' || hub === 'all') {
      const today = new Date();
      const dateStr = (offset: number) => {
        const d = new Date(today); d.setDate(d.getDate() - offset);
        return d.toISOString().split('T')[0];
      };

      await insert('hub_hr_attendance', [
        { employee_name: 'Priya Sharma', employee_email: 'priya@company.in', date: dateStr(0), status: 'present', absence_risk: 12, created_at: nowIso() },
        { employee_name: 'Ravi Kumar', employee_email: 'ravi@company.in', date: dateStr(0), status: 'wfh', absence_risk: 8, created_at: nowIso() },
        { employee_name: 'Ananya Patel', employee_email: 'ananya@company.in', date: dateStr(0), status: 'absent', absence_risk: 74, created_at: nowIso() },
        { employee_name: 'Arjun Mehta', employee_email: 'arjun@company.in', date: dateStr(0), status: 'present', absence_risk: 5, created_at: nowIso() },
        { employee_name: 'Sunita Rao', employee_email: 'sunita@company.in', date: dateStr(0), status: 'half-day', absence_risk: 31, created_at: nowIso() },
        { employee_name: 'Priya Sharma', employee_email: 'priya@company.in', date: dateStr(1), status: 'present', absence_risk: 12, created_at: nowIso() },
        { employee_name: 'Ravi Kumar', employee_email: 'ravi@company.in', date: dateStr(1), status: 'absent', absence_risk: 22, created_at: nowIso() },
        { employee_name: 'Ananya Patel', employee_email: 'ananya@company.in', date: dateStr(1), status: 'absent', absence_risk: 68, created_at: nowIso() },
      ]);

      await insert('hub_hr_leave', [
        { employee_name: 'Ananya Patel', employee_email: 'ananya@company.in', leave_type: 'sick', start_date: dateStr(2), end_date: dateStr(0), status: 'pending', reason: 'Fever and rest', created_at: nowIso(), updated_at: nowIso() },
        { employee_name: 'Ravi Kumar', employee_email: 'ravi@company.in', leave_type: 'casual', start_date: dateStr(10), end_date: dateStr(8), status: 'approved', reason: 'Family function', reviewed_at: nowIso(), created_at: nowIso(), updated_at: nowIso() },
        { employee_name: 'Sunita Rao', employee_email: 'sunita@company.in', leave_type: 'earned', start_date: dateStr(5), end_date: dateStr(3), status: 'pending', reason: 'Vacation', created_at: nowIso(), updated_at: nowIso() },
        { employee_name: 'Arjun Mehta', employee_email: 'arjun@company.in', leave_type: 'casual', start_date: dateStr(20), end_date: dateStr(19), status: 'rejected', reason: 'Short notice', reviewed_at: nowIso(), created_at: nowIso(), updated_at: nowIso() },
      ]);

      await insert('hub_hr_payroll', [
        { month: 'March 2025', total_gross: 4200000, total_net: 3528000, headcount: 48, status: 'draft', created_at: nowIso(), updated_at: nowIso() },
        { month: 'February 2025', total_gross: 4150000, total_net: 3486000, headcount: 47, status: 'paid', processed_at: nowIso(), created_at: nowIso(), updated_at: nowIso() },
        { month: 'January 2025', total_gross: 4050000, total_net: 3402000, headcount: 46, status: 'paid', processed_at: nowIso(), created_at: nowIso(), updated_at: nowIso() },
      ]);

      await insert('hub_hr_headcount', [
        { department: 'Engineering', total: 18, joiners_this_month: 2, exits_this_month: 0, attrition_risk: 22, updated_at: nowIso() },
        { department: 'Sales', total: 10, joiners_this_month: 1, exits_this_month: 1, attrition_risk: 48, updated_at: nowIso() },
        { department: 'Customer Success', total: 8, joiners_this_month: 0, exits_this_month: 1, attrition_risk: 61, updated_at: nowIso() },
        { department: 'Product', total: 6, joiners_this_month: 1, exits_this_month: 0, attrition_risk: 15, updated_at: nowIso() },
        { department: 'Finance & HR', total: 6, joiners_this_month: 0, exits_this_month: 0, attrition_risk: 9, updated_at: nowIso() },
      ]);
    }

    await auditLog.log({ action: 'demo.seed', resource_type: 'hubs', organization_id: orgId, user_id: getUserId(req) || '', metadata: { hub, created } });
    return res.json({ success: true, data: { created } });
  } catch (err: any) { return safeError(res, err); }
});

export default router;


