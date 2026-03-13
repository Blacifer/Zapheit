# SyntheticHR API

Backend control-plane API for SyntheticHR (Express + TypeScript).

## Requirements

- Node.js 20+
- A Supabase project (hosted or self-hosted) for Auth + PostgREST + Postgres

## Environment

Copy the template and fill values:

```bash
cp .env.example .env.local
```

Required (all environments):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`

Required in production (`NODE_ENV=production`):

- `FRONTEND_URL` (for CORS)
- `API_URL`
- `EMAIL_FROM`
- `ALERT_EMAIL_TO`
- plus email provider config (`RESEND_API_KEY` or `EMAIL_WEBHOOK_URL`)

## Run locally

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3001/health
```

## Docker

Build:

```bash
docker build -t synthetic-hr-api .
```

Run (expects your env file):

```bash
docker run --rm -p 3001:3001 --env-file .env.local synthetic-hr-api
```

## Docker Compose (API + Frontend)

From repo root:

```bash
cp deploy/compose/control-plane.env.example deploy/compose/control-plane.env
docker compose -f deploy/compose/control-plane.yml up --build
```

