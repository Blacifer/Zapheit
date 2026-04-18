// ---------------------------------------------------------------------------
// WhatsApp Cloud API Connector Adapter
//
// Full ConnectorAdapter for WhatsApp Business via Meta Cloud API v21.0.
// Reads come from the local DB (whatsapp_messages / whatsapp_contacts).
// Writes go to the Meta Graph API and are persisted locally on success.
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  bearerHeaders,
  registerAdapter,
} from '../adapter';
import { supabaseRestAsService, eq } from '../../supabase-rest';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

function resolveToken(creds: Record<string, string>): string | null {
  return creds.access_token || creds.accessToken || creds.token || null;
}

function resolvePhoneNumberId(creds: Record<string, string>): string | null {
  return creds.phone_number_id || creds.phoneNumberId || null;
}

function resolveWabaId(creds: Record<string, string>): string | null {
  return creds.waba_id || creds.wabaId || null;
}

const whatsappAdapter: ConnectorAdapter = {
  connectorId: 'whatsapp',
  displayName: 'WhatsApp Business',
  requiredCredentials: ['access_token', 'phone_number_id', 'waba_id'],

  validateCredentials(creds) {
    const missing: string[] = [];
    if (!resolveToken(creds)) missing.push('access_token');
    if (!resolvePhoneNumberId(creds)) missing.push('phone_number_id');
    if (!resolveWabaId(creds)) missing.push('waba_id');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const token = resolveToken(creds);
    const phoneNumberId = resolvePhoneNumberId(creds);
    if (!token || !phoneNumberId) {
      return { healthy: false, error: 'Missing access_token or phone_number_id' };
    }

    const start = Date.now();
    try {
      const r = await jsonFetch(`${GRAPH_API}/${phoneNumberId}`, {
        method: 'GET',
        headers: bearerHeaders(token),
      });
      const latencyMs = Date.now() - start;

      if (!r.ok) {
        return {
          healthy: false,
          latencyMs,
          error: r.data?.error?.message || `API Error: ${r.status}`,
        };
      }

      return {
        healthy: true,
        latencyMs,
        accountLabel: r.data.verified_name || r.data.display_phone_number || phoneNumberId,
        details: {
          verified_name: r.data.verified_name,
          display_phone_number: r.data.display_phone_number,
          quality_rating: r.data.quality_rating,
          platform_type: r.data.platform_type,
        },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  // ────────────────────────────────────────────────────────────────────
  // Read Actions
  // ────────────────────────────────────────────────────────────────────

  async executeRead(action, params, creds): Promise<ActionResult> {
    const token = resolveToken(creds);
    const phoneNumberId = resolvePhoneNumberId(creds);
    const wabaId = resolveWabaId(creds);
    if (!token) return { success: false, error: 'Missing access_token' };

    switch (action) {
      // Conversations — grouped by thread_phone from local DB
      case 'list_conversations': {
        const orgId = params._orgId;
        if (!orgId) return { success: false, error: 'Missing _orgId' };

        try {
          const rows = await supabaseRestAsService(
            'whatsapp_messages',
            new URLSearchParams({
              organization_id: eq(orgId),
              select: 'thread_phone,content,status,direction,created_at,from_number,to_number',
              order: 'created_at.desc',
            }),
          ) as any[] | null;

          if (!rows?.length) {
            return { success: true, data: { conversations: [] } };
          }

          // Group by thread_phone, take latest message per thread
          const threadMap = new Map<string, any>();
          for (const row of rows) {
            if (!threadMap.has(row.thread_phone)) {
              threadMap.set(row.thread_phone, row);
            }
          }

          // Enrich with contact names
          const phones = Array.from(threadMap.keys());
          const contacts = await supabaseRestAsService(
            'whatsapp_contacts',
            new URLSearchParams({
              organization_id: eq(orgId),
              phone: `in.(${phones.join(',')})`,
              select: 'phone,name,labels',
            }),
          ) as any[] | null;
          const contactMap = new Map((contacts || []).map((c: any) => [c.phone, c]));

          const conversations = phones.map((phone) => {
            const latest = threadMap.get(phone)!;
            const contact = contactMap.get(phone);
            return {
              phone,
              name: contact?.name || phone,
              labels: contact?.labels || [],
              lastMessage: latest.content,
              lastDirection: latest.direction,
              lastStatus: latest.status,
              lastTs: latest.created_at,
              unread: 0, // Could be computed from status
            };
          });

          return { success: true, data: { conversations } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Messages for a specific phone thread
      case 'get_messages': {
        const orgId = params._orgId;
        const phone = params.phone;
        if (!orgId || !phone) return { success: false, error: 'Missing _orgId or phone' };

        try {
          const rows = await supabaseRestAsService(
            'whatsapp_messages',
            new URLSearchParams({
              organization_id: eq(orgId),
              thread_phone: eq(phone),
              select: '*',
              order: 'created_at.asc',
              limit: String(params.limit || 50),
            }),
          ) as any[] | null;

          return { success: true, data: { messages: rows || [] } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Contacts from local DB
      case 'list_contacts': {
        const orgId = params._orgId;
        if (!orgId) return { success: false, error: 'Missing _orgId' };

        try {
          const rows = await supabaseRestAsService(
            'whatsapp_contacts',
            new URLSearchParams({
              organization_id: eq(orgId),
              select: '*',
              order: 'last_message_at.desc.nullslast',
              limit: String(params.limit || 100),
            }),
          ) as any[] | null;

          return { success: true, data: { contacts: rows || [] } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Templates — fetch from Meta API and sync to local DB
      case 'list_templates': {
        if (!wabaId) return { success: false, error: 'Missing waba_id' };

        try {
          const r = await jsonFetch(
            `${GRAPH_API}/${wabaId}/message_templates?limit=100`,
            { method: 'GET', headers: bearerHeaders(token) },
          );

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          const templates = (r.data.data || []).map((t: any) => ({
            wa_template_id: t.id,
            name: t.name,
            category: t.category,
            language: t.language,
            status: t.status,
            body: t.components?.find((c: any) => c.type === 'BODY')?.text || '',
            header: t.components?.find((c: any) => c.type === 'HEADER') || null,
            footer: t.components?.find((c: any) => c.type === 'FOOTER')?.text || null,
            buttons: t.components?.find((c: any) => c.type === 'BUTTONS')?.buttons || null,
          }));

          return { success: true, data: { templates } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Phone number metadata from Meta API
      case 'get_phone_info': {
        if (!phoneNumberId) return { success: false, error: 'Missing phone_number_id' };

        try {
          const r = await jsonFetch(`${GRAPH_API}/${phoneNumberId}`, {
            method: 'GET',
            headers: bearerHeaders(token),
          });

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          return { success: true, data: r.data };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  // ────────────────────────────────────────────────────────────────────
  // Write Actions
  // ────────────────────────────────────────────────────────────────────

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const token = resolveToken(creds);
    const phoneNumberId = resolvePhoneNumberId(creds);
    const wabaId = resolveWabaId(creds);
    if (!token || !phoneNumberId) return { success: false, error: 'Missing access_token or phone_number_id' };

    switch (action) {
      // Send a text message
      case 'send_message': {
        const to = params.to || params.phone;
        const text = params.text || params.body || params.content;
        if (!to || !text) return { success: false, error: 'Missing to/phone and text/body' };

        try {
          const r = await jsonFetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: to.replace(/[\s\-()]/g, ''), // Normalize phone number
              type: 'text',
              text: { preview_url: true, body: text },
            }),
          });

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          const waMessageId = r.data.messages?.[0]?.id || '';
          return {
            success: true,
            data: {
              message_id: waMessageId,
              to,
              status: 'sent',
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Send a template message
      case 'send_template': {
        const to = params.to || params.phone;
        const templateName = params.template || params.name;
        const language = params.language || 'en';
        const components = params.components || [];
        if (!to || !templateName) return { success: false, error: 'Missing to/phone and template name' };

        try {
          const r = await jsonFetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: to.replace(/[\s\-()]/g, ''),
              type: 'template',
              template: {
                name: templateName,
                language: { code: language },
                components,
              },
            }),
          });

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          return { success: true, data: { message_id: r.data.messages?.[0]?.id, to, template: templateName } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Mark a message as read
      case 'mark_read': {
        const messageId = params.message_id || params.wa_message_id;
        if (!messageId) return { success: false, error: 'Missing message_id' };

        try {
          const r = await jsonFetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              status: 'read',
              message_id: messageId,
            }),
          });

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          return { success: true, data: { marked_read: true } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Create a message template via Business Management API
      case 'create_template': {
        if (!wabaId) return { success: false, error: 'Missing waba_id' };
        const { name, category, language, body: templateBody, header, footer, buttons } = params;
        if (!name || !category) return { success: false, error: 'Missing name or category' };

        const components: any[] = [];
        if (header) components.push({ type: 'HEADER', ...header });
        if (templateBody) components.push({ type: 'BODY', text: templateBody });
        if (footer) components.push({ type: 'FOOTER', text: footer });
        if (buttons?.length) components.push({ type: 'BUTTONS', buttons });

        try {
          const r = await jsonFetch(`${GRAPH_API}/${wabaId}/message_templates`, {
            method: 'POST',
            headers: bearerHeaders(token),
            body: JSON.stringify({
              name,
              category,
              language: language || 'en',
              components,
            }),
          });

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          return { success: true, data: { template_id: r.data.id, name, status: r.data.status } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // Delete a message template
      case 'delete_template': {
        if (!wabaId) return { success: false, error: 'Missing waba_id' };
        const name = params.name || params.template_name;
        if (!name) return { success: false, error: 'Missing template name' };

        try {
          const r = await jsonFetch(
            `${GRAPH_API}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`,
            { method: 'DELETE', headers: bearerHeaders(token) },
          );

          if (!r.ok) {
            return { success: false, error: r.data?.error?.message || `API ${r.status}` };
          }

          return { success: true, data: { deleted: true, name } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(whatsappAdapter);
export default whatsappAdapter;
