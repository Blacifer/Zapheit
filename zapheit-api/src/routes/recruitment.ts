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
  logger.error('Recruitment route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

function nowIso() {
  return new Date().toISOString();
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const jobListQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const jobCreateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(50000),
  requirements: z.string().max(50000).optional(),
  location: z.string().max(255).optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'internship']).optional(),
  salary_min: z.number().int().min(0).optional(),
  salary_max: z.number().int().min(0).optional(),
  currency: z.string().max(10).optional(),
  status: z.enum(['draft', 'open', 'paused', 'closed']).optional(),
  ai_screening_enabled: z.boolean().optional(),
  ai_screening_threshold: z.number().int().min(0).max(100).optional(),
  auto_reject_below: z.number().int().min(0).max(100).optional().nullable(),
});

const jobUpdateSchema = jobCreateSchema.partial();

const applicationCreateSchema = z.object({
  candidate_name: z.string().min(1).max(255),
  candidate_email: z.string().email().optional(),
  candidate_phone: z.string().max(50).optional(),
  resume_url: z.string().max(2000).optional(),
  resume_text: z.string().max(100000).optional(),
  cover_letter: z.string().max(50000).optional(),
  source_platform: z.string().max(50).optional(),
  external_application_id: z.string().max(255).optional(),
  tags: z.array(z.string()).optional(),
});

