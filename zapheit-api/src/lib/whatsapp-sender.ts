// ---------------------------------------------------------------------------
// WhatsApp Cloud API — outbound message sender
//
// Used to send approval request notifications to approvers via WhatsApp.
// Requires a Meta-approved interactive button template.
//
// Environment variables:
//   WHATSAPP_APPROVAL_TEMPLATE_NAME  — template name registered with Meta
//   WHATSAPP_APPROVAL_TEMPLATE_LANG  — template language code (default: en)
//
// Template must have 2 quick-reply buttons:
//   button[0].payload = "approve:{approvalId}"
//   button[1].payload = "reject:{approvalId}"
//
// Until the template is Meta-approved, this will soft-fail gracefully.
// ---------------------------------------------------------------------------

import { logger } from './logger';
import { eq, supabaseRestAsService } from './supabase-rest';

export interface WhatsAppApprovalPayload {
  orgId: string;
  approvalId: string;
  approverPhone: string;
  agentName?: string;
  service: string;
  action: string;
  actionSummary: string;
  riskScore?: number | null;
  amount?: number | null;
}

interface SendResult {
  sent: boolean;
  waMessageId?: string;
  error?: string;
}

/* ─────────────────────────────────────────────────────────────────────────
   Resolve org's WhatsApp phone_number_id from integration_credentials
──────────────────────────────────────────────────────────────────────────── */

async function resolvePhoneNumberId(orgId: string): Promise<{ phoneNumberId: string; accessToken: string } | null> {
  try {
    const intQ = new URLSearchParams();
    intQ.set('organization_id', eq(orgId));
    intQ.set('service_type', eq('whatsapp_business'));
    intQ.set('status', eq('connected'));
    intQ.set('select', 'id');
    intQ.set('limit', '1');

    const integrations = await supabaseRestAsService('integrations', intQ) as any[];
    if (!integrations?.length) return null;

    const integrationId = integrations[0].id;

    const credQ = new URLSearchParams();
    credQ.set('integration_id', eq(integrationId));
    credQ.set('key', `in.(phone_number_id,access_token)`);
    credQ.set('select', 'key,value');

    const creds = await supabaseRestAsService('integration_credentials', credQ) as any[];
    if (!creds?.length) return null;

    const phoneNumberId = creds.find((c: any) => c.key === 'phone_number_id')?.value;
    const accessToken = creds.find((c: any) => c.key === 'access_token')?.value;

    if (!phoneNumberId || !accessToken) return null;
    return { phoneNumberId, accessToken };
  } catch (err: any) {
    logger.warn('Failed to resolve WhatsApp credentials', { orgId, error: err?.message });
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Format risk level label
──────────────────────────────────────────────────────────────────────────── */

function riskLabel(score?: number | null): string {
  if (!score) return 'standard';
  if (score >= 0.7) return 'high risk ⚠️';
  if (score >= 0.4) return 'medium risk';
  return 'low risk';
}

/* ─────────────────────────────────────────────────────────────────────────
   Send approval request via WhatsApp template message
──────────────────────────────────────────────────────────────────────────── */

export async function sendWhatsAppApproval(payload: WhatsAppApprovalPayload): Promise<SendResult> {
  const templateName = process.env.WHATSAPP_APPROVAL_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_APPROVAL_TEMPLATE_LANG || 'en';

  if (!templateName) {
    logger.debug('WHATSAPP_APPROVAL_TEMPLATE_NAME not set — skipping WhatsApp approval notification');
    return { sent: false, error: 'Template name not configured' };
  }

  const wa = await resolvePhoneNumberId(payload.orgId);
  if (!wa) {
    logger.debug('No connected WhatsApp integration for org — skipping', { orgId: payload.orgId });
    return { sent: false, error: 'No WhatsApp integration connected' };
  }

  const { phoneNumberId, accessToken } = wa;
  const to = payload.approverPhone.replace(/\D/g, ''); // strip non-digits

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: payload.agentName || 'Zapheit Agent' },
            { type: 'text', text: payload.actionSummary.slice(0, 200) },
            { type: 'text', text: `${payload.service} · ${riskLabel(payload.riskScore)}` },
            ...(payload.amount ? [{ type: 'text', text: new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(payload.amount) }] : []),
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: `approve:${payload.approvalId}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: `reject:${payload.approvalId}` }],
        },
      ],
    },
  };

  try {
    const resp = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json() as any;

    if (!resp.ok) {
      const err = data?.error?.message || `HTTP ${resp.status}`;
      logger.warn('WhatsApp approval message failed', { approvalId: payload.approvalId, to, error: err });
      return { sent: false, error: err };
    }

    const waMessageId = data?.messages?.[0]?.id;
    logger.info('WhatsApp approval message sent', { approvalId: payload.approvalId, to, waMessageId });
    return { sent: true, waMessageId };
  } catch (err: any) {
    logger.warn('WhatsApp approval send error', { approvalId: payload.approvalId, error: err?.message });
    return { sent: false, error: err?.message };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Send a plain text message (confirmation after button tap)
──────────────────────────────────────────────────────────────────────────── */

export async function sendWhatsAppText(orgId: string, to: string, text: string): Promise<SendResult> {
  const wa = await resolvePhoneNumberId(orgId);
  if (!wa) return { sent: false, error: 'No WhatsApp integration connected' };

  const { phoneNumberId, accessToken } = wa;
  const toClean = to.replace(/\D/g, '');

  try {
    const resp = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toClean,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!resp.ok) {
      const data = await resp.json() as any;
      return { sent: false, error: data?.error?.message || `HTTP ${resp.status}` };
    }

    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err?.message };
  }
}
