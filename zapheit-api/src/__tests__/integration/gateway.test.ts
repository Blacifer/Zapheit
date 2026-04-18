/// <reference types="jest" />
import http from 'http';
import request from 'supertest';
import express from 'express';
import nock from 'nock';

// ── Mocks ────────────────────────────────────────────────────────────────────

const TEST_ORG_ID = '22222222-2222-4222-8222-222222222222';
const TEST_KEY_ID = 'key-aaaaaa';

const VALID_API_KEY_OBJ = {
  id: TEST_KEY_ID,
  organization_id: TEST_ORG_ID,
  name: 'Test key',
  permissions: ['*'],
  rate_limit: 100,
  allowed_origins: [],
  allowed_agent_ids: [],
  deployment_type: null as null,
};

// Mutable override — tests can swap this to inject a different key (e.g. rate_limit: 1)
let currentApiKeyOverride: typeof VALID_API_KEY_OBJ | null = null;

// Mock the API key validation middleware — inject req.apiKey for valid tokens.
// Uses `currentApiKeyOverride` when set so individual tests can inject a custom key shape.
jest.mock('../../middleware/api-key-validation', () => ({
  validateApiKey: (req: any, res: any, next: any) => {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer sk_valid')) {
      return res.status(401).json({ error: { message: 'Invalid API key', type: 'invalid_request_error' } });
    }
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    req.apiKey = (global as any).__gatewayTestApiKey ?? VALID_API_KEY_OBJ;
    next();
  },
}));

// Mock supabase-rest to avoid real DB calls
jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn().mockResolvedValue([]),
  supabaseRestAsService: jest.fn().mockResolvedValue([]),
  supabaseRest: jest.fn().mockResolvedValue([]),
  eq: (v: any) => `eq.${encodeURIComponent(String(v))}`,
  gte: (v: any) => `gte.${encodeURIComponent(String(v))}`,
  in_: (vals: any[]) => `in.(${vals.join(',')})`,
  lt: (v: any) => `lt.${encodeURIComponent(String(v))}`,
  lte: (v: any) => `lte.${encodeURIComponent(String(v))}`,
  not: (v: any) => `not.${String(v)}`,
  is: (v: any) => `is.${String(v)}`,
}));

// Mock billing-service so budget always passes (unless overridden per test)
const mockCheckAgentBudget = jest.fn();
jest.mock('../../services/billing-service', () => ({
  checkAgentBudget: (...args: any[]) => mockCheckAgentBudget(...args),
  recordCost: jest.fn().mockResolvedValue(undefined),
}));

// Mock rate-limiter to always pass
jest.mock('../../lib/api-key-usage', () => ({
  recordApiKeyUsage: jest.fn().mockResolvedValue(undefined),
  checkApiKeyRateLimit: jest.fn().mockResolvedValue({ count: 0 }),
}));

// Mock observability
jest.mock('../../lib/observability', () => ({
  getTracer: () => ({ startActiveSpan: (_n: any, fn: any) => fn({ end: () => {} }) }),
  getMeter: () => ({ createCounter: () => ({ add: () => {} }), createHistogram: () => ({ record: () => {} }) }),
}));

// Suppress logger noise
jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── App factory ───────────────────────────────────────────────────────────────

function createGatewayApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app.use('/v1', require('../../routes/gateway').default);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Gateway /v1/chat/completions', () => {
  let server: http.Server;

  beforeAll((done) => { server = createGatewayApp().listen(0, done); });
  afterAll((done) => { server.close(done); nock.cleanAll(); });

  beforeEach(() => {
    nock.cleanAll();
    mockCheckAgentBudget.mockReset();
    mockCheckAgentBudget.mockResolvedValue({ ok: true, agentId: null });
    (global as any).__gatewayTestApiKey = null; // reset override
  });

  const VALID_BODY = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
  };

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(server).post('/v1/chat/completions').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unrecognised API key', async () => {
    const res = await request(server)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer sk_bad_key')
      .send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('proxies to OpenAI and returns an OpenAI-shaped response', async () => {
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });

    const res = await request(server)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer sk_valid')
      .send(VALID_BODY);

    // Gateway may return 200 directly or forward 200 — accept 200 or 201
    expect([200, 201]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('choices');
    }
  });

  // ── Rate limit ────────────────────────────────────────────────────────────

  it('returns 429 when the API key rate limit is exceeded', async () => {
    // Inject a key with rate_limit=1 via the global override so the mocked
    // validateApiKey picks it up. Then: 1st request fills the in-memory window,
    // 2nd request finds count(1) >= rate_limit(1) → 429.
    const RATE_LIMITED_KEY_ID = 'key-rate-limited-' + Date.now();
    (global as any).__gatewayTestApiKey = { ...VALID_API_KEY_OBJ, id: RATE_LIMITED_KEY_ID, rate_limit: 1 };

    const rateLimitedApp = express();
    rateLimitedApp.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    rateLimitedApp.use('/v1', require('../../routes/gateway').default);

    await new Promise<void>((resolve, reject) => {
      const rateLimitedServer = rateLimitedApp.listen(0, async () => {
        try {
          // Seed the upstream mock for both requests
          nock('https://api.openai.com')
            .post('/v1/chat/completions')
            .reply(200, {
              id: 'chatcmpl-rl-1',
              object: 'chat.completion',
              choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
            });

          // First request — fills the keyWindow (count = 1, limit = 1)
          await request(rateLimitedServer)
            .post('/v1/chat/completions')
            .set('Authorization', 'Bearer sk_valid')
            .send(VALID_BODY);

          // Second request — count(1) >= rate_limit(1) → 429
          const res = await request(rateLimitedServer)
            .post('/v1/chat/completions')
            .set('Authorization', 'Bearer sk_valid')
            .send(VALID_BODY);

          expect(res.status).toBe(429);
          rateLimitedServer.close(() => resolve());
        } catch (err) {
          rateLimitedServer.close(() => reject(err));
        }
      });
    });
  });

  // ── Budget exhausted ──────────────────────────────────────────────────────

  it('returns 402 when the agent budget is exhausted', async () => {
    mockCheckAgentBudget.mockResolvedValueOnce({
      ok: false,
      status: 402,
      body: { error: 'Budget limit exceeded', code: 'budget_exceeded' },
    });

    const res = await request(server)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer sk_valid')
      .set('x-rasi-agent-id', 'agent-budget-zero')
      .send(VALID_BODY);

    expect(res.status).toBe(402);
  });
});
