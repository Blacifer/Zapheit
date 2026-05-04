import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Link2, Link2Off, Info, Loader2, LayoutDashboard, Bot, MessageSquare, Users, ExternalLink,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { SharedAutomationTab } from '../shared/SharedAutomationTab';

const CONNECTOR_ID = 'miro';
const CALLBACK_URL = 'https://api.zapheit.com/integrations/oauth/callback/miro';

const MIRO_TRIGGERS = {
  board_created:  { label: 'Board created',  description: 'Agent sets up initial cards or notifies team when a board is created', Icon: LayoutDashboard },
  card_updated:   { label: 'Card updated',   description: 'Agent tracks changes and logs updates to board cards',                  Icon: LayoutDashboard },
  comment_added:  { label: 'Comment added',  description: 'Agent summarises discussion threads on board items',                    Icon: MessageSquare },
  board_shared:   { label: 'Board shared',   description: 'Agent notifies stakeholders when a board is shared',                    Icon: Users },
};

const MIRO_EXAMPLES = [
  'List all my team boards',
  "Create a new board: 'Q3 Planning'",
  "Add a sticky note to board 'Sprint Retro'",
  "Share board 'Product Roadmap' with design@company.com",
];

type Tab = 'boards' | 'automation';

const TABS: { id: Tab; label: string; Icon: typeof LayoutDashboard }[] = [
  { id: 'boards',     label: 'Boards',     Icon: LayoutDashboard },
  { id: 'automation', label: 'Automation', Icon: Bot },
];

interface MiroBoard {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  modifiedAt?: string;
  viewLink?: string;
  team?: { name: string };
}

export default function MiroWorkspace() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('boards');

  const [boards, setBoards] = useState<MiroBoard[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_boards', { limit: 1 });
      setConnected(res.success);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadBoards = useCallback(async () => {
    setLoadingBoards(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_boards', { limit: 25 });
      if (res.success && res.data?.data) setBoards(res.data.data);
      else if (res.success && Array.isArray(res.data)) setBoards(res.data);
    } catch {
      /* silent */
    } finally {
      setLoadingBoards(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);
  useEffect(() => { if (connected && activeTab === 'boards') void loadBoards(); }, [connected, activeTab, loadBoards]);

  const handleConnect = useCallback(() => {
    const url = api.integrations.getOAuthAuthorizeUrl('miro', window.location.href);
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect Miro? Board automation will stop.')) return;
    try {
      await api.integrations.disconnect('miro');
      setConnected(false);
      toast.success('Miro disconnected');
    } catch {
      toast.error('Failed to disconnect Miro');
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

        <div className="w-8 h-8 rounded-lg bg-[#FFD02F] flex items-center justify-center shrink-0">
          <LayoutDashboard className="w-4 h-4 text-[#1a1200]" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Miro</h1>
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
                <div className="w-12 h-12 rounded-xl bg-[#FFD02F] flex items-center justify-center mx-auto">
                  <LayoutDashboard className="w-6 h-6 text-[#1a1200]" />
                </div>
                <h2 className="text-base font-semibold text-white">Connect Miro</h2>
                <p className="text-sm text-slate-400">Authorize Zapheit to manage your whiteboards and automate team collaboration.</p>
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#FFD02F] hover:bg-[#f0c01f] text-[#1a1200] text-sm font-semibold transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Connect Miro with OAuth
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

        {/* Boards tab */}
        {!checking && connected && activeTab === 'boards' && (
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Your Boards</h2>
              <button onClick={() => void loadBoards()} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Refresh</button>
            </div>

            {showBanner && <AgentSuggestionBanner serviceId="miro" onDismiss={() => setShowBanner(false)} />}

            {loadingBoards ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : boards.length === 0 ? (
              <EmptyState icon={LayoutDashboard} title="No boards found" description="Your Miro boards will appear here." />
            ) : (
              <div className="space-y-2">
                {boards.map((b) => (
                  <div key={b.id} className="rounded-lg border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#FFD02F]/20 border border-[#FFD02F]/30 flex items-center justify-center shrink-0 mt-0.5">
                      <LayoutDashboard className="w-4 h-4 text-[#FFD02F]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{b.name}</p>
                      {b.description && <p className="text-xs text-slate-400 mt-0.5 truncate">{b.description}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        {b.team && <span className="text-[10px] text-slate-500">{b.team.name}</span>}
                        {b.modifiedAt && (
                          <span className="text-[10px] text-slate-500">
                            Updated {new Date(b.modifiedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                          </span>
                        )}
                      </div>
                    </div>
                    {b.viewLink && (
                      <a
                        href={b.viewLink}
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
            connectorId="miro"
            triggerTypes={MIRO_TRIGGERS}
            nlExamples={MIRO_EXAMPLES}
            accentColor="amber"
          />
        )}
      </div>
    </div>
  );
}
