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
