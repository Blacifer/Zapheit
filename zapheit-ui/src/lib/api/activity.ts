import type { UnifiedActivityEvent } from '../production-readiness';
import { API_BASE_URL, authenticatedFetch, getAuthHeaders, type ApiResponse } from './_helpers';

export type ActivityEventTypeFilter = UnifiedActivityEvent['type'] | 'all';

export interface ActivityEventsResponse {
  events: UnifiedActivityEvent[];
  generatedAt: string;
  nextCursor: string | null;
}

export type ActivityStreamEventName = 'activity' | 'ready' | 'heartbeat' | 'stream_error';

export interface ActivityStreamOptions {
  since?: string | null;
  type?: ActivityEventTypeFilter;
  signal?: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: UnifiedActivityEvent) => void;
  onStatus?: (event: ActivityStreamEventName, payload: any) => void;
}

function buildActivityQuery(params?: { limit?: number; since?: string | null; type?: ActivityEventTypeFilter }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.since) query.set('since', params.since);
  if (params?.type && params.type !== 'all') query.set('type', params.type);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function parseSseChunk(chunk: string) {
  const lines = chunk.split('\n');
  let event = 'message';
  let data = '';

  for (const line of lines) {
    const cleanLine = line.replace(/\r$/, '');
    if (cleanLine.startsWith('event:')) {
      event = cleanLine.slice(6).trim();
    } else if (cleanLine.startsWith('data:')) {
      data += cleanLine.slice(5).trimStart();
    }
  }

  return { event, data };
}

export const activityApi = {
  async list(params?: { limit?: number; since?: string | null; type?: ActivityEventTypeFilter }): Promise<ApiResponse<ActivityEventsResponse>> {
    return authenticatedFetch<ActivityEventsResponse>(`/activity/events${buildActivityQuery(params)}`, {
      method: 'GET',
    });
  },

  async stream(options: ActivityStreamOptions): Promise<void> {
    const headers = await getAuthHeaders();
    const hasAuthorization = Boolean((headers as Record<string, string>).Authorization);
    if (!hasAuthorization) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/activity/stream${buildActivityQuery({ since: options.since, type: options.type })}`, {
      method: 'GET',
      headers: {
        ...headers,
        Accept: 'text/event-stream',
      },
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Activity stream failed with status ${response.status}`);
    }

    options.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const rawChunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const parsed = parseSseChunk(rawChunk);
        if (parsed.data) {
          try {
            const payload = JSON.parse(parsed.data);
            if (parsed.event === 'activity') {
              options.onEvent(payload as UnifiedActivityEvent);
            } else if (
              parsed.event === 'ready'
              || parsed.event === 'heartbeat'
              || parsed.event === 'stream_error'
            ) {
              options.onStatus?.(parsed.event, payload);
            }
          } catch {
            // Ignore malformed stream frames. The next valid frame can continue the stream.
          }
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  },
};
