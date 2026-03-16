import express, { Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { AnthropicService, OpenAIService } from '../services/ai-service';
import { auditLog } from '../lib/audit-logger';
import { errorResponse, getOrgId, getUserJwt } from '../lib/route-helpers';

const router = express.Router();

// GET /api/fine-tunes/jobs — list all fine-tune jobs for the org
router.get('/fine-tunes/jobs', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    q.set('limit', '100');

    const data = await supabaseRestAsUser(getUserJwt(req), 'fine_tune_jobs', q);
    return res.json({ success: true, data: data || [] });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// POST /api/fine-tunes/jobs — persist a staged (not yet submitted) fine-tune job
router.post('/fine-tunes/jobs', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const {
      name,
      baseModel,
      epochs,
      fileName,
      examples,
      validationExamples,
      estimatedCostInr,
      readinessScore,
      issues,
      status,
    } = req.body as {
      name?: string;
      baseModel?: string;
      epochs?: number;
      fileName?: string;
      examples?: number;
      validationExamples?: number;
      estimatedCostInr?: number;
      readinessScore?: number;
      issues?: string[];
      status?: string;
    };

    if (!name?.trim()) return errorResponse(res, new Error('name is required'), 400);
    if (!baseModel?.trim()) return errorResponse(res, new Error('baseModel is required'), 400);

    const q = new URLSearchParams();
    const data = await supabaseRestAsUser(getUserJwt(req), 'fine_tune_jobs', q, {
      method: 'POST',
      body: {
        organization_id: orgId,
        name: String(name).trim(),
        base_model: String(baseModel).trim(),
        epochs: Number.isFinite(Number(epochs)) ? Number(epochs) : 3,
        file_name: String(fileName || '').trim(),
        examples: Number(examples) || 0,
        validation_examples: Number(validationExamples) || 0,
        estimated_cost_inr: Number(estimatedCostInr) || 0,
        readiness_score: Number(readinessScore) || 0,
        issues: Array.isArray(issues) ? issues : [],
        status: String(status || 'ready'),
        provider_state: 'staged_local',
      },
    });

    const created = Array.isArray(data) ? data[0] : data;
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// DELETE /api/fine-tunes/jobs/:id — delete a fine-tune job record
router.delete('/fine-tunes/jobs/:id', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));

    const deleted = await supabaseRestAsUser(getUserJwt(req), 'fine_tune_jobs', q, { method: 'DELETE' }) as any[];
    if (!deleted?.length) return errorResponse(res, new Error('Fine-tune job not found'), 404);

    return res.json({ success: true, data: { id } });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// POST /api/fine-tunes/openai — create a real OpenAI fine-tuning job
router.post('/fine-tunes/openai', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const {
      name,
      baseModel,
      epochs,
      trainingRecords,
      validationRecords = [],
    } = req.body as {
      name?: string;
      baseModel?: string;
      epochs?: number;
      trainingRecords?: Array<{ prompt: string; completion: string }>;
      validationRecords?: Array<{ prompt: string; completion: string }>;
    };

    if (!name || !String(name).trim()) {
      return errorResponse(res, new Error('Fine-tune name is required'), 400);
    }

    if (!baseModel || !String(baseModel).startsWith('openai/')) {
      return errorResponse(res, new Error('Only OpenAI fine-tunes are supported by the live provider flow right now'), 400);
    }

    if (!Array.isArray(trainingRecords) || trainingRecords.length < 10) {
      return errorResponse(res, new Error('At least 10 training records are required'), 400);
    }

    const openAiApiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!openAiApiKey) {
      return errorResponse(res, new Error('OpenAI API key missing for fine-tuning'), 500);
    }

    const model = String(baseModel).replace(/^openai\//, '');
    const toJsonl = (records: Array<{ prompt: string; completion: string }>) =>
      records
        .map((record) => JSON.stringify({
          messages: [
            { role: 'user', content: record.prompt },
            { role: 'assistant', content: record.completion },
          ],
        }))
        .join('\n');

    const uploadFile = async (fileName: string, content: string): Promise<{ id: string }> => {
      const form = new FormData();
      form.append('purpose', 'fine-tune');
      form.append('file', new Blob([content], { type: 'application/jsonl' }), fileName);

      const uploadResponse = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiApiKey}` },
        body: form,
      });

      const uploadPayload = await uploadResponse.json().catch(() => ({} as any)) as any;
      if (!uploadResponse.ok) {
        logger.error('OpenAI file upload failed', { status: uploadResponse.status, uploadPayload });
        throw new Error(uploadPayload?.error?.message || 'OpenAI training file upload failed');
      }

      return { id: String(uploadPayload.id) };
    };

    const safePrefix = String(name).trim().replace(/\s+/g, '_').toLowerCase();
    const trainingFile = await uploadFile(`${safePrefix}_train.jsonl`, toJsonl(trainingRecords));

    let validationFileId: string | undefined;
    if (Array.isArray(validationRecords) && validationRecords.length > 0) {
      const validationFile = await uploadFile(`${safePrefix}_validation.jsonl`, toJsonl(validationRecords));
      validationFileId = validationFile.id;
    }

    const fineTuneResponse = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        training_file: trainingFile.id,
        ...(validationFileId ? { validation_file: validationFileId } : {}),
        suffix: String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 18),
        method: {
          type: 'supervised',
          supervised: {
            hyperparameters: {
              n_epochs: Number.isFinite(Number(epochs)) ? Number(epochs) : 3,
            },
          },
        },
      }),
    });

    const fineTunePayload = await fineTuneResponse.json().catch(() => ({} as any)) as any;
    if (!fineTuneResponse.ok) {
      logger.error('OpenAI fine-tune job creation failed', { status: fineTuneResponse.status, fineTunePayload });
      throw new Error(fineTunePayload?.error?.message || 'OpenAI fine-tune job creation failed');
    }

    await auditLog.log({
      user_id: req.user?.id || '',
      action: 'fine_tune.created',
      resource_type: 'organization',
      resource_id: orgId,
      organization_id: orgId,
      metadata: {
        provider: 'openai',
        fine_tune_job_id: fineTunePayload.id,
        model,
        training_examples: trainingRecords.length,
        validation_examples: validationRecords.length,
      },
    });

    // Persist the submitted job to the DB.
    // If a stagedJobId is provided the client can pass it so we update the
    // existing staged row; otherwise we insert a fresh record.
    const {
      stagedJobId,
      fileName = '',
      examples = trainingRecords.length,
      validationExamples = validationRecords.length,
      estimatedCostInr = 0,
      readinessScore = 100,
      issues = [],
    } = req.body as {
      stagedJobId?: string;
      fileName?: string;
      examples?: number;
      validationExamples?: number;
      estimatedCostInr?: number;
      readinessScore?: number;
      issues?: string[];
    };

    try {
      if (stagedJobId) {
        const uq = new URLSearchParams();
        uq.set('id', eq(stagedJobId));
        uq.set('organization_id', eq(orgId));
        await supabaseRestAsUser(getUserJwt(req), 'fine_tune_jobs', uq, {
          method: 'PATCH',
          body: {
            status: fineTunePayload.status || 'provider_queued',
            provider_state: 'openai_submitted',
            provider_job_id: fineTunePayload.id,
            updated_at: new Date().toISOString(),
          },
        });
      } else {
        const iq = new URLSearchParams();
        await supabaseRestAsUser(getUserJwt(req), 'fine_tune_jobs', iq, {
          method: 'POST',
          body: {
            organization_id: orgId,
            name: String(name).trim(),
            base_model: `openai/${model}`,
            epochs: Number.isFinite(Number(epochs)) ? Number(epochs) : 3,
            file_name: String(fileName),
            examples: Number(examples),
            validation_examples: Number(validationExamples),
            estimated_cost_inr: Number(estimatedCostInr),
            readiness_score: Number(readinessScore),
            issues: Array.isArray(issues) ? issues : [],
            status: fineTunePayload.status || 'provider_queued',
            provider_state: 'openai_submitted',
            provider_job_id: fineTunePayload.id,
          },
        });
      }
    } catch (dbErr) {
      // Non-fatal: job was submitted to OpenAI successfully; log and continue
      logger.warn('Failed to persist fine-tune job to DB', { error: dbErr, jobId: fineTunePayload.id });
    }

    res.json({
      success: true,
      data: {
        provider: 'openai',
        id: fineTunePayload.id,
        model: fineTunePayload.model,
        status: fineTunePayload.status,
        trainingFileId: trainingFile.id,
        validationFileId: validationFileId || null,
        trainedTokens: fineTunePayload.trained_tokens ?? null,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// GET /api/fine-tunes/openai/:jobId — retrieve live OpenAI fine-tune job status
router.get('/fine-tunes/openai/:jobId', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const openAiApiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    if (!openAiApiKey) {
      return errorResponse(res, new Error('OpenAI API key missing for fine-tune status checks'), 500);
    }

    const response = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${encodeURIComponent(req.params.jobId)}`, {
      headers: { Authorization: `Bearer ${openAiApiKey}` },
    });

    const payload = await response.json().catch(() => ({} as any)) as any;
    if (!response.ok) {
      logger.error('OpenAI fine-tune status fetch failed', { status: response.status, payload, jobId: req.params.jobId });
      throw new Error(payload?.error?.message || 'OpenAI fine-tune status fetch failed');
    }

    // Map OpenAI status to our internal status
    const statusMap: Record<string, string> = {
      queued: 'provider_queued',
      validating_files: 'provider_queued',
      running: 'provider_running',
      succeeded: 'provider_succeeded',
      failed: 'provider_failed',
      cancelled: 'provider_failed',
    };
    const mappedStatus = statusMap[payload.status] ?? 'provider_queued';

    // Sync status back to DB (best-effort — non-fatal if it fails)
    try {
      const uq = new URLSearchParams();
      uq.set('provider_job_id', eq(req.params.jobId));
      uq.set('organization_id', eq(orgId));
      await supabaseRestAsUser(getUserJwt(req), 'fine_tune_jobs', uq, {
        method: 'PATCH',
        body: {
          status: mappedStatus,
          fine_tuned_model: payload.fine_tuned_model ?? null,
          trained_tokens: payload.trained_tokens ?? null,
          provider_status_text: payload.status,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (dbErr) {
      logger.warn('Failed to sync fine-tune job status to DB', { error: dbErr, jobId: req.params.jobId });
    }

    res.json({
      success: true,
      data: {
        id: payload.id,
        status: payload.status,
        model: payload.model,
        fineTunedModel: payload.fine_tuned_model ?? null,
        trainedTokens: payload.trained_tokens ?? null,
        estimatedFinish: payload.estimated_finish ?? null,
        finishedAt: payload.finished_at ?? null,
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// POST /api/batches/process-line — process a single line from the batch feature
router.post('/batches/process-line', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { prompt, model } = req.body;
    const orgId = getOrgId(req);

    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!prompt) return errorResponse(res, new Error('prompt is required'), 400);

    const rawModel = String(model || 'openai/gpt-4o').trim();
    const normalizedModel = rawModel.includes('/') ? rawModel : (
      rawModel.startsWith('claude') ? `anthropic/${rawModel}` : `openai/${rawModel}`
    );

    const [provider, providerModel] = normalizedModel.split('/', 2) as [string, string];

    let result: { latency: number; response: string; costUSD: number };

    if (provider === 'openai') {
      const apiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
      if (!apiKey) throw new Error('OpenAI API key missing for batch processing');

      const service = new OpenAIService(apiKey);
      const completion = await service.chat(
        [{ role: 'user', content: prompt }],
        providerModel || 'gpt-4o',
        { temperature: 0 }
      );
      result = { latency: completion.latency, response: completion.content, costUSD: completion.costUSD };
    } else if (provider === 'anthropic') {
      const apiKey = process.env.RASI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) throw new Error('Anthropic API key missing for batch processing');

      const service = new AnthropicService(apiKey);
      const completion = await service.chat(
        [{ role: 'user', content: prompt }],
        providerModel || 'claude-3-5-sonnet',
        { temperature: 0 }
      );
      result = { latency: completion.latency, response: completion.content, costUSD: completion.costUSD };
    } else {
      const key = process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
      if (!key) throw new Error(`OpenRouter API key missing for model ${normalizedModel}`);

      const startTime = Date.now();
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
          'X-Title': 'Rasi Synthetic HR Batch Processor',
        },
        body: JSON.stringify({
          model: normalizedModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          stream: false,
        }),
      });

      if (!orRes.ok) {
        const errBody = await orRes.text();
        logger.error('Batch model request failed', { status: orRes.status, errBody, model: normalizedModel });
        return errorResponse(res, new Error(`Upstream model error: ${orRes.status} ${errBody}`), 500);
      }

      const orData = await orRes.json() as any;
      result = {
        latency: Date.now() - startTime,
        response: orData?.choices?.[0]?.message?.content || '',
        costUSD: Number(orData?.usage?.cost || 0),
      };
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// GET /api/batches — list batch jobs for the org
router.get('/batches', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    q.set('limit', '100');

    const data = await supabaseRestAsUser(getUserJwt(req), 'batch_jobs', q);
    return res.json({ success: true, data: data || [] });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// POST /api/batches — create a new batch job record
router.post('/batches', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { name, description, model, items } = req.body as {
      name?: string;
      description?: string;
      model?: string;
      items?: Array<{ prompt: string; model?: string }>;
    };

    if (!name?.trim()) return errorResponse(res, new Error('name is required'), 400);
    if (!Array.isArray(items) || items.length === 0) return errorResponse(res, new Error('items must be a non-empty array'), 400);

    const q = new URLSearchParams();
    const data = await supabaseRestAsUser(getUserJwt(req), 'batch_jobs', q, {
      method: 'POST',
      body: {
        organization_id: orgId,
        name: String(name).trim(),
        description: String(description || '').trim(),
        model: String(model || 'openai/gpt-4o'),
        status: 'processing',
        requests: items.length,
        succeeded: 0,
        failed: 0,
        progress: 0,
        total_cost_usd: 0,
        items,
        results: [],
      },
    });

    const created = Array.isArray(data) ? data[0] : data;
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// PATCH /api/batches/:id — update progress, results, status
router.patch('/batches/:id', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { succeeded, failed, progress, total_cost_usd, results, status } = req.body as {
      succeeded?: number;
      failed?: number;
      progress?: number;
      total_cost_usd?: number;
      results?: unknown[];
      status?: string;
    };

    const updates: Record<string, unknown> = {};
    if (succeeded !== undefined) updates.succeeded = succeeded;
    if (failed !== undefined) updates.failed = failed;
    if (progress !== undefined) updates.progress = progress;
    if (total_cost_usd !== undefined) updates.total_cost_usd = total_cost_usd;
    if (results !== undefined) updates.results = results;
    if (status !== undefined) {
      updates.status = status;
      if (status === 'completed' || status === 'failed') {
        updates.completed_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) return errorResponse(res, new Error('No fields to update'), 400);

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));

    const data = await supabaseRestAsUser(getUserJwt(req), 'batch_jobs', q, {
      method: 'PATCH',
      body: updates,
    });

    if (!data?.length) return errorResponse(res, new Error('Batch job not found'), 404);
    return res.json({ success: true, data: data[0] });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

// DELETE /api/batches/:id — delete a batch job
router.delete('/batches/:id', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));

    const deleted = await supabaseRestAsUser(getUserJwt(req), 'batch_jobs', q, { method: 'DELETE' }) as any[];
    if (!deleted?.length) return errorResponse(res, new Error('Batch job not found'), 404);

    return res.json({ success: true, data: { id } });
  } catch (error: any) {
    return errorResponse(res, error);
  }
});

export default router;
