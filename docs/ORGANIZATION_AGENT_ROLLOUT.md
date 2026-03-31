# RasiSyntheticHR — Organization Rollout (Agents)

This guide turns “Agent Management” into an organization-ready workflow: **standard playbooks → approvals → execution → audit**.

## 1) Define who can do what

SyntheticHR already enforces RBAC on the backend:

- **Viewer**: read-only (fleet, incidents, costs, conversations)
- **Manager**: create/update agents, submit/approve jobs (recommended for TA/HR Ops leads)
- **Admin / Super Admin**: full control + kill switch

Recommendation:
- Start with **1–2 Admins**, **3–10 Managers**, and the rest **Viewers**.

## 2) Standardize what “good” looks like (Playbooks)

Use **Playbooks** for repeatable HR work instead of ad-hoc prompts:

- Job Description Generator
- Resume Screening Summary
- Interview Kit Builder

Playbooks create **Jobs** that are always **pending approval** first.

## 3) Set up execution (Runtime)

Agents only execute approved jobs when deployed to a runtime:

1. Go to **Fleet → Deploy**
2. Create / pick a **Runtime instance**
3. Deploy an agent to that runtime
4. Enroll the runtime using the token in the UI

Runtime pulls approved jobs and posts results back to SyntheticHR.

## 4) Day-to-day flow (recommended)

1. HR user runs a Playbook → **Job created** (`pending_approval`)
2. Manager approves in **Jobs & Approvals** → job becomes `queued`
3. Runtime executes → job becomes `running` → `succeeded` / `failed`
4. Outputs stay in SyntheticHR (and can be reviewed/audited)

## 5) Governance & safety defaults

Minimum guardrails to keep:

- Always require approval for work that affects real people/processes.
- Keep prompts/templates centralized (Playbooks) so output is consistent.
- Track job submissions/decisions in audit logs.

## 6) Metrics to prove value

Track:

- Adoption: playbook runs/week, active managers
- Efficiency: time-to-first-draft for JD, time-to-shortlist note
- Quality: rework rate (how often outputs are edited)
- Risk: incidents per 1k runs, kill-switch usage

