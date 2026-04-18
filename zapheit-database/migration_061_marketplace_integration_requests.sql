-- migration_061_marketplace_integration_requests.sql
-- Tracks operator requests for integrations that are not yet supported.

CREATE TABLE IF NOT EXISTS marketplace_integration_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  app_id           text,
  app_name         text NOT NULL,
  use_case         text,
  status           text NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_integration_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON marketplace_integration_requests
  USING (organization_id = (current_setting('app.current_org_id', true))::uuid);
