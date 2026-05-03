export type ConnectorCertificationState =
  | 'production_ready'
  | 'approval_gated'
  | 'read_only'
  | 'unavailable'
  | 'degraded';

export type ConnectorCertificationCheck =
  | 'auth'
  | 'read'
  | 'approval_policy'
  | 'write_audit'
  | 'failure_handling'
  | 'disconnect'
  | 'tenant_isolation';

export interface ConnectorCertificationManifest {
  connectorId: string;
  label: string;
  state: Exclude<ConnectorCertificationState, 'unavailable' | 'degraded'>;
  readActions: number;
  writeActions: number;
  approvalGatedActions: number;
  checks: Record<ConnectorCertificationCheck, boolean>;
  evidence: string[];
  owner: string;
}

export interface ConnectorCertification {
  connectorId: string;
  state: ConnectorCertificationState;
  certified: boolean;
  label: string;
  reasons: string[];
  readActions: number;
  writeActions: number;
  approvalGatedActions: number;
  evidence: string[];
  missingChecks: string[];
  certificationLevel: 'pilot_certified' | 'requires_certification' | 'degraded';
}

type CapabilityPolicyLike = {
  requires_human_approval?: boolean;
  risk_level?: 'low' | 'medium' | 'high' | string;
  enabled?: boolean;
};

function certificationChecks(overrides: Partial<Record<ConnectorCertificationCheck, boolean>> = {}) {
  return {
    auth: true,
    read: true,
    approval_policy: true,
    write_audit: true,
    failure_handling: true,
    disconnect: true,
    tenant_isolation: true,
    ...overrides,
  };
}

const BASE_CERTIFICATION_EVIDENCE = [
  'Authentication path is explicit and tenant-scoped.',
  'Read actions are separated from write actions.',
  'Write-capable actions require policy or approval before side effects.',
  'Connector actions write audit evidence and activity-stream records.',
  'Failure and disconnect states are visible to operators.',
];