const applicationListQuerySchema = z.object({
  status: z.string().optional(),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOB POSTINGS
// ═══════════════════════════════════════════════════════════════════════════════

// List jobs
router.get('/jobs', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = jobListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (parsed.data.status) query.set('status', eq(parsed.data.status));
    if (parsed.data.limit) query.set('limit', String(parsed.data.limit));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'job_postings', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Get single job with application stats
router.get('/jobs/:id', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const jobQuery = new URLSearchParams();
    jobQuery.set('id', eq(req.params.id));
    jobQuery.set('organization_id', eq(orgId));
    const jobs = (await supabaseRestAsUser(getUserJwt(req), 'job_postings', jobQuery)) as any[];
    const job = jobs?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Job posting not found' });

    // Fetch application stats
    const appQuery = new URLSearchParams();
    appQuery.set('job_id', eq(req.params.id));
    appQuery.set('organization_id', eq(orgId));
    const applications = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', appQuery)) as any[];
    const appList = applications || [];

    const scored = appList.filter((a: any) => typeof a.ai_score === 'number');
    const avgScore = scored.length > 0
      ? Math.round(scored.reduce((sum: number, a: any) => sum + a.ai_score, 0) / scored.length)
      : null;

    return res.json({
      success: true,
      data: {
        ...job,
        application_count: appList.length,
        avg_ai_score: avgScore,
        status_breakdown: {
          new: appList.filter((a: any) => a.status === 'new').length,
          screening: appList.filter((a: any) => a.status === 'screening').length,
          shortlisted: appList.filter((a: any) => a.status === 'shortlisted').length,
          interviewing: appList.filter((a: any) => a.status === 'interviewing').length,
          offered: appList.filter((a: any) => a.status === 'offered').length,
          rejected: appList.filter((a: any) => a.status === 'rejected').length,
        },
      },
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Create job posting
router.post('/jobs', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = jobCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'job_postings', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        title: parsed.data.title,
        description: parsed.data.description,
        requirements: parsed.data.requirements || null,
        location: parsed.data.location || null,
        employment_type: parsed.data.employment_type || 'full_time',
        salary_min: parsed.data.salary_min ?? null,
        salary_max: parsed.data.salary_max ?? null,
        currency: parsed.data.currency || 'INR',
        status: parsed.data.status || 'draft',
        posted_to: [],
        ai_screening_enabled: parsed.data.ai_screening_enabled ?? false,
        ai_screening_threshold: parsed.data.ai_screening_threshold ?? 75,
        auto_reject_below: parsed.data.auto_reject_below ?? null,
        created_by: userId,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create job posting' });

    await auditLog.log({
      user_id: userId,
      action: 'recruitment.job.created',
      resource_type: 'job_posting',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { title: row.title, status: row.status },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Update job posting
router.patch('/jobs/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = jobUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const updateQuery = new URLSearchParams();
    updateQuery.set('id', eq(req.params.id));
    updateQuery.set('organization_id', eq(orgId));

    const updated = (await supabaseRestAsUser(getUserJwt(req), 'job_postings', updateQuery, {
      method: 'PATCH',
      body: { ...parsed.data, updated_at: nowIso() },
    })) as any[];

    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Job posting not found' });

    return res.json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Delete job posting
router.delete('/jobs/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const deleteQuery = new URLSearchParams();
    deleteQuery.set('id', eq(req.params.id));
    deleteQuery.set('organization_id', eq(orgId));

    await supabaseRestAsUser(getUserJwt(req), 'job_postings', deleteQuery, { method: 'DELETE' });

    return res.json({ success: true });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOB APPLICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

// List applications for a job
router.get('/jobs/:jobId/applications', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = applicationListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const query = new URLSearchParams();
    query.set('job_id', eq(req.params.jobId));
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    if (parsed.data.status) query.set('status', eq(parsed.data.status));
    if (parsed.data.limit) query.set('limit', String(parsed.data.limit));

    let rows = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', query)) as any[];
    rows = rows || [];

    // Client-side min_score filter (PostgREST doesn't support gte on nullable int cleanly)
    if (typeof parsed.data.min_score === 'number') {
      rows = rows.filter((r: any) => typeof r.ai_score === 'number' && r.ai_score >= parsed.data.min_score!);
    }

    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Create application (manual entry)
router.post('/jobs/:jobId/applications', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const parsed = applicationCreateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const now = nowIso();
    const created = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        job_id: req.params.jobId,
        candidate_name: parsed.data.candidate_name,
        candidate_email: parsed.data.candidate_email || null,
        candidate_phone: parsed.data.candidate_phone || null,
        resume_url: parsed.data.resume_url || null,
        resume_text: parsed.data.resume_text || null,
        cover_letter: parsed.data.cover_letter || null,
        source_platform: parsed.data.source_platform || 'manual',
        external_application_id: parsed.data.external_application_id || null,
        status: 'new',
        tags: parsed.data.tags || [],
        notes: [],
        applied_at: now,
        created_at: now,
        updated_at: now,
      },
    })) as any[];

    const row = created?.[0];
    if (!row) return res.status(500).json({ success: false, error: 'Failed to create application' });

    await auditLog.log({
      user_id: userId,
      action: 'recruitment.application.created',
      resource_type: 'job_application',
      resource_id: row.id,
      organization_id: orgId,
      ip_address: req.ip || (req.socket as any)?.remoteAddress,
      user_agent: req.get('user-agent') || undefined,
      metadata: { candidate_name: row.candidate_name, job_id: req.params.jobId },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Update application status
router.patch('/applications/:id/status', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const statusSchema = z.object({
      status: z.enum(['new', 'screening', 'shortlisted', 'interviewing', 'offered', 'rejected', 'withdrawn']),
      rejection_reason: z.string().max(2000).optional(),
    });

    const parsed = statusSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });

    const updateQuery = new URLSearchParams();
    updateQuery.set('id', eq(req.params.id));
    updateQuery.set('organization_id', eq(orgId));

    const body: Record<string, any> = {
      status: parsed.data.status,
      updated_at: nowIso(),
    };
    if (parsed.data.rejection_reason) body.rejection_reason = parsed.data.rejection_reason;

    const updated = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', updateQuery, {
      method: 'PATCH',
      body,
    })) as any[];

    const row = updated?.[0];
    if (!row) return res.status(404).json({ success: false, error: 'Application not found' });

    return res.json({ success: true, data: row });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI RESUME SCORING
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/applications/:id/score', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    // Fetch application
    const appQuery = new URLSearchParams();
    appQuery.set('id', eq(req.params.id));
    appQuery.set('organization_id', eq(orgId));
    const apps = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', appQuery)) as any[];
    const application = apps?.[0];
    if (!application) return res.status(404).json({ success: false, error: 'Application not found' });

    if (!application.resume_text && !application.cover_letter) {
      return res.status(400).json({ success: false, error: 'No resume text available for scoring' });
    }

    // Fetch the parent job for context
    const jobQuery = new URLSearchParams();
    jobQuery.set('id', eq(application.job_id));
    jobQuery.set('organization_id', eq(orgId));
    const jobs = (await supabaseRestAsUser(getUserJwt(req), 'job_postings', jobQuery)) as any[];
    const job = jobs?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Parent job posting not found' });

    // Call LLM for scoring
    const scoringPrompt = buildScoringPrompt(job, application);
    const scoringResult = await callLlmForScoring(scoringPrompt);

    // Persist score
    const now = nowIso();
    const scoreUpdateQuery = new URLSearchParams();
    scoreUpdateQuery.set('id', eq(req.params.id));
    scoreUpdateQuery.set('organization_id', eq(orgId));

    const updateBody: Record<string, any> = {
      ai_score: scoringResult.score,
      ai_summary: scoringResult.summary,
      ai_scored_at: now,
      updated_at: now,
    };

    // Auto-reject if below threshold
    if (
      typeof job.auto_reject_below === 'number' &&
      scoringResult.score < job.auto_reject_below &&
      application.status === 'new'
    ) {
      updateBody.status = 'rejected';
      updateBody.rejection_reason = `Auto-rejected: AI score ${scoringResult.score} is below threshold ${job.auto_reject_below}`;
    }

    const updated = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', scoreUpdateQuery, {
      method: 'PATCH',
      body: updateBody,
    })) as any[];

    const row = updated?.[0];
    return res.json({
      success: true,
      data: row || { ...application, ...updateBody },
      scoring: scoringResult,
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// Batch score all unscored applications for a job
router.post('/jobs/:jobId/score-all', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    // Fetch job
    const jobQuery = new URLSearchParams();
    jobQuery.set('id', eq(req.params.jobId));
    jobQuery.set('organization_id', eq(orgId));
    const jobs = (await supabaseRestAsUser(getUserJwt(req), 'job_postings', jobQuery)) as any[];
    const job = jobs?.[0];
    if (!job) return res.status(404).json({ success: false, error: 'Job posting not found' });

    // Fetch unscored applications
    const appQuery = new URLSearchParams();
    appQuery.set('job_id', eq(req.params.jobId));
    appQuery.set('organization_id', eq(orgId));
    const allApps = (await supabaseRestAsUser(getUserJwt(req), 'job_applications', appQuery)) as any[];
    const unscored = (allApps || []).filter(
      (a: any) => a.ai_score === null && (a.resume_text || a.cover_letter)
    );

    if (unscored.length === 0) {
      return res.json({ success: true, scored: 0, message: 'No unscored applications with resume text' });
    }

    let scored = 0;
    const errors: string[] = [];

    for (const app of unscored) {
      try {
        const prompt = buildScoringPrompt(job, app);
        const result = await callLlmForScoring(prompt);

        const now = nowIso();
        const updateQuery = new URLSearchParams();
        updateQuery.set('id', eq(app.id));
        updateQuery.set('organization_id', eq(orgId));

        const updateBody: Record<string, any> = {
          ai_score: result.score,
          ai_summary: result.summary,
          ai_scored_at: now,
          updated_at: now,
        };

        if (
          typeof job.auto_reject_below === 'number' &&
          result.score < job.auto_reject_below &&
          app.status === 'new'
        ) {
          updateBody.status = 'rejected';
          updateBody.rejection_reason = `Auto-rejected: AI score ${result.score} is below threshold ${job.auto_reject_below}`;
        }

        await supabaseRestAsUser(getUserJwt(req), 'job_applications', updateQuery, {
          method: 'PATCH',
          body: updateBody,
        });
        scored++;
      } catch (e: any) {
        errors.push(`${app.id}: ${e?.message || 'scoring failed'}`);
      }
    }

    return res.json({ success: true, scored, total: unscored.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// ─── LLM Scoring Helpers ──────────────────────────────────────────────────────

function buildScoringPrompt(job: any, application: any): string {
  return `You are an expert recruiter AI. Score this candidate's resume against the job description.

## Job Title
${job.title}

## Job Description
${job.description}

${job.requirements ? `## Requirements\n${job.requirements}` : ''}

## Candidate Resume
${application.resume_text || '(No resume text provided)'}

${application.cover_letter ? `## Cover Letter\n${application.cover_letter}` : ''}

## Instructions
Evaluate the candidate and return a JSON object with exactly these fields:
- "score": integer from 0 to 100 (100 = perfect match)
- "summary": a 2-3 sentence narrative of strengths and gaps
- "strengths": array of up to 5 key strengths
- "gaps": array of up to 5 key gaps or missing qualifications

Respond ONLY with valid JSON, no other text.`;
}

async function callLlmForScoring(prompt: string): Promise<{ score: number; summary: string; strengths: string[]; gaps: string[] }> {
  // Use OpenAI-compatible endpoint via environment keys
  const apiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.RECRUITMENT_SCORING_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    logger.warn('No OpenAI API key configured for resume scoring, returning mock score');
    return {
      score: Math.floor(Math.random() * 40) + 50,
      summary: 'AI scoring is not configured. Please set OPENAI_API_KEY or the legacy RASI_OPENAI_API_KEY.',
      strengths: ['Unable to evaluate'],
      gaps: ['AI scoring not configured'],
    };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM scoring API error: ${response.status} – ${errorBody}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM scoring');

  const parsed = JSON.parse(content);
  return {
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    summary: String(parsed.summary || ''),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String) : [],
  };
}

export default router;
