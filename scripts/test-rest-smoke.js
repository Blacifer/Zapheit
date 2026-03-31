#!/usr/bin/env node

/**
 * REST Endpoint Smoke Test
 * Validates migrated endpoints with authenticated requests.
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@rasi.ai';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '';
const RUN_GATEWAY_SMOKE = process.env.RUN_GATEWAY_SMOKE === '1';
const CLEANUP = process.env.CLEANUP !== '0';
const normalizedApiBase = API_URL.replace(/\/+$/, '');
const apiBase = normalizedApiBase.endsWith('/api')
  ? normalizedApiBase.slice(0, -4)
  : normalizedApiBase;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEMO_PASSWORD) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and DEMO_PASSWORD are required. Set them in your environment before running this test.');
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const state = {
  token: '',
  userId: '',
  agentId: '',
  incidentId: '',
  apiKeyId: '',
  apiKeySecret: '',
};
const cleanupTasks = [];

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function unwrapRecord(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (payload && Array.isArray(payload.data)) return payload.data[0] || null;
  if (payload && payload.data && typeof payload.data === 'object') return payload.data;
  return payload || null;
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
}

async function ensureAuth() {
  const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });

  const signInData = await signInResponse.json();
  if (!signInData.access_token) {
    throw new Error(signInData.error_description || signInData.msg || 'Failed to sign in');
  }

  state.token = signInData.access_token;
  state.userId = signInData.user?.id || '';
}

async function runStep(name, fn) {
  try {
    await fn();
    log(`✅ ${name}`, colors.green);
    return true;
  } catch (err) {
    log(`❌ ${name}: ${err.message}`, colors.red);
    return false;
  }
}

function registerCleanup(name, fn) {
  cleanupTasks.unshift({ name, fn });
}

async function runCleanup() {
  if (!CLEANUP || cleanupTasks.length === 0) {
    return;
  }

  log('\nCleanup\n', colors.blue);
  for (const task of cleanupTasks) {
    try {
      await task.fn();
      log(`🧹 ${task.name}`, colors.green);
    } catch (err) {
      log(`⚠️ Cleanup failed for ${task.name}: ${err.message}`, colors.yellow);
    }
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  log('\nREST Endpoint Smoke Test\n', colors.blue);

  const results = [];

  results.push(await runStep('Health check', async () => {
    const { response, data } = await apiRequest('/health', { method: 'GET' });
    if (!response.ok || data?.status !== 'ok') {
      throw new Error(`Unexpected health response: ${response.status}`);
    }
  }));

  results.push(await runStep('Authenticate demo user', async () => {
    await ensureAuth();
  }));

  results.push(await runStep('GET /api/agents', async () => {
    const { response, data } = await apiRequest('/api/agents');
    if (!response.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(`Bad agents list response: ${response.status}`);
    }
  }));

  results.push(await runStep('POST /api/agents', async () => {
    const body = {
      name: `Smoke Agent ${Date.now()}`,
      description: 'Smoke test agent',
      agent_type: 'support',
      platform: 'openai',
      model_name: 'gpt-4o-mini',
      system_prompt: 'You are a smoke test assistant.',
      config: { temperature: 0.3 },
    };

    const { response, data } = await apiRequest('/api/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok || !data?.success) {
      throw new Error(`Create agent failed: ${response.status}`);
    }

    const record = unwrapRecord(data.data);
    if (!record?.id) {
      throw new Error('Created agent ID missing');
    }
    state.agentId = record.id;
    registerCleanup('Delete smoke-test agent', async () => {
      await apiRequest(`/api/agents/${state.agentId}`, { method: 'DELETE' });
    });
  }));

  results.push(await runStep('GET /api/agents/:id', async () => {
    const { response, data } = await apiRequest(`/api/agents/${state.agentId}`);
    if (!response.ok || !data?.success || !data?.data?.id) {
      throw new Error(`Get agent failed: ${response.status}`);
    }
  }));

  results.push(await runStep('PUT /api/agents/:id', async () => {
    const { response, data } = await apiRequest(`/api/agents/${state.agentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'paused',
        description: 'Updated by smoke test',
      }),
    });

    if (!response.ok || !data?.success) {
      throw new Error(`Update agent failed: ${response.status}`);
    }
  }));

  results.push(await runStep('GET /api/conversations', async () => {
    const { response, data } = await apiRequest('/api/conversations?limit=10');
    if (!response.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(`Get conversations failed: ${response.status}`);
    }
  }));

  results.push(await runStep('GET /api/conversations/:id (404 check)', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const { response } = await apiRequest(`/api/conversations/${fakeId}`);
    if (response.status !== 404) {
      throw new Error(`Expected 404, got ${response.status}`);
    }
  }));

  results.push(await runStep('POST /api/incidents', async () => {
    const { response, data } = await apiRequest('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: state.agentId,
        incident_type: 'toxic_output',
        severity: 'high',
        title: 'Smoke incident',
        description: 'Smoke incident for endpoint validation',
        trigger_content: 'sample trigger text',
      }),
    });

    if (!response.ok || !data?.success) {
      throw new Error(`Create incident failed: ${response.status}`);
    }

    const record = unwrapRecord(data.data);
    if (!record?.id) {
      throw new Error('Created incident ID missing');
    }
    state.incidentId = record.id;
    registerCleanup('Delete smoke-test incident', async () => {
      await apiRequest(`/api/incidents/${state.incidentId}`, { method: 'DELETE' });
    });
  }));

  results.push(await runStep('GET /api/incidents', async () => {
    const { response, data } = await apiRequest('/api/incidents?limit=10');
    if (!response.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(`Get incidents failed: ${response.status}`);
    }
  }));

  results.push(await runStep('PUT /api/incidents/:id/resolve', async () => {
    const { response, data } = await apiRequest(`/api/incidents/${state.incidentId}/resolve`, {
      method: 'PUT',
      body: JSON.stringify({
        resolution_notes: 'Resolved by smoke test',
      }),
    });

    if (!response.ok || !data?.success) {
      throw new Error(`Resolve incident failed: ${response.status}`);
    }
  }));

  results.push(await runStep('POST /api/detect', async () => {
    const { response, data } = await apiRequest('/api/detect', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: state.agentId,
        content: 'Customer SSN is 123-45-6789 and credit card is 4111 1111 1111 1111',
      }),
    });

    if (!response.ok || !data?.success || !Array.isArray(data?.results)) {
      throw new Error(`Detect endpoint failed: ${response.status}`);
    }
  }));

  results.push(await runStep('POST /api/costs', async () => {
    const { response, data } = await apiRequest('/api/costs', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: state.agentId,
        model_name: 'gpt-4o-mini',
        input_tokens: 100,
        output_tokens: 40,
        request_count: 1,
        avg_latency_ms: 230,
      }),
    });

    if (!response.ok || !data?.success) {
      throw new Error(`Create cost failed: ${response.status}`);
    }
  }));

  results.push(await runStep('POST /api/api-keys', async () => {
    const { response, data } = await apiRequest('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name: `Smoke Key ${Date.now()}`,
        environment: 'development',
        preset: 'full_access',
        description: 'Temporary smoke test key',
        rateLimit: 120,
      }),
    });

    if (!response.ok || !data?.success || !data?.data?.id || !data?.data?.key) {
      throw new Error(`Create API key failed: ${response.status}`);
    }

    state.apiKeyId = data.data.id;
    state.apiKeySecret = data.data.key;
    registerCleanup('Revoke smoke-test API key', async () => {
      await apiRequest(`/api/api-keys/${state.apiKeyId}`, { method: 'DELETE' });
    });
  }));

  if (RUN_GATEWAY_SMOKE) {
    results.push(await runStep('POST /v1/chat/completions', async () => {
      const response = await fetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.apiKeySecret}`,
          'Content-Type': 'application/json',
          'x-rasi-agent-id': state.agentId,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash',
          messages: [
            { role: 'system', content: 'Reply in one short sentence.' },
            { role: 'user', content: 'Return the phrase smoke test verified.' },
          ],
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.choices?.[0]?.message?.content) {
        throw new Error(`Gateway completion failed: ${response.status}`);
      }
    }));

    results.push(await runStep('GET /api/api-keys/:id/activity', async () => {
      await sleep(250);
      const { response, data } = await apiRequest(`/api/api-keys/${state.apiKeyId}/activity`);
      const series = data?.data?.usage_30d?.series || data?.data?.usage_30d || [];

      if (!response.ok || !data?.success) {
        throw new Error(`API key activity failed: ${response.status}`);
      }

      const totalRequests = Array.isArray(series)
        ? series.reduce((sum, point) => sum + Number(point?.requests || 0), 0)
        : 0;

      if (totalRequests < 1) {
        throw new Error('Gateway request did not update API key activity');
      }
    }));
  }

  results.push(await runStep('GET /api/costs', async () => {
    const { response, data } = await apiRequest('/api/costs?period=30d');
    if (!response.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(`Get costs failed: ${response.status}`);
    }
  }));

  results.push(await runStep('GET /api/dashboard', async () => {
    const { response, data } = await apiRequest('/api/dashboard');
    if (!response.ok || !data?.success || !data?.data?.agents || !data?.data?.incidents || !data?.data?.costs) {
      throw new Error(`Dashboard failed: ${response.status}`);
    }
  }));

  results.push(await runStep('POST /api/agents/:id/kill', async () => {
    const { response, data } = await apiRequest(`/api/agents/${state.agentId}/kill`, {
      method: 'POST',
      body: JSON.stringify({
        level: 2,
        reason: 'Smoke test cleanup',
      }),
    });

    if (!response.ok || !data?.success) {
      throw new Error(`Kill switch failed: ${response.status}`);
    }
  }));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;

  log('\nSmoke Test Summary', colors.blue);
  log(`Passed: ${passed}`, colors.green);
  log(`Failed: ${failed}`, failed === 0 ? colors.green : colors.red);

  await runCleanup();

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log(`\nFatal error: ${err.message}`, colors.red);
  process.exit(1);
});
