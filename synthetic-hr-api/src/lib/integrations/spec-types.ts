export type IntegrationCategory =
  | 'HRMS'
  | 'PAYROLL'
  | 'GLOBAL_PAYROLL'
  | 'RECRUITMENT'
  | 'ATS'
  | 'SUPPORT'
  | 'CRM'
  | 'ITSM'
  | 'COMPLIANCE'
  | 'FINANCE'
  | 'COMMUNICATION'
  | 'IDENTITY'
  | 'DOCUMENTS'
  | 'BGV'
  | 'LMS'
  | 'PAYMENTS'
  | 'PRODUCTIVITY'
  | 'COLLABORATION'
  | 'IAM'
  | 'OTHER';

export type IntegrationAuthType = 'oauth2' | 'api_key' | 'client_credentials';

export type IntegrationFieldType = 'text' | 'password';

export type IntegrationActionRisk = 'low' | 'medium' | 'high' | 'money';

export type IntegrationRequiredField = {
  name: string;
  label: string;
  type: IntegrationFieldType;
  placeholder?: string;
  required: boolean;
  description?: string;
};

// UI pack ids (frontend groups integrations/actions by these).
export type IntegrationPackId = 'recruitment' | 'support' | 'sales' | 'it' | 'finance' | 'compliance';

export type IntegrationApiKeyConfig = {
  requiredFields: IntegrationRequiredField[];
  testEndpoint: string;
  baseUrl: string;
};

export type IntegrationOAuthConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectPath: string; // backend path, e.g. /api/integrations/oauth/callback/zoho_people
};

export type IntegrationEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  format?: 'json' | 'xml';
};

export type IntegrationWriteCapability = {
  id: string; // stable action id, e.g. "outreach.send_email"
  label: string;
  risk: IntegrationActionRisk;
  // Optional hint for UI grouping when provider category alone is not enough (e.g. built-in/internal actions).
  pack?: IntegrationPackId;
};

export type IntegrationCapabilities = {
  reads: string[]; // canonical-ish objects, e.g. "candidate_profiles"
  writes: IntegrationWriteCapability[];
};

export type IntegrationSpec = {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  authType: IntegrationAuthType;
  tags: string[];
  status: 'READY';
  color: string;
  priority: number;
  apiKeyConfig?: IntegrationApiKeyConfig;
  // For non-api-key connections (oauth2 params like domain, client_credentials fields, etc).
  connectionFields?: IntegrationRequiredField[];
  oauthConfig?: IntegrationOAuthConfig;
  endpoints: Record<string, IntegrationEndpoint>;
  capabilities?: IntegrationCapabilities;
  aiFeatures?: {
    enabled: boolean;
    capabilities: string[];
    dataTypes: string[];
  };
  notes?: string;
};

export type ConnectionTestResult = { success: boolean; message: string };

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export type SyncResult = {
  success: boolean;
  message: string;
  stats?: Record<string, number>;
};

export interface IntegrationAdapter {
  testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult>;
  refreshToken?(credentials: Record<string, string>): Promise<TokenResponse>;
  sync?(integrationId: string, credentials: Record<string, string>): Promise<SyncResult>;
}
