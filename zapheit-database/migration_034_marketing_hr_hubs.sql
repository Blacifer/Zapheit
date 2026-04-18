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
    CREATE POLICY org_isolation ON hub_marketing_campaigns USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_marketing_contacts' AND policyname = 'org_isolation') THEN
    CREATE POLICY org_isolation ON hub_marketing_contacts USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_marketing_performance' AND policyname = 'org_isolation') THEN
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
    CREATE POLICY org_isolation ON hub_hr_attendance USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_leave' AND policyname = 'org_isolation') THEN
    CREATE POLICY org_isolation ON hub_hr_leave USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_payroll' AND policyname = 'org_isolation') THEN
    CREATE POLICY org_isolation ON hub_hr_payroll USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hub_hr_headcount' AND policyname = 'org_isolation') THEN
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
