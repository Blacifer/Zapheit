-- Migration 026: Add assigned_to to approval_requests for routing rules
-- When action_policies.routing_rules matches action_payload, a specific user
-- can be assigned as the required approver.

BEGIN;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN approval_requests.assigned_to IS
  'Specific user required to approve this request (set by routing rules). NULL = any user with required_role.';

COMMIT;
