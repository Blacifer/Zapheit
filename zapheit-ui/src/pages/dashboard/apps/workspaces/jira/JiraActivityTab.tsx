import { useEffect, useState, useMemo } from 'react';
import { api } from '../../../../../lib/api-client';
import { ActivityFeed } from '../shared';
import type { ActivityItem } from '../shared';

interface JiraActivityTabProps {
  connectorId?: string;
}

export function JiraActivityTab({ connectorId = 'jira' }: JiraActivityTabProps) {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.integrations.getGovernedActions({ service: connectorId, limit: 50 });
        if (!cancelled && res.success && res.data) {
          setActions(res.data);
        }
      } catch {
        // swallow — empty state handles it
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [connectorId]);

  const items: ActivityItem[] = useMemo(() =>
    actions.map((a: any) => ({
      id: a.id || a.governed_action_id || String(Math.random()),
      actor: a.source === 'runtime' ? 'agent' as const : 'user' as const,
      actorName: a.agent_name || a.user_email || a.source || 'Unknown',
      action: a.action || a.service_action || '',
      target: a.connector_id || a.service || connectorId,
      timestamp: a.created_at || a.executed_at || new Date().toISOString(),
      status: a.decision === 'executed' ? 'success' as const
        : a.decision === 'pending_approval' ? 'pending' as const
        : a.decision === 'blocked' ? 'failed' as const
        : 'success' as const,
      detail: a.result_summary || a.decision || undefined,
    })),
    [actions, connectorId],
  );

  return (
    <div className="p-4">
      <ActivityFeed
        items={items}
        loading={loading}
        maxItems={50}
        emptyMessage="No Jira activity yet. Actions will appear here once the integration is active."
      />
    </div>
  );
}
