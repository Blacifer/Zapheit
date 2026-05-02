-- ============================================================
-- BUNDLED MIGRATIONS 022 → 072
-- Generated 2026-04-27 10:48:12 UTC
-- All migrations are idempotent (use IF NOT EXISTS guards).
-- Safe to run on top of existing schema.
-- Run as one transaction in Supabase SQL Editor.
-- ============================================================


-- ============================================================
-- migration_022_api_key_last_used.sql
-- ============================================================
-- Migration 022: Add last_used column to api_keys
-- The middleware already writes to this column; the live DB was missing it.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS last_used TIMESTAMP WITH TIME ZONE;


-- ============================================================
-- migration_022_connector_actions.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 022: Connector Action Executions
-- Audit table for all actions executed by agents through connected apps.
-- ---------------------------------------------------------------------------

-- Enable uuid extension (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connector_action_executions (
  id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          UUID         REFERENCES ai_agents(id) ON DELETE SET NULL,
  integration_id    UUID         REFERENCES integrations(id) ON DELETE SET NULL,
  connector_id      VARCHAR(100) NOT NULL,
  action            VARCHAR(200) NOT NULL,
  params            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  result            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  success           BOOLEAN      NOT NULL DEFAULT false,
  error_message     TEXT,
  duration_ms       INTEGER,
  approval_required BOOLEAN      NOT NULL DEFAULT false,
  approval_id       UUID,        -- references approval_requests(id) — no FK to avoid dependency on migration_021
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_cae_org
  ON connector_action_executions(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_agent
  ON connector_action_executions(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_connector
  ON connector_action_executions(organization_id, connector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cae_success
  ON connector_action_executions(organization_id, success, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE connector_action_executions ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's executions
DROP POLICY IF EXISTS "connector_action_executions_select" ON connector_action_executions;
CREATE POLICY "connector_action_executions_select"
  ON connector_action_executions
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Org members can insert (actions are logged by the backend service role,
-- but allowing member INSERT means the API can insert without service_role key)
DROP POLICY IF EXISTS "connector_action_executions_insert" ON connector_action_executions;
CREATE POLICY "connector_action_executions_insert"
  ON connector_action_executions
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- No UPDATE or DELETE — audit records are immutable


-- ============================================================
-- migration_023_integrations_metadata.sql
-- ============================================================
-- migration_023_integrations_metadata.sql
-- Adds metadata JSONB column to integrations table.
-- Required by marketplace.ts which writes marketplace_app, developer, and
-- waitlisted fields when creating or updating integration records.

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_integrations_metadata ON integrations USING GIN(metadata);


-- ============================================================
-- migration_024_oauth_states_app_id.sql
-- ============================================================
-- migration_024_oauth_states_app_id.sql
-- The integration_oauth_states table was created before migration_019 added the
-- app_id column. Because CREATE TABLE IF NOT EXISTS skips when the table exists,
-- the column was never added. This migration adds it idempotently.

ALTER TABLE integration_oauth_states
  ADD COLUMN IF NOT EXISTS app_id VARCHAR(100);


-- ============================================================
-- migration_025_playbook_extensions.sql
-- ============================================================
-- Migration 025: Playbook system extensions
-- Extends agent_jobs with batch/chain/feedback tracking.
-- Adds tables for: schedules, triggers, custom playbooks, share links, result comments.
-- Extends playbook_settings with API exposure flags.
-- Extends action_policies with routing rules.

BEGIN;

-- ─── 1. Extend agent_jobs ────────────────────────────────────────────────────
ALTER TABLE agent_jobs
  ADD COLUMN IF NOT EXISTS batch_id      UUID,
  ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS feedback      SMALLINT,    -- 1=thumbs_up, -1=thumbs_down, NULL=no feedback
  ADD COLUMN IF NOT EXISTS playbook_id   TEXT;        -- which built-in or custom playbook spawned this job

CREATE INDEX IF NOT EXISTS idx_agent_jobs_batch_id      ON agent_jobs(batch_id)      WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_jobs_parent_job_id ON agent_jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_jobs_playbook_id   ON agent_jobs(playbook_id)   WHERE playbook_id IS NOT NULL;

-- ─── 2. Scheduled playbooks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbook_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  playbook_id     TEXT NOT NULL,        -- built-in id or custom_playbooks.id
  agent_id        UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  input_template  JSONB NOT NULL DEFAULT '{}'::jsonb,
  cron_expression TEXT NOT NULL,        -- standard cron, e.g. "0 9 * * 1"
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbook_schedules_org_id ON playbook_schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_playbook_schedules_next_run ON playbook_schedules(next_run_at) WHERE enabled = true;

-- ─── 3. Event-triggered playbooks ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbook_triggers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  playbook_id     TEXT NOT NULL,
  agent_id        UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,        -- e.g. 'incident.created', 'conversation.ended'
  event_filter    JSONB DEFAULT '{}'::jsonb,   -- optional conditions on event payload
  field_mappings  JSONB NOT NULL DEFAULT '{}'::jsonb, -- { playbook_field: "event.payload.path" }
  enabled         BOOLEAN NOT NULL DEFAULT true,
  fire_count      INTEGER NOT NULL DEFAULT 0,
  last_fired_at   TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbook_triggers_org_id     ON playbook_triggers(organization_id);
CREATE INDEX IF NOT EXISTS idx_playbook_triggers_event_type ON playbook_triggers(event_type) WHERE enabled = true;

-- ─── 4. Custom playbooks ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_playbooks (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  description            TEXT,
  output_description     TEXT,
  field_extractor_prompt TEXT,
  category               TEXT NOT NULL DEFAULT 'custom',  -- hr | support | sales | it | custom
  icon_name              TEXT,
  fields                 JSONB NOT NULL DEFAULT '[]'::jsonb,   -- PlaybookField[]
  workflow               JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { type, steps[], final_step }
  version                INTEGER NOT NULL DEFAULT 1,
  version_history        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{version, workflow, updated_at}]
  test_cases             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{inputs, checklist[]}]
  api_enabled            BOOLEAN NOT NULL DEFAULT false,
  api_slug               TEXT UNIQUE,
  enabled                BOOLEAN NOT NULL DEFAULT true,
  created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_playbooks_org_id ON custom_playbooks(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_playbooks_api_slug ON custom_playbooks(api_slug) WHERE api_slug IS NOT NULL;

-- ─── 5. Share links ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbook_share_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbook_share_links_token  ON playbook_share_links(token);
CREATE INDEX IF NOT EXISTS idx_playbook_share_links_job_id ON playbook_share_links(job_id);

-- ─── 6. Result comments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbook_result_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbook_result_comments_job_id ON playbook_result_comments(job_id);

-- ─── 7. Extend playbook_settings ─────────────────────────────────────────────
ALTER TABLE playbook_settings
  ADD COLUMN IF NOT EXISTS api_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS api_slug    TEXT;

-- ─── 8. Extend action_policies with routing rules ────────────────────────────
ALTER TABLE action_policies
  ADD COLUMN IF NOT EXISTS routing_rules JSONB NOT NULL DEFAULT '[]'::jsonb;
-- routing_rules format: [{ condition: "payload.amount > 5000", required_role: "admin", required_user_id?: "uuid" }]

COMMIT;


-- ============================================================
-- migration_026_approval_assigned_to.sql
-- ============================================================
-- Migration 026: Add assigned_to to approval_requests for routing rules
-- When action_policies.routing_rules matches action_payload, a specific user
-- can be assigned as the required approver.

BEGIN;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN approval_requests.assigned_to IS
  'Specific user required to approve this request (set by routing rules). NULL = any user with required_role.';

COMMIT;


-- ============================================================
-- migration_027_playbook_rls.sql
-- ============================================================
-- Migration 027: RLS policies for playbook system tables
-- Depends on: migration_025_playbook_extensions.sql
-- Safe to re-run (idempotent DO $$ blocks).

BEGIN;

-- ─── Enable RLS (only if table exists) ───────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_schedules') THEN
    EXECUTE 'ALTER TABLE playbook_schedules ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_triggers') THEN
    EXECUTE 'ALTER TABLE playbook_triggers ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='custom_playbooks') THEN
    EXECUTE 'ALTER TABLE custom_playbooks ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_share_links') THEN
    EXECUTE 'ALTER TABLE playbook_share_links ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_result_comments') THEN
    EXECUTE 'ALTER TABLE playbook_result_comments ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ─── playbook_schedules ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can view schedules') THEN
DROP POLICY IF EXISTS "Org members can view schedules" ON playbook_schedules;
    CREATE POLICY "Org members can view schedules" ON playbook_schedules
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can insert schedules') THEN
DROP POLICY IF EXISTS "Org members can insert schedules" ON playbook_schedules;
    CREATE POLICY "Org members can insert schedules" ON playbook_schedules
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can update schedules') THEN
DROP POLICY IF EXISTS "Org members can update schedules" ON playbook_schedules;
    CREATE POLICY "Org members can update schedules" ON playbook_schedules
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can delete schedules') THEN
DROP POLICY IF EXISTS "Org members can delete schedules" ON playbook_schedules;
    CREATE POLICY "Org members can delete schedules" ON playbook_schedules
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── playbook_triggers ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can view triggers') THEN
DROP POLICY IF EXISTS "Org members can view triggers" ON playbook_triggers;
    CREATE POLICY "Org members can view triggers" ON playbook_triggers
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can insert triggers') THEN
DROP POLICY IF EXISTS "Org members can insert triggers" ON playbook_triggers;
    CREATE POLICY "Org members can insert triggers" ON playbook_triggers
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can update triggers') THEN
DROP POLICY IF EXISTS "Org members can update triggers" ON playbook_triggers;
    CREATE POLICY "Org members can update triggers" ON playbook_triggers
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can delete triggers') THEN
DROP POLICY IF EXISTS "Org members can delete triggers" ON playbook_triggers;
    CREATE POLICY "Org members can delete triggers" ON playbook_triggers
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── custom_playbooks ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can view custom playbooks') THEN
DROP POLICY IF EXISTS "Org members can view custom playbooks" ON custom_playbooks;
    CREATE POLICY "Org members can view custom playbooks" ON custom_playbooks
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can insert custom playbooks') THEN
DROP POLICY IF EXISTS "Org members can insert custom playbooks" ON custom_playbooks;
    CREATE POLICY "Org members can insert custom playbooks" ON custom_playbooks
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can update custom playbooks') THEN
DROP POLICY IF EXISTS "Org members can update custom playbooks" ON custom_playbooks;
    CREATE POLICY "Org members can update custom playbooks" ON custom_playbooks
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can delete custom playbooks') THEN
DROP POLICY IF EXISTS "Org members can delete custom playbooks" ON custom_playbooks;
    CREATE POLICY "Org members can delete custom playbooks" ON custom_playbooks
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── playbook_share_links ─────────────────────────────────────────────────────
-- Public token reads go through the backend service role key — not user JWT.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_share_links' AND policyname='Org members can view share links') THEN
DROP POLICY IF EXISTS "Org members can view share links" ON playbook_share_links;
    CREATE POLICY "Org members can view share links" ON playbook_share_links
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_share_links' AND policyname='Org members can insert share links') THEN
DROP POLICY IF EXISTS "Org members can insert share links" ON playbook_share_links;
    CREATE POLICY "Org members can insert share links" ON playbook_share_links
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_share_links' AND policyname='Org members can delete share links') THEN
DROP POLICY IF EXISTS "Org members can delete share links" ON playbook_share_links;
    CREATE POLICY "Org members can delete share links" ON playbook_share_links
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── playbook_result_comments ─────────────────────────────────────────────────
-- Immutable after insert — no UPDATE or DELETE for users.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_result_comments' AND policyname='Org members can view comments') THEN
DROP POLICY IF EXISTS "Org members can view comments" ON playbook_result_comments;
    CREATE POLICY "Org members can view comments" ON playbook_result_comments
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_result_comments' AND policyname='Org members can insert comments') THEN
DROP POLICY IF EXISTS "Org members can insert comments" ON playbook_result_comments;
    CREATE POLICY "Org members can insert comments" ON playbook_result_comments
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMIT;


-- ============================================================
-- migration_028_gateway_usage.sql
-- ============================================================
-- Migration 028: Gateway usage tracking for org-level monthly quotas
-- Supports free/audit/retainer/enterprise plan tiers with monthly request caps.

CREATE TABLE IF NOT EXISTS gateway_usage (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month       VARCHAR(7) NOT NULL,           -- 'YYYY-MM', e.g. '2026-03'
  request_count INTEGER NOT NULL DEFAULT 0,
  quota       INTEGER NOT NULL DEFAULT 10000, -- -1 means unlimited
  UNIQUE (org_id, month)
);

CREATE INDEX IF NOT EXISTS gateway_usage_org_month_idx ON gateway_usage (org_id, month);

-- RLS: orgs can only see their own usage rows
ALTER TABLE gateway_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gateway_usage_org_isolation ON gateway_usage;
CREATE POLICY gateway_usage_org_isolation ON gateway_usage
  USING (org_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));


-- ============================================================
-- migration_029_incident_confidence.sql
-- ============================================================
-- migration_029: add confidence score to incidents table
-- Enables surfacing detection confidence in the UI and auto-suppressing
-- incident types with >5 false positives in 30 days.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS confidence REAL;

-- Index to support fast false-positive-count queries used by auto-suppress logic
-- (org + type + status + created_at range)
CREATE INDEX IF NOT EXISTS idx_incidents_fp_lookup
  ON incidents (organization_id, incident_type, status, created_at);

COMMENT ON COLUMN incidents.confidence IS
  'Detection confidence score (0.0–1.0) from incident-detection.ts. NULL for manually created incidents.';


-- ============================================================
-- migration_030_policy_interceptors.sql
-- ============================================================
-- migration_030_policy_interceptors.sql
-- Adds interceptor_rules column to action_policies for real-time
-- prompt/response interception (PATCH_REQUEST, PATCH_RESPONSE) and
-- model routing (ROUTE_MODEL) policies.

ALTER TABLE action_policies
  ADD COLUMN IF NOT EXISTS interceptor_rules JSONB DEFAULT '[]';

-- Index for fast lookup of __gateway__ service policies per org
CREATE INDEX IF NOT EXISTS idx_action_policies_gateway
  ON action_policies (organization_id, service)
  WHERE service = '__gateway__';


-- ============================================================
-- migration_031_policy_constraints_and_evidence.sql
-- ============================================================
-- Migration 031: Policy constraints and richer connector execution evidence
-- Extends action_policies with structured constraints and connector_action_executions
-- with investigation-grade metadata.

BEGIN;

ALTER TABLE action_policies
  ADD COLUMN IF NOT EXISTS policy_constraints JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS requested_by UUID,
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remediation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_action_policies_constraints
  ON action_policies USING GIN (policy_constraints);

COMMIT;


-- ============================================================
-- migration_032_dual_approval_for_job_approvals.sql
-- ============================================================
-- Migration 032: Dual approval support for agent_job_approvals
-- Allows governed connector actions to require multiple reviewers before queueing.

BEGIN;

ALTER TABLE agent_job_approvals
  ADD COLUMN IF NOT EXISTS required_approvals INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approval_history JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;


-- ============================================================
-- migration_033_contact_leads.sql
-- ============================================================
-- migration_033: contact leads table for landing page email capture
create table if not exists contact_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  agents integer,
  conversations integer,
  estimated_spend text,
  source text default 'landing_calculator',
  created_at timestamptz default now()
);

