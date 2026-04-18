-- Migration 018: Identity Hub tables
-- Unified identity event stream + access-graph for blast-radius analysis

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Identity Events — unified log from Okta / Azure AD / Google Workspace
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_identity_events (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type           VARCHAR(50)  NOT NULL
                           CHECK (event_type IN (
                             'login', 'login_failed', 'mfa_challenge', 'mfa_failed',
                             'password_reset', 'account_locked',
                             'access_granted', 'access_revoked',
                             'user_provisioned', 'user_deprovisioned',
                             'group_changed', 'role_changed',
                             'suspicious_activity', 'other'
                           )),
    severity             VARCHAR(20)  NOT NULL DEFAULT 'info'
                           CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    actor_email          VARCHAR(255),
    actor_name           VARCHAR(255),
    actor_id             VARCHAR(255),
    target_resource      VARCHAR(255),
    target_system        VARCHAR(255),
    source_platform      VARCHAR(100), -- okta, azure_ad, google_workspace, manual
    source_event_id      VARCHAR(255),
    ip_address           VARCHAR(45),
    geo_location         VARCHAR(255),
    user_agent           TEXT,
    details              JSONB DEFAULT '{}',
    ai_anomaly_score     INTEGER,          -- 0-100, null if not scored
    ai_anomaly_reasons   JSONB DEFAULT '[]', -- ["3 countries in 6 hours", ...]
    ai_scored_at         TIMESTAMP WITH TIME ZONE,
    event_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_identity_events_org_id     ON hub_identity_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_hub_identity_events_type       ON hub_identity_events(event_type);
CREATE INDEX IF NOT EXISTS idx_hub_identity_events_severity   ON hub_identity_events(severity);
CREATE INDEX IF NOT EXISTS idx_hub_identity_events_actor      ON hub_identity_events(actor_email);
CREATE INDEX IF NOT EXISTS idx_hub_identity_events_event_at   ON hub_identity_events(event_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Access Graph — maps users → systems they can reach (blast-radius calc)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_access_graph (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_email           VARCHAR(255) NOT NULL,
    user_name            VARCHAR(255),
    system_name          VARCHAR(255) NOT NULL,
    access_level         VARCHAR(50)  NOT NULL DEFAULT 'read'
                           CHECK (access_level IN ('read', 'write', 'admin', 'owner')),
    source_platform      VARCHAR(100), -- okta, azure_ad, google_workspace, manual
    granted_at           TIMESTAMP WITH TIME ZONE,
    last_used_at         TIMESTAMP WITH TIME ZONE,
    status               VARCHAR(50)  NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'inactive', 'revoked', 'pending_review')),
    risk_score           INTEGER,     -- 0-100, computed from sensitivity + access level
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_access_graph_org_id      ON hub_access_graph(organization_id);
CREATE INDEX IF NOT EXISTS idx_hub_access_graph_user_email  ON hub_access_graph(user_email);
CREATE INDEX IF NOT EXISTS idx_hub_access_graph_system      ON hub_access_graph(system_name);
CREATE INDEX IF NOT EXISTS idx_hub_access_graph_status      ON hub_access_graph(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE hub_identity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_identity_events_select_org ON hub_identity_events FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_identity_events_insert_org ON hub_identity_events FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_identity_events_update_org ON hub_identity_events FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_identity_events_delete_org ON hub_identity_events FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

ALTER TABLE hub_access_graph ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_access_graph_select_org ON hub_access_graph FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_access_graph_insert_org ON hub_access_graph FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_access_graph_update_org ON hub_access_graph FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_access_graph_delete_org ON hub_access_graph FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

COMMIT;
