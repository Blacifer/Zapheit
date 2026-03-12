import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type CreateFn = (params: any) => Promise<any>;
const createMock = jest.fn<CreateFn>();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: createMock,
      },
    })),
  };
});

import { AnthropicService } from '../services/ai-service';

describe('AnthropicService', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('does not throw when Anthropic returns empty content', async () => {
    createMock.mockResolvedValue({ content: [], model: 'claude-3-5-sonnet' });

    const service = new AnthropicService('test-key');
    const result = await service.chat(
      [
        { role: 'system', content: 'You are SyntheticHR.' },
        { role: 'user', content: 'Hello' },
      ],
      'claude-3-5-sonnet',
      { maxTokens: 16, temperature: 0.2 }
    );

    expect(result.content).toBe('');
    expect(result.tokenCount.output).toBe(0);
  });

  it('concatenates multiple text blocks', async () => {
    createMock.mockResolvedValue({
      model: 'claude-3-5-sonnet',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
        { type: 'text', text: ' world' },
      ],
    });

    const service = new AnthropicService('test-key');
    const result = await service.chat(
      [
        { role: 'system', content: 'You are SyntheticHR.' },
        { role: 'user', content: 'Say hi' },
      ],
      'claude-3-5-sonnet'
    );

    expect(result.content).toBe('Hello world');
    expect(result.tokenCount.output).toBeGreaterThan(0);
  });
});
