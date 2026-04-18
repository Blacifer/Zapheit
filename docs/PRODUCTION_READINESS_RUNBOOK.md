# Production Readiness Runbook

Use this before any Zapheit production rollout. This runbook is the release gate for the current launch scope:

- `Apps`
- `Agents`
- `Chat`
- `Templates`
- `Policies`
- `Approvals`
- `Incidents`
- `Audit`
- `Costs`

## 1. Automated Gate

Run the baseline production gate from the repository root:

```bash
npm run production:gate
```

This must pass:

- frontend production build
- API production build
- runtime production build

For a deeper pre-release pass, run:

```bash
npm run production:gate:full
```

This additionally attempts:

- workflow route tests
- REST smoke test against a live environment
- frontend smoke test

Notes:

- `production:gate:full` requires a runnable environment for smoke coverage.
- `smoke:rest` depends on `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `DEMO_PASSWORD`.
- frontend smoke can run either locally or against a deployed environment by setting `E2E_BASE_URL`.
- authenticated chat smoke depends on `E2E_DEMO_EMAIL` or `DEMO_EMAIL`, plus `E2E_DEMO_PASSWORD` or `DEMO_PASSWORD`.
- optional runtime-profile creation smoke depends on `E2E_CHAT_PROVIDER_KEY` and optionally `E2E_CHAT_PROVIDER`.
- `smoke:rest` now validates governed entry-path creation for `Chat`, template-backed chat, runtime deployment wiring, and the connector-action approval path. It does not replace a live runtime completion check.

## 2. Manual Go/No-Go Workflow Checks

Zapheit is not production-ready unless these three flows work end-to-end with the same lifecycle semantics.

### Apps Flow

1. Open `/dashboard/apps`.
2. Choose a connected app or complete one app connection.
3. Trigger governed work that requires policy evaluation.
4. Confirm the action enters `pending_approval` when policy requires review.
5. Approve the action from the approvals queue.
6. Verify execution reaches `completed` or `failed` deterministically.
7. Verify the resulting run shows:
   - source: `apps`
   - approval status
   - audit reference
   - `Zapheit-observed cost` state
   - incident reference when a failure path is triggered

### Chat Flow

1. Open `/dashboard/chat`.
2. Start governed work from chat.
3. Confirm policy outcome is visible.
4. If approval is required, approve it from the approvals queue.
5. Verify the resulting run shows:
   - source: `chat`
   - matching workflow status language in chat, approvals, and governed actions
   - audit and cost linkage

### Templates Flow

1. Open `/dashboard/agent-studio`.
2. Launch a promoted template that performs governed work.
3. Confirm the template run enters the same approval and execution lifecycle.
4. Verify the resulting run shows:
   - source: `template`
   - approval linkage
   - execution outcome
   - audit and cost linkage

## 3. Status Model

All core entry points must use the same lifecycle:

- `initiated`
- `policy_evaluated`
- `pending_approval`
- `approved`
- `denied`
- `executing`
- `completed`
- `failed`
- `cancelled`

If one surface uses different language or hides a state transition, the release is not ready.

## 4. Trust And Product Integrity Checks

Before release, verify:

- no customer-facing launch surface shows legacy `Rasi` / `Zapheit` branding
- no launch-facing page overclaims unsupported maturity
- weaker modules are explicitly labeled `Beta` or `Preview`
- `Apps`, `Chat`, and `Templates` all route into the same governed workflow model
- cost wording consistently uses `Zapheit-observed cost`

## 5. Operations Readiness

Before production rollout, verify:

- health endpoint responds successfully
- deployment and rollback steps are current
- incident response contacts and channels are current
- one rollback drill has been rehearsed
- one incident drill has been rehearsed

Related docs:

- `docs/DEPLOYMENT_QUICK_REFERENCE.md`
- `docs/INCIDENT_RESPONSE_PLAYBOOK.md`
- `docs/SLO_DEFINITIONS.md`
- `docs/STAGING_RELEASE_RUNBOOK.md`

## 6. Release Decision

Release only if all are true:

- automated production gate passes
- Apps flow passes manually
- Chat flow passes manually
- Templates flow passes manually
- no launch-critical workflow is visibly broken
- no launch-facing page materially misrepresents capability or maturity
