import type { ConnectionTestResult, IntegrationAdapter } from '../spec-types';
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

export const DigiLockerAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const response = await fetchWithTimeout('https://api.digitallocker.gov.in/public/oauth2/1/files', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        if (response.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${response.status}` };
      }
      return { success: true, message: 'Connected to DigiLocker successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const IdfyAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const accountId = decryptSecret(credentials.account_id || '');
      const response = await fetchWithTimeout('https://api.idfy.com/v3/status', {
        method: 'GET',
        headers: {
          'api-key': apiKey,
          'account-id': accountId,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to IDfy successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const ZohoLearnAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      // Base path is not in the spec; this endpoint is the most likely common REST pattern.
      const response = await fetchWithTimeout('https://learn.zoho.com/api/v1/courses?per_page=1', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        if (response.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${response.status}` };
      }
      return { success: true, message: 'Connected to Zoho Learn successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const PaytmAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const merchantId = decryptSecret(credentials.merchant_id || '');
      const merchantKey = decryptSecret(credentials.merchant_key || '');
      const channelId = decryptSecret(credentials.channel_id || '');

      const response = await fetchWithTimeout('https://api.paytm.com/v1/merchant/status', {
        method: 'GET',
        headers: {
          'X-Merchant-Id': merchantId,
          'X-Merchant-Key': merchantKey,
          'X-Channel-Id': channelId,
        },
      });
      if (!response.ok) return { success: false, message: `API Error: ${response.status}` };
      return { success: true, message: 'Connected to Paytm successfully' };
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error?.message || String(error)}` };
    }
  },
};

export const Phase3Adapters: Record<string, IntegrationAdapter> = {
  digilocker: DigiLockerAdapter,
  idfy: IdfyAdapter,
  zoho_learn: ZohoLearnAdapter,
  paytm: PaytmAdapter,
};