export const CONNECTOR_CERTIFICATION_MANIFEST: Record<string, ConnectorCertificationManifest> = {
  slack: {
    connectorId: 'slack',
    label: 'Slack',
    state: 'approval_gated',
    readActions: 2,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Collaboration',
  },
  'google-workspace': {
    connectorId: 'google-workspace',
    label: 'Google Workspace',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Productivity',
  },
  'microsoft-365': {
    connectorId: 'microsoft-365',
    label: 'Microsoft 365',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Productivity',
  },
  jira: {
    connectorId: 'jira',
    label: 'Jira',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Engineering',
  },
  github: {
    connectorId: 'github',
    label: 'GitHub',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Engineering',
  },
  hubspot: {
    connectorId: 'hubspot',
    label: 'HubSpot',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Sales',
  },
  quickbooks: {
    connectorId: 'quickbooks',
    label: 'QuickBooks',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Finance',
  },
  cashfree: {
    connectorId: 'cashfree',
    label: 'Cashfree',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Finance',
  },
  naukri: {
    connectorId: 'naukri',
    label: 'Naukri RMS',
    state: 'read_only',
    readActions: 3,
    writeActions: 0,
    approvalGatedActions: 0,
    checks: certificationChecks({ approval_policy: true, write_audit: true }),
    evidence: [
      'Candidate reads are tenant-scoped through configured credentials.',
      'Write-capable recruiting actions remain unavailable until separately certified.',
      'Workspace activity and failures surface in the command center.',
    ],
    owner: 'Recruiting',
  },
  greythr: {
    connectorId: 'greythr',
    label: 'greytHR',
    state: 'read_only',
    readActions: 4,
    writeActions: 0,
    approvalGatedActions: 0,
    checks: certificationChecks({ approval_policy: true, write_audit: true }),
    evidence: [
      'Employee and attendance reads are separated from write-capable HR actions.',
      'Write-capable HR actions remain unavailable until separately certified.',
      'Workspace activity and failures surface in the command center.',
    ],
    owner: 'HR',
  },
  linkedin: {
    connectorId: 'linkedin',
    label: 'LinkedIn',
    state: 'read_only',
    readActions: 3,
    writeActions: 0,
    approvalGatedActions: 0,
    checks: certificationChecks({ approval_policy: true, write_audit: true }),
    evidence: [
      'Profile reads are OAuth-scoped and tenant-isolated.',
      'Recruiter write actions require LinkedIn Talent Solutions partnership — not exposed.',
      'Workspace activity and failures surface in the command center.',
    ],
    owner: 'Recruiting',
  },
  figma: {
    connectorId: 'figma',
    label: 'Figma',
    state: 'approval_gated',
    readActions: 5,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Design',
  },
  gitlab: {
    connectorId: 'gitlab',
    label: 'GitLab',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Engineering',
  },
  calendly: {
    connectorId: 'calendly',
    label: 'Calendly',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'HR',
  },
  miro: {
    connectorId: 'miro',
    label: 'Miro',
    state: 'approval_gated',
    readActions: 2,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Collaboration',
  },
  asana: {
    connectorId: 'asana',
    label: 'Asana',
    state: 'approval_gated',
    readActions: 5,
    writeActions: 3,
    approvalGatedActions: 3,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Productivity',
  },
  zoom: {
    connectorId: 'zoom',
    label: 'Zoom',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Collaboration',
  },
  xero: {
    connectorId: 'xero',
    label: 'Xero',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Finance',
  },
  loom: {
    connectorId: 'loom',
    label: 'Loom',
    state: 'read_only',
    readActions: 3,
    writeActions: 0,
    approvalGatedActions: 0,
    checks: certificationChecks({ approval_policy: true, write_audit: true }),
    evidence: [
      'Video and workspace reads are OAuth-scoped and tenant-isolated.',
      'Recording creation is not exposed as an agent action.',
      'Workspace activity and failures surface in the command center.',
    ],
    owner: 'Collaboration',
  },
  canva: {
    connectorId: 'canva',
    label: 'Canva',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Design',
  },
  monday: {
    connectorId: 'monday',
    label: 'Monday.com',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Productivity',
  },
  flock: {
    connectorId: 'flock',
    label: 'Flock',
    state: 'approval_gated',
    readActions: 2,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Communication',
  },
  'google-chat': {
    connectorId: 'google-chat',
    label: 'Google Chat',
    state: 'approval_gated',
    readActions: 2,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Collaboration',
  },
  'microsoft-teams': {
    connectorId: 'microsoft-teams',
    label: 'Microsoft Teams',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Collaboration',
  },
  azure: {
    connectorId: 'azure',
    label: 'Azure',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'IT',
  },
  'zoho-crm': {
    connectorId: 'zoho-crm',
    label: 'Zoho CRM',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Sales',
  },
  'zoho-people': {
    connectorId: 'zoho-people',
    label: 'Zoho People',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'HR',
  },
  'zoho-recruit': {
    connectorId: 'zoho-recruit',
    label: 'Zoho Recruit',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Recruiting',
  },
  box: {
    connectorId: 'box',
    label: 'Box',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Productivity',
  },
  'dropbox-business': {
    connectorId: 'dropbox-business',
    label: 'Dropbox Business',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Productivity',
  },
  mailchimp: {
    connectorId: 'mailchimp',
    label: 'Mailchimp',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Marketing',
  },
  aircall: {
    connectorId: 'aircall',
    label: 'Aircall',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 1,
    approvalGatedActions: 1,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Support',
  },
  gorgias: {
    connectorId: 'gorgias',
    label: 'Gorgias',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Support',
  },
  salesforce: {
    connectorId: 'salesforce',
    label: 'Salesforce',
    state: 'approval_gated',
    readActions: 4,
    writeActions: 3,
    approvalGatedActions: 3,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Sales',
  },
  intercom: {
    connectorId: 'intercom',
    label: 'Intercom',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'Support',
  },
  okta: {
    connectorId: 'okta',
    label: 'Okta',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'IT',
  },
  deel: {
    connectorId: 'deel',
    label: 'Deel',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'HR',
  },
  gusto: {
    connectorId: 'gusto',
    label: 'Gusto',
    state: 'approval_gated',
    readActions: 3,
    writeActions: 2,
    approvalGatedActions: 2,
    checks: certificationChecks(),
    evidence: BASE_CERTIFICATION_EVIDENCE,
    owner: 'HR',
  },
  digilocker: {
    connectorId: 'digilocker',
    label: 'DigiLocker',
    state: 'read_only',
    readActions: 3,
    writeActions: 0,
    approvalGatedActions: 0,
    checks: certificationChecks({ approval_policy: true, write_audit: true }),
    evidence: [
      'Document reads are OAuth-scoped and citizen-consent gated.',
      'No write actions are exposed — document issuance requires government-side flows.',
      'Workspace activity and failures surface in the command center.',
    ],
    owner: 'Compliance',
  },
};

