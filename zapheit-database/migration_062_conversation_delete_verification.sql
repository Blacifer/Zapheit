-- migration_062_conversation_delete_verification.sql
-- Verifies that the FK cascade required by DELETE /conversations/:id is in place.
-- messages.conversation_id was defined with ON DELETE CASCADE in migration_001.
-- gateway_reasoning_traces.conversation_id is ON DELETE SET NULL (traces are kept, reference nulled).
-- No schema changes needed — this migration serves as an explicit confirmation.

DO $$
DECLARE
  cascade_count int;
BEGIN
  SELECT COUNT(*) INTO cascade_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage kcu
    ON rc.constraint_name = kcu.constraint_name
  WHERE kcu.table_name = 'messages'
    AND kcu.column_name = 'conversation_id'
    AND rc.delete_rule = 'CASCADE';

  IF cascade_count = 0 THEN
    RAISE EXCEPTION 'messages.conversation_id FK cascade is missing — run migration_001 first';
  END IF;
END $$;
