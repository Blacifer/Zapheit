import express, { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { encryptSecret } from '../lib/integrations/encryption';
import { eq, supabaseRestAsService } from '../lib/supabase-rest';
import { installApp, uninstallApp } from '../services/marketplace-service';

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
  is_certified?: boolean;
  colorHex: string;
  logoLetter: string;
  comingSoon?: boolean;
};

/** Apps that have passed Zapheit's integration review and carry the Certified badge */
const CERTIFIED_APP_IDS = new Set([
  'slack', 'zoho-people', 'workday', 'sap-successfactors', 'bamboohr',
  'jira', 'zendesk', 'salesforce', 'google-workspace', 'microsoft-teams',
]);

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
  {
    id: 'productivity-stack',
    name: 'Productivity Stack',
    description: 'Connect your team\'s daily tools — docs, design, scheduling, and automation.',
    intentLabel: 'Productivity',
    appIds: ['notion', 'figma', 'calendly', 'zapier'],
    colorHex: '#0891B2',
    icon: 'Layers',
  },
  {
    id: 'india-compliance-stack',
    name: 'India Compliance Stack',
    description: 'Government portals and compliance tools for India-registered businesses.',
    intentLabel: 'India Compliance',
    appIds: ['epfo', 'aadhaar-api', 'cleartax', 'vanta'],
    colorHex: '#0369A1',
    icon: 'Gavel',
  },
  {
    id: 'cloud-stack',
    name: 'Cloud Infrastructure Stack',
    description: 'Monitor and govern your cloud footprint across AWS, Azure, and GCP.',
    intentLabel: 'Cloud Infra',
    appIds: ['aws', 'azure', 'gcp', 'datadog'],
    colorHex: '#EA580C',
    icon: 'Wrench',
  },
  {
    id: 'india-fintech-stack',
    name: 'India Fintech Stack',
    description: 'Payments, payroll, and banking APIs purpose-built for Indian markets.',
    intentLabel: 'India Fintech',
    appIds: ['razorpay', 'paytm-business', 'cashfree', 'razorpayx'],
    colorHex: '#DC2626',
    icon: 'HandCoins',
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
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_token', label: 'Personal Access Token', type: 'password', placeholder: 'ghp_...', required: true },
    ],
    installCount: 8900,
    featured: true,
    badge: 'Popular',
    colorHex: '#24292E',
    logoLetter: 'G',
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
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_token', label: 'Personal Access Token', type: 'password', placeholder: 'glpat-...', required: true },
    ],
    installCount: 4600,
    featured: false,
    badge: 'Verified',
    colorHex: '#FC6D26',
    logoLetter: 'G',
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
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us1', required: true },
      { name: 'server_prefix', label: 'Server Prefix', type: 'text', placeholder: 'us1 (last part of your API key)', required: false },
    ],
    installCount: 5400,
    featured: false,
    badge: 'Popular',
    colorHex: '#FFE01B',
    logoLetter: 'M',
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
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'Personal API Key', type: 'password', placeholder: 'phx_...', required: true },
    ],
    installCount: 1620,
    featured: false,
    badge: 'Verified',
    colorHex: '#1D4ED8',
    logoLetter: 'P',
  },

  // ─── Finance (new) ──────────────────────────────────────────────────────────
  {
    id: 'chargebee',
    name: 'Chargebee',
    developer: 'Chargebee Inc.',
    category: 'finance',
    description: 'Subscription billing and revenue management platform. Agents can manage subscriptions, trigger renewals, handle dunning, and report on MRR and churn.',
    permissions: ['Read subscriptions', 'Read invoices', 'Read customer data'],
    relatedAgentIds: ['finance_agent'],
    actionsUnlocked: ['Fetch subscription status', 'Read invoices', 'Monitor churn signals', 'Track MRR'],
    setupTimeMinutes: 4,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Chargebee API key', required: true },
      { name: 'site', label: 'Site Name', type: 'text', placeholder: 'yoursite (from yoursite.chargebee.com)', required: true },
    ],
    installCount: 1680,
    featured: false,
    badge: 'Verified',
    colorHex: '#FF6C2C',
    logoLetter: 'C',
  },
  {
    id: 'paytm-business',
    name: 'Paytm Business',
    developer: 'One97 Communications Ltd.',
    category: 'finance',
    description: 'India\'s leading digital payments platform. Agents can monitor payment collections, verify transactions, and reconcile UPI/wallet payments at scale.',
    permissions: ['Read payment transactions', 'Read settlement reports', 'Verify payment status'],
    relatedAgentIds: ['finance_agent'],
    actionsUnlocked: ['Fetch payment status', 'Read settlement data', 'Verify UPI transactions', 'Monitor refunds'],
    setupTimeMinutes: 3,
    bundleIds: ['india-fintech-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'merchant_id', label: 'Merchant ID', type: 'text', placeholder: 'Your Paytm merchant ID', required: true },
      { name: 'merchant_key', label: 'Merchant Key', type: 'password', placeholder: 'Your Paytm merchant key', required: true },
    ],
    installCount: 3100,
    featured: false,
    badge: 'India Priority',
    colorHex: '#00BAF2',
    logoLetter: 'P',
  },
  {
    id: 'razorpayx',
    name: 'RazorpayX Payroll',
    developer: 'Razorpay Software Pvt. Ltd.',
    category: 'finance',
    description: 'Automated payroll and banking platform by Razorpay. Agents can monitor payroll runs, verify disbursements, and ensure statutory compliance like PF and TDS.',
    permissions: ['Read payroll data', 'Read bank transactions', 'Read compliance reports'],
    relatedAgentIds: ['finance_agent', 'hr_agent'],
    actionsUnlocked: ['Fetch payroll status', 'Read bank transfers', 'Monitor PF/TDS', 'Check disbursement logs'],
    setupTimeMinutes: 5,
    bundleIds: ['india-fintech-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'text', placeholder: 'rzp_live_...', required: true },
      { name: 'api_secret', label: 'API Secret', type: 'password', placeholder: 'Your RazorpayX API secret', required: true },
    ],
    installCount: 1950,
    featured: false,
    badge: 'India Priority',
    colorHex: '#2C73D2',
    logoLetter: 'R',
  },
  {
    id: 'zoho-books',
    name: 'Zoho Books',
    developer: 'Zoho Corporation Pvt. Ltd.',
    category: 'finance',
    description: 'Online accounting software for growing businesses. Agents can fetch invoices, track expenses, monitor GST compliance, and reconcile bank transactions.',
    permissions: ['Read invoices', 'Read expenses', 'Read contacts', 'Read bank transactions'],
    relatedAgentIds: ['finance_agent'],
    actionsUnlocked: ['Fetch invoices', 'Read expense reports', 'Monitor GST filings', 'Check bank reconciliation'],
    setupTimeMinutes: 4,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Zoho Books API key', required: true },
      { name: 'organization_id', label: 'Organization ID', type: 'text', placeholder: 'Your Zoho Books org ID', required: true },
    ],
    installCount: 2200,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E42527',
    logoLetter: 'Z',
  },
  {
    id: 'tally',
    name: 'TallyPrime',
    developer: 'Tally Solutions Pvt. Ltd.',
    category: 'finance',
    description: 'India\'s most-used accounting and ERP software. Agents can pull ledger data, monitor GST returns, track payroll, and flag anomalies in financial records.',
    permissions: ['Read ledger data', 'Read GST reports', 'Read payroll data'],
    relatedAgentIds: ['finance_agent', 'compliance_agent'],
    actionsUnlocked: ['Fetch ledger entries', 'Read GST reports', 'Monitor payroll data', 'Flag financial anomalies'],
    setupTimeMinutes: 6,
    bundleIds: ['finance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Token', type: 'password', placeholder: 'Your TallyPrime API token', required: true },
      { name: 'company_name', label: 'Company Name', type: 'text', placeholder: 'Exact company name in Tally', required: true },
    ],
    installCount: 4800,
    featured: false,
    badge: 'India Priority',
    colorHex: '#004B87',
    logoLetter: 'T',
  },
  {
    id: 'marg-erp',
    name: 'Marg ERP 9+',
    developer: 'Marg Compusoft Pvt. Ltd.',
    category: 'finance',
    description: 'ERP and GST billing software for retail and distribution businesses in India. Agents can monitor stock, fetch billing data, and track GST compliance.',
    permissions: ['Read billing data', 'Read inventory', 'Read GST reports'],
    relatedAgentIds: ['finance_agent'],
    actionsUnlocked: ['Fetch billing records', 'Read stock levels', 'Monitor GST compliance', 'Track distributor data'],
    setupTimeMinutes: 7,
    bundleIds: [],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Marg ERP API key', required: true },
    ],
    installCount: 2700,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E63946',
    logoLetter: 'M',
  },

  // ─── HR & People (new) ───────────────────────────────────────────────────────
  {
    id: 'zoho-people',
    name: 'Zoho People',
    developer: 'Zoho Corporation Pvt. Ltd.',
    category: 'hr',
    description: 'Cloud HR software for managing the complete employee lifecycle. Agents can fetch employee records, monitor leave, track attendance, and manage appraisals.',
    permissions: ['Read employee profiles', 'Read leave data', 'Read attendance', 'Read performance data'],
    relatedAgentIds: ['hr_agent'],
    actionsUnlocked: ['Fetch employee data', 'Monitor leave balances', 'Track attendance', 'Read appraisal scores'],
    setupTimeMinutes: 4,
    bundleIds: ['hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Zoho People API key', required: true },
    ],
    installCount: 1900,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E42527',
    logoLetter: 'Z',
  },
  {
    id: 'zoho-learn',
    name: 'Zoho Learn',
    developer: 'Zoho Corporation Pvt. Ltd.',
    category: 'hr',
    description: 'Learning management system for employee training and development. Agents can track course completion, assign trainings, and report on skill gaps.',
    permissions: ['Read course catalog', 'Read enrollment data', 'Read completion reports'],
    relatedAgentIds: ['hr_agent'],
    actionsUnlocked: ['Fetch training progress', 'Read completion rates', 'Monitor skill gaps', 'Track certifications'],
    setupTimeMinutes: 3,
    bundleIds: ['hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Zoho Learn API key', required: true },
    ],
    installCount: 820,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E42527',
    logoLetter: 'Z',
  },
  {
    id: 'zimyo',
    name: 'Zimyo',
    developer: 'Zimyo Consulting Pvt. Ltd.',
    category: 'hr',
    description: 'Modern HRMS for Indian SMEs — payroll, attendance, performance, and engagement in one platform. Agents can monitor payroll cycles and flag compliance issues.',
    permissions: ['Read employee records', 'Read payroll data', 'Read attendance logs'],
    relatedAgentIds: ['hr_agent'],
    actionsUnlocked: ['Fetch employee data', 'Read payroll summaries', 'Monitor attendance', 'Track appraisals'],
    setupTimeMinutes: 4,
    bundleIds: ['hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Zimyo API key', required: true },
    ],
    installCount: 740,
    featured: false,
    badge: 'India Priority',
    colorHex: '#6C63FF',
    logoLetter: 'Z',
  },
  {
    id: 'hrone',
    name: 'HROne',
    developer: 'Uneecops Workplace Solutions Pvt. Ltd.',
    category: 'hr',
    description: 'Enterprise HRMS with a focus on automation and employee experience. Agents can manage onboarding workflows, track performance, and monitor payroll compliance.',
    permissions: ['Read employee records', 'Read payroll data', 'Read onboarding status'],
    relatedAgentIds: ['hr_agent'],
    actionsUnlocked: ['Fetch employee profiles', 'Monitor onboarding tasks', 'Read payroll reports', 'Track performance reviews'],
    setupTimeMinutes: 4,
    bundleIds: ['hr-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your HROne API key', required: true },
      { name: 'company_code', label: 'Company Code', type: 'text', placeholder: 'Your HROne company code', required: true },
    ],
    installCount: 680,
    featured: false,
    badge: 'India Priority',
    colorHex: '#1D6EC0',
    logoLetter: 'H',
  },

  // ─── Recruitment (new) ───────────────────────────────────────────────────────
  {
    id: 'zoho-recruit',
    name: 'Zoho Recruit',
    developer: 'Zoho Corporation Pvt. Ltd.',
    category: 'recruitment',
    description: 'End-to-end recruitment software from sourcing to offer. Agents can screen candidates, track pipeline stages, and automate interview scheduling.',
    permissions: ['Read job openings', 'Read candidate profiles', 'Read interview schedules'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Fetch candidate pipeline', 'Screen applications', 'Track interview status', 'Read offer details'],
    setupTimeMinutes: 4,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Zoho Recruit API key', required: true },
    ],
    installCount: 1450,
    featured: false,
    badge: 'India Priority',
    colorHex: '#E42527',
    logoLetter: 'Z',
  },
  {
    id: 'apna',
    name: 'Apna',
    developer: 'Apna Time Pvt. Ltd.',
    category: 'recruitment',
    description: 'India\'s largest blue- and grey-collar hiring platform with 60M+ job seekers. Agents can post jobs, screen applicants, and schedule interviews for frontline roles.',
    permissions: ['Read job postings', 'Read applicant profiles', 'Read interview slots'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Post jobs', 'Fetch applicants', 'Screen candidates', 'Schedule interviews'],
    setupTimeMinutes: 3,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Apna partner API key', required: true },
    ],
    installCount: 2800,
    featured: false,
    badge: 'India Priority',
    colorHex: '#5C2D91',
    logoLetter: 'A',
  },
  {
    id: 'instahyre',
    name: 'Instahyre',
    developer: 'Instahyre Technologies Pvt. Ltd.',
    category: 'recruitment',
    description: 'AI-powered hiring platform for tech and professional roles in India. Agents can source candidates, track applications, and automate outreach sequences.',
    permissions: ['Read candidate profiles', 'Read job openings', 'Read pipeline stages'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Source candidates', 'Track applications', 'Read interview feedback', 'Monitor pipeline health'],
    setupTimeMinutes: 3,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Instahyre API key', required: true },
    ],
    installCount: 560,
    featured: false,
    badge: 'India Priority',
    colorHex: '#00B4D8',
    logoLetter: 'I',
  },
  {
    id: 'cutshort',
    name: 'Cutshort',
    developer: 'Cutshort Technologies Pvt. Ltd.',
    category: 'recruitment',
    description: 'AI-driven professional network for tech hiring. Agents can discover passive candidates, track referrals, and surface high-intent profiles based on skill signals.',
    permissions: ['Read candidate profiles', 'Read job postings', 'Read match scores'],
    relatedAgentIds: ['recruitment_agent'],
    actionsUnlocked: ['Discover candidates', 'Read match scores', 'Track referral pipeline', 'Monitor job engagement'],
    setupTimeMinutes: 3,
    bundleIds: ['recruitment-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Cutshort API key', required: true },
    ],
    installCount: 480,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF4500',
    logoLetter: 'C',
  },

  // ─── Communication (new) ─────────────────────────────────────────────────────
  {
    id: 'loom',
    name: 'Loom',
    developer: 'Loom, Inc.',
    category: 'communication',
    description: 'Async video messaging platform. Agents can retrieve video metadata, track view engagement, and surface unreviewed recordings assigned to key workflows.',
    permissions: ['Read workspace videos', 'Read view analytics', 'Read space memberships'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch video library', 'Read engagement stats', 'Monitor unreviewed recordings'],
    setupTimeMinutes: 3,
    bundleIds: ['communication-stack'],
    installMethod: 'oauth2',
    installCount: 4200,
    featured: false,
    badge: 'Verified',
    colorHex: '#625DF5',
    logoLetter: 'L',
    comingSoon: true,
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    developer: 'Meta Platforms, Inc.',
    category: 'communication',
    description: 'WhatsApp Business via Meta Cloud API. Send messages, templates, and receive webhooks directly – no third-party gateway.',
    permissions: ['Send messages', 'Read message status', 'Manage templates', 'Receive webhooks'],
    relatedAgentIds: [],
    actionsUnlocked: ['Send WhatsApp messages', 'Send template messages', 'Read delivery status', 'List contacts', 'Manage templates'],
    setupTimeMinutes: 5,
    bundleIds: ['communication-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_token', label: 'Access Token', type: 'password', placeholder: 'Meta access token', required: true },
      { name: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: '1234567890', required: true },
      { name: 'waba_id', label: 'WABA ID', type: 'text', placeholder: '0987654321', required: true },
    ],
    installCount: 1840,
    featured: true,
    badge: 'India Priority',
    colorHex: '#25D366',
    logoLetter: 'W',
  },

  // ─── IT & Security (new) ─────────────────────────────────────────────────────
  {
    id: 'postman',
    name: 'Postman',
    developer: 'Postman, Inc.',
    category: 'it',
    description: 'API development and testing platform used by 30M+ developers. Agents can run collections, monitor API health, and surface broken endpoints before they reach production.',
    permissions: ['Read workspaces', 'Read collections', 'Read monitor results'],
    relatedAgentIds: [],
    actionsUnlocked: ['Run API collections', 'Read monitor results', 'Fetch environment variables', 'Check API health'],
    setupTimeMinutes: 3,
    bundleIds: ['devops-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Postman API key', required: true },
    ],
    installCount: 3800,
    featured: false,
    badge: 'Verified',
    colorHex: '#FF6C37',
    logoLetter: 'P',
  },
  {
    id: 'browserstack',
    name: 'BrowserStack',
    developer: 'BrowserStack Limited',
    category: 'it',
    description: 'Cloud testing platform for web and mobile apps. Agents can trigger test runs, monitor pass/fail rates, and flag regressions across browsers and devices.',
    permissions: ['Read test builds', 'Read test results', 'Read device logs'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch test results', 'Monitor pass/fail rates', 'Read device logs', 'Flag test regressions'],
    setupTimeMinutes: 3,
    bundleIds: ['devops-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'username', label: 'Username', type: 'text', placeholder: 'Your BrowserStack username', required: true },
      { name: 'access_key', label: 'Access Key', type: 'password', placeholder: 'Your BrowserStack access key', required: true },
    ],
    installCount: 2900,
    featured: false,
    badge: 'Verified',
    colorHex: '#F47E26',
    logoLetter: 'B',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    developer: 'Functional Software, Inc.',
    category: 'it',
    description: 'Error tracking and performance monitoring for developers. Agents can surface new error spikes, correlate errors with deployments, and assign issues automatically.',
    permissions: ['Read projects', 'Read issues', 'Read events', 'Read performance data'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch error spikes', 'Read issue details', 'Correlate errors with deployments', 'Monitor performance regressions'],
    setupTimeMinutes: 3,
    bundleIds: ['devops-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'auth_token', label: 'Auth Token', type: 'password', placeholder: 'Your Sentry auth token', required: true },
      { name: 'organization', label: 'Organization Slug', type: 'text', placeholder: 'yourorg', required: true },
    ],
    installCount: 3400,
    featured: false,
    badge: 'Verified',
    colorHex: '#362D59',
    logoLetter: 'S',
  },
  {
    id: '1password',
    name: '1Password',
    developer: 'AgileBits Inc.',
    category: 'it',
    description: 'Enterprise password and secrets manager. Agents can audit vault access, monitor for exposed credentials, and alert on policy violations.',
    permissions: ['Read vault metadata', 'Read audit events', 'Read team access'],
    relatedAgentIds: [],
    actionsUnlocked: ['Audit vault access', 'Monitor policy violations', 'Read team permissions', 'Fetch audit logs'],
    setupTimeMinutes: 4,
    bundleIds: ['it-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'service_account_token', label: 'Service Account Token', type: 'password', placeholder: 'ops_...', required: true },
    ],
    installCount: 2100,
    featured: false,
    badge: 'Verified',
    colorHex: '#1A8CFF',
    logoLetter: '1',
  },
  {
    id: 'freshservice',
    name: 'Freshservice',
    developer: 'Freshworks Inc.',
    category: 'it',
    description: 'IT service management (ITSM) platform. Agents can create tickets, monitor SLA breaches, track asset inventory, and escalate incidents to the right team.',
    permissions: ['Read tickets', 'Read assets', 'Read SLA data', 'Read change requests'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch open tickets', 'Monitor SLA breaches', 'Read asset inventory', 'Track incident escalations'],
    setupTimeMinutes: 4,
    bundleIds: ['it-stack', 'support-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Freshservice API key', required: true },
      { name: 'domain', label: 'Domain', type: 'text', placeholder: 'yourcompany (from yourcompany.freshservice.com)', required: true },
    ],
    installCount: 2450,
    featured: false,
    badge: 'Verified',
    colorHex: '#1FB8CD',
    logoLetter: 'F',
  },
  {
    id: 'kissflow',
    name: 'Kissflow',
    developer: 'OrangeScape Technologies Pvt. Ltd.',
    category: 'it',
    description: 'No-code workflow automation and app building platform built in India. Agents can monitor workflow runs, trigger processes, and surface bottlenecks in approvals.',
    permissions: ['Read workflow instances', 'Read process data', 'Read form submissions'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch workflow status', 'Monitor approval queues', 'Read process metrics', 'Track SLA compliance'],
    setupTimeMinutes: 4,
    bundleIds: [],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Kissflow API key', required: true },
      { name: 'account_id', label: 'Account ID', type: 'text', placeholder: 'Your Kissflow account ID', required: true },
    ],
    installCount: 1120,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF5B00',
    logoLetter: 'K',
  },
  {
    id: 'aws',
    name: 'AWS',
    developer: 'Amazon Web Services, Inc.',
    category: 'it',
    description: 'World\'s leading cloud platform. Agents can monitor resource usage, surface cost anomalies, track security findings, and audit IAM policy changes.',
    permissions: ['Read CloudWatch metrics', 'Read Cost Explorer data', 'Read Security Hub findings', 'Read IAM policies'],
    relatedAgentIds: [],
    actionsUnlocked: ['Monitor cloud costs', 'Read security findings', 'Audit IAM changes', 'Track resource utilization'],
    setupTimeMinutes: 8,
    bundleIds: ['cloud-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_key_id', label: 'Access Key ID', type: 'text', placeholder: 'AKIA...', required: true },
      { name: 'secret_access_key', label: 'Secret Access Key', type: 'password', placeholder: 'Your AWS secret access key', required: true },
      { name: 'region', label: 'Default Region', type: 'text', placeholder: 'ap-south-1', required: true },
    ],
    installCount: 9400,
    featured: false,
    badge: 'Verified',
    colorHex: '#FF9900',
    logoLetter: 'A',
  },
  {
    id: 'azure',
    name: 'Azure',
    developer: 'Microsoft Corporation',
    category: 'it',
    description: 'Microsoft\'s cloud platform. Agents can monitor resource health, surface cost insights, track security alerts, and audit Active Directory changes.',
    permissions: ['Read resource metrics', 'Read cost data', 'Read security alerts', 'Read Active Directory'],
    relatedAgentIds: [],
    actionsUnlocked: ['Monitor resource health', 'Read cost insights', 'Track security alerts', 'Audit AD changes'],
    setupTimeMinutes: 8,
    bundleIds: ['cloud-stack'],
    installMethod: 'oauth2',
    installCount: 7800,
    featured: false,
    badge: 'Verified',
    colorHex: '#0078D4',
    logoLetter: 'A',
    comingSoon: true,
  },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    developer: 'Google LLC',
    category: 'it',
    description: 'Google\'s cloud infrastructure platform. Agents can monitor compute resources, track billing, surface Security Command Center alerts, and audit IAM policies.',
    permissions: ['Read Monitoring metrics', 'Read Billing data', 'Read Security Command Center', 'Read IAM policies'],
    relatedAgentIds: [],
    actionsUnlocked: ['Monitor GCP resources', 'Read billing anomalies', 'Track security alerts', 'Audit IAM policies'],
    setupTimeMinutes: 8,
    bundleIds: ['cloud-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'service_account_json', label: 'Service Account JSON', type: 'password', placeholder: 'Paste your service account key JSON', required: true },
      { name: 'project_id', label: 'Project ID', type: 'text', placeholder: 'your-gcp-project-id', required: true },
    ],
    installCount: 6200,
    featured: false,
    badge: 'Verified',
    colorHex: '#4285F4',
    logoLetter: 'G',
  },

  // ─── Compliance & Legal (new) ────────────────────────────────────────────────
  {
    id: 'vanta',
    name: 'Vanta',
    developer: 'Vanta, Inc.',
    category: 'compliance',
    description: 'Automated security and compliance platform for SOC 2, ISO 27001, HIPAA, and more. Agents can monitor control status, surface failing checks, and track remediation tasks.',
    permissions: ['Read compliance controls', 'Read test results', 'Read evidence', 'Read risk assessments'],
    relatedAgentIds: ['compliance_agent'],
    actionsUnlocked: ['Fetch failing controls', 'Monitor compliance posture', 'Read test evidence', 'Track remediation tasks'],
    setupTimeMinutes: 5,
    bundleIds: ['compliance-stack', 'india-compliance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_token', label: 'API Token', type: 'password', placeholder: 'Your Vanta API token', required: true },
    ],
    installCount: 2300,
    featured: false,
    badge: 'Verified',
    colorHex: '#7C3AED',
    logoLetter: 'V',
  },
  {
    id: 'drata',
    name: 'Drata',
    developer: 'Drata, Inc.',
    category: 'compliance',
    description: 'Continuous compliance automation for SOC 2, ISO 27001, PCI DSS, and GDPR. Agents can track control health, surface gaps, and generate audit-ready evidence.',
    permissions: ['Read controls', 'Read evidence', 'Read audit tasks', 'Read risk register'],
    relatedAgentIds: ['compliance_agent'],
    actionsUnlocked: ['Monitor control health', 'Fetch compliance gaps', 'Read audit evidence', 'Track risk items'],
    setupTimeMinutes: 5,
    bundleIds: ['compliance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Drata API key', required: true },
    ],
    installCount: 1760,
    featured: false,
    badge: 'Verified',
    colorHex: '#6366F1',
    logoLetter: 'D',
  },
  {
    id: 'vakilsearch',
    name: 'Vakilsearch',
    developer: 'Vakilsearch Online Services Pvt. Ltd.',
    category: 'legal',
    description: 'India\'s leading online legal services platform for company registration, GST, trademarks, and contracts. Agents can track compliance filings and flag overdue deadlines.',
    permissions: ['Read filing deadlines', 'Read compliance status', 'Read document status'],
    relatedAgentIds: ['compliance_agent', 'legal_agent'],
    actionsUnlocked: ['Fetch filing status', 'Monitor compliance deadlines', 'Track trademark status', 'Read contract status'],
    setupTimeMinutes: 4,
    bundleIds: ['legal-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Vakilsearch API key', required: true },
    ],
    installCount: 1340,
    featured: false,
    badge: 'India Priority',
    colorHex: '#1565C0',
    logoLetter: 'V',
  },
  {
    id: 'idfy',
    name: 'IDfy',
    developer: 'IDfy Technologies Pvt. Ltd.',
    category: 'compliance',
    description: 'India\'s leading identity verification and background check platform. Agents can verify Aadhaar, PAN, GST, and run employee background screenings.',
    permissions: ['Initiate verifications', 'Read verification status', 'Read report results'],
    relatedAgentIds: ['compliance_agent', 'hr_agent'],
    actionsUnlocked: ['Verify Aadhaar/PAN', 'Run background checks', 'Read verification reports', 'Monitor KYC status'],
    setupTimeMinutes: 4,
    bundleIds: ['india-compliance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'text', placeholder: 'Your IDfy API key', required: true },
      { name: 'api_secret', label: 'API Secret', type: 'password', placeholder: 'Your IDfy API secret', required: true },
    ],
    installCount: 1580,
    featured: false,
    badge: 'India Priority',
    colorHex: '#005F73',
    logoLetter: 'I',
  },
  {
    id: 'epfo',
    name: 'EPFO',
    developer: 'Employees\' Provident Fund Organisation (Govt. of India)',
    category: 'compliance',
    description: 'India\'s statutory retirement savings and compliance portal. Agents can monitor PF contribution status, track ECR filings, and alert on non-compliance.',
    permissions: ['Read PF contribution data', 'Read ECR filing status', 'Read employer registration'],
    relatedAgentIds: ['compliance_agent', 'hr_agent'],
    actionsUnlocked: ['Fetch PF contribution status', 'Monitor ECR filings', 'Track employer compliance', 'Alert on non-compliance'],
    setupTimeMinutes: 6,
    bundleIds: ['india-compliance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'establishment_id', label: 'Establishment ID', type: 'text', placeholder: 'Your EPFO establishment ID', required: true },
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your EPFO API key (e-Sewa portal)', required: true },
    ],
    installCount: 4200,
    featured: false,
    badge: 'India Priority',
    colorHex: '#1B4F72',
    logoLetter: 'E',
  },
  {
    id: 'aadhaar-api',
    name: 'Aadhaar API',
    developer: 'UIDAI (Govt. of India)',
    category: 'compliance',
    description: 'India\'s national identity verification API powered by Aadhaar. Agents can verify identity, authenticate users, and enable e-KYC for onboarding workflows.',
    permissions: ['Verify Aadhaar identity', 'Read e-KYC data', 'Perform OTP authentication'],
    relatedAgentIds: ['compliance_agent', 'hr_agent'],
    actionsUnlocked: ['Verify Aadhaar number', 'Run e-KYC', 'Authenticate with OTP', 'Fetch demographic data'],
    setupTimeMinutes: 8,
    bundleIds: ['india-compliance-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'aua_code', label: 'AUA Code', type: 'text', placeholder: 'Your AUA code', required: true },
      { name: 'licence_key', label: 'Licence Key', type: 'password', placeholder: 'Your UIDAI licence key', required: true },
    ],
    installCount: 3600,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF6600',
    logoLetter: 'A',
  },
  {
    id: 'digilocker',
    name: 'DigiLocker',
    developer: 'Ministry of Electronics & IT (Govt. of India)',
    category: 'compliance',
    description: 'India\'s digital document wallet (1.5B+ docs). Agents can verify issued documents like mark sheets, driving licences, and Aadhaar to streamline onboarding.',
    permissions: ['Read issued documents', 'Verify document authenticity', 'Read user profile'],
    relatedAgentIds: ['compliance_agent', 'hr_agent'],
    actionsUnlocked: ['Verify documents', 'Fetch issued certificates', 'Read document metadata', 'Authenticate users'],
    setupTimeMinutes: 8,
    bundleIds: ['india-compliance-stack'],
    installMethod: 'oauth2',
    installCount: 2800,
    featured: false,
    badge: 'India Priority',
    colorHex: '#0A3161',
    logoLetter: 'D',
    comingSoon: true,
  },

  // ─── Marketing (new) ─────────────────────────────────────────────────────────
  {
    id: 'invideo',
    name: 'InVideo',
    developer: 'InVideo Innovation Pvt. Ltd.',
    category: 'marketing',
    description: 'AI-powered video creation platform for marketing teams. Agents can monitor published video metrics, track campaign performance, and surface top-performing creatives.',
    permissions: ['Read project library', 'Read video analytics', 'Read team workspace'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch video metrics', 'Read campaign performance', 'Monitor creative engagement', 'Track publishing status'],
    setupTimeMinutes: 3,
    bundleIds: ['marketing-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your InVideo API key', required: true },
    ],
    installCount: 1280,
    featured: false,
    badge: 'India Priority',
    colorHex: '#4F46E5',
    logoLetter: 'I',
  },

  // ─── Analytics (new) ─────────────────────────────────────────────────────────
  {
    id: 'tableau',
    name: 'Tableau',
    developer: 'Salesforce, Inc.',
    category: 'analytics',
    description: 'World-leading BI and data visualization platform. Agents can query published dashboards, fetch KPI summaries, and surface data quality issues across your reports.',
    permissions: ['Read workbooks', 'Read dashboards', 'Read data sources', 'Read user activity'],
    relatedAgentIds: ['analytics_agent'],
    actionsUnlocked: ['Fetch dashboard KPIs', 'Read data source metadata', 'Monitor data freshness', 'Surface report anomalies'],
    setupTimeMinutes: 5,
    bundleIds: ['analytics-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'token_name', label: 'Personal Access Token Name', type: 'text', placeholder: 'Token name from Tableau Account Settings', required: true },
      { name: 'token_secret', label: 'Personal Access Token Secret', type: 'password', placeholder: 'Your token secret', required: true },
      { name: 'server_url', label: 'Server URL', type: 'text', placeholder: 'https://prod-apnortheast-a.online.tableau.com', required: true },
    ],
    installCount: 3900,
    featured: false,
    badge: 'Verified',
    colorHex: '#E97627',
    logoLetter: 'T',
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    developer: 'Snowflake Inc.',
    category: 'analytics',
    description: 'Cloud data warehouse and data sharing platform. Agents can run warehouse queries, monitor credit consumption, surface slow queries, and track data pipeline health.',
    permissions: ['Read warehouse metrics', 'Read query history', 'Read database objects', 'Read usage data'],
    relatedAgentIds: ['analytics_agent'],
    actionsUnlocked: ['Monitor credit usage', 'Surface slow queries', 'Read pipeline health', 'Fetch data freshness metrics'],
    setupTimeMinutes: 6,
    bundleIds: ['analytics-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'account', label: 'Account Identifier', type: 'text', placeholder: 'orgname-accountname', required: true },
      { name: 'username', label: 'Username', type: 'text', placeholder: 'Your Snowflake username', required: true },
      { name: 'password', label: 'Password', type: 'password', placeholder: 'Your Snowflake password', required: true },
    ],
    installCount: 3200,
    featured: false,
    badge: 'Verified',
    colorHex: '#29B5E8',
    logoLetter: 'S',
  },

  // ─── Sales (new) ─────────────────────────────────────────────────────────────
  {
    id: 'leadsquared',
    name: 'LeadSquared',
    developer: 'MarketXpander Services Pvt. Ltd.',
    category: 'sales',
    description: 'Sales execution CRM for high-velocity teams in India. Agents can track lead pipelines, surface stalled deals, monitor field sales activity, and trigger follow-up workflows.',
    permissions: ['Read leads', 'Read activities', 'Read sales pipeline', 'Read reports'],
    relatedAgentIds: ['sales_agent'],
    actionsUnlocked: ['Fetch lead pipeline', 'Monitor stalled deals', 'Read activity logs', 'Track conversion metrics'],
    setupTimeMinutes: 4,
    bundleIds: ['sales-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_key', label: 'Access Key', type: 'text', placeholder: 'Your LeadSquared access key', required: true },
      { name: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'Your LeadSquared secret key', required: true },
      { name: 'host', label: 'Host URL', type: 'text', placeholder: 'api.leadsquared.com', required: false },
    ],
    installCount: 1820,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF6B35',
    logoLetter: 'L',
  },

  // ─── Productivity (new) ──────────────────────────────────────────────────────
  {
    id: 'figma',
    name: 'Figma',
    developer: 'Figma, Inc.',
    category: 'productivity',
    description: 'Collaborative design platform used by product and design teams worldwide. Agents can track design review status, monitor file versions, and surface stale designs.',
    permissions: ['Read files', 'Read comments', 'Read project members', 'Read version history'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch design files', 'Read review comments', 'Monitor version changes', 'Track project status'],
    setupTimeMinutes: 3,
    bundleIds: ['productivity-stack'],
    installMethod: 'oauth2',
    installCount: 6800,
    featured: false,
    badge: 'Verified',
    colorHex: '#F24E1E',
    logoLetter: 'F',
    comingSoon: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    developer: 'Notion Labs, Inc.',
    category: 'productivity',
    description: 'All-in-one workspace for notes, docs, and wikis. Agents can read knowledge base pages, track project databases, and surface overdue tasks across workspaces.',
    permissions: ['Read pages', 'Read databases', 'Read workspace members'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch knowledge base pages', 'Read project databases', 'Monitor task statuses', 'Surface overdue items'],
    setupTimeMinutes: 3,
    bundleIds: ['productivity-stack'],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'token', label: 'Integration Token', type: 'password', placeholder: 'secret_...', required: true },
    ],
    installCount: 5400,
    featured: false,
    badge: 'Verified',
    colorHex: '#000000',
    logoLetter: 'N',
  },
  {
    id: 'canva',
    name: 'Canva',
    developer: 'Canva Pty Ltd',
    category: 'productivity',
    description: 'Online graphic design tool for teams. Agents can monitor brand asset usage, track published designs, and surface unapproved content in team folders.',
    permissions: ['Read designs', 'Read team folders', 'Read brand kits'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch team designs', 'Monitor brand asset usage', 'Track published content', 'Read folder activity'],
    setupTimeMinutes: 3,
    bundleIds: [],
    installMethod: 'oauth2',
    installCount: 4100,
    featured: false,
    badge: 'Verified',
    colorHex: '#00C4CC',
    logoLetter: 'C',
    comingSoon: true,
  },
  {
    id: 'calendly',
    name: 'Calendly',
    developer: 'Calendly LLC',
    category: 'productivity',
    description: 'Scheduling automation platform. Agents can monitor meeting loads, surface no-show patterns, and trigger follow-up actions when bookings are created or cancelled.',
    permissions: ['Read event types', 'Read scheduled events', 'Read invitee data'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch scheduled meetings', 'Monitor no-show rates', 'Read meeting load', 'Trigger post-meeting workflows'],
    setupTimeMinutes: 2,
    bundleIds: ['productivity-stack'],
    installMethod: 'oauth2',
    installCount: 3600,
    featured: false,
    badge: 'Verified',
    colorHex: '#006BFF',
    logoLetter: 'C',
    comingSoon: true,
  },
  {
    id: 'miro',
    name: 'Miro',
    developer: 'RealtimeBoard, Inc.',
    category: 'productivity',
    description: 'Online collaborative whiteboard platform. Agents can track active sprint boards, monitor workshop participation, and surface stale planning canvases.',
    permissions: ['Read boards', 'Read team members', 'Read board items'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch active boards', 'Monitor board activity', 'Read sprint planning canvases', 'Track collaboration metrics'],
    setupTimeMinutes: 3,
    bundleIds: [],
    installMethod: 'oauth2',
    installCount: 3200,
    featured: false,
    badge: 'Verified',
    colorHex: '#FFD02F',
    logoLetter: 'M',
    comingSoon: true,
  },
  {
    id: 'asana',
    name: 'Asana',
    developer: 'Asana, Inc.',
    category: 'productivity',
    description: 'Work management platform for teams. Agents can monitor project health, surface overdue tasks, track milestone completion, and alert on blocked dependencies.',
    permissions: ['Read projects', 'Read tasks', 'Read teams', 'Read portfolios'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch project health', 'Surface overdue tasks', 'Track milestone completion', 'Monitor blocked work'],
    setupTimeMinutes: 4,
    bundleIds: ['productivity-stack'],
    installMethod: 'oauth2',
    installCount: 4800,
    featured: false,
    badge: 'Verified',
    colorHex: '#FC636B',
    logoLetter: 'A',
    comingSoon: true,
  },
  {
    id: 'monday',
    name: 'Monday.com',
    developer: 'monday.com Ltd.',
    category: 'productivity',
    description: 'Work OS for managing projects, workflows, and team collaboration. Agents can track board status, surface overdue items, and monitor sprint velocity.',
    permissions: ['Read boards', 'Read items', 'Read workspaces', 'Read users'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch board status', 'Surface overdue items', 'Monitor sprint velocity', 'Read team workloads'],
    setupTimeMinutes: 4,
    bundleIds: [],
    installMethod: 'oauth2',
    installCount: 4200,
    featured: false,
    badge: 'Verified',
    colorHex: '#FF3D57',
    logoLetter: 'M',
    comingSoon: true,
  },
  {
    id: 'zapier',
    name: 'Zapier',
    developer: 'Zapier, Inc.',
    category: 'productivity',
    description: 'No-code automation platform connecting 6,000+ apps. Agents can monitor Zap run history, surface failed automations, and alert on quota exhaustion.',
    permissions: ['Read Zaps', 'Read Zap runs', 'Read app connections'],
    relatedAgentIds: [],
    actionsUnlocked: ['Monitor Zap failures', 'Read automation history', 'Surface quota usage', 'Track error rates'],
    setupTimeMinutes: 3,
    bundleIds: ['productivity-stack'],
    installMethod: 'oauth2',
    installCount: 7200,
    featured: false,
    badge: 'Popular',
    colorHex: '#FF4A00',
    logoLetter: 'Z',
    comingSoon: true,
  },
  {
    id: 'whatfix',
    name: 'Whatfix',
    developer: 'Whatfix Inc.',
    category: 'productivity',
    description: 'Digital adoption platform that guides users through enterprise software. Agents can monitor feature adoption rates, surface low-engagement workflows, and track training completion.',
    permissions: ['Read flow analytics', 'Read user engagement', 'Read content performance'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch adoption metrics', 'Monitor feature engagement', 'Read training completion', 'Surface low-adoption flows'],
    setupTimeMinutes: 4,
    bundleIds: [],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Whatfix API key', required: true },
    ],
    installCount: 1160,
    featured: false,
    badge: 'India Priority',
    colorHex: '#FF6B35',
    logoLetter: 'W',
  },
  {
    id: 'shiprocket',
    name: 'Shiprocket',
    developer: 'Bigfoot Retail Solutions Pvt. Ltd.',
    category: 'productivity',
    description: 'India\'s leading e-commerce shipping platform. Agents can track shipment status, surface delivery exceptions, monitor NDR rates, and reconcile COD settlements.',
    permissions: ['Read orders', 'Read shipments', 'Read tracking data', 'Read settlements'],
    relatedAgentIds: [],
    actionsUnlocked: ['Track shipment status', 'Monitor delivery exceptions', 'Read NDR data', 'Reconcile COD payments'],
    setupTimeMinutes: 3,
    bundleIds: [],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'email', label: 'Account Email', type: 'text', placeholder: 'Your Shiprocket account email', required: true },
      { name: 'password', label: 'Password', type: 'password', placeholder: 'Your Shiprocket password', required: true },
    ],
    installCount: 3400,
    featured: false,
    badge: 'India Priority',
    colorHex: '#F97316',
    logoLetter: 'S',
  },
  {
    id: 'unicommerce',
    name: 'Unicommerce',
    developer: 'Unicommerce eSolutions Pvt. Ltd.',
    category: 'productivity',
    description: 'E-commerce operations platform for order and inventory management. Agents can monitor inventory levels, track pending orders, and surface fulfilment bottlenecks.',
    permissions: ['Read orders', 'Read inventory', 'Read warehouses', 'Read fulfilment data'],
    relatedAgentIds: [],
    actionsUnlocked: ['Fetch order pipeline', 'Monitor inventory levels', 'Track warehouse capacity', 'Surface fulfilment delays'],
    setupTimeMinutes: 4,
    bundleIds: [],
    installMethod: 'api_key',
    requiredFields: [
      { name: 'access_token', label: 'Access Token', type: 'password', placeholder: 'Your Unicommerce access token', required: true },
      { name: 'facility_code', label: 'Facility Code', type: 'text', placeholder: 'Your warehouse facility code', required: true },
    ],
    installCount: 1640,
    featured: false,
    badge: 'India Priority',
    colorHex: '#1A56DB',
    logoLetter: 'U',
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
    const activeStatuses = new Set(['connected', 'syncing', 'error', 'expired']);
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
      if (!activeStatuses.has(String(r.status || '').toLowerCase())) return;
      // Prefer marketplace rows when both exist for the same service_type.
      const isMarketplace = r.metadata?.marketplace_app === 'true';
      const nextValue: InstalledAppHealth = {
        service_type: r.service_type,
        status: r.status,
        last_sync_at: r.last_sync_at,
        last_error_at: r.last_error_at,
        last_error_msg: r.last_error_msg,
        connectionSource: isMarketplace ? 'marketplace' : 'connections',
      };
      for (const alias of toServiceAliases(r.service_type)) {
        const existing = map.get(alias);
        if (existing && existing.connectionSource === 'marketplace' && !isMarketplace) continue;
        map.set(alias, nextValue);
      }
    });
    return map;
  } catch {
    return new Map();
  }
}

