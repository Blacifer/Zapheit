import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2, ChevronDown, ChevronUp, X, Eye, EyeOff, ExternalLink,
  Search, CheckCircle2, AlertCircle, Clock, Zap, ArrowRight,
  Building2, Users, Receipt, MessageSquare, Shield, TrendingUp,
  Headphones, BarChart3, Scale, LayoutGrid, Landmark, RefreshCw,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { api } from '../../../lib/api-client';
import { authenticatedFetch } from '../../../lib/api/_helpers';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';
import { AppLogo } from './components/AppLogo';
import { useAppsData } from './hooks/useAppsData';
import { getAppServiceId } from './helpers';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

type AuthType = 'oauth' | 'api_key';
type ProductionStatus = 'production_ready' | 'coming_soon' | 'special';

interface CredField {
  key: string;
  label: string;
  type: 'text' | 'password';
  helpText?: string;
}

interface AppDef {
  appId: string;
  serviceId: string;
  name: string;
  description: string;
  category: string;
  auth: AuthType;
  logoLetter: string;
  colorHex: string;
  productionStatus: ProductionStatus;
  isIndiaNative?: boolean;
  workspaceRoute?: string;
  fields?: CredField[];
  suggestedAgent?: string;
}

interface AppStack {
  id: string;
  name: string;
  description: string;
  appIds: string[];
  colorHex: string;
  Icon: React.FC<{ className?: string }>;
}

/* ─────────────────────────────────────────────────────────────────────────
   App Catalog — 150+ apps
──────────────────────────────────────────────────────────────────────────── */

