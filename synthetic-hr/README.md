# SyntheticHR Frontend

SyntheticHR is the dashboard frontend for the RASI governance and operations platform.

## What this app does

- Shows organization-scoped fleet, incidents, conversations, black box, API key, usage, and cost views
- Authenticates users with Supabase
- Calls the backend API defined by `VITE_API_URL`
- Displays RASI-observed usage and runtime spend, not provider-wide billing totals

## Requirements

- Node.js 20+
- `pnpm`
- A running backend API from `/synthetic-hr-api`
- Supabase project configured for auth and multi-tenant data access

## Required environment variables

Create a local `.env` file or equivalent runtime configuration with:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_API_URL=http://localhost:3001/api
```

Production builds require all three values.

## Local development

```bash
pnpm install
pnpm dev
```

Default local frontend URL:

- `http://localhost:5173`

## Production build

```bash
pnpm build
pnpm preview
```

## Operational notes

- Usage shown in `API Keys -> Usage` is based on RASI-observed API-key traffic.
- Spend shown in `Costs` is based on provider usage observed through RASI.
- Provider dashboards may show higher totals if traffic bypasses the RASI gateway or tracked connectors.
- SyntheticHR subscription pricing should be presented separately from provider runtime spend.

## Related services

- Frontend: `/synthetic-hr`
- Backend API: `/synthetic-hr-api`
- Database schema and migration guide: `/synthetic-hr-database`

## Deployment sequence

1. Deploy database schema from `/synthetic-hr-database/DEPLOYMENT_GUIDE.md`
2. Configure and start the backend API
3. Set frontend environment variables
4. Build and host the frontend
5. Verify sign-in, org scoping, and one tracked request through RASI
