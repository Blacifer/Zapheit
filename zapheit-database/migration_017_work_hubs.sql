-- Migration 017: Work Hub tables & AI columns
-- Adds AI triage/scoring columns to existing work-item tables
-- and creates new tables for Finance and Compliance hubs.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Support Hub — AI columns on support_tickets
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ai_urgency_score    INTEGER,
  ADD COLUMN IF NOT EXISTS ai_category         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ai_draft_response   TEXT,
  ADD COLUMN IF NOT EXISTS ai_triaged_at       TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sla_deadline        TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS channel             VARCHAR(50) DEFAULT 'manual';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Sales Hub — AI columns on sales_leads
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS ai_deal_score       INTEGER,
  ADD COLUMN IF NOT EXISTS ai_risk_reason      TEXT,
  ADD COLUMN IF NOT EXISTS ai_next_action      TEXT,
  ADD COLUMN IF NOT EXISTS ai_scored_at        TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deal_value          NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS currency            VARCHAR(10) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS last_activity_at    TIMESTAMP WITH TIME ZONE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. IT Hub — AI columns on it_access_requests
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE it_access_requests
  ADD COLUMN IF NOT EXISTS ai_risk_rating      INTEGER,
  ADD COLUMN IF NOT EXISTS ai_policy_result    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ai_evaluation_notes TEXT,
  ADD COLUMN IF NOT EXISTS ai_evaluated_at     TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS department          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS sensitivity_level   VARCHAR(50) DEFAULT 'standard';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Finance Hub — new tables
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_invoices (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    vendor_name          VARCHAR(255) NOT NULL,
    invoice_number       VARCHAR(100),
    amount               NUMERIC(12,2) NOT NULL,
    currency             VARCHAR(10)  DEFAULT 'INR',
    due_date             DATE,
    received_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    po_number            VARCHAR(100),
    matched_status       VARCHAR(50) NOT NULL DEFAULT 'unmatched'
                           CHECK (matched_status IN ('unmatched', 'matched', 'exception', 'paid')),
    ai_match_confidence  INTEGER,
    ai_flags             JSONB DEFAULT '[]',
    ai_validated_at      TIMESTAMP WITH TIME ZONE,
    status               VARCHAR(50) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    approved_by          UUID REFERENCES users(id),
    notes                TEXT,
    created_by           UUID REFERENCES users(id),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_invoices_org_id   ON hub_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_hub_invoices_status   ON hub_invoices(status);
CREATE INDEX IF NOT EXISTS idx_hub_invoices_due_date ON hub_invoices(due_date);

CREATE TABLE IF NOT EXISTS hub_expenses (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    claimant_name        VARCHAR(255) NOT NULL,
    claimant_email       VARCHAR(255),
    category             VARCHAR(100),
    amount               NUMERIC(12,2) NOT NULL,
    currency             VARCHAR(10) DEFAULT 'INR',
    receipt_url          TEXT,
    description          TEXT,
    expense_date         DATE,
    ai_policy_compliant  BOOLEAN,
    ai_flags             JSONB DEFAULT '[]',
    ai_validated_at      TIMESTAMP WITH TIME ZONE,
    status               VARCHAR(50) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected', 'reimbursed')),
    approved_by          UUID REFERENCES users(id),
    created_by           UUID REFERENCES users(id),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_expenses_org_id ON hub_expenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_hub_expenses_status ON hub_expenses(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Compliance Hub — new tables
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hub_deadlines (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title                VARCHAR(255) NOT NULL,
    regulation           VARCHAR(100),
    description          TEXT,
    due_date             DATE         NOT NULL,
    recurring            VARCHAR(50),
    status               VARCHAR(50) NOT NULL DEFAULT 'upcoming'
                           CHECK (status IN ('upcoming', 'in_progress', 'completed', 'overdue', 'waived')),
    ai_checklist         JSONB DEFAULT '[]',
    ai_generated_at      TIMESTAMP WITH TIME ZONE,
    assigned_to          UUID REFERENCES users(id),
    completed_at         TIMESTAMP WITH TIME ZONE,
    created_by           UUID REFERENCES users(id),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_deadlines_org_id   ON hub_deadlines(organization_id);
CREATE INDEX IF NOT EXISTS idx_hub_deadlines_due_date ON hub_deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_hub_deadlines_status   ON hub_deadlines(status);

CREATE TABLE IF NOT EXISTS hub_evidence (
    id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deadline_id          UUID         REFERENCES hub_deadlines(id) ON DELETE SET NULL,
    title                VARCHAR(255) NOT NULL,
    control_area         VARCHAR(100),
    source               VARCHAR(100),
    file_url             TEXT,
    collected_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status               VARCHAR(50) NOT NULL DEFAULT 'collected'
                           CHECK (status IN ('collected', 'reviewed', 'accepted', 'rejected')),
    reviewed_by          UUID REFERENCES users(id),
    created_by           UUID REFERENCES users(id),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_evidence_org_id      ON hub_evidence(organization_id);
CREATE INDEX IF NOT EXISTS idx_hub_evidence_deadline_id ON hub_evidence(deadline_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE hub_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_invoices_select_org ON hub_invoices FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_invoices_insert_org ON hub_invoices FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_invoices_update_org ON hub_invoices FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_invoices_delete_org ON hub_invoices FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

ALTER TABLE hub_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_expenses_select_org ON hub_expenses FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_expenses_insert_org ON hub_expenses FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_expenses_update_org ON hub_expenses FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_expenses_delete_org ON hub_expenses FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

ALTER TABLE hub_deadlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_deadlines_select_org ON hub_deadlines FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_deadlines_insert_org ON hub_deadlines FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_deadlines_update_org ON hub_deadlines FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_deadlines_delete_org ON hub_deadlines FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

ALTER TABLE hub_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_evidence_select_org ON hub_evidence FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_evidence_insert_org ON hub_evidence FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_evidence_update_org ON hub_evidence FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
CREATE POLICY hub_evidence_delete_org ON hub_evidence FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));

COMMIT;
