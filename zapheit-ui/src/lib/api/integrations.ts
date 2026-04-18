import { authenticatedFetch, API_BASE_URL } from './_helpers';
import type { ApiResponse } from './_helpers';

/**
 * Connectors API
 */
export const connectorsApi = {
  // Platform Integrations
  async getIntegrations(): Promise<ApiResponse<Array<{
    id: string;
    organization_id: string;
    provider: string;
    status: string;
    auth_type: string;
    created_at: string;
    account_label?: string;
  }>>> {
    return authenticatedFetch('/connectors/integrations', {
      method: 'GET',
    });
  },

  async connectApiKeyIntegration(providerId: string, providerName: string, credentials: Record<string, string>): Promise<ApiResponse<{
    id: string;
    provider: string;
    status: string;
  }>> {
    return authenticatedFetch(`/connectors/integrations/api-key`, {
      method: 'POST',
      body: JSON.stringify({ providerId, providerName, credentials }),
    });
  },

  async initOAuthIntegration(provider: string): Promise<ApiResponse<{ url: string }>> {
    return authenticatedFetch('/connectors/integrations/oauth/init', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    });
  },

  async validateIntegration(data: { provider: string; credentials: Record<string, string> }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/integrations/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async createIntegration(data: { name: string; status?: string; icon?: string; config?: any }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/integrations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async testIntegration(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/integrations/${id}/test`, {
      method: 'POST',
    });
  },

  async runIntegrationActionTest(id: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/integrations/${id}/action-test`, {
      method: 'POST',
    });
  },

  async runSpecIntegrationActionTest(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/spec-integrations/${service}/action-test`, {
      method: 'POST',
    });
  },

  async updateIntegration(id: string, data: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/integrations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteIntegration(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return authenticatedFetch(`/connectors/integrations/${id}`, {
      method: 'DELETE',
    });
  },

  // Proxy Endpoints
  async getEndpoints(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/connectors/endpoints', {
      method: 'GET',
    });
  },

  async createEndpoint(data: { path: string; method: string; description?: string; config?: any }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/endpoints', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateEndpoint(id: string, data: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/endpoints/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteEndpoint(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return authenticatedFetch(`/connectors/endpoints/${id}`, {
      method: 'DELETE',
    });
  },

  // Log Scrapers
  async getScrapers(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/connectors/scrapers', {
      method: 'GET',
    });
  },

  async createScraper(data: { source: string; config?: any }): Promise<ApiResponse<any>> {
    return authenticatedFetch('/connectors/scrapers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateScraper(id: string, data: any): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/connectors/scrapers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteScraper(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return authenticatedFetch(`/connectors/scrapers/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Integrations API (spec-driven)
 */
export const integrationsApi = {
  async getCatalog(): Promise<ApiResponse<{
    phase: number;
    integrations: any[];
  }>> {
    return authenticatedFetch('/integrations/catalog', { method: 'GET' });
  },

  async getAll(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/integrations', { method: 'GET' });
  },

  async getAppsInventory(): Promise<ApiResponse<any[]>> {
    return integrationsApi.getAll();
  },

  async connect(service: string, credentials: Record<string, string>): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  async configure(service: string, credentials: Record<string, string>): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/configure`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  // Backwards-compatible alias (older UI calls).
  async connectApiKey(service: string, credentials: Record<string, string>): Promise<ApiResponse<any>> {
    return integrationsApi.connect(service, credentials);
  },

  async disconnect(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/disconnect`, {
      method: 'POST',
    });
  },

  async test(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/test/${encodeURIComponent(service)}`, {
      method: 'POST',
    });
  },

  async getLogs(service: string, limit = 20): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/logs?${params.toString()}`, {
      method: 'GET',
    });
  },

  async refresh(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/refresh/${encodeURIComponent(service)}`, {
      method: 'POST',
    });
  },

  async samplePull(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/sample-pull`, {
      method: 'POST',
    });
  },

  async getWorkspacePreview(service: string): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/workspace-preview`, {
      method: 'GET',
    });
  },

  async initOAuth(service: string, returnTo: string, connection?: Record<string, string>, popup?: boolean): Promise<ApiResponse<{ url: string }>> {
    return authenticatedFetch('/integrations/oauth/init', {
      method: 'POST',
      body: JSON.stringify({
        service,
        returnTo,
        connection: connection || {},
        ...(popup ? { popup: true } : {}),
      }),
    });
  },

  async getActionCatalog(): Promise<ApiResponse<any[]>> {
    return authenticatedFetch('/integrations/actions', { method: 'GET' });
  },

  async getExecutionHistory(service?: string, limit = 25): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (service) params.set('service', service);
    params.set('limit', String(limit));
    return authenticatedFetch(`/integrations/executions?${params.toString()}`, { method: 'GET' });
  },

  async getGovernedActions(options?: {
    service?: string;
    decision?: 'executed' | 'pending_approval' | 'blocked';
    source?: 'gateway' | 'connector_console' | 'runtime';
    limit?: number;
  }): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (options?.service) params.set('service', options.service);
    if (options?.decision) params.set('decision', options.decision);
    if (options?.source) params.set('source', options.source);
    params.set('limit', String(options?.limit ?? 25));
    return authenticatedFetch(`/integrations/governed-actions?${params.toString()}`, { method: 'GET' });
  },

  async upsertActions(items: Array<{ service: string; action: string; enabled: boolean }>): Promise<ApiResponse<any>> {
    return authenticatedFetch('/integrations/actions', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  },

  async seedWave1Policies(services?: string[]): Promise<ApiResponse<any>> {
    return authenticatedFetch('/integrations/actions/seed-wave1', {
      method: 'POST',
      body: JSON.stringify({ ...(services?.length ? { services } : {}) }),
    });
  },

  async updateCapabilities(service: string, enabled: string[]): Promise<ApiResponse<any>> {
    return authenticatedFetch(`/integrations/${encodeURIComponent(service)}/capabilities`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  },

  async getHealthSummary(): Promise<ApiResponse<Array<{
    service: string;
    status: string;
    last_error_msg: string | null;
    last_error_at?: string | null;
    last_tested_at: string | null;
    last_test_result: string | null;
  }>>> {
    return authenticatedFetch('/integrations/health-summary', { method: 'GET' });
  },

  getOAuthAuthorizeUrl(service: string, returnTo: string): string {
    const base = API_BASE_URL.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('return_to', returnTo);
    return `${base}/integrations/oauth/authorize/${encodeURIComponent(service)}?${params.toString()}`;
  },
};

export type SlackMessage = {
  id: string;
  slack_channel_id: string;
  slack_channel_name: string | null;
  slack_user_id: string;
  slack_user_name: string | null;
  slack_ts: string;
  thread_ts: string | null;
  text: string;
  event_type: string;
  status: 'new' | 'reviewed' | 'replied' | 'dismissed';
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export const slackApi = {
  async getMessages(params?: {
    status?: 'new' | 'reviewed' | 'replied' | 'dismissed';
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<SlackMessage[]>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return authenticatedFetch(`/integrations/slack/messages${q ? '?' + q : ''}`, { method: 'GET' });
  },

  async reply(messageId: string, text: string): Promise<ApiResponse<{ slack_ts: string }>> {
    return authenticatedFetch(`/integrations/slack/messages/${encodeURIComponent(messageId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  async updateStatus(
    messageId: string,
    status: 'new' | 'reviewed' | 'replied' | 'dismissed',
  ): Promise<ApiResponse<void>> {
    return authenticatedFetch(`/integrations/slack/messages/${encodeURIComponent(messageId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
};
