import { Client, Account, Databases, Teams, ID, Query } from 'appwrite';

// Appwrite configuration
const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '69a6b2760039cfb7ba1c';

// Database and Collection IDs
export const DB_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID || 'synthetic-hr';
export const COLLECTIONS = {
  AGENTS: 'agents',
  INCIDENTS: 'incidents',
  COST_DATA: 'cost_data',
  API_KEYS: 'api_keys',
  TEAMS: 'teams',
  SETTINGS: 'settings',
  CONVERSATIONS: 'conversations',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOGS: 'audit_logs',
  WEBHOOKS: 'webhooks',
};

// Initialize Appwrite Client
const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const databases = new Databases(client);
export const teams = new Teams(client);

const hasAppwriteSessionCookie = (): boolean => {
  if (typeof document === 'undefined') return false;
  const primary = `a_session_${APPWRITE_PROJECT_ID}=`;
  const legacy = `a_session_${APPWRITE_PROJECT_ID}_legacy=`;
  return document.cookie.includes(primary) || document.cookie.includes(legacy);
};

const getCurrentUserIfAuthenticated = async () => {
  if (!hasAppwriteSessionCookie()) return null;
  try {
    return await account.get();
  } catch (error: any) {
    if (!isAuthError(error)) console.error('Get user error:', error);
    return null;
  }
};

