import { supabaseRestAsUser } from '../../lib/supabase-rest';

const mockOpenAIChat = jest.fn();
const mockAnthropicChat = jest.fn();

jest.mock('../../lib/supabase-rest', () => ({
  supabaseRestAsUser: jest.fn(),
  eq: (value: string | number) => `eq.${encodeURIComponent(String(value))}`,
}));

jest.mock('../../middleware/rbac', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../services/ai-service', () => ({
  OpenAIService: jest.fn().mockImplementation(() => ({
    chat: mockOpenAIChat,
  })),
  AnthropicService: jest.fn().mockImplementation(() => ({
    chat: mockAnthropicChat,
  })),
}));

jest.mock('../../lib/chat-instrumentation', () => ({
  fireChatInstrumentation: jest.fn().mockResolvedValue(undefined),
}));

import chatRouter from '../chat';

describe('Chat Routes - standard sessions', () => {
  let mockUserRest: jest.MockedFunction<typeof supabaseRestAsUser>;

  beforeEach(() => {
    mockUserRest = supabaseRestAsUser as jest.MockedFunction<typeof supabaseRestAsUser>;
    mockUserRest.mockReset();
    mockOpenAIChat.mockReset();
    mockAnthropicChat.mockReset();
  });

  async function invokeRoute(method: 'POST', url: string, body: Record<string, unknown>) {
    const req: any = {
      method,
      url,
      path: url,
      originalUrl: url,
      headers: { host: 'localhost:3001' },
      get(name: string) {
        return this.headers[name.toLowerCase()];
      },
      protocol: 'http',
      query: {},
      body,
      params: {},
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: '22222222-2222-4222-8222-222222222222',
        email: 'operator@zapheit.com',
        role: 'admin',
      },
      userJwt: 'mock-jwt',
    };

    let done = false;
    let payload: any = null;

    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(responseBody: any) {
        payload = responseBody;
        done = true;
        return this;
      },
      setHeader() {
        return undefined;
      },
    };

    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (done) return resolve();
        setTimeout(tick, 0);
      };
      (chatRouter as any).handle(req, res, (err: any) => (err ? reject(err) : resolve()));
      tick();
    });

    return { statusCode: res.statusCode, body: payload };
  }

  it('creates a standard chat session with runtime metadata', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string, _query?: any, options?: any) => {
      if (table === 'conversations' && options?.method === 'POST') {
        return [{
          id: 'conversation-standard-1',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: {
            session_type: 'standard_chat_session',
            runtime_source: 'managed',
            model: 'openai/gpt-4o-mini',
          },
        }] as any;
      }
      return [];
    });

    const res = await invokeRoute('POST', '/chat/sessions', {
      runtime_source: 'managed',
      model: 'openai/gpt-4o-mini',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session_id).toBe('conversation-standard-1');
    expect(res.body.data.session_type).toBe('standard_chat_session');
    expect(res.body.data.runtime_source).toBe('managed');
    expect(res.body.data.runtime_label).toBe('Zapheit Managed');
    expect(res.body.data.billing_mode).toBe('managed');
  });

  it('sends a managed standard chat message and returns usage metadata', async () => {
    mockOpenAIChat.mockResolvedValue({
      content: 'Here is the concise answer.',
      tokenCount: {
        input: 18,
        output: 24,
        total: 42,
      },
      costUSD: 0.0012,
    });

    mockUserRest.mockImplementation(async (_jwt: string, table: string, query?: any, options?: any) => {
      if (table === 'conversations' && !options) {
        return [{
          id: 'conversation-standard-1',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: {
            session_type: 'standard_chat_session',
            topic: 'Old topic',
          },
        }] as any;
      }

      if (table === 'messages' && !options) {
        return [
          {
            id: 'message-previous-1',
            role: 'assistant',
            content: 'Previous answer.',
            created_at: '2026-04-16T12:00:00.000Z',
          },
          {
            id: 'message-user-1',
            role: 'user',
            content: 'What changed this week?',
            created_at: '2026-04-16T12:01:00.000Z',
          },
        ] as any;
      }

      if (table === 'messages' && options?.method === 'POST') {
        if (options.body?.role === 'user') {
          return [{
            id: 'message-user-new',
            role: 'user',
            content: options.body.content,
            created_at: '2026-04-16T12:02:00.000Z',
          }] as any;
        }
        return [{
          id: 'message-assistant-new',
          role: 'assistant',
          content: options.body.content,
          token_count: options.body.token_count,
          metadata: options.body.metadata,
          created_at: '2026-04-16T12:02:05.000Z',
        }] as any;
      }

      if (table === 'conversations' && options?.method === 'PATCH') {
        return [{
          id: 'conversation-standard-1',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: options.body.metadata,
        }] as any;
      }

      if (table === 'conversations' && !options && String(query || '').includes('id=eq.conversation-standard-1')) {
        return [{
          id: 'conversation-standard-1',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: {
            session_type: 'standard_chat_session',
            topic: 'What changed this week?',
          },
        }] as any;
      }

      return [];
    });

    const res = await invokeRoute('POST', '/chat/sessions/conversation-standard-1/messages', {
      prompt: 'What changed this week?',
      runtime_source: 'managed',
      model: 'openai/gpt-4o-mini',
      mode: 'operator',
    });

    expect(mockOpenAIChat).toHaveBeenCalledWith(
      [
        { role: 'system', content: 'You are an AI assistant for an enterprise operator. Be concise and professional.' },
        { role: 'assistant', content: 'Previous answer.' },
        { role: 'user', content: 'What changed this week?' },
        { role: 'user', content: 'What changed this week?' },
      ],
      'gpt-4o-mini',
      { temperature: 0.7 },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session_type).toBe('standard_chat_session');
    expect(res.body.data.runtime_source).toBe('managed');
    expect(res.body.data.billing_mode).toBe('managed');
    expect(res.body.data.usage.total_tokens).toBe(42);
    expect(res.body.data.message.content).toBe('Here is the concise answer.');
    expect(res.body.data.conversation.messages).toHaveLength(2);
  });

  it('uses a saved backend runtime profile for provider-key chat', async () => {
    mockOpenAIChat.mockResolvedValue({
      content: 'Provider-backed reply.',
      tokenCount: {
        input: 11,
        output: 9,
        total: 20,
      },
      costUSD: 0.0008,
    });

    mockUserRest.mockImplementation(async (_jwt: string, table: string, query?: any, options?: any) => {
      if (table === 'chat_runtime_profiles') {
        return [{
          id: '55555555-5555-4555-8555-555555555555',
          organization_id: '22222222-2222-4222-8222-222222222222',
          kind: 'provider',
          provider: 'openai',
          label: 'Ops OpenAI',
          api_key_encrypted: 'sk-provider-1234',
          status: 'active',
        }] as any;
      }
      if (table === 'conversations' && !options) {
        return [{
          id: 'conversation-standard-2',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: {
            session_type: 'standard_chat_session',
            topic: 'Provider chat',
          },
        }] as any;
      }
      if (table === 'messages' && !options) {
        return [] as any;
      }
      if (table === 'messages' && options?.method === 'POST') {
        return [{
          id: options.body.role === 'user' ? 'provider-user-message' : 'provider-assistant-message',
          role: options.body.role,
          content: options.body.content,
          token_count: options.body.token_count || 0,
          metadata: options.body.metadata,
          created_at: '2026-04-16T12:12:00.000Z',
        }] as any;
      }
      if (table === 'conversations' && options?.method === 'PATCH') {
        return [{
          id: 'conversation-standard-2',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: options.body.metadata,
        }] as any;
      }
      return [];
    });

    const res = await invokeRoute('POST', '/chat/sessions/conversation-standard-2/messages', {
      prompt: 'Use the saved provider profile.',
      runtime_source: 'provider_key',
      runtime_profile_id: '55555555-5555-4555-8555-555555555555',
      model: 'openai/gpt-4o-mini',
      mode: 'operator',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runtime_profile_id).toBe('55555555-5555-4555-8555-555555555555');
    expect(res.body.data.runtime_label).toBe('Ops OpenAI');
    expect(res.body.data.billing_mode).toBe('byok_provider');
    expect(mockOpenAIChat).toHaveBeenCalled();
  });

  it('returns 409 when the session belongs to governed chat', async () => {
    mockUserRest.mockImplementation(async (_jwt: string, table: string, _query?: any, _options?: any) => {
      if (table === 'conversations') {
        return [{
          id: 'conversation-governed-1',
          organization_id: '22222222-2222-4222-8222-222222222222',
          status: 'active',
          metadata: {
            session_type: 'governed_chat_session',
          },
        }] as any;
      }
      return [];
    });

    const res = await invokeRoute('POST', '/chat/sessions/conversation-governed-1/messages', {
      prompt: 'Try standard send on the wrong session.',
      runtime_source: 'managed',
      model: 'openai/gpt-4o-mini',
      mode: 'operator',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not a standard chat session/i);
  });
});
