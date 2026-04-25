// ---------------------------------------------------------------------------
// Cashfree Payments Connector Adapter
//
// Covers Cashfree Payment Gateway (PG) and Payouts APIs.
// Reads:  list_transactions, get_transaction, list_settlements, list_payouts,
//         get_payout, list_payment_links, get_payment_link
// Writes: initiate_payout, create_payment_link, deactivate_payment_link,
//         trigger_refund
//
// Credentials: client_id, client_secret
// PG base:     https://api.cashfree.com/pg
// Payouts base:https://api.cashfree.com/payout/v1
// API version: 2023-08-01
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  type ConnectorAdapter,
  type HealthResult,
  jsonFetch,
  registerAdapter,
} from '../adapter';
import { decryptSecret } from '../../integrations/encryption';

const PG_BASE = 'https://api.cashfree.com/pg';
const PAYOUT_BASE = 'https://api.cashfree.com/payout/v1';
const API_VERSION = '2023-08-01';

function resolveAuth(creds: Record<string, string>) {
  const clientId = decryptSecret(creds.client_id || '');
  const clientSecret = decryptSecret(creds.client_secret || '');
  return { clientId, clientSecret };
}

function pgHeaders(clientId: string, clientSecret: string): Record<string, string> {
  return {
    'x-client-id': clientId,
    'x-client-secret': clientSecret,
    'x-api-version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

// Cashfree Payouts uses a separate Bearer token obtained via client credentials
async function getPayoutToken(clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const r = await jsonFetch(`${PAYOUT_BASE}/authorize`, {
      method: 'POST',
      headers: { 'X-Client-Id': clientId, 'X-Client-Secret': clientSecret },
    });
    if (!r.ok) return null;
    return r.data?.data?.token || null;
  } catch {
    return null;
  }
}

const cashfreeAdapter: ConnectorAdapter = {
  connectorId: 'cashfree',
  displayName: 'Cashfree Payments',
  requiredCredentials: ['client_id', 'client_secret'],

  validateCredentials(creds) {
    const { clientId, clientSecret } = resolveAuth(creds);
    const missing: string[] = [];
    if (!clientId) missing.push('client_id');
    if (!clientSecret) missing.push('client_secret');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { clientId, clientSecret } = resolveAuth(creds);
    if (!clientId || !clientSecret) {
      return { healthy: false, error: 'Missing client_id or client_secret' };
    }
    const start = Date.now();
    try {
      const r = await jsonFetch(`${PG_BASE}/orders?limit=1`, {
        headers: pgHeaders(clientId, clientSecret),
      });
      const latencyMs = Date.now() - start;
      if (r.status === 401) return { healthy: false, latencyMs, error: 'Invalid credentials — check client_id and client_secret' };
      if (!r.ok && r.status !== 404) return { healthy: false, latencyMs, error: `HTTP ${r.status}` };
      return { healthy: true, latencyMs, accountLabel: 'Cashfree Payments', details: { apiVersion: API_VERSION } };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { clientId, clientSecret } = resolveAuth(creds);
    const headers = pgHeaders(clientId, clientSecret);

    switch (action) {
      case 'list_transactions': {
        const limit = Math.min(Number(params.limit) || 50, 200);
        const fromDate = params.from_date || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const toDate = params.to_date || new Date().toISOString().split('T')[0];
        const r = await jsonFetch(
          `${PG_BASE}/orders?limit=${limit}&from_date=${fromDate}&to_date=${toDate}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.orders || r.data || [] };
      }

      case 'get_transaction': {
        const orderId = params.order_id || params.orderId;
        if (!orderId) return { success: false, error: 'order_id is required' };
        const r = await jsonFetch(`${PG_BASE}/orders/${orderId}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'list_settlements': {
        const limit = Math.min(Number(params.limit) || 50, 200);
        const r = await jsonFetch(`${PG_BASE}/settlement?limit=${limit}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.settlements || r.data || [] };
      }

      case 'list_payouts': {
        const payoutToken = await getPayoutToken(clientId, clientSecret);
        if (!payoutToken) return { success: false, error: 'Failed to authenticate with Cashfree Payouts — check credentials' };
        const limit = Math.min(Number(params.limit) || 50, 200);
        const r = await jsonFetch(`${PAYOUT_BASE}/transfers?maxReturn=${limit}`, {
          headers: { Authorization: `Bearer ${payoutToken}`, 'Content-Type': 'application/json' },
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.data || [] };
      }

      case 'get_payout': {
        const transferId = params.transfer_id || params.transferId;
        if (!transferId) return { success: false, error: 'transfer_id is required' };
        const payoutToken = await getPayoutToken(clientId, clientSecret);
        if (!payoutToken) return { success: false, error: 'Failed to authenticate with Cashfree Payouts' };
        const r = await jsonFetch(`${PAYOUT_BASE}/transfers/${transferId}`, {
          headers: { Authorization: `Bearer ${payoutToken}`, 'Content-Type': 'application/json' },
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.data };
      }

      case 'list_payment_links': {
        const limit = Math.min(Number(params.limit) || 50, 200);
        const r = await jsonFetch(`${PG_BASE}/links?limit=${limit}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.payment_links || r.data || [] };
      }

      case 'get_payment_link': {
        const linkId = params.link_id || params.linkId;
        if (!linkId) return { success: false, error: 'link_id is required' };
        const r = await jsonFetch(`${PG_BASE}/links/${encodeURIComponent(linkId)}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { clientId, clientSecret } = resolveAuth(creds);
    const headers = pgHeaders(clientId, clientSecret);

    switch (action) {
      case 'initiate_payout': {
        const { beneficiary_name, beneficiary_account, beneficiary_ifsc, amount, transfer_id, remarks } = params;
        if (!beneficiary_name || !beneficiary_account || !beneficiary_ifsc || !amount) {
          return { success: false, error: 'beneficiary_name, beneficiary_account, beneficiary_ifsc, and amount are required' };
        }
        const payoutToken = await getPayoutToken(clientId, clientSecret);
        if (!payoutToken) return { success: false, error: 'Failed to authenticate with Cashfree Payouts' };
        const body = {
          beneId: `BENE_${Date.now()}`,
          amount: String(amount),
          transferId: transfer_id || `TXN_${Date.now()}`,
          remarks: remarks || 'Payout via Zapheit',
          bankAccount: beneficiary_account,
          ifsc: beneficiary_ifsc,
          name: beneficiary_name,
          phone: params.phone || '',
          email: params.email || '',
        };
        const r = await jsonFetch(`${PAYOUT_BASE}/transfers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${payoutToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.data };
      }

      case 'create_payment_link': {
        const { link_amount, link_currency, link_purpose, customer_email, customer_phone, customer_name, expiry_time } = params;
        if (!link_amount || !link_purpose) {
          return { success: false, error: 'link_amount and link_purpose are required' };
        }
        const body: Record<string, any> = {
          link_id: `LINK_${Date.now()}`,
          link_amount: Number(link_amount),
          link_currency: link_currency || 'INR',
          link_purpose,
          link_expiry_time: expiry_time || new Date(Date.now() + 7 * 86400000).toISOString(),
          link_notify: { send_sms: false, send_email: false },
        };
        if (customer_name || customer_email || customer_phone) {
          body.customer_details = {
            customer_name: customer_name || '',
            customer_email: customer_email || '',
            customer_phone: customer_phone || '',
          };
        }
        const r = await jsonFetch(`${PG_BASE}/links`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'deactivate_payment_link': {
        const linkId = params.link_id || params.linkId;
        if (!linkId) return { success: false, error: 'link_id is required' };
        const r = await jsonFetch(`${PG_BASE}/links/${encodeURIComponent(linkId)}/cancel`, {
          method: 'POST',
          headers,
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'trigger_refund': {
        const { order_id, refund_amount, refund_id, refund_note } = params;
        if (!order_id || !refund_amount) {
          return { success: false, error: 'order_id and refund_amount are required' };
        }
        const body = {
          refund_amount: Number(refund_amount),
          refund_id: refund_id || `REFUND_${Date.now()}`,
          refund_note: refund_note || 'Refund via Zapheit',
        };
        const r = await jsonFetch(`${PG_BASE}/orders/${order_id}/refunds`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(cashfreeAdapter);
