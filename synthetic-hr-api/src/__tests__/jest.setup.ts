/**
 * Jest runtime sandbox can block binding to 0.0.0.0. Supertest starts an ephemeral
 * server via `server.listen(0)` which defaults to 0.0.0.0.
 *
 * Force localhost binding for all tests to avoid EPERM on listen.
 */

// Provide dummy Supabase env vars so supabase.ts doesn't throw at module load time
// during integration tests. Real values are never used — all DB calls are mocked.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-openai-key';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-anthropic-key';
process.env.INTEGRATIONS_ENCRYPTION_KEY = process.env.INTEGRATIONS_ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000';

import net from 'net';

const originalListen = net.Server.prototype.listen;

function isFunction(value: unknown): value is (...args: any[]) => any {
  return typeof value === 'function';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
net.Server.prototype.listen = function patchedListen(...args: any[]) {
  // Handle `server.listen({ port })` style
  if (args.length >= 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const options = { ...args[0] };
    if (options.port != null && (options.host == null || options.host === '')) {
      options.host = '127.0.0.1';
    }
    return (originalListen as any).apply(this, [options, ...args.slice(1)]);
  }

  // Handle `server.listen(port, [hostname], [backlog], [callback])`
  if (typeof args[0] === 'number') {
    const port = args[0];
    const hostname = args[1];

    // If hostname missing (or callback is in its place), inject localhost.
    if (hostname == null || isFunction(hostname)) {
      const rest = args.slice(1);
      return (originalListen as any).apply(this, [port, '127.0.0.1', ...rest]);
    }
  }

  return originalListen.apply(this, args as any);
};
