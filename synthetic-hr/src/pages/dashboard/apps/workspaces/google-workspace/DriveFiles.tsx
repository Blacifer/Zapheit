import { useState } from 'react';
import { Search, HardDrive, FileText, Image, Film, Table, Share2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  owners?: { displayName: string; emailAddress: string }[];
  shared?: boolean;
  webViewLink?: string;
}

interface DriveFilesProps {
  files: DriveFile[];
  loading: boolean;
  onShare: (fileId: string, email: string, role: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fileIcon(mime?: string) {
  if (!mime) return FileText;
  if (mime.includes('image')) return Image;
  if (mime.includes('video')) return Film;
  if (mime.includes('spreadsheet') || mime.includes('excel')) return Table;
  return FileText;
}

function fmtSize(bytes?: string) {
  if (!bytes) return '';
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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

export function DriveFiles({ files, loading, onShare }: DriveFilesProps) {
  const [search, setSearch] = useState('');
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState('');

  const filtered = files.filter((f) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (f.name || '').toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
        </div>
        <span className="text-[11px] text-slate-600">{filtered.length} files</span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <HardDrive className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No files found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((f) => {
              const Icon = fileIcon(f.mimeType);
              return (
                <div key={f.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-blue-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{f.name || 'Untitled'}</p>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        {f.owners?.[0]?.displayName && <span>{f.owners[0].displayName}</span>}
                        {f.size && <span>{fmtSize(f.size)}</span>}
                        {f.modifiedTime && <span>{timeAgo(f.modifiedTime)}</span>}
                        {f.shared && <span className="text-blue-400">Shared</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => setShareTarget(shareTarget === f.id ? null : f.id)}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-blue-400 transition-colors"
                      title="Share"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {shareTarget === f.id && (
                    <div className="mt-2 ml-7 flex gap-2">
                      <input
                        type="text"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                      />
                      <button
                        onClick={() => {
                          if (shareEmail.trim()) {
                            onShare(f.id, shareEmail.trim(), 'reader');
                            setShareEmail('');
                            setShareTarget(null);
                          }
                        }}
                        disabled={!shareEmail.trim()}
                        className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-xs font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-40"
                      >
                        Share
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