function toServiceAliases(serviceType: string) {
  const normalized = String(serviceType || '').trim();
  const aliases = new Set<string>([normalized]);
  if (normalized.includes('_')) aliases.add(normalized.replace(/_/g, '-'));
  if (normalized.includes('-')) aliases.add(normalized.replace(/-/g, '_'));
  return Array.from(aliases);
}

export async function findInstalledIntegrationByAliases(orgId: string, serviceType: string) {
  const aliases = new Set(toServiceAliases(serviceType));
  const rows = (await supabaseRestAsService('integrations', new URLSearchParams({
    organization_id: eq(orgId),
    status: 'neq.waitlisted',
    select: 'id,service_type,status,metadata',
  }))) as Array<{
    id: string;
    service_type: string;
    status: string;
    metadata?: Record<string, unknown> | null;
  }>;

  const matches = (rows || []).filter((row) => aliases.has(String(row.service_type || '')));
  if (!matches.length) return null;

  return matches.sort((a, b) => {
    const aMarketplace = a.metadata?.marketplace_app === 'true' ? 1 : 0;
    const bMarketplace = b.metadata?.marketplace_app === 'true' ? 1 : 0;
    if (aMarketplace !== bMarketplace) return bMarketplace - aMarketplace;
    const aExact = a.service_type === serviceType ? 1 : 0;
    const bExact = b.service_type === serviceType ? 1 : 0;
    return bExact - aExact;
  })[0];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /marketplace/bundles — app bundle definitions
router.get('/bundles', (_req: Request, res: Response) => {
  return res.json({ success: true, data: APP_BUNDLES });
});

// GET /marketplace/apps — full catalog with installation status + health
/** Fetch live install counts for all apps from marketplace_install_events */
async function getLiveInstallCounts(): Promise<Map<string, number>> {
  try {
    const rows = await supabaseRestAsService('marketplace_install_events', new URLSearchParams({ select: 'app_id,action' })) as any[];
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const cur = counts.get(row.app_id) ?? 0;
      counts.set(row.app_id, row.action === 'install' ? cur + 1 : Math.max(0, cur - 1));
    }
    return counts;
  } catch {
    return new Map();
  }
}

