-- Migration 014: Batch Jobs table + Incident metadata columns
-- Run this in the Supabase SQL editor

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add UI metadata columns to the incidents table
--    These replace the localStorage-only fields: owner, priority, source,
--    notes, next_action
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS owner       VARCHAR(100) DEFAULT 'Unassigned',
  ADD COLUMN IF NOT EXISTS priority    VARCHAR(10)  DEFAULT 'P4',
  ADD COLUMN IF NOT EXISTS source      VARCHAR(50)  DEFAULT 'live_traffic',
  ADD COLUMN IF NOT EXISTS notes       TEXT         DEFAULT '',
  ADD COLUMN IF NOT EXISTS next_action TEXT         DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_incidents_owner    ON incidents(owner);
CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents(priority);
CREATE INDEX IF NOT EXISTS idx_incidents_source   ON incidents(source);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Create batch_jobs table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS batch_jobs (
    id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             VARCHAR(255) NOT NULL,
    description      TEXT         DEFAULT '',
    model            VARCHAR(100) NOT NULL DEFAULT 'openai/gpt-4o',
    status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','processing','completed','failed')),
    requests         INTEGER      NOT NULL DEFAULT 0,
    succeeded        INTEGER      NOT NULL DEFAULT 0,
    failed           INTEGER      NOT NULL DEFAULT 0,
    progress         INTEGER      NOT NULL DEFAULT 0,
    total_cost_usd   NUMERIC(12,8) NOT NULL DEFAULT 0,
    items            JSONB        NOT NULL DEFAULT '[]',
    results          JSONB        NOT NULL DEFAULT '[]',
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at     TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_org_id    ON batch_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status    ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created_at ON batch_jobs(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS for batch_jobs — org-scoped, same pattern as other tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;

-- Users can see their own org's batch jobs
CREATE POLICY batch_jobs_select_org ON batch_jobs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can create batch jobs for their org
CREATE POLICY batch_jobs_insert_org ON batch_jobs
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can update batch jobs in their org
CREATE POLICY batch_jobs_update_org ON batch_jobs
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can delete batch jobs in their org
CREATE POLICY batch_jobs_delete_org ON batch_jobs
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
