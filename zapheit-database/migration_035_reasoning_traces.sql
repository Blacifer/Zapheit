-- migration_035_reasoning_traces.sql
-- Captures per-request reasoning traces from the LLM gateway:
-- tool calls, interceptors applied, risk scores, confidence calibration, entropy.

CREATE TABLE IF NOT EXISTS gateway_reasoning_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  request_id TEXT,                          -- idempotency key / client request ID
  model TEXT,                               -- e.g. gpt-4o, claude-3-5-sonnet
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  total_tokens INT GENERATED ALWAYS AS (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) STORED,
  latency_ms INT,                           -- total gateway round-trip ms
  tool_calls JSONB DEFAULT '[]'::JSONB,     -- [{name, arguments, result, latency_ms}]
  interceptors_applied JSONB DEFAULT '[]'::JSONB, -- list of interceptor rule IDs/names that fired
  risk_score NUMERIC(4,3),                  -- 0.000-1.000 composite from incident detection
  confidence_gap NUMERIC(4,3),             -- |predicted_confidence - actual_outcome|
  prompt_drift_score NUMERIC(4,3),          -- similarity delta from baseline prompt
  response_entropy NUMERIC(8,4),            -- Shannon entropy of response text
  policy_violations JSONB DEFAULT '[]'::JSONB, -- [{policy_id, policy_name, rule, action_taken}]
  discarded_options JSONB DEFAULT '[]'::JSONB, -- future: reasoning chain alternatives
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gateway_traces_org ON gateway_reasoning_traces(organization_id);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_agent ON gateway_reasoning_traces(agent_id);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_conversation ON gateway_reasoning_traces(conversation_id);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_created ON gateway_reasoning_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_risk ON gateway_reasoning_traces(risk_score) WHERE risk_score IS NOT NULL;

-- Row-Level Security
ALTER TABLE gateway_reasoning_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_traces"
  ON gateway_reasoning_traces FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "service_role_can_insert_traces"
  ON gateway_reasoning_traces FOR INSERT
  WITH CHECK (true);

-- Allow org members to delete their own org's traces (for data privacy)
CREATE POLICY "org_admins_can_delete_traces"
  ON gateway_reasoning_traces FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );
