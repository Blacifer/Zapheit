import type { ComponentType } from 'react';
import { Brain, DollarSign, Loader2, ShieldAlert } from 'lucide-react';
import type { AIAgent } from '../../../types';

export function WorkspaceSettingsPanel({
  activeWorkspaceAgent,
  wsModels,
  wsModelsLoading,
  wsSettingsPlatform,
  setWsSettingsPlatform,
  wsSettingsModel,
  setWsSettingsModel,
  wsSettingsBudget,
  setWsSettingsBudget,
  wsSettingsAutoThrottle,
  setWsSettingsAutoThrottle,
  handleKillSwitch,
  wsSettingsSaving,
  saveWsSettings,
  resetWsSettings,
  InfoTip,
}: {
  activeWorkspaceAgent: AIAgent;
  wsModels: { id: string; name: string; provider: string; pricing?: { prompt?: string; completion?: string } }[];
  wsModelsLoading: boolean;
  wsSettingsPlatform: string;
  setWsSettingsPlatform: React.Dispatch<React.SetStateAction<string>>;
  wsSettingsModel: string;
  setWsSettingsModel: React.Dispatch<React.SetStateAction<string>>;
  wsSettingsBudget: number;
  setWsSettingsBudget: React.Dispatch<React.SetStateAction<number>>;
  wsSettingsAutoThrottle: boolean;
  setWsSettingsAutoThrottle: React.Dispatch<React.SetStateAction<boolean>>;
  handleKillSwitch: (agentId: string, level: 1 | 2 | 3) => void;
  wsSettingsSaving: boolean;
  saveWsSettings: () => Promise<void>;
  resetWsSettings: () => void;
  InfoTip: ComponentType<{ text: string }>;
}) {
  const wsPlatforms = Array.from(new Set(wsModels.map((m) => m.provider)));
  const wsFilteredModels = wsModels.filter((m) => m.provider === wsSettingsPlatform);
  const wsSelectedModel = wsModels.find((m) => m.id === wsSettingsModel);
  const wsFormatPrice = (model: any) => {
    const p = Number(model?.pricing?.prompt || 0);
    const c = Number(model?.pricing?.completion || 0);
    if (!p && !c) return 'Free / Open Source';
    return `$${(((p + c) / 2) * 1000).toFixed(4)} avg / 1K tokens`;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Brain className="w-4 h-4 text-purple-400" /> AI Model
            </h4>
            {wsModelsLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading models…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Platform</label>
                  <select
                    value={wsSettingsPlatform}
                    onChange={(e) => {
                      setWsSettingsPlatform(e.target.value);
                      const first = wsModels.find((m) => m.provider === e.target.value);
                      if (first) setWsSettingsModel(first.id);
                    }}
                    className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500 text-sm"
                  >
                    {wsPlatforms.length > 0 ? wsPlatforms.map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    )) : <option value="">—</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Model</label>
                  <select
                    value={wsSettingsModel}
                    onChange={(e) => setWsSettingsModel(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500 text-sm"
                  >
                    {wsFilteredModels.length > 0 ? wsFilteredModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    )) : <option value={wsSettingsModel}>{wsSettingsModel}</option>}
                  </select>
                </div>
              </div>
            )}
            {wsSelectedModel && (
              <div className="flex items-center justify-between text-xs bg-purple-500/10 px-3 py-2 rounded-lg border border-purple-500/20">
                <span className="text-purple-300/80 font-medium">Gateway pricing</span>
                <span className="font-mono text-purple-300">{wsFormatPrice(wsSelectedModel)}</span>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" /> Budget & Spend Controls
            </h4>
            <div>
              <label className="flex items-center text-xs text-slate-400 mb-1.5">Monthly Budget Cap (₹)<InfoTip text="When spend reaches this limit, the agent stops processing new requests until the next billing cycle or the cap is raised." /></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 text-sm font-bold">₹</span>
                <input
                  type="number"
                  value={wsSettingsBudget}
                  onChange={(e) => setWsSettingsBudget(parseInt(e.target.value) || 0)}
                  className="w-full pl-7 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 text-sm"
                  min="0"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">Current spend: ₹{(activeWorkspaceAgent.current_spend || 0).toLocaleString()}</p>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative shrink-0">
                <input type="checkbox" className="sr-only" checked={wsSettingsAutoThrottle} onChange={(e) => setWsSettingsAutoThrottle(e.target.checked)} />
                <div className={`w-10 h-5 rounded-full transition-colors ${wsSettingsAutoThrottle ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                <div className={`absolute left-1 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform ${wsSettingsAutoThrottle ? 'translate-x-5' : ''}`} />
              </div>
              <div>
                <p className="text-sm text-white font-medium">Auto-Throttle</p>
                <p className="text-xs text-slate-400">Slow down responses as budget limit approaches</p>
              </div>
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-rose-400 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Emergency Controls
          </h4>
          <p className="text-xs text-slate-400">Use these if the agent is behaving incorrectly or causing harm.</p>
          <div className="space-y-2">
            <button onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 1)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all text-sm font-medium">
              <span className="text-base">⏸</span>
              <div className="text-left">
                <p className="font-semibold">Pause agent</p>
                <p className="text-xs text-amber-400/70">Temporarily stop the agent — you can resume it later</p>
              </div>
            </button>
            <button onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 2)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 transition-all text-sm font-medium">
              <span className="text-base">🚩</span>
              <div className="text-left">
                <p className="font-semibold">Flag for human review</p>
                <p className="text-xs text-orange-400/70">Pause the agent and alert your team to investigate</p>
              </div>
            </button>
            <button onClick={() => handleKillSwitch(activeWorkspaceAgent.id, 3)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-sm font-medium">
              <span className="text-base">🛑</span>
              <div className="text-left">
                <p className="font-semibold">Permanently shut down</p>
                <p className="text-xs text-rose-400/70 font-semibold">This cannot be undone — the agent will be terminated forever</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-4 border-t border-slate-700/50">
        <button onClick={resetWsSettings} className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-sm hover:bg-slate-700 transition-colors">
          Reset
        </button>
        <button onClick={() => void saveWsSettings()} disabled={wsSettingsSaving} className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 text-white font-semibold rounded-xl text-sm hover:from-emerald-400 hover:to-teal-300 disabled:opacity-60 transition-all flex items-center gap-2">
          {wsSettingsSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save Changes
        </button>
      </div>
    </div>
  );
}
