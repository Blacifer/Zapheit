-- migration_024_oauth_states_app_id.sql
-- The integration_oauth_states table was created before migration_019 added the
-- app_id column. Because CREATE TABLE IF NOT EXISTS skips when the table exists,
-- the column was never added. This migration adds it idempotently.

ALTER TABLE integration_oauth_states
  ADD COLUMN IF NOT EXISTS app_id VARCHAR(100);
