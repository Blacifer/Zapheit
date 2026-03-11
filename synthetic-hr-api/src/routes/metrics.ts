import { Router } from 'express';
import { logger } from '../lib/logger';
import { getMetricsSnapshot } from '../middleware/metrics';
import { SupabaseRestError, eq, gte, supabaseRestAsUser } from '../lib/supabase-rest';

const router = Router();

interface EscalationMetricRow {
  channel: string;
  delivery_status: 'delivered' | 'failed' | 'pending' | string;
  delivery_attempts: number | null;
  created_at: string | null;
  delivered_at: string | null;
}

interface IncidentMetricRow {
  incident_type: string;
  severity: string;
  status: 'open' | 'investigating' | 'resolved' | string;
  created_at: string | null;
  resolved_at: string | null;
}

/**
 * GET /api/metrics/system
 * Get real-time system performance metrics
 */
router.get('/system', async (req, res) => {
  try {
    const snapshot = getMetricsSnapshot();
    
    res.json({
      success: true,
      data: snapshot,
      requestId: req.requestId,
    });
  } catch (err) {
    logger.error('Error fetching system metrics', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
  }
});

/**
 * GET /api/metrics/delivery
 * Get alert delivery metrics and SLO tracking
 */
router.get('/delivery', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = (req.user as any)?.organization_id;
    if (!orgId) {
      return res.json({
        success: true,
        data: {
          summary: {
            totalAlerts: 0,
            deliveredAlerts: 0,
            failedAlerts: 0,
            pendingAlerts: 0,
            deliverySuccessRate: 0,
            avgDeliveryTimeMs: 0,
            avgRetries: 0,
          },
          byChannel: {},
          slo: {
            target: { deliverySuccessRate: 99, maxDeliveryTimeMs: 5000 },
            current: { deliverySuccessRate: 0, avgDeliveryTimeMs: 0 },
            met: { deliverySuccessRateMet: false, avgDeliveryTimeMet: true, overallSloMet: false },
          },
          timeRange: {
            from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString(),
          },
          note: 'Organization missing on user profile; delivery metrics defaulted to empty.',
        },
        requestId: req.requestId,
      });
    }

    // Get escalation delivery statistics
    let escalations: any[] = [];
    const timeFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const query = new URLSearchParams({
        select: 'channel,delivery_status,delivery_attempts,created_at,delivered_at',
        organization_id: eq(orgId),
        created_at: gte(timeFrom),
      });
      escalations = (await supabaseRestAsUser(userJwt, 'escalations', query)) as any[];
    } catch (error: any) {
      if (error instanceof SupabaseRestError) {
        logger.warn('Delivery metrics unavailable; returning empty state', {
          status: error.status,
          requestId: req.requestId,
        });
        return res.json({
          success: true,
          data: {
            summary: {
              totalAlerts: 0,
              deliveredAlerts: 0,
              failedAlerts: 0,
              pendingAlerts: 0,
              deliverySuccessRate: 0,
              avgDeliveryTimeMs: 0,
              avgRetries: 0,
            },
            byChannel: {},
            slo: {
              target: { deliverySuccessRate: 99, maxDeliveryTimeMs: 5000 },
              current: { deliverySuccessRate: 0, avgDeliveryTimeMs: 0 },
              met: { deliverySuccessRateMet: false, avgDeliveryTimeMet: true, overallSloMet: false },
            },
            timeRange: {
              from: timeFrom,
              to: new Date().toISOString(),
            },
            note: 'Escalation metrics not available yet (missing table or permissions).',
          },
          requestId: req.requestId,
        });
      }
      throw error;
    }

    // Calculate metrics
    const escalationRows = (escalations || []) as EscalationMetricRow[];
    const totalAlerts = escalationRows.length;
    const deliveredAlerts = escalationRows.filter((e: EscalationMetricRow) => e.delivery_status === 'delivered').length;
    const failedAlerts = escalationRows.filter((e: EscalationMetricRow) => e.delivery_status === 'failed').length;
    const pendingAlerts = escalationRows.filter((e: EscalationMetricRow) => e.delivery_status === 'pending').length;

    const deliverySuccessRate = totalAlerts > 0 ? (deliveredAlerts / totalAlerts) * 100 : 0;

    // Calculate average delivery time (for successfully delivered alerts)
    const deliveredWithTiming = escalationRows.filter(
      (e: EscalationMetricRow) => e.delivery_status === 'delivered' && e.created_at && e.delivered_at
    );
    
    const avgDeliveryTimeMs = deliveredWithTiming.length > 0
      ? deliveredWithTiming.reduce((sum: number, e: EscalationMetricRow) => {
          const created = new Date(e.created_at!).getTime();
          const delivered = new Date(e.delivered_at!).getTime();
          return sum + (delivered - created);
        }, 0) / deliveredWithTiming.length
      : 0;

    // Calculate retry statistics
    const totalRetries = escalationRows.reduce((sum: number, e: EscalationMetricRow) => sum + (e.delivery_attempts || 0), 0);
    const avgRetries = totalAlerts > 0 ? totalRetries / totalAlerts : 0;

    // Channel breakdown
    const byChannel = escalationRows.reduce((acc: Record<string, any>, e: EscalationMetricRow) => {
      if (!acc[e.channel]) {
        acc[e.channel] = {
          total: 0,
          delivered: 0,
          failed: 0,
          pending: 0,
        };
      }
      acc[e.channel].total++;
      if (e.delivery_status === 'delivered') acc[e.channel].delivered++;
      if (e.delivery_status === 'failed') acc[e.channel].failed++;
      if (e.delivery_status === 'pending') acc[e.channel].pending++;
      return acc;
    }, {} as Record<string, any>);

    // SLO tracking (target: 99% delivery success, < 5s delivery time)
    const sloTarget = {
      deliverySuccessRate: 99,
      maxDeliveryTimeMs: 5000,
    };

    const sloMetrics = {
      deliverySuccessRateMet: deliverySuccessRate >= sloTarget.deliverySuccessRate,
      avgDeliveryTimeMet: avgDeliveryTimeMs <= sloTarget.maxDeliveryTimeMs,
      overallSloMet: deliverySuccessRate >= sloTarget.deliverySuccessRate && avgDeliveryTimeMs <= sloTarget.maxDeliveryTimeMs,
    };

    res.json({
      success: true,
      data: {
        summary: {
          totalAlerts,
          deliveredAlerts,
          failedAlerts,
          pendingAlerts,
          deliverySuccessRate: Math.round(deliverySuccessRate * 100) / 100,
          avgDeliveryTimeMs: Math.round(avgDeliveryTimeMs),
          avgRetries: Math.round(avgRetries * 100) / 100,
        },
        byChannel,
        slo: {
          target: sloTarget,
          current: {
            deliverySuccessRate: Math.round(deliverySuccessRate * 100) / 100,
            avgDeliveryTimeMs: Math.round(avgDeliveryTimeMs),
          },
          met: sloMetrics,
        },
        timeRange: {
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date().toISOString(),
        },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    logger.error('Error fetching delivery metrics', { error: err, requestId: req.requestId });
    res.json({
      success: true,
      data: {
        summary: {
          totalAlerts: 0,
          deliveredAlerts: 0,
          failedAlerts: 0,
          pendingAlerts: 0,
          deliverySuccessRate: 0,
          avgDeliveryTimeMs: 0,
          avgRetries: 0,
        },
        byChannel: {},
        slo: {
          target: { deliverySuccessRate: 99, maxDeliveryTimeMs: 5000 },
          current: { deliverySuccessRate: 0, avgDeliveryTimeMs: 0 },
          met: { deliverySuccessRateMet: false, avgDeliveryTimeMet: true, overallSloMet: false },
        },
        timeRange: {
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date().toISOString(),
        },
        note: 'Delivery metrics temporarily unavailable.',
      },
      requestId: req.requestId,
    });
  }
});

/**
 * GET /api/metrics/incidents
 * Get incident resolution metrics
 */
router.get('/incidents', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const userJwt = (req as any).userJwt as string | undefined;
    if (!userJwt) {
      return res.status(401).json({ error: 'Unauthorized', requestId: req.requestId });
    }

    const orgId = (req.user as any)?.organization_id;
    if (!orgId) {
      return res.json({
        success: true,
        data: {
          summary: {
            totalIncidents: 0,
            resolved: 0,
            open: 0,
            investigating: 0,
            resolutionRate: 0,
            mttrMs: 0,
            mttrHours: 0,
          },
          timeRange: {
            from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString(),
          },
          note: 'Organization missing on user profile; incident metrics defaulted to empty.',
        },
        requestId: req.requestId,
      });
    }

    // Get incident statistics
    let incidents: any[] = [];
    const timeFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const query = new URLSearchParams({
        select: 'incident_type,severity,status,created_at,resolved_at',
        organization_id: eq(orgId),
        created_at: gte(timeFrom),
      });
      incidents = (await supabaseRestAsUser(userJwt, 'incidents', query)) as any[];
    } catch (error: any) {
      if (error instanceof SupabaseRestError) {
        logger.warn('Incident metrics unavailable; returning empty state', {
          status: error.status,
          requestId: req.requestId,
        });
        return res.json({
          success: true,
          data: {
            summary: {
              totalIncidents: 0,
              resolved: 0,
              open: 0,
              investigating: 0,
              resolutionRate: 0,
              mttrMs: 0,
              mttrHours: 0,
            },
            timeRange: {
              from: timeFrom,
              to: new Date().toISOString(),
            },
            note: 'Incident metrics not available yet (missing table or permissions).',
          },
          requestId: req.requestId,
        });
      }
      throw error;
    }

    const incidentRows = (incidents || []) as IncidentMetricRow[];
    const totalIncidents = incidentRows.length;
    const resolved = incidentRows.filter((i: IncidentMetricRow) => i.status === 'resolved').length;
    const open = incidentRows.filter((i: IncidentMetricRow) => i.status === 'open').length;
    const investigating = incidentRows.filter((i: IncidentMetricRow) => i.status === 'investigating').length;

    // Calculate MTTR (Mean Time To Resolution)
    const resolvedWithTiming = incidentRows.filter(
      (i: IncidentMetricRow) => i.status === 'resolved' && i.created_at && i.resolved_at
    );
    
    const mttrMs = resolvedWithTiming.length > 0
      ? resolvedWithTiming.reduce((sum: number, i: IncidentMetricRow) => {
          const created = new Date(i.created_at!).getTime();
          const resolved = new Date(i.resolved_at!).getTime();
          return sum + (resolved - created);
        }, 0) / resolvedWithTiming.length
      : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalIncidents,
          resolved,
          open,
          investigating,
          resolutionRate: totalIncidents > 0 ? Math.round((resolved / totalIncidents) * 10000) / 100 : 0,
          mttrMs: Math.round(mttrMs),
          mttrHours: Math.round((mttrMs / (1000 * 60 * 60)) * 100) / 100,
        },
        timeRange: {
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date().toISOString(),
        },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    logger.error('Error fetching incident metrics', { error: err, requestId: req.requestId });
    res.json({
      success: true,
      data: {
        summary: {
          totalIncidents: 0,
          resolved: 0,
          open: 0,
          investigating: 0,
          resolutionRate: 0,
          mttrMs: 0,
          mttrHours: 0,
        },
        timeRange: {
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date().toISOString(),
        },
        note: 'Incident metrics temporarily unavailable.',
      },
      requestId: req.requestId,
    });
  }
});

export default router;
