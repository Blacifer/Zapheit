import React from 'react';

// Central type definitions for SyntheticHR
// All types should be defined here for consistency

// ==================== AUTH TYPES ====================
export interface AuthUser {
  id: string;
  email: string;
  organizationName: string;
}

export interface UserRole {
  type: 'super_admin' | 'admin' | 'manager' | 'viewer';
  permissions: Permission[];
}

export type Permission =
  | 'agents.create'
  | 'agents.read'
  | 'agents.update'
  | 'agents.delete'
  | 'agents.kill'
  | 'incidents.create'
  | 'incidents.read'
  | 'incidents.update'
  | 'incidents.resolve'
  | 'incidents.delete'
  | 'costs.create'
  | 'costs.read'
  | 'costs.update'
  | 'costs.delete'
  | 'dashboard.read'
  | 'policies.manage'
  | 'workitems.read'
  | 'workitems.manage'
  | 'settings.read'
  | 'settings.update';

// Role-based permissions mapping
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: [
    'agents.create', 'agents.read', 'agents.update', 'agents.delete', 'agents.kill',
    'incidents.create', 'incidents.read', 'incidents.update', 'incidents.resolve', 'incidents.delete',
    'costs.create', 'costs.read', 'costs.update', 'costs.delete',
    'dashboard.read', 'settings.read', 'settings.update',
    'policies.manage',
    'workitems.read', 'workitems.manage',
  ],
  admin: [
    'agents.create', 'agents.read', 'agents.update', 'agents.delete', 'agents.kill',
    'incidents.create', 'incidents.read', 'incidents.update', 'incidents.resolve',
    'costs.create', 'costs.read', 'costs.update',
    'dashboard.read', 'settings.read', 'settings.update',
    'policies.manage',
    'workitems.read', 'workitems.manage',
  ],
  manager: [
    'agents.create', 'agents.read', 'agents.update',
    'incidents.create', 'incidents.read', 'incidents.update', 'incidents.resolve',
    'costs.read',
    'dashboard.read', 'settings.read',
    'policies.manage',
    'workitems.read', 'workitems.manage',
  ],
  viewer: [
    'agents.read',
    'incidents.read',
    'costs.read',
    'dashboard.read',
    'workitems.read',
  ]
};

// ==================== ORGANIZATION TYPES ====================
export interface Organization {
  id: string;
  name: string;
  plan: 'starter' | 'pro' | 'enterprise';
  industry: string;
  createdAt?: string;
}

// ==================== AGENT TYPES ====================
export type AgentStatus = 'active' | 'paused' | 'terminated';
export type LifecycleState = 'provisioning' | 'idle' | 'processing' | 'learning' | 'error' | 'terminated';
export type RiskLevel = 'low' | 'medium' | 'high';
export type AgentPublishStatus = 'not_live' | 'ready' | 'live';
export type AgentPackId = 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance';

export interface AgentConnectedTarget {
  integrationId: string;
  integrationName: string;
  packId: AgentPackId;
  status: string;
  lastSyncAt?: string | null;
  lastActivityAt?: string | null;
}

export interface AIAgent {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  platform: string;
  model_name: string;
  system_prompt?: string;
  status: AgentStatus;
  lifecycle_state: LifecycleState;
  risk_level: RiskLevel;
  risk_score: number;
  created_at: string;
  conversations: number;
  satisfaction: number;
  uptime: number;
  budget_limit: number;
  current_spend: number;
  auto_throttle: boolean;
  publishStatus?: AgentPublishStatus;
  primaryPack?: AgentPackId | null;
  integrationIds?: string[];
  connectedTargets?: AgentConnectedTarget[];
  lastIntegrationSyncAt?: string | null;
}

// ==================== INCIDENT TYPES ====================
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';
export type IncidentType =
  | 'prompt_injection'
  | 'pii_extraction'
  | 'policy_override'
  | 'toxicity'
  | 'hallucination'
  | 'escalation'
  | 'legal_risk'
  | 'other'; // Kept 'other' for frontend fallback, though backend strictly expects the 7 above

