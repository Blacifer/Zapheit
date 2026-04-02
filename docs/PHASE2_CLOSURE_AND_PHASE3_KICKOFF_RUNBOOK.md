# Phase 2 Closure And Phase 3 Kickoff Runbook

This runbook is the locked execution path for closing Phase 2 and starting Phase 3 safely.

## 1) Production Hardening Completion

1. Apply database backfill in staging and production:
   - `synthetic-hr-database/migration_041_connector_action_execution_governance_backfill.sql`
2. Verify `connector_action_executions` columns exist:
   - `requested_by`
   - `policy_snapshot`
   - `before_state`
   - `after_state`
   - `remediation`
3. Set API envs:
   - `SCHEMA_COMPAT_STRICT_OPTIONAL=true`
   - `CORS_ALLOWED_ORIGINS=https://rasi-synthetic-hr.vercel.app`
4. Restart API and confirm startup does not fail schema compatibility checks.

## 2) Mandatory Build + Contract Gates

Run these on the release candidate commit:

1. API build:
```bash
cd synthetic-hr-api
pnpm build
```
2. Frontend build:
```bash
cd synthetic-hr
pnpm run build
```
3. Contracts in production-like env:
```bash
cd synthetic-hr-api
SCHEMA_COMPAT_STRICT_OPTIONAL=true pnpm run check:contracts
```

Exit condition: all three pass.

## 3) Reliability Behavior Dry Run (Staging)

Execute one outage + recovery scenario per service class used in production.

1. Outage simulation:
   - Force connector/provider failure responses.
   - Trigger governed action write.
   - Verify state transitions include:
     - `queued_for_retry` and/or `paused_by_circuit_breaker`
2. Recovery simulation:
   - Restore provider behavior after breaker window.
   - Verify transitions include:
     - `recovered`
     - eventually `ok` on healthy follow-up executions
3. Duplicate-write regression:
   - Replay identical write fingerprint/idempotency key.
   - Verify second outbound write is not executed.

Evidence to capture:
- Governed actions payload snippets
- Connector execution history rows
- Retry queue and breaker state snapshots

## 4) Operator Workflow Acceptance

Validate on desktop and mobile:

1. One-screen triage clarity:
   - What happened
   - What needs attention
   - What to do next
2. Distinction remains explicit:
   - governance block vs reliability degradation
3. Deep links from governed actions are stable:
   - Approvals
   - Apps
   - Run history
4. Reason copy standard:
   - one primary “Cannot proceed because …” line
   - one “Next step …” line

Exit condition: all items pass without route regressions.

## 5) Phase 3 Kickoff Contract

Phase 3 starts only after sections 1-4 pass.

Normalized reason fields are optional and backward-compatible:
- `reason_category`
- `reason_message`
- `recommended_next_action`

Allowed categories:
- `policy_blocked`
- `approval_required`
- `reliability_degraded`
- `execution_failed`
