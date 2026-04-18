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

CREATE POLICY consent_records_select ON consent_records
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

CREATE POLICY consent_records_insert ON consent_records
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

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

CREATE POLICY retention_policies_select ON data_retention_policies
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

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

CREATE POLICY dpr_select ON data_principal_requests
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

CREATE POLICY dpr_insert ON data_principal_requests
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid()
    )
  );

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
