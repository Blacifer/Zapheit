import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import logger from '../lib/logger';
import { SupabaseRestError, supabaseRestAsUser } from '../lib/supabase-rest';

const debugLog = (msg: string) => {
  if (process.env.AUTH_DEBUG === 'true') {
    // Intentionally avoid structured logging here to prevent leaking tokens/PII by accident.
    // Enable only during local debugging.
    console.log('[AUTH]', msg);
  }
};

// Extend Express Request type to include user data
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      userJwt?: string;
      user?: {
        id: string;
        email: string;
        organization_id?: string;
        role?: string;
      };
    }
  }
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getSupabaseJwks() {
  if (cachedJwks) return cachedJwks;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required for JWT verification');
  }
  cachedJwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return cachedJwks;
}

/**
 * Authentication Middleware
 * Validates JWT token from Authorization header
 * Token should be: Bearer <jwt_token>
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Missing authentication token',
      });
      return;
    }

    let jwtPayload: any = null;

    try {
      const jwks = getSupabaseJwks();
      const verified = await jwtVerify(token, jwks);
      jwtPayload = verified.payload;
    } catch (jwtError: any) {
      logger.warn('JWT verification failed', { error: jwtError.message });
      res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
      return;
    }

    // Fail closed: ensure the token was issued by this Supabase project.
    const supabaseUrlForIss = process.env.SUPABASE_URL;
    const expectedIss = supabaseUrlForIss ? `${supabaseUrlForIss}/auth/v1` : null;
    if (expectedIss && jwtPayload?.iss && jwtPayload.iss !== expectedIss) {
      logger.warn('JWT issuer mismatch', { expected: expectedIss, got: jwtPayload.iss });
      res.status(401).json({
        success: false,
        error: 'Invalid token issuer',
      });
      return;
    }

    if (!jwtPayload || !jwtPayload.sub) {
      res.status(401).json({
        success: false,
        error: 'Invalid token payload',
      });
      return;
    }

    // Attach the verified JWT for downstream RLS-enforced PostgREST calls.
    req.userJwt = token;

    // Fetch user profile (RLS-enforced) to derive organization and role.
    debugLog('[AUTH] Attempting user profile lookup for ID: ' + jwtPayload.sub);

    let userProfile: any = null;
    let profileError: any = null;

    try {
      const byIdQuery = new URLSearchParams();
      byIdQuery.set('id', `eq.${encodeURIComponent(String(jwtPayload.sub))}`);
      byIdQuery.set('select', 'id,email,organization_id,role');
      byIdQuery.set('limit', '1');

      let rows: any[] = await supabaseRestAsUser(token, 'users', byIdQuery);

      if ((!rows || rows.length === 0) && jwtPayload.email) {
        // Fallback for older seeds where profile id mismatches auth.uid(): resolve by email.
        const byEmailQuery = new URLSearchParams();
        byEmailQuery.set('email', `eq.${encodeURIComponent(String(jwtPayload.email))}`);
        byEmailQuery.set('select', 'id,email,organization_id,role');
        byEmailQuery.set('limit', '1');
        rows = await supabaseRestAsUser(token, 'users', byEmailQuery);
        if (rows && rows.length > 0) {
          debugLog('[AUTH] Resolved user organization by email fallback');
        }
      }

      if (rows && rows.length > 0) {
        const orgUser = rows[0];
        userProfile = {
          id: orgUser.id || jwtPayload.sub,
          email: orgUser.email || jwtPayload.email,
          organization_id: orgUser.organization_id,
          role: orgUser.role || 'viewer',
        };
        debugLog('[AUTH] Found user organization and role: ' + (orgUser.role || 'viewer'));
      } else {
        debugLog('[AUTH] User profile missing, attaching viewer role with no organization');
        userProfile = {
          id: jwtPayload.sub,
          email: jwtPayload.email,
          organization_id: null,
          role: 'viewer',
        };
      }
    } catch (error: any) {
      profileError = error;
      if (error instanceof SupabaseRestError) {
        debugLog('[AUTH] Profile lookup failed (SupabaseRestError ' + error.status + ')');
      } else {
        debugLog('[AUTH] Error fetching user organization: ' + error.message);
      }
      // Fail closed if the profile lookup fails: do not grant org access.
      userProfile = {
        id: jwtPayload.sub,
        email: jwtPayload.email,
        organization_id: null,
        role: 'viewer',
      };
    }

    // Attach user to request
    req.user = {
      id: userProfile.id || jwtPayload.sub,
      email: userProfile.email || jwtPayload.email,
      // Never trust org context from client-provided headers.
      organization_id: userProfile.organization_id || undefined,
      role: userProfile.role || 'viewer',
    };

    debugLog('[AUTH] Attached user to request: org_id=' + (req.user.organization_id || 'undefined') + ', role=' + req.user.role);

    next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
};

/**
 * Authorization Middleware
 * Checks if user has required role for the endpoint
 */
export const authorize = (requiredRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
      return;
    }

    if (!requiredRoles.includes(req.user.role || 'viewer')) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
};

/**
 * Organization Isolation Middleware
 * Ensures user can only access their organization's data
 */
export const checkOrgAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || !req.user.organization_id) {
    // 409: user is authenticated but their workspace/user profile is not provisioned yet.
    res.status(409).json({
      success: false,
      error: 'Workspace not provisioned for this account. Complete setup and try again.',
      code: 'WORKSPACE_NOT_PROVISIONED',
    });
    return;
  }

  // Store organization_id on request for use in queries
  req.user.organization_id = req.user.organization_id;
  next();
};

/**
 * Error handling middleware for auth issues
 */
export const authErrorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (error.name === 'UnauthorizedError') {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
    return;
  }

  next(error);
};
