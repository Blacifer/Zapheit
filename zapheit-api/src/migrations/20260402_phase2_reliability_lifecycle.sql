-- ---------------------------------------------------------------------------
-- Phase 2: Reliability Behavior Layer
-- Adds explicit reliability lifecycle fields to governed action records.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS reliability_state TEXT,
  ADD COLUMN IF NOT EXISTS retry_count       INTEGER,
  ADD COLUMN IF NOT EXISTS next_retry_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS breaker_open      BOOLEAN,
  ADD COLUMN IF NOT EXISTS recovered_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cae_reliability_state
  ON connector_action_executions(organization_id, reliability_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_next_retry
  ON connector_action_executions(organization_id, next_retry_at)
  WHERE next_retry_at IS NOT NULL;

COMMIT;

