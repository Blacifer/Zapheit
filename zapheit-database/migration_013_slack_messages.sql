-- Migration 013: Slack Messages inbox table
-- Stores inbound Slack messages for review and action from within the app.
-- Safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS slack_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id      UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,

  slack_team_id       VARCHAR(32)  NOT NULL,
  slack_channel_id    VARCHAR(32)  NOT NULL,
  slack_channel_name  VARCHAR(255),
  slack_user_id       VARCHAR(32)  NOT NULL,
  slack_user_name     VARCHAR(255),

  slack_ts            VARCHAR(32)  NOT NULL,   -- Slack message timestamp (unique per workspace)
  thread_ts           VARCHAR(32),             -- NULL = top-level; set = reply in thread
  text                TEXT         NOT NULL DEFAULT '',
  event_type          VARCHAR(50)  NOT NULL DEFAULT 'message',

  status              VARCHAR(20)  NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'reviewed', 'replied', 'dismissed')),

  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Idempotent ingest: Slack can re-deliver events
  UNIQUE (slack_team_id, slack_ts)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_slack_messages_org
  ON slack_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_integration
  ON slack_messages(integration_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_org_status
  ON slack_messages(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_slack_messages_org_channel
  ON slack_messages(organization_id, slack_channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_org_created
  ON slack_messages(organization_id, created_at DESC);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_slack_messages_updated_at'
  ) THEN
    CREATE TRIGGER update_slack_messages_updated_at
      BEFORE UPDATE ON slack_messages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Row Level Security
ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'slack_messages'
      AND policyname = 'Org members can view slack_messages'
  ) THEN
    CREATE POLICY "Org members can view slack_messages" ON slack_messages
      FOR SELECT USING (
        organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'slack_messages'
      AND policyname = 'Org members can update slack_messages'
  ) THEN
    CREATE POLICY "Org members can update slack_messages" ON slack_messages
      FOR UPDATE USING (
        organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
      );
  END IF;
END $$;
-- INSERT is via service role only (inbound webhook bypasses RLS).

COMMIT;
