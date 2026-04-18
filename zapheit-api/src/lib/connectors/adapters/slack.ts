// ---------------------------------------------------------------------------
// Slack Connector Adapter
//
// Full ConnectorAdapter implementation for Slack.
// Migrated from the switch-case in action-executor.ts into a structured
// adapter that separates reads from writes.
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  bearerHeaders,
  isReadAction,
  registerAdapter,
} from '../adapter';

function resolveToken(creds: Record<string, string>): string | null {
  return creds.access_token || creds.bot_token || creds.token || creds.botToken || null;
}

const slackAdapter: ConnectorAdapter = {
  connectorId: 'slack',
  displayName: 'Slack',
  requiredCredentials: ['botToken'],

  validateCredentials(creds) {
    const token = resolveToken(creds);
    if (!token) return { valid: false, missing: ['botToken'] };
    return { valid: true, missing: [] };
  },

  async testConnection(creds): Promise<HealthResult> {
    const token = resolveToken(creds);
    if (!token) return { healthy: false, error: 'Missing bot token' };

    const start = Date.now();
    try {
      const r = await jsonFetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: bearerHeaders(token),
      });
      const latencyMs = Date.now() - start;

      if (!r.data.ok) {
        return { healthy: false, latencyMs, error: r.data.error || 'auth.test failed' };
      }
      return {
        healthy: true,
        latencyMs,
        accountLabel: `${r.data.team} (${r.data.user})`,
        details: { team_id: r.data.team_id, user_id: r.data.user_id },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const token = resolveToken(creds);
    if (!token) return { success: false, error: 'Slack credentials missing: botToken required' };

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    switch (action) {
      case 'get_channel_history': {
        let channelId = params.channel;
        if (channelId?.startsWith('#')) {
          const listR = await jsonFetch('https://slack.com/api/conversations.list?limit=200', { headers });
          const found = listR.data?.channels?.find((c: any) => c.name === channelId.slice(1));
          if (!found) return { success: false, error: `Channel ${channelId} not found` };
          channelId = found.id;
        }
        const r = await jsonFetch(
          `https://slack.com/api/conversations.history?channel=${channelId}&limit=${params.limit || 10}`,
          { headers },
        );
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.messages };
      }

      case 'get_user_info': {
        if (params.email) {
          const r = await jsonFetch(
            `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(params.email)}`,
            { headers },
          );
          if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
          return { success: true, data: r.data.user };
        }
        if (params.user_id) {
          const r = await jsonFetch(
            `https://slack.com/api/users.info?user=${params.user_id}`,
            { headers },
          );
          if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
          return { success: true, data: r.data.user };
        }
        return { success: false, error: 'email or user_id required' };
      }

      case 'list_channels': {
        const r = await jsonFetch(
          `https://slack.com/api/conversations.list?limit=${params.limit || 20}&types=${params.types || 'public_channel,private_channel'}`,
          { headers },
        );
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return {
          success: true,
          data: r.data.channels?.map((c: any) => ({
            id: c.id,
            name: c.name,
            is_private: c.is_private,
            num_members: c.num_members,
            topic: c.topic?.value,
            purpose: c.purpose?.value,
          })),
        };
      }

      case 'list_users': {
        const r = await jsonFetch(
          `https://slack.com/api/users.list?limit=${params.limit || 50}`,
          { headers },
        );
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return {
          success: true,
          data: r.data.members
            ?.filter((m: any) => !m.deleted && !m.is_bot)
            .map((m: any) => ({
              id: m.id,
              name: m.name,
              real_name: m.real_name,
              email: m.profile?.email,
              avatar: m.profile?.image_48,
              is_admin: m.is_admin,
            })),
        };
      }

      case 'search_messages': {
        const r = await jsonFetch(
          `https://slack.com/api/search.messages?query=${encodeURIComponent(params.query)}&count=${params.limit || 10}`,
          { headers },
        );
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.messages?.matches };
      }

      case 'get_channel_info': {
        if (!params.channel) return { success: false, error: 'channel required' };
        const r = await jsonFetch(
          `https://slack.com/api/conversations.info?channel=${params.channel}`,
          { headers },
        );
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.channel };
      }

      default:
        return { success: false, error: `Unknown Slack read action: ${action}`, statusCode: 400 };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const token = resolveToken(creds);
    if (!token) return { success: false, error: 'Slack credentials missing: botToken required' };

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    switch (action) {
      case 'send_message': {
        const body: Record<string, any> = { channel: params.channel, text: params.text };
        if (params.thread_ts) body.thread_ts = params.thread_ts;
        if (params.blocks) body.blocks = params.blocks;

        const r = await jsonFetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: { ts: r.data.ts, channel: r.data.channel } };
      }

      case 'update_message': {
        if (!params.channel || !params.ts || !params.text) {
          return { success: false, error: 'update_message requires: channel, ts, text' };
        }
        const r = await jsonFetch('https://slack.com/api/chat.update', {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel: params.channel, ts: params.ts, text: params.text }),
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: { ts: r.data.ts, channel: r.data.channel } };
      }

      case 'delete_message': {
        if (!params.channel || !params.ts) {
          return { success: false, error: 'delete_message requires: channel, ts' };
        }
        const r = await jsonFetch('https://slack.com/api/chat.delete', {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel: params.channel, ts: params.ts }),
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: { deleted: true } };
      }

      case 'add_reaction': {
        if (!params.channel || !params.timestamp || !params.name) {
          return { success: false, error: 'add_reaction requires: channel, timestamp, name' };
        }
        const r = await jsonFetch('https://slack.com/api/reactions.add', {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel: params.channel, timestamp: params.timestamp, name: params.name }),
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: { added: true } };
      }

      case 'set_channel_topic': {
        if (!params.channel || !params.topic) {
          return { success: false, error: 'set_channel_topic requires: channel, topic' };
        }
        const r = await jsonFetch('https://slack.com/api/conversations.setTopic', {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel: params.channel, topic: params.topic }),
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.channel };
      }

      case 'create_channel': {
        if (!params.name) return { success: false, error: 'create_channel requires: name' };
        const r = await jsonFetch('https://slack.com/api/conversations.create', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: params.name, is_private: params.is_private || false }),
        });
        if (!r.data.ok) return { success: false, error: r.data.error || 'Slack API error' };
        return { success: true, data: r.data.channel };
      }

      default:
        return { success: false, error: `Unknown Slack write action: ${action}`, statusCode: 400 };
    }
  },
};

// Auto-register on import
registerAdapter(slackAdapter);

export default slackAdapter;
