# Zapheit Dashboard

Frontend for the Zapheit AI agent governance platform (React + TypeScript + Vite).

## What this app does

- Shows organization-scoped fleet, incidents, conversations, API keys, usage, and cost views
- Authenticates users with Supabase
- Calls the backend API at `VITE_API_URL`
- Displays Zapheit-observed usage and runtime spend, not provider-wide billing totals

## Requirements

- Node.js 20+
- `pnpm`
- A running backend API from `/zapheit-api`
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

Default local frontend URL: `http://localhost:5173`

## Production build

```bash
pnpm build
pnpm preview
```

## Operational notes

- Usage shown in **API Keys → Usage** is based on Zapheit-observed API-key traffic.
- Spend shown in **Costs** is based on provider usage observed through Zapheit.
- Provider dashboards may show higher totals if traffic bypasses the Zapheit gateway or tracked connectors.

## Related services

- Frontend: `/zapheit`
- Backend API: `/zapheit-api`
- Database schema and migration guide: `/zapheit-database`

## Deployment

1. Deploy database schema from `/zapheit-database/DEPLOYMENT_GUIDE.md`
2. Configure and start the backend API
3. Set frontend environment variables
4. Build and deploy to Vercel (see root `vercel.json`)
5. Verify sign-in, org scoping, and one tracked request through Zapheit

## Runtime config override

Production deployments can override frontend configuration **at runtime** (no rebuild) via `public/runtime-config.js`.
When using Docker, set `ZAPHEIT_API_URL`, `ZAPHEIT_SUPABASE_URL`, and `ZAPHEIT_SUPABASE_ANON_KEY` on the container.
