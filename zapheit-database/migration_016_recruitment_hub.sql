-- Migration 016: Recruitment Hub tables
-- Native job posting + AI resume screening for the Recruitment Hub.
-- Run this in the Supabase SQL editor.

BEGIN;

-- ─── Job Postings ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_postings (
    id                     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id        UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    title                  VARCHAR(255) NOT NULL,
    requirements           TEXT,
    location               VARCHAR(255),
    employment_type        VARCHAR(50)  NOT NULL DEFAULT 'full_time'
                             CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'internship')),
    salary_min             INTEGER,
    salary_max             INTEGER,
    currency               VARCHAR(10)  DEFAULT 'INR',

    status                 VARCHAR(50)  NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'open', 'paused', 'closed')),

    -- External platform posting state
    posted_to              JSONB        NOT NULL DEFAULT '[]',

    -- AI screening configuration
    ai_screening_enabled   BOOLEAN      NOT NULL DEFAULT false,
    ai_screening_threshold INTEGER      NOT NULL DEFAULT 75,
    auto_reject_below      INTEGER,

    created_by             UUID         REFERENCES users(id),
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_org_id     ON job_postings(organization_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_status     ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_job_postings_created_at ON job_postings(created_at DESC);

-- ─── Job Applications ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_applications (
    id                       UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    job_id                   UUID         NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,

    candidate_name           VARCHAR(255) NOT NULL,
    candidate_email          VARCHAR(255),
    candidate_phone          VARCHAR(50),
    resume_url               TEXT,
    resume_text              TEXT,
    cover_letter             TEXT,

    source_platform          VARCHAR(50),  -- naukri / linkedin / zoho_recruit / direct / manual
    external_application_id  VARCHAR(255),

    -- AI scoring
    ai_score                 INTEGER,      -- 0-100
    ai_summary               TEXT,
    ai_scored_at             TIMESTAMP WITH TIME ZONE,

    status                   VARCHAR(50)  NOT NULL DEFAULT 'new'
                               CHECK (status IN ('new', 'screening', 'shortlisted', 'interviewing', 'offered', 'rejected', 'withdrawn')),
    rejection_reason         TEXT,
    tags                     TEXT[]       DEFAULT '{}',
    notes                    JSONB        DEFAULT '[]',

    applied_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_org_id     ON job_applications(organization_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_job_id     ON job_applications(job_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_status     ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_job_applications_ai_score   ON job_applications(ai_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_job_applications_created_at ON job_applications(created_at DESC);

-- ─── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_postings_select_org ON job_postings
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY job_postings_insert_org ON job_postings
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY job_postings_update_org ON job_postings
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY job_postings_delete_org ON job_postings
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_applications_select_org ON job_applications
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY job_applications_insert_org ON job_applications
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY job_applications_update_org ON job_applications
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY job_applications_delete_org ON job_applications
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
