import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { decryptSecret } from './integrations/encryption';
import { SupabaseRestError, eq, supabaseRestAsService } from './supabase-rest';
import { logger } from './logger';

export type RuntimeAuthContext = {
  runtime_id: string;
  organization_id: string;
};

type RuntimeInstanceRow = {
  id: string;
  organization_id: string;
  runtime_secret_enc?: string | null;
  status?: string | null;
};

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function signRuntimeJwt(runtimeSecret: string, payload: RuntimeAuthContext): Promise<string> {
  const key = new TextEncoder().encode(runtimeSecret);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

async function loadRuntimeInstance(runtimeId: string): Promise<RuntimeInstanceRow | null> {
  try {
    const query = new URLSearchParams();
    query.set('id', eq(runtimeId));
    query.set('select', 'id,organization_id,runtime_secret_enc,status');
    const rows = (await supabaseRestAsService('runtime_instances', query)) as RuntimeInstanceRow[];
    return rows?.[0] || null;
  } catch (err: any) {
    if (err instanceof SupabaseRestError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export function requireRuntimeAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.header('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
      if (!token) {
        return res.status(401).json({ success: false, error: 'Missing runtime Authorization token' });
      }

      const decoded = decodeJwt(token) as any;
      const runtimeId = typeof decoded?.runtime_id === 'string' ? decoded.runtime_id : '';
      if (!runtimeId) {
        return res.status(401).json({ success: false, error: 'Invalid runtime token payload' });
      }

      const runtime = await loadRuntimeInstance(runtimeId);
      if (!runtime?.runtime_secret_enc) {
        return res.status(401).json({ success: false, error: 'Runtime not enrolled' });
      }

      const secret = decryptSecret(String(runtime.runtime_secret_enc));
      if (!secret) {
        return res.status(401).json({ success: false, error: 'Runtime secret unavailable' });
      }

      const key = new TextEncoder().encode(secret);
      const verified = await jwtVerify(token, key, { algorithms: ['HS256'] });
      const payload = verified.payload as any;

      const organizationId = typeof payload?.organization_id === 'string' ? payload.organization_id : '';
      if (!organizationId || organizationId !== runtime.organization_id) {
        return res.status(403).json({ success: false, error: 'Runtime token org mismatch' });
      }

      (req as any).runtime = {
        runtime_id: runtime.id,
        organization_id: runtime.organization_id,
      } satisfies RuntimeAuthContext;

      return next();
    } catch (err: any) {
      logger.warn('Runtime auth failed', { error: err?.message || String(err) });
      return res.status(401).json({ success: false, error: 'Runtime authentication failed' });
    }
  };
}

