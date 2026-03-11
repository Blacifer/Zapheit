import { createServiceClient } from '../_shared/supabase.ts';

type SlackOAuthResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  team?: { id: string; name: string };
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    refresh_token?: string;
  };
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return new Response(`Slack OAuth failed: ${oauthError}`, { status: 400 });
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  const service = createServiceClient();
  const { data: stateRow, error: stateError } = await service
    .from('integration_oauth_states')
    .select('*')
    .eq('state', state)
    .eq('provider_name', 'slack')
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (stateError || !stateRow) {
    return new Response('Invalid or expired OAuth state', { status: 400 });
  }

  const basicAuth = btoa(`${Deno.env.get('SLACK_CLIENT_ID')!}:${Deno.env.get('SLACK_CLIENT_SECRET')!}`);

  const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      redirect_uri: stateRow.redirect_uri,
    }),
  });

  const tokenPayload = (await tokenResponse.json()) as SlackOAuthResponse;

  if (!tokenResponse.ok || !tokenPayload.ok || !tokenPayload.access_token) {
    return new Response(JSON.stringify({ error: tokenPayload.error ?? 'Slack token exchange failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error: upsertError } = await service.rpc('upsert_oauth_integration_service', {
    p_organization_id: stateRow.organization_id,
    p_provider_name: 'slack',
    p_access_token: tokenPayload.access_token,
    p_refresh_token: tokenPayload.refresh_token ?? tokenPayload.authed_user?.refresh_token ?? null,
    p_webhook_secret: null,
    p_external_account_id: tokenPayload.team?.id ?? null,
    p_connection_metadata: {
      scopes: tokenPayload.scope ?? null,
      team: tokenPayload.team ?? null,
      authed_user: tokenPayload.authed_user
        ? {
            id: tokenPayload.authed_user.id,
            scope: tokenPayload.authed_user.scope ?? null,
          }
        : null,
      installed_via: 'slack_oauth_v2',
    },
  });

  if (upsertError) {
    return new Response(upsertError.message, { status: 500 });
  }

  await service
    .from('integration_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', stateRow.id);

  const appRedirect = `${Deno.env.get('APP_FRONTEND_URL')}/dashboard?integration=slack&status=connected`;
  return Response.redirect(appRedirect, 302);
});
