-- migration_066_audit_log_immutable.sql
-- P3-05: Make audit_logs append-only (immutable events, strict taxonomy)

-- Prevent UPDATE on audit_logs (any attempt throws an error)
CREATE OR REPLACE FUNCTION fn_audit_logs_prevent_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — UPDATE is not permitted (event: %)', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_prevent_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_prevent_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_prevent_update();

-- Prevent DELETE on audit_logs
CREATE OR REPLACE FUNCTION fn_audit_logs_prevent_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — DELETE is not permitted (event: %)', OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_prevent_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_prevent_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_prevent_delete();

-- Add event_taxonomy column to enforce strict taxonomy at app layer reference
-- (taxonomy enforcement happens in the application; DB column stores the validated value)
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_category text;

-- Backfill categories from existing action prefixes
-- Temporarily bypass the append-only trigger so the schema backfill can run.
ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_prevent_update;
UPDATE audit_logs SET event_category = split_part(action, '.', 1)
WHERE event_category IS NULL AND action IS NOT NULL;
ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_prevent_update;

CREATE INDEX IF NOT EXISTS audit_logs_event_category_idx ON audit_logs (organization_id, event_category);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (organization_id, action);
