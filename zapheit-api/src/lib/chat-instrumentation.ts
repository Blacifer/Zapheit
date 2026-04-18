import { recordCost } from '../services/billing-service';
import { incidentDetection } from '../services/incident-detection';
import { supabaseRest } from './supabase-rest';
import { logger } from './logger';

export interface ChatInstrumentationParams {
  orgId: string;
  conversationId: string;
  agentId: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  latencyMs: number;
  messages: Array<{ role: string; content: string }>;
  assistantContent: string;
  requestId: string;
}

export async function fireChatInstrumentation(params: ChatInstrumentationParams): Promise<void> {
  await fireCostRecord(params);
  void fireIncidentDetection(params);
  void fireReasoningTrace(params);
}

// recordCost is billing data — must not be silently dropped.
// Errors are caught and logged with enough context to replay the row manually.
async function fireCostRecord(params: ChatInstrumentationParams): Promise<void> {
  try {
    await recordCost({
      organizationId: params.orgId,
      agentId: params.agentId,
      modelId: params.model,
      modelProvider: params.provider,
      billedModel: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      costUSD: params.costUSD,
      latencyMs: params.latencyMs,
      apiKeyId: 'managed',
      requestId: params.requestId,
      endpoint: '/chat/sessions/messages',
    });
  } catch (err: any) {
    logger.error('chat_instrumentation: cost record failed — requires manual replay', {
      orgId: params.orgId,
      conversationId: params.conversationId,
      costUSD: params.costUSD,
      model: params.model,
      requestId: params.requestId,
      error: String(err?.message || err),
    });
  }
}

async function fireIncidentDetection(params: ChatInstrumentationParams): Promise<void> {
  try {
    const scanResults = incidentDetection.fullScan(params.assistantContent || '');
    const userMsg = params.messages.filter(m => m.role === 'user').at(-1)?.content || '';
    const userScan = [incidentDetection.detectDataExtractionAttempt(userMsg)].filter(r => r.detected);
    const allResults = [...scanResults, ...userScan];
    const highest = incidentDetection.getHighestSeverity(allResults);
    if (!highest || (highest.severity !== 'critical' && highest.severity !== 'high')) return;

    const title = `${String(highest.type || 'incident').replace(/_/g, ' ').toUpperCase()} Detected`;
    await supabaseRest('incidents', '', {
      method: 'POST',
      body: {
        organization_id: params.orgId,
        agent_id: params.agentId ?? null,
        incident_type: highest.type,
        severity: highest.severity,
        title,
        description: highest.details,
        trigger_content: userMsg || undefined,
        ai_response: params.assistantContent,
        status: 'open',
        confidence: highest.confidence,
      },
    });
    logger.warn('chat: incident created', {
      orgId: params.orgId,
      conversationId: params.conversationId,
      incident_type: highest.type,
      severity: highest.severity,
    });
  } catch (err: any) {
    logger.error('chat_instrumentation: incident detection failed (non-fatal)', {
      error: String(err?.message || err),
      orgId: params.orgId,
    });
  }
}

async function fireReasoningTrace(params: ChatInstrumentationParams): Promise<void> {
  try {
    const scanResults = incidentDetection.fullScan(params.assistantContent || '');
    const highest = incidentDetection.getHighestSeverity(scanResults);
    await supabaseRest('gateway_reasoning_traces', '', {
      method: 'POST',
      body: {
        organization_id: params.orgId,
        agent_id: params.agentId ?? null,
        conversation_id: params.conversationId,
        request_id: params.requestId ?? null,
        model: params.model,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        latency_ms: params.latencyMs,
        tool_calls: [],
        interceptors_applied: ['standard_chat'],
        risk_score: highest ? highest.confidence : null,
        response_entropy: null,
        policy_violations: [],
      },
    });
  } catch (err: any) {
    logger.debug('chat_instrumentation: reasoning trace failed (non-fatal)', { err: err?.message });
  }
}
