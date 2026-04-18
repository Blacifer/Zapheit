import { useState, useCallback, useEffect } from 'react';
import { Loader2, MessageSquare, RefreshCw, Send, User } from 'lucide-react';
import { api, type SlackMessage } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { cn } from '../../../../lib/utils';
import { fmtDate } from '../helpers';

export function SlackTab({ serviceId: _serviceId }: { serviceId: string }) {
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [filter, setFilter] = useState<'all' | SlackMessage['status']>('all');
  const [loading, setLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.slack.getMessages(filter === 'all' ? {} : { status: filter });
    if (res.success) setMessages((res.data as SlackMessage[]) || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const sendReply = async (id: string) => {
    if (!replyText.trim()) return;
    setReplying(true);
    const res = await api.slack.reply(id, replyText.trim());
    if (res.success) {
      toast.success('Reply sent');
      setMessages((p) => p.map((m) => m.id === id ? { ...m, status: 'replied' } : m));
      setReplyTarget(null); setReplyText('');
    } else { toast.error((res as any).error || 'Failed to send'); }
    setReplying(false);
  };

  const updateStatus = async (id: string, status: SlackMessage['status']) => {
    const res = await api.slack.updateStatus(id, status);
    if (res.success) setMessages((p) => p.map((m) => m.id === id ? { ...m, status } : m));
  };

  const FILTERS: Array<{ value: typeof filter; label: string }> = [
    { value: 'all', label: 'All' }, { value: 'new', label: 'New' },
    { value: 'reviewed', label: 'Reviewed' }, { value: 'replied', label: 'Replied' }, { value: 'dismissed', label: 'Dismissed' },
  ];

  const STATUS_COLOR: Record<SlackMessage['status'], string> = {
    new:       'border-blue-400/20 bg-blue-500/10 text-blue-200',
    reviewed:  'border-white/10 bg-white/5 text-slate-300',
    replied:   'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    dismissed: 'border-white/5 bg-white/[0.03] text-slate-500',
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(({ value, label }) => (
          <button key={value} onClick={() => setFilter(value)}
            className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-colors', filter === value ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5')}>
            {label}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors" title="Refresh">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
      ) : messages.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No {filter === 'all' ? '' : filter} messages.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div key={msg.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <User className="w-3 h-3 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-slate-300">{msg.slack_user_name || 'User'}</span>
                    {msg.slack_channel_name && <span className="text-[10px] text-slate-500 ml-1.5">#{msg.slack_channel_name}</span>}
                  </div>
                </div>
                <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-medium', STATUS_COLOR[msg.status])}>
                  {msg.status}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{msg.text}</p>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-slate-600">{fmtDate(msg.created_at)}</span>
                <div className="flex gap-1 ml-auto">
                  {msg.status === 'new' && (
                    <button onClick={() => updateStatus(msg.id, 'reviewed')} className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-white transition-colors">
                      Mark reviewed
                    </button>
                  )}
                  {msg.status !== 'dismissed' && (
                    <button onClick={() => updateStatus(msg.id, 'dismissed')} className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-rose-300 transition-colors">
                      Dismiss
                    </button>
                  )}
                  <button onClick={() => setReplyTarget(replyTarget === msg.id ? null : msg.id)} className="text-[10px] px-2 py-0.5 rounded-md border border-blue-400/20 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors">
                    Reply
                  </button>
                </div>
              </div>
              {replyTarget === msg.id && (
                <div className="flex items-center gap-2 pt-1">
                  <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendReply(msg.id); } }}
                    placeholder="Type a reply…"
                    className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  <button onClick={() => void sendReply(msg.id)} disabled={replying || !replyText.trim()} className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                    {replying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
