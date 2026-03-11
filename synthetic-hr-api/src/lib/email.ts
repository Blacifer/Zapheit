import { logger } from './logger';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

const DEFAULT_PROVIDER = 'resend';

function getProvider(): string {
  return process.env.EMAIL_PROVIDER || DEFAULT_PROVIDER;
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM || 'no-reply@synthetic-hr.local';
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<void> {
  const provider = getProvider();

  if (provider === 'resend') {
    await sendViaResend(input);
    return;
  }

  if (provider === 'webhook') {
    await sendViaWebhook(input);
    return;
  }

  throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);
}

async function sendViaResend(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.error('Resend API key not configured');
    throw new Error('RESEND_API_KEY is not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Resend API error', {
      status: response.status,
      statusText: response.statusText,
      body: body.substring(0, 200),
      to: input.to,
      subject: input.subject,
    });
    throw new Error(`Email delivery failed: ${response.status} ${response.statusText}`);
  }

  logger.info('Email delivered via Resend', { to: input.to, subject: input.subject });
}

async function sendViaWebhook(input: SendEmailInput): Promise<void> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.error('Email webhook not configured', { to: input.to });
    throw new Error('EMAIL_WEBHOOK_URL is not configured');
  }

  // Validate webhook URL format
  try {
    new URL(webhookUrl);
  } catch (error) {
    logger.error('Invalid EMAIL_WEBHOOK_URL', { url: webhookUrl });
    throw new Error('EMAIL_WEBHOOK_URL is not a valid URL');
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      app: 'synthetic-hr-api',
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error('Webhook email delivery failed', {
      status: response.status,
      statusText: response.statusText,
      body: body.substring(0, 200),
      url: webhookUrl,
      to: input.to,
      subject: input.subject,
    });
    throw new Error(`Email delivery failed via webhook: ${response.status} ${response.statusText}`);
  }

  logger.info('Email delivered via webhook', { to: input.to, subject: input.subject });
}
