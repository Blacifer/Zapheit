-- migration_030_policy_interceptors.sql
-- Adds interceptor_rules column to action_policies for real-time
-- prompt/response interception (PATCH_REQUEST, PATCH_RESPONSE) and
-- model routing (ROUTE_MODEL) policies.

ALTER TABLE action_policies
  ADD COLUMN IF NOT EXISTS interceptor_rules JSONB DEFAULT '[]';

-- Index for fast lookup of __gateway__ service policies per org
CREATE INDEX IF NOT EXISTS idx_action_policies_gateway
  ON action_policies (organization_id, service)
  WHERE service = '__gateway__';
