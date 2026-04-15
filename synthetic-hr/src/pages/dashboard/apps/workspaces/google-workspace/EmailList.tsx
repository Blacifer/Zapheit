import { useState, useMemo } from 'react';
import { Search, Mail, Paperclip, Plus } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { WriteForm, PendingApprovalRow, type WriteFormField } from '../shared';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  labelIds?: string[];
  isUnread?: boolean;
  hasAttachment?: boolean;
}

interface EmailListProps {
  emails: GmailMessage[];
  loading: boolean;
  onSend: (data: Record<string, string>) => void;
  pendingApprovals?: ApprovalRequest[];
  onApprovalResolved?: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EmailList({ emails, loading, onSend, pendingApprovals = [], onApprovalResolved }: EmailListProps) {
  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);

  const composeFields: WriteFormField[] = [
    { name: 'to', label: 'To', type: 'text', required: true, placeholder: 'recipient@example.com' },
    { name: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Email subject' },
    { name: 'body', label: 'Body', type: 'textarea', required: true, placeholder: 'Write your message…' },
  ];

  const filtered = useMemo(() => {
    if (!search.trim()) return emails;
    const q = search.toLowerCase();
    return emails.filter((e) =>
      (e.subject || '').toLowerCase().includes(q) ||
      (e.from || '').toLowerCase().includes(q) ||
      (e.snippet || '').toLowerCase().includes(q),
    );
  }, [emails, search]);

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
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emails…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
        </div>
        <span className="text-[11px] text-slate-600">{filtered.length} emails</span>
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 text-[11px] font-medium hover:bg-blue-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> Compose
        </button>
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Email"
            fields={composeFields}
            onSubmit={async (values) => {
              onSend(values);
              setShowCompose(false);
            }}
            onCancel={() => setShowCompose(false)}
            submitLabel="Send"
          />
        </div>
      )}

      {/* Email list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Mail className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No emails found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((e) => (
              <div
                key={e.id}
                className={cn(
                  'px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-default',
                  e.isUnread && 'bg-white/[0.01]',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-blue-600/30 flex items-center justify-center text-blue-300 text-xs font-semibold shrink-0 mt-0.5">
                    {(e.from?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn(
                        'text-xs truncate',
                        e.isUnread ? 'font-bold text-white' : 'font-medium text-slate-300',
                      )}>
                        {e.from || 'Unknown sender'}
                      </span>
                      {e.hasAttachment && <Paperclip className="w-3 h-3 text-slate-500 shrink-0" />}
                    </div>
                    <p className={cn(
                      'text-xs truncate mb-0.5',
                      e.isUnread ? 'text-slate-200 font-medium' : 'text-slate-400',
                    )}>
                      {e.subject || '(no subject)'}
                    </p>
                    <p className="text-[10px] text-slate-600 truncate">{e.snippet}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {e.date && (
                      <span className="text-[10px] text-slate-600">{timeAgo(e.date)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
