-- ---------------------------------------------------------------------------
-- Phase 1: Schema + Contract Hardening
-- Ensures seniority and integration contract tables/columns exist.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS agent_corrections (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id         UUID        REFERENCES ai_agents(id) ON DELETE SET NULL,
  approval_id      UUID,
  service          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  decision         TEXT        NOT NULL CHECK (decision IN ('approved', 'denied')),
  context_summary  TEXT        NOT NULL,
  reviewer_note    TEXT,
  embedding        JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synthesized_rules (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  trigger_count    INTEGER     NOT NULL DEFAULT 3,
  proposed_policy  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, service, action)
);

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

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS enabled_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_tested_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_result     TEXT;

COMMIT;

