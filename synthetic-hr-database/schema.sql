-- Synthetic HR Database Schema
-- Production-ready multi-tenant database design

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations (Multi-tenant)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'audit', -- audit, retainer, enterprise
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'viewer', -- admin, manager, viewer
    avatar_url TEXT,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI Agents
CREATE TABLE ai_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    agent_type VARCHAR(50), -- support, sales, refund, hr, analyst, custom
    platform VARCHAR(50), -- openai, anthropic, azure, custom
    model_name VARCHAR(100),
    system_prompt TEXT,
    status VARCHAR(20) DEFAULT 'active', -- active, paused, terminated
    risk_level VARCHAR(20) DEFAULT 'low', -- low, medium, high
    risk_score INTEGER DEFAULT 50,
    config JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversations
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    external_conversation_id VARCHAR(255), -- ID from external system
    platform VARCHAR(50), -- slack, discord, intercom, zendesk, custom
    status VARCHAR(20) DEFAULT 'active', -- active, completed, terminated
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    token_count INTEGER,
    cost_usd DECIMAL(10, 6),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Incidents
CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    incident_type VARCHAR(50) NOT NULL, -- pii_leak, hallucination, refund_abuse, legal_advice, infinite_loop, angry_user, custom
    severity VARCHAR(20) DEFAULT 'low', -- low, medium, high, critical
    status VARCHAR(20) DEFAULT 'open', -- open, investigating, resolved, false_positive
    title VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_content TEXT,
    ai_response TEXT,
    resolution_notes TEXT,
    escalated_to VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Escalations (for routing critical incidents)
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL, -- slack, pagerduty, email
    severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
    status VARCHAR(20) DEFAULT 'open', -- open, acknowledged, resolved
    assignee VARCHAR(255),
    escalation_details JSONB DEFAULT '{}', -- channel-specific response data
    idempotency_key VARCHAR(255) UNIQUE, -- prevent duplicate alert processing
    delivery_attempts INTEGER DEFAULT 0,
    delivery_status VARCHAR(50) DEFAULT 'pending', -- pending, delivered, failed
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    error_details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost Tracking
CREATE TABLE cost_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    model_name VARCHAR(100),
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    avg_latency_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent Performance Reviews
CREATE TABLE performance_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,
    review_period_start DATE NOT NULL,
    review_period_end DATE NOT NULL,
    total_conversations INTEGER DEFAULT 0,
    avg_satisfaction_score DECIMAL(5, 2),
    accuracy_score DECIMAL(5, 2),
    tone_score DECIMAL(5, 2),
    incident_count INTEGER DEFAULT 0,
    total_cost_usd DECIMAL(10, 2),
    recommendations TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Keys (for customer integrations)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    permissions JSONB DEFAULT '["read"]',
    rate_limit INTEGER DEFAULT 1000,
    last_used TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'active', -- active, expired, revoked
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Gateway idempotency keys (durable replay protection for API gateway)
CREATE TABLE gateway_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
    route_path VARCHAR(120) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, completed
    http_status INTEGER,
    content_type VARCHAR(20), -- json, text
    response_payload JSONB,
    response_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(api_key_id, route_path, idempotency_key)
);

-- Team Invitations (for multi-user collaboration)
CREATE TABLE invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- admin, manager, viewer
    token VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, rejected, expired, cancelled
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Logs (for compliance)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Platform Integrations (Universal Connector)
CREATE TABLE platform_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'disconnected', -- connected, active, disconnected, error
    icon VARCHAR(10) DEFAULT '🔌',
    requests INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Spec-driven Integrations (HR platform connectors)
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

CREATE TABLE integration_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    is_sensitive BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    label VARCHAR(255),
    last_rotated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (integration_id, key)
);

