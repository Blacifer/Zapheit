-- Database Migration: Agent Runtime Orchestration
-- Version: 1.0.0
-- Created: 2026-03-10
-- Description: Add runtime instances, deployments, jobs, approvals, and action run tracking
--
-- Run with:
--   psql postgresql://user:password@host:5432/dbname < migration_004_runtime_orchestration.sql
--
-- Or from Supabase SQL editor

BEGIN;

-- Runtime instances (customer VPC / hosted executors)
CREATE TABLE runtime_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    mode VARCHAR(20) DEFAULT 'vpc', -- hosted, vpc
    status VARCHAR(20) DEFAULT 'pending', -- pending, online, offline, degraded

    last_heartbeat_at TIMESTAMP WITH TIME ZONE,
    version VARCHAR(100),

    capabilities JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Enrollment (one-time) + runtime credential (encrypted)
    enrollment_token_hash TEXT,
    enrollment_expires_at TIMESTAMP WITH TIME ZONE,
    enrollment_used_at TIMESTAMP WITH TIME ZONE,
    runtime_secret_enc TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_runtime_instances_org_id ON runtime_instances(organization_id);
CREATE INDEX idx_runtime_instances_status ON runtime_instances(status);
CREATE INDEX idx_runtime_instances_last_heartbeat ON runtime_instances(last_heartbeat_at);

-- Agent deployments bind an agent to a runtime instance
CREATE TABLE agent_deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,
    runtime_instance_id UUID REFERENCES runtime_instances(id) ON DELETE CASCADE,

    status VARCHAR(20) DEFAULT 'active', -- active, paused, terminated
    execution_policy JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (organization_id, agent_id)
);

CREATE INDEX idx_agent_deployments_org_id ON agent_deployments(organization_id);
CREATE INDEX idx_agent_deployments_agent_id ON agent_deployments(agent_id);
CREATE INDEX idx_agent_deployments_runtime_id ON agent_deployments(runtime_instance_id);

-- Jobs represent approved units of work executed by a runtime
CREATE TABLE agent_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    runtime_instance_id UUID REFERENCES runtime_instances(id) ON DELETE SET NULL,

    type VARCHAR(30) NOT NULL, -- chat_turn, workflow_run, connector_action
    status VARCHAR(30) DEFAULT 'pending_approval', -- pending_approval, queued, running, succeeded, failed, canceled

    input JSONB DEFAULT '{}'::jsonb,
    output JSONB DEFAULT '{}'::jsonb,
    error TEXT,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_agent_jobs_org_id ON agent_jobs(organization_id);
CREATE INDEX idx_agent_jobs_agent_id ON agent_jobs(agent_id);
CREATE INDEX idx_agent_jobs_runtime_id ON agent_jobs(runtime_instance_id);
CREATE INDEX idx_agent_jobs_status ON agent_jobs(status);
CREATE INDEX idx_agent_jobs_created_at ON agent_jobs(created_at);

-- Approval records (always required for side-effectful work)
CREATE TABLE agent_job_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES agent_jobs(id) ON DELETE CASCADE,

    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,

    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    policy_snapshot JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    decided_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_agent_job_approvals_job_id ON agent_job_approvals(job_id);
CREATE INDEX idx_agent_job_approvals_status ON agent_job_approvals(status);

-- Action runs: normalized record of side-effectful connector actions
CREATE TABLE agent_action_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
    job_id UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,

    action_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'ok', -- ok, failed

    input JSONB DEFAULT '{}'::jsonb,
    output JSONB DEFAULT '{}'::jsonb,
    error TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_action_runs_org_id ON agent_action_runs(organization_id);
CREATE INDEX idx_agent_action_runs_agent_id ON agent_action_runs(agent_id);
CREATE INDEX idx_agent_action_runs_job_id ON agent_action_runs(job_id);
CREATE INDEX idx_agent_action_runs_created_at ON agent_action_runs(created_at);

COMMIT;

