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

## F) Wave 1 Apps Closure

Wave 1 is not closed until the HR, recruiting, and collaboration app workspaces all pass.

### 1. Canonical Catalog

1. Search `google workspace`, `microsoft 365`, `zoho people`, `zoho learn`, `zoho recruit`, and `naukri`.
2. Verify:
   - only one card appears per app
   - no duplicate OAuth/direct cards
   - primary setup path is correct for the app family

### 2. Connect / Disconnect / Test

1. Connect:
   - `Google Workspace`
   - `Microsoft 365`
   - one Zoho HR app
   - one recruiting app
2. Verify:
   - no `404`
   - app appears once in `My Apps`
   - reload preserves connected state
3. Disconnect one connected app and verify:
   - it disappears from `My Apps`
   - connected counts update
   - reload does not show it as connected again
4. Click `Test All` and verify:
   - no raw `404` or `501`
   - unsupported apps skip cleanly
   - health counts update correctly

### 3. Workspace Routing

1. Open `Google Workspace` and verify `Collaboration Workspace` loads.
2. Open `Microsoft 365` and verify `Collaboration Workspace` loads.
3. Open `Zoho People` and `Zoho Learn` and verify `HR Workspace` loads.
4. Open `Zoho Recruit` and `Naukri` and verify `Hiring Workspace` loads.

### 4. Workspace Behavior

1. Collaboration Workspace:
   - profile/account context loads
   - event preview loads when scope allows
   - fallback note appears when current scopes are too narrow
2. HR Workspace:
   - leave, attendance, payroll, and headcount views load
   - leave approve/reject works if data exists
3. Hiring Workspace:
   - jobs list loads
   - applications load for selected job
   - score / shortlist / reject actions work without breaking the UI

### 5. Linked Agents + HITL

1. Open `Linked Agents` for a Wave 1 app and verify:
   - linked agents load
   - linking/unlinking updates state correctly
2. Open `HITL Approvals`, use `Simulate Agent Write Action`, and verify:
   - pending approval appears
   - `Approve` resumes execution
   - `Reject` blocks execution
   - execution history updates for both

### 6. Wave 1 Close Rule

Wave 1 is closed only if all are true:

1. All six Wave 1 apps pass canonical catalog checks.
2. Connect, disconnect, and test paths pass without `404`/`501` errors.
3. Workspace routing is correct:
   - collaboration apps do not open HR views
   - HR apps do not open recruiting views
   - recruiting apps do not open collaboration views
4. HITL approve/reject passes end-to-end.
5. No duplicate cards or alias bugs reappear after reload.
