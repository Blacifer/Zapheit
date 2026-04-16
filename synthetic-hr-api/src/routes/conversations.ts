import express, { Request, Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq, in_ } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { errorResponse, getOrgId, getUserJwt } from '../lib/route-helpers';
import { parseCursorParams, buildCursorResponse, buildCursorFilter } from '../lib/pagination';
import {
  buildApprovalSummaryFromJobApproval,
  buildGovernedExecutionSummary,
  inferWorkflowEntrySource,
} from '../lib/governed-workflow';

const router = express.Router();
const getUserId = (req: Request): string | null => req.user?.id || null;

const composeChatSchema = z.object({
  agent_id: z.string().min(1),
  prompt: z.string().min(1),
  conversation_id: z.string().uuid().optional(),
  mode: z.enum(['operator', 'employee', 'external']).optional().default('operator'),
  template_id: z.string().min(1).optional(),
  template_context: z.object({
    name: z.string().optional(),
    businessPurpose: z.string().optional(),
    riskLevel: z.string().optional(),
    approvalDefault: z.string().optional(),
    requiredSystems: z.array(z.string()).optional(),
  }).optional(),
  app_target: z.object({
    service: z.string().optional(),
    label: z.string().optional(),
  }).optional(),
});

function nowIso() {
  return new Date().toISOString();
}

function summarizePrompt(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 'Conversation';
  return trimmed.replace(/\s+/g, ' ').slice(0, 80);
}

function buildJobView(job: any, approval: any = null) {
  const approvalSummary = approval ? buildApprovalSummaryFromJobApproval(approval, job) : null;
  const governedExecution = buildGovernedExecutionSummary({ job, approval, approvalSummary });
  return {
    ...job,
    approval,
    approval_summary: approvalSummary,
    governed_execution: governedExecution,
    source: governedExecution.source,
    source_ref: governedExecution.source_ref,
    governance_status: governedExecution.status,
    cost_status: governedExecution.cost_status,
    audit_ref: governedExecution.audit_ref,
    incident_ref: governedExecution.incident_ref,
  };
}

// Get conversations list
router.get('/conversations', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, status } = req.query;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching conversations', { org_id: orgId, agent_id, status });

    const { limit, cursorId, cursorCreatedAt } = parseCursorParams(req);
    const cursorFilter = buildCursorFilter(cursorId, cursorCreatedAt);

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc,id.desc');
    query.set('limit', String(limit + 1));
    if (cursorFilter) query.set('or', cursorFilter);
    if (agent_id) query.set('agent_id', eq(String(agent_id)));
    if (status) query.set('status', eq(String(status)));

    const rows = await supabaseRestAsUser(
      getUserJwt(req),
      'conversations',
      query,
      { headers: { 'Prefer': 'return=representation' } }
    ) as any[];
    const paged = buildCursorResponse(rows || [], limit);

    logger.info('Conversations fetched successfully', { count: paged.data?.length, org_id: orgId });

    res.json({ success: true, data: paged.data, count: paged.data?.length || 0, next_cursor: paged.next_cursor, has_more: paged.has_more });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

