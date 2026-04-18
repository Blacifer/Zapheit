import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../../../lib/api-client';
import { GovernanceActivityFeed } from '../shared';

interface M365ActivityTabProps {
  onApprovalResolved?: () => void;
}

export function M365ActivityTab({ onApprovalResolved }: M365ActivityTabProps) {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.integrations.getGovernedActions({ service: 'microsoft-365', limit: 50 });
      if (res.success && res.data) setActions(res.data);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  }, []);

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
        emptyMessage="No Microsoft 365 activity yet. Actions will appear here once the integration is active."
        onApprovalResolved={handleResolved}
      />
    </div>
  );
}
