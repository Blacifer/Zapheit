import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Link2, Link2Off, Info, Loader2, Figma, MessageSquare, Bot, ExternalLink, FileImage,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { SharedAutomationTab } from '../shared/SharedAutomationTab';

const CONNECTOR_ID = 'figma';
const CALLBACK_URL = 'https://api.zapheit.com/integrations/oauth/callback/figma';

const FIGMA_TRIGGERS = {
  comment_added:      { label: 'Comment added',      description: 'Agent summarises or notifies when a new comment is posted', Icon: MessageSquare },
  file_updated:       { label: 'File updated',       description: 'Agent tracks changes and notifies stakeholders',             Icon: Figma },
  version_published:  { label: 'Version published',  description: 'Agent announces and logs new design versions',              Icon: FileImage },
  component_updated:  { label: 'Component updated',  description: 'Agent audits brand consistency when a component changes',   Icon: Figma },
};

const FIGMA_EXAMPLES = [
  'List all files in my Design System project',
  'Get recent comments on the "Dashboard Redesign" file',
  'Export assets from the mobile design file',
  'Check if logo components are up to date',
];

type Tab = 'files' | 'comments' | 'automation';

const TABS: { id: Tab; label: string; Icon: typeof Figma }[] = [
  { id: 'files',      label: 'Files',      Icon: FileImage },
  { id: 'comments',   label: 'Comments',   Icon: MessageSquare },
  { id: 'automation', label: 'Automation', Icon: Bot },
];

interface FigmaFile {
  key: string;
  name: string;
  last_modified: string;
  thumbnail_url?: string;
}

interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  user: { handle: string };
  file_key?: string;
}

export default function FigmaWorkspace() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('files');

  const [files, setFiles] = useState<FigmaFile[]>([]);
  const [comments, setComments] = useState<FigmaComment[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_files', { limit: 1 });
      setConnected(res.success);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_files', { limit: 20 });
      if (res.success && res.data?.files) setFiles(res.data.files);
      else if (res.success && Array.isArray(res.data)) setFiles(res.data);
    } catch {
      /* silent */
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_comments', { limit: 20 });
      if (res.success && res.data?.comments) setComments(res.data.comments);
      else if (res.success && Array.isArray(res.data)) setComments(res.data);
    } catch {
      /* silent */
    } finally {
      setLoadingComments(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);

  useEffect(() => {
    if (!connected) return;
    if (activeTab === 'files') void loadFiles();
    if (activeTab === 'comments') void loadComments();
  }, [connected, activeTab, loadFiles, loadComments]);

  const handleConnect = useCallback(() => {
    const url = api.integrations.getOAuthAuthorizeUrl('figma', window.location.href);
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect Figma? Design automation will stop.')) return;
    try {
      await api.integrations.disconnect('figma');
      setConnected(false);
      toast.success('Figma disconnected');
    } catch {
      toast.error('Failed to disconnect Figma');
    }
  }, []);

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

        <div className="w-8 h-8 rounded-lg bg-[#F24E1E] flex items-center justify-center shrink-0">
          <Figma className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Figma</h1>
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
                <div className="w-12 h-12 rounded-xl bg-[#F24E1E] flex items-center justify-center mx-auto">
                  <Figma className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-base font-semibold text-white">Connect Figma</h2>
                <p className="text-sm text-slate-400">Authorize Zapheit to read designs, audit components, and post review comments.</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Read-only access</p>
                <div className="flex items-start gap-2 pt-1">
                  <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-slate-500">
                    Figma's API is read-only for canvas content. Agents can read files, list comments, and post comment replies.
                    <br />Callback: <span className="font-mono text-slate-400">{CALLBACK_URL}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={handleConnect}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#F24E1E] hover:bg-[#d43d10] text-white text-sm font-semibold transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Connect Figma with OAuth
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

        {/* Files tab */}
        {!checking && connected && activeTab === 'files' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Design Files</h2>
              <button onClick={() => void loadFiles()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>

            {showBanner && <AgentSuggestionBanner serviceId="figma" onDismiss={() => setShowBanner(false)} />}

            {loadingFiles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : files.length === 0 ? (
              <EmptyState icon={FileImage} title="No files found" description="Your Figma files will appear here once the connection fetches them." />
            ) : (
              <div className="space-y-2">
                {files.map((f) => (
                  <div key={f.key} className="rounded-lg border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3">
                    {f.thumbnail_url ? (
                      <img src={f.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover shrink-0 border border-white/10" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#F24E1E]/20 border border-[#F24E1E]/30 flex items-center justify-center shrink-0">
                        <FileImage className="w-5 h-5 text-[#F24E1E]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{f.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Last modified: {new Date(f.last_modified).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                      </p>
                    </div>
                    <a
                      href={`https://figma.com/file/${f.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-colors shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Comments tab */}
        {!checking && connected && activeTab === 'comments' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Recent Comments</h2>
              <button onClick={() => void loadComments()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>
            {loadingComments ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : comments.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No comments found" description="Comments from your Figma files will appear here." />
            ) : (
              <div className="space-y-2">
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-5 h-5 rounded-full bg-[#F24E1E]/30 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-[#F24E1E]">{c.user.handle[0]?.toUpperCase()}</span>
                      </div>
                      <span className="text-xs font-medium text-slate-300">{c.user.handle}</span>
                      <span className="text-[10px] text-slate-500 ml-auto">{new Date(c.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{c.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Automation tab */}
        {!checking && connected && activeTab === 'automation' && (
          <SharedAutomationTab
            connectorId="figma"
            triggerTypes={FIGMA_TRIGGERS}
            nlExamples={FIGMA_EXAMPLES}
            accentColor="orange"
          />
        )}
      </div>
    </div>
  );
}
