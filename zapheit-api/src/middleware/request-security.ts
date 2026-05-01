import { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Ensure scheme is present so the URL constructor can parse it.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return trimmed.replace(/\/+$/, '') || null;
  }
}

/**
 * Build the set of allowed origins for CSRF validation.
 *
 * IMPORTANT: This MUST read from the same env vars as the CORS middleware in
 * index.ts (FRONTEND_URL, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL,
 * CORS_ALLOWED_ORIGINS). Keeping them in sync prevents the situation where a
 * CORS preflight passes but the subsequent mutation is rejected by CSRF.
 */
function getAllowedOrigins(): Set<string> {
  const configured = [
    process.env.FRONTEND_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL || '',
    process.env.VERCEL_URL || '',
    process.env.CORS_ALLOWED_ORIGINS || '',
  ]
    .join(',')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => !!item);

  if (process.env.NODE_ENV !== 'production') {
    configured.push('http://localhost:3000', 'http://localhost:5173');
  }

  return new Set(configured);
}

export function protectMutationsFromCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const originHeader = normalizeOrigin(req.headers.origin as string | undefined);
  const refererHeader = normalizeOrigin(req.headers.referer as string | undefined);
  const requestOrigin = originHeader || refererHeader;

  // Non-browser clients often omit Origin/Referer headers; allow these.
  if (!requestOrigin) {
    next();
    return;
  }

  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.has(requestOrigin)) {
    // Log the rejection so it's easy to diagnose in production.
    console.warn('[CSRF] Blocked mutating request', {
      method: req.method,
      path: req.path,
      origin: requestOrigin,
      allowedOrigins: Array.from(allowedOrigins),
    });
    res.status(403).json({
      success: false,
      error: 'Origin not allowed for mutating request',
    });
    return;
  }

  next();
}
