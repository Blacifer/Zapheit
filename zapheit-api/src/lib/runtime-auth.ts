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

      const rawEnc = String(runtime.runtime_secret_enc ?? '');
      const secret = decryptSecret(rawEnc);
      if (!secret) {
        return res.status(401).json({ success: false, error: 'Runtime secret unavailable' });
      }

      // Verify using the same HMAC-SHA256 approach the runtime uses to sign.
      // jose v5's jwtVerify is not used here to avoid format incompatibilities.
      const parts = token.split('.');
      if (parts.length !== 3) {
        return res.status(401).json({ success: false, error: 'Malformed runtime token' });
      }
      const expectedSig = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
      if (expectedSig !== parts[2]) {
        logger.warn('Runtime HMAC mismatch', {
          runtime_id: runtimeId,
          enc_prefix: rawEnc.slice(0, 6),
          enc_len: rawEnc.length,
          secret_len: secret.length,
          secret_prefix: secret.slice(0, 8),
          sig_from_token: parts[2].slice(0, 12),
          sig_expected: expectedSig.slice(0, 12),
        });
        return res.status(401).json({ success: false, error: 'Runtime token signature invalid' });
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as any;
      const nowSec = Math.floor(Date.now() / 1000);
      if (!payload?.exp || payload.exp < nowSec) {
        return res.status(401).json({ success: false, error: 'Runtime token expired' });
      }

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

