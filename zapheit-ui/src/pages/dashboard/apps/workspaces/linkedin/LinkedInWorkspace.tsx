import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Link2, Link2Off, Info, Loader2, Users } from 'lucide-react';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';

const CONNECTOR_ID = 'linkedin';
const SCOPES = ['r_liteprofile', 'r_emailaddress', 'w_member_social'];
const CALLBACK_URL = 'https://api.zapheit.com/integrations/oauth/callback/linkedin';

export default function LinkedInWorkspace() {
  const navigate = useNavigate();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'search_candidates', { query: 'test', limit: 1 });
      setConnected(res.success);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void checkConnection(); }, [checkConnection]);

  const handleConnect = useCallback(() => {
    const url = api.integrations.getOAuthAuthorizeUrl('linkedin', window.location.href);
    window.location.href = url;
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect LinkedIn? Recruitment actions will stop.')) return;
    try {
      await api.integrations.disconnect('linkedin');
      setConnected(false);
      toast.success('LinkedIn disconnected');
    } catch {
      toast.error('Failed to disconnect LinkedIn');
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#080b12]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8 shrink-0">
        <button
          onClick={() => navigate('/dashboard/apps')}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-[#0A66C2] flex items-center justify-center shrink-0">
          <span className="text-white text-sm font-bold">in</span>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">LinkedIn Recruiter</h1>
          {!checking && connected !== null && (
            <div className="mt-0.5">
              <StatusBadge status={connected ? 'connected' : 'disconnected'} size="sm" />
            </div>
          )}
        </div>

        {checking && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}

        {!checking && connected === true && (
          <button
            onClick={() => void handleDisconnect()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 text-xs font-medium transition-colors"
          >
            <Link2Off className="w-3.5 h-3.5" />
            Disconnect
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center p-8">
        {checking ? (
          <div className="flex flex-col items-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Checking connection…</span>
          </div>
        ) : connected ? (
          <div className="w-full max-w-sm space-y-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#0A66C2]/20 border border-[#0A66C2]/30 flex items-center justify-center mx-auto">
              <Users className="w-6 h-6 text-[#0A66C2]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white mb-1">LinkedIn connected</h2>
              <p className="text-sm text-slate-400">Your agents can now search candidates, send InMails, and post jobs via LinkedIn Recruiter.</p>
            </div>
            {showBanner && (
              <AgentSuggestionBanner serviceId="linkedin" onDismiss={() => setShowBanner(false)} />
            )}
            <button
              onClick={() => navigate('/dashboard/apps/workspaces/recruitment')}
              className="w-full px-4 py-2.5 rounded-lg bg-[#0A66C2] hover:bg-[#0958a8] text-white text-sm font-semibold transition-colors"
            >
              Open Recruitment Workspace
            </button>
          </div>
        ) : (
          <div className="w-full max-w-sm space-y-5">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-xl bg-[#0A66C2] flex items-center justify-center mx-auto">
                <span className="text-white text-xl font-bold">in</span>
              </div>
              <h2 className="text-base font-semibold text-white">Connect LinkedIn</h2>
              <p className="text-sm text-slate-400">Authorize Zapheit to search candidates and post jobs on your behalf.</p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Permissions requested</p>
              <div className="flex flex-wrap gap-2">
                {SCOPES.map((scope) => (
                  <span key={scope} className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-slate-300 font-mono">{scope}</span>
                ))}
              </div>
              <div className="flex items-start gap-2 pt-1">
                <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-slate-500">
                  Callback URL:{' '}
                  <span className="font-mono text-slate-400">{CALLBACK_URL}</span>
                </p>
              </div>
            </div>

            <button
              onClick={handleConnect}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0A66C2] hover:bg-[#0958a8] text-white text-sm font-semibold transition-colors"
            >
              <Link2 className="w-4 h-4" />
              Connect LinkedIn with OAuth
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
