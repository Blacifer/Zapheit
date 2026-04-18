// ---------------------------------------------------------------------------
// Correction Memory — Seniority Engine
//
// Stores human approval/denial decisions as learnable memories with embeddings,
// fetches contextually relevant past corrections to inject into agent prompts,
// and synthesizes new action policy proposals when the same mistake recurs 3+
// times.
// ---------------------------------------------------------------------------

import { embedText, cosineSimilarity } from './embeddings';
import { supabaseRest, eq } from './supabase-rest';
import { fireAndForgetWebhookEvent } from './webhook-relay';
import { logger } from './logger';

const CORRECTION_FETCH_LIMIT = 200; // max corrections to load for similarity search
const RULE_SYNTHESIS_THRESHOLD = 3; // denials before a rule is proposed

// ---------------------------------------------------------------------------
// Store a correction
// ---------------------------------------------------------------------------

export async function storeCorrection(
  orgId: string,
  agentId: string | null | undefined,
  approval: {
    id?: string;
    service: string;
    action: string;
    action_payload?: Record<string, any>;
  },
  decision: 'approved' | 'denied',
  reviewerNote: string | null | undefined,
): Promise<void> {
  const { service, action, action_payload } = approval;

  // Build a human-readable summary to embed
  const payloadSnippet = action_payload
    ? JSON.stringify(action_payload).slice(0, 300)
    : '';
  const noteSnippet = reviewerNote ? ` Note: ${reviewerNote}` : '';
  const contextSummary = `${decision}: ${service}.${action}. Payload: ${payloadSnippet}.${noteSnippet}`.trim();

  let embedding: number[] | null = null;
  try {
    embedding = await embedText(contextSummary);
  } catch (err: any) {
    logger.warn('[correction-memory] Embedding failed, storing without vector', { error: err?.message });
  }

  try {
    await supabaseRest('agent_corrections', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        ...(agentId ? { agent_id: agentId } : {}),
        ...(approval.id ? { approval_id: approval.id } : {}),
        service,
        action,
        decision,
        context_summary: contextSummary,
        reviewer_note: reviewerNote ?? null,
        embedding: embedding ? JSON.stringify(embedding) : null,
      },
    });
  } catch (err: any) {
    logger.warn('[correction-memory] Failed to store correction', { orgId, service, action, error: err?.message });
    return;
  }

  // After each denied correction, check if a rule should be synthesized
  if (decision === 'denied') {
    void checkRuleSynthesis(orgId, service, action);
  }
}

// ---------------------------------------------------------------------------
// Fetch relevant past corrections for system prompt injection
// ---------------------------------------------------------------------------

export async function fetchRelevantCorrections(
  orgId: string,
  agentId: string | null | undefined,
  contextText: string,
  topK = 5,
): Promise<string[]> {
  try {
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('order', 'created_at.desc');
    q.set('limit', String(CORRECTION_FETCH_LIMIT));
    q.set('select', 'service,action,decision,context_summary,reviewer_note,embedding,created_at');
    // Prefer corrections for this specific agent, but fall back to org-wide
    if (agentId) q.set('agent_id', `eq.${agentId}`);

    const rows = (await supabaseRest('agent_corrections', q)) as any[];
    if (!rows?.length) return [];

    // Embed the current context
    const queryEmbedding = await embedText(contextText);

    // Score each correction by cosine similarity
    const scored = rows
      .map((row) => {
        let sim = 0;
        if (row.embedding) {
          try {
            const vec = typeof row.embedding === 'string'
              ? JSON.parse(row.embedding)
              : row.embedding;
            sim = cosineSimilarity(queryEmbedding, vec);
          } catch { /* ignore malformed */ }
        }
        return { row, sim };
      })
      .sort((a, b) => b.sim - a.sim)
      .slice(0, topK);

    return scored.map(({ row }) => {
      const when = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const note = row.reviewer_note ? ` Reviewer note: "${row.reviewer_note}"` : '';
      return `[${row.decision.toUpperCase()}] ${row.service}.${row.action}: ${row.context_summary.slice(0, 200)}${note} (${when})`;
    });
  } catch (err: any) {
    logger.warn('[correction-memory] fetchRelevantCorrections failed', { orgId, error: err?.message });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rule synthesis: propose an action policy after 3+ repeated denials
// ---------------------------------------------------------------------------

export async function checkRuleSynthesis(
  orgId: string,
  service: string,
  action: string,
): Promise<void> {
  try {
    // Count denied corrections for this (org, service, action)
    const q = new URLSearchParams();
    q.set('organization_id', eq(orgId));
    q.set('service', eq(service));
    q.set('action', eq(action));
    q.set('decision', eq('denied'));
    q.set('select', 'id');
    const rows = (await supabaseRest('agent_corrections', q)) as any[];
    const denialCount = rows?.length ?? 0;

    if (denialCount < RULE_SYNTHESIS_THRESHOLD) return;

    // Check if a synthesized_rules row already exists for this (org, service, action)
    const existQ = new URLSearchParams();
    existQ.set('organization_id', eq(orgId));
    existQ.set('service', eq(service));
    existQ.set('action', eq(action));
    existQ.set('limit', '1');
    const existing = (await supabaseRest('synthesized_rules', existQ)) as any[];
    if (existing?.length > 0) return; // already proposed

    // Insert a proposed rule
    const proposedPolicy = {
      service,
      action,
      enabled: true,
      require_approval: true,
      required_role: 'admin',
      notes: `Auto-proposed after ${denialCount} repeated denials by human reviewers.`,
    };

    await supabaseRest('synthesized_rules', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        service,
        action,
        trigger_count: denialCount,
        proposed_policy: proposedPolicy,
        status: 'proposed',
      },
    });

    // Fire webhook so admins are notified (Slack/Teams)
    fireAndForgetWebhookEvent(orgId, 'rule_synthesis.proposed', {
      id: `evt_rule_synthesis_${orgId}_${service}_${action}`,
      type: 'rule_synthesis.proposed',
      created_at: new Date().toISOString(),
      organization_id: orgId,
      data: { service, action, denial_count: denialCount, proposed_policy: proposedPolicy },
    });

    logger.info('[correction-memory] Synthesized rule proposed', { orgId, service, action, denialCount });
  } catch (err: any) {
    logger.warn('[correction-memory] checkRuleSynthesis failed', { orgId, service, action, error: err?.message });
  }
}
