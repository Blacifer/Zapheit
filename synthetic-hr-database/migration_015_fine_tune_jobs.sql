-- Migration 015: Fine-tune jobs table
-- Replaces localStorage persistence of fine-tuning job history.
-- Run this in the Supabase SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS fine_tune_jobs (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Job metadata (matches FineTuneJob frontend interface)
    name                 VARCHAR(255) NOT NULL,
    base_model           VARCHAR(100) NOT NULL,
    epochs               INTEGER      NOT NULL DEFAULT 3,
    file_name            VARCHAR(255) NOT NULL DEFAULT '',
    examples             INTEGER      NOT NULL DEFAULT 0,
    validation_examples  INTEGER      NOT NULL DEFAULT 0,
    estimated_cost_inr   NUMERIC(10,2) NOT NULL DEFAULT 0,
    readiness_score      INTEGER      NOT NULL DEFAULT 0,
    issues               JSONB        NOT NULL DEFAULT '[]',

    -- Status tracking
    status               VARCHAR(50)  NOT NULL DEFAULT 'ready'
                           CHECK (status IN (
                             'ready', 'needs_attention',
                             'provider_queued', 'provider_running',
                             'provider_succeeded', 'provider_failed'
                           )),
    provider_state       VARCHAR(20)  NOT NULL DEFAULT 'staged_local'
                           CHECK (provider_state IN ('staged_local', 'openai_submitted')),

    -- OpenAI-specific fields (populated after submission)
    provider_job_id      VARCHAR(255),
    fine_tuned_model     VARCHAR(255),
    trained_tokens       INTEGER,
    provider_status_text VARCHAR(255),

    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fine_tune_jobs_org_id     ON fine_tune_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_fine_tune_jobs_created_at ON fine_tune_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fine_tune_jobs_status     ON fine_tune_jobs(status);

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE fine_tune_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY fine_tune_jobs_select_org ON fine_tune_jobs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY fine_tune_jobs_insert_org ON fine_tune_jobs
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY fine_tune_jobs_update_org ON fine_tune_jobs
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY fine_tune_jobs_delete_org ON fine_tune_jobs
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
