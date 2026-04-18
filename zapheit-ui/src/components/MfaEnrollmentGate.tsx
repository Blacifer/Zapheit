import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Copy, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase-client';
import { toast } from '../lib/toast';

interface MfaEnrollmentGateProps {
  children: React.ReactNode;
  required?: boolean;
  title?: string;
  message?: string;
}

/**
 * Blocks dashboard access until the user has enrolled and verified a TOTP MFA factor.
 * Renders inline enrollment UI when MFA is not yet set up.
 */
export function MfaEnrollmentGate({
  children,
  required = true,
  title = 'Set Up 2FA',
  message = 'Your organization requires two-factor authentication. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.) to proceed.',
}: MfaEnrollmentGateProps) {
  const [checking, setChecking] = useState(true);
  const [enrolled, setEnrolled] = useState(false);

  // Enrollment state
  const [enrollId, setEnrollId] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Check enrollment on mount
  useEffect(() => {
    if (!required) {
      setEnrolled(true);
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.mfa.listFactors();
        const hasVerified = data?.totp?.some((f) => f.status === 'verified');
        if (!cancelled) setEnrolled(!!hasVerified);
      } catch {
        // If MFA API fails, let user through rather than permanently lock them out
        if (!cancelled) setEnrolled(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [required]);

  // Auto-start enrollment once we know they don't have MFA
  useEffect(() => {
    if (!required) return;
    if (checking || enrolled || enrollId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        if (cancelled) return;
        if (enrollError || !data) {
          setError(enrollError?.message || 'Failed to start MFA setup.');
          return;
        }
        setEnrollId(data.id);
        setQrUri(data.totp.qr_code);
        setSecret(data.totp.secret);
      } catch {
        if (!cancelled) setError('Failed to start MFA setup. Please refresh and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [checking, enrolled, enrollId, required]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollId || code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: enrollId });
      if (!challenge) { setError('Failed to create MFA challenge.'); setLoading(false); return; }
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: enrollId, challengeId: challenge.id, code });
      if (verifyError) { setError('Invalid code. Please check your authenticator app and try again.'); setLoading(false); return; }
      toast.success('Two-factor authentication enabled.');
      setEnrolled(true);
    } catch {
      setError('Verification failed. Please try again.');
    }
    setLoading(false);
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Still checking — show spinner
  if (checking) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  // Enrolled — render dashboard
  if (enrolled) return <>{children}</>;

  // Not enrolled — full-screen enrollment gate
  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-6 text-slate-50">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/60 backdrop-blur-sm p-8 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 shadow-[0_0_12px_rgba(34,211,238,0.15)] flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-cyan-300" />
            </div>
            <div>
              <span className="text-xl font-bold text-white">{title}</span>
              <span className="text-xs text-blue-300 block -mt-0.5">Required to continue</span>
            </div>
          </div>

          <p className="text-slate-400 text-sm mb-6">
            {message}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {loading && !qrUri && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
            </div>
          )}

          {qrUri && (
            <form onSubmit={handleVerify} className="space-y-4">
              {/* QR Code */}
              <div className="flex justify-center">
                <img src={qrUri} alt="2FA QR Code" className="w-44 h-44 rounded-lg bg-white p-2" />
              </div>

              {/* Manual secret */}
              <div className="bg-slate-900/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400 font-mono break-all select-all">{secret}</span>
                <button type="button" onClick={copySecret} className="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex-shrink-0 flex items-center gap-1">
                  {copied ? <><CheckCircle2 className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>

              {/* Code input */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-sm text-slate-200 px-3 py-2.5 font-mono tracking-widest focus:outline-none focus:border-cyan-500/50"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? 'Verifying…' : 'Enable 2FA & Continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