CREATE TABLE integration_connection_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE,
    action VARCHAR(30) NOT NULL, -- connect, disconnect, sync, refresh, test, error
    status VARCHAR(20) NOT NULL, -- success, failed
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- API Proxy Endpoints
CREATE TABLE proxy_endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    path VARCHAR(500) NOT NULL,
    method VARCHAR(10) NOT NULL, -- GET, POST, PUT, DELETE, PATCH
    requests INTEGER DEFAULT 0,
    latency VARCHAR(20) DEFAULT '0ms',
    status VARCHAR(50) DEFAULT 'active', -- active, inactive, maintenance
    description TEXT,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Log Scraper Configurations
CREATE TABLE log_scraper_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    source VARCHAR(255) NOT NULL,
    last_sync TIMESTAMP WITH TIME ZONE,
    messages INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'idle', -- syncing, idle, error
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Policy Packs (Enterprise Feature)
CREATE TABLE policy_packs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    policy_type VARCHAR(50), -- gdpr, soc2, hipaa, custom
    rules JSONB NOT NULL DEFAULT '[]', -- Array of policy rules
    enforcement_level VARCHAR(50) DEFAULT 'warn', -- block, warn, audit
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Policy Assignments (which agents/users are subject to which policies)
CREATE TABLE policy_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_pack_id UUID REFERENCES policy_packs(id) ON DELETE CASCADE,
    target_type VARCHAR(50) NOT NULL, -- agent, user, organization
    target_id UUID NOT NULL, -- ID of agent/user/org
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Compliance Exports (SOC2/GDPR evidence exports)
CREATE TABLE compliance_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    export_type VARCHAR(50) NOT NULL, -- soc2, gdpr, hipaa, full_audit
    requested_by UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
    date_range_start TIMESTAMP WITH TIME ZONE,
    date_range_end TIMESTAMP WITH TIME ZONE,
    filters JSONB DEFAULT '{}',
    file_url TEXT,
    file_size_bytes INTEGER,
    record_count INTEGER,
    error_message TEXT,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Compliance Events (track compliance-relevant events)
CREATE TABLE compliance_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- policy_violation, data_access, consent_change, etc
    severity VARCHAR(20) DEFAULT 'info', -- info, warning, critical
    resource_type VARCHAR(50), -- agent, conversation, user, data
    resource_id UUID,
    actor_id UUID REFERENCES users(id),
    details JSONB DEFAULT '{}',
    remediation_status VARCHAR(50) DEFAULT 'none', -- none, in_progress, resolved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_agents_organization ON ai_agents(organization_id);
