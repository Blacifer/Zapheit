import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Database, FileText, Search,
  Activity, Bot, RefreshCw, Loader2,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import { DatabaseList, type NotionDatabase } from './DatabaseList';
import { PageList, type NotionPage } from './PageList';
import { NotionActivityTab } from './NotionActivityTab';
import { NotionAutomationTab } from './NotionAutomationTab';

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'databases', label: 'Databases', Icon: Database },
  { id: 'pages',     label: 'Pages',     Icon: FileText },
  { id: 'search',    label: 'Search',    Icon: Search },
  { id: 'activity',  label: 'Activity',  Icon: Activity },
  { id: 'automation', label: 'Automation', Icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function NotionWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('databases');

  /* Data state */
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  /* Loading */
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [searching, setSearching] = useState(false);

  /* --------------------------------------------------------------- */
  /*  Data loaders                                                     */
  /* --------------------------------------------------------------- */

  const loadDatabases = useCallback(async () => {
    setLoadingDatabases(true);
    try {
      const res = await api.unifiedConnectors.executeAction('notion', 'list_databases', {});
      if (res.success && res.data?.data) setDatabases(res.data.data);
      setConnectionStatus('connected');
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setLoadingDatabases(false);
    }
  }, []);

  const loadPages = useCallback(async () => {
    setLoadingPages(true);
    try {
      const res = await api.unifiedConnectors.executeAction('notion', 'search', { filter: { property: 'object', value: 'page' }, page_size: 50 });
      if (res.success && res.data?.data) setPages(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingPages(false); }
  }, []);

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.unifiedConnectors.executeAction('notion', 'search', { query, page_size: 20 });
      if (res.success && res.data?.data) setSearchResults(res.data.data);
    } catch { /* empty */ }
    finally { setSearching(false); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                    */
  /* --------------------------------------------------------------- */

  const createPage = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('notion', 'create_page', data);
      if (res.success) {
        toast.success('Page created');
        void loadPages();
      } else {
        toast.error(res.error || 'Failed to create page');
      }
    } catch { toast.error('Network error'); }
  }, [loadPages]);

  const archivePage = useCallback(async (pageId: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('notion', 'archive_page', { pageId });
      if (res.success) {
        toast.success('Page archived');
        void loadPages();
      } else {
        toast.error(res.error || 'Failed to archive page');
      }
    } catch { toast.error('Network error'); }
  }, [loadPages]);

  /* Auto-load on mount */
  useEffect(() => { void loadDatabases(); }, [loadDatabases]);

  /* Load tab data on switch */
  useEffect(() => {
    if (activeTab === 'pages' && pages.length === 0) void loadPages();
  }, [activeTab, pages.length, loadPages]);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                          */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    if (activeTab === 'databases') void loadDatabases();
    else if (activeTab === 'pages') void loadPages();
  }, [activeTab, loadDatabases, loadPages]);

  const isLoading = loadingDatabases || loadingPages || searching;

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

        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-300 flex items-center justify-center text-black font-bold text-sm">
          N
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Notion</h1>
            <StatusBadge status={connectionStatus} />
          </div>
          <p className="text-[10px] text-slate-500">Knowledge Base — Databases, Pages &amp; Search</p>
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
      {activeTab === 'databases' ? (
        <div className="flex-1 overflow-hidden">
          <DatabaseList databases={databases} loading={loadingDatabases} />
        </div>
      ) : activeTab === 'pages' ? (
        <div className="flex-1 overflow-hidden">
          <PageList
            pages={pages}
            loading={loadingPages}
            onCreate={createPage}
            onArchive={archivePage}
          />
        </div>
      ) : activeTab === 'search' ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Search bar */}
          <div className="px-4 py-3 border-b border-white/5 shrink-0">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(searchQuery); }}
                  placeholder="Search Notion…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-white/20"
                />
              </div>
              <button
                onClick={() => void doSearch(searchQuery)}
                disabled={!searchQuery.trim() || searching}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white font-medium hover:bg-white/20 transition-colors disabled:opacity-40"
              >
                Search
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searching ? (
              <div className="animate-pulse space-y-1 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />
                ))}
              </div>
            ) : searchResults.length === 0 ? (
              <EmptyState type="no-data" description="Search Notion to find databases and pages" />
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {searchResults.map((item: any) => (
                  <div key={item.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      {item.object === 'database' ? (
                        <Database className="w-4 h-4 text-blue-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400" />
                      )}
                      <span className="text-xs font-semibold text-slate-200">
                        {item.title?.[0]?.plain_text || item.properties?.title?.title?.[0]?.plain_text || item.properties?.Name?.title?.[0]?.plain_text || 'Untitled'}
                      </span>
                      <span className="text-[9px] text-slate-600 uppercase">{item.object}</span>
                    </div>
                    {item.last_edited_time && (
                      <p className="text-[10px] text-slate-600 ml-6">
                        Edited {new Date(item.last_edited_time).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <NotionActivityTab />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <NotionAutomationTab />
        </div>
      )}
    </div>
  );
}
