import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type EnrollResponse = {
  success: boolean;
  runtime_id: string;
  organization_id: string;
  runtime_secret: string;
  runtime_jwt?: string;
  expires_in_seconds?: number;
  error?: string;
};

type JobRow = {
  id: string;
  organization_id: string;
  agent_id: string | null;
  runtime_instance_id: string | null;
  type: string;
  status: string;
  input: any;
};

const env = (key: string, fallback?: string) => (process.env[key] && String(process.env[key]).trim().length > 0)
  ? String(process.env[key]).trim()
  : fallback;

const CONTROL_PLANE_URL = env('SYNTHETICHR_CONTROL_PLANE_URL', 'http://localhost:3001')!.replace(/\/+$/, '');
const RUNTIME_ID = env('SYNTHETICHR_RUNTIME_ID', '')!;
const ENROLLMENT_TOKEN = env('SYNTHETICHR_ENROLLMENT_TOKEN', '')!;
const RUNTIME_SECRET_ENV = env('SYNTHETICHR_RUNTIME_SECRET', '')!;
const RUNTIME_SECRET_FILE = env('SYNTHETICHR_RUNTIME_SECRET_FILE', '')!;
const API_KEY = env('SYNTHETICHR_API_KEY', '')!;
const GATEWAY_URL = env('SYNTHETICHR_GATEWAY_URL', `${CONTROL_PLANE_URL}/v1`)!.replace(/\/+$/, '');
const POLL_INTERVAL_MS = Math.max(750, Number(env('SYNTHETICHR_POLL_INTERVAL_MS', '2000')));
const HEARTBEAT_INTERVAL_MS = Math.max(5000, Number(env('SYNTHETICHR_HEARTBEAT_INTERVAL_MS', '15000')));
const DEFAULT_MODEL = env('SYNTHETICHR_MODEL', 'openai/gpt-4o-mini')!;
const STREAM_MODE = env('SYNTHETICHR_STREAM_MODE', 'poll')!; // poll | stream

if (!RUNTIME_ID) {
  console.error('Missing required env: SYNTHETICHR_RUNTIME_ID');
  process.exit(1);
}

if (!API_KEY) {
  console.error('Missing required env: SYNTHETICHR_API_KEY (create it via SyntheticHR → Connect Agent wizard)');
  process.exit(1);
}

let runtimeSecret = '';
let organizationId = '';

function nowIso() {
  return new Date().toISOString();
}

function loadRuntimeSecret(): string {
  if (RUNTIME_SECRET_ENV) return RUNTIME_SECRET_ENV;
  if (RUNTIME_SECRET_FILE) {
    try {
      if (fs.existsSync(RUNTIME_SECRET_FILE)) {
        const value = fs.readFileSync(RUNTIME_SECRET_FILE, 'utf8').trim();
        if (value) return value;
      }
    } catch {
      // ignore
    }
  }
  return '';
}

function persistRuntimeSecret(secret: string) {
  if (!RUNTIME_SECRET_FILE) return;
  try {
    fs.mkdirSync(path.dirname(RUNTIME_SECRET_FILE), { recursive: true });
    fs.writeFileSync(RUNTIME_SECRET_FILE, secret, { encoding: 'utf8', mode: 0o600 });
  } catch (err: any) {
    console.warn(`[runtime] could not persist runtime secret to file: ${err?.message || String(err)}`);
  }
}

function base64urlJson(value: any): string {
  const json = JSON.stringify(value);
  return Buffer.from(json, 'utf8').toString('base64url');
}

function signRuntimeJwt(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    runtime_id: RUNTIME_ID,
    organization_id: organizationId,
    iat: nowSec,
    exp: nowSec + 5 * 60,
  };
  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const sig = crypto.createHmac('sha256', runtimeSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function enroll(): Promise<void> {
  const existing = loadRuntimeSecret();
  if (existing) {
    runtimeSecret = existing;
    console.log('[runtime] using existing runtime secret (skipping enrollment)');
    return;
  }

  if (!ENROLLMENT_TOKEN) {
    throw new Error('Missing required env: SYNTHETICHR_ENROLLMENT_TOKEN (needed for first-time enrollment)');
  }

  const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runtime_id: RUNTIME_ID,
      enrollment_token: ENROLLMENT_TOKEN,
      version: 'synthetic-hr-runtime/0.1.0',
      capabilities: {
        jobTypes: ['chat_turn', 'workflow_run', 'connector_action'],
        modes: [STREAM_MODE],
      },
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as EnrollResponse;
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `Enroll failed (${response.status})`);
  }

  runtimeSecret = payload.runtime_secret;
  organizationId = payload.organization_id;
  persistRuntimeSecret(runtimeSecret);
  console.log(`[runtime] enrolled runtime_id=${payload.runtime_id} org_id=${payload.organization_id}`);
}

