import { logger } from '../lib/logger';
import { eq, gte, lte, supabaseRestAsService } from '../lib/supabase-rest';

/**
 * Compliance export generation runs asynchronously and requires broad read access
 * across org-scoped tables. This is an explicit service-role operation.
 */
export async function generateComplianceExport(
  exportId: string,
  organizationId: string,
  exportType: string,
  options: { date_range_start: string; date_range_end: string; filters: any }
): Promise<void> {
  try {
    // Update status to processing
    await supabaseRestAsService('compliance_exports', new URLSearchParams({ id: eq(exportId) }), {
      method: 'PATCH',
      body: { status: 'processing' },
    });

    const exportData: any = {
      export_type: exportType,
      generated_at: new Date().toISOString(),
      organization_id: organizationId,
      date_range: {
        start: options.date_range_start,
        end: options.date_range_end,
      },
      data: {},
    };

    // Note: PostgREST cannot express "created_at <= ..." with duplicated param keys in URLSearchParams.
    // Build queries manually when needing both gte + lte on the same column.
    const auditLogs = (await supabaseRestAsService(
      'audit_logs',
      `select=*&organization_id=${eq(organizationId)}&created_at=${gte(options.date_range_start)}&created_at=${lte(options.date_range_end)}&order=created_at.desc`
    )) as any[];
    exportData.data.audit_logs = auditLogs || [];

    const complianceEvents = (await supabaseRestAsService(
      'compliance_events',
      `select=*&organization_id=${eq(organizationId)}&created_at=${gte(options.date_range_start)}&created_at=${lte(options.date_range_end)}&order=created_at.desc`
    )) as any[];
    exportData.data.compliance_events = complianceEvents || [];

    const incidents = (await supabaseRestAsService(
      'incidents',
      `select=*&organization_id=${eq(organizationId)}&created_at=${gte(options.date_range_start)}&created_at=${lte(options.date_range_end)}`
    )) as any[];
    exportData.data.incidents = incidents || [];

    const policyPacks = (await supabaseRestAsService(
      'policy_packs',
      new URLSearchParams({
        select: '*',
        organization_id: eq(organizationId),
      })
    )) as any[];
    exportData.data.policy_packs = policyPacks || [];

    const exportJson = JSON.stringify(exportData, null, 2);
    const fileSize = Buffer.byteLength(exportJson, 'utf8');
    const recordCount =
      (auditLogs?.length || 0) +
      (complianceEvents?.length || 0) +
      (incidents?.length || 0) +
      (policyPacks?.length || 0);

    await supabaseRestAsService('compliance_exports', new URLSearchParams({ id: eq(exportId) }), {
      method: 'PATCH',
      body: {
        status: 'completed',
        file_size_bytes: fileSize,
        record_count: recordCount,
        file_url: `/api/compliance/exports/${exportId}/download`,
        completed_at: new Date().toISOString(),
      },
    });

    logger.info('Compliance export generated successfully', {
      exportId,
      exportType,
      recordCount,
      fileSize,
    });
  } catch (error: any) {
    logger.error('Failed to generate compliance export:', { error: error?.message || 'Unknown error', exportId });

    try {
      await supabaseRestAsService('compliance_exports', new URLSearchParams({ id: eq(exportId) }), {
        method: 'PATCH',
        body: { status: 'failed', error_message: error?.message || 'Export failed' },
      });
    } catch (updateErr: any) {
      logger.error('Failed to write compliance export failure status', {
        error: updateErr?.message || 'Unknown error',
        exportId,
      });
    }
  }
}
