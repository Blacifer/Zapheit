import React from 'react';

// Central type definitions for Zapheit
// All types should be defined here for consistency

// ==================== AUTH TYPES ====================
export interface AuthUser {
  id: string;
  email: string;
  organizationName: string;
  role: 'super_admin' | 'admin' | 'manager' | 'viewer';
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

export interface AgentVersion {
  id: string;
  version_number: number;
  changed_by_email: string | null;
  change_summary: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
}

export interface AgentWorkspaceConversation {
  id: string;
  user: string;
  topic: string;
  preview: string;
  status: string;
  platform: string;
  timestamp: string;
}

export interface AgentWorkspaceIncident {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  type: string;
  createdAt: string;
}

export interface AgentWorkspaceAnalytics {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  avgCostPerRequest: number;
  dailyAverage: number;
  trend: Array<{
    date: string;
    cost: number;
    requests: number;
  }>;
}

export interface AgentWorkspaceSummary {
  openIncidentCount: number;
  criticalIncidentCount: number;
  liveTargetCount: number;
  connectedTargetCount: number;
  totalConversationCount: number;
  lastActivityAt: string | null;
}

export interface AgentWorkspaceData {
  agent: AIAgent;
  summary: AgentWorkspaceSummary;
  conversations: AgentWorkspaceConversation[];
  incidents: AgentWorkspaceIncident[];
  analytics: AgentWorkspaceAnalytics;
}

// ==================== INCIDENT TYPES ====================
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';
export type IncidentType =
  | 'pii_leak'
  | 'hallucination'
  | 'refund_abuse'
  | 'legal_advice'
  | 'infinite_loop'
  | 'angry_user'
  | 'toxic_output'
  | 'data_extraction_attempt';

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
  // DB-persisted triage metadata (migration_014)
  owner?: string;
  priority?: string;
  source?: string;
  next_action?: string;
  // Detection confidence (0.0–1.0), stored since migration_029
  confidence?: number;
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
  required_role?: string | null;
  assigned_to?: string | null;
  required_approvals?: number;
  approvals_recorded?: number;
  approvals_remaining?: number;
  awaiting_additional_approval?: boolean;
  approval?: AgentJobApproval | null;
  reason_category?: 'policy_blocked' | 'approval_required' | 'reliability_degraded' | 'execution_failed' | null;
  reason_message?: string | null;
  recommended_next_action?: string | null;
}

export type AgentJobApprovalStatus = 'pending' | 'approved' | 'rejected' | string;

