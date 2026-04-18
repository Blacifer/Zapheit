-- migration_058_agent_lifecycle.sql
--
-- Formalises the agent lifecycle as an enforced state machine.
--
-- Lifecycle states (HR metaphor):
--   draft          → agent record created, not yet configured (job posting)
--   provisioning   → being set up / enrolled into a runtime (onboarding)
--   active         → fully operational (employed)
--   suspended      → temporarily paused by a manager (leave of absence)
--   decommissioning → being wound down, draining jobs (notice period)
--   terminated     → permanently shut down, no further calls (terminated)
--
-- Legal transitions:
--   draft          → provisioning
--   provisioning   → active | terminated
--   active         → suspended | decommissioning | terminated
--   suspended      → active | decommissioning | terminated
--   decommissioning → terminated
--   terminated     → (no transitions — terminal state)

DO $$ BEGIN

  -- Add lifecycle_state column with enum-style constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agents' AND column_name = 'lifecycle_state'
  ) THEN
    ALTER TABLE ai_agents ADD COLUMN lifecycle_state VARCHAR(30)
      DEFAULT 'active'
      CHECK (lifecycle_state IN ('draft','provisioning','active','suspended','decommissioning','terminated'));
  END IF;

END $$;

-- Transition audit table
CREATE TABLE IF NOT EXISTS agent_lifecycle_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  from_state      VARCHAR(30) NOT NULL,
  to_state        VARCHAR(30) NOT NULL,
  reason          TEXT,
  actor_email     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying transition history per agent
CREATE INDEX IF NOT EXISTS idx_lifecycle_transitions_agent
  ON agent_lifecycle_transitions (agent_id, created_at DESC);

-- RLS: org members can read/write their own org's transitions
ALTER TABLE agent_lifecycle_transitions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_lifecycle_transitions' AND policyname = 'org_isolation'
  ) THEN
    CREATE POLICY org_isolation ON agent_lifecycle_transitions
      USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::uuid);
  END IF;
END $$;

COMMENT ON TABLE agent_lifecycle_transitions IS
  'Immutable audit log of every lifecycle state change for an agent.';
COMMENT ON COLUMN ai_agents.lifecycle_state IS
  'Current lifecycle state of the agent. Transitions are enforced by agent-lifecycle.ts.';
