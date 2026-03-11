/**
 * Supabase REST API helper utilities
 */

export class SupabaseRestError extends Error {
  status: number;
  responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Supabase REST API error: ${status} ${responseBody}`);
    this.name = 'SupabaseRestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Helper function to make REST API calls to Supabase
 * Exposes two explicit clients:
 * - supabaseRestAsUser: uses anon key + user JWT (RLS enforced)
 * - supabaseRestAsService: uses service role key (bypasses RLS; use sparingly)
 */

type RestOptions = { method?: string; body?: any; headers?: Record<string, string> };

async function supabaseRestInternal(
  auth: { apikey: string; authorization: string },
  table: string,
  query: string | URLSearchParams = '',
  options: RestOptions = {}
): Promise<any> {
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!supabaseUrl || !auth.apikey || !auth.authorization) {
    throw new Error('Missing required Supabase environment variables for REST client');
  }
  
  const queryString = query instanceof URLSearchParams ? query.toString() : query;
  const url = queryString
    ? `${supabaseUrl}/rest/v1/${table}?${queryString}`
    : `${supabaseUrl}/rest/v1/${table}`;
  
  const requestOptions: RequestInit = {
    method: options.method || 'GET',
    headers: {
      'apikey': auth.apikey,
      'Authorization': auth.authorization,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers,
    },
  };

  if (options.body) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, requestOptions);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new SupabaseRestError(response.status, errorText);
  }

  // Handle empty responses (e.g., from DELETE)
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const supabaseRestAsUser = async (
  userJwt: string,
  table: string,
  query: string | URLSearchParams = '',
  options: RestOptions = {}
): Promise<any> => {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is required for user-scoped Supabase REST calls');
  }
  return supabaseRestInternal(
    { apikey: anonKey, authorization: `Bearer ${userJwt}` },
    table,
    query,
    options
  );
};

export const supabaseRestAsService = async (
  table: string,
  query: string | URLSearchParams = '',
  options: RestOptions = {}
): Promise<any> => {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_KEY is required for service-role Supabase REST calls');
  }
  return supabaseRestInternal(
    { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    table,
    query,
    options
  );
};

/**
 * Deprecated alias. Treat as service-role access.
 * Prefer supabaseRestAsUser() for all authenticated /api requests.
 */
export const supabaseRest = supabaseRestAsService;

/**
 * URL encoding helpers for Supabase PostgREST filters
 */
export const eq = (value: string | number) => `eq.${encodeURIComponent(String(value))}`;
export const gte = (value: string | number) => `gte.${encodeURIComponent(String(value))}`;
export const lte = (value: string | number) => `lte.${encodeURIComponent(String(value))}`;
export const gt = (value: string | number) => `gt.${encodeURIComponent(String(value))}`;
export const lt = (value: string | number) => `lt.${encodeURIComponent(String(value))}`;
export const like = (value: string) => `like.${encodeURIComponent(value)}`;
export const ilike = (value: string) => `ilike.${encodeURIComponent(value)}`;
export const in_ = (values: Array<string | number>) => `in.(${values.map(v => encodeURIComponent(String(v))).join(',')})`;
