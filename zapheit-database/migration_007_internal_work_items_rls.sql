-- Database Migration: RLS for Internal Work Items (Support/Sales/IT)
-- Version: 1.0.0
-- Created: 2026-03-11
-- Description: Enable Row Level Security policies for internal work item tables.
--
-- Safe to run multiple times (policy existence checks).

BEGIN;

-- Enable RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_access_requests ENABLE ROW LEVEL SECURITY;

-- Support tickets: org members can read/insert/update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'Org members can view support tickets'
  ) THEN
    CREATE POLICY "Org members can view support tickets" ON support_tickets
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'Org members can insert support tickets'
  ) THEN
    CREATE POLICY "Org members can insert support tickets" ON support_tickets
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'Org members can update support tickets'
  ) THEN
    CREATE POLICY "Org members can update support tickets" ON support_tickets
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- Sales leads: org members can read/insert/update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_leads' AND policyname = 'Org members can view sales leads'
  ) THEN
    CREATE POLICY "Org members can view sales leads" ON sales_leads
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_leads' AND policyname = 'Org members can insert sales leads'
  ) THEN
    CREATE POLICY "Org members can insert sales leads" ON sales_leads
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sales_leads' AND policyname = 'Org members can update sales leads'
  ) THEN
    CREATE POLICY "Org members can update sales leads" ON sales_leads
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

-- IT access requests: org members can read/insert/update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'it_access_requests' AND policyname = 'Org members can view access requests'
  ) THEN
    CREATE POLICY "Org members can view access requests" ON it_access_requests
      FOR SELECT USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'it_access_requests' AND policyname = 'Org members can insert access requests'
  ) THEN
    CREATE POLICY "Org members can insert access requests" ON it_access_requests
      FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'it_access_requests' AND policyname = 'Org members can update access requests'
  ) THEN
    CREATE POLICY "Org members can update access requests" ON it_access_requests
      FOR UPDATE USING (organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid()));
  END IF;
END $$;

COMMIT;