-- Allow anyone (anon) to insert — this is a public lead capture form
alter table contact_leads enable row level security;

DROP POLICY IF EXISTS "anon can insert contact leads" ON contact_leads;
create policy "anon can insert contact leads"
  on contact_leads for insert
  to anon, authenticated
  with check (true);

-- Only service role can read (owner views via Supabase dashboard)
DROP POLICY IF EXISTS "service role can read contact leads" ON contact_leads;
create policy "service role can read contact leads"
  on contact_leads for select
  to service_role
  using (true);

-- Explicit grants required in addition to RLS policies
grant insert on contact_leads to anon;
grant insert on contact_leads to authenticated;


-- ============================================================
-- migration_034_marketing_hr_hubs.sql
-- ============================================================
-- Migration 034: Marketing Hub + HR Hub tables

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- MARKETING HUB
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_marketing_campaigns (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                VARCHAR(255)  NOT NULL,
    channel             VARCHAR(50)   NOT NULL DEFAULT 'Email'
                          CHECK (channel IN ('Email', 'WhatsApp', 'SMS')),
    status              VARCHAR(50)   NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('active', 'draft', 'paused', 'completed')),
    audience_size       INTEGER       NOT NULL DEFAULT 0,
    engagement_score    INTEGER       CHECK (engagement_score BETWEEN 0 AND 100),
    ai_scored_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_marketing_contacts (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email               TEXT          NOT NULL,
    tags                TEXT[]        DEFAULT '{}',
    subscribed          BOOLEAN       NOT NULL DEFAULT TRUE,
    source              VARCHAR(100)  DEFAULT 'manual',
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_marketing_performance (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id         UUID          REFERENCES hub_marketing_campaigns(id) ON DELETE CASCADE,
    campaign_name       VARCHAR(255)  NOT NULL,
    sent                INTEGER       NOT NULL DEFAULT 0,
    delivered           INTEGER       NOT NULL DEFAULT 0,
    opened              INTEGER       NOT NULL DEFAULT 0,
    clicked             INTEGER       NOT NULL DEFAULT 0,
    recorded_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE hub_marketing_campaigns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_marketing_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_marketing_performance ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_marketing_campaigns' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_marketing_campaigns;
    CREATE POLICY org_isolation ON hub_marketing_campaigns USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_marketing_contacts' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_marketing_contacts;
    CREATE POLICY org_isolation ON hub_marketing_contacts USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_marketing_performance' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_marketing_performance;
    CREATE POLICY org_isolation ON hub_marketing_performance USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HR HUB
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_hr_attendance (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_name       VARCHAR(255)  NOT NULL,
    employee_email      TEXT          NOT NULL,
    date                DATE          NOT NULL,
    status              VARCHAR(50)   NOT NULL DEFAULT 'present'
                          CHECK (status IN ('present', 'absent', 'wfh', 'half-day')),
    absence_risk        INTEGER       CHECK (absence_risk BETWEEN 0 AND 100),
    ai_scored_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_hr_leave (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_name       VARCHAR(255)  NOT NULL,
    employee_email      TEXT          NOT NULL,
    leave_type          VARCHAR(100)  NOT NULL DEFAULT 'casual',
    start_date          DATE          NOT NULL,
    end_date            DATE          NOT NULL,
    status              VARCHAR(50)   NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected')),
    reason              TEXT,
    reviewed_by         TEXT,
    reviewed_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_hr_payroll (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    month               VARCHAR(20)   NOT NULL,
    total_gross         NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_net           NUMERIC(14,2) NOT NULL DEFAULT 0,
    headcount           INTEGER       NOT NULL DEFAULT 0,
    status              VARCHAR(50)   NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'processing', 'paid')),
    processed_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub_hr_headcount (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department          VARCHAR(255)  NOT NULL,
    total               INTEGER       NOT NULL DEFAULT 0,
    joiners_this_month  INTEGER       NOT NULL DEFAULT 0,
    exits_this_month    INTEGER       NOT NULL DEFAULT 0,
    attrition_risk      INTEGER       CHECK (attrition_risk BETWEEN 0 AND 100),
    ai_scored_at        TIMESTAMP WITH TIME ZONE,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE hub_hr_attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_hr_leave        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_hr_payroll      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_hr_headcount    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_attendance' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_hr_attendance;
    CREATE POLICY org_isolation ON hub_hr_attendance USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_leave' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_hr_leave;
    CREATE POLICY org_isolation ON hub_hr_leave USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_payroll' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_hr_payroll;
    CREATE POLICY org_isolation ON hub_hr_payroll USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_headcount' AND policyname = 'org_isolation') THEN
DROP POLICY IF EXISTS org_isolation ON hub_hr_headcount;
    CREATE POLICY org_isolation ON hub_hr_headcount USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_org ON hub_marketing_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_org  ON hub_marketing_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_marketing_perf_org      ON hub_marketing_performance(organization_id);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_org       ON hub_hr_attendance(organization_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_org            ON hub_hr_leave(organization_id);
CREATE INDEX IF NOT EXISTS idx_hr_payroll_org          ON hub_hr_payroll(organization_id);
CREATE INDEX IF NOT EXISTS idx_hr_headcount_org        ON hub_hr_headcount(organization_id);

COMMIT;


-- ============================================================
-- migration_035_reasoning_traces.sql
-- ============================================================
-- migration_035_reasoning_traces.sql
-- Captures per-request reasoning traces from the LLM gateway:
-- tool calls, interceptors applied, risk scores, confidence calibration, entropy.

CREATE TABLE IF NOT EXISTS gateway_reasoning_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  request_id TEXT,                          -- idempotency key / client request ID
  model TEXT,                               -- e.g. gpt-4o, claude-3-5-sonnet
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  total_tokens INT GENERATED ALWAYS AS (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) STORED,
  latency_ms INT,                           -- total gateway round-trip ms
  tool_calls JSONB DEFAULT '[]'::JSONB,     -- [{name, arguments, result, latency_ms}]
  interceptors_applied JSONB DEFAULT '[]'::JSONB, -- list of interceptor rule IDs/names that fired
  risk_score NUMERIC(4,3),                  -- 0.000-1.000 composite from incident detection
  confidence_gap NUMERIC(4,3),             -- |predicted_confidence - actual_outcome|
  prompt_drift_score NUMERIC(4,3),          -- similarity delta from baseline prompt
  response_entropy NUMERIC(8,4),            -- Shannon entropy of response text
  policy_violations JSONB DEFAULT '[]'::JSONB, -- [{policy_id, policy_name, rule, action_taken}]
  discarded_options JSONB DEFAULT '[]'::JSONB, -- future: reasoning chain alternatives
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gateway_traces_org ON gateway_reasoning_traces(organization_id);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_agent ON gateway_reasoning_traces(agent_id);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_conversation ON gateway_reasoning_traces(conversation_id);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_created ON gateway_reasoning_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_traces_risk ON gateway_reasoning_traces(risk_score) WHERE risk_score IS NOT NULL;

-- Row-Level Security
ALTER TABLE gateway_reasoning_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_can_view_traces" ON gateway_reasoning_traces;
CREATE POLICY "org_members_can_view_traces"
  ON gateway_reasoning_traces FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_role_can_insert_traces" ON gateway_reasoning_traces;
CREATE POLICY "service_role_can_insert_traces"
  ON gateway_reasoning_traces FOR INSERT
  WITH CHECK (true);

-- Allow org members to delete their own org's traces (for data privacy)
DROP POLICY IF EXISTS "org_admins_can_delete_traces" ON gateway_reasoning_traces;
CREATE POLICY "org_admins_can_delete_traces"
  ON gateway_reasoning_traces FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );


-- ============================================================
-- migration_036_approval_enhancements.sql
-- ============================================================
-- migration_036_approval_enhancements.sql
-- Adds risk scoring, SLA tracking, snooze, subtasks, tags to approval_requests.
-- Adds approval_comments table for collaborative workspace.

-- ── approval_requests enhancements ────────────────────────────────────────────

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS risk_score NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sub_tasks JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::TEXT[];

-- Update status enum to include escalated
DO $$
BEGIN
  -- Only alter if 'escalated' is not already a valid value
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'approval_status' AND e.enumlabel = 'escalated'
  ) THEN
    -- approval_requests.status is VARCHAR, so just document the new value
    -- (no enum type to alter; constraint is enforced in application layer)
    NULL;
  END IF;
END $$;

-- Index for SLA queries
CREATE INDEX IF NOT EXISTS idx_approval_sla ON approval_requests(sla_deadline)
  WHERE status = 'pending' AND sla_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_snooze ON approval_requests(snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- ── approval_comments ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mention_ids UUID[] DEFAULT '{}'::UUID[],  -- @-mentioned user IDs
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_comments_request ON approval_comments(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_approval_comments_org ON approval_comments(organization_id);

-- Row-Level Security
ALTER TABLE approval_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_can_view_comments" ON approval_comments;
CREATE POLICY "org_members_can_view_comments"
  ON approval_comments FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "org_members_can_insert_comments" ON approval_comments;
CREATE POLICY "org_members_can_insert_comments"
  ON approval_comments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
    AND author_id = auth.uid()
  );

DROP POLICY IF EXISTS "authors_can_update_comments" ON approval_comments;
CREATE POLICY "authors_can_update_comments"
  ON approval_comments FOR UPDATE
  USING (author_id = auth.uid());

DROP POLICY IF EXISTS "authors_and_admins_can_delete_comments" ON approval_comments;
CREATE POLICY "authors_and_admins_can_delete_comments"
  ON approval_comments FOR DELETE
  USING (
    author_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );


-- ============================================================
-- migration_037_policy_versioning.sql
-- ============================================================
-- migration_037_policy_versioning.sql
-- Adds YAML source storage and versioning to policy_packs.
-- Creates policy_pack_versions for full audit history of policy changes.

-- ── policy_packs enhancements ─────────────────────────────────────────────────

ALTER TABLE policy_packs
  ADD COLUMN IF NOT EXISTS yaml_source TEXT,    -- raw YAML policy definition
  ADD COLUMN IF NOT EXISTS version INT DEFAULT 1 NOT NULL;

-- ── policy_pack_versions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_pack_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_pack_id UUID NOT NULL REFERENCES policy_packs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INT NOT NULL,
  yaml_source TEXT NOT NULL,
  rules JSONB NOT NULL,             -- snapshot of rules at this version
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_pack_ver
  ON policy_pack_versions(policy_pack_id, version);

CREATE INDEX IF NOT EXISTS idx_policy_versions_pack ON policy_pack_versions(policy_pack_id);
CREATE INDEX IF NOT EXISTS idx_policy_versions_org ON policy_pack_versions(organization_id);

-- Row-Level Security
ALTER TABLE policy_pack_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_can_view_versions" ON policy_pack_versions;
CREATE POLICY "org_members_can_view_versions"
  ON policy_pack_versions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_role_can_insert_versions" ON policy_pack_versions;
CREATE POLICY "service_role_can_insert_versions"
  ON policy_pack_versions FOR INSERT
  WITH CHECK (true);


-- ============================================================
-- migration_038_circuit_breaker_and_reliability.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 038: Integration Reliability Layer
-- Adds circuit-breaker state tracking, retry queue, and idempotency keys
-- for external connector actions.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Per-(org, connector) circuit breaker state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_circuit_breakers (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id     TEXT        NOT NULL,
  state            TEXT        NOT NULL DEFAULT 'closed', -- closed | open | half_open
  failure_count    INTEGER     NOT NULL DEFAULT 0,
  last_failure_at  TIMESTAMPTZ,
  opened_at        TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_ccb_org_connector
  ON connector_circuit_breakers(organization_id, connector_id);

-- ---------------------------------------------------------------------------
-- Retry queue: persists failed/blocked connector actions for later execution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_retry_queue (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  connector_id     TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  params           JSONB       NOT NULL DEFAULT '{}',
  credentials_ref  TEXT,        -- integration_id to re-fetch creds at retry time
  attempt_count    INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 3,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error       TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending', -- pending | succeeded | failed | abandoned
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crq_pending
  ON connector_retry_queue(status, next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_crq_org
  ON connector_retry_queue(organization_id, created_at DESC);

-- RLS: org members can read their queue items; service role writes them
ALTER TABLE connector_circuit_breakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_retry_queue      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ccb_select" ON connector_circuit_breakers;
CREATE POLICY "ccb_select" ON connector_circuit_breakers FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "crq_select" ON connector_retry_queue;
CREATE POLICY "crq_select" ON connector_retry_queue FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Idempotency key column on connector_action_executions
-- Allows the executor to detect duplicate calls (same org + fingerprint)
-- and return the cached result without firing the external API again.
-- ---------------------------------------------------------------------------
ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cae_idempotency
  ON connector_action_executions(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND success = true;

COMMIT;


-- ============================================================
-- migration_039_seniority_engine.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 039: Seniority Engine
-- Adds correction memory, synthesized rules, and shadow test run history.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Agent corrections: one row per human approve/deny decision on a connector
-- action. Embedding stored as a JSON float8 array for cosine similarity search
-- in JS (no pgvector required).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_corrections (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  approval_id      UUID,       -- source approval_requests.id (no FK — migrations may run out of order)
  service          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  decision         TEXT        NOT NULL CHECK (decision IN ('approved', 'denied')),
  context_summary  TEXT        NOT NULL, -- human-readable summary used for embedding
  reviewer_note    TEXT,
  embedding        JSONB,      -- float8[] stored as JSON array; null when embedding unavailable
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ac_org_service_action
  ON agent_corrections(organization_id, service, action, decision);

CREATE INDEX IF NOT EXISTS idx_ac_org_agent
  ON agent_corrections(organization_id, agent_id, created_at DESC);

ALTER TABLE agent_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ac_select" ON agent_corrections;
CREATE POLICY "ac_select" ON agent_corrections FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Synthesized rules: auto-proposed action policies generated after 3+
-- repeated denials of the same (service, action) pair.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS synthesized_rules (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  trigger_count    INTEGER     NOT NULL DEFAULT 3,
  proposed_policy  JSONB       NOT NULL DEFAULT '{}', -- pre-filled action_policy body
  status           TEXT        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, service, action)
);

CREATE INDEX IF NOT EXISTS idx_sr_org_status
  ON synthesized_rules(organization_id, status);

ALTER TABLE synthesized_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sr_select" ON synthesized_rules;
CREATE POLICY "sr_select" ON synthesized_rules FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Shadow test runs: persisted results from POST /agents/:id/test
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shadow_test_runs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  category         TEXT        NOT NULL,
  attack_prompt    TEXT        NOT NULL,
  response         TEXT,
  passed           BOOLEAN     NOT NULL,
  details          TEXT,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_str_org_agent
  ON shadow_test_runs(organization_id, agent_id, created_at DESC);

ALTER TABLE shadow_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "str_select" ON shadow_test_runs;
CREATE POLICY "str_select" ON shadow_test_runs FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

COMMIT;


-- ============================================================
-- migration_040_integration_capabilities.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 040: Integration Capabilities & Health Tracking
-- Adds per-org capability toggles and connection health fields to integrations.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS enabled_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_tested_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_result     TEXT; -- 'ok' | 'error'

-- Index for fast capability lookups in preflight gate
CREATE INDEX IF NOT EXISTS idx_integrations_capabilities
  ON integrations USING GIN (enabled_capabilities);

COMMIT;


-- ============================================================
-- migration_041_connector_action_execution_governance_backfill.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 041: Connector Action Execution Governance Backfill
-- Safety migration for environments that missed migration_031.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE connector_action_executions
  ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remediation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cae_requested_by
  ON connector_action_executions(organization_id, requested_by, created_at DESC);

COMMIT;



-- ============================================================
-- migration_042_trust_openapi_and_audit_chain.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 042: Trust + OpenAPI Ingest Foundations
-- Adds OpenAPI ingest storage, tamper-evident audit chain, and red-team run logs.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS integration_openapi_specs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  raw_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  capability_map JSONB NOT NULL DEFAULT '{"capabilities":[]}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openapi_specs_unique_hash
  ON integration_openapi_specs (organization_id, service_id, spec_hash);

CREATE INDEX IF NOT EXISTS idx_openapi_specs_service
  ON integration_openapi_specs (organization_id, service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_event_chain (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_chain_org_time
  ON audit_event_chain (organization_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_chain_hash
  ON audit_event_chain (entry_hash);

CREATE TABLE IF NOT EXISTS redteam_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed',
  scenario_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redteam_runs_org_time
  ON redteam_runs (organization_id, created_at DESC);

COMMIT;


-- ============================================================
-- migration_043_trust_tables_rls.sql
-- ============================================================
-- ---------------------------------------------------------------------------
-- Migration 043: Trust Tables RLS
-- Enables user-scoped access to trust tables so normal /api routes do not
-- require service-role PostgREST access.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE integration_openapi_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE redteam_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_openapi_specs_select" ON integration_openapi_specs;
CREATE POLICY "integration_openapi_specs_select"
  ON integration_openapi_specs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "integration_openapi_specs_insert" ON integration_openapi_specs;
CREATE POLICY "integration_openapi_specs_insert"
  ON integration_openapi_specs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "audit_event_chain_select" ON audit_event_chain;
CREATE POLICY "audit_event_chain_select"
  ON audit_event_chain
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "redteam_runs_select" ON redteam_runs;
CREATE POLICY "redteam_runs_select"
  ON redteam_runs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "redteam_runs_insert" ON redteam_runs;
CREATE POLICY "redteam_runs_insert"
  ON redteam_runs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;


-- ============================================================
-- migration_044_agent_versions.sql
-- ============================================================
-- Migration 044: Agent version history + rollback
-- Each save to PUT /agents/:id creates an immutable snapshot row.
-- Rollback restores the snapshot fields back onto ai_agents.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  version_number    INTEGER NOT NULL,
  -- Snapshot of mutable fields at the moment of save
  snapshot          JSONB NOT NULL,
  changed_by_email  TEXT,
  change_summary    TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_id ON agent_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_org_id   ON agent_versions(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_created  ON agent_versions(agent_id, created_at DESC);

-- RLS: org members can read their own agent versions; only backend service role can write
ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_versions_select" ON agent_versions;
CREATE POLICY "agent_versions_select" ON agent_versions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Inserts / updates done via service role in backend (bypasses RLS)

COMMIT;


-- ============================================================
-- migration_045_alert_channels.sql
-- ============================================================
-- Migration 045: Alert channels (PagerDuty, Microsoft Teams, Opsgenie, email)
-- Stores per-org notification channel configuration.
-- Secrets (API keys, webhook URLs) are stored encrypted in the `config` JSONB column
-- using the same application-level encryption used by integration_credentials.

BEGIN;

CREATE TABLE IF NOT EXISTS alert_channels (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  channel_type    TEXT NOT NULL CHECK (channel_type IN ('pagerduty', 'teams', 'opsgenie', 'email')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  -- Minimum severity to trigger this channel: low | medium | high | critical
  min_severity    TEXT NOT NULL DEFAULT 'high' CHECK (min_severity IN ('low', 'medium', 'high', 'critical')),
  -- Channel-specific config (encrypted secrets stored here):
  --   pagerduty : { routing_key }
  --   teams     : { webhook_url }
  --   opsgenie  : { api_key, region? }
  --   email     : { recipients: string[] }
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_channels_org_id ON alert_channels(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_channels_enabled ON alert_channels(organization_id, enabled);

ALTER TABLE alert_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alert_channels_select" ON alert_channels;
CREATE POLICY "alert_channels_select" ON alert_channels
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;


-- ============================================================
-- migration_046_rls_new_tables.sql
-- ============================================================
-- Migration 046: RLS write policies for agent_versions and alert_channels
-- Both tables were created (044, 045) with only SELECT policies.
-- INSERT/UPDATE/DELETE were missing, blocking all backend writes via user JWT.

BEGIN;

-- ── agent_versions ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "agent_versions_insert" ON agent_versions;
CREATE POLICY "agent_versions_insert" ON agent_versions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agent_versions_update" ON agent_versions;
CREATE POLICY "agent_versions_update" ON agent_versions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agent_versions_delete" ON agent_versions;
CREATE POLICY "agent_versions_delete" ON agent_versions
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- ── alert_channels ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "alert_channels_insert" ON alert_channels;
CREATE POLICY "alert_channels_insert" ON alert_channels
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "alert_channels_update" ON alert_channels;
CREATE POLICY "alert_channels_update" ON alert_channels
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "alert_channels_delete" ON alert_channels;
CREATE POLICY "alert_channels_delete" ON alert_channels
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;


-- ============================================================
-- migration_047_approval_delegation.sql
-- ============================================================
-- migration_047_approval_delegation.sql
-- Adds delegation, SLA, and escalation fields to approval_requests.

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS delegate_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN approval_requests.delegate_to_user_id IS 'When set, this approval has been delegated to another user (e.g. manager OOO).';
COMMENT ON COLUMN approval_requests.sla_hours IS 'Hours before this approval is considered overdue. Default 24.';
COMMENT ON COLUMN approval_requests.escalated_at IS 'Timestamp when SLA was breached and alert was sent. NULL = not yet escalated.';

CREATE INDEX IF NOT EXISTS idx_approval_requests_delegate ON approval_requests(delegate_to_user_id) WHERE delegate_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_escalated ON approval_requests(escalated_at) WHERE escalated_at IS NOT NULL;


-- ============================================================
-- migration_048_conversation_ratings.sql
-- ============================================================
-- Migration 048: Conversation ratings (CSAT)
-- Adds thumbs up/down rating and optional feedback text to conversations.
-- Pattern: same as agent_jobs.feedback SMALLINT (migration_025).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating IN (1, -1)),
  ADD COLUMN IF NOT EXISTS feedback_text TEXT;

-- 1 = thumbs up, -1 = thumbs down, NULL = not yet rated
COMMENT ON COLUMN conversations.rating IS '1 = thumbs up, -1 = thumbs down, NULL = unrated';
COMMENT ON COLUMN conversations.feedback_text IS 'Optional free-text feedback from the employee';

CREATE INDEX IF NOT EXISTS idx_conversations_rating
  ON conversations(rating)
  WHERE rating IS NOT NULL;


-- ============================================================
-- migration_049_agent_portal_links.sql
-- ============================================================
-- Migration 049: Agent public portal links
-- Allows admins to generate a public share token for an agent.
-- Employees open /chat/:share_token to talk to the agent without logging in.

CREATE TABLE IF NOT EXISTS agent_portal_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  share_token     TEXT NOT NULL UNIQUE
                    DEFAULT encode(gen_random_bytes(24), 'base64url'),
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_portal_links_agent_id
  ON agent_portal_links(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_portal_links_token
  ON agent_portal_links(share_token);

COMMENT ON TABLE agent_portal_links IS
  'Public chat portal links for agents — token-gated, no user JWT required.';


-- ============================================================
-- migration_050_whatsapp.sql
-- ============================================================
-- migration_050_whatsapp.sql
-- WhatsApp Business (Cloud API) tables for message persistence,
-- contact management, and template sync.

-- ─── WhatsApp Messages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id    UUID REFERENCES integrations(id) ON DELETE SET NULL,
  waba_id           VARCHAR(32) NOT NULL,
  phone_number_id   VARCHAR(32) NOT NULL,
  from_number       VARCHAR(20) NOT NULL,
  to_number         VARCHAR(20) NOT NULL,
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type      VARCHAR(20) NOT NULL DEFAULT 'text'
                    CHECK (message_type IN ('text','image','document','audio','video','template','interactive','location','contacts','sticker','reaction')),
  content           TEXT NOT NULL DEFAULT '',
  media_url         TEXT,
  wa_message_id     VARCHAR(64) NOT NULL,
  wa_timestamp      TIMESTAMPTZ,
  status            VARCHAR(20) NOT NULL DEFAULT 'received'
                    CHECK (status IN ('sent','delivered','read','failed','received')),
  thread_phone      VARCHAR(20) NOT NULL,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (waba_id, wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_org        ON whatsapp_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_thread     ON whatsapp_messages(organization_id, thread_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status     ON whatsapp_messages(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created    ON whatsapp_messages(created_at DESC);

-- ─── WhatsApp Contacts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone             VARCHAR(20) NOT NULL,
  name              VARCHAR(255),
  wa_id             VARCHAR(20),
  opted_in          BOOLEAN NOT NULL DEFAULT false,
  opted_in_at       TIMESTAMPTZ,
  labels            JSONB NOT NULL DEFAULT '[]',
  last_message_at   TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_org        ON whatsapp_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_labels     ON whatsapp_contacts USING gin(labels);

-- ─── WhatsApp Templates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wa_template_id    VARCHAR(64),
  name              VARCHAR(255) NOT NULL,
  category          VARCHAR(30) NOT NULL DEFAULT 'UTILITY'
                    CHECK (category IN ('UTILITY','MARKETING','AUTHENTICATION')),
  language          VARCHAR(10) NOT NULL DEFAULT 'en',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('APPROVED','PENDING','REJECTED','PAUSED','DISABLED')),
  body              TEXT NOT NULL DEFAULT '',
  header            JSONB,
  footer            TEXT,
  buttons           JSONB,
  last_synced_at    TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, wa_template_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_org       ON whatsapp_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_templates_status    ON whatsapp_templates(organization_id, status);

-- ─── Row Level Security ─────────────────────────────────────────────
ALTER TABLE whatsapp_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;

-- Messages: org members can SELECT + UPDATE status; INSERT via service role only
DROP POLICY IF EXISTS wa_messages_select ON whatsapp_messages;
CREATE POLICY wa_messages_select ON whatsapp_messages
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_messages_update ON whatsapp_messages;
CREATE POLICY wa_messages_update ON whatsapp_messages
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Contacts: full CRUD for org members
DROP POLICY IF EXISTS wa_contacts_select ON whatsapp_contacts;
CREATE POLICY wa_contacts_select ON whatsapp_contacts
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_contacts_insert ON whatsapp_contacts;
CREATE POLICY wa_contacts_insert ON whatsapp_contacts
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_contacts_update ON whatsapp_contacts;
CREATE POLICY wa_contacts_update ON whatsapp_contacts
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_contacts_delete ON whatsapp_contacts;
CREATE POLICY wa_contacts_delete ON whatsapp_contacts
  FOR DELETE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Templates: full CRUD for org members
DROP POLICY IF EXISTS wa_templates_select ON whatsapp_templates;
CREATE POLICY wa_templates_select ON whatsapp_templates
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_templates_insert ON whatsapp_templates;
CREATE POLICY wa_templates_insert ON whatsapp_templates
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_templates_update ON whatsapp_templates;
CREATE POLICY wa_templates_update ON whatsapp_templates
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
DROP POLICY IF EXISTS wa_templates_delete ON whatsapp_templates;
CREATE POLICY wa_templates_delete ON whatsapp_templates
  FOR DELETE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );


-- ============================================================
-- migration_051_dpdp_consent.sql
-- ============================================================
-- migration_051_dpdp_consent.sql
-- DPDP Act 2023 compliance layer: consent tracking, retention lifecycle,
-- Data Principal rights requests, and BSUID readiness for WhatsApp.
--
-- Tables:
--   consent_records       – Purpose-specific consent with TTL
--   data_retention_policies – Per-data-category retention rules
--   data_principal_requests – Right to access/erasure/grievance queue
--
-- Also adds bsuid column to whatsapp_contacts for Meta's 2026 migration.

-- ─── Consent Records ────────────────────────────────────────────────
-- Each row represents a single consent grant for a specific purpose.
-- DPDP requires: purpose-specific, clear notice, freely given, revocable.
CREATE TABLE IF NOT EXISTS consent_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who gave consent (the Data Principal)
  principal_type    VARCHAR(20) NOT NULL CHECK (principal_type IN ('employee', 'candidate', 'contact', 'vendor', 'customer')),
  principal_id      UUID,            -- FK to employees/candidates/whatsapp_contacts etc
  principal_email   VARCHAR(255),    -- Fallback identifier when no UUID
  principal_phone   VARCHAR(20),     -- For WhatsApp / SMS consent

  -- What they consented to
  purpose           VARCHAR(100) NOT NULL,  -- e.g. 'payroll_processing', 'recruitment', 'whatsapp_messaging', 'analytics'
  purpose_description TEXT,                 -- Human-readable description shown at collection
  data_categories   TEXT[] NOT NULL DEFAULT '{}', -- e.g. {'personal_info', 'financial', 'biometric', 'health'}
  legal_basis       VARCHAR(30) NOT NULL DEFAULT 'consent'
                    CHECK (legal_basis IN ('consent', 'contract', 'legal_obligation', 'vital_interest', 'legitimate_interest')),

  -- Consent lifecycle
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'withdrawn', 'expired', 'superseded')),
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,      -- NULL = no expiry; else auto-expire via TTL worker
  withdrawn_at      TIMESTAMPTZ,
  withdrawal_reason TEXT,

  -- Collection metadata (audit trail)
  collection_method VARCHAR(30) NOT NULL DEFAULT 'explicit'
                    CHECK (collection_method IN ('explicit', 'implicit', 'notice_based', 'opt_in', 'opt_out', 'api')),
  collection_point  VARCHAR(100),     -- e.g. 'onboarding_form', 'whatsapp_opt_in', 'job_application'
  notice_version    VARCHAR(20),      -- Version of privacy notice shown
  ip_address        INET,
  user_agent        TEXT,

  -- Metadata
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_org
  ON consent_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_principal
  ON consent_records(organization_id, principal_type, principal_id)
  WHERE principal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_records_purpose
  ON consent_records(organization_id, purpose, status);
CREATE INDEX IF NOT EXISTS idx_consent_records_expires
  ON consent_records(expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_records_select ON consent_records;
CREATE POLICY consent_records_select ON consent_records
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS consent_records_insert ON consent_records;
CREATE POLICY consent_records_insert ON consent_records
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS consent_records_update ON consent_records;
CREATE POLICY consent_records_update ON consent_records
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );


-- ─── Data Retention Policies ────────────────────────────────────────
-- Configurable per-org retention rules. The TTL worker uses these to
-- identify and purge expired personal data.
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  data_category     VARCHAR(60) NOT NULL,   -- e.g. 'whatsapp_messages', 'conversations', 'audit_logs', 'candidate_data', 'employee_pii'
  retention_days    INTEGER NOT NULL CHECK (retention_days >= 0),  -- 0 = delete immediately on consent withdrawal
  description       TEXT,
  applies_to_table  VARCHAR(80),            -- Target table name for auto-purge
  purge_strategy    VARCHAR(20) NOT NULL DEFAULT 'delete'
                    CHECK (purge_strategy IN ('delete', 'anonymize', 'archive')),

  -- When consent is withdrawn, override the TTL
  on_consent_withdrawal VARCHAR(20) NOT NULL DEFAULT 'immediate'
                    CHECK (on_consent_withdrawal IN ('immediate', 'end_of_retention', 'manual')),

  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, data_category)
);

CREATE INDEX IF NOT EXISTS idx_retention_policies_org
  ON data_retention_policies(organization_id);

ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS retention_policies_select ON data_retention_policies;
CREATE POLICY retention_policies_select ON data_retention_policies
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS retention_policies_all ON data_retention_policies;
CREATE POLICY retention_policies_all ON data_retention_policies
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );


-- ─── Data Principal Requests ────────────────────────────────────────
-- DPDP Act mandates: right to access, right to correction, right to
-- erasure, right to grievance redressal. Orgs must respond within 72h.
CREATE TABLE IF NOT EXISTS data_principal_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The Data Principal
  principal_type    VARCHAR(20) NOT NULL CHECK (principal_type IN ('employee', 'candidate', 'contact', 'vendor', 'customer')),
  principal_id      UUID,
  principal_email   VARCHAR(255),
  principal_phone   VARCHAR(20),
  principal_name    VARCHAR(255),

  -- Request details
  request_type      VARCHAR(20) NOT NULL
                    CHECK (request_type IN ('access', 'correction', 'erasure', 'grievance', 'portability')),
  description       TEXT,                   -- Free-text from the Data Principal
  data_categories   TEXT[] DEFAULT '{}',    -- Which data categories are in scope

  -- Processing
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected', 'escalated')),
  priority          VARCHAR(10) NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('urgent', 'normal')),
  assigned_to       UUID REFERENCES auth.users(id),
  due_at            TIMESTAMPTZ NOT NULL,   -- 72h from submission per DPDP
  completed_at      TIMESTAMPTZ,
  response_summary  TEXT,                   -- What action was taken
  rejection_reason  TEXT,

  -- Audit
  erasure_receipt   TEXT,                   -- SHA-256 signed receipt if erasure
  submitted_via     VARCHAR(30) DEFAULT 'portal'
                    CHECK (submitted_via IN ('portal', 'email', 'api', 'whatsapp', 'manual')),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dpr_org_status
  ON data_principal_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_dpr_due
  ON data_principal_requests(due_at)
  WHERE status IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_dpr_principal
  ON data_principal_requests(organization_id, principal_type, principal_id)
  WHERE principal_id IS NOT NULL;

ALTER TABLE data_principal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpr_select ON data_principal_requests;
CREATE POLICY dpr_select ON data_principal_requests
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS dpr_insert ON data_principal_requests;
CREATE POLICY dpr_insert ON data_principal_requests
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS dpr_update ON data_principal_requests;
CREATE POLICY dpr_update ON data_principal_requests
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );


-- ─── BSUID Column on WhatsApp Contacts ──────────────────────────────
-- Meta is transitioning to Business Scoped User IDs (BSUIDs) in 2026.
-- This column will be populated from webhook payload contacts[].user_id.
ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS bsuid VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_bsuid
  ON whatsapp_contacts(bsuid)
  WHERE bsuid IS NOT NULL;


-- ============================================================
-- migration_052_ctc_salary_structures.sql
-- ============================================================
-- Migration 052: CTC/Salary Structure Tables for India Payroll
-- India's Wage Code 2019 + PF Act mandate: basic pay >= 50% of CTC
-- This migration creates per-employee salary structures with component breakdown

-- Salary structures (per employee, one active at a time)
CREATE TABLE IF NOT EXISTS salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    employee_name VARCHAR(200),
    employee_email VARCHAR(320),
    designation VARCHAR(200),
    department VARCHAR(200),
    location VARCHAR(200),
    ctc_annual NUMERIC(14,2) NOT NULL CHECK (ctc_annual > 0),
    ctc_monthly NUMERIC(14,2) GENERATED ALWAYS AS (ctc_annual / 12) STORED,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'superseded', 'terminated')),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Salary components (line items within a structure)
CREATE TABLE IF NOT EXISTS salary_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salary_structure_id UUID NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    component_type VARCHAR(30) NOT NULL CHECK (component_type IN (
        'basic',          -- Basic Pay (must be >= 50% of CTC per Wage Code 2019)
        'hra',            -- House Rent Allowance (40-50% of basic depending on metro/non-metro)
        'da',             -- Dearness Allowance
        'special',        -- Special Allowance (balancing figure)
        'lta',            -- Leave Travel Allowance
        'medical',        -- Medical Allowance
        'conveyance',     -- Conveyance Allowance
        'employer_pf',    -- Employer PF contribution (12% of basic, capped at ₹1800/month on ₹15000 basic)
        'employer_esi',   -- Employer ESI (3.25% of gross, if gross <= ₹21000/month)
        'employer_lwf',   -- Labour Welfare Fund (employer share, state-specific)
        'gratuity',       -- Gratuity provision (4.81% of basic per Payment of Gratuity Act)
        'bonus',          -- Statutory/performance bonus
        'food_coupon',    -- Sodexo/meal vouchers
        'nps_employer',   -- National Pension Scheme employer contribution
        'custom'          -- Custom component
    )),
    component_name VARCHAR(100) NOT NULL,
    annual_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (annual_amount >= 0),
    monthly_amount NUMERIC(14,2) GENERATED ALWAYS AS (annual_amount / 12) STORED,
    is_taxable BOOLEAN NOT NULL DEFAULT true,
    is_statutory BOOLEAN NOT NULL DEFAULT false,
    calculation_rule VARCHAR(200),  -- e.g. '50% of CTC', '12% of basic', 'balance'
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CTC simulation history (saved what-if scenarios)
CREATE TABLE IF NOT EXISTS ctc_simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    simulation_name VARCHAR(200),
    ctc_annual NUMERIC(14,2) NOT NULL,
    location VARCHAR(200),
    is_metro BOOLEAN NOT NULL DEFAULT true,
    pf_capped BOOLEAN NOT NULL DEFAULT true, -- true = PF on ₹15000 cap, false = PF on full basic
    include_esi BOOLEAN NOT NULL DEFAULT false,
    breakdown JSONB NOT NULL DEFAULT '{}',   -- full component breakdown snapshot
    compliance_warnings JSONB NOT NULL DEFAULT '[]',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_salary_structures_org ON salary_structures(organization_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_employee ON salary_structures(organization_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_active ON salary_structures(organization_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_salary_components_structure ON salary_components(salary_structure_id);
CREATE INDEX IF NOT EXISTS idx_salary_components_org ON salary_components(organization_id);
CREATE INDEX IF NOT EXISTS idx_ctc_simulations_org ON ctc_simulations(organization_id);

-- RLS
ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctc_simulations ENABLE ROW LEVEL SECURITY;

-- salary_structures RLS
DROP POLICY IF EXISTS salary_structures_select ON salary_structures;
CREATE POLICY salary_structures_select ON salary_structures FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
DROP POLICY IF EXISTS salary_structures_insert ON salary_structures;
CREATE POLICY salary_structures_insert ON salary_structures FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
DROP POLICY IF EXISTS salary_structures_update ON salary_structures;
CREATE POLICY salary_structures_update ON salary_structures FOR UPDATE
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

-- salary_components RLS
DROP POLICY IF EXISTS salary_components_select ON salary_components;
CREATE POLICY salary_components_select ON salary_components FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
DROP POLICY IF EXISTS salary_components_insert ON salary_components;
CREATE POLICY salary_components_insert ON salary_components FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
DROP POLICY IF EXISTS salary_components_update ON salary_components;
CREATE POLICY salary_components_update ON salary_components FOR UPDATE
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

-- ctc_simulations RLS
DROP POLICY IF EXISTS ctc_simulations_select ON ctc_simulations;
CREATE POLICY ctc_simulations_select ON ctc_simulations FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
DROP POLICY IF EXISTS ctc_simulations_insert ON ctc_simulations;
CREATE POLICY ctc_simulations_insert ON ctc_simulations FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));


-- ============================================================
-- migration_053_compliance_filing.sql
-- ============================================================
-- Migration 053: Compliance Filing Orchestrator
-- Statutory filing deadline tracker for India payroll compliance.
-- Tracks PF (15th), TDS (7th), ESI (15th), PT, LWF, Gratuity, etc.

-- Filing deadlines — recurring statutory obligations per org
CREATE TABLE IF NOT EXISTS filing_deadlines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    filing_type     VARCHAR(50) NOT NULL,  -- pf, tds, esi, pt, lwf, gratuity, annual_return, form_16, etc.
    title           VARCHAR(300) NOT NULL,
    description     TEXT,
    regulation      VARCHAR(100),          -- e.g. 'EPF Act 1952', 'Income Tax Act 1961'
    authority       VARCHAR(100),          -- e.g. 'EPFO', 'Income Tax Dept', 'ESIC'
    due_day_of_month INTEGER CHECK (due_day_of_month BETWEEN 1 AND 31),
    frequency       VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'annually', 'one_time')),
    quarter_months  INTEGER[],             -- e.g. {4,7,10,1} for quarterly filings
    annual_month    INTEGER CHECK (annual_month BETWEEN 1 AND 12),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    api_provider    VARCHAR(50),           -- 'cleartax', 'epfo', 'traces', 'manual'
    form_name       VARCHAR(100),          -- e.g. 'ECR', 'Form 26Q', 'ESI Return'
    penalty_info    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Filing submissions — each month/quarter/year's actual filing
CREATE TABLE IF NOT EXISTS filing_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deadline_id     UUID NOT NULL REFERENCES filing_deadlines(id) ON DELETE CASCADE,
    period_label    VARCHAR(50) NOT NULL,  -- e.g. 'Mar 2026', 'Q4 FY2025-26', 'FY2025-26'
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    due_date        DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'submitted', 'accepted', 'rejected', 'overdue', 'waived')),
    submitted_at    TIMESTAMPTZ,
    submitted_by    UUID,
    reference_number VARCHAR(200),          -- challan/acknowledgement number
    amount          NUMERIC(14,2),          -- payment amount if applicable
    receipt_url     TEXT,
    api_response    JSONB,                  -- response from ClearTax/EPFO API
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Filing alerts — reminders and escalations
CREATE TABLE IF NOT EXISTS filing_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    submission_id   UUID REFERENCES filing_submissions(id) ON DELETE CASCADE,
    deadline_id     UUID REFERENCES filing_deadlines(id) ON DELETE CASCADE,
    alert_type      VARCHAR(30) NOT NULL CHECK (alert_type IN ('reminder', 'due_today', 'overdue', 'escalation', 'submission_confirmed', 'rejection')),
    severity        VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    title           VARCHAR(300) NOT NULL,
    message         TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT false,
    is_dismissed    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_filing_deadlines_org ON filing_deadlines(organization_id);
CREATE INDEX IF NOT EXISTS idx_filing_deadlines_type ON filing_deadlines(organization_id, filing_type);
CREATE INDEX IF NOT EXISTS idx_filing_submissions_org ON filing_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_filing_submissions_deadline ON filing_submissions(deadline_id);
CREATE INDEX IF NOT EXISTS idx_filing_submissions_status ON filing_submissions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_filing_submissions_due ON filing_submissions(due_date) WHERE status IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_filing_alerts_org ON filing_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_filing_alerts_unread ON filing_alerts(organization_id) WHERE is_read = false;

-- RLS
ALTER TABLE filing_deadlines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS filing_deadlines_select ON filing_deadlines;
CREATE POLICY filing_deadlines_select ON filing_deadlines
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS filing_deadlines_insert ON filing_deadlines;
CREATE POLICY filing_deadlines_insert ON filing_deadlines
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS filing_deadlines_update ON filing_deadlines;
CREATE POLICY filing_deadlines_update ON filing_deadlines
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

ALTER TABLE filing_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS filing_submissions_select ON filing_submissions;
CREATE POLICY filing_submissions_select ON filing_submissions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS filing_submissions_insert ON filing_submissions;
CREATE POLICY filing_submissions_insert ON filing_submissions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS filing_submissions_update ON filing_submissions;
CREATE POLICY filing_submissions_update ON filing_submissions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

ALTER TABLE filing_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS filing_alerts_select ON filing_alerts;
CREATE POLICY filing_alerts_select ON filing_alerts
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS filing_alerts_insert ON filing_alerts;
CREATE POLICY filing_alerts_insert ON filing_alerts
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS filing_alerts_update ON filing_alerts;
CREATE POLICY filing_alerts_update ON filing_alerts
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );


-- ============================================================
-- migration_054_payments_foundation.sql
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'cashfree',
  offer_code VARCHAR(64) NOT NULL,
  offer_name VARCHAR(255) NOT NULL,
  merchant_order_id VARCHAR(64) NOT NULL UNIQUE,
  provider_order_id VARCHAR(64) UNIQUE,
  provider_payment_session_id TEXT,
  provider_order_status VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL,
  company_name VARCHAR(255),
  return_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_org_created
  ON payment_orders(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_org_status
  ON payment_orders(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_merchant_order_id
  ON payment_orders(merchant_order_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  payment_order_id UUID REFERENCES payment_orders(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL DEFAULT 'cashfree',
  provider_event_id VARCHAR(128),
  event_type VARCHAR(128) NOT NULL,
  event_status VARCHAR(32) NOT NULL DEFAULT 'received',
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_order_created
  ON payment_events(payment_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_org_created
  ON payment_events(organization_id, created_at DESC);

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_orders_select ON payment_orders;
CREATE POLICY payment_orders_select ON payment_orders
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payment_orders_insert ON payment_orders;
CREATE POLICY payment_orders_insert ON payment_orders
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payment_orders_update ON payment_orders;
CREATE POLICY payment_orders_update ON payment_orders
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payment_events_select ON payment_events;
CREATE POLICY payment_events_select ON payment_events
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;

-- ============================================================
-- migration_055_payment_events_insert_rls.sql
-- ============================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
      AND policyname = 'payment_events_insert'
  ) THEN
DROP POLICY IF EXISTS payment_events_insert ON payment_events;
    CREATE POLICY payment_events_insert ON payment_events
      FOR INSERT WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;

-- ============================================================
-- migration_056_job_claim_lock.sql
-- ============================================================
-- migration_056_job_claim_lock.sql
--
-- Adds at-least-once job delivery to agent_jobs.
--
-- Problem: runtimes poll for queued jobs then mark them running in two separate
-- DB calls. A runtime crash between those calls leaves jobs stranded as
-- "running" forever. Concurrent runtimes can also pick up the same job.
--
-- Solution: claim lock columns that allow:
--   1. Atomic SELECT + claim in a single UPDATE...RETURNING
--   2. Job reaper to return stale claimed jobs to the queue

DO $$ BEGIN

  -- Add claimed_by: which runtime instance has this job claimed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_jobs' AND column_name = 'claimed_by'
  ) THEN
    ALTER TABLE agent_jobs ADD COLUMN claimed_by TEXT;
  END IF;

  -- Add claimed_at: when the claim was made (used to detect stale claims)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_jobs' AND column_name = 'claimed_at'
  ) THEN
    ALTER TABLE agent_jobs ADD COLUMN claimed_at TIMESTAMPTZ;
  END IF;

END $$;

-- Index for the reaper query (jobs claimed but not completed for too long)
CREATE INDEX IF NOT EXISTS idx_agent_jobs_stale_claim
  ON agent_jobs (claimed_at)
  WHERE status = 'running' AND claimed_at IS NOT NULL;

-- Index for efficient poll query
CREATE INDEX IF NOT EXISTS idx_agent_jobs_poll
  ON agent_jobs (organization_id, runtime_instance_id, status, created_at)
  WHERE status = 'queued';

COMMENT ON COLUMN agent_jobs.claimed_by IS 'Runtime instance ID that claimed this job. NULL = unclaimed.';
COMMENT ON COLUMN agent_jobs.claimed_at IS 'Timestamp when the job was claimed. Used by reaper to return stale claims.';


-- ============================================================
-- migration_057_agent_manifest.sql
-- ============================================================
-- migration_057_agent_manifest.sql
--
-- Adds a structured manifest JSONB column to ai_agents.
-- The manifest is the agent's "employment file" — declared capabilities,
-- SLO targets, owner, environment, and review cadence.
--
-- Schema of the manifest JSON:
-- {
--   capabilities: string[],                      e.g. ["email_drafting", "ticket_routing"]
--   slo_targets: {
--     uptime_pct: number,                         e.g. 99.5  (target uptime %)
--     max_latency_ms: number,                     e.g. 3000
--     min_satisfaction: number,                   e.g. 85    (CSAT target 0-100)
--     max_cost_per_request_usd: number,           e.g. 0.05
--   },
--   tags: string[],                               free-form labels
--   owner_email: string,                          responsible person
--   deployment_environment: 'production'|'staging'|'sandbox',
--   review_cadence: 'weekly'|'monthly'|'quarterly'|'none',
--   notes: string                                 free-form text
-- }

DO $$ BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agents' AND column_name = 'manifest'
  ) THEN
    ALTER TABLE ai_agents ADD COLUMN manifest JSONB;
  END IF;

END $$;

COMMENT ON COLUMN ai_agents.manifest IS
  'Structured agent identity card: capabilities, SLO targets, owner, environment, review cadence.';


-- ============================================================
-- migration_058_agent_lifecycle.sql
-- ============================================================
-- migration_058_agent_lifecycle.sql
--
-- Formalises the agent lifecycle as an enforced state machine.
--
-- Lifecycle states (HR metaphor):
--   draft          → agent record created, not yet configured (job posting)
--   provisioning   → being set up / enrolled into a runtime (onboarding)
--   active         → fully operational (employed)
--   suspended      → temporarily paused by a manager (leave of absence)
--   decommissioning → being wound down, draining jobs (notice period)
--   terminated     → permanently shut down, no further calls (terminated)
--
-- Legal transitions:
--   draft          → provisioning
--   provisioning   → active | terminated
--   active         → suspended | decommissioning | terminated
--   suspended      → active | decommissioning | terminated
--   decommissioning → terminated
--   terminated     → (no transitions — terminal state)

DO $$ BEGIN

  -- Add lifecycle_state column with enum-style constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agents' AND column_name = 'lifecycle_state'
  ) THEN
    ALTER TABLE ai_agents ADD COLUMN lifecycle_state VARCHAR(30)
      DEFAULT 'active'
      CHECK (lifecycle_state IN ('draft','provisioning','active','suspended','decommissioning','terminated'));
  END IF;

END $$;

-- Transition audit table
CREATE TABLE IF NOT EXISTS agent_lifecycle_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  from_state      VARCHAR(30) NOT NULL,
  to_state        VARCHAR(30) NOT NULL,
  reason          TEXT,
  actor_email     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying transition history per agent
CREATE INDEX IF NOT EXISTS idx_lifecycle_transitions_agent
  ON agent_lifecycle_transitions (agent_id, created_at DESC);

-- RLS: org members can read/write their own org's transitions
ALTER TABLE agent_lifecycle_transitions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_lifecycle_transitions' AND policyname = 'org_isolation'
  ) THEN
DROP POLICY IF EXISTS org_isolation ON agent_lifecycle_transitions;
    CREATE POLICY org_isolation ON agent_lifecycle_transitions
      USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid);
  END IF;
END $$;

COMMENT ON TABLE agent_lifecycle_transitions IS
  'Immutable audit log of every lifecycle state change for an agent.';
COMMENT ON COLUMN ai_agents.lifecycle_state IS
  'Current lifecycle state of the agent. Transitions are enforced by agent-lifecycle.ts.';


-- ============================================================
-- migration_059_marketplace_improvements.sql
-- ============================================================
-- migration_059_marketplace_improvements.sql
--
-- Tracks marketplace app installs per organization for live install counts.
-- Enables the "X installs" badge on the marketplace catalog.

CREATE TABLE IF NOT EXISTS marketplace_install_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  organization_id UUID NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('install', 'uninstall')),
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast count queries per app_id
CREATE INDEX IF NOT EXISTS idx_mkt_install_events_app
  ON marketplace_install_events (app_id, action);

