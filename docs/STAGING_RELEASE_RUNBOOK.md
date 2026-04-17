# Staging Release Runbook

Use this runbook when preparing a Zapheit release candidate for production proof.

This repo currently ships production-named GCP services by default:

- `synthetic-hr-api`
- `synthetic-hr-runtime`

Do not use those services for staging validation. Create or use separate staging targets:

- `synthetic-hr-api-staging`
- `synthetic-hr-runtime-staging`
- a Vercel preview or dedicated staging frontend URL

## 1. Staging prerequisites

Confirm all of the following before running the full release gate:

- Supabase staging has the latest schema, including `migration_060_chat_runtime_profiles.sql`
- a demo/operator user exists in staging auth
- staging backend secrets are separated from production secrets
- staging frontend points to staging backend and staging Supabase
- runtime credentials used by staging are not the production runtime credentials

## 2. Backend staging targets

If staging Cloud Run services do not exist yet, create them as separate services instead of reusing production:

- `synthetic-hr-api-staging`
- `synthetic-hr-runtime-staging`

Recommended repo-supported deploy command:

```bash
export PROJECT_ID="<your-staging-gcp-project>"
export REGION="asia-south1"
bash deploy/gcp/deploy-staging.sh
```

This wrapper defaults to:

- `DEPLOY_ENV=staging`
- `SERVICE_SUFFIX=-staging`
- `SECRET_SUFFIX=_STAGING`
- `BUILD_SA_NAME=cloudbuild-deployer-staging`

Recommended staging env separation:

- `FRONTEND_URL` -> staging frontend URL
- `API_URL` -> staging API URL
- `CORS_ALLOWED_ORIGINS` -> staging frontend URL
- runtime enrollment/API key/runtime ID -> staging-specific values

If staging shares the same GCP project as production, the `_STAGING` secret suffix is required to avoid collisions with production secrets.

Do not point staging runtime to the production control plane.

## 3. Frontend staging target

Use a Vercel preview deployment or a dedicated staging project.

Frontend config must resolve to staging values for:

- `VITE_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If using runtime config, verify `public/runtime-config.js` is overridden correctly for staging.

## 4. Full automated gate

From the repo root:

```bash
npm run production:gate:full
```

Required environment values:

```bash
export API_URL="https://<staging-api-host>"
export E2E_BASE_URL="https://<staging-frontend-host>"
export E2E_DEMO_EMAIL="demo@your-staging-domain"
export E2E_DEMO_PASSWORD="..."
export SUPABASE_URL="https://<staging-project>.supabase.co"
export SUPABASE_ANON_KEY="..."
```

Optional:

```bash
export E2E_CHAT_PROVIDER_KEY="..."
export E2E_CHAT_PROVIDER="openrouter"
```

The gate is not complete until all of these pass:

- frontend build
- API build
- runtime build
- workflow route tests
- REST smoke
- frontend smoke

## 5. Manual go/no-go proof

After the automated gate passes, manually prove all three flows:

1. `Apps -> policy -> approval -> execution -> audit -> cost`
2. `Chat -> policy -> approval -> execution -> audit -> cost`
3. `Templates -> policy -> approval -> execution -> audit -> cost`

For each flow, verify:

- correct `source`
- visible lifecycle states
- approval linkage
- audit linkage
- cost state
- incident linkage when failure is triggered

## 6. Release criteria

The release candidate is acceptable only if:

- staging backend and frontend are isolated from production
- `npm run production:gate:full` passes
- Apps, Chat, and Templates manual flows pass
- no launch-facing legacy branding remains
- rollback and incident drill notes are current
