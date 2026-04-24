import { useState, useCallback, useEffect } from 'react';
import { Briefcase, Plus, Loader2, MapPin, Clock, AlertTriangle, X } from 'lucide-react';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

interface JobPosting {
  id: string;
  title: string;
  location?: string;
  employment_type?: string;
  created_at?: string;
  status?: string;
  source: 'linkedin' | 'naukri';
}

function normalizeLinkedIn(raw: any): JobPosting {
  return {
    id: raw.id || String(Math.random()),
    title: raw.title || raw.jobTitle || 'Untitled',
    location: raw.formattedLocation || raw.location,
    employment_type: raw.employmentType,
    created_at: raw.listedAt ? new Date(raw.listedAt).toLocaleDateString() : undefined,
    status: raw.jobState || 'LISTED',
    source: 'linkedin',
  };
}

interface CreateJobForm {
  title: string;
  description: string;
  location: string;
  employment_type: string;
}

const EMPTY_FORM: CreateJobForm = { title: '', description: '', location: '', employment_type: 'full-time' };

export default function JobPostings() {
  const [jobs, setJobs]         = useState<JobPosting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm]         = useState<CreateJobForm>(EMPTY_FORM);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.unifiedConnectors.executeAction('linkedin-recruiter', 'list_job_postings', { limit: 20 });
      if (res.success) {
        const raw: any[] = Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? [];
        setJobs(raw.map(normalizeLinkedIn));
      }
    } catch {
      // silent — connector may not be connected
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const handleCreate = useCallback(async () => {
    if (!form.title || !form.description) {
      toast.error('Title and description are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.unifiedConnectors.executeAction('naukri', 'create_job', {
        title: form.title,
        description: form.description,
        location: form.location || undefined,
        employment_type: form.employment_type,
      });
      if (res.success) {
        toast.success('Job posting created');
        if ((res as any).data?.pending) toast.info('Pending approval before publishing');
        setShowForm(false);
        setForm(EMPTY_FORM);
        void loadJobs();
      } else if ((res as any).data?.pending) {
        toast.info('Job posting sent for approval');
        setShowForm(false);
        setForm(EMPTY_FORM);
      } else {
        toast.error(res.error || 'Failed to create job posting');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }, [form, loadJobs]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0">
        <span className="text-xs text-slate-500">{jobs.length} active posting{jobs.length !== 1 ? 's' : ''} · LinkedIn</span>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Post on Naukri
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="px-5 py-4 border-b border-violet-500/20 bg-violet-500/5 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">New job posting</p>
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <AlertTriangle className="w-3 h-3" /> Requires approval
              </span>
            </div>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }} className="text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Job title *"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
          />
          <textarea
            placeholder="Job description *"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 resize-none"
          />
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Location (optional)"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
            />
            <select
              value={form.employment_type}
              onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value }))}
              className="bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500/50"
            >
              <option value="full-time">Full-time</option>
              <option value="part-time">Part-time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Submit for approval
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-3 text-slate-500 mt-16">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading job postings…</span>
          </div>
        ) : jobs.length > 0 ? (
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="p-3 rounded-xl border border-white/8 bg-white/[0.02]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{j.title}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {j.location && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <MapPin className="w-3 h-3" />{j.location}
                        </span>
                      )}
                      {j.employment_type && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Briefcase className="w-3 h-3" />{j.employment_type}
                        </span>
                      )}
                      {j.created_at && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />{j.created_at}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0A66C2]/20 text-[#0A66C2] border border-[#0A66C2]/30 whitespace-nowrap">
                    LinkedIn
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center mt-16">
            <Briefcase className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No job postings found</p>
            <p className="text-xs text-slate-600 mt-1">Connect LinkedIn Recruiter or post a new job on Naukri</p>
          </div>
        )}
      </div>
    </div>
  );
}