const APP_CATALOG: AppDef[] = [
  /* ── HR & People ──────────────────────────────────────────────────── */
  {
    appId: 'greythr', serviceId: 'greythr', name: 'greytHR',
    description: 'Complete HRMS for Indian businesses — payroll, leave, attendance, and compliance in one place.',
    category: 'hr', auth: 'api_key', logoLetter: 'GH', colorHex: '#00529B',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/greythr/workspace', suggestedAgent: 'HR Assistant',
    fields: [
      { key: 'api_key', label: 'API key', type: 'password', helpText: 'Settings → API Access → Generate API Key' },
      { key: 'subdomain', label: 'Subdomain (e.g. yourcompany.greythr.com)', type: 'text', helpText: 'Your greytHR login URL' },
    ],
  },
  {
    appId: 'zoho-people', serviceId: 'zoho_people', name: 'Zoho People',
    description: 'Employee directory, leave management, and attendance tracking for HR agents.',
    category: 'hr', auth: 'api_key', logoLetter: 'ZP', colorHex: '#E42527',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/zoho/workspace', suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password', helpText: 'Zoho People → Settings → Developer Space → API Keys' }],
  },
  {
    appId: 'microsoft-365', serviceId: 'microsoft_365', name: 'Microsoft 365',
    description: 'Outlook, Teams, and OneDrive. Enterprise email, calendar, and document workflows.',
    category: 'hr', auth: 'oauth', logoLetter: 'M', colorHex: '#0078D4',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/microsoft-365/workspace', suggestedAgent: 'Email Assistant',
  },
  {
    appId: 'keka', serviceId: 'keka', name: 'Keka HR',
    description: 'Modern HRMS built for India — payroll processing, leave, attendance, and performance.',
    category: 'hr', auth: 'api_key', logoLetter: 'KK', colorHex: '#F5A623',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'darwinbox', serviceId: 'darwinbox', name: 'Darwinbox',
    description: 'End-to-end HCM platform used by 700+ Indian enterprises for hire-to-retire workflows.',
    category: 'hr', auth: 'oauth', logoLetter: 'DB', colorHex: '#6C2BD9',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'hrone', serviceId: 'hrone', name: 'HROne',
    description: 'Unified HRMS for SMBs — payroll, attendance, leave, and employee self-service.',
    category: 'hr', auth: 'api_key', logoLetter: 'H1', colorHex: '#E91E63',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'zimyo', serviceId: 'zimyo', name: 'Zimyo',
    description: 'People OS for growing Indian companies — HR, payroll, benefits, and engagement.',
    category: 'hr', auth: 'api_key', logoLetter: 'ZY', colorHex: '#009688',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'freshteam', serviceId: 'freshteam', name: 'Freshteam',
    description: 'HR software by Freshworks — recruiting, onboarding, time-off, and employee information.',
    category: 'hr', auth: 'api_key', logoLetter: 'FT', colorHex: '#00B8D9',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'bamboohr', serviceId: 'bamboohr', name: 'BambooHR',
    description: 'HR software for small and medium businesses — employee records, time tracking, and hiring.',
    category: 'hr', auth: 'api_key', logoLetter: 'BH', colorHex: '#73AC3E',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
    fields: [
      { key: 'api_key', label: 'API key', type: 'password' },
      { key: 'subdomain', label: 'BambooHR subdomain', type: 'text' },
    ],
  },
  {
    appId: 'gusto', serviceId: 'gusto', name: 'Gusto',
    description: 'Full-service payroll, benefits, and HR management for modern teams.',
    category: 'hr', auth: 'oauth', logoLetter: 'GU', colorHex: '#F45D48',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'workday', serviceId: 'workday', name: 'Workday',
    description: 'Enterprise HCM and financial management for large organizations.',
    category: 'hr', auth: 'oauth', logoLetter: 'WD', colorHex: '#F5820D',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'rippling', serviceId: 'rippling', name: 'Rippling',
    description: 'Unified platform for HR, IT, and Finance — manage people and devices in one place.',
    category: 'hr', auth: 'oauth', logoLetter: 'RP', colorHex: '#FFC700',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'deel', serviceId: 'deel', name: 'Deel',
    description: 'Global payroll, compliance, and HR for remote and international teams.',
    category: 'hr', auth: 'oauth', logoLetter: 'DL', colorHex: '#FF6B35',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'hibob', serviceId: 'hibob', name: 'HiBob',
    description: 'Modern HRIS for fast-growing companies — culture, people analytics, and workflows.',
    category: 'hr', auth: 'api_key', logoLetter: 'HB', colorHex: '#FF4D4D',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
    fields: [{ key: 'service_user_id', label: 'Service user ID', type: 'text' }, { key: 'token', label: 'Token', type: 'password' }],
  },
  {
    appId: 'zoho-people-oauth', serviceId: 'zoho_people_oauth', name: 'Zoho People (OAuth)',
    description: 'Connect Zoho People via OAuth for automated employee data sync.',
    category: 'hr', auth: 'oauth', logoLetter: 'ZO', colorHex: '#E42527',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
  },

  /* ── Recruitment & Hiring ─────────────────────────────────────────── */
  {
    appId: 'naukri', serviceId: 'naukri', name: 'Naukri RMS',
    description: "India's largest job portal — source candidates, post jobs, and manage applications at scale.",
    category: 'recruitment', auth: 'api_key', logoLetter: 'NK', colorHex: '#FF7555',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/naukri/workspace', suggestedAgent: 'Hiring Agent',
    fields: [
      { key: 'api_key', label: 'API key', type: 'password', helpText: 'Naukri RMS → Settings → API Credentials' },
      { key: 'client_id', label: 'Client ID', type: 'text', helpText: 'Provided with your Naukri RMS subscription' },
    ],
  },
  {
    appId: 'linkedin', serviceId: 'linkedin', name: 'LinkedIn Recruiter',
    description: 'Search candidates, send InMails, and post jobs on the world\'s largest professional network.',
    category: 'recruitment', auth: 'oauth', logoLetter: 'in', colorHex: '#0A66C2',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/linkedin/workspace', suggestedAgent: 'Hiring Agent',
  },
  {
    appId: 'apna', serviceId: 'apna', name: 'Apna',
    description: "India's leading blue-collar hiring platform — connect with 60M+ job seekers in vernacular languages.",
    category: 'recruitment', auth: 'api_key', logoLetter: 'AP', colorHex: '#2563EB',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'iimjobs', serviceId: 'iimjobs', name: 'IIMJobs',
    description: 'Premium job portal for management professionals and senior hiring in India.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'IJ', colorHex: '#1E3A8A',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'instahyre', serviceId: 'instahyre', name: 'Instahyre',
    description: 'AI-powered recruiting platform for tech talent — sourcing, screening, and scheduling.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'IH', colorHex: '#6366F1',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'shine', serviceId: 'shine', name: 'Shine.com',
    description: 'Leading job portal in India with 30M+ registered candidates across all sectors.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'SH', colorHex: '#F59E0B',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'cutshort', serviceId: 'cutshort', name: 'Cutshort',
    description: 'AI-first hiring platform for tech roles — automated matching and screening.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'CS', colorHex: '#0EA5E9',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'greenhouse', serviceId: 'greenhouse', name: 'Greenhouse',
    description: 'Structured hiring platform — job boards, scorecards, and interview kits.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'GR', colorHex: '#24A148',
    productionStatus: 'coming_soon', suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'on_behalf_of', label: 'On behalf of user ID', type: 'text' }],
  },
  {
    appId: 'workable', serviceId: 'workable', name: 'Workable',
    description: 'End-to-end recruitment software with job posting, screening, and onboarding.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'WK', colorHex: '#4CAF50',
    productionStatus: 'coming_soon', suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'subdomain', label: 'Subdomain', type: 'text' }],
  },
  {
    appId: 'lever', serviceId: 'lever', name: 'Lever',
    description: 'Talent acquisition suite for sourcing, nurturing, and hiring top candidates.',
    category: 'recruitment', auth: 'oauth', logoLetter: 'LV', colorHex: '#1B1B1B',
    productionStatus: 'coming_soon', suggestedAgent: 'Hiring Agent',
  },
  {
    appId: 'smartrecruiters', serviceId: 'smartrecruiters', name: 'SmartRecruiters',
    description: 'Enterprise talent acquisition platform with collaborative hiring workflows.',
    category: 'recruitment', auth: 'oauth', logoLetter: 'SR', colorHex: '#00BCD4',
    productionStatus: 'coming_soon', suggestedAgent: 'Hiring Agent',
  },
  {
    appId: 'ashby', serviceId: 'ashby', name: 'Ashby',
    description: 'All-in-one recruiting platform with advanced analytics and automation.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'AB', colorHex: '#5B5EA6',
    productionStatus: 'coming_soon', suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'wellfound', serviceId: 'wellfound', name: 'Wellfound',
    description: 'Startup-focused talent marketplace — connect with startup-ready candidates.',
    category: 'recruitment', auth: 'api_key', logoLetter: 'WF', colorHex: '#000000',
    productionStatus: 'coming_soon', suggestedAgent: 'Hiring Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'zoho-recruit', serviceId: 'zoho_recruit', name: 'Zoho Recruit',
    description: 'Applicant tracking system with AI sourcing, video interviews, and onboarding.',
    category: 'recruitment', auth: 'oauth', logoLetter: 'ZR', colorHex: '#E42527',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Hiring Agent',
  },

  /* ── Finance & Accounting ─────────────────────────────────────────── */
  {
    appId: 'tally', serviceId: 'tally', name: 'TallyPrime',
    description: 'The most widely used accounting software in India — GST, invoicing, payroll, and inventory.',
    category: 'finance', auth: 'api_key', logoLetter: 'TP', colorHex: '#004B87',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/tally/workspace', suggestedAgent: 'Finance Ops Agent',
    fields: [
      { key: 'api_key', label: 'API key', type: 'password', helpText: 'TallyPrime → F1 Configuration → API Settings → Generate Key' },
      { key: 'company_name', label: 'Company name (as in Tally)', type: 'text', helpText: 'Exact company name from your Tally data' },
    ],
  },
  {
    appId: 'cashfree', serviceId: 'cashfree', name: 'Cashfree Payments',
    description: 'Accept payments, initiate payouts, and query settlements via Cashfree — India\'s leading payments platform.',
    category: 'finance', auth: 'api_key', logoLetter: 'CF', colorHex: '#1A73E8',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/cashfree/workspace', suggestedAgent: 'Finance Ops Agent',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', helpText: 'Cashfree Dashboard → Developers → API Keys' },
      { key: 'client_secret', label: 'Client secret', type: 'password', helpText: 'Cashfree Dashboard → Developers → API Keys' },
    ],
  },
  {
    appId: 'cleartax', serviceId: 'cleartax', name: 'ClearTax',
    description: 'GST filing, e-invoicing, and tax compliance automation for Indian businesses.',
    category: 'finance', auth: 'api_key', logoLetter: 'CT', colorHex: '#F7941D',
    productionStatus: 'production_ready', isIndiaNative: true,
    suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password', helpText: 'ClearTax → Settings → API Access → Generate Key' }],
  },
  {
    appId: 'zoho-books', serviceId: 'zoho_books', name: 'Zoho Books',
    description: 'GST-compliant accounting software for Indian SMBs — invoicing, expenses, and reconciliation.',
    category: 'finance', auth: 'api_key', logoLetter: 'ZB', colorHex: '#E42527',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'organization_id', label: 'Organization ID', type: 'text' }],
  },
  {
    appId: 'razorpay', serviceId: 'razorpay', name: 'Razorpay',
    description: 'India\'s leading payment gateway — payments, subscriptions, and instant settlements.',
    category: 'finance', auth: 'api_key', logoLetter: 'RZ', colorHex: '#3395FF',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'key_id', label: 'Key ID', type: 'text' }, { key: 'key_secret', label: 'Key secret', type: 'password' }],
  },
  {
    appId: 'payu', serviceId: 'payu', name: 'PayU',
    description: 'Payments and financial services platform trusted by 500K+ Indian businesses.',
    category: 'finance', auth: 'api_key', logoLetter: 'PU', colorHex: '#FF9800',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'merchant_key', label: 'Merchant key', type: 'text' }, { key: 'merchant_salt', label: 'Merchant salt', type: 'password' }],
  },
  {
    appId: 'paytm-business', serviceId: 'paytm_business', name: 'Paytm Business',
    description: 'Payment gateway, QR codes, and digital banking for Indian merchants.',
    category: 'finance', auth: 'api_key', logoLetter: 'PB', colorHex: '#00BAF2',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'merchant_id', label: 'Merchant ID', type: 'text' }, { key: 'merchant_key', label: 'Merchant key', type: 'password' }],
  },
  {
    appId: 'razorpayx-payroll', serviceId: 'razorpayx_payroll', name: 'RazorpayX Payroll',
    description: 'Automated payroll disbursement and compliance for Indian companies via RazorpayX.',
    category: 'finance', auth: 'api_key', logoLetter: 'RX', colorHex: '#3395FF',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'marg-erp', serviceId: 'marg_erp', name: 'Marg ERP 9+',
    description: 'Popular ERP for pharmacy, FMCG, and distribution businesses across India.',
    category: 'finance', auth: 'api_key', logoLetter: 'ME', colorHex: '#C0392B',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'quickbooks', serviceId: 'quickbooks', name: 'QuickBooks',
    description: 'Invoices, expenses, and financial reports for finance agents.',
    category: 'finance', auth: 'oauth', logoLetter: 'QB', colorHex: '#2CA01C',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/quickbooks/workspace', suggestedAgent: 'Finance Ops Agent',
  },
  {
    appId: 'xero', serviceId: 'xero', name: 'Xero',
    description: 'Cloud accounting software for small businesses — invoicing, payroll, and reporting.',
    category: 'finance', auth: 'oauth', logoLetter: 'XR', colorHex: '#13B5EA',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
  },
  {
    appId: 'chargebee', serviceId: 'chargebee', name: 'Chargebee',
    description: 'Subscription billing and revenue operations for SaaS and subscription businesses.',
    category: 'finance', auth: 'api_key', logoLetter: 'CB', colorHex: '#FF5722',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'site', label: 'Site name', type: 'text' }],
  },
  {
    appId: 'expensify', serviceId: 'expensify', name: 'Expensify',
    description: 'Expense management, receipt scanning, and corporate card controls.',
    category: 'finance', auth: 'oauth', logoLetter: 'EX', colorHex: '#03A9F4',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
  },
  {
    appId: 'sap-concur', serviceId: 'sap_concur', name: 'SAP Concur',
    description: 'Travel and expense management for enterprises — booking, claims, and compliance.',
    category: 'finance', auth: 'oauth', logoLetter: 'SC', colorHex: '#008FD3',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
  },
  {
    appId: 'stripe', serviceId: 'stripe', name: 'Stripe',
    description: 'Payment processing, subscriptions, and revenue data for global businesses.',
    category: 'finance', auth: 'api_key', logoLetter: 'ST', colorHex: '#635BFF',
    productionStatus: 'production_ready', suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'secret_key', label: 'Secret key', type: 'password', helpText: 'Stripe Dashboard → Developers → API Keys → Secret key' }],
  },

  /* ── Communication ────────────────────────────────────────────────── */
  {
    appId: 'whatsapp-business', serviceId: 'whatsapp_business', name: 'WhatsApp Business',
    description: 'Send approval requests, HR notifications, and payment alerts directly to WhatsApp — India\'s #1 channel.',
    category: 'communication', auth: 'api_key', logoLetter: 'WA', colorHex: '#25D366',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/whatsapp/workspace', suggestedAgent: 'Team Communication Agent',
    fields: [
      { key: 'access_token', label: 'Access token', type: 'password', helpText: 'Meta Developer Portal → WhatsApp → API Setup → Temporary access token' },
      { key: 'phone_number_id', label: 'Phone number ID', type: 'text', helpText: 'Meta Developer Portal → WhatsApp → API Setup → Phone number ID' },
    ],
  },
  {
    appId: 'slack', serviceId: 'slack', name: 'Slack',
    description: 'Read channels, send messages, and post incident alerts automatically.',
    category: 'communication', auth: 'oauth', logoLetter: 'SL', colorHex: '#4A154B',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/slack/workspace', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'google-workspace', serviceId: 'google_workspace', name: 'Google Workspace',
    description: 'Gmail, Calendar, and Drive. Agents can onboard employees, send emails, and schedule meetings.',
    category: 'communication', auth: 'oauth', logoLetter: 'GW', colorHex: '#4285F4',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/google-workspace/workspace', suggestedAgent: 'Email Assistant',
  },
  {
    appId: 'microsoft-teams', serviceId: 'microsoft_teams', name: 'Microsoft Teams',
    description: 'Send notifications, create channels, and post agent updates in Microsoft Teams.',
    category: 'communication', auth: 'oauth', logoLetter: 'MT', colorHex: '#5059C9',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'zoom', serviceId: 'zoom', name: 'Zoom',
    description: 'Schedule meetings, generate transcripts, and automate follow-ups via Zoom.',
    category: 'communication', auth: 'oauth', logoLetter: 'ZM', colorHex: '#2D8CFF',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'google-chat', serviceId: 'google_chat', name: 'Google Chat',
    description: 'Send messages and notifications to Google Chat spaces and DMs.',
    category: 'communication', auth: 'oauth', logoLetter: 'GC', colorHex: '#00897B',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'twilio', serviceId: 'twilio', name: 'Twilio',
    description: 'Send SMS, voice calls, and programmable communications at scale.',
    category: 'communication', auth: 'api_key', logoLetter: 'TW', colorHex: '#F22F46',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
    fields: [{ key: 'account_sid', label: 'Account SID', type: 'text' }, { key: 'auth_token', label: 'Auth token', type: 'password' }],
  },
  {
    appId: 'loom', serviceId: 'loom', name: 'Loom',
    description: 'Record and share screen videos — automate onboarding videos and tutorials.',
    category: 'communication', auth: 'oauth', logoLetter: 'LO', colorHex: '#625DF5',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },

  /* ── Support & CX ─────────────────────────────────────────────────── */
  {
    appId: 'freshdesk', serviceId: 'freshdesk', name: 'Freshdesk',
    description: 'Triage tickets, auto-draft replies, and monitor SLAs with AI agents.',
    category: 'support', auth: 'api_key', logoLetter: 'FD', colorHex: '#25C16F',
    productionStatus: 'production_ready', isIndiaNative: true,
    workspaceRoute: 'apps/freshdesk/workspace', suggestedAgent: 'Support Agent',
    fields: [
      { key: 'api_key', label: 'API key', type: 'password', helpText: 'Freshdesk → Profile Settings → API Key' },
      { key: 'domain', label: 'Domain (e.g. yourco.freshdesk.com)', type: 'text' },
    ],
  },
  {
    appId: 'exotel', serviceId: 'exotel', name: 'Exotel',
    description: 'India\'s leading cloud telephony platform — calls, SMS, and IVR for customer support.',
    category: 'support', auth: 'api_key', logoLetter: 'EX', colorHex: '#E84C30',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Support Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'api_token', label: 'API token', type: 'password' }, { key: 'sid', label: 'SID', type: 'text' }],
  },
  {
    appId: 'ozonetel', serviceId: 'ozonetel', name: 'Ozonetel',
    description: 'Cloud contact center platform built for Indian businesses with regional language support.',
    category: 'support', auth: 'api_key', logoLetter: 'OZ', colorHex: '#FF6B35',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Support Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'zendesk', serviceId: 'zendesk', name: 'Zendesk',
    description: 'Customer support tickets, agents, and helpdesk automation.',
    category: 'support', auth: 'api_key', logoLetter: 'ZD', colorHex: '#03363D',
    productionStatus: 'production_ready', suggestedAgent: 'Support Agent',
    fields: [
      { key: 'api_token', label: 'API token', type: 'password', helpText: 'Zendesk Admin → Apps & Integrations → Zendesk API → Add API token' },
      { key: 'subdomain', label: 'Subdomain', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
    ],
  },
  {
    appId: 'intercom', serviceId: 'intercom', name: 'Intercom',
    description: 'Customer messaging platform — live chat, product tours, and support automation.',
    category: 'support', auth: 'oauth', logoLetter: 'IC', colorHex: '#1F8DED',
    productionStatus: 'coming_soon', suggestedAgent: 'Support Agent',
  },
  {
    appId: 'help-scout', serviceId: 'help_scout', name: 'Help Scout',
    description: 'Shared inbox and helpdesk for customer-first support teams.',
    category: 'support', auth: 'api_key', logoLetter: 'HS', colorHex: '#1292EE',
    productionStatus: 'coming_soon', suggestedAgent: 'Support Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'gorgias', serviceId: 'gorgias', name: 'Gorgias',
    description: 'Customer support helpdesk built for e-commerce — Shopify, WooCommerce, and more.',
    category: 'support', auth: 'oauth', logoLetter: 'GG', colorHex: '#1B4DFF',
    productionStatus: 'coming_soon', suggestedAgent: 'Support Agent',
  },
  {
    appId: 'aircall', serviceId: 'aircall', name: 'Aircall',
    description: 'Cloud phone system for support and sales teams — call routing, IVR, and analytics.',
    category: 'support', auth: 'oauth', logoLetter: 'AC', colorHex: '#00D55B',
    productionStatus: 'coming_soon', suggestedAgent: 'Support Agent',
  },

  /* ── Sales & CRM ──────────────────────────────────────────────────── */
  {
    appId: 'hubspot', serviceId: 'hubspot', name: 'HubSpot',
    description: 'CRM contacts, deals pipeline, and marketing automation.',
    category: 'sales', auth: 'oauth', logoLetter: 'HS', colorHex: '#FF7A59',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/hubspot/workspace', suggestedAgent: 'Sales Agent',
  },
  {
    appId: 'salesforce', serviceId: 'salesforce', name: 'Salesforce',
    description: 'Leads, opportunities, and accounts for enterprise sales teams.',
    category: 'sales', auth: 'api_key', logoLetter: 'SF', colorHex: '#00A1E0',
    productionStatus: 'production_ready', suggestedAgent: 'Sales Agent',
    fields: [
      { key: 'access_token', label: 'Access token', type: 'password', helpText: 'Salesforce → Setup → My Personal Information → Reset Security Token' },
      { key: 'instance_url', label: 'Instance URL', type: 'text' },
    ],
  },
  {
    appId: 'zoho-crm', serviceId: 'zoho_crm', name: 'Zoho CRM',
    description: 'Complete CRM for Indian businesses — leads, deals, and customer lifecycle management.',
    category: 'sales', auth: 'oauth', logoLetter: 'ZC', colorHex: '#E42527',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
  },
  {
    appId: 'leadsquared', serviceId: 'leadsquared', name: 'LeadSquared',
    description: 'Sales CRM and marketing automation platform built for Indian growth teams.',
    category: 'sales', auth: 'api_key', logoLetter: 'LS', colorHex: '#E91E63',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'access_key', label: 'Access key', type: 'text' }, { key: 'secret_key', label: 'Secret key', type: 'password' }],
  },
  {
    appId: 'pipedrive', serviceId: 'pipedrive', name: 'Pipedrive',
    description: 'Sales CRM built by salespeople — pipeline management and activity tracking.',
    category: 'sales', auth: 'api_key', logoLetter: 'PD', colorHex: '#27AE60',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_token', label: 'API token', type: 'password' }],
  },
  {
    appId: 'freshsales', serviceId: 'freshsales', name: 'Freshsales',
    description: 'AI-powered CRM by Freshworks — leads, deals, and built-in phone and email.',
    category: 'sales', auth: 'api_key', logoLetter: 'FS', colorHex: '#00A651',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'domain', label: 'Domain', type: 'text' }],
  },
  {
    appId: 'apollo', serviceId: 'apollo', name: 'Apollo.io',
    description: 'Sales intelligence and engagement platform — prospect, enrich, and sequence outreach.',
    category: 'sales', auth: 'api_key', logoLetter: 'AL', colorHex: '#3B73FB',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },

  /* ── IT & Security ────────────────────────────────────────────────── */
  {
    appId: 'jira', serviceId: 'jira', name: 'Jira',
    description: 'Issue tracking, sprint planning, and project management.',
    category: 'it', auth: 'api_key', logoLetter: 'JR', colorHex: '#0052CC',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/jira/workspace', suggestedAgent: 'DevOps Agent',
    fields: [
      { key: 'api_token', label: 'API token', type: 'password', helpText: 'id.atlassian.com → Security → Create API token' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'domain', label: 'Atlassian domain (e.g. yourco.atlassian.net)', type: 'text' },
    ],
  },
  {
    appId: 'github', serviceId: 'github', name: 'GitHub',
    description: 'Repositories, issues, pull requests, and CI/CD pipeline management.',
    category: 'it', auth: 'api_key', logoLetter: 'GH', colorHex: '#24292E',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/github/workspace', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'access_token', label: 'Personal access token', type: 'password', helpText: 'GitHub → Settings → Developer Settings → Personal access tokens' }],
  },
  {
    appId: 'okta', serviceId: 'okta', name: 'Okta',
    description: 'Identity management, SSO, and user provisioning for enterprise teams.',
    category: 'it', auth: 'api_key', logoLetter: 'OK', colorHex: '#007DC1',
    productionStatus: 'production_ready', suggestedAgent: 'DevOps Agent',
    fields: [
      { key: 'api_token', label: 'API token', type: 'password', helpText: 'Okta Admin → Security → API → Tokens → Create Token' },
      { key: 'domain', label: 'Okta domain', type: 'text' },
    ],
  },
  {
    appId: 'gitlab', serviceId: 'gitlab', name: 'GitLab',
    description: 'DevOps platform — source code management, CI/CD, and security scanning.',
    category: 'it', auth: 'oauth', logoLetter: 'GL', colorHex: '#FC6D26',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
  },
  {
    appId: 'pagerduty', serviceId: 'pagerduty', name: 'PagerDuty',
    description: 'On-call alerting and incident management — trigger, acknowledge, and resolve incidents.',
    category: 'it', auth: 'api_key', logoLetter: 'PG', colorHex: '#06AC38',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'datadog', serviceId: 'datadog', name: 'Datadog',
    description: 'Infrastructure monitoring, APM, and log management for cloud-native apps.',
    category: 'it', auth: 'api_key', logoLetter: 'DD', colorHex: '#632CA6',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'app_key', label: 'App key', type: 'password' }],
  },
  {
    appId: 'sentry', serviceId: 'sentry', name: 'Sentry',
    description: 'Application monitoring and error tracking — detect, triage, and resolve issues fast.',
    category: 'it', auth: 'api_key', logoLetter: 'SN', colorHex: '#362D59',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'auth_token', label: 'Auth token', type: 'password' }],
  },
  {
    appId: 'new-relic', serviceId: 'new_relic', name: 'New Relic',
    description: 'Observability platform — full-stack performance monitoring and analytics.',
    category: 'it', auth: 'api_key', logoLetter: 'NR', colorHex: '#008C99',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'account_id', label: 'Account ID', type: 'text' }],
  },
  {
    appId: 'servicenow', serviceId: 'servicenow', name: 'ServiceNow',
    description: 'Enterprise ITSM platform — incident, change, and service request management.',
    category: 'it', auth: 'oauth', logoLetter: 'SN', colorHex: '#62D84E',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
  },
  {
    appId: 'freshservice', serviceId: 'freshservice', name: 'Freshservice',
    description: 'IT service management by Freshworks — incidents, assets, and change management.',
    category: 'it', auth: 'api_key', logoLetter: 'SV', colorHex: '#2B8000',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'domain', label: 'Domain', type: 'text' }],
  },
  {
    appId: 'azure', serviceId: 'azure', name: 'Azure',
    description: 'Microsoft Azure cloud services — VMs, storage, databases, and DevOps pipelines.',
    category: 'it', auth: 'oauth', logoLetter: 'AZ', colorHex: '#0089D6',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
  },
  {
    appId: 'aws', serviceId: 'aws', name: 'AWS',
    description: 'Amazon Web Services — EC2, S3, RDS, Lambda, and 200+ cloud services.',
    category: 'it', auth: 'api_key', logoLetter: 'AW', colorHex: '#FF9900',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'access_key_id', label: 'Access key ID', type: 'text' }, { key: 'secret_access_key', label: 'Secret access key', type: 'password' }],
  },
  {
    appId: 'auth0', serviceId: 'auth0', name: 'Auth0',
    description: 'Identity platform — authentication, authorization, and user management.',
    category: 'it', auth: 'api_key', logoLetter: 'A0', colorHex: '#EB5424',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'domain', label: 'Auth0 domain', type: 'text' }, { key: 'client_id', label: 'Client ID', type: 'text' }, { key: 'client_secret', label: 'Client secret', type: 'password' }],
  },
  {
    appId: 'flock', serviceId: 'flock', name: 'Flock',
    description: 'Team messaging and collaboration built in India — messaging, video calls, and productivity tools.',
    category: 'it', auth: 'oauth', logoLetter: 'FL', colorHex: '#6557FF',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'microsoft-entra', serviceId: 'microsoft_entra', name: 'Microsoft Entra ID',
    description: 'Azure Active Directory rebranded — identity, access management, and conditional access.',
    category: 'it', auth: 'oauth', logoLetter: 'ME', colorHex: '#0078D4',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
  },
  {
    appId: 'kissflow', serviceId: 'kissflow', name: 'Kissflow',
    description: 'Low-code workflow platform built for Indian enterprises — approvals, forms, and process automation.',
    category: 'it', auth: 'api_key', logoLetter: 'KF', colorHex: '#F44336',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'DevOps Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },

  /* ── Marketing ────────────────────────────────────────────────────── */
  {
    appId: 'moengage', serviceId: 'moengage', name: 'MoEngage',
    description: 'Customer engagement platform built in India — push, email, SMS, and in-app messaging.',
    category: 'marketing', auth: 'api_key', logoLetter: 'ME', colorHex: '#FF6B35',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'data_api_id', label: 'Data API ID', type: 'text' }, { key: 'data_api_key', label: 'Data API key', type: 'password' }],
  },
  {
    appId: 'clevertap', serviceId: 'clevertap', name: 'CleverTap',
    description: 'All-in-one customer retention platform — analytics, segmentation, and omnichannel campaigns.',
    category: 'marketing', auth: 'api_key', logoLetter: 'CT', colorHex: '#E91E63',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'account_id', label: 'Account ID', type: 'text' }, { key: 'passcode', label: 'Passcode', type: 'password' }],
  },
  {
    appId: 'webengage', serviceId: 'webengage', name: 'WebEngage',
    description: 'Marketing automation and analytics platform for B2C companies in India.',
    category: 'marketing', auth: 'api_key', logoLetter: 'WE', colorHex: '#FF4500',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'brevo', serviceId: 'brevo', name: 'Brevo',
    description: 'Email, SMS, and marketing automation — formerly Sendinblue.',
    category: 'marketing', auth: 'api_key', logoLetter: 'BR', colorHex: '#0092FF',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'mailchimp', serviceId: 'mailchimp', name: 'Mailchimp',
    description: 'Email marketing platform — campaigns, automations, and audience management.',
    category: 'marketing', auth: 'oauth', logoLetter: 'MC', colorHex: '#FFE01B',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
  },
  {
    appId: 'klaviyo', serviceId: 'klaviyo', name: 'Klaviyo',
    description: 'E-commerce marketing platform — email flows, SMS, and customer data.',
    category: 'marketing', auth: 'api_key', logoLetter: 'KL', colorHex: '#000000',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'mailmodo', serviceId: 'mailmodo', name: 'Mailmodo',
    description: 'Interactive email marketing platform built in India — AMP emails and automation.',
    category: 'marketing', auth: 'api_key', logoLetter: 'MM', colorHex: '#7C3AED',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },

  /* ── Analytics & BI ───────────────────────────────────────────────── */
  {
    appId: 'posthog', serviceId: 'posthog', name: 'PostHog',
    description: 'Product analytics, session recordings, and feature flags — all in one open-source platform.',
    category: 'analytics', auth: 'oauth', logoLetter: 'PH', colorHex: '#F54E00',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
  },
  {
    appId: 'mixpanel', serviceId: 'mixpanel', name: 'Mixpanel',
    description: 'Event-based product analytics — track user behavior and measure conversion funnels.',
    category: 'analytics', auth: 'api_key', logoLetter: 'MX', colorHex: '#7856FF',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'project_token', label: 'Project token', type: 'text' }, { key: 'service_account_secret', label: 'Service account secret', type: 'password' }],
  },
  {
    appId: 'amplitude', serviceId: 'amplitude', name: 'Amplitude',
    description: 'Digital analytics platform — understand user behavior and drive product growth.',
    category: 'analytics', auth: 'api_key', logoLetter: 'AM', colorHex: '#1271E8',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'api_key', label: 'API key', type: 'text' }, { key: 'secret_key', label: 'Secret key', type: 'password' }],
  },
  {
    appId: 'metabase', serviceId: 'metabase', name: 'Metabase',
    description: 'Open-source BI tool — build dashboards and run queries on your data.',
    category: 'analytics', auth: 'api_key', logoLetter: 'MB', colorHex: '#509EE3',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'url', label: 'Metabase URL', type: 'text' }, { key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'tableau', serviceId: 'tableau', name: 'Tableau',
    description: 'Data visualization and BI platform — interactive dashboards and visual analytics.',
    category: 'analytics', auth: 'api_key', logoLetter: 'TB', colorHex: '#E97627',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'token_name', label: 'Token name', type: 'text' }, { key: 'token_value', label: 'Token value', type: 'password' }],
  },
  {
    appId: 'snowflake', serviceId: 'snowflake', name: 'Snowflake',
    description: 'Cloud data warehouse — query structured and semi-structured data at scale.',
    category: 'analytics', auth: 'api_key', logoLetter: 'SF', colorHex: '#29B5E8',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'account', label: 'Account identifier', type: 'text' }, { key: 'username', label: 'Username', type: 'text' }, { key: 'password', label: 'Password', type: 'password' }],
  },
  {
    appId: 'power-bi', serviceId: 'power_bi', name: 'Power BI',
    description: 'Microsoft\'s BI tool — connect, visualize, and share business intelligence.',
    category: 'analytics', auth: 'oauth', logoLetter: 'PB', colorHex: '#F2C811',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
  },
  {
    appId: 'looker', serviceId: 'looker', name: 'Looker',
    description: 'Google\'s BI and data platform — explore, share, and embed analytics.',
    category: 'analytics', auth: 'api_key', logoLetter: 'LK', colorHex: '#4285F4',
    productionStatus: 'coming_soon', suggestedAgent: 'Finance Ops Agent',
    fields: [{ key: 'client_id', label: 'Client ID', type: 'text' }, { key: 'client_secret', label: 'Client secret', type: 'password' }],
  },

  /* ── Compliance & Legal ───────────────────────────────────────────── */
  {
    appId: 'idfy', serviceId: 'idfy', name: 'IDfy',
    description: 'Digital KYC and background verification platform built for India — Aadhaar, PAN, and more.',
    category: 'compliance', auth: 'api_key', logoLetter: 'ID', colorHex: '#1565C0',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }, { key: 'account_id', label: 'Account ID', type: 'text' }],
  },
  {
    appId: 'hyperverge', serviceId: 'hyperverge', name: 'HyperVerge',
    description: 'AI-powered KYC, onboarding, and fraud prevention — trusted by 200+ Indian fintechs.',
    category: 'compliance', auth: 'api_key', logoLetter: 'HV', colorHex: '#6C63FF',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'app_id', label: 'App ID', type: 'text' }, { key: 'app_key', label: 'App key', type: 'password' }],
  },
  {
    appId: 'leegality', serviceId: 'leegality', name: 'Leegality',
    description: 'India\'s leading e-signature and document automation platform — legally binding across courts.',
    category: 'compliance', auth: 'api_key', logoLetter: 'LG', colorHex: '#2E7D32',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'docusign', serviceId: 'docusign', name: 'DocuSign',
    description: 'Electronic signature and agreement cloud — send, sign, and manage documents.',
    category: 'compliance', auth: 'api_key', logoLetter: 'DS', colorHex: '#FFCE00',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
    fields: [{ key: 'integration_key', label: 'Integration key', type: 'text' }, { key: 'secret_key', label: 'Secret key', type: 'password' }],
  },
  {
    appId: 'zoho-sign', serviceId: 'zoho_sign', name: 'Zoho Sign',
    description: 'Digital signature solution by Zoho — Aadhaar-based e-signature for Indian compliance.',
    category: 'compliance', auth: 'api_key', logoLetter: 'ZS', colorHex: '#E42527',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'HR Assistant',
    fields: [{ key: 'oauth_token', label: 'OAuth token', type: 'password' }],
  },
  {
    appId: 'vanta', serviceId: 'vanta', name: 'Vanta',
    description: 'Automated security compliance — SOC 2, ISO 27001, GDPR, and HIPAA in weeks.',
    category: 'compliance', auth: 'api_key', logoLetter: 'VA', colorHex: '#6C2BD9',
    productionStatus: 'coming_soon',
    fields: [{ key: 'api_token', label: 'API token', type: 'password' }],
  },
  {
    appId: 'drata', serviceId: 'drata', name: 'Drata',
    description: 'Continuous security and compliance automation — evidence collection on autopilot.',
    category: 'compliance', auth: 'api_key', logoLetter: 'DR', colorHex: '#5C54F0',
    productionStatus: 'coming_soon',
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'signdesk', serviceId: 'signdesk', name: 'SignDesk',
    description: 'Document workflow and e-signature platform with Aadhaar-based verification for Indian enterprises.',
    category: 'compliance', auth: 'api_key', logoLetter: 'SD', colorHex: '#1A73E8',
    productionStatus: 'coming_soon', isIndiaNative: true,
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'vakilsearch', serviceId: 'vakilsearch', name: 'Vakilsearch',
    description: 'Online legal services for Indian businesses — company registration, contracts, and compliance filings.',
    category: 'compliance', auth: 'api_key', logoLetter: 'VS', colorHex: '#E53935',
    productionStatus: 'coming_soon', isIndiaNative: true,
    fields: [{ key: 'api_key', label: 'API key', type: 'password' }],
  },
  {
    appId: 'digilocker', serviceId: 'digilocker', name: 'DigiLocker',
    description: 'India\'s official digital document wallet — verify Aadhaar, PAN, driving license instantly.',
    category: 'compliance', auth: 'oauth', logoLetter: 'DL', colorHex: '#0066B3',
    productionStatus: 'coming_soon', isIndiaNative: true,
  },

  /* ── Productivity ─────────────────────────────────────────────────── */
  {
    appId: 'notion', serviceId: 'notion', name: 'Notion',
    description: 'Access and update pages, databases, and wikis from your AI agents.',
    category: 'productivity', auth: 'api_key', logoLetter: 'NO', colorHex: '#1E1E1E',
    productionStatus: 'production_ready',
    workspaceRoute: 'apps/notion/workspace', suggestedAgent: 'Team Communication Agent',
    fields: [{ key: 'api_key', label: 'Integration token', type: 'password', helpText: 'Notion → Settings → Connections → Develop or manage integrations → New Integration' }],
  },
  {
    appId: 'asana', serviceId: 'asana', name: 'Asana',
    description: 'Project management and task tracking — organize work, automate workflows, and hit deadlines.',
    category: 'productivity', auth: 'oauth', logoLetter: 'AS', colorHex: '#F06A6A',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
  },
  {
    appId: 'monday', serviceId: 'monday', name: 'Monday.com',
    description: 'Work OS — manage projects, teams, and workflows in one visual platform.',
    category: 'productivity', auth: 'oauth', logoLetter: 'MN', colorHex: '#FF3D57',
    productionStatus: 'coming_soon', suggestedAgent: 'DevOps Agent',
  },
  {
    appId: 'figma', serviceId: 'figma', name: 'Figma',
    description: 'Collaborative design platform — access designs, comments, and prototypes.',
    category: 'productivity', auth: 'oauth', logoLetter: 'FG', colorHex: '#F24E1E',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'canva', serviceId: 'canva', name: 'Canva',
    description: 'Design and visual content creation — generate branded assets at scale.',
    category: 'productivity', auth: 'oauth', logoLetter: 'CA', colorHex: '#00C4CC',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'calendly', serviceId: 'calendly', name: 'Calendly',
    description: 'Automated scheduling — book meetings without back-and-forth emails.',
    category: 'productivity', auth: 'oauth', logoLetter: 'CL', colorHex: '#006BFF',
    productionStatus: 'coming_soon', suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'miro', serviceId: 'miro', name: 'Miro',
    description: 'Online collaborative whiteboard — brainstorm, plan, and collaborate visually.',
    category: 'productivity', auth: 'oauth', logoLetter: 'MI', colorHex: '#FFD02F',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'shopify', serviceId: 'shopify', name: 'Shopify',
    description: 'E-commerce platform — manage orders, inventory, and customers.',
    category: 'productivity', auth: 'oauth', logoLetter: 'SP', colorHex: '#96BF48',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
  },
  {
    appId: 'shiprocket', serviceId: 'shiprocket', name: 'Shiprocket',
    description: 'India\'s largest shipping aggregator — multi-carrier logistics for D2C and e-commerce brands.',
    category: 'productivity', auth: 'api_key', logoLetter: 'SR', colorHex: '#FF6B35',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'email', label: 'Email', type: 'text' }, { key: 'password', label: 'Password', type: 'password' }],
  },
  {
    appId: 'unicommerce', serviceId: 'unicommerce', name: 'Unicommerce',
    description: 'Multi-channel order management and fulfillment platform for Indian e-commerce.',
    category: 'productivity', auth: 'api_key', logoLetter: 'UC', colorHex: '#E91E63',
    productionStatus: 'coming_soon', isIndiaNative: true, suggestedAgent: 'Sales Agent',
    fields: [{ key: 'access_token', label: 'Access token', type: 'password' }],
  },
  {
    appId: 'dropbox-business', serviceId: 'dropbox_business', name: 'Dropbox Business',
    description: 'Cloud storage and collaboration — secure file sharing and team folders.',
    category: 'productivity', auth: 'oauth', logoLetter: 'DB', colorHex: '#0061FF',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'box', serviceId: 'box', name: 'Box',
    description: 'Cloud content management — secure file storage, sharing, and collaboration.',
    category: 'productivity', auth: 'oauth', logoLetter: 'BX', colorHex: '#0061D5',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },
  {
    appId: 'woocommerce', serviceId: 'woocommerce', name: 'WooCommerce',
    description: 'WordPress e-commerce plugin — manage products, orders, and customers.',
    category: 'productivity', auth: 'api_key', logoLetter: 'WC', colorHex: '#96588A',
    productionStatus: 'coming_soon', suggestedAgent: 'Sales Agent',
    fields: [{ key: 'consumer_key', label: 'Consumer key', type: 'text' }, { key: 'consumer_secret', label: 'Consumer secret', type: 'password' }, { key: 'store_url', label: 'Store URL', type: 'text' }],
  },
  {
    appId: 'zapier', serviceId: 'zapier', name: 'Zapier',
    description: 'Connect any app to Zapheit — trigger Zaps from governed agent actions.',
    category: 'productivity', auth: 'oauth', logoLetter: 'ZP', colorHex: '#FF4A00',
    productionStatus: 'coming_soon', suggestedAgent: 'Team Communication Agent',
  },

  /* ── Government & Special ─────────────────────────────────────────── */
  {
    appId: 'epfo', serviceId: 'epfo', name: 'EPFO',
    description: 'Employees Provident Fund Organisation — automate PF filing, ECR upload, and compliance.',
    category: 'government', auth: 'api_key', logoLetter: 'EP', colorHex: '#006400',
    productionStatus: 'special', isIndiaNative: true, suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'aadhaar-api', serviceId: 'aadhaar_api', name: 'Aadhaar API',
    description: 'UIDAI\'s official API — Aadhaar-based identity verification and e-KYC for Indian businesses.',
    category: 'government', auth: 'api_key', logoLetter: 'AA', colorHex: '#FF6600',
    productionStatus: 'special', isIndiaNative: true, suggestedAgent: 'HR Assistant',
  },
  {
    appId: 'google-cloud-platform', serviceId: 'gcp', name: 'Google Cloud Platform',
    description: 'GCP infrastructure — BigQuery, GCS, Cloud Run, and 100+ managed services.',
    category: 'government', auth: 'api_key', logoLetter: 'GC', colorHex: '#4285F4',
    productionStatus: 'special',
    fields: [{ key: 'service_account_json', label: 'Service account JSON', type: 'password' }],
  },
];

