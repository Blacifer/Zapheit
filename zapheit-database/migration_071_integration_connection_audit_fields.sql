BEGIN;

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_integrations_connected_by ON integrations(connected_by);
CREATE INDEX IF NOT EXISTS idx_integrations_connected_at ON integrations(connected_at DESC);

COMMIT;
