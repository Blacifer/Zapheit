import type { ConnectionTestResult, IntegrationAdapter } from '../spec-types';
import { decryptSecret } from '../encryption';

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

function basicAuthHeader(username: string, password: string) {
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

// ─── Finance ─────────────────────────────────────────────────────────────────

export const PayUAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const merchantKey = decryptSecret(credentials.merchant_key || '');
      const merchantSalt = decryptSecret(credentials.merchant_salt || '');
      if (!merchantKey || !merchantSalt) return { success: false, message: 'Merchant key and salt are required' };
      // PayU does not have a simple ping endpoint; validate by checking key length/format
      if (merchantKey.length < 6) return { success: false, message: 'Invalid merchant key format' };
      return { success: true, message: 'PayU credentials saved — live validation occurs on first transaction' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const CashfreeAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const appId = decryptSecret(credentials.app_id || '');
      const secretKey = decryptSecret(credentials.secret_key || '');
      const res = await fetchWithTimeout('https://api.cashfree.com/pg/orders?count=1', {
        headers: {
          'x-client-id': appId,
          'x-client-secret': secretKey,
          'x-api-version': '2023-08-01',
          Accept: 'application/json',
        },
      });
      if (res.status === 401) return { success: false, message: 'Invalid App ID or Secret Key' };
      if (!res.ok && res.status !== 404) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Cashfree successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const ChargebeeAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const site = decryptSecret(credentials.site || '');
      const res = await fetchWithTimeout(`https://${site}.chargebee.com/api/v2/subscriptions?limit=1`, {
        headers: { Authorization: basicAuthHeader(apiKey, '') },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Chargebee successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const PaytmBusinessAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const merchantId = decryptSecret(credentials.merchant_id || '');
      const merchantKey = decryptSecret(credentials.merchant_key || '');
      if (!merchantId || !merchantKey) return { success: false, message: 'Merchant ID and key are required' };
      // Paytm credentials are validated on first API call; store and confirm format
      if (merchantId.length < 4) return { success: false, message: 'Invalid merchant ID format' };
      return { success: true, message: 'Paytm Business credentials saved — validated on first API call' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const ZohoBooksAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const orgId = decryptSecret(credentials.organization_id || '');
      const res = await fetchWithTimeout(`https://www.zohoapis.com/books/v3/organizations/${orgId}`, {
        headers: { Authorization: `Zoho-oauthtoken ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Zoho Books successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const MargERPAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      if (!apiKey) return { success: false, message: 'API key is required' };
      const res = await fetchWithTimeout('https://api.margcompusoft.com/v1/health', {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Marg ERP 9+ successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Legal / E-Sign ──────────────────────────────────────────────────────────

export const DocuSignAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const accountId = decryptSecret(credentials.account_id || '');
      const res = await fetchWithTimeout(`https://na3.docusign.net/restapi/v2.1/accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to DocuSign successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const LeegalityAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://app.leegality.com/api/v3.0/document/list?page=1&pageSize=1', {
        headers: { Authorization: apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Leegality successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const ZohoSignAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://sign.zoho.com/api/v1/requests?page_context={"row_count":"1"}', {
        headers: { Authorization: `Zoho-oauthtoken ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Zoho Sign successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Support ─────────────────────────────────────────────────────────────────

export const HelpScoutAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.helpscout.net/v2/conversations?status=active&page=1', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Help Scout successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Sales ───────────────────────────────────────────────────────────────────

export const LeadSquaredAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessKey = decryptSecret(credentials.access_key || '');
      const secretKey = decryptSecret(credentials.secret_key || '');
      const host = decryptSecret(credentials.host || '') || 'api.leadsquared.com';
      const res = await fetchWithTimeout(
        `https://${host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}&Parameter.Page=1&Parameter.PageSize=1`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to LeadSquared successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Compliance ───────────────────────────────────────────────────────────────

export const VantaAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiToken = decryptSecret(credentials.api_token || '');
      const res = await fetchWithTimeout('https://api.vanta.com/v1/controls?pageSize=1', {
        headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Vanta successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const DrataAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://public-api.drata.com/public/controls?limit=1', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Drata successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const VakilsearchAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.vakilsearch.com/v1/compliance/status', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Vakilsearch successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Productivity / E-commerce ────────────────────────────────────────────────

export const WhatfixAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.whatfix.com/v1/analytics/flows?limit=1', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Whatfix successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const ShiprocketAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const email = decryptSecret(credentials.email || '');
      const password = decryptSecret(credentials.password || '');
      // Shiprocket uses email+password to get a JWT token
      const tokenRes = await fetchWithTimeout('https://apiv2.shiprocket.in/v1/external/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!tokenRes.ok) return { success: false, message: 'Invalid Shiprocket email or password' };
      const data: any = await tokenRes.json();
      if (!data.token) return { success: false, message: 'Failed to obtain Shiprocket token' };
      return { success: true, message: 'Connected to Shiprocket successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const UnicommerceAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const facilityCode = decryptSecret(credentials.facility_code || '');
      const res = await fetchWithTimeout(
        `https://increff.unicommerce.com/services/rest/v1/inventory/itemType/searchAll?facilityCode=${encodeURIComponent(facilityCode)}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      );
      if (res.status === 401) return { success: false, message: 'Invalid access token' };
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Unicommerce successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const Phase8Adapters: Record<string, IntegrationAdapter> = {
  payu: PayUAdapter,
  cashfree: CashfreeAdapter,
  chargebee: ChargebeeAdapter,
  'paytm-business': PaytmBusinessAdapter,
  'zoho-books': ZohoBooksAdapter,
  'marg-erp': MargERPAdapter,
  docusign: DocuSignAdapter,
  leegality: LeegalityAdapter,
  'zoho-sign': ZohoSignAdapter,
  helpscout: HelpScoutAdapter,
  leadsquared: LeadSquaredAdapter,
  vanta: VantaAdapter,
  drata: DrataAdapter,
  vakilsearch: VakilsearchAdapter,
  whatfix: WhatfixAdapter,
  shiprocket: ShiprocketAdapter,
  unicommerce: UnicommerceAdapter,
};
