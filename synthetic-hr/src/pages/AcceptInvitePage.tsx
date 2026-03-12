import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api-client';
import { authHelpers } from '../lib/supabase-client';

type Props = {
  onLogin: () => void;
  onSignUp: () => void;
  onBack: () => void;
  onDone: () => void;
};

type Step = 'checking' | 'needs-auth' | 'claiming' | 'done' | 'error';

export default function AcceptInvitePage(props: Props) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const inviteToken = params.get('token') || params.get('invite') || '';
  const [step, setStep] = useState<Step>('checking');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const run = async () => {
      if (!inviteToken) {
        setStep('error');
        setMessage('Missing invite token in the URL.');
        return;
      }

      // Public verify step: confirms token exists and is not expired/rejected.
      const verify = await api.team.acceptInvite(inviteToken);
      if (!verify.success) {
        setStep('error');
        setMessage(verify.error || 'Invite could not be verified.');
        return;
      }

      // If user is signed in, immediately claim into org.
      const { session } = await authHelpers.getSession();
      if (!session?.access_token) {
        localStorage.setItem('synthetic_hr_pending_invite_token', inviteToken);
        setStep('needs-auth');
        setMessage('Invite verified. Sign in to join the workspace.');
        return;
      }

      setStep('claiming');
      const claim = await api.team.claimInvite(inviteToken);
      if (!claim.success) {
        // Keep token around so user can retry after fixing provisioning.
        localStorage.setItem('synthetic_hr_pending_invite_token', inviteToken);
        setStep('error');
        setMessage(claim.error || 'Invite verified, but could not be claimed.');
        return;
      }

      localStorage.removeItem('synthetic_hr_pending_invite_token');
      setStep('done');
      setMessage('Invite accepted. You have joined the workspace.');

      // Give the UI a tick to show the success state, then continue.
      setTimeout(() => props.onDone(), 250);
    };

    void run();
  }, [inviteToken]);

  return (
    <div className="min-h-screen app-bg text-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg card-surface p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Accept invite</h1>
            <p className="text-slate-300 mt-2">
              {step === 'checking' && 'Verifying invite token...'}
              {step !== 'checking' && message}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onBack}
            className="rounded-xl border border-white/15 bg-white/[0.02] px-3 py-2 text-slate-100 hover:bg-white/[0.06]"
          >
            Close
          </button>
        </div>

        {(step === 'checking' || step === 'claiming') && (
          <div className="mt-8 flex items-center gap-3 text-slate-200">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
            <span>{step === 'claiming' ? 'Joining workspace...' : 'Checking...'}</span>
          </div>
        )}

        {step === 'needs-auth' && (
          <div className="mt-8 flex flex-col gap-3">
            <button
              type="button"
              onClick={props.onLogin}
              className="btn-primary w-full"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={props.onSignUp}
              className="btn-secondary w-full"
            >
              Create account
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="mt-8 flex flex-col gap-3">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-100">
              {message || 'Something went wrong.'}
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={props.onLogin}
                className="btn-primary w-full"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={props.onBack}
                className="btn-secondary w-full"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
