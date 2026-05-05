jest.mock('../../lib/supabase', () => ({
  supabase: {},
  supabaseAdmin: {},
}));

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsService: jest.fn(),
  supabaseRestAsUser: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/rbac', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../marketplace', () => ({
  PARTNER_APP_CATALOG: [
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      developer: 'Google',
      category: 'hr',
      description: 'Workspace productivity suite',
      permissions: ['Read Gmail'],
      relatedAgentIds: [],
      actionsUnlocked: ['Draft email'],
      setupTimeMinutes: 3,
      bundleIds: [],
      installMethod: 'oauth2',
      installCount: 100,
      featured: true,
      colorHex: '#EA4335',
      logoLetter: 'G',
    },
    {
      id: 'microsoft-365',
      name: 'Microsoft 365',
      developer: 'Microsoft',
      category: 'hr',
      description: 'Microsoft productivity suite',
      permissions: ['Read Outlook'],
      relatedAgentIds: [],
      actionsUnlocked: ['Draft message'],
      setupTimeMinutes: 3,
      bundleIds: [],
      installMethod: 'oauth2',
      installCount: 100,
      featured: true,
      colorHex: '#0078D4',
      logoLetter: 'M',
    },
    {
      id: 'zoho-people',
      name: 'Zoho People',
      developer: 'Zoho',
      category: 'hr',
      description: 'Zoho People direct setup',
      permissions: ['Read employees'],
      relatedAgentIds: [],
      actionsUnlocked: ['Fetch employees'],
      setupTimeMinutes: 3,
      bundleIds: [],
      installMethod: 'api_key',
      requiredFields: [{ name: 'api_key', label: 'API Key', type: 'password', required: true }],
      installCount: 50,
      featured: false,
      colorHex: '#E42527',
      logoLetter: 'Z',
    },
    {
      id: 'zoho-learn',
      name: 'Zoho Learn',
      developer: 'Zoho',
      category: 'hr',
      description: 'Zoho Learn direct setup',
      permissions: ['Read courses'],
      relatedAgentIds: [],
      actionsUnlocked: ['Fetch courses'],
      setupTimeMinutes: 3,
      bundleIds: [],
      installMethod: 'api_key',
      requiredFields: [{ name: 'api_key', label: 'API Key', type: 'password', required: true }],
      installCount: 50,
      featured: false,
      colorHex: '#E42527',
      logoLetter: 'Z',
    },
    {
      id: 'zoho-recruit',
      name: 'Zoho Recruit',
      developer: 'Zoho',
      category: 'recruitment',
      description: 'Zoho Recruit direct setup',
      permissions: ['Read candidates'],
      relatedAgentIds: [],
      actionsUnlocked: ['Fetch candidates'],
      setupTimeMinutes: 3,
      bundleIds: [],
      installMethod: 'api_key',
      requiredFields: [{ name: 'api_key', label: 'API Key', type: 'password', required: true }],
      installCount: 50,
      featured: false,
      colorHex: '#E42527',
      logoLetter: 'Z',
    },
  ],
  getInstalledAppHealth: jest.fn(async () => new Map()),
}));

jest.mock('../../lib/integrations/spec-registry', () => {
  const specs = [
    {
      id: 'google_workspace',
      name: 'Google Workspace',
      category: 'HR',
      description: 'Google Workspace OAuth integration',
      authType: 'oauth2',
      capabilities: { reads: ['calendar.read'], writes: [{ id: 'email.send', label: 'Send email', approvalDefault: true, risk: 'high' }] },
      status: 'READY',
      color: '#EA4335',
    },
    {
      id: 'microsoft_365',
      name: 'Microsoft 365',
      category: 'HR',
      description: 'Microsoft 365 OAuth integration',
      authType: 'oauth2',
      capabilities: { reads: ['calendar.read'], writes: [{ id: 'message.send', label: 'Send message', approvalDefault: true, risk: 'high' }] },
      status: 'READY',
      color: '#0078D4',
    },
    {
      id: 'zoho_people',
      name: 'Zoho People',
      category: 'HR',
      description: 'Zoho People OAuth integration',
      authType: 'oauth2',
      capabilities: { reads: ['employees.read'], writes: [{ id: 'employee.update', label: 'Update employee', approvalDefault: true, risk: 'medium' }] },
      status: 'READY',
      color: '#D97706',
    },
    {
      id: 'zoho_learn',
      name: 'Zoho Learn',
      category: 'HR',
      description: 'Zoho Learn OAuth integration',
      authType: 'oauth2',
      capabilities: { reads: ['courses.read'], writes: [{ id: 'course.assign', label: 'Assign course', approvalDefault: true, risk: 'medium' }] },
      status: 'READY',
      color: '#EA580C',
    },
    {
      id: 'zoho_recruit',
      name: 'Zoho Recruit',
      category: 'RECRUITMENT',
      description: 'Zoho Recruit OAuth integration',
      authType: 'oauth2',
      capabilities: { reads: ['candidates.read'], writes: [{ id: 'candidate.create', label: 'Create candidate', approvalDefault: true, risk: 'medium' }] },
      status: 'READY',
      color: '#DC2626',
    },
  ];
  return { PHASE1_INTEGRATIONS: specs, IMPLEMENTED_INTEGRATIONS: specs };
});

