-- Migration 021: Approval Requests (Human-in-the-Loop workflow engine)
-- When an agent wants to perform an action governed by an action_policy
-- with require_approval=true, it creates an approval request here.
-- A human reviewer (with the required role) approves or denies it.
-- Run this in the Supabase SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS approval_requests (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id     UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Optional links to the triggering agent and conversation
    agent_id            UUID            REFERENCES ai_agents(id) ON DELETE SET NULL,
    conversation_id     UUID,

    -- Optional link back to the governing policy
    action_policy_id    UUID            REFERENCES action_policies(id) ON DELETE SET NULL,

    -- What action was requested (mirrors action_policies.service / .action)
    service             TEXT            NOT NULL,
    action              TEXT            NOT NULL,

    -- The data the agent wants to act on
    action_payload      JSONB           NOT NULL DEFAULT '{}',

    -- Who/what raised this request (agent name, system component, etc.)
    requested_by        TEXT            NOT NULL DEFAULT 'agent',

    -- Lifecycle
    status              TEXT            NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),

    -- Minimum role required to approve/deny
    required_role       TEXT            NOT NULL DEFAULT 'manager'
                            CHECK (required_role IN ('viewer', 'manager', 'admin', 'super_admin')),

    -- Review outcome
    reviewer_id         UUID            REFERENCES users(id) ON DELETE SET NULL,
    reviewer_note       TEXT,
    reviewed_at         TIMESTAMPTZ,

    -- Expiry (default 24 h from creation; any pending request past this is effectively expired)
    expires_at          TIMESTAMPTZ     NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

    created_at          TIMESTAMPTZ     DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_org_id     ON approval_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status     ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_agent_id   ON approval_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_expires_at ON approval_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_created_at ON approval_requests(created_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_requests_select_org ON approval_requests
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY approval_requests_insert_org ON approval_requests
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY approval_requests_update_org ON approval_requests
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY approval_requests_delete_org ON approval_requests
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
