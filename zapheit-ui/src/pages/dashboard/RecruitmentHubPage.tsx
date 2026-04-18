import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase, Users, Settings2, RefreshCw, Plus, X, Sparkles, Loader2,
  MapPin, Clock, IndianRupee, FileText, ChevronDown, Check, Ban, Eye,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type {
  JobPosting, JobApplication, JobPostingStatus, EmploymentType, ApplicationStatus,
} from '../../types';

type TabId = 'jobs' | 'applications' | 'settings';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

// ─── Score Color Helper ───────────────────────────────────────────────────────

function scoreColor(score: number | null | undefined) {
  if (score == null) return 'text-slate-500';
  if (score >= 85) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-rose-400';
}

function scoreBg(score: number | null | undefined) {
  if (score == null) return 'bg-slate-800/50';
  if (score >= 85) return 'bg-emerald-500/15 border-emerald-500/30';
  if (score >= 60) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-rose-500/15 border-rose-500/30';
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
    open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    closed: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    new: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    screening: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    shortlisted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    interviewing: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    offered: 'bg-green-500/15 text-green-300 border-green-500/30',
    rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    withdrawn: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  };
  return map[status] || 'bg-slate-600/20 text-slate-300 border-slate-600/30';
}

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function RecruitmentHubPage() {
  const [tab, setTab] = useState<TabId>('jobs');
  const [busy, setBusy] = useState(false);

  // Data
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);

  // Filters
  const [minScore, setMinScore] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Create job drawer
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showAddApplication, setShowAddApplication] = useState(false);

  // ─── Data Loading ─────────────────────────────────────────────────────

  const loadJobs = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.recruitment.listJobs({ limit: 100 });
      if (res.success && res.data) {
        setJobs(res.data);
        // Auto-select first job if none selected
        if (!selectedJobId && res.data.length > 0) {
          setSelectedJobId(res.data[0].id);
        }
      } else {
        toast.error(res.error || 'Failed to load jobs');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load jobs');
    } finally {
      setBusy(false);
    }
  }, [selectedJobId]);

  const loadApplications = useCallback(async () => {
    if (!selectedJobId) { setApplications([]); return; }
    setBusy(true);
    try {
      const res = await api.recruitment.listApplications(selectedJobId, {
        min_score: minScore > 0 ? minScore : undefined,
        status: statusFilter || undefined,
        limit: 200,
      });
      if (res.success && res.data) {
        setApplications(res.data);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load applications');
    } finally {
      setBusy(false);
    }
  }, [selectedJobId, minScore, statusFilter]);

  useEffect(() => { void loadJobs(); }, []);
  useEffect(() => { void loadApplications(); }, [selectedJobId, minScore, statusFilter]);

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId) || null, [jobs, selectedJobId]);

  // ─── Actions ──────────────────────────────────────────────────────────

  const handleScoreApplication = async (appId: string) => {
    try {
      setBusy(true);
      const res = await api.recruitment.scoreApplication(appId);
      if (res.success) {
        toast.success('Resume scored successfully');
        void loadApplications();
      } else {
        toast.error(res.error || 'Scoring failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Scoring failed');
    } finally {
      setBusy(false);
    }
  };

  const handleScoreAll = async () => {
    if (!selectedJobId) return;
    try {
      setBusy(true);
      const res = await api.recruitment.scoreAllApplications(selectedJobId);
      if (res.success) {
        const d = res.data as any;
        toast.success(`Scored ${d?.scored || 0} of ${d?.total || 0} applications`);
        void loadApplications();
      } else {
        toast.error(res.error || 'Batch scoring failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Batch scoring failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateApplicationStatus = async (appId: string, status: ApplicationStatus) => {
    try {
      const res = await api.recruitment.updateApplicationStatus(appId, status);
      if (res.success) {
        toast.success(`Application ${status}`);
        void loadApplications();
      } else {
        toast.error(res.error || 'Update failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Update failed');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const res = await api.recruitment.deleteJob(jobId);
      if (res.success) {
        toast.success('Job deleted');
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
        if (selectedJobId === jobId) setSelectedJobId(null);
      } else {
        toast.error(res.error || 'Delete failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  };

  // ─── Tabs ─────────────────────────────────────────────────────────────

  const tabs = useMemo(() => [
    { id: 'jobs' as const, label: 'Jobs', icon: Briefcase },
    { id: 'applications' as const, label: 'Applications', icon: Users },
    { id: 'settings' as const, label: 'Screening Settings', icon: Settings2 },
  ], []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Recruitment Hub</h1>
          <p className="text-sm text-slate-400 mt-1">
            Post jobs, track applications, and let AI screen resumes automatically.
          </p>
        </div>
        <button
          onClick={() => { void loadJobs(); void loadApplications(); }}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className={cx('w-4 h-4', busy && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'px-3 py-1.5 rounded-full text-xs border inline-flex items-center gap-2',
              tab === t.id
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ JOBS TAB ═══ */}
      {tab === 'jobs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-400">{jobs.length} job posting{jobs.length !== 1 ? 's' : ''}</div>
            <button
              onClick={() => setShowCreateJob(true)}
              className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Job
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No job postings yet. Create your first job to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className={cx(
                    'bg-slate-800/30 border rounded-xl p-4 cursor-pointer transition-all hover:bg-slate-800/50',
                    selectedJobId === job.id ? 'border-cyan-500/50 ring-1 ring-cyan-500/20' : 'border-slate-700'
                  )}
                  onClick={() => { setSelectedJobId(job.id); setTab('applications'); }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-white font-semibold truncate flex-1">{job.title}</h3>
                    <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(job.status))}>
                      {job.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-400">
                    {job.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {job.location}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
                    </span>
                    {(job.salary_min || job.salary_max) && (
                      <span className="inline-flex items-center gap-1">
                        <IndianRupee className="w-3 h-3" />
                        {job.salary_min ? `${(job.salary_min / 100000).toFixed(1)}L` : ''}
                        {job.salary_min && job.salary_max ? ' – ' : ''}
                        {job.salary_max ? `${(job.salary_max / 100000).toFixed(1)}L` : ''}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-400 mt-3 line-clamp-2">{job.description}</p>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-700/50">
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      {job.ai_screening_enabled && (
                        <span className="inline-flex items-center gap-1 text-purple-400">
                          <Sparkles className="w-3 h-3" /> AI Screening
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                        title="Delete job"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ APPLICATIONS TAB ═══ */}
      {tab === 'applications' && (
        <div className="space-y-4">
          {/* Job Selector + Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedJobId || ''}
              onChange={(e) => setSelectedJobId(e.target.value || null)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white min-w-[200px]"
            >
              <option value="">Select a job...</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>

            {/* Score Slider */}
            <div className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-1.5">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-slate-400">Min Score:</span>
              <input
                type="range"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-24 accent-purple-500"
              />
              <span className={cx('text-xs font-mono font-semibold w-8 text-right', scoreColor(minScore > 0 ? minScore : null))}>
                {minScore > 0 ? `${minScore}%` : 'All'}
              </span>
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All statuses</option>
              {['new', 'screening', 'shortlisted', 'interviewing', 'offered', 'rejected', 'withdrawn'].map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>

            <div className="flex-1" />

            {selectedJobId && (
              <>
                <button
                  onClick={handleScoreAll}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4" />
                  Score All
                </button>
                <button
                  onClick={() => setShowAddApplication(true)}
                  className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Application
                </button>
              </>
            )}
          </div>

          {/* Applications Table */}
          {!selectedJobId ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Select a job to view applications.</p>
            </div>
          ) : applications.length === 0 ? (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
              <FileText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No applications yet{minScore > 0 ? ` with score >= ${minScore}%` : ''}.</p>
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 text-sm text-slate-300">
                {applications.length} application{applications.length !== 1 ? 's' : ''}
                {selectedJob ? ` for "${selectedJob.title}"` : ''}
              </div>
              <div className="divide-y divide-slate-800/60">
                {applications.map((app) => (
                  <div key={app.id} className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Score Circle */}
                      <div className={cx(
                        'w-14 h-14 rounded-full border flex flex-col items-center justify-center shrink-0',
                        scoreBg(app.ai_score)
                      )}>
                        {app.ai_score != null ? (
                          <>
                            <span className={cx('text-lg font-bold', scoreColor(app.ai_score))}>{app.ai_score}</span>
                            <span className="text-[8px] text-slate-500 -mt-0.5">/ 100</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">N/A</span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold truncate">{app.candidate_name}</span>
                          <span className={cx('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border', statusBadge(app.status))}>
                            {app.status}
                          </span>
                          {app.source_platform && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-700/50 text-slate-400 border border-slate-600">
                              {app.source_platform}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {app.candidate_email && <span>{app.candidate_email}</span>}
                          {app.candidate_phone && <span className="ml-2">{app.candidate_phone}</span>}
                          <span className="ml-2 text-slate-500">
                            Applied {new Date(app.applied_at).toLocaleDateString()}
                          </span>
                        </div>
                        {app.ai_summary && (
                          <p className="text-sm text-slate-300 mt-2">{app.ai_summary}</p>
                        )}
                        {app.rejection_reason && (
                          <p className="text-xs text-rose-400 mt-1">{app.rejection_reason}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {app.ai_score == null && (
                          <button
                            onClick={() => handleScoreApplication(app.id)}
                            disabled={busy}
                            className="p-2 rounded-lg text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-40"
                            title="Score resume with AI"
                          >
                            <Sparkles className="w-4 h-4" />
                          </button>
                        )}
                        {app.status === 'new' && (
                          <>
                            <button
                              onClick={() => handleUpdateApplicationStatus(app.id, 'shortlisted')}
                              className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                              title="Shortlist"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleUpdateApplicationStatus(app.id, 'rejected')}
                              className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Reject"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {app.status === 'shortlisted' && (
                          <button
                            onClick={() => handleUpdateApplicationStatus(app.id, 'interviewing')}
                            className="p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                            title="Move to Interviewing"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {tab === 'settings' && selectedJob && (
        <ScreeningSettingsPanel job={selectedJob} onSave={async (updates) => {
          const res = await api.recruitment.updateJob(selectedJob.id, updates);
          if (res.success) {
            toast.success('Screening settings updated');
            void loadJobs();
          } else {
            toast.error(res.error || 'Update failed');
          }
        }} />
      )}
      {tab === 'settings' && !selectedJob && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-8 text-center">
          <Settings2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Select a job from the Jobs tab first to configure screening settings.</p>
        </div>
      )}

      {/* ═══ CREATE JOB DRAWER ═══ */}
      {showCreateJob && (
        <CreateJobDrawer
          onClose={() => setShowCreateJob(false)}
          onCreated={() => { setShowCreateJob(false); void loadJobs(); }}
        />
      )}

      {/* ═══ ADD APPLICATION DRAWER ═══ */}
      {showAddApplication && selectedJobId && (
        <AddApplicationDrawer
          jobId={selectedJobId}
          onClose={() => setShowAddApplication(false)}
          onCreated={() => { setShowAddApplication(false); void loadApplications(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREENING SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function ScreeningSettingsPanel({ job, onSave }: { job: JobPosting; onSave: (updates: Partial<JobPosting>) => Promise<void> }) {
  const [enabled, setEnabled] = useState(job.ai_screening_enabled);
  const [threshold, setThreshold] = useState(job.ai_screening_threshold);
  const [autoReject, setAutoReject] = useState<number | null>(job.auto_reject_below ?? null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ai_screening_enabled: enabled,
        ai_screening_threshold: threshold,
        auto_reject_below: autoReject,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6 max-w-xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white">AI Screening for "{job.title}"</h3>
        <p className="text-sm text-slate-400 mt-1">Configure how AI scores and filters incoming applications.</p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30"
        />
        <span className="text-sm text-white">Enable AI resume screening</span>
      </label>

      <div>
        <label className="text-sm text-slate-300 block mb-2">
          Display threshold: show applications scoring <span className="font-semibold text-white">{threshold}%+</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-purple-500"
        />
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>

      <div>
        <label className="text-sm text-slate-300 block mb-2">
          Auto-reject below score (optional)
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={100}
            value={autoReject ?? ''}
            onChange={(e) => setAutoReject(e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g., 30"
            className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          />
          <span className="text-xs text-slate-500">Leave blank to disable auto-rejection</span>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Save Settings
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE JOB DRAWER
// ═══════════════════════════════════════════════════════════════════════════════

function CreateJobDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    requirements: '',
    location: '',
    employment_type: 'full_time' as EmploymentType,
    salary_min: '',
    salary_max: '',
    status: 'draft' as JobPostingStatus,
    ai_screening_enabled: true,
    ai_screening_threshold: 75,
  });

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required');
      return;
    }
    setSaving(true);
    try {
      const res = await api.recruitment.createJob({
        title: form.title.trim(),
        description: form.description.trim(),
        requirements: form.requirements.trim() || undefined,
        location: form.location.trim() || undefined,
        employment_type: form.employment_type,
        salary_min: form.salary_min ? Number(form.salary_min) : undefined,
        salary_max: form.salary_max ? Number(form.salary_max) : undefined,
        status: form.status,
        ai_screening_enabled: form.ai_screening_enabled,
        ai_screening_threshold: form.ai_screening_threshold,
      } as any);
      if (res.success) {
        toast.success('Job posting created');
        onCreated();
      } else {
        toast.error(res.error || 'Failed to create job');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Create Job Posting</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-300 block mb-1">Title *</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g., Senior Frontend Engineer"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300 block mb-1">Description *</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={5}
              placeholder="Job description..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300 block mb-1">Requirements</label>
            <textarea
              value={form.requirements}
              onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
              rows={3}
              placeholder="Required skills, experience..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-300 block mb-1">Location</label>
              <input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="e.g., Bangalore, Remote"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-300 block mb-1">Type</label>
              <select
                value={form.employment_type}
                onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value as EmploymentType }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-300 block mb-1">Salary Min (INR)</label>
              <input
                type="number"
                value={form.salary_min}
                onChange={(e) => setForm((f) => ({ ...f, salary_min: e.target.value }))}
                placeholder="e.g., 800000"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-300 block mb-1">Salary Max (INR)</label>
              <input
                type="number"
                value={form.salary_max}
                onChange={(e) => setForm((f) => ({ ...f, salary_max: e.target.value }))}
                placeholder="e.g., 1500000"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-300 block mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as JobPostingStatus }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="draft">Draft</option>
              <option value="open">Open (accepting applications)</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <label className="flex items-center gap-3 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={form.ai_screening_enabled}
              onChange={(e) => setForm((f) => ({ ...f, ai_screening_enabled: e.target.checked }))}
              className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30"
            />
            <span className="text-sm text-white">Enable AI resume screening</span>
          </label>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Job
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD APPLICATION DRAWER
// ═══════════════════════════════════════════════════════════════════════════════

function AddApplicationDrawer({ jobId, onClose, onCreated }: { jobId: string; onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    candidate_name: '',
    candidate_email: '',
    candidate_phone: '',
    resume_text: '',
    cover_letter: '',
    source_platform: 'manual',
  });

  const handleSubmit = async () => {
    if (!form.candidate_name.trim()) {
      toast.error('Candidate name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await api.recruitment.createApplication(jobId, {
        candidate_name: form.candidate_name.trim(),
        candidate_email: form.candidate_email.trim() || undefined,
        candidate_phone: form.candidate_phone.trim() || undefined,
        resume_text: form.resume_text.trim() || undefined,
        cover_letter: form.cover_letter.trim() || undefined,
        source_platform: form.source_platform || 'manual',
      } as any);
      if (res.success) {
        toast.success('Application added');
        onCreated();
      } else {
        toast.error(res.error || 'Failed to add application');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add application');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full border-l border-white/10 bg-slate-900 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Add Application</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-300 block mb-1">Candidate Name *</label>
            <input
              value={form.candidate_name}
              onChange={(e) => setForm((f) => ({ ...f, candidate_name: e.target.value }))}
              placeholder="Full name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-300 block mb-1">Email</label>
              <input
                type="email"
                value={form.candidate_email}
                onChange={(e) => setForm((f) => ({ ...f, candidate_email: e.target.value }))}
                placeholder="email@example.com"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-300 block mb-1">Phone</label>
              <input
                value={form.candidate_phone}
                onChange={(e) => setForm((f) => ({ ...f, candidate_phone: e.target.value }))}
                placeholder="+91..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-300 block mb-1">Source</label>
            <select
              value={form.source_platform}
              onChange={(e) => setForm((f) => ({ ...f, source_platform: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="manual">Manual Entry</option>
              <option value="naukri">Naukri</option>
              <option value="linkedin">LinkedIn</option>
              <option value="zoho_recruit">Zoho Recruit</option>
              <option value="direct">Direct / Website</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-slate-300 block mb-1">Resume Text (paste for AI scoring)</label>
            <textarea
              value={form.resume_text}
              onChange={(e) => setForm((f) => ({ ...f, resume_text: e.target.value }))}
              rows={8}
              placeholder="Paste the candidate's resume text here for AI screening..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y font-mono"
            />
          </div>

          <div>
            <label className="text-sm text-slate-300 block mb-1">Cover Letter</label>
            <textarea
              value={form.cover_letter}
              onChange={(e) => setForm((f) => ({ ...f, cover_letter: e.target.value }))}
              rows={3}
              placeholder="Optional cover letter..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-y"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm inline-flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Application
          </button>
        </div>
      </div>
    </div>
  );
}
