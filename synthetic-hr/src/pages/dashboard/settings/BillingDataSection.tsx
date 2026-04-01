import { Download, RefreshCw, Save, TrendingUp } from 'lucide-react';

export function BillingDataSection({
  usageData,
  orgName,
  setOrgName,
  dataRetention,
  setDataRetention,
  handleSaveOrg,
  savingOrg,
  setShowUpgradeModal,
  handleExportAllData,
  exportingData,
}: {
  usageData: { used: number; quota: number; plan: string; planKey: string; month: string } | null;
  orgName: string;
  setOrgName: React.Dispatch<React.SetStateAction<string>>;
  dataRetention: number;
  setDataRetention: React.Dispatch<React.SetStateAction<number>>;
  handleSaveOrg: () => void;
  savingOrg: boolean;
  setShowUpgradeModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleExportAllData: () => void;
  exportingData: boolean;
}) {
  const usagePct = usageData && usageData.quota > 0 ? Math.min(100, Math.round((usageData.used / usageData.quota) * 100)) : 0;
  const barColor = usagePct >= 90 ? 'bg-rose-500' : usagePct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const usageLabel = usageData
    ? usageData.quota === -1
      ? 'Unlimited requests'
      : `${usageData.used.toLocaleString()} / ${usageData.quota.toLocaleString()} requests`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Billing &amp; Data</h2>
        <p className="text-slate-400 text-sm">Manage plan capacity, retention, and data portability for the whole workspace.</p>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Plan &amp; Usage</h3>
          {usageData && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
              {usageData.plan}
            </span>
          )}
        </div>
        {usageData ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400">Gateway requests this month</span>
                <span className={`font-mono font-semibold ${usagePct >= 90 ? 'text-rose-300' : usagePct >= 80 ? 'text-amber-300' : 'text-slate-300'}`}>
                  {usageData.quota === -1 ? 'Unlimited' : `${usagePct}%`}
                </span>
              </div>
              {usageData.quota !== -1 && (
                <div className="h-2 w-full rounded-full bg-slate-700/60 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${usagePct}%` }} />
                </div>
              )}
              {usageLabel && <p className="text-xs text-slate-500 mt-1.5 font-mono">{usageLabel}</p>}
            </div>
            {usageData.quota !== -1 && usagePct >= 80 && (
              <div className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${usagePct >= 90 ? 'border-rose-500/20 bg-rose-500/5 text-rose-300' : 'border-amber-500/20 bg-amber-500/5 text-amber-300'}`}>
                <TrendingUp className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{usagePct >= 90 ? 'You\'ve used over 90% of your monthly quota. Upgrade to avoid request blocking.' : 'You\'re approaching your monthly quota. Consider upgrading your plan.'}</span>
              </div>
            )}
            {usageData.planKey !== 'enterprise' && (
              <div className="flex justify-end">
                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-semibold hover:from-cyan-500/20 hover:to-blue-500/20 transition-all"
                >
                  View plans &amp; upgrade →
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-3 rounded-full bg-slate-700/60 animate-pulse w-full" />
            <div className="h-3 rounded-full bg-slate-700/40 animate-pulse w-2/3" />
          </div>
        )}
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <h3 className="text-base font-semibold text-white">Workspace Data Controls</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Billing Workspace Name</label>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Data Retention Period <span className="text-cyan-400 font-bold">{dataRetention} days</span>
          </label>
          <input
            type="range"
            min={30}
            max={365}
            step={30}
            value={dataRetention}
            onChange={(e) => setDataRetention(parseInt(e.target.value, 10))}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>30 days</span><span>6 months</span><span>1 year</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">Incident logs, agent activity, and audit trails are retained for this duration before automatic deletion. Higher retention improves forensic depth but increases storage footprint.</p>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={handleSaveOrg} disabled={savingOrg} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20">
            {savingOrg ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingOrg ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Data Portability</h3>
          <p className="text-sm text-slate-400 mt-1">Your data is yours — export or delete it at any time. Exports include agents, conversations, incidents, policies, audit logs, cost records, and webhooks.</p>
        </div>
        <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Export all my data</p>
              <p className="text-xs text-slate-500">Downloads a ZIP archive with all your organization's data as JSON files.</p>
            </div>
          </div>
          <button
            onClick={handleExportAllData}
            disabled={exportingData}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50 flex-shrink-0 ml-4"
          >
            {exportingData ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exportingData ? 'Exporting…' : 'Export ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
