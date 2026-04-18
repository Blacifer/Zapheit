-- ---------------------------------------------------------------------------
-- Migration 022: Connector Action Executions
-- Audit table for all actions executed by agents through connected apps.
-- ---------------------------------------------------------------------------

-- Enable uuid extension (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connector_action_executions (
  id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          UUID         REFERENCES ai_agents(id) ON DELETE SET NULL,
  integration_id    UUID         REFERENCES integrations(id) ON DELETE SET NULL,
  connector_id      VARCHAR(100) NOT NULL,
  action            VARCHAR(200) NOT NULL,
  params            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  result            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  success           BOOLEAN      NOT NULL DEFAULT false,
  error_message     TEXT,
  duration_ms       INTEGER,
  approval_required BOOLEAN      NOT NULL DEFAULT false,
  approval_id       UUID,        -- references approval_requests(id) — no FK to avoid dependency on migration_021
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_cae_org
  ON connector_action_executions(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_agent
  ON connector_action_executions(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_connector
  ON connector_action_executions(organization_id, connector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_success
  ON connector_action_executions(organization_id, success, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE connector_action_executions ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's executions
CREATE POLICY "connector_action_executions_select"
  ON connector_action_executions
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Org members can insert (actions are logged by the backend service role,
-- but allowing member INSERT means the API can insert without service_role key)
CREATE POLICY "connector_action_executions_insert"
  ON connector_action_executions
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- No UPDATE or DELETE — audit records are immutable
