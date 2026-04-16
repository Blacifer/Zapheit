import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
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
  created_by?: string | null;
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
const SCHEDULER_INTERVAL_MS = Math.max(30_000, Number(env('SYNTHETICHR_SCHEDULER_INTERVAL_MS', '60000')));
const DEFAULT_MODEL = env('SYNTHETICHR_MODEL', 'openai/gpt-4o-mini')!;
const STREAM_MODE = env('SYNTHETICHR_STREAM_MODE', 'poll')!; // poll | stream
const WEBHOOK_ALLOWLIST = env('SYNTHETICHR_WEBHOOK_ALLOWLIST', '')!;

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

// ── GCP Secret Manager helpers (for Cloud Run stateless persistence) ─────────

const GCP_SECRET_NAME = 'SYNTHETICHR_RUNTIME_SECRET';

async function gcpMetadataFetch(path: string): Promise<string> {
  const res = await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Metadata ${path} → ${res.status}`);
  return res.text();
}

async function gcpGetTokenAndProject(): Promise<{ token: string; project: string }> {
  const [tokenRaw, project] = await Promise.all([
    gcpMetadataFetch('instance/service-accounts/default/token'),
    gcpMetadataFetch('project/project-id'),
  ]);
  const token = (JSON.parse(tokenRaw) as { access_token: string }).access_token;
  return { token, project };
}

async function loadRuntimeSecretFromGCP(): Promise<{ secret: string; orgId: string }> {
  try {
    const { token, project } = await gcpGetTokenAndProject();
    const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${GCP_SECRET_NAME}/versions/latest:access`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { secret: '', orgId: '' };
    const data = await res.json() as { payload?: { data?: string } };
    if (!data?.payload?.data) return { secret: '', orgId: '' };
    const value = Buffer.from(data.payload.data, 'base64').toString('utf8').trim();
    // Try to parse as JSON (new format: { secret, org_id })
    try {
      const parsed = JSON.parse(value) as { secret?: string; org_id?: string };
      if (parsed?.secret) return { secret: parsed.secret, orgId: parsed.org_id || '' };
    } catch {
      // Legacy: plain secret string
    }
    return { secret: value, orgId: '' };
  } catch {
    return { secret: '', orgId: '' };
  }
}