CREATE INDEX idx_agents_status ON ai_agents(status);
CREATE INDEX idx_conversations_organization ON conversations(organization_id);
CREATE INDEX idx_conversations_agent ON conversations(agent_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_incidents_organization ON incidents(organization_id);
CREATE INDEX idx_incidents_agent ON incidents(agent_id);
CREATE INDEX idx_incidents_type ON incidents(incident_type);
CREATE INDEX idx_escalations_organization ON escalations(organization_id);
CREATE INDEX idx_escalations_incident ON escalations(incident_id);
CREATE INDEX idx_escalations_idempotency_key ON escalations(idempotency_key);
CREATE INDEX idx_escalations_delivery_status ON escalations(delivery_status);
CREATE INDEX idx_cost_tracking_organization ON cost_tracking(organization_id, date);
CREATE INDEX idx_cost_tracking_agent ON cost_tracking(agent_id, date);
CREATE INDEX idx_audit_logs_organization ON audit_logs(organization_id, created_at);
CREATE INDEX idx_platform_integrations_organization ON platform_integrations(organization_id);
CREATE INDEX idx_integrations_organization ON integrations(organization_id);
CREATE INDEX idx_integrations_service_type ON integrations(service_type);
CREATE INDEX idx_integrations_category ON integrations(category);
CREATE INDEX idx_integrations_status ON integrations(status);
CREATE INDEX idx_integration_credentials_integration_id ON integration_credentials(integration_id);
CREATE INDEX idx_integration_credentials_key ON integration_credentials(key);
CREATE INDEX idx_integration_credentials_expires ON integration_credentials(expires_at);
CREATE INDEX idx_integration_connection_logs_integration_created ON integration_connection_logs(integration_id, created_at DESC);
CREATE INDEX idx_proxy_endpoints_organization ON proxy_endpoints(organization_id);
CREATE INDEX idx_log_scraper_configs_organization ON log_scraper_configs(organization_id);
CREATE INDEX idx_gateway_idempotency_lookup ON gateway_idempotency_keys(api_key_id, route_path, idempotency_key);
CREATE INDEX idx_gateway_idempotency_expires ON gateway_idempotency_keys(expires_at);
CREATE INDEX idx_gateway_idempotency_status ON gateway_idempotency_keys(status, created_at);
CREATE INDEX idx_policy_packs_organization ON policy_packs(organization_id);
CREATE INDEX idx_policy_packs_active ON policy_packs(organization_id, is_active);
CREATE INDEX idx_policy_assignments_policy ON policy_assignments(policy_pack_id);
CREATE INDEX idx_policy_assignments_target ON policy_assignments(target_type, target_id);
CREATE INDEX idx_compliance_exports_organization ON compliance_exports(organization_id, requested_at);
CREATE INDEX idx_compliance_exports_status ON compliance_exports(status);
CREATE INDEX idx_compliance_events_organization ON compliance_events(organization_id, created_at);
CREATE INDEX idx_compliance_events_type ON compliance_events(event_type, severity);

-- Row Level Security
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE proxy_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_scraper_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Organizations: users can only see their own org
CREATE POLICY "Users can view own organization" ON organizations
    FOR SELECT USING (id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- AI Agents: org members can view/edit
CREATE POLICY "Org members can view agents" ON ai_agents
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert agents" ON ai_agents
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update agents" ON ai_agents
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Users: org members can view/update users in same org
CREATE POLICY "Org members can view users" ON users
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (id = auth.uid());
CREATE POLICY "Org members can update users" ON users
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Conversations: org members can CRUD conversations in their org
CREATE POLICY "Org members can view conversations" ON conversations
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert conversations" ON conversations
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update conversations" ON conversations
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Messages: access is scoped by parent conversation's organization
CREATE POLICY "Org members can view messages" ON messages
    FOR SELECT USING (
      conversation_id IN (
        SELECT c.id FROM conversations c
        WHERE c.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can insert messages" ON messages
    FOR INSERT WITH CHECK (
      conversation_id IN (
        SELECT c.id FROM conversations c
        WHERE c.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );

-- Incidents: org members can CRUD incidents in their org
CREATE POLICY "Org members can view incidents" ON incidents
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert incidents" ON incidents
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update incidents" ON incidents
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Escalations: org members can CRUD escalations in their org
CREATE POLICY "Org members can view escalations" ON escalations
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert escalations" ON escalations
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update escalations" ON escalations
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Cost tracking: org members can CRUD costs in their org
CREATE POLICY "Org members can view costs" ON cost_tracking
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert costs" ON cost_tracking
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update costs" ON cost_tracking
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Performance reviews: org members can CRUD reviews in their org
CREATE POLICY "Org members can view reviews" ON performance_reviews
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert reviews" ON performance_reviews
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update reviews" ON performance_reviews
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- API keys: org members can CRUD keys in their org
CREATE POLICY "Org members can view api keys" ON api_keys
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert api keys" ON api_keys
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update api keys" ON api_keys
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
-- Invites: org members can CRUD invites in their org
CREATE POLICY "Org members can view invites" ON invites
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert invites" ON invites
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update invites" ON invites
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- 
-- Audit logs: org members can only view logs in their org; insert allowed in org scope
CREATE POLICY "Org members can view audit logs" ON audit_logs
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert audit logs" ON audit_logs
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Platform Integrations: org members can CRUD integrations in their org
CREATE POLICY "Org members can view platform integrations" ON platform_integrations
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert platform integrations" ON platform_integrations
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update platform integrations" ON platform_integrations
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can delete platform integrations" ON platform_integrations
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Spec Integrations: org members can CRUD integrations in their org
CREATE POLICY "Org members can view integrations" ON integrations
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert integrations" ON integrations
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update integrations" ON integrations
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can delete integrations" ON integrations
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Integration credentials: access is scoped by parent integration's organization
CREATE POLICY "Org members can view integration credentials" ON integration_credentials
    FOR SELECT USING (
      integration_id IN (
        SELECT i.id FROM integrations i
        WHERE i.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can insert integration credentials" ON integration_credentials
    FOR INSERT WITH CHECK (
      integration_id IN (
        SELECT i.id FROM integrations i
        WHERE i.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can update integration credentials" ON integration_credentials
    FOR UPDATE USING (
      integration_id IN (
        SELECT i.id FROM integrations i
        WHERE i.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can delete integration credentials" ON integration_credentials
    FOR DELETE USING (
      integration_id IN (
        SELECT i.id FROM integrations i
        WHERE i.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );

-- Integration connection logs: org members can read + insert logs in their org
CREATE POLICY "Org members can view integration connection logs" ON integration_connection_logs
    FOR SELECT USING (
      integration_id IN (
        SELECT i.id FROM integrations i
        WHERE i.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );
CREATE POLICY "Org members can insert integration connection logs" ON integration_connection_logs
    FOR INSERT WITH CHECK (
      integration_id IN (
        SELECT i.id FROM integrations i
        WHERE i.organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      )
    );

-- Proxy Endpoints: org members can CRUD endpoints in their org
CREATE POLICY "Org members can view proxy endpoints" ON proxy_endpoints
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert proxy endpoints" ON proxy_endpoints
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update proxy endpoints" ON proxy_endpoints
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can delete proxy endpoints" ON proxy_endpoints
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Log Scraper Configs: org members can CRUD configs in their org
CREATE POLICY "Org members can view log scraper configs" ON log_scraper_configs
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert log scraper configs" ON log_scraper_configs
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update log scraper configs" ON log_scraper_configs
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can delete log scraper configs" ON log_scraper_configs
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Policy Packs: org admins can CRUD policy packs in their org
CREATE POLICY "Org members can view policy packs" ON policy_packs
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org admins can insert policy packs" ON policy_packs
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Org admins can update policy packs" ON policy_packs
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Org admins can delete policy packs" ON policy_packs
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Policy Assignments: org members can view, admins can assign
CREATE POLICY "Org members can view policy assignments" ON policy_assignments
    FOR SELECT USING (policy_pack_id IN (SELECT id FROM policy_packs WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())));
CREATE POLICY "Org admins can insert policy assignments" ON policy_assignments
    FOR INSERT WITH CHECK (policy_pack_id IN (SELECT id FROM policy_packs WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND role = 'admin')));
CREATE POLICY "Org admins can delete policy assignments" ON policy_assignments
    FOR DELETE USING (policy_pack_id IN (SELECT id FROM policy_packs WHERE organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Compliance Exports: org members can view and request exports in their org
CREATE POLICY "Org members can view compliance exports" ON compliance_exports
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can request compliance exports" ON compliance_exports
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Compliance Events: org members can view events in their org
CREATE POLICY "Org members can view compliance events" ON compliance_events
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert compliance events" ON compliance_events
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Gateway idempotency keys: org members can view/insert/update rows in their org
CREATE POLICY "Org members can view gateway idempotency keys" ON gateway_idempotency_keys
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can insert gateway idempotency keys" ON gateway_idempotency_keys
    FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can update gateway idempotency keys" ON gateway_idempotency_keys
    FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Org members can delete gateway idempotency keys" ON gateway_idempotency_keys
    FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_ai_agents_updated_at BEFORE UPDATE ON ai_agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_platform_integrations_updated_at BEFORE UPDATE ON platform_integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_integration_credentials_updated_at BEFORE UPDATE ON integration_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_proxy_endpoints_updated_at BEFORE UPDATE ON proxy_endpoints
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_log_scraper_configs_updated_at BEFORE UPDATE ON log_scraper_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Demo data has been moved out of the schema for production safety.
-- If you want local demo rows, run `synthetic-hr-database/seed_demo.sql` explicitly.
