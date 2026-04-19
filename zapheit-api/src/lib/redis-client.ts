/**
 * Shared lazy Redis client factory.
 *
 * - getRedisClient()         — singleton for commands (SET, GET, PUBLISH, etc.)
 * - createRedisSubscriber()  — always a new connection (ioredis requires a
 *                              dedicated connection while in subscribe mode)
 *
 * Both return null when REDIS_URL is not set, letting callers fall back to
 * in-memory behaviour without crashing.
 */

import logger from './logger';

let sharedClient: any = null;
let sharedClientReady = false;

async function makeClient(url: string, label: string): Promise<any> {
  const { default: Redis } = await import('ioredis');
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on('connect', () => logger.info(`redis-client: ${label} connected`));
  client.on('error', (err: Error) =>
    logger.warn(`redis-client: ${label} error`, { err: err.message }),
  );

  await client.connect();
  return client;
}

export async function getRedisClient(): Promise<any | null> {
  if (sharedClient) return sharedClient;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    sharedClient = await makeClient(url, 'publisher');
    sharedClient.on('connect', () => { sharedClientReady = true; });
    sharedClient.on('error', () => { sharedClientReady = false; });
    sharedClientReady = true;
    return sharedClient;
  } catch (err: any) {
    logger.warn('redis-client: unavailable — in-memory fallback active', { err: err?.message });
    return null;
  }
}

export async function createRedisSubscriber(): Promise<any | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    return await makeClient(url, 'subscriber');
  } catch (err: any) {
    logger.warn('redis-client: subscriber unavailable', { err: err?.message });
    return null;
  }
}

export function isRedisReady(): boolean {
  return sharedClientReady;
}

// Warm up on startup if configured
if (process.env.REDIS_URL) {
  getRedisClient().catch(() => null);
}
