export type SettingsTab =
  | 'overview'
  | 'workspace'
  | 'team_access'
  | 'alerts'
  | 'security'
  | 'billing_data'
  | 'advanced';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'pending' | 'suspended';
  joinedAt: string;
  lastActive?: string;
}

export interface NotificationRule {
  id: string;
  label: string;
  description: string;
  channels: { slack: boolean; email: boolean; pagerduty: boolean };
}

export interface ActiveSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: string;
  current: boolean;
}

export interface ReconciliationAlertConfigState {
  channels: {
    inApp: boolean;
    email: boolean;
    webhook: boolean;
  };
  thresholds: {
    absoluteGapUsd: number;
    relativeGapRatio: number;
    staleSyncHours: number;
  };
}

export type SeverityRoutingState = {
  critical: { slack: boolean; email: boolean; pagerduty: boolean };
  warning: { slack: boolean; email: boolean; pagerduty: boolean };
  info: { slack: boolean; email: boolean; pagerduty: boolean };
};

export type TeamEditorState = {
  memberId: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'pending' | 'suspended';
} | null;
