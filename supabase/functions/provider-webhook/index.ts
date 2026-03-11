import { createServiceClient } from '../_shared/supabase.ts';

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function signHmacSHA256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return hex(signature);
}

async function verifyProviderSignature(provider: string, req: Request, rawBody: string, secret: string): Promise<boolean> {
  if (provider.toLowerCase() === 'slack') {
    const timestamp = req.headers.get('x-slack-request-timestamp');
    const provided = req.headers.get('x-slack-signature');
    if (!timestamp || !provided) return false;

    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (ageSeconds > 60 * 5) return false;

    const base = `v0:${timestamp}:${rawBody}`;
    const expected = `v0=${await signHmacSHA256(secret, base)}`;
    return constantTimeEqual(expected, provided);
  }

  const provided = req.headers.get('x-signature') ?? req.headers.get('x-hub-signature-256') ?? '';
  if (!provided) return false;

  const expectedRaw = await signHmacSHA256(secret, rawBody);
  const expected = provided.startsWith('sha256=') ? `sha256=${expectedRaw}` : expectedRaw;
  return constantTimeEqual(expected, provided);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const connectionId = url.searchParams.get('connection_id');

  if (!connectionId) {
    return new Response('connection_id is required', { status: 400 });
  }

  const rawBody = await req.text();
  const service = createServiceClient();

  const { data: connection, error: connectionError } = await service
    .from('integration_connections')
    .select('id, organization_id, provider_name, webhook_secret_name, is_active')
    .eq('id', connectionId)
    .single();

  if (connectionError || !connection || !connection.is_active || !connection.webhook_secret_name) {
    return new Response('Webhook connection not found or inactive', { status: 404 });
  }

  const { data: secretRows, error: secretError } = await service
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', connection.webhook_secret_name)
    .limit(1);

  const webhookSecret = secretRows?.[0]?.decrypted_secret;

  if (secretError || !webhookSecret) {
    return new Response('Webhook secret missing', { status: 500 });
  }

  const verified = await verifyProviderSignature(connection.provider_name, req, rawBody, webhookSecret);

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  await service.from('integration_webhook_events').insert({
    connection_id: connection.id,
    organization_id: connection.organization_id,
    provider_name: connection.provider_name,
    signature_verified: verified,
    request_headers: Object.fromEntries(req.headers.entries()),
    payload,
    raw_body: rawBody,
  });

  if (!verified) {
    return new Response('Invalid signature', { status: 401 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
