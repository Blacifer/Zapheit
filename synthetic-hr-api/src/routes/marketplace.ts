import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { encryptSecret } from '../lib/integrations/encryption';
import { eq, supabaseRestAsService } from '../lib/supabase-rest';

const router = express.Router();

// ---------------------------------------------------------------------------
// Static partner app catalog
// ---------------------------------------------------------------------------

export type MarketplaceApp = {
  id: string;
  name: string;
  developer: string;
  category: string;
  description: string;
  permissions: string[];
  relatedAgentIds: string[];
  actionsUnlocked: string[];
  setupTimeMinutes: number;
  bundleIds: string[];
  installMethod: 'free' | 'api_key' | 'oauth2';
  requiredFields?: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; required: boolean }>;
  installCount: number;
  featured: boolean;
  badge?: string;
  colorHex: string;
  logoLetter: string;
  comingSoon?: boolean;
};

export type AppBundle = {
  id: string;
  name: string;
  description: string;
  intentLabel: string;
  appIds: string[];
  colorHex: string;
  icon: string;
};

export const APP_BUNDLES: AppBundle[] = [
  {
    id: 'recruitment-stack',
    name: 'Recruitment Stack',
    description: 'Source, screen, and hire candidates automatically.',
    intentLabel: 'Hiring',
    appIds: ['linkedin-recruiter', 'greenhouse'],
    colorHex: '#7C3AED',
    icon: 'BriefcaseBusiness',
  },
  {
    id: 'support-stack',
    name: 'Support Stack',
    description: 'Triage tickets, auto-reply, and monitor SLAs.',
    intentLabel: 'Customer Support',
    appIds: ['zendesk', 'freshdesk', 'intercom'],
    colorHex: '#2563EB',
    icon: 'Headset',
  },
  {
    id: 'finance-stack',
    name: 'Finance Stack',
    description: 'Automate refunds, reconciliation, and invoicing.',
    intentLabel: 'Finance & Payments',
    appIds: ['stripe', 'razorpay', 'quickbooks', 'xero'],
    colorHex: '#DC2626',
    icon: 'HandCoins',
  },
  {
    id: 'sales-stack',
    name: 'Sales Stack',
    description: 'Qualify leads, enrich contacts, and log CRM activity.',
    intentLabel: 'Sales',
    appIds: ['hubspot', 'salesforce', 'pipedrive', 'zoho'],
    colorHex: '#059669',
    icon: 'Building2',
  },
  {
    id: 'hr-stack',
    name: 'HR & Payroll Stack',
    description: 'Manage employee records, payroll, and workforce tools.',
    intentLabel: 'HR & Payroll',
    appIds: ['google-workspace', 'microsoft-365', 'deel', 'gusto'],
    colorHex: '#7C3AED',
    icon: 'Users',
  },
  {
    id: 'it-stack',
    name: 'IT & Access Stack',
    description: 'Provision accounts, manage incidents, and control access.',
    intentLabel: 'IT / Access Management',
    appIds: ['okta', 'jira-service-management', 'slack', 'microsoft-365', 'flock'],
    colorHex: '#D97706',
    icon: 'Wrench',
  },
  {
    id: 'compliance-stack',
    name: 'Compliance Stack',
    description: 'Track filing deadlines and monitor regulatory posture.',
    intentLabel: 'Compliance',
    appIds: ['cleartax'],
    colorHex: '#0891B2',
    icon: 'Gavel',
  },
  {
    id: 'communication-stack',
    name: 'Communication Stack',
    description: 'Connect agents to every channel your team and customers use.',
    intentLabel: 'Communication',
    appIds: ['microsoft-teams', 'zoom', 'slack', 'whatsapp-business'],
    colorHex: '#0891B2',
    icon: 'MessageSquare',
  },
  {
    id: 'devops-stack',
    name: 'DevOps Stack',
    description: 'Monitor infrastructure, manage incidents, and automate deployments.',
    intentLabel: 'DevOps / IT',
    appIds: ['github', 'pagerduty', 'datadog', 'jira-service-management'],
    colorHex: '#D97706',
    icon: 'Wrench',
  },
  {
    id: 'marketing-stack',
    name: 'Marketing Stack',
    description: 'Automate campaigns, track engagement, and grow your audience.',
    intentLabel: 'Marketing',
    appIds: ['mailchimp', 'moengage', 'clevertap', 'brevo'],
    colorHex: '#EA580C',
    icon: 'Megaphone',
  },
  {
    id: 'analytics-stack',
    name: 'Analytics Stack',
    description: 'Query product data, track funnels, and surface insights automatically.',
    intentLabel: 'Analytics',
    appIds: ['mixpanel', 'amplitude', 'segment', 'metabase'],
    colorHex: '#4F46E5',
    icon: 'BarChart2',
  },
  {
    id: 'legal-stack',
    name: 'Legal & Compliance Stack',
    description: 'Send e-signatures, track document status, and automate legal workflows.',
    intentLabel: 'Legal',
    appIds: ['docusign', 'leegality', 'cleartax', 'zoho-sign'],
    colorHex: '#0D9488',
    icon: 'Scale',
  },
  {
    id: 'india-hr-stack',
    name: 'India HR Stack',
    description: 'HR, payroll, and recruitment tools built for Indian businesses.',
    intentLabel: 'India HR',
    appIds: ['keka', 'greythr', 'darwinbox', 'naukri'],
    colorHex: '#7C3AED',
    icon: 'Users',
  },
];

