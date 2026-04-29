import type { AgentTemplate } from '../config/agentTemplates';
import type { ReadinessStatus } from './production-readiness';

export interface TemplateLaunchCheck {
  key: string;
  label: string;
  detail: string;
  ready: boolean;
  status: ReadinessStatus;
}

export interface TemplateLaunchPackage {
  templateId: string;
  ownerRole: string;
  purpose: string;
  runtimeTarget: string;
  budgetInr: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  requiredApps: string[];
  requiredPermissions: string[];
  approvalPolicy: string;
  auditEvidence: string[];
  readiness: ReadinessStatus;
  canLaunch: boolean;
  blockers: string[];
  checks: TemplateLaunchCheck[];
}

function inferOwnerRole(template: AgentTemplate) {
  const text = `${template.industry} ${template.type} ${template.name}`.toLowerCase();
  if (text.includes('finance') || text.includes('payroll') || text.includes('invoice')) return 'Finance owner';
  if (text.includes('hr') || text.includes('people') || text.includes('leave') || text.includes('onboarding')) return 'HR owner';
  if (text.includes('legal') || text.includes('compliance')) return 'Legal or compliance owner';
  if (text.includes('support') || text.includes('customer')) return 'Support owner';
  if (text.includes('sales') || text.includes('crm')) return 'Sales owner';
  if (text.includes('it') || text.includes('devops') || text.includes('security')) return 'IT owner';
  return 'Business process owner';
}

function inferPermissions(template: AgentTemplate) {
  const systems = template.requiredSystems || [];
  const permissions = systems.flatMap((system) => {
    const normalized = system.toLowerCase();
    if (normalized.includes('email') || normalized.includes('chat')) return [`${system}: read messages`, `${system}: draft outbound messages`];
    if (normalized.includes('crm')) return [`${system}: read records`, `${system}: draft updates`];
    if (normalized.includes('order') || normalized.includes('finance') || normalized.includes('payment')) return [`${system}: read records`, `${system}: approval-gated writes only`];
    if (normalized.includes('hr') || normalized.includes('employee')) return [`${system}: read employee records`, `${system}: approval-gated changes only`];
    if (normalized.includes('document') || normalized.includes('policy')) return [`${system}: read approved documents`];
    return [`${system}: least-privilege access`];
  });

  return Array.from(new Set(permissions));
}

function statusFromChecks(checks: TemplateLaunchCheck[]): ReadinessStatus {
  if (checks.some((check) => !check.ready && check.status === 'blocked')) return 'blocked';
  if (checks.some((check) => !check.ready && check.status === 'needs_policy')) return 'needs_policy';
  if (checks.some((check) => !check.ready)) return 'not_configured';
  return 'ready';
}

export function buildTemplateLaunchPackage(args: {
  template: AgentTemplate;
  modelSelected: boolean;
  monthlyCostInr?: number | null;
}): TemplateLaunchPackage {
  const { template, modelSelected } = args;
  const requiredApps = template.requiredSystems || [];
  const requiredPermissions = inferPermissions(template);
  const riskLevel = template.riskLevel || 'Medium';
  const auditEvidence = template.certifications || [];
  const budgetOverrun =
    typeof args.monthlyCostInr === 'number'
    && Number.isFinite(args.monthlyCostInr)
    && template.budget > 0
    && args.monthlyCostInr > template.budget;

  const checks: TemplateLaunchCheck[] = [
    {
      key: 'model',
      label: 'Live model selected',
      ready: modelSelected,
      status: modelSelected ? 'ready' : 'not_configured',
      detail: modelSelected ? 'Model choice is explicit for this launch package.' : 'Select a model from the live catalog.',
    },
    {
      key: 'budget',
      label: 'Budget guardrail',
      ready: template.budget > 0 && !budgetOverrun,
      status: template.budget <= 0 || budgetOverrun ? 'needs_policy' : 'ready',
      detail: budgetOverrun
        ? `Estimated spend is above the ₹${template.budget.toLocaleString('en-IN')} budget.`
        : template.budget > 0
          ? `Budget cap: ₹${template.budget.toLocaleString('en-IN')}/month.`
          : 'Add a monthly budget cap before production launch.',
    },
    {
      key: 'apps',
      label: 'Required production apps',
      ready: requiredApps.length > 0,
      status: requiredApps.length > 0 ? 'ready' : 'not_configured',
      detail: requiredApps.length > 0 ? requiredApps.join(', ') : 'Declare the real systems this agent will use.',
    },
    {
      key: 'permissions',
      label: 'Least-privilege permissions',
      ready: requiredPermissions.length > 0,
      status: requiredPermissions.length > 0 ? 'ready' : 'not_configured',
      detail: requiredPermissions.length > 0
        ? requiredPermissions.slice(0, 3).join(' · ')
        : 'Define read/write scopes before launch.',
    },
    {
      key: 'approval',
      label: 'Approval policy',
      ready: Boolean(template.approvalDefault),
      status: template.approvalDefault ? 'ready' : 'needs_policy',
      detail: template.approvalDefault || 'Define which actions are advisory, approval-gated, or blocked.',
    },
    {
      key: 'risk',
      label: 'Risk and purpose',
      ready: Boolean(template.riskLevel && template.businessPurpose),
      status: template.riskLevel && template.businessPurpose ? 'ready' : 'needs_policy',
      detail: template.businessPurpose || 'Document the business purpose and risk owner.',
    },
    {
      key: 'runtime',
      label: 'Runtime target',
      ready: true,
      status: 'ready',
      detail: 'Zapheit Runtime with governed chat handoff and audit capture.',
    },
    {
      key: 'audit',
      label: 'Audit evidence',
      ready: auditEvidence.length > 0 || template.maturity === 'Core',
      status: auditEvidence.length > 0 || template.maturity === 'Core' ? 'ready' : 'needs_policy',
      detail: auditEvidence.length > 0
        ? auditEvidence.join(', ')
        : 'Attach compliance or operational evidence labels for paid-pilot review.',
    },
  ];

  const readiness = statusFromChecks(checks);
  const blockers = checks.filter((check) => !check.ready).map((check) => check.label);

  return {
    templateId: template.id,
    ownerRole: inferOwnerRole(template),
    purpose: template.businessPurpose || template.description,
    runtimeTarget: 'Zapheit Runtime + Governed Chat',
    budgetInr: template.budget,
    riskLevel,
    requiredApps,
    requiredPermissions,
    approvalPolicy: template.approvalDefault || 'Policy required before write-capable launch.',
    auditEvidence,
    readiness,
    canLaunch: blockers.length === 0,
    blockers,
    checks,
  };
}
