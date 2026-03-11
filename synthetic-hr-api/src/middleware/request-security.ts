import { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(): Set<string> {
  const configured = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
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

  const secFetchSite = (req.headers['sec-fetch-site'] as string | undefined)?.toLowerCase();
  if (secFetchSite === 'cross-site') {
    res.status(403).json({
      success: false,
      error: 'Cross-site requests are not allowed for this operation',
    });
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
    res.status(403).json({
      success: false,
      error: 'Origin not allowed for mutating request',
    });
    return;
  }

  next();
}
