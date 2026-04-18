import { useState, useMemo } from 'react';
import { Search, Star, GitFork, Lock, Globe, Code2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string;
  html_url: string;
  default_branch: string;
}

interface RepoListProps {
  repos: GitHubRepo[];
  loading: boolean;
  selectedRepo: string | null;
  onSelect: (repo: GitHubRepo) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const LANG_COLORS: Record<string, string> = {
  TypeScript: 'bg-blue-400',
  JavaScript: 'bg-yellow-400',
  Python: 'bg-blue-300',
  Go: 'bg-cyan-400',
  Rust: 'bg-orange-400',
  Java: 'bg-red-400',
  Ruby: 'bg-red-500',
  'C#': 'bg-violet-400',
  'C++': 'bg-pink-400',
  Swift: 'bg-orange-500',
  Kotlin: 'bg-violet-300',
  PHP: 'bg-indigo-400',
  Shell: 'bg-emerald-400',
  HTML: 'bg-orange-300',
  CSS: 'bg-purple-400',
};

function timeAgo(iso: string): string {
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

export function RepoList({ repos, loading, selectedRepo, onSelect }: RepoListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');

  const filtered = useMemo(() => {
    let list = repos;
    if (filter === 'public') list = list.filter((r) => !r.private);
    if (filter === 'private') list = list.filter((r) => r.private);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.full_name.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.language || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [repos, search, filter]);

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
            placeholder="Find a repository…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'public', 'private'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors capitalize',
                filter === f
                  ? 'bg-white/10 text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Repo list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Code2 className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No repositories found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((repo) => (
              <button
                key={repo.id}
                onClick={() => onSelect(repo)}
                className={cn(
                  'w-full text-left px-4 py-3 hover:bg-white/[0.04] transition-colors',
                  selectedRepo === repo.name && 'bg-white/[0.06]',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {repo.private ? (
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-cyan-400 truncate">{repo.full_name}</span>
                </div>

                {repo.description && (
                  <p className="text-[11px] text-slate-500 line-clamp-1 mb-2 ml-5">{repo.description}</p>
                )}

                <div className="flex items-center gap-3 ml-5">
                  {repo.language && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <span className={cn('w-2 h-2 rounded-full', LANG_COLORS[repo.language] || 'bg-slate-500')} />
                      {repo.language}
                    </span>
                  )}
                  {repo.stargazers_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-500">
                      <Star className="w-3 h-3" /> {repo.stargazers_count}
                    </span>
                  )}
                  {repo.open_issues_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-500">
                      <GitFork className="w-3 h-3" /> {repo.open_issues_count} open
                    </span>
                  )}
                  <span className="text-[10px] text-slate-600">Updated {timeAgo(repo.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
