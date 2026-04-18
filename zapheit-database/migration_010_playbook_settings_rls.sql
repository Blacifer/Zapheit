-- Database Migration: RLS for Playbook Settings
-- Version: 1.0.0
-- Created: 2026-03-11
-- Safe to run multiple times (policy existence checks).

BEGIN;

ALTER TABLE playbook_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'playbook_settings' AND policyname = 'Org members can view playbook settings'
  ) THEN
    CREATE POLICY "Org members can view playbook settings" ON playbook_settings
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'playbook_settings' AND policyname = 'Org members can upsert playbook settings'
  ) THEN
    CREATE POLICY "Org members can upsert playbook settings" ON playbook_settings
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'playbook_settings' AND policyname = 'Org members can update playbook settings'
  ) THEN
    CREATE POLICY "Org members can update playbook settings" ON playbook_settings
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMIT;

