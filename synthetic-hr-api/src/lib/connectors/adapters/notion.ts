// ---------------------------------------------------------------------------
// Notion Connector Adapter
//
// Full ConnectorAdapter for Notion API (v2022-06-28).
// Reads: list_databases, query_database, get_page, search, list_blocks
// Writes: create_page, update_page, append_block, archive_page, create_database, update_block
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  registerAdapter,
} from '../adapter';

function resolveAuth(creds: Record<string, string>) {
  const token = creds.token || creds.access_token || creds.api_key;
  return { token };
}

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };
}

const BASE = 'https://api.notion.com/v1';

const notionAdapter: ConnectorAdapter = {
  connectorId: 'notion',
  displayName: 'Notion',
  requiredCredentials: ['token'],

  validateCredentials(creds) {
    const { token } = resolveAuth(creds);
    const missing: string[] = [];
    if (!token) missing.push('token');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { token } = resolveAuth(creds);
    if (!token) return { healthy: false, error: 'Missing required credential: token (integration token)' };
    const start = Date.now();
    try {
      const headers = notionHeaders(token);
      const r = await jsonFetch(`${BASE}/users/me`, { headers });
      const latencyMs = Date.now() - start;
      if (!r.ok) return { healthy: false, latencyMs, error: r.data?.message || `HTTP ${r.status}` };
      return {
        healthy: true,
        latencyMs,
        accountLabel: r.data?.name || r.data?.bot?.owner?.user?.name || 'Notion',
        details: { type: r.data?.type, botId: r.data?.id },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { token } = resolveAuth(creds);
    const headers = notionHeaders(token);

    switch (action) {
      case 'list_databases': {
        const r = await jsonFetch(`${BASE}/search`, {
          method: 'POST', headers,
          body: JSON.stringify({ filter: { value: 'database', property: 'object' }, page_size: params.limit || 20 }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.results || [] };
      }
      case 'query_database': {
        const dbId = params.databaseId || params.id;
        if (!dbId) return { success: false, error: 'databaseId is required' };
        const body: any = { page_size: params.limit || 20 };
        if (params.filter) body.filter = params.filter;
        if (params.sorts) body.sorts = params.sorts;
        const r = await jsonFetch(`${BASE}/databases/${dbId}/query`, {
          method: 'POST', headers, body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.results || [], meta: { has_more: r.data?.has_more, next_cursor: r.data?.next_cursor } };
      }
      case 'get_page': {
        const pageId = params.pageId || params.id;
        if (!pageId) return { success: false, error: 'pageId is required' };
        const r = await jsonFetch(`${BASE}/pages/${pageId}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'search': {
        const query = params.query || params.q || '';
        const r = await jsonFetch(`${BASE}/search`, {
          method: 'POST', headers,
          body: JSON.stringify({ query, page_size: params.limit || 20 }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.results || [] };
      }
      case 'list_blocks': {
        const blockId = params.blockId || params.pageId || params.id;
        if (!blockId) return { success: false, error: 'blockId or pageId is required' };
        const r = await jsonFetch(`${BASE}/blocks/${blockId}/children?page_size=${params.limit || 50}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.results || [] };
      }
      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { token } = resolveAuth(creds);
    const headers = notionHeaders(token);

    switch (action) {
      case 'create_page': {
        const parentDb = params.databaseId;
        const parentPage = params.parentPageId;
        if (!parentDb && !parentPage) return { success: false, error: 'databaseId or parentPageId is required' };
        const body: any = {
          parent: parentDb ? { database_id: parentDb } : { page_id: parentPage },
          properties: params.properties || {},
        };
        if (params.children) body.children = params.children;
        const r = await jsonFetch(`${BASE}/pages`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'update_page': {
        const pageId = params.pageId || params.id;
        if (!pageId) return { success: false, error: 'pageId is required' };
        const body: any = {};
        if (params.properties) body.properties = params.properties;
        if (params.archived !== undefined) body.archived = params.archived;
        const r = await jsonFetch(`${BASE}/pages/${pageId}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'append_block': {
        const blockId = params.blockId || params.pageId;
        if (!blockId) return { success: false, error: 'blockId or pageId is required' };
        const children = params.children || [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: params.content || '' } }] },
        }];
        const r = await jsonFetch(`${BASE}/blocks/${blockId}/children`, {
          method: 'PATCH', headers, body: JSON.stringify({ children }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'archive_page': {
        const pageId = params.pageId || params.id;
        if (!pageId) return { success: false, error: 'pageId is required' };
        const r = await jsonFetch(`${BASE}/pages/${pageId}`, {
          method: 'PATCH', headers, body: JSON.stringify({ archived: true }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'create_database': {
        const parentPageId = params.parentPageId;
        if (!parentPageId || !params.title) return { success: false, error: 'parentPageId and title are required' };
        const body: any = {
          parent: { page_id: parentPageId },
          title: [{ type: 'text', text: { content: params.title } }],
          properties: params.properties || { Name: { title: {} } },
        };
        const r = await jsonFetch(`${BASE}/databases`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'update_block': {
        const blockId = params.blockId || params.id;
        if (!blockId) return { success: false, error: 'blockId is required' };
        const { blockId: _bid, id: _id, ...updates } = params;
        const r = await jsonFetch(`${BASE}/blocks/${blockId}`, {
          method: 'PATCH', headers, body: JSON.stringify(updates),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(notionAdapter);
