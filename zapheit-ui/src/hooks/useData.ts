import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, authHelpers } from '../lib/supabase-client';
import { api } from '../lib/api-client';
import { USD_TO_INR } from '../lib/currency';
import type { AIAgent, Incident, CostData } from '../types';

// ---------------------------------------------------------------------------
// Shared type for a persisted fine-tune job (matches DB row shape)
// ---------------------------------------------------------------------------
export type FineTuneJobRecord = {
  id: string;
  name: string;
  base_model: string;
  epochs: number;
  file_name: string;
  examples: number;
  validation_examples: number;
  estimated_cost_inr: number;
  readiness_score: number;
  issues: string[];
  status: string;
  provider_state: 'staged_local' | 'openai_submitted';
  provider_job_id: string | null;
  fine_tuned_model: string | null;
  trained_tokens: number | null;
  provider_status_text: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Query keys — centralised so invalidations are consistent
// ---------------------------------------------------------------------------
export const queryKeys = {
  agents: ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
  incidents: (filters?: { agent_id?: string; severity?: string; status?: string }) =>
    filters ? ['incidents', filters] : (['incidents'] as const),
  costAnalytics: (period: string) => ['costs', 'analytics', period] as const,
  fineTuneJobs: ['fine-tune-jobs'] as const,
  auth: ['auth'] as const,
};

// ---------------------------------------------------------------------------
// Auth hook (unchanged logic, keeps same return shape)
// ---------------------------------------------------------------------------
export const useAuth = () => {
  const { data: user, isLoading: loading } = useQuery({
    queryKey: queryKeys.auth,
    queryFn: async () => {
      const { user: currentUser, error } = await authHelpers.getCurrentUser();
      if (error) return null;
      return currentUser ?? null;
    },
    staleTime: Infinity, // auth state managed by Supabase listener — never auto-refetch
  });

  // Mirror Supabase auth events into the cache
  supabase.auth.onAuthStateChange((_event, session) => {
    // No-op: AppContext handles auth; this hook is kept for backward compat
    void session;
  });

  const signUp = async (email: string, password: string, name: string) => {
    const { user: newUser, error } = await authHelpers.signUp(email, password, name);
    if (error) return { success: false, error };
    return { success: true, user: newUser };
  };

  const signIn = async (email: string, password: string) => {
    const { user: signedInUser, error } = await authHelpers.signIn(email, password);
    if (error) return { success: false, error };
    return { success: true, user: signedInUser };
  };

  const signOut = async () => {
    const { error } = await authHelpers.signOut();
    if (error) return { success: false, error };
    return { success: true };
  };

  const resetPassword = async (email: string) => {
    const { error } = await authHelpers.sendPasswordReset(email);
    if (error) return { success: false, error };
    return { success: true };
  };

  return {
    user: user ?? null,
    loading,
    error: null,
    signUp,
    signIn,
    signOut,
    resetPassword,
    isAuthenticated: !!user,
  };
};

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
export const useAgents = (options?: { enabled?: boolean }) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.agents,
    enabled: options?.enabled !== false,
    queryFn: async (): Promise<AIAgent[]> => {
      const res = await api.agents.getAll();
      if (!res.success) throw new Error(res.error ?? 'Failed to fetch agents');
      return (res.data ?? []).map((a: AIAgent) => ({
        ...a,
        lifecycle_state: a.lifecycle_state || 'idle',
        conversations: a.conversations || 0,
        satisfaction: a.satisfaction || 0,
        uptime: a.uptime || 100,
        budget_limit: a.budget_limit || 0,
        current_spend: a.current_spend || 0,
        auto_throttle: a.auto_throttle || false,
      }));
    },
  });

  return {
    agents: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
};

// ---------------------------------------------------------------------------
// Agent mutations
// ---------------------------------------------------------------------------
export const useAgentMutations = () => {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.agents });

  const pauseAgent = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.agents.pause(id, reason),
    onSuccess: invalidate,
  });

  const resumeAgent = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.agents.resume(id, reason),
    onSuccess: invalidate,
  });

  const killAgent = useMutation({
    mutationFn: ({ id, level, reason }: { id: string; level?: 1 | 2 | 3; reason?: string }) =>
      api.agents.kill(id, { level, reason }),
    onSuccess: invalidate,
  });

  const updateAgent = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof api.agents.update>[1] }) =>
      api.agents.update(id, updates),
    onSuccess: invalidate,
  });

  const deleteAgent = useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: invalidate,
  });

  return { pauseAgent, resumeAgent, killAgent, updateAgent, deleteAgent };
};

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
export const useIncidents = (
  filters?: { agent_id?: string; severity?: string; status?: string },
  options?: { enabled?: boolean },
) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.incidents(filters),
    enabled: options?.enabled !== false,
    queryFn: async (): Promise<Incident[]> => {
      const res = await api.incidents.getAll({ ...filters, limit: 100 });
      if (!res.success) throw new Error(res.error ?? 'Failed to fetch incidents');
      return res.data ?? [];
    },
  });

  return {
    incidents: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
};

// ---------------------------------------------------------------------------
// Real-time incident SSE stream
// ---------------------------------------------------------------------------
/**
 * Connects to /api/incidents/stream and prepends new incidents into the React
 * Query cache as they arrive, so the UI updates without polling.
 */