export interface Incident {
  id: string;
  agent_id: string;
  agent_name: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
  notes?: string;
}

// ==================== COST TYPES ====================
export interface CostData {
  id: string;
  date: string;
  cost: number;
  tokens: number;
  requests: number;
  agent_id?: string;
  model?: string;
}

// ==================== API KEY TYPES ====================
export interface ApiKeyManager {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface ApiKeyUsagePoint {
  date: string;
  requests: number;
  errors: number;
  last_used_at?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key?: string;
  masked_key?: string;
  keyHash?: string;
  created: string;
  lastUsed?: string | null;
  permissions: string[];
  userId?: string;
  status?: 'active' | 'expired' | 'revoked';
  environment?: 'production' | 'staging' | 'development';
  preset?: 'read_only' | 'operations' | 'billing' | 'full_access' | 'custom';
  description?: string | null;
  expiresAt?: string | null;
  rateLimit?: number | null;
  createdBy?: string | null;
  createdByUser?: ApiKeyManager | null;
  managerIds?: string[];
  managers?: ApiKeyManager[];
  requests30d?: number;
  errors30d?: number;
  usage7d?: ApiKeyUsagePoint[];
  usage30d?: ApiKeyUsagePoint[];
}

// ==================== TEAM TYPES ====================
export type TeamMemberRole = 'admin' | 'editor' | 'viewer';
export type TeamMemberStatus = 'active' | 'pending' | 'suspended';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  joinedAt: string;
  invitedBy?: string;
}

// ==================== WEBHOOK TYPES ====================
export interface WebhookConfig {
  id?: string;
  slackWebhook?: string;
  slackEnabled: boolean;
  pagerDutyKey?: string;
  pagerDutyEnabled: boolean;
  alertLevel: 'warning' | 'escalation' | 'critical';
}

// ==================== NOTIFICATION TYPES ====================
export interface Notification {
  id: string;
  userId: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionUrl?: string;
}

// ==================== AUDIT LOG TYPES ====================
export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  details: string;
  timestamp: string;
  ipAddress: string;
}

// ==================== SETTINGS TYPES ====================
export interface AppSettings {
  id?: string;
  userId?: string;
  retentionDays: number;
  emailNotifications: boolean;
  weeklyReports: boolean;
  darkMode?: boolean;
  timezone?: string;
  language?: string;
}

// ==================== UI TYPES ====================
export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  badge?: number;
}

export interface PageView {
  id: string;
  name: string;
  component: React.ComponentType<any>;
  requiresAuth?: boolean;
  requiredPermissions?: Permission[];
}

// ==================== API RESPONSE TYPES ====================
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ==================== FORM TYPES ====================
export interface AgentFormData {
  name: string;
  description: string;
  agent_type: string;
  platform: string;
  model_name: string;
  system_prompt: string;
  budget_limit: number;
  auto_throttle: boolean;
}

export interface CostFormData {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
  agent_id?: string;
  model?: string;
}

export interface IncidentFormData {
  agent_id: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
}

// ==================== UTILITY TYPES ====================
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ValueOf<T> = T[keyof T];

// Type guards
export const isAgent = (obj: any): obj is AIAgent => {
  return obj && typeof obj === 'object' && 'id' in obj && 'name' in obj;
};

export const isIncident = (obj: any): obj is Incident => {
  return obj && typeof obj === 'object' && 'id' in obj && 'incident_type' in obj;
};

export const hasPermission = (userPermissions: Permission[], required: Permission): boolean => {
  return userPermissions.includes(required);
};

// ==================== CONNECTOR TYPES ====================
export type IntegrationStatus = 'connected' | 'active' | 'disconnected' | 'error';

