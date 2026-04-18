-- migration_060_chat_runtime_profiles.sql
--
-- Backend-managed runtime profiles for consumer-first chat.
-- Stores BYOK provider keys and Zapheit gateway keys encrypted at rest.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_runtime_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('provider', 'gateway')),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'openrouter', 'zapheit_gateway')),
  label VARCHAR(120) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_runtime_profiles_org_created
  ON chat_runtime_profiles (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_runtime_profiles_org_status
  ON chat_runtime_profiles (organization_id, status);

ALTER TABLE chat_runtime_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_select'
  ) THEN
    CREATE POLICY chat_runtime_profiles_select ON chat_runtime_profiles
      FOR SELECT USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_insert'
  ) THEN
    CREATE POLICY chat_runtime_profiles_insert ON chat_runtime_profiles
      FOR INSERT WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_update'
  ) THEN
    CREATE POLICY chat_runtime_profiles_update ON chat_runtime_profiles
      FOR UPDATE USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_runtime_profiles'
      AND policyname = 'chat_runtime_profiles_delete'
  ) THEN
    CREATE POLICY chat_runtime_profiles_delete ON chat_runtime_profiles
      FOR DELETE USING (
        organization_id IN (
          SELECT organization_id FROM users WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
