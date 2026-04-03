import { useCallback } from 'react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { UnifiedApp } from '../types';

interface UseAppActionsOptions {
  reload: () => Promise<void>;
  markConnected: (connectorId: string) => void;
  markDisconnected: (connectorId: string) => void;
  onPostConnect?: (app: UnifiedApp) => void;
}

export function useAppActions({ reload, markConnected, markDisconnected, onPostConnect }: UseAppActionsOptions) {
  const handleConnect = useCallback(async (app: UnifiedApp, creds: Record<string, string>) => {
    try {
      if (app.source === 'marketplace') {
        const res = await api.marketplace.install(app.appId, creds);
        const data = res.data as any;
        if (!res.success) {
          toast.error((res as any).error || 'Connection failed');
          return;
        }
        if (data?.authUrl) {
          window.location.href = data.authUrl;
          return;
        }
      } else if (app.authType === 'oauth2') {
        const res = await api.integrations.initOAuth(app.appId, '/dashboard/apps', creds, false);
        if (res.success && (res.data as any)?.url) {
          window.location.href = (res.data as any).url;
          return;
        }
        toast.error((res as any).error || 'Connection failed');
        return;
      } else {
        const res = await api.integrations.connect(app.appId, creds);
        if (!res.success) {
          toast.error((res as any).error || 'Connection failed');
          return;
        }
      }
      toast.success(`${app.name} connected`);
      markConnected(app.appId);
      onPostConnect?.(app);
    } catch (e: any) {
      toast.error(e?.message || 'Connection failed');
    }
  }, [markConnected, onPostConnect]);

  const handleDisconnect = useCallback(async (app: UnifiedApp) => {
    try {
      const res = app.source === 'marketplace'
        ? await api.marketplace.uninstall(app.appId)
        : await api.integrations.disconnect(app.appId);
      if (!res.success) throw new Error((res as any).error);
      markDisconnected(app.appId);
      toast.success(`${app.name} disconnected`);
      void reload();
    } catch (e: any) {
      toast.error(e.message || 'Disconnect failed');
    }
  }, [markDisconnected, reload]);

  const handleConfigure = useCallback(async (app: UnifiedApp, creds: Record<string, string>) => {
    try {
      if (app.source === 'marketplace') {
        if (app.authType === 'oauth2') {
          const res = await api.marketplace.install(app.appId, creds);
          const data = res.data as any;
          if (res.success && data?.authUrl) {
            window.location.href = data.authUrl;
            return;
          }
          throw new Error((res as any).error || 'Reauthorization failed');
        }
        const res = await api.marketplace.updateCredentials(app.appId, creds);
        if (!res.success) throw new Error((res as any).error);
        toast.success(`${app.name} credentials updated`);
        void reload();
        return;
      }
      if (app.authType === 'oauth2') {
        const res = await api.integrations.initOAuth(app.appId, '/dashboard/apps', creds, false);
        if (res.success && (res.data as any)?.url) {
          window.location.href = (res.data as any).url;
          return;
        }
        throw new Error((res as any).error || 'Reauthorization failed');
      }
      const res = await api.integrations.configure(app.appId, creds);
      if (!res.success) throw new Error((res as any).error);
      toast.success(`${app.name} credentials updated`);
      void reload();
    } catch (e: any) {
      toast.error(e.message || 'Configuration failed');
    }
  }, [reload]);

  const handleTest = useCallback(async (app: UnifiedApp) => {
    if (!app.supportsHealthTest) {
      return { success: true, skipped: true, unsupported: true } as any;
    }
    try {
      const res = app.source === 'marketplace'
        ? await api.marketplace.testConnection(app.appId)
        : await api.integrations.test(app.appId);
      if (res.success) {
        toast.success(`${app.name}: connection healthy`);
      } else {
        toast.error((res as any).error || 'Connection test failed');
      }
      return res.success;
    } catch (e: any) {
      toast.error(e.message || 'Connection test failed');
      return false;
    }
  }, []);

  const handleRefresh = useCallback(async (app: UnifiedApp) => {
    if (app.source === 'marketplace' || app.authType !== 'oauth2') return;
    try {
      const res = await api.integrations.refresh(app.appId);
      if (res.success) {
        toast.success(`${app.name}: token refreshed`);
        void reload();
      } else {
        toast.error((res as any).error || 'Token refresh failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Token refresh failed');
    }
  }, [reload]);

  const handleInitOAuth = useCallback(async (app: UnifiedApp) => {
    try {
      const res = app.source === 'marketplace'
        ? await api.marketplace.install(app.appId)
        : await api.integrations.initOAuth(app.appId, '/dashboard/apps', {}, false);
      const url = (res.data as any)?.url || (res.data as any)?.authUrl;
      if (res.success && url) {
        window.location.href = url;
      } else {
        toast.error((res as any).error || 'OAuth init failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'OAuth init failed');
    }
  }, []);

  return {
    handleConnect,
    handleDisconnect,
    handleConfigure,
    handleTest,
    handleRefresh,
    handleInitOAuth,
  };
}
