-- migration_059_marketplace_improvements.sql
--
-- Tracks marketplace app installs per organization for live install counts.
-- Enables the "X installs" badge on the marketplace catalog.

CREATE TABLE IF NOT EXISTS marketplace_install_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT NOT NULL,
  organization_id UUID NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('install', 'uninstall')),
  actor_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast count queries per app_id
CREATE INDEX IF NOT EXISTS idx_mkt_install_events_app
  ON marketplace_install_events (app_id, action);

-- Per-org history
CREATE INDEX IF NOT EXISTS idx_mkt_install_events_org
  ON marketplace_install_events (organization_id, created_at DESC);

-- RLS: orgs can only see their own install events
ALTER TABLE marketplace_install_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'marketplace_install_events' AND policyname = 'org_isolation'
  ) THEN
    CREATE POLICY org_isolation ON marketplace_install_events
      USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid);
  END IF;
END $$;

COMMENT ON TABLE marketplace_install_events IS
  'Immutable log of marketplace app install/uninstall events for install-count tracking.';
