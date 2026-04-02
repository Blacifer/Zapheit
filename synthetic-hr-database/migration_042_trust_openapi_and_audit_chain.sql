-- ---------------------------------------------------------------------------
-- Migration 042: Trust + OpenAPI Ingest Foundations
-- Adds OpenAPI ingest storage, tamper-evident audit chain, and red-team run logs.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS integration_openapi_specs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  raw_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  capability_map JSONB NOT NULL DEFAULT '{"capabilities":[]}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openapi_specs_unique_hash
  ON integration_openapi_specs (organization_id, service_id, spec_hash);

CREATE INDEX IF NOT EXISTS idx_openapi_specs_service
  ON integration_openapi_specs (organization_id, service_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_event_chain (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_chain_org_time
  ON audit_event_chain (organization_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_chain_hash
  ON audit_event_chain (entry_hash);

CREATE TABLE IF NOT EXISTS redteam_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed',
  scenario_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redteam_runs_org_time
  ON redteam_runs (organization_id, created_at DESC);

COMMIT;
