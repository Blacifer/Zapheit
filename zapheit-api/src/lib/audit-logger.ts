import { logger } from './logger';
import { supabaseRest } from './supabase-rest';

interface AuditLogEntry {
  user_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
  organization_id?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toUuidOrNull = (value?: string): string | null => {
  if (!value || !UUID_REGEX.test(value)) return null;
  return value;
};

const toIpOrNull = (value?: string): string | null => {
  if (!value) return null;
  if (value === 'unknown') return null;
  return value;
};

/**
 * Audit logger for security-sensitive operations
 * In production, this should write to audit_logs table
 */
export const auditLog = {
  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    logger.info('AUDIT', {
      timestamp: new Date().toISOString(),
      ...entry,
    });

    if (!entry.organization_id) {
      return;
    }

    try {
      await supabaseRest('audit_logs', '', {
        method: 'POST',
        body: {
          organization_id: toUuidOrNull(entry.organization_id),
          user_id: toUuidOrNull(entry.user_id),
          action: entry.action,
          resource_type: entry.resource_type || null,
          resource_id: toUuidOrNull(entry.resource_id),
          details: entry.metadata || {},
          ip_address: toIpOrNull(entry.ip_address),
          user_agent: entry.user_agent || null,
        },
      });
    } catch (error: any) {
      logger.warn('Failed to persist audit log', {
        action: entry.action,
        error: error?.message,
      });
    }
  },

  /**
   * Log agent creation
   */
  async agentCreated(userId: string, agentId: string, orgId: string, metadata?: any): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'agent.created',
      resource_type: 'agent',
      resource_id: agentId,
      organization_id: orgId,
      metadata,
    });
  },

  /**
   * Log agent update
   */
  async agentUpdated(userId: string, agentId: string, orgId: string, changes?: any): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'agent.updated',
      resource_type: 'agent',
      resource_id: agentId,
      organization_id: orgId,
      metadata: { changes },
    });
  },

  /**
   * Log agent deletion
   */
  async agentDeleted(userId: string, agentId: string, orgId: string): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'agent.deleted',
      resource_type: 'agent',
      resource_id: agentId,
      organization_id: orgId,
    });
  },

  /**
   * Log kill switch activation (critical event)
   */
  async killSwitchActivated(
    userId: string, 
    agentId: string, 
    orgId: string, 
    level: number, 
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'agent.kill_switch',
      resource_type: 'agent',
      resource_id: agentId,
      organization_id: orgId,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata: { level, reason },
    });
  },

  /**
   * Log incident resolution
   */
  async incidentResolved(userId: string, incidentId: string, orgId: string, resolution?: string): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'incident.resolved',
      resource_type: 'incident',
      resource_id: incidentId,
      organization_id: orgId,
      metadata: { resolution },
    });
  },

  /**
   * Log authentication events
   */
  async authEvent(action: 'login' | 'logout' | 'failed_login', userId: string, ipAddress?: string): Promise<void> {
    await this.log({
      user_id: userId,
      action: `auth.${action}`,
      ip_address: ipAddress,
    });
  },
};
