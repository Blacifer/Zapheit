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

function normalizeDomain(value: string) {
  let v = (value || '').trim();
  v = v.replace(/^https?:\/\//i, '');
  v = v.replace(/\/.*$/, '');
  return v;
}

// ─── HR ──────────────────────────────────────────────────────────────────────

export const BambooHRAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const subdomain = normalizeDomain(decryptSecret(credentials.subdomain || ''));
      const res = await fetchWithTimeout(`https://api.bamboohr.com/api/gateway.php/${subdomain}/v1/employees/directory`, {
        headers: { Authorization: basicAuthHeader(apiKey, 'x'), Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to BambooHR successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const FreshteamAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const subdomain = normalizeDomain(decryptSecret(credentials.subdomain || ''));
      const res = await fetchWithTimeout(`https://${subdomain}.freshteam.com/api/employees?page=1&per_page=1`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Freshteam successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const ZimyoAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.zimyo.com/v1/employee/list?page=1&limit=1', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Zimyo successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const HROneAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const companyCode = decryptSecret(credentials.company_code || '');
      const res = await fetchWithTimeout(`https://api.hrone.cloud/v1/${companyCode}/employees?page=1&per_page=1`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to HROne successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Recruitment ─────────────────────────────────────────────────────────────

export const PipedriveAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiToken = decryptSecret(credentials.api_token || '');
      const res = await fetchWithTimeout(`https://api.pipedrive.com/v1/users/me?api_token=${encodeURIComponent(apiToken)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Pipedrive successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const GreenhouseAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://harvest.greenhouse.io/v1/jobs?per_page=1', {
        headers: { Authorization: basicAuthHeader(apiKey, ''), Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Greenhouse successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const ShineAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.shine.com/v2/jobs?count=1', {
        headers: { 'X-Shine-Api-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Shine.com successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const IIMJobsAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.iimjobs.com/v1/jobs?limit=1', {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to IIMJobs successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const WorkableAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const subdomain = normalizeDomain(decryptSecret(credentials.subdomain || ''));
      const res = await fetchWithTimeout(`https://${subdomain}.workable.com/spi/v3/jobs?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Workable successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const InstahyreAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.instahyre.com/api/v1/jobs/?limit=1', {
        headers: { Authorization: `Token ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Instahyre successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const CutshortAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://cutshort.io/api/v1/jobs?limit=1', {
        headers: { 'x-cutshort-token': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Cutshort successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Communication ───────────────────────────────────────────────────────────

export const WhatsAppBusinessAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const phoneNumberId = decryptSecret(credentials.phone_number_id || '');
      const res = await fetchWithTimeout(`https://graph.facebook.com/v18.0/${phoneNumberId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to WhatsApp Business successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const Phase6Adapters: Record<string, IntegrationAdapter> = {
  bamboohr: BambooHRAdapter,
  freshteam: FreshteamAdapter,
  zimyo: ZimyoAdapter,
  hrone: HROneAdapter,
  pipedrive: PipedriveAdapter,
  greenhouse: GreenhouseAdapter,
  shine: ShineAdapter,
  iimjobs: IIMJobsAdapter,
  workable: WorkableAdapter,
  instahyre: InstahyreAdapter,
  cutshort: CutshortAdapter,
  'whatsapp-business': WhatsAppBusinessAdapter,
};
