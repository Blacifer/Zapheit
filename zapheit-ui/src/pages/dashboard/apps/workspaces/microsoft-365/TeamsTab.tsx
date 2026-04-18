import { useState, useCallback, useRef, useEffect } from 'react';
import { MessageSquare, Send, Loader2, Users, ChevronRight, Hash, Bot } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

const CONNECTOR_ID = 'microsoft-365';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MsTeam {
  id: string;
  displayName?: string;
  description?: string;
}

export interface MsChannel {
  id: string;
  displayName?: string;
  description?: string;
  membershipType?: string;
}

export interface TeamsMessage {
  id: string;
  from?: string;
  body?: string;
  isHtml?: boolean;
  createdAt?: string;
  edited?: boolean;
}

interface TeamsTabProps {
  teams: MsTeam[];
  loadingTeams: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(raw?: string): string {
  if (!raw) return '';
  const ms = Date.now() - new Date(raw).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (name[0] ?? '?').toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Channel messages panel                                            */
/* ------------------------------------------------------------------ */

function ChannelMessages({ team, channel, onBack }: { team: MsTeam; channel: MsChannel; onBack: () => void }) {
  const [messages, setMessages] = useState<TeamsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'get_channel_messages', {
        team_id: team.id,
        channel_id: channel.id,
        limit: 50,
      });
      const payload = res.data as any;
      if (res.success && payload?.data) setMessages((payload.data as TeamsMessage[]).reverse());
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [team.id, channel.id]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'send_teams_message', {
        team_id: team.id,
        channel_id: channel.id,
        body: message.trim(),
      });
      if (res.success) {
        setMessage('');
        void loadMessages();
      } else {
        toast.error((res as any).error || 'Failed to send');
      }
    } catch { toast.error('Network error'); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
        <Hash className="w-3.5 h-3.5 text-slate-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white">{channel.displayName}</p>
          <p className="text-[10px] text-slate-500 truncate">{team.displayName}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No messages yet</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isBot = msg.from?.toLowerCase().includes('bot') || msg.from?.toLowerCase().includes('agent');
              return (
                <div key={msg.id} className="flex items-start gap-2.5">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                    isBot ? 'bg-violet-500/20 text-violet-300' : 'bg-blue-500/20 text-blue-300',
                  )}>
                    {isBot ? <Bot className="w-3.5 h-3.5" /> : initials(msg.from)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-slate-200">{msg.from || 'Unknown'}</span>
                      <span className="text-[10px] text-slate-600">{timeAgo(msg.createdAt)}</span>
                      {msg.edited && <span className="text-[10px] text-slate-600">(edited)</span>}
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5 leading-relaxed break-words">
                      {msg.isHtml
                        ? msg.body?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                        : msg.body}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-white/[0.06] px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
            }}
            placeholder={`Message #${channel.displayName}…`}
            rows={2}
            className="flex-1 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
          />
          <button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40 shrink-0"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Channel list                                                       */
/* ------------------------------------------------------------------ */

function TeamChannels({ team, onSelectChannel, onBack }: { team: MsTeam; onSelectChannel: (ch: MsChannel) => void; onBack: () => void }) {
  const [channels, setChannels] = useState<MsChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_teams_channels', { team_id: team.id });
        const payload = res.data as any;
        if (res.success && payload?.data) setChannels(payload.data);
      } catch { /* empty */ }
      finally { setLoading(false); }
    })();
  }, [team.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/30 to-blue-500/30 flex items-center justify-center text-white font-bold text-xs shrink-0">
          {(team.displayName?.[0] ?? 'T').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{team.displayName}</p>
          <p className="text-[10px] text-slate-500">Channels</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-px p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center py-16">
            <Hash className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No channels</p>
          </div>
        ) : (
          channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => onSelectChannel(ch)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors text-left"
            >
              <Hash className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">{ch.displayName}</p>
                {ch.description && <p className="text-[10px] text-slate-500 truncate">{ch.description}</p>}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Teams tab                                                     */
/* ------------------------------------------------------------------ */

export function TeamsTab({ teams, loadingTeams }: TeamsTabProps) {
  const [selectedTeam, setSelectedTeam] = useState<MsTeam | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<MsChannel | null>(null);

  if (selectedTeam && selectedChannel) {
    return (
      <ChannelMessages
        team={selectedTeam}
        channel={selectedChannel}
        onBack={() => setSelectedChannel(null)}
      />
    );
  }

  if (selectedTeam) {
    return (
      <TeamChannels
        team={selectedTeam}
        onSelectChannel={setSelectedChannel}
        onBack={() => setSelectedTeam(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
        <p className="text-xs font-semibold text-slate-300">Your Teams</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{teams.length} team{teams.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingTeams ? (
          <div className="animate-pulse space-y-px p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No teams found</p>
          </div>
        ) : (
          teams.map((team) => (
            <button
              key={team.id}
              onClick={() => setSelectedTeam(team)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-blue-500/30 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {(team.displayName?.[0] ?? 'T').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{team.displayName}</p>
                {team.description && <p className="text-[10px] text-slate-500 truncate">{team.description}</p>}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
