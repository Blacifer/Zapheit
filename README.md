# Zapheit

**Zapheit** is an AI Agent control plane for enterprises. Connect your AI agents, govern every action, track costs, and keep a complete audit trail — all in one place.

## What it does

- **Fleet management** — register and monitor all your AI agents in one dashboard
- **Governance** — set policies that auto-approve, require human sign-off, or block agent actions
- **Integrations** — agents can act on Google Workspace, Slack, Jira, and more through a governed connector layer
- **Cost tracking** — per-agent LLM spend across OpenAI, Anthropic, and OpenRouter
- **Incident detection** — automatic flagging of PII leakage and hallucinations
- **Playbooks** — define multi-step automation workflows agents can execute

## Services

| Service | Folder | Hosting |
|---|---|---|
| Frontend dashboard | `./synthetic-hr` | Vercel |
| Backend API | `./synthetic-hr-api` | GCP Cloud Run |
| Runtime worker | `./synthetic-hr-runtime` | GCP Cloud Run |
| Database & migrations | `./synthetic-hr-database` | Supabase (PostgreSQL) |

## Quick start (local)

```bash
# Frontend
cd synthetic-hr && pnpm install && pnpm dev

# Backend API
cd synthetic-hr-api && npm install && npm run dev

# Runtime worker
cd synthetic-hr-runtime && npm install && npm run dev
```

See `synthetic-hr/README.md` and `synthetic-hr-database/DEPLOYMENT_GUIDE.md` for full setup.

## Production gate

From the repository root:

```bash
npm run production:gate
```

This validates the required production builds for frontend, API, and runtime. For the release checklist and the manual governed workflow gate, use [`docs/PRODUCTION_READINESS_RUNBOOK.md`](docs/PRODUCTION_READINESS_RUNBOOK.md).

## Self-host / deploy to GCP

```bash
# First-time GCP setup
bash deploy/gcp/deploy.sh
```

- GCP deployment guide: [`deploy/gcp/README.md`](deploy/gcp/README.md)
- Deployment quick reference: [`docs/DEPLOYMENT_QUICK_REFERENCE.md`](docs/DEPLOYMENT_QUICK_REFERENCE.md)
- Enterprise checklist: [`docs/ENTERPRISE_DEPLOYMENT_CHECKLIST.md`](docs/ENTERPRISE_DEPLOYMENT_CHECKLIST.md)
- Docker Compose (local all-in-one): `docker compose -f deploy/compose/docker-compose.yml --env-file deploy/compose/stack.env up -d`

> Supabase is required for auth and the database regardless of where the API runs.

## Company

Built by **Rasi Cyber Solutions Private Limited**.