-- Per-org history
CREATE INDEX IF NOT EXISTS idx_mkt_install_events_org
  ON marketplace_install_events (organization_id, created_at DESC);

-- RLS: orgs can only see their own install events
ALTER TABLE marketplace_install_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketplace_install_events' AND policyname = 'org_isolation'
  ) THEN
DROP POLICY IF EXISTS org_isolation ON marketplace_install_events;
    CREATE POLICY org_isolation ON marketplace_install_events
      USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid);
  END IF;
END $$;

COMMENT ON TABLE marketplace_install_events IS
  'Immutable log of marketplace app install/uninstall events for install-count tracking.';


-- ============================================================
-- migration_060_chat_runtime_profiles.sql
-- ============================================================
-- migration_060_chat_runtime_profiles.sql
--
-- Backend-managed runtime profiles for consumer-first chat.
-- Stores BYOK provider keys and Zapheit gateway keys encrypted at rest.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_runtime_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('provider', 'gateway')),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'openrouter', 'zapheit_gateway')),
  label VARCHAR(120) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_runtime_profiles_org_created
  ON chat_runtime_profiles (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_runtime_profiles_org_status
  ON chat_runtime_profiles (organization_id, status);

ALTER TABLE chat_runtime_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_select'
  ) THEN
DROP POLICY IF EXISTS chat_runtime_profiles_select ON chat_runtime_profiles;
    CREATE POLICY chat_runtime_profiles_select ON chat_runtime_profiles
      FOR SELECT USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_insert'
  ) THEN
