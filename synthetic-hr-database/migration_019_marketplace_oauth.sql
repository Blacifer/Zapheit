-- Migration 019: Marketplace OAuth States
-- Creates the integration_oauth_states table used by the marketplace OAuth flow.
-- This table was previously only in schema.sql; this migration makes it official.

BEGIN;

CREATE TABLE IF NOT EXISTS integration_oauth_states (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    state            UUID         NOT NULL UNIQUE,
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          UUID,
    provider_name    VARCHAR(100) NOT NULL,
    app_id           VARCHAR(100),         -- marketplace app id (e.g. 'hubspot', 'salesforce')
    redirect_uri     TEXT         NOT NULL,
    expires_at       TIMESTAMPTZ  NOT NULL,
    consumed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state   ON integration_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_org     ON integration_oauth_states(organization_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON integration_oauth_states(expires_at);

COMMIT;
