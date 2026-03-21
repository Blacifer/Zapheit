import { useState, useEffect } from 'react';
import { Brain, AlertCircle, ArrowRight, Loader2, CheckCircle, Eye, EyeOff, Check, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { authHelpers } from '../lib/supabase-client';

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 21 21">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022" />
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" />
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

const PASSWORD_HINTS = [
  { id: 'lower',   label: 'Lowercase letter (a–z)',    test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper',   label: 'Uppercase letter (A–Z)',    test: (p: string) => /[A-Z]/.test(p) },
  { id: 'number',  label: 'Number (0–9)',               test: (p: string) => /[0-9]/.test(p) },
  { id: 'special', label: 'Special character (!@#$…)', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
];

const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

interface LoginPageProps {
  onSignUp: () => void;
  onBack: () => void;
}

export default function LoginPage({ onSignUp, onBack }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => localStorage.getItem('synthetic_hr_remember_me') === 'true'
  );
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);
  const { signIn, signInWithOAuth } = useApp();

  const isLockedOut = lockoutSeconds > 0;

  // Countdown timer during lockout
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const passwordHints = PASSWORD_HINTS.map((h) => ({ ...h, matched: h.test(password) }));
  const showHint = passwordFocused && password.length > 0;

  const handleOAuth = async (provider: 'google' | 'microsoft') => {
    setError('');
    setOauthLoading(provider);
    const result = await signInWithOAuth(provider === 'microsoft' ? 'azure' : 'google');
    if (result.error) {
      setError(result.error);
      setOauthLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLockedOut) return;
    setError('');

    if (!email || !password) {
      setError('Please enter your email and password');
      return;
    }

    setLoading(true);
    const result = await signIn(email, password);

    if (result.error) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);

      if (next >= MAX_ATTEMPTS) {
        setLockoutSeconds(LOCKOUT_SECONDS);
        setFailedAttempts(0);
        setError(`Too many failed attempts. Please wait ${LOCKOUT_SECONDS} seconds before trying again.`);
      } else {
        const remaining = MAX_ATTEMPTS - next;
        setError(`${result.error} — ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
      }
    } else {
      // Persist remember-me preference
      if (rememberMe) {
        localStorage.setItem('synthetic_hr_remember_me', 'true');
      } else {
        localStorage.removeItem('synthetic_hr_remember_me');
      }
      setFailedAttempts(0);
    }

    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResetLoading(true);

    if (!resetEmail) {
      setError('Please enter your email address');
      setResetLoading(false);
      return;
    }

    const result = await authHelpers.sendPasswordReset(resetEmail);
    if (result.error) {
      setError(result.error);
    } else {
      setResetSent(true);
    }
    setResetLoading(false);
  };

  // ── Forgot password view ─────────────────────────────────────────────────
  if (showForgotPassword) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center p-6 text-slate-50">
        <div className="w-full max-w-md">
          <button
            onClick={() => setShowForgotPassword(false)}
            className="flex items-center gap-2 text-slate-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Login
          </button>

          <div className="card-surface p-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">RASI</span>
                <span className="text-xs text-blue-300 block -mt-1">Synthetic HR</span>
              </div>
            </div>

            {resetSent ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
                <p className="text-slate-400 mb-6">
                  We've sent a password reset link to <span className="text-white">{resetEmail}</span>
                </p>
                <button onClick={() => setShowForgotPassword(false)} className="text-blue-300 hover:text-blue-200 font-medium">
                  Back to Sign In
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white mb-2">Reset Password</h1>
                <p className="text-slate-400 mb-6">Enter your email and we'll send you a reset link</p>

                {error && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-300 mb-2">Email</label>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="input-field"
                      placeholder="you@company.com"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="btn-primary w-full disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {resetLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                    ) : 'Send Reset Link'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main login view ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-6 text-slate-50">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-300 hover:text-white mb-8 transition-colors">
          <ArrowRight className="w-4 h-4 rotate-180" />
          Back to Home
        </button>

        <div className="card-surface p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold text-white">RASI</span>
              <span className="text-xs text-blue-300 block -mt-1">Synthetic HR</span>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-slate-400 mb-6">Sign in to your account</p>

          {/* OAuth Buttons */}
          <div className="space-y-3 mb-6">
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={!!oauthLoading || loading || isLockedOut}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {oauthLoading === 'google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => handleOAuth('microsoft')}
              disabled={!!oauthLoading || loading || isLockedOut}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {oauthLoading === 'microsoft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MicrosoftIcon />}
              Continue with Microsoft
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">or sign in with email</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Lockout banner */}
          {isLockedOut && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-amber-400">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">
                Too many failed attempts. Try again in <span className="font-bold">{lockoutSeconds}s</span>.
              </span>
            </div>
          )}

          {/* Error */}
          {error && !isLockedOut && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@company.com"
                autoComplete="email"
                disabled={isLockedOut}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  className="input-field pr-10"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={isLockedOut}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password character-type hint — shows while the field is focused */}
              {showHint && (
                <div className="mt-2 p-3 bg-white/5 border border-white/10 rounded-lg">
                  <p className="text-xs text-slate-500 mb-1.5">Password must contain:</p>
                  <div className="grid grid-cols-2 gap-1">
                    {passwordHints.map((h) => (
                      <div key={h.id} className="flex items-center gap-1.5">
                        <Check className={`w-3 h-3 flex-shrink-0 ${h.matched ? 'text-green-400' : 'text-slate-600'}`} />
                        <span className={`text-xs ${h.matched ? 'text-green-400' : 'text-slate-500'}`}>
                          {h.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Remember me + Forgot password row */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setRememberMe((v) => !v)}
                className="flex items-center gap-2 group"
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                  rememberMe ? 'bg-blue-500 border-blue-500' : 'bg-transparent border-white/20 group-hover:border-white/40'
                }`}>
                  {rememberMe && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors select-none">
                  Remember me
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || isLockedOut || !!oauthLoading}
              className="btn-primary w-full disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
              ) : isLockedOut ? (
                <><Clock className="w-4 h-4" /> Locked — wait {lockoutSeconds}s</>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-slate-400">Don't have an account? </span>
            <button onClick={onSignUp} className="text-cyan-400 hover:text-cyan-300 font-medium">
              Sign up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
