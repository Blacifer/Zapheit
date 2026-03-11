-- Database Migration: Integrations (Spec-driven)
-- Version: 1.0.0
-- Created: 2026-03-10
-- Description: Add spec-driven integrations + encrypted credentials tables
--
-- Run with:
--   psql postgresql://user:password@host:5432/dbname < migration_002_integrations.sql
--
-- Or from Supabase SQL editor

BEGIN;

-- Integrations (spec-driven connector records)
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    service_type VARCHAR(100) NOT NULL, -- e.g., 'naukri', 'cleartax', 'zoho_people'
    service_name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, -- HRMS, PAYROLL, RECRUITMENT, etc.

    status VARCHAR(20) DEFAULT 'disconnected', -- disconnected, connected, error, syncing, expired
    auth_type VARCHAR(30) NOT NULL, -- oauth2, api_key, client_credentials, basic_auth

    ai_enabled BOOLEAN DEFAULT false,
    ai_last_training TIMESTAMP WITH TIME ZONE,
    ai_model_version VARCHAR(100),
    ai_confidence REAL,

    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_error_at TIMESTAMP WITH TIME ZONE,
    last_error_msg TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (organization_id, service_type)
);

CREATE INDEX idx_integrations_org_id ON integrations(organization_id);
CREATE INDEX idx_integrations_service_type ON integrations(service_type);
CREATE INDEX idx_integrations_category ON integrations(category);
CREATE INDEX idx_integrations_status ON integrations(status);

-- Encrypted credentials per integration (api keys, access tokens, refresh tokens)
CREATE TABLE integration_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,

    key VARCHAR(100) NOT NULL, -- e.g., api_key, client_id, access_token
    value TEXT NOT NULL, -- encrypted value for sensitive fields
    is_sensitive BOOLEAN DEFAULT true,

    expires_at TIMESTAMP WITH TIME ZONE,

    label VARCHAR(255),
    last_rotated TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (integration_id, key)
);

CREATE INDEX idx_integration_credentials_integration_id ON integration_credentials(integration_id);
CREATE INDEX idx_integration_credentials_key ON integration_credentials(key);
CREATE INDEX idx_integration_credentials_expires ON integration_credentials(expires_at);

-- Optional: connection logs for audit / debugging
CREATE TABLE integration_connection_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,

    action VARCHAR(30) NOT NULL, -- connect, disconnect, sync, refresh, test, error
    status VARCHAR(20) NOT NULL, -- success, failed
    message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integration_connection_logs_integration_created ON integration_connection_logs(integration_id, created_at DESC);

-- Row Level Security
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connection_logs ENABLE ROW LEVEL SECURITY;

-- Policies: Integrations (org members can CRUD)
CREATE POLICY "Org members can view integrations" ON integrations
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert integrations" ON integrations
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update integrations" ON integrations
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can delete integrations" ON integrations
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Policies: Credentials (scope through parent integration)
CREATE POLICY "Org members can view integration credentials" ON integration_credentials
    FOR SELECT USING (
      integration_id IN (
        SELECT id FROM integrations
        WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can insert integration credentials" ON integration_credentials
    FOR INSERT WITH CHECK (
      integration_id IN (
        SELECT id FROM integrations
        WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can update integration credentials" ON integration_credentials
    FOR UPDATE USING (
      integration_id IN (
        SELECT id FROM integrations
        WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can delete integration credentials" ON integration_credentials
    FOR DELETE USING (
      integration_id IN (
        SELECT id FROM integrations
        WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );

-- Policies: Connection logs (read/insert only for org members)
CREATE POLICY "Org members can view integration connection logs" ON integration_connection_logs
    FOR SELECT USING (
      integration_id IN (
        SELECT id FROM integrations
        WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can insert integration connection logs" ON integration_connection_logs
    FOR INSERT WITH CHECK (
      integration_id IN (
        SELECT id FROM integrations
        WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );

-- Ensure updated_at trigger function exists (idempotent).
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_integration_credentials_updated_at BEFORE UPDATE ON integration_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

