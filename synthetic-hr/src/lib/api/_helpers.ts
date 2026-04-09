import { getSupabaseClient } from '../supabase';
import { getFrontendConfig } from '../config';

export const API_BASE_URL = getFrontendConfig().apiUrl || 'http://localhost:3001/api';

const getProvisionUrl = () => {
  const normalized = API_BASE_URL.replace(/\/+$/, '');
  return normalized.endsWith('/api')
    ? `${normalized.slice(0, -4)}/auth/provision`
    : `${normalized}/auth/provision`;
};

/** One-shot provision guard: only attempt auto-provision once per page load. */
let _provisionAttempted = false;

export const isAnonymousEndpoint = (endpoint: string): boolean => {
  return endpoint === '/health' || endpoint === '/invites/accept' || /\/invites\/[^/]+\/reject$/.test(endpoint);
};

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: string[];
  requestId?: string;
}

export function normalizeErrorPayload(response: Response, payload: any): ApiResponse<never> {
  const requestId = response.headers.get('x-request-id') || undefined;

  const candidateErrors = [
    payload?.error,
    payload?.error?.message,
    payload?.error?.error,
    payload?.message,
    payload?.details,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0) as string[];

  return {
    success: false,
    error: candidateErrors[0] || `Request failed with status ${response.status}`,
    errors: Array.isArray(payload?.errors) ? payload.errors : undefined,
    requestId,
  };
}

/**
 * Get authenticated fetch headers
 */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const supabase = getSupabaseClient();
  if (!supabase) {
    return headers;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  return headers;
}

/**
 * Authenticated fetch wrapper
 */
export async function authenticatedFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const headers = await getAuthHeaders();
    const hasAuthorization = Boolean((headers as Record<string, string>).Authorization);

    if (!hasAuthorization && !isAnonymousEndpoint(endpoint)) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    const rawBody = await response.text();
    let data: any = {};

    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { message: rawBody };
      }
    }

    if (!response.ok) {
      // Auto-provision on 409 WORKSPACE_NOT_PROVISIONED — retry the request once after provisioning.
      if (response.status === 409 && data?.code === 'WORKSPACE_NOT_PROVISIONED' && !_provisionAttempted) {
        _provisionAttempted = true;
        try {
          const supabase = getSupabaseClient();
          const { data: sessionData } = await supabase!.auth.getSession();
          const session = sessionData?.session;
          if (session) {
            const email = session.user?.email || '';
            const domain = email.split('@')[1] || 'workspace';
            const domainName = domain.split('.')[0];
            const orgName = (session.user?.user_metadata as any)?.organization_name
              || (domainName.charAt(0).toUpperCase() + domainName.slice(1));
            const slug = domainName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
              || `workspace-${session.user.id.substring(0, 8)}`;

            const provisionRes = await fetch(getProvisionUrl(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({ name: orgName, orgName, slug }),
            });
            if (provisionRes.ok) {
              // Retry the original request now that the workspace exists.
              return authenticatedFetch<T>(endpoint, options);
            }
          }
        } catch {
          // Fall through to normal error handling
        }
      }
      return normalizeErrorPayload(response, data);
    }

    return {
      ...data,
      requestId: response.headers.get('x-request-id') || undefined,
    };
  } catch (error) {
    // AbortError is common during navigation/refresh/overlapping polls; don't spam console.
    const isAbortError = (err: unknown) => {
      if (!err) return false;
      const anyErr = err as any;
      if (anyErr?.name === 'AbortError') return true;
      const msg = typeof anyErr?.message === 'string' ? anyErr.message : '';
      return msg.toLowerCase().includes('aborterror') || msg.toLowerCase().includes('lock broken');
    };

    if (!isAbortError(error)) {
      console.error('API request failed:', error);
    }
    return {
      success: false,
      error: isAbortError(error)
        ? 'Request canceled'
        : error instanceof Error
          ? `${error.message} (API: ${API_BASE_URL})`
          : `Network request failed (API: ${API_BASE_URL})`,
    };
  }
}
