-- ---------------------------------------------------------------------------
-- Migration 039: Seniority Engine
-- Adds correction memory, synthesized rules, and shadow test run history.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Agent corrections: one row per human approve/deny decision on a connector
-- action. Embedding stored as a JSON float8 array for cosine similarity search
-- in JS (no pgvector required).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_corrections (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  approval_id      UUID,       -- source approval_requests.id (no FK — migrations may run out of order)
  service          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  decision         TEXT        NOT NULL CHECK (decision IN ('approved', 'denied')),
  context_summary  TEXT        NOT NULL, -- human-readable summary used for embedding
  reviewer_note    TEXT,
  embedding        JSONB,      -- float8[] stored as JSON array; null when embedding unavailable
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ac_org_service_action
  ON agent_corrections(organization_id, service, action, decision);

CREATE INDEX IF NOT EXISTS idx_ac_org_agent
  ON agent_corrections(organization_id, agent_id, created_at DESC);

ALTER TABLE agent_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ac_select" ON agent_corrections FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Synthesized rules: auto-proposed action policies generated after 3+
-- repeated denials of the same (service, action) pair.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS synthesized_rules (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  trigger_count    INTEGER     NOT NULL DEFAULT 3,
  proposed_policy  JSONB       NOT NULL DEFAULT '{}', -- pre-filled action_policy body
  status           TEXT        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, service, action)
);

CREATE INDEX IF NOT EXISTS idx_sr_org_status
  ON synthesized_rules(organization_id, status);

ALTER TABLE synthesized_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sr_select" ON synthesized_rules FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Shadow test runs: persisted results from POST /agents/:id/test
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shadow_test_runs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  category         TEXT        NOT NULL,
  attack_prompt    TEXT        NOT NULL,
  response         TEXT,
  passed           BOOLEAN     NOT NULL,
  details          TEXT,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_str_org_agent
  ON shadow_test_runs(organization_id, agent_id, created_at DESC);

ALTER TABLE shadow_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "str_select" ON shadow_test_runs FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

COMMIT;
