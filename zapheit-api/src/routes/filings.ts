import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { logger } from '../lib/logger';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('Filing route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

// ---------------------------------------------------------------------------
// India Statutory Filing Calendar — FY 2025-26 / 2026-27
// ---------------------------------------------------------------------------
const STATUTORY_FILINGS = [
  { filing_type: 'pf',          title: 'PF ECR Filing',                  due_day: 15, frequency: 'monthly',    regulation: 'EPF Act 1952',            authority: 'EPFO',            form_name: 'ECR',           api_provider: 'epfo',     penalty_info: '₹5,000/day under Sec 14B for delayed deposit' },
  { filing_type: 'tds_salary',  title: 'TDS on Salary (Form 24Q)',       due_day: 7,  frequency: 'quarterly',  regulation: 'Income Tax Act 1961',     authority: 'Income Tax Dept', form_name: 'Form 24Q',      api_provider: 'traces',   penalty_info: '₹200/day u/s 234E, max = TDS amount', quarter_months: [7, 10, 1, 5] },
  { filing_type: 'tds_non_salary', title: 'TDS Non-Salary (Form 26Q)',   due_day: 7,  frequency: 'quarterly',  regulation: 'Income Tax Act 1961',     authority: 'Income Tax Dept', form_name: 'Form 26Q',      api_provider: 'traces',   penalty_info: '₹200/day u/s 234E', quarter_months: [7, 10, 1, 5] },
  { filing_type: 'esi',         title: 'ESI Return Filing',              due_day: 15, frequency: 'monthly',    regulation: 'ESI Act 1948',            authority: 'ESIC',            form_name: 'ESI Contribution', api_provider: 'manual', penalty_info: '12% damages on delayed payment' },
  { filing_type: 'pt',          title: 'Professional Tax',               due_day: 15, frequency: 'monthly',    regulation: 'State PT Act',            authority: 'State Govt',      form_name: 'PT Return',     api_provider: 'manual',   penalty_info: 'Varies by state — 1.25% to 2% per month' },
  { filing_type: 'lwf',         title: 'Labour Welfare Fund',            due_day: 15, frequency: 'quarterly',  regulation: 'LWF Act',                 authority: 'State Govt',      form_name: 'LWF Return',    api_provider: 'manual',   penalty_info: 'Varies by state', quarter_months: [1, 4, 7, 10] },
  { filing_type: 'form_16',     title: 'Form 16 Issuance',              due_day: 15, frequency: 'annually',   regulation: 'Income Tax Act 1961',     authority: 'Income Tax Dept', form_name: 'Form 16',       api_provider: 'traces',   penalty_info: '₹100/day u/s 272A(2)(g)', annual_month: 6 },
  { filing_type: 'annual_return', title: 'PF Annual Return (Form 6A)',   due_day: 25, frequency: 'annually',   regulation: 'EPF Act 1952',            authority: 'EPFO',            form_name: 'Form 6A',       api_provider: 'epfo',     penalty_info: 'Refer EPFO circular', annual_month: 4 },
  { filing_type: 'gratuity',    title: 'Gratuity Valuation Return',      due_day: 31, frequency: 'annually',   regulation: 'Payment of Gratuity Act', authority: 'Controlling Auth', form_name: 'Form L',       api_provider: 'manual',   penalty_info: 'Up to ₹10,000 fine', annual_month: 3 },
] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const deadlineCreateSchema = z.object({
  filing_type: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  regulation: z.string().max(100).optional(),
  authority: z.string().max(100).optional(),
  due_day_of_month: z.number().int().min(1).max(31).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'annually', 'one_time']).default('monthly'),
  quarter_months: z.array(z.number().int().min(1).max(12)).optional(),
  annual_month: z.number().int().min(1).max(12).optional(),
  api_provider: z.string().max(50).optional(),
  form_name: z.string().max(100).optional(),
  penalty_info: z.string().max(1000).optional(),
});

const submissionCreateSchema = z.object({
  deadline_id: z.string().uuid(),
  period_label: z.string().min(1).max(50),
  period_start: z.string(),
  period_end: z.string(),
  due_date: z.string(),
  status: z.enum(['pending', 'in_progress', 'submitted', 'accepted', 'rejected', 'overdue', 'waived']).default('pending'),
  reference_number: z.string().max(200).optional(),
  amount: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

const submissionUpdateSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'submitted', 'accepted', 'rejected', 'overdue', 'waived']).optional(),
  reference_number: z.string().max(200).optional(),
  amount: z.number().min(0).optional(),
  receipt_url: z.string().url().max(2000).optional(),
  notes: z.string().max(2000).optional(),
  submitted_at: z.string().optional(),
});

// ---------------------------------------------------------------------------
// GET /statutory-calendar — built-in India filing calendar
// ---------------------------------------------------------------------------
router.get('/statutory-calendar', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: STATUTORY_FILINGS });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /seed — seed org's filing deadlines from statutory calendar
// ---------------------------------------------------------------------------
router.post('/seed', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    // Check if already seeded
    const existing = await supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams({
      organization_id: eq(orgId),
      select: 'id',
      limit: '1',
    })) as any[];

    if (existing?.length) {
      return res.status(409).json({ success: false, error: 'Filing deadlines already seeded for this organization' });
    }

    // Insert all statutory filings
    const rows = STATUTORY_FILINGS.map(f => ({
      organization_id: orgId,
      filing_type: f.filing_type,
      title: f.title,
      due_day_of_month: f.due_day,
      frequency: f.frequency,
      regulation: f.regulation,
      authority: f.authority,
      form_name: f.form_name,
      api_provider: f.api_provider,
      penalty_info: f.penalty_info,
      quarter_months: 'quarter_months' in f ? f.quarter_months : null,
      annual_month: 'annual_month' in f ? f.annual_month : null,
      is_active: true,
    }));

    for (const row of rows) {
      await supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams(), {
        method: 'POST',
        body: row,
      });
    }

    res.json({ success: true, data: { seeded: rows.length } });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /deadlines — list org's filing deadlines
// ---------------------------------------------------------------------------
router.get('/deadlines', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    const rows = await supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams({
      organization_id: eq(orgId),
      order: 'filing_type.asc',
      select: '*',
    }));

    res.json({ success: true, data: rows || [] });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /deadlines — create a custom filing deadline