async function persistRuntimeSecretToGCP(secret: string, orgId: string): Promise<void> {
  try {
    const { token, project } = await gcpGetTokenAndProject();
    const url = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${GCP_SECRET_NAME}:addVersion`;
    const payload = JSON.stringify({ secret, org_id: orgId });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { data: Buffer.from(payload, 'utf8').toString('base64') } }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      console.log('[runtime] runtime secret persisted to Secret Manager');
    } else {
      const err = await res.text();
      console.warn(`[runtime] Secret Manager write failed (${res.status}): ${err}`);
    }
  } catch (err: any) {
    console.warn(`[runtime] could not persist to Secret Manager: ${err?.message || String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// Real runtime secrets are generated by generateOpaqueToken(48) — 64+ chars.
// Placeholder values like "pending-first-enrollment" are shorter and must be ignored.
const MIN_RUNTIME_SECRET_LENGTH = 32;

function parseSecretValue(raw: string): { secret: string; orgId: string } {
  try {
    const parsed = JSON.parse(raw) as { secret?: string; org_id?: string };
    if (parsed?.secret && parsed.secret.length >= MIN_RUNTIME_SECRET_LENGTH) {
      return { secret: parsed.secret, orgId: parsed.org_id || '' };
    }
  } catch {
    // Not JSON — plain secret string
  }
  return { secret: raw, orgId: '' };
}

async function loadRuntimeSecret(): Promise<{ secret: string; orgId: string }> {
  if (RUNTIME_SECRET_ENV && RUNTIME_SECRET_ENV.length >= MIN_RUNTIME_SECRET_LENGTH) {
    return parseSecretValue(RUNTIME_SECRET_ENV);
  }
  if (RUNTIME_SECRET_FILE) {
    try {
      if (fs.existsSync(RUNTIME_SECRET_FILE)) {
        const value = fs.readFileSync(RUNTIME_SECRET_FILE, 'utf8').trim();
        if (value && value.length >= MIN_RUNTIME_SECRET_LENGTH) return parseSecretValue(value);
      }
    } catch {
      // ignore
    }
  }
  // Cloud Run: dynamically read from Secret Manager (survives container restarts)
  const gcpResult = await loadRuntimeSecretFromGCP();
  if (gcpResult.secret.length >= MIN_RUNTIME_SECRET_LENGTH) return gcpResult;
  return { secret: '', orgId: '' };
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
  const existing = await loadRuntimeSecret();
  if (existing.secret) {
    runtimeSecret = existing.secret;
    if (existing.orgId) organizationId = existing.orgId;
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
      version: 'zapheit-runtime/0.1.0',
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
  // Persist to Secret Manager in the background — don't block startup
  void persistRuntimeSecretToGCP(runtimeSecret, organizationId);
}

async function heartbeat(): Promise<void> {
  const jwt = signRuntimeJwt();
  const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      status: 'online',
      version: 'zapheit-runtime/0.1.0',
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

async function heartbeatJob(jobId: string): Promise<void> {
  const jwt = signRuntimeJwt();
  await fetch(`${CONTROL_PLANE_URL}/api/runtimes/jobs/${jobId}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  }).catch(() => void 0); // fire-and-forget; don't interrupt execution on failure
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
      'x-zapheit-agent-id': job.agent_id || '',
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

function getByPath(obj: any, dottedPath: string): any {
  const parts = dottedPath.split('.').map((p) => p.trim()).filter(Boolean);
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function renderTemplate(value: string, context: any): string {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, exprRaw) => {
    const expr = String(exprRaw || '').trim();
    const resolved = getByPath(context, expr);
    if (resolved == null) return '';
    if (typeof resolved === 'string') return resolved;
    try {
      return JSON.stringify(resolved);
    } catch {
      return String(resolved);
    }
  });
}

// ─── Workflow step types ───────────────────────────────────────────────────

type LlmStep = {
  id: string;
  kind: 'llm';
  agent_id?: string | null;   // B7: per-step agent override
  model?: string;
  temperature?: number;
  messages?: Array<{ role: string; content: string }>;
};

type BranchCondition = {
  test: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'else' | 'llm';
  value?: string;             // text to match (case-insensitive)
  prompt?: string;            // LLM judge: ask this yes/no question about the source text
  next: string;               // step id to jump to
};

type BranchStep = {
  id: string;
  kind: 'branch';
  source: string;             // step id whose output to evaluate
  conditions: BranchCondition[];
};

type WorkflowStep = LlmStep | BranchStep | ConnectorStep;

type ConnectorStep = {
  id: string;
  kind: 'connector';
  connector_id: string;       // e.g. 'slack', 'jira', 'github'
  action: string;             // e.g. 'send_message', 'search_issues'
  params?: Record<string, any>;
  /** Template params: {{input.fieldKey}} and {{steps.stepId.message}} resolved at runtime */
  param_template?: Record<string, string>;
  next?: string | null;
};

/** Evaluate branch conditions against source text; return matching next-step id. */
async function evalBranch(conditions: BranchCondition[], text: string, agentId: string): Promise<string | null> {
  const lower = text.toLowerCase();
  for (const cond of conditions) {
    if (cond.test === 'else') return cond.next;

    // Text-match conditions
    const val = (cond.value || '').toLowerCase();
    if (cond.test === 'contains'    && lower.includes(val))    return cond.next;
    if (cond.test === 'equals'      && lower === val)           return cond.next;
    if (cond.test === 'starts_with' && lower.startsWith(val))  return cond.next;
    if (cond.test === 'ends_with'   && lower.endsWith(val))    return cond.next;

    // LLM judge condition: ask the LLM a yes/no question about the text
    if (cond.test === 'llm' && cond.prompt) {
      try {
        const resp = await fetch(`${GATEWAY_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
            'x-zapheit-agent-id': agentId,
          },
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            messages: [
              { role: 'system', content: 'You are a classifier. Answer only "yes" or "no".' },
              { role: 'user', content: `Text:\n${text}\n\nQuestion: ${cond.prompt}\n\nAnswer yes or no.` },
            ],
            temperature: 0,
            max_tokens: 5,
          }),
        });
        const payload = await resp.json().catch(() => ({}));
        const answer = (payload?.choices?.[0]?.message?.content || '').trim().toLowerCase();
        if (answer.startsWith('yes')) return cond.next;
      } catch { /* non-fatal — skip condition */ }
    }
  }
  return null;
}

