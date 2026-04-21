/**
 * No-code JS embed — one <script> tag intercepts fetch/XHR calls to AI
 * providers and reroutes them through the Zapheit gateway for governance.
 *
 * GET /embed/zapheit.js   — serves the embed script (public, cached)
 * POST /embed/proxy       — authenticated relay used by the embed script
 */
import express, { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { supabaseRest, eq } from '../lib/supabase-rest';
import { auditLog } from '../lib/audit-logger';

const router = express.Router();

// ── Embed script ──────────────────────────────────────────────────────────────

const EMBED_SCRIPT = `
(function(w, apiKey, gatewayUrl) {
  if (!apiKey) { console.warn('[Zapheit] apiKey is required'); return; }
  var OPENAI_PATTERN = /openai\\.com\\/v1\\/chat\\/completions/;
  var ANTHROPIC_PATTERN = /api\\.anthropic\\.com\\/v1\\/messages/;

  function isAiEndpoint(url) {
    return OPENAI_PATTERN.test(url) || ANTHROPIC_PATTERN.test(url);
  }

  function rewrite(url, body, headers) {
    var proxied = gatewayUrl + '/embed/proxy';
    var newHeaders = Object.assign({}, headers, {
      'x-zapheit-api-key': apiKey,
      'x-zapheit-origin-url': url,
    });
    return { url: proxied, body: body, headers: newHeaders };
  }

  // Intercept fetch
  var origFetch = w.fetch.bind(w);
  w.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (!isAiEndpoint(url)) return origFetch(input, init);
    var r = rewrite(url, init && init.body, (init && init.headers) || {});
    var newInit = Object.assign({}, init, { headers: r.headers, body: r.body });
    return origFetch(r.url, newInit);
  };

  // Intercept XHR
  var OrigXHR = w.XMLHttpRequest;
  w.XMLHttpRequest = function() {
    var xhr = new OrigXHR();
    var origOpen = xhr.open.bind(xhr);
    var capturedUrl = '';
    xhr.open = function(method, url) {
      capturedUrl = url;
      if (isAiEndpoint(url)) {
        origOpen(method, gatewayUrl + '/embed/proxy');
        xhr.setRequestHeader('x-zapheit-api-key', apiKey);
        xhr.setRequestHeader('x-zapheit-origin-url', capturedUrl);
      } else {
        origOpen.apply(this, arguments);
      }
    };
    return xhr;
  };

  console.info('[Zapheit] Embed active — AI traffic governed');
})(window, '{{API_KEY}}', '{{GATEWAY_URL}}');
`.trim();

router.get('/embed/zapheit.js', (req: Request, res: Response) => {
  const apiKey = (req.query.api_key as string) || '{{API_KEY}}';
  const gatewayUrl = process.env.API_BASE_URL || 'https://api.zapheit.com';
  const script = EMBED_SCRIPT
    .replace(/\{\{API_KEY\}\}/g, apiKey.replace(/'/g, "\\'"))
    .replace(/\{\{GATEWAY_URL\}\}/g, gatewayUrl);

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(script);
});

// ── Proxy endpoint — relay embed traffic through gateway ──────────────────────

router.post('/embed/proxy', async (req: Request, res: Response) => {
  const apiKey = req.get('x-zapheit-api-key');
  const originUrl = req.get('x-zapheit-origin-url') || '';

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-zapheit-api-key header' });
  }

  // Validate API key
  const keyRows = await supabaseRest('api_keys', `key_hash=eq.${apiKey}&select=organization_id,name&limit=1`, { method: 'GET' }).catch(() => null) as any[];
  const keyRow = keyRows?.[0];
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const orgId = keyRow.organization_id;
  const body = req.body;

  // Determine upstream
  let upstream: string;
  if (originUrl.includes('anthropic.com')) {
    upstream = 'https://api.anthropic.com/v1/messages';
  } else {
    upstream = 'https://api.openai.com/v1/chat/completions';
  }

  const providerKey = originUrl.includes('anthropic.com')
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;

  if (!providerKey) {
    return res.status(503).json({ error: 'Provider not configured for embed proxy' });
  }

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerKey}`,
        ...(originUrl.includes('anthropic.com') ? { 'anthropic-version': '2023-06-01' } : {}),
      },
      body: JSON.stringify(body),
    });

    const responseBody = await upstreamRes.text();

    // Fire-and-forget audit log
    void auditLog.log({
      user_id: '',
      action: 'embed.proxy.request',
      resource_type: 'embed_proxy',
      resource_id: originUrl,
      organization_id: orgId,
      metadata: { origin_url: originUrl, status: upstreamRes.status },
    }).catch(() => {});

    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.send(responseBody);
  } catch (err: any) {
    logger.error('embed proxy upstream failed', { error: err?.message, orgId, originUrl });
    return res.status(502).json({ error: 'Upstream request failed' });
  }
});

export default router;
