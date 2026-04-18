import { logger } from './logger';
import { eq, supabaseRestAsService } from './supabase-rest';

type SynthesizedRuleDecisionStatus = 'accepted' | 'dismissed';

type SynthesizedRuleRecord = {
  id: string;
  organization_id: string;
  service: string;
  action: string;
  trigger_count: number;
  proposed_policy?: Record<string, any> | null;
};

export async function applySynthesizedRuleDecision(
  orgId: string,
  rule: SynthesizedRuleRecord,
  status: SynthesizedRuleDecisionStatus,
): Promise<void> {
  const patchQ = new URLSearchParams();
  patchQ.set('id', eq(rule.id));
  patchQ.set('organization_id', eq(orgId));

  await supabaseRestAsService('synthesized_rules', patchQ, {
    method: 'PATCH',
    body: { status, updated_at: new Date().toISOString() },
  });

  if (status !== 'accepted' || !rule.proposed_policy) return;

  const policy = rule.proposed_policy as Record<string, any>;
  try {
    await supabaseRestAsService('action_policies', '', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        organization_id: orgId,
        service: rule.service,
        action: rule.action,
        enabled: true,
        require_approval: policy.require_approval ?? true,
        required_role: policy.required_role ?? 'admin',
        notes: policy.notes ?? `Auto-created from synthesized rule after ${rule.trigger_count} denials.`,
        updated_at: new Date().toISOString(),
      },
    });
    logger.info('[rules] Action policy auto-created from synthesized rule', { orgId, service: rule.service, action: rule.action });
  } catch (err: any) {
    logger.warn('[rules] Failed to auto-create action policy from synthesized rule', { id: rule.id, error: err?.message });
  }
}