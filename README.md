# Rasi-Synthetic-HR (SyntheticHR)

Rasi-Synthetic-HR is an **AI Agent control plane**: define **Playbooks**, route runs through **Jobs & Approvals**, execute via a **Runtime**, and keep an **audit trail**.

## Services

- Frontend dashboard: `./synthetic-hr` (Vercel)
- Backend API: `./synthetic-hr-api` (Railway)
- Runtime worker: `./synthetic-hr-runtime` (your compute / container)
- Database & migrations: `./synthetic-hr-database` (Supabase / Postgres)

## Key docs

- Documentation index: `./DOCUMENTATION_INDEX.md`
- Org rollout (agents): `./ORGANIZATION_AGENT_ROLLOUT.md`
- Internal connectors (Support/Sales/IT): `./INTERNAL_CONNECTORS_SUPPORT_SALES_IT.md`

## Quick start (local)

- Frontend: see `./synthetic-hr/README.md`
- Database: `./synthetic-hr-database/DEPLOYMENT_GUIDE.md`

## Archive

Older planning/status docs were moved to `./docs/archive/` to keep the repo root clean.

