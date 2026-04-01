# Rasi-Synthetic-HR (SyntheticHR)

Rasi-Synthetic-HR is an **AI Agent control plane**: define **Playbooks**, route runs through **Jobs & Approvals**, execute via a **Runtime**, and keep an **audit trail**.

## Services

- Frontend dashboard: `./synthetic-hr` (Vercel)
- Backend API: `./synthetic-hr-api` (Railway)
- Runtime worker: `./synthetic-hr-runtime` (your compute / container)
- Database & migrations: `./synthetic-hr-database` (Supabase / Postgres)

## Key docs

- Documentation index: [`docs/DOCUMENTATION_INDEX.md`](docs/DOCUMENTATION_INDEX.md)
- Org rollout (agents): [`docs/ORGANIZATION_AGENT_ROLLOUT.md`](docs/ORGANIZATION_AGENT_ROLLOUT.md)
- Internal connectors (Support/Sales/IT): [`docs/INTERNAL_CONNECTORS_SUPPORT_SALES_IT.md`](docs/INTERNAL_CONNECTORS_SUPPORT_SALES_IT.md)

## Quick start (local)

- Frontend: see `./synthetic-hr/README.md`
- Database: `./synthetic-hr-database/DEPLOYMENT_GUIDE.md`

## Self-host / enterprise

- Deployment guide: [`docs/DEPLOYMENT_QUICK_REFERENCE.md`](docs/DEPLOYMENT_QUICK_REFERENCE.md)
- Enterprise checklist: [`docs/ENTERPRISE_DEPLOYMENT_CHECKLIST.md`](docs/ENTERPRISE_DEPLOYMENT_CHECKLIST.md)
- Docker Compose (all services): `docker compose -f deploy/compose/docker-compose.yml --env-file deploy/compose/stack.env up -d`
- Note: deployments still require a Supabase instance (cloud or self-hosted) for auth + PostgREST.

## Archive

Older planning/status docs are in [`docs/archive/`](docs/archive/).
