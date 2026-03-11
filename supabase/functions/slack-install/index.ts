import { createAuthedClient, createServiceClient } from '../_shared/supabase.ts';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const organizationId = url.searchParams.get('organization_id');

  if (!organizationId) {
    return new Response('organization_id is required', { status: 400 });
  }

  const authClient = createAuthedClient(req.headers.get('Authorization'));
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const service = createServiceClient();
  const { data: orgUser, error: orgUserError } = await service
    .from('users')
    .select('id, organization_id')
    .eq('id', user.id)
    .eq('organization_id', organizationId)
    .single();

  if (orgUserError || !orgUser) {
    return new Response('Forbidden', { status: 403 });
  }

  const state = crypto.randomUUID();
  const redirectUri = `${Deno.env.get('SUPABASE_FUNCTIONS_BASE_URL')}/slack-oauth-callback`;

  const { error: stateError } = await service
    .from('integration_oauth_states')
    .insert({
      state,
      organization_id: organizationId,
      user_id: user.id,
      provider_name: 'slack',
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  if (stateError) {
    return new Response(stateError.message, { status: 500 });
  }

  const authorize = new URL(SLACK_AUTHORIZE_URL);
  authorize.searchParams.set('client_id', Deno.env.get('SLACK_CLIENT_ID')!);
  authorize.searchParams.set('scope', Deno.env.get('SLACK_BOT_SCOPES') ?? 'chat:write,channels:read,groups:read');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);

  return Response.redirect(authorize.toString(), 302);
});
