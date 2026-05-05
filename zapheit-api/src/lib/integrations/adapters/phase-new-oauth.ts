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
  try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ─── Xero (15-minute access tokens) ────────────────────────────────────────

export const XeroAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.xero.com/connections', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Xero successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.XERO_CLIENT_ID || '';
    const clientSecret = process.env.XERO_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('XERO_CLIENT_ID/XERO_CLIENT_SECRET not configured');
    return (await postForm('https://identity.xero.com/connect/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Box ────────────────────────────────────────────────────────────────────

export const BoxAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.box.com/2.0/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Box successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.BOX_CLIENT_ID || '';
    const clientSecret = process.env.BOX_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('BOX_CLIENT_ID/BOX_CLIENT_SECRET not configured');
    return (await postForm('https://api.box.com/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Dropbox Business ────────────────────────────────────────────────────────

export const DropboxBusinessAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: 'null',
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Dropbox Business successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.DROPBOX_CLIENT_ID || '';
    const clientSecret = process.env.DROPBOX_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('DROPBOX_CLIENT_ID/DROPBOX_CLIENT_SECRET not configured');
    return (await postForm('https://api.dropbox.com/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Asana ──────────────────────────────────────────────────────────────────

export const AsanaAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://app.asana.com/api/1.0/users/me', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Asana successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.ASANA_CLIENT_ID || '';
    const clientSecret = process.env.ASANA_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('ASANA_CLIENT_ID/ASANA_CLIENT_SECRET not configured');
    return (await postForm('https://app.asana.com/-/oauth_token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Monday.com ──────────────────────────────────────────────────────────────

export const MondayAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.monday.com/v2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ me { id name } }' }),
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Monday.com successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.MONDAY_CLIENT_ID || '';
    const clientSecret = process.env.MONDAY_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('MONDAY_CLIENT_ID/MONDAY_CLIENT_SECRET not configured');
    return (await postForm('https://auth.monday.com/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Miro ────────────────────────────────────────────────────────────────────

export const MiroAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.miro.com/v1/oauth-token', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Miro successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.MIRO_CLIENT_ID || '';
    const clientSecret = process.env.MIRO_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('MIRO_CLIENT_ID/MIRO_CLIENT_SECRET not configured');
    return (await postForm('https://api.miro.com/v1/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Zoom ────────────────────────────────────────────────────────────────────

export const ZoomAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.zoom.us/v2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Zoom successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.ZOOM_CLIENT_ID || '';
    const clientSecret = process.env.ZOOM_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET not configured');
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    const res = await fetchWithTimeout('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const raw = await res.text();
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
    if (!res.ok) throw new Error(json?.reason || json?.error || `HTTP ${res.status}`);
    return json as TokenResponse;
  },
};

// ─── Zoho CRM ────────────────────────────────────────────────────────────────

export const ZohoCRMAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://www.zohoapis.com/crm/v3/users?type=CurrentUser', {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Zoho CRM successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.ZOHO_CLIENT_ID || '';
    const clientSecret = process.env.ZOHO_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET not configured');
    return (await postForm('https://accounts.zoho.com/oauth/v2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Zoho Recruit ────────────────────────────────────────────────────────────

export const ZohoRecruitAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://recruit.zoho.com/recruit/v2/users?type=CurrentUser', {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Zoho Recruit successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.ZOHO_CLIENT_ID || '';
    const clientSecret = process.env.ZOHO_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET not configured');
    return (await postForm('https://accounts.zoho.com/oauth/v2/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Intercom ────────────────────────────────────────────────────────────────

export const IntercomAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.intercom.io/me', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Intercom successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.INTERCOM_CLIENT_ID || '';
    const clientSecret = process.env.INTERCOM_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('INTERCOM_CLIENT_ID/INTERCOM_CLIENT_SECRET not configured');
    return (await postForm('https://api.intercom.io/auth/eagle/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Calendly ────────────────────────────────────────────────────────────────

export const CalendlyAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 401) return { success: false, message: 'Token expired. Please refresh or reconnect.' };
        return { success: false, message: `API Error: ${res.status}` };
      }
      return { success: true, message: 'Connected to Calendly successfully' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decryptSecret(credentials.refresh_token || '');
    const clientId = process.env.CALENDLY_CLIENT_ID || '';
    const clientSecret = process.env.CALENDLY_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) throw new Error('CALENDLY_CLIENT_ID/CALENDLY_CLIENT_SECRET not configured');
    return (await postForm('https://auth.calendly.com/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    })) as TokenResponse;
  },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const NewOAuthAdapters: Record<string, IntegrationAdapter> = {
  xero: XeroAdapter,
  box: BoxAdapter,
  dropbox_business: DropboxBusinessAdapter,
  asana: AsanaAdapter,
  monday: MondayAdapter,
  miro: MiroAdapter,
  zoom: ZoomAdapter,
  zoho_crm: ZohoCRMAdapter,
  zoho_recruit: ZohoRecruitAdapter,
  intercom: IntercomAdapter,
  calendly: CalendlyAdapter,
};
