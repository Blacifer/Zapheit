import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ── Mock jsonFetch before any adapter imports ──────────────────────────────────
const mockJsonFetch = jest.fn();

jest.mock('../lib/connectors/adapter', () => {
  const actual = jest.requireActual('../lib/connectors/adapter') as any;
  return {
    ...actual,
    jsonFetch: (...args: any[]) => mockJsonFetch(...args),
  };
});

// Import adapters — each self-registers via registerAdapter()
import '../lib/connectors/adapters/slack';
import '../lib/connectors/adapters/jira';
import '../lib/connectors/adapters/github';
import '../lib/connectors/adapters/hubspot';
import '../lib/connectors/adapters/quickbooks';
import '../lib/connectors/adapters/google-workspace';
import '../lib/connectors/adapters/zoho-people';
import '../lib/connectors/adapters/notion';

import { getRegisteredAdapter, listRegisteredAdapters } from '../lib/connectors/adapter';

function resetMock() { mockJsonFetch.mockReset(); }

describe('Connector Adapter Registry', () => {
  it('registers all 8 adapters', () => {
    const ids = listRegisteredAdapters();
    expect(ids).toEqual(
      expect.arrayContaining([
        'slack', 'jira', 'github', 'hubspot',
        'quickbooks', 'google-workspace', 'zoho-people', 'notion',
      ]),
    );
  });
});

// ── Slack ────────────────────────────────────────────────────────────────────

describe('Slack Adapter', () => {
  const adapter = getRegisteredAdapter('slack')!;
  const creds = { bot_token: 'xoxb-test' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });

    it('rejects missing token', () => {
      const result = adapter.validateCredentials({});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('botToken');
    });
  });

  describe('testConnection', () => {
    it('returns healthy on success', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        data: { ok: true, team: 'TestCo', user: 'bot', team_id: 'T1', user_id: 'U1' },
      });
      const health = await adapter.testConnection(creds);
      expect(health.healthy).toBe(true);
      expect(health.accountLabel).toContain('TestCo');
    });

    it('returns unhealthy on API error', async () => {
      (mockJsonFetch as any).mockResolvedValue({ data: { ok: false, error: 'invalid_auth' } });
      const health = await adapter.testConnection(creds);
      expect(health.healthy).toBe(false);
    });
  });

  describe('executeRead', () => {
    it('lists channels', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        data: {
          ok: true,
          channels: [{ id: 'C1', name: 'general', is_private: false, num_members: 5, topic: { value: '' }, purpose: { value: '' } }],
        },
      });
      const result = await adapter.executeRead('list_channels', { limit: 10 }, creds);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('general');
    });

    it('returns error for unknown action', async () => {
      const result = await adapter.executeRead('nonexistent', {}, creds);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });

  describe('executeWrite', () => {
    it('sends a message', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        data: { ok: true, ts: '1234567890.123456' },
      });
      const result = await adapter.executeWrite('send_message', { channel: 'C1', text: 'hello' }, creds);
      expect(result.success).toBe(true);
    });
  });
});

// ── Jira ─────────────────────────────────────────────────────────────────────

describe('Jira Adapter', () => {
  const adapter = getRegisteredAdapter('jira')!;
  const creds = { baseUrl: 'https://test.atlassian.net', email: 'a@b.com', api_token: 'tok' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });

    it('rejects missing fields', () => {
      const result = adapter.validateCredentials({ baseUrl: 'x' });
      expect(result.valid).toBe(false);
    });
  });

  describe('executeRead', () => {
    it('searches issues via JQL', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        ok: true, status: 200,
        data: { issues: [{ key: 'TEST-1', fields: { summary: 'Bug', status: { name: 'Open' } } }], total: 1 },
      });
      const result = await adapter.executeRead('search_issues', { jql: 'project = TEST' }, creds);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('returns error for unknown action', async () => {
      const result = await adapter.executeRead('nonexistent', {}, creds);
      expect(result.success).toBe(false);
    });
  });
});

// ── GitHub ────────────────────────────────────────────────────────────────────

describe('GitHub Adapter', () => {
  const adapter = getRegisteredAdapter('github')!;
  const creds = { token: 'ghp_test', owner: 'org', repo: 'repo' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });
  });

  describe('testConnection', () => {
    it('returns healthy on success', async () => {
      (mockJsonFetch as any).mockResolvedValue({ ok: true, status: 200, data: { login: 'testuser', name: 'Test', id: 1 } });
      const health = await adapter.testConnection(creds);
      expect(health.healthy).toBe(true);
    });
  });

  describe('executeRead', () => {
    it('lists issues', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        ok: true, status: 200,
        data: [{ number: 1, title: 'Bug', state: 'open', user: { login: 'alice' }, labels: [], created_at: '2024-01-01', updated_at: '2024-01-02' }],
      });
      const result = await adapter.executeRead('list_issues', { owner: 'org', repo: 'repo' }, creds);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });
});

// ── HubSpot ──────────────────────────────────────────────────────────────────

describe('HubSpot Adapter', () => {
  const adapter = getRegisteredAdapter('hubspot')!;
  const creds = { access_token: 'hub-tok' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });

    it('rejects missing token', () => {
      const result = adapter.validateCredentials({});
      expect(result.valid).toBe(false);
    });
  });

  describe('executeRead', () => {
    it('lists contacts', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        ok: true, status: 200,
        data: { results: [{ id: '1', properties: { firstname: 'John', lastname: 'Doe', email: 'j@d.com' } }] },
      });
      const result = await adapter.executeRead('list_contacts', { limit: 5 }, creds);
      expect(result.success).toBe(true);
    });
  });
});

// ── Notion ───────────────────────────────────────────────────────────────────

describe('Notion Adapter', () => {
  const adapter = getRegisteredAdapter('notion')!;
  const creds = { api_key: 'ntn_test' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });
  });

  describe('executeRead', () => {
    it('searches pages', async () => {
      (mockJsonFetch as any).mockResolvedValue({
        ok: true, status: 200,
        data: {
          results: [{ id: 'p1', object: 'page', properties: { title: { title: [{ plain_text: 'My Page' }] } }, url: 'https://notion.so/p1', last_edited_time: '2024-01-01' }],
          has_more: false,
        },
      });
      const result = await adapter.executeRead('search', { query: 'test' }, creds);
      expect(result.success).toBe(true);
    });
  });
});

// ── QuickBooks ───────────────────────────────────────────────────────────────

describe('QuickBooks Adapter', () => {
  const adapter = getRegisteredAdapter('quickbooks')!;
  const creds = { access_token: 'qb-tok', realm_id: 'realm-1' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });

    it('rejects missing fields', () => {
      const result = adapter.validateCredentials({});
      expect(result.valid).toBe(false);
    });
  });
});

// ── Zoho People ──────────────────────────────────────────────────────────────

describe('Zoho People Adapter', () => {
  const adapter = getRegisteredAdapter('zoho-people')!;
  const creds = { access_token: 'zoho-tok' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });
  });
});

// ── Google Workspace ─────────────────────────────────────────────────────────

describe('Google Workspace Adapter', () => {
  const adapter = getRegisteredAdapter('google-workspace')!;
  const creds = { access_token: 'goog-tok' };

  beforeEach(resetMock);

  describe('validateCredentials', () => {
    it('accepts valid credentials', () => {
      expect(adapter.validateCredentials(creds)).toEqual({ valid: true, missing: [] });
    });
  });
});
