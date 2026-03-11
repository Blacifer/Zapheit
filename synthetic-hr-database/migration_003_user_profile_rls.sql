-- Allow an authenticated user to read their own profile row.
-- This enables secure "is my workspace provisioned?" checks using user JWT + RLS.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Create policy only if it doesn't already exist.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Users can view own profile'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "Users can view own profile" ON users
        FOR SELECT USING (id = auth.uid())
    $POLICY$;
  END IF;
END $$;

