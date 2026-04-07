import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Mail, Calendar, HardDrive,
  Activity, Bot, RefreshCw, Loader2,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import { EmailList, type GmailMessage } from './EmailList';
import { CalendarView, type CalendarEvent } from './CalendarView';
import { DriveFiles, type DriveFile } from './DriveFiles';
import { GoogleActivityTab } from './GoogleActivityTab';
import { GoogleAutomationTab } from './GoogleAutomationTab';

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'email',      label: 'Email',      Icon: Mail },
  { id: 'calendar',   label: 'Calendar',   Icon: Calendar },
  { id: 'drive',      label: 'Drive',      Icon: HardDrive },
  { id: 'activity',   label: 'Activity',   Icon: Activity },
  { id: 'automation', label: 'Automation', Icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function GoogleWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('email');

  /* Data state */
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  /* Loading */
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  /* --------------------------------------------------------------- */
  /*  Data loaders                                                     */
  /* --------------------------------------------------------------- */

  const loadEmails = useCallback(async () => {
    setLoadingEmails(true);
    try {
      const res = await api.unifiedConnectors.executeAction('google-workspace', 'list_emails', { maxResults: 50 });
      if (res.success && res.data?.data) setEmails(res.data.data);
      setConnectionStatus('connected');
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setLoadingEmails(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await api.unifiedConnectors.executeAction('google-workspace', 'list_events', { maxResults: 50 });
      if (res.success && res.data?.data) setEvents(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingEvents(false); }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await api.unifiedConnectors.executeAction('google-workspace', 'list_files', { pageSize: 50 });
      if (res.success && res.data?.data) setFiles(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingFiles(false); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                    */
  /* --------------------------------------------------------------- */

  const sendEmail = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('google-workspace', 'send_email', data);
      if (res.success) {
        toast.success('Email sent');
        void loadEmails();
      } else {
        toast.error(res.error || 'Failed to send email');
      }
    } catch { toast.error('Network error'); }
  }, [loadEmails]);

  const createEvent = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('google-workspace', 'create_event', data);
      if (res.success) {
        toast.success('Event created');
        void loadEvents();
      } else {
        toast.error(res.error || 'Failed to create event');
      }
    } catch { toast.error('Network error'); }
  }, [loadEvents]);

  const shareFile = useCallback(async (fileId: string, email: string, role: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('google-workspace', 'share_file', { fileId, email, role });
      if (res.success) {
        toast.success('File shared');
      } else {
        toast.error(res.error || 'Failed to share file');
      }
    } catch { toast.error('Network error'); }
  }, []);

  /* Auto-load on mount */
  useEffect(() => { void loadEmails(); }, [loadEmails]);

  /* Load tab data on switch */
  useEffect(() => {
    if (activeTab === 'calendar' && events.length === 0) void loadEvents();
    if (activeTab === 'drive' && files.length === 0) void loadFiles();
  }, [activeTab, events.length, files.length, loadEvents, loadFiles]);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                          */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    if (activeTab === 'email') void loadEmails();
    else if (activeTab === 'calendar') void loadEvents();
    else if (activeTab === 'drive') void loadFiles();
  }, [activeTab, loadEmails, loadEvents, loadFiles]);

  const isLoading = loadingEmails || loadingEvents || loadingFiles;

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
          </div>
          <p className="text-[10px] text-slate-500">Productivity — Email, Calendar &amp; Drive</p>
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
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              activeTab === id
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'email' ? (
        <div className="flex-1 overflow-hidden">
          <EmailList emails={emails} loading={loadingEmails} onSend={sendEmail} />
        </div>
      ) : activeTab === 'calendar' ? (
        <div className="flex-1 overflow-hidden">
          <CalendarView events={events} loading={loadingEvents} onCreate={createEvent} />
        </div>
      ) : activeTab === 'drive' ? (
        <div className="flex-1 overflow-hidden">
          <DriveFiles files={files} loading={loadingFiles} onShare={shareFile} />
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <GoogleActivityTab />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <GoogleAutomationTab />
        </div>
      )}
    </div>
  );
}
