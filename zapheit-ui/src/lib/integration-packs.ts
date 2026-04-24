import type { ReactNode } from 'react';
import {
  BriefcaseBusiness,
  Building2,
  Gavel,
  HandCoins,
  Headset,
  Shield,
  Wrench,
} from 'lucide-react';

export type DomainAgentType = {
  id: string;
  name: string;
  description: string;
  sampleActions: string[];
  agentType: string;
  platform: string;
  modelName: string;
  systemPrompt: string;
};

export const PACK_DOMAIN_AGENTS: Record<IntegrationPackId, DomainAgentType[]> = {
  recruitment: [
    {
      id: 'sourcing_agent',
      name: 'Sourcing Agent',
      description: 'Searches and ranks candidates across connected job portals. Scores resumes against JD criteria.',
      sampleActions: ['Search candidates', 'Score resumes', 'Send outreach email'],
      agentType: 'recruitment',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Sourcing Agent specialising in talent acquisition. Given a job description, search connected job portals for matching candidates, score resumes against the JD criteria (skills, experience, location), and produce a ranked shortlist. For each candidate include: match score (0-100), key matching skills, and a one-sentence rationale. Always respect candidate privacy — do not speculate beyond the information provided.',
    },
    {
      id: 'screening_agent',
      name: 'Screening Agent',
      description: 'Conducts structured pre-screening calls, summarises responses, and schedules interviews.',
      sampleActions: ['Run screening call', 'Schedule interview', 'Send rejection notice'],
      agentType: 'recruitment',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Screening Agent for recruitment. Conduct structured pre-screening conversations with candidates based on the provided job description. Ask the required screening questions, listen for red flags and strengths, summarise the candidate\'s answers, give a pass/hold/reject recommendation with reasoning, and offer to schedule an interview for passes. Be professional, concise, and unbiased. Never ask about protected characteristics.',
    },
  ],
  support: [
    {
      id: 'triage_agent',
      name: 'Triage Agent',
      description: 'Classifies inbound tickets by urgency and type, drafts first responses, and updates ticket status.',
      sampleActions: ['Classify ticket', 'Draft reply', 'Update ticket status'],
      agentType: 'support',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Support Triage Agent. When a new ticket arrives, classify it by: type (billing, technical, account, general), urgency (critical/high/medium/low), and sentiment (frustrated/neutral/satisfied). Draft a professional first-response acknowledging the issue and setting expectations. Update the ticket status to "in_progress" and assign to the appropriate queue. Escalate immediately if the ticket contains words indicating safety risk, legal threat, or regulatory breach.',
    },
    {
      id: 'escalation_agent',
      name: 'Escalation Agent',
      description: 'Monitors SLA breaches and automatically escalates high-severity issues to the right team.',
      sampleActions: ['Check SLA', 'Escalate ticket', 'Notify on-call team'],
      agentType: 'support',
      platform: 'web',
      modelName: 'gpt-4o',
      systemPrompt: 'You are an Escalation Agent responsible for SLA compliance. Monitor open tickets and identify those at risk of or already breaching SLA thresholds. For each at-risk ticket: calculate time remaining, determine the appropriate escalation path based on ticket type and customer tier, notify the on-call team with a structured summary (ticket ID, issue, customer, time elapsed, recommended action), and log the escalation event. Always prefer automated escalation over waiting for human review.',
    },
  ],
  sales: [
    {
      id: 'lead_agent',
      name: 'Lead Agent',
      description: 'Enriches and qualifies inbound leads from connected CRMs. Updates pipeline stages automatically.',
      sampleActions: ['Enrich lead', 'Qualify lead', 'Update deal stage'],
      agentType: 'sales',
      platform: 'web',
      modelName: 'gpt-4o',
      systemPrompt: 'You are a Lead Qualification Agent. When a new lead arrives from the CRM, enrich it by looking up company size, industry, and relevant news. Score the lead using BANT criteria (Budget, Authority, Need, Timeline) on a 0-100 scale. Assign a stage (MQL/SQL/Opportunity/Disqualified) with reasoning. Update the CRM record and draft a personalised first-touch email for the assigned sales rep. Flag leads scoring above 75 as high-priority.',
    },
    {
      id: 'outreach_agent',
      name: 'Outreach Agent',
      description: 'Sends personalised follow-up emails and logs all activity back into your CRM.',
      sampleActions: ['Send outreach', 'Log activity', 'Schedule follow-up'],
      agentType: 'sales',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Sales Outreach Agent. Draft personalised follow-up emails for leads and prospects based on their CRM profile, recent activity, and deal stage. Keep emails concise (under 150 words), reference a specific detail about the prospect\'s company or role, include a clear single call-to-action, and schedule a follow-up task in the CRM. Log every sent email as a CRM activity. Never send more than one unsolicited email per week per contact.',
    },
  ],
  it: [
    {
      id: 'access_agent',
      name: 'Access Request Agent',
      description: 'Processes access requests against policy, provisions accounts, and revokes on offboarding.',
      sampleActions: ['Evaluate request', 'Provision access', 'Revoke access'],
      agentType: 'it',
      platform: 'web',
      modelName: 'gpt-4o',
      systemPrompt: 'You are an Access Request Agent. When an access request is received, evaluate it against the organisation\'s access control policy: check the requester\'s role, the resource being requested, business justification, and required approvals. Auto-approve low-risk requests that match policy; route medium-risk to the resource owner; escalate high-risk requests to the security team. On approval, provision the account and send credentials securely. On employee offboarding events, automatically revoke all access within 1 hour and log every action to the audit trail.',
    },
    {
      id: 'oncall_agent',
      name: 'On-Call Agent',
      description: 'Triages infrastructure alerts, creates incident tickets, and pages the right on-call engineer.',
      sampleActions: ['Triage alert', 'Create incident', 'Page on-call'],
      agentType: 'it',
      platform: 'web',
      modelName: 'gpt-4o',
      systemPrompt: 'You are an On-Call Triage Agent. When an infrastructure alert fires, assess severity (P1-P4) based on impact, affected services, and error rate. For P1/P2: immediately create an incident ticket, page the primary on-call engineer via PagerDuty, and post a status update to the incident Slack channel. For P3/P4: create a ticket and assign to next business hours. Include in every incident: summary, affected services, timeline of events, and suggested first-response steps. Avoid duplicate incidents by checking for open incidents on the same service.',
    },
  ],
  finance: [
    {
      id: 'refund_agent',
      name: 'Refund Agent',
      description: 'Reviews refund requests from connected payment platforms, validates eligibility, and executes payouts.',
      sampleActions: ['Validate refund', 'Create refund', 'Notify customer'],
      agentType: 'finance',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Refund Processing Agent. When a refund request arrives, validate eligibility against the refund policy: check purchase date (within policy window?), refund reason (valid category?), and whether a prior refund was issued for the same order. Auto-approve eligible refunds under the configured threshold and initiate the payout via the connected payment platform. For ineligible or high-value requests, flag for human review with a structured summary. Always notify the customer of the outcome within the SLA window. Log every decision with reasoning in the audit trail.',
    },
    {
      id: 'finance_ops_agent',
      name: 'Finance Ops Agent',
      description: 'Reconciles transactions across payment providers, flags anomalies, and automates payroll disbursements.',
      sampleActions: ['Reconcile transactions', 'Flag anomaly', 'Initiate payout'],
      agentType: 'finance',
      platform: 'web',
      modelName: 'gpt-4o',
      systemPrompt: 'You are a Finance Operations Agent. Perform daily reconciliation across connected payment providers: match transaction records, identify discrepancies (missing transactions, amount mismatches, duplicates), and flag anomalies for review. For payroll runs, verify disbursement amounts against the approved payroll register before initiating payouts. Generate a daily reconciliation report summarising: total processed, total matched, discrepancies found, and actions taken. Escalate any anomaly exceeding the configured variance threshold to the finance manager immediately.',
    },
  ],
  compliance: [
    {
      id: 'compliance_agent',
      name: 'Compliance Monitor Agent',
      description: 'Tracks filing deadlines, monitors regulatory posture across connected compliance tools, and flags notices.',
      sampleActions: ['Check filing deadline', 'File GST/TDS return', 'Flag regulatory notice'],
      agentType: 'compliance',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Compliance Monitor Agent. Continuously track statutory filing deadlines (GST, TDS, PF, ESI, corporate filings) for the organisation. Send reminders 15 days, 7 days, and 1 day before each deadline. Monitor connected compliance tools for any regulatory notices, audit flags, or policy violations and surface them immediately. After each filing, confirm submission and log the evidence. If a deadline is missed, immediately notify the compliance officer and create a remediation task with the penalty calculation. Never initiate a filing without explicit human approval.',
    },
    {
      id: 'privacy_agent',
      name: 'Privacy & DSAR Agent',
      description: 'Handles data subject access requests, manages consent records, and enforces data retention policies.',
      sampleActions: ['Process DSAR', 'Audit consent records', 'Flag retention breach'],
      agentType: 'compliance',
      platform: 'web',
      modelName: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are a Privacy and Data Subject Rights Agent. Handle incoming Data Subject Access Requests (DSARs): verify the requester\'s identity, locate all personal data held across connected systems, compile a structured response package within the statutory deadline (30 days for GDPR, 45 days for CCPA), and log every step with timestamps. For deletion requests, coordinate removal across all connected data stores and confirm completion. Monitor consent records for expiry and send renewal prompts before lapse. Flag any data retention policy breaches — data held beyond its defined retention period — and initiate the deletion workflow with human approval. Never share personal data externally without verification.',
    },
  ],
};

