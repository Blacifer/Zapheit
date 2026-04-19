/**
 * Zapheit MCP Gateway — governed Model Context Protocol server
 *
 * Implements the MCP SSE transport (spec: modelcontextprotocol.io).
 * Every tool call is policy-checked, proxied, audit-logged, and recorded
 * in mcp_tool_calls — giving the same governance coverage as the LLM gateway.
 *
 * Transport:
 *   GET  /mcp/sse           — open SSE session; server emits an `endpoint` event
 *   POST /mcp/messages      — send JSON-RPC 2.0 messages (sessionId in query)
 *
 * Tool registry (requires API key):
 *   POST   /mcp/tools       — register a tool for the authenticated org
 *   GET    /mcp/tools       — list active tools
 *   DELETE /mcp/tools/:name — deactivate a tool
 */

import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { validateApiKey } from '../middleware/api-key-validation';
import { supabaseRest } from '../lib/supabase-rest';
import { evaluatePolicies } from '../services/policy-engine';
import { auditLog } from '../lib/audit-logger';
import logger from '../lib/logger';

const router = express.Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface McpToolRow {
  id: string;
  organization_id: string;
  agent_id?: string | null;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  endpoint_url: string;
  endpoint_method: string;
  endpoint_headers?: Record<string, string> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type PolicyDecision = 'allow' | 'warn' | 'require_approval' | 'block';

// ─── In-memory SSE session store ──────────────────────────────────────────────
// Maps sessionId → { res, orgId, agentId }
// Acceptable for an MVP — replace with Redis pub/sub for multi-instance deploys.

interface McpSession {
  res: Response;
  orgId: string;
  agentId?: string;
}

const sessions = new Map<string, McpSession>();

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function rpcOk(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcErr(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ─── SSE connection ────────────────────────────────────────────────────────────

router.get('/sse', validateApiKey, (req: Request, res: Response) => {
  const orgId = req.apiKey!.organization_id;
  const agentId = req.apiKey!.allowed_agent_ids?.[0];
  const sessionId = crypto.randomUUID();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

  sessions.set(sessionId, { res, orgId, agentId });

  // Tell the client where to POST messages (MCP SSE transport requirement)
  sendEvent(res, 'endpoint', { uri: `/mcp/messages?sessionId=${sessionId}` });

  logger.info('MCP SSE session opened', { sessionId, orgId });

  req.on('close', () => {
    sessions.delete(sessionId);
    logger.info('MCP SSE session closed', { sessionId });
  });
});

// ─── Message receiver ─────────────────────────────────────────────────────────

router.post('/messages', validateApiKey, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(400).json({ error: 'Unknown sessionId — open an SSE connection first' });
    return;
  }

  const msg = req.body;
  if (!msg || msg.jsonrpc !== '2.0' || !msg.method) {
    session.res.write(`event: message\ndata: ${JSON.stringify(rpcErr(msg?.id ?? null, -32600, 'Invalid JSON-RPC request'))}\n\n`);
    res.status(202).end();
    return;
  }

  // Acknowledge receipt immediately; response travels over SSE
  res.status(202).end();

  try {
    const reply = await dispatchRpc(msg, session);
    if (reply !== null) {
      session.res.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
    }
  } catch (err: any) {
    logger.error('MCP RPC dispatch error', { error: err?.message, method: msg.method });
    session.res.write(`event: message\ndata: ${JSON.stringify(rpcErr(msg.id, -32603, err?.message || 'Internal error'))}\n\n`);
  }
});

// ─── JSON-RPC dispatcher ──────────────────────────────────────────────────────

async function dispatchRpc(msg: any, session: McpSession) {
  const { id, method, params } = msg;
  const { orgId, agentId } = session;

  switch (method) {
    case 'initialize':
      return rpcOk(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'zapheit-mcp', version: '1.0.0' },
      });

    case 'initialized':
      // Notification — no response required per MCP spec
      return null;

    case 'ping':
      return rpcOk(id, {});

    case 'tools/list':
      return rpcOk(id, { tools: await listTools(orgId, agentId) });

    case 'tools/call':
      return rpcOk(id, await callTool(orgId, agentId, params));

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Tool list ────────────────────────────────────────────────────────────────

async function listTools(orgId: string, agentId?: string) {
  const rows: McpToolRow[] = (await supabaseRest(
    'mcp_tools',
    `organization_id=eq.${orgId}&is_active=eq.true&order=name.asc`,
    { method: 'GET' },
  )) || [];

  return rows
    .filter((t: McpToolRow) => !agentId || !t.agent_id || t.agent_id === agentId)
    .map((t: McpToolRow) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));
}

