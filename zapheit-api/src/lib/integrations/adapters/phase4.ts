import type { ConnectionTestResult, IntegrationAdapter, TokenResponse } from '../spec-types';
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

async function postForm(url: string, data: Record<string, string>): Promise<any> {
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => body.set(k, v));
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const raw = await res.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = { raw };
  }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

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

export const GoogleWorkspaceAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://www.googleapis.com/oauth2/v3/userinfo', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Google Workspace successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not configured');

    return (await postForm('https://oauth2.googleapis.com/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

export const Microsoft365Adapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Microsoft 365 successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.MICROSOFT_CLIENT_ID || '';
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET not configured');

    return (await postForm('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

export const TeamsAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    return Microsoft365Adapter.testConnection(credentials);
  },
  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    return Microsoft365Adapter.refreshToken!(credentials);
  },
};

export const SlackAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({}).toString(),
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      if (!json?.ok) {
        const msg = json?.error || 'auth.test failed';
        if (msg.includes('token')) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: msg };
      }
      return { success: true, message: 'Connected to Slack successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const DeelAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://app.deel.com/rest/v2/profile', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Deel successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.DEEL_CLIENT_ID || '';
    const clientSecret = process.env.DEEL_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('DEEL_CLIENT_ID/DEEL_CLIENT_SECRET not configured');

    return (await postForm('https://auth.deel.com/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

export const GustoAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.gusto.com/v1/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Gusto successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.GUSTO_CLIENT_ID || '';
    const clientSecret = process.env.GUSTO_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('GUSTO_CLIENT_ID/GUSTO_CLIENT_SECRET not configured');

    return (await postForm('https://api.gusto.com/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

export const FlockAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.flock.com/v1/users.list', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Flock successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.FLOCK_CLIENT_ID || '';
    const clientSecret = process.env.FLOCK_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('FLOCK_CLIENT_ID/FLOCK_CLIENT_SECRET not configured');

    return (await postForm('https://api.flock.com/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

export const OktaAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const domain = normalizeDomain(decryptSecret(credentials.domain || ''));
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout(`https://${domain}/userinfo`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Okta / Auth0 successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const domain = normalizeDomain(decryptSecret(credentials.domain || ''));
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.OKTA_CLIENT_ID || '';
    const clientSecret = process.env.OKTA_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('OKTA_CLIENT_ID/OKTA_CLIENT_SECRET not configured');

    return (await postForm(`https://${domain}/oauth2/v1/token`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

export const ZendeskAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const subdomain = normalizeDomain(decryptSecret(credentials.subdomain || ''));
      const email = decryptSecret(credentials.email || '');
      const apiToken = decryptSecret(credentials.api_token || '');
      if (!subdomain) return { success: false, message: 'Missing subdomain' };
      const url = `https://${subdomain}.zendesk.com/api/v2/users/me.json`;
      const auth = basicAuthHeader(`${email}/token`, apiToken);
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Zendesk successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const FreshdeskAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const domain = normalizeDomain(decryptSecret(credentials.domain || ''));
      const apiKey = decryptSecret(credentials.api_key || '');
      if (!domain) return { success: false, message: 'Missing domain' };
      const url = `https://${domain}.freshdesk.com/api/v2/agents/me`;
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Authorization: basicAuthHeader(apiKey, 'X'), Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Freshdesk successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

function normalizeUrl(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed.replace(/\/+$/, '') : `https://${trimmed.replace(/\/+$/, '')}`;
}

export const JiraAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const baseUrl = normalizeUrl(decryptSecret(credentials.base_url || ''));
      const email = decryptSecret(credentials.email || '');
      const apiToken = decryptSecret(credentials.api_token || '');
      if (!baseUrl) return { success: false, message: 'Missing base_url' };
      const url = `${baseUrl}/rest/api/3/myself`;
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Authorization: basicAuthHeader(email, apiToken), Accept: 'application/json' },
      });
      if (res.status === 401) return { success: false, message: 'Invalid credentials — check your email and API token' };
      if (res.status === 403) return { success: false, message: 'Access denied — ensure your API token has the right permissions' };
      if (res.status === 404) return { success: false, message: 'Jira not found at this URL — verify Jira Software is activated on your Atlassian site and the base URL is correct (e.g. https://yourcompany.atlassian.net)' };
      if (!res.ok) return { success: false, message: `Jira API error: ${res.status}` };
      return { success: true, message: 'Connected to Jira successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const HubSpotAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const token = decryptSecret(credentials.private_app_token || credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.hubapi.com/account-info/v3/details', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to HubSpot successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const StripeAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const secretKey = decryptSecret(credentials.secret_key || '');
      const res = await fetchWithTimeout('https://api.stripe.com/v1/account', {
        method: 'GET',
        headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Stripe successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const CashfreeAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const keyId = decryptSecret(credentials.key_id || '');
      const keySecret = decryptSecret(credentials.key_secret || '');
      const res = await fetchWithTimeout('https://api.cashfree.com/v1/payments?count=1', {
        method: 'GET',
        headers: { Authorization: basicAuthHeader(keyId, keySecret), Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Cashfree successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const KekaAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const clientId = decryptSecret(credentials.client_id || '');
      const clientSecret = decryptSecret(credentials.client_secret || '');
      const subdomain = (decryptSecret(credentials.subdomain || '') || '').trim();
      if (!clientId || !clientSecret || !subdomain) return { success: false, message: 'Missing client credentials' };

      const token = await postForm(`https://${encodeURIComponent(subdomain)}.keka.com/oauth/token`, {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      const accessToken = token?.access_token;
      if (!accessToken) return { success: false, message: 'No access token returned' };

      const res = await fetchWithTimeout(`https://${encodeURIComponent(subdomain)}.keka.com/api/v1/employees?limit=1`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Keka successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const CashfreeXAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const keyId = decryptSecret(credentials.key_id || '');
      const keySecret = decryptSecret(credentials.key_secret || '');
      const res = await fetchWithTimeout('https://api.cashfree.com/v1/fund_accounts?count=1', {
        method: 'GET',
        headers: { Authorization: basicAuthHeader(keyId, keySecret) },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to CashfreeX successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const WhatsAppCloudAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const phoneNumberId = decryptSecret(credentials.phone_number_id || '');
      if (!accessToken || !phoneNumberId) {
        return { success: false, message: 'Missing access_token or phone_number_id' };
      }
      const res = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      const data = await res.json().catch(() => null) as any;
      return { success: true, message: `Connected to WhatsApp Business – ${data?.verified_name || phoneNumberId}` };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const EpfoAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const establishmentId = decryptSecret(credentials.establishment_id || '');
      const apiKey = decryptSecret(credentials.api_key || '');
      const dsc = decryptSecret(credentials.dsc || '');
      const url = `https://api.epfindia.gov.in/v1/establishment?establishment_id=${encodeURIComponent(establishmentId)}`;
      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          'X-DSC': dsc,
        },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to EPFO successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },
};

export const Phase4Adapters: Record<string, IntegrationAdapter> = {
  zendesk: ZendeskAdapter,
  freshdesk: FreshdeskAdapter,
  jira: JiraAdapter,
  hubspot: HubSpotAdapter,
  stripe: StripeAdapter,
  cashfree: CashfreeAdapter,
  'google-workspace': GoogleWorkspaceAdapter,
  'microsoft-365': Microsoft365Adapter,
  'microsoft-teams': TeamsAdapter,
  slack: SlackAdapter,
  deel: DeelAdapter,
  gusto: GustoAdapter,
  flock: FlockAdapter,
  okta: OktaAdapter,
  keka: KekaAdapter,
  cashfreex: CashfreeXAdapter,
  whatsapp: WhatsAppCloudAdapter,
  epfo: EpfoAdapter,
};
