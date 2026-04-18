import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

export type MarketplaceApp = {
  id: string;
  name: string;
  developer: string;
  category: string;
  description: string;
  permissions: string[];
  relatedAgentIds: string[];
  actionsUnlocked: string[];
  setupTimeMinutes: number;
  bundleIds: string[];
  installMethod: 'free' | 'api_key' | 'oauth2';
  requiredFields?: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; required: boolean }>;
  installCount: number;
  featured: boolean;
  badge?: string;
  colorHex: string;
  logoLetter: string;
  installed: boolean;
  connectionStatus?: string | null;
  lastSyncAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
  comingSoon?: boolean;
  connectionSource?: 'marketplace' | 'connections' | null;
};

export type AppBundle = {
  id: string;
  name: string;
  description: string;
  intentLabel: string;
  appIds: string[];
  colorHex: string;
  icon: string;
};

export const marketplaceApi = {
  async getAll(): Promise<ApiResponse<MarketplaceApp[]>> {
    return authenticatedFetch<MarketplaceApp[]>('/marketplace/apps', { method: 'GET' });
  },

  async getBundles(): Promise<ApiResponse<AppBundle[]>> {
    return authenticatedFetch<AppBundle[]>('/marketplace/bundles', { method: 'GET' });
  },

  async getInstalled(): Promise<ApiResponse<MarketplaceApp[]>> {
    return authenticatedFetch<MarketplaceApp[]>('/marketplace/apps/installed', { method: 'GET' });
  },

  async install(appId: string, credentials: Record<string, string> = {}): Promise<ApiResponse<{ integration_id?: string; oauth?: boolean; state?: string; authUrl?: string; message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}/install`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  async uninstall(appId: string): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
  },

  async updateCredentials(appId: string, credentials: Record<string, string>): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}/credentials`, {
      method: 'PATCH',
      body: JSON.stringify({ credentials }),
    });
  },

  async testConnection(appId: string, credentials: Record<string, string> = {}): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}/test`, {
      method: 'POST',
      body: JSON.stringify({ credentials }),
    });
  },

  async notifyMe(appId: string): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch(`/marketplace/apps/${encodeURIComponent(appId)}/notify`, {
      method: 'POST',
    });
  },

  async requestIntegration(payload: { app_id?: string; app_name: string; use_case?: string }): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch('/marketplace/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
