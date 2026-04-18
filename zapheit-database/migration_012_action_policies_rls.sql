-- Database Migration: RLS for Action Policies
-- Version: 1.0.0
-- Created: 2026-03-11
-- Safe to run multiple times (policy existence checks).

BEGIN;

ALTER TABLE action_policies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'action_policies' AND policyname = 'Org members can view action policies'
  ) THEN
    CREATE POLICY "Org members can view action policies" ON action_policies
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'action_policies' AND policyname = 'Org members can insert action policies'
  ) THEN
    CREATE POLICY "Org members can insert action policies" ON action_policies
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'action_policies' AND policyname = 'Org members can update action policies'
  ) THEN
    CREATE POLICY "Org members can update action policies" ON action_policies
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMIT;

