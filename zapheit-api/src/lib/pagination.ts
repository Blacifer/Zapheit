/**
 * pagination.ts
 *
 * Keyset (cursor) pagination helpers for list endpoints.
 *
 * Why keyset over offset?
 * - Stable under concurrent inserts/deletes (no "page drift")
 * - O(log n) rather than O(offset) at large pages
 * - Works naturally with Supabase PostgREST ordering
 *
 * Cursor encoding: base64url of `{ id: string, created_at: string }` of the
 * last row returned. Opaque to clients — they just pass it back as `?cursor=`.
 *
 * Usage (route handler):
 *
 *   const { limit, cursorId, cursorCreatedAt } = parseCursorParams(req);
 *
 *   const q = new URLSearchParams();
 *   q.set('organization_id', eq(orgId));
 *   q.set('order', 'created_at.desc,id.desc');
 *   q.set('limit', String(limit + 1));          // fetch one extra to detect has_more
 *   if (cursorId && cursorCreatedAt) {
 *     // rows AFTER the cursor position (exclusive)
 *     q.set('or', `(created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId}))`);
 *   }
 *
 *   const rows = await supabaseRest('my_table', q);
 *   return res.json(buildCursorResponse(rows, limit));
 */

import { Request } from 'express';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from './route-helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CursorParams {
  limit: number;
  /** ID of the last row on the previous page (undefined on first page) */
  cursorId: string | undefined;
  /** ISO timestamp of the last row on the previous page */
  cursorCreatedAt: string | undefined;
}

export interface CursorResponse<T> {
  data: T[];
  /** Pass this value as `?cursor=` on the next request. Null when no more pages. */
  next_cursor: string | null;
  has_more: boolean;
}

// ── Encoding ──────────────────────────────────────────────────────────────────

function encodeCursor(id: string, createdAt: string): string {
  return Buffer.from(JSON.stringify({ id, created_at: createdAt })).toString('base64url');
}

function decodeCursor(raw: string): { id: string; created_at: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof decoded.id === 'string' && typeof decoded.created_at === 'string') {
      return decoded as { id: string; created_at: string };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse `?limit` and `?cursor` from an Express request.
 */
export function parseCursorParams(req: Request): CursorParams {
  const rawLimit = req.query.limit;
  const parsed = Number.parseInt(String(rawLimit ?? DEFAULT_LIST_LIMIT), 10);
  const limit = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;

  const rawCursor = req.query.cursor;
  if (typeof rawCursor === 'string' && rawCursor.length > 0) {
    const decoded = decodeCursor(rawCursor);
    if (decoded) {
      return { limit, cursorId: decoded.id, cursorCreatedAt: decoded.created_at };
    }
  }

  return { limit, cursorId: undefined, cursorCreatedAt: undefined };
}

/**
 * Build a paginated response object.
 *
 * Pass `limit + 1` rows from the DB; this function detects the extra row to
 * determine `has_more` without a separate COUNT query.
 *
 * Rows must have at least `id` and `created_at` fields.
 */
export function buildCursorResponse<T extends { id: string; created_at: string }>(
  rows: T[],
  limit: number,
): CursorResponse<T> {
  const has_more = rows.length > limit;
  const data = has_more ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const next_cursor = has_more && last
    ? encodeCursor(last.id, last.created_at)
    : null;

  return { data, next_cursor, has_more };
}

/**
 * Build the PostgREST `or` filter string for keyset pagination.
 *
 * Ordering is assumed to be `created_at DESC, id DESC`.
 * Returns undefined (no filter) when on the first page.
 */
export function buildCursorFilter(
  cursorId: string | undefined,
  cursorCreatedAt: string | undefined,
): string | undefined {
  if (!cursorId || !cursorCreatedAt) return undefined;
  // Rows strictly before the cursor in DESC order
  return `(created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId}))`;
}