// Auth functions
export const appwriteAuth = {
  signUp: async (email: string, password: string, name: string) => {
    try {
      // Create user account
      const user = await account.create(ID.unique(), email, password, name);

      // Create email session (login immediately)
      await account.createSession(email, password);

      // Create user document in database
      await databases.createDocument(DB_ID, COLLECTIONS.TEAMS, user.$id, {
        userId: user.$id,
        email: user.email,
        name: name,
        role: 'super_admin',
        createdAt: new Date().toISOString(),
      });

      return { user, error: null };
    } catch (error: any) {
      console.error('Sign up error:', error);
      return { user: null, error: error.message || 'Sign up failed' };
    }
  },

  signIn: async (email: string, password: string) => {
    try {
      const session = await account.createSession(email, password);
      const user = await account.get();

      return { user, session, error: null };
    } catch (error: any) {
      console.error('Sign in error:', error);
      return { user: null, session: null, error: error.message || 'Invalid credentials' };
    }
  },

  signOut: async () => {
    try {
      await account.deleteSession('current');
      return { error: null };
    } catch (error: any) {
      console.error('Sign out error:', error);
      return { error: error.message };
    }
  },

  getCurrentUser: async () => {
    try {
      const user = await account.get();
      return { user, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get user error:', error);
      return { user: null, error: error.message };
    }
  },

  isAuthenticated: async () => {
    try {
      await account.get();
      return true;
    } catch {
      return false;
    }
  },

  // Password Reset
  sendPasswordReset: async (email: string) => {
    try {
      // Appwrite requires a URL for password reset - using a placeholder
      const resetUrl = 'https://0g6l23q9twev.space.minimax.io?reset=true';
      await account.createRecovery(email, resetUrl);
      return { error: null };
    } catch (error: any) {
      console.error('Password reset error:', error);
      return { error: error.message || 'Failed to send password reset email' };
    }
  },

  resetPassword: async (userId: string, secret: string, newPassword: string) => {
    try {
      await account.updateRecovery(userId, secret, newPassword);
      return { error: null };
    } catch (error: any) {
      console.error('Reset password error:', error);
      return { error: error.message || 'Failed to reset password' };
    }
  },
};

// Helper to silence expected auth errors when not logged in
const isAuthError = (error: any) => {
  const msg = error?.message?.toLowerCase() || '';
  const str = error?.toString().toLowerCase() || '';
  return msg.includes('missing scope') || str.includes('missing scope') || error?.code === 401;
};

// Database helper functions
export const appwriteDB = {
  // Agents
  createAgent: async (agentData: any) => {
    try {
      const user = await account.get();
      const agent = await databases.createDocument(DB_ID, COLLECTIONS.AGENTS, ID.unique(), {
        ...agentData,
        userId: user.$id,
        createdAt: new Date().toISOString(),
      });
      return { agent, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Create agent error:', error);
      return { agent: null, error: error.message };
    }
  },

  getAgents: async () => {
    try {
      const user = await account.get();
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.AGENTS, [
        Query.equal('userId', user.$id),
      ]);
      return { agents: response.documents, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get agents error:', error);
      return { agents: [], error: error.message };
    }
  },

  updateAgent: async (agentId: string, agentData: any) => {
    try {
      const agent = await databases.updateDocument(DB_ID, COLLECTIONS.AGENTS, agentId, agentData);
      return { agent, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Update agent error:', error);
      return { agent: null, error: error.message };
    }
  },

  deleteAgent: async (agentId: string) => {
    try {
      await databases.deleteDocument(DB_ID, COLLECTIONS.AGENTS, agentId);
      return { error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Delete agent error:', error);
      return { error: error.message };
    }
  },

  // Incidents
  createIncident: async (incidentData: any) => {
    try {
      const user = await account.get();
      const incident = await databases.createDocument(DB_ID, COLLECTIONS.INCIDENTS, ID.unique(), {
        ...incidentData,
        userId: user.$id,
        createdAt: new Date().toISOString(),
      });
      return { incident, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Create incident error:', error);
      return { incident: null, error: error.message };
    }
  },

  getIncidents: async () => {
    try {
      const user = await account.get();
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, [
        Query.equal('userId', user.$id),
        Query.orderDesc('$createdAt'),
      ]);
      return { incidents: response.documents, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get incidents error:', error);
      return { incidents: [], error: error.message };
    }
  },

  updateIncident: async (incidentId: string, incidentData: any) => {
    try {
      const incident = await databases.updateDocument(DB_ID, COLLECTIONS.INCIDENTS, incidentId, incidentData);
      return { incident, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Update incident error:', error);
      return { incident: null, error: error.message };
    }
  },

  // Cost Data
  createCostEntry: async (costData: any) => {
    try {
      const user = await account.get();
      const cost = await databases.createDocument(DB_ID, COLLECTIONS.COST_DATA, ID.unique(), {
        ...costData,
        userId: user.$id,
        createdAt: new Date().toISOString(),
      });
      return { cost, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Create cost error:', error);
      return { cost: null, error: error.message };
    }
  },

  getCostData: async () => {
    try {
      const user = await account.get();
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.COST_DATA, [
        Query.equal('userId', user.$id),
        Query.orderDesc('date'),
      ]);
      return { costData: response.documents, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get cost data error:', error);
      return { costData: [], error: error.message };
    }
  },

  // API Keys
  createApiKey: async (keyData: any) => {
    try {
      const user = await account.get();
      const key = await databases.createDocument(DB_ID, COLLECTIONS.API_KEYS, ID.unique(), {
        ...keyData,
        userId: user.$id,
        created: new Date().toISOString(),
      });
      return { key, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Create API key error:', error);
      return { key: null, error: error.message };
    }
  },

  getApiKeys: async () => {
    try {
      const user = await getCurrentUserIfAuthenticated();
      if (!user) {
        return { apiKeys: [], error: 'unauthenticated' };
      }
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.API_KEYS, [
        Query.equal('userId', user.$id),
      ]);
      return { apiKeys: response.documents, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get API keys error:', error);
      return { apiKeys: [], error: error.message };
    }
  },

  deleteApiKey: async (keyId: string) => {
    try {
      await databases.deleteDocument(DB_ID, COLLECTIONS.API_KEYS, keyId);
      return { error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Delete API key error:', error);
      return { error: error.message };
    }
  },

  // Notifications
  createNotification: async (notificationData: any) => {
    try {
      const user = await account.get();
      const notification = await databases.createDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, ID.unique(), {
        ...notificationData,
        userId: user.$id,
        timestamp: new Date().toISOString(),
        read: false,
      });
      return { notification, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Create notification error:', error);
      return { notification: null, error: error.message };
    }
  },

  getNotifications: async () => {
    try {
      const user = await getCurrentUserIfAuthenticated();
      if (!user) {
        return { notifications: [], error: 'unauthenticated' };
      }
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [
        Query.equal('userId', user.$id),
        Query.orderDesc('timestamp'),
        Query.limit(50),
      ]);
      return { notifications: response.documents, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get notifications error:', error);
      return { notifications: [], error: error.message };
    }
  },

  markNotificationRead: async (notificationId: string) => {
    try {
      const notification = await databases.updateDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, notificationId, {
        read: true,
      });
      return { notification, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Mark notification read error:', error);
      return { notification: null, error: error.message };
    }
  },

  // Settings
  saveSettings: async (settings: any) => {
    try {
      const user = await account.get();

      // Check if settings exist
      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.SETTINGS, [
        Query.equal('userId', user.$id),
      ]);

      if (existing.documents.length > 0) {
        // Update existing
        const settingsDoc = await databases.updateDocument(DB_ID, COLLECTIONS.SETTINGS, existing.documents[0].$id, settings);
        return { settings: settingsDoc, error: null };
      } else {
        // Create new
        const settingsDoc = await databases.createDocument(DB_ID, COLLECTIONS.SETTINGS, ID.unique(), {
          ...settings,
          userId: user.$id,
        });
        return { settings: settingsDoc, error: null };
      }
    } catch (error: any) {
      console.error('Save settings error:', error);
      return { settings: null, error: error.message };
    }
  },

  getSettings: async () => {
    try {
      const user = await account.get();
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.SETTINGS, [
        Query.equal('userId', user.$id),
      ]);

      if (response.documents.length > 0) {
        return { settings: response.documents[0], error: null };
      }
      return { settings: null, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get settings error:', error);
      return { settings: null, error: error.message };
    }
  },

  // API Keys - Server-side secure storage
  createSecureApiKey: async (keyData: { name: string; permissions: string[] }) => {
    try {
      const user = await account.get();
      // Generate a secure key server-side (in production, use a proper secure random)
      const rawKey = `sk_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
      // Hash the key for storage (never store raw keys)
      const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
      const keyHashHex = Array.from(new Uint8Array(keyHash)).map(b => b.toString(16).padStart(2, '0')).join('');

      const apiKey = await databases.createDocument(DB_ID, COLLECTIONS.API_KEYS, ID.unique(), {
        name: keyData.name,
        keyHash: keyHashHex,
        permissions: keyData.permissions,
        userId: user.$id,
        created: new Date().toISOString(),
        lastUsed: null,
        // Only return the raw key once to the user
      });

      return { apiKey: { ...apiKey, rawKey }, error: null };
    } catch (error: any) {
      console.error('Create API key error:', error);
      return { apiKey: null, error: error.message };
    }
  },

  // Verify API key (for server-side validation)
  verifyApiKey: async (keyId: string, keyHash: string) => {
    try {
      const key = await databases.getDocument(DB_ID, COLLECTIONS.API_KEYS, keyId);
      if (key.keyHash === keyHash) {
        // Update last used
        await databases.updateDocument(DB_ID, COLLECTIONS.API_KEYS, keyId, {
          lastUsed: new Date().toISOString(),
        });
        return { valid: true, permissions: key.permissions, error: null };
      }
      return { valid: false, permissions: [], error: 'Invalid API key' };
    } catch (error: any) {
      return { valid: false, permissions: [], error: error.message };
    }
  },

  // Audit Log - Track all actions
  createAuditLog: async (action: string, details: any) => {
    try {
      const user = await account.get();
      await databases.createDocument(DB_ID, COLLECTIONS.AUDIT_LOGS, ID.unique(), {
        userId: user.$id,
        action,
        details: JSON.stringify(details),
        timestamp: new Date().toISOString(),
        ipAddress: 'client', // In production, get from server
      });
      return { error: null };
    } catch (error: any) {
      console.error('Audit log error:', error);
      return { error: error.message };
    }
  },

  // Webhooks - Securely store webhook configurations
  saveWebhooks: async (webhookData: {
    slackWebhook?: string;
    slackEnabled?: boolean;
    pagerDutyKey?: string;
    pagerDutyEnabled?: boolean;
    alertLevel?: string;
  }) => {
    try {
      const user = await account.get();

      // Check if webhooks exist
      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.WEBHOOKS, [
        Query.equal('userId', user.$id),
      ]);

      if (existing.documents.length > 0) {
        const webhook = await databases.updateDocument(DB_ID, COLLECTIONS.WEBHOOKS, existing.documents[0].$id, webhookData);
        return { webhook, error: null };
      } else {
        const webhook = await databases.createDocument(DB_ID, COLLECTIONS.WEBHOOKS, ID.unique(), {
          ...webhookData,
          userId: user.$id,
        });
        return { webhook, error: null };
      }
    } catch (error: any) {
      console.error('Save webhooks error:', error);
      return { webhook: null, error: error.message };
    }
  },

  getWebhooks: async () => {
    try {
      const user = await getCurrentUserIfAuthenticated();
      if (!user) {
        return { webhook: null, error: 'unauthenticated' };
      }
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.WEBHOOKS, [
        Query.equal('userId', user.$id),
      ]);

      if (response.documents.length > 0) {
        // Don't expose the raw webhook URL to client, only return metadata
        const webhook = response.documents[0];
        return {
          webhook: {
            id: webhook.$id,
            slackEnabled: webhook.slackEnabled,
            pagerDutyEnabled: webhook.pagerDutyEnabled,
            alertLevel: webhook.alertLevel,
            // Don't return slackWebhook or pagerDutyKey - only use on server
          },
          error: null
        };
      }
      return { webhook: null, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get webhooks error:', error);
      return { webhook: null, error: error.message };
    }
  },

  // Get raw webhook config for server-side use only
  getWebhookSecrets: async () => {
    return {
      secrets: null,
      error: 'Webhook secrets are server-side only. Access via backend webhook endpoint.',
    };
  },

  // RasiAI Settings - Securely store API keys
  saveRasiAiSettings: async (settings: {
    enabled?: boolean;
    apiKey?: string;
    defaultModel?: string;
    maxBudget?: number;
    costAlertThreshold?: number;
  }) => {
    try {
      const user = await account.get();

      // Check if settings exist
      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.SETTINGS, [
        Query.equal('userId', user.$id),
      ]);

      if (existing.documents.length > 0) {
        const updated = await databases.updateDocument(DB_ID, COLLECTIONS.SETTINGS, existing.documents[0].$id, {
          rasiAiEnabled: settings.enabled,
          rasiAiApiKey: settings.apiKey,
          rasiAiDefaultModel: settings.defaultModel,
          rasiAiMaxBudget: settings.maxBudget,
          rasiAiCostAlertThreshold: settings.costAlertThreshold,
        });
        return { settings: updated, error: null };
      } else {
        const created = await databases.createDocument(DB_ID, COLLECTIONS.SETTINGS, ID.unique(), {
          userId: user.$id,
          rasiAiEnabled: settings.enabled,
          rasiAiApiKey: settings.apiKey,
          rasiAiDefaultModel: settings.defaultModel,
          rasiAiMaxBudget: settings.maxBudget,
          rasiAiCostAlertThreshold: settings.costAlertThreshold,
        });
        return { settings: created, error: null };
      }
    } catch (error: any) {
      console.error('Save RasiAI settings error:', error);
      return { settings: null, error: error.message };
    }
  },

  // Get RasiAI settings (without exposing API key)
  getRasiAiSettings: async () => {
    try {
      const user = await getCurrentUserIfAuthenticated();
      if (!user) {
        return { settings: null, error: 'unauthenticated' };
      }
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.SETTINGS, [
        Query.equal('userId', user.$id),
      ]);

      if (response.documents.length > 0) {
        const settings = response.documents[0];
        return {
          settings: {
            enabled: settings.rasiAiEnabled || false,
            hasApiKey: !!settings.rasiAiApiKey,
            defaultModel: settings.rasiAiDefaultModel || 'openai/gpt-4-turbo',
            maxBudget: settings.rasiAiMaxBudget || 1000,
            costAlertThreshold: settings.rasiAiCostAlertThreshold || 80,
          },
          error: null
        };
      }
      return { settings: null, error: null };
    } catch (error: any) {
      if (!isAuthError(error)) console.error('Get RasiAI settings error:', error);
      return { settings: null, error: error.message };
    }
  },

  // Get raw RasiAI API key for server-side use only
  getRasiAiApiKey: async () => {
    try {
      const user = await account.get();
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.SETTINGS, [
        Query.equal('userId', user.$id),
      ]);

      if (response.documents.length > 0) {
        return {
          apiKey: response.documents[0].rasiAiApiKey,
          error: null
        };
      }
      return { apiKey: null, error: null };
    } catch (error: any) {
      return { apiKey: null, error: error.message };
    }
  },
};

export default client;
