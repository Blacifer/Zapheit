-- migration_069_saml_sso.sql
-- P4-01: SAML/SSO configuration per organisation

CREATE TABLE IF NOT EXISTS sso_configurations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL,       -- okta | azure_ad | google | custom
  metadata_url    text,                -- IdP metadata URL (preferred)
  metadata_xml    text,                -- Raw IdP metadata XML (fallback)
  domain_hint     text,                -- e.g. "acme.com" for auto-redirect
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS sso_configurations_org_idx ON sso_configurations (organization_id);

ALTER TABLE sso_configurations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org admins manage sso" ON sso_configurations;
CREATE POLICY "org admins manage sso"
  ON sso_configurations FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  ));
