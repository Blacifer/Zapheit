import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Briefcase, Users, Activity,
  RefreshCw, Loader2, Star, ExternalLink, Search,
  TrendingUp, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';

/* ─────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */

interface JobPosting {
  id: string;
  title: string;
  department: string;
  location: string;
  type: 'full_time' | 'contract' | 'internship';
  postedAt: string;
  applicantCount: number;
  shortlistedCount: number;
  status: 'active' | 'paused' | 'closed';
}

interface Candidate {
  id: string;
  name: string;
  jobId: string;
  jobTitle: string;
  experience: string;
  skills: string[];
  source: 'naukri' | 'linkedin';
  appliedAt: string;
  aiScore: number;
  aiSummary: string;
  status: 'new' | 'shortlisted' | 'interview' | 'offered' | 'rejected';
  resumeUrl?: string;
}

/* ─────────────────────────────────────────────────────────────────────────
   Mock data
──────────────────────────────────────────────────────────────────────────── */

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const MOCK_JOBS: JobPosting[] = [
  { id: 'JOB-101', title: 'Senior Backend Engineer', department: 'Engineering', location: 'Bengaluru (Hybrid)', type: 'full_time', postedAt: '2026-04-10T10:00:00Z', applicantCount: 87, shortlistedCount: 8, status: 'active' },
  { id: 'JOB-102', title: 'Product Manager — Integrations', department: 'Product', location: 'Bengaluru / Remote', type: 'full_time', postedAt: '2026-04-15T09:00:00Z', applicantCount: 43, shortlistedCount: 4, status: 'active' },
  { id: 'JOB-103', title: 'Frontend Developer (React)', department: 'Engineering', location: 'Bengaluru (Hybrid)', type: 'full_time', postedAt: '2026-04-18T11:00:00Z', applicantCount: 62, shortlistedCount: 5, status: 'active' },
  { id: 'JOB-104', title: 'Customer Success Manager', department: 'Customer Success', location: 'Mumbai', type: 'full_time', postedAt: '2026-04-20T10:00:00Z', applicantCount: 29, shortlistedCount: 3, status: 'active' },
  { id: 'JOB-105', title: 'Data Science Intern', department: 'Engineering', location: 'Bengaluru', type: 'internship', postedAt: '2026-04-05T09:00:00Z', applicantCount: 118, shortlistedCount: 6, status: 'paused' },
];