DROP POLICY IF EXISTS chat_runtime_profiles_insert ON chat_runtime_profiles;
    CREATE POLICY chat_runtime_profiles_insert ON chat_runtime_profiles
      FOR INSERT WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_update'
  ) THEN
DROP POLICY IF EXISTS chat_runtime_profiles_update ON chat_runtime_profiles;
    CREATE POLICY chat_runtime_profiles_update ON chat_runtime_profiles
      FOR UPDATE USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_delete'
  ) THEN
DROP POLICY IF EXISTS chat_runtime_profiles_delete ON chat_runtime_profiles;
    CREATE POLICY chat_runtime_profiles_delete ON chat_runtime_profiles
      FOR DELETE USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;


-- ============================================================
-- migration_061_marketplace_integration_requests.sql
-- ============================================================
-- migration_061_marketplace_integration_requests.sql
-- Tracks operator requests for integrations that are not yet supported.

CREATE TABLE IF NOT EXISTS marketplace_integration_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  app_id           text,
  app_name         text NOT NULL,
  use_case         text,
  status           text NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_integration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON marketplace_integration_requests;
CREATE POLICY org_isolation ON marketplace_integration_requests
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);


-- ============================================================
-- migration_062_conversation_delete_verification.sql
-- ============================================================
-- migration_062_conversation_delete_verification.sql
-- Verifies that the FK cascade required by DELETE /conversations/:id is in place.
-- messages.conversation_id was defined with ON DELETE CASCADE in migration_001.
-- gateway_reasoning_traces.conversation_id is ON DELETE SET NULL (traces are kept, reference nulled).
-- No schema changes needed — this migration serves as an explicit confirmation.

