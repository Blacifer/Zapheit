import { useEffect, useState } from 'react';
import { Joyride, EVENTS, type Step, type EventData } from 'react-joyride';

const TOUR_STORAGE_KEY = 'rasi_tour_completed';

const TOUR_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to Rasi',
    content:
      'Rasi is your AI agent control plane — manage, monitor, and govern every AI agent in your organization. This quick tour will show you the key features.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="agents"]',
    placement: 'right',
    title: 'Agent Fleet',
    content:
      'View and manage all your AI agents here. Monitor live status, start / stop agents, and inspect reasoning traces.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="apps"]',
    placement: 'right',
    title: 'App Marketplace',
    content:
      'Browse and install 100+ pre-built AI app integrations — from Slack and Gmail to Jira, Salesforce, and more.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="playbooks"]',
    placement: 'right',
    title: 'Playbooks',
    content:
      'Build automated AI workflows. Use the text-based builder or the new drag-and-drop Visual Builder to chain LLM steps, conditions, and tool calls.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="approvals"]',
    placement: 'right',
    title: 'Human-in-the-Loop Approvals',
    content:
      'Any high-risk agent action can be routed here for human review. Approve, deny, snooze, or escalate — with ML risk scoring and SLA tracking.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="incidents"]',
    placement: 'right',
    title: 'Incident Detection',
    content:
      'Rasi automatically detects anomalies, PII leaks, hallucinations, and unusual agent behavior. Investigate with full reasoning traces.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="costs"]',
    placement: 'right',
    title: 'Cost Tracking',
    content:
      'Track token usage and spend per agent, model, and time period. Set budgets and get alerted when agents exceed thresholds.',
    skipBeacon: true,
  },
  {
    target: '[data-tour="settings"]',
    placement: 'right',
    title: "You're all set!",
    content:
      'Configure your organization, invite team members, set up webhooks, and manage API keys in Settings. You can re-launch this tour any time from the Help menu.',
    skipBeacon: true,
  },
];

type Props = {
  /** Force the tour to start (e.g. triggered from Help menu) */
  forceStart?: boolean;
  onFinish?: () => void;
};

export function OnboardingTour({ forceStart, onFinish }: Props) {
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (forceStart) {
      setRun(true);
      return undefined;
    }
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      // Small delay so the page layout settles before the tour starts
      const t = setTimeout(() => setRun(true), 800);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [forceStart]);

  const handleEvent = (data: EventData, controls: { next: () => void }) => {
    if (data.type === EVENTS.TOUR_END) {
      localStorage.setItem(TOUR_STORAGE_KEY, '1');
      setRun(false);
      onFinish?.();
    }
    // If a sidebar element hasn't rendered yet, skip to the next step
    if (data.type === EVENTS.TARGET_NOT_FOUND) {
      controls.next();
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={TOUR_STEPS}
      run={run}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      options={{
        buttons: ['back', 'primary', 'skip'],
        overlayColor: 'rgba(0,0,0,0.55)',
        primaryColor: '#0891b2',
        backgroundColor: '#1e293b',
        textColor: '#e2e8f0',
        arrowColor: '#1e293b',
        zIndex: 10000,
        showProgress: true,
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Done',
        next: 'Next',
        open: 'Open',
        skip: 'Skip tour',
      }}
    />
  );
}

/** Call this from a Help menu button to re-trigger the tour */
export function clearTourCompletion() {
  localStorage.removeItem(TOUR_STORAGE_KEY);
}