export const useIncidentStream = (options?: { enabled?: boolean }) => {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (options?.enabled === false) return;

    let active = true;
    let retryDelay = 2000;

    const connect = async () => {
      if (!active) return;
      abortRef.current = new AbortController();

      try {
        const { getSupabaseClient } = await import('../lib/supabase');
        const supabaseClient = getSupabaseClient();
        const { data: { session } } = await supabaseClient!.auth.getSession();
        if (!session?.access_token || !active) return;

        const { getFrontendConfig } = await import('../lib/config');
        const apiBase = getFrontendConfig().apiUrl || 'http://localhost:3001/api';

        const response = await fetch(`${apiBase}/incidents/stream`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';

          for (const block of blocks) {
            const eventLine = block.split('\n').find(l => l.startsWith('event:'));
            const dataLine = block.split('\n').find(l => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;

            const eventType = eventLine.slice(6).trim();
            if (eventType !== 'incident.new') continue;

            try {
              const incident = JSON.parse(dataLine.slice(5).trim()) as Incident;
              queryClient.setQueryData<Incident[]>(
                ['incidents'],
                (prev) => prev ? [incident, ...prev.filter(i => i.id !== incident.id)] : [incident]
              );
              // Invalidate all filtered incident queries so they also refresh
              queryClient.invalidateQueries({ queryKey: ['incidents'], exact: false });
            } catch { /* malformed JSON — skip */ }
          }
        }

        retryDelay = 2000; // reset on clean disconnect
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }

      // Reconnect with backoff (max 30s)
      if (active) {
        await new Promise(r => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 30_000);
        connect();
      }
    };

    connect();

    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [options?.enabled, queryClient]);
};

// ---------------------------------------------------------------------------
// Incident mutations
// ---------------------------------------------------------------------------
export const useIncidentMutations = () => {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.incidents() });

  const resolveIncident = useMutation({
    mutationFn: (id: string) => api.incidents.resolve(id),
    onSuccess: invalidate,
  });

  const createIncident = useMutation({
    mutationFn: (data: Parameters<typeof api.incidents.create>[0]) =>
      api.incidents.create(data),
    onSuccess: invalidate,
  });

  return { resolveIncident, createIncident };
};

// ---------------------------------------------------------------------------
// Cost analytics
// ---------------------------------------------------------------------------
export const useCostData = (period: '7d' | '30d' | '90d' | 'all' = '30d', options?: { enabled?: boolean }) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.costAnalytics(period),
    enabled: options?.enabled !== false,
    queryFn: async () => {
      const res = await api.costs.getAnalytics({ period });
      if (!res.success) throw new Error(res.error ?? 'Failed to fetch cost data');
      // Backend returns { success, data: [...rows], totals, byDate, period }
      // authenticatedFetch spreads it, so res.data is the raw row array
      // and res.totals / res.byDate are at the top level (not nested under res.data)
      const rawRes = res as any;
      const rows: any[] = Array.isArray(rawRes.data) ? rawRes.data : [];
      return {
        costData: rows.map((item: any) => ({
          id: item.id as string,
          date: item.date as string,
          cost: ((item.cost_usd as number) || 0) * USD_TO_INR,
          // fall back to input+output when total_tokens was not stored
          tokens: (item.total_tokens as number) || ((item.input_tokens as number || 0) + (item.output_tokens as number || 0)),
          // request_count defaults to 1 per gateway insert but guard against 0
          requests: (item.request_count as number) || 1,
          agent_id: item.agent_id as string | undefined,
          model: ((item.metadata?.billed_model as string | undefined)
            || (item.model_name as string | undefined)),
        })) as CostData[],
        totals: rawRes.totals
          ? { ...rawRes.totals, totalCost: (rawRes.totals.totalCost || 0) * USD_TO_INR }
          : { totalCost: 0, totalTokens: 0, totalRequests: 0 },
      };
    },
    staleTime: 60_000, // 1 min stale time so new gateway requests appear quickly
  });

  return {
    costData: data?.costData ?? [],
    totals: data?.totals ?? { totalCost: 0, totalTokens: 0, totalRequests: 0 },
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
};

// ---------------------------------------------------------------------------
// Fine-tune jobs
// ---------------------------------------------------------------------------
export const useFineTuneJobs = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.fineTuneJobs,
    queryFn: async (): Promise<FineTuneJobRecord[]> => {
      const res = await api.fineTunes.listJobs();
      if (!res.success) throw new Error(res.error ?? 'Failed to fetch fine-tune jobs');
      return (res.data ?? []) as FineTuneJobRecord[];
    },
    staleTime: 30_000, // 30s — jobs change infrequently
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.fineTuneJobs });

  const createStagedJob = useMutation({
    mutationFn: (jobData: Parameters<typeof api.fineTunes.createStagedJob>[0]) =>
      api.fineTunes.createStagedJob(jobData),
    onSuccess: invalidate,
  });

  const deleteJob = useMutation({
    mutationFn: (id: string) => api.fineTunes.deleteJob(id),
    onSuccess: invalidate,
  });

  // After submitting to OpenAI, optimistically update cache without full refetch
  const markJobSubmitted = (localId: string, providerJobId: string) => {
    queryClient.setQueryData<FineTuneJobRecord[]>(queryKeys.fineTuneJobs, (old) =>
      (old ?? []).map((job) =>
        job.id === localId
          ? { ...job, provider_state: 'openai_submitted', provider_job_id: providerJobId, status: 'provider_queued' }
          : job,
      ),
    );
  };

  return {
    jobs: data ?? [],
    loading: isLoading,
    error: error ? (error as Error).message : null,
    refetch,
    createStagedJob,
    deleteJob,
    markJobSubmitted,
  };
};
