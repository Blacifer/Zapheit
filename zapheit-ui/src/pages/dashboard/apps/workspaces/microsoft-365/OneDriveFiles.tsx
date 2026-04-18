import { useState } from 'react';
import { Search, HardDrive, FileText, Image, Film, Table, Share2, ExternalLink, Bot, ChevronDown, Loader2, Folder } from 'lucide-react';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';
import { PendingApprovalRow } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OneDriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  owners?: { displayName: string; emailAddress: string }[];
  shared?: boolean;
  webViewLink?: string;
  isFolder?: boolean;
}

export interface AgentTouch {
  actor: string;
  action: string;
  ts: string;
}

interface OneDriveFilesProps {
  files: OneDriveFile[];
  loading: boolean;
  onShare: (fileId: string, email: string, role: string) => void;
  pendingApprovals?: ApprovalRequest[];
  onApprovalResolved?: (id: string) => void;
  agentActivity?: Record<string, AgentTouch[]>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fileIcon(mime?: string, isFolder?: boolean) {
  if (isFolder) return Folder;
  if (!mime) return FileText;
  if (mime.includes('image')) return Image;
  if (mime.includes('video')) return Film;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return Table;
  return FileText;
}

function formatSize(bytes?: string): string {
  if (!bytes) return '';
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function timeAgo(raw?: string): string {
  if (!raw) return '';
  const ms = Date.now() - new Date(raw).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/* ------------------------------------------------------------------ */
/*  Share modal                                                        */
/* ------------------------------------------------------------------ */

function ShareModal({ file, onClose, onShare }: { file: OneDriveFile; onClose: () => void; onShare: (email: string, role: string) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('read');
  const [submitting, setSubmitting] = useState(false);

  const handleShare = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    await onShare(email.trim(), role);
    setSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0f1117] shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-white">Share "{file.name}"</h3>
        <div className="space-y-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 focus:outline-none"
          >
            <option value="read">View</option>
            <option value="write">Edit</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            disabled={submitting || !email.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
            Share
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/[0.06] text-slate-400 text-xs font-medium hover:bg-white/[0.1] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function OneDriveFiles({
  files, loading, onShare,
  pendingApprovals = [], onApprovalResolved,
  agentActivity = {},
  hasMore = false, loadingMore = false, onLoadMore,
}: OneDriveFilesProps) {
  const [search, setSearch] = useState('');
  const [shareTarget, setShareTarget] = useState<OneDriveFile | null>(null);

  const filtered = search.trim()
    ? files.filter((f) => (f.name || '').toLowerCase().includes(search.toLowerCase()))
    : files;

  return (
    <div className="flex flex-col h-full">
      {pendingApprovals.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-500/15 bg-amber-500/[0.03] space-y-1.5 shrink-0">
          <p className="text-[10px] text-amber-400/80 font-semibold uppercase tracking-wider mb-2">
            {pendingApprovals.length} pending file action{pendingApprovals.length !== 1 ? 's' : ''}
          </p>
          {pendingApprovals.map((a) => (
            <PendingApprovalRow key={a.id} approval={a} onResolved={onApprovalResolved ?? (() => {})} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
        </div>
        <span className="text-[11px] text-slate-600 shrink-0">{filtered.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="animate-pulse space-y-px p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <HardDrive className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No files found</p>
          </div>
        ) : (
          <div>
            {filtered.map((f) => {
              const Icon = fileIcon(f.mimeType, f.isFolder);
              const touches = agentActivity[f.id] || [];
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                    <Icon className={`w-4 h-4 ${f.isFolder ? 'text-blue-400' : 'text-slate-400'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-slate-200 truncate">{f.name || 'Untitled'}</p>
                      {f.shared && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium shrink-0">Shared</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {f.size && <span className="text-[10px] text-slate-600">{formatSize(f.size)}</span>}
                      {f.modifiedTime && <span className="text-[10px] text-slate-600">{timeAgo(f.modifiedTime)}</span>}
                      {f.owners?.[0] && <span className="text-[10px] text-slate-600 truncate">{f.owners[0].displayName}</span>}
                    </div>
                    {touches.length > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        <Bot className="w-3 h-3 text-violet-400" />
                        <span className="text-[10px] text-violet-400/80">{touches.length} agent touch{touches.length !== 1 ? 'es' : ''}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!f.isFolder && (
                      <button
                        onClick={() => setShareTarget(f)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
                        title="Share"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
                        title="Open"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <div className="px-4 py-3 border-t border-white/[0.04]">
                <button
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
                >
                  {loadingMore
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</>
                    : <><ChevronDown className="w-3.5 h-3.5" />Load more files</>
                  }
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {shareTarget && (
        <ShareModal
          file={shareTarget}
          onClose={() => setShareTarget(null)}
          onShare={(email, role) => {
            onShare(shareTarget.id, email, role);
            setShareTarget(null);
          }}
        />
      )}
    </div>
  );
}
