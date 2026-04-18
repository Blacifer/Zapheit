import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bot, GitPullRequest, BookOpen, CircleDot,
  Activity, RefreshCw, Loader2,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import { RepoList, type GitHubRepo } from './RepoList';
import { PullRequestList, type GitHubPR } from './PullRequestList';
import { GitHubIssuesList, type GitHubIssue } from './GitHubIssuesList';
import { GitHubActivityTab } from './GitHubActivityTab';
import { GitHubAutomationTab } from './GitHubAutomationTab';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'repos' | 'pulls' | 'issues' | 'activity' | 'automation';

const CONNECTOR_ID = 'github';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GitHubWorkspace() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('repos');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [pulls, setPulls] = useState<GitHubPR[]>([]);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null);

  /* -- Load repos -------------------------------------------------- */
  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_repos', { limit: 30 });
      if (res.success && res.data?.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : [];
        setRepos(list);
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  /* -- Load PRs for a repo ----------------------------------------- */
  const loadPulls = useCallback(async (owner: string, repo: string) => {
    setLoadingPulls(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_pulls', { owner, repo, limit: 30 });
      if (res.success && res.data?.data) {
        setPulls(Array.isArray(res.data.data) ? res.data.data : []);
      }
    } catch {
      toast.error('Failed to load pull requests');
    } finally {
      setLoadingPulls(false);
    }
  }, []);

  /* -- Load issues for a repo -------------------------------------- */
  const loadIssues = useCallback(async (owner: string, repo: string) => {
    setLoadingIssues(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_issues', { owner, repo, limit: 30 });
      if (res.success && res.data?.data) {
        setIssues(Array.isArray(res.data.data) ? res.data.data : []);
      }
    } catch {
      toast.error('Failed to load issues');
    } finally {
      setLoadingIssues(false);
    }
  }, []);

  /* -- Create issue ------------------------------------------------ */
  const createIssue = useCallback(async (data: { owner: string; repo: string; title: string; body?: string; labels?: string[] }) => {
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'create_issue', data);
    if (res.success) {
      toast.success(`Issue #${res.data?.data?.number || ''} created`);
      if (selectedRepo) void loadIssues(selectedRepo.owner, selectedRepo.repo);
    } else if (res.data?.pending) {
      toast.info('Issue creation requires approval');
    } else {
      toast.error('Failed to create issue');
    }
  }, [selectedRepo, loadIssues]);

  /* -- Create comment ---------------------------------------------- */
  const createComment = useCallback(async (issueNumber: number, body: string) => {
    if (!selectedRepo) return;
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'create_comment', {
      owner: selectedRepo.owner,
      repo: selectedRepo.repo,
      issue_number: issueNumber,
      body,
    });
    if (res.success) {
      toast.success('Comment added');
    } else if (res.data?.pending) {
      toast.info('Comment requires approval');
    } else {
      toast.error('Failed to add comment');
    }
  }, [selectedRepo]);

  /* -- Merge PR ---------------------------------------------------- */
  const mergePull = useCallback(async (pullNumber: number) => {
    if (!selectedRepo) return;
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'merge_pull', {
      owner: selectedRepo.owner,
      repo: selectedRepo.repo,
      pull_number: pullNumber,
    });
    if (res.success) {
      toast.success(`PR #${pullNumber} merged`);
      void loadPulls(selectedRepo.owner, selectedRepo.repo);
    } else if (res.data?.pending) {
      toast.info('Merge requires approval');
    } else {
      toast.error('Failed to merge pull request');
    }
  }, [selectedRepo, loadPulls]);

  /* -- Select a repo ----------------------------------------------- */
  const handleSelectRepo = useCallback((repo: GitHubRepo) => {
    const parts = repo.full_name.split('/');
    const sel = { owner: parts[0], repo: parts[1] };
    setSelectedRepo(sel);
    setActiveTab('pulls');
    void loadPulls(sel.owner, sel.repo);
    void loadIssues(sel.owner, sel.repo);
  }, [loadPulls, loadIssues]);

  /* -- Initial load ------------------------------------------------ */
  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const TABS: { id: Tab; label: string; Icon: typeof BookOpen }[] = [
    { id: 'repos',      label: 'Repos',        Icon: BookOpen },
    { id: 'pulls',      label: 'Pull Requests', Icon: GitPullRequest },
    { id: 'issues',     label: 'Issues',        Icon: CircleDot },
    { id: 'activity',   label: 'Activity',      Icon: Activity },
    { id: 'automation', label: 'Automation',     Icon: Bot },
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

        <div className="w-8 h-8 rounded-lg bg-[#24292f] flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">
            GitHub Workspace
            {selectedRepo && (
              <span className="text-slate-500 font-normal ml-2">
                / {selectedRepo.owner}/{selectedRepo.repo}
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {connected !== null && (
              <StatusBadge status={connected ? 'connected' : 'disconnected'} size="sm" />
            )}
            <span className="text-[11px] text-slate-500">
              {repos.length} repo{repos.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <button
          onClick={() => {
            void loadRepos();
            if (selectedRepo) {
              void loadPulls(selectedRepo.owner, selectedRepo.repo);
              void loadIssues(selectedRepo.owner, selectedRepo.repo);
            }
          }}
          disabled={loadingRepos}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
          title="Refresh"
        >
          {loadingRepos ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
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
              activeTab === t.id
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            <t.Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {connected === false ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            type="disconnected"
            title="GitHub not connected"
            description="Connect GitHub from the Apps page to use this workspace."
            action={{ label: 'Go to Apps', onClick: () => navigate('/dashboard/apps') }}
          />
        </div>
      ) : activeTab === 'repos' ? (
        <div className="flex-1 overflow-hidden">
          <RepoList
            repos={repos}
            loading={loadingRepos}
            selectedRepo={selectedRepo?.repo ?? null}
            onSelect={handleSelectRepo}
          />
        </div>
      ) : activeTab === 'pulls' ? (
        <div className="flex-1 overflow-hidden">
          {selectedRepo ? (
            <PullRequestList
              pulls={pulls}
              loading={loadingPulls}
              repoFullName={`${selectedRepo.owner}/${selectedRepo.repo}`}
              onMerge={mergePull}
              onComment={createComment}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center h-full">
              <EmptyState
                type="no-data"
                title="Select a repository"
                description="Choose a repo from the Repos tab to view pull requests."
                action={{ label: 'Browse repos', onClick: () => setActiveTab('repos') }}
              />
            </div>
          )}
        </div>
      ) : activeTab === 'issues' ? (
        <div className="flex-1 overflow-hidden">
          {selectedRepo ? (
            <GitHubIssuesList
              issues={issues}
              loading={loadingIssues}
              repoFullName={`${selectedRepo.owner}/${selectedRepo.repo}`}
              onCreate={(title, body) => createIssue({ owner: selectedRepo.owner, repo: selectedRepo.repo, title, body })}
              onComment={createComment}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center h-full">
              <EmptyState
                type="no-data"
                title="Select a repository"
                description="Choose a repo from the Repos tab to view issues."
                action={{ label: 'Browse repos', onClick: () => setActiveTab('repos') }}
              />
            </div>
          )}
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <GitHubActivityTab connectorId={CONNECTOR_ID} />
        </div>
      ) : activeTab === 'automation' ? (
        <div className="flex-1 overflow-y-auto">
          <GitHubAutomationTab />
        </div>
      ) : null}
    </div>
  );
}