/* ─────────────────────────────────────────────────────────────────────────
   Category tabs
──────────────────────────────────────────────────────────────────────────── */

const CATEGORY_TABS = [
  { id: 'all',          label: 'All',                  Icon: LayoutGrid },
  { id: 'hr',           label: 'HR & People',           Icon: Users },
  { id: 'recruitment',  label: 'Recruitment & Hiring',  Icon: Building2 },
  { id: 'finance',      label: 'Finance & Accounting',  Icon: Receipt },
  { id: 'communication',label: 'Communication',         Icon: MessageSquare },
  { id: 'it',           label: 'IT & Security',         Icon: Shield },
  { id: 'sales',        label: 'Sales & CRM',           Icon: TrendingUp },
  { id: 'support',      label: 'Support & CX',          Icon: Headphones },
  { id: 'marketing',    label: 'Marketing',             Icon: Zap },
  { id: 'analytics',    label: 'Analytics & BI',        Icon: BarChart3 },
  { id: 'compliance',   label: 'Compliance & Legal',    Icon: Scale },
  { id: 'productivity', label: 'Productivity',          Icon: LayoutGrid },
  { id: 'government',   label: 'Government & Special',  Icon: Landmark },
];

/* ─────────────────────────────────────────────────────────────────────────
   One-click Stacks
──────────────────────────────────────────────────────────────────────────── */

const STACKS: AppStack[] = [
  {
    id: 'hr-stack', name: 'HR Stack', description: 'Hire, onboard, manage, and pay your people from one place.',
    appIds: ['greythr', 'naukri', 'linkedin'], colorHex: '#00529B',
    Icon: Users,
  },
  {
    id: 'finance-stack', name: 'Finance Stack', description: 'GST filing, payments, and accounting — all governed.',
    appIds: ['tally', 'cashfree', 'cleartax'], colorHex: '#1A73E8',
    Icon: Receipt,
  },
  {
    id: 'recruitment-stack', name: 'Recruitment Stack', description: 'Source candidates from every major Indian platform.',
    appIds: ['linkedin', 'naukri', 'apna'], colorHex: '#0A66C2',
    Icon: Building2,
  },
  {
    id: 'support-stack', name: 'Support Stack', description: 'Triage tickets, handle calls, and notify on WhatsApp.',
    appIds: ['freshdesk', 'exotel', 'whatsapp-business'], colorHex: '#25C16F',
    Icon: Headphones,
  },
];

/* ─────────────────────────────────────────────────────────────────────────
   Popular in India — featured app IDs
──────────────────────────────────────────────────────────────────────────── */

const INDIA_POPULAR_IDS = [
  'whatsapp-business', 'naukri', 'greythr', 'tally',
  'cashfree', 'cleartax', 'freshdesk', 'zoho-crm',
];

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

type ConnStatus = 'connected' | 'disconnected' | 'error';

function resolveStatus(app: AppDef, backendApp: any): ConnStatus {
  if (!backendApp) return 'disconnected';
  const s = backendApp.status || backendApp.connectionStatus || backendApp.connection_status || '';
  if (s === 'connected') return 'connected';
  if (s === 'error' || s === 'expired') return 'error';
  return 'disconnected';
}

function resolveHealth(backendApp: any): { label: string; good: boolean } | null {
  if (!backendApp) return null;
  const lastSync = backendApp.last_sync_at || backendApp.lastSyncAt;
  const lastErr = backendApp.last_error_at || backendApp.lastErrorAt;
  if (lastErr && (!lastSync || new Date(lastErr) > new Date(lastSync))) {
    const msg = backendApp.last_error_msg || backendApp.lastErrorMsg || 'Connection error';
    return { label: msg.slice(0, 40), good: false };
  }
  if (lastSync) {
    const mins = Math.round((Date.now() - new Date(lastSync).getTime()) / 60000);
    const label = mins < 2 ? 'Just synced' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
    return { label: `Last sync ${label}`, good: true };
  }
  return null;
}

function formatLastSync(backendApp: any): string | null {
  const ts = backendApp?.last_sync_at || backendApp?.lastSyncAt || backendApp?.connected_at;
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ─────────────────────────────────────────────────────────────────────────
   CredForm — enhanced with helpText + test-connection step
──────────────────────────────────────────────────────────────────────────── */

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function CredForm({
  app,
  onSubmit,
  onCancel,
  submitting,
}: {
  app: AppDef;
  onSubmit: (creds: Record<string, string>) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const fields = app.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<TestState>('idle');
  const [testError, setTestError] = useState('');

  const set = (k: string, v: string) => { setValues((p) => ({ ...p, [k]: v })); setTestState('idle'); };
  const toggle = (k: string) => setShown((p) => ({ ...p, [k]: !p[k] }));
  const ready = fields.every((f) => values[f.key]?.trim());

  const handleConnect = async () => {
    setTestState('testing');
    setTestError('');
    try {
      const res = await authenticatedFetch<{ success: boolean; message?: string }>(`/marketplace/apps/${app.appId}/test`, {
        method: 'POST',
        body: JSON.stringify({ credentials: values }),
      });
      if (!res.success || res.data?.success === false) {
        setTestState('fail');
        setTestError((res.data as any)?.message || res.error || "That API key didn't work. Double-check it in your app settings and try again.");
        return;
      }
      setTestState('ok');
      onSubmit(values);
    } catch {
      setTestState('fail');
      setTestError("Couldn't reach the server. Check your internet connection and try again.");
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-medium text-slate-400 mb-1">{f.label}</label>
          <div className="flex items-center gap-1">
            <input
              type={f.type === 'password' && !shown[f.key] ? 'password' : 'text'}
              value={values[f.key] || ''}
              onChange={(e) => set(f.key, e.target.value)}
              className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors"
              placeholder={f.type === 'password' ? '••••••••' : f.label}
            />
            {f.type === 'password' && (
              <button type="button" onClick={() => toggle(f.key)} className="p-2 text-slate-500 hover:text-slate-300">
                {shown[f.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
          </div>
          {f.helpText && (
            <p className="mt-1 text-[11px] text-slate-500">
              <span className="text-blue-400/70">Where to find it:</span> {f.helpText}
            </p>
          )}
        </div>
      ))}

      {testState === 'fail' && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
          <p className="text-xs text-rose-300">{testError}</p>
        </div>
      )}

      {testState === 'ok' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">Connection verified — saving…</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || submitting || testState === 'testing' || testState === 'ok'}
          onClick={handleConnect}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {testState === 'testing' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Testing connection…</>
          ) : submitting || testState === 'ok' ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
          ) : (
            'Test & Connect'
          )}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Request Access Modal
──────────────────────────────────────────────────────────────────────────── */

function RequestAccessModal({ appName, onClose }: { appName: string; onClose: () => void }) {
  const [form, setForm] = useState({ app_name: appName, name: '', email: '', company: '', use_case: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const ready = form.name && form.email && form.company && form.use_case;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await authenticatedFetch('/api/marketplace/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appName.toLowerCase().replace(/\s+/g, '-'), app_name: form.app_name, use_case: `${form.name} (${form.company}, ${form.email}): ${form.use_case}` }),
      });
      setDone(true);
    } catch {
      toast.error('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1829] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Request access — {appName}</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {done ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-white">Request submitted!</p>
            <p className="text-xs text-slate-400">We'll notify you at {form.email} when {appName} is ready.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-xl bg-white/[0.07] text-sm text-slate-300 hover:bg-white/[0.12] transition-colors">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Tell us about your use case — this becomes our roadmap signal.</p>
            {[
              { k: 'name' as const, label: 'Your name', type: 'text' },
              { k: 'email' as const, label: 'Work email', type: 'email' },
              { k: 'company' as const, label: 'Company name', type: 'text' },
            ].map(({ k, label, type }) => (
              <div key={k}>
                <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={form[k]}
                  onChange={(e) => set(k, e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Use case</label>
              <textarea
                rows={3}
                value={form.use_case}
                onChange={(e) => set('use_case', e.target.value)}
                placeholder="What would you automate if this app were connected?"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
              <button
                disabled={!ready || submitting}
                onClick={handleSubmit}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Submit request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Stack Setup Card
──────────────────────────────────────────────────────────────────────────── */

function StackCard({ stack, onSelect }: { stack: AppStack; onSelect: () => void }) {
  const apps = stack.appIds.map((id) => APP_CATALOG.find((a) => a.appId === id)).filter(Boolean) as AppDef[];
  return (
    <button
      onClick={onSelect}
      className="shrink-0 w-56 rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] p-4 text-left transition-all hover:border-white/15 group"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: `${stack.colorHex}22`, border: `1px solid ${stack.colorHex}33` }}>
        <span style={{ color: stack.colorHex }} className="flex items-center justify-center"><stack.Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-sm font-semibold text-white mb-1">{stack.name}</p>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">{stack.description}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {apps.map((a) => (
          <span key={a.appId} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-400 font-medium">{a.name}</span>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-3 text-[11px] font-semibold group-hover:text-blue-400 text-slate-500 transition-colors">
        Set up <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   App Card
──────────────────────────────────────────────────────────────────────────── */

function AppCard({
  app,
  status,
  backendApp,
  onConnect,
  onDisconnect,
  onOpenWorkspace,
  onRequestAccess,
}: {
  app: AppDef;
  status: ConnStatus;
  backendApp: any;
  onConnect: (app: AppDef, creds?: Record<string, string>) => Promise<void>;
  onDisconnect: (app: AppDef) => Promise<void>;
  onOpenWorkspace: (app: AppDef) => void;
  onRequestAccess: (app: AppDef) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const connect = async (creds?: Record<string, string>) => {
    setBusy(true);
    try { await onConnect(app, creds); }
    finally { setBusy(false); setFormOpen(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await onDisconnect(app); }
    finally { setBusy(false); }
  };

  const health = resolveHealth(backendApp);
  const lastSync = formatLastSync(backendApp);
  const isConnected = status === 'connected';

  return (
    <div className={cn(
      'rounded-2xl border p-5 transition-all',
      isConnected ? 'border-emerald-500/15 bg-emerald-500/[0.03]' : 'border-white/8 bg-white/[0.02] hover:border-white/12',
    )}>
      <div className="flex items-start gap-4">
        {/* Logo */}
        <div className="relative shrink-0">
          <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} size="md" />
          {app.isIndiaNative && (
            <span className="absolute -top-1 -right-1 text-[10px] leading-none" title="India-native app">🇮🇳</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white">{app.name}</h3>

            {/* Status badge */}
            {isConnected && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 text-emerald-300 font-medium">
                Connected
              </span>
            )}
            {status === 'error' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-rose-400/20 bg-rose-500/10 text-rose-300 font-medium">
                Error
              </span>
            )}
            {app.productionStatus === 'coming_soon' && !isConnected && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-white/[0.04] text-slate-500 font-medium">
                Coming Soon
              </span>
            )}
            {app.productionStatus === 'special' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-400/20 bg-amber-500/10 text-amber-300 font-medium">
                Requires Approval
              </span>
            )}

            {/* Auth type */}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-500 font-mono">
              {app.auth === 'oauth' ? 'OAuth 2.0' : 'API Key'}
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-lg">{app.description}</p>

          {/* Connected details */}
          {isConnected && (
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {app.workspaceRoute && (
                <button
                  onClick={() => onOpenWorkspace(app)}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Open Workspace
                </button>
              )}
              {lastSync && (
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Clock className="w-3 h-3" /> {lastSync}
                </span>
              )}
            </div>
          )}

          {/* Health indicator */}
          {isConnected && health && (
            <div className={cn('mt-1.5 flex items-center gap-1.5 text-[11px]', health.good ? 'text-emerald-400/70' : 'text-amber-400')}>
              {health.good
                ? <RefreshCw className="w-3 h-3" />
                : <AlertCircle className="w-3 h-3" />}
              {health.label}
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="shrink-0">
          {isConnected ? (
            <div className="flex flex-col items-end gap-1.5">
              {app.workspaceRoute && (
                <button
                  onClick={() => onOpenWorkspace(app)}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                >
                  Open Workspace
                </button>
              )}
              <button
                onClick={() => void disconnect()}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/10 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Disconnect'}
              </button>
            </div>
          ) : app.productionStatus === 'coming_soon' ? (
            <button
              className="px-3 py-1.5 rounded-xl border border-slate-600/40 bg-white/[0.04] text-slate-500 text-xs font-semibold cursor-default"
              disabled
            >
              Coming Soon
            </button>
          ) : app.productionStatus === 'special' ? (
            <button
              onClick={() => onRequestAccess(app)}
              className="px-3 py-1.5 rounded-xl border border-amber-400/20 bg-amber-500/10 text-amber-300 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
            >
              Request Access
            </button>
          ) : app.auth === 'oauth' ? (
            <button
              onClick={() => void connect()}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Connect
            </button>
          ) : (
            <button
              onClick={() => setFormOpen((v) => !v)}
              disabled={busy}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.13] text-slate-200 text-xs font-semibold transition-colors"
            >
              {formOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Inline credential form */}
      {formOpen && app.fields && (
        <CredForm
          app={app}
          onSubmit={(creds) => void connect(creds)}
          onCancel={() => setFormOpen(false)}
          submitting={busy}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Page
──────────────────────────────────────────────────────────────────────────── */

interface AppsPageProps {
  agents?: AIAgent[];
  onNavigate?: (route: string) => void;
}

export default function AppsPage({ onNavigate }: AppsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [requestApp, setRequestApp] = useState<AppDef | null>(null);
  const [stackFilter, setStackFilter] = useState<string[] | null>(null);

  const { allApps, loading, reload } = useAppsData();

  // Handle OAuth callback
  useEffect(() => {
    const status  = searchParams.get('status');
    const service = searchParams.get('service') || searchParams.get('provider');
    const message = searchParams.get('message');
    if (!status || !service) return;

    if (status === 'connected') {
      void reload().then(() => {
        const app = APP_CATALOG.find((a) => a.serviceId === service || a.appId === service);
        toast.success(`${app?.name ?? service} connected`);
        if (app?.workspaceRoute && onNavigate) onNavigate(app.workspaceRoute);
      });
    } else if (status === 'error') {
      toast.error(message || 'Connection failed');
    }

    setSearchParams((p) => {
      p.delete('status'); p.delete('service'); p.delete('provider'); p.delete('message');
      return p;
    }, { replace: true });
  }, [searchParams, setSearchParams, reload, onNavigate]);

  // Merge backend status
  const apps = useMemo(() => APP_CATALOG.map((def) => {
    const backendApp = allApps.find((a) => {
      const sid = getAppServiceId(a);
      return a.appId === def.appId || sid === def.serviceId;
    });
    return { def, status: resolveStatus(def, backendApp), backendApp: backendApp ?? null };
  }), [allApps]);

  // Filter
  const filtered = useMemo(() => {
    let list = apps;
    if (stackFilter) list = list.filter(({ def }) => stackFilter.includes(def.appId));
    else if (activeCategory !== 'all') list = list.filter(({ def }) => def.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(({ def }) =>
        def.name.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q),
      );
    }
    // India-native apps sort to top within category
    return [...list].sort((a, b) => {
      if (a.def.isIndiaNative && !b.def.isIndiaNative) return -1;
      if (!a.def.isIndiaNative && b.def.isIndiaNative) return 1;
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (a.status !== 'connected' && b.status === 'connected') return 1;
      return 0;
    });
  }, [apps, activeCategory, search, stackFilter]);

  const connected = useMemo(() => apps.filter((a) => a.status === 'connected'), [apps]);
  const indiaNativeCount = useMemo(() => APP_CATALOG.filter((a) => a.isIndiaNative).length, []);
  const comingSoonCount = useMemo(() => APP_CATALOG.filter((a) => a.productionStatus === 'coming_soon').length, []);

  const popularInIndia = useMemo(
    () => INDIA_POPULAR_IDS.map((id) => apps.find(({ def }) => def.appId === id)).filter(Boolean) as typeof apps,
    [apps],
  );

  /* Connect handler */
  const handleConnect = useCallback(async (app: AppDef, creds?: Record<string, string>) => {
    if (app.auth === 'oauth') {
      window.location.href = api.integrations.getOAuthAuthorizeUrl(app.serviceId, '/dashboard/apps');
      return;
    }
    if (!creds) return;
    const res = await api.integrations.connect(app.serviceId, creds);
    if (res.success) {
      toast.success(`${app.name} connected`);
      void reload();
    } else {
      toast.error((res as any).error || 'Connection failed');
    }
  }, [reload]);

  const handleDisconnect = useCallback(async (app: AppDef) => {
    const res = await api.integrations.disconnect(app.serviceId);
    if (res.success) {
      toast.success(`${app.name} disconnected`);
      void reload();
    } else {
      toast.error((res as any).error || 'Disconnect failed');
    }
  }, [reload]);

  const handleOpenWorkspace = useCallback((app: AppDef) => {
    if (app.workspaceRoute && onNavigate) onNavigate(app.workspaceRoute);
  }, [onNavigate]);

  const handleStackSelect = (stack: AppStack) => {
    setStackFilter(stack.appIds);
    setActiveCategory('all');
    setSearch('');
  };

  const clearStackFilter = () => setStackFilter(null);

  return (
    <div className="min-h-full bg-[#080f1a] px-6 py-6">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400/80 mb-1">Apps</p>
          <h1 className="text-2xl font-bold text-white">Connect your tools</h1>
          <p className="text-sm text-slate-400 mt-1">
            Connect once — every action governed, every approval tracked, every audit logged automatically.
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            { label: 'Connected', value: connected.length, color: 'text-emerald-400' },
            { label: 'Available now', value: APP_CATALOG.filter((a) => a.productionStatus === 'production_ready').length, color: 'text-blue-400' },
            { label: 'Coming soon', value: comingSoonCount, color: 'text-slate-400' },
            { label: 'India-native', value: indiaNativeCount, color: 'text-orange-400' },
            { label: 'Categories', value: CATEGORY_TABS.length - 1, color: 'text-slate-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={cn('font-bold text-base', color)}>{value}</span>
              <span className="text-slate-500 text-xs">{label}</span>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search 150+ apps by name or category…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setStackFilter(null); }}
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/40 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Stack filter banner */}
        {stackFilter && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-2">
            <span className="text-xs text-blue-300 font-medium">Showing stack apps</span>
            <button onClick={clearStackFilter} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              <X className="w-3 h-3" /> Clear filter
            </button>
          </div>
        )}

        {/* Popular in India — only on "All" tab with no search/stack filter */}
        {!search && !stackFilter && activeCategory === 'all' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-white">🇮🇳 Popular in India</span>
              <span className="text-[10px] text-slate-500 font-medium px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/8">Featured</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {popularInIndia.map(({ def, status, backendApp }) => (
                <button
                  key={def.appId}
                  onClick={() => {
                    if (status === 'connected' && def.workspaceRoute) handleOpenWorkspace(def);
                    else { setSearch(def.name); }
                  }}
                  className={cn(
                    'flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all hover:border-white/15',
                    status === 'connected' ? 'border-emerald-500/15 bg-emerald-500/[0.03]' : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ background: def.colorHex }}
                  >
                    {def.logoLetter.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{def.name}</p>
                    <p className="text-[10px] text-slate-500">{status === 'connected' ? '✓ Connected' : def.productionStatus === 'production_ready' ? 'Ready' : 'Coming soon'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* One-click Stacks — only on "All" tab with no search/stack filter */}
        {!search && !stackFilter && activeCategory === 'all' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-white">Set up a Stack</span>
              <span className="text-[10px] text-slate-500">Connect multiple apps at once</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
              {STACKS.map((stack) => (
                <StackCard key={stack.id} stack={stack} onSelect={() => handleStackSelect(stack)} />
              ))}
            </div>
          </div>
        )}

        {/* Connected highlight strip */}
        {connected.length > 0 && !search && !stackFilter && (
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
            <p className="text-xs font-semibold text-emerald-400 mb-3">Connected ({connected.length})</p>
            <div className="flex flex-wrap gap-2">
              {connected.map(({ def }) => (
                <button
                  key={def.appId}
                  onClick={() => def.workspaceRoute && onNavigate?.(def.workspaceRoute)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-500/20 bg-white/[0.04]',
                    'text-xs font-medium text-slate-200 hover:bg-white/[0.08] transition-colors',
                    !def.workspaceRoute && 'cursor-default',
                  )}
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ background: def.colorHex }}
                  >
                    {def.logoLetter[0]}
                  </span>
                  {def.name}
                  {def.isIndiaNative && <span className="text-[9px]">🇮🇳</span>}
                  {def.workspaceRoute && <ExternalLink className="w-3 h-3 text-slate-500" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category tabs */}
        {!stackFilter && (
          <div className="flex gap-1 flex-wrap">
            {CATEGORY_TABS.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  activeCategory === cat.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/[0.05] text-slate-400 hover:text-slate-200 hover:bg-white/[0.09]',
                )}
              >
                <cat.Icon className="w-3 h-3" />
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* App list */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading apps…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500 text-sm">
            <p>No apps found{search ? ` for "${search}"` : ''}.</p>
            <button
              onClick={() => setRequestApp({ appId: search, serviceId: search, name: search, description: '', category: '', auth: 'api_key', logoLetter: search[0] ?? '?', colorHex: '#666', productionStatus: 'coming_soon' })}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300"
            >
              Request this app →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(({ def, status, backendApp }) => (
              <AppCard
                key={def.appId}
                app={def}
                status={status}
                backendApp={backendApp}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onOpenWorkspace={handleOpenWorkspace}
                onRequestAccess={setRequestApp}
              />
            ))}
          </div>
        )}

        {/* "Don't see your app?" footer */}
        {!search && (
          <div className="border-t border-white/8 pt-6 text-center">
            <p className="text-xs text-slate-500">
              Don't see your app?{' '}
              <button
                onClick={() => setRequestApp({ appId: '', serviceId: '', name: '', description: '', category: '', auth: 'api_key', logoLetter: '?', colorHex: '#666', productionStatus: 'coming_soon' })}
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                Request an integration
              </button>
            </p>
          </div>
        )}
      </div>

      {/* Request Access Modal */}
      {requestApp && (
        <RequestAccessModal
          appName={requestApp.name || 'Custom app'}
          onClose={() => setRequestApp(null)}
        />
      )}
    </div>
  );
}
