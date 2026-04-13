/**
 * demo-fixtures.ts
 *
 * Static demo data used when VITE_DEMO_MODE_ENABLED=true.
 * Extracted from Dashboard.tsx to keep the main component lean and to allow
 * reuse in tests / Storybook stories.
 *
 * These are intentionally realistic-looking but entirely fictional records.
 */

import type { AIAgent, Incident, CostData } from '../types';
import type { AgentConnectionDraft } from '../pages/dashboard/types';

// ── Agents ────────────────────────────────────────────────────────────────────

export const DEMO_AGENTS: AIAgent[] = [
  {
    id: '1',
    name: 'Support Bot',
    description: 'Customer support AI agent',
    agent_type: 'support',
    platform: 'web',
    model_name: 'GPT-4',
    status: 'active',
    lifecycle_state: 'processing',
    risk_level: 'low',
    risk_score: 23,
    conversations: 15420,
    created_at: '2024-01-15',
    satisfaction: 94,
    uptime: 99.5,
    budget_limit: 1000,
    current_spend: 462,
    auto_throttle: true,
    publishStatus: 'live',
    primaryPack: 'support',
    integrationIds: ['zendesk', 'intercom'],
  },
  {
    id: '2',
    name: 'Sales Assistant',
    description: 'Sales qualification AI agent',
    agent_type: 'sales',
    platform: 'web',
    model_name: 'Claude-3',
    status: 'active',
    lifecycle_state: 'processing',
    risk_level: 'medium',
    risk_score: 45,
    conversations: 8932,
    created_at: '2024-02-01',
    satisfaction: 88,
    uptime: 98.2,
    budget_limit: 500,
    current_spend: 267,
    auto_throttle: false,
    publishStatus: 'live',
    primaryPack: 'sales',
    integrationIds: ['hubspot'],
  },
  {
    id: '3',
    name: 'HR Bot',
    description: 'HR internal support agent',
    agent_type: 'hr',
    platform: 'web',
    model_name: 'GPT-4',
    status: 'active',
    lifecycle_state: 'idle',
    risk_level: 'low',
    risk_score: 18,
    conversations: 4521,
    created_at: '2024-02-15',
    satisfaction: 96,
    uptime: 99.8,
    budget_limit: 300,
    current_spend: 135,
    auto_throttle: true,
    publishStatus: 'ready',
    primaryPack: 'recruitment',
    integrationIds: [],
  },
  {
    id: '4',
    name: 'Refund Handler',
    description: 'Automated refund processing',
    agent_type: 'finance',
    platform: 'web',
    model_name: 'GPT-4',
    status: 'paused',
    lifecycle_state: 'error',
    risk_level: 'high',
    risk_score: 78,
    conversations: 2341,
    created_at: '2024-03-01',
    satisfaction: 72,
    uptime: 95.5,
    budget_limit: 200,
    current_spend: 70,
    auto_throttle: false,
    publishStatus: 'ready',
    primaryPack: 'finance',
    integrationIds: ['stripe'],
  },
  {
    id: '5',
    name: 'Knowledge Base',
    description: 'Internal knowledge assistant',
    agent_type: 'support',
    platform: 'web',
    model_name: 'Claude-3',
    status: 'active',
    lifecycle_state: 'processing',
    risk_level: 'low',
    risk_score: 12,
    conversations: 28754,
    created_at: '2024-01-20',
    satisfaction: 97,
    uptime: 99.9,
    budget_limit: 1500,
    current_spend: 862,
    auto_throttle: true,
    publishStatus: 'not_live',
    primaryPack: 'support',
    integrationIds: [],
  },
];

// ── Integrations ──────────────────────────────────────────────────────────────

export const DEMO_INTEGRATIONS = [
  { id: 'zendesk', name: 'Zendesk', category: 'SUPPORT', status: 'connected', lifecycleStatus: 'connected', lastSyncAt: new Date().toISOString() },
  { id: 'intercom', name: 'Intercom', category: 'SUPPORT', status: 'connected', lifecycleStatus: 'connected', lastSyncAt: new Date().toISOString() },
  { id: 'hubspot', name: 'HubSpot', category: 'CRM', status: 'connected', lifecycleStatus: 'connected', lastSyncAt: new Date().toISOString() },
  { id: 'stripe', name: 'Stripe', category: 'PAYMENTS', status: 'configured', lifecycleStatus: 'configured', lastSyncAt: new Date(Date.now() - 86400000).toISOString() },
];

export const DEMO_AGENT_CONNECTIONS: Record<string, AgentConnectionDraft> = {
  '1': { integrationIds: ['zendesk', 'intercom'], primaryPack: 'support' },
  '2': { integrationIds: ['hubspot'], primaryPack: 'sales' },
  '3': { integrationIds: [], primaryPack: 'recruitment' },
  '4': { integrationIds: ['stripe'], primaryPack: 'finance' },
  '5': { integrationIds: [], primaryPack: 'support' },
};

// ── Incidents ─────────────────────────────────────────────────────────────────

export const DEMO_INCIDENTS: Incident[] = [
  {
    id: '1',
    agent_id: '4',
    agent_name: 'Refund Handler',
    incident_type: 'refund_abuse',
    severity: 'critical',
    status: 'open',
    title: 'Unauthorized Refund Approved',
    description: 'Bot approved a refund request without proper verification',
    created_at: new Date().toISOString(),
  },
  {
    id: '2',
    agent_id: '2',
    agent_name: 'Sales Assistant',
    incident_type: 'hallucination',
    severity: 'low',
    status: 'resolved',
    title: 'Incorrect Pricing Information',
    description: 'Bot provided wrong pricing for enterprise plan',
    resolved_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: '3',
    agent_id: '1',
    agent_name: 'Support Bot',
    incident_type: 'pii_leak',
    severity: 'high',
    status: 'open',
    title: 'Potential PII Exposure',
    description: 'Bot may have shared customer email in response',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

// ── Cost data ─────────────────────────────────────────────────────────────────

export const DEMO_COST_DATA: CostData[] = [
  { id: '1', tokens: 1542000, cost: 462.60, date: new Date().toISOString(), requests: 5000 },
  { id: '2', tokens: 893200, cost: 267.96, date: new Date().toISOString(), requests: 2800 },
  { id: '3', tokens: 452100, cost: 135.63, date: new Date().toISOString(), requests: 1500 },
  { id: '4', tokens: 234100, cost: 70.23, date: new Date().toISOString(), requests: 750 },
  { id: '5', tokens: 2875400, cost: 862.62, date: new Date().toISOString(), requests: 9200 },
];

// ── Notifications ─────────────────────────────────────────────────────────────

export const DEMO_NOTIFICATIONS = [
  { id: '1', type: 'error' as const, title: 'Critical Incident Detected', message: 'Refund Handler approved unauthorized refund', timestamp: new Date().toISOString(), read: false, source: 'local' as const },
  { id: '2', type: 'warning' as const, title: 'Cost Alert', message: 'Monthly AI costs exceeded budget by 15%', timestamp: new Date(Date.now() - 86400000).toISOString(), read: false, source: 'local' as const },
  { id: '3', type: 'success' as const, title: 'Shadow Mode Complete', message: 'New agent passed deployment testing with 92% score', timestamp: new Date(Date.now() - 172800000).toISOString(), read: true, source: 'local' as const },
];

// ── API keys ──────────────────────────────────────────────────────────────────

export const DEMO_API_KEYS = [
  { id: '1', name: 'Production Key', key: 'sk-demo-xxxx', permissions: ['agents.read', 'agents.update'], created: new Date().toISOString(), lastUsed: new Date().toISOString() },
];
