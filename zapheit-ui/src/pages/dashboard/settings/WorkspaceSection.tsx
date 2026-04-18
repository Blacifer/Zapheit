import type { ReactNode } from 'react';
import { RefreshCw, Save } from 'lucide-react';

export function WorkspaceSection({
  orgName,
  setOrgName,
  providerDisplayName,
  setProviderDisplayName,
  workspaceTimezone,
  setWorkspaceTimezone,
  defaultResponseStyle,
  setDefaultResponseStyle,
  profileSection,
  handleSaveProfile,
  savingProfile,
}: {
  orgName: string;
  setOrgName: React.Dispatch<React.SetStateAction<string>>;
  providerDisplayName: string;
  setProviderDisplayName: React.Dispatch<React.SetStateAction<string>>;
  workspaceTimezone: string;
  setWorkspaceTimezone: React.Dispatch<React.SetStateAction<string>>;
  defaultResponseStyle: string;
  setDefaultResponseStyle: React.Dispatch<React.SetStateAction<string>>;
  profileSection: ReactNode;
  handleSaveProfile: () => void;
  savingProfile: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Workspace</h2>
        <p className="text-slate-400 text-sm">Manage your identity, workspace defaults, and daily operator context.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Workspace name', value: orgName || 'Unset', note: 'Used across invites, exports, and summaries' },
          { label: 'Default timezone', value: workspaceTimezone, note: 'Used for alerts, recaps, and scheduled reporting' },
          { label: 'Response style', value: defaultResponseStyle, note: 'Default operator-facing tone for generated summaries' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-lg font-bold text-white">{item.value}</p>
            <p className="mt-1 text-sm text-slate-400">{item.note}</p>
          </div>
        ))}
      </div>

      {profileSection}

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-white">Workspace Defaults</h3>
          <p className="text-sm text-slate-400 mt-1">Set the baseline context operators see across alerts, reporting, and summaries.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Workspace Name</label>
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Provider Display Name</label>
            <input
              value={providerDisplayName}
              onChange={(e) => setProviderDisplayName(e.target.value)}
              placeholder="Zapheit AI"
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
            />
            <p className="mt-1.5 text-xs text-slate-500">Shown on agent cards instead of the underlying model vendor (e.g. "OpenAI").</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Default Timezone</label>
            <select
              value={workspaceTimezone}
              onChange={(e) => setWorkspaceTimezone(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
            >
              {['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Singapore'].map((timezone) => (
                <option key={timezone} value={timezone}>{timezone}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">Default Summary Style</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {['Balanced', 'Executive', 'Ops-heavy'].map((option) => (
                <button
                  key={option}
                  onClick={() => setDefaultResponseStyle(option)}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${defaultResponseStyle === option
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                    : 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-slate-600'
                    }`}
                >
                  <p className="text-sm font-semibold">{option}</p>
                  <p className="text-xs mt-1 text-slate-400">
                    {option === 'Balanced' ? 'Default clarity for most teams.' : option === 'Executive' ? 'High-level summaries and fewer details.' : 'More operational signal and action language.'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={handleSaveProfile} disabled={savingProfile} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20">
            {savingProfile ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingProfile ? 'Saving…' : 'Save Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
