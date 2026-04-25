import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Calendar, HardDrive, MessageSquare, Activity, Bot, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';
import { OutlookEmail, type OutlookMessage } from './OutlookEmail';
import { OutlookCalendar, type OutlookEvent } from './OutlookCalendar';
import { OneDriveFiles, type OneDriveFile, type AgentTouch } from './OneDriveFiles';
import { TeamsTab, type MsTeam } from './TeamsTab';
import { M365ActivityTab } from './M365ActivityTab';
import { M365AutomationTab } from './M365AutomationTab';

const CONNECTOR_ID = 'microsoft-365';

/* ------------------------------------------------------------------ */
/*  Tab config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'email',      label: 'Outlook',   Icon: Mail },
  { id: 'calendar',   label: 'Calendar',  Icon: Calendar },
  { id: 'files',      label: 'OneDrive',  Icon: HardDrive },
  { id: 'teams',      label: 'Teams',     Icon: MessageSquare },
  { id: 'activity',   label: 'Activity',  Icon: Activity },
  { id: 'automation', label: 'Automation',Icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Microsoft365() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('email');
  const [showBanner, setShowBanner] = useState(true);

  /* Email */
  const [emails, setEmails] = useState<OutlookMessage[]>([]);
  const [emailsNextToken, setEmailsNextToken] = useState<string | null>(null);
  const [loadingMoreEmails, setLoadingMoreEmails] = useState(false);
  const [loadingEmails, setLoadingEmails] = useState(false);

  /* Calendar */
  const [events, setEvents] = useState<OutlookEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  /* OneDrive */
  const [files, setFiles] = useState<OneDriveFile[]>([]);
  const [filesNextToken, setFilesNextToken] = useState<string | null>(null);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  /* Teams */
  const [teams, setTeams] = useState<MsTeam[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);

  /* Connection + approvals */
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);

  /* Agent activity map for OneDrive attribution */
  const [agentActivity, setAgentActivity] = useState<Record<string, AgentTouch[]>>({});

  /* --------------------------------------------------------------- */
  /*  Loaders                                                         */
  /* --------------------------------------------------------------- */

  const loadEmails = useCallback(async () => {
    setLoadingEmails(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_emails', { maxResults: 50 });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setEmails(payload.data);
        setEmailsNextToken(payload.nextPageToken ?? null);
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
    if (!emailsNextToken || loadingMoreEmails) return;
    setLoadingMoreEmails(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_emails', { maxResults: 50, skipToken: emailsNextToken });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setEmails((prev) => [...prev, ...payload.data]);
        setEmailsNextToken(payload.nextPageToken ?? null);
      }
    } catch { /* empty */ }
    finally { setLoadingMoreEmails(false); }
  }, [emailsNextToken, loadingMoreEmails]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_calendar_events', { limit: 50 });
      const payload = res.data as any;
      if (res.success && payload?.data) setEvents(payload.data);
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
        setFilesNextToken(payload.nextPageToken ?? null);
      }
    } catch { /* empty */ }
    finally { setLoadingFiles(false); }
  }, []);

  const loadMoreFiles = useCallback(async () => {
    if (!filesNextToken || loadingMoreFiles) return;
    setLoadingMoreFiles(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_files', { pageSize: 50, skipToken: filesNextToken });
      const payload = res.data as any;
      if (res.success && payload?.data) {
        setFiles((prev) => [...prev, ...payload.data]);
        setFilesNextToken(payload.nextPageToken ?? null);
      }
    } catch { /* empty */ }
    finally { setLoadingMoreFiles(false); }
  }, [filesNextToken, loadingMoreFiles]);

  const loadTeams = useCallback(async () => {
    setLoadingTeams(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_teams', {});
      const payload = res.data as any;
      if (res.success && payload?.data) setTeams(payload.data);
    } catch { /* empty */ }
    finally { setLoadingTeams(false); }
  }, []);

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
        const fileId = params?.fileId ?? params?.id;
        if (!fileId) continue;
        const actor = (row.governance as any)?.requested_by ?? row.requested_by ?? 'AI Agent';
        if (!map[fileId]) map[fileId] = [];
        map[fileId].push({ actor, action: row.action, ts: row.created_at });
      }
      setAgentActivity(map);
    } catch { /* empty */ }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                   */
  /* --------------------------------------------------------------- */

  const createEvent = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'create_calendar_event', data);
      if (res.success) {
        toast.success('Event created');
        void loadEvents();
      } else {
        toast.error((res as any).error || 'Failed to create event');
      }
    } catch { toast.error('Network error'); }
  }, [loadEvents]);

  const shareFile = useCallback(async (fileId: string, email: string, role: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'share_file', { fileId, email, role });
      if (res.success) {
        toast.success('File shared');
      } else {
        toast.error((res as any).error || 'Failed to share file');
      }
    } catch { toast.error('Network error'); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Approval resolution                                             */
  /* --------------------------------------------------------------- */

  const handleApprovalResolved = useCallback((id: string) => {
    setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
    void loadEmails();
    void loadEvents();
    void loadFiles();
  }, [loadEmails, loadEvents, loadFiles]);

  /* --------------------------------------------------------------- */
  /*  Lifecycle                                                       */
  /* --------------------------------------------------------------- */

  useEffect(() => {
    void loadEmails();
    void loadApprovals();
    void loadAgentActivity();
  }, [loadEmails, loadApprovals, loadAgentActivity]);

  useEffect(() => {
    if (activeTab === 'calendar' && events.length === 0) void loadEvents();
    if (activeTab === 'files' && files.length === 0) { void loadFiles(); }
    if (activeTab === 'teams' && teams.length === 0) void loadTeams();
  }, [activeTab, events.length, files.length, teams.length, loadEvents, loadFiles, loadTeams]);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                         */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    void loadApprovals();
    if (activeTab === 'email') void loadEmails();
    else if (activeTab === 'calendar') void loadEvents();
    else if (activeTab === 'files') { void loadFiles(); void loadAgentActivity(); }
    else if (activeTab === 'teams') void loadTeams();
  }, [activeTab, loadEmails, loadEvents, loadFiles, loadTeams, loadApprovals, loadAgentActivity]);

  const isLoading = loadingEmails || loadingEvents || loadingFiles || loadingTeams;
  const totalPending = pendingApprovals.length;

  const pendingCountFor = (tabId: TabId) => {
    if (tabId === 'email') return pendingApprovals.filter((a) => a.action === 'send_email').length;
    if (tabId === 'calendar') return pendingApprovals.filter((a) => a.action === 'create_calendar_event').length;
    if (tabId === 'files') return pendingApprovals.filter((a) => a.action === 'share_file').length;
    if (tabId === 'teams') return pendingApprovals.filter((a) => a.action === 'send_teams_message').length;
    return 0;
  };

  /* --------------------------------------------------------------- */
  /*  Render                                                          */
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

        {/* Microsoft logo approximation */}
        <div className="w-8 h-8 rounded-lg overflow-hidden grid grid-cols-2 grid-rows-2 gap-0.5 bg-[#0a0a0f] p-0.5 shrink-0">
          <div className="bg-[#f25022] rounded-sm" />
          <div className="bg-[#7fba00] rounded-sm" />
          <div className="bg-[#00a4ef] rounded-sm" />
          <div className="bg-[#ffb900] rounded-sm" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Microsoft 365</h1>
            <StatusBadge status={connectionStatus} />
            {totalPending > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/25">
                {totalPending} pending
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500">Productivity — Outlook, Calendar, OneDrive &amp; Teams</p>
        </div>

        <button
          onClick={refreshCurrent}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

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
        <div className="px-5 pt-3 pb-1 shrink-0">
          <AgentSuggestionBanner serviceId="microsoft-365" onDismiss={() => setShowBanner(false)} />
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'email' ? (
        <div className="flex-1 overflow-hidden">
          <OutlookEmail
            emails={emails}
            loading={loadingEmails}
            pendingApprovals={pendingApprovals.filter((a) => a.action === 'send_email')}
            onApprovalResolved={handleApprovalResolved}
            hasMore={!!emailsNextToken}
            loadingMore={loadingMoreEmails}
            onLoadMore={loadMoreEmails}
          />
        </div>
      ) : activeTab === 'calendar' ? (
        <div className="flex-1 overflow-hidden">
          <OutlookCalendar
            events={events}
            loading={loadingEvents}
            onCreate={createEvent}
            pendingApprovals={pendingApprovals.filter((a) => a.action === 'create_calendar_event')}
            onApprovalResolved={handleApprovalResolved}
          />
        </div>
      ) : activeTab === 'files' ? (
        <div className="flex-1 overflow-hidden">
          <OneDriveFiles
            files={files}
            loading={loadingFiles}
            onShare={shareFile}
            pendingApprovals={pendingApprovals.filter((a) => a.action === 'share_file')}
            onApprovalResolved={handleApprovalResolved}
            agentActivity={agentActivity}
            hasMore={!!filesNextToken}
            loadingMore={loadingMoreFiles}
            onLoadMore={loadMoreFiles}
          />
        </div>
      ) : activeTab === 'teams' ? (
        <div className="flex-1 overflow-hidden">
          <TeamsTab teams={teams} loadingTeams={loadingTeams} />
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <M365ActivityTab onApprovalResolved={loadApprovals} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <M365AutomationTab />
        </div>
      )}
    </div>
  );
}
