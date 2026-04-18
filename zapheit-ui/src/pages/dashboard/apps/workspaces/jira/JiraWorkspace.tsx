import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, LayoutList, Columns3, Activity, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import { IssueList, type JiraIssue } from './IssueList';
import { IssueBoard } from './IssueBoard';
import { IssueDetail } from './IssueDetail';
import { JiraActivityTab } from './JiraActivityTab';
import { JiraAutomationTab } from './JiraAutomationTab';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'issues' | 'board' | 'activity' | 'automation';

const CONNECTOR_ID = 'jira';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JiraWorkspace() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('issues');
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<JiraIssue | null>(null);

  /* -- Load issues ------------------------------------------------- */
  const loadIssues = useCallback(async (jql?: string) => {
    setLoadingIssues(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'search_issues', {
        jql: jql || 'order by updated DESC',
        limit: 50,
      });
      if (res.success && res.data?.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : [];
        setIssues(list);
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoadingIssues(false);
    }
  }, []);

  /* -- Transition issue -------------------------------------------- */
  const transitionIssue = useCallback(async (issueKey: string, transitionId: string) => {
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'transition_issue', {
      issue_key: issueKey,
      transition_id: transitionId,
    });
    if (res.success) {
      toast.success(`Issue ${issueKey} transitioned`);
      void loadIssues();
    } else if (res.data?.pending) {
      toast.info('Transition requires approval');
    } else {
      toast.error('Failed to transition issue');
    }
  }, [loadIssues]);

  /* -- Add comment ------------------------------------------------- */
  const addComment = useCallback(async (issueKey: string, body: string) => {
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'add_comment', {
      issue_key: issueKey,
      body,
    });
    if (res.success) {
      toast.success('Comment added');
    } else if (res.data?.pending) {
      toast.info('Comment requires approval');
    } else {
      toast.error('Failed to add comment');
    }
  }, []);

  /* -- Create issue ------------------------------------------------ */
  const createIssue = useCallback(async (data: { project_key: string; summary: string; issue_type: string; description?: string; priority?: string }) => {
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'create_issue', data);
    if (res.success) {
      toast.success(`Issue ${res.data?.data?.key || ''} created`);
      void loadIssues();
    } else if (res.data?.pending) {
      toast.info('Issue creation requires approval');
    } else {
      toast.error('Failed to create issue');
    }
  }, [loadIssues]);

  /* -- Update issue ------------------------------------------------ */
  const updateIssue = useCallback(async (issueKey: string, fields: Record<string, any>) => {
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'update_issue', {
      issue_key: issueKey,
      ...fields,
    });
    if (res.success) {
      toast.success(`Issue ${issueKey} updated`);
      void loadIssues();
    } else if (res.data?.pending) {
      toast.info('Update requires approval');
    } else {
      toast.error('Failed to update issue');
    }
  }, [loadIssues]);

  /* -- Select issue (open detail) ---------------------------------- */
  const handleSelectIssue = useCallback((issue: JiraIssue) => {
    setSelectedIssue(issue);
  }, []);

  /* -- Initial load ------------------------------------------------ */
  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const TABS: { id: Tab; label: string; Icon: typeof LayoutList }[] = [
    { id: 'issues', label: 'Issues', Icon: LayoutList },
    { id: 'board', label: 'Board', Icon: Columns3 },
    { id: 'activity', label: 'Activity', Icon: Activity },
    { id: 'automation', label: 'Automation', Icon: Bot },
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

        {/* Jira logo */}
        <div className="w-8 h-8 rounded-lg bg-[#0052CC] flex items-center justify-center shrink-0">
          <span className="text-white text-sm font-bold">J</span>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Jira Workspace</h1>
          <div className="flex items-center gap-2 mt-0.5">
            {connected !== null && (
              <StatusBadge status={connected ? 'connected' : 'disconnected'} size="sm" />
            )}
            <span className="text-[11px] text-slate-500">
              {issues.length} issue{issues.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <button
          onClick={() => void loadIssues()}
          disabled={loadingIssues}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
          title="Refresh"
        >
          {loadingIssues ? (
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
            title="Jira not connected"
            description="Connect Jira from the Apps page to use this workspace."
            action={{ label: 'Go to Apps', onClick: () => navigate('/dashboard/apps') }}
          />
        </div>
      ) : activeTab === 'issues' ? (
        <div className="flex-1 overflow-hidden flex">
          <div className={cn('flex-1 overflow-hidden', selectedIssue && 'hidden md:block md:flex-1')}>
            <IssueList
              issues={issues}
              loading={loadingIssues}
              selectedKey={selectedIssue?.key ?? null}
              onSelect={handleSelectIssue}
              onSearch={(jql) => void loadIssues(jql)}
              onCreate={createIssue}
            />
          </div>
          {selectedIssue && (
            <IssueDetail
              issue={selectedIssue}
              onClose={() => setSelectedIssue(null)}
              onTransition={transitionIssue}
              onComment={addComment}
              onUpdate={updateIssue}
            />
          )}
        </div>
      ) : activeTab === 'board' ? (
        <div className="flex-1 overflow-hidden">
          <IssueBoard
            issues={issues}
            loading={loadingIssues}
            onSelect={handleSelectIssue}
            onTransition={transitionIssue}
          />
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <JiraActivityTab connectorId={CONNECTOR_ID} />
        </div>
      ) : activeTab === 'automation' ? (
        <div className="flex-1 overflow-y-auto">
          <JiraAutomationTab />
        </div>
      ) : null}
    </div>
  );
}
