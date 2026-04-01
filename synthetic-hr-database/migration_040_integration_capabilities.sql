-- ---------------------------------------------------------------------------
-- Migration 040: Integration Capabilities & Health Tracking
-- Adds per-org capability toggles and connection health fields to integrations.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS enabled_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_tested_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_result     TEXT; -- 'ok' | 'error'

-- Index for fast capability lookups in preflight gate
CREATE INDEX IF NOT EXISTS idx_integrations_capabilities
  ON integrations USING GIN (enabled_capabilities);

COMMIT;
