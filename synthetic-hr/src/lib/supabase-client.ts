import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const getProvisionUrl = () => {
  const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
  const normalized = rawApiUrl.replace(/\/+$/, '');
  return normalized.endsWith('/api')
    ? `${normalized.slice(0, -4)}/auth/provision`
    : `${normalized}/auth/provision`;
};

// Auth helper functions
export const authHelpers = {
  // Get current authenticated user
  getCurrentUser: async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        return { user: null, error: sessionError };
      }

      // No session means user is simply signed out.
      if (!session) {
        return { user: null, error: null };
      }

      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        // Treat missing-session auth errors as a normal signed-out state.
        if (error.name === 'AuthSessionMissingError') {
          return { user: null, error: null };
        }
        console.error('Get user error:', error);
        return { user: null, error };
      }
      return { user, error: null };
    } catch (err: any) {
      if (err?.name === 'AuthSessionMissingError') {
        return { user: null, error: null };
      }
      console.error('Get user exception:', err);
      return { user: null, error: err };
    }
  },

  // Sign up
  signUp: async (email: string, password: string, name: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            organization_name: name,
          },
        },
      });

      if (error) {
        return { user: null, error: error.message };
      }

      // Create organization and user profile (only if a session is available).
      // For email-confirm flows where session is null, we'll provision on first sign-in.
      if (data.user) {
        try {
          const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 100) || `workspace-${data.user.id.substring(0, 8)}`;

          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (accessToken) {
            const provisionResponse = await fetch(getProvisionUrl(), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                name,
                orgName: name,
                slug,
              }),
            });

            if (!provisionResponse.ok) {
              const payload = await provisionResponse.json().catch(() => null);
              const message = payload?.error || payload?.errors?.[0] || 'Workspace setup failed after sign-up';
              return { user: data.user, error: message };
            }
          }
        } catch (err: any) {
          console.warn('Profile/org creation exception:', err.message);
          return { user: data.user, error: 'Account created, but workspace setup failed. Run the operator bootstrap or contact support.' };
        }
      }

      return { user: data.user, error: null };
    } catch (err: any) {
      return { user: null, error: err.message };
    }
  },

  // Sign in
  signIn: async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { user: null, session: null, error: error.message };
      }

      // Ensure the user has a provisioned workspace profile.
      if (data.user && data.session?.access_token) {
        try {
          const profileLookup = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', data.user.id)
            .maybeSingle();

          const orgId = profileLookup.data?.organization_id || null;
          if (!orgId) {
            const orgName = (data.user.user_metadata as any)?.organization_name || (data.user.email ? `${data.user.email.split('@')[0]}'s Workspace` : 'Workspace');
            const slug = String(orgName)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .substring(0, 100) || `workspace-${data.user.id.substring(0, 8)}`;

            await fetch(getProvisionUrl(), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${data.session.access_token}`,
              },
              body: JSON.stringify({
                name: (data.user.user_metadata as any)?.full_name || orgName,
                orgName,
                slug,
              }),
            }).catch(() => null);
          }
        } catch (err: any) {
          console.warn('Provision check failed after sign-in:', err.message);
        }
      }

      return { user: data.user, session: data.session, error: null };
    } catch (err: any) {
      return { user: null, session: null, error: err.message };
    }
  },

  // Sign out
  signOut: async () => {
    try {
      const { error } = await supabase.auth.signOut();
      return { error: error?.message || null };
    } catch (err: any) {
      return { error: err.message };
    }
  },

  // Get session
  getSession: async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      return { session, error };
    } catch (err: any) {
      return { session: null, error: err };
    }
  },

  // Password reset
  sendPasswordReset: async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      return { error: error?.message || null };
    } catch (err: any) {
      return { error: err.message };
    }
  },

  // Update password
  updatePassword: async (newPassword: string) => {
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      return { user: data.user, error: error?.message || null };
    } catch (err: any) {
      return { user: null, error: err.message };
    }
  },

  // Watch auth state changes
  onAuthStateChanged: (callback: any) => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
    return subscription;
  },
};

// Data query helpers
export const dataHelpers = {
  // Get all agents for org
  getAgents: async (orgId: string) => {
    try {
      const { data, error } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: [], error: err.message };
    }
  },

  // Get all incidents for org
  getIncidents: async (orgId: string) => {
    try {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: [], error: err.message };
    }
  },

  // Get cost tracking data
  getCostData: async (orgId: string) => {
    try {
      const { data, error } = await supabase
        .from('cost_tracking')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: any) {
      return { data: [], error: err.message };
    }
  },

  // Get user org
  getUserOrganization: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('organization_id, organizations(*)')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: err.message };
    }
  },
};

export default supabase;
