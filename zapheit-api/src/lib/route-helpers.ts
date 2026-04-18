/**
 * Shared route helpers used across all domain route files.
 * Extracted from the monolithic api.ts to avoid duplication.
 */
import { Request, Response } from 'express';
import { SupabaseRestError } from './supabase-rest';
import { logger } from './logger';

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export const safeLimit = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIST_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(parsed, MAX_LIST_LIMIT);
};

export const getOrgId = (req: Request): string | null =>
  req.user?.organization_id || null;

export const getUserJwt = (req: Request): string => {
  const jwt = (req as any).userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

export const clampDays = (value: unknown, fallback = 7, min = 7, max = 30): number => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

export const toIsoDay = (value: Date): string => value.toISOString().split('T')[0];

export const buildDaySeries = (days: number): string[] => {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    dates.push(toIsoDay(date));
  }
  return dates;
};

/**
 * Standard error response helper.
 * Always logs the full error internally; never exposes DB internals to the client.
 */
export const errorResponse = (res: Response, error: any, statusCode = 500): void => {
  const isSupabaseError = error instanceof SupabaseRestError;
  const resolvedStatusCode = isSupabaseError ? error.status : statusCode;

  if (isSupabaseError) {
    logger.error('API Error (database)', {
      status: error.status,
      responseBody: error.responseBody,
      stack: error.stack,
    });
  } else {
    logger.error('API Error', { error: error.message, stack: error.stack });
  }

  const clientMessage = isSupabaseError
    ? 'A database error occurred. Please try again or contact support.'
    : (error.message || 'Internal server error');

  res.status(resolvedStatusCode).json({ success: false, error: clientMessage });
};
