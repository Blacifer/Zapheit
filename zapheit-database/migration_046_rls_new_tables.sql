-- Migration 046: RLS write policies for agent_versions and alert_channels
-- Both tables were created (044, 045) with only SELECT policies.
-- INSERT/UPDATE/DELETE were missing, blocking all backend writes via user JWT.

BEGIN;

-- ── agent_versions ──────────────────────────────────────────────────────────

CREATE POLICY "agent_versions_insert" ON agent_versions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "agent_versions_update" ON agent_versions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "agent_versions_delete" ON agent_versions
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

-- ── alert_channels ───────────────────────────────────────────────────────────

CREATE POLICY "alert_channels_insert" ON alert_channels
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "alert_channels_update" ON alert_channels
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY "alert_channels_delete" ON alert_channels
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;
