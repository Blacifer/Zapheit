import crypto from 'crypto';
import { fetchWithTimeout } from './timeouts';
import { retryWithBackoff } from './retry';
import { eq, supabaseRest } from './supabase-rest';
import { logger } from './logger';

export type WebhookEventId =
  | 'usage.updated'
  | 'cost.alert'
  | 'reconciliation.alert'
  | 'error.occurred'
  | 'rate_limit.exceeded'
  | 'model.deprecated';

type StoredWebhook = {
  id: string;
  url: string;
  events: WebhookEventId[];
  secret: string;
  status: 'not_tested' | 'healthy' | 'failing' | 'disabled';
  createdAt: string;
  updatedAt: string;
  lastTestedAt?: string;
  lastDeliveryAt?: string;
  successCount: number;
  failureCount: number;
};

type StoredWebhookLog = {
  id: string;
  webhookId: string;
  event: WebhookEventId;
  endpoint: string;
  attemptedAt: string;
  status: 'delivered' | 'failed';
  responseCode?: number;
  latencyMs?: number;
  note: string;
};

const WEBHOOK_SETTINGS_KEY = 'rasi_webhooks';
const WEBHOOK_LOGS_KEY = 'rasi_webhook_logs';
const MAX_LOGS = 100;

async function getOrgRecord(orgId: string) {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  const orgs = (await supabaseRest('organizations', query)) as any[];
  return orgs?.[0] || null;
}

async function persistOrgSettings(orgId: string, settings: Record<string, any>) {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  await supabaseRest('organizations', query, {
    method: 'PATCH',
    body: {
      settings,
      updated_at: new Date().toISOString(),
    },
  });
}

async function readWebhookState(orgId: string) {
  const org = await getOrgRecord(orgId);
  const settings = org?.settings || {};
  return {
    settings,
    webhooks: (settings[WEBHOOK_SETTINGS_KEY] || []) as StoredWebhook[],
    logs: (settings[WEBHOOK_LOGS_KEY] || []) as StoredWebhookLog[],
  };
}

export async function getWebhookRelaySettings(orgId: string): Promise<Record<string, any>> {
  const org = await getOrgRecord(orgId);
  return org?.settings || {};
}

export async function dispatchWebhookEvent(
  orgId: string,
  event: WebhookEventId,
  payload: Record<string, any>,
): Promise<void> {
  const { settings, webhooks, logs } = await readWebhookState(orgId);
  const subscribed = webhooks.filter((webhook) => webhook.status !== 'disabled' && webhook.events.includes(event));
  if (subscribed.length === 0) {
    return;
  }

  const nextLogs: StoredWebhookLog[] = [...logs];
  const nextWebhooks = [...webhooks];

  await Promise.all(subscribed.map(async (webhook) => {
    const attemptedAt = new Date().toISOString();
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const deliveryId = `dlv_${crypto.randomUUID()}`;
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    const startedAt = Date.now();
    const result = await retryWithBackoff(
      async () => {
        const response = await fetchWithTimeout(
          webhook.url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'RasiSyntheticHR-WebhookRelay/1.0',
              'X-Rasi-Event': event,
              'X-Rasi-Delivery-Id': deliveryId,
              'X-Rasi-Timestamp': timestamp,
              'X-Rasi-Signature': `sha256=${signature}`,
            },
            body,
          },
          { timeoutMs: 10000, retries: 0 },
        );

        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(`Endpoint responded ${response.status}: ${responseText || response.statusText}`);
        }

        return { responseCode: response.status };
      },
      { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2000 },
      { org_id: orgId, webhook_id: webhook.id, event },
    );

    const latencyMs = Date.now() - startedAt;
    nextLogs.unshift({
      id: deliveryId,
      webhookId: webhook.id,
      event,
      endpoint: webhook.url,
      attemptedAt,
      status: result.success ? 'delivered' : 'failed',
      responseCode: result.data?.responseCode,
      latencyMs,
      note: result.success ? 'Delivered from live event relay.' : (result.error?.message || 'Delivery failed'),
    });

    const index = nextWebhooks.findIndex((item) => item.id === webhook.id);
    if (index >= 0) {
      nextWebhooks[index] = {
        ...nextWebhooks[index],
        status: result.success ? 'healthy' : 'failing',
        updatedAt: attemptedAt,
        lastDeliveryAt: attemptedAt,
        successCount: nextWebhooks[index].successCount + (result.success ? 1 : 0),
        failureCount: nextWebhooks[index].failureCount + (result.success ? 0 : 1),
      };
    }
  }));

  await persistOrgSettings(orgId, {
    ...settings,
    [WEBHOOK_SETTINGS_KEY]: nextWebhooks,
    [WEBHOOK_LOGS_KEY]: nextLogs.slice(0, MAX_LOGS),
  });
}

export function fireAndForgetWebhookEvent(
  orgId: string,
  event: WebhookEventId,
  payload: Record<string, any>,
): void {
  void dispatchWebhookEvent(orgId, event, payload).catch((error: any) => {
    logger.error('Webhook event dispatch failed', {
      org_id: orgId,
      event,
      error: error?.message || 'Unknown error',
    });
  });
}
