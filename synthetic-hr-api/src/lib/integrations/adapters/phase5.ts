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

// ─── IT / DevOps ─────────────────────────────────────────────────────────────

export const JiraServiceManagementAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const siteUrl = decryptSecret(credentials.site_url || '').replace(/\/$/, '');
      const email = decryptSecret(credentials.email || '');
      const apiToken = decryptSecret(credentials.api_token || '');
      const res = await fetchWithTimeout(`${siteUrl}/rest/servicedeskapi/servicedesk`, {
        headers: {
          Authorization: basicAuthHeader(email, apiToken),
          Accept: 'application/json',
        },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Jira Service Management successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const PagerDutyAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.pagerduty.com/users/me', {
        headers: { Authorization: `Token token=${apiKey}`, Accept: 'application/vnd.pagerduty+json;version=2' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to PagerDuty successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const DatadogAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const appKey = decryptSecret(credentials.app_key || '');
      const res = await fetchWithTimeout('https://api.datadoghq.com/api/v1/validate', {
        headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Datadog successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const NewRelicAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const accountId = decryptSecret(credentials.account_id || '');
      const res = await fetchWithTimeout(`https://api.newrelic.com/v2/applications.json`, {
        headers: { 'X-Api-Key': apiKey },
      });
      if (res.status === 403) return { success: false, message: 'Invalid API key' };
      if (!res.ok && res.status !== 200) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: `Connected to New Relic (account ${accountId}) successfully` };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const SentryAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const token = decryptSecret(credentials.auth_token || '');
      const org = decryptSecret(credentials.organization || '');
      const res = await fetchWithTimeout(`https://sentry.io/api/0/organizations/${org}/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Sentry successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const PostmanAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const res = await fetchWithTimeout('https://api.getpostman.com/me', {
        headers: { 'X-Api-Key': apiKey },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Postman successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const BrowserStackAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const username = decryptSecret(credentials.username || '');
      const accessKey = decryptSecret(credentials.access_key || '');
      const res = await fetchWithTimeout('https://api.browserstack.com/automate/plan.json', {
        headers: { Authorization: basicAuthHeader(username, accessKey) },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to BrowserStack successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const FreshserviceAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const domain = normalizeDomain(decryptSecret(credentials.domain || ''));
      const res = await fetchWithTimeout(`https://${domain}.freshservice.com/api/v2/tickets?per_page=1`, {
        headers: { Authorization: basicAuthHeader(apiKey, 'X') },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Freshservice successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const KissflowAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decryptSecret(credentials.api_key || '');
      const accountId = decryptSecret(credentials.account_id || '');
      const res = await fetchWithTimeout(`https://api.kissflow.com/flow/2/${accountId}/process?pageSize=1`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to Kissflow successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

export const OnePasswordAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const token = decryptSecret(credentials.service_account_token || '');
      const res = await fetchWithTimeout('https://events.1password.com/api/v1/auditevents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 1 }),
      });
      if (res.status === 401) return { success: false, message: 'Invalid service account token' };
      if (!res.ok && res.status !== 200) return { success: false, message: `API Error: ${res.status}` };
      return { success: true, message: 'Connected to 1Password successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

// ─── Cloud ────────────────────────────────────────────────────────────────────

export const AWSAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessKeyId = decryptSecret(credentials.access_key_id || '');
      const secretAccessKey = decryptSecret(credentials.secret_access_key || '');
      const region = decryptSecret(credentials.region || '') || 'ap-south-1';
      // Use STS GetCallerIdentity — works with any valid credentials, no IAM permissions needed
      const endpoint = `https://sts.${region}.amazonaws.com/`;
      const date = new Date();
      const dateStr = date.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 8);
      const amzDate = date.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
      const body = 'Action=GetCallerIdentity&Version=2011-06-15';
      const contentHash = await sha256Hex(body);
      const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:sts.${region}.amazonaws.com\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-date';
      const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${contentHash}`;
      const credentialScope = `${dateStr}/${region}/sts/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
      const signingKey = await getAWS4SigningKey(secretAccessKey, dateStr, region, 'sts');
      const signature = await hmacHex(signingKey, stringToSign);
      const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Amz-Date': amzDate,
          Authorization: authHeader,
        },
        body,
      });
      if (res.status === 403) return { success: false, message: 'Invalid AWS credentials' };
      if (!res.ok) return { success: false, message: `AWS STS error: ${res.status}` };
      return { success: true, message: 'Connected to AWS successfully' };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

async function sha256Hex(data: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSHA256(key: ArrayBuffer | ArrayBufferView, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function hmacHex(key: ArrayBuffer | ArrayBufferView, data: string): Promise<string> {
  const buf = await hmacSHA256(key, data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getAWS4SigningKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSHA256(new TextEncoder().encode(`AWS4${secret}`), date);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, service);
  return hmacSHA256(kService, 'aws4_request');
}

export const GCPAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const saJson = decryptSecret(credentials.service_account_json || '');
      const projectId = decryptSecret(credentials.project_id || '');
      let sa: any;
      try {
        sa = JSON.parse(saJson);
      } catch {
        return { success: false, message: 'Invalid service account JSON — could not parse' };
      }
      if (!sa.client_email || !sa.private_key) {
        return { success: false, message: 'Service account JSON missing client_email or private_key' };
      }
      // Get an access token via JWT assertion
      const token = await getGCPAccessToken(sa);
      const res = await fetchWithTimeout(
        `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 403) return { success: false, message: 'Service account lacks resourcemanager.projects.get permission' };
      if (!res.ok) return { success: false, message: `GCP API error: ${res.status}` };
      return { success: true, message: `Connected to GCP project ${projectId} successfully` };
    } catch (e: any) {
      return { success: false, message: `Connection failed: ${e?.message || String(e)}` };
    }
  },
};

async function getGCPAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${header}.${payload}`;
  // Import RSA private key and sign
  const pem = sa.private_key.replace(/\\n/g, '\n');
  const pemBody = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const keyBuffer = Buffer.from(pemBody, 'base64');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const sigB64 = Buffer.from(sig).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${unsigned}.${sigB64}`;
  const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Failed to get GCP token: ${tokenRes.status}`);
  const data: any = await tokenRes.json();
  return data.access_token;
}

export const Phase5Adapters: Record<string, IntegrationAdapter> = {
  'jira-service-management': JiraServiceManagementAdapter,
  pagerduty: PagerDutyAdapter,
  datadog: DatadogAdapter,
  newrelic: NewRelicAdapter,
  sentry: SentryAdapter,
  postman: PostmanAdapter,
  browserstack: BrowserStackAdapter,
  freshservice: FreshserviceAdapter,
  kissflow: KissflowAdapter,
  '1password': OnePasswordAdapter,
  aws: AWSAdapter,
  gcp: GCPAdapter,
};
