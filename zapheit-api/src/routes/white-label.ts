/**
 * White-label configuration endpoints (P4-08).
 * Enterprise orgs can set custom logo, domain, primary colour, and product name.
 */
import { Router } from 'express';
import { z } from 'zod';
import { supabaseRestAsService } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { requireRole } from '../middleware/rbac';
import { auditLog } from '../lib/audit-logger';

const router = Router();

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const WhiteLabelSchema = z.object({
  white_label_enabled: z.boolean().optional(),
  wl_logo_url: z.string().url().max(2048).optional().nullable(),
  wl_primary_color: z.string().regex(HEX_COLOR, 'Must be a hex color e.g. #1a73e8').optional().nullable(),
  wl_custom_domain: z.string().max(253).optional().nullable(),
  wl_product_name: z.string().max(80).optional().nullable(),
  wl_support_email: z.string().email().optional().nullable(),
  wl_email_from_name: z.string().max(80).optional().nullable(),
});

/**
 * GET /api/white-label
 */
router.get('/white-label', async (req, res) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const rows = await supabaseRestAsService('organizations', new URLSearchParams({
      select: 'white_label_enabled,wl_logo_url,wl_primary_color,wl_custom_domain,wl_product_name,wl_support_email,wl_email_from_name',
      id: `eq.${orgId}`,
      limit: '1',
    }));
    const row = Array.isArray(rows) ? rows[0] : {};
    return res.json({ success: true, ...row });
  } catch (err: any) {
    logger.error('white-label GET error', { err: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch white-label config' });
  }
});

/**
 * PATCH /api/white-label
 * Update white-label configuration. Admin-only.
 */
router.patch('/white-label', requireRole('admin'), async (req, res) => {
  const orgId = req.user?.organization_id;
  const userId = req.user?.id;
  if (!orgId || !userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const parsed = WhiteLabelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message });
  }

  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }

  try {
    await supabaseRestAsService('organizations', new URLSearchParams({ id: `eq.${orgId}` }), {
      method: 'PATCH',
      body: patch,
    });

    await auditLog.log({
      user_id: userId,
      action: 'white_label.updated',
      resource_type: 'organization',
      resource_id: orgId,
      organization_id: orgId,
      ip_address: req.ip,
      metadata: { changed: Object.keys(patch) },
    });

    return res.json({ success: true, updated: Object.keys(patch) });
  } catch (err: any) {
    logger.error('white-label PATCH error', { err: err?.message });
    return res.status(500).json({ success: false, error: 'Failed to update white-label config' });
  }
});

export default router;