DO $$
DECLARE
  cascade_count int;
BEGIN
  SELECT COUNT(*) INTO cascade_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage kcu
    ON rc.constraint_name = kcu.constraint_name
  WHERE kcu.table_name = 'messages'
    AND kcu.column_name = 'conversation_id'
    AND rc.delete_rule = 'CASCADE';

  IF cascade_count = 0 THEN
    RAISE EXCEPTION 'messages.conversation_id FK cascade is missing — run migration_001 first';
  END IF;
END $$;


-- ============================================================
-- migration_063_mcp_tools.sql
-- ============================================================
-- MCP (Model Context Protocol) tool registry
-- Each row represents one tool that an organisation has registered with the Zapheit MCP gateway.
-- When an LLM calls tools/call, Zapheit checks action_policies then proxies to endpoint_url.

CREATE TABLE IF NOT EXISTS mcp_tools (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  agent_id          uuid                 REFERENCES ai_agents(id)      ON DELETE SET NULL,
  name              text        NOT NULL,
  description       text        NOT NULL DEFAULT '',
  input_schema      jsonb       NOT NULL DEFAULT '{}',
  endpoint_url      text        NOT NULL,
  endpoint_method   text        NOT NULL DEFAULT 'POST',
  endpoint_headers  jsonb                DEFAULT '{}',
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tools_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS mcp_tools_org_idx   ON mcp_tools (organization_id);
CREATE INDEX IF NOT EXISTS mcp_tools_agent_idx ON mcp_tools (agent_id) WHERE agent_id IS NOT NULL;

ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_tools_org_isolation ON mcp_tools;
CREATE POLICY mcp_tools_org_isolation ON mcp_tools
  USING (
    organization_id = (
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
    )::uuid
  );

-- MCP session call log — one row per tools/call invocation through the gateway
CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id        uuid                 REFERENCES ai_agents(id)    ON DELETE SET NULL,
  tool_name       text        NOT NULL,
  input           jsonb       NOT NULL DEFAULT '{}',
  output          jsonb,
  policy_decision text        NOT NULL DEFAULT 'allow', -- allow | warn | require_approval | block
  http_status     int,
  latency_ms      int,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_org_idx  ON mcp_tool_calls (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tool_calls_tool_idx ON mcp_tool_calls (organization_id, tool_name);

ALTER TABLE mcp_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_tool_calls_org_isolation ON mcp_tool_calls;
CREATE POLICY mcp_tool_calls_org_isolation ON mcp_tool_calls
  USING (
    organization_id = (
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
    )::uuid
  );


-- ============================================================
-- migration_064_plan_tier.sql
-- ============================================================
-- migration_064_plan_tier.sql
-- Adds plan_tier column to organizations and a gateway_usage table for
-- monthly request tracking. Idempotent — safe to run multiple times.

-- 1. Ensure plan column exists (most orgs have it already; this is a safety net)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- 2. Add plan_tier column for richer plan metadata
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan_tier JSONB DEFAULT '{}'::jsonb;

-- 3. Add grace_period_ends_at for 14-day grace on limit breaches
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

-- 4. Ensure gateway_usage table exists for monthly quota tracking
CREATE TABLE IF NOT EXISTS gateway_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,              -- 'YYYY-MM'
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, month)
);