router.post('/conversations/chat', requirePermission('agents.update'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const jwt = getUserJwt(req);
    const userId = getUserId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);
    if (!userId) return errorResponse(res, new Error('Authentication required'), 401);

    const parsed = composeChatSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((error) => error.message),
      });
    }

    const data = parsed.data;
    const agentQuery = new URLSearchParams();
    agentQuery.set('id', eq(data.agent_id));
    agentQuery.set('organization_id', eq(orgId));
    agentQuery.set('select', 'id,name,system_prompt,model_name,status');
    agentQuery.set('limit', '1');
    const agentRows = (await supabaseRestAsUser(jwt, 'ai_agents', agentQuery)) as any[];
    const agent = agentRows?.[0];
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    if (String(agent.status || '').toLowerCase() === 'terminated') {
      return res.status(409).json({ success: false, error: 'Agent is terminated' });
    }

    const deploymentQuery = new URLSearchParams();
    deploymentQuery.set('organization_id', eq(orgId));
    deploymentQuery.set('agent_id', eq(data.agent_id));
    deploymentQuery.set('status', eq('active'));
    deploymentQuery.set('select', '*');
    deploymentQuery.set('limit', '1');
    const deploymentRows = (await supabaseRestAsUser(jwt, 'agent_deployments', deploymentQuery)) as any[];
    const deployment = deploymentRows?.[0];
    if (!deployment) {
      return res.status(409).json({ success: false, error: 'Agent is not deployed to an active runtime' });
    }

    const now = nowIso();

    let conversation: any | null = null;
    if (data.conversation_id) {
      const conversationQuery = new URLSearchParams();
      conversationQuery.set('id', eq(data.conversation_id));
      conversationQuery.set('organization_id', eq(orgId));
      conversationQuery.set('select', '*');
      conversationQuery.set('limit', '1');
      const existingConversation = (await supabaseRestAsUser(jwt, 'conversations', conversationQuery)) as any[];
      conversation = existingConversation?.[0] || null;
    }

    if (!conversation) {
      const createdConversations = (await supabaseRestAsUser(jwt, 'conversations', '', {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: data.agent_id,
          platform: 'internal',
          status: 'active',
          started_at: now,
          created_at: now,
          metadata: {
            topic: summarizePrompt(data.prompt),
            preview: data.prompt.slice(0, 200),
            last_user_message: data.prompt.slice(0, 200),
            user_label: req.user?.email || 'Operator',
            mode: data.mode,
            template_id: data.template_id || null,
            template_name: data.template_context?.name || null,
            app_target: data.app_target || null,
          },
        },
        headers: { Prefer: 'return=representation' },
      })) as any[];
      conversation = createdConversations?.[0] || null;
    } else {
      const patchConversationQuery = new URLSearchParams();
      patchConversationQuery.set('id', eq(conversation.id));
      patchConversationQuery.set('organization_id', eq(orgId));
      const updatedConversations = (await supabaseRestAsUser(jwt, 'conversations', patchConversationQuery, {
        method: 'PATCH',
        body: {
          status: 'active',
          metadata: {
            ...(conversation.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {}),
            preview: data.prompt.slice(0, 200),
            last_user_message: data.prompt.slice(0, 200),
            mode: data.mode,
            template_id: data.template_id || null,
            template_name: data.template_context?.name || null,
            app_target: data.app_target || null,
          },
        },
        headers: { Prefer: 'return=representation' },
      })) as any[];
      conversation = updatedConversations?.[0] || conversation;
    }

    if (!conversation?.id) {
      return res.status(500).json({ success: false, error: 'Failed to create conversation' });
    }

    const createdMessages = (await supabaseRestAsUser(jwt, 'messages', '', {
      method: 'POST',
      body: {
        conversation_id: conversation.id,
        role: 'user',
        content: data.prompt,
        token_count: 0,
        created_at: now,
      },
      headers: { Prefer: 'return=representation' },
    })) as any[];
    const userMessage = createdMessages?.[0] || null;

    const messageHistoryQuery = new URLSearchParams();
    messageHistoryQuery.set('conversation_id', eq(conversation.id));
    messageHistoryQuery.set('order', 'created_at.asc');
    messageHistoryQuery.set('select', 'role,content');
    const messageHistory = (await supabaseRestAsUser(jwt, 'messages', messageHistoryQuery)) as any[];

    const systemSections = [
      String(agent.system_prompt || '').trim(),
      data.template_context?.name ? `Template: ${data.template_context.name}` : '',
      data.template_context?.businessPurpose ? `Business purpose: ${data.template_context.businessPurpose}` : '',
      data.template_context?.riskLevel ? `Risk level: ${data.template_context.riskLevel}` : '',
      data.template_context?.approvalDefault ? `Approval default: ${data.template_context.approvalDefault}` : '',
      Array.isArray(data.template_context?.requiredSystems) && data.template_context.requiredSystems.length > 0
        ? `Required systems: ${data.template_context.requiredSystems.join(', ')}`
        : '',
      data.app_target?.label || data.app_target?.service
        ? `Preferred app context: ${data.app_target.label || data.app_target.service}`
        : '',
      `Chat mode: ${data.mode}`,
    ].filter((value) => value && value.length > 0);

    const historyMessages = (messageHistory || []).map((message: any) => ({
      role: String(message.role || 'user'),
      content: String(message.content || ''),
    }));

    const workflowSource = data.template_id ? 'template' : 'chat';
    const workflowMeta = {
      source: workflowSource,
      source_ref: conversation.id,
    };

    const jobType = data.template_id ? 'workflow_run' : 'chat_turn';
    const jobInput = data.template_id
      ? {
          workflow: {
            source: workflowMeta.source,
            source_ref: workflowMeta.source_ref,
            steps: [{
              id: 'template-chat',
              kind: 'llm',
              model: agent.model_name || 'openai/gpt-4o-mini',
              temperature: 0.3,
              messages: [
                { role: 'system', content: systemSections.join('\n\n') },
                ...historyMessages,
              ],
            }],
            final_step: 'template-chat',
          },
          fields: {
            prompt: data.prompt,
          },
          conversation_id: conversation.id,
          mode: data.mode,
          template_id: data.template_id,
          app_target: data.app_target || null,
        }
      : {
          workflow: workflowMeta,
          messages: [
            { role: 'system', content: systemSections.join('\n\n') || 'You are a helpful assistant.' },
            ...historyMessages,
          ],
          model: agent.model_name || 'openai/gpt-4o-mini',
          temperature: 0.3,
          conversation_id: conversation.id,
          mode: data.mode,
          template_id: data.template_id || null,
          app_target: data.app_target || null,
        };

    const createdJobs = (await supabaseRestAsUser(jwt, 'agent_jobs', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        agent_id: data.agent_id,
        runtime_instance_id: deployment.runtime_instance_id,
        type: jobType,
        status: 'queued',
        input: jobInput,
        output: {},
        created_by: userId,
        created_at: now,
      },
      headers: { Prefer: 'return=representation' },
    })) as any[];
    const job = createdJobs?.[0];
    if (!job?.id) {
      return res.status(500).json({ success: false, error: 'Failed to create chat job' });
    }

    const createdApprovals = (await supabaseRestAsUser(jwt, 'agent_job_approvals', '', {
      method: 'POST',
      body: {
        job_id: job.id,
        requested_by: userId,
        approved_by: userId,
        status: 'approved',
        policy_snapshot: {
          workflow: workflowMeta,
          chat_mode: data.mode,
          template_id: data.template_id || null,
          template_name: data.template_context?.name || null,
          app_target: data.app_target || null,
        },
        created_at: now,
        decided_at: now,
      },
      headers: { Prefer: 'return=representation' },
    })) as any[];
    const approval = createdApprovals?.[0] || null;

    const updatedConversationQuery = new URLSearchParams();
    updatedConversationQuery.set('id', eq(conversation.id));
    updatedConversationQuery.set('organization_id', eq(orgId));
    const updatedConversations = (await supabaseRestAsUser(jwt, 'conversations', updatedConversationQuery, {
      method: 'PATCH',
      body: {
        metadata: {
          ...(conversation.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {}),
          latest_job_id: job.id,
          mode: data.mode,
          template_id: data.template_id || null,
          template_name: data.template_context?.name || null,
          app_target: data.app_target || null,
        },
      },
      headers: { Prefer: 'return=representation' },
    })) as any[];
    conversation = updatedConversations?.[0] || conversation;

    const messagesQuery = new URLSearchParams();
    messagesQuery.set('conversation_id', eq(conversation.id));
    messagesQuery.set('order', 'created_at.asc');
    const messages = (await supabaseRestAsUser(jwt, 'messages', messagesQuery)) as any[];

    return res.status(201).json({
      success: true,
      data: {
        conversation: { ...conversation, messages: messages || [] },
        message: userMessage,
        job: buildJobView(job, approval),
        approval,
        session: {
          session_id: conversation.id,
          mode: data.mode,
          agent_id: data.agent_id,
          template_id: data.template_id || null,
          source: inferWorkflowEntrySource({ job: { type: jobType, input: jobInput } as any }),
          source_ref: conversation.id,
          governed_execution: buildJobView(job, approval).governed_execution,
          approval_summary: buildJobView(job, approval).approval_summary || null,
          audit_ref: buildJobView(job, approval).audit_ref || null,
          cost_status: buildJobView(job, approval).cost_status || null,
          incident_ref: buildJobView(job, approval).incident_ref || null,
        },
      },
    });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// CSAT aggregate summary for the org
