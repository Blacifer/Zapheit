// Domain API objects
export { agentApi, conversationApi } from './agents';
export { incidentApi, escalationsApi, alertsApi } from './incidents';
export { costApi, metricsApi } from './costs';
export { connectorsApi, integrationsApi, slackApi } from './integrations';
export { unifiedConnectorsApi } from './connectors';
export type { UnifiedConnectorEntry, ConnectorAction, ConnectorActionResult, ConnectorToolCallResult } from './connectors';
export { policiesApi, complianceApi, safeHarborApi, auditLogsApi } from './governance';
export type { AuditLogEntry } from './governance';
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
export { alertChannelsApi } from './alert-channels';
export type { AlertChannel, ChannelType, SeverityLevel, CreateAlertChannelInput } from './alert-channels';
export { recruitmentApi } from './recruitment';
export { dpdpApi } from './dpdp';
export type { ConsentRecord, ConsentStats, RetentionPolicy, DataPrincipalRequest, DpdpDashboard } from './dpdp';
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
  PlaybookSchedule,
  PlaybookTrigger,
  CustomPlaybook,
  PlaybookComment,
  ActionPolicyRow,
  ActionPolicyConstraints,
  RoutingRule,
  InterceptorRule,
} from './platform';
export type { MarketplaceApp, AppBundle } from './marketplace';

// Shared types
export type { ApiResponse } from './_helpers';

// Assembled api object
import { agentApi, conversationApi } from './agents';
import { incidentApi, escalationsApi, alertsApi } from './incidents';
import { costApi, metricsApi } from './costs';
import { connectorsApi, integrationsApi, slackApi } from './integrations';
import { unifiedConnectorsApi } from './connectors';
import { policiesApi, complianceApi, safeHarborApi, auditLogsApi } from './governance';
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
import { alertChannelsApi } from './alert-channels';
import { recruitmentApi } from './recruitment';
import { dpdpApi } from './dpdp';
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
  unifiedConnectors: unifiedConnectorsApi,
  integrations: integrationsApi,
  webhooks: webhooksApi,
  metrics: metricsApi,
  policies: policiesApi,
  compliance: complianceApi,
  dpdp: dpdpApi,
  batches: batchesApi,
  fineTunes: fineTunesApi,
  caching: cachingApi,
  pricing: pricingApi,
  safeHarbor: safeHarborApi,
  auditLogs: auditLogsApi,
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
  alertChannels: alertChannelsApi,
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