export interface PlatformIntegration {
  id: string;
  name: string;
  status: IntegrationStatus;
  icon: string;
  requests: number;
  errors: number;
  createdAt: string;
  updatedAt: string;
  config?: Record<string, any>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type EndpointStatus = 'active' | 'inactive' | 'maintenance';

export interface ProxyEndpoint {
  id: string;
  path: string;
  method: HttpMethod;
  requests: number;
  latency: string;
  status: EndpointStatus;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export type ScraperStatus = 'syncing' | 'idle' | 'error';

export interface LogScraperConfig {
  id: string;
  source: string;
  lastSync: string;
  messages: number;
  status: ScraperStatus;
  createdAt: string;
  updatedAt: string;
  config?: Record<string, any>;
}

// ==================== POLICY & COMPLIANCE TYPES ====================
export type PolicyType = 'gdpr' | 'soc2' | 'hipaa' | 'custom';
export type EnforcementLevel = 'block' | 'warn' | 'audit';
export type PolicyTargetType = 'agent' | 'user' | 'organization';

export interface PolicyRule {
  id: string;
  rule_type: string; // e.g., "data_retention", "pii_protection", "audit_frequency"
  condition: Record<string, any>;
  action: string;
  severity: 'low' | 'medium' | 'high';
}

export interface PolicyPack {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  policy_type: PolicyType;
  rules: PolicyRule[];
  enforcement_level: EnforcementLevel;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PolicyAssignment {
  id: string;
  policy_pack_id: string;
  target_type: PolicyTargetType;
  target_id: string;
  assigned_by: string;
  assigned_at: string;
}

export type ComplianceExportType = 'soc2' | 'gdpr' | 'hipaa' | 'full_audit';
export type ComplianceExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ComplianceExport {
  id: string;
  organization_id: string;
  export_type: ComplianceExportType;
  requested_by: string;
  status: ComplianceExportStatus;
  date_range_start: string;
  date_range_end: string;
  filters?: Record<string, any>;
  file_url?: string;
  file_size_bytes?: number;
  record_count?: number;
  error_message?: string;
  requested_at: string;
  completed_at?: string;
}

export type ComplianceEventType = 'policy_violation' | 'data_access' | 'consent_change' | 'data_export' | 'data_deletion';
export type ComplianceEventSeverity = 'info' | 'warning' | 'critical';
export type RemediationStatus = 'none' | 'in_progress' | 'resolved';

export interface ComplianceEvent {
  id: string;
  organization_id: string;
  event_type: ComplianceEventType;
  severity: ComplianceEventSeverity;
  resource_type?: string;
  resource_id?: string;
  actor_id?: string;
  details: Record<string, any>;
  remediation_status: RemediationStatus;
  created_at: string;
}

// ==================== RUNTIME JOB TYPES ====================
export type AgentJobType = 'chat_turn' | 'workflow_run' | 'connector_action';
export type AgentJobStatus =
  | 'pending_approval'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | string;

export interface AgentJob {
  id: string;
  organization_id: string;
  agent_id: string | null;
  runtime_instance_id: string | null;
  type: AgentJobType;
  status: AgentJobStatus;
  input: Record<string, any>;
  output: Record<string, any>;
  error?: string | null;
  created_by: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export type AgentJobApprovalStatus = 'pending' | 'approved' | 'rejected' | string;

export interface AgentJobApproval {
  id: string;
  job_id: string;
  requested_by: string | null;
  approved_by: string | null;
  status: AgentJobApprovalStatus;
  policy_snapshot: any;
  created_at: string;
  decided_at: string | null;
}

// ==================== INTERNAL WORK ITEM TYPES ====================
export type SupportTicketStatus = 'open' | 'pending' | 'resolved' | 'closed' | string;
export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'urgent' | string;

export interface SupportTicket {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  customer_email?: string | null;
  source?: string | null;
  tags?: string[] | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export type SalesLeadStage = 'new' | 'qualified' | 'discovery' | 'demo' | 'proposal' | 'won' | 'lost' | string;

export interface SalesLead {
  id: string;
  organization_id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  stage: SalesLeadStage;
  score?: number | null;
  tags?: string[] | null;
  notes?: Record<string, any> | null;
  source?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'canceled' | string;

export interface AccessRequest {
  id: string;
  organization_id: string;
  subject: string;
  requestor_email?: string | null;
  system_name?: string | null;
  requested_access?: Record<string, any> | null;
  justification?: string | null;
  status: AccessRequestStatus;
  approved_by?: string | null;
  decided_at?: string | null;
  source?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}
