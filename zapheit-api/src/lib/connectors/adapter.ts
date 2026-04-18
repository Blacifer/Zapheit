// ---------------------------------------------------------------------------
// ConnectorAdapter Interface
//
// Standard contract that every connector adapter implements.
// Replaces the ad-hoc switch-case pattern in action-executor.ts with a
// pluggable, per-provider adapter file.
//
// Read actions (get, list, search) go through executeRead().
// Write actions (create, update, delete, send) go through executeWrite().
// Both return the same ActionResult shape used by the existing executor.
// ---------------------------------------------------------------------------

import type { ActionResult } from './action-executor';

export type HealthResult = {
  healthy: boolean;
  latencyMs?: number;
  accountLabel?: string;
  error?: string;
  details?: Record<string, any>;
};

export type SubscriptionCallback = (event: {
  type: string;
  data: any;
  timestamp: string;
}) => void;

export type Unsubscribe = () => void;

export interface ConnectorAdapter {
  /** Unique connector identifier (e.g., 'slack', 'jira', 'hubspot') */
  readonly connectorId: string;

  /** Human-readable connector name */
  readonly displayName: string;

  /** Credential field names required for this connector */
  readonly requiredCredentials: string[];

  /** Validate that credentials are present and properly formatted */
  validateCredentials(creds: Record<string, string>): { valid: boolean; missing: string[] };

  /** Test the connection to the third-party service */
  testConnection(creds: Record<string, string>): Promise<HealthResult>;

  /** Execute a read action (get, list, search) — safe to retry, no side effects */
  executeRead(
    action: string,
    params: Record<string, any>,
    creds: Record<string, string>,
  ): Promise<ActionResult>;

  /** Execute a write action (create, update, delete, send) — has side effects */
  executeWrite(
    action: string,
    params: Record<string, any>,
    creds: Record<string, string>,
  ): Promise<ActionResult>;

  /**
   * Optional: subscribe to real-time events from the connector.
   * Returns an unsubscribe function.
   */
  subscribe?(event: string, callback: SubscriptionCallback): Unsubscribe;
}

// ---------------------------------------------------------------------------
// Adapter Registry — maps connectorId → adapter instance
// ---------------------------------------------------------------------------
const adapterRegistry = new Map<string, ConnectorAdapter>();

export function registerAdapter(adapter: ConnectorAdapter): void {
  adapterRegistry.set(adapter.connectorId, adapter);
}

export function getRegisteredAdapter(connectorId: string): ConnectorAdapter | undefined {
  return adapterRegistry.get(connectorId);
}

export function listRegisteredAdapters(): string[] {
  return Array.from(adapterRegistry.keys());
}

// ---------------------------------------------------------------------------
// Helpers shared across adapters
// ---------------------------------------------------------------------------

/** Standard JSON fetch with typed return */
export async function jsonFetch(
  url: string,
  opts: RequestInit,
): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(url, opts);
  let data: any;
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  return { ok: resp.ok, status: resp.status, data };
}

/** Build Authorization: Bearer headers with JSON content type */
export function bearerHeaders(
  token: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

/** Build Basic Auth header */
export function basicAuthHeaders(
  username: string,
  password: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json', ...extra };
}

// Read-action prefixes — actions starting with these are safe reads
const READ_ACTION_PREFIXES = ['get', 'list', 'search', 'fetch', 'find', 'lookup', 'check', 'query'];

/** Determine if an action is a read or write based on its name */
export function isReadAction(action: string): boolean {
  const lower = action.toLowerCase();
  return READ_ACTION_PREFIXES.some((p) => lower.startsWith(p));
}
