-- Migration 044: Agent version history + rollback
-- Each save to PUT /agents/:id creates an immutable snapshot row.
-- Rollback restores the snapshot fields back onto ai_agents.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  version_number    INTEGER NOT NULL,
  -- Snapshot of mutable fields at the moment of save
  snapshot          JSONB NOT NULL,
  changed_by_email  TEXT,
  change_summary    TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_id ON agent_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_org_id   ON agent_versions(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_created  ON agent_versions(agent_id, created_at DESC);

-- RLS: org members can read their own agent versions; only backend service role can write
ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_versions_select" ON agent_versions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- Inserts / updates done via service role in backend (bypasses RLS)

COMMIT;
