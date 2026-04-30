import { useCallback, useEffect, useRef, useState } from 'react';
import { activityApi, type ActivityEventTypeFilter } from '../lib/api/activity';
import type { UnifiedActivityEvent } from '../lib/production-readiness';

export type ActivityStreamStatus = 'idle' | 'connecting' | 'live' | 'polling' | 'error';

interface UseActivityStreamOptions {
  enabled?: boolean;
  limit?: number;
  pollMs?: number;
  type?: ActivityEventTypeFilter;
}

function sortAndLimit(events: UnifiedActivityEvent[], limit: number) {
  return events
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

function newestTimestamp(events: UnifiedActivityEvent[]) {
  return events.reduce<string | null>((latest, event) => {
    if (!latest) return event.at;
    return new Date(event.at).getTime() > new Date(latest).getTime() ? event.at : latest;
  }, null);
}

export function useActivityStream(options: UseActivityStreamOptions = {}) {
  const enabled = options.enabled ?? true;
  const limit = options.limit ?? 20;
  const pollMs = options.pollMs ?? 15000;
  const type = options.type ?? 'all';

  const [events, setEvents] = useState<UnifiedActivityEvent[]>([]);
  const [status, setStatus] = useState<ActivityStreamStatus>(enabled ? 'connecting' : 'idle');
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestAtRef = useRef<string | null>(null);

  const mergeEvents = useCallback((incoming: UnifiedActivityEvent[]) => {
    if (incoming.length === 0) return;

    const incomingLatest = newestTimestamp(incoming);
    if (
      incomingLatest
      && (!latestAtRef.current || new Date(incomingLatest).getTime() > new Date(latestAtRef.current).getTime())
    ) {
      latestAtRef.current = incomingLatest;
      setLastEventAt(incomingLatest);
    }

    setEvents((previous) => {
      const byId = new Map<string, UnifiedActivityEvent>();
      for (const event of [...incoming, ...previous]) {
        byId.set(event.id, event);
      }

      return sortAndLimit(Array.from(byId.values()), limit);
    });
  }, [limit]);

  const poll = useCallback(async () => {
    const response = await activityApi.list({
      limit,
      since: latestAtRef.current,
      type,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Activity feed unavailable');
    }

    mergeEvents(response.data.events);
    setError(null);
  }, [limit, mergeEvents, type]);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }

    let disposed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    const abortController = new AbortController();

    const startPolling = () => {
      if (disposed || pollInterval) return;
      setStatus((current) => current === 'error' ? 'error' : 'polling');
      pollInterval = setInterval(() => {
        poll().catch((pollError: any) => {
          if (disposed) return;
          setStatus('error');
          setError(pollError?.message || 'Activity feed unavailable');
        });
      }, pollMs);
    };

    const start = async () => {
      latestAtRef.current = null;
      setEvents([]);
      setLastEventAt(null);
      setStatus('connecting');

      try {
        await poll();
      } catch (initialError: any) {
        if (disposed) return;
        setStatus('error');
        setError(initialError?.message || 'Activity feed unavailable');
        startPolling();
        return;
      }

      activityApi.stream({
        since: latestAtRef.current,
        type,
        signal: abortController.signal,
        onOpen: () => {
          if (!disposed) setStatus('live');
        },
        onEvent: (event) => {
          if (!disposed) mergeEvents([event]);
        },
        onStatus: (eventName, payload) => {
          if (disposed) return;
          if (eventName === 'stream_error') {
            setStatus('polling');
            setError(payload?.message || 'Activity stream degraded');
          }
        },
      }).then(() => {
        if (disposed) return;
        startPolling();
      }).catch((streamError: any) => {
        if (disposed || abortController.signal.aborted) return;
        setStatus('polling');
        setError(streamError?.message || 'Activity stream unavailable');
        startPolling();
      });
    };

    void start();

    return () => {
      disposed = true;
      abortController.abort();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [enabled, mergeEvents, poll, pollMs, type]);

  return {
    events,
    status,
    lastEventAt,
    error,
    refresh: poll,
  };
}
