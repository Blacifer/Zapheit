import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Link2, Link2Off, Info, Loader2, Calendar, Bot, Clock, Users,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { SharedAutomationTab } from '../shared/SharedAutomationTab';

const CONNECTOR_ID = 'calendly';
const CALLBACK_URL = 'https://api.zapheit.com/integrations/oauth/callback/calendly';

const CALENDLY_TRIGGERS = {
  meeting_scheduled:  { label: 'Meeting scheduled',  description: 'Agent logs or notifies when a meeting is booked',         Icon: Calendar },
  meeting_cancelled:  { label: 'Meeting cancelled',  description: 'Agent follows up or reschedules when a meeting is cancelled', Icon: Clock },
  invitee_no_show:    { label: 'Invitee no-show',    description: 'Agent sends a follow-up when an invitee misses a meeting',  Icon: Users },
  reschedule_requested: { label: 'Reschedule requested', description: 'Agent coordinates rescheduling automatically',          Icon: Calendar },
};

const CALENDLY_EXAMPLES = [
  'List my upcoming meetings today',
  'Cancel meeting with john@example.com',
  'Show all no-shows from last week',
  'Get the booking link for my 30-min intro call',
];

type Tab = 'events' | 'event-types' | 'automation';

const TABS: { id: Tab; label: string; Icon: typeof Calendar }[] = [
  { id: 'events',      label: 'Upcoming Events', Icon: Calendar },
  { id: 'event-types', label: 'Event Types',     Icon: Clock },
  { id: 'automation',  label: 'Automation',      Icon: Bot },
];

interface CalendlyEvent {
  uri: string;
  name: string;
  start_time: string;
  end_time: string;
  status: string;
  invitees_counter: { total: number };
}

interface CalendlyEventType {
  uri: string;
  name: string;
  duration: number;
  slug: string;
  active: boolean;
  scheduling_url: string;
}

export default function CalendlyWorkspace() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('events');

  const [events, setEvents] = useState<CalendlyEvent[]>([]);
  const [eventTypes, setEventTypes] = useState<CalendlyEventType[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_event_types', { limit: 1 });
      setConnected(res.success);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_events', { count: 20, status: 'active' });
      if (res.success && res.data?.collection) setEvents(res.data.collection);
    } catch {
      /* silent */
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const loadEventTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_event_types', { count: 20 });
      if (res.success && res.data?.collection) setEventTypes(res.data.collection);
    } catch {
      /* silent */
    } finally {
      setLoadingTypes(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);

  useEffect(() => {
    if (!connected) return;
    if (activeTab === 'events') void loadEvents();
    if (activeTab === 'event-types') void loadEventTypes();
  }, [connected, activeTab, loadEvents, loadEventTypes]);

  const handleConnect = useCallback(() => {
    const url = api.integrations.getOAuthAuthorizeUrl('calendly', window.location.href);
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect Calendly? Scheduling automation will stop.')) return;
    try {
      await api.integrations.disconnect('calendly');
      setConnected(false);
      toast.success('Calendly disconnected');
    } catch {
      toast.error('Failed to disconnect Calendly');
    }
  }, []);

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div className="flex flex-col h-full bg-[#080b12]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8 shrink-0">
        <button
          onClick={() => navigate('/dashboard/apps')}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-[#006BFF] flex items-center justify-center shrink-0">
          <Calendar className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Calendly</h1>
          {!checking && connected !== null && (
            <div className="mt-0.5">
              <StatusBadge status={connected ? 'connected' : 'disconnected'} size="sm" />
            </div>
          )}
        </div>

        {checking && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}

        {!checking && connected && (
          <button
            onClick={() => void handleDisconnect()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 text-xs font-medium transition-colors"
          >
            <Link2Off className="w-3.5 h-3.5" />
            Disconnect
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-white/5 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              activeTab === t.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            <t.Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Not connected */}
        {!checking && !connected && (
          <div className="flex items-center justify-center p-8 h-full">
            <div className="w-full max-w-sm space-y-5">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl bg-[#006BFF] flex items-center justify-center mx-auto">
                  <Calendar className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-base font-semibold text-white">Connect Calendly</h2>
                <p className="text-sm text-slate-400">Authorize Zapheit to manage your scheduling and automate follow-ups.</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">OAuth 2.0</p>
                <div className="flex items-start gap-2 pt-1">
                  <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-slate-500">
                    Callback URL: <span className="font-mono text-slate-400">{CALLBACK_URL}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={handleConnect}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#006BFF] hover:bg-[#005ce0] text-white text-sm font-semibold transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Connect Calendly with OAuth
              </button>
            </div>
          </div>
        )}

        {/* Checking */}
        {checking && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Checking connection…</span>
            </div>
          </div>
        )}

        {/* Events tab */}
        {!checking && connected && activeTab === 'events' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Upcoming Events</h2>
              <button onClick={() => void loadEvents()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>

            {showBanner && <AgentSuggestionBanner serviceId="calendly" onDismiss={() => setShowBanner(false)} />}

            {loadingEvents ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : events.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="No upcoming events"
                description="Your scheduled Calendly meetings will appear here."
              />
            ) : (
              <div className="space-y-2">
                {events.map((ev) => (
                  <div key={ev.uri} className="rounded-lg border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#006BFF]/20 border border-[#006BFF]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Calendar className="w-4 h-4 text-[#006BFF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{ev.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{fmtDateTime(ev.start_time)} → {fmtDateTime(ev.end_time)}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-medium',
                          ev.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400',
                        )}>
                          {ev.status}
                        </span>
                        <span className="text-[10px] text-slate-500">{ev.invitees_counter?.total ?? 0} invitee(s)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Event Types tab */}
        {!checking && connected && activeTab === 'event-types' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Event Types</h2>
              <button onClick={() => void loadEventTypes()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>
            {loadingTypes ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : eventTypes.length === 0 ? (
              <EmptyState icon={Clock} title="No event types found" description="Your Calendly event templates will appear here." />
            ) : (
              <div className="grid gap-2">
                {eventTypes.map((et) => (
                  <div key={et.uri} className="rounded-lg border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#006BFF]/20 border border-[#006BFF]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="w-4 h-4 text-[#006BFF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{et.name}</p>
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                          et.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400',
                        )}>
                          {et.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{et.duration} min · /{et.slug}</p>
                      {et.scheduling_url && (
                        <a
                          href={et.scheduling_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[#006BFF] hover:text-blue-300 mt-1 inline-block transition-colors"
                        >
                          {et.scheduling_url}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Automation tab */}
        {!checking && connected && activeTab === 'automation' && (
          <SharedAutomationTab
            connectorId="calendly"
            triggerTypes={CALENDLY_TRIGGERS}
            nlExamples={CALENDLY_EXAMPLES}
            accentColor="cyan"
          />
        )}
      </div>
    </div>
  );
}
