import { buildTemplateLaunchPackage } from './template-launch-package';
import type { AgentTemplate } from '../config/agentTemplates';

const Icon = () => null;

function baseTemplate(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: 'finance-invoice',
    name: 'Invoice Agent',
    type: 'finance',
    industry: 'Finance',
    description: 'Reconcile invoices and prepare approval packets.',
    businessPurpose: 'Prepare invoice reconciliation with human approval before money movement.',
    features: ['Invoice matching'],
    model: 'openai/gpt-4o-mini',
    platform: 'OpenAI',
    budget: 2500,
    price: '₹25,000/month',
    icon: Icon,
    color: 'emerald',
    maturity: 'Core',
    riskLevel: 'High',
    approvalDefault: 'Require approval for payment actions and vendor changes',
    requiredSystems: ['Finance system', 'Payment gateway'],
    certifications: ['DPDP', 'RBI'],
    ...overrides,
  };
}

describe('template launch package', () => {
  it('builds a complete production package when required launch data exists', () => {
    const pkg = buildTemplateLaunchPackage({
      template: baseTemplate(),
      modelSelected: true,
      monthlyCostInr: 1200,
    });

    expect(pkg.canLaunch).toBe(true);
    expect(pkg.readiness).toBe('ready');
    expect(pkg.ownerRole).toBe('Finance owner');
    expect(pkg.requiredPermissions.length).toBeGreaterThan(0);
    expect(pkg.approvalPolicy).toContain('approval');
  });

  it('blocks governed chat when package prerequisites are missing', () => {
    const pkg = buildTemplateLaunchPackage({
      template: baseTemplate({
        businessPurpose: undefined,
        requiredSystems: [],
        approvalDefault: undefined,
        certifications: [],
        maturity: 'Preview',
        budget: 0,
      }),
      modelSelected: false,
    });

    expect(pkg.canLaunch).toBe(false);
    expect(pkg.readiness).toBe('needs_policy');
    expect(pkg.blockers).toEqual(expect.arrayContaining([
      'Live model selected',
      'Budget guardrail',
      'Required production apps',
      'Approval policy',
      'Risk and purpose',
      'Audit evidence',
    ]));
  });
});