async function runWorkflow(job: JobRow) {
  const input = job.input && typeof job.input === 'object' ? job.input : {};
  const wf = input.workflow && typeof input.workflow === 'object' ? input.workflow : null;
  if (!wf || !Array.isArray(wf.steps) || wf.steps.length === 0) {
    throw new Error('Invalid workflow input: expected input.workflow.steps[]');
  }

  // Field values: prefer input.fields (clean separation); fall back to input directly (legacy).
  const fields: Record<string, any> = (input.fields && typeof input.fields === 'object')
    ? input.fields
    : input;

  const steps = wf.steps as WorkflowStep[];
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const stepResults: Record<string, { message: string; model: string; raw: any }> = {};

  // Graph traversal: start at first step (or wf.start), follow next pointers.
  let currentId: string | null = (typeof wf.start === 'string' && wf.start) ? wf.start : steps[0].id;
  let lastLlmId: string | null = null;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) {
      await logJob(job.id, `Workflow cycle detected at step=${currentId}, stopping`, 'warn');
      break;
    }
    visited.add(currentId);

    const step = stepById.get(currentId);
    if (!step) {
      await logJob(job.id, `Step not found: ${currentId}`, 'warn');
      break;
    }

    // ── Branch step (B8) ────────────────────────────────────────────────────
    if (step.kind === 'branch') {
      const bs = step as BranchStep;
      const sourceText = stepResults[bs.source]?.message || '';
      const nextId = await evalBranch(bs.conditions || [], sourceText, job.agent_id || '');
      await logJob(job.id, `Branch step=${bs.id} source=${bs.source} → ${nextId || '(no match)'}`, 'info');
      if (!nextId) break; // no matching condition — stop
      currentId = nextId;
      continue;
    }

    // ── LLM step (always, with B7 agent override) ───────────────────────────
    if (step.kind === 'llm') {
      const ls = step as LlmStep;
      const model = typeof ls.model === 'string' ? ls.model : (typeof input.model === 'string' ? input.model : DEFAULT_MODEL);
      const temperature = typeof ls.temperature === 'number' ? ls.temperature : (typeof input.temperature === 'number' ? input.temperature : 0.2);

      // B7: use step-level agent_id for attribution; fall back to job agent
      const agentId = ls.agent_id || job.agent_id || '';

      // Template context: {{input.fieldKey}} resolves from fields; {{steps.stepId.message}} from prior results.
      const ctx = {
        input: fields,
        steps: Object.fromEntries(Object.entries(stepResults).map(([id, r]) => [id, { message: r.message, model: r.model }])),
      };

      const rawMessages = Array.isArray(ls.messages) ? ls.messages : [];
      const messages = rawMessages.map((m) => {
        const role = typeof m?.role === 'string' ? m.role : 'user';
        const contentRaw = typeof m?.content === 'string' ? m.content : '';
        return { role, content: renderTemplate(contentRaw, ctx) };
      });

      if (messages.length === 0) {
        throw new Error(`Workflow step ${ls.id} has no messages`);
      }

      await logJob(job.id, `Workflow step=${ls.id} model=${model} agent=${agentId}`, 'info');

      const response = await fetch(`${GATEWAY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
          'x-zapheit-agent-id': agentId,
        },
        body: JSON.stringify({ model, messages, temperature, stream: false, agent_id: agentId || undefined }),
      });

      const payload = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        const msg = payload?.error?.message || payload?.error || `Gateway error ${response.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }

      const content = payload?.choices?.[0]?.message?.content || '';
      stepResults[ls.id] = { message: content, model: payload?.model || model, raw: payload };
      lastLlmId = ls.id;

      // Advance: go to explicitly configured next, or next in array order.
      const idx = steps.indexOf(step);
      const nextInOrder = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1].id : null;
      currentId = (ls as any).next || nextInOrder;
      continue;
    }

    // ── Connector step — execute external connector action via control plane ─
    if (step.kind === 'connector') {
      const cs = step as ConnectorStep;
      const connectorId = cs.connector_id;
      const actionName = cs.action;

      if (!connectorId || !actionName) {
        await logJob(job.id, `Connector step=${cs.id} missing connector_id or action, skipping`, 'warn');
        const idx = steps.indexOf(step);
        currentId = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1].id : null;
        continue;
      }

      // Build params: merge static params with resolved templates
      const templateCtx = {
        input: fields,
        steps: Object.fromEntries(
          Object.entries(stepResults).map(([id, r]) => [id, { message: r.message, model: r.model }]),
        ),
      };
      const resolvedParams: Record<string, any> = { ...(cs.params || {}) };
      if (cs.param_template && typeof cs.param_template === 'object') {
        for (const [key, tmpl] of Object.entries(cs.param_template)) {
          resolvedParams[key] = renderTemplate(String(tmpl), templateCtx);
        }
      }

      await logJob(job.id, `Connector step=${cs.id} service=${connectorId} action=${actionName}`, 'info');

      const jwt = signRuntimeJwt();
      const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/actions/execute-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          job_id: job.id,
          agent_id: job.agent_id || undefined,
          service: connectorId,
          action: actionName,
          payload: resolvedParams,
        }),
      });

      const payload = await response.json().catch(() => ({} as any));

      if (payload?.success === false && payload?.error?.includes('requires an approved job')) {
        // Approval required — record partial result and stop; job can be resumed after approval
        stepResults[cs.id] = {
          message: `⏳ Awaiting approval for ${connectorId}.${actionName}`,
          model: 'connector',
          raw: { approval_required: true, ...payload },
        };
        await logJob(job.id, `Connector step=${cs.id} paused: approval required`, 'info');
        // Return partial result with pending state
        return {
          workflow: { version: wf.version || 2, final_step: cs.id },
          steps: Object.entries(stepResults).map(([id, r]) => ({ id, model: r.model, message: r.message })),
          final: { step_id: cs.id, model: 'connector', message: stepResults[cs.id].message },
          pending_approval: true,
          paused_at_step: cs.id,
          connector: { service: connectorId, action: actionName, params: resolvedParams },
        };
      }

      if (!response.ok || payload?.success === false) {
        const errMsg = payload?.error || `Connector action failed (HTTP ${response.status})`;
        await logJob(job.id, `Connector step=${cs.id} failed: ${errMsg}`, 'error');
        stepResults[cs.id] = { message: `❌ ${connectorId}.${actionName} failed: ${errMsg}`, model: 'connector', raw: payload };
      } else {
        const output = payload?.data?.output || payload?.data || payload?.action_run?.output || {};
        const summary = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        stepResults[cs.id] = { message: summary, model: 'connector', raw: payload };
      }

      // Advance
      const idx = steps.indexOf(step);
      const nextInOrder = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1].id : null;
      currentId = cs.next || nextInOrder;
      continue;
    }

    // Unknown step kind — skip.
    await logJob(job.id, `Unknown step kind "${(step as any).kind}", skipping`, 'warn');
    const idx = steps.indexOf(step);
    currentId = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1].id : null;
  }

  // Final step: explicitly configured, last executed LLM step, or last LLM step in array.
  const finalStepId = typeof wf.final_step === 'string'
    ? wf.final_step
    : (lastLlmId || steps.filter((s) => s.kind === 'llm').at(-1)?.id || steps[steps.length - 1].id);
  const final = stepResults[finalStepId] || Object.values(stepResults).at(-1);

  return {
    workflow: { version: wf.version || 2, final_step: finalStepId },
    steps: Object.entries(stepResults).map(([id, r]) => ({ id, model: r.model, message: r.message })),
    final: {
      step_id: finalStepId,
      model: final?.model || DEFAULT_MODEL,
      message: final?.message || '',
    },
  };
}

