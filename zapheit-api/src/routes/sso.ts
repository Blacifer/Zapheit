/**
 * SSO/SAML configuration endpoints (P4-01).
 * Stores IdP metadata per org. Actual SAML assertion verification is delegated
 * to Supabase Auth (configure SSO in the Supabase dashboard using the stored metadata).
 */
import { Router } from 'express';
import { z } from 'zod';
import { supabaseRestAsService } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { requireRole } from '../middleware/rbac';
import { auditLog } from '../lib/audit-logger';

const router = Router();

const SSO_PROVIDERS = ['okta', 'azure_ad', 'google', 'custom'] as const;

const UpsertSsoSchema = z.object({
  provider: z.enum(SSO_PROVIDERS),
  metadata_url: z.string().url().optional(),
  metadata_xml: z.string().max(200_000).optional(),
  domain_hint: z.string().max(253).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (d) => d.metadata_url || d.metadata_xml,
  { message: 'Either metadata_url or metadata_xml is required' }
);

/**
 * GET /api/sso
 * List SSO configurations for the org.
 */
router.get('/sso', async (req, res) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const rows = await supabaseRestAsService('sso_configurations', new URLSearchParams({
      select: 'id,provider,metadata_url,domain_hint,enabled,created_at,updated_at',
      organization_id: `eq.${orgId}`,
    }));
    return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  } catch (err: any) {
    logger.error('sso GET error', { err: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch SSO config' });
  }
});

/**
 * PUT /api/sso
 * Upsert an SSO provider configuration. Admin-only.
 */
router.put('/sso', requireRole('admin'), async (req, res) => {
  const orgId = req.user?.organization_id;
  const userId = req.user?.id;
  if (!orgId || !userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const parsed = UpsertSsoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message });
  }

  const { provider, metadata_url, metadata_xml, domain_hint, enabled = true } = parsed.data;

  try {
    const rows = await supabaseRestAsService('sso_configurations', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        provider,
        metadata_url: metadata_url ?? null,
        metadata_xml: metadata_xml ?? null,
        domain_hint: domain_hint ?? null,
        enabled,
        updated_at: new Date().toISOString(),
      },
      headers: {
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
    }) as any[];

    await auditLog.log({
      user_id: userId,
      action: 'sso.configured',
      resource_type: 'sso_configuration',
      organization_id: orgId,
      ip_address: req.ip,
      metadata: { provider, enabled },
    });

    return res.status(200).json({ success: true, data: Array.isArray(rows) ? rows[0] : null });
  } catch (err: any) {
    logger.error('sso PUT error', { err: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to save SSO config' });
  }
});

/**
 * DELETE /api/sso/:provider
 * Remove an SSO configuration. Admin-only.
 */
router.delete('/sso/:provider', requireRole('admin'), async (req, res) => {
  const orgId = req.user?.organization_id;
  const userId = req.user?.id;
  const { provider } = req.params;
  if (!orgId || !userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await supabaseRestAsService('sso_configurations', new URLSearchParams({
      organization_id: `eq.${orgId}`,
      provider: `eq.${provider}`,
    }), { method: 'DELETE' });

    await auditLog.log({
      user_id: userId,
      action: 'sso.removed',
      resource_type: 'sso_configuration',
      organization_id: orgId,
      ip_address: req.ip,
      metadata: { provider },
    });

    return res.json({ success: true });
  } catch (err: any) {
    logger.error('sso DELETE error', { err: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to remove SSO config' });
  }
});

export default router;