-- 5. RLS for gateway_usage
ALTER TABLE gateway_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
DROP POLICY IF EXISTS "gateway_usage_select" ON gateway_usage;
  CREATE POLICY "gateway_usage_select" ON gateway_usage
    FOR SELECT USING (
      org_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Index for quota lookups
CREATE INDEX IF NOT EXISTS idx_gateway_usage_org_month
  ON gateway_usage (org_id, month);

-- 7. Comment
COMMENT ON TABLE gateway_usage IS
  'Monthly gateway request counts per org. Used by planGate for quota enforcement.';


-- ============================================================
-- migration_065_semantic_cache.sql
-- ============================================================
-- migration_065_semantic_cache.sql
-- Semantic response cache for LLM gateway (pgvector cosine similarity)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES ai_agents(id) ON DELETE CASCADE,
  model           text NOT NULL,
  prompt_hash     text NOT NULL,              -- SHA-256 of canonical prompt text
  prompt_embedding vector(1536),              -- OpenAI text-embedding-3-small
  prompt_text     text NOT NULL,              -- first 2000 chars for audit
  response_json   jsonb NOT NULL,             -- full ChatCompletion response
  input_tokens    integer DEFAULT 0,
  output_tokens   integer DEFAULT 0,
  hit_count       integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_hit_at     timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Fast exact-match lookup by hash
CREATE UNIQUE INDEX IF NOT EXISTS semantic_cache_hash_idx
  ON semantic_cache (organization_id, model, prompt_hash);

-- pgvector cosine similarity index (IVFFlat — fast approximate nearest neighbour)
CREATE INDEX IF NOT EXISTS semantic_cache_embedding_idx
  ON semantic_cache USING ivfflat (prompt_embedding vector_cosine_ops)
  WITH (lists = 100);

-- TTL cleanup index
CREATE INDEX IF NOT EXISTS semantic_cache_expires_idx
  ON semantic_cache (expires_at);

-- Row-level security
ALTER TABLE semantic_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can read their cache" ON semantic_cache;
CREATE POLICY "org members can read their cache"
  ON semantic_cache FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));


