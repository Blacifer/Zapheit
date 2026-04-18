-- ---------------------------------------------------------------------------
-- Migration 041: Connector Action Execution Governance Backfill
-- Safety migration for environments that missed migration_031.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remediation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cae_requested_by
  ON connector_action_executions(organization_id, requested_by, created_at DESC);

COMMIT;

