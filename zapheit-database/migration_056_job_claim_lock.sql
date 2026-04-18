-- migration_056_job_claim_lock.sql
--
-- Adds at-least-once job delivery to agent_jobs.
--
-- Problem: runtimes poll for queued jobs then mark them running in two separate
-- DB calls. A runtime crash between those calls leaves jobs stranded as
-- "running" forever. Concurrent runtimes can also pick up the same job.
--
-- Solution: claim lock columns that allow:
--   1. Atomic SELECT + claim in a single UPDATE...RETURNING
--   2. Job reaper to return stale claimed jobs to the queue

DO $$ BEGIN

  -- Add claimed_by: which runtime instance has this job claimed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_jobs' AND column_name = 'claimed_by'
  ) THEN
    ALTER TABLE agent_jobs ADD COLUMN claimed_by TEXT;
  END IF;

  -- Add claimed_at: when the claim was made (used to detect stale claims)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_jobs' AND column_name = 'claimed_at'
  ) THEN
    ALTER TABLE agent_jobs ADD COLUMN claimed_at TIMESTAMPTZ;
  END IF;

END $$;

-- Index for the reaper query (jobs claimed but not completed for too long)
CREATE INDEX IF NOT EXISTS idx_agent_jobs_stale_claim
  ON agent_jobs (claimed_at)
  WHERE status = 'running' AND claimed_at IS NOT NULL;

-- Index for efficient poll query
CREATE INDEX IF NOT EXISTS idx_agent_jobs_poll
  ON agent_jobs (organization_id, runtime_instance_id, status, created_at)
  WHERE status = 'queued';

COMMENT ON COLUMN agent_jobs.claimed_by IS 'Runtime instance ID that claimed this job. NULL = unclaimed.';
COMMENT ON COLUMN agent_jobs.claimed_at IS 'Timestamp when the job was claimed. Used by reaper to return stale claims.';
