import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Mail, Calendar, HardDrive,
  Activity, Bot, RefreshCw, Loader2, Link2, Link2Off, Info,
} from 'lucide-react';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge } from '../shared';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';
import { EmailList, type GmailMessage } from './EmailList';
import { CalendarView, type CalendarEvent } from './CalendarView';
import { DriveFiles, type DriveFile, type AgentTouch } from './DriveFiles';
import { GoogleActivityTab } from './GoogleActivityTab';
import { GoogleAutomationTab } from './GoogleAutomationTab';

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'email',      label: 'Email',      Icon: Mail },
  { id: 'calendar',   label: 'Calendar',   Icon: Calendar },
  { id: 'activity',   label: 'Activity',   Icon: Activity },
  { id: 'automation', label: 'Automation', Icon: Bot },
  { id: 'drive',      label: 'Drive',      Icon: HardDrive },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const CONNECTOR_ID = 'google_workspace';

export default function GoogleWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('email');

  /* Data state */
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [emailsNextPageToken, setEmailsNextPageToken] = useState<string | null>(null);
  const [loadingMoreEmails, setLoadingMoreEmails] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [filesNextPageToken, setFilesNextPageToken] = useState<string | null>(null);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  /* Approvals */
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);

  /* Agent activity map for Drive attribution: fileId → touches */
  const [agentActivity, setAgentActivity] = useState<Record<string, AgentTouch[]>>({});

  /* Loading */
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showBanner, setShowBanner] = useState(true);

  /* --------------------------------------------------------------- */
  /*  Data loaders                                                     */
  /* --------------------------------------------------------------- */

  const loadEmails = useCallback(async () => {
    setLoadingEmails(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_emails', { maxResults: 50 });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setEmails(payload.data);
        setEmailsNextPageToken(payload.nextPageToken ?? null);
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('disconnected');
      }
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setLoadingEmails(false);
    }
  }, []);

  const loadMoreEmails = useCallback(async () => {
    if (!emailsNextPageToken || loadingMoreEmails) return;
    setLoadingMoreEmails(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_emails', { maxResults: 50, pageToken: emailsNextPageToken });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setEmails((prev) => [...prev, ...payload.data]);
        setEmailsNextPageToken(payload.nextPageToken ?? null);
      }
    } catch { /* empty */ }
    finally { setLoadingMoreEmails(false); }
  }, [emailsNextPageToken, loadingMoreEmails]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_events', { maxResults: 50 });
      if (res.success && res.data?.data) setEvents(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingEvents(false); }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_files', { pageSize: 50 });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setFiles(payload.data);
        setFilesNextPageToken(payload.nextPageToken ?? null);
      }
    } catch { /* empty */ }
    finally { setLoadingFiles(false); }
  }, []);

  const loadMoreFiles = useCallback(async () => {
    if (!filesNextPageToken || loadingMoreFiles) return;
    setLoadingMoreFiles(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_files', { pageSize: 50, pageToken: filesNextPageToken });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setFiles((prev) => [...prev, ...payload.data]);
        setFilesNextPageToken(payload.nextPageToken ?? null);
      }
    } catch { /* empty */ }
    finally { setLoadingMoreFiles(false); }
  }, [filesNextPageToken, loadingMoreFiles]);

  const loadApprovals = useCallback(async () => {
    try {
      const res = await api.approvals.list({ service: CONNECTOR_ID, status: 'pending', limit: 50 });
      if (res.success && res.data) setPendingApprovals(res.data);
    } catch { /* empty */ }
  }, []);

  const loadAgentActivity = useCallback(async () => {
    try {
      const res = await api.integrations.getGovernedActions({ service: CONNECTOR_ID, limit: 100 });
      if (!res.success || !res.data) return;
      const map: Record<string, AgentTouch[]> = {};
      for (const row of res.data as any[]) {
        const params = row.params as Record<string, any> | undefined;
        const fileId = params?.fileId ?? params?.documentId;
        if (!fileId) continue;
        const actor = (row.governance as any)?.requested_by ?? row.requested_by ?? 'AI Agent';
        if (!map[fileId]) map[fileId] = [];
        map[fileId].push({ actor, action: row.action, ts: row.created_at });
      }
      setAgentActivity(map);
    } catch { /* empty */ }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                    */
  /* --------------------------------------------------------------- */

  const createEvent = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'create_event', data);
      if (res.success) {
        if ((res as any).pending) {
          toast.info((res as any).message || 'Event sent for approval');
          void loadApprovals();
        } else {
          toast.success('Event created');
          void loadEvents();
        }
      } else {
        toast.error(res.error || 'Failed to create event');
      }
    } catch { toast.error('Network error'); }
  }, [loadApprovals, loadEvents]);

  const updateEvent = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'update_event', data);
      if (res.success) {
        if ((res as any).pending) {
          toast.info((res as any).message || 'Event update sent for approval');
          void loadApprovals();
        } else {
          toast.success('Event updated');
          void loadEvents();
        }
      } else {
        toast.error(res.error || 'Failed to update event');
      }
    } catch { toast.error('Network error'); }
  }, [loadApprovals, loadEvents]);

  const cancelEvent = useCallback(async (eventId: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'cancel_event', { eventId });
      if (res.success) {
        if ((res as any).pending) {
          toast.info((res as any).message || 'Cancellation sent for approval');
          void loadApprovals();
        } else {
          toast.success('Event cancelled');
          void loadEvents();
        }
      } else {
        toast.error(res.error || 'Failed to cancel event');
      }
    } catch { toast.error('Network error'); }
  }, [loadApprovals, loadEvents]);

  const shareFile = useCallback(async (fileId: string, email: string, role: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'share_file', { fileId, email, role });
      if (res.success) {
        toast.success('File shared');
      } else {
        toast.error(res.error || 'Failed to share file');
      }
    } catch { toast.error('Network error'); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Approval resolution                                              */
  /* --------------------------------------------------------------- */

  const handleApprovalResolved = useCallback((id: string) => {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
    // Refresh underlying data so the action shows executed state
    void loadEmails();
    void loadEvents();
    void loadFiles();
  }, [loadEmails, loadEvents, loadFiles]);

  /* --------------------------------------------------------------- */
  /*  Lifecycle                                                        */
  /* --------------------------------------------------------------- */

  /* Initial load */
  useEffect(() => {
    void loadEmails();
    void loadApprovals();
    void loadAgentActivity();
  }, [loadEmails, loadApprovals, loadAgentActivity]);

  /* Load tab data on switch */
  useEffect(() => {
    if (activeTab === 'calendar' && events.length === 0) void loadEvents();
    if (activeTab === 'drive' && files.length === 0) void loadFiles();
  }, [activeTab, events.length, files.length, loadEvents, loadFiles]);

  const handleConnect = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const url = api.integrations.getOAuthAuthorizeUrl(CONNECTOR_ID, returnTo);
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect Google Workspace? Gmail, Calendar, and Drive sync will stop.')) return;
    try {
      await api.integrations.disconnect(CONNECTOR_ID);
      setConnectionStatus('disconnected');
      setEmails([]);
      setEmailsNextPageToken(null);
      setEvents([]);
      setFiles([]);
      setFilesNextPageToken(null);
      setPendingApprovals([]);
      setAgentActivity({});
      toast.success('Google Workspace disconnected');
    } catch {
      toast.error('Failed to disconnect Google Workspace');
    }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                          */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    void loadApprovals();
    if (activeTab === 'email') void loadEmails();
    else if (activeTab === 'calendar') void loadEvents();
    else if (activeTab === 'drive') { void loadFiles(); void loadAgentActivity(); }
  }, [activeTab, loadEmails, loadEvents, loadFiles, loadApprovals, loadAgentActivity]);

  const isLoading = loadingEmails || loadingEvents || loadingFiles;

  /* Pending counts per tab */
  const emailPendingCount  = pendingApprovals.filter((a) => ['send_email', 'reply_email', 'forward_email'].includes(a.action)).length;
  const calendarPendingCount = pendingApprovals.filter((a) => ['create_event', 'cancel_event'].includes(a.action)).length;
  const drivePendingCount  = pendingApprovals.filter((a) => a.action === 'share_file').length;
  const totalPending = pendingApprovals.length;

  const pendingCountFor = (tabId: TabId) => {
    if (tabId === 'email') return emailPendingCount;
    if (tabId === 'calendar') return calendarPendingCount;
    if (tabId === 'drive') return drivePendingCount;
    return 0;
  };

  /* --------------------------------------------------------------- */
  /*  Render                                                           */
  /* --------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <button
          onClick={() => navigate('/dashboard/apps')}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-red-500 flex items-center justify-center text-white font-bold text-sm">
          G
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Google Workspace</h1>
            <StatusBadge status={connectionStatus} />
            {totalPending > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/25">
                {totalPending} pending
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">Phase 1 — Gmail and Calendar operate directly inside Zapheit. Drive remains available but secondary.</p>
        </div>

        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' && (
            <button
              onClick={() => void handleDisconnect()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 text-xs font-medium transition-colors"
            >
              <Link2Off className="w-3.5 h-3.5" />
              Disconnect
            </button>
          )}
          {connectionStatus === 'disconnected' && (
            <button
              onClick={handleConnect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4285F4] hover:bg-[#5a95f5] text-white text-xs font-medium transition-colors"
            >
              <Link2 className="w-3.5 h-3.5" />
              Connect Google Workspace
            </button>
          )}
          <button
            onClick={refreshCurrent}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors disabled:opacity-40"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      {connectionStatus === 'disconnected' ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-sm space-y-5">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-red-500 flex items-center justify-center mx-auto text-white text-xl font-bold">
                G
              </div>
              <h2 className="text-base font-semibold text-white">Connect Google Workspace</h2>
              <p className="text-sm text-slate-400">Authorize Zapheit to access Gmail, Calendar, and Drive for this workspace.</p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Permissions requested</p>
              <div className="flex flex-wrap gap-2">
                {['openid', 'email', 'gmail.modify', 'gmail.send', 'calendar'].map((scope) => (
                  <span key={scope} className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-slate-300 font-mono">{scope}</span>
                ))}
              </div>
              <div className="flex items-start gap-2 pt-1">
                <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-slate-500">
                  Callback URL:{' '}
                  <span className="font-mono text-slate-400">https://api.zapheit.com/api/integrations/oauth/callback/google_workspace</span>
                </p>
              </div>
            </div>

            <button
              onClick={handleConnect}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#4285F4] hover:bg-[#5a95f5] text-white text-sm font-semibold transition-colors"
            >
              <Link2 className="w-4 h-4" />
              Connect Google Workspace with OAuth
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-0.5 px-5 py-1.5 border-b border-white/5 shrink-0 overflow-x-auto">
            {TABS.map(({ id, label, Icon }) => {
              const count = pendingCountFor(id);
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
                    activeTab === id
                      ? 'bg-white/[0.08] text-white'
                      : id === 'drive'
                        ? 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.03]'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                  {count > 0 && (
                    <span className="ml-0.5 text-[9px] px-1 py-0.5 rounded-full bg-amber-500/30 text-amber-400 font-bold leading-none">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Agent suggestion banner */}
          {showBanner && (
            <div className="px-5 pt-3 shrink-0">
              <AgentSuggestionBanner serviceId="google-workspace" onDismiss={() => setShowBanner(false)} />
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'email' ? (
            <div className="flex-1 overflow-hidden">
              <EmailList
                emails={emails}
                loading={loadingEmails}
                pendingApprovals={pendingApprovals.filter((a) => ['send_email', 'reply_email', 'forward_email'].includes(a.action))}
                onApprovalResolved={handleApprovalResolved}
                hasMore={!!emailsNextPageToken}
                loadingMore={loadingMoreEmails}
                onLoadMore={loadMoreEmails}
                onEmailActionComplete={refreshCurrent}
              />
            </div>
          ) : activeTab === 'calendar' ? (
            <div className="flex-1 overflow-hidden">
              <CalendarView
                events={events}
                loading={loadingEvents}
                onCreate={createEvent}
                onUpdate={updateEvent}
                onCancelEvent={cancelEvent}
                pendingApprovals={pendingApprovals.filter((a) => ['create_event', 'cancel_event'].includes(a.action))}
                onApprovalResolved={handleApprovalResolved}
              />
            </div>
          ) : activeTab === 'drive' ? (
            <div className="flex-1 overflow-hidden">
              <DriveFiles
                files={files}
                loading={loadingFiles}
                onShare={shareFile}
                pendingApprovals={pendingApprovals.filter((a) => a.action === 'share_file')}
                onApprovalResolved={handleApprovalResolved}
                agentActivity={agentActivity}
                hasMore={!!filesNextPageToken}
                loadingMore={loadingMoreFiles}
                onLoadMore={loadMoreFiles}
              />
            </div>
          ) : activeTab === 'activity' ? (
            <div className="flex-1 overflow-y-auto">
              <GoogleActivityTab onApprovalResolved={loadApprovals} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <GoogleAutomationTab />
            </div>
          )}
        </>
      )}
    </div>
  );
}
