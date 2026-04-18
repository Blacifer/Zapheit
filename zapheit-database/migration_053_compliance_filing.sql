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

CREATE POLICY filing_deadlines_select ON filing_deadlines
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY filing_deadlines_insert ON filing_deadlines
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY filing_deadlines_update ON filing_deadlines
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

ALTER TABLE filing_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY filing_submissions_select ON filing_submissions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY filing_submissions_insert ON filing_submissions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY filing_submissions_update ON filing_submissions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

ALTER TABLE filing_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY filing_alerts_select ON filing_alerts
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY filing_alerts_insert ON filing_alerts
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY filing_alerts_update ON filing_alerts
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );
