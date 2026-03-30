import {
  BriefcaseBusiness, Building2, Gavel, HandCoins, Headset,
  Layers, Wrench, Users, Briefcase, Megaphone, TrendingUp, ShoppingBag,
  MessageSquare, BarChart2, Scale,
} from 'lucide-react';

// ─── Category sidebar (from AppsPage — includes hub routes) ─────────────────

export interface Category {
  id: string;
  label: string;
  icon: React.ElementType;
  hubRoute: string | null;
  hubLabel: string | null;
  apiCategory: string;
}

export const CATEGORIES: Category[] = [
  { id: 'finance',     label: 'Finance & Payments',   icon: HandCoins,  hubRoute: 'finance-hub',    hubLabel: 'Finance Hub',      apiCategory: 'finance' },
  { id: 'hr',          label: 'HR & People',           icon: Users,      hubRoute: 'hr-hub',         hubLabel: 'HR Hub',           apiCategory: 'hr' },
  { id: 'support',     label: 'Support & CX',          icon: Headset,    hubRoute: 'support-hub',    hubLabel: 'Support Hub',      apiCategory: 'support' },
  { id: 'sales',       label: 'Sales & CRM',           icon: TrendingUp, hubRoute: 'sales-hub',      hubLabel: 'Sales Hub',        apiCategory: 'sales' },
  { id: 'it',          label: 'IT & Security',         icon: Wrench,     hubRoute: 'it-hub',         hubLabel: 'IT Hub',           apiCategory: 'it' },
  { id: 'compliance',  label: 'Compliance & Legal',    icon: Gavel,      hubRoute: 'compliance-hub', hubLabel: 'Compliance Hub',   apiCategory: 'compliance' },
  { id: 'recruitment', label: 'Recruitment & Hiring',  icon: Briefcase,  hubRoute: 'recruitment',    hubLabel: 'Recruitment Hub',  apiCategory: 'recruitment' },
  { id: 'marketing',   label: 'Marketing',             icon: Megaphone,  hubRoute: 'marketing-hub',  hubLabel: 'Marketing Hub',    apiCategory: 'marketing' },
  { id: 'productivity',label: 'Productivity',          icon: Layers,     hubRoute: null,             hubLabel: null,               apiCategory: 'productivity' },
];

// ─── Category meta (from ConnectorsPage — icons + colors for browse filters) ─

export const CATEGORY_META: Record<string, { label: string; Icon: React.ElementType; color: string }> = {
  all:           { label: 'All',             Icon: ShoppingBag,       color: 'text-slate-400' },
  finance:       { label: 'Finance',         Icon: HandCoins,         color: 'text-rose-400' },
  support:       { label: 'Support',         Icon: Headset,           color: 'text-blue-400' },
  sales:         { label: 'Sales',           Icon: Building2,         color: 'text-emerald-400' },
  hr:            { label: 'HR & People',     Icon: Users,             color: 'text-pink-400' },
  it:            { label: 'IT / DevOps',     Icon: Wrench,            color: 'text-amber-400' },
  compliance:    { label: 'Compliance',      Icon: Gavel,             color: 'text-sky-400' },
  recruitment:   { label: 'Recruitment',     Icon: BriefcaseBusiness, color: 'text-violet-400' },
  communication: { label: 'Communication',   Icon: MessageSquare,     color: 'text-cyan-400' },
  marketing:     { label: 'Marketing',       Icon: Megaphone,         color: 'text-orange-400' },
  analytics:     { label: 'Analytics',       Icon: BarChart2,         color: 'text-indigo-400' },
  legal:         { label: 'Legal',           Icon: Scale,             color: 'text-teal-400' },
};

// ─── Browse / filter constants ──────────────────────────────────────────────

export const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'alpha',   label: 'A–Z' },
  { value: 'recent',  label: 'Recently added' },
] as const;

export const TYPE_OPTIONS = [
  { value: 'all',         label: 'All types' },
  { value: 'marketplace', label: 'Apps' },
  { value: 'integration', label: 'Integrations' },
] as const;

export const BADGE_STYLE: Record<string, string> = {
  Popular:          'bg-blue-500/15 border-blue-400/25 text-blue-200',
  Verified:         'bg-emerald-500/15 border-emerald-400/25 text-emerald-200',
  'India Priority': 'bg-amber-500/15 border-amber-400/25 text-amber-200',
  New:              'bg-violet-500/15 border-violet-400/25 text-violet-200',
};

// ─── Intents (ConnectorsPage "What are you trying to automate?") ────────────

export const INTENTS = [
  { id: 'hiring',     label: 'Hiring',            Icon: BriefcaseBusiness, color: '#7C3AED', bundleId: 'recruitment-stack' },
  { id: 'support',    label: 'Customer Support',  Icon: Headset,           color: '#2563EB', bundleId: 'support-stack' },
  { id: 'finance',    label: 'Finance & Payments', Icon: HandCoins,        color: '#DC2626', bundleId: 'finance-stack' },
  { id: 'sales',      label: 'Sales',             Icon: Building2,         color: '#059669', bundleId: 'sales-stack' },
  { id: 'it',         label: 'IT / Access',       Icon: Wrench,            color: '#D97706', bundleId: 'it-stack' },
  { id: 'compliance', label: 'Compliance',        Icon: Gavel,             color: '#0891B2', bundleId: 'compliance-stack' },
];

export const BUNDLE_ICONS: Record<string, React.ElementType> = {
  BriefcaseBusiness, Building2, HandCoins, Headset, Wrench, Gavel,
  MessageSquare, BarChart2, Scale, Users, Megaphone,
};

// ─── Featured apps ──────────────────────────────────────────────────────────

export const FEATURED_IDS = ['slack', 'google-workspace', 'zoho-people', 'quickbooks', 'hubspot', 'naukri'];

// ─── Logo domains (Google favicon API) ──────────────────────────────────────

export const LOGO_DOMAINS: Record<string, string> = {
  'slack':            'slack.com',
  'google-workspace': 'google.com',
  'microsoft-365':    'microsoft.com',
  'quickbooks':       'quickbooks.intuit.com',
  'hubspot':          'hubspot.com',
  'naukri':           'naukri.com',
  'stripe':           'stripe.com',
  'razorpay':         'razorpay.com',
  'xero':             'xero.com',
  'tally':            'tallysolutions.com',
  'paytm':            'paytm.com',
  'zoho-people':      'zoho.com',
  'zoho-books':       'zoho.com',
  'zoho-crm':         'zoho.com',
  'zendesk':          'zendesk.com',
  'freshdesk':        'freshdesk.com',
  'intercom':         'intercom.com',
  'salesforce':       'salesforce.com',
  'pipedrive':        'pipedrive.com',
  'okta':             'okta.com',
  'jira':             'atlassian.com',
  'servicenow':       'servicenow.com',
  'jumpcloud':        'jumpcloud.com',
  'cleartax':         'cleartax.in',
  'diligent':         'diligent.com',
  'signdesk':         'signdesk.com',
  'linkedin':         'linkedin.com',
  'greenhouse':       'greenhouse.io',
  'lever':            'lever.co',
  'mailchimp':        'mailchimp.com',
  'klaviyo':          'klaviyo.com',
  'brevo':            'brevo.com',
  'google-ads':       'google.com',
  'meta-ads':         'meta.com',
  'darwinbox':          'darwinbox.com',
  'keka':               'keka.com',
  'greythr':            'greythr.com',
  'bamboohr':           'bamboohr.com',
  // HR & Payroll
  'freshteam':          'freshworks.com',
  'rippling':           'rippling.com',
  'workday':            'workday.com',
  // Recruitment
  'naukri':             'naukri.com',
  'shine':              'shine.com',
  'workable':           'workable.com',
  'iimjobs':            'iimjobs.com',
  'smartrecruiters':    'smartrecruiters.com',
  // Communication
  'whatsapp-business':  'whatsapp.com',
  'microsoft-teams':    'microsoft.com',
  'zoom':               'zoom.us',
  'google-chat':        'google.com',
  // IT / DevOps
  'github':             'github.com',
  'gitlab':             'gitlab.com',
  'pagerduty':          'pagerduty.com',
  'datadog':            'datadoghq.com',
  'newrelic':           'newrelic.com',
  // Marketing
  'moengage':           'moengage.com',
  'clevertap':          'clevertap.com',
  'mailmodo':           'mailmodo.com',
  'webengage':          'webengage.com',
  'mailchimp':          'mailchimp.com',
  // Analytics
  'mixpanel':           'mixpanel.com',
  'amplitude':          'amplitude.com',
  'segment':            'segment.com',
  'metabase':           'metabase.com',
  'posthog':            'posthog.com',
  // Finance India
  'payu':               'payu.in',
  'cashfree':           'cashfree.com',
  // Legal / Compliance
  'docusign':           'docusign.com',
  'leegality':          'leegality.com',
  'zoho-sign':          'zoho.com',
  // Support
  'helpscout':          'helpscout.com',
  'kayako':             'kayako.com',
  // Sales
  'apollo':             'apollo.io',
  'outreach':           'outreach.io',
};
