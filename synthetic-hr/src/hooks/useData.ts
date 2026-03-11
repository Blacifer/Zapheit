import { useState, useCallback, useEffect } from 'react';
import { supabase, authHelpers } from '../lib/supabase-client';
import { api } from '../lib/api-client';

/**
 * Hook for managing authentication state and operations
 */
export const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if user is logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user: currentUser, error: checkError } = await authHelpers.getCurrentUser();
        if (checkError) {
          setUser(null);
        } else {
          setUser(currentUser);
        }
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(session.user);
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    setLoading(true);
    setError(null);
    try {
      const { user: newUser, error: signUpError } = await authHelpers.signUp(email, password, name);
      if (signUpError) {
        setError(signUpError);
        return { success: false, error: signUpError };
      }
      setUser(newUser);
      return { success: true, user: newUser };
    } catch (err: any) {
      const errMsg = err.message || 'Sign up failed';
      setError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setLoading(false);
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const { user: signedInUser, error: signInError } = await authHelpers.signIn(email, password);
      if (signInError) {
        setError(signInError);
        return { success: false, error: signInError };
      }
      setUser(signedInUser);
      return { success: true, user: signedInUser };
    } catch (err: any) {
      const errMsg = err.message || 'Sign in failed';
      setError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await authHelpers.signOut();
      if (signOutError) {
        setError(signOutError);
        return { success: false, error: signOutError };
      }
      setUser(null);
      return { success: true };
    } catch (err: any) {
      const errMsg = err.message || 'Sign out failed';
      setError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setLoading(false);
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      const { error: resetError } = await authHelpers.sendPasswordReset(email);
      if (resetError) {
        setError(resetError);
        return { success: false, error: resetError };
      }
      return { success: true };
    } catch (err: any) {
      const errMsg = err.message || 'Password reset failed';
      setError(errMsg);
      return { success: false, error: errMsg };
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    user,
    loading,
    error,
    signUp,
    signIn,
    signOut,
    resetPassword,
    isAuthenticated: !!user,
  };
};

/**
 * Hook for managing AI agents
 */
export const useAgents = () => {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.agents.getAll();
      if (response.success && response.data) {
        setAgents(response.data);
      } else {
        setError(response.error || 'Failed to fetch agents');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, refetch: fetchAgents };
};

/**
 * Hook for managing incidents
 */
export const useIncidents = () => {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.incidents.getAll();
      if (response.success && response.data) {
        setIncidents(response.data);
      } else {
        setError(response.error || 'Failed to fetch incidents');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  return { incidents, loading, error, refetch: fetchIncidents };
};

/**
 * Hook for managing cost data
 */
export const useCostData = (period: '7d' | '30d' | '90d' = '30d') => {
  const [costData, setCostData] = useState<any[]>([]);
  const [totals, setTotals] = useState({ totalCost: 0, totalTokens: 0, totalRequests: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCostData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.costs.getAnalytics({ period });
      if (response.success && response.data) {
        setCostData(response.data.data || []);
        setTotals(response.data.totals || { totalCost: 0, totalTokens: 0, totalRequests: 0 });
      } else {
        setError(response.error || 'Failed to fetch cost data');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch cost data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchCostData();
  }, [fetchCostData]);

  return { costData, totals, loading, error, refetch: fetchCostData };
};
