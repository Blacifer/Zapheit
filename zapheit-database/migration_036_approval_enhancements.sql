-- migration_036_approval_enhancements.sql
-- Adds risk scoring, SLA tracking, snooze, subtasks, tags to approval_requests.
-- Adds approval_comments table for collaborative workspace.

-- ── approval_requests enhancements ────────────────────────────────────────────

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS risk_score NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sub_tasks JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::TEXT[];

-- Update status enum to include escalated
DO $$
BEGIN
  -- Only alter if 'escalated' is not already a valid value
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'approval_status' AND e.enumlabel = 'escalated'
  ) THEN
    -- approval_requests.status is VARCHAR, so just document the new value
    -- (no enum type to alter; constraint is enforced in application layer)
    NULL;
  END IF;
END $$;

-- Index for SLA queries
CREATE INDEX IF NOT EXISTS idx_approval_sla ON approval_requests(sla_deadline)
  WHERE status = 'pending' AND sla_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_snooze ON approval_requests(snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- ── approval_comments ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mention_ids UUID[] DEFAULT '{}'::UUID[],  -- @-mentioned user IDs
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_comments_request ON approval_comments(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_approval_comments_org ON approval_comments(organization_id);

-- Row-Level Security
ALTER TABLE approval_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_view_comments"
  ON approval_comments FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "org_members_can_insert_comments"
  ON approval_comments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
    AND author_id = auth.uid()
  );

CREATE POLICY "authors_can_update_comments"
  ON approval_comments FOR UPDATE
  USING (author_id = auth.uid());

CREATE POLICY "authors_and_admins_can_delete_comments"
  ON approval_comments FOR DELETE
  USING (
    author_id = auth.uid()
    OR organization_id IN (
      SELECT organization_id FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );
