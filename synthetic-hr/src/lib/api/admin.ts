import { getAuthHeaders, normalizeErrorPayload, API_BASE_URL, authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

function safeParseJson(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

export const adminApi = {
  async getCoverageStatus(): Promise<ApiResponse<{
    generatedAt: string;
    organization: {
      id: string;
      name: string;
      slug: string;
      plan: string;
      createdAt: string;
    } | null;
    bootstrap: {
      organizationReady: boolean;
      currentUserProfileReady: boolean;
      operatorReady: boolean;
      pendingInvites: number;
    };
    users: {
      total: number;
      admins: number;
      operators: number;
    };
    agents: {
      total: number;
      active: number;
      paused: number;
      terminated: number;
    };
    apiKeys: {
      total: number;
      active: number;
      recentlyUsed30d: number;
      lastUsedAt: string | null;
    };
    telemetry: {
      gatewayObserved: boolean;
      coverageScore: number;
      status: 'healthy' | 'partial' | 'at_risk';
      lastTrackedAt: string | null;
      lastTrackedModel: string | null;
      lastTrackedEndpoint: string | null;
      costRecords30d: number;
      requests30d: number;
      tokens30d: number;
      spend30dUsd: number;
    };
    providerReconciliation: {
      configured: boolean;
      totalReportedSpendUsd: number | null;
      gapUsd: number | null;
      lastSyncedAt: string | null;
      providers: Array<{
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
        reportedSpendUsd: number;
        source: 'manual' | 'api';
        lastSyncedAt: string | null;
        notes: string | null;
        updatedAt: string;
      }>;
    };
    providerSync: {
      providers: Array<{
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
        enabled: boolean;
        organizationId: string | null;
        projectId: string | null;
        updatedAt: string;
        updatedBy: string | null;
        lastTestAt?: string | null;
        lastTestStatus?: 'ok' | 'failed' | null;
        lastTestMessage?: string | null;
        lastSyncAt?: string | null;
        lastSyncStatus?: 'ok' | 'failed' | null;
        lastSyncMessage?: string | null;
        credentialsAvailable: boolean;
        automatedSyncSupported: boolean;
      }>;
      history: Array<{
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
        ok: boolean;
        message: string;
        runAt: string;
        trigger: 'manual' | 'scheduler';
        importedSpendUsd?: number | null;
      }>;
      scheduler: {
        lastRunAt: string | null;
        lastRunFinishedAt: string | null;
        nextRunAt: string | null;
        running: boolean;
        lastTrigger: 'manual' | 'scheduler' | null;
        lastSummary: {
          organizations: number;
          attempted: number;
          okCount: number;
          failedCount: number;
        } | null;
      };
    };
    reconciliationAlerts: Array<{
      severity: 'info' | 'warning' | 'critical';
      code: string;
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
      title: string;
      message: string;
    }>;
    reconciliationAlertConfig: {
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
      updatedAt?: string;
      updatedBy?: string | null;
    };
    reconciliationNotifications: {
      history: Array<{
        id: string;
        code: string;
        provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other' | 'all';
        severity: 'warning' | 'critical';
        title: string;
        message: string;
        sentAt: string;
      }>;
    };
    incidents: {
      open: number;
      critical: number;
      lastIncidentAt: string | null;
    };
    notes: string[];
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/coverage-status`, {
        method: 'GET',
        headers,
      });

      const data = safeParseJson(await response.text());

      if (!response.ok) {
        return normalizeErrorPayload(response, data);
      }

      return {
        ...data,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load admin coverage status',
      };
    }
  },

  async updateProviderReconciliation(data: {
    provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
    reportedSpendUsd: number;
    source?: 'manual' | 'api';
    lastSyncedAt?: string;
    notes?: string | null;
  }): Promise<ApiResponse<{
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      reportedSpendUsd: number;
      source: 'manual' | 'api';
      lastSyncedAt: string | null;
      notes: string | null;
      updatedAt: string;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-reconciliation`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      const payload = safeParseJson(await response.text());

      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }

      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update provider reconciliation',
      };
    }
  },

  async deleteProviderReconciliation(provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other'): Promise<ApiResponse<{
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      reportedSpendUsd: number;
      source: 'manual' | 'api';
      lastSyncedAt: string | null;
      notes: string | null;
      updatedAt: string;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-reconciliation/${provider}`, {
        method: 'DELETE',
        headers,
      });

      const payload = safeParseJson(await response.text());

      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }

      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete provider reconciliation',
      };
    }
  },

  async updateProviderSyncConfig(data: {
    provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
    enabled: boolean;
    organizationId?: string | null;
    projectId?: string | null;
  }): Promise<ApiResponse<{
    providers: Array<{
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      enabled: boolean;
      organizationId: string | null;
      projectId: string | null;
      updatedAt: string;
      updatedBy: string | null;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update provider sync config',
      };
    }
  },

  async testOpenAIProviderSync(): Promise<ApiResponse<{
    provider: 'openai';
    lastTestAt: string;
    lastTestStatus: 'ok' | 'failed';
    lastTestMessage: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openai/test`, {
        method: 'POST',
        headers,
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test OpenAI provider sync',
      };
    }
  },

  async syncOpenAIProviderCosts(days = 30): Promise<ApiResponse<{
    provider: 'openai';
    importedSpendUsd: number;
    bucketCount: number;
    days: number;
    syncedAt: string;
    message: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openai/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync OpenAI provider costs',
      };
    }
  },

  async testAnthropicProviderSync(): Promise<ApiResponse<{
    provider: 'anthropic';
    lastTestAt: string;
    lastTestStatus: 'ok' | 'failed';
    lastTestMessage: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/anthropic/test`, {
        method: 'POST',
        headers,
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test Anthropic provider sync',
      };
    }
  },

  async syncAnthropicProviderCosts(days = 30): Promise<ApiResponse<{
    provider: 'anthropic';
    importedSpendUsd: number;
    bucketCount: number;
    days: number;
    syncedAt: string;
    message: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/anthropic/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync Anthropic provider costs',
      };
    }
  },

  async testOpenRouterProviderSync(): Promise<ApiResponse<{
    provider: 'openrouter';
    lastTestAt: string;
    lastTestStatus: 'ok' | 'failed';
    lastTestMessage: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openrouter/test`, {
        method: 'POST',
        headers,
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test OpenRouter provider sync',
      };
    }
  },

  async syncOpenRouterProviderCosts(days = 30): Promise<ApiResponse<{
    provider: 'openrouter';
    importedSpendUsd: number;
    bucketCount: number;
    days: number;
    syncedAt: string;
    message: string;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/openrouter/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync OpenRouter provider costs',
      };
    }
  },

  async runProviderSyncSweep(days = 30): Promise<ApiResponse<{
    organizations: number;
    attempted: number;
    okCount: number;
    failedCount: number;
    results: Array<{
      organizationId: string;
      provider: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'other';
      ok: boolean;
      message: string;
    }>;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/provider-sync/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days }),
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run provider sync sweep',
      };
    }
  },

  async updateReconciliationAlertConfig(data: {
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
  }): Promise<ApiResponse<{
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
    updatedAt?: string;
    updatedBy?: string | null;
  }>> {
    try {
      const headers = await getAuthHeaders();
      const adminBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${adminBaseUrl}/admin/reconciliation-alert-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      const payload = safeParseJson(await response.text());
      if (!response.ok) {
        return normalizeErrorPayload(response, payload);
      }
      return {
        ...payload,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update reconciliation alert config',
      };
    }
  },
};

/**
 * OpenAI-compatible gateway (API key auth, not JWT auth)
 */
export const gatewayApi = {
  async listModels(options: { apiKey: string }): Promise<ApiResponse<{ object: string; data: Array<{ id: string }> }>> {
    try {
      const gatewayBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${gatewayBaseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
      });

      const data = safeParseJson(await response.text());

      if (!response.ok) {
        return normalizeErrorPayload(response, data);
      }

      return {
        success: true,
        data,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load gateway models',
      };
    }
  },

  async chatCompletions(options: {
    apiKey: string;
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    agentId?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<ApiResponse<any>> {
    try {
      const gatewayBaseUrl = API_BASE_URL.replace(/\/api\/?$/, '');
      const response = await fetch(`${gatewayBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          ...(options.agentId ? { 'x-rasi-agent-id': options.agentId } : {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          stream: false,
          agent_id: options.agentId,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
      });

      const data = safeParseJson(await response.text());

      if (!response.ok) {
        return normalizeErrorPayload(response, data);
      }

      return {
        success: true,
        data,
        requestId: response.headers.get('x-request-id') || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Gateway request failed',
      };
    }
  },
};

/**
 * Batches API
 */
export interface BatchJob {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requests: number;
  succeeded: number;
  failed: number;
  progress: number;
  total_cost_usd: number;
  items: Array<{ prompt: string; model?: string }>;
  results: Array<{ prompt: string; response?: string; error?: string; costUSD: number; latency: number }>;
  created_at: string;
  completed_at: string | null;
}

export const batchesApi = {
  async processLine(prompt: string, model: string): Promise<ApiResponse<{
    latency: number;
    response: string;
    costUSD: number;
  }>> {
    const response = await authenticatedFetch<any>('/batches/process-line', {
      method: 'POST',
      body: JSON.stringify({ prompt, model }),
    });

    if (!response.success) {
      return response as ApiResponse<{ latency: number; response: string; costUSD: number }>;
    }

    const normalizedData = (response.data && 'data' in response.data)
      ? response.data.data
      : response.data;

    return { ...response, data: normalizedData };
  },

  async list(): Promise<ApiResponse<BatchJob[]>> {
    return authenticatedFetch<BatchJob[]>('/batches', { method: 'GET' });
  },

  async create(data: {
    name: string;
    description?: string;
    model: string;
    items: Array<{ prompt: string; model?: string }>;
  }): Promise<ApiResponse<BatchJob>> {
    return authenticatedFetch<BatchJob>('/batches', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, updates: Partial<{
    succeeded: number;
    failed: number;
    progress: number;
    total_cost_usd: number;
    results: BatchJob['results'];
    status: BatchJob['status'];
  }>): Promise<ApiResponse<BatchJob>> {
    return authenticatedFetch<BatchJob>(`/batches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch<{ id: string }>(`/batches/${id}`, { method: 'DELETE' });
  },
};

/**
 * Fine-tuning API
 */
export const fineTunesApi = {
  async createOpenAIJob(data: {
    name: string;
    baseModel: string;
    epochs: number;
    trainingRecords: Array<{ prompt: string; completion: string }>;
    validationRecords?: Array<{ prompt: string; completion: string }>;
    stagedJobId?: string;
  }): Promise<ApiResponse<{
    provider: 'openai';
    id: string;
    model: string;
    status: string;
    trainingFileId: string;
    validationFileId: string | null;
    trainedTokens: number | null;
  }>> {
    return authenticatedFetch('/fine-tunes/openai', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getOpenAIJobStatus(jobId: string): Promise<ApiResponse<{
    id: string;
    status: string;
    model: string;
    fineTunedModel: string | null;
    trainedTokens: number | null;
    estimatedFinish: number | null;
    finishedAt: number | null;
  }>> {
    return authenticatedFetch(`/fine-tunes/openai/${jobId}`, {
      method: 'GET',
    });
  },

  async listJobs(): Promise<ApiResponse<Array<{
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
  }>>> {
    return authenticatedFetch('/fine-tunes/jobs', { method: 'GET' });
  },

  async createStagedJob(data: {
    name: string;
    baseModel: string;
    epochs: number;
    fileName: string;
    examples: number;
    validationExamples: number;
    estimatedCostInr: number;
    readinessScore: number;
    issues: string[];
    status: string;
  }): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch('/fine-tunes/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteJob(id: string): Promise<ApiResponse<{ id: string }>> {
    return authenticatedFetch(`/fine-tunes/jobs/${id}`, { method: 'DELETE' });
  },
};

/**
 * Prompt caching API
 */
export const cachingApi = {
  async getState(): Promise<ApiResponse<{
    policy: {
      enabled: boolean;
      minContextTokens: number;
      retentionHours: number;
      cacheScope: 'organization' | 'agent';
      matchMode: 'exact' | 'normalized';
    };
    telemetry: {
      stats: {
        totalObservedRequests: number;
        eligibleRequests: number;
        observedHits: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
        hitRate: number;
        averageSavingsPercent: number;
        lastUpdatedAt: string | null;
      };
      entries: Array<{
        id: string;
        keyHash: string;
        keyPreview: string;
        modelName: string;
        endpoint: string;
        contextTokens: number;
        firstSeenAt: string;
        lastUsedAt: string;
        hits: number;
        requestsSeen: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
      }>;
    };
  }>> {
    return authenticatedFetch('/caching', {
      method: 'GET',
    });
  },

  async updatePolicy(data: {
    enabled?: boolean;
    minContextTokens?: number;
    retentionHours?: number;
    cacheScope?: 'organization' | 'agent';
    matchMode?: 'exact' | 'normalized';
  }): Promise<ApiResponse<{
    policy: {
      enabled: boolean;
      minContextTokens: number;
      retentionHours: number;
      cacheScope: 'organization' | 'agent';
      matchMode: 'exact' | 'normalized';
    };
    telemetry: {
      stats: {
        totalObservedRequests: number;
        eligibleRequests: number;
        observedHits: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
        hitRate: number;
        averageSavingsPercent: number;
        lastUpdatedAt: string | null;
      };
      entries: Array<{
        id: string;
        keyHash: string;
        keyPreview: string;
        modelName: string;
        endpoint: string;
        contextTokens: number;
        firstSeenAt: string;
        lastUsedAt: string;
        hits: number;
        requestsSeen: number;
        estimatedSavedTokens: number;
        estimatedSavedCostUsd: number;
      }>;
    };
  }>> {
    return authenticatedFetch('/caching/policy', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

/**
 * Pricing API
 */
export const pricingApi = {
  async getState(): Promise<ApiResponse<{
    config: {
      requestPriceInr: number;
      batchDiscount: number;
      gstRate: number;
      models: Array<{
        id: string;
        label: string;
        provider: string;
        category: string;
        tokenPriceInr: number;
      }>;
    };
    quotes: Array<{
      id: string;
      name: string;
      scenarioId: string;
      scenarioName: string;
      createdAt: string;
      totalInr: number;
      totalWithoutCachingInr: number;
      annualRunRateInr: number;
      gstMode: 'excluded' | 'included';
      monthlyRequests: number;
      avgInputTokens: number;
      avgOutputTokens: number;
      repeatableContext: number;
      batchShare: number;
      agentCount: number;
      cacheEnabled: boolean;
      mixRows: Array<{ modelId: string; allocation: number }>;
      shareUrl?: string;
    }>;
  }>> {
    return authenticatedFetch('/pricing', {
      method: 'GET',
    });
  },

  async saveQuote(data: {
    name: string;
    scenarioId: string;
    scenarioName: string;
    totalInr: number;
    totalWithoutCachingInr: number;
    annualRunRateInr: number;
    gstMode: 'excluded' | 'included';
    monthlyRequests: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    repeatableContext: number;
    batchShare: number;
    agentCount: number;
    cacheEnabled: boolean;
    mixRows: Array<{ modelId: string; allocation: number }>;
    shareUrl?: string;
  }): Promise<ApiResponse<{
    config: {
      requestPriceInr: number;
      batchDiscount: number;
      gstRate: number;
      models: Array<{
        id: string;
        label: string;
        provider: string;
        category: string;
        tokenPriceInr: number;
      }>;
    };
    quotes: Array<any>;
  }>> {
    return authenticatedFetch('/pricing/quotes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteQuote(id: string): Promise<ApiResponse<{
    config: {
      requestPriceInr: number;
      batchDiscount: number;
      gstRate: number;
      models: Array<{
        id: string;
        label: string;
        provider: string;
        category: string;
        tokenPriceInr: number;
      }>;
    };
    quotes: Array<any>;
  }>> {
    return authenticatedFetch(`/pricing/quotes/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Team management for multi-user collaboration
 */
export const teamApi = {
  /**
   * Send a team invitation
   */
  async sendInvite(options: {
    email: string;
    role: 'admin' | 'manager' | 'viewer';
    message?: string;
  }): Promise<ApiResponse<{
    data: {
      id: string;
      email: string;
      role: string;
      status: string;
      expires_at: string;
      created_at: string;
    };
    message: string;
  }>> {
    return authenticatedFetch('/invites', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  /**
   * List all invitations for the organization
   */
  async listInvites(status?: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled'): Promise<ApiResponse<{
    data: Array<{
      id: string;
      email: string;
      role: string;
      status: string;
      invited_by?: string;
      message?: string;
      expires_at: string;
      created_at: string;
    }>;
    count: number;
  }>> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return authenticatedFetch(`/invites${queryString}`, {
      method: 'GET',
    });
  },

  /**
   * Get a specific invitation
   */
  async getInvite(id: string): Promise<ApiResponse<{
    data: {
      id: string;
      email: string;
      role: string;
      status: string;
      created_at: string;
    };
  }>> {
    return authenticatedFetch(`/invites/${id}`, {
      method: 'GET',
    });
  },

  /**
   * Accept an invitation (public, no auth required)
   */
  async acceptInvite(token: string): Promise<ApiResponse<{
    message: string;
    data: {
      organization_id: string;
      role: string;
      email: string;
    };
  }>> {
    return authenticatedFetch('/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Claim an invitation (auth required; user may not be provisioned yet)
   */
  async claimInvite(token: string): Promise<ApiResponse<{
    message: string;
    data: {
      organization_id: string;
      role: string;
      email: string;
    };
  }>> {
    return authenticatedFetch('/invites/claim', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Reject an invitation
   */
  async rejectInvite(id: string, token: string): Promise<ApiResponse<{
    message: string;
  }>> {
    return authenticatedFetch(`/invites/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /**
   * Cancel/revoke an invitation
   */
  async cancelInvite(id: string): Promise<ApiResponse<{
    message: string;
  }>> {
    return authenticatedFetch(`/invites/${id}`, {
      method: 'DELETE',
    });
  },
};
