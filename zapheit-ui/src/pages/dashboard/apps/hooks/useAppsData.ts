import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../../../lib/api-client';
import type { AIAgent } from '../../../../types';
import type { UnifiedApp } from '../types';
import { fromUnifiedConnectorEntry, getAppServiceId } from '../helpers';
import { FEATURED_IDS, CATEGORIES } from '../constants';

export function useAppsData(agents: AIAgent[] = []) {
  const [rawCatalog, setRawCatalog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks services just connected via OAuth — survives subsequent reloads for 15 s
  const pinnedConnected = useRef<Set<string>>(new Set());

  const applyPins = useCallback((entries: any[]) =>
    entries.map((entry) => {
      const entryId = entry.app_key || entry.id;
      if (pinnedConnected.current.has(entryId) && !entry.is_connected) {
        return {
          ...entry,
          installed: true,
          is_connected: true,
          connectionStatus: 'connected',
          connection_status: 'connected',
          health_status: 'healthy',
        };
      }
      return entry;
    }),
  []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const catalogRes = await api.unifiedConnectors.getCatalog();
      if (catalogRes.success && Array.isArray(catalogRes.data)) {
        setRawCatalog(applyPins(catalogRes.data));
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [applyPins]);

  useEffect(() => { void loadData(); }, [loadData]);

  const allApps = useMemo<UnifiedApp[]>(() => rawCatalog.map(fromUnifiedConnectorEntry), [rawCatalog]);

  const connectedList = useMemo(() => allApps.filter((app) => app.connected), [allApps]);
  const browseList = useMemo(() => allApps, [allApps]);

  const myApps = useMemo(() => connectedList, [connectedList]);

  const featured = useMemo(() =>
    FEATURED_IDS.map((id) => browseList.find((a) => a.appId === id)).filter(Boolean) as UnifiedApp[],
  [browseList]);

  const categoryApps = useCallback((catId: string) =>
    browseList.filter((a) => {
      const cat = CATEGORIES.find((c) => c.id === catId);
      return cat ? a.category.toLowerCase() === cat.apiCategory : false;
    }),
  [browseList]);

  const agentNamesFor = useCallback((app: UnifiedApp): string[] => {
    const serviceId = getAppServiceId(app);
    return agents.filter((a) => (a as any).integrationIds?.includes(serviceId)).map((a) => a.name);
  }, [agents]);

  // Stats
  const totalActions = connectedList.reduce((s, c) => s + (c.governanceSummary?.enabledActionCount || c.actionsUnlocked?.length || 0), 0);
  const errorCount = connectedList.filter((c) => c.status === 'error' || c.status === 'expired').length;
  const governedCount = connectedList.filter((c) => c.maturity === 'governed').length;

  const markConnected = useCallback((connectorId: string) => {
    // Pin so subsequent loadData calls don't flip it back to disconnected
    pinnedConnected.current.add(connectorId);
    setTimeout(() => pinnedConnected.current.delete(connectorId), 15_000);
    setRawCatalog((prev) =>
      prev.map((entry) => {
        const entryId = entry.app_key || entry.id;
        if (entryId !== connectorId) return entry;
        return {
          ...entry,
          installed: true,
          is_connected: true,
          connectionStatus: 'connected',
          connection_status: 'connected',
          health_status: 'healthy',
        };
      }),
    );
  }, []);

  const markDisconnected = useCallback((connectorId: string) => {
    pinnedConnected.current.delete(connectorId);
    const aliases = new Set([connectorId, connectorId.replace(/_/g, '-'), connectorId.replace(/-/g, '_')]);
    setRawCatalog((prev) =>
      prev.map((entry) => {
        const entryId = entry.app_key || entry.id;
        if (!aliases.has(entryId)) return entry;
        return {
          ...entry,
          installed: false,
          is_connected: false,
          connectionStatus: 'disconnected',
          connection_status: 'disconnected',
          health_status: 'not_connected',
          lastErrorMsg: null,
          last_test_result: null,
        };
      }),
    );
  }, []);

  return {
    allApps, browseList, connectedList, myApps, featured,
    loading, reload: loadData, markConnected, markDisconnected,
    categoryApps, agentNamesFor,
    totalActions, errorCount, governedCount,
  };
}
