// Restrict CORS to the configured frontend origin.
// Set FRONTEND_URL in Supabase project secrets (Dashboard → Settings → Edge Functions → Secrets).
// Falls back to '*' only when FRONTEND_URL is not set so local development still works.
const allowedOrigin = Deno.env.get('FRONTEND_URL') || '*';

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Returns CORS headers that validate the incoming request origin.
 * Use this instead of the static `corsHeaders` export for stricter enforcement.
 */
export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  if (allowedOrigin === '*') {
    return { ...corsHeaders };
  }
  const origin = requestOrigin && requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
