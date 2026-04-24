import { useState, useCallback } from 'react';
import { Search, Loader2, User, MapPin, Briefcase, ExternalLink } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

type Source = 'linkedin' | 'naukri';

interface Candidate {
  id: string;
  name: string;
  title?: string;
  location?: string;
  source: Source;
}

function normalize(raw: any, source: Source): Candidate {
  if (source === 'linkedin') {
    return {
      id: raw.id || raw.entityUrn || String(Math.random()),
      name: [raw.firstName, raw.lastName].filter(Boolean).join(' ') || raw.localizedFirstName || 'Unknown',
      title: raw.headline || raw.localizedHeadline,
      location: raw.locationName,
      source: 'linkedin',
    };
  }
  return {
    id: raw.candidate_id || raw.id || String(Math.random()),
    name: raw.name || raw.full_name || 'Unknown',
    title: raw.current_title || raw.designation,
    location: raw.location || raw.city,
    source: 'naukri',
  };
}

const SOURCE_LABELS: Record<Source, string> = { linkedin: 'LinkedIn', naukri: 'Naukri' };
const SOURCE_COLORS: Record<Source, string> = {
  linkedin: 'bg-[#0A66C2]/20 text-[#0A66C2] border-[#0A66C2]/30',
  naukri:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

export default function CandidateList() {
  const [query, setQuery]         = useState('');
  const [source, setSource]       = useState<Source>('linkedin');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]     = useState(false);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setCandidates([]);
    try {
      const connectorId = source === 'linkedin' ? 'linkedin-recruiter' : 'naukri';
      const params = source === 'linkedin'
        ? { keywords: query, limit: 20 }
        : { query, limit: 20 };
      const res = await api.unifiedConnectors.executeAction(connectorId, 'search_candidates', params);
      if (!res.success) {
        toast.error(res.error || 'Search failed — check that the connector is connected.');
        return;
      }
      const raw: any[] = Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? [];
      setCandidates(raw.map((c) => normalize(c, source)));
    } catch {
      toast.error('Network error during candidate search');
    } finally {
      setLoading(false);
    }
  }, [query, source]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void search();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-3 p-4 border-b border-white/5 shrink-0">
        <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs">
          {(['linkedin', 'naukri'] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={cn(
                'px-3 py-1.5 font-medium transition-colors',
                source === s ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {SOURCE_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder={source === 'linkedin' ? 'Search by keywords, skills, role…' : 'Search by name, role, skills…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
        </div>

        <button
          onClick={() => void search()}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 text-slate-500 mt-16">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Searching {SOURCE_LABELS[source]}…</span>
          </div>
        ) : candidates.length > 0 ? (
          <div className="space-y-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{c.name}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', SOURCE_COLORS[c.source])}>
                      {SOURCE_LABELS[c.source]}
                    </span>
                  </div>
                  {c.title && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Briefcase className="w-3 h-3 text-slate-500" />
                      <span className="text-xs text-slate-400 truncate">{c.title}</span>
                    </div>
                  )}
                  {c.location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-500" />
                      <span className="text-xs text-slate-500">{c.location}</span>
                    </div>
                  )}
                </div>
                {c.source === 'linkedin' && (
                  <a
                    href={`https://www.linkedin.com/in/${c.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                    title="View on LinkedIn"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : query && !loading ? (
          <div className="text-center mt-16">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No candidates found for "{query}"</p>
            <p className="text-xs text-slate-600 mt-1">Try different keywords or switch sources</p>
          </div>
        ) : (
          <div className="text-center mt-16">
            <Search className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Search for candidates on LinkedIn or Naukri</p>
            <p className="text-xs text-slate-600 mt-1">Results from both platforms appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
