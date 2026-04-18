import { useState, useCallback } from 'react';
import type { DashboardNotification, CoverageNotificationPayload } from '../pages/dashboard/types';

// ── Storage helpers ───────────────────────────────────────────────────────────

const COVERAGE_FOCUS_STORAGE_KEY = 'synthetic_hr_coverage_focus';

function getNotificationReadStorageKey(orgName?: string | null) {
  return `synthetic_hr_notification_reads:${orgName || 'workspace'}`;
}

export function readNotificationState(orgName?: string | null): Set<string> {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = localStorage.getItem(getNotificationReadStorageKey(orgName));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

export function writeNotificationState(orgName: string | null | undefined, ids: Iterable<string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getNotificationReadStorageKey(orgName), JSON.stringify(Array.from(ids)));
}

// ── buildCoverageNotifications ────────────────────────────────────────────────

export function buildCoverageNotifications(
  coverage: CoverageNotificationPayload | undefined,
  readIds: Set<string>,
): DashboardNotification[] {
  if (!coverage) return [];

  const sentNotifications = (coverage.reconciliationNotifications?.history || []).map((entry) => ({
    id: `recon:${entry.id}`,
    type: entry.severity === 'critical' ? 'error' as const : 'warning' as const,
    title: entry.title,
    message: entry.message,
    timestamp: entry.sentAt,
    read: readIds.has(`recon:${entry.id}`),
    source: 'reconciliation' as const,
  }));

  const activeAlerts = (coverage.reconciliationAlerts || []).map((alert) => {
    const id = `active:${alert.code}:${alert.provider}`;
    return {
      id,
      type: alert.severity === 'critical'
        ? 'error' as const
        : alert.severity === 'warning'
          ? 'warning' as const
          : 'info' as const,
      title: alert.title,
      message: alert.message,
      timestamp: coverage.generatedAt,
      read: readIds.has(id),
      source: 'reconciliation' as const,
    };
  });

  if (coverage.reconciliationAlertConfig?.channels?.inApp === false) return [];

  const deduped = new Map<string, DashboardNotification>();
  [...activeAlerts, ...sentNotifications]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .forEach((n) => {
      const key = `${n.title}::${n.message}`;
      const existing = deduped.get(key);
      if (!existing) { deduped.set(key, n); return; }
      const preferred = new Date(n.timestamp).getTime() >= new Date(existing.timestamp).getTime() ? n : existing;
      deduped.set(key, { ...preferred, read: existing.read && n.read });
    });

  return Array.from(deduped.values())
    .sort((a, b) => {
      const sev = (n: DashboardNotification) => n.type === 'error' ? 0 : n.type === 'warning' ? 1 : 2;
      const readDiff = (a.read ? 1 : 0) - (b.read ? 1 : 0);
      if (readDiff !== 0) return readDiff;
      const sevDiff = sev(a) - sev(b);
      if (sevDiff !== 0) return sevDiff;
      const srcDiff = (a.source === 'reconciliation' ? 0 : 1) - (b.source === 'reconciliation' ? 0 : 1);
      if (srcDiff !== 0) return srcDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, 50);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseDashboardNotificationsProps {
  orgName: string | null | undefined;
  navigateTo: (page: string, options?: { userInitiated?: boolean }) => void;
}

export function useDashboardNotifications({ orgName, navigateTo }: UseDashboardNotificationsProps) {
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [coverageStatus, setCoverageStatus] = useState<CoverageNotificationPayload | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const addNotification = useCallback((type: string, title: string, message: string) => {
    const newNotification: DashboardNotification = {
      id: crypto.randomUUID(),
      type: type === 'error' ? 'error' : type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'info',
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      source: 'local',
    };
    setNotifications((prev) => {
      const updated = [newNotification, ...prev].slice(0, 50);
      writeNotificationState(orgName, new Set(updated.filter((n) => n.read).map((n) => n.id)));
      return updated;
    });
  }, [orgName]);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => n.id === id ? { ...n, read: true } : n);
      writeNotificationState(orgName, new Set(updated.filter((n) => n.read).map((n) => n.id)));
      return updated;
    });
  }, [orgName]);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      writeNotificationState(orgName, updated.map((n) => n.id));
      return updated;
    });
  }, [orgName]);

  const clearNotifications = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      writeNotificationState(orgName, updated.map((n) => n.id));
      return updated;
    });
  }, [orgName]);

  const openCoverageFromNotification = useCallback((notification: DashboardNotification) => {
    markAsRead(notification.id);
    if (notification.source === 'reconciliation') {
      localStorage.setItem(COVERAGE_FOCUS_STORAGE_KEY, JSON.stringify({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        timestamp: notification.timestamp,
      }));
    }
    navigateTo('coverage', { userInitiated: false });
    setShowNotificationPanel(false);
  }, [markAsRead, navigateTo]);

  return {
    notifications,
    setNotifications,
    showNotificationPanel,
    setShowNotificationPanel,
    coverageStatus,
    setCoverageStatus,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    openCoverageFromNotification,
  };
}