// ---------------------------------------------------------------------------
router.post('/deadlines', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);
    const parsed = deadlineCreateSchema.parse(req.body);

    const row = await supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams(), {
      method: 'POST',
      body: { ...parsed, organization_id: orgId },
      headers: { Prefer: 'return=representation' },
    });

    res.status(201).json({ success: true, data: Array.isArray(row) ? row[0] : row });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: err.errors });
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /deadlines/:id — update a filing deadline
// ---------------------------------------------------------------------------
router.patch('/deadlines/:id', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    const allowed = ['title', 'description', 'due_day_of_month', 'frequency', 'is_active', 'api_provider', 'form_name', 'penalty_info', 'quarter_months', 'annual_month'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const row = await supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams({
      id: eq(req.params.id),
      organization_id: eq(orgId),
    }), {
      method: 'PATCH',
      body: updates,
      headers: { Prefer: 'return=representation' },
    });

    res.json({ success: true, data: Array.isArray(row) ? row[0] : row });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /submissions — list submissions with optional filters
// ---------------------------------------------------------------------------
router.get('/submissions', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    const params = new URLSearchParams({
      organization_id: eq(orgId),
      order: 'due_date.desc',
      select: '*,filing_deadlines(filing_type,title,authority,form_name)',
    });

    if (req.query.status && typeof req.query.status === 'string') {
      params.set('status', eq(req.query.status));
    }
    if (req.query.deadline_id && typeof req.query.deadline_id === 'string') {
      params.set('deadline_id', eq(req.query.deadline_id));
    }
    if (req.query.limit && typeof req.query.limit === 'string') {
      params.set('limit', req.query.limit);
    }

    const rows = await supabaseRestAsUser(jwt, 'filing_submissions', params);
    res.json({ success: true, data: rows || [] });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /submissions — create a filing submission
// ---------------------------------------------------------------------------
router.post('/submissions', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);
    const parsed = submissionCreateSchema.parse(req.body);

    const row = await supabaseRestAsUser(jwt, 'filing_submissions', new URLSearchParams(), {
      method: 'POST',
      body: { ...parsed, organization_id: orgId, submitted_by: req.user?.id },
      headers: { Prefer: 'return=representation' },
    });

    res.status(201).json({ success: true, data: Array.isArray(row) ? row[0] : row });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: err.errors });
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /submissions/:id — update a filing submission
// ---------------------------------------------------------------------------
router.patch('/submissions/:id', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);
    const parsed = submissionUpdateSchema.parse(req.body);

    const updates: Record<string, any> = { ...parsed, updated_at: new Date().toISOString() };

    // Auto-set submitted_at when marking as submitted
    if (parsed.status === 'submitted' && !parsed.submitted_at) {
      updates.submitted_at = new Date().toISOString();
      updates.submitted_by = req.user?.id;
    }

    const row = await supabaseRestAsUser(jwt, 'filing_submissions', new URLSearchParams({
      id: eq(req.params.id),
      organization_id: eq(orgId),
    }), {
      method: 'PATCH',
      body: updates,
      headers: { Prefer: 'return=representation' },
    });

    res.json({ success: true, data: Array.isArray(row) ? row[0] : row });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: err.errors });
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /alerts — list filing alerts
// ---------------------------------------------------------------------------
router.get('/alerts', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    const params = new URLSearchParams({
      organization_id: eq(orgId),
      order: 'created_at.desc',
      select: '*',
      limit: req.query.limit?.toString() || '50',
    });

    if (req.query.unread === 'true') {
      params.set('is_read', eq('false'));
    }

    const rows = await supabaseRestAsUser(jwt, 'filing_alerts', params);
    res.json({ success: true, data: rows || [] });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /alerts/:id/read — mark alert as read
// ---------------------------------------------------------------------------
router.patch('/alerts/:id/read', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    await supabaseRestAsUser(jwt, 'filing_alerts', new URLSearchParams({
      id: eq(req.params.id),
      organization_id: eq(orgId),
    }), {
      method: 'PATCH',
      body: { is_read: true },
    });

    res.json({ success: true });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /alerts/read-all — mark all alerts as read
// ---------------------------------------------------------------------------
router.post('/alerts/read-all', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    await supabaseRestAsUser(jwt, 'filing_alerts', new URLSearchParams({
      organization_id: eq(orgId),
      is_read: eq('false'),
    }), {
      method: 'PATCH',
      body: { is_read: true },
    });

    res.json({ success: true });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// GET /dashboard — filing compliance dashboard stats
// ---------------------------------------------------------------------------
router.get('/dashboard', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    const [deadlines, submissions, alerts] = await Promise.all([
      supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams({
        organization_id: eq(orgId),
        is_active: eq('true'),
        select: 'id,filing_type,title',
      })) as Promise<any[]>,
      supabaseRestAsUser(jwt, 'filing_submissions', new URLSearchParams({
        organization_id: eq(orgId),
        select: 'id,status,due_date,amount',
      })) as Promise<any[]>,
      supabaseRestAsUser(jwt, 'filing_alerts', new URLSearchParams({
        organization_id: eq(orgId),
        is_read: eq('false'),
        select: 'id',
      })) as Promise<any[]>,
    ]);

    const subs = submissions || [];
    const now = new Date();
    const pending = subs.filter(s => s.status === 'pending' || s.status === 'in_progress');
    const overdue = subs.filter(s => (s.status === 'pending' || s.status === 'in_progress') && new Date(s.due_date) < now);
    const submitted = subs.filter(s => s.status === 'submitted' || s.status === 'accepted');
    const totalAmount = subs.filter(s => s.amount).reduce((sum: number, s: any) => sum + Number(s.amount || 0), 0);

    // Compliance score: % of non-overdue out of total active
    const totalActive = pending.length + submitted.length + overdue.length;
    const complianceScore = totalActive > 0 ? Math.round(((totalActive - overdue.length) / totalActive) * 100) : 100;

    res.json({
      success: true,
      data: {
        compliance_score: complianceScore,
        active_deadlines: (deadlines || []).length,
        total_submissions: subs.length,
        pending: pending.length,
        overdue: overdue.length,
        submitted: submitted.length,
        unread_alerts: (alerts || []).length,
        total_amount_filed: totalAmount,
      },
    });
  } catch (err) {
    return safeError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /generate-submissions — auto-generate current period submissions
// ---------------------------------------------------------------------------
router.post('/generate-submissions', requirePermission('compliance.consent'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Missing organization' });
    const jwt = getUserJwt(req);

    const deadlines = await supabaseRestAsUser(jwt, 'filing_deadlines', new URLSearchParams({
      organization_id: eq(orgId),
      is_active: eq('true'),
      select: '*',
    })) as any[];

    if (!deadlines?.length) {
      return res.status(404).json({ success: false, error: 'No active filing deadlines. Seed first.' });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    const currentYear = now.getFullYear();
    let created = 0;

    for (const dl of deadlines) {
      let shouldCreate = false;
      let periodLabel = '';
      let periodStart = '';
      let periodEnd = '';
      let dueDate = '';

      if (dl.frequency === 'monthly') {
        shouldCreate = true;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        periodLabel = `${monthNames[currentMonth - 1]} ${currentYear}`;
        periodStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        const lastDay = new Date(currentYear, currentMonth, 0).getDate();
        periodEnd = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${lastDay}`;
        const dueDay = Math.min(dl.due_day_of_month || 15, lastDay);
        // Due date is next month's due day for most filings
        const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
        const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
        const nextLastDay = new Date(nextYear, nextMonth, 0).getDate();
        const actualDueDay = Math.min(dueDay, nextLastDay);
        dueDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(actualDueDay).padStart(2, '0')}`;
      } else if (dl.frequency === 'quarterly' && dl.quarter_months?.includes(currentMonth)) {
        shouldCreate = true;
        const qMap: Record<number, string> = { 7: 'Q1', 10: 'Q2', 1: 'Q3', 4: 'Q4', 5: 'Q4' };
        const fyYear = currentMonth >= 4 ? currentYear : currentYear - 1;
        periodLabel = `${qMap[currentMonth] || 'Q?'} FY${fyYear}-${(fyYear + 1) % 100}`;
        // Quarter period
        const qStart = currentMonth >= 4 ? currentMonth - 3 : currentMonth + 9;
        const qStartYear = qStart > currentMonth ? currentYear - 1 : currentYear;
        periodStart = `${qStartYear}-${String(qStart).padStart(2, '0')}-01`;
        const qEndMonth = currentMonth >= 4 ? currentMonth - 1 : currentMonth + 8 + 1;
        const qEndYear = qEndMonth > 12 ? currentYear : (qEndMonth < qStart ? currentYear : qStartYear);
        periodEnd = `${qEndYear}-${String(Math.min(qEndMonth, 12)).padStart(2, '0')}-${new Date(qEndYear, Math.min(qEndMonth, 12), 0).getDate()}`;
        const dueDay = Math.min(dl.due_day_of_month || 7, 28);
        dueDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
      } else if (dl.frequency === 'annually' && dl.annual_month === currentMonth) {
        shouldCreate = true;
        const fyYear = currentMonth >= 4 ? currentYear : currentYear - 1;
        periodLabel = `FY${fyYear}-${(fyYear + 1) % 100}`;
        periodStart = `${fyYear}-04-01`;
        periodEnd = `${fyYear + 1}-03-31`;
        const dueDay = Math.min(dl.due_day_of_month || 15, 28);
        dueDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
      }

      if (!shouldCreate) continue;

      // Check if submission already exists for this period
      const existing = await supabaseRestAsUser(jwt, 'filing_submissions', new URLSearchParams({
        organization_id: eq(orgId),
        deadline_id: eq(dl.id),
        period_label: eq(periodLabel),
        select: 'id',
        limit: '1',
      })) as any[];

      if (existing?.length) continue;

      await supabaseRestAsUser(jwt, 'filing_submissions', new URLSearchParams(), {
        method: 'POST',
        body: {
          organization_id: orgId,
          deadline_id: dl.id,
          period_label: periodLabel,
          period_start: periodStart,
          period_end: periodEnd,
          due_date: dueDate,
          status: 'pending',
        },
      });
      created++;
    }

    res.json({ success: true, data: { generated: created } });
  } catch (err) {
    return safeError(res, err);
  }
});

export default router;
