import express, { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { requirePermission } from '../middleware/rbac';
import { eq, gte, supabaseRestAsUser } from '../lib/supabase-rest';
import { generateComplianceExport } from '../services/compliance-export';

const router = express.Router();

function requireUserJwt(req: Request, res: Response): string | null {
  const userJwt = (req as any).userJwt as string | undefined;
  if (!userJwt) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return userJwt;
}

/**
 * Compliance Export Routes
 * For SOC2, GDPR, HIPAA evidence generation
 */

// GET /api/compliance/exports - List all compliance exports
router.get('/exports', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;

    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const query = new URLSearchParams({
      select: '*',
      organization_id: eq(organizationId),
      order: 'requested_at.desc',
      limit: '50',
    });
    const data = await supabaseRestAsUser(userJwt, 'compliance_exports', query);

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching compliance exports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/compliance/exports - Request new compliance export (requires permissions)
router.post('/exports', requirePermission('compliance.export'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;
    const userId = req.user?.id;
    const { export_type, date_range_start, date_range_end, filters } = req.body;

    if (!organizationId || !userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!export_type) {
      return res.status(400).json({ success: false, error: 'export_type is required' });
    }

    // Create export record
    const exportRecordRows = (await supabaseRestAsUser(userJwt, 'compliance_exports', '', {
      method: 'POST',
      body: [{
        organization_id: organizationId,
        export_type,
        requested_by: userId,
        status: 'pending',
        date_range_start: date_range_start || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        date_range_end: date_range_end || new Date().toISOString(),
        filters: filters || {},
      }],
    })) as any[];
    const exportRecord = exportRecordRows?.[0];

    // Log compliance event
    await supabaseRestAsUser(userJwt, 'compliance_events', '', {
      method: 'POST',
      body: [{
        organization_id: organizationId,
        event_type: 'data_export',
        severity: 'info',
        resource_type: 'compliance_export',
        resource_id: exportRecord?.id,
        actor_id: userId,
        details: { export_type, filters },
      }],
    });

    // Start async export generation (in production, this would be a background job)
    generateComplianceExport(exportRecord.id, organizationId, export_type, {
      date_range_start: exportRecord.date_range_start,
      date_range_end: exportRecord.date_range_end,
      filters: exportRecord.filters,
    }).catch((err) => {
      logger.error('Failed to generate compliance export:', err);
    });

    res.status(201).json({ success: true, data: exportRecord });
  } catch (error: any) {
    console.error('Error creating compliance export:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/compliance/exports/:id - Get export status/download
router.get('/exports/:id', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { id } = req.params;
    const organizationId = req.user?.organization_id;

    const query = new URLSearchParams({
      select: '*',
      id: eq(id),
      organization_id: eq(String(organizationId || '')),
      limit: '1',
    });
    const rows = (await supabaseRestAsUser(userJwt, 'compliance_exports', query)) as any[];
    const data = rows?.[0];
    if (!data) {
      return res.status(404).json({ success: false, error: 'Export not found' });
    }

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching compliance export:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Compliance Events Routes
 * Track all compliance-relevant events
 */

// GET /api/compliance/events - List compliance events
router.get('/events', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;
    const { event_type, severity, limit = 100 } = req.query;

    const query = new URLSearchParams({
      select: '*',
      organization_id: eq(String(organizationId || '')),
      order: 'created_at.desc',
      limit: String(Number(limit) || 100),
    });
    if (event_type) query.set('event_type', eq(String(event_type)));
    if (severity) query.set('severity', eq(String(severity)));
    const data = await supabaseRestAsUser(userJwt, 'compliance_events', query);

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching compliance events:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/compliance/events - Log compliance event (requires permissions)
router.post('/events', requirePermission('compliance.log'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;
    const userId = req.user?.id;
    const { event_type, severity, resource_type, resource_id, details } = req.body;

    if (!event_type) {
      return res.status(400).json({ success: false, error: 'event_type is required' });
    }

    const created = (await supabaseRestAsUser(userJwt, 'compliance_events', '', {
      method: 'POST',
      body: [{
        organization_id: organizationId,
        event_type,
        severity: severity || 'info',
        resource_type,
        resource_id,
        actor_id: userId,
        details: details || {},
        remediation_status: 'none',
      }],
    })) as any[];

    res.status(201).json({ success: true, data: created?.[0] });
  } catch (error: any) {
    console.error('Error creating compliance event:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Compliance Dashboard Stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;
    const { days = 30 } = req.query;
    const startDate = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();

    // Get event counts by type
    const eventsQuery = new URLSearchParams({
      select: 'event_type,severity',
      organization_id: eq(String(organizationId || '')),
      created_at: gte(startDate),
    });
    const events = (await supabaseRestAsUser(userJwt, 'compliance_events', eventsQuery)) as any[];

    // Get active policies count
    const policiesQuery = new URLSearchParams({
      select: 'id,enforcement_level',
      organization_id: eq(String(organizationId || '')),
      is_active: 'eq.true',
    });
    const policies = (await supabaseRestAsUser(userJwt, 'policy_packs', policiesQuery)) as any[];

    // Get recent exports
    const exportsQuery = new URLSearchParams({
      select: 'status',
      organization_id: eq(String(organizationId || '')),
      requested_at: gte(startDate),
    });
    const exports = (await supabaseRestAsUser(userJwt, 'compliance_exports', exportsQuery)) as any[];

    // Calculate stats
    const eventsByType = events?.reduce((acc: any, event: any) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {});

    const eventsBySeverity = events?.reduce((acc: any, event: any) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {});

    const stats = {
      total_events: events?.length || 0,
      events_by_type: eventsByType,
      events_by_severity: eventsBySeverity,
      active_policies: policies?.length || 0,
      policies_by_level: policies?.reduce((acc: any, policy: any) => {
        acc[policy.enforcement_level] = (acc[policy.enforcement_level] || 0) + 1;
        return acc;
      }, {}),
      recent_exports: exports?.length || 0,
      exports_by_status: exports?.reduce((acc: any, exp: any) => {
        acc[exp.status] = (acc[exp.status] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('Error fetching compliance stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