-- ============================================================
-- migration_066_audit_log_immutable.sql
-- ============================================================
-- migration_066_audit_log_immutable.sql
-- P3-05: Make audit_logs append-only (immutable events, strict taxonomy)

-- Prevent UPDATE on audit_logs (any attempt throws an error)
CREATE OR REPLACE FUNCTION fn_audit_logs_prevent_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — UPDATE is not permitted (event: %)', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_prevent_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_prevent_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_prevent_update();

-- Prevent DELETE on audit_logs
CREATE OR REPLACE FUNCTION fn_audit_logs_prevent_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — DELETE is not permitted (event: %)', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_prevent_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_prevent_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_prevent_delete();

-- Add event_taxonomy column to enforce strict taxonomy at app layer reference
-- (taxonomy enforcement happens in the application; DB column stores the validated value)
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_category text;

-- Backfill categories from existing action prefixes
UPDATE audit_logs SET event_category = split_part(action, '.', 1)
WHERE event_category IS NULL AND action IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_event_category_idx ON audit_logs (organization_id, event_category);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (organization_id, action);


-- ============================================================
-- migration_067_enterprise_features.sql
-- ============================================================
-- migration_067_enterprise_features.sql
-- P4-02: data residency, P4-03: IP allowlisting, P4-09: shadow AI detection

