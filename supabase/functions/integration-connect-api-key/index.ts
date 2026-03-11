import { corsHeaders } from '../_shared/cors.ts';
import { createAuthedClient } from '../_shared/supabase.ts';

type Body = {
  organization_id: string;
  provider_name: string;
  api_key: string;
  webhook_secret?: string;
  connection_metadata?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createAuthedClient(req.headers.get('Authorization'));
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = (await req.json()) as Body;

  if (!body.organization_id || !body.provider_name || !body.api_key) {
    return new Response(JSON.stringify({ error: 'organization_id, provider_name, and api_key are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await supabase.rpc('create_api_key_integration', {
    p_organization_id: body.organization_id,
    p_provider_name: body.provider_name.toLowerCase(),
    p_api_key: body.api_key,
    p_webhook_secret: body.webhook_secret ?? null,
    p_connection_metadata: body.connection_metadata ?? {},
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, connection: data }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
