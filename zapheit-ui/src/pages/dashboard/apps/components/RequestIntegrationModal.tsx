import { useState } from 'react';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../../../../lib/api-client';

interface RequestIntegrationModalProps {
  appId?: string;
  appName?: string;
  onClose: () => void;
}

export function RequestIntegrationModal({ appId, appName: initialName = '', onClose }: RequestIntegrationModalProps) {
  const [appName, setAppName] = useState(initialName);
  const [useCase, setUseCase] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!appName.trim()) { setError('App name is required.'); return; }
    setBusy(true);
    setError(null);
    const res = await api.marketplace.requestIntegration({
      app_id: appId,
      app_name: appName.trim(),
      use_case: useCase.trim() || undefined,
    });
    setBusy(false);
    if (res.success) {
      setDone(true);
    } else {
      setError((res as any).error || 'Failed to submit request. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
          <h2 className="text-base font-semibold text-white">Request an integration</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <p className="text-sm font-semibold text-white">Request submitted!</p>
            <p className="text-xs text-slate-400">We'll prioritise {appName} and notify you when it's available.</p>
            <button
              onClick={onClose}
              className="mt-4 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">App name</label>
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="e.g. Zendesk, Salesforce…"
                disabled={!!initialName}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">What would you use it for?</label>
              <textarea
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="Briefly describe your use case…"
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500"
              />
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={busy || !appName.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Submit request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
