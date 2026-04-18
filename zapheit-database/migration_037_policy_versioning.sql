-- migration_037_policy_versioning.sql
-- Adds YAML source storage and versioning to policy_packs.
-- Creates policy_pack_versions for full audit history of policy changes.

-- ── policy_packs enhancements ─────────────────────────────────────────────────

ALTER TABLE policy_packs
  ADD COLUMN IF NOT EXISTS yaml_source TEXT,    -- raw YAML policy definition
  ADD COLUMN IF NOT EXISTS version INT DEFAULT 1 NOT NULL;

-- ── policy_pack_versions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_pack_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_pack_id UUID NOT NULL REFERENCES policy_packs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INT NOT NULL,
  yaml_source TEXT NOT NULL,
  rules JSONB NOT NULL,             -- snapshot of rules at this version
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_pack_ver
  ON policy_pack_versions(policy_pack_id, version);

CREATE INDEX IF NOT EXISTS idx_policy_versions_pack ON policy_pack_versions(policy_pack_id);
CREATE INDEX IF NOT EXISTS idx_policy_versions_org ON policy_pack_versions(organization_id);

-- Row-Level Security
ALTER TABLE policy_pack_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_versions"
  ON policy_pack_versions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "service_role_can_insert_versions"
  ON policy_pack_versions FOR INSERT
  WITH CHECK (true);