const JOB_HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds — well under the 5-min reaper threshold

async function executeJob(job: JobRow) {
  // Send periodic heartbeats so the reaper knows this job is still alive.
  const heartbeatTimer = setInterval(() => {
    void heartbeatJob(job.id);
  }, JOB_HEARTBEAT_INTERVAL_MS);

  try {
    await executeJobInner(job);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function executeJobInner(job: JobRow) {
  if (job.type === 'chat_turn') {
    const result = await runChatTurn(job);
    await completeJob(job.id, { status: 'succeeded', output: result });
    return;
  }

  if (job.type === 'workflow_run') {
    const result = await runWorkflow(job);
    await completeJob(job.id, { status: 'succeeded', output: result });
    return;
  }

  if (job.type === 'connector_action') {
    const input = job.input && typeof job.input === 'object' ? job.input : {};
    const connector = input.connector && typeof input.connector === 'object' ? input.connector : null;
    if (!connector) {
      throw new Error('connector_action requires input.connector');
    }
    const service = typeof connector.service === 'string' ? connector.service : '';
    const action = typeof connector.action === 'string' ? connector.action : '';
    const payload = connector.payload && typeof connector.payload === 'object' ? connector.payload : {};

    if (!service || !action) {
      throw new Error('connector_action requires connector.service and connector.action');
    }

    if (service === 'internal') {
      // Check policy (enabled) before executing.
      try {
        const jwt = signRuntimeJwt();
        const qs = new URLSearchParams({ service: 'internal', action });
        const polRes = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/actions/policy?${qs.toString()}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const pol = await polRes.json().catch(() => ({} as any));
        if (polRes.ok && pol?.success && pol?.data && pol.data.enabled === false) {
          await completeJob(job.id, { status: 'failed', error: 'Action disabled by policy', output: { policy: pol.data } });
          return;
        }
      } catch {
        // ignore policy lookup failures; approval path should still enforce.
      }

      await logJob(job.id, `Executing internal connector action=${action}`, 'info');
      const jwt = signRuntimeJwt();
      const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/actions/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          job_id: job.id,
          agent_id: job.agent_id || undefined,
          action,
          payload,
        }),
      });

      const result = await response.json().catch(() => ({} as any));
      if (!response.ok || result?.success !== true) {
        const errMsg = result?.error || `Internal action failed (${response.status})`;
        await logJob(job.id, errMsg, 'error');
        await completeJob(job.id, { status: 'failed', error: errMsg, output: { result } });
        return;
      }

      await completeJob(job.id, { status: 'succeeded', output: result?.data || result });
      return;
    }

    if (service === 'webhook') {
      const url = typeof (payload as any).url === 'string' ? (payload as any).url : '';
      if (!url) {
        await completeJob(job.id, { status: 'failed', error: 'webhook connector requires payload.url' });
        return;
      }

      const parsedUrl = new URL(url);
      // Prefer DB policy allowlist; fall back to env allowlist.
      let allowlist: string[] = [];
      try {
        const jwt = signRuntimeJwt();
        const qs = new URLSearchParams({ service: 'webhook', action });
        const polRes = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/actions/policy?${qs.toString()}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const pol = await polRes.json().catch(() => ({} as any));
        if (polRes.ok && pol?.success && pol?.data) {
          if (pol.data.enabled === false) {
            await completeJob(job.id, { status: 'failed', error: 'Action disabled by policy', output: { policy: pol.data } });
            return;
          }
          if (Array.isArray(pol.data.webhook_allowlist)) {
            allowlist = pol.data.webhook_allowlist.map((h: any) => String(h));
          }
        }
      } catch {
        // ignore
      }

      if (allowlist.length === 0) {
        allowlist = WEBHOOK_ALLOWLIST.split(',').map((v) => v.trim()).filter(Boolean);
      }

      if (allowlist.length > 0 && !allowlist.includes(parsedUrl.host)) {
        await completeJob(job.id, { status: 'failed', error: `Webhook host not in allowlist: ${parsedUrl.host}`, output: { host: parsedUrl.host, allowlist } });
        return;
      }

      const method = typeof (payload as any).method === 'string' ? String((payload as any).method).toUpperCase() : 'POST';
      const headers = ((payload as any).headers && typeof (payload as any).headers === 'object') ? (payload as any).headers : {};
      const body = (payload as any).body ?? (payload as any).data ?? {};

      await logJob(job.id, `Calling webhook ${method} ${parsedUrl.host}`, 'info');
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body),
      });

      const text = await response.text().catch(() => '');
      if (!response.ok) {
        await completeJob(job.id, { status: 'failed', error: `Webhook error (${response.status})`, output: { status: response.status, body: text } });
        return;
      }

      await completeJob(job.id, { status: 'succeeded', output: { status: response.status, body: text } });
      return;
    }

    // External provider (zendesk, freshdesk, hubspot, salesforce, okta, stripe, etc.)
    // Delegate to the control plane which holds the decrypted credentials.
    {
      await logJob(job.id, `Executing external connector action service=${service} action=${action}`, 'info');
      const jwt = signRuntimeJwt();

      // Check policy first
      try {
        const qs = new URLSearchParams({ service, action });
        const polRes = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/actions/policy?${qs.toString()}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const pol = await polRes.json().catch(() => ({} as any));
        if (polRes.ok && pol?.success && pol?.data && pol.data.enabled === false) {
          await completeJob(job.id, { status: 'failed', error: 'Action disabled by policy', output: { policy: pol.data } });
          return;
        }
      } catch {
        // ignore policy lookup failures
      }

      const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/actions/execute-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          job_id: job.id,
          agent_id: job.agent_id || undefined,
          service,
          action,
          payload,
        }),
      });

      const result = await response.json().catch(() => ({} as any));
      if (!response.ok || result?.success !== true) {
        const errMsg = result?.error || `External action failed (${response.status})`;
        await logJob(job.id, errMsg, 'error');
        await completeJob(job.id, { status: 'failed', error: errMsg, output: { result } });
        return;
      }

      await completeJob(job.id, { status: 'succeeded', output: result?.data || result });
      return;
    }
  }

  await completeJob(job.id, { status: 'failed', error: `Unsupported job type: ${job.type}` });
}