// ─── Governed tool call ───────────────────────────────────────────────────────

async function callTool(
  orgId: string,
  agentId: string | undefined,
  params: { name: string; arguments?: Record<string, unknown> },
) {
  const { name, arguments: toolArgs = {} } = params;
  const start = Date.now();

  // 1. Look up the tool
  const toolRows: McpToolRow[] = (await supabaseRest(
    'mcp_tools',
    `organization_id=eq.${orgId}&name=eq.${encodeURIComponent(name)}&is_active=eq.true`,
    { method: 'GET' },
  )) || [];
  const tool = toolRows[0];
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  // 2. Policy check
  const policyRows: Array<{ id: string; action: string; rules: unknown[] }> = (await supabaseRest(
    'action_policies',
    `organization_id=eq.${orgId}&service=eq.mcp&enabled=eq.true`,
    { method: 'GET' },
  )) || [];

  const policies = policyRows.map((p: { id: string; action: string; rules: unknown[] }) => ({
    id: p.id,
    name: p.action,
    rules: p.rules ?? [],
  }));

  const evalCtx = {
    content: JSON.stringify(toolArgs),
    context: { tool: name, agent_id: agentId, ...toolArgs },
  };

  let policyDecision: PolicyDecision = 'allow';
  if (policies.length > 0) {
    const result = evaluatePolicies(policies as any, evalCtx);
    policyDecision = result.decision as PolicyDecision;
  }

  // 3. Enforce policy decision
  if (policyDecision === 'block') {
    void recordCall(orgId, agentId, name, toolArgs, null, 'block', null, Date.now() - start, 'Blocked by policy');
    return { content: [{ type: 'text', text: 'Tool call blocked by governance policy.' }], isError: true };
  }

  if (policyDecision === 'require_approval') {
    void recordCall(orgId, agentId, name, toolArgs, null, 'require_approval', null, Date.now() - start, 'Pending approval');
    return { content: [{ type: 'text', text: 'Tool call requires human approval. A request has been submitted.' }], isError: false };
  }

  // 4. Proxy the call to the registered endpoint
  let httpStatus: number | null = null;
  let output: unknown = null;
  let errorMsg: string | undefined;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((tool.endpoint_headers as Record<string, string>) || {}),
    };

    const fetchRes = await fetch(tool.endpoint_url, {
      method: tool.endpoint_method,
      headers,
      body: tool.endpoint_method !== 'GET' ? JSON.stringify(toolArgs) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    httpStatus = fetchRes.status;

    if (fetchRes.ok) {
      const ct = fetchRes.headers.get('content-type') || '';
      output = ct.includes('application/json') ? await fetchRes.json() : await fetchRes.text();
    } else {
      const text = await fetchRes.text().catch(() => fetchRes.statusText);
      errorMsg = `Upstream returned ${fetchRes.status}: ${text}`;
    }
  } catch (err: any) {
    errorMsg = err?.message || 'Upstream request failed';
  }

  const latency = Date.now() - start;

  // 5. Audit + record (fire-and-forget — don't block the response)
  void Promise.all([
    recordCall(orgId, agentId, name, toolArgs, output, policyDecision, httpStatus, latency, errorMsg),
    auditLog.log({
      user_id: agentId ?? 'system',
      action: 'mcp.tool_call',
      resource_type: 'mcp_tool',
      resource_id: tool.id,
      organization_id: orgId,
      metadata: { tool: name, policy: policyDecision, latency_ms: latency, status: httpStatus },
    }),
  ]);

  // 6. Return MCP-shaped response
  if (errorMsg) {
    return { content: [{ type: 'text', text: errorMsg }], isError: true };
  }

  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return { content: [{ type: 'text', text }], isError: false };
}