router.get('/conversations/csat-summary', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('rating', 'not.is.null');
    query.set('select', 'rating');

    const data: Array<{ rating: number }> = await supabaseRestAsUser(getUserJwt(req), 'conversations', query) || [];

    const thumbs_up = data.filter((r) => r.rating === 1).length;
    const thumbs_down = data.filter((r) => r.rating === -1).length;
    const total_rated = thumbs_up + thumbs_down;
    const satisfaction_pct = total_rated > 0 ? Math.round((thumbs_up / total_rated) * 100) : null;

    res.json({ success: true, data: { total_rated, thumbs_up, thumbs_down, satisfaction_pct } });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Get single conversation with messages
router.get('/conversations/:id', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching conversation', { conversation_id: id, org_id: orgId });

    const conversationQuery = new URLSearchParams();
    conversationQuery.set('id', eq(id));
    conversationQuery.set('organization_id', eq(orgId));

    const conversationData = await supabaseRestAsUser(getUserJwt(req), 'conversations', conversationQuery);

    if (!conversationData?.length) {
      return errorResponse(res, new Error('Conversation not found'), 404);
    }

    const conversation = conversationData[0];

    const messagesQuery = new URLSearchParams();
    messagesQuery.set('conversation_id', eq(id));
    messagesQuery.set('order', 'created_at.asc');

    const messagesData = await supabaseRestAsUser(getUserJwt(req), 'messages', messagesQuery);

    logger.info('Conversation fetched successfully', { conversation_id: id, message_count: messagesData?.length });

    res.json({ success: true, data: { ...conversation, messages: messagesData || [] } });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Get reasoning traces for a conversation
router.get('/conversations/:id/trace', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    // Verify the conversation belongs to this org
    const convQuery = new URLSearchParams();
    convQuery.set('id', eq(id));
    convQuery.set('organization_id', eq(orgId));
    convQuery.set('select', 'id');
    const convData = await supabaseRestAsUser(getUserJwt(req), 'conversations', convQuery);
    if (!convData?.length) {
      return errorResponse(res, new Error('Conversation not found'), 404);
    }

    const traceQuery = new URLSearchParams();
    traceQuery.set('conversation_id', eq(id));
    traceQuery.set('organization_id', eq(orgId));
    traceQuery.set('order', 'created_at.asc');

    const traces = await supabaseRestAsUser(getUserJwt(req), 'gateway_reasoning_traces', traceQuery);

    res.json({ success: true, data: traces || [] });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Rate a conversation (thumbs up / thumbs down)
router.post('/conversations/:id/rate', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const jwt = getUserJwt(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    const { id } = req.params;
    const { rating, feedback_text } = req.body as { rating: 1 | -1; feedback_text?: string };

    if (rating !== 1 && rating !== -1) {
      return res.status(400).json({ success: false, error: 'rating must be 1 or -1' });
    }

    // Verify conversation belongs to this org
    const checkQ = new URLSearchParams();
    checkQ.set('id', eq(id));
    checkQ.set('organization_id', eq(orgId));
    checkQ.set('select', 'id');
    const existing = await supabaseRestAsUser(jwt, 'conversations', checkQ);
    if (!existing?.length) return res.status(404).json({ success: false, error: 'Conversation not found' });

    // PATCH rating + feedback_text
    const patchQ = new URLSearchParams();
    patchQ.set('id', eq(id));
    const updated = await supabaseRestAsUser(jwt, 'conversations', patchQ, {
      method: 'PATCH',
      body: { rating, feedback_text: feedback_text || null },
      headers: { 'Prefer': 'return=representation' },
    });

    res.json({ success: true, data: updated?.[0] });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

// Trending topics: top keywords from last 500 user messages for the org
router.get('/analytics/trending-topics', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const jwt = getUserJwt(req);
    if (!orgId) return errorResponse(res, new Error('Organization not found'), 400);

    // Step 1: get conversation IDs for this org
    const convQ = new URLSearchParams();
    convQ.set('organization_id', eq(orgId));
    convQ.set('select', 'id');
    convQ.set('limit', '500');
    const convRows: Array<{ id: string }> = await supabaseRestAsUser(jwt, 'conversations', convQ) || [];
    const convIds = convRows.map((c) => c.id);

    if (convIds.length === 0) {
      return res.json({ success: true, data: { topics: [] } });
    }

    // Step 2: fetch last 500 user messages from those conversations
    const msgQ = new URLSearchParams();
    msgQ.set('conversation_id', in_(convIds.slice(0, 200))); // cap to avoid URL length limits
    msgQ.set('role', eq('user'));
    msgQ.set('select', 'content');
    msgQ.set('order', 'created_at.desc');
    msgQ.set('limit', '500');
    const messages: Array<{ content: string }> = await supabaseRestAsUser(jwt, 'messages', msgQ) || [];

    // Step 3: tokenize and count word frequency
    const STOP_WORDS = new Set([
      'the','a','an','i','is','it','my','to','and','of','in','for','can','you','me','do',
      'we','he','she','they','this','that','with','on','at','by','from','or','not','but',
      'are','was','were','be','been','have','has','had','will','would','could','should',
      'what','how','when','where','who','why','which','there','their','your','our','its',
      'if','so','as','up','out','about','into','than','then','more','some','any','all',
      'just','also','no','yes','ok','hi','hello','thanks','please','help','need','want',
      'get','got','know','think','like','use','make','much','many','need','can','i\'m',
      'i\'ve','i\'ll','i\'d','don\'t','didn\'t','can\'t','won\'t','isn\'t','aren\'t',
    ]);

    const freq: Record<string, number> = {};
    for (const msg of messages) {
      const words = (msg.content || '')
        .toLowerCase()
        .replace(/[^a-z0-9'\s-]/g, ' ')
        .split(/\s+/);
      for (const word of words) {
        const clean = word.replace(/^'+|'+$/g, '');
        if (clean.length < 3) continue;
        if (STOP_WORDS.has(clean)) continue;
        freq[clean] = (freq[clean] || 0) + 1;
      }
    }

    const topics = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));

    res.json({ success: true, data: { topics } });
  } catch (error: any) {
    errorResponse(res, error);
  }
});

export default router;
