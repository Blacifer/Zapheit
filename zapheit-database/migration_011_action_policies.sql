-- Database Migration: Action Policies (Connector Governance)
-- Version: 1.0.0
-- Created: 2026-03-11
-- Description: Per-org policy rules for connector actions (internal/webhook/etc.)

BEGIN;

CREATE TABLE IF NOT EXISTS action_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    service TEXT NOT NULL, -- internal | webhook | <provider>
    action TEXT NOT NULL,  -- e.g. support.ticket.create

    enabled BOOLEAN DEFAULT TRUE,
    require_approval BOOLEAN DEFAULT TRUE,
    required_role VARCHAR(20) DEFAULT 'manager', -- viewer, manager, admin, super_admin

    webhook_allowlist TEXT[] DEFAULT ARRAY[]::TEXT[],

    notes TEXT,

    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (organization_id, service, action)
);

CREATE INDEX IF NOT EXISTS idx_action_policies_org_id ON action_policies(organization_id);
CREATE INDEX IF NOT EXISTS idx_action_policies_service_action ON action_policies(service, action);

COMMIT;

