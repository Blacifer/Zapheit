// ---------------------------------------------------------------------------
// QuickBooks Connector Adapter
//
// Full ConnectorAdapter for QuickBooks Online (REST API v3).
// Reads: list_invoices, get_invoice, list_customers, get_customer, list_payments, query
// Writes: create_invoice, create_customer, update_customer, send_invoice, create_payment, void_invoice
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  bearerHeaders,
  registerAdapter,
} from '../adapter';

function resolveAuth(creds: Record<string, string>) {
  const token = creds.token || creds.access_token;
  const realmId = creds.realmId || creds.realm_id || creds.company_id;
  const baseUrl = (creds.baseUrl || creds.base_url || 'https://quickbooks.api.intuit.com').replace(/\/+$/, '');
  return { token, realmId, baseUrl };
}

const qbAdapter: ConnectorAdapter = {
  connectorId: 'quickbooks',
  displayName: 'QuickBooks',
  requiredCredentials: ['token', 'realmId'],

  validateCredentials(creds) {
    const { token, realmId } = resolveAuth(creds);
    const missing: string[] = [];
    if (!token) missing.push('token');
    if (!realmId) missing.push('realmId');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { token, realmId, baseUrl } = resolveAuth(creds);
    if (!token || !realmId) {
      return { healthy: false, error: 'Missing required credentials: token and realmId' };
    }
    const start = Date.now();
    try {
      const headers = { ...bearerHeaders(token), Accept: 'application/json' };
      const r = await jsonFetch(`${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`, { headers });
      const latencyMs = Date.now() - start;
      if (!r.ok) return { healthy: false, latencyMs, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
      return {
        healthy: true,
        latencyMs,
        accountLabel: r.data?.CompanyInfo?.CompanyName || 'QuickBooks',
        details: { companyName: r.data?.CompanyInfo?.CompanyName },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { token, realmId, baseUrl } = resolveAuth(creds);
    const headers = { ...bearerHeaders(token), Accept: 'application/json' };
    const base = `${baseUrl}/v3/company/${realmId}`;

    switch (action) {
      case 'list_invoices': {
        const q = params.query || "SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 50";
        const r = await jsonFetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.QueryResponse?.Invoice || [] };
      }
      case 'get_invoice': {
        const id = params.invoiceId || params.id;
        if (!id) return { success: false, error: 'invoiceId is required' };
        const r = await jsonFetch(`${base}/invoice/${id}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Invoice };
      }
      case 'list_customers': {
        const q = params.query || "SELECT * FROM Customer ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 50";
        const r = await jsonFetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.QueryResponse?.Customer || [] };
      }
      case 'get_customer': {
        const id = params.customerId || params.id;
        if (!id) return { success: false, error: 'customerId is required' };
        const r = await jsonFetch(`${base}/customer/${id}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Customer };
      }
      case 'list_payments': {
        const q = params.query || "SELECT * FROM Payment ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 50";
        const r = await jsonFetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.QueryResponse?.Payment || [] };
      }
      case 'query': {
        const q = params.query || params.q;
        if (!q) return { success: false, error: 'query is required' };
        const r = await jsonFetch(`${base}/query?query=${encodeURIComponent(q)}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.QueryResponse };
      }
      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { token, realmId, baseUrl } = resolveAuth(creds);
    const headers = { ...bearerHeaders(token), Accept: 'application/json' };
    const base = `${baseUrl}/v3/company/${realmId}`;

    switch (action) {
      case 'create_invoice': {
        const customerRef = params.customerId || params.CustomerRef;
        if (!customerRef) return { success: false, error: 'customerId is required' };
        const body: any = {
          CustomerRef: { value: customerRef },
          Line: params.lines || [{ Amount: params.amount || 0, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: params.itemId || '1' } } }],
        };
        if (params.dueDate) body.DueDate = params.dueDate;
        const r = await jsonFetch(`${base}/invoice`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Invoice };
      }
      case 'create_customer': {
        const displayName = params.displayName || params.name;
        if (!displayName) return { success: false, error: 'displayName is required' };
        const body: any = { DisplayName: displayName };
        if (params.email) body.PrimaryEmailAddr = { Address: params.email };
        if (params.phone) body.PrimaryPhone = { FreeFormNumber: params.phone };
        if (params.company) body.CompanyName = params.company;
        const r = await jsonFetch(`${base}/customer`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Customer };
      }
      case 'update_customer': {
        const id = params.customerId || params.id;
        if (!id) return { success: false, error: 'customerId is required' };
        const getR = await jsonFetch(`${base}/customer/${id}`, { headers });
        if (!getR.ok) return { success: false, error: 'Failed to fetch customer for update' };
        const existing = getR.data?.Customer;
        const body: any = { ...existing, Id: id, SyncToken: existing.SyncToken };
        if (params.displayName) body.DisplayName = params.displayName;
        if (params.email) body.PrimaryEmailAddr = { Address: params.email };
        if (params.phone) body.PrimaryPhone = { FreeFormNumber: params.phone };
        const r = await jsonFetch(`${base}/customer`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Customer };
      }
      case 'send_invoice': {
        const id = params.invoiceId || params.id;
        if (!id) return { success: false, error: 'invoiceId is required' };
        const email = params.email ? `?sendTo=${encodeURIComponent(params.email)}` : '';
        const r = await jsonFetch(`${base}/invoice/${id}/send${email}`, { method: 'POST', headers });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Invoice };
      }
      case 'create_payment': {
        const customerRef = params.customerId;
        const amount = params.amount;
        if (!customerRef || !amount) return { success: false, error: 'customerId and amount are required' };
        const body: any = { CustomerRef: { value: customerRef }, TotalAmt: parseFloat(amount) };
        if (params.invoiceId) body.Line = [{ Amount: parseFloat(amount), LinkedTxn: [{ TxnId: params.invoiceId, TxnType: 'Invoice' }] }];
        const r = await jsonFetch(`${base}/payment`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Payment };
      }
      case 'void_invoice': {
        const id = params.invoiceId || params.id;
        if (!id) return { success: false, error: 'invoiceId is required' };
        const getR = await jsonFetch(`${base}/invoice/${id}`, { headers });
        if (!getR.ok) return { success: false, error: 'Failed to fetch invoice' };
        const inv = getR.data?.Invoice;
        const r = await jsonFetch(`${base}/invoice?operation=void`, {
          method: 'POST', headers, body: JSON.stringify({ Id: id, SyncToken: inv.SyncToken }),
        });
        if (!r.ok) return { success: false, error: r.data?.Fault?.Error?.[0]?.Detail || `HTTP ${r.status}` };
        return { success: true, data: r.data?.Invoice };
      }
      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(qbAdapter);
