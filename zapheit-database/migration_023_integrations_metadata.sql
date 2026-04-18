-- migration_023_integrations_metadata.sql
-- Adds metadata JSONB column to integrations table.
-- Required by marketplace.ts which writes marketplace_app, developer, and
-- waitlisted fields when creating or updating integration records.

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_integrations_metadata ON integrations USING GIN(metadata);
