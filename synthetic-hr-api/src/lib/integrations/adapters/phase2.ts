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

export const GreythrAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const companyId = decryptSecret(credentials.company_id || '');
      const subdomain = decryptSecret(credentials.subdomain || '');

      const response = await fetchWithTimeout('https://api.greythr.com/v2/employees?limit=1', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          'X-Company-Id': companyId,
          'X-Subdomain': subdomain,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to Greythr successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const ZohoRecruitAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const response = await fetchWithTimeout('https://recruit.zoho.com/recruit/v2/Candidates?per_page=1', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        if (response.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${response.status}` };
      }
      return { success: true, message: 'Connected to Zoho Recruit successfully' };
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

export const ApnaAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const employerId = decryptSecret(credentials.employer_id || '');
      const response = await fetchWithTimeout('https://api.apna.co/v1/jobs?limit=1', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          'X-Employer-Id': employerId,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to Apna successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const AadhaarAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const licenseKey = decryptSecret(credentials.license_key || '');
      const auaCode = decryptSecret(credentials.aua_code || '');
      const subAuaCode = decryptSecret(credentials.sub_aua_code || '');
      const response = await fetchWithTimeout('https://api.uidai.gov.in/v1/status', {
        method: 'GET',
        headers: {
          'X-License-Key': licenseKey,
          'X-AUA-Code': auaCode,
          'X-Sub-AUA-Code': subAuaCode,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to Aadhaar API successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const Phase2Adapters: Record<string, IntegrationAdapter> = {
  greythr: GreythrAdapter,
  zoho_recruit: ZohoRecruitAdapter,
  apna: ApnaAdapter,
  aadhaar: AadhaarAdapter,
};

