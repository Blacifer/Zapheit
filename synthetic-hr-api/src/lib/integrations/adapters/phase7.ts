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

// ─── Marketing ───────────────────────────────────────────────────────────────

export const BrevoAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.brevo.com/v3/account', {
        headers: { 'api-key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Brevo successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const MoEngageAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const appId = decryptSecret(credentials.app_id || '');
      const res = await fetchWithTimeout(`https://api.moengage.com/v1/segments?app_id=${encodeURIComponent(appId)}&limit=1`, {
        headers: { Authorization: basicAuthHeader(appId, apiKey), Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to MoEngage successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const CleverTapAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accountId = decryptSecret(credentials.account_id || '');
      const passcode = decryptSecret(credentials.passcode || '');
      const res = await fetchWithTimeout('https://api.clevertap.com/1/counts/events.json', {
        method: 'POST',
        headers: {
          'X-CleverTap-Account-Id': accountId,
          'X-CleverTap-Passcode': passcode,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_name: 'App Launched', from: 20200101, to: 20200101 }),
      });
      if (res.status === 401) return { success: false, message: 'Invalid account ID or passcode' };
      if (!res.ok && res.status !== 200) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to CleverTap successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const MailmodoAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.mailmodo.com/api/v1/lists', {
        headers: { mmApiKey: apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Mailmodo successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const WebEngageAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const licenseCode = decryptSecret(credentials.license_code || '');
      const res = await fetchWithTimeout(`https://api.webengage.com/v1/accounts/${licenseCode}/users?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to WebEngage successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const MailchimpAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const serverPrefix = decryptSecret(credentials.server_prefix || '');
      const server = serverPrefix || apiKey.split('-').pop() || 'us1';
      const res = await fetchWithTimeout(`https://${server}.api.mailchimp.com/3.0/ping`, {
        headers: { Authorization: basicAuthHeader('anystring', apiKey) },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Mailchimp successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Analytics ───────────────────────────────────────────────────────────────

export const MixpanelAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiSecret = decryptSecret(credentials.api_secret || '');
      const res = await fetchWithTimeout('https://mixpanel.com/api/2.0/engage?page_size=1', {
        headers: { Authorization: basicAuthHeader(apiSecret, ''), Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Mixpanel successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const AmplitudeAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const secretKey = decryptSecret(credentials.secret_key || '');
      const res = await fetchWithTimeout('https://amplitude.com/api/2/useractivity?user=test@test.com', {
        headers: { Authorization: basicAuthHeader(apiKey, secretKey) },
      });
      // 400 means auth worked but user not found — still a valid connection
      if (res.status === 401 || res.status === 403) return { success: false, message: 'Invalid API key or secret' };
      return { success: true, message: 'Connected to Amplitude successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const SegmentAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const writeKey = decryptSecret(credentials.write_key || '');
      // Segment identify with a test user — 200 means the write key is valid
      const res = await fetchWithTimeout('https://api.segment.io/v1/identify', {
        method: 'POST',
        headers: {
          Authorization: basicAuthHeader(writeKey, ''),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: 'zapheit-connection-test', traits: { test: true } }),
      });
      if (res.status === 401) return { success: false, message: 'Invalid write key' };
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Segment successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const MetabaseAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const instanceUrl = (decryptSecret(credentials.instance_url || '') || '').replace(/\/$/, '');
      const res = await fetchWithTimeout(`${instanceUrl}/api/user/current`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Metabase successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const PostHogAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://app.posthog.com/api/users/@me/', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to PostHog successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const NotionAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const token = decryptSecret(credentials.token || '');
      const res = await fetchWithTimeout('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Notion successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const InVideoAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.invideo.io/v1/projects?limit=1', {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to InVideo successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const TableauAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const tokenName = decryptSecret(credentials.token_name || '');
      const tokenSecret = decryptSecret(credentials.token_secret || '');
      const serverUrl = (decryptSecret(credentials.server_url || '') || '').replace(/\/$/, '');
      const res = await fetchWithTimeout(`${serverUrl}/api/3.19/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          credentials: { personalAccessTokenName: tokenName, personalAccessTokenSecret: tokenSecret, site: { contentUrl: '' } },
        }),
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Tableau successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const SnowflakeAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const account = decryptSecret(credentials.account || '');
      const username = decryptSecret(credentials.username || '');
      const password = decryptSecret(credentials.password || '');
      // Use Snowflake REST API login
      const res = await fetchWithTimeout(`https://${account}.snowflakecomputing.com/session/v1/login-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          data: { ACCOUNT_NAME: account, LOGIN_NAME: username, PASSWORD: password, CLIENT_APP_ID: 'Zapheit' },
        }),
      });
      if (res.status === 403 || res.status === 401) return { success: false, message: 'Invalid Snowflake credentials' };
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Snowflake successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const GitHubAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const token = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to GitHub successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const GitLabAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const token = decryptSecret(credentials.access_token || '');
      const res = await fetchWithTimeout('https://gitlab.com/api/v4/user', {
        headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to GitLab successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const Phase7Adapters: Record<string, IntegrationAdapter> = {
  brevo: BrevoAdapter,
  moengage: MoEngageAdapter,
  clevertap: CleverTapAdapter,
  mailmodo: MailmodoAdapter,
  webengage: WebEngageAdapter,
  mailchimp: MailchimpAdapter,
  mixpanel: MixpanelAdapter,
  amplitude: AmplitudeAdapter,
  segment: SegmentAdapter,
  metabase: MetabaseAdapter,
  posthog: PostHogAdapter,
  notion: NotionAdapter,
  invideo: InVideoAdapter,
  tableau: TableauAdapter,
  snowflake: SnowflakeAdapter,
  github: GitHubAdapter,
  gitlab: GitLabAdapter,
};
