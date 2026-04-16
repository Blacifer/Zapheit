import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { supabaseRestAsService, supabaseRestAsUser, eq } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';
import { logger } from '../lib/logger';
import { auditLog } from '../lib/audit-logger';
import { sendTransactionalEmail } from '../lib/email';

const router = express.Router();

// Schemas
const createInviteSchema = z.object({
  email: z.string().email('Valid email required'),
  role: z.enum(['admin', 'manager', 'viewer']),
  message: z.string().optional(),
});

const respondToInviteSchema = z.object({
  token: z.string().min(32),
});

// Helper: Get organization from authenticated user
const getOrgId = (req: Request): string | null => {
  return req.user?.organization_id || null;
};

const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

// Helper: Generate secure invite token
const generateInviteToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const buildInviteLink = (token: string): string => {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    throw new Error('FRONTEND_URL is required to generate invite links');
  }

  const safeBase = frontendUrl.endsWith('/') ? frontendUrl.slice(0, -1) : frontendUrl;
  return `${safeBase}/accept-invite?token=${encodeURIComponent(token)}`;
};

const sendInviteEmail = async (to: string, inviteLink: string, role: string, message?: string) => {
  const subject = 'You are invited to Zapheit';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin-bottom: 8px;">You have been invited to Zapheit</h2>
      <p style="margin: 0 0 12px 0;">Role: <strong>${role}</strong></p>
      ${message ? `<p style="margin: 0 0 12px 0;">Message: ${message}</p>` : ''}
      <p style="margin: 0 0 16px 0;">This invite expires in 7 days.</p>
      <a href="${inviteLink}" style="display:inline-block;padding:10px 14px;background:#0891b2;color:#fff;text-decoration:none;border-radius:6px;">
        Accept Invitation
      </a>
      <p style="margin-top: 16px; color: #6b7280; font-size: 12px;">If the button does not work, copy this link: ${inviteLink}</p>
    </div>
  `;

  await sendTransactionalEmail({
    to,
    subject,
    html,
    text: `You have been invited to Zapheit as ${role}. Accept: ${inviteLink}`,
  });
};

/**
 * POST /api/invites
 * Create and send a team invitation
 */
router.post('/invites', requirePermission('team.invite'), async (req: Request, res: Response) => {
  try {
    const result = createInviteSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { email, role, message } = result.data;

    // Check if user already exists in this organization
    const existingUserQuery = new URLSearchParams();
    existingUserQuery.set('email', eq(email));
    existingUserQuery.set('organization_id', eq(orgId));
    const existingUsers = (await supabaseRestAsUser(getUserJwt(req), 'users', existingUserQuery)) as any[];

    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User already exists in this organization',
      });
    }

    // Check if there's already a pending invite
    const existingInviteQuery = new URLSearchParams();
    existingInviteQuery.set('email', eq(email));
    existingInviteQuery.set('organization_id', eq(orgId));
    existingInviteQuery.set('status', eq('pending'));
    const existingInvites = (await supabaseRestAsUser(getUserJwt(req), 'invites', existingInviteQuery)) as any[];

    if (existingInvites && existingInvites.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Invitation already sent to this email',
      });
    }

    // Generate secure token
    const token = generateInviteToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    // Create invite record
    const inviteData = {
      organization_id: orgId,
      email,
      role,
      token,
      status: 'pending',
      invited_by: req.user?.id || null,
      message: message || null,
      expires_at: expiresAt.toISOString(),
    };

    const invites = (await supabaseRestAsUser(getUserJwt(req), 'invites', '', {
      method: 'POST',
      body: inviteData,
    })) as any[];

    if (!invites || invites.length === 0) {
      throw new Error('Failed to create invitation');
    }

    // Send invitation email. If it fails, rollback invite record to avoid unsent pending invites.
    try {
      const inviteLink = buildInviteLink(token);
      await sendInviteEmail(email, inviteLink, role, message);
    } catch (emailError: any) {
      await supabaseRestAsUser(getUserJwt(req), 'invites', `id=${eq(invites[0].id)}`, {
        method: 'DELETE',
      }).catch(() => {
        logger.warn('Failed to rollback invite after email failure', { invite_id: invites[0].id });
      });

      throw new Error(`Invitation email delivery failed: ${emailError.message}`);
    }

    // Audit log
    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'invite.created',
      resource_type: 'invite',
      resource_id: invites[0].id,
      organization_id: orgId,
      metadata: { email, role },
    });

    logger.info('Team invitation created', {
      invite_id: invites[0].id,
      org_id: orgId,
      email,
      role,
    });

    res.status(201).json({
      success: true,
      data: {
        ...invites[0],
        token: undefined, // Don't expose token in response
      },
      message: 'Invitation sent successfully',
    });
  } catch (error: any) {
    logger.error('Invite creation failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/invites
 * List all invitations for the organization
 */
router.get('/invites', requirePermission('team.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const { status } = req.query;

    const query = new URLSearchParams();
    query.set('organization_id', eq(orgId));
    if (status) {
      query.set('status', eq(status as string));
    }
    query.set('order', 'created_at.desc');

    const invites = (await supabaseRestAsUser(getUserJwt(req), 'invites', query)) as any[];

    // Remove tokens from response
    const safeInvites = invites?.map((inv) => ({
      ...inv,
      token: undefined,
    })) || [];

    logger.info('Invites listed', { org_id: orgId, count: safeInvites.length });

    res.json({
      success: true,
      data: safeInvites,
      count: safeInvites.length,
    });
  } catch (error: any) {
    logger.error('Invites list failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/invites/:id
 * Get a specific invitation
 */
router.get('/invites/:id', requirePermission('team.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));

    const invites = (await supabaseRestAsUser(getUserJwt(req), 'invites', query)) as any[];

    if (!invites || invites.length === 0) {
      return res.status(404).json({ success: false, error: 'Invitation not found' });
    }

    const invite = invites[0];
    invite.token = undefined; // Don't expose token

    logger.info('Invite retrieved', { invite_id: id, org_id: orgId });

    res.json({ success: true, data: invite });
  } catch (error: any) {
    logger.error('Invite retrieval failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/invites/accept
 * Accept an invitation (public endpoint, no auth required)
 */
router.post('/invites/accept', async (req: Request, res: Response) => {
  try {
    const result = respondToInviteSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const { token } = result.data;

    // Find invite by token
    const inviteQuery = new URLSearchParams();
    inviteQuery.set('token', eq(token));
    inviteQuery.set('status', eq('pending'));
    const invites = (await supabaseRestAsService('invites', inviteQuery)) as any[];

    if (!invites || invites.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired invitation',
      });
    }

    const invite = invites[0];

    // Check expiration
    if (new Date(invite.expires_at) < new Date()) {
      // Mark as expired
      await supabaseRestAsService('invites', `id=${eq(invite.id)}`, {
        method: 'PATCH',
        body: { status: 'expired' },
      });

      return res.status(400).json({
        success: false,
        error: 'Invitation has expired',
      });
    }

    res.json({
      success: true,
      message: 'Invitation verified. Sign in to claim access to this workspace.',
      data: {
        organization_id: invite.organization_id,
        role: invite.role,
        email: invite.email,
      },
    });
  } catch (error: any) {
    logger.error('Invite acceptance failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/invites/claim
 * Claim an invitation (auth required, org may be missing)
 */
router.post('/invites/claim', async (req: Request, res: Response) => {
  try {
    const result = respondToInviteSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Missing authentication' });
    }

    const email = String(req.user.email || '').toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email not available on session' });
    }

    const { token } = result.data;
    const inviteQuery = new URLSearchParams();
    inviteQuery.set('token', eq(token));
    inviteQuery.set('status', eq('pending'));
    const invites = (await supabaseRestAsService('invites', inviteQuery)) as any[];
    if (!invites || invites.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid or expired invitation' });
    }

    const invite = invites[0];
    if (new Date(invite.expires_at) < new Date()) {
      await supabaseRestAsService('invites', `id=${eq(invite.id)}`, {
        method: 'PATCH',
        body: { status: 'expired' },
      });
      return res.status(400).json({ success: false, error: 'Invitation has expired' });
    }

    const inviteEmail = String(invite.email || '').toLowerCase();
    if (inviteEmail !== email) {
      return res.status(403).json({ success: false, error: 'Invitation email does not match this account' });
    }

    // Ensure the authenticated user profile is attached to the invited org.
    // This uses service role to avoid being blocked pre-provisioning.
    const userLookup = new URLSearchParams();
    userLookup.set('id', eq(req.user.id));
    userLookup.set('select', 'id,email,organization_id,role');
    userLookup.set('limit', '1');
    const existingProfiles = (await supabaseRestAsService('users', userLookup)) as any[];
    const existing = existingProfiles?.[0] || null;

    if (existing) {
      await supabaseRestAsService('users', `id=${eq(existing.id)}`, {
        method: 'PATCH',
        body: {
          organization_id: invite.organization_id,
          role: invite.role,
          updated_at: new Date().toISOString(),
        },
      });
    } else {
      await supabaseRestAsService('users', '', {
        method: 'POST',
        body: {
          id: req.user.id,
          email: req.user.email,
          organization_id: invite.organization_id,
          role: invite.role,
          name: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }

    await supabaseRestAsService('invites', `id=${eq(invite.id)}`, {
      method: 'PATCH',
      body: {
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      },
    });

    auditLog.log({
      user_id: req.user.id,
      action: 'invite.claimed',
      resource_type: 'invite',
      resource_id: invite.id,
      organization_id: invite.organization_id,
      metadata: { email: invite.email, role: invite.role },
    });

    return res.json({
      success: true,
      message: 'Invitation claimed successfully',
      data: {
        organization_id: invite.organization_id,
        role: invite.role,
        email: invite.email,
      },
    });
  } catch (error: any) {
    logger.error('Invite claim failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/invites/:id/reject
 * Reject an invitation
 */
router.post('/invites/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = respondToInviteSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map((e) => e.message),
      });
    }

    const { token } = result.data;

    // Find invite by id and token
    const inviteQuery = new URLSearchParams();
    inviteQuery.set('id', eq(id));
    inviteQuery.set('token', eq(token));
    const invites = (await supabaseRestAsService('invites', inviteQuery)) as any[];

    if (!invites || invites.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid invitation',
      });
    }

    const invite = invites[0];

    // Mark invite as rejected
    await supabaseRestAsService('invites', `id=${eq(invite.id)}`, {
      method: 'PATCH',
      body: {
        status: 'rejected',
        rejected_at: new Date().toISOString(),
      },
    });

    // Audit log
    auditLog.log({
      user_id: invite.email,
      action: 'invite.rejected',
      resource_type: 'invite',
      resource_id: invite.id,
      organization_id: invite.organization_id,
      metadata: { email: invite.email },
    });

    logger.info('Invite rejected', {
      invite_id: invite.id,
      email: invite.email,
    });

    res.json({
      success: true,
      message: 'Invitation rejected',
    });
  } catch (error: any) {
    logger.error('Invite rejection failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/invites/:id
 * Cancel/revoke an invitation
 */
router.delete('/invites/:id', requirePermission('team.manage'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization not found' });
    }

    const query = new URLSearchParams();
    query.set('id', eq(id));
    query.set('organization_id', eq(orgId));

    // Mark as cancelled instead of hard delete
    const invites = (await supabaseRestAsUser(getUserJwt(req), 'invites', query, {
      method: 'PATCH',
      body: { status: 'cancelled' },
    })) as any[];

    if (!invites || invites.length === 0) {
      return res.status(404).json({ success: false, error: 'Invitation not found' });
    }

    // Audit log
    auditLog.log({
      user_id: req.user?.id || 'unknown',
      action: 'invite.cancelled',
      resource_type: 'invite',
      resource_id: id,
      organization_id: orgId,
      metadata: { email: invites[0].email },
    });

    logger.info('Invite cancelled', { invite_id: id, org_id: orgId });

    res.json({
      success: true,
      message: 'Invitation cancelled successfully',
    });
  } catch (error: any) {
    logger.error('Invite cancellation failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
