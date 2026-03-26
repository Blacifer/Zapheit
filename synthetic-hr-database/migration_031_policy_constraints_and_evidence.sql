-- Migration 031: Policy constraints and richer connector execution evidence
-- Extends action_policies with structured constraints and connector_action_executions
-- with investigation-grade metadata.

BEGIN;

ALTER TABLE action_policies
  ADD COLUMN IF NOT EXISTS policy_constraints JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS requested_by UUID,
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remediation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_action_policies_constraints
  ON action_policies USING GIN (policy_constraints);

COMMIT;
