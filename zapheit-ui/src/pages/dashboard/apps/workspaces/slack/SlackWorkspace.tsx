import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, Hash, MessageSquare, Activity, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import { ChannelList, type SlackChannel } from './ChannelList';
import { MessageView, type SlackMessage } from './MessageView';
import { ComposeBox } from './ComposeBox';
import { SlackActivityTab } from './SlackActivityTab';
import { SlackAutomationTab } from './SlackAutomationTab';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'channels' | 'messages' | 'activity' | 'automation';

const CONNECTOR_ID = 'slack';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SlackWorkspace() {
  const navigate = useNavigate();

  // Tab & selection state
  const [activeTab, setActiveTab] = useState<Tab>('channels');
  const [selectedChannel, setSelectedChannel] = useState<SlackChannel | null>(null);

  // Data state
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);

  /* -- Load channels ----------------------------------------------- */
  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_channels', {});
      if (!res.success) {
        // HTTP-level failure (401/403/400) — integration is not connected
        setConnected(false);
      } else {
        // Execute route succeeded — the integration IS connected even if channel list is empty
        setConnected(true);
        const inner = (res as any).data;
        if (inner?.data) {
          const list = Array.isArray(inner.data) ? inner.data : inner.data?.channels ?? [];
          setChannels(list);
        }
      }
    } catch {
      setConnected(false);
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  /* -- Load messages for channel ----------------------------------- */
  const loadMessages = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'get_channel_history', {
        channel: channelId,
        limit: 50,
      });
      if (res.success && res.data?.data) {
        const msgs = Array.isArray(res.data.data) ? res.data.data
          : res.data.data?.messages ?? [];
        setMessages(msgs);
      }
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  /* -- Send message ------------------------------------------------ */
  const sendMessage = useCallback(async (text: string) => {
    if (!selectedChannel) return;
    const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'send_message', {
      channel: selectedChannel.id,
      text,
    });
    if (res.success) {
      // Optimistic: append message locally
      const newMsg: SlackMessage = {
        ts: String(Date.now() / 1000),
        username: 'You',
        text,
      };
      setMessages((prev) => [...prev, newMsg]);
      toast.success('Message sent');
    } else if (res.data?.pending) {
      toast.info('Message requires approval');
    } else {
      toast.error('Failed to send message');
    }
  }, [selectedChannel]);

  /* -- Select a channel -------------------------------------------- */
  const handleSelectChannel = useCallback((ch: SlackChannel) => {
    setSelectedChannel(ch);
    setActiveTab('messages');
    void loadMessages(ch.id);
  }, [loadMessages]);

  /* -- Initial load ------------------------------------------------ */
  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const TABS: { id: Tab; label: string; Icon: typeof Hash }[] = [
    { id: 'channels', label: 'Channels', Icon: Hash },
    { id: 'messages', label: 'Messages', Icon: MessageSquare },
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

        {/* Slack logo */}
        <div className="w-8 h-8 rounded-lg bg-[#4A154B] flex items-center justify-center shrink-0">
          <span className="text-white text-sm font-bold">#</span>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Slack Workspace</h1>
          <div className="flex items-center gap-2 mt-0.5">
            {connected !== null && (
              <StatusBadge status={connected ? 'connected' : 'disconnected'} size="sm" />
            )}
            <span className="text-[11px] text-slate-500">
              {channels.length} channel{channels.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <button
          onClick={() => void loadChannels()}
          disabled={loadingChannels}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
          title="Refresh"
        >
          {loadingChannels ? (
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
            title="Slack not connected"
            description="Connect Slack from the Apps page to use this workspace."
            action={{ label: 'Go to Apps', onClick: () => navigate('/dashboard/apps') }}
          />
        </div>
      ) : activeTab === 'channels' ? (
        <div className="flex-1 overflow-hidden">
          <ChannelList
            channels={channels}
            selectedId={selectedChannel?.id ?? null}
            onSelect={handleSelectChannel}
            loading={loadingChannels}
          />
        </div>
      ) : activeTab === 'messages' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedChannel ? (
            <>
              {/* Channel header */}
              <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 shrink-0">
                <Hash className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-semibold text-white">{selectedChannel.name}</span>
                {selectedChannel.topic && (
                  <span className="text-xs text-slate-500 truncate ml-2">— {selectedChannel.topic}</span>
                )}
              </div>

              {/* Messages */}
              <MessageView
                messages={messages}
                channelName={selectedChannel.name}
                loading={loadingMessages}
              />

              {/* Compose */}
              <ComposeBox
                channelName={selectedChannel.name}
                onSend={sendMessage}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Select a channel to view messages</p>
                <button
                  onClick={() => setActiveTab('channels')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 mt-2 font-medium transition-colors"
                >
                  Browse channels
                </button>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <SlackActivityTab connectorId={CONNECTOR_ID} />
        </div>
      ) : activeTab === 'automation' ? (
        <div className="flex-1 overflow-y-auto">
          <SlackAutomationTab />
        </div>
      ) : null}
    </div>
  );
}
