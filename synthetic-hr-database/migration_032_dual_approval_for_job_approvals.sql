-- Migration 032: Dual approval support for agent_job_approvals
-- Allows governed connector actions to require multiple reviewers before queueing.

BEGIN;

ALTER TABLE agent_job_approvals
  ADD COLUMN IF NOT EXISTS required_approvals INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approval_history JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
