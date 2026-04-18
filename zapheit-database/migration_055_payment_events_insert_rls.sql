BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
      AND policyname = 'payment_events_insert'
  ) THEN
    CREATE POLICY payment_events_insert ON payment_events
      FOR INSERT WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;