import crypto from 'crypto';
import { logger } from './logger';

type CashfreeEnvironment = 'sandbox' | 'production';

type CashfreeCustomerDetails = {
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

type CreateCashfreeOrderInput = {
  merchantOrderId: string;
  amount: number;
  currency: string;
  customer: CashfreeCustomerDetails;
  returnUrl?: string;
  notifyUrl?: string;
  note?: string;
};

export type CashfreeCreateOrderResult = {
  orderId: string;
  cfOrderId: string | null;
  paymentSessionId: string | null;
  orderStatus: string | null;
  raw: Record<string, any>;
};

export type CashfreeOrderStatusResult = {
  orderId: string;
  cfOrderId: string | null;
  orderStatus: string | null;
  paymentSessionId: string | null;
  raw: Record<string, any>;
};

export class CashfreeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashfreeConfigError';
  }
}

export class CashfreeApiError extends Error {
  status: number;
  responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Cashfree API error: ${status} ${responseBody}`);
    this.name = 'CashfreeApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

type CashfreeConfig = {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  environment: CashfreeEnvironment;
  apiBase: string;
};

function getEnvironment(): CashfreeEnvironment {
  const raw = (process.env.CASHFREE_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  return raw === 'production' ? 'production' : 'sandbox';
}

function getCashfreeConfig(): CashfreeConfig {
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new CashfreeConfigError('Cashfree credentials are not configured');
  }

  const environment = getEnvironment();
  return {
    clientId,
    clientSecret,
    apiVersion: process.env.CASHFREE_API_VERSION?.trim() || '2023-08-01',
    environment,
    apiBase: environment === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
  };
}

async function cashfreeRequest<T>(
  method: string,
  path: string,
  body?: Record<string, any>,
): Promise<T> {
  const config = getCashfreeConfig();
  const response = await fetch(`${config.apiBase}${path}`, {
    method,
    headers: {
      'x-client-id': config.clientId,
      'x-client-secret': config.clientSecret,
      'x-api-version': config.apiVersion,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let parsed: any = {};

  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    parsed = { raw: rawText };
  }

  if (!response.ok) {
    const message = parsed?.message || parsed?.error_description || parsed?.error_details || rawText || 'Unknown Cashfree error';
    throw new CashfreeApiError(response.status, message);
  }

  return parsed as T;
}

export function getCashfreeFrontendMode(): 'hosted' {
  return 'hosted';
}

export function getCashfreeEnvironment(): CashfreeEnvironment {
  return getEnvironment();
}

export function getCashfreeWebhookSigningSecret(): string {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET?.trim() || process.env.CASHFREE_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new CashfreeConfigError('Cashfree webhook signing secret is not configured');
  }
  return secret;
}

export function verifyCashfreeWebhookSignature(input: {
  rawBody: Buffer;
  timestamp: string;
  signature: string;
  secret: string;
}): boolean {
  const signedPayload = Buffer.concat([Buffer.from(input.timestamp, 'utf8'), input.rawBody]);
  const expectedSignature = crypto
    .createHmac('sha256', input.secret)
    .update(signedPayload)
    .digest('base64');

  if (!input.signature || expectedSignature.length !== input.signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(input.signature, 'utf8'),
  );
}

export async function createCashfreeOrder(input: CreateCashfreeOrderInput): Promise<CashfreeCreateOrderResult> {
  const payload: Record<string, any> = {
    order_id: input.merchantOrderId,
    order_amount: Number(input.amount.toFixed(2)),
    order_currency: input.currency,
    customer_details: {
      customer_id: input.customer.customerId,
      customer_name: input.customer.customerName,
      customer_email: input.customer.customerEmail,
      customer_phone: input.customer.customerPhone,
    },
  };

  if (input.note) {
    payload.order_note = input.note;
  }

  if (input.returnUrl || input.notifyUrl) {
    payload.order_meta = {
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
    };
  }

  const data = await cashfreeRequest<Record<string, any>>('POST', '/orders', payload);

  return {
    orderId: data.order_id || input.merchantOrderId,
    cfOrderId: data.cf_order_id || null,
    paymentSessionId: data.payment_session_id || null,
    orderStatus: typeof data.order_status === 'string' ? data.order_status : null,
    raw: data,
  };
}

export async function getCashfreeOrder(orderId: string): Promise<CashfreeOrderStatusResult> {
  const data = await cashfreeRequest<Record<string, any>>('GET', `/orders/${encodeURIComponent(orderId)}`);
  return {
    orderId: data.order_id || orderId,
    cfOrderId: data.cf_order_id || null,
    paymentSessionId: data.payment_session_id || null,
    orderStatus: typeof data.order_status === 'string' ? data.order_status : null,
    raw: data,
  };
}

export function mapCashfreeOrderStatus(status: string | null | undefined): 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' {
  const normalized = (status || '').trim().toUpperCase();

  if (normalized === 'PAID') return 'paid';
  if (normalized === 'EXPIRED') return 'expired';
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'cancelled';
  if (normalized === 'FAILED' || normalized === 'TERMINATED') return 'failed';
  if (normalized === 'ACTIVE' || normalized === 'PENDING') return 'pending';
  return 'created';
}

export function mapCashfreeWebhookPaymentStatus(status: string | null | undefined): 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' {
  const normalized = (status || '').trim().toUpperCase();

  if (normalized === 'SUCCESS' || normalized === 'PAID') return 'paid';
  if (normalized === 'FAILED' || normalized === 'USER_DROPPED') return 'failed';
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'cancelled';
  if (normalized === 'EXPIRED') return 'expired';
  if (normalized === 'PENDING' || normalized === 'ACTIVE' || normalized === 'NOT_ATTEMPTED') return 'pending';
  return 'created';
}

export function assertCashfreeConfigured(): void {
  try {
    getCashfreeConfig();
  } catch (error: any) {
    logger.warn('Cashfree configuration check failed', { error: error?.message || String(error) });
    throw error;
  }
}