/**
 * Calls the control-plane scheduler tick endpoint, which finds all playbook
 * schedules whose next_run_at has elapsed and creates queued jobs for them.
 * The runtime then picks those jobs up through the normal poll loop.
 */
async function tickSchedules(): Promise<void> {
  const jwt = signRuntimeJwt();
  const response = await fetch(`${CONTROL_PLANE_URL}/api/runtimes/schedules/tick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Scheduler tick failed (${response.status}): ${text}`);
  }
  const payload = await response.json().catch(() => ({} as any));
  if (payload?.jobs_created > 0) {
    console.log(`[scheduler] created ${payload.jobs_created} job(s) from due schedules`);
  }
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

  // Lightweight health server for container orchestrators
  const HEALTH_PORT = Number(env('HEALTH_PORT', '3002'));
  const healthServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'zapheit-runtime' }));
  });
  healthServer.listen(HEALTH_PORT, () => {
    console.log(`[runtime] health server listening on :${HEALTH_PORT}`);
  });

  await enroll();
  if (!runtimeSecret) {
    throw new Error('Runtime secret missing after enrollment');
  }

  // Heartbeats
  setInterval(() => {
    void heartbeat().catch((err) => console.error(`[runtime] heartbeat error: ${err?.message || String(err)}`));
  }, HEARTBEAT_INTERVAL_MS);

  // Scheduler: fire immediately, then on the configured interval.
  const runSchedulerTick = () => {
    void tickSchedules().catch((err) => console.error(`[scheduler] tick error: ${err?.message || String(err)}`));
  };
  runSchedulerTick();
  setInterval(runSchedulerTick, SCHEDULER_INTERVAL_MS);

  // Initial heartbeat with automatic secret recovery.
  // On GCP Cloud Run, two instances may briefly overlap on restart. If a newer instance
  // enrolled and rotated runtime_secret_enc in the DB, this instance's cached secret is
  // now stale and the first heartbeat will get a 401. Recovery: wait for the API to persist
  // the new secret to Secret Manager (~5-10s async), then reload and retry.
  let heartbeatOk = false;
  for (let attempt = 0; attempt < 4 && !heartbeatOk; attempt++) {
    try {
      await heartbeat();
      heartbeatOk = true;
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isAuthError = msg.includes('401') || msg.includes('signature') || msg.includes('authentication');
      if (!isAuthError || attempt >= 3) throw err;
      console.warn(`[runtime] initial heartbeat auth error (attempt ${attempt + 1}), reloading secret in 6s…`);
      await new Promise((r) => setTimeout(r, 6000));
      const fresh = await loadRuntimeSecretFromGCP();
      if (fresh.secret.length >= MIN_RUNTIME_SECRET_LENGTH && fresh.secret !== runtimeSecret) {
        runtimeSecret = fresh.secret;
        if (fresh.orgId) organizationId = fresh.orgId;
        console.log('[runtime] updated secret from Secret Manager, retrying heartbeat');
      }
    }
  }

  await loopPoll();
}

void main().catch((err) => {
  console.error(`[runtime] fatal: ${err?.message || String(err)}`);
  process.exit(1);
});
