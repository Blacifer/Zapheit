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

  const { code, state, error: oauthError } = req.query as Record<string, string>;

  if (oauthError) {
    return res.redirect(`${frontendUrl}/dashboard?marketplace_error=${enc(oauthError)}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/dashboard?marketplace_error=${enc('MissingCodeOrState')}`);
  }

  // Look up the state record
  const stateRows = (await supabaseRestAsService('integration_oauth_states', new URLSearchParams({
    state: eq(state),
    consumed_at: 'is.null',
    select: '*',
    limit: '1',
  }))) as any[];

  if (!stateRows?.length) {
    return res.redirect(`${frontendUrl}/dashboard?marketplace_error=${enc('InvalidOrExpiredState')}`);
  }

  const stateRow = stateRows[0];
  const appId = (stateRow.app_id || stateRow.provider_name) as string;
  const app = PARTNER_APP_CATALOG.find((a) => a.id === appId);

  if (!app) {
    return res.redirect(`${frontendUrl}/dashboard?marketplace_error=${enc('UnknownApp')}`);
  }

  // Exchange code for tokens
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let exchangeError: string | null = null;

  try {
    const result = await exchangeOAuthCode(appId, code, stateRow.redirect_uri as string);
    accessToken = result.accessToken;
    refreshToken = result.refreshToken ?? null;
  } catch (e: any) {
    exchangeError = e.message;
  }

  if (!accessToken) {
    return res.redirect(`${frontendUrl}/dashboard?marketplace_error=${enc(exchangeError || 'TokenExchangeFailed')}&marketplace_app=${enc(appId)}`);
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
  return res.redirect(`${frontendUrl}/dashboard?marketplace_connected=true&marketplace_app=${enc(appId)}`);
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
  redirectUri: string
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
      tokenUrl = 'https://accounts.zoho.com/oauth/v2/token';
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