jest.mock('../../lib/connectors/action-registry', () => ({
  ACTION_REGISTRY: {},
}));

jest.mock('../../lib/integrations/adapters', () => ({
  getAdapter: jest.fn(() => ({ id: 'mock-adapter' })),
}));

import { supabaseRestAsService } from '../../lib/supabase-rest';
import connectorsRouter from '../connectors';

describe('Connectors catalog unified canonicalization', () => {
  const mockServiceRest = supabaseRestAsService as jest.MockedFunction<typeof supabaseRestAsService>;

  beforeEach(() => {
    mockServiceRest.mockReset();
    mockServiceRest.mockImplementation(async (table: any) => {
      if (table === 'integration_openapi_specs') return [];
      if (table === 'action_policies') return [];
      if (table === 'ai_agents') return [];
      return [];
    });
  });

  async function invokeUnifiedCatalog() {
    const req: any = {
      method: 'GET',
      url: '/catalog/unified',
      headers: {},
      query: {},
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: '22222222-2222-4222-8222-222222222222',
        role: 'admin',
      },
      userJwt: 'mock-jwt',
    };

    let done = false;
    let payload: any = null;

    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: any) {
        payload = body;
        done = true;
        return this;
      },
      setHeader() {
        return undefined;
      },
    };

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (done) return resolve();
        setTimeout(tick, 0);
      };
      (connectorsRouter as any).handle(req, res, (err: any) => (err ? reject(err) : resolve()));
      tick();
    });

    return { statusCode: res.statusCode, body: payload };
  }

  it('returns one canonical record per alias pair and chooses the primary setup path', async () => {
    const res = await invokeUnifiedCatalog();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const rows = res.body.data as Array<any>;
    const googleRows = rows.filter((row) => row.app_key === 'google-workspace');
    const microsoftRows = rows.filter((row) => row.app_key === 'microsoft-365');
    const zohoPeopleRows = rows.filter((row) => row.app_key === 'zoho-people');
    const zohoLearnRows = rows.filter((row) => row.app_key === 'zoho-learn');
    const zohoRecruitRows = rows.filter((row) => row.app_key === 'zoho-recruit');

    expect(googleRows).toHaveLength(1);
    expect(googleRows[0].source).toBe('marketplace');
    expect(googleRows[0].primary_setup_mode).toBe('oauth');
    expect(googleRows[0].primary_service_id).toBe('google-workspace');
    expect(googleRows[0].readiness_status).toBe('not_configured');
    expect(googleRows[0].connector_certification).toMatchObject({
      connectorId: 'google-workspace',
      certified: true,
      state: 'approval_gated',
      label: 'Certified with governed writes',
    });

    expect(microsoftRows).toHaveLength(1);
    expect(microsoftRows[0].source).toBe('marketplace');
    expect(microsoftRows[0].primary_setup_mode).toBe('oauth');
    expect(microsoftRows[0].primary_service_id).toBe('microsoft-365');
    expect(microsoftRows[0].connector_certification.certified).toBe(true);

    expect(zohoPeopleRows).toHaveLength(1);
    expect(zohoPeopleRows[0].source).toBe('integration');
    expect(zohoPeopleRows[0].primary_setup_mode).toBe('oauth');
    expect(zohoPeopleRows[0].advanced_setup_modes).toEqual(expect.arrayContaining(['oauth', 'direct']));
    expect(zohoPeopleRows[0].primary_service_id).toBe('zoho_people');
    expect(zohoPeopleRows[0].readiness_status).toBe('not_configured');
    expect(zohoPeopleRows[0].connector_certification).toMatchObject({
      connectorId: 'zoho-people',
      certified: true,
      state: 'approval_gated',
      label: 'Certified with governed writes',
    });

    expect(zohoLearnRows).toHaveLength(1);
    expect(zohoLearnRows[0].source).toBe('integration');
    expect(zohoLearnRows[0].primary_setup_mode).toBe('oauth');
    expect(zohoLearnRows[0].advanced_setup_modes).toEqual(expect.arrayContaining(['oauth', 'direct']));
    expect(zohoLearnRows[0].primary_service_id).toBe('zoho_learn');

    expect(zohoRecruitRows).toHaveLength(1);
    expect(zohoRecruitRows[0].source).toBe('integration');
    expect(zohoRecruitRows[0].primary_setup_mode).toBe('oauth');
    expect(zohoRecruitRows[0].advanced_setup_modes).toEqual(expect.arrayContaining(['oauth', 'direct']));
    expect(zohoRecruitRows[0].primary_service_id).toBe('zoho_recruit');
  });
});
