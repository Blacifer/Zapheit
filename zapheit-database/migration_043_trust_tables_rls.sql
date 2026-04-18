-- ---------------------------------------------------------------------------
-- Migration 043: Trust Tables RLS
-- Enables user-scoped access to trust tables so normal /api routes do not
-- require service-role PostgREST access.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE integration_openapi_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE redteam_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_openapi_specs_select"
  ON integration_openapi_specs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "integration_openapi_specs_insert"
  ON integration_openapi_specs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "audit_event_chain_select"
  ON audit_event_chain
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "redteam_runs_select"
  ON redteam_runs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "redteam_runs_insert"
  ON redteam_runs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