const MOCK_CANDIDATES: Candidate[] = [
  { id: 'CAND-001', name: 'Arjun Nair', jobId: 'JOB-101', jobTitle: 'Senior Backend Engineer', experience: '5 years', skills: ['Go', 'PostgreSQL', 'Kubernetes', 'gRPC'], source: 'naukri', appliedAt: '2026-04-25T08:30:00Z', aiScore: 94, aiSummary: 'Strong match — 5 years Go + distributed systems at Flipkart. Kubernetes certified. Exactly the profile we need for the integrations team.', status: 'shortlisted' },
  { id: 'CAND-002', name: 'Sneha Krishnamurthy', jobId: 'JOB-101', jobTitle: 'Senior Backend Engineer', experience: '4 years', skills: ['Node.js', 'TypeScript', 'MongoDB', 'Docker'], source: 'naukri', appliedAt: '2026-04-25T07:15:00Z', aiScore: 81, aiSummary: 'Good TypeScript background but no Go experience. Strong system design. Worth an interview if Go shortlist is thin.', status: 'new' },
  { id: 'CAND-003', name: 'Rohan Verma', jobId: 'JOB-101', jobTitle: 'Senior Backend Engineer', experience: '6 years', skills: ['Python', 'FastAPI', 'Redis', 'AWS'], source: 'linkedin', appliedAt: '2026-04-24T16:00:00Z', aiScore: 76, aiSummary: 'Strong backend generalist but Python-focused. AWS experience is a plus. Borderline for Go role.', status: 'new' },
  { id: 'CAND-004', name: 'Priya Deshpande', jobId: 'JOB-102', jobTitle: 'Product Manager — Integrations', experience: '4 years', skills: ['Product Strategy', 'APIs', 'B2B SaaS', 'User Research'], source: 'naukri', appliedAt: '2026-04-24T14:30:00Z', aiScore: 91, aiSummary: 'Excellent fit — 4 years PM at Zoho Integrations, deep API product experience, ran end-to-end launches. High priority shortlist.', status: 'shortlisted' },
  { id: 'CAND-005', name: 'Vikram Iyer', jobId: 'JOB-103', jobTitle: 'Frontend Developer (React)', experience: '3 years', skills: ['React', 'TypeScript', 'Tailwind', 'Vite'], source: 'naukri', appliedAt: '2026-04-24T11:00:00Z', aiScore: 88, aiSummary: 'Near-perfect tech stack match — React 18 + TypeScript + Tailwind at a Series A startup. Portfolio is strong.', status: 'interview' },
  { id: 'CAND-006', name: 'Ananya Reddy', jobId: 'JOB-102', jobTitle: 'Product Manager — Integrations', experience: '3 years', skills: ['Product Management', 'SaaS', 'Analytics', 'Roadmapping'], source: 'linkedin', appliedAt: '2026-04-23T17:00:00Z', aiScore: 72, aiSummary: 'Good PM background but no integrations domain experience. May need ramp-up time on API products.', status: 'new' },
  { id: 'CAND-007', name: 'Karthik Subramanian', jobId: 'JOB-104', jobTitle: 'Customer Success Manager', experience: '5 years', skills: ['Customer Success', 'SaaS', 'Onboarding', 'CRM'], source: 'naukri', appliedAt: '2026-04-23T09:30:00Z', aiScore: 89, aiSummary: 'Strong CSM profile — 5 years at Freshdesk and Zoho. Proven track record reducing churn. High priority.', status: 'shortlisted' },
];

const MOCK_ACTIVITY = [
  { id: 1, desc: 'Hiring Agent ranked 87 applicants for Senior Backend Engineer — top 8 shortlisted', agent: true, at: '2026-04-25T09:00:00Z' },
  { id: 2, desc: 'Arjun Nair shortlisted for Senior Backend Engineer', agent: false, at: '2026-04-25T09:05:00Z' },
  { id: 3, desc: 'Priya Deshpande shortlisted for Product Manager — Integrations', agent: false, at: '2026-04-24T15:00:00Z' },
  { id: 4, desc: 'Hiring Agent identified 3 cross-source duplicates — merged Naukri + LinkedIn profiles', agent: true, at: '2026-04-24T13:00:00Z' },
  { id: 5, desc: 'Vikram Iyer moved to Interview stage for Frontend Developer role', agent: false, at: '2026-04-24T12:00:00Z' },
  { id: 6, desc: 'JOB-105 (Data Science Intern) paused — headcount on hold', agent: false, at: '2026-04-23T10:00:00Z' },
  { id: 7, desc: 'Hiring Agent flagged 12 applicants on JOB-105 as low fit (<40% match)', agent: true, at: '2026-04-23T09:30:00Z' },
];

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────────────── */

const JOB_TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', contract: 'Contract', internship: 'Internship' };
const JOB_STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-400',
  closed: 'bg-slate-500/15 text-slate-400',
};
const CANDIDATE_STATUS_COLOR: Record<string, string> = {
  new:         'bg-blue-500/15 text-blue-400',
  shortlisted: 'bg-emerald-500/15 text-emerald-400',
  interview:   'bg-violet-500/15 text-violet-400',
  offered:     'bg-amber-500/15 text-amber-400',
  rejected:    'bg-red-500/15 text-red-400',
};
const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  naukri:   { label: 'Naukri', color: 'bg-orange-500/15 text-orange-400 border-orange-500/20' },
  linkedin: { label: 'LinkedIn', color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
};

