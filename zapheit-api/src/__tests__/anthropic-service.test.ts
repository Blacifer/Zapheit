import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { AnthropicService } from '../services/ai-service';

// Mock the SDK so no real HTTP is made; we control messages.create per test
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    _mockCreate: mockCreate,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _mockCreate: mockCreate } = require('@anthropic-ai/sdk') as { _mockCreate: jest.MockedFunction<() => Promise<any>> };

describe('AnthropicService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('does not throw when Anthropic returns empty content', async () => {
    mockCreate.mockResolvedValue({
      content: [],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 0 },
    });

    const service = new AnthropicService('test-key');
    const result = await service.chat(
      [
        { role: 'system', content: 'You are Zapheit.' },
        { role: 'user', content: 'Hello' },
      ],
      'claude-sonnet-4-6',
      { maxTokens: 16, temperature: 0.2 }
    );

    expect(result.content).toBe('');
    expect(result.tokenCount.output).toBe(0);
  });

  it('concatenates multiple text blocks', async () => {
    mockCreate.mockResolvedValue({
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
        { type: 'text', text: ' world' },
      ],
    });

    const service = new AnthropicService('test-key');
    const result = await service.chat(
      [
        { role: 'system', content: 'You are Zapheit.' },
        { role: 'user', content: 'Say hi' },
      ],
      'claude-sonnet-4-6'
    );

    expect(result.content).toBe('Hello world');
    expect(result.tokenCount.output).toBeGreaterThan(0);
  });
});
