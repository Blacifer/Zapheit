-- Database Migration: Playbook Settings (DB-backed registry)
-- Version: 1.0.0
-- Created: 2026-03-11
-- Description: Persist enabled/disabled state and optional overrides per org.

BEGIN;

CREATE TABLE IF NOT EXISTS playbook_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    playbook_id TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    overrides JSONB DEFAULT '{}'::jsonb,

    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (organization_id, playbook_id)
);

CREATE INDEX IF NOT EXISTS idx_playbook_settings_org_id ON playbook_settings(organization_id);
CREATE INDEX IF NOT EXISTS idx_playbook_settings_playbook_id ON playbook_settings(playbook_id);

COMMIT;

