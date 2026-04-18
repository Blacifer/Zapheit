import type { ConnectionTestResult, IntegrationAdapter, TokenResponse } from '../spec-types';
import { decryptSecret } from '../encryption';

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export const NaukriAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const clientId = decryptSecret(credentials.client_id || '');
      const response = await fetchWithTimeout('https://api.naukri.com/v1/jobs?limit=1', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          'X-Client-Id': clientId,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to Naukri.com successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const ClearTaxAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const gstin = decryptSecret(credentials.gstin || '');
      const url = `https://api.cleartax.in/v1/compliance/status?gstin=${encodeURIComponent(gstin)}`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'X-Cleartax-Api-Key': apiKey,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to ClearTax successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const ZohoPeopleAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const response = await fetchWithTimeout('https://people.zoho.com/api/v1/employees', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        if (response.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${response.status}` };
      }
      return { success: true, message: 'Connected to Zoho People successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.ZOHO_CLIENT_ID || '';
    const clientSecret = process.env.ZOHO_CLIENT_SECRET || '';
    const response = await fetchWithTimeout('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Token refresh failed: ${response.status} ${text}`);
    }
    return (await response.json()) as TokenResponse;
  },
};

export const LinkedInAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const response = await fetchWithTimeout('https://api.linkedin.com/v2/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        if (response.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${response.status}` };
      }
      return { success: true, message: 'Connected to LinkedIn successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const TallyAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const serverUrl = decryptSecret(credentials.server_url || '');
      const xmlRequest = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Company Information</ID></HEADER><BODY></BODY></ENVELOPE>`;
      const response = await fetchWithTimeout(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: xmlRequest,
      });
      if (!response.ok) return { success: false, message: 'Cannot connect to Tally server' };
      return { success: true, message: 'Connected to Tally.ERP successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const Phase1Adapters: Record<string, IntegrationAdapter> = {
  naukri: NaukriAdapter,
  cleartax: ClearTaxAdapter,
  'zoho-people': ZohoPeopleAdapter,
  'linkedin-recruiter': LinkedInAdapter,
  tally: TallyAdapter,
};