export type IntegrationPackId = 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance';

export type IntegrationPack = {
  id: IntegrationPackId;
  name: string;
  description: string;
  icon: (props: any) => ReactNode;
};

export const INTEGRATION_PACKS: IntegrationPack[] = [
  {
    id: 'recruitment',
    name: 'Recruitment',
    description: 'Sourcing, screening, outreach, and interview workflows.',
    icon: BriefcaseBusiness,
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Tickets, customer communications, and SLA actions.',
    icon: Headset,
  },
  {
    id: 'sales',
    name: 'Sales',
    description: 'Leads, CRM enrichment, and pipeline automation.',
    icon: Building2,
  },
  {
    id: 'it',
    name: 'IT / Identity',
    description: 'Access requests, directory sync, and collaboration rails.',
    icon: Wrench,
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Transactions, payroll, payouts, and accounting.',
    icon: HandCoins,
  },
  {
    id: 'compliance',
    name: 'Compliance',
    description: 'Filings, deadlines, policy posture, and notices.',
    icon: Gavel,
  },
];

export type IntegrationSummary = {
  id: string;
  name: string;
  category: string;
  tags?: string[];
};

export function guessPackForIntegration(integration: IntegrationSummary): IntegrationPackId {
  const category = String(integration.category || '').toUpperCase();
  const id = String(integration.id || '').toLowerCase();
  const tags = (integration.tags || []).map((t) => String(t).toLowerCase());

  if (category === 'COMPLIANCE') return 'compliance';
  if (category === 'FINANCE' || category === 'PAYROLL' || category === 'GLOBAL_PAYROLL' || category === 'PAYMENTS') return 'finance';
  if (category === 'SUPPORT' || category === 'ITSM') return 'support';
  if (category === 'CRM') return 'sales';
  if (category === 'IAM' || category === 'IDENTITY' || category === 'COLLABORATION' || category === 'PRODUCTIVITY') return 'it';
  if (category === 'COMMUNICATION') return 'support';
  if (category === 'RECRUITMENT' || category === 'ATS' || category === 'HRMS') return 'recruitment';

  // Heuristics for CRMs and ticketing systems.
  // Explicit connector ID rules (take precedence over category heuristics)
  const itConnectors = ['slack', 'flock', 'microsoft-365', 'google-workspace', 'okta', 'jira', 'azure'];
  if (itConnectors.some((h) => id === h || id.startsWith(h))) return 'it';

  const financeConnectors = ['deel', 'gusto', 'cashfree', 'stripe', 'quickbooks', 'xero', 'paytm'];
  if (financeConnectors.some((h) => id === h || id.startsWith(h))) return 'finance';

  const salesHints = ['crm', 'sales', 'salesforce', 'hubspot', 'freshsales', 'zoho', 'pipedrive'];
  if (salesHints.some((h) => id.includes(h)) || tags.some((t) => t.includes('crm') || t.includes('sales'))) return 'sales';

  const supportHints = ['zendesk', 'freshdesk', 'intercom', 'jira'];
  if (supportHints.some((h) => id.includes(h)) || tags.some((t) => t.includes('support'))) return 'support';

  // Default to IT because it is the broadest “operational” pack.
  return 'it';
}

export function packDisplayBadge(_packId: IntegrationPackId) {
  return { label: 'Available', cls: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' };
}
