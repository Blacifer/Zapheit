import express, { Request, Response } from 'express';
import archiver from 'archiver';
import PDFDocument from 'pdfkit';
import { logger } from '../lib/logger';
import { requirePermission } from '../middleware/rbac';
import { eq, gte, supabaseRestAsUser } from '../lib/supabase-rest';
import { generateComplianceExport } from '../services/compliance-export';
import { supabaseAdmin } from '../lib/supabase';

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

// --- Shared PDF generation helper ---
async function streamCompliancePdf(
  _req: Request,
  res: Response,
  organizationId: string,
  startDate: string,
  endDate: string,
  exportLabel: string
): Promise<void> {
  try {
    const [orgRows, incidents, auditLogs, policyPacks] = await Promise.all([
      supabaseAdmin.from('organizations').select('name, plan').eq('id', organizationId).limit(1),
      supabaseAdmin.from('incidents').select('*').eq('organization_id', organizationId)
        .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }),
      supabaseAdmin.from('audit_logs').select('action, resource_type, created_at').eq('organization_id', organizationId)
        .gte('created_at', startDate).lte('created_at', endDate).order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('policy_packs').select('name, enforcement_level, is_active').eq('organization_id', organizationId),
    ]);

    const orgName = (orgRows.data?.[0] as any)?.name || 'Your Organization';
    const orgPlan = (orgRows.data?.[0] as any)?.plan || 'unknown';
    const incidentList: any[] = incidents.data || [];
    const auditList: any[] = auditLogs.data || [];
    const policyList: any[] = policyPacks.data || [];

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `rasi-compliance-report-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const BRAND = '#6366f1';
    const DARK = '#1e1b4b';
    const GRAY = '#6b7280';
    const RED = '#ef4444';
    const GREEN = '#22c55e';
    const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const pageW = doc.page.width - 100;

    // Cover header
    doc.rect(0, 0, doc.page.width, 130).fill(DARK);
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('Rasi Compliance Report', 50, 40);
    doc.fontSize(11).font('Helvetica').text(`${orgName}  ·  ${exportLabel.toUpperCase()} Export`, 50, 70);
    doc.fontSize(9).fillColor('#a5b4fc').text(`Period: ${fmt(startDate)} – ${fmt(endDate)}   ·   Generated: ${fmt(new Date().toISOString())}   ·   Plan: ${orgPlan}`, 50, 92);
    doc.moveDown(4);

    const section = (title: string) => {
      doc.moveDown(0.5);
      doc.rect(50, doc.y, pageW, 22).fill(BRAND);
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(title, 58, doc.y - 17);
      doc.moveDown(0.8);
      doc.fillColor(DARK).font('Helvetica').fontSize(10);
    };

    const kv = (label: string, value: string) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value);
    };

    // 1. Executive Summary
    section('1. Executive Summary');
    const critical = incidentList.filter((i) => i.severity === 'critical').length;
    const high = incidentList.filter((i) => i.severity === 'high').length;
    const resolved = incidentList.filter((i) => i.status === 'resolved').length;
    const activePolicies = policyList.filter((p) => p.is_active).length;
    kv('Total Incidents', String(incidentList.length));
    kv('Critical / High Severity', `${critical} / ${high}`);
    kv('Resolved Incidents', `${resolved} of ${incidentList.length}`);
    kv('Active Governance Policies', String(activePolicies));
    kv('Audit Log Entries (sample)', String(auditList.length));
    doc.moveDown(0.3);
    const overallStatus = critical === 0 ? 'COMPLIANT' : 'REVIEW REQUIRED';
    doc.fillColor(critical === 0 ? GREEN : RED).font('Helvetica-Bold').fontSize(12).text(`Overall Status: ${overallStatus}`);
    doc.fillColor(DARK).font('Helvetica').fontSize(10);

    // 2. Incident Summary
    section('2. Incident Summary');
    if (incidentList.length === 0) {
      doc.fillColor(GREEN).text('No incidents recorded in this period.').fillColor(DARK);
    } else {
      const bySeverity: Record<string, number> = {};
      const byType: Record<string, number> = {};
      for (const inc of incidentList) {
        bySeverity[inc.severity || 'unknown'] = (bySeverity[inc.severity || 'unknown'] || 0) + 1;
        byType[inc.incident_type || 'unknown'] = (byType[inc.incident_type || 'unknown'] || 0) + 1;
      }
      doc.text('By Severity:');
      for (const [sev, cnt] of Object.entries(bySeverity)) {
        doc.fillColor(sev === 'critical' ? RED : sev === 'high' ? '#f97316' : GRAY).text(`  • ${sev}: ${cnt}`).fillColor(DARK);
      }
      doc.moveDown(0.3).text('By Type:');
      for (const [type, cnt] of Object.entries(byType)) doc.text(`  • ${type}: ${cnt}`);
      doc.moveDown(0.5).text('Recent Incidents (up to 10):');
      for (const inc of incidentList.slice(0, 10)) {
        doc.fillColor(GRAY).fontSize(9)
          .text(`  ${fmt(inc.created_at)}  [${(inc.severity || '?').toUpperCase()}]  ${inc.title || inc.incident_type || 'Incident'}  —  ${inc.status || 'open'}`)
          .fillColor(DARK).fontSize(10);
      }
    }

    // 3. Policy Coverage
    section('3. Governance Policy Coverage');
    if (policyList.length === 0) {
      doc.text('No policies configured.');
    } else {
      for (const p of policyList) {
        doc.fillColor(p.is_active ? GREEN : GRAY).text(`  ${p.is_active ? '✓ Active' : '✗ Inactive'}  `, { continued: true })
          .fillColor(DARK).text(`${p.name}  [${p.enforcement_level || 'advisory'}]`);
      }
    }

    // 4. Regulatory Framework Mapping
    section('4. Regulatory Framework Mapping');
    const frameworks = [
      { name: 'DPDPA (India) — Data Breach Detection', feature: 'PII incident detection', status: 'Covered' },
      { name: 'DPDPA — Data Fiduciary Obligations', feature: 'Action policies + HITL approvals', status: 'Covered' },
      { name: 'DPDPA — Breach Notification', feature: 'Webhook alerts on incident.created', status: 'Covered' },
      { name: 'NIST AI RMF — Govern', feature: 'Action policies, RBAC, audit logs', status: 'Covered' },
      { name: 'NIST AI RMF — Map', feature: 'Agent fleet + integration inventory', status: 'Covered' },
      { name: 'NIST AI RMF — Measure', feature: 'Incident detection + cost tracking + Shadow Mode', status: 'Covered' },
      { name: 'NIST AI RMF — Manage', feature: 'Kill switch, HITL approvals, remediation', status: activePolicies > 0 ? 'Covered' : 'Partial' },
    ];
    for (const fw of frameworks) {
      doc.fillColor(fw.status === 'Covered' ? GREEN : '#f97316').font('Helvetica-Bold').text(`  [${fw.status}]  `, { continued: true })
        .fillColor(DARK).font('Helvetica').text(fw.name)
        .fillColor(GRAY).fontSize(9).text(`    → ${fw.feature}`).fillColor(DARK).fontSize(10);
    }

    // 5. Audit Trail Excerpt
    section('5. Audit Trail Excerpt (last 50 entries)');
    if (auditList.length === 0) {
      doc.text('No audit log entries in this period.');
    } else {
      doc.fontSize(9).fillColor(GRAY);
      for (const entry of auditList) {
        doc.text(`  ${fmt(entry.created_at)}  ${(entry.action || '').padEnd(30)}  ${entry.resource_type || ''}`);
      }
      doc.fillColor(DARK).fontSize(10);
    }

    // 6. Safe Harbor Status
    section('6. Safe Harbor Status');
    kv('Plan', orgPlan);
    kv('Incident Detection', 'Active');
    kv('Audit Logging', 'Active');
    kv('Policy Enforcement', activePolicies > 0 ? `Active (${activePolicies} policies)` : 'No active policies');
    doc.moveDown(0.5);
    doc.fillColor(GRAY).fontSize(9)
      .text('This report was automatically generated by Rasi AI Agent Governance Platform. It is intended as supporting evidence for compliance and audit purposes. Rasi does not certify regulatory compliance — consult your compliance officer for formal assessments.');

    // Footer on each page
    const pageCount = (doc as any).bufferedPageRange?.()?.count || 1;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor(GRAY).fontSize(8)
        .text(`Rasi Compliance Report  ·  ${orgName}  ·  Confidential  ·  Page ${i + 1} of ${pageCount}`, 50, doc.page.height - 40, { align: 'center', width: pageW });
    }

    doc.end();
  } catch (error: any) {
    logger.error('Error generating compliance PDF:', { error: error?.message });
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
}

// GET /api/compliance/report.pdf - Direct PDF download (no pre-existing export required)
router.get('/report.pdf', async (req: Request, res: Response) => {
  const orgId = req.user?.organization_id;
  if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const startDate = String(req.query.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
  const endDate = String(req.query.to || new Date().toISOString());
  return streamCompliancePdf(req, res, orgId, startDate, endDate, 'full');
});

// GET /api/compliance/exports/:id/pdf - Download a specific export as PDF
router.get('/exports/:id/pdf', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { id } = req.params;
    const organizationId = req.user?.organization_id;
    if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const exportRows = (await supabaseRestAsUser(userJwt, 'compliance_exports', new URLSearchParams({
      select: 'export_type,date_range_start,date_range_end',
      id: eq(id),
      organization_id: eq(String(organizationId)),
      limit: '1',
    }))) as any[];
    const exportRecord = exportRows?.[0];
    if (!exportRecord) return res.status(404).json({ success: false, error: 'Export not found' });

    const startDate = exportRecord.date_range_start || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = exportRecord.date_range_end || new Date().toISOString();
    return streamCompliancePdf(req, res, organizationId, startDate, endDate, exportRecord.export_type || 'full');
  } catch (error: any) {
    logger.error('Error generating compliance PDF for export:', { error: error?.message });
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
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

// GET /api/compliance/audit-logs — paginated audit log viewer
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organization_id;
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const {
      action,
      resource_type,
      user_id,
      from,
      to,
      search,
      page = '1',
      limit: limitStr = '50',
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitStr, 10) || 50, 200);
    const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

    let query = supabaseAdmin
      .from('audit_logs')
      .select('*, users(id, email, full_name)', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (action) query = query.eq('action', action);
    if (resource_type) query = query.eq('resource_type', resource_type);
    if (user_id) query = query.eq('user_id', user_id);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (search) query = query.ilike('action', `%${search}%`);

    const { data, error, count } = await query;

    if (error) {
      logger.warn('audit-logs query error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      data,
      total: count ?? 0,
      page: Math.max(parseInt(page, 10) || 1, 1),
      limit,
    });
  } catch (error: any) {
    logger.error('Error fetching audit logs', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/compliance/data-export.zip — full org data export as ZIP
// Exports: agents, conversations, incidents, action_policies, audit_logs,
//          cost_tracking, webhooks, integrations
router.get('/data-export.zip', requirePermission('compliance.export'), async (req: Request, res: Response) => {
  const organizationId = req.user?.organization_id;
  if (!organizationId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const tables = [
      { name: 'agents.json', table: 'ai_agents', select: 'id,name,description,agent_type,platform,model_name,status,budget_limit,created_at' },
      { name: 'conversations.json', table: 'conversations', select: 'id,agent_id,platform,status,started_at,ended_at,created_at' },
      { name: 'incidents.json', table: 'incidents', select: 'id,agent_id,incident_type,severity,status,title,description,confidence,created_at,resolved_at' },
      { name: 'policies.json', table: 'policy_packs', select: 'id,name,enforcement_level,is_active,created_at' },
      { name: 'action_policies.json', table: 'action_policies', select: 'id,service,action,enabled,require_approval,required_role,notes,created_at' },
      { name: 'audit_logs.json', table: 'audit_logs', select: 'id,action,resource_type,resource_id,user_id,created_at,metadata' },
      { name: 'cost_tracking.json', table: 'cost_tracking', select: 'id,agent_id,model_name,total_tokens,total_cost_usd,date,created_at' },
      { name: 'webhooks.json', table: 'webhooks', select: 'id,name,url,events,is_active,created_at' },
      { name: 'integrations.json', table: 'integrations', select: 'id,service_type,display_name,status,auth_type,created_at' },
    ];

    const filename = `rasi-data-export-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { logger.error('Archiver error', { error: err.message }); });
    archive.pipe(res);

    // Fetch each table in parallel then append to archive
    const results = await Promise.allSettled(
      tables.map(async ({ table, select }) => {
        const { data } = await supabaseAdmin.from(table).select(select).eq('organization_id', organizationId).limit(10000);
        return data || [];
      })
    );

    for (let i = 0; i < tables.length; i++) {
      const { name } = tables[i];
      const result = results[i];
      const data = result.status === 'fulfilled' ? result.value : [];
      archive.append(JSON.stringify(data, null, 2), { name });
    }

    // Manifest
    archive.append(JSON.stringify({
      exported_at: new Date().toISOString(),
      organization_id: organizationId,
      files: tables.map((t) => t.name),
      generator: 'Rasi AI Agent Governance Platform',
      note: 'Your data is yours — export anytime, delete anytime.',
    }, null, 2), { name: 'manifest.json' });

    await archive.finalize();
  } catch (error: any) {
    logger.error('Data export failed', { error: error?.message });
    if (!res.headersSent) res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
