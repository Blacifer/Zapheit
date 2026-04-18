// ---------------------------------------------------------------------------
// DPDP Act Compliance Routes
//
// Endpoints for consent management, data retention policies, and
// Data Principal rights (access / correction / erasure / grievance).
//
// Mounts at /api/compliance/dpdp via index.ts
// ---------------------------------------------------------------------------

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsService, supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';

const router = express.Router();

// ════════════════════════════════════════════════════════════════════════════
// CONSENT RECORDS
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/compliance/dpdp/consents
 * List consent records for the org, with optional filters.
 */
router.get('/consents', async (req: Request, res: Response) => {
  try {
    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const params = new URLSearchParams({
      organization_id: eq(orgId),
      select: '*',
      order: 'created_at.desc',
      limit: String(Math.min(Number(req.query.limit) || 50, 200)),
    });

    // Optional filters
    if (req.query.purpose) params.set('purpose', eq(String(req.query.purpose)));
    if (req.query.status) params.set('status', eq(String(req.query.status)));
    if (req.query.principal_type) params.set('principal_type', eq(String(req.query.principal_type)));

    const data = await supabaseRestAsUser(userJwt, 'consent_records', params);
    return res.json({ success: true, data });
  } catch (err: any) {
    logger.error('Failed to list consents', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch consent records' });
  }
});

/**
 * GET /api/compliance/dpdp/consents/stats
 * Aggregate consent stats for the dashboard.
 */
router.get('/consents/stats', async (req: Request, res: Response) => {
  try {
    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    // Fetch all consents
    const all = (await supabaseRestAsUser(userJwt, 'consent_records', new URLSearchParams({
      organization_id: eq(orgId),
      select: 'status,purpose,principal_type,expires_at',
    }))) as any[] | null;

    const records = all || [];
    const now = new Date();

    const stats = {
      total: records.length,
      active: records.filter((r) => r.status === 'active').length,
      withdrawn: records.filter((r) => r.status === 'withdrawn').length,
      expired: records.filter((r) => r.status === 'expired').length,
      expiring_soon: records.filter(
        (r) => r.status === 'active' && r.expires_at && new Date(r.expires_at) <= new Date(now.getTime() + 30 * 86400000),
      ).length,
      by_purpose: {} as Record<string, number>,
      by_principal_type: {} as Record<string, number>,
    };

    for (const r of records) {
      stats.by_purpose[r.purpose] = (stats.by_purpose[r.purpose] || 0) + 1;
      stats.by_principal_type[r.principal_type] = (stats.by_principal_type[r.principal_type] || 0) + 1;
    }

    return res.json({ success: true, data: stats });
  } catch (err: any) {
    logger.error('Failed to compute consent stats', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to compute stats' });
  }
});

/**
 * POST /api/compliance/dpdp/consents
 * Record a new consent grant.
 */
router.post('/consents', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const {
      principal_type, principal_id, principal_email, principal_phone,
      purpose, purpose_description, data_categories, legal_basis,
      collection_method, collection_point, notice_version, expires_at,
      metadata,
    } = req.body;

    if (!principal_type || !purpose) {
      return res.status(400).json({ success: false, error: 'principal_type and purpose are required' });
    }

    const validPrincipalTypes = ['employee', 'candidate', 'contact', 'vendor', 'customer'];
    if (!validPrincipalTypes.includes(principal_type)) {
      return res.status(400).json({ success: false, error: `Invalid principal_type. Must be one of: ${validPrincipalTypes.join(', ')}` });
    }

    const now = new Date().toISOString();
    const row = {
      organization_id: orgId,
      principal_type,
      principal_id: principal_id || null,
      principal_email: principal_email || null,
      principal_phone: principal_phone || null,
      purpose,
      purpose_description: purpose_description || null,
      data_categories: data_categories || [],
      legal_basis: legal_basis || 'consent',
      status: 'active',
      granted_at: now,
      expires_at: expires_at || null,
      collection_method: collection_method || 'explicit',
      collection_point: collection_point || null,
      notice_version: notice_version || null,
      ip_address: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
      metadata: metadata || {},
      created_at: now,
      updated_at: now,
    };

    const result = await supabaseRestAsService('consent_records', new URLSearchParams(), {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: row,
    });

    // Log the consent event
    await supabaseRestAsService('compliance_events', new URLSearchParams(), {
      method: 'POST',
      body: {
        organization_id: orgId,
        event_type: 'consent_change',
        severity: 'info',
        resource_type: 'consent_record',
        resource_id: (result as any[])?.[0]?.id || null,
        actor_id: req.user?.id || null,
        details: { action: 'granted', purpose, principal_type, legal_basis: legal_basis || 'consent' },
        remediation_status: 'none',
        created_at: now,
      },
    });

    return res.status(201).json({ success: true, data: (result as any[])?.[0] || result });
  } catch (err: any) {
    logger.error('Failed to create consent', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to record consent' });
  }
});

/**
 * POST /api/compliance/dpdp/consents/:id/withdraw
 * Withdraw consent. Triggers retention policy evaluation.
 */
router.post('/consents/:id/withdraw', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const { id } = req.params;
    const { reason } = req.body;

    // Fetch the consent record
    const existing = (await supabaseRestAsService('consent_records', new URLSearchParams({
      id: eq(id),
      organization_id: eq(orgId),
      select: '*',
      limit: '1',
    }))) as any[] | null;

    if (!existing?.length) {
      return res.status(404).json({ success: false, error: 'Consent record not found' });
    }

    const consent = existing[0];
    if (consent.status !== 'active') {
      return res.status(400).json({ success: false, error: `Consent is already ${consent.status}` });
    }

    const now = new Date().toISOString();

    // Update consent status
    await supabaseRestAsService(
      'consent_records',
      new URLSearchParams({ id: eq(id), organization_id: eq(orgId) }),
      {
        method: 'PATCH',
        body: {
          status: 'withdrawn',
          withdrawn_at: now,
          withdrawal_reason: reason || null,
          updated_at: now,
        },
      },
    );

    // Log withdrawal event
    await supabaseRestAsService('compliance_events', new URLSearchParams(), {
      method: 'POST',
      body: {
        organization_id: orgId,
        event_type: 'consent_change',
        severity: 'warning',
        resource_type: 'consent_record',
        resource_id: id,
        actor_id: req.user?.id || null,
        details: {
          action: 'withdrawn',
          purpose: consent.purpose,
          principal_type: consent.principal_type,
          reason: reason || null,
          data_categories: consent.data_categories,
        },
        remediation_status: 'in_progress',
        created_at: now,
      },
    });

    // Check retention policy to see if immediate purge is needed
    const policies = (await supabaseRestAsService('data_retention_policies', new URLSearchParams({
      organization_id: eq(orgId),
      is_active: eq('true'),
      select: '*',
    }))) as any[] | null;

    const immediateCategories: string[] = [];
    for (const policy of (policies || [])) {
      if (policy.on_consent_withdrawal === 'immediate') {
        // Check if any data_category from the consent matches this policy
        const consentCats = consent.data_categories || [];
        if (consentCats.includes(policy.data_category) || policy.data_category === '*') {
          immediateCategories.push(policy.data_category);
        }
      }
    }

    return res.json({
      success: true,
      data: {
        id,
        status: 'withdrawn',
        withdrawn_at: now,
        immediate_purge_categories: immediateCategories,
        message: immediateCategories.length > 0
          ? `Consent withdrawn. ${immediateCategories.length} data categories flagged for immediate purge.`
          : 'Consent withdrawn. Data will be purged per retention schedule.',
      },
    });
  } catch (err: any) {
    logger.error('Failed to withdraw consent', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to withdraw consent' });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// DATA RETENTION POLICIES
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/compliance/dpdp/retention-policies
 */
router.get('/retention-policies', async (req: Request, res: Response) => {
  try {
    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const data = await supabaseRestAsUser(userJwt, 'data_retention_policies', new URLSearchParams({
      organization_id: eq(orgId),
      select: '*',
      order: 'data_category.asc',
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    logger.error('Failed to list retention policies', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch retention policies' });
  }
});

/**
 * POST /api/compliance/dpdp/retention-policies
 * Create or update a retention policy for a data category.
 */
router.post('/retention-policies', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const { data_category, retention_days, description, applies_to_table, purge_strategy, on_consent_withdrawal } = req.body;

    if (!data_category || retention_days === undefined) {
      return res.status(400).json({ success: false, error: 'data_category and retention_days are required' });
    }

    if (typeof retention_days !== 'number' || retention_days < 0) {
      return res.status(400).json({ success: false, error: 'retention_days must be a non-negative number' });
    }

    const now = new Date().toISOString();
    const result = await supabaseRestAsService('data_retention_policies', new URLSearchParams(), {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: {
        organization_id: orgId,
        data_category,
        retention_days,
        description: description || null,
        applies_to_table: applies_to_table || null,
        purge_strategy: purge_strategy || 'delete',
        on_consent_withdrawal: on_consent_withdrawal || 'immediate',
        is_active: true,
        created_by: req.user?.id || null,
        created_at: now,
        updated_at: now,
      },
    });

    return res.status(201).json({ success: true, data: (result as any[])?.[0] || result });
  } catch (err: any) {
    logger.error('Failed to create retention policy', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to save retention policy' });
  }
});

/**
 * PATCH /api/compliance/dpdp/retention-policies/:id
 */
router.patch('/retention-policies/:id', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const { id } = req.params;
    const allowedFields = ['retention_days', 'description', 'purge_strategy', 'on_consent_withdrawal', 'is_active', 'applies_to_table'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (updates.retention_days !== undefined && (typeof updates.retention_days !== 'number' || updates.retention_days < 0)) {
      return res.status(400).json({ success: false, error: 'retention_days must be a non-negative number' });
    }

    await supabaseRestAsService(
      'data_retention_policies',
      new URLSearchParams({ id: eq(id), organization_id: eq(orgId) }),
      { method: 'PATCH', body: updates },
    );

    return res.json({ success: true, data: { id, ...updates } });
  } catch (err: any) {
    logger.error('Failed to update retention policy', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to update retention policy' });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// DATA PRINCIPAL REQUESTS (Right to Access / Erasure / Correction / Grievance)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/compliance/dpdp/requests
 * List all Data Principal requests for the org.
 */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const params = new URLSearchParams({
      organization_id: eq(orgId),
      select: '*',
      order: 'created_at.desc',
      limit: String(Math.min(Number(req.query.limit) || 50, 200)),
    });

    if (req.query.status) params.set('status', eq(String(req.query.status)));
    if (req.query.request_type) params.set('request_type', eq(String(req.query.request_type)));

    const data = await supabaseRestAsUser(userJwt, 'data_principal_requests', params);
    return res.json({ success: true, data });
  } catch (err: any) {
    logger.error('Failed to list data principal requests', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch requests' });
  }
});

/**
 * POST /api/compliance/dpdp/requests
 * Submit a new Data Principal request. Sets 72-hour deadline per DPDP Act.
 */
router.post('/requests', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const {
      principal_type, principal_id, principal_email, principal_phone, principal_name,
      request_type, description, data_categories, priority, submitted_via, metadata,
    } = req.body;

    if (!principal_type || !request_type) {
      return res.status(400).json({ success: false, error: 'principal_type and request_type are required' });
    }

    const validRequestTypes = ['access', 'correction', 'erasure', 'grievance', 'portability'];
    if (!validRequestTypes.includes(request_type)) {
      return res.status(400).json({ success: false, error: `Invalid request_type. Must be one of: ${validRequestTypes.join(', ')}` });
    }

    const now = new Date();
    // DPDP mandates 72-hour response window
    const dueAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

    const row = {
      organization_id: orgId,
      principal_type,
      principal_id: principal_id || null,
      principal_email: principal_email || null,
      principal_phone: principal_phone || null,
      principal_name: principal_name || null,
      request_type,
      description: description || null,
      data_categories: data_categories || [],
      status: 'pending',
      priority: priority || 'normal',
      due_at: dueAt,
      submitted_via: submitted_via || 'portal',
      metadata: metadata || {},
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const result = await supabaseRestAsService('data_principal_requests', new URLSearchParams(), {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: row,
    });

    const created = (result as any[])?.[0];

    // Log the request as a compliance event
    await supabaseRestAsService('compliance_events', new URLSearchParams(), {
      method: 'POST',
      body: {
        organization_id: orgId,
        event_type: 'consent_change',
        severity: request_type === 'erasure' ? 'critical' : 'warning',
        resource_type: 'data_principal_request',
        resource_id: created?.id || null,
        actor_id: req.user?.id || null,
        details: { action: `dpr_${request_type}_submitted`, principal_type, due_at: dueAt },
        remediation_status: 'in_progress',
        created_at: now.toISOString(),
      },
    });

    return res.status(201).json({
      success: true,
      data: created || result,
      due_at: dueAt,
      message: `Request submitted. Must be resolved by ${new Date(dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`,
    });
  } catch (err: any) {
    logger.error('Failed to create data principal request', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to submit request' });
  }
});

/**
 * PATCH /api/compliance/dpdp/requests/:id
 * Update a Data Principal request (assign, resolve, reject).
 */
router.patch('/requests/:id', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const { id } = req.params;
    const { status, assigned_to, response_summary, rejection_reason } = req.body;

    // Fetch existing
    const existing = (await supabaseRestAsService('data_principal_requests', new URLSearchParams({
      id: eq(id),
      organization_id: eq(orgId),
      select: '*',
      limit: '1',
    }))) as any[] | null;

    if (!existing?.length) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const request = existing[0];
    const now = new Date().toISOString();
    const updates: Record<string, any> = { updated_at: now };

    if (status) updates.status = status;
    if (assigned_to) updates.assigned_to = assigned_to;
    if (response_summary) updates.response_summary = response_summary;
    if (rejection_reason) updates.rejection_reason = rejection_reason;

    if (status === 'completed') {
      updates.completed_at = now;

      // If this was an erasure request, generate a signed receipt
      if (request.request_type === 'erasure') {
        const receiptPayload = JSON.stringify({
          request_id: id,
          org_id: orgId,
          principal_type: request.principal_type,
          completed_at: now,
          data_categories: request.data_categories,
        });
        const salt = process.env.ERASURE_SIGNING_SALT || 'dpdp-erasure-default';
        updates.erasure_receipt = crypto
          .createHash('sha256')
          .update(salt + receiptPayload)
          .digest('hex');
      }
    }

    await supabaseRestAsService(
      'data_principal_requests',
      new URLSearchParams({ id: eq(id), organization_id: eq(orgId) }),
      { method: 'PATCH', body: updates },
    );

    // Log status change
    await supabaseRestAsService('compliance_events', new URLSearchParams(), {
      method: 'POST',
      body: {
        organization_id: orgId,
        event_type: 'consent_change',
        severity: status === 'rejected' ? 'warning' : 'info',
        resource_type: 'data_principal_request',
        resource_id: id,
        actor_id: req.user?.id || null,
        details: {
          action: `dpr_${status || 'updated'}`,
          request_type: request.request_type,
          has_receipt: !!updates.erasure_receipt,
        },
        remediation_status: status === 'completed' ? 'resolved' : 'in_progress',
        created_at: now,
      },
    });

    return res.json({ success: true, data: { id, ...updates } });
  } catch (err: any) {
    logger.error('Failed to update data principal request', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to update request' });
  }
});

/**
 * GET /api/compliance/dpdp/requests/overdue
 * Returns requests that are past their 72-hour deadline and still open.
 */
router.get('/requests/overdue', async (req: Request, res: Response) => {
  try {
    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    const now = new Date().toISOString();
    const data = await supabaseRestAsUser(userJwt, 'data_principal_requests', new URLSearchParams({
      organization_id: eq(orgId),
      select: '*',
      'status': 'in.(pending,in_progress)',
      'due_at': `lt.${now}`,
      order: 'due_at.asc',
    }));

    return res.json({ success: true, data, count: Array.isArray(data) ? data.length : 0 });
  } catch (err: any) {
    logger.error('Failed to fetch overdue requests', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch overdue requests' });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD / OVERVIEW
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/compliance/dpdp/dashboard
 * Aggregated DPDP compliance overview.
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Organization not found' });

    // Parallel fetch
    const [consents, requests, policies] = await Promise.all([
      supabaseRestAsUser(userJwt, 'consent_records', new URLSearchParams({
        organization_id: eq(orgId),
        select: 'status,purpose,expires_at',
      })),
      supabaseRestAsUser(userJwt, 'data_principal_requests', new URLSearchParams({
        organization_id: eq(orgId),
        select: 'status,request_type,due_at',
      })),
      supabaseRestAsUser(userJwt, 'data_retention_policies', new URLSearchParams({
        organization_id: eq(orgId),
        select: 'data_category,retention_days,is_active',
      })),
    ]);

    const consentArr = (consents as any[]) || [];
    const requestArr = (requests as any[]) || [];
    const policyArr = (policies as any[]) || [];
    const now = new Date();

    const dashboard = {
      consents: {
        total: consentArr.length,
        active: consentArr.filter((c) => c.status === 'active').length,
        withdrawn: consentArr.filter((c) => c.status === 'withdrawn').length,
        expired: consentArr.filter((c) => c.status === 'expired').length,
        expiring_30d: consentArr.filter(
          (c) => c.status === 'active' && c.expires_at && new Date(c.expires_at) <= new Date(now.getTime() + 30 * 86400000),
        ).length,
      },
      requests: {
        total: requestArr.length,
        pending: requestArr.filter((r) => r.status === 'pending').length,
        in_progress: requestArr.filter((r) => r.status === 'in_progress').length,
        completed: requestArr.filter((r) => r.status === 'completed').length,
        overdue: requestArr.filter(
          (r) => ['pending', 'in_progress'].includes(r.status) && new Date(r.due_at) < now,
        ).length,
      },
      retention_policies: {
        total: policyArr.length,
        active: policyArr.filter((p) => p.is_active).length,
      },
      compliance_score: 0, // Computed below
    };

    // Simple compliance score: penalize for overdue requests and missing policies
    let score = 100;
    if (dashboard.requests.overdue > 0) score -= Math.min(40, dashboard.requests.overdue * 10);
    if (dashboard.retention_policies.active === 0) score -= 20;
    if (dashboard.consents.active === 0 && consentArr.length > 0) score -= 15;
    if (dashboard.consents.expiring_30d > 5) score -= 10;
    dashboard.compliance_score = Math.max(0, score);

    return res.json({ success: true, data: dashboard });
  } catch (err: any) {
    logger.error('Failed to compute DPDP dashboard', { error: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

export default router;
