import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, GitMerge, CircleDot, FolderGit2, Activity, RefreshCw, Loader2, Link2Off, Plus, X } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { ProjectList, type GitLabProject } from './ProjectList';
import { MRList, type GitLabMR } from './MRList';
import { SharedAutomationTab } from '../shared/SharedAutomationTab';

const GITLAB_TRIGGERS = {
  push_to_branch: { label: 'Push to branch',  description: 'Agent reviews commits when code is pushed',                Icon: Activity },
  mr_opened:      { label: 'MR opened',        description: 'Agent triages or reviews new merge requests',             Icon: GitMerge },
  issue_created:  { label: 'Issue created',    description: 'Agent triages or responds to new issues',                 Icon: CircleDot },
  mr_approved:    { label: 'MR approved',      description: 'Agent auto-merges or notifies when MR is fully approved', Icon: GitMerge },
  pipeline_failed:{ label: 'Pipeline failed',  description: 'Agent alerts or retries when a CI pipeline fails',        Icon: Activity },
};
const GITLAB_EXAMPLES = [
  'Create an issue in group/project: "Login page crash on mobile"',
  'Merge MR !15 in group/project after all checks pass',
  'Comment on issue #42: "Fixed in commit abc123"',
  'Close issue #7 in group/project',
];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'projects' | 'mrs' | 'issues' | 'activity' | 'automation';

interface GitLabIssue {
  iid: number;
  title: string;
  state: string;
  author: string;
  assignee?: string;
  labels: string[];
  created_at: string;
  updated_at: string;
  user_notes_count: number;
  web_url: string;
}

