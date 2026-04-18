-- ---------------------------------------------------------------------------
-- Migration 038: Integration Reliability Layer
-- Adds circuit-breaker state tracking, retry queue, and idempotency keys
-- for external connector actions.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Per-(org, connector) circuit breaker state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_circuit_breakers (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id     TEXT        NOT NULL,
  state            TEXT        NOT NULL DEFAULT 'closed', -- closed | open | half_open
  failure_count    INTEGER     NOT NULL DEFAULT 0,
  last_failure_at  TIMESTAMPTZ,
  opened_at        TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_ccb_org_connector
  ON connector_circuit_breakers(organization_id, connector_id);

-- ---------------------------------------------------------------------------
-- Retry queue: persists failed/blocked connector actions for later execution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_retry_queue (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  connector_id     TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  params           JSONB       NOT NULL DEFAULT '{}',
  credentials_ref  TEXT,        -- integration_id to re-fetch creds at retry time
  attempt_count    INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 3,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error       TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending', -- pending | succeeded | failed | abandoned
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crq_pending
  ON connector_retry_queue(status, next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_crq_org
  ON connector_retry_queue(organization_id, created_at DESC);

-- RLS: org members can read their queue items; service role writes them
ALTER TABLE connector_circuit_breakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_retry_queue      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccb_select" ON connector_circuit_breakers FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

CREATE POLICY "crq_select" ON connector_retry_queue FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Idempotency key column on connector_action_executions
-- Allows the executor to detect duplicate calls (same org + fingerprint)
-- and return the cached result without firing the external API again.
-- ---------------------------------------------------------------------------
ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cae_idempotency
  ON connector_action_executions(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND success = true;

COMMIT;