async function heartbeat(): Promise<void> {
  const jwt = signRuntimeJwt();
  const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      status: 'online',
      version: 'synthetic-hr-runtime/0.1.0',
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Heartbeat failed (${response.status}): ${text}`);
  }
}

async function pollJobs(): Promise<JobRow[]> {
  const jwt = signRuntimeJwt();
  const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/jobs/poll?limit=3`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || `Poll failed (${response.status})`);
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

async function completeJob(jobId: string, body: { status: 'succeeded' | 'failed' | 'canceled'; output?: any; error?: string }) {
  const jwt = signRuntimeJwt();
  const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Complete failed (${response.status}): ${text}`);
  }
}

async function logJob(jobId: string, line: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
  const jwt = signRuntimeJwt();
  await fetch(`${CONTROL_PLANE_URL}/api/runtimes/jobs/${jobId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ line, level, ts: nowIso() }),
  }).catch(() => void 0);
}

async function runChatTurn(job: JobRow) {
  const input = job.input && typeof job.input === 'object' ? job.input : {};
  const model = typeof input.model === 'string' ? input.model : DEFAULT_MODEL;
  const messages = Array.isArray(input.messages) ? input.messages : [
    { role: 'system', content: 'Reply concisely.' },
    { role: 'user', content: 'Hello from SyntheticHR runtime.' },
  ];
  const temperature = typeof input.temperature === 'number' ? input.temperature : 0.3;

  await logJob(job.id, `Calling gateway model=${model}`, 'info');

  const response = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      'x-rasi-agent-id': job.agent_id || '',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: false,
      agent_id: job.agent_id || undefined,
    }),
  });

  const payload = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    const msg = payload?.error?.message || payload?.error || `Gateway error ${response.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const content = payload?.choices?.[0]?.message?.content || '';
  return {
    model: payload?.model || model,
    message: content,
    raw: payload,
  };
}

async function executeJob(job: JobRow) {
  if (job.type === 'chat_turn') {
    const result = await runChatTurn(job);
    await completeJob(job.id, { status: 'succeeded', output: result });
    return;
  }

  // Placeholder implementations (MVP)
  if (job.type === 'workflow_run') {
    await logJob(job.id, 'Workflow execution placeholder (MVP)', 'warn');
    await completeJob(job.id, { status: 'succeeded', output: { ok: true, note: 'workflow_run placeholder', input: job.input } });
    return;
  }

  if (job.type === 'connector_action') {
    await logJob(job.id, 'Connector action placeholder (MVP)', 'warn');
    await completeJob(job.id, { status: 'succeeded', output: { ok: true, note: 'connector_action placeholder', input: job.input } });
    return;
  }

  await completeJob(job.id, { status: 'failed', error: `Unsupported job type: ${job.type}` });
}

async function loopPoll() {
  for (;;) {
    const jobs = await pollJobs();
    for (const job of jobs) {
      try {
        console.log(`[runtime] executing job=${job.id} type=${job.type}`);
        await executeJob(job);
        console.log(`[runtime] completed job=${job.id}`);
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error(`[runtime] job failed job=${job.id}: ${msg}`);
        await logJob(job.id, `Job failed: ${msg}`, 'error');
        await completeJob(job.id, { status: 'failed', error: msg });
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main() {
  console.log(`[runtime] starting controlPlane=${CONTROL_PLANE_URL} gateway=${GATEWAY_URL} mode=${STREAM_MODE}`);
  await enroll();
  if (!runtimeSecret) {
    throw new Error('Runtime secret missing after enrollment');
  }

  // Heartbeats
  setInterval(() => {
    void heartbeat().catch((err) => console.error(`[runtime] heartbeat error: ${err?.message || String(err)}`));
  }, HEARTBEAT_INTERVAL_MS);

  await heartbeat();
  await loopPoll();
}

void main().catch((err) => {
  console.error(`[runtime] fatal: ${err?.message || String(err)}`);
  process.exit(1);
});
