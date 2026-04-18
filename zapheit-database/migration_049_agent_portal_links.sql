-- Migration 049: Agent public portal links
-- Allows admins to generate a public share token for an agent.
-- Employees open /chat/:share_token to talk to the agent without logging in.

CREATE TABLE IF NOT EXISTS agent_portal_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  share_token     TEXT NOT NULL UNIQUE
                    DEFAULT encode(gen_random_bytes(24), 'base64url'),
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_portal_links_agent_id
  ON agent_portal_links(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_portal_links_token
  ON agent_portal_links(share_token);

COMMENT ON TABLE agent_portal_links IS
  'Public chat portal links for agents — token-gated, no user JWT required.';
