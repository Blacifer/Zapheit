/**
 * playbookTemplates.ts
 *
 * Static pre-built playbook templates for common enterprise workflows.
 * Each template has a workflow field matching the CustomPlaybook.workflow shape.
 * "Use Template" deep-copies the workflow via JSON.parse(JSON.stringify(...)).
 */

type TemplateStep = {
  id: string;
  kind: 'llm';
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  next?: string | null;
};

export type PlaybookTemplate = {
  id: string;
  name: string;
  description: string;
  domain: string;
  domainColor: string;
  fields: Array<{ key: string; label: string; placeholder?: string; kind: 'text' | 'textarea' }>;
  workflow: { version: number; steps: TemplateStep[]; start?: string };
};

export const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = [
  {
    id: 'tpl_incident_response',
    name: 'Incident Response',
    description: 'Detect → notify team → escalate to on-call → log resolution and close.',
    domain: 'Incidents',
    domainColor: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
    fields: [
      { key: 'incident_summary', label: 'Incident Summary', placeholder: 'Brief description of what happened…', kind: 'textarea' },
      { key: 'severity', label: 'Severity (P1–P4)', placeholder: 'P2', kind: 'text' },
    ],
    workflow: {
      version: 2,
      start: 'step_detect',
      steps: [
        {
          id: 'step_detect',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an incident triage assistant. Classify the incident severity and identify immediate impact.' },
            { role: 'user', content: 'Incident: {{input.incident_summary}}\nSeverity reported: {{input.severity}}\n\nClassify this incident. Provide: 1) Confirmed severity, 2) Likely root cause categories, 3) Immediate impact summary.' },
          ],
          next: 'step_notify',
        },
        {
          id: 'step_notify',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a communication assistant. Draft clear, concise incident notifications.' },
            { role: 'user', content: 'Draft a Slack notification for the on-call team about this incident:\n{{step_detect}}\n\nInclude: severity badge, summary, initial action required, and a @here mention for P1/P2.' },
          ],
          next: 'step_escalate',
        },
        {
          id: 'step_escalate',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an incident manager. Determine escalation path and create a resolution checklist.' },
            { role: 'user', content: 'Based on:\n{{step_detect}}\n\nCreate: 1) Escalation decision (escalate yes/no and to whom), 2) Step-by-step resolution checklist, 3) Post-incident review schedule.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_employee_onboarding',
    name: 'Employee Onboarding',
    description: 'Create accounts → assign tools → send welcome email → schedule 1:1.',
    domain: 'HR',
    domainColor: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
    fields: [
      { key: 'employee_name', label: 'Employee Name', placeholder: 'Jane Smith', kind: 'text' },
      { key: 'role', label: 'Role / Department', placeholder: 'Software Engineer, Engineering', kind: 'text' },
      { key: 'start_date', label: 'Start Date', placeholder: '2026-01-15', kind: 'text' },
    ],
    workflow: {
      version: 2,
      start: 'step_accounts',
      steps: [
        {
          id: 'step_accounts',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an IT provisioning assistant. Generate structured account setup instructions.' },
            { role: 'user', content: 'New employee: {{input.employee_name}}, Role: {{input.role}}, Start: {{input.start_date}}\n\nList all accounts and tools to provision. Include: email, Slack, GitHub/Jira (if engineering), and role-specific SaaS tools. Format as a checklist.' },
          ],
          next: 'step_welcome',
        },
        {
          id: 'step_welcome',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an HR communications assistant. Write warm, professional welcome messages.' },
            { role: 'user', content: 'Write a welcome email for {{input.employee_name}} joining as {{input.role}} on {{input.start_date}}. Include: warm greeting, first-day schedule outline, key contacts, and how to reach IT/HR.' },
          ],
          next: 'step_schedule',
        },
        {
          id: 'step_schedule',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a scheduling assistant. Create structured 30/60/90 day onboarding plans.' },
            { role: 'user', content: 'Create a 30/60/90 day onboarding plan for {{input.employee_name}} in role: {{input.role}}. Include: week 1 schedule with 1:1 meetings, 30-day goals, 60-day milestones, 90-day success criteria.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_invoice_approval',
    name: 'Invoice Approval',
    description: 'Extract line items → validate against budget → route for approval → pay or reject.',
    domain: 'Finance',
    domainColor: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    fields: [
      { key: 'invoice_text', label: 'Invoice Details', placeholder: 'Paste invoice text or key fields…', kind: 'textarea' },
      { key: 'budget_code', label: 'Budget Code / Department', placeholder: 'ENG-2026-Q1', kind: 'text' },
    ],
    workflow: {
      version: 2,
      start: 'step_extract',
      steps: [
        {
          id: 'step_extract',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a finance assistant. Extract structured data from invoices.' },
            { role: 'user', content: 'Extract from this invoice:\n{{input.invoice_text}}\n\nReturn JSON with: vendor, invoice_number, date, line_items (array of {description, qty, unit_price, total}), subtotal, tax, grand_total, payment_terms.' },
          ],
          next: 'step_validate',
        },
        {
          id: 'step_validate',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a budget compliance assistant. Validate invoices against policy.' },
            { role: 'user', content: 'Invoice data:\n{{step_extract}}\nBudget code: {{input.budget_code}}\n\nCheck: 1) Are line items reasonable for this budget code? 2) Any anomalies (duplicate lines, round numbers, unusual vendors)? 3) Recommended action: auto-approve / needs human review / reject with reason.' },
          ],
          next: 'step_route',
        },
        {
          id: 'step_route',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an approval routing assistant. Determine the correct approval chain.' },
            { role: 'user', content: 'Based on:\n{{step_validate}}\n\nDraft: 1) Approval routing decision with approver level required, 2) Email to approver with invoice summary and recommendation, 3) Payment instructions if approved.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_lead_qualification',
    name: 'Lead Qualification',
    description: 'Score lead → enrich with context → route to sales rep → create CRM record.',
    domain: 'Sales',
    domainColor: 'text-violet-300 border-violet-500/30 bg-violet-500/10',
    fields: [
      { key: 'lead_info', label: 'Lead Information', placeholder: 'Name, company, email, source, notes…', kind: 'textarea' },
    ],
    workflow: {
      version: 2,
      start: 'step_score',
      steps: [
        {
          id: 'step_score',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a sales qualification expert. Score leads using BANT criteria.' },
            { role: 'user', content: 'Qualify this lead:\n{{input.lead_info}}\n\nScore on BANT (Budget/Authority/Need/Timeline) 1-10 each. Provide: total score (40 max), ICP fit (high/medium/low), recommended tier (Enterprise/Mid-Market/SMB), next action.' },
          ],
          next: 'step_enrich',
        },
        {
          id: 'step_enrich',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a sales intelligence assistant. Create detailed prospect profiles.' },
            { role: 'user', content: 'Lead: {{input.lead_info}}\nQualification: {{step_score}}\n\nCreate a sales brief: company overview, likely pain points for our product, recommended talk track, potential objections and responses, competitive context.' },
          ],
          next: 'step_crm',
        },
        {
          id: 'step_crm',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a CRM data entry assistant. Format data for CRM systems.' },
            { role: 'user', content: 'Format CRM record for this lead:\n{{input.lead_info}}\nScore: {{step_score}}\n\nProvide JSON: {name, email, company, title, lead_score, tier, assigned_rep_notes, next_steps, follow_up_date}.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_access_request',
    name: 'Access Request',
    description: 'Request → RBAC check → manager approval → provision access.',
    domain: 'IT',
    domainColor: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
    fields: [
      { key: 'requester', label: 'Requester Name / Email', placeholder: 'alice@company.com', kind: 'text' },
      { key: 'resource', label: 'Resource Requested', placeholder: 'Production DB read access, AWS S3 bucket…', kind: 'text' },
      { key: 'justification', label: 'Business Justification', placeholder: 'Need to debug production issue…', kind: 'textarea' },
    ],
    workflow: {
      version: 2,
      start: 'step_rbac',
      steps: [
        {
          id: 'step_rbac',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a security policy assistant. Evaluate access requests against zero-trust principles.' },
            { role: 'user', content: 'Access request:\nRequester: {{input.requester}}\nResource: {{input.resource}}\nJustification: {{input.justification}}\n\nEvaluate: 1) Least-privilege assessment (is this the minimum needed?), 2) Risk level (low/medium/high), 3) Recommended duration (temporary/permanent), 4) Required approver level.' },
          ],
          next: 'step_approval_draft',
        },
        {
          id: 'step_approval_draft',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an IT workflow assistant. Draft access request approvals.' },
            { role: 'user', content: 'RBAC analysis:\n{{step_rbac}}\n\nDraft: 1) Approval request email to manager with risk context, 2) Provisioning instructions if approved (specific permissions, duration, monitoring), 3) Rejection email with alternative if denied.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_payroll_run',
    name: 'Payroll Run',
    description: 'Validate headcount → run payroll checklist → notify finance → audit log.',
    domain: 'Payroll',
    domainColor: 'text-teal-300 border-teal-500/30 bg-teal-500/10',
    fields: [
      { key: 'pay_period', label: 'Pay Period', placeholder: 'March 2026 (March 1–31)', kind: 'text' },
      { key: 'headcount', label: 'Active Headcount', placeholder: '142', kind: 'text' },
      { key: 'notes', label: 'Special Items', placeholder: 'New hires, terminations, bonuses…', kind: 'textarea' },
    ],
    workflow: {
      version: 2,
      start: 'step_validate',
      steps: [
        {
          id: 'step_validate',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a payroll compliance assistant. Validate payroll runs before processing.' },
            { role: 'user', content: 'Payroll run:\nPeriod: {{input.pay_period}}\nHeadcount: {{input.headcount}}\nSpecial items: {{input.notes}}\n\nCreate pre-payroll checklist: 1) Headcount verification steps, 2) Compliance checks (taxes, deductions), 3) Special item handling for each note, 4) Approval gates required.' },
          ],
          next: 'step_notify',
        },
        {
          id: 'step_notify',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a finance communications assistant.' },
            { role: 'user', content: 'Payroll checklist:\n{{step_validate}}\n\nDraft: 1) Finance team notification with payroll summary and amounts, 2) Audit log entry (ISO 8601 timestamp format, all key decisions), 3) Post-payroll confirmation message to employees.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_compliance_alert',
    name: 'Compliance Alert',
    description: 'Detect breach → notify DPO → freeze relevant data → generate incident report.',
    domain: 'Compliance',
    domainColor: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
    fields: [
      { key: 'breach_description', label: 'Breach Description', placeholder: 'What happened, what data was affected…', kind: 'textarea' },
      { key: 'regulation', label: 'Applicable Regulation', placeholder: 'GDPR / DPDPA / HIPAA / SOC2', kind: 'text' },
    ],
    workflow: {
      version: 2,
      start: 'step_assess',
      steps: [
        {
          id: 'step_assess',
          kind: 'llm',
          model: 'openai/gpt-4o',
          messages: [
            { role: 'system', content: 'You are a data protection compliance expert. Assess breaches against regulatory requirements.' },
            { role: 'user', content: 'Breach: {{input.breach_description}}\nRegulation: {{input.regulation}}\n\nAssess: 1) Severity classification under {{input.regulation}}, 2) Notification obligations (72h rule for GDPR, etc.), 3) Affected data categories, 4) Immediate containment actions.' },
          ],
          next: 'step_notify_dpo',
        },
        {
          id: 'step_notify_dpo',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a compliance communications assistant.' },
            { role: 'user', content: 'Assessment:\n{{step_assess}}\n\nDraft: 1) DPO notification email with breach details and regulatory timeline, 2) Data freeze instructions for affected systems, 3) Regulatory notification draft (if required by {{input.regulation}}).' },
          ],
          next: 'step_report',
        },
        {
          id: 'step_report',
          kind: 'llm',
          model: 'openai/gpt-4o',
          messages: [
            { role: 'system', content: 'You are a compliance documentation expert.' },
            { role: 'user', content: 'Breach: {{input.breach_description}}\nAssessment: {{step_assess}}\nNotifications: {{step_notify_dpo}}\n\nGenerate formal incident report: executive summary, timeline, affected data, regulatory implications, remediation plan, lessons learned.' },
          ],
          next: null,
        },
      ],
    },
  },
  {
    id: 'tpl_contract_review',
    name: 'Contract Review',
    description: 'Extract clauses → flag risk items → route for legal approval → counter-sign.',
    domain: 'Legal',
    domainColor: 'text-slate-300 border-slate-500/30 bg-slate-500/10',
    fields: [
      { key: 'contract_text', label: 'Contract Text', placeholder: 'Paste the contract or key clauses…', kind: 'textarea' },
      { key: 'contract_type', label: 'Contract Type', placeholder: 'MSA / NDA / SOW / Employment', kind: 'text' },
    ],
    workflow: {
      version: 2,
      start: 'step_extract',
      steps: [
        {
          id: 'step_extract',
          kind: 'llm',
          model: 'openai/gpt-4o',
          messages: [
            { role: 'system', content: 'You are a contract analysis expert. Extract and structure key contractual terms.' },
            { role: 'user', content: 'Contract ({{input.contract_type}}):\n{{input.contract_text}}\n\nExtract: parties, effective date, term, payment terms, key obligations, IP ownership, termination clauses, limitation of liability, governing law, non-standard clauses.' },
          ],
          next: 'step_risk',
        },
        {
          id: 'step_risk',
          kind: 'llm',
          model: 'openai/gpt-4o',
          messages: [
            { role: 'system', content: 'You are a legal risk assessment specialist.' },
            { role: 'user', content: 'Contract clauses:\n{{step_extract}}\n\nFlag: 1) High-risk clauses with explanation, 2) Missing standard protections, 3) Ambiguous language, 4) Recommended redlines with standard market language alternatives, 5) Overall risk rating (low/medium/high).' },
          ],
          next: 'step_route',
        },
        {
          id: 'step_route',
          kind: 'llm',
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a legal operations assistant.' },
            { role: 'user', content: 'Risk assessment:\n{{step_risk}}\n\nDraft: 1) Email to legal counsel with executive summary and priority flags, 2) Counter-proposal covering the top 3 redlines, 3) Approval checklist for signatory.' },
          ],
          next: null,
        },
      ],
    },
  },
];
