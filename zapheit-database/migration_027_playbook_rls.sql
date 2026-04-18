-- Migration 027: RLS policies for playbook system tables
-- Depends on: migration_025_playbook_extensions.sql
-- Safe to re-run (idempotent DO $$ blocks).

BEGIN;

-- ─── Enable RLS (only if table exists) ───────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_schedules') THEN
    EXECUTE 'ALTER TABLE playbook_schedules ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_triggers') THEN
    EXECUTE 'ALTER TABLE playbook_triggers ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='custom_playbooks') THEN
    EXECUTE 'ALTER TABLE custom_playbooks ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_share_links') THEN
    EXECUTE 'ALTER TABLE playbook_share_links ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='playbook_result_comments') THEN
    EXECUTE 'ALTER TABLE playbook_result_comments ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ─── playbook_schedules ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can view schedules') THEN
    CREATE POLICY "Org members can view schedules" ON playbook_schedules
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can insert schedules') THEN
    CREATE POLICY "Org members can insert schedules" ON playbook_schedules
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can update schedules') THEN
    CREATE POLICY "Org members can update schedules" ON playbook_schedules
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_schedules' AND policyname='Org members can delete schedules') THEN
    CREATE POLICY "Org members can delete schedules" ON playbook_schedules
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── playbook_triggers ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can view triggers') THEN
    CREATE POLICY "Org members can view triggers" ON playbook_triggers
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can insert triggers') THEN
    CREATE POLICY "Org members can insert triggers" ON playbook_triggers
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can update triggers') THEN
    CREATE POLICY "Org members can update triggers" ON playbook_triggers
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_triggers' AND policyname='Org members can delete triggers') THEN
    CREATE POLICY "Org members can delete triggers" ON playbook_triggers
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── custom_playbooks ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can view custom playbooks') THEN
    CREATE POLICY "Org members can view custom playbooks" ON custom_playbooks
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can insert custom playbooks') THEN
    CREATE POLICY "Org members can insert custom playbooks" ON custom_playbooks
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can update custom playbooks') THEN
    CREATE POLICY "Org members can update custom playbooks" ON custom_playbooks
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='custom_playbooks' AND policyname='Org members can delete custom playbooks') THEN
    CREATE POLICY "Org members can delete custom playbooks" ON custom_playbooks
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── playbook_share_links ─────────────────────────────────────────────────────
-- Public token reads go through the backend service role key — not user JWT.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_share_links' AND policyname='Org members can view share links') THEN
    CREATE POLICY "Org members can view share links" ON playbook_share_links
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_share_links' AND policyname='Org members can insert share links') THEN
    CREATE POLICY "Org members can insert share links" ON playbook_share_links
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_share_links' AND policyname='Org members can delete share links') THEN
    CREATE POLICY "Org members can delete share links" ON playbook_share_links
      FOR DELETE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- ─── playbook_result_comments ─────────────────────────────────────────────────
-- Immutable after insert — no UPDATE or DELETE for users.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_result_comments' AND policyname='Org members can view comments') THEN
    CREATE POLICY "Org members can view comments" ON playbook_result_comments
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='playbook_result_comments' AND policyname='Org members can insert comments') THEN
    CREATE POLICY "Org members can insert comments" ON playbook_result_comments
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMIT;