export const PARTNER_APP_CATALOG: MarketplaceApp[] = [
  // --- Finance ---
  {
    id: 'stripe',
    name: 'Stripe',
    developer: 'Stripe, Inc.',
    category: 'finance',
    description: "Accept payments, automate payouts, and reconcile transactions. Rasi's Refund Agent monitors every charge and automates dispute handling.",
    permissions: ['Read charges and refunds', 'Initiate refunds up to policy limit', 'Read payout schedules', 'Receive webhook events'],
    relatedAgentIds: ['refund_agent', 'finance_ops_agent'],
    actionsUnlocked: ['Auto-process refunds', 'Reconcile transactions', 'Flag anomalies', 'Monitor disputes'],
    setupTimeMinutes: 3,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...', required: true },
      { name: 'webhook_secret', label: 'Webhook Signing Secret', type: 'password', placeholder: 'whsec_...', required: false },
    ],
    installCount: 3820,
    featured: true,
    badge: 'Popular',
    colorHex: '#6772E5',
    logoLetter: 'S',
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    developer: 'Razorpay Software Pvt. Ltd.',
    category: 'finance',
    description: "India's leading payment gateway. Full payment lifecycle management with automated refund processing and settlement reconciliation.",
    permissions: ['Read orders and payments', 'Initiate refunds', 'Read settlements', 'Receive webhook events'],
    relatedAgentIds: ['refund_agent', 'finance_ops_agent'],
    actionsUnlocked: ['Auto-process refunds', 'Reconcile settlements', 'Monitor disputes'],
    setupTimeMinutes: 3,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'key_id', label: 'Key ID', type: 'text', placeholder: 'rzp_live_...', required: true },
      { name: 'key_secret', label: 'Key Secret', type: 'password', placeholder: 'Your Razorpay key secret', required: true },
    ],
    installCount: 2410,
    featured: true,
    badge: 'India Priority',
    colorHex: '#2C73D2',
    logoLetter: 'R',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    developer: 'Intuit Inc.',
    category: 'finance',
    description: 'Sync invoices, reconcile accounts, and automate payroll. Finance Ops Agent keeps your books accurate and flags anomalies in real time.',
    permissions: ['Read and write invoices', 'Read bank accounts', 'Read/write payroll runs', 'Sync chart of accounts'],
    relatedAgentIds: ['finance_ops_agent'],
    actionsUnlocked: ['Sync invoices', 'Reconcile accounts', 'Flag anomalies', 'Automate payroll'],
    setupTimeMinutes: 5,
    bundleIds: ['finance-stack'],
    installMethod: 'oauth2',
    installCount: 1880,
    featured: false,
    badge: 'Verified',
    colorHex: '#2CA01C',
    logoLetter: 'Q',
  },
  {
    id: 'xero',
    name: 'Xero',
    developer: 'Xero Limited',
    category: 'finance',
    description: 'Cloud accounting with automated bank reconciliation. Let Finance Ops Agent reconcile transactions and alert on discrepancies daily.',
    permissions: ['Read and write bank transactions', 'Read invoices', 'Read payroll', 'Post journal entries'],
    relatedAgentIds: ['finance_ops_agent'],
    actionsUnlocked: ['Reconcile bank transactions', 'Sync invoices', 'Post journal entries'],
    setupTimeMinutes: 5,
    bundleIds: ['finance-stack'],
    installMethod: 'oauth2',
    installCount: 1240,
    featured: false,
    colorHex: '#1AB4D7',
    logoLetter: 'X',
    comingSoon: true,
  },

  // --- Support ---
  {
    id: 'zendesk',
    name: 'Zendesk',
    developer: 'Zendesk, Inc.',
    category: 'support',
    description: 'Enterprise customer support platform. Triage Agent auto-classifies tickets, drafts replies, and Escalation Agent monitors SLA breaches.',
    permissions: ['Read and write tickets', 'Read/update user profiles', 'Manage ticket fields and views', 'Post internal notes'],
    relatedAgentIds: ['triage_agent', 'escalation_agent'],
    actionsUnlocked: ['Classify tickets', 'Draft replies', 'Monitor SLAs', 'Auto-escalate breaches'],
    setupTimeMinutes: 4,
    bundleIds: ['support-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'yourcompany', required: true },
      { name: 'email', label: 'Agent Email', type: 'text', placeholder: 'agent@company.com', required: true },
      { name: 'api_token', label: 'API Token', type: 'password', placeholder: 'Zendesk API token', required: true },
    ],
    installCount: 4150,
    featured: true,
    badge: 'Popular',
    colorHex: '#03363D',
    logoLetter: 'Z',
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    developer: 'Freshworks Inc.',
    category: 'support',
    description: 'Omni-channel helpdesk. Triage Agent classifies inbound tickets from email, chat, and social — and Escalation Agent keeps your SLAs green.',
    permissions: ['Read and create tickets', 'Update ticket status and priority', 'Assign tickets to agents', 'Add notes and replies'],
    relatedAgentIds: ['triage_agent', 'escalation_agent'],
    actionsUnlocked: ['Classify inbound tickets', 'Auto-assign priority', 'Draft replies', 'Monitor SLA'],
    setupTimeMinutes: 3,
    bundleIds: ['support-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'domain', label: 'Domain', type: 'text', placeholder: 'yourcompany.freshdesk.com', required: true },
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Freshdesk API key', required: true },
    ],
    installCount: 2730,
    featured: false,
    badge: 'Verified',
    colorHex: '#25C16F',
    logoLetter: 'F',
  },
  {
    id: 'intercom',
    name: 'Intercom',
    developer: 'Intercom, Inc.',
    category: 'support',
    description: 'Conversational customer support. Triage Agent reads inbound conversations, categorises them, and routes to the right inbox automatically.',
    permissions: ['Read and reply to conversations', 'Manage contacts', 'Create notes and tags', 'Send outbound messages'],
    relatedAgentIds: ['triage_agent'],
    actionsUnlocked: ['Categorise conversations', 'Route to inbox', 'Draft replies', 'Tag contacts'],
    setupTimeMinutes: 5,
    bundleIds: ['support-stack'],
    installMethod: 'oauth2',
    installCount: 1960,
    featured: false,
    colorHex: '#286EFA',
    logoLetter: 'I',
  },

  // --- Sales ---
  {
    id: 'hubspot',
    name: 'HubSpot',
    developer: 'HubSpot, Inc.',
    category: 'sales',
    description: 'Full-funnel CRM with marketing automation. Lead Agent qualifies every inbound lead and Outreach Agent logs activity automatically.',
    permissions: ['Read and write contacts/companies', 'Read and update deals', 'Create tasks and notes', 'Send emails via HubSpot'],
    relatedAgentIds: ['lead_agent', 'outreach_agent'],
    actionsUnlocked: ['Qualify leads', 'Enrich contacts', 'Update deal stages', 'Log outreach activity'],
    setupTimeMinutes: 5,
    bundleIds: ['sales-stack'],
    installMethod: 'oauth2',
    installCount: 5200,
    featured: true,
    badge: 'Popular',
    colorHex: '#FF7A59',
    logoLetter: 'H',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    developer: 'Salesforce, Inc.',
    category: 'sales',
    description: "The world's #1 CRM. Lead Agent enriches and scores every lead, updates pipeline stages, and Outreach Agent syncs all email activity.",
    permissions: ['Read and write Leads/Contacts/Opportunities', 'Log Activities', 'Update pipeline stages', 'Create Tasks'],
    relatedAgentIds: ['lead_agent', 'outreach_agent'],
    actionsUnlocked: ['Score leads', 'Update pipeline stages', 'Sync email activity', 'Create follow-up tasks'],
    setupTimeMinutes: 8,
    bundleIds: ['sales-stack'],
    installMethod: 'oauth2',
    installCount: 4680,
    featured: true,
    badge: 'Verified',
    colorHex: '#00A1E0',
    logoLetter: 'S',
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    developer: 'Pipedrive OÜ',
    category: 'sales',
    description: 'Sales pipeline built for action. Lead Agent auto-moves deals through stages based on activity signals, keeping your pipeline healthy.',
    permissions: ['Read and write deals and leads', 'Update pipeline stages', 'Create activities and notes', 'Manage contacts'],
    relatedAgentIds: ['lead_agent', 'outreach_agent'],
    actionsUnlocked: ['Move deals through stages', 'Create activities', 'Enrich leads', 'Log notes'],
    setupTimeMinutes: 2,
    bundleIds: ['sales-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_token', label: 'API Token', type: 'password', placeholder: 'Pipedrive API token', required: true },
    ],
    installCount: 1320,
    featured: false,
    colorHex: '#1A1F36',
    logoLetter: 'P',
    comingSoon: true,
  },

  // --- IT / Identity ---
  {
    id: 'okta',
    name: 'Okta',
    developer: 'Okta, Inc.',
    category: 'it',
    description: 'Identity and access management at scale. Access Request Agent evaluates requests against Okta policies and provisions accounts automatically.',
    permissions: ['Read and manage users and groups', 'Assign application access', 'Read audit logs', 'Trigger lifecycle events'],
    relatedAgentIds: ['access_agent'],
    actionsUnlocked: ['Provision user accounts', 'Assign app access', 'Evaluate access requests', 'Trigger deprovisioning'],
    setupTimeMinutes: 5,
    bundleIds: ['it-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'domain', label: 'Okta Domain', type: 'text', placeholder: 'yourcompany.okta.com', required: true },
      { name: 'api_token', label: 'API Token', type: 'password', placeholder: 'Okta SSWS API token', required: true },
    ],
    installCount: 2890,
    featured: true,
    badge: 'Verified',
    colorHex: '#007DC1',
    logoLetter: 'O',
  },
  {
    id: 'jira-service-management',
    name: 'Jira Service Management',
    developer: 'Atlassian Pty Ltd',
    category: 'it',
    description: 'ITSM for modern teams. On-Call Agent creates P1 incidents automatically and Access Request Agent routes approval flows through JSM queues.',
    permissions: ['Create and update requests/incidents', 'Manage queues and priorities', 'Add comments and watchers', 'Read SLA metrics'],
    relatedAgentIds: ['access_agent', 'oncall_agent'],
    actionsUnlocked: ['Create P1 incidents', 'Route approval flows', 'Monitor SLA metrics', 'Add watchers'],
    setupTimeMinutes: 6,
    bundleIds: ['it-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'site_url', label: 'Site URL', type: 'text', placeholder: 'https://yourcompany.atlassian.net', required: true },
      { name: 'email', label: 'Email', type: 'text', placeholder: 'admin@company.com', required: true },
      { name: 'api_token', label: 'API Token', type: 'password', placeholder: 'Atlassian API token', required: true },
    ],
    installCount: 3410,
    featured: false,
    badge: 'Popular',
    colorHex: '#0052CC',
    logoLetter: 'J',
  },

  // --- Compliance ---
  {
    id: 'cleartax',
    name: 'ClearTax',
    developer: 'Defmacro Software Pvt. Ltd.',
    category: 'compliance',
    description: "India's leading GST and ITR filing platform. Compliance Monitor Agent tracks all filing deadlines and initiates returns with your approval.",
    permissions: ['Read filing status and deadlines', 'Draft GST/TDS returns', 'Submit returns (with approval)', 'Read notices and demands'],
    relatedAgentIds: ['compliance_agent'],
    actionsUnlocked: ['Track filing deadlines', 'Draft GST/TDS returns', 'Monitor notices', 'Flag overdue filings'],
    setupTimeMinutes: 4,
    bundleIds: ['compliance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'ClearTax API key', required: true },
      { name: 'gstin', label: 'GSTIN', type: 'text', placeholder: '22AAAAA0000A1Z5', required: true },
    ],
    installCount: 1870,
    featured: false,
    badge: 'India Priority',
    colorHex: '#0C8A40',
    logoLetter: 'C',
    comingSoon: true,
  },

  // --- Recruitment ---
  {
    id: 'linkedin-recruiter',
    name: 'LinkedIn Recruiter',
    developer: 'LinkedIn Corporation',
    category: 'recruitment',
    description: "Access LinkedIn's 900M+ member network. Sourcing Agent searches, scores, and shortlists candidates against your JD automatically.",
    permissions: ['Search candidate profiles', 'Send InMails (with approval)', 'Read job postings', 'Export candidate data'],
    relatedAgentIds: ['sourcing_agent'],
    actionsUnlocked: ['Search candidates', 'Score against JD', 'Send InMails', 'Shortlist candidates'],
    setupTimeMinutes: 5,
    bundleIds: ['recruitment-stack'],
    installMethod: 'oauth2',
    installCount: 6100,
    featured: true,
    badge: 'Popular',
    colorHex: '#0A66C2',
    logoLetter: 'L',
    comingSoon: true,
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    developer: 'Greenhouse Software, Inc.',
    category: 'recruitment',
    description: 'ATS trusted by 7,500+ companies. Screening Agent updates candidate stages, logs interview notes, and sends rejection/offer emails via Greenhouse.',
    permissions: ['Read and update candidate profiles', 'Manage interview stages', 'Create and send offer letters', 'Log activity notes'],
    relatedAgentIds: ['sourcing_agent', 'screening_agent'],
    actionsUnlocked: ['Update candidate stages', 'Log interview notes', 'Send offer/rejection emails', 'Create scorecards'],
    setupTimeMinutes: 3,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Greenhouse Harvest API key', required: true },
      { name: 'on_behalf_of', label: 'On-Behalf-Of User ID', type: 'text', placeholder: 'Greenhouse user ID for actions', required: false },
    ],
    installCount: 1540,
    featured: false,
    badge: 'Verified',
    colorHex: '#24B247',
    logoLetter: 'G',
    comingSoon: true,
  },

  // --- HR / Payroll ---
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    developer: 'Google LLC',
    category: 'hr',
    description: 'Gmail, Calendar, Drive, and Admin SDK. HR agents can onboard employees, manage directory records, send emails, and schedule events automatically.',
    permissions: ['Read and write Gmail', 'Manage Calendar events', 'Read/write Admin directory', 'Access Drive files'],
    relatedAgentIds: ['access_agent', 'onboarding_agent'],
    actionsUnlocked: ['Send emails', 'Create calendar events', 'Manage directory users', 'Access shared drives'],
    setupTimeMinutes: 5,
    bundleIds: ['hr-stack', 'it-stack'],
    installMethod: 'oauth2',
    installCount: 7200,
    featured: true,
    badge: 'Popular',
    colorHex: '#EA4335',
    logoLetter: 'G',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    developer: 'Microsoft Corporation',
    category: 'hr',
    description: 'Teams, Outlook, OneDrive, and Azure AD. IT and HR agents can send messages, manage users, schedule meetings, and handle access requests.',
    permissions: ['Send Teams messages', 'Read/write Outlook calendar', 'Manage Azure AD users', 'Read SharePoint'],
    relatedAgentIds: ['access_agent', 'oncall_agent'],
    actionsUnlocked: ['Send Teams messages', 'Schedule meetings', 'Manage AD users', 'Create Teams channels'],
    setupTimeMinutes: 6,
    bundleIds: ['hr-stack', 'it-stack'],
    installMethod: 'oauth2',
    installCount: 8900,
    featured: true,
    badge: 'Popular',
    colorHex: '#0078D4',
    logoLetter: 'M',
  },
  {
    id: 'slack',
    name: 'Slack',
    developer: 'Salesforce, Inc.',
    category: 'it',
    description: 'Team messaging and collaboration. Agents can send alerts, post updates, read channel history, and notify on-call engineers automatically.',
    permissions: ['Send messages to channels', 'Read channel history', 'Manage channel members', 'Read user profiles'],
    relatedAgentIds: ['oncall_agent', 'triage_agent', 'access_agent'],
    actionsUnlocked: ['Send channel alerts', 'Post incident updates', 'Notify on-call', 'Read conversation history'],
    setupTimeMinutes: 3,
    bundleIds: ['it-stack'],
    installMethod: 'oauth2',
    installCount: 11400,
    featured: true,
    badge: 'Popular',
    colorHex: '#4A154B',
    logoLetter: 'S',
  },
  {
    id: 'zoho',
    name: 'Zoho',
    developer: 'Zoho Corporation Pvt. Ltd.',
    category: 'sales',
    description: 'Zoho CRM and Zoho People in one connector. Lead Agent qualifies contacts and updates your pipeline; HR Agent reads employee records.',
    permissions: ['Read and write CRM contacts/deals', 'Read Zoho People employee data', 'Update pipeline stages', 'Create tasks'],
    relatedAgentIds: ['lead_agent', 'outreach_agent'],
    actionsUnlocked: ['Qualify CRM leads', 'Update deal stages', 'Read employee records', 'Create CRM tasks'],
    setupTimeMinutes: 5,
    bundleIds: ['sales-stack'],
    installMethod: 'oauth2',
    installCount: 3100,
    featured: false,
    badge: 'Verified',
    colorHex: '#E42527',
    logoLetter: 'Z',
  },
  {
    id: 'deel',
    name: 'Deel',
    developer: 'Deel, Inc.',
    category: 'hr',
    description: 'Global payroll and contractor management. Finance Ops Agent reads contracts, payslips, and payment status across 150+ countries automatically.',
    permissions: ['Read employee contracts', 'Read payslip data', 'Read payment status', 'List workers'],
    relatedAgentIds: ['finance_ops_agent', 'compliance_agent'],
    actionsUnlocked: ['Read contract details', 'Get payslip summaries', 'Check payment status', 'List global workers'],
    setupTimeMinutes: 4,
    bundleIds: ['hr-stack'],
    installMethod: 'oauth2',
    installCount: 2800,
    featured: false,
    badge: 'Verified',
    colorHex: '#FF6B35',
    logoLetter: 'D',
    comingSoon: true,
  },
  {
    id: 'gusto',
    name: 'Gusto',
    developer: 'Gusto, Inc.',
    category: 'hr',
    description: 'US payroll, benefits, and HR in one place. Finance Ops Agent reads payroll runs, time-off balances, and benefit elections automatically.',
    permissions: ['Read employee records', 'Read payroll runs', 'Read time-off requests', 'Read benefits enrollment'],
    relatedAgentIds: ['finance_ops_agent'],
    actionsUnlocked: ['Get payroll summaries', 'Check time-off balances', 'Read benefit details', 'List employees'],
    setupTimeMinutes: 4,
    bundleIds: ['hr-stack'],
    installMethod: 'oauth2',
    installCount: 1950,
    featured: false,
    badge: 'Verified',
    colorHex: '#F45D48',
    logoLetter: 'G',
  },
  {
    id: 'flock',
    name: 'Flock',
    developer: 'Flock FZ-LLC',
    category: 'it',
    description: 'Team messaging for growing businesses. Agents can send automated alerts, post incident notifications, and keep teams informed in real time.',
    permissions: ['Send messages to channels', 'Read channel info', 'Post notifications'],
    relatedAgentIds: ['oncall_agent', 'triage_agent'],
    actionsUnlocked: ['Send channel messages', 'Post incident alerts', 'Notify teams'],
    setupTimeMinutes: 3,
    bundleIds: ['it-stack'],
    installMethod: 'oauth2',
    installCount: 890,
    featured: false,
    colorHex: '#6B4FBB',
    logoLetter: 'F',
    comingSoon: true,
  },

  // --- HR & Payroll (new) ---
  {
    id: 'keka',
    name: 'Keka HR',
    developer: 'Keka Technologies Pvt. Ltd.',
    category: 'hr',
    description: 'India\'s leading HR platform for payroll, attendance, and performance. Agents can fetch employee records, trigger payroll runs, and monitor leave balances.',
    permissions: ['Read employee profiles', 'Read payroll data', 'Read attendance records'],
    relatedAgentIds: ['hr_agent', 'payroll_agent'],
    actionsUnlocked: ['Fetch employee data', 'Check leave balances', 'Monitor attendance', 'Read payroll summaries'],
    setupTimeMinutes: 4,
    bundleIds: ['india-hr-stack', 'hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Keka API key', required: true },
      { name: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'yourcompany (from yourcompany.keka.com)', required: true },
    ],
    installCount: 1840,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E85D04',
    logoLetter: 'K',
  },
  {
    id: 'greythr',
    name: 'GreytHR',
    developer: 'Greytip Software Pvt. Ltd.',
    category: 'hr',
    description: 'Comprehensive HR and payroll solution built for Indian businesses. Streamline employee lifecycle management, compliance, and statutory reporting.',
    permissions: ['Read employee data', 'Read payroll reports', 'Read compliance data'],
    relatedAgentIds: ['hr_agent', 'compliance_agent'],
    actionsUnlocked: ['Fetch employee records', 'Read payroll data', 'Monitor compliance deadlines', 'Check PF/ESI status'],
    setupTimeMinutes: 4,
    bundleIds: ['india-hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your GreytHR API key', required: true },
      { name: 'subdomain', label: 'Account Subdomain', type: 'text', placeholder: 'yourcompany', required: true },
    ],
    installCount: 1320,
    featured: false,
    badge: 'India Priority',
    colorHex: '#1A9E6E',
    logoLetter: 'G',
  },
  {
    id: 'bamboohr',
    name: 'BambooHR',
    developer: 'Bamboo HR LLC',
    category: 'hr',
    description: 'HR software for small and medium businesses. Manage employee records, onboarding, time tracking, and performance reviews from one place.',
    permissions: ['Read employee directory', 'Read time-off requests', 'Read onboarding tasks'],
    relatedAgentIds: ['hr_agent', 'onboarding_agent'],
    actionsUnlocked: ['Fetch employee profiles', 'Check time-off balances', 'Monitor onboarding progress', 'Read org chart'],
    setupTimeMinutes: 3,
    bundleIds: ['hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your BambooHR API key', required: true },
      { name: 'subdomain', label: 'Company Domain', type: 'text', placeholder: 'yourcompany (from yourcompany.bamboohr.com)', required: true },
    ],
    installCount: 2100,
    featured: false,
    badge: 'Verified',
    colorHex: '#73AC39',
    logoLetter: 'B',
  },
  {
    id: 'freshteam',
    name: 'Freshteam',
    developer: 'Freshworks Inc.',
    category: 'hr',
    description: 'Smart HR software by Freshworks for recruiting, onboarding, time off, and employee information management. Built for fast-growing teams.',
    permissions: ['Read candidate profiles', 'Read employee data', 'Read job openings'],
    relatedAgentIds: ['hr_agent', 'recruitment_agent'],
    actionsUnlocked: ['Fetch job openings', 'Track candidate pipeline', 'Read employee records', 'Monitor time-off requests'],
    setupTimeMinutes: 3,
    bundleIds: ['hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Freshteam API key', required: true },
      { name: 'subdomain', label: 'Account Subdomain', type: 'text', placeholder: 'yourcompany', required: true },
    ],
    installCount: 1150,
    featured: false,
    badge: 'Verified',
    colorHex: '#0088CC',
    logoLetter: 'F',
  },

  // --- Recruitment (new) ---
  {
    id: 'naukri',
    name: 'Naukri RMS',
    developer: 'Info Edge (India) Ltd.',
    category: 'recruitment',
    description: 'India\'s #1 job platform. Access millions of candidates, post jobs, and let agents screen resumes, rank applicants, and schedule interviews automatically.',
    permissions: ['Read job postings', 'Read candidate applications', 'Read resume data'],
    relatedAgentIds: ['recruitment_agent', 'hr_agent'],
    actionsUnlocked: ['Fetch applications', 'Screen resumes', 'Rank candidates', 'Schedule interviews', 'Post job openings'],
    setupTimeMinutes: 5,
    bundleIds: ['india-hr-stack', 'recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Naukri RMS API key', required: true },
      { name: 'client_id', label: 'Client ID', type: 'text', placeholder: 'Your client ID', required: true },
    ],
    installCount: 3200,
    featured: true,
    badge: 'India Priority',
    colorHex: '#3399CC',
    logoLetter: 'N',
  },
  {
    id: 'shine',
    name: 'Shine.com',
    developer: 'HT Media Ltd.',
    category: 'recruitment',
    description: 'One of India\'s largest job portals. Connect agents to candidate pipelines for automated resume screening and talent discovery.',
    permissions: ['Read candidate profiles', 'Read job applications'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Fetch candidate profiles', 'Screen applications', 'Search talent pool'],
    setupTimeMinutes: 3,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Shine API key', required: true },
    ],
    installCount: 1080,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF6600',
    logoLetter: 'S',
  },
  {
    id: 'iimjobs',
    name: 'IIMJobs',
    developer: 'Taggd (Info Edge)',
    category: 'recruitment',
    description: 'Premium jobs platform for mid and senior management roles in India. Agents can surface top talent for leadership positions automatically.',
    permissions: ['Read candidate profiles', 'Read job postings'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Fetch senior candidates', 'Screen profiles', 'Monitor applications'],
    setupTimeMinutes: 3,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your IIMJobs API key', required: true },
    ],
    installCount: 680,
    featured: false,
    badge: 'India Priority',
    colorHex: '#C0392B',
    logoLetter: 'I',
  },
  {
    id: 'workable',
    name: 'Workable',
    developer: 'Workable Software Ltd.',
    category: 'recruitment',
    description: 'Modern ATS and hiring platform. Agents can track candidates, automate screening questions, and move applicants through your pipeline hands-free.',
    permissions: ['Read jobs and candidates', 'Read pipeline stages', 'Read candidate notes'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Fetch open roles', 'Track candidates', 'Automate screening', 'Post job updates'],
    setupTimeMinutes: 4,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Token', type: 'password', placeholder: 'Your Workable API token', required: true },
      { name: 'subdomain', label: 'Account Subdomain', type: 'text', placeholder: 'yourcompany', required: true },
    ],
    installCount: 950,
    featured: false,
    badge: 'Verified',
    colorHex: '#40B3E0',
    logoLetter: 'W',
  },

  // --- Communication (new) ---
  {
    id: 'whatsapp-business',
    name: 'WhatsApp Business',
    developer: 'Meta Platforms, Inc.',
    category: 'communication',
    description: 'Reach customers on the world\'s most popular messaging platform. Agents can send notifications, respond to queries, and run automated support flows over WhatsApp.',
    permissions: ['Send and receive messages', 'Read message templates', 'Send template messages'],
    relatedAgentIds: ['support_agent', 'outreach_agent'],
    actionsUnlocked: ['Send WhatsApp messages', 'Reply to customer queries', 'Send order/payment notifications', 'Run support flows'],
    setupTimeMinutes: 5,
    bundleIds: ['communication-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_token', label: 'Permanent Access Token', type: 'password', placeholder: 'Your Meta API access token', required: true },
      { name: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: 'From Meta Business Manager', required: true },
    ],
    installCount: 4500,
    featured: true,
    badge: 'Popular',
    colorHex: '#25D366',
    logoLetter: 'W',
  },

  // --- IT / DevOps (new) ---
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    developer: 'PagerDuty, Inc.',
    category: 'it',
    description: 'Incident management and alerting platform. Agents can create incidents, trigger escalation policies, and resolve alerts automatically based on real-time conditions.',
    permissions: ['Read and create incidents', 'Read on-call schedules', 'Trigger escalations'],
    relatedAgentIds: ['oncall_agent', 'incident_agent'],
    actionsUnlocked: ['Create incidents', 'Trigger alerts', 'Resolve incidents', 'Check on-call schedule', 'Escalate pages'],
    setupTimeMinutes: 3,
    bundleIds: ['devops-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your PagerDuty API key', required: true },
    ],
    installCount: 2300,
    featured: false,
    badge: 'Verified',
    colorHex: '#06AC38',
    logoLetter: 'P',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    developer: 'Datadog, Inc.',
    category: 'it',
    description: 'Cloud monitoring and security platform. Agents can query metrics, create monitors, retrieve logs, and trigger automated remediation when anomalies are detected.',
    permissions: ['Read metrics and monitors', 'Read logs', 'Create and mute monitors'],
    relatedAgentIds: ['oncall_agent', 'infra_agent'],
    actionsUnlocked: ['Query metrics', 'Fetch logs', 'Create monitors', 'Mute alerts', 'Trigger downtime'],
    setupTimeMinutes: 4,
    bundleIds: ['devops-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Datadog API key', required: true },
      { name: 'app_key', label: 'Application Key', type: 'password', placeholder: 'Your Datadog application key', required: true },
    ],
    installCount: 1980,
    featured: false,
    badge: 'Verified',
    colorHex: '#632CA6',
    logoLetter: 'D',
  },
  {
    id: 'newrelic',
    name: 'New Relic',
    developer: 'New Relic, Inc.',
    category: 'it',
    description: 'Full-stack observability platform. Agents can query APM data, fetch error traces, monitor throughput, and surface performance anomalies for automated triage.',
    permissions: ['Read application metrics', 'Read error traces', 'Query NRQL'],
    relatedAgentIds: ['oncall_agent', 'infra_agent'],
    actionsUnlocked: ['Query APM metrics', 'Fetch error traces', 'Monitor throughput', 'Run NRQL queries'],
    setupTimeMinutes: 4,
    bundleIds: ['devops-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your New Relic User API key', required: true },
      { name: 'account_id', label: 'Account ID', type: 'text', placeholder: 'Your New Relic account ID', required: true },
    ],
    installCount: 1540,
    featured: false,
    badge: 'Verified',
    colorHex: '#008C99',
    logoLetter: 'N',
  },

  // --- Marketing (new category) ---
  {
    id: 'brevo',
    name: 'Brevo',
    developer: 'Sendinblue SAS',
    category: 'marketing',
    description: 'Email, SMS, and marketing automation platform. Agents can send transactional emails, trigger campaigns, and track engagement metrics automatically.',
    permissions: ['Send emails and SMS', 'Read campaign stats', 'Manage contact lists'],
    relatedAgentIds: ['marketing_agent', 'outreach_agent'],
    actionsUnlocked: ['Send transactional emails', 'Trigger campaigns', 'Add contacts', 'Read open/click rates'],
    setupTimeMinutes: 3,
    bundleIds: ['marketing-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Brevo API key', required: true },
    ],
    installCount: 1650,
    featured: false,
    badge: 'Verified',
    colorHex: '#0B996E',
    logoLetter: 'B',
  },
  {
    id: 'moengage',
    name: 'MoEngage',
    developer: 'MoEngage Inc.',
    category: 'marketing',
    description: 'India-built customer engagement and retention platform. Agents can trigger push notifications, in-app messages, and personalised campaigns across channels.',
    permissions: ['Send push notifications', 'Send in-app messages', 'Read campaign analytics'],
    relatedAgentIds: ['marketing_agent'],
    actionsUnlocked: ['Trigger push notifications', 'Send in-app messages', 'Launch campaigns', 'Fetch engagement metrics'],
    setupTimeMinutes: 4,
    bundleIds: ['marketing-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your MoEngage API key', required: true },
      { name: 'app_id', label: 'App ID', type: 'text', placeholder: 'Your MoEngage App ID', required: true },
    ],
    installCount: 1420,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF5A00',
    logoLetter: 'M',
  },
  {
    id: 'clevertap',
    name: 'CleverTap',
    developer: 'CleverTap Inc.',
    category: 'marketing',
    description: 'Real-time customer engagement and retention platform. Agents can trigger personalised messages, A/B tests, and retention campaigns based on user behaviour.',
    permissions: ['Read user segments', 'Trigger campaigns', 'Read analytics'],
    relatedAgentIds: ['marketing_agent'],
    actionsUnlocked: ['Trigger user campaigns', 'Read retention metrics', 'Fetch segment data', 'Launch A/B tests'],
    setupTimeMinutes: 4,
    bundleIds: ['marketing-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'account_id', label: 'Account ID', type: 'text', placeholder: 'Your CleverTap account ID', required: true },
      { name: 'passcode', label: 'Passcode', type: 'password', placeholder: 'Your CleverTap passcode', required: true },
    ],
    installCount: 1280,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E8461C',
    logoLetter: 'C',
  },
  {
    id: 'mailmodo',
    name: 'Mailmodo',
    developer: 'Mailmodo Technologies Pvt. Ltd.',
    category: 'marketing',
    description: 'India-built interactive email platform. Send AMP emails with embedded forms, quizzes, and widgets. Agents can trigger campaigns and fetch engagement data.',
    permissions: ['Send emails', 'Read campaign analytics', 'Manage contact lists'],
    relatedAgentIds: ['marketing_agent'],
    actionsUnlocked: ['Send AMP emails', 'Trigger drip campaigns', 'Fetch open rates', 'Add to contact lists'],
    setupTimeMinutes: 3,
    bundleIds: ['marketing-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Mailmodo API key', required: true },
    ],
    installCount: 720,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF6B2B',
    logoLetter: 'M',
  },
  {
    id: 'webengage',
    name: 'WebEngage',
    developer: 'WebEngage Pvt. Ltd.',
    category: 'marketing',
    description: 'Full-stack retention marketing platform for B2C brands. Agents can trigger journeys, send push/email/SMS, and analyse cohort retention metrics.',
    permissions: ['Send push/email/SMS', 'Read user journeys', 'Read retention metrics'],
    relatedAgentIds: ['marketing_agent'],
    actionsUnlocked: ['Trigger user journeys', 'Send notifications', 'Fetch retention data', 'Read funnel metrics'],
    setupTimeMinutes: 4,
    bundleIds: ['marketing-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your WebEngage API key', required: true },
      { name: 'license_code', label: 'License Code', type: 'text', placeholder: 'Your WebEngage license code', required: true },
    ],
    installCount: 890,
    featured: false,
    badge: 'India Priority',
    colorHex: '#F4A200',
    logoLetter: 'W',
  },

  // --- Analytics (new category) ---
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    developer: 'Mixpanel, Inc.',
    category: 'analytics',
    description: 'Product analytics platform. Agents can query user events, track funnel conversion, fetch retention cohorts, and surface anomalies in product usage.',
    permissions: ['Read event data', 'Query funnels', 'Read retention reports'],
    relatedAgentIds: ['analytics_agent', 'product_agent'],
    actionsUnlocked: ['Query events', 'Fetch funnel data', 'Read cohort retention', 'Track user journeys'],
    setupTimeMinutes: 3,
    bundleIds: ['analytics-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'project_token', label: 'Project Token', type: 'text', placeholder: 'Your Mixpanel project token', required: true },
      { name: 'api_secret', label: 'API Secret', type: 'password', placeholder: 'Your Mixpanel API secret', required: true },
    ],
    installCount: 2450,
    featured: false,
    badge: 'Verified',
    colorHex: '#7856FF',
    logoLetter: 'M',
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    developer: 'Amplitude, Inc.',
    category: 'analytics',
    description: 'Digital analytics platform for understanding user behaviour. Agents can query charts, fetch event breakdowns, and detect drops in key product metrics.',
    permissions: ['Read chart data', 'Read user segments', 'Query event streams'],
    relatedAgentIds: ['analytics_agent'],
    actionsUnlocked: ['Query charts', 'Fetch event breakdowns', 'Read cohorts', 'Monitor metric anomalies'],
    setupTimeMinutes: 3,
    bundleIds: ['analytics-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'text', placeholder: 'Your Amplitude API key', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'Your Amplitude secret key', required: true },
    ],
    installCount: 2100,
    featured: false,
    badge: 'Verified',
    colorHex: '#1877F2',
    logoLetter: 'A',
  },
  {
    id: 'segment',
    name: 'Segment',
    developer: 'Twilio Inc.',
    category: 'analytics',
    description: 'Customer data platform. Agents can read unified customer profiles, trigger audience syncs, and access event streams across all your data sources.',
    permissions: ['Read customer profiles', 'Read event streams', 'Trigger audience syncs'],
    relatedAgentIds: ['analytics_agent', 'marketing_agent'],
    actionsUnlocked: ['Fetch customer profiles', 'Read event history', 'Trigger audience syncs', 'Query traits'],
    setupTimeMinutes: 4,
    bundleIds: ['analytics-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'write_key', label: 'Write Key', type: 'password', placeholder: 'Your Segment source write key', required: true },
    ],
    installCount: 1780,
    featured: false,
    badge: 'Verified',
    colorHex: '#52BD95',
    logoLetter: 'S',
  },
  {
    id: 'metabase',
    name: 'Metabase',
    developer: 'Metabase, Inc.',
    category: 'analytics',
    description: 'Open-source BI tool. Agents can query dashboards, run saved questions, and surface insights from your internal databases without writing SQL.',
    permissions: ['Read dashboards', 'Run saved questions', 'Read database schemas'],
    relatedAgentIds: ['analytics_agent'],
    actionsUnlocked: ['Run saved queries', 'Fetch dashboard data', 'Read database tables', 'Export results'],
    setupTimeMinutes: 5,
    bundleIds: ['analytics-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Metabase API key', required: true },
      { name: 'instance_url', label: 'Instance URL', type: 'text', placeholder: 'https://metabase.yourcompany.com', required: true },
    ],
    installCount: 1240,
    featured: false,
    badge: 'Verified',
    colorHex: '#509EE3',
    logoLetter: 'M',
  },

  // --- Finance India (new) ---
  {
    id: 'payu',
    name: 'PayU',
    developer: 'PayU Finance India Pvt. Ltd.',
    category: 'finance',
    description: 'Leading payment gateway in India. Agents can query transaction status, initiate refunds, and reconcile payment data across your PayU merchant account.',
    permissions: ['Read transactions', 'Initiate refunds', 'Read settlement reports'],
    relatedAgentIds: ['finance_ops_agent', 'refund_agent'],
    actionsUnlocked: ['Query transaction status', 'Initiate refunds', 'Fetch settlement data', 'Reconcile payments'],
    setupTimeMinutes: 4,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'merchant_key', label: 'Merchant Key', type: 'text', placeholder: 'Your PayU merchant key', required: true },
      { name: 'merchant_salt', label: 'Merchant Salt', type: 'password', placeholder: 'Your PayU merchant salt', required: true },
    ],
    installCount: 2800,
    featured: false,
    badge: 'India Priority',
    colorHex: '#F37021',
    logoLetter: 'P',
  },
  {
    id: 'cashfree',
    name: 'Cashfree Payments',
    developer: 'Cashfree Payments India Pvt. Ltd.',
    category: 'finance',
    description: 'Full-stack payments platform for Indian businesses. Agents can manage payouts, validate UPI payments, and reconcile bank settlements automatically.',
    permissions: ['Read payment orders', 'Initiate payouts', 'Read settlement data'],
    relatedAgentIds: ['finance_ops_agent'],
    actionsUnlocked: ['Initiate payouts', 'Query payment status', 'Fetch settlements', 'Validate UPI IDs'],
    setupTimeMinutes: 4,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'app_id', label: 'App ID', type: 'text', placeholder: 'Your Cashfree App ID', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'Your Cashfree secret key', required: true },
    ],
    installCount: 2200,
    featured: false,
    badge: 'India Priority',
    colorHex: '#00D09C',
    logoLetter: 'C',
  },

  // --- Legal / Compliance (new) ---
  {
    id: 'docusign',
    name: 'DocuSign',
    developer: 'DocuSign, Inc.',
    category: 'legal',
    description: 'World\'s #1 e-signature platform. Agents can send documents for signature, track envelope status, and trigger automated workflows when agreements are signed.',
    permissions: ['Send envelopes', 'Read envelope status', 'Download signed documents'],
    relatedAgentIds: ['legal_agent', 'hr_agent'],
    actionsUnlocked: ['Send signature requests', 'Track envelope status', 'Download signed docs', 'Trigger post-sign workflows'],
    setupTimeMinutes: 5,
    bundleIds: ['legal-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'integration_key', label: 'Integration Key', type: 'text', placeholder: 'Your DocuSign integration key (client ID)', required: true },
      { name: 'account_id', label: 'Account ID', type: 'text', placeholder: 'Your DocuSign account ID', required: true },
      { name: 'access_token', label: 'Access Token', type: 'password', placeholder: 'Your DocuSign access token', required: true },
    ],
    installCount: 1920,
    featured: false,
    badge: 'Verified',
    colorHex: '#FFCC01',
    logoLetter: 'D',
  },
  {
    id: 'leegality',
    name: 'Leegality',
    developer: 'Leegality Pvt. Ltd.',
    category: 'legal',
    description: 'India\'s leading e-signature and document automation platform. Agents can send Aadhaar-signed agreements, track status, and trigger onboarding flows on completion.',
    permissions: ['Send documents for signature', 'Track document status', 'Read signed documents'],
    relatedAgentIds: ['legal_agent', 'hr_agent'],
    actionsUnlocked: ['Send e-sign requests', 'Track document status', 'Fetch signed documents', 'Trigger post-sign automation'],
    setupTimeMinutes: 4,
    bundleIds: ['legal-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Leegality API key', required: true },
    ],
    installCount: 980,
    featured: false,
    badge: 'India Priority',
    colorHex: '#1A1A6B',
    logoLetter: 'L',
  },
  {
    id: 'zoho-sign',
    name: 'Zoho Sign',
    developer: 'Zoho Corporation Pvt. Ltd.',
    category: 'legal',
    description: 'E-signature and digital workflow platform from Zoho. Agents can send documents, collect multi-party signatures, and integrate with other Zoho apps.',
    permissions: ['Send documents for signature', 'Read document status', 'Manage templates'],
    relatedAgentIds: ['legal_agent'],
    actionsUnlocked: ['Send signature requests', 'Track signing status', 'Fetch signed documents', 'Use document templates'],
    setupTimeMinutes: 3,
    bundleIds: ['legal-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Zoho Sign API key', required: true },
    ],
    installCount: 1100,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E42527',
    logoLetter: 'Z',
  },

  // --- Support (new) ---
  {
    id: 'helpscout',
    name: 'Help Scout',
    developer: 'Help Scout PBC',
    category: 'support',
    description: 'Customer support platform built for meaningful conversations. Agents can read and respond to tickets, manage mailboxes, and surface customer history automatically.',
    permissions: ['Read conversations', 'Create replies', 'Read customer profiles'],
    relatedAgentIds: ['support_agent', 'triage_agent'],
    actionsUnlocked: ['Fetch conversations', 'Draft replies', 'Tag tickets', 'Read customer history', 'Assign conversations'],
    setupTimeMinutes: 3,
    bundleIds: ['support-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Help Scout API key', required: true },
    ],
    installCount: 1340,
    featured: false,
    badge: 'Verified',
    colorHex: '#1292EE',
    logoLetter: 'H',
  },

  // --- Coming Soon — OAuth2 providers (Phase B) ---
  {
    id: 'darwinbox',
    name: 'Darwinbox',
    developer: 'Darwinbox Digital Solutions Pvt. Ltd.',
    category: 'hr',
    description: 'Enterprise HR platform built for Asia. Manage the complete employee lifecycle — from hire to retire — with deep India-specific compliance and payroll features.',
    permissions: ['Read employee data', 'Read payroll', 'Read org structure'],
    relatedAgentIds: ['hr_agent'],
    actionsUnlocked: ['Fetch employee records', 'Read payroll data', 'Monitor org changes'],
    setupTimeMinutes: 5,
    bundleIds: ['india-hr-stack'],
    installMethod: 'oauth2',
    installCount: 2600,
    featured: false,
    badge: 'India Priority',
    colorHex: '#F05A28',
    logoLetter: 'D',
    comingSoon: true,
  },
  {
    id: 'rippling',
    name: 'Rippling',
    developer: 'Rippling People Center Inc.',
    category: 'hr',
    description: 'Workforce management platform that unifies HR, IT, and Finance. One platform to manage employees from onboarding to offboarding with full automation.',
    permissions: ['Read employee data', 'Read payroll', 'Read app provisioning'],
    relatedAgentIds: ['hr_agent', 'it_agent'],
    actionsUnlocked: ['Fetch employee records', 'Read payroll summaries', 'Monitor provisioning status'],
    setupTimeMinutes: 5,
    bundleIds: ['hr-stack'],
    installMethod: 'oauth2',
    installCount: 3100,
    featured: false,
    badge: 'Verified',
    colorHex: '#F7C520',
    logoLetter: 'R',
    comingSoon: true,
  },
  {
    id: 'workday',
    name: 'Workday',
    developer: 'Workday, Inc.',
    category: 'hr',
    description: 'Enterprise cloud platform for human capital management and finance. Agents can query workforce data, headcount, and payroll metrics at scale.',
    permissions: ['Read worker data', 'Read payroll', 'Read financial data'],
    relatedAgentIds: ['hr_agent', 'finance_ops_agent'],
    actionsUnlocked: ['Fetch workforce data', 'Query headcount', 'Read payroll summaries', 'Monitor finance metrics'],
    setupTimeMinutes: 8,
    bundleIds: ['hr-stack'],
    installMethod: 'oauth2',
    installCount: 4200,
    featured: false,
    badge: 'Verified',
    colorHex: '#F5A623',
    logoLetter: 'W',
    comingSoon: true,
  },
  {
    id: 'lever',
    name: 'Lever',
    developer: 'Lever, Inc.',
    category: 'recruitment',
    description: 'Modern applicant tracking system with CRM capabilities. Agents can manage requisitions, track candidates, and automate interview scheduling.',
    permissions: ['Read candidates', 'Read opportunities', 'Read postings'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Fetch candidates', 'Track opportunities', 'Read postings', 'Monitor interview stages'],
    setupTimeMinutes: 5,
    bundleIds: ['recruitment-stack'],
    installMethod: 'oauth2',
    installCount: 1540,
    featured: false,
    badge: 'Verified',
    colorHex: '#4BB8A9',
    logoLetter: 'L',
    comingSoon: true,
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    developer: 'SmartRecruiters Inc.',
    category: 'recruitment',
    description: 'Enterprise talent acquisition platform. Agents can source candidates, track pipeline health, and automate recruiter workflows across departments.',
    permissions: ['Read candidates', 'Read job postings', 'Read pipeline stages'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Fetch candidates', 'Track pipeline', 'Read job postings', 'Monitor hiring velocity'],
    setupTimeMinutes: 5,
    bundleIds: ['recruitment-stack'],
    installMethod: 'oauth2',
    installCount: 1180,
    featured: false,
    badge: 'Verified',
    colorHex: '#1B8755',
    logoLetter: 'S',
    comingSoon: true,
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    developer: 'Microsoft Corporation',
    category: 'communication',
    description: 'Enterprise collaboration hub. Agents can post messages to channels, send adaptive cards, create meetings, and surface real-time alerts to the right teams.',
    permissions: ['Send channel messages', 'Read team memberships', 'Create meetings'],
    relatedAgentIds: ['oncall_agent', 'hr_agent'],
    actionsUnlocked: ['Post to channels', 'Send direct messages', 'Create meetings', 'Post adaptive cards'],
    setupTimeMinutes: 5,
    bundleIds: ['communication-stack'],
    installMethod: 'oauth2',
    installCount: 9200,
    featured: true,
    badge: 'Popular',
    colorHex: '#5059C9',
    logoLetter: 'T',
    comingSoon: true,
  },
  {
    id: 'zoom',
    name: 'Zoom',
    developer: 'Zoom Video Communications, Inc.',
    category: 'communication',
    description: 'Video-first communication platform. Agents can create meetings, send invites, retrieve recordings, and monitor webinar attendance automatically.',
    permissions: ['Create meetings', 'Read recordings', 'Read webinar data'],
    relatedAgentIds: ['hr_agent', 'support_agent'],
    actionsUnlocked: ['Create meetings', 'Send invites', 'Fetch recordings', 'Monitor webinar attendance'],
    setupTimeMinutes: 4,
    bundleIds: ['communication-stack'],
    installMethod: 'oauth2',
    installCount: 7800,
    featured: true,
    badge: 'Popular',
    colorHex: '#2D8CFF',
    logoLetter: 'Z',
    comingSoon: true,
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    developer: 'Google LLC',
    category: 'communication',
    description: 'Messaging and collaboration for Google Workspace teams. Agents can send messages to spaces, post cards, and surface alerts directly in Chat.',
    permissions: ['Send messages to spaces', 'Read space memberships', 'Post cards'],
    relatedAgentIds: ['oncall_agent'],
    actionsUnlocked: ['Post to spaces', 'Send DMs', 'Post interactive cards', 'Notify teams'],
    setupTimeMinutes: 4,
    bundleIds: ['communication-stack'],
    installMethod: 'oauth2',
    installCount: 4100,
    featured: false,
    badge: 'Verified',
    colorHex: '#1A73E8',
    logoLetter: 'G',
    comingSoon: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    developer: 'GitHub, Inc.',
    category: 'it',
    description: 'World\'s largest code hosting platform. Agents can open issues, comment on PRs, fetch CI status, and trigger automated workflows on repository events.',
    permissions: ['Read repositories', 'Read and create issues', 'Read pull requests'],
    relatedAgentIds: ['devops_agent', 'incident_agent'],
    actionsUnlocked: ['Open issues', 'Comment on PRs', 'Fetch CI status', 'Read repo activity', 'Trigger workflows'],
    setupTimeMinutes: 4,
    bundleIds: ['devops-stack'],
    installMethod: 'oauth2',
    installCount: 8900,
    featured: true,
    badge: 'Popular',
    colorHex: '#24292E',
    logoLetter: 'G',
    comingSoon: true,
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    developer: 'GitLab Inc.',
    category: 'it',
    description: 'Complete DevSecOps platform. Agents can query pipeline status, read merge requests, open issues, and monitor CI/CD failures across your GitLab projects.',
    permissions: ['Read projects', 'Read pipelines', 'Read merge requests'],
    relatedAgentIds: ['devops_agent'],
    actionsUnlocked: ['Fetch pipeline status', 'Read MRs', 'Open issues', 'Monitor CI failures'],
    setupTimeMinutes: 4,
    bundleIds: ['devops-stack'],
    installMethod: 'oauth2',
    installCount: 4600,
    featured: false,
    badge: 'Verified',
    colorHex: '#FC6D26',
    logoLetter: 'G',
    comingSoon: true,
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    developer: 'ServiceNow, Inc.',
    category: 'it',
    description: 'Enterprise IT service management platform. Agents can create and update incidents, read change requests, and automate ITSM workflows at scale.',
    permissions: ['Read and create incidents', 'Read change requests', 'Read CMDB'],
    relatedAgentIds: ['it_agent', 'incident_agent'],
    actionsUnlocked: ['Create incidents', 'Update tickets', 'Read change requests', 'Query CMDB', 'Trigger workflows'],
    setupTimeMinutes: 8,
    bundleIds: ['devops-stack'],
    installMethod: 'oauth2',
    installCount: 3800,
    featured: false,
    badge: 'Verified',
    colorHex: '#81B5A1',
    logoLetter: 'S',
    comingSoon: true,
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    developer: 'The Rocket Science Group LLC',
    category: 'marketing',
    description: 'Email marketing and automation platform. Agents can send campaigns, manage audience segments, and surface open/click metrics for performance monitoring.',
    permissions: ['Send campaigns', 'Manage audiences', 'Read campaign stats'],
    relatedAgentIds: ['marketing_agent'],
    actionsUnlocked: ['Send email campaigns', 'Add/remove subscribers', 'Read open rates', 'Trigger automation'],
    setupTimeMinutes: 4,
    bundleIds: ['marketing-stack'],
    installMethod: 'oauth2',
    installCount: 5400,
    featured: false,
    badge: 'Popular',
    colorHex: '#FFE01B',
    logoLetter: 'M',
    comingSoon: true,
  },
  {
    id: 'posthog',
    name: 'PostHog',
    developer: 'PostHog Inc.',
    category: 'analytics',
    description: 'Open-source product analytics with session recording and feature flags. Agents can query funnels, read session replays, and toggle feature flags automatically.',
    permissions: ['Read events', 'Query funnels', 'Read feature flags', 'Read session recordings'],
    relatedAgentIds: ['analytics_agent', 'product_agent'],
    actionsUnlocked: ['Query events', 'Fetch funnel data', 'Read session replays', 'Toggle feature flags'],
    setupTimeMinutes: 4,
    bundleIds: ['analytics-stack'],
    installMethod: 'oauth2',
    installCount: 1620,
    featured: false,
    badge: 'Verified',
    colorHex: '#1D4ED8',
    logoLetter: 'P',
    comingSoon: true,
  },
];

// ---------------------------------------------------------------------------
// Helper: get installed app health data for an org
// ---------------------------------------------------------------------------
type InstalledAppHealth = {
  service_type: string;
  status: string;
  last_sync_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
  connectionSource: 'marketplace' | 'connections';
};

export async function getInstalledAppHealth(orgId: string): Promise<Map<string, InstalledAppHealth>> {
  try {
    // Fetch all integrations for the org — both marketplace-installed and spec-driven.
    // This lets marketplace apps appear "installed" even when connected via the
    // Integrations/Connections flow, giving users a unified view.
    // Exclude waitlisted entries — those are not yet installed.
    const rows = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eq(orgId),
      status: 'neq.waitlisted',
      select: 'service_type,status,last_sync_at,last_error_at,last_error_msg,metadata',
    }))) as Array<{
      service_type: string;
      status: string;
      last_sync_at: string | null;
      last_error_at: string | null;
      last_error_msg: string | null;
      metadata?: Record<string, unknown> | null;
    }>;
    const map = new Map<string, InstalledAppHealth>();
    (rows || []).forEach((r) => {
      // Prefer marketplace rows when both exist for the same service_type.
      const isMarketplace = r.metadata?.marketplace_app === 'true';
      const existing = map.get(r.service_type);
      if (existing && existing.connectionSource === 'marketplace' && !isMarketplace) return;
      map.set(r.service_type, {
        service_type: r.service_type,
        status: r.status,
        last_sync_at: r.last_sync_at,
        last_error_at: r.last_error_at,
        last_error_msg: r.last_error_msg,
        connectionSource: isMarketplace ? 'marketplace' : 'connections',
      });
    });
    return map;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /marketplace/bundles — app bundle definitions
