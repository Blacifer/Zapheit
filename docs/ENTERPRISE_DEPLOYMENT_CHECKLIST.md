# Enterprise / On‑Prem Deployment Checklist (Zapheit)

Zapheit can be deployed as SaaS or into a company-managed environment. Today, both the frontend and API assume **Supabase** (Auth + PostgREST + Postgres), so an enterprise deployment requires either:

- Supabase Cloud (customer-owned project), or
- Supabase Self‑Hosted (customer infrastructure).

## Deployment Models

- **SaaS (recommended for fastest rollout):** Vercel (frontend) + Railway (API) + Supabase (DB/auth).
- **Customer-managed cloud:** Docker/Kubernetes for API + frontend, Supabase Cloud or self-hosted.
- **On‑prem:** Docker/Kubernetes for API + frontend, Supabase self-hosted within the customer network.

## Technical Requirements

- **Supabase:** URL + anon key + service role key + JWT secret.
- **API:** `FRONTEND_URL` configured (CORS), TLS termination at a reverse proxy/load balancer, outbound access to AI providers (if used).
- **Frontend:** runtime-config supported via `public/runtime-config.js` (so customers can change endpoints without rebuilding).

## Security & Compliance

- Secrets stored in a secret manager (not `.env` committed to git).
- TLS everywhere; HSTS at the edge; strict CORS (`FRONTEND_URL` allowlist, no `*` with credentials).
- RBAC + audit logs enabled; retention policy documented and enforced.
- Data export + incident response playbook shared with customer security.

## Operations (What Enterprises Expect)

- Backups + restore procedure tested (RPO/RTO agreed).
- Monitoring/alerting: `/health`, logs, and OpenTelemetry exporter configured.
- Upgrade path: database migrations + blue/green or rolling deploy plan.
- Runbooks: deploy/rollback, schema verification, and access provisioning.

## Quick Self‑Host (API + Frontend)

1. Create `deploy/compose/control-plane.env` from `deploy/compose/control-plane.env.example`
2. Run:
   - `docker compose -f deploy/compose/control-plane.yml up --build`
3. Open:
   - Frontend: `http://localhost:8080`
   - API health: `http://localhost:3001/health`