async function recordCall(
  orgId: string,
  agentId: string | undefined,
  toolName: string,
  input: unknown,
  output: unknown,
  policyDecision: string,
  httpStatus: number | null,
  latencyMs: number,
  error?: string,
) {
  try {
    await supabaseRest(
      'mcp_tool_calls',
      '',
      {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agentId ?? null,
          tool_name: toolName,
          input,
          output,
          policy_decision: policyDecision,
          http_status: httpStatus,
          latency_ms: latencyMs,
          error: error ?? null,
        },
      },
    );
  } catch (err) {
    logger.error('MCP: failed to record tool call', { error: String(err) });
  }
}

// ─── Tool registry REST endpoints ─────────────────────────────────────────────

/**
 * @openapi
 * /mcp/tools:
 *   post:
 *     tags: [MCP]
 *     summary: Register a tool with the Zapheit MCP gateway
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, description, endpoint_url, input_schema]
 *             properties:
 *               name:             { type: string, example: search_kb }
 *               description:      { type: string, example: Search the knowledge base }
 *               endpoint_url:     { type: string, format: uri }
 *               endpoint_method:  { type: string, enum: [GET, POST, PUT, PATCH], default: POST }
 *               endpoint_headers: { type: object }
 *               input_schema:     { type: object, description: JSON Schema for tool arguments }
 *               agent_id:         { type: string, format: uuid }
 *     responses:
 *       201: { description: Tool registered }
 *       400: { description: Validation error }
 */
router.post('/tools', validateApiKey, async (req: Request, res: Response) => {
  const orgId = req.apiKey!.organization_id;
  const { name, description, endpoint_url, endpoint_method, endpoint_headers, input_schema, agent_id } = req.body;

  if (!name || !description || !endpoint_url || !input_schema) {
    res.status(400).json({ error: 'name, description, endpoint_url, and input_schema are required' });
    return;
  }

  if (!/^https?:\/\//.test(endpoint_url)) {
    res.status(400).json({ error: 'endpoint_url must be an http or https URL' });
    return;
  }

  try {
    const row = await supabaseRest(
      'mcp_tools',
      '',
      {
        method: 'POST',
        body: {
          organization_id: orgId,
          agent_id: agent_id ?? null,
          name,
          description,
          input_schema,
          endpoint_url,
          endpoint_method: (endpoint_method || 'POST').toUpperCase(),
          endpoint_headers: endpoint_headers ?? {},
          is_active: true,
        },
        headers: { Prefer: 'on_conflict=organization_id,name&resolution=merge-duplicates,return=representation' },
      },
    );
    res.status(201).json(row);
  } catch (err: any) {
    logger.error('MCP: tool register failed', { error: err?.message });
    res.status(500).json({ error: 'Failed to register tool' });
  }
});

/**
 * @openapi
 * /mcp/tools:
 *   get:
 *     tags: [MCP]
 *     summary: List registered MCP tools for the authenticated org
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Array of registered tools
 */
router.get('/tools', validateApiKey, async (req: Request, res: Response) => {
  const orgId = req.apiKey!.organization_id;
  try {
    const rows = await supabaseRest(
      'mcp_tools',
      `organization_id=eq.${orgId}&is_active=eq.true&order=name.asc`,
      { method: 'GET' },
    );
    res.json({ tools: rows || [] });
  } catch (err: any) {
    logger.error('MCP: list tools failed', { error: err?.message });
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

/**
 * @openapi
 * /mcp/tools/{name}:
 *   delete:
 *     tags: [MCP]
 *     summary: Deactivate a registered MCP tool
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tool deactivated }
 *       404: { description: Not found }
 */
router.delete('/tools/:name', validateApiKey, async (req: Request, res: Response) => {
  const orgId = req.apiKey!.organization_id;
  const toolName = req.params.name;

  try {
    await supabaseRest(
      'mcp_tools',
      `organization_id=eq.${orgId}&name=eq.${encodeURIComponent(toolName)}`,
      { method: 'PATCH', body: { is_active: false, updated_at: new Date().toISOString() } },
    );
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('MCP: deactivate tool failed', { error: err?.message });
    res.status(500).json({ error: 'Failed to deactivate tool' });
  }
});

export default router;
