-- Database Migration: Deploy Core Schema
-- Version: 1.0.0
-- Created: 2026-03-05
-- Description: Deploy multi-tenant Synthetic HR platform schema
--
-- Run with:
--   psql postgresql://user:password@host:5432/dbname < migration_001_core_schema.sql
--
-- Or from Supabase SQL editor

BEGIN;

-- 1. Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Organizations (Multi-tenant)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'audit', -- audit, retainer, enterprise
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);

-- 3. Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'viewer', -- super_admin, admin, manager, viewer
    avatar_url TEXT,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_org_id ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- 4. AI Agents
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

CREATE INDEX idx_agents_org_id ON ai_agents(organization_id);
CREATE INDEX idx_agents_status ON ai_agents(status);
CREATE INDEX idx_agents_risk_level ON ai_agents(risk_level);

-- 5. Conversations
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

CREATE INDEX idx_conversations_org_id ON conversations(organization_id);
CREATE INDEX idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- 6. Messages
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

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_role ON messages(role);

-- 7. Incidents
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

CREATE INDEX idx_incidents_org_id ON incidents(organization_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_type ON incidents(incident_type);

-- 8. Escalations
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

CREATE INDEX idx_escalations_org_id ON escalations(organization_id);
CREATE INDEX idx_escalations_status ON escalations(status);
CREATE INDEX idx_escalations_idempotency_key ON escalations(idempotency_key);

-- 9. Cost Tracking
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

CREATE INDEX idx_cost_tracking_org_id ON cost_tracking(organization_id);
CREATE INDEX idx_cost_tracking_date ON cost_tracking(date);

-- 10. Agent Performance Reviews
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

CREATE INDEX idx_performance_reviews_org_id ON performance_reviews(organization_id);
CREATE INDEX idx_performance_reviews_agent_id ON performance_reviews(agent_id);

-- 11. API Keys (Missing - needed for gateway)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 hash
    name VARCHAR(255) NOT NULL,
    last_four VARCHAR(4),
    status VARCHAR(20) DEFAULT 'active', -- active, revoked, expired
    rate_limit_per_minute INTEGER DEFAULT 60,
    rate_limit_per_day INTEGER DEFAULT 10000,
    allowed_models TEXT[], -- Array of allowed models
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_keys_org_id ON api_keys(organization_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(status);

-- 12. Gateway Idempotency Keys (Missing - needed for idempotent requests)
CREATE TABLE gateway_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    request_hash VARCHAR(64), -- SHA-256 hash of request
    status VARCHAR(20) DEFAULT 'pending', -- pending, processed, failed
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_idempotency_keys_org_id ON gateway_idempotency_keys(organization_id);
CREATE INDEX idx_idempotency_keys_key ON gateway_idempotency_keys(idempotency_key);
CREATE INDEX idx_idempotency_keys_expires_at ON gateway_idempotency_keys(expires_at);

-- 13. Audit Logs (Missing - needed for compliance)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resource_type VARCHAR(100) NOT NULL, -- ai_agent, conversation, incident, etc
    resource_id UUID,
    action VARCHAR(50) NOT NULL, -- create, read, update, delete, execute
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    status VARCHAR(20) DEFAULT 'success', -- success, failure
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_org_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- 14. API Usage Metrics (Missing - needed for cost tracking)
CREATE TABLE api_usage_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    endpoint VARCHAR(255),
    method VARCHAR(10),
    request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    avg_latency_ms INTEGER,
    p95_latency_ms INTEGER,
    p99_latency_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_usage_org_id ON api_usage_metrics(organization_id);
CREATE INDEX idx_api_usage_date ON api_usage_metrics(date);

-- 15. Team Invites (Missing - needed for user invitations)
CREATE TABLE invites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer',
    token VARCHAR(64) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, expired, revoked
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invites_org_id ON invites(organization_id);
CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_invites_token ON invites(token);
CREATE INDEX idx_invites_status ON invites(status);

-- 16. Schema Migrations (VERSION TRACKING - NEW)
-- Tracks which migrations have been applied to prevent duplicate execution
CREATE TABLE schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    checksum VARCHAR(64), -- SHA-256 hash of migration content
    installed_by VARCHAR(255),
    execution_time_ms INTEGER,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_schema_migrations_applied_at ON schema_migrations(applied_at);

-- Record this migration as applied
INSERT INTO schema_migrations (name, checksum, installed_by, execution_time_ms) 
VALUES ('001_core_schema', 'manual', 'admin', 0)
ON CONFLICT (name) DO NOTHING;

-- Commit all changes
COMMIT;

-- Verify deployment
SELECT 'Organizations' as table_name, COUNT(*) as row_count FROM organizations
UNION ALL
SELECT 'Users', COUNT(*) FROM users
UNION ALL
SELECT 'AI Agents', COUNT(*) FROM ai_agents
UNION ALL
SELECT 'Conversations', COUNT(*) FROM conversations
UNION ALL
SELECT 'Messages', COUNT(*) FROM messages
UNION ALL
SELECT 'Incidents', COUNT(*) FROM incidents
UNION ALL
SELECT 'Escalations', COUNT(*) FROM escalations
UNION ALL
SELECT 'Cost Tracking', COUNT(*) FROM cost_tracking
UNION ALL
SELECT 'Performance Reviews', COUNT(*) FROM performance_reviews
UNION ALL
SELECT 'API Keys', COUNT(*) FROM api_keys
UNION ALL
SELECT 'Idempotency Keys', COUNT(*) FROM gateway_idempotency_keys
UNION ALL
SELECT 'Audit Logs', COUNT(*) FROM audit_logs
UNION ALL
SELECT 'API Usage Metrics', COUNT(*) FROM api_usage_metrics
UNION ALL
SELECT 'Invites', COUNT(*) FROM invites
UNION ALL
SELECT 'Schema Migrations', COUNT(*) FROM schema_migrations;
