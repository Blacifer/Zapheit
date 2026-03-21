-- migration_020: add missing DELETE RLS policy for ai_agents
-- Without this, all agent deletes are blocked by row-level security
-- even for authenticated org members with agents.delete permission.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_agents'
      AND policyname = 'Org members can delete agents'
  ) THEN
    CREATE POLICY "Org members can delete agents" ON ai_agents
      FOR DELETE USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;
