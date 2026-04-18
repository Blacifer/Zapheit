import crypto from 'crypto';
import { eq, supabaseRestAsService } from './supabase-rest';
import { logger } from './logger';

type AuditChainPayload = {
  organization_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload?: Record<string, any>;
};

export async function appendAuditChainEvent(input: AuditChainPayload): Promise<void> {
  try {
    const q = new URLSearchParams();
    q.set('organization_id', eq(input.organization_id));
    q.set('select', 'entry_hash');
    q.set('order', 'created_at.desc');
    q.set('limit', '1');
    const rows = (await supabaseRestAsService('audit_event_chain', q)) as Array<{ entry_hash?: string | null }>;
    const prevHash = rows?.[0]?.entry_hash || null;
    const body = JSON.stringify({
      organization_id: input.organization_id,
      event_type: input.event_type,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      payload: input.payload || {},
      prev_hash: prevHash,
    });
    const entryHash = crypto.createHash('sha256').update(body).digest('hex');

    await supabaseRestAsService('audit_event_chain', '', {
      method: 'POST',
      body: {
        organization_id: input.organization_id,
        event_type: input.event_type,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        payload: input.payload || {},
        prev_hash: prevHash,
        entry_hash: entryHash,
      },
    });
  } catch (err: any) {
    logger.warn('Failed to append audit chain event', { error: err?.message, event_type: input.event_type });
  }
}

export async function verifyAuditChain(organizationId: string, limit = 500): Promise<{
  ok: boolean;
  verified: number;
  broken_at_id: string | null;
  reason: string | null;
}> {
  const q = new URLSearchParams();
  q.set('organization_id', eq(organizationId));
  q.set('select', 'id,event_type,entity_type,entity_id,payload,prev_hash,entry_hash,created_at');
  q.set('order', 'created_at.asc');
  q.set('limit', String(Math.max(1, Math.min(2000, limit))));
  const rows = (await supabaseRestAsService('audit_event_chain', q)) as Array<Record<string, any>>;

  let expectedPrev: string | null = null;
  for (const row of rows || []) {
    if ((row.prev_hash || null) !== expectedPrev) {
      return {
        ok: false,
        verified: 0,
        broken_at_id: row.id || null,
        reason: 'prev_hash link mismatch',
      };
    }
    const body = JSON.stringify({
      organization_id: organizationId,
      event_type: row.event_type,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      payload: row.payload || {},
      prev_hash: row.prev_hash || null,
    });
    const recalculated = crypto.createHash('sha256').update(body).digest('hex');
    if (recalculated !== row.entry_hash) {
      return {
        ok: false,
        verified: 0,
        broken_at_id: row.id || null,
        reason: 'entry_hash mismatch',
      };
    }
    expectedPrev = row.entry_hash;
  }

  return {
    ok: true,
    verified: rows?.length || 0,
    broken_at_id: null,
    reason: null,
  };
}
