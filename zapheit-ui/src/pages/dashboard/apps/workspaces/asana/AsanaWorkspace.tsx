import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Link2, Link2Off, Info, Loader2, CheckSquare, FolderOpen, Bot, Circle, CheckCircle2, ExternalLink,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { SharedAutomationTab } from '../shared/SharedAutomationTab';

const CONNECTOR_ID = 'asana';
const CALLBACK_URL = 'https://api.zapheit.com/integrations/oauth/callback/asana';

const ASANA_TRIGGERS = {
  task_created:           { label: 'Task created',           description: 'Agent triages or assigns new tasks automatically',              Icon: CheckSquare },
  task_completed:         { label: 'Task completed',         description: 'Agent notifies stakeholders and closes related work',           Icon: CheckCircle2 },
  task_assigned:          { label: 'Task assigned',          description: 'Agent sends context or reminders when a task is assigned',      Icon: CheckSquare },
  project_status_updated: { label: 'Project status updated', description: 'Agent summarises and broadcasts project status changes',        Icon: FolderOpen },
};

const ASANA_EXAMPLES = [
  'List overdue tasks assigned to me',
  "Create a task: 'Review Q3 report' in Marketing project",
  'Mark task #12345 as complete',
  "Show all tasks in the 'Product Launch' project",
];

type Tab = 'projects' | 'tasks' | 'automation';

const TABS: { id: Tab; label: string; Icon: typeof FolderOpen }[] = [
  { id: 'projects',   label: 'Projects',   Icon: FolderOpen },
  { id: 'tasks',      label: 'My Tasks',   Icon: CheckSquare },
  { id: 'automation', label: 'Automation', Icon: Bot },
];

interface AsanaProject {
  gid: string;
  name: string;
  color?: string;
  archived?: boolean;
  due_date?: string;
  permalink_url?: string;
}

interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  due_on?: string;
  assignee?: { name: string } | null;
  memberships?: { project: { name: string } }[];
  permalink_url?: string;
}

export default function AsanaWorkspace() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('projects');

  const [projects, setProjects] = useState<AsanaProject[]>([]);
  const [tasks, setTasks] = useState<AsanaTask[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_projects', { limit: 1 });
      setConnected(res.success);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_projects', { limit: 25 });
      if (res.success && res.data?.data) setProjects(res.data.data);
      else if (res.success && Array.isArray(res.data)) setProjects(res.data);
    } catch {
      /* silent */
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_my_tasks', { limit: 25 });
      if (res.success && res.data?.data) setTasks(res.data.data);
      else if (res.success && Array.isArray(res.data)) setTasks(res.data);
    } catch {
      /* silent */
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);

  useEffect(() => {
    if (!connected) return;
    if (activeTab === 'projects') void loadProjects();
    if (activeTab === 'tasks') void loadTasks();
  }, [connected, activeTab, loadProjects, loadTasks]);

  const handleConnect = useCallback(() => {
    const url = api.integrations.getOAuthAuthorizeUrl('asana', window.location.href);
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect Asana? Task automation will stop.')) return;
    try {
      await api.integrations.disconnect('asana');
      setConnected(false);
      toast.success('Asana disconnected');
    } catch {
      toast.error('Failed to disconnect Asana');
    }
  }, []);

  const isOverdue = (dueOn?: string) => {
    if (!dueOn) return false;
    return new Date(dueOn) < new Date();
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

        <div className="w-8 h-8 rounded-lg bg-[#F06A6A] flex items-center justify-center shrink-0">
          <CheckSquare className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Asana</h1>
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
                <div className="w-12 h-12 rounded-xl bg-[#F06A6A] flex items-center justify-center mx-auto">
                  <CheckSquare className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-base font-semibold text-white">Connect Asana</h2>
                <p className="text-sm text-slate-400">Authorize Zapheit to manage tasks, track projects, and automate workflows.</p>
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#F06A6A] hover:bg-[#d95555] text-white text-sm font-semibold transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Connect Asana with OAuth
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

        {/* Projects tab */}
        {!checking && connected && activeTab === 'projects' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Projects</h2>
              <button onClick={() => void loadProjects()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>

            {showBanner && <AgentSuggestionBanner serviceId="asana" onDismiss={() => setShowBanner(false)} />}

            {loadingProjects ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : projects.length === 0 ? (
              <EmptyState icon={FolderOpen} title="No projects found" description="Your Asana projects will appear here." />
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <div key={p.gid} className="rounded-lg border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0 mt-1.5"
                      style={{ backgroundColor: p.color ?? '#F06A6A' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{p.name}</p>
                        {p.archived && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 font-medium shrink-0">Archived</span>
                        )}
                      </div>
                      {p.due_date && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          Due {new Date(p.due_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                        </p>
                      )}
                    </div>
                    {p.permalink_url && (
                      <a
                        href={p.permalink_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tasks tab */}
        {!checking && connected && activeTab === 'tasks' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">My Tasks</h2>
              <button onClick={() => void loadTasks()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>
            {loadingTasks ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : tasks.length === 0 ? (
              <EmptyState icon={CheckSquare} title="No tasks found" description="Tasks assigned to you will appear here." />
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => (
                  <div key={t.gid} className="rounded-lg border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {t.completed
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : <Circle className="w-4 h-4 text-slate-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium truncate', t.completed ? 'line-through text-slate-500' : 'text-white')}>{t.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {t.memberships?.[0]?.project?.name && (
                          <span className="text-[10px] text-slate-500">{t.memberships[0].project.name}</span>
                        )}
                        {t.due_on && (
                          <span className={cn('text-[10px] font-medium', isOverdue(t.due_on) && !t.completed ? 'text-rose-400' : 'text-slate-500')}>
                            {isOverdue(t.due_on) && !t.completed ? 'Overdue · ' : ''}
                            {new Date(t.due_on).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                          </span>
                        )}
                      </div>
                    </div>
                    {t.permalink_url && (
                      <a
                        href={t.permalink_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Automation tab */}
        {!checking && connected && activeTab === 'automation' && (
          <SharedAutomationTab
            connectorId="asana"
            triggerTypes={ASANA_TRIGGERS}
            nlExamples={ASANA_EXAMPLES}
            accentColor="rose"
          />
        )}
      </div>
    </div>
  );
}
