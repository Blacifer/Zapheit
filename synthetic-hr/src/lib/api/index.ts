// Domain API objects
export { agentApi, conversationApi } from './agents';
export { incidentApi, escalationsApi, alertsApi } from './incidents';
export { costApi, metricsApi } from './costs';
export { connectorsApi, integrationsApi, slackApi } from './integrations';
export { policiesApi, complianceApi, safeHarborApi } from './governance';
export {
  webhooksApi,
  dashboardApi,
  apiKeysApi,
  healthApi,
  runtimesApi,
  jobsApi,
  workItemsApi,
  playbooksApi,
  actionPoliciesApi,
} from './platform';
export { marketplaceApi } from './marketplace';
export { approvalsApi } from './approvals';
export type { ApprovalRequest } from './approvals';
export { recruitmentApi } from './recruitment';
export { supportHubApi, salesHubApi, itHubApi, financeHubApi, complianceHubApi, identityHubApi } from './hubs';
export {
  adminApi,
  gatewayApi,
  batchesApi,
  fineTunesApi,
  cachingApi,
  pricingApi,
  teamApi,
} from './admin';

// Types from domain files
export type { SlackMessage } from './integrations';
export type {
  ApiKeyManagerRecord,
  ApiKeyUsageRecord,
  ApiKeyRecord,
  RuntimeInstance,
  AgentDeployment,
  AgentJob,
  AgentJobApproval,
  PlaybookSettingRow,
  ActionPolicyRow,
} from './platform';
export type { MarketplaceApp, AppBundle } from './marketplace';

// Shared types
export type { ApiResponse } from './_helpers';

// Assembled api object
import { agentApi, conversationApi } from './agents';
import { incidentApi, escalationsApi, alertsApi } from './incidents';
import { costApi, metricsApi } from './costs';
import { connectorsApi, integrationsApi, slackApi } from './integrations';
import { policiesApi, complianceApi, safeHarborApi } from './governance';
import {
  webhooksApi,
  dashboardApi,
  apiKeysApi,
  healthApi,
  runtimesApi,
  jobsApi,
  workItemsApi,
  playbooksApi,
  actionPoliciesApi,
} from './platform';
import { marketplaceApi } from './marketplace';
import { approvalsApi } from './approvals';
import { recruitmentApi } from './recruitment';
import { supportHubApi, salesHubApi, itHubApi, financeHubApi, complianceHubApi, identityHubApi } from './hubs';
import {
  adminApi,
  gatewayApi,
  batchesApi,
  fineTunesApi,
  cachingApi,
  pricingApi,
  teamApi,
} from './admin';

export const api = {
  agents: agentApi,
  conversations: conversationApi,
  incidents: incidentApi,
  costs: costApi,
  apiKeys: apiKeysApi,
  escalations: escalationsApi,
  alerts: alertsApi,
  team: teamApi,
  dashboard: dashboardApi,
  connectors: connectorsApi,
  integrations: integrationsApi,
  webhooks: webhooksApi,
  metrics: metricsApi,
  policies: policiesApi,
  compliance: complianceApi,
  batches: batchesApi,
  fineTunes: fineTunesApi,
  caching: cachingApi,
  pricing: pricingApi,
  safeHarbor: safeHarborApi,
  health: healthApi,
  admin: adminApi,
  gateway: gatewayApi,
  runtimes: runtimesApi,
  jobs: jobsApi,
  workItems: workItemsApi,
  playbooks: playbooksApi,
  actionPolicies: actionPoliciesApi,
  marketplace: marketplaceApi,
  approvals: approvalsApi,
  slack: slackApi,
  recruitment: recruitmentApi,
  hubs: {
    support: supportHubApi,
    sales: salesHubApi,
    it: itHubApi,
    finance: financeHubApi,
    compliance: complianceHubApi,
    identity: identityHubApi,
  },
};

export default api;
