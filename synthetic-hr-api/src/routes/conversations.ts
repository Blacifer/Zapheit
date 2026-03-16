import express, { Request, Response } from 'express';
import { requirePermission } from '../middleware/rbac';
import { supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { logger } from '../lib/logger';
import { errorResponse, getOrgId, getUserJwt, safeLimit } from '../lib/route-helpers';

const router = express.Router();

// Get conversations list
router.get('/conversations', requirePermission('dashboard.read'), async (req: Request, res: Response) => {
  try {
    const { agent_id, status, limit = 50 } = req.query;
    const orgId = getOrgId(req);
    if (!orgId) {
      return errorResponse(res, new Error('Organization not found'), 400);
    }

    logger.info('Fetching conversations', { org_id: orgId, agent_id, status });

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    query.set('order', 'created_at.desc');
    query.set('limit', String(safeLimit(limit)));
    if (agent_id) query.set('agent_id', eq(String(agent_id)));
    if (status) query.set('status', eq(String(status)));

    const data = await supabaseRestAsUser(
      getUserJwt(req),
      'conversations',
      query,
      { headers: { 'Prefer': 'return=representation' } }
    );

    logger.info('Conversations fetched successfully', { count: data?.length, org_id: orgId });

    res.json({ success: true, data, count: data?.length || 0 });
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

export default router;
