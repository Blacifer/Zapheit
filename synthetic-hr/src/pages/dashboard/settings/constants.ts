import type {
  ActiveSession,
  NotificationRule,
  ReconciliationAlertConfigState,
  SeverityRoutingState,
} from './types';

export const DEFAULT_RECONCILIATION_ALERT_CONFIG: ReconciliationAlertConfigState = {
  channels: {
    inApp: true,
    email: true,
    webhook: true,
  },
  thresholds: {
    absoluteGapUsd: 5,
    relativeGapRatio: 0.15,
    staleSyncHours: 36,
  },
};

export const DEFAULT_SEVERITY_ROUTING: SeverityRoutingState = {
  critical: { slack: true, email: true, pagerduty: true },
  warning: { slack: true, email: true, pagerduty: false },
  info: { slack: false, email: true, pagerduty: false },
};

export const DEFAULT_NOTIFICATIONS: NotificationRule[] = [
  { id: 'incident.critical', label: 'Critical Incident', description: 'When an incident is rated P0 or P1 severity', channels: { slack: true, email: true, pagerduty: true } },
  { id: 'incident.created', label: 'New Incident', description: 'When any new incident is detected by an agent', channels: { slack: true, email: false, pagerduty: false } },
  { id: 'incident.resolved', label: 'Incident Resolved', description: 'When an incident moves to resolved state', channels: { slack: true, email: false, pagerduty: false } },
  { id: 'agent.terminated', label: 'Agent Terminated', description: 'When an agent is forcibly terminated or crashes', channels: { slack: true, email: true, pagerduty: false } },
  { id: 'cost.threshold', label: 'Cost Threshold', description: 'When monthly spend crosses your alert threshold', channels: { slack: false, email: true, pagerduty: false } },
  { id: 'key.rotated', label: 'API Key Rotated', description: 'When an API key is rotated or revoked', channels: { slack: false, email: true, pagerduty: false } },
  { id: 'weekly.digest', label: 'Weekly Digest', description: 'Summary email of fleet activity every Monday', channels: { slack: false, email: true, pagerduty: false } },
];

export const DEMO_SESSIONS: ActiveSession[] = [
  { id: 's1', device: 'MacBook Pro (M3)', browser: 'Chrome 123', location: 'Mumbai, IN', lastActive: 'Now', current: true },
  { id: 's2', device: 'Windows PC', browser: 'Edge 121', location: 'Bangalore, IN', lastActive: '3 hours ago', current: false },
  { id: 's3', device: 'iPhone 15 Pro', browser: 'Safari Mobile', location: 'Mumbai, IN', lastActive: '1 day ago', current: false },
];
