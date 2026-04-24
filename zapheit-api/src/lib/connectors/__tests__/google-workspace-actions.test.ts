import { executeConnectorAction } from '../action-executor';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../circuit-breaker', () => ({
  checkCircuitBreaker: jest.fn().mockResolvedValue(true),
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
}));

jest.mock('../../retry-worker', () => ({
  enqueueRetry: jest.fn(),
}));

jest.mock('../../preflight-gate', () => ({
  connectorActionFingerprint: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../supabase-rest', () => ({
  supabaseRest: jest.fn(),
  eq: (v: string) => `eq.${v}`,
  gte: (v: string) => `gte.${v}`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDS = { access_token: 'test-token' };
const ORG = 'org-123';
const CONNECTOR = 'google_workspace';

function mockOk(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status,
    json: () => Promise.resolve(data),
  });
}

function mockErr(data: unknown, status = 400) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(data),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Google Workspace write actions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.GOOGLE_WORKSPACE_WRITES;
  });

  // ── feature flag ────────────────────────────────────────────────────────────
  it('blocks all write actions when GOOGLE_WORKSPACE_WRITES=false', async () => {
    process.env.GOOGLE_WORKSPACE_WRITES = 'false';
    const result = await executeConnectorAction(CONNECTOR, 'send_email', {}, CREDS, ORG);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/temporarily disabled/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows write actions when flag is unset', async () => {
    mockOk({ id: 'msg-1' });
    const result = await executeConnectorAction(CONNECTOR, 'send_email', { to: 'a@b.com', subject: 'Hi', body: 'Hello' }, CREDS, ORG);
    expect(result.success).toBe(true);
  });

  // ── send_email ───────────────────────────────────────────────────────────────
  it('send_email: calls Gmail send and returns success', async () => {
    mockOk({ id: 'msg-abc', threadId: 'thread-1' });
    const result = await executeConnectorAction(CONNECTOR, 'send_email', { to: 'user@example.com', subject: 'Test', body: 'Hello' }, CREDS, ORG);
    expect(result.success).toBe(true);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toContain('gmail.googleapis.com');
    expect(call[0]).toContain('messages/send');
  });

  it('send_email: returns error on API failure', async () => {
    mockErr({ error: { message: 'Invalid credentials' } }, 401);
    const result = await executeConnectorAction(CONNECTOR, 'send_email', { to: 'a@b.com', subject: 'S', body: 'B' }, CREDS, ORG);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid credentials/i);
  });

  // ── reply_email ──────────────────────────────────────────────────────────────
  it('reply_email: sends to Gmail with threadId', async () => {
    mockOk({ id: 'msg-reply' });
    const result = await executeConnectorAction(CONNECTOR, 'reply_email', { threadId: 'thread-1', to: 'a@b.com', subject: 'Re: test', body: 'Reply' }, CREDS, ORG);
    expect(result.success).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toContain('messages/send');
  });

  // ── forward_email ────────────────────────────────────────────────────────────
  it('forward_email: sends to Gmail', async () => {
    mockOk({ id: 'msg-fwd' });
    const result = await executeConnectorAction(CONNECTOR, 'forward_email', { to: 'fwd@b.com', subject: 'Fwd: test', body: 'fwd body' }, CREDS, ORG);
    expect(result.success).toBe(true);
  });

  // ── archive_email ────────────────────────────────────────────────────────────
  it('archive_email: removes INBOX label', async () => {
    mockOk({});
    const result = await executeConnectorAction(CONNECTOR, 'archive_email', { id: 'msg-1' }, CREDS, ORG);
    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.removeLabelIds).toContain('INBOX');
  });

  it('archive_email: returns error when id missing', async () => {
    const result = await executeConnectorAction(CONNECTOR, 'archive_email', {}, CREDS, ORG);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/id/i);
  });

  // ── mark_email_read / mark_email_unread ───────────────────────────────────────
  it('mark_email_read: removes UNREAD label', async () => {
    mockOk({});
    const result = await executeConnectorAction(CONNECTOR, 'mark_email_read', { id: 'msg-1' }, CREDS, ORG);
    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.removeLabelIds).toContain('UNREAD');
  });

  it('mark_email_unread: adds UNREAD label', async () => {
    mockOk({});
    const result = await executeConnectorAction(CONNECTOR, 'mark_email_unread', { id: 'msg-1' }, CREDS, ORG);
    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.addLabelIds).toContain('UNREAD');
  });

  // ── cancel_event ─────────────────────────────────────────────────────────────
  it('cancel_event: deletes the Calendar event', async () => {
    mockOk({}, 204);
    const result = await executeConnectorAction(CONNECTOR, 'cancel_event', { eventId: 'evt-abc' }, CREDS, ORG);
    expect(result.success).toBe(true);
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    expect(mockFetch.mock.calls[0][0]).toContain('evt-abc');
  });

  it('cancel_event: returns error when eventId missing', async () => {
    const result = await executeConnectorAction(CONNECTOR, 'cancel_event', {}, CREDS, ORG);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/eventId/i);
  });

  // ── nl_command ───────────────────────────────────────────────────────────────
  it('nl_command: returns stub success without calling Google API', async () => {
    const result = await executeConnectorAction(CONNECTOR, 'nl_command', { command: 'Schedule a meeting' }, CREDS, ORG);
    expect(result.success).toBe(true);
    expect((result.data as any)?.message).toBe('Command received');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
