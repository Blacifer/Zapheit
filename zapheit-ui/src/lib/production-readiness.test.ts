import {
  deriveConnectorCertification,
  deriveOrgReadinessScore,
  isCertifiedProductionConnector,
  type UnifiedActivityEvent,
} from './production-readiness';

describe('production readiness helpers', () => {
  it('does not certify unsupported connectors from catalog labels alone', () => {
    const certification = deriveConnectorCertification({
      connectorId: 'zoho-people',
      connected: false,
      status: 'disconnected',
      actionsUnlocked: ['Fetch employees'],
    });

    expect(isCertifiedProductionConnector('zoho-people')).toBe(false);
    expect(certification).toMatchObject({
      certified: false,
      state: 'unavailable',
      certificationLevel: 'requires_certification',
    });
    expect(certification.missingChecks).toEqual(expect.arrayContaining(['auth', 'write_audit']));
  });

  it('keeps certified connectors evidence-backed', () => {
    const certification = deriveConnectorCertification({
      connectorId: 'github',
      connected: true,
      status: 'connected',
    });

    expect(certification.certified).toBe(true);
    expect(certification.state).toBe('approval_gated');
    expect(certification.evidence.length).toBeGreaterThan(0);
    expect(certification.missingChecks).toHaveLength(0);
  });

  it('penalizes readiness when live production evidence is missing', () => {
    const score = deriveOrgReadinessScore({
      agents: [{
        id: 'agent-1',
        name: 'Finance Agent',
        status: 'active',
        budget_limit: 1000,
        integrationIds: ['github'],
        conversations: 0,
        risk_score: 30,
      } as any],
      pendingApprovals: 0,
      openIncidents: 0,
      severeIncidents: 0,
      connectedConnectors: 1,
      degradedConnectors: 0,
      activityEvents: [],
      costSignalCount: 0,
    });

    expect(score.status).toBe('needs_policy');
    expect(score.issues.map((issue) => issue.id)).toEqual(expect.arrayContaining([
      'runtime-evidence',
      'connector-action-evidence',
      'cost-evidence',
      'audit-evidence',
    ]));
  });

  it('recognizes complete evidence coverage', () => {
    const now = new Date().toISOString();
    const events: UnifiedActivityEvent[] = ['approval', 'incident', 'job', 'connector', 'audit', 'cost'].map((type) => ({
      id: `${type}-1`,
      type: type as UnifiedActivityEvent['type'],
      at: now,
      title: `${type} event`,
      detail: 'Recorded',
      status: 'deployed',
      tone: 'success',
    }));

    const score = deriveOrgReadinessScore({
      agents: [{
        id: 'agent-1',
        name: 'Finance Agent',
        status: 'active',
        budget_limit: 1000,
        integrationIds: ['github'],
        conversations: 1,
        risk_score: 30,
      } as any],
      pendingApprovals: 0,
      openIncidents: 0,
      severeIncidents: 0,
      connectedConnectors: 1,
      degradedConnectors: 0,
      activityEvents: events,
      costSignalCount: 1,
    });

    expect(score.score).toBe(100);
    expect(score.signalCoverage.every((signal) => signal.present)).toBe(true);
  });
});
