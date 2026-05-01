import { useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { authenticatedFetch } from '../../../../lib/api/_helpers';
import { toast } from '../../../../lib/toast';

interface RequestAccessModalProps {
  appName: string;
  onClose: () => void;
}

export function RequestAccessModal({ appName, onClose }: RequestAccessModalProps) {
  const [form, setForm] = useState({ app_name: appName, name: '', email: '', company: '', use_case: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const ready = form.name && form.email && form.company && form.use_case;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await authenticatedFetch('/api/marketplace/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appName.toLowerCase().replace(/\s+/g, '-'), app_name: form.app_name, use_case: `${form.name} (${form.company}, ${form.email}): ${form.use_case}` }),
      });
      setDone(true);
    } catch {
      toast.error('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1829] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Request access — {appName}</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {done ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-white">Request submitted!</p>
            <p className="text-xs text-slate-400">We'll notify you at {form.email} when {appName} is ready.</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-xl bg-white/[0.07] text-sm text-slate-300 hover:bg-white/[0.12] transition-colors">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Tell us about your use case — this becomes our roadmap signal.</p>
            {[
              { k: 'name' as const, label: 'Your name', type: 'text' },
              { k: 'email' as const, label: 'Work email', type: 'email' },
              { k: 'company' as const, label: 'Company name', type: 'text' },
            ].map(({ k, label, type }) => (
              <div key={k}>
                <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={form[k]}
                  onChange={(e) => set(k, e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Use case</label>
              <textarea
                rows={3}
                value={form.use_case}
                onChange={(e) => set('use_case', e.target.value)}
                placeholder="What would you automate if this app were connected?"
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/50 transition-colors resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
              <button
                disabled={!ready || submitting}
                onClick={handleSubmit}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Submit request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
