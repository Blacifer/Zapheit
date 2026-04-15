import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../../../lib/api-client';
import { GovernanceActivityFeed } from '../shared';

interface GoogleActivityTabProps {
  connectorId?: string;
  onApprovalResolved?: () => void;
}

export function GoogleActivityTab({ connectorId = 'google-workspace', onApprovalResolved }: GoogleActivityTabProps) {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.integrations.getGovernedActions({ service: connectorId, limit: 50 });
      if (res.success && res.data) setActions(res.data);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  }, [connectorId]);

  useEffect(() => { void load(); }, [load]);

  const handleResolved = useCallback(() => {
    void load();
    onApprovalResolved?.();
  }, [load, onApprovalResolved]);

  return (
    <div className="p-4">
      <GovernanceActivityFeed
        actions={actions}
        loading={loading}
        maxItems={50}
        emptyMessage="No Google Workspace activity yet. Actions will appear here once the integration is active."
        onApprovalResolved={handleResolved}
      />
    </div>
  );
}
