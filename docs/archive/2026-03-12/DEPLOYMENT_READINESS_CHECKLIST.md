# Deployment Readiness Checklist

This checklist is for the current SyntheticHR stack:

- `/synthetic-hr` frontend
- `/synthetic-hr-api` backend
- Supabase/Postgres database
- Optional RASI gateway and observability stack

## Current status summary

| Area | Status | Notes |
|---|---|---|
| Frontend build | Ready | `npm run build` passes |
| Backend structure | Ready | Express API with auth, RBAC, costs, API keys, gateway, connectors |
| Database dependency | Blocked until verified | Schema deployment is required before live API flows work |
| Usage accuracy | Partial | Accurate for RASI-observed traffic, not provider-wide billing by default |
| Security hygiene | Needs refinement | Local scripts previously contained hardcoded Supabase credentials |
| Operator documentation | Improved | Frontend README replaced, checklist added |

## 1. Environment and secrets

- [ ] `SUPABASE_URL` is set for backend scripts and API
- [ ] `SUPABASE_ANON_KEY` is set for frontend and test clients
- [ ] `SUPABASE_SERVICE_KEY` is server-only and never exposed to the frontend
- [ ] `JWT_SECRET` is set in backend runtime
- [ ] `FRONTEND_URL` is configured in backend production env
- [ ] `API_URL` is configured in backend production env
- [ ] At least one runtime provider key is configured for the gateway:
  - `RASI_OPENROUTER_API_KEY` (recommended, can route many models), or
  - `RASI_OPENAI_API_KEY`, `RASI_ANTHROPIC_API_KEY`
- [ ] If using provider reconciliation sync, admin keys are configured server-side:
  - `RASI_OPENAI_ADMIN_KEY`, `RASI_ANTHROPIC_ADMIN_KEY`, `RASI_OPENROUTER_ADMIN_KEY` as needed
- [ ] `VITE_SUPABASE_URL` is configured in frontend env
- [ ] `VITE_SUPABASE_ANON_KEY` is configured in frontend env
- [ ] `VITE_API_URL` is configured in frontend env
- [ ] `VITE_DEMO_MODE_ENABLED=false` in production frontend env (demo mode is dev-only by default)
- [ ] Any previously exposed Supabase keys have been rotated
- [ ] Any API keys accidentally shared in logs/chat have been revoked and rotated

## 2. Database readiness

- [ ] Run the schema from `/synthetic-hr-database/migration_001_core_schema.sql`
- [ ] Verify required tables exist
- [ ] Confirm org-scoped data can be read and written
- [ ] Confirm API keys table exists
- [ ] Confirm gateway idempotency table exists
- [ ] Confirm audit logs table exists
- [ ] Confirm cost tracking table exists
- [ ] Create or verify at least one organization and user
- [ ] Take a backup before production migration

## 3. Backend readiness

- [ ] `cd synthetic-hr-api && npm run build`
- [ ] Start API with real env vars
- [ ] Confirm `/health` returns healthy or degraded with actionable dependency details
- [ ] Confirm auth flow works with Supabase session tokens
- [ ] If the demo user exists, ensure it has a valid `organization_id` in the `users` table
- [ ] Confirm org scoping is enforced on agents, incidents, costs, and API keys
- [ ] Confirm CORS uses real frontend origin values in production
- [ ] Confirm write endpoints require RBAC where expected

## 4. Frontend readiness

- [ ] `cd synthetic-hr && npm run build`
- [ ] Sign-in works against the intended Supabase project
- [ ] Dashboard loads without demo-only assumptions
- [ ] `Fleet`, `Incidents`, `Black Box`, `Conversations`, `API Keys`, `Usage`, `Limits`, `Costs`, and `Pricing` open correctly
- [ ] `Getting Started` and `Connect Agent` are visible and usable as setup flows
- [ ] Empty states are honest when no org data exists
- [ ] Error states are visible when backend endpoints fail

## 5. Accuracy and telemetry

- [ ] At least one real request passes through the RASI path
- [ ] That request creates or updates tracked data for the correct organization
- [ ] API key `last_used` changes when a RASI key is used
- [ ] API key usage counts increase on the `Usage` page
- [ ] Cost records appear in `Costs`
- [ ] `Coverage` shows `Gateway observed: Yes` and `Last tracked endpoint/model`
- [ ] Traffic outside RASI is explicitly treated as uncovered
- [ ] Customer-facing copy does not imply provider-wide billing sync unless it exists

## 6. Customer deployment model

Choose one before go-live:

- [ ] RASI-hosted SaaS
- [ ] Customer-hosted backend + database
- [ ] Hybrid

Then confirm:

- [ ] Where the backend runs
- [ ] Where the database runs
- [ ] How secrets are stored
- [ ] How inbound/outbound network access works
- [ ] Whether the RASI gateway is mandatory for tracked traffic

## 7. Final go-live test

- [ ] Create a new organization
- [ ] Create or invite a real user
- [ ] Sign in from the frontend
- [ ] Create a RASI API key
- [ ] Send one tracked request through the RASI path
- [ ] Confirm usage appears on the `Usage` page
- [ ] Confirm spend appears on the `Costs` page
- [ ] Confirm only that organization can see the new data

## 8. Repeatable verification commands

Use these only after env files are configured for the intended project.

- [ ] Bootstrap a real operator account and organization mapping:
  - `OPERATOR_EMAIL=<email> OPERATOR_NAME=<name> OPERATOR_PASSWORD=<password> ORG_NAME=<org-name> ORG_SLUG=<org-slug> node /Users/patty/Downloads/RasiSyntheticHR/bootstrap-operator.js`
- [ ] Repair the demo user org assignment when local seed data is stale:
  - `ORG_SLUG=<your-org-slug> node /Users/patty/Downloads/RasiSyntheticHR/setup-demo-user.js`
- [ ] Run the lightweight auth + agents probe:
  - `DEMO_PASSWORD=<demo-password> node /Users/patty/Downloads/RasiSyntheticHR/test-api.js`
- [ ] Run the full end-to-end REST smoke test:
  - `DEMO_PASSWORD=<demo-password> node /Users/patty/Downloads/RasiSyntheticHR/test-rest-smoke.js`
- [ ] Run the gateway-observed traffic smoke test:
  - `DEMO_PASSWORD=<demo-password> RUN_GATEWAY_SMOKE=1 node /Users/patty/Downloads/RasiSyntheticHR/test-rest-smoke.js`
- [ ] Keep cleanup enabled by default so smoke runs do not leave extra agents/incidents/API keys
  - Set `CLEANUP=0` only if you explicitly need to inspect smoke-created records afterward
- [ ] Verify the smoke test passes before calling the stack deployment-ready

## Recommended immediate next actions

1. Bootstrap a real operator account for the target organization instead of relying on the demo user.
2. Verify the database schema is deployed in the intended Supabase project.
3. Run the backend with production-like environment variables.
4. Send one real request through the RASI path and confirm it reaches `Usage` and `Costs`.
5. Rotate any Supabase keys that were previously committed or shared in local scripts.
