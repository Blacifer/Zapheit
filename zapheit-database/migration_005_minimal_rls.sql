-- Minimal RLS policies for core multi-tenant tables
-- Safe to run multiple times (policy existence checks)

-- Enable RLS on core tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Organizations: users can read their own org
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organizations' AND policyname = 'Users can view own organization'
  ) THEN
    CREATE POLICY "Users can view own organization" ON organizations
      FOR SELECT USING (id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Users: org members can view, and users can view self
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'Org members can view users'
  ) THEN
    CREATE POLICY "Org members can view users" ON users
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'Users can view own profile'
  ) THEN
    CREATE POLICY "Users can view own profile" ON users
      FOR SELECT USING (id = auth.uid());
  END IF;
END $$;

-- AI Agents: org members can read/write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_agents' AND policyname = 'Org members can view agents'
  ) THEN
    CREATE POLICY "Org members can view agents" ON ai_agents
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_agents' AND policyname = 'Org members can insert agents'
  ) THEN
    CREATE POLICY "Org members can insert agents" ON ai_agents
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_agents' AND policyname = 'Org members can update agents'
  ) THEN
    CREATE POLICY "Org members can update agents" ON ai_agents
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Incidents: org members can read/write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'Org members can view incidents'
  ) THEN
    CREATE POLICY "Org members can view incidents" ON incidents
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'Org members can insert incidents'
  ) THEN
    CREATE POLICY "Org members can insert incidents" ON incidents
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'Org members can update incidents'
  ) THEN
    CREATE POLICY "Org members can update incidents" ON incidents
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Cost Tracking: org members can read/write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cost_tracking' AND policyname = 'Org members can view costs'
  ) THEN
    CREATE POLICY "Org members can view costs" ON cost_tracking
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cost_tracking' AND policyname = 'Org members can insert costs'
  ) THEN
    CREATE POLICY "Org members can insert costs" ON cost_tracking
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cost_tracking' AND policyname = 'Org members can update costs'
  ) THEN
    CREATE POLICY "Org members can update costs" ON cost_tracking
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- API Keys: org members can read/write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'api_keys' AND policyname = 'Org members can view api keys'
  ) THEN
    CREATE POLICY "Org members can view api keys" ON api_keys
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'api_keys' AND policyname = 'Org members can insert api keys'
  ) THEN
    CREATE POLICY "Org members can insert api keys" ON api_keys
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'api_keys' AND policyname = 'Org members can update api keys'
  ) THEN
    CREATE POLICY "Org members can update api keys" ON api_keys
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Audit Logs: org members can read/insert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'Org members can view audit logs'
  ) THEN
    CREATE POLICY "Org members can view audit logs" ON audit_logs
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'Org members can insert audit logs'
  ) THEN
    CREATE POLICY "Org members can insert audit logs" ON audit_logs
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Gateway idempotency keys: org members can read/write
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gateway_idempotency_keys' AND policyname = 'Org members can view gateway idempotency keys'
  ) THEN
    CREATE POLICY "Org members can view gateway idempotency keys" ON gateway_idempotency_keys
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gateway_idempotency_keys' AND policyname = 'Org members can insert gateway idempotency keys'
  ) THEN
    CREATE POLICY "Org members can insert gateway idempotency keys" ON gateway_idempotency_keys
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'gateway_idempotency_keys' AND policyname = 'Org members can update gateway idempotency keys'
  ) THEN
    CREATE POLICY "Org members can update gateway idempotency keys" ON gateway_idempotency_keys
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;
