-- MCP (Model Context Protocol) tool registry
-- Each row represents one tool that an organisation has registered with the Zapheit MCP gateway.
-- When an LLM calls tools/call, Zapheit checks action_policies then proxies to endpoint_url.

CREATE TABLE IF NOT EXISTS mcp_tools (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  agent_id          uuid                 REFERENCES ai_agents(id)      ON DELETE SET NULL,
  name              text        NOT NULL,
  description       text        NOT NULL DEFAULT '',
  input_schema      jsonb       NOT NULL DEFAULT '{}',
  endpoint_url      text        NOT NULL,
  endpoint_method   text        NOT NULL DEFAULT 'POST',
  endpoint_headers  jsonb                DEFAULT '{}',
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tools_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS mcp_tools_org_idx   ON mcp_tools (organization_id);
CREATE INDEX IF NOT EXISTS mcp_tools_agent_idx ON mcp_tools (agent_id) WHERE agent_id IS NOT NULL;

ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcp_tools_org_isolation ON mcp_tools
  USING (
    organization_id = (
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
    )::uuid
  );

-- MCP session call log — one row per tools/call invocation through the gateway
CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id        uuid                 REFERENCES ai_agents(id)    ON DELETE SET NULL,
  tool_name       text        NOT NULL,
  input           jsonb       NOT NULL DEFAULT '{}',
  output          jsonb,
  policy_decision text        NOT NULL DEFAULT 'allow', -- allow | warn | require_approval | block
  http_status     int,
  latency_ms      int,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_org_idx  ON mcp_tool_calls (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tool_calls_tool_idx ON mcp_tool_calls (organization_id, tool_name);

ALTER TABLE mcp_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcp_tool_calls_org_isolation ON mcp_tool_calls
  USING (
    organization_id = (
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
    )::uuid
  );
