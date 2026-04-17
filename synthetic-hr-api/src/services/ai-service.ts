import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { checkCircuitBreaker, recordSuccess, recordFailure } from '../lib/circuit-breaker';

// Sentinel org ID used for system-level (provider) circuit breakers.
// Not tied to any real organization — purely for provider health tracking.
const SYSTEM_ORG = 'system';

// OpenAI Pricing (per 1M tokens)
export const OPENAI_PRICING = {
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
};

// Anthropic Pricing (per 1M tokens)
export const ANTHROPIC_PRICING = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-sonnet-4-0': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
};

export interface AIResponse {
  content: string;
  tokenCount: {
    input: number;
    output: number;
    total: number;
  };
  costUSD: number;
  model: string;
  latency: number;
  /** Populated when the model wants to call a connector tool */
  toolCalls?: ToolCall[];
}

/** Normalized tool call (OpenAI format — used by both providers) */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-encoded arguments string */
    arguments: string;
  };
}

/** OpenAI function-calling tool schema */
export interface ConnectorTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

export interface AIConfig {
  apiKey: string;
  model: string;
  platform: 'openai' | 'anthropic';
}

interface AIChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ConnectorTool[];
}

// OpenAI Service
export class OpenAIService {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(
    messages: { role: string; content: any }[],
    model: string = 'gpt-4o',
    options: AIChatOptions = {}
  ): Promise<AIResponse> {
    const startTime = Date.now();

    const circuitState = await checkCircuitBreaker(SYSTEM_ORG, 'openai');
    if (circuitState === 'open') {
      const err: any = new Error('OpenAI circuit breaker is open — provider temporarily unavailable');
      err.status = 503;
      err.code = 'CIRCUIT_OPEN';
      throw err;
    }

    let response: Awaited<ReturnType<typeof this.client.chat.completions.create>>;
    try {
      response = await this.client.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        temperature: options.temperature ?? 0.7,
        ...(typeof options.maxTokens === 'number' ? { max_tokens: options.maxTokens } : {}),
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools as any, tool_choice: 'auto' } : {}),
      });
    } catch (err) {
      void recordFailure(SYSTEM_ORG, 'openai');
      throw err;
    }

    void recordSuccess(SYSTEM_ORG, 'openai');
    const latency = Date.now() - startTime;
    const completion = response.choices[0].message;

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;

    // Calculate cost
    const pricing = OPENAI_PRICING[model as keyof typeof OPENAI_PRICING] || OPENAI_PRICING['gpt-4o'];
    const costUSD = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000000;

    const toolCalls: ToolCall[] = (completion.tool_calls || []).map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      content: completion.content || '',
      tokenCount: { input: inputTokens, output: outputTokens, total: totalTokens },
      costUSD,
      model: response.model,
      latency,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

// Anthropic Service
export class AnthropicService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    });
  }

  private static extractTextBlocks(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  /** Translate OpenAI tool schema → Anthropic format */
  private static toAnthropicTools(tools: ConnectorTool[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool['input_schema'],
    }));
  }

  /** Translate Anthropic tool_use content blocks → OpenAI ToolCall format */
  private static extractToolCalls(content: Anthropic.ContentBlock[]): ToolCall[] {
    return content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        type: 'function' as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));
  }

  /**
   * Translate messages for Anthropic — handles tool_calls (assistant) and
   * tool results (role: 'tool') that come from the gateway continuation loop.
   */
  private static toAnthropicMessages(messages: { role: string; content: any }[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        // Tool result — must be appended as user content block
        const last = out[out.length - 1];
        const block: Anthropic.ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: (m as any).tool_call_id,
          content: String(m.content),
        };
        if (last?.role === 'user' && Array.isArray(last.content)) {
          (last.content as any[]).push(block);
        } else {
          out.push({ role: 'user', content: [block] });
        }
        continue;
      }

      if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
        // Assistant asking for tool calls
        out.push({
          role: 'assistant',
          content: (m as any).tool_calls.map((tc: ToolCall) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.function.name,
            input: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
          })),
        });
        continue;
      }

      out.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }
    return out;
  }

  async chat(
    messages: { role: string; content: any }[],
    model: string = 'claude-sonnet-4-6',
    options: AIChatOptions = {}
  ): Promise<AIResponse> {
    const startTime = Date.now();

    const anthropicMessages = AnthropicService.toAnthropicMessages(messages);
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
    const anthropicTools = options.tools && options.tools.length > 0
      ? AnthropicService.toAnthropicTools(options.tools)
      : undefined;

    const circuitState = await checkCircuitBreaker(SYSTEM_ORG, 'anthropic');
    if (circuitState === 'open') {
      const err: any = new Error('Anthropic circuit breaker is open — provider temporarily unavailable');
      err.status = 503;
      err.code = 'CIRCUIT_OPEN';
      throw err;
    }

    let data: Anthropic.Message;
    try {
      data = await this.client.messages.create({
        model,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: anthropicMessages,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        ...(anthropicTools ? { tools: anthropicTools } : {}),
      });
    } catch (err) {
      void recordFailure(SYSTEM_ORG, 'anthropic');
      throw err;
    }

    void recordSuccess(SYSTEM_ORG, 'anthropic');
    const latency = Date.now() - startTime;

    const outputText = AnthropicService.extractTextBlocks(data.content);
    const toolCalls = AnthropicService.extractToolCalls(data.content);

    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    const totalTokens = inputTokens + outputTokens;

    const pricing = ANTHROPIC_PRICING[model as keyof typeof ANTHROPIC_PRICING] || ANTHROPIC_PRICING['claude-sonnet-4-6'];
    const costUSD = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000000;

    return {
      content: outputText,
      tokenCount: { input: inputTokens, output: outputTokens, total: totalTokens },
      costUSD,
      model: data.model,
      latency,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

// Cost Calculator Utility
export function calculateTokenCost(
  platform: 'openai' | 'anthropic',
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  let pricing: { input: number; output: number };

  if (platform === 'openai') {
    pricing = OPENAI_PRICING[model as keyof typeof OPENAI_PRICING] || OPENAI_PRICING['gpt-4o'];
  } else {
    pricing = ANTHROPIC_PRICING[model as keyof typeof ANTHROPIC_PRICING] || ANTHROPIC_PRICING['claude-sonnet-4-6'];
  }

  return ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000000;
}