router.get('/apps', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const [healthMap, installCounts] = await Promise.all([
      getInstalledAppHealth(orgId),
      getLiveInstallCounts(),
    ]);

    let catalog = PARTNER_APP_CATALOG;

    // Full-text search across name, description, developer
    if (q) {
      catalog = catalog.filter(app =>
        app.name.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        app.developer.toLowerCase().includes(q) ||
        app.category.toLowerCase().includes(q),
      );
    }

    const apps = catalog.map((app) => {
      const health = healthMap.get(app.id);
      const liveCount = installCounts.get(app.id) ?? app.installCount;
      const isCertified = CERTIFIED_APP_IDS.has(app.id);
      return {
        ...app,
        installCount: liveCount,
        is_certified: isCertified,
        badge: isCertified ? 'Zapheit Certified' : app.badge,
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

export const installSchema = z.object({
  credentials: z.record(z.string()).optional().default({}),
});

// POST /marketplace/apps/:id/install — install a partner app
router.post('/apps/:id/install', async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.organization_id;
    if (!orgId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.errors.map((e) => e.message) });
    }

    const result = await installApp(
      orgId,
      (req.user as any)?.id ?? null,
      req.params.id,
      parsed.data.credentials,
      process.env.API_URL || 'http://localhost:3001',
    );

    if (result.type === 'error') {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    if (result.type === 'oauth') {
      return res.json({
        success: true,
        oauth: true,
        state: result.state,
        authUrl: result.authUrl,
        message: `Redirect to ${result.appName} to authorize access.`,
      });
    }
    return res.status(201).json({
      success: true,
      integration_id: result.integrationId,
      message: `${result.appName} has been installed successfully.`,
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

    const result = await uninstallApp(orgId, req.params.id, (req.user as any)?.id ?? null);
    if (!result.ok) {
      return res.status(result.status ?? 400).json({ success: false, error: result.error });
    }
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

    const installed = await findInstalledIntegrationByAliases(orgId, app.id);
    if (!installed) {
      return res.status(404).json({ success: false, error: 'App not installed' });
    }

    const integrationId = installed.id;
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
    const installed = await findInstalledIntegrationByAliases(orgId, app.id);

    if (installed?.id) {
      await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(installed.id) }), {
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
    logger.info('OAuth token exchange succeeded', { app_id: appId, org_id: stateRow.organization_id, has_refresh: !!refreshToken });
  } catch (e: any) {
    exchangeError = e.message;
    logger.error('OAuth token exchange failed', { app_id: appId, org_id: stateRow.organization_id, error: exchangeError });
  }

  if (!accessToken) {
    return res.redirect(`${frontendUrl}/dashboard/apps?marketplace_error=${enc(exchangeError || 'TokenExchangeFailed')}&marketplace_app=${enc(appId)}`);
  }

  const now = new Date().toISOString();
  const orgId = stateRow.organization_id as string;

  // Create or update integration — match ANY existing row for this org+service to avoid
  // UNIQUE(organization_id, service_type) constraint failures on INSERT.
  const existingRows = (await supabaseRestAsService('integrations', new URLSearchParams({
    organization_id: eq(orgId),
    service_type: eq(appId),
    select: 'id',
    limit: '1',
  }))) as Array<{ id: string }>;

  let integrationId: string;

  if (existingRows?.length > 0) {
    integrationId = existingRows[0].id;
    await supabaseRestAsService('integrations', new URLSearchParams({ id: eq(integrationId) }), {
      method: 'PATCH',
      body: {
        status: 'connected',
        auth_type: 'oauth2',
        service_name: app.name,
        ai_enabled: true,
        updated_at: now,
        metadata: { marketplace_app: 'true', developer: app.developer },
      },
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

export function buildOAuthUrl(appId: string, state: string, redirectUri: string): string | null {
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
      return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${enc(process.env.GOOGLE_CLIENT_ID)}&redirect_uri=${enc(redirectUri)}&scope=${enc('openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents')}&access_type=offline&prompt=consent&state=${state}`;
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

  // Slack returns HTTP 200 even on errors — check json.ok explicitly for Slack
  const slackFailed = appId === 'slack' && json.ok === false;
  if (!resp.ok || slackFailed || !json.access_token) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${resp.status})`);
  }

  // Slack OAuth v2 bot flow: access_token is the bot token at top level
  // User token (if requested) is at authed_user.access_token — we use the bot token
  return { accessToken: json.access_token as string, refreshToken: json.refresh_token as string | undefined };
}

export default router;
