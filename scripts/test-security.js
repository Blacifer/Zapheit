#!/usr/bin/env node

/**
 * Security smoke checks for auth boundaries.
 * Requires backend running on localhost:3001.
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required. Set them in your environment before running this test.');
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function signInDemo() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: 'demo@rasi.ai',
      password: 'Demo123!@#',
    }),
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.msg || 'Unable to fetch valid auth token');
  }
  return data.access_token;
}

async function request(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${API_URL}${path}`, { headers });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function runStep(name, fn) {
  try {
    await fn();
    log(`PASS ${name}`, colors.green);
    return true;
  } catch (error) {
    log(`FAIL ${name}: ${error.message}`, colors.red);
    return false;
  }
}

(async () => {
  log('\nSecurity Smoke Test\n', colors.blue);

  const validToken = await signInDemo();

  const results = [];

  results.push(await runStep('Missing token is rejected', async () => {
    const res = await request('/api/agents');
    assert(res.status === 401, `expected 401, got ${res.status}`);
  }));

  results.push(await runStep('Malformed token is rejected', async () => {
    const res = await request('/api/agents', 'not.a.real.jwt');
    assert(res.status === 401, `expected 401, got ${res.status}`);
  }));

  results.push(await runStep('Tampered valid token is rejected', async () => {
    const tampered = `${validToken}tamper`;
    const res = await request('/api/agents', tampered);
    assert(res.status === 401, `expected 401, got ${res.status}`);
  }));

  results.push(await runStep('Valid token is accepted', async () => {
    const res = await request('/api/agents', validToken);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.data?.success === true, 'expected success=true');
  }));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;

  console.log(`\nSummary: passed=${passed}, failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();
