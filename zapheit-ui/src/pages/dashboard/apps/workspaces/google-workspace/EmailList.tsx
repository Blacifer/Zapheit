import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Search, Mail, Paperclip, Plus, ArrowLeft,
  Reply, Forward, Archive, Send, Loader2, X, ChevronDown,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { PendingApprovalRow } from '../shared';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GmailMessage {
  id: string;
  threadId?: string;
  messageId?: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  labelIds?: string[];
  isUnread?: boolean;
  hasAttachment?: boolean;
}

interface EmailDetail extends GmailMessage {
  cc?: string;
  replyTo?: string;
  body?: string;
  isHtml?: boolean;
}

interface EmailListProps {
  emails: GmailMessage[];
  loading: boolean;
  pendingApprovals?: ApprovalRequest[];
  onApprovalResolved?: (id: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onEmailActionComplete?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(raw?: string): string {
  if (!raw) return '';
  const ms = Date.now() - new Date(raw).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function senderName(from?: string): string {
  if (!from) return 'Unknown';
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.split('@')[0];
}

function senderInitial(from?: string): string {
  return (senderName(from)[0] ?? '?').toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Compose / Reply box                                                */
/* ------------------------------------------------------------------ */

interface ComposeProps {
  connectorId: string;
  mode: 'compose' | 'reply' | 'forward';
  email?: EmailDetail;
  onClose: () => void;
  onSubmitted?: () => void;
}

function ComposeBox({ connectorId, mode, email, onClose, onSubmitted }: ComposeProps) {
  const [to, setTo] = useState(mode === 'reply' ? (email?.replyTo || email?.from || '') : '');
  const [subject, setSubject] = useState(
    mode === 'reply' ? `Re: ${email?.subject ?? ''}` :
    mode === 'forward' ? `Fwd: ${email?.subject ?? ''}` : ''
  );
  const [body, setBody] = useState(
    mode === 'forward' && email
      ? `\n\n---------- Forwarded message ----------\nFrom: ${email.from}\nDate: ${email.date}\nSubject: ${email.subject}\n\n${email.body ?? email.snippet ?? ''}`
      : ''
  );
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      toast.error('To, subject and body are required');
      return;
    }
    setSending(true);
    try {
      const data: Record<string, string> = { to, subject, body };
      if (mode === 'reply' && email?.threadId) data.threadId = email.threadId;
      if (mode === 'reply' && email?.messageId) data.messageId = email.messageId;
      const action = mode === 'reply' ? 'reply_email' : mode === 'forward' ? 'forward_email' : 'send_email';
      const res = await api.unifiedConnectors.executeAction(connectorId, action, data);
      if (res.success) {
        if ((res as any).pending) {
          toast.info((res as any).message || 'Action sent for approval');
          onSubmitted?.();
        } else {
          toast.success(mode === 'reply' ? 'Reply sent' : mode === 'forward' ? 'Forwarded' : 'Email sent');
          onSubmitted?.();
        }
        onClose();
      } else {
        toast.error((res as any).error || 'Failed to send');
      }
    } catch { toast.error('Network error'); }
    finally { setSending(false); }
  };

  return (
    <div className="border-t border-white/[0.08] bg-[#0d1117] flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
        <span className="text-xs font-semibold text-slate-300 capitalize">{mode}</span>
        <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 py-2 space-y-1.5">
        <input
          value={to} onChange={(e) => setTo(e.target.value)}
          placeholder="To"
          className="w-full px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
        <input
          value={subject} onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        />
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message…"
          rows={5}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Email detail view                                                  */
/* ------------------------------------------------------------------ */

interface EmailDetailViewProps {
  connectorId: string;
  emailMeta: GmailMessage;
  onBack: () => void;
  onArchived: (id: string) => void;
  onActionComplete?: () => void;
}

function EmailDetailView({ connectorId, emailMeta, onBack, onArchived, onActionComplete }: EmailDetailViewProps) {
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState<'reply' | 'forward' | null>(null);
  const [archiving, setArchiving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.unifiedConnectors.executeAction(connectorId, 'get_email', { id: emailMeta.id });
        const payload = res.data as any;
        if (res.success && payload?.data) setDetail(payload.data);
        else setDetail({ ...emailMeta });
      } catch { setDetail({ ...emailMeta }); }
      finally { setLoading(false); }
    })();
  }, [emailMeta]);

