import React, { useState } from 'react';
import { Brain, AlertCircle, ArrowRight, Loader2, Eye, EyeOff, Check, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface SignUpPageProps {
  onSignIn: () => void;
  onBack: () => void;
}

const PASSWORD_RULES = [
  { id: 'length',  label: 'At least 8 characters',          test: (p: string) => p.length >= 8 },
  { id: 'lower',   label: 'One lowercase letter (a–z)',      test: (p: string) => /[a-z]/.test(p) },
  { id: 'upper',   label: 'One uppercase letter (A–Z)',      test: (p: string) => /[A-Z]/.test(p) },
  { id: 'number',  label: 'One number (0–9)',                test: (p: string) => /[0-9]/.test(p) },
  { id: 'special', label: 'One special character (!@#$…)',   test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
];

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

export default function SignUpPage({ onSignIn, onBack }: SignUpPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const { signUp, signInWithOAuth } = useApp();

  const passwordChecks = PASSWORD_RULES.map((rule) => ({ ...rule, passed: rule.test(password) }));
  const passwordValid = passwordChecks.every((c) => c.passed);
  const passwordsMatch = password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!orgName || !email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (!passwordValid) {
      setPasswordTouched(true);
      setError('Password does not meet all requirements listed below');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match');
      return;
    }
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy to continue');
      return;
    }

    setLoading(true);
    const result = await signUp(email, password, orgName);
    if (result.error) {
      // Replace Supabase's verbose character-list error with a friendly message
      if (result.error.toLowerCase().includes('password should contain')) {
        setPasswordTouched(true);
        setError('Password does not meet the requirements listed below.');
      } else {
        setError(result.error);
      }
    } else {
      localStorage.clear();
      onSignIn();
    }
    setLoading(false);
  };

  const handleOAuth = async (provider: 'google' | 'microsoft') => {
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy before continuing');
      return;
    }
    setError('');
    setOauthLoading(provider);
    const result = await signInWithOAuth(provider === 'microsoft' ? 'azure' : 'google');
    if (result.error) {
      setError(result.error);
      setOauthLoading(null);
    }
    // On success the browser redirects — loading state intentionally stays set
  };

  return (
    <div className="min-h-screen flex text-slate-50">
      {/* Left branding panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 app-bg items-center justify-center relative overflow-hidden">
        <div className="absolute top-20 left-10 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-24 right-12 w-60 h-60 bg-blue-500/12 rounded-full blur-3xl animate-float delay-200" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="surface-raised rounded-3xl p-6 w-64 opacity-40 absolute top-1/4 left-1/4 -translate-x-1/4 animate-float delay-300" style={{ height: 80 }} />
          <div className="surface-raised rounded-2xl p-4 w-48 opacity-30 absolute bottom-1/3 right-1/4 animate-float delay-100" style={{ height: 60 }} />
        </div>
        <div className="relative z-10 text-center px-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.20)] flex items-center justify-center">
              <Brain className="w-8 h-8 text-cyan-300" />
            </div>
          </div>
          <h1 className="gradient-text text-4xl font-bold mb-3">Zapheit</h1>
          <p className="text-slate-400 text-base leading-relaxed">AI Agent Control Plane<br />Govern every agent, every conversation</p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 app-bg lg:bg-slate-950 overflow-y-auto">
        <div className="w-full max-w-md py-8">
          <button onClick={onBack} className="flex items-center gap-2 text-slate-300 hover:text-white mb-8 transition-colors">
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Home
          </button>

          <div className="card-surface p-8">
            {/* Logo — visible on mobile only */}
            <div className="flex items-center gap-3 mb-8 lg:hidden">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 shadow-[0_0_12px_rgba(34,211,238,0.15)] flex items-center justify-center">
                <Brain className="w-7 h-7 text-cyan-300" />
              </div>
              <div>
                <span className="text-xl font-bold gradient-text">Zapheit</span>
                <span className="text-xs text-blue-300 block -mt-1">AI Agent Governance</span>
              </div>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
            <p className="text-slate-400 mb-6">Start governing your AI workforce today</p>

          {/* OAuth Buttons */}
          <div className="space-y-3 mb-6">
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={!!oauthLoading || loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {oauthLoading === 'google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => handleOAuth('microsoft')}
              disabled={!!oauthLoading || loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {oauthLoading === 'microsoft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MicrosoftIcon />}
              Continue with Microsoft
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">or sign up with email</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Organization Name */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Organization Name</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="input-field"
                placeholder="Acme Inc."
                autoComplete="organization"
              />
            </div>

            {/* Work Email */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Work Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordTouched(true); }}
                  className="input-field pr-10"
                  placeholder="••••••••"
                  autoComplete="new-password"
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

              {/* Live password requirements — visible once the user starts typing */}
              {passwordTouched && (
                <div className="mt-2 p-3 bg-white/5 border border-white/10 rounded-lg space-y-1.5">
                  {passwordChecks.map((check) => (
                    <div key={check.id} className="flex items-center gap-2">
                      {check.passed
                        ? <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                        : <X className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />}
                      <span className={`text-xs ${check.passed ? 'text-green-400' : 'text-slate-400'}`}>
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm text-slate-300 mb-2">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`input-field pr-10 ${confirmPassword && !passwordsMatch ? 'border-red-500/50 focus:border-red-500/70' : ''}`}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && !passwordsMatch && (
                <p className="mt-1 text-xs text-red-400">Passwords do not match</p>
              )}
              {confirmPassword && passwordsMatch && password.length > 0 && (
                <p className="mt-1 text-xs text-green-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Passwords match
                </p>
              )}
            </div>

            {/* Terms of Service */}
            <div className="flex items-start gap-3 pt-1">
              <button
                type="button"
                onClick={() => setAgreedToTerms((v) => !v)}
                className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                  agreedToTerms ? 'bg-blue-500 border-blue-500' : 'bg-transparent border-white/20 hover:border-white/40'
                }`}
              >
                {agreedToTerms && <Check className="w-2.5 h-2.5 text-white" />}
              </button>
              <span
                className="text-xs text-slate-400 leading-relaxed cursor-pointer select-none"
                onClick={() => setAgreedToTerms((v) => !v)}
              >
                I agree to the{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline underline-offset-2"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >Terms of Service</a>
                {' '}and{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:text-blue-200 underline underline-offset-2"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >Privacy Policy</a>
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || !!oauthLoading}
              className="btn-primary w-full disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-slate-400">Already have an account? </span>
            <button onClick={onSignIn} className="text-blue-300 hover:text-blue-200 font-medium">
              Sign in
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