router.get('/bundles', (_req: Request, res: Response) => {
  return res.json({ success: true, data: APP_BUNDLES });
});

// GET /marketplace/apps — full catalog with installation status + health
router.get('/apps', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const healthMap = await getInstalledAppHealth(orgId);
    const apps = PARTNER_APP_CATALOG.map((app) => {
      const health = healthMap.get(app.id);
      return {
        ...app,
        installed: healthMap.has(app.id),
        connectionStatus: health?.status ?? null,
        lastSyncAt: health?.last_sync_at ?? null,
        lastErrorAt: health?.last_error_at ?? null,
        lastErrorMsg: health?.last_error_msg ?? null,
        connectionSource: health?.connectionSource ?? null,
      };
    });

    return res.json({ success: true, data: apps });
  } catch (error: any) {
    logger.error('Failed to list marketplace apps', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /marketplace/apps/installed — only installed apps for this org
router.get('/apps/installed', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const healthMap = await getInstalledAppHealth(orgId);
    const apps = PARTNER_APP_CATALOG
      .filter((app) => healthMap.has(app.id))
      .map((app) => {
        const health = healthMap.get(app.id)!;
        return {
          ...app,
          installed: true,
          connectionStatus: health.status,
          lastSyncAt: health.last_sync_at,
          lastErrorAt: health.last_error_at,
          lastErrorMsg: health.last_error_msg,
          connectionSource: health.connectionSource,
        };
      });

    return res.json({ success: true, data: apps });
  } catch (error: any) {
    logger.error('Failed to list installed apps', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

const installSchema = z.object({
  credentials: z.record(z.string()).optional().default({}),
});

// POST /marketplace/apps/:id/install — install a partner app
router.post('/apps/:id/install', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const app = PARTNER_APP_CATALOG.find((a) => a.id === req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'App not found' });

    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }

    // For OAuth apps: build real auth URL and store state for callback verification
    if (app.installMethod === 'oauth2') {
      const state = crypto.randomUUID();
      const callbackUrl = `${process.env.API_URL || 'http://localhost:3001'}/api/marketplace/oauth/callback`;
      const authUrl = buildOAuthUrl(app.id, state, callbackUrl);

      if (!authUrl) {
        return res.status(400).json({
          success: false,
          error: `OAuth for ${app.name} is not yet configured. Contact your administrator to set up the required credentials.`,
        });
      }

      // Store state for verification on callback
      await supabaseRestAsService('integration_oauth_states', '', {
        method: 'POST',
        body: {
          state,
          organization_id: orgId,
          user_id: (req.user as any)?.id ?? null,
          provider_name: app.id,
          app_id: app.id,
          redirect_uri: callbackUrl,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      });

      return res.json({
        success: true,
        oauth: true,
        state,
        authUrl,
        message: `Redirect to ${app.name} to authorize access.`,
      });
    }

    // Validate required fields for api_key apps
    if (app.installMethod === 'api_key' && app.requiredFields) {
      const missing = app.requiredFields
        .filter((f) => f.required && !parsed.data.credentials[f.name])
        .map((f) => f.label);
      if (missing.length > 0) {
        return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
      }
    }

    const now = new Date().toISOString();

    // Check if any row already exists for this org + service_type (any status, any source)
    const existingRows = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eq(orgId),
      service_type: eq(app.id),
      select: 'id,status',
      limit: '1',
    }))) as Array<{ id: string; status: string }>;

    let integrationId: string;

    if (existingRows?.length > 0) {
      // Row exists (waitlisted, configured, or from the old integrations system) — update in place
      integrationId = existingRows[0].id;
      await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(integrationId) }), {
        method: 'PATCH',
        body: {
          service_name: app.name,
          category: app.category.toUpperCase(),
          auth_type: app.installMethod,
          status: 'configured',
          ai_enabled: true,
          updated_at: now,
          metadata: { marketplace_app: 'true', developer: app.developer },
        },
      });
    } else {
      // No existing row — create one
      const integrationBody = {
        organization_id: orgId,
        service_type: app.id,
        service_name: app.name,
        category: app.category.toUpperCase(),
        auth_type: app.installMethod,
        status: 'configured',
        ai_enabled: true,
        created_at: now,
        updated_at: now,
        metadata: { marketplace_app: 'true', developer: app.developer },
      };

      const created = (await supabaseRestAsService('integrations', '', {
        method: 'POST',
        body: integrationBody,
      })) as any[];

      const integration = Array.isArray(created) ? created[0] : created;
      integrationId = integration?.id;

      if (!integrationId) {
        return res.status(500).json({ success: false, error: 'Failed to create integration record' });
      }
    }

    // Store credentials (encrypted)
    if (app.installMethod === 'api_key' && Object.keys(parsed.data.credentials).length > 0) {
      const credInserts = await Promise.allSettled(
        Object.entries(parsed.data.credentials).map(async ([key, value]) => {
          const field = app.requiredFields?.find((f) => f.name === key);
          const isSensitive = field?.type === 'password';
          const encrypted = isSensitive ? await encryptSecret(value) : value;
          return supabaseRestAsService('integration_credentials', '', {
            method: 'POST',
            body: {
              integration_id: integrationId,
              key,
              value: encrypted,
              is_sensitive: isSensitive,
              label: field?.label || key,
              created_at: now,
              updated_at: now,
            },
          });
        })
      );
      const failed = credInserts.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        logger.warn('Some credentials failed to store', { integrationId, count: failed.length });
      }
    }

    logger.info('Marketplace app installed', { app_id: app.id, org_id: orgId, integration_id: integrationId });

    return res.status(201).json({
      success: true,
      integration_id: integrationId,
      message: `${app.name} has been installed successfully.`,
    });
  } catch (error: any) {
    logger.error('Failed to install marketplace app', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /marketplace/apps/:id — uninstall a partner app
router.delete('/apps/:id', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    // Find and remove the integration record (any row for this org + service_type)
    const rows = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eq(orgId),
      service_type: eq(req.params.id),
      select: 'id',
      limit: '1',
    }))) as Array<{ id: string }>;

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'App not installed' });
    }

    const integrationId = rows[0].id;

    await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(integrationId) }), {
      method: 'DELETE',
    });

    logger.info('Marketplace app uninstalled', { app_id: req.params.id, org_id: orgId });

    return res.json({ success: true, message: 'App uninstalled.' });
  } catch (error: any) {
    logger.error('Failed to uninstall marketplace app', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /marketplace/apps/:id/credentials — update credentials for an installed app
router.patch('/apps/:id/credentials', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const app = PARTNER_APP_CATALOG.find((a) => a.id === req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'App not found' });

    const parsed = z.object({ credentials: z.record(z.string()) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }

    const creds: Record<string, string> = parsed.data.credentials;

    if (Object.keys(creds).length === 0) {
      return res.status(400).json({ success: false, error: 'No credentials provided' });
    }

    // Find the existing integration (any row for this org + service_type)
    const rows = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eq(orgId),
      service_type: eq(app.id),
      select: 'id',
      limit: '1',
    }))) as Array<{ id: string }>;

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'App not installed' });
    }

    const integrationId = rows[0].id;
    const now = new Date().toISOString();

    // Upsert each credential
    await Promise.allSettled(
      Object.entries(creds).map(async ([key, value]) => {
        const field = app.requiredFields?.find((f) => f.name === key);
        const isSensitive = field?.type === 'password';
        const stored = isSensitive ? await encryptSecret(value) : value;
        return supabaseRestAsService(
          'integration_credentials',
          new URLSearchParams({ on_conflict: 'integration_id,key' }),
          {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
            body: {
              integration_id: integrationId,
              key,
              value: stored,
              is_sensitive: isSensitive,
              label: field?.label || key,
              updated_at: now,
            },
          }
        );
      })
    );

    // Touch updated_at on the integration itself
    await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(integrationId) }), {
      method: 'PATCH',
      body: { updated_at: now },
    });

    logger.info('Marketplace credentials updated', { app_id: app.id, org_id: orgId });
    return res.json({ success: true, message: 'Credentials updated successfully.' });
  } catch (error: any) {
    logger.error('Failed to update credentials', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /marketplace/apps/:id/test — test an app's credentials
router.post('/apps/:id/test', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const app = PARTNER_APP_CATALOG.find((a) => a.id === req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'App not found' });

    const { credentials = {} } = req.body as { credentials?: Record<string, string> };

    // Validate all required fields are present and non-empty
    if (app.requiredFields) {
      const missing = app.requiredFields
        .filter((f) => f.required && !credentials[f.name]?.trim())
        .map((f) => f.label);
      if (missing.length > 0) {
        return res.json({ success: false, message: `Missing required fields: ${missing.join(', ')}` });
      }
    }

    let testSuccess = true;
    let testMessage = `${app.name} credentials look valid.`;

    // Provider-specific live check for apps where it's easy and safe
    if (app.id === 'stripe' && credentials.secret_key) {
      try {
        const stripeRes = await fetch('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${credentials.secret_key}` },
        });
        if (stripeRes.ok) {
          testMessage = 'Stripe connection verified successfully.';
        } else {
          testSuccess = false;
          testMessage = stripeRes.status === 401
            ? 'Invalid Stripe secret key. Please check and try again.'
            : `Stripe returned status ${stripeRes.status}.`;
        }
      } catch {
        testSuccess = false;
        testMessage = 'Could not reach Stripe API. Check your network connectivity.';
      }
    }

    // Update integration status if we have one stored
    const rows = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eq(orgId),
      service_type: eq(app.id),
      'metadata->>marketplace_app': eq('true'),
      select: 'id',
      limit: '1',
    }))) as Array<{ id: string }>;

    if (rows?.length > 0) {
      await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(rows[0].id) }), {
        method: 'PATCH',
        body: {
          status: testSuccess ? 'connected' : 'error',
          last_error_msg: testSuccess ? null : testMessage,
          last_error_at: testSuccess ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }

    return res.json({ success: testSuccess, message: testMessage });
  } catch (error: any) {
    logger.error('Failed to test connection', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /marketplace/apps/:id/notify — join the waitlist for a Coming Soon app
router.post('/apps/:id/notify', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const app = PARTNER_APP_CATALOG.find((a) => a.id === req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'App not found' });
    if (!app.comingSoon) {
      return res.status(400).json({ success: false, error: 'This app is already available to install.' });
    }

    // Check for existing entry (idempotent)
    const existing = (await supabaseRestAsService('integrations', new URLSearchParams({
      organization_id: eq(orgId),
      service_type: eq(app.id),
      'metadata->>marketplace_app': eq('true'),
      select: 'id,status',
      limit: '1',
    }))) as Array<{ id: string; status: string }>;

    if (existing?.length > 0) {
      return res.json({ success: true, message: `You're already on the waitlist for ${app.name}.` });
    }

    const now = new Date().toISOString();
    await supabaseRestAsService('integrations', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        service_type: app.id,
        service_name: app.name,
        category: app.category.toUpperCase(),
        auth_type: app.installMethod,
        status: 'waitlisted',
        ai_enabled: false,
        created_at: now,
        updated_at: now,
        metadata: { marketplace_app: 'true', waitlisted: 'true', developer: app.developer },
      },
    });

    logger.info('Marketplace waitlist signup', { app_id: app.id, org_id: orgId });
    return res.json({ success: true, message: `You'll be notified when ${app.name} is available.` });
  } catch (error: any) {
    logger.error('Failed to join waitlist', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /marketplace/oauth/callback — OAuth2 authorization callback (public route — no auth middleware)
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const enc = encodeURIComponent;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const { code, state, error: oauthError, 'accounts-server': zohoAccountsServer } = req.query as Record<string, string>;

  if (oauthError) {
    return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_error=${enc(oauthError)}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_error=${enc('MissingCodeOrState')}`);
  }

  // Look up the state record
  const stateRows = (await supabaseRestAsService('integration_oauth_states', new URLSearchParams({
    state: eq(state),
    consumed_at: 'is.null',
    select: '*',
    limit: '1',
  }))) as any[];

  if (!stateRows?.length) {
    return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_error=${enc('InvalidOrExpiredState')}`);
  }

  const stateRow = stateRows[0];
  const appId = (stateRow.app_id || stateRow.provider_name) as string;
  const app = PARTNER_APP_CATALOG.find((a) => a.id === appId);

  if (!app) {
    return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_error=${enc('UnknownApp')}`);
  }

  // Exchange code for tokens
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let exchangeError: string | null = null;

  try {
    const result = await exchangeOAuthCode(appId, code, stateRow.redirect_uri as string, zohoAccountsServer ? { zohoAccountsServer } : undefined);
    accessToken = result.accessToken;
    refreshToken = result.refreshToken ?? null;
  } catch (e: any) {
    exchangeError = e.message;
  }

  if (!accessToken) {
    return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_error=${enc(exchangeError || 'TokenExchangeFailed')}&marketplace_app=${enc(appId)}`);
  }

  const now = new Date().toISOString();
  const orgId = stateRow.organization_id as string;

  // Create or update integration — handle waitlisted rows
  const existingRows = (await supabaseRestAsService('integrations', new URLSearchParams({
    organization_id: eq(orgId),
    service_type: eq(appId),
    'metadata->>marketplace_app': eq('true'),
    select: 'id',
    limit: '1',
  }))) as Array<{ id: string }>;

  let integrationId: string;

  if (existingRows?.length > 0) {
    integrationId = existingRows[0].id;
    await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(integrationId) }), {
      method: 'PATCH',
      body: { status: 'connected', ai_enabled: true, updated_at: now },
    });
  } else {
    const created = (await supabaseRestAsService('integrations', '', {
      method: 'POST',
      body: {
        organization_id: orgId,
        service_type: appId,
        service_name: app.name,
        category: app.category.toUpperCase(),
        auth_type: 'oauth2',
        status: 'connected',
        ai_enabled: true,
        created_at: now,
        updated_at: now,
        metadata: { marketplace_app: 'true', developer: app.developer },
      },
    })) as any[];
    const record = Array.isArray(created) ? created[0] : created;
    integrationId = record?.id;
  }

  // Store tokens
  if (integrationId) {
    const encAccess = await encryptSecret(accessToken);
    await supabaseRestAsService(
      'integration_credentials',
      new URLSearchParams({ on_conflict: 'integration_id,key' }),
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: { integration_id: integrationId, key: 'access_token', value: encAccess, is_sensitive: true, label: 'Access Token', updated_at: now },
      }
    );
    if (refreshToken) {
      const encRefresh = await encryptSecret(refreshToken);
      await supabaseRestAsService(
        'integration_credentials',
        new URLSearchParams({ on_conflict: 'integration_id,key' }),
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: { integration_id: integrationId, key: 'refresh_token', value: encRefresh, is_sensitive: true, label: 'Refresh Token', updated_at: now },
        }
      );
    }
  }

  // Mark state consumed
  await supabaseRestAsService('integration_oauth_states', new URLSearchParams({ id: eq(stateRow.id) }), {
    method: 'PATCH',
    body: { consumed_at: now },
  });

  logger.info('Marketplace OAuth completed', { app_id: appId, org_id: orgId });
  return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_connected=true&marketplace_app=${enc(appId)}`);
});

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

function buildOAuthUrl(appId: string, state: string, redirectUri: string): string | null {
  const enc = encodeURIComponent;
  switch (appId) {
    case 'hubspot':
      if (!process.env.HUBSPOT_CLIENT_ID) return null;
      return `https://app.hubspot.com/oauth/authorize?client_id=${enc(process.env.HUBSPOT_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=oauth%20crm.objects.contacts.read%20crm.objects.deals.read&state=${state}`;
    case 'salesforce':
      if (!process.env.SALESFORCE_CLIENT_ID) return null;
      return `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${enc(process.env.SALESFORCE_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&state=${state}`;
    case 'quickbooks':
      if (!process.env.QUICKBOOKS_CLIENT_ID) return null;
      return `https://appcenter.intuit.com/connect/oauth2?client_id=${enc(process.env.QUICKBOOKS_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&response_type=code&scope=com.intuit.quickbooks.accounting&state=${state}`;
    case 'intercom':
      if (!process.env.INTERCOM_CLIENT_ID) return null;
      return `https://app.intercom.com/oauth?client_id=${enc(process.env.INTERCOM_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&state=${state}`;
    case 'linkedin-recruiter':
      if (!process.env.LINKEDIN_CLIENT_ID) return null;
      return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${enc(process.env.LINKEDIN_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=openid%20profile%20email&state=${state}`;
    case 'xero':
      if (!process.env.XERO_CLIENT_ID) return null;
      return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${enc(process.env.XERO_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=offline_access%20accounting.transactions&state=${state}`;
    case 'google-workspace':
      if (!process.env.GOOGLE_CLIENT_ID) return null;
      return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${enc(process.env.GOOGLE_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=${enc('openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/admin.directory.user.readonly')}&access_type=offline&prompt=consent&state=${state}`;
    case 'microsoft-365':
      if (!process.env.MICROSOFT_CLIENT_ID) return null;
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?response_type=code&client_id=${enc(process.env.MICROSOFT_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=${enc('openid email profile offline_access User.Read Mail.Send Calendars.ReadWrite Team.ReadBasic.All')}&state=${state}`;
    case 'slack':
      if (!process.env.SLACK_CLIENT_ID) return null;
      return `https://slack.com/oauth/v2/authorize?client_id=${enc(process.env.SLACK_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=chat%3Awrite%2Cchannels%3Ahistory%2Cusers%3Aread%2Cchannels%3Aread&state=${state}`;
    case 'zoho':
      if (!process.env.ZOHO_CLIENT_ID) return null;
      return `https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=${enc(process.env.ZOHO_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=${enc('ZohoCRM.modules.contacts.ALL ZohoCRM.modules.deals.ALL ZohoPeople.employee.ALL')}&access_type=offline&state=${state}`;
    case 'deel':
      if (!process.env.DEEL_CLIENT_ID) return null;
      return `https://app.deel.com/oauth2/authorize?response_type=code&client_id=${enc(process.env.DEEL_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=contracts%3Aread%20payslips%3Aread%20workers%3Aread&state=${state}`;
    case 'gusto':
      if (!process.env.GUSTO_CLIENT_ID) return null;
      return `https://api.gusto.com/oauth/authorize?response_type=code&client_id=${enc(process.env.GUSTO_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&state=${state}`;
    case 'flock':
      if (!process.env.FLOCK_CLIENT_ID) return null;
      return `https://api.flock.com/v2/auth/authorize?response_type=code&client_id=${enc(process.env.FLOCK_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&state=${state}`;
    default:
      return null;
  }
}

async function exchangeOAuthCode(
  appId: string,
  code: string,
  redirectUri: string,
  extraParams?: Record<string, string>
): Promise<{ accessToken: string; refreshToken?: string }> {
  let tokenUrl: string;
  let params: Record<string, string>;

  switch (appId) {
    case 'hubspot':
      tokenUrl = 'https://api.hubapi.com/oauth/v1/token';
      params = { grant_type: 'authorization_code', client_id: process.env.HUBSPOT_CLIENT_ID!, client_secret: process.env.HUBSPOT_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'salesforce':
      tokenUrl = 'https://login.salesforce.com/services/oauth2/token';
      params = { grant_type: 'authorization_code', client_id: process.env.SALESFORCE_CLIENT_ID!, client_secret: process.env.SALESFORCE_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'quickbooks':
      tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
      params = { grant_type: 'authorization_code', client_id: process.env.QUICKBOOKS_CLIENT_ID!, client_secret: process.env.QUICKBOOKS_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'intercom':
      tokenUrl = 'https://api.intercom.io/auth/eagle/token';
      params = { code, client_id: process.env.INTERCOM_CLIENT_ID!, client_secret: process.env.INTERCOM_CLIENT_SECRET! };
      break;
    case 'linkedin-recruiter':
      tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
      params = { grant_type: 'authorization_code', code, client_id: process.env.LINKEDIN_CLIENT_ID!, client_secret: process.env.LINKEDIN_CLIENT_SECRET!, redirect_uri: redirectUri };
      break;
    case 'xero':
      tokenUrl = 'https://identity.xero.com/connect/token';
      params = { grant_type: 'authorization_code', client_id: process.env.XERO_CLIENT_ID!, client_secret: process.env.XERO_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'google-workspace':
      tokenUrl = 'https://oauth2.googleapis.com/token';
      params = { grant_type: 'authorization_code', client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'microsoft-365':
      tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
      params = { grant_type: 'authorization_code', client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'slack':
      tokenUrl = 'https://slack.com/api/oauth.v2.access';
      params = { grant_type: 'authorization_code', client_id: process.env.SLACK_CLIENT_ID!, client_secret: process.env.SLACK_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'zoho':
      tokenUrl = `${extraParams?.zohoAccountsServer || 'https://accounts.zoho.com'}/oauth/v2/token`;
      params = { grant_type: 'authorization_code', client_id: process.env.ZOHO_CLIENT_ID!, client_secret: process.env.ZOHO_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'deel':
      tokenUrl = 'https://app.deel.com/oauth2/token';
      params = { grant_type: 'authorization_code', client_id: process.env.DEEL_CLIENT_ID!, client_secret: process.env.DEEL_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'gusto':
      tokenUrl = 'https://api.gusto.com/oauth/token';
      params = { grant_type: 'authorization_code', client_id: process.env.GUSTO_CLIENT_ID!, client_secret: process.env.GUSTO_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    case 'flock':
      tokenUrl = 'https://api.flock.com/v2/auth/token';
      params = { grant_type: 'authorization_code', client_id: process.env.FLOCK_CLIENT_ID!, client_secret: process.env.FLOCK_CLIENT_SECRET!, redirect_uri: redirectUri, code };
      break;
    default:
      throw new Error(`No token exchange configured for app: ${appId}`);
  }

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await resp.json() as any;
  if (!resp.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${resp.status})`);
  }
  return { accessToken: json.access_token as string, refreshToken: json.refresh_token as string | undefined };
}

export default router;
