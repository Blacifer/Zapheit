import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, ChevronRight, Loader2, RefreshCw, Sparkles, Users } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { JobApplication, JobPosting } from '../../../../types';
import type { UnifiedApp } from '../types';

type RecruitmentWorkspaceSection = 'jobs' | 'applications';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function statusTone(status: string) {
  const map: Record<string, string> = {
    open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    shortlisted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    interviewing: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
    screening: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
    new: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    offered: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    paused: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
    closed: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
    draft: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  };
  return map[status] || 'bg-slate-700/30 text-slate-300 border-slate-600/30';
}

function scoreTone(score: number | null | undefined) {
  if (score == null) return 'text-slate-500';
  if (score >= 85) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-rose-400';
}

interface RecruitmentWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function RecruitmentWorkspaceTab({ app, agentNames }: RecruitmentWorkspaceTabProps) {
  const [section, setSection] = useState<RecruitmentWorkspaceSection>('applications');
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await api.recruitment.listJobs({ limit: 50 });
    if (res.success && res.data) {
      setJobs(res.data);
      if (!selectedJobId && res.data.length > 0) {
        setSelectedJobId(res.data[0].id);
      }
    } else if (res.error) {
      toast.error(res.error);
    }
  }, [selectedJobId]);

  const loadApplications = useCallback(async (jobId: string | null) => {
    if (!jobId) {
      setApplications([]);
      return;
    }
    const res = await api.recruitment.listApplications(jobId, { limit: 50 });
    if (res.success && res.data) {
      setApplications(res.data);
    } else if (res.error) {
      toast.error(res.error);
    }
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      await loadJobs();
    } finally {
      setBusy(false);
    }
  }, [loadJobs]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadApplications(selectedJobId);
  }, [selectedJobId, loadApplications]);

  const selectedJob = useMemo(() => jobs.find((row) => row.id === selectedJobId) || null, [jobs, selectedJobId]);
  const openJobs = useMemo(() => jobs.filter((row) => row.status === 'open').length, [jobs]);
  const pendingApplications = useMemo(() => applications.filter((row) => ['new', 'screening'].includes(row.status)).length, [applications]);

  const handleScore = async (applicationId: string) => {
    setBusy(true);
    try {
      const res = await api.recruitment.scoreApplication(applicationId);
      if (res.success) {
        toast.success('Candidate scored');
        await loadApplications(selectedJobId);
      } else {
        toast.error(res.error || 'Scoring failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (applicationId: string, status: string) => {
    setBusy(true);
    try {
      const res = await api.recruitment.updateApplicationStatus(applicationId, status);
      if (res.success) {
        toast.success(`Candidate marked ${status}`);
        await loadApplications(selectedJobId);
      } else {
        toast.error(res.error || 'Update failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const sections: Array<{ id: RecruitmentWorkspaceSection; label: string; Icon: typeof Briefcase }> = [
    { id: 'applications', label: 'Candidate queue', Icon: Users },
    { id: 'jobs', label: 'Jobs', Icon: Briefcase },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-violet-300">Recruitment workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} hiring operations inside Zapheit</h3>
            <p className="mt-1 text-sm text-slate-400">
              Review candidate flow, shortlist with agents, and keep hiring actions inside one controlled workspace.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw className={cx('h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Open jobs</p>
            <p className="mt-2 text-2xl font-semibold text-white">{openJobs}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Candidates to review</p>
            <p className="mt-2 text-2xl font-semibold text-white">{pendingApplications}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Linked agents</p>
            <p className="mt-2 text-2xl font-semibold text-white">{agentNames.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Selected job</p>
            <p className="mt-2 truncate text-sm font-semibold text-white">{selectedJob?.title || 'None yet'}</p>
          </div>
        </div>
        {agentNames.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Linked agents: <span className="text-slate-300">{agentNames.join(', ')}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {sections.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={cx(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
              section === id
                ? 'border-violet-400/30 bg-violet-500/10 text-violet-200'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {section === 'jobs' && (
        <div className="grid gap-3 lg:grid-cols-2">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-10 text-sm text-slate-500">
              No job postings available yet.
            </div>
          ) : jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => {
                setSelectedJobId(job.id);
                setSection('applications');
              }}
              className={cx(
                'rounded-2xl border p-4 text-left transition-colors',
                selectedJobId === job.id
                  ? 'border-violet-400/25 bg-violet-500/10'
                  : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.04]'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{job.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{job.employment_type.replace('_', ' ')} • {job.location || 'Location not set'}</p>
                </div>
                <span className={cx('rounded-full border px-2 py-0.5 text-[11px] capitalize', statusTone(job.status))}>
                  {job.status}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-400 line-clamp-2">{job.description || 'No job description yet.'}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{job.application_count || 0} candidates</span>
                <span className="inline-flex items-center gap-1 text-violet-300">
                  Open queue
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {section === 'applications' && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <h4 className="text-sm font-semibold text-white">{selectedJob?.title || 'Candidate queue'}</h4>
              <p className="mt-1 text-xs text-slate-500">Score, shortlist, and move candidates forward without leaving Zapheit.</p>
            </div>
            {selectedJob ? (
              <button
                onClick={() => void api.recruitment.scoreAllApplications(selectedJob.id).then((res) => {
                  if (res.success) {
                    toast.success(`Scored ${(res.data as any)?.scored || 0} candidates`);
                    void loadApplications(selectedJob.id);
                  } else {
                    toast.error(res.error || 'Batch scoring failed');
                  }
                })}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Score all
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-white/6">
            {!selectedJob ? (
              <div className="px-4 py-10 text-sm text-slate-500">Select a job to view candidate activity.</div>
            ) : applications.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No applications found for this job yet.</div>
            ) : applications.slice(0, 20).map((application) => (
              <div key={application.id} className="flex items-start justify-between gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{application.candidate_name || 'Candidate'}</p>
                    <span className={cx('rounded-full border px-2 py-0.5 text-[11px] capitalize', statusTone(application.status))}>
                      {application.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{application.candidate_email || 'No email provided'}</p>
                  <p className={cx('mt-2 text-xs font-medium', scoreTone(application.ai_score))}>
                    {application.ai_score == null ? 'Not scored yet' : `AI score ${application.ai_score}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    onClick={() => void handleScore(application.id)}
                    disabled={busy}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
                  >
                    Score
                  </button>
                  <button
                    onClick={() => void handleStatus(application.id, 'shortlisted')}
                    disabled={busy}
                    className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-200"
                  >
                    Shortlist
                  </button>
                  <button
                    onClick={() => void handleStatus(application.id, 'rejected')}
                    disabled={busy}
                    className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-200"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
