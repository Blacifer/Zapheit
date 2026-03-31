# Internal Connectors (Support / Sales / IT)

This adds “connector actions” that create real records **inside** the app (no external tools required):

- **Support**: `support.ticket.create` → `support_tickets`
- **Sales**: `sales.lead.create` → `sales_leads`
- **IT**: `it.access_request.create` → `it_access_requests`

All of these run through the same control-plane flow:

**Playbooks → Job (pending approval) → Approve → Runtime executes `connector_action` → Audit + Work Item created**

## 1) Database migration

Apply: `synthetic-hr-database/migration_006_internal_work_items.sql`
Then apply RLS: `synthetic-hr-database/migration_007_internal_work_items_rls.sql`
Then apply links (Job ↔ Work Item): `synthetic-hr-database/migration_008_internal_work_item_links.sql`

Optional (DB-backed Playbook enable/disable):
- `synthetic-hr-database/migration_009_playbook_settings.sql`
- `synthetic-hr-database/migration_010_playbook_settings_rls.sql`

## 2) API endpoints (user auth)

- `GET /api/work-items/support-tickets`
- `GET /api/work-items/sales-leads`
- `GET /api/work-items/access-requests`

Permissions:
- `workitems.read`
- `workitems.manage`

## 3) Runtime execution endpoint (runtime auth)

Runtime uses:
- `POST /api/runtimes/actions/execute`

This writes:
- the target work item row
- an `agent_action_runs` record for audit and traceability

Supported internal actions:
- `support.ticket.create`
- `support.ticket.update_status`
- `sales.lead.create`
- `sales.lead.update_stage`
- `it.access_request.create`
- `it.access_request.decide`

External baseline:
- `service=webhook` (runtime-only) supports calling `payload.url` with an allowlist via `SYNTHETICHR_WEBHOOK_ALLOWLIST` (comma-separated hosts).

## 4) UI

- **Playbooks**: filter packs (Support / Sales / IT) and submit connector actions for approval.
- **Jobs & Approvals**: approve connector actions and review output.
- **Work Items**: view created tickets/leads/access requests.
