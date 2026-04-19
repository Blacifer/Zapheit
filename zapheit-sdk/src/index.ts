export interface ZapheitClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface RegisterAgentOptions {
  name: string;
  model: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletion {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

class AgentsClient {
  constructor(private readonly http: HttpClient) {}

  async register(options: RegisterAgentOptions): Promise<{ agentId: string }> {
    const body = await this.http.post<{ id: string }>('/agents', {
      name: options.name,
      model_name: options.model,
      platform: options.provider,
    });
    return { agentId: body.id };
  }
}

class ChatClient {
  constructor(private readonly http: HttpClient) {}

  async send(
    agentId: string,
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatCompletion> {
    const model = options.model ?? 'gpt-4o';
    return this.http.post<ChatCompletion>('/gateway/v1/chat/completions', {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      stream: false,
      zapheit_agent_id: agentId,
    });
  }
}

class EventsClient {
  constructor(private readonly http: HttpClient) {}

  emit(agentId: string, event: AgentEvent): void {
    void this.http.post('/agents/' + agentId + '/events', {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    }).catch(() => {
      // fire-and-forget — instrumentation failures are non-fatal
    });
  }
}

class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl.replace(/\/$/, '') + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ZapheitError(res.status, text);
    }

    return res.json() as Promise<T>;
  }
}

export class ZapheitError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ZapheitError';
  }
}

export class ZapheitClient {
  readonly agents: AgentsClient;
  readonly chat: ChatClient;
  readonly events: EventsClient;

  constructor(options: ZapheitClientOptions) {
    if (!options.apiKey) {
      throw new Error('ZapheitClient: apiKey is required');
    }
    const baseUrl = options.baseUrl ?? 'https://api.zapheit.com';
    const http = new HttpClient(baseUrl, options.apiKey);
    this.agents = new AgentsClient(http);
    this.chat = new ChatClient(http);
    this.events = new EventsClient(http);
  }
}
