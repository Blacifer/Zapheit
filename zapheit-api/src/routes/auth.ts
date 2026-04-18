import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { eq, supabaseRestAsService } from '../lib/supabase-rest';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Password reset request schema
const passwordResetRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// Password reset confirm schema
const passwordResetConfirmSchema = z.object({
  tokenHash: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[a-z]/, 'Password must contain lowercase letter')
    .regex(/[0-9]/, 'Password must contain number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain special character'),
}).refine(
  (data) => !!data.tokenHash || (!!data.accessToken && !!data.refreshToken),
  {
    message: 'Provide either tokenHash or both accessToken and refreshToken',
    path: ['tokenHash'],
  }
);

// Provision request schema (authenticated; user identity derived from JWT)
const provisionSchema = z.object({
  name: z.string().min(1).optional(),
  orgName: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});

/**
 * Provision organization and user profile
 * POST /auth/provision
 */
router.post('/provision', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = provisionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map(e => e.message),
      });
    }

    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: 'Missing authentication' });
    }

    const userId = req.user.id;
    const email = req.user.email;

    // Defense-in-depth idempotency:
    // even if `authenticateToken` cannot derive org context (ex: transient RLS mistakes),
    // never remap an existing user into a brand-new organization.
    try {
      const query = new URLSearchParams({
        select: 'id,organization_id',
        id: eq(userId),
        limit: '1',
      });
      const rows = (await supabaseRestAsService('users', query)) as any[];
      const existingOrgId = rows?.[0]?.organization_id ?? null;
      if (existingOrgId) {
        return res.json({
          success: true,
          message: 'Already provisioned',
          data: {
            organizationId: existingOrgId,
            slug: null,
          },
        });
      }
    } catch (lookupError: any) {
      logger.error('User profile lookup failed during provision (idempotency guard)', { error: lookupError?.message || 'Unknown error' });
      return res.status(500).json({ success: false, error: 'Failed to resolve user profile' });
    }

    // Fast-path idempotency when org context is already known.
    if (req.user.organization_id) {
      return res.json({
        success: true,
        message: 'Already provisioned',
        data: {
          organizationId: req.user.organization_id,
          slug: null,
        },
      });
    }
    const desiredName = result.data.name || email || 'User';
    const desiredOrgName = result.data.orgName || (email ? `${email.split('@')[0]}'s Workspace` : 'Workspace');

    const normalizeSlug = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);

    let desiredSlug = normalizeSlug(result.data.slug || desiredOrgName) || `org-${userId.slice(0, 8)}`;

    // Ensure slug uniqueness; do not auto-join existing orgs by slug.
    let existingBySlug: any | null = null;
    try {
      const query = new URLSearchParams({
        select: 'id,slug',
        slug: eq(desiredSlug),
        limit: '1',
      });
      const rows = (await supabaseRestAsService('organizations', query)) as any[];
      existingBySlug = rows?.[0] ?? null;
    } catch (slugLookupError: any) {
      logger.error('Organization slug lookup failed during provision', { error: slugLookupError?.message || 'Unknown error' });
      return res.status(500).json({ success: false, error: 'Failed to resolve organization slug' });
    }

    if (existingBySlug) {
      desiredSlug = normalizeSlug(`${desiredSlug}-${userId.slice(0, 6)}`);
    }

    const resolvedOrganizationId = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await supabaseRestAsService('organizations', '', {
        method: 'POST',
        body: [{
          id: resolvedOrganizationId,
          name: desiredOrgName,
          slug: desiredSlug,
          plan: 'audit',
          created_at: now,
        }],
      });
    } catch (orgError: any) {
      logger.error('Organization creation failed during provision', { error: orgError?.message || 'Unknown error' });
      return res.status(500).json({ success: false, error: 'Failed to create organization' });
    }

    let existingProfile: any | null = null;
    try {
      const query = new URLSearchParams({
        select: 'id,email,organization_id,role',
        id: eq(userId),
        limit: '1',
      });
      const rows = (await supabaseRestAsService('users', query)) as any[];
      existingProfile = rows?.[0] ?? null;
    } catch (profileLookupError: any) {
      logger.error('User profile lookup failed during provision', { error: profileLookupError?.message || 'Unknown error' });
      return res.status(500).json({ success: false, error: 'Failed to resolve user profile' });
    }

    if (existingProfile) {
      try {
        await supabaseRestAsService('users', new URLSearchParams({ id: eq(existingProfile.id) }), {
          method: 'PATCH',
          body: {
            email,
            name: desiredName,
            role: existingProfile.role || 'super_admin',
            organization_id: resolvedOrganizationId,
            updated_at: now,
          },
        });
      } catch (updateError: any) {
        logger.error('Failed to update existing user profile', { error: updateError?.message || 'Unknown error' });
        return res.status(500).json({ success: false, error: 'Failed to update user profile' });
      }
    } else {
      try {
        await supabaseRestAsService('users', '', {
          method: 'POST',
          body: [{
            id: userId,
            email,
            name: desiredName,
            role: 'super_admin',
            organization_id: resolvedOrganizationId,
            created_at: now,
            updated_at: now,
          }],
        });
      } catch (profileError: any) {
        logger.error('Failed to create user profile', { error: profileError?.message || 'Unknown error' });
        return res.status(500).json({ success: false, error: 'Failed to create user profile' });
      }
    }

    return res.json({
      success: true,
      message: 'Provisioned successfully',
      data: {
        organizationId: resolvedOrganizationId,
        slug: desiredSlug,
      },
    });
  } catch (error: any) {
    logger.error('Provision failed', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to process provision request',
    });
  }
});

/**
 * Request password reset
 * POST /auth/password-reset
 */
router.post('/password-reset', async (req: Request, res: Response) => {
  try {
    const result = passwordResetRequestSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map(e => e.message),
      });
    }

    const { email } = result.data;

    logger.info('Password reset requested', { email });

    // Send password reset email via Supabase
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/reset-password`,
    });

    if (error) {
      logger.error('Supabase password reset failed', { error: error.message });
      // Still return success to prevent email enumeration
    }

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  } catch (error: any) {
    logger.error('Password reset request failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to process password reset request',
    });
  }
});

/**
 * Confirm password reset with token
 * POST /auth/password-confirm
 */
router.post('/password-confirm', async (req: Request, res: Response) => {
  try {
    const result = passwordResetConfirmSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.error.errors.map(e => e.message),
      });
    }

    const { tokenHash, accessToken, refreshToken, newPassword } = result.data;

    logger.info('Password reset confirmation attempted');

    let sessionTokens: { access_token: string; refresh_token: string } | null = null;

    if (tokenHash) {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });

      if (verifyError || !verifyData.session) {
        logger.warn('Password reset token verification failed', { error: verifyError?.message });
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired reset token',
        });
      }

      sessionTokens = {
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
      };
    } else {
      sessionTokens = {
        access_token: accessToken as string,
        refresh_token: refreshToken as string,
      };
    }

    const { error: sessionError } = await supabase.auth.setSession(sessionTokens);
    if (sessionError) {
      logger.warn('Password reset session setup failed', { error: sessionError.message });
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset session',
      });
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      logger.error('Password update failed', { error: error.message });
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token',
      });
    }

    await supabase.auth.signOut();

    logger.info('Password reset successful');

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    });
  } catch (error: any) {
    logger.error('Password reset confirmation failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to reset password',
    });
  }
});

export default router;
