import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

export type ChannelType = 'pagerduty' | 'teams' | 'opsgenie' | 'email';
export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AlertChannel {
  id: string;
  organization_id: string;
  name: string;
  channel_type: ChannelType;
  enabled: boolean;
  min_severity: SeverityLevel;
  config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface CreateAlertChannelInput {
  name: string;
  channel_type: ChannelType;
  enabled?: boolean;
  min_severity?: SeverityLevel;
  config: Record<string, string>;
}

export const alertChannelsApi = {
  list(): Promise<ApiResponse<AlertChannel[]>> {
    return authenticatedFetch<AlertChannel[]>('/alert-channels', { method: 'GET' });
  },

  create(input: CreateAlertChannelInput): Promise<ApiResponse<AlertChannel>> {
    return authenticatedFetch<AlertChannel>('/alert-channels', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, patch: Partial<Omit<CreateAlertChannelInput, 'channel_type'>>): Promise<ApiResponse<AlertChannel>> {
    return authenticatedFetch<AlertChannel>(`/alert-channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  delete(id: string): Promise<ApiResponse<null>> {
    return authenticatedFetch<null>(`/alert-channels/${id}`, { method: 'DELETE' });
  },

  test(id: string): Promise<ApiResponse<{ message: string }>> {
    return authenticatedFetch<{ message: string }>(`/alert-channels/${id}/test`, { method: 'POST' });
  },
};
