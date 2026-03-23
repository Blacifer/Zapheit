-- migration_029: add confidence score to incidents table
-- Enables surfacing detection confidence in the UI and auto-suppressing
-- incident types with >5 false positives in 30 days.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS confidence REAL;

-- Index to support fast false-positive-count queries used by auto-suppress logic
-- (org + type + status + created_at range)
CREATE INDEX IF NOT EXISTS idx_incidents_fp_lookup
  ON incidents (organization_id, incident_type, status, created_at);

COMMENT ON COLUMN incidents.confidence IS
  'Detection confidence score (0.0–1.0) from incident-detection.ts. NULL for manually created incidents.';
