import { CheckCircle2, Globe, Lock, LogOut, Monitor, Smartphone } from 'lucide-react';
import { STORAGE_KEYS } from '../../../utils/storage';
import { toast } from '../../../lib/toast';
import type { ActiveSession } from './types';

export function SecuritySection({
  userRole,
  twoFactorEnabled,
  sessions,
  handleToggle2FA,
  mfaLoading,
  showMfaSetup,
  mfaQrUri,
  mfaSecret,
  mfaCode,
  setMfaCode,
  handleVerifyMfa,
  setShowMfaSetup,
  handleSignOutAll,
  handleRevokeSession,
  orgName,
  signOut,
  showDangerZone,
  setShowDangerZone,
  deleteConfirm,
  setDeleteConfirm,
  handleDeleteOrg,
}: {
  userRole?: string | null;
  twoFactorEnabled: boolean;
  sessions: ActiveSession[];
  handleToggle2FA: () => Promise<void>;
  mfaLoading: boolean;
  showMfaSetup: boolean;
  mfaQrUri: string;
  mfaSecret: string;
  mfaCode: string;
  setMfaCode: React.Dispatch<React.SetStateAction<string>>;
  handleVerifyMfa: () => Promise<void>;
  setShowMfaSetup: React.Dispatch<React.SetStateAction<boolean>>;
  handleSignOutAll: () => Promise<void>;
  handleRevokeSession: (id: string) => void;
  orgName: string;
  signOut: () => Promise<void>;
  showDangerZone: boolean;
  setShowDangerZone: React.Dispatch<React.SetStateAction<boolean>>;
  deleteConfirm: string;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<string>>;
  handleDeleteOrg: () => Promise<void>;
}) {
  const adminMfaRequired = userRole === 'super_admin' || userRole === 'admin';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Security</h2>
        <p className="text-slate-400 text-sm">Manage sign-in protection, session trust, and irreversible workspace actions.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'MFA', value: twoFactorEnabled ? 'Enabled' : 'Off', note: twoFactorEnabled ? 'Account protection is active' : adminMfaRequired ? 'Required for admin access' : 'Strongly recommended for your account' },
          { label: 'Active sessions', value: String(sessions.length), note: 'Logged-in browsers and devices' },
          { label: 'Current device', value: sessions.find((session) => session.current)?.device || 'Unknown', note: 'Session in use right now' },
          { label: 'Risk', value: twoFactorEnabled && sessions.length <= 2 ? 'Low' : 'Review', note: 'Based on MFA and session spread' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-2xl font-bold text-white">{item.value}</p>
            <p className="mt-1 text-sm text-slate-400">{item.note}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl"><Smartphone className="w-5 h-5 text-emerald-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Two-Factor Authentication</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {adminMfaRequired
                  ? 'Required for admin operators. Protect your account with an authenticator app (TOTP).'
                  : 'Recommended for your account. Protect sign-in with an authenticator app (TOTP).'}
              </p>
            </div>
          </div>
          <button onClick={() => void handleToggle2FA()} disabled={mfaLoading} className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60 ${twoFactorEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${twoFactorEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        {twoFactorEnabled && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-slate-300">2FA is active. You'll be asked for a verification code every time you sign in.</p>
          </div>
        )}

        {showMfaSetup && (
          <div className="mt-4 bg-slate-900/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
            <p className="text-sm font-semibold text-white">Scan with your authenticator app</p>
            <p className="text-xs text-slate-400">Use Google Authenticator, Authy, or any TOTP app. Scan the QR code below, then enter the 6-digit code to confirm.</p>
            <div className="flex justify-center">
              <img src={mfaQrUri} alt="2FA QR Code" className="w-40 h-40 rounded-lg bg-white p-2" />
            </div>
            <div className="bg-slate-800/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400 font-mono break-all">{mfaSecret}</span>
              <button onClick={() => { navigator.clipboard.writeText(mfaSecret); toast.success('Secret copied'); }} className="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex-shrink-0">Copy</button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-400">Verification code</label>
              <input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-sm text-slate-200 px-3 py-2 font-mono tracking-widest focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => void handleVerifyMfa()} disabled={mfaLoading || mfaCode.length < 6} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-50 transition-colors">
                {mfaLoading ? 'Verifying…' : 'Enable 2FA'}
              </button>
              <button onClick={() => { setShowMfaSetup(false); setMfaCode(''); }} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 border border-slate-700/60 transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 rounded-xl"><Monitor className="w-5 h-5 text-cyan-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Active Sessions</h3>
              <p className="text-xs text-slate-500 mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''} currently active</p>
            </div>
          </div>
          <button onClick={() => void handleSignOutAll()} className="text-xs text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-500/10 border border-rose-500/20 transition-all">
            Sign out all others
          </button>
        </div>

        <div className="space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${session.current ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-900/50 border-slate-700/50'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${session.current ? 'bg-emerald-500/10' : 'bg-slate-700/60'}`}>
                  <Monitor className={`w-4 h-4 ${session.current ? 'text-emerald-400' : 'text-slate-400'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{session.device}</p>
                    {session.current && <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold uppercase">Current</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{session.browser} · <Globe className="w-3 h-3 inline" /> {session.location} · {session.lastActive}</p>
                </div>
              </div>
              {!session.current && (
                <button onClick={() => handleRevokeSession(session.id)} className="text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 transition-all flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6">
        <h3 className="text-base font-semibold text-amber-400 mb-1">Testing Tools</h3>
        <p className="text-sm text-slate-400 mb-4">Reset one-time UX states so memorable moments and banners re-fire. No data is deleted — localStorage only.</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-white">Reset all moment flags</p>
              <p className="text-xs text-slate-500 mt-0.5">Re-enables: Morning Briefing, Agent Alive overlay, We Caught Something alert, What Changed banner, setup bar</p>
            </div>
            <button
              onClick={() => {
                const org = orgName || 'workspace';
                localStorage.removeItem(`${STORAGE_KEYS.MORNING_BRIEFING_DATE}:${org}`);
                localStorage.removeItem(`${STORAGE_KEYS.AGENT_ALIVE_SEEN}:${org}`);
                localStorage.removeItem(`${STORAGE_KEYS.CAUGHT_SOMETHING_SEEN}:${org}`);
                localStorage.removeItem(`synthetic_hr_setup_bar_dismissed:${org}`);
                localStorage.setItem(`synthetic_hr_last_visit:${org}`, String(Date.now() - 49 * 60 * 60 * 1000));
                toast.success('Moment flags reset — refresh any page to see them fire');
              }}
              className="shrink-0 px-4 py-2 text-sm font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-xl transition-colors"
            >
              Reset moments
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-white">Simulate behavioral drift</p>
              <p className="text-xs text-slate-500 mt-0.5">Sets stored risk baseline to 0 for all agents — drift banners will appear on Fleet page on next load</p>
            </div>
            <button
              onClick={() => {
                let count = 0;
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key?.startsWith('rasi_drift_baseline_')) {
                    const stored = localStorage.getItem(key);
                    if (stored) {
                      const baseline = JSON.parse(stored) as { risk_score: number; model_name: string };
                      localStorage.setItem(key, JSON.stringify({ ...baseline, risk_score: 0 }));
                      count++;
                    }
                  }
                }
                if (count === 0) {
                  toast.info('No baselines found — visit Fleet page first, then come back and run this');
                } else {
                  toast.success(`Drift simulated on ${count} agent${count === 1 ? '' : 's'} — visit Fleet page to see banners`);
                }
              }}
              className="shrink-0 px-4 py-2 text-sm font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-xl transition-colors"
            >
              Simulate drift
            </button>
          </div>
        </div>
      </div>

      <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-6">
        <h3 className="text-base font-semibold text-rose-400 mb-1">Danger Zone</h3>
        <p className="text-sm text-slate-400 mb-4">These actions are permanent and cannot be undone.</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-white">Sign Out</p>
              <p className="text-xs text-slate-500 mt-0.5">End your current session</p>
            </div>
            <button onClick={() => void signOut()} className="px-4 py-2 text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-xl transition-colors flex items-center gap-2">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-rose-500/5 border border-rose-500/20 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-rose-400">Delete Organization</p>
              <p className="text-xs text-slate-500 mt-0.5">Permanently delete all workspace data</p>
            </div>
            <button onClick={() => setShowDangerZone(!showDangerZone)} className="px-4 py-2 text-sm font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl transition-colors">
              Delete Org
            </button>
          </div>
          {showDangerZone && (
            <div className="p-5 bg-rose-500/5 border border-rose-500/30 rounded-xl space-y-3">
              <p className="text-sm text-rose-300 font-semibold">⚠️ This will immediately and permanently delete:</p>
              <ul className="text-xs text-slate-400 space-y-1 ml-4 list-disc">
                <li>All agents, incidents, and audit logs</li>
                <li>All API keys and integrations</li>
                <li>All team members and their access</li>
                <li>All cost data and organization settings</li>
              </ul>
              <p className="text-xs text-slate-400">Type <span className="text-rose-400 font-mono font-bold">{orgName}</span> to confirm:</p>
              <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={orgName} className="w-full px-4 py-2.5 bg-slate-900 border border-rose-500/30 rounded-xl text-white font-mono text-sm outline-none focus:border-rose-500 transition-all" />
              <button onClick={() => void handleDeleteOrg()} disabled={deleteConfirm !== orgName} className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors">
                I understand — Delete Everything
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
