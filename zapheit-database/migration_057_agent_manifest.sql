-- migration_057_agent_manifest.sql
--
-- Adds a structured manifest JSONB column to ai_agents.
-- The manifest is the agent's "employment file" — declared capabilities,
-- SLO targets, owner, environment, and review cadence.
--
-- Schema of the manifest JSON:
-- {
--   capabilities: string[],                      e.g. ["email_drafting", "ticket_routing"]
--   slo_targets: {
--     uptime_pct: number,                         e.g. 99.5  (target uptime %)
--     max_latency_ms: number,                     e.g. 3000
--     min_satisfaction: number,                   e.g. 85    (CSAT target 0-100)
--     max_cost_per_request_usd: number,           e.g. 0.05
--   },
--   tags: string[],                               free-form labels
--   owner_email: string,                          responsible person
--   deployment_environment: 'production'|'staging'|'sandbox',
--   review_cadence: 'weekly'|'monthly'|'quarterly'|'none',
--   notes: string                                 free-form text
-- }

DO $$ BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_agents' AND column_name = 'manifest'
  ) THEN
    ALTER TABLE ai_agents ADD COLUMN manifest JSONB;
  END IF;

END $$;

COMMENT ON COLUMN ai_agents.manifest IS
  'Structured agent identity card: capabilities, SLO targets, owner, environment, review cadence.';
