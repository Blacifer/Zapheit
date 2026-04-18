/**
 * Shared types for Dashboard hooks and components.
 * Extracted from Dashboard.tsx to avoid circular imports.
 */

import type { IntegrationPackId } from '../../lib/integration-packs';
import type { api } from '../../lib/api-client';

export type DashboardNotification = {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  source: 'local' | 'reconciliation';
};

export type CoverageNotificationPayload = Awaited<ReturnType<typeof api.admin.getCoverageStatus>>['data'];

export type IntegrationSummaryRow = {
  id: string;
  name: string;
  category: string;
  tags?: string[];
  status?: string;
  lifecycleStatus?: string;
  lastSyncAt?: string | null;
};

export type AgentConnectionDraft = {
  integrationIds: string[];
  primaryPack: IntegrationPackId | null;
};
