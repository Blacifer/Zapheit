# Phase 2 + Phase 3 Full System Test Checklist

Use this after frontend and API production deploys are complete.

## Preconditions

1. Frontend deploy includes latest `main`.
2. API deploy includes latest `main`.
3. Environment confirms:
   - `SCHEMA_COMPAT_STRICT_OPTIONAL=true`
   - `CORS_ALLOWED_ORIGINS=https://rasi-synthetic-hr.vercel.app`
4. Migration 041 is applied in production.

## A) Core Route Health

1. Open:
   - `/dashboard/overview`
   - `/dashboard/agents`
   - `/dashboard/incidents`
   - `/dashboard/apps`
   - `/dashboard/settings`
2. Verify no blocking console errors and no CORS failures.

## B) Incident Workflow (Production Persistence)

1. In `/dashboard/incidents`, click `Investigate` on an open incident.
2. Verify:
   - incident status changes to `investigating`
   - incident detail drawer opens immediately
3. Change owner and notes in drawer.
4. Refresh page and verify status/owner/notes persist.
5. Resolve incident and confirm:
   - critical incidents require notes
   - resolved status persists after refresh
6. Bulk test:
   - select multiple incidents
   - `Bulk investigate`, refresh, confirm persisted
   - `Bulk resolve`, refresh, confirm persisted
   - `Delete selected`, refresh, confirm deleted

## C) Governed Actions + Approvals + Apps Consistency

1. Open `/dashboard/governed-actions`.
2. Verify each blocked/degraded/pending item shows:
   - `Cannot proceed because ...`
   - `Next step: ...`
3. Follow deep links from governed action cards:
   - to `Approvals`
   - to `Apps` history
   - to `Jobs`
4. In `Approvals`, verify same reason pattern appears in queue and history cards.
5. In `Apps` history drawer, verify same reason pattern appears on execution items.

## D) Reliability Lifecycle Validation

1. Trigger connector outage case.
2. Verify governed action reliability fields show:
   - `queued_for_retry` or `paused_by_circuit_breaker`
3. Restore connector and verify state transitions to:
   - `recovered`
   - then `ok` for healthy follow-up runs
4. Replay same write fingerprint/idempotency key and verify no duplicate outbound write.

## E) Exit Gate Criteria

Phase 2 + early Phase 3 are accepted only if all are true:

1. Build gates pass:
   - `synthetic-hr-api`: `pnpm build`
   - `synthetic-hr`: `pnpm run build`
2. Contract gate passes in production-like env:
   - `SCHEMA_COMPAT_STRICT_OPTIONAL=true pnpm run check:contracts`
3. Incident workflows persist to backend (not UI-only).
4. Reason model and copy are consistent across Governed Actions, Approvals, and Apps History.
5. Deep links and operator actions are stable on desktop and mobile.