  const handleArchive = async () => {
    setArchiving(true);
    try {
      const res = await api.unifiedConnectors.executeAction(connectorId, 'archive_email', { id: emailMeta.id });
      if (res.success) {
        toast.success('Archived');
        onArchived(emailMeta.id);
        onActionComplete?.();
        onBack();
      } else toast.error('Failed to archive');
    } catch { toast.error('Network error'); }
    finally { setArchiving(false); }
  };

  const handleMarkState = async (nextUnread: boolean) => {
    try {
      const res = await api.unifiedConnectors.executeAction(
        connectorId,
        nextUnread ? 'mark_email_unread' : 'mark_email_read',
        { id: emailMeta.id },
      );
      if (res.success) {
        setDetail((prev) => prev ? {
          ...prev,
          labelIds: nextUnread
            ? Array.from(new Set([...(prev.labelIds || []), 'UNREAD']))
            : (prev.labelIds || []).filter((label) => label !== 'UNREAD'),
        } : prev);
        toast.success(nextUnread ? 'Marked unread' : 'Marked read');
        onActionComplete?.();
      } else {
        toast.error((res as any).error || 'Failed to update email state');
      }
    } catch {
      toast.error('Network error');
    }
  };

  const email = detail ?? emailMeta;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setCompose('reply')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors"
        >
          <Reply className="w-3.5 h-3.5" /> Reply
        </button>
        <button
          onClick={() => setCompose('forward')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors"
        >
          <Forward className="w-3.5 h-3.5" /> Forward
        </button>
        <button
          onClick={() => void handleMarkState(!(email.labelIds || []).includes('UNREAD'))}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors"
        >
          <Mail className="w-3.5 h-3.5" /> {(email.labelIds || []).includes('UNREAD') ? 'Mark read' : 'Mark unread'}
        </button>
        <button
          onClick={handleArchive}
          disabled={archiving}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-400 text-xs font-medium transition-colors disabled:opacity-40"
        >
          {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
          Archive
        </button>
      </div>

      {/* Email content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
          </div>
        ) : (
          <div className="px-5 py-4">
            {/* Subject */}
            <h2 className="text-base font-semibold text-white mb-4 leading-snug">
              {email.subject || '(no subject)'}
            </h2>

            {/* From / To / Date */}
            <div className="flex items-start gap-3 mb-5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/30 to-violet-500/30 flex items-center justify-center text-white font-semibold text-sm shrink-0">
                {senderInitial(email.from)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-100">{senderName(email.from)}</p>
                <p className="text-[11px] text-slate-500 truncate">{email.from}</p>
                {email.to && <p className="text-[11px] text-slate-500 mt-0.5">To: {email.to}</p>}
                {(email as EmailDetail).cc && <p className="text-[11px] text-slate-500">Cc: {(email as EmailDetail).cc}</p>}
              </div>
              <p className="text-[11px] text-slate-500 shrink-0">{timeAgo(email.date)}</p>
            </div>

            {/* Body */}
            {(email.labelIds || []).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {(email.labelIds || []).map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-400"
                  >
                    {label.toLowerCase()}
                  </span>
                ))}
              </div>
            )}
            <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
              {(detail as EmailDetail | null)?.body || email.snippet || '(empty)'}
            </div>
          </div>
        )}
      </div>

      {/* Compose area */}
      {compose && (
        <ComposeBox
          connectorId={connectorId}
          mode={compose}
          email={detail ?? undefined}
          onClose={() => setCompose(null)}
          onSubmitted={onActionComplete}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function EmailList({
  emails, loading,
  pendingApprovals = [], onApprovalResolved,
  hasMore = false, loadingMore = false, onLoadMore,
  onEmailActionComplete,
}: EmailListProps) {
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [openEmail, setOpenEmail] = useState<GmailMessage | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  const handleArchived = useCallback((id: string) => {
    setArchivedIds((prev) => new Set([...prev, id]));
  }, []);

  const filtered = useMemo(() => {
    let list = emails.filter((e) => !archivedIds.has(e.id));
    if (unreadOnly) list = list.filter((e) => e.isUnread);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        (e.subject || '').toLowerCase().includes(q) ||
        (e.from || '').toLowerCase().includes(q) ||
        (e.snippet || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [emails, archivedIds, search, unreadOnly]);

  const unreadCount = useMemo(
    () => emails.filter((e) => e.isUnread && !archivedIds.has(e.id)).length,
    [emails, archivedIds],
  );

  // Email detail view
  if (openEmail) {
    return (
      <EmailDetailView
        connectorId="google_workspace"
        emailMeta={openEmail}
        onBack={() => setOpenEmail(null)}
        onArchived={handleArchived}
        onActionComplete={onEmailActionComplete}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Pending approvals */}
      {pendingApprovals.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-500/15 bg-amber-500/[0.03] space-y-1.5 shrink-0">
          <p className="text-[10px] text-amber-400/80 font-semibold uppercase tracking-wider mb-2">
            Awaiting your approval — {pendingApprovals.length} outbound email{pendingApprovals.length !== 1 ? 's' : ''}
          </p>
          {pendingApprovals.map((a) => (
            <PendingApprovalRow key={a.id} approval={a} onResolved={onApprovalResolved ?? (() => {})} />
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emails…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
        </div>

        {/* Unread filter toggle */}
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0',
            unreadOnly
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              : 'bg-white/[0.05] text-slate-500 hover:text-slate-300',
          )}
        >
          Unread
          {unreadCount > 0 && (
            <span className={cn(
              'text-[9px] px-1 py-0.5 rounded-full font-bold leading-none',
              unreadOnly ? 'bg-blue-500/30 text-blue-200' : 'bg-white/10 text-slate-400',
            )}>
              {unreadCount}
            </span>
          )}
        </button>

        <span className="text-[11px] text-slate-600 shrink-0">{filtered.length}</span>
        <button
          onClick={() => setShowCompose((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 text-xs font-medium hover:bg-blue-600/30 transition-colors shrink-0"
        >
          <Plus className="w-3 h-3" /> Compose
        </button>
      </div>

      {/* Compose */}
      {showCompose && (
        <ComposeBox
          connectorId="google_workspace"
          mode="compose"
          onClose={() => setShowCompose(false)}
          onSubmitted={onEmailActionComplete}
        />
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="animate-pulse space-y-px p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Mail className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {unreadOnly ? 'No unread emails' : 'No emails found'}
            </p>
            {unreadOnly && (
              <button onClick={() => setUnreadOnly(false)} className="mt-2 text-xs text-blue-400 hover:underline">
                Show all
              </button>
            )}
          </div>
        ) : (
          <div>
            {filtered.map((e) => (
              <div
                key={e.id}
                onClick={() => setOpenEmail(e)}
                className={cn(
                  'flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.03] transition-colors',
                  e.isUnread && 'bg-blue-500/[0.03]',
                )}
              >
                <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/25 to-violet-500/25 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5">
                  {senderInitial(e.from)}
                  {e.isUnread && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 border border-[#0a0a0f]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 justify-between">
                    <span className={cn('text-xs truncate', e.isUnread ? 'font-bold text-white' : 'font-medium text-slate-300')}>
                      {senderName(e.from)}
                    </span>
                    <span className="text-[10px] text-slate-600 shrink-0">{timeAgo(e.date)}</span>
                  </div>
                  <p className={cn('text-xs truncate mt-0.5', e.isUnread ? 'text-slate-200 font-medium' : 'text-slate-400')}>
                    {e.subject || '(no subject)'}
                  </p>
                  <p className="text-[10px] text-slate-600 truncate mt-0.5">{e.snippet}</p>
                </div>
                {e.hasAttachment && <Paperclip className="w-3 h-3 text-slate-500 shrink-0 mt-1.5" />}
              </div>
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="px-4 py-3 border-t border-white/[0.04]">
                <button
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
                >
                  {loadingMore
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</>
                    : <><ChevronDown className="w-3.5 h-3.5" />Load more emails</>
                  }
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