export interface AgentJobApproval {
  id: string;
  job_id: string;
  requested_by: string | null;
  approved_by: string | null;
  status: AgentJobApprovalStatus;
  policy_snapshot: any;
  required_approvals?: number;
  approval_history?: Array<{
    reviewer_id: string;
    decision: 'approved' | 'rejected';
    decided_at: string;
  }>;
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

// ==================== RECRUITMENT HUB TYPES ====================
export type JobPostingStatus = 'draft' | 'open' | 'paused' | 'closed';
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';
export type ApplicationStatus = 'new' | 'screening' | 'shortlisted' | 'interviewing' | 'offered' | 'rejected' | 'withdrawn';

export interface PostedPlatform {
  platform: string;
  external_id: string;
  posted_at: string;
}

export interface JobPosting {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  requirements?: string | null;
  location?: string | null;
  employment_type: EmploymentType;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string;
  status: JobPostingStatus;
  posted_to: PostedPlatform[];
  ai_screening_enabled: boolean;
  ai_screening_threshold: number;
  auto_reject_below?: number | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
  // Enriched from GET /jobs/:id
  application_count?: number;
  avg_ai_score?: number | null;
  status_breakdown?: Record<string, number>;
}

export interface JobApplication {
  id: string;
  organization_id: string;
  job_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  candidate_phone?: string | null;
  resume_url?: string | null;
  resume_text?: string | null;
  cover_letter?: string | null;
  source_platform?: string | null;
  external_application_id?: string | null;
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_scored_at?: string | null;
  status: ApplicationStatus;
  rejection_reason?: string | null;
  tags?: string[];
  notes?: any[];
  applied_at: string;
  created_at: string;
  updated_at?: string | null;
}

export interface AiScoringResult {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

// ==================== SUPPORT HUB TYPES ====================
export interface SupportTicketHub extends SupportTicket {
  ai_urgency_score?: number | null;
  ai_category?: string | null;
  ai_draft_response?: string | null;
  ai_triaged_at?: string | null;
  sla_deadline?: string | null;
  channel?: string | null;
}

// ==================== SALES HUB TYPES ====================
export interface SalesLeadHub extends SalesLead {
  ai_deal_score?: number | null;
  ai_risk_reason?: string | null;
  ai_next_action?: string | null;
  ai_scored_at?: string | null;
  deal_value?: number | null;
  currency?: string | null;
  last_activity_at?: string | null;
}

// ==================== IT HUB TYPES ====================
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

// ==================== ACCESS REQUEST HUB (IT) ====================
export interface AccessRequestHub extends AccessRequest {
  ai_risk_rating?: number | null;
  ai_policy_result?: string | null;
  ai_evaluation_notes?: string | null;
  ai_evaluated_at?: string | null;
  department?: string | null;
  sensitivity_level?: string | null;
}

// ==================== FINANCE HUB TYPES ====================
export type InvoiceMatchedStatus = 'unmatched' | 'matched' | 'exception' | 'paid';
export type InvoiceStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface HubInvoice {
  id: string;
  organization_id: string;
  vendor_name: string;
  invoice_number?: string | null;
  amount: number;
  currency?: string;
  due_date?: string | null;
  received_at?: string | null;
  po_number?: string | null;
  matched_status: InvoiceMatchedStatus;
  ai_match_confidence?: number | null;
  ai_flags?: Array<{ type: string; detail: string }>;
  ai_validated_at?: string | null;
  status: InvoiceStatus;
  approved_by?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'reimbursed';

export interface HubExpense {
  id: string;
  organization_id: string;
  claimant_name: string;
  claimant_email?: string | null;
  category?: string | null;
  amount: number;
  currency?: string;
  receipt_url?: string | null;
  description?: string | null;
  expense_date?: string | null;
  ai_policy_compliant?: boolean | null;
  ai_flags?: Array<{ type: string; detail: string }>;
  ai_validated_at?: string | null;
  status: ExpenseStatus;
  approved_by?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// ==================== COMPLIANCE HUB TYPES ====================
export type DeadlineStatus = 'upcoming' | 'in_progress' | 'completed' | 'overdue' | 'waived';

export interface HubDeadline {
  id: string;
  organization_id: string;
  title: string;
  regulation?: string | null;
  description?: string | null;
  due_date: string;
  recurring?: string | null;
  status: DeadlineStatus;
  ai_checklist?: Array<{ item: string; done: boolean }>;
  ai_generated_at?: string | null;
  assigned_to?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export type EvidenceStatus = 'collected' | 'reviewed' | 'accepted' | 'rejected';

export interface HubEvidence {
  id: string;
  organization_id: string;
  deadline_id?: string | null;
  title: string;
  control_area?: string | null;
  source?: string | null;
  file_url?: string | null;
  collected_at?: string | null;
  status: EvidenceStatus;
  reviewed_by?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// ==================== IDENTITY HUB TYPES ====================

export type IdentityEventType =
  | 'login' | 'login_failed' | 'mfa_challenge' | 'mfa_failed'
  | 'password_reset' | 'account_locked'
  | 'access_granted' | 'access_revoked'
  | 'user_provisioned' | 'user_deprovisioned'
  | 'group_changed' | 'role_changed'
  | 'suspicious_activity' | 'other';

export type IdentityEventSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AccessLevel = 'read' | 'write' | 'admin' | 'owner';
export type AccessGraphStatus = 'active' | 'inactive' | 'revoked' | 'pending_review';

export interface HubIdentityEvent {
  id: string;
  organization_id: string;
  event_type: IdentityEventType;
  severity: IdentityEventSeverity;
  actor_email?: string | null;
  actor_name?: string | null;
  actor_id?: string | null;
  target_resource?: string | null;
  target_system?: string | null;
  source_platform?: string | null;
  source_event_id?: string | null;
  ip_address?: string | null;
  geo_location?: string | null;
  user_agent?: string | null;
  details?: Record<string, any>;
  ai_anomaly_score?: number | null;
  ai_anomaly_reasons?: string[];
  ai_scored_at?: string | null;
  event_at: string;
  created_at: string;
}

export interface HubAccessGraph {
  id: string;
  organization_id: string;
  user_email: string;
  user_name?: string | null;
  system_name: string;
  access_level: AccessLevel;
  source_platform?: string | null;
  granted_at?: string | null;
  last_used_at?: string | null;
  status: AccessGraphStatus;
  risk_score?: number | null;
  created_at: string;
  updated_at?: string | null;
}
