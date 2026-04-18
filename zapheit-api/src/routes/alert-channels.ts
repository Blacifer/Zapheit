import express, { Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { buildFrontendUrl } from '../lib/frontend-url';
import { errorResponse, getOrgId, getUserJwt } from '../lib/route-helpers';
import {
  encryptChannelConfig,
  decryptChannelConfigForDisplay,
  notifyOneChannel,
  type ChannelType,
  type SeverityLevel,
} from '../lib/alert-channels';

const router = express.Router();

const VALID_TYPES: ChannelType[] = ['pagerduty', 'teams', 'opsgenie', 'email'];
const VALID_SEVERITIES: SeverityLevel[] = ['low', 'medium', 'high', 'critical'];

function sanitizeRow(row: any) {
  return {
    ...row,
    config: decryptChannelConfigForDisplay(row.channel_type, row.config || {}),
  };
}

// GET /alert-channels — list all channels for org
router.get('/alert-channels', requirePermission('settings.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.asc');
    const rows = await supabaseRestAsUser(getUserJwt(req), 'alert_channels', q).catch(() => []) as any[];
    return res.json({ success: true, data: (rows || []).map(sanitizeRow) });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /alert-channels — create a channel
router.post('/alert-channels', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { name, channel_type, enabled = true, min_severity = 'high', config = {} } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    if (!VALID_TYPES.includes(channel_type)) {
      return res.status(400).json({ success: false, error: `channel_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!VALID_SEVERITIES.includes(min_severity)) {
      return res.status(400).json({ success: false, error: `min_severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ success: false, error: 'config must be an object' });
    }

    const encryptedConfig = encryptChannelConfig(channel_type, config as Record<string, string>);
    const rows = await supabaseRestAsUser(getUserJwt(req), 'alert_channels', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        name: name.trim(),
        channel_type,
        enabled: Boolean(enabled),
        min_severity,
        config: encryptedConfig,
      },
    }) as any[];

    if (!rows || rows.length === 0) return errorResponse(res, new Error('Failed to create channel'), 500);
    auditLog.log({ user_id: req.user?.id || 'unknown', action: 'alert_channel.created', resource_type: 'alert_channel', resource_id: rows[0].id, organization_id: orgId, metadata: { channel_type, name } });
    logger.info('Alert channel created', { id: rows[0].id, channel_type, org_id: orgId });
    return res.status(201).json({ success: true, data: sanitizeRow(rows[0]) });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// PUT /alert-channels/:id — update a channel
router.put('/alert-channels/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    // Verify ownership
    const checkQ = new URLSearchParams();
    checkQ.set('id', eq(id));
    checkQ.set('organization_id', eq(orgId));
    const existing = await supabaseRestAsUser(getUserJwt(req), 'alert_channels', checkQ).catch(() => []) as any[];
    if (!existing || existing.length === 0) return errorResponse(res, new Error('Channel not found'), 404);

    const { name, enabled, min_severity, config } = req.body;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name !== undefined) patch.name = String(name).trim();
    if (enabled !== undefined) patch.enabled = Boolean(enabled);
    if (min_severity !== undefined) {
      if (!VALID_SEVERITIES.includes(min_severity)) return res.status(400).json({ success: false, error: 'Invalid min_severity' });
      patch.min_severity = min_severity;
    }
    if (config !== undefined && typeof config === 'object' && !Array.isArray(config)) {
      const channelType: ChannelType = existing[0].channel_type;
      // Only re-encrypt fields that are not masked (masked = "••••••••")
      const merged = { ...existing[0].config } as Record<string, string>;
      for (const [k, v] of Object.entries(config as Record<string, string>)) {
        if (v !== '••••••••') merged[k] = v;
      }
      patch.config = encryptChannelConfig(channelType, merged);
    }

    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    patchQ.set('organization_id', eq(orgId));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'alert_channels', patchQ, { method: 'PATCH', body: patch }) as any[];
    if (!rows || rows.length === 0) return errorResponse(res, new Error('Channel not found'), 404);
    return res.json({ success: true, data: sanitizeRow(rows[0]) });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// DELETE /alert-channels/:id
router.delete('/alert-channels/:id', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    await supabaseRestAsUser(getUserJwt(req), 'alert_channels', q, { method: 'DELETE' });
    auditLog.log({ user_id: req.user?.id || 'unknown', action: 'alert_channel.deleted', resource_type: 'alert_channel', resource_id: id, organization_id: orgId, metadata: {} });
    return res.json({ success: true });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

// POST /alert-channels/:id/test — send a test notification
router.post('/alert-channels/:id/test', requirePermission('settings.update'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const q = new URLSearchParams();
    q.set('id', eq(id));
    q.set('organization_id', eq(orgId));
    const rows = await supabaseRestAsUser(getUserJwt(req), 'alert_channels', q).catch(() => []) as any[];
    if (!rows || rows.length === 0) return errorResponse(res, new Error('Channel not found'), 404);

    // Dispatch a synthetic test incident (only to this one channel, bypassing severity filter)
    const testIncident = {
      incidentId: `test-${Date.now()}`,
      title: 'Test notification from Zapheit',
      severity: 'high' as SeverityLevel,
      incidentType: 'test',
      agentId: 'test-agent',
      description: 'This is a test notification sent from the Zapheit alert channels settings page.',
      dashboardUrl: buildFrontendUrl('/dashboard/incidents'),
    };

    const ch = rows[0];
    // Dispatch directly to this single channel — bypasses enabled/severity filters
    await notifyOneChannel(ch, testIncident);

    logger.info('Alert channel test sent', { id, channel_type: ch.channel_type, org_id: orgId });
    return res.json({ success: true, message: `Test notification dispatched to ${ch.name}` });
  } catch (err: any) {
    return errorResponse(res, err);
  }
});

export default router;