function aiScoreColor(score: number) {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-400';
  return 'text-red-400';
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Job Postings
──────────────────────────────────────────────────────────────────────────── */

function JobPostingsTab({ jobs }: { jobs: JobPosting[] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Active Jobs', value: jobs.filter(j => j.status === 'active').length, color: 'text-emerald-400' },
          { label: 'Total Applicants', value: jobs.reduce((a, j) => a + j.applicantCount, 0), color: 'text-white' },
          { label: 'Shortlisted', value: jobs.reduce((a, j) => a + j.shortlistedCount, 0), color: 'text-blue-400' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-white/8 bg-white/3 p-3 text-center">
            <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {jobs.map(job => (
        <div key={job.id} className="rounded-2xl border border-white/8 bg-white/3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', JOB_STATUS_COLOR[job.status])}>
                  {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                </span>
                <span className="text-xs text-slate-500">{JOB_TYPE_LABEL[job.type]}</span>
              </div>
              <p className="text-sm font-semibold text-white">{job.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{job.department} · {job.location} · Posted {fmtDate(job.postedAt)}</p>
            </div>
            <button className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-4 mt-3 pt-3 border-t border-white/8">
            <div className="text-center">
              <p className="text-lg font-bold text-white">{job.applicantCount}</p>
              <p className="text-xs text-slate-500">Applicants</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-emerald-400">{job.shortlistedCount}</p>
              <p className="text-xs text-slate-500">Shortlisted</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-400">
                {job.applicantCount > 0 ? Math.round((job.shortlistedCount / job.applicantCount) * 100) : 0}%
              </p>
              <p className="text-xs text-slate-500">Selection rate</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Candidates (multi-source with AI ranking)
──────────────────────────────────────────────────────────────────────────── */

function CandidatesTab({ candidates }: { candidates: Candidate[] }) {
  const [search, setSearch] = useState('');
  const [jobFilter, setJobFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'naukri' | 'linkedin'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = candidates.filter(c => {
    const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.skills.some(s => s.toLowerCase().includes(search.toLowerCase()));
    const matchesJob = jobFilter === 'all' || c.jobId === jobFilter;
    const matchesSource = sourceFilter === 'all' || c.source === sourceFilter;
    return matchesSearch && matchesJob && matchesSource;
  });

  const uniqueJobs = [...new Set(candidates.map(c => c.jobId))];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or skill..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={jobFilter}
            onChange={e => setJobFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl text-xs border border-white/10 bg-[#0B0F1A] text-slate-300 focus:outline-none focus:border-blue-500/50"
          >
            <option value="all">All Roles</option>
            {uniqueJobs.map(jid => {
              const c = candidates.find(x => x.jobId === jid);
              return <option key={jid} value={jid}>{c?.jobTitle}</option>;
            })}
          </select>
          {(['all', 'naukri', 'linkedin'] as const).map(s => (
            <button key={s} onClick={() => setSourceFilter(s)}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors capitalize',
                sourceFilter === s ? 'bg-blue-600 border-blue-500 text-white' : 'border-white/10 text-slate-400 hover:text-white hover:border-white/20'
              )}>
              {s === 'all' ? 'All Sources' : SOURCE_BADGE[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Candidate cards */}
      <div className="space-y-3">
        {filtered.sort((a, b) => b.aiScore - a.aiScore).map(candidate => {
          const src = SOURCE_BADGE[candidate.source];
          return (
            <div key={candidate.id} className="rounded-2xl border border-white/8 bg-white/3 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white">{candidate.name}</p>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', src.color)}>{src.label}</span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', CANDIDATE_STATUS_COLOR[candidate.status])}>
                      {candidate.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{candidate.jobTitle} · {candidate.experience}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {candidate.skills.slice(0, 4).map(s => (
                      <span key={s} className="px-2 py-0.5 rounded-full text-xs bg-white/8 text-slate-300 border border-white/10">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cn('text-xl font-bold', aiScoreColor(candidate.aiScore))}>
                    {candidate.aiScore}
                  </div>
                  <div className="flex items-center gap-0.5 text-xs text-slate-500 justify-end">
                    <Star className="w-3 h-3" /> AI score
                  </div>
                </div>
              </div>

              <button
                onClick={() => setExpanded(expanded === candidate.id ? null : candidate.id)}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {expanded === candidate.id ? 'Hide AI summary ↑' : 'View AI summary ↓'}
              </button>

              {expanded === candidate.id && (
                <div className="mt-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                  <p className="text-xs font-semibold text-blue-400 mb-1">Hiring Agent Summary</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{candidate.aiSummary}</p>
                  <p className="text-xs text-slate-500 mt-1.5">Applied {fmtTime(candidate.appliedAt)}</p>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center">
            <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No candidates match your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Tab: Activity
──────────────────────────────────────────────────────────────────────────── */

function ActivityTab() {
  return (
    <div className="space-y-2">
      {MOCK_ACTIVITY.map(entry => (
        <div key={entry.id} className="rounded-xl border border-white/8 bg-white/3 p-3 flex items-start gap-3">
          <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', entry.agent ? 'bg-blue-400' : 'bg-slate-500')} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white">{entry.desc}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {entry.agent && <span className="text-xs font-medium text-blue-400">Agent</span>}
              <span className="text-xs text-slate-500">{fmtTime(entry.at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Root workspace component
──────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'jobs',       label: 'Job Postings', Icon: Briefcase },
  { id: 'candidates', label: 'Candidates',   Icon: Users },
  { id: 'activity',   label: 'Activity',     Icon: Activity },
] as const;

type TabId = typeof TABS[number]['id'];

export default function NaukriWorkspace() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('jobs');
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [showBanner, setShowBanner] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await api.unifiedConnectors?.executeAction?.('naukri', 'list_jobs', {});
    } catch { /* fall through to mock */ }
    setJobs(MOCK_JOBS);
    setCandidates(MOCK_CANDIDATES);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalApplicants = jobs.reduce((a, j) => a + j.applicantCount, 0);
  const newCandidates = candidates.filter(c => c.status === 'new').length;
  const multiSource = candidates.filter(c => c.source === 'linkedin').length > 0;

  return (
    <div className="h-full flex flex-col bg-[#0B0F1A] text-white">
      {/* Header */}
      <div className="border-b border-white/8 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard/apps')} className="p-1.5 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: '#FF7555' }}>NK</div>
          <div>
            <h1 className="text-lg font-semibold">Naukri RMS</h1>
            <p className="text-xs text-slate-400">Recruitment workspace{multiSource ? ' · Naukri + LinkedIn' : ''}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-white transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Quick stats */}
      <div className="border-b border-white/8 px-6 py-3 flex items-center gap-6 text-xs shrink-0">
        <span className="text-slate-400">Active Jobs <span className="text-white font-semibold ml-1">{jobs.filter(j => j.status === 'active').length}</span></span>
        <span className="text-slate-400">Applicants <span className="text-white font-semibold ml-1">{totalApplicants}</span></span>
        <span className="text-slate-400">New to Review <span className="text-amber-400 font-semibold ml-1">{newCandidates}</span></span>
        {multiSource && (
          <span className="flex items-center gap-1 text-slate-400">
            Sources <span className="text-blue-400 font-semibold ml-1">Naukri + LinkedIn</span>
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-white/8 px-6 flex gap-1 shrink-0">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              tab === id ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
            )}>
            <Icon className="w-4 h-4" /> {label}
            {id === 'candidates' && newCandidates > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">{newCandidates}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {showBanner && <AgentSuggestionBanner serviceId="naukri" onDismiss={() => setShowBanner(false)} />}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {tab === 'jobs'       && <JobPostingsTab jobs={jobs} />}
            {tab === 'candidates' && <CandidatesTab candidates={candidates} />}
            {tab === 'activity'   && <ActivityTab />}
          </>
        )}
      </div>
    </div>
  );
}
