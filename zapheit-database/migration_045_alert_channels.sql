-- Migration 045: Alert channels (PagerDuty, Microsoft Teams, Opsgenie, email)
-- Stores per-org notification channel configuration.
-- Secrets (API keys, webhook URLs) are stored encrypted in the `config` JSONB column
-- using the same application-level encryption used by integration_credentials.

BEGIN;

CREATE TABLE IF NOT EXISTS alert_channels (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  channel_type    TEXT NOT NULL CHECK (channel_type IN ('pagerduty', 'teams', 'opsgenie', 'email')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  -- Minimum severity to trigger this channel: low | medium | high | critical
  min_severity    TEXT NOT NULL DEFAULT 'high' CHECK (min_severity IN ('low', 'medium', 'high', 'critical')),
  -- Channel-specific config (encrypted secrets stored here):
  --   pagerduty : { routing_key }
  --   teams     : { webhook_url }
  --   opsgenie  : { api_key, region? }
  --   email     : { recipients: string[] }
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_channels_org_id ON alert_channels(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_channels_enabled ON alert_channels(organization_id, enabled);

ALTER TABLE alert_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_channels_select" ON alert_channels
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