-- ── Data residency ────────────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_region text NOT NULL DEFAULT 'in-south1';
CREATE INDEX IF NOT EXISTS organizations_data_region_idx ON organizations (data_region);

-- ── IP allowlisting ───────────────────────────────────────────────────────────
-- Stored as JSONB array of CIDR strings, e.g. ["203.0.113.0/24","10.0.0.1/32"]
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ip_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── Shadow AI detection ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shadow_ai_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  source_ip       text,
  user_agent      text,
  request_url     text NOT NULL,
  provider        text NOT NULL,          -- openai | anthropic | gemini | other
  request_method  text NOT NULL DEFAULT 'POST',
  request_size    integer,
  blocked         boolean NOT NULL DEFAULT false,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS shadow_ai_events_org_idx   ON shadow_ai_events (organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS shadow_ai_events_prov_idx  ON shadow_ai_events (organization_id, provider);

ALTER TABLE shadow_ai_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members read shadow ai events" ON shadow_ai_events;
CREATE POLICY "org members read shadow ai events"
  ON shadow_ai_events FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));


-- ============================================================
-- migration_068_gdpr.sql
-- ============================================================
-- migration_068_gdpr.sql
-- P4-05: GDPR compliance — data subject requests, processing records, lawful bases

-- ── Data subject requests (Article 15-22 rights) ─────────────────────────────
CREATE TABLE IF NOT EXISTS gdpr_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_type    text NOT NULL,    -- access | rectification | erasure | restriction | portability | objection
  article         text NOT NULL,    -- Article 15 | 16 | 17 | 18 | 20 | 21
  requester_email text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed | rejected
  notes           text,
  due_by          timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gdpr_requests_org_idx ON gdpr_requests (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gdpr_requests_status_idx ON gdpr_requests (organization_id, status);

ALTER TABLE gdpr_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members read gdpr requests" ON gdpr_requests;
CREATE POLICY "org members read gdpr requests"
  ON gdpr_requests FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));

-- ── Data processing records (Article 30 Register of Processing Activities) ───
CREATE TABLE IF NOT EXISTS gdpr_processing_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  processing_activity text NOT NULL,
  purpose             text NOT NULL,
  lawful_basis        text NOT NULL,  -- consent | contract | legal_obligation | vital_interests | public_task | legitimate_interests
  data_categories     jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipients          jsonb NOT NULL DEFAULT '[]'::jsonb,
  retention_period    text,
  third_country       boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gdpr_processing_org_idx ON gdpr_processing_records (organization_id);

ALTER TABLE gdpr_processing_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members read processing records" ON gdpr_processing_records;
CREATE POLICY "org members read processing records"
  ON gdpr_processing_records FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));

-- ── Default processing records for AI governance platform ────────────────────
-- These are inserted per-org at signup but migration seeds the template concepts.
-- Actual per-org seeding happens in the auth.provision endpoint.


-- ============================================================
-- migration_069_saml_sso.sql
-- ============================================================
-- migration_069_saml_sso.sql
-- P4-01: SAML/SSO configuration per organisation

CREATE TABLE IF NOT EXISTS sso_configurations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL,       -- okta | azure_ad | google | custom
  metadata_url    text,                -- IdP metadata URL (preferred)
  metadata_xml    text,                -- Raw IdP metadata XML (fallback)
  domain_hint     text,                -- e.g. "acme.com" for auto-redirect
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS sso_configurations_org_idx ON sso_configurations (organization_id);

ALTER TABLE sso_configurations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org admins manage sso" ON sso_configurations;
CREATE POLICY "org admins manage sso"
  ON sso_configurations FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  ));


-- ============================================================
-- migration_070_white_label.sql
-- ============================================================
-- migration_070_white_label.sql
-- P4-08: White-label program — custom logo, domain, email templates per org

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS white_label_enabled  boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_logo_url          text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_primary_color     text;   -- hex e.g. #1a73e8
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_custom_domain     text;   -- e.g. ai.acme.com
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_product_name      text;   -- replaces "Zapheit" in UI
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_support_email     text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_email_from_name   text;   -- sender display name

CREATE UNIQUE INDEX IF NOT EXISTS organizations_wl_domain_idx ON organizations (wl_custom_domain) WHERE wl_custom_domain IS NOT NULL;


-- ============================================================
-- migration_071_integration_connection_audit_fields.sql
-- ============================================================
BEGIN;

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_integrations_connected_by ON integrations(connected_by);
CREATE INDEX IF NOT EXISTS idx_integrations_connected_at ON integrations(connected_at DESC);

COMMIT;


-- ============================================================
-- migration_072_session_recording.sql
-- ============================================================
-- migration_072_session_recording.sql
-- P3-12: Session recording + configurable retention policy per org

-- Add dedicated columns to organizations for performance and cron clarity.
-- Values are also mirrored in the settings JSONB for API convenience.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS session_recording_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS conversation_retention_days integer NOT NULL DEFAULT 90
    CHECK (conversation_retention_days IN (30, 90, 365));

-- Index used by the nightly retention worker
CREATE INDEX IF NOT EXISTS idx_orgs_retention
  ON organizations (conversation_retention_days)
  WHERE session_recording_enabled = true;

-- Policy: conversations older than the org's retention window are eligible for deletion.
-- The worker queries:
--   DELETE FROM conversations
--   WHERE organization_id = $orgId
--     AND created_at < NOW() - INTERVAL '1 day' * retention_days

COMMENT ON COLUMN organizations.session_recording_enabled IS
  'When false, gateway does not persist message content — only metadata is stored.';
COMMENT ON COLUMN organizations.conversation_retention_days IS
  '30 = Free tier max, 90 = Pro default, 365 = Business/Enterprise. Enforced by nightly TTL worker.';

