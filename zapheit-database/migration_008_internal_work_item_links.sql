-- Database Migration: Link Work Items to Jobs and Action Runs
-- Version: 1.0.0
-- Created: 2026-03-11
-- Description: Add (job_id, action_run_id) foreign keys for traceability.

BEGIN;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_run_id UUID REFERENCES agent_action_runs(id) ON DELETE SET NULL;

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_run_id UUID REFERENCES agent_action_runs(id) ON DELETE SET NULL;

ALTER TABLE it_access_requests
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_run_id UUID REFERENCES agent_action_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_job_id ON support_tickets(job_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_action_run_id ON support_tickets(action_run_id);

CREATE INDEX IF NOT EXISTS idx_sales_leads_job_id ON sales_leads(job_id);
CREATE INDEX IF NOT EXISTS idx_sales_leads_action_run_id ON sales_leads(action_run_id);

CREATE INDEX IF NOT EXISTS idx_it_access_requests_job_id ON it_access_requests(job_id);
CREATE INDEX IF NOT EXISTS idx_it_access_requests_action_run_id ON it_access_requests(action_run_id);

COMMIT;