export function normalizeConnectorKey(value: string) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

export function getConnectorCertificationManifest(connectorId: string) {
  return CONNECTOR_CERTIFICATION_MANIFEST[normalizeConnectorKey(connectorId)] || null;
}

export function isProductionCertifiedConnector(connectorId: string) {
  return Boolean(getConnectorCertificationManifest(connectorId));
}

function missingCertificationChecks(manifest: ConnectorCertificationManifest | null) {
  if (!manifest) {
    return ['auth', 'read', 'approval_policy', 'write_audit', 'failure_handling', 'disconnect', 'tenant_isolation'];
  }

  return Object.entries(manifest.checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
}

export function deriveConnectorCertification(args: {
  connectorId: string;
  comingSoon?: boolean;
  connected: boolean;
  status?: string | null;
  healthStatus?: string | null;
  capabilityPolicies?: CapabilityPolicyLike[];
  permissions?: string[];
  actionsUnlocked?: string[];
}): ConnectorCertification {
  const manifest = getConnectorCertificationManifest(args.connectorId);
  const policies = args.capabilityPolicies || [];
  const enabledPolicies = policies.filter((policy) => policy.enabled !== false);
  const approvalGatedActions = Math.max(
    manifest?.approvalGatedActions || 0,
    enabledPolicies.filter((policy) => policy.requires_human_approval).length,
  );
  const highRiskActions = enabledPolicies.filter((policy) => policy.risk_level === 'high' || policy.risk_level === 'medium').length;
  const writeActions = Math.max(manifest?.writeActions || 0, approvalGatedActions, highRiskActions, args.actionsUnlocked?.length || 0);
  const readActions = Math.max(
    manifest?.readActions || 0,
    enabledPolicies.length - writeActions,
    args.permissions?.length || 0,
    0,
  );
  const missingChecks = missingCertificationChecks(manifest);
  const certified = !args.comingSoon && Boolean(manifest) && missingChecks.length === 0;
  const degraded = Boolean(args.connected && (args.status === 'error' || args.status === 'expired' || args.healthStatus === 'degraded'));

  if (degraded) {
    return {
      connectorId: args.connectorId,
      state: 'degraded',
      certified,
      label: 'Connection degraded',
      reasons: ['Installed connector health or credentials need attention before production use.'],
      readActions,
      writeActions,
      approvalGatedActions,
      evidence: manifest?.evidence || [],
      missingChecks,
      certificationLevel: 'degraded',
    };
  }

  if (!certified) {
    return {
      connectorId: args.connectorId,
      state: 'unavailable',
      certified: false,
      label: args.comingSoon ? 'Not production-certified yet' : 'Certification required',
      reasons: args.comingSoon
        ? ['This connector is not exposed as a production-ready path yet.']
        : ['Use after auth, action policy, failure handling, and audit capture are verified.'],
      readActions,
      writeActions,
      approvalGatedActions,
      evidence: manifest?.evidence || [],
      missingChecks,
      certificationLevel: 'requires_certification',
    };
  }

  if (manifest?.state === 'approval_gated' || approvalGatedActions > 0 || writeActions > 0) {
    return {
      connectorId: args.connectorId,
      state: 'approval_gated',
      certified: true,
      label: 'Certified with governed writes',
      reasons: ['Write actions are available only through configured policy, approval, and audit evidence.'],
      readActions,
      writeActions,
      approvalGatedActions,
      evidence: manifest?.evidence || [],
      missingChecks: [],
      certificationLevel: 'pilot_certified',
    };
  }

  return {
    connectorId: args.connectorId,
    state: manifest?.state === 'read_only' || readActions > 0 ? 'read_only' : 'production_ready',
    certified: true,
    label: manifest?.state === 'read_only' || readActions > 0 ? 'Certified read path' : 'Certified production path',
    reasons: [manifest?.state === 'read_only' || readActions > 0 ? 'Read actions are available for production workflows.' : 'Connector path is certified for production setup.'],
    readActions,
    writeActions,
    approvalGatedActions,
    evidence: manifest?.evidence || [],
    missingChecks: [],
    certificationLevel: 'pilot_certified',
  };
}
