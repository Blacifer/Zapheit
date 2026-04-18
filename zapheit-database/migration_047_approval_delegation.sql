-- migration_047_approval_delegation.sql
-- Adds delegation, SLA, and escalation fields to approval_requests.

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS delegate_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN approval_requests.delegate_to_user_id IS 'When set, this approval has been delegated to another user (e.g. manager OOO).';
COMMENT ON COLUMN approval_requests.sla_hours IS 'Hours before this approval is considered overdue. Default 24.';
COMMENT ON COLUMN approval_requests.escalated_at IS 'Timestamp when SLA was breached and alert was sent. NULL = not yet escalated.';

CREATE INDEX IF NOT EXISTS idx_approval_requests_delegate ON approval_requests(delegate_to_user_id) WHERE delegate_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_escalated ON approval_requests(escalated_at) WHERE escalated_at IS NOT NULL;
