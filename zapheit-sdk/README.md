# @zapheit/sdk

Official TypeScript SDK for the [Zapheit](https://zapheit.com) AI Agent Governance Platform.

## Installation

```bash
npm install @zapheit/sdk
```

## Quickstart (10 minutes)

```typescript
import { ZapheitClient } from '@zapheit/sdk';

const zapheit = new ZapheitClient({
  apiKey: process.env.ZAPHEIT_API_KEY!,
  // baseUrl defaults to https://api.zapheit.com
});

// 1. Register your agent
const { agentId } = await zapheit.agents.register({
  name: 'Customer Support Bot',
  model: 'gpt-4o',
  provider: 'openai',
});

// 2. Send a governed chat completion
const completion = await zapheit.chat.send(agentId, [
  { role: 'user', content: 'What is your return policy?' },
]);

console.log(completion.choices[0].message.content);

// 3. Emit instrumentation events (fire-and-forget)
zapheit.events.emit(agentId, {
  type: 'tool_call',
  data: { tool: 'search_kb', query: 'return policy' },
});
```

Every `chat.send` call is automatically:
- **Policy-checked** against your configured action policies
- **Cost-tracked** in your Zapheit billing dashboard
- **Incident-scanned** for PII leaks, policy violations, and anomalies
- **Audit-logged** with full request/response traces

## API Reference

### `new ZapheitClient(options)`

| Option | Type | Required | Default |
|--------|------|----------|---------|
| `apiKey` | `string` | Yes | — |
| `baseUrl` | `string` | No | `https://api.zapheit.com` |

### `client.agents.register(options)`

Register a new AI agent with the governance platform.

```typescript
const { agentId } = await client.agents.register({
  name: 'My Agent',       // display name
  model: 'gpt-4o',        // model identifier
  provider: 'openai',     // 'openai' | 'anthropic' | 'openrouter'
});
```

Returns `{ agentId: string }`.

### `client.chat.send(agentId, messages, options?)`

Send a governed chat completion through the Zapheit gateway.

```typescript
const completion = await client.chat.send(agentId, messages, {
  model: 'gpt-4o',        // override model (optional)
  temperature: 0.7,
  max_tokens: 1024,
});
```

Returns an OpenAI-compatible `ChatCompletion` object.

### `client.events.emit(agentId, event)`

Fire-and-forget instrumentation event. Never throws.

```typescript
client.events.emit(agentId, {
  type: 'tool_call',
  data: { tool: 'search', query: '...' },
});
```

## Error Handling

```typescript
import { ZapheitClient, ZapheitError } from '@zapheit/sdk';

try {
  await client.chat.send(agentId, messages);
} catch (err) {
  if (err instanceof ZapheitError) {
    console.error(`API error ${err.status}: ${err.message}`);
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZAPHEIT_API_KEY` | Your Zapheit API key (from dashboard → Settings → API Keys) |

## License

MIT — see [LICENSE](https://github.com/Blacifer/Zapheit/blob/main/LICENSE).
