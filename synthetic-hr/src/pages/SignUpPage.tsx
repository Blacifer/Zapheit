import { useState } from 'react';
import { Brain, Mail, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface SignUpPageProps {
  onSignIn: () => void;
  onBack: () => void;
}

export default function SignUpPage({ onSignIn, onBack }: SignUpPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const { signUp } = useApp();

  const passwordRequirements = [
    { met: password.length >= 8, text: 'At least 8 characters' },
    { met: /[A-Z]/.test(password), text: 'One uppercase letter' },
    { met: /[a-z]/.test(password), text: 'One lowercase letter' },
    { met: /[0-9]/.test(password), text: 'One number' },
    { met: /[!@#$%^&*]/.test(password), text: 'One special character (!@#$%^&*)' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password || !orgName) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    // Validate password before submitting
    if (!passwordRequirements.every(req => req.met)) {
      setError('Please meet all password requirements');
      setLoading(false);
      return;
    }

    const result = await signUp(email, password, orgName);

    if (result.error) {
      setError(result.error);
    } else {
      // Clear localStorage on successful signup (removes old notifications from previous accounts)
      localStorage.clear();
      // Auto-proceed to sign in (email verification is not enforced in development)
      onSignIn();
    }
    setLoading(false);
  };

  // Show verification success screen
  if (emailVerified) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center p-6 text-slate-50">
        <div className="w-full max-w-md">
          <button onClick={onBack} className="flex items-center gap-2 text-slate-300 hover:text-white mb-8 transition-colors">
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Home
          </button>

          <div className="card-surface p-8 text-center">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="w-10 h-10 text-green-400" />
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">Check your email!</h1>
            <p className="text-slate-400 mb-6">
              We've sent a verification link to <span className="text-white font-medium">{verificationEmail}</span>
            </p>

            <div className="p-4 bg-slate-900/50 rounded-lg mb-6">
              <p className="text-slate-400 text-sm">
                Please check your inbox and click the verification link to activate your account.
                If you don't see the email, check your spam folder.
              </p>
            </div>

            <button
              onClick={onSignIn}
              className="btn-primary w-full"
            >
              Go to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-6 text-slate-50">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-300 hover:text-white mb-8 transition-colors">
          <ArrowRight className="w-4 h-4 rotate-180" />
          Back to Home
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

          <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
          <p className="text-slate-400 mb-6">Start governing your AI workforce today</p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Organization Name</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="input-field"
                placeholder="Acme Inc."
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
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
  );
}
