-- Migration 028: Gateway usage tracking for org-level monthly quotas
-- Supports free/audit/retainer/enterprise plan tiers with monthly request caps.

CREATE TABLE IF NOT EXISTS gateway_usage (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month       VARCHAR(7) NOT NULL,           -- 'YYYY-MM', e.g. '2026-03'
  request_count INTEGER NOT NULL DEFAULT 0,
  quota       INTEGER NOT NULL DEFAULT 10000, -- -1 means unlimited
  UNIQUE (org_id, month)
);

CREATE INDEX IF NOT EXISTS gateway_usage_org_month_idx ON gateway_usage (org_id, month);

-- RLS: orgs can only see their own usage rows
ALTER TABLE gateway_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY gateway_usage_org_isolation ON gateway_usage
  USING (org_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()
  ));