const CONNECTOR_ID = 'gitlab';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GitLabWorkspace() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('projects');
  const [showBanner, setShowBanner] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [mrs, setMrs] = useState<GitLabMR[]>([]);
  const [issues, setIssues] = useState<GitLabIssue[]>([]);
  const [selectedProject, setSelectedProject] = useState<GitLabProject | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingMrs, setLoadingMrs] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);

  // Create issue modal
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const loadConnectionStatus = useCallback(async () => {
    try {
      const res = await api.integrations.getAll();
      const items = Array.isArray(res.data) ? res.data : [];
      const gl = items.find((i: any) => i.service_type === CONNECTOR_ID || i.id === CONNECTOR_ID);
      setConnected(gl?.status === 'connected');
    } catch {
      setConnected(null);
    }
  }, []);

  const handleConnect = useCallback(async () => {
    try {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const res = await api.integrations.initOAuth(CONNECTOR_ID, returnTo);
      const url = (res.data as any)?.url;
      if (res.success && url) { window.location.href = url; return; }
      toast.error(res.error || 'Failed to start GitLab OAuth');
    } catch {
      toast.error('Failed to start GitLab OAuth');
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect GitLab? Project, MR, and issue access will stop.')) return;
    try {
      await api.integrations.disconnect(CONNECTOR_ID);
      setConnected(false);
      setProjects([]);
      setMrs([]);
      setIssues([]);
      setSelectedProject(null);
      toast.success('GitLab disconnected');
    } catch {
      toast.error('Failed to disconnect GitLab');
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      await loadConnectionStatus();
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_projects', { limit: 30 });
      const payload = res.data as any;
      if (res.success && Array.isArray(payload?.data)) {
        setProjects(payload.data);
        setConnected(true);
      } else {
        setProjects([]);
        if (payload?.error) toast.error(payload.error);
      }
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, [loadConnectionStatus]);

  const loadMrs = useCallback(async (projectId: number) => {
    setLoadingMrs(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_mrs', { project_id: projectId, limit: 30 });
      if (res.success && res.data?.data) setMrs(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      toast.error('Failed to load merge requests');
    } finally {
      setLoadingMrs(false);
    }
  }, []);

  const loadIssues = useCallback(async (projectId: number) => {
    setLoadingIssues(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_issues', { project_id: projectId, limit: 30 });
      if (res.success && res.data?.data) setIssues(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      toast.error('Failed to load issues');
    } finally {
      setLoadingIssues(false);
    }
  }, []);

  const handleSelectProject = useCallback((project: GitLabProject) => {
    setSelectedProject(project);
    setActiveTab('mrs');
    void loadMrs(project.id);
    void loadIssues(project.id);
  }, [loadMrs, loadIssues]);

  const handleMerge = useCallback(async (iid: number) => {
    if (!selectedProject) return;
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'merge_mr', {
      project_id: selectedProject.id,
      mr_iid: iid,
    });
    if (res.success) {
      toast.success(`MR !${iid} merged`);
      void loadMrs(selectedProject.id);
    } else if (res.data?.pending) {
      toast.info('Merge requires approval');
    } else {
      toast.error('Failed to merge MR');
    }
  }, [selectedProject, loadMrs]);

  const handleCreateIssue = useCallback(async () => {
    if (!selectedProject || !newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'create_issue', {
        project_id: selectedProject.id,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
      });
      if (res.success) {
        toast.success(`Issue #${res.data?.data?.iid || ''} created`);
        setShowCreate(false);
        setNewTitle('');
        setNewDesc('');
        void loadIssues(selectedProject.id);
      } else if (res.data?.pending) {
        toast.info('Issue creation requires approval');
        setShowCreate(false);
      } else {
        toast.error('Failed to create issue');
      }
    } finally {
      setCreating(false);
    }
  }, [selectedProject, newTitle, newDesc, loadIssues]);

  useEffect(() => {
    void loadConnectionStatus();
    void loadProjects();
  }, [loadConnectionStatus, loadProjects]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const TABS: { id: Tab; label: string; Icon: typeof FolderGit2 }[] = [
    { id: 'projects',   label: 'Projects',       Icon: FolderGit2 },
    { id: 'mrs',        label: 'Merge Requests',  Icon: GitMerge },
    { id: 'issues',     label: 'Issues',          Icon: CircleDot },
    { id: 'activity',   label: 'Activity',        Icon: Activity },
    { id: 'automation', label: 'Automation',       Icon: RefreshCw },
  ];

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

        <div className="w-8 h-8 rounded-lg bg-[#FC6D26]/15 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-[#FC6D26]" viewBox="0 0 25 24" fill="currentColor">
            <path d="M24.507 9.5l-.034-.09L21.082.562a.896.896 0 00-1.694.091l-2.29 7.01H7.825L5.535.653a.898.898 0 00-1.694-.09L.451 9.411.416 9.5a6.297 6.297 0 002.09 7.278l.012.01.03.022 5.16 3.867 2.56 1.935 1.554 1.176a1.051 1.051 0 001.268 0l1.555-1.176 2.56-1.935 5.197-3.89.014-.01A6.297 6.297 0 0024.507 9.5z" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">
            GitLab Workspace
            {selectedProject && (
              <span className="text-slate-500 font-normal ml-2">/ {selectedProject.path_with_namespace}</span>
            )}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {connected !== null && <StatusBadge status={connected ? 'connected' : 'disconnected'} size="sm" />}
            <span className="text-[11px] text-slate-500">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {connected && (
          <button
            onClick={() => void handleDisconnect()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 text-xs font-medium transition-colors"
          >
            <Link2Off className="w-3.5 h-3.5" />
            Disconnect
          </button>
        )}

        <button
          onClick={() => { void loadProjects(); if (selectedProject) { void loadMrs(selectedProject.id); void loadIssues(selectedProject.id); } }}
          disabled={loadingProjects}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
          title="Refresh"
        >
          {loadingProjects ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
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

      {/* Agent banner */}
      {showBanner && (
        <div className="px-5 pt-3 pb-1 shrink-0">
          <AgentSuggestionBanner serviceId="gitlab" onDismiss={() => setShowBanner(false)} />
        </div>
      )}

      {/* Body */}
      {connected === false ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            type="disconnected"
            title="GitLab not connected"
            description="Connect GitLab via OAuth to browse projects, merge requests, and issues."
            action={{ label: 'Connect GitLab with OAuth', onClick: () => { void handleConnect(); } }}
          />
        </div>
      ) : activeTab === 'projects' ? (
        <div className="flex-1 overflow-hidden">
          <ProjectList
            projects={projects}
            loading={loadingProjects}
            selectedId={selectedProject?.id ?? null}
            onSelect={handleSelectProject}
          />
        </div>
      ) : activeTab === 'mrs' ? (
        <div className="flex-1 overflow-hidden">
          {selectedProject ? (
            <MRList
              mrs={mrs}
              loading={loadingMrs}
              projectPath={selectedProject.path_with_namespace}
              onMerge={handleMerge}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center h-full">
              <EmptyState
                type="no-data"
                title="Select a project"
                description="Choose a project from the Projects tab to view merge requests."
                action={{ label: 'Browse projects', onClick: () => setActiveTab('projects') }}
              />
            </div>
          )}
        </div>
      ) : activeTab === 'issues' ? (
        <div className="flex flex-col h-full">
          {selectedProject ? (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 shrink-0">
                <span className="text-xs text-slate-400 font-medium">{selectedProject.path_with_namespace} — Issues</span>
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 text-xs font-medium transition-colors border border-orange-500/20"
                >
                  <Plus className="w-3.5 h-3.5" /> New Issue
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingIssues ? (
                  <div className="animate-pulse space-y-1 p-4">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />)}
                  </div>
                ) : issues.length === 0 ? (
                  <div className="text-center py-16">
                    <CircleDot className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No open issues</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {issues.map((issue) => (
                      <div key={issue.iid} className="px-4 py-3 hover:bg-white/[0.03]">
                        <div className="flex items-start gap-2">
                          <CircleDot className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white">{issue.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[11px] text-slate-500">#{issue.iid} by {issue.author}</span>
                              {issue.assignee && <span className="text-[11px] text-slate-600">→ {issue.assignee}</span>}
                              <span className="text-[10px] text-slate-600">{timeAgo(issue.updated_at)}</span>
                              {issue.user_notes_count > 0 && (
                                <span className="text-[10px] text-slate-600">{issue.user_notes_count} comments</span>
                              )}
                            </div>
                            {issue.labels.length > 0 && (
                              <div className="flex gap-1 mt-1">
                                {issue.labels.slice(0, 3).map((l) => (
                                  <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/20">{l}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Create issue modal */}
              {showCreate && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 p-6">
                  <div className="w-full max-w-md bg-[#0e1117] border border-white/10 rounded-xl p-5 shadow-2xl">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-white">New Issue</h3>
                      <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Issue title *"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40 mb-3"
                    />
                    <textarea
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="Description (optional)"
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40 resize-none mb-4"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleCreateIssue()}
                        disabled={!newTitle.trim() || creating}
                        className="px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 text-xs font-medium transition-colors border border-orange-500/20 disabled:opacity-40"
                      >
                        {creating ? 'Creating…' : 'Create Issue'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                type="no-data"
                title="Select a project"
                description="Choose a project from the Projects tab to view issues."
                action={{ label: 'Browse projects', onClick: () => setActiveTab('projects') }}
              />
            </div>
          )}
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="text-center py-16">
            <Activity className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Activity feed coming soon</p>
            <p className="text-xs text-slate-600 mt-1">Recent commits, pipeline events, and more</p>
          </div>
        </div>
      ) : activeTab === 'automation' ? (
        <div className="flex-1 overflow-y-auto">
          <SharedAutomationTab
            connectorId="gitlab"
            triggerTypes={GITLAB_TRIGGERS}
            nlExamples={GITLAB_EXAMPLES}
            scopeLabel="Project"
            scopePlaceholder="group/project or leave blank for all"
            accentColor="orange"
          />
        </div>
      ) : null}
    </div>
  );
}
