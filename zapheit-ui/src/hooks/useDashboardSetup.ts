import { useState, useCallback, useEffect } from 'react';
import type { AIAgent, Incident } from '../types';
import type { CoverageNotificationPayload } from '../pages/dashboard/types';

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseDashboardSetupProps {
  orgName: string | null | undefined;
  isDemoMode: boolean;
  agents: AIAgent[];
  incidents: Incident[];
  loading: boolean;
  coverageStatus: CoverageNotificationPayload | null;
}

export function useDashboardSetup({
  orgName,
  isDemoMode,
  agents,
  incidents,
  loading,
  coverageStatus,
}: UseDashboardSetupProps) {
  const scope = orgName || 'workspace';
  const setupBarDismissKey = `synthetic_hr_setup_bar_dismissed:${scope}`;
  const lastVisitKey = `synthetic_hr_last_visit:${scope}`;

  const [setupBarDismissed, setSetupBarDismissed] = useState(() =>
    typeof window !== 'undefined' ? Boolean(localStorage.getItem(setupBarDismissKey)) : false,
  );
  const [whatsNewDismissed, setWhatsNewDismissed] = useState(false);
  const [whatsNewData, setWhatsNewData] = useState<{
    newIncidents: number;
    openIncidents: number;
    agentCount: number;
    prevAgentCount: number;
    hoursAway: number;
  } | null>(null);

  // Record visit + compute "what's new" delta on first data load
  useEffect(() => {
    if (loading || isDemoMode) return;
    const now = Date.now();
    const lastVisitStr = localStorage.getItem(lastVisitKey);
    const lastVisit = lastVisitStr ? parseInt(lastVisitStr, 10) : 0;
    const hoursAway = lastVisit ? (now - lastVisit) / 3600000 : 0;

    if (hoursAway > 24 && lastVisit) {
      const newIncidents = incidents.filter((i) => new Date(i.created_at).getTime() > lastVisit).length;
      const openIncidents = incidents.filter((i) => i.status === 'open').length;
      const prevAgentCount = parseInt(localStorage.getItem(`${lastVisitKey}:agents`) || '0', 10);
      setWhatsNewData({ newIncidents, openIncidents, agentCount: agents.length, prevAgentCount, hoursAway: Math.round(hoursAway) });
    }

    localStorage.setItem(lastVisitKey, String(now));
    localStorage.setItem(`${lastVisitKey}:agents`, String(agents.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const onboardingDismissedKey = `synthetic_hr_onboarding_dismissed:${scope}`;
  const onboardingCompletedKey = `synthetic_hr_onboarding_completed:${scope}`;
  const onboardingDismissed = typeof window !== 'undefined' ? Boolean(localStorage.getItem(onboardingDismissedKey)) : false;
  const onboardingCompleted = typeof window !== 'undefined' ? Boolean(localStorage.getItem(onboardingCompletedKey)) : false;

  const needsOnboarding = Boolean(
    !isDemoMode
    && !onboardingCompleted
    && !onboardingDismissed
    && (
      (coverageStatus?.agents?.total ?? agents.length) === 0
      || (coverageStatus?.telemetry?.gatewayObserved === false)
    ),
  );

  const dismissSetupBar = useCallback(() => {
    localStorage.setItem(setupBarDismissKey, '1');
    setSetupBarDismissed(true);
  }, [setupBarDismissKey]);

  return {
    setupBarDismissed,
    whatsNewDismissed,
    setWhatsNewDismissed,
    whatsNewData,
    needsOnboarding,
    dismissSetupBar,
  };
}
