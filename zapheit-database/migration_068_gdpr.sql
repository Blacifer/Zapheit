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
