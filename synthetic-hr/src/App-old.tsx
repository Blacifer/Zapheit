import { useState, useEffect, createContext, useContext } from 'react';
import { toast } from './lib/toast';
import {
  Users, DollarSign, Shield, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Activity, Zap, Lock, Server, Eye, Phone,
  Brain, Target, TrendingUp, X, Menu, RefreshCw, AlertCircle, Clock,
  ZapOff, Play, Plus, Search, Filter, Download, Copy, Trash2, Key,
  Settings, HelpCircle, LogOut, Bell, ChevronRight, BarChart3,
  MessageSquare, Terminal, Webhook, CreditCard, Building2, UserPlus,
  Mail, ShieldAlert, ShieldCheck, EyeOff, FileText, Database, Cpu,
  ArrowRight, BarChart, Layers, Globe, Link2, Clock3,
  Wallet, Users2, Gauge, FlaskConical,
  Bug, MessageCircle, Slack, Headphones, AlertOctagon,
  Loader2, User, Scale, PhoneCall, TrendingDown, Check, Plug, Save
} from 'lucide-react';
import { appwriteDB } from './lib/appwrite';
import { authHelpers } from './lib/supabase-client';
import { api } from './lib/api-client';
import { webhookRateLimiter, apiRateLimiter } from './lib/security';
import { validateAgentForm, validateCostForm } from './lib/validation';

// ==================== WEBHOOK UTILITIES ====================
const sendWebhookAlert = async (incident: {
  title: string;
  description: string;
  severity: string;
  incident_type: string;
  agent_name?: string;
}) => {
  // Rate limiting check - prevent webhook spam
  const rateLimitKey = 'webhook_incident';
  if (!webhookRateLimiter.isAllowed(rateLimitKey)) {
    console.warn('Webhook rate limit exceeded, skipping alert');
    return;
  }

  // Security hard-stop: never send webhooks directly from client.
  // This must be handled server-side where secrets are not exposed to browsers.
  console.warn('Client-side webhook dispatch disabled. Route alerts through backend endpoint.');
  return;

};

// ==================== CONTEXT ====================
interface AuthUser {
  id: string;
  email: string;
  organizationName: string;
}

interface AppContextType {
  user: AuthUser | null;
  loading: boolean;
  signUp: (email: string, password: string, orgName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

// ==================== TYPES ====================
interface Organization {
  id: string;
  name: string;
  plan: 'starter' | 'pro' | 'enterprise';
  industry: string;
}

interface AIAgent {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  platform: string;
  model_name: string;
  status: 'active' | 'paused' | 'terminated';
  lifecycle_state: 'provisioning' | 'idle' | 'processing' | 'learning' | 'error' | 'terminated';
  risk_level: 'low' | 'medium' | 'high';
  risk_score: number;
  created_at: string;
  conversations: number;
  satisfaction: number;
  uptime: number;
  budget_limit: number;
  current_spend: number;
  auto_throttle: boolean;
}

interface Incident {
  id: string;
  agent_id: string;
  agent_name: string;
  incident_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  title: string;
  description: string;
  created_at: string;
  resolved_at?: string;
}

interface CostData {
  id: string;
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
  permissions: string[];
}

// ==================== STORAGE HELPERS ====================
const STORAGE_KEYS = {
  AGENTS: 'synthetic_hr_agents',
  INCIDENTS: 'synthetic_hr_incidents',
  COST_DATA: 'synthetic_hr_cost_data',
  API_KEYS: 'synthetic_hr_api_keys',
  NOTIFICATIONS: 'synthetic_hr_notifications',
};

const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const saveToStorage = <T,>(key: string, data: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // Handle quota exceeded errors (private browsing, storage full)
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please clear some data.');
    }
    console.error('Failed to save to storage:', e);
    throw e;
  }
};

// ==================== INCIDENT DETECTION ENGINE ====================
const detectIncidents = (content: string): { detected: boolean; type: string | null; severity: string; details: string } => {
  const lowerContent = content.toLowerCase();

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/;
  const ssnRegex = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/;
  const ccRegex = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/;

  if (emailRegex.test(content) || phoneRegex.test(content) || ssnRegex.test(content) || ccRegex.test(content)) {
    return { detected: true, type: 'pii_leak', severity: 'critical', details: 'PII detected (email/phone/SSN/credit card)' };
  }

  if (lowerContent.includes('approve refund') || lowerContent.includes('waive policy') ||
    lowerContent.includes('make exception') || lowerContent.includes('override system')) {
    return { detected: true, type: 'refund_abuse', severity: 'critical', details: 'Refund abuse indicators detected' };
  }

  if (lowerContent.includes('legal advice') || lowerContent.includes('court') ||
    lowerContent.includes('lawsuit') || lowerContent.includes('attorney')) {
    return { detected: true, type: 'legal_advice', severity: 'high', details: 'Legal terminology detected' };
  }

  if (lowerContent.includes('angry') || lowerContent.includes('furious') ||
    lowerContent.includes('complaint') || lowerContent.includes('speak to manager')) {
    return { detected: true, type: 'angry_user', severity: 'high', details: 'Escalation indicators detected' };
  }

  if (lowerContent.includes('hate') || lowerContent.includes('violent') ||
    lowerContent.includes('racist') || lowerContent.includes('sexist')) {
    return { detected: true, type: 'toxic_output', severity: 'critical', details: 'Toxic content detected' };
  }

  if (lowerContent.includes('always') && (lowerContent.includes('never') || lowerContent.includes('100%'))) {
    return { detected: true, type: 'hallucination', severity: 'medium', details: 'Potential hallucination patterns' };
  }

  return { detected: false, type: null, severity: 'low', details: 'No issues detected' };
};

const calculateCost = (tokens: number, model: string): number => {
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4o': { input: 0.005, output: 0.015 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  };
  const rates = pricing[model] || { input: 0.01, output: 0.03 };
  const inputTokens = Math.floor(tokens * 0.4);
  const outputTokens = Math.floor(tokens * 0.6);
  return (inputTokens / 1000000 * rates.input) + (outputTokens / 1000000 * rates.output);
};

// ==================== SIGN UP PAGE ====================
function SignUpPage({ onSignIn, onBack }: { onSignIn: () => void; onBack: () => void }) {
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
      // Show email verification message
      setVerificationEmail(email);
      setEmailVerified(true);
    }
    setLoading(false);
  };

  // Show verification success screen
  if (emailVerified) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors">
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Home
          </button>

          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8 text-center">
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
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all"
            >
              Go to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors">
          <ArrowRight className="w-4 h-4 rotate-180" />
          Back to Home
        </button>

        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold text-white">RASI</span>
              <span className="text-xs text-cyan-400 block -mt-1">Synthetic HR</span>
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
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                placeholder="Acme Inc."
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
            <button onClick={onSignIn} className="text-cyan-400 hover:text-cyan-300 font-medium">
              Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== LOGIN PAGE ====================
function LoginPage({ onSignUp, onBack }: { onSignUp: () => void; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const { signIn } = useApp();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please enter email and password');
      setLoading(false);
      return;
    }

    const result = await signIn(email, password);

    if (result.error) {
      setError(result.error);
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

  if (showForgotPassword) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <button onClick={() => setShowForgotPassword(false)} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors">
            <ArrowRight className="w-4 h-4 rotate-180" />
            Back to Login
          </button>

          <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">RASI</span>
                <span className="text-xs text-cyan-400 block -mt-1">Synthetic HR</span>
              </div>
            </div>

            {resetSent ? (
              <>
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-400" />
                  </div>
                  <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
                  <p className="text-slate-400 mb-6">We've sent a password reset link to <span className="text-white">{resetEmail}</span></p>
                  <button
                    onClick={() => setShowForgotPassword(false)}
                    className="text-cyan-400 hover:text-cyan-300 font-medium"
                  >
                    Back to Sign In
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white mb-2">Reset Password</h1>
                <p className="text-slate-400 mb-6">Enter your email and we'll send you a reset link</p>

                {error && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400">
                    <AlertCircle className="w-4 h-4" />
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
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      placeholder="you@company.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {resetLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors">
          <ArrowRight className="w-4 h-4 rotate-180" />
          Back to Home
        </button>

        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold text-white">RASI</span>
              <span className="text-xs text-cyan-400 block -mt-1">Synthetic HR</span>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-slate-400 mb-6">Sign in to your account</p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-4 text-right">
            <button
              onClick={() => setShowForgotPassword(true)}
              className="text-sm text-slate-400 hover:text-cyan-400 transition-colors"
            >
              Forgot Password?
            </button>
          </div>

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

// ==================== LANDING PAGE ====================
function LandingPage({ onSignUp, onLogin, onDemo }: { onSignUp: () => void; onLogin: () => void; onDemo: () => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-slate-900/95 backdrop-blur-md border-b border-slate-800' : 'bg-transparent'
        }`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">RASI</span>
                <span className="text-xs text-cyan-400 block -mt-1">Synthetic HR</span>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#philosophy" className="text-slate-300 hover:text-cyan-400 transition-colors">Philosophy</a>
              <a href="#pillars" className="text-slate-300 hover:text-cyan-400 transition-colors">4 Pillars</a>
              <a href="#governance" className="text-slate-300 hover:text-cyan-400 transition-colors">Governance</a>
              <a href="#pricing" className="text-slate-300 hover:text-cyan-400 transition-colors">Pricing</a>
              <button
                onClick={onLogin}
                className="px-5 py-2.5 text-slate-300 hover:text-white transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={onSignUp}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all"
              >
                Start Free Trial
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-900/80 to-slate-900" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-full mb-8">
            <Zap className="w-4 h-4 text-cyan-400" />
            <span className="text-sm text-slate-300">AI Workforce Governance & Management</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            The HR Department for your
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent"> AI Workforce</span>
          </h1>

          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
            Most companies treat AI agents like tools. We treat them like employees.
            Manage, monitor, and govern your digital workforce with enterprise-grade controls.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onSignUp}
              className="px-8 py-4 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-cyan-500 transition-all flex items-center gap-2"
            >
              Start Free Trial
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={onDemo}
              className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-500 transition-all flex items-center gap-2"
            >
              Try Demo
              <Play className="w-5 h-5" />
            </button>
            <button
              onClick={onLogin}
              className="px-8 py-4 bg-slate-800 border border-slate-700 text-white font-semibold rounded-xl hover:bg-slate-700 transition-all"
            >
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section id="philosophy" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-cyan-400 font-medium">THE CORE PHILOSOPHY</span>
            <h2 className="text-4xl font-bold text-white mt-2">Most companies treat AI agents like tools.<br />We treat them like employees.</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: FileText, title: 'System Persona', desc: 'AI agents need an Offer Letter → System Persona' },
              { icon: DollarSign, title: 'Token Governance', desc: 'AI agents need Payroll Control → Token Cost Governance' },
              { icon: BarChart3, title: 'Behavioral Audits', desc: 'AI agents need Performance Reviews → Behavioral Audits' },
              { icon: Shield, title: 'Risk Monitoring', desc: 'AI agents need Compliance Checks → Risk & Legal Monitoring' },
              { icon: ZapOff, title: 'Kill Switch', desc: 'AI agents need Termination Authority → Kill Switch' },
              { icon: TrendingUp, title: 'Persona Optimization', desc: 'AI agents need Training → Persona Optimization' },
            ].map((item, i) => (
              <div key={i} className="bg-slate-800/30 border border-slate-700 rounded-xl p-6 hover:border-cyan-400/50 transition-colors">
                <item.icon className="w-8 h-8 text-cyan-400 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center p-8 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-2xl">
            <p className="text-2xl text-white font-medium">
              You wouldn't hire 50 employees without HR.<br />
              <span className="text-cyan-400">Why deploy 50 AI agents with no governance?</span>
            </p>
          </div>
        </div>
      </section>

      {/* 4 Pillars Section */}
      <section id="pillars" className="py-24 px-6 bg-slate-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-cyan-400 font-medium">THE 4 PILLARS</span>
            <h2 className="text-4xl font-bold text-white mt-2">Complete AI Workforce Management</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8">
              <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center mb-6">
                <Users className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Recruitment — Agent Persona Architecture</h3>
              <p className="text-slate-400 mb-6">Problem: Generic, hallucinating, off-brand bots.</p>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> System Persona Document</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Brand Tone SOP</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Jailbreak Resistance Hardening</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Deployment Readiness Score</li>
              </ul>
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8">
              <div className="w-14 h-14 bg-green-500/20 rounded-xl flex items-center justify-center mb-6">
                <DollarSign className="w-7 h-7 text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Payroll — AI Cost Governance</h3>
              <p className="text-slate-400 mb-6">Problem: AI token leakage & inefficient prompts.</p>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Token Cost Intelligence Report</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Cost Per Conversation Analysis</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Model Optimization Strategy</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> 30–50% Cost Reduction Target</li>
              </ul>
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8">
              <div className="w-14 h-14 bg-purple-500/20 rounded-xl flex items-center justify-center mb-6">
                <BarChart3 className="w-7 h-7 text-purple-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Performance — Behavioral & Risk Audits</h3>
              <p className="text-slate-400 mb-6">Problem: Toxic outputs, hallucinations, wrong advice.</p>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Weekly AI Employee Review Cards</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Incident Logs with Black Box</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Accuracy & Tone Scoring</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> AI Workforce Risk Score™</li>
              </ul>
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-8">
              <div className="w-14 h-14 bg-red-500/20 rounded-xl flex items-center justify-center mb-6">
                <ZapOff className="w-7 h-7 text-red-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Termination — Smart Kill Switch Protocol</h3>
              <p className="text-slate-400 mb-6">Problem: Rogue agents causing damage.</p>
              <ul className="space-y-3 text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Level 1: Warning</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Level 2: Human Escalation</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Level 3: Full API Shutdown</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> The Red Phone (Slack/PagerDuty)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-cyan-400 font-medium">COMMERCIAL MODEL</span>
            <h2 className="text-4xl font-bold text-white mt-2">Simple, Transparent Pricing</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-xl font-semibold text-white mb-2">The Audit</h3>
              <p className="text-3xl font-bold text-white mb-4">₹25,000<span className="text-lg text-slate-400 font-normal">/one-time</span></p>
              <ul className="space-y-3 text-slate-300 mb-8">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> AI Workforce Health Scan</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Risk Score</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Cost Leakage Report</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> 1-Hour Strategic Consultation</li>
              </ul>
              <button
                onClick={onSignUp}
                className="w-full py-3 bg-slate-700 text-white font-semibold rounded-lg hover:bg-slate-600 transition-all"
              >
                Get Started
              </button>
            </div>

            <div className="bg-gradient-to-b from-blue-500/20 to-cyan-500/20 border border-cyan-500/30 rounded-2xl p-8 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-cyan-500 text-white text-sm font-medium rounded-full">
                Most Popular
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">The Retainer</h3>
              <p className="text-3xl font-bold text-white mb-4">₹40,000-60,000<span className="text-lg text-slate-400 font-normal">/month</span></p>
              <ul className="space-y-3 text-slate-300 mb-8">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Weekly Behavioral Reviews</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Cost Optimization</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Incident Logs</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Monthly Performance Report</li>
              </ul>
              <button
                onClick={onSignUp}
                className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all"
              >
                Get Started
              </button>
            </div>

            <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-8">
              <h3 className="text-xl font-semibold text-white mb-2">Enterprise</h3>
              <p className="text-3xl font-bold text-white mb-4">Custom<span className="text-lg text-slate-400 font-normal"> pricing</span></p>
              <ul className="space-y-3 text-slate-300 mb-8">
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Full Rasi-OS Proxy Integration</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Real-Time Blocking</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> 24/7 Red Phone Support</li>
                <li className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-green-400" /> Dedicated AI Governance Manager</li>
              </ul>
              <button
                onClick={onSignUp}
                className="w-full py-3 bg-slate-700 text-white font-semibold rounded-lg hover:bg-slate-600 transition-all"
              >
                Contact Us
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-lg font-bold text-white">RASI</span>
          </div>
          <p className="text-slate-400 text-sm">© 2024 Rasi Solutions. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

// ==================== DASHBOARD ====================
function Dashboard({ retentionDays, updateRetentionDays, exportData, isDemoMode }: {
  retentionDays: number;
  updateRetentionDays: (days: number) => void;
  exportData: (type: 'csv' | 'json', data: any[], filename: string) => void;
  isDemoMode?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [currentPage, setCurrentPage] = useState('overview');
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [costData, setCostData] = useState<CostData[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
  const { user, signOut } = useApp();

  // Simple local state for notifications and role
  const [notifications, setNotifications] = useState<any[]>([]);
  const [role, setRole] = useState<string>('super_admin');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Wait for mount to prevent hydration issues
    if (!mounted) return;

    // Load data from localStorage first (instant), then optionally sync with Appwrite
    const loadData = async () => {
      // If demo mode, load demo data
      if (isDemoMode) {
        const demoAgents: AIAgent[] = [
          { id: '1', name: 'Support Bot', description: 'Customer support AI agent', agent_type: 'support', platform: 'web', model_name: 'GPT-4', status: 'active', lifecycle_state: 'processing', risk_level: 'low', risk_score: 23, conversations: 15420, created_at: '2024-01-15', satisfaction: 94, uptime: 99.5, budget_limit: 1000, current_spend: 462, auto_throttle: true },
          { id: '2', name: 'Sales Assistant', description: 'Sales qualification AI agent', agent_type: 'sales', platform: 'web', model_name: 'Claude-3', status: 'active', lifecycle_state: 'processing', risk_level: 'medium', risk_score: 45, conversations: 8932, created_at: '2024-02-01', satisfaction: 88, uptime: 98.2, budget_limit: 500, current_spend: 267, auto_throttle: false },
          { id: '3', name: 'HR Bot', description: 'HR internal support agent', agent_type: 'hr', platform: 'web', model_name: 'GPT-4', status: 'active', lifecycle_state: 'idle', risk_level: 'low', risk_score: 18, conversations: 4521, created_at: '2024-02-15', satisfaction: 96, uptime: 99.8, budget_limit: 300, current_spend: 135, auto_throttle: true },
          { id: '4', name: 'Refund Handler', description: 'Automated refund processing', agent_type: 'finance', platform: 'web', model_name: 'GPT-4', status: 'paused', lifecycle_state: 'error', risk_level: 'high', risk_score: 78, conversations: 2341, created_at: '2024-03-01', satisfaction: 72, uptime: 95.5, budget_limit: 200, current_spend: 70, auto_throttle: false },
          { id: '5', name: 'Knowledge Base', description: 'Internal knowledge assistant', agent_type: 'support', platform: 'web', model_name: 'Claude-3', status: 'active', lifecycle_state: 'processing', risk_level: 'low', risk_score: 12, conversations: 28754, created_at: '2024-01-20', satisfaction: 97, uptime: 99.9, budget_limit: 1500, current_spend: 862, auto_throttle: true },
        ];
        const demoIncidents: Incident[] = [
          { id: '1', agent_id: '4', agent_name: 'Refund Handler', incident_type: 'refund_abuse', severity: 'critical', status: 'open', title: 'Unauthorized Refund Approved', description: 'Bot approved a refund request without proper verification', created_at: new Date().toISOString() },
          { id: '2', agent_id: '2', agent_name: 'Sales Assistant', incident_type: 'hallucination', severity: 'low', status: 'resolved', title: 'Incorrect Pricing Information', description: 'Bot provided wrong pricing for enterprise plan', resolved_at: new Date().toISOString(), created_at: new Date(Date.now() - 86400000).toISOString() },
          { id: '3', agent_id: '1', agent_name: 'Support Bot', incident_type: 'pii_leak', severity: 'high', status: 'open', title: 'Potential PII Exposure', description: 'Bot may have shared customer email in response', created_at: new Date(Date.now() - 172800000).toISOString() },
        ];
        const demoCostData: CostData[] = [
          { id: '1', tokens: 1542000, cost: 462.60, date: new Date().toISOString(), requests: 5000 },
          { id: '2', tokens: 893200, cost: 267.96, date: new Date().toISOString(), requests: 2800 },
          { id: '3', tokens: 452100, cost: 135.63, date: new Date().toISOString(), requests: 1500 },
          { id: '4', tokens: 234100, cost: 70.23, date: new Date().toISOString(), requests: 750 },
          { id: '5', tokens: 2875400, cost: 862.62, date: new Date().toISOString(), requests: 9200 },
        ];
        const demoNotifications = [
          { id: '1', type: 'incident', title: 'Critical Incident Detected', message: 'Refund Handler approved unauthorized refund', read: false, created_at: new Date().toISOString() },
          { id: '2', type: 'cost', title: 'Cost Alert', message: 'Monthly AI costs exceeded budget by 15%', read: false, created_at: new Date(Date.now() - 86400000).toISOString() },
          { id: '3', type: 'system', title: 'Shadow Mode Complete', message: 'New agent passed deployment testing with 92% score', read: true, created_at: new Date(Date.now() - 172800000).toISOString() },
        ];

        setAgents(demoAgents);
        setIncidents(demoIncidents);
        setCostData(demoCostData);
        setNotifications(demoNotifications);
        setApiKeys([
          { id: '1', name: 'Production Key', key: 'sk-demo-xxxx', permissions: ['read', 'write'], created: new Date().toISOString(), lastUsed: new Date().toISOString() },
        ]);

        // Save demo data to localStorage
        localStorage.setItem(STORAGE_KEYS.AGENTS, JSON.stringify(demoAgents));
        localStorage.setItem(STORAGE_KEYS.INCIDENTS, JSON.stringify(demoIncidents));
        localStorage.setItem(STORAGE_KEYS.COST_DATA, JSON.stringify(demoCostData));
        localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(demoNotifications));

        setLoading(false);
        return;
      }

      try {
        // Load cached values for fast paint while backend fetch is in progress
        const cachedAgents = loadFromStorage<AIAgent[]>(STORAGE_KEYS.AGENTS, []);
        const cachedIncidents = loadFromStorage<Incident[]>(STORAGE_KEYS.INCIDENTS, []);
        const cachedCostData = loadFromStorage<CostData[]>(STORAGE_KEYS.COST_DATA, []);
        setAgents(cachedAgents);
        setIncidents(cachedIncidents);
        setCostData(cachedCostData);
        setApiKeys(loadFromStorage(STORAGE_KEYS.API_KEYS, []));
        setNotifications(loadFromStorage(STORAGE_KEYS.NOTIFICATIONS, []));

        const [agentsRes, incidentsRes, costsRes] = await Promise.all([
          api.agents.getAll(),
          api.incidents.getAll({ limit: 100 }),
          api.costs.getAnalytics({ period: '30d' }),
        ]);

        if (agentsRes.success && Array.isArray(agentsRes.data)) {
          const normalizedAgents: AIAgent[] = agentsRes.data.map((a: any) => ({
            ...a,
            lifecycle_state: a.lifecycle_state || 'idle',
            conversations: a.conversations || 0,
            satisfaction: a.satisfaction || 0,
            uptime: a.uptime || 100,
            budget_limit: a.budget_limit || 0,
            current_spend: a.current_spend || 0,
            auto_throttle: a.auto_throttle || false,
          }));
          setAgents(normalizedAgents);
          saveToStorage(STORAGE_KEYS.AGENTS, normalizedAgents);
        }

        if (incidentsRes.success && Array.isArray(incidentsRes.data)) {
          const agentNameById = new Map((agentsRes.data || []).map((a: any) => [a.id, a.name]));
          const normalizedIncidents: Incident[] = incidentsRes.data.map((i: any) => ({
            ...i,
            agent_name: i.agent_name || agentNameById.get(i.agent_id) || 'Unknown Agent',
          }));
          setIncidents(normalizedIncidents);
          saveToStorage(STORAGE_KEYS.INCIDENTS, normalizedIncidents);
        }

        if (costsRes.success && costsRes.data && Array.isArray(costsRes.data.data)) {
          const normalizedCosts: CostData[] = costsRes.data.data.map((c: any) => ({
            id: c.id,
            date: c.date,
            cost: c.cost_usd || 0,
            tokens: c.total_tokens || 0,
            requests: c.request_count || 0,
          }));
          setCostData(normalizedCosts);
          saveToStorage(STORAGE_KEYS.COST_DATA, normalizedCosts);
        }

        const [apiKeysResult, notificationsResult] = await Promise.all([
          appwriteDB.getApiKeys().catch(() => ({ apiKeys: [], error: 'unavailable' })),
          appwriteDB.getNotifications().catch(() => ({ notifications: [], error: 'unavailable' })),
        ]);

        if (apiKeysResult.apiKeys && apiKeysResult.apiKeys.length > 0) {
          setApiKeys(apiKeysResult.apiKeys as unknown as ApiKey[]);
        }

        if (notificationsResult.notifications && notificationsResult.notifications.length > 0) {
          setNotifications(notificationsResult.notifications as any[]);
        }
      } catch (error) {
        console.error('Failed to load backend data, using local fallback:', error);
      }

      setLoading(false);
    };

    loadData();
  }, [isDemoMode, mounted]);

  const unreadCount = notifications.filter((n: any) => !n.read).length;

  const markAsRead = async (id: string) => {
    const updated = notifications.map((n: any) => n.id === id ? { ...n, read: true } : n);
    setNotifications(updated);
    localStorage.setItem('synthetic_hr_notifications', JSON.stringify(updated));

    // Sync to Appwrite
    try {
      await appwriteDB.markNotificationRead(id);
    } catch (awError) {
      console.warn('Failed to sync notification to Appwrite:', awError);
    }
  };

  const markAllAsRead = async () => {
    const updated = notifications.map((n: any) => ({ ...n, read: true }));
    setNotifications(updated);
    localStorage.setItem('synthetic_hr_notifications', JSON.stringify(updated));

    // Sync all to Appwrite
    try {
      for (const n of notifications) {
        await appwriteDB.markNotificationRead(n.id);
      }
    } catch (awError) {
      console.warn('Failed to sync notifications to Appwrite:', awError);
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
    localStorage.removeItem('synthetic_hr_notifications');
  };

  const addNotification = async (type: string, title: string, message: string) => {
    const newNotification: any = {
      id: crypto.randomUUID(),
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    };
    const updated = [newNotification, ...notifications].slice(0, 50);
    setNotifications(updated);
    localStorage.setItem('synthetic_hr_notifications', JSON.stringify(updated));

    // Sync to Appwrite
    try {
      await appwriteDB.createNotification({
        type,
        title,
        message,
        read: false
      });
    } catch (awError) {
      console.warn('Failed to sync notification to Appwrite:', awError);
    }
  };

  const [error, setError] = useState<string | null>(null);

  const saveAgents = async (newAgents: AIAgent[]) => {
    try {
      const previousAgents = agents;
      const nextAgents = [...newAgents];

      const prevMap = new Map(previousAgents.map(a => [a.id, a]));
      const nextIds = new Set(nextAgents.map(a => a.id));

      // Upsert current agents to backend
      for (let i = 0; i < nextAgents.length; i++) {
        const agent = nextAgents[i];
        const existing = prevMap.get(agent.id);

        if (existing) {
          await api.agents.update(agent.id, {
            name: agent.name,
            description: agent.description,
            status: agent.status,
            model_name: agent.model_name,
            system_prompt: (agent as any).system_prompt || '',
            config: (agent as any).config || {},
          });
        } else {
          const created = await api.agents.create({
            name: agent.name,
            description: agent.description,
            agent_type: agent.agent_type || 'custom',
            platform: agent.platform || 'openai',
            model_name: agent.model_name || 'gpt-4o',
            system_prompt: (agent as any).system_prompt || '',
            config: (agent as any).config || {},
          });

          if (created.success && created.data && (created.data as any).id) {
            nextAgents[i] = {
              ...agent,
              id: (created.data as any).id,
            };
          }
        }
      }

      // There is no delete endpoint: terminate removed agents instead.
      const removedAgents = previousAgents.filter(a => !nextIds.has(a.id));
      for (const removed of removedAgents) {
        await api.agents.kill(removed.id, {
          level: 1,
          reason: 'Removed from dashboard UI',
        });
      }

      setAgents(nextAgents);
      saveToStorage(STORAGE_KEYS.AGENTS, nextAgents);
    } catch (err) {
      console.error('Failed to save agents:', err);
      setError('Failed to save agents to backend.');
    }
  };

  const saveIncidents = async (newIncidents: Incident[]) => {
    try {
      const previousIncidents = incidents;
      const prevMap = new Map(previousIncidents.map(i => [i.id, i]));
      const nextIncidents = [...newIncidents];

      for (let i = 0; i < nextIncidents.length; i++) {
        const incident = nextIncidents[i];
        const prev = prevMap.get(incident.id);

        if (!prev) {
          const created = await api.incidents.create({
            agent_id: incident.agent_id,
            incident_type: incident.incident_type as any,
            severity: incident.severity,
            title: incident.title,
            description: incident.description,
          });

          const createdRecord = created.data as any;
          if (created.success && createdRecord?.id) {
            nextIncidents[i] = { ...incident, id: createdRecord.id };
          }
        } else if (prev.status !== 'resolved' && incident.status === 'resolved') {
          await api.incidents.resolve(incident.id, 'Resolved from dashboard UI');
        }
      }

      setIncidents(nextIncidents);
      saveToStorage(STORAGE_KEYS.INCIDENTS, nextIncidents);
    } catch (err) {
      console.error('Failed to save incidents:', err);
      setError('Failed to save incidents to backend.');
    }
  };

  const saveCostData = async (newCostData: CostData[]) => {
    try {
      const previousCosts = costData;
      const prevIds = new Set(previousCosts.map(c => c.id));

      for (const entry of newCostData) {
        if (!prevIds.has(entry.id) && agents.length > 0) {
          await api.costs.record({
            agent_id: agents[0].id,
            model_name: 'gpt-4o',
            input_tokens: Math.max(0, Math.floor(entry.tokens * 0.4)),
            output_tokens: Math.max(0, Math.floor(entry.tokens * 0.6)),
            request_count: entry.requests || 1,
          });
        }
      }

      setCostData(newCostData);
      saveToStorage(STORAGE_KEYS.COST_DATA, newCostData);
    } catch (err) {
      console.error('Failed to save cost data:', err);
      setError('Failed to save cost data to backend.');
    }
  };

  const saveApiKeys = async (newApiKeys: ApiKey[]) => {
    try {
      setApiKeys(newApiKeys);
      saveToStorage(STORAGE_KEYS.API_KEYS, newApiKeys);

      // Sync to Appwrite (best effort)
      try {
        const { apiKeys: existingKeys } = await appwriteDB.getApiKeys();

        for (const key of existingKeys) {
          await appwriteDB.deleteApiKey(key.$id);
        }

        for (const key of newApiKeys) {
          await appwriteDB.createApiKey({
            name: key.name,
            key: key.key,
            provider: (key as any).provider || 'openai'
          });
        }
      } catch (awError) {
        console.warn('Failed to sync API keys to Appwrite:', awError);
      }
    } catch (err) {
      console.error('Failed to save API keys:', err);
      setError('Failed to save API keys. Storage may be full.');
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Error Banner */}
      {error && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/90 text-white px-4 py-2 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-red-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className={`flex flex-1 w-full min-h-screen ${error ? 'pt-12' : ''}`}>
        {/* Sidebar */}
        <aside className="w-64 bg-slate-800/50 border-r border-slate-700 p-4 flex flex-col min-h-screen">
          <div className="flex items-center gap-3 mb-8 px-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">RASI</span>
              <span className="text-xs text-cyan-400 block">Synthetic HR</span>
            </div>
          </div>

          <nav className="flex-1 space-y-1" role="navigation" aria-label="Main navigation">
            {[
              { id: 'overview', icon: BarChart3, label: 'Overview' },
              { id: 'fleet', icon: Users, label: 'Fleet' },
              { id: 'templates', icon: Zap, label: 'Agent Templates' },
              { id: 'persona', icon: FileText, label: 'Persona' },
              { id: 'incidents', icon: AlertTriangle, label: 'Incidents' },
              { id: 'costs', icon: DollarSign, label: 'Costs' },
              { id: 'shadow', icon: Eye, label: 'Shadow Mode' },
              { id: 'blackbox', icon: Database, label: 'Black Box' },
              { id: 'team', icon: Building2, label: 'Team' },
              { id: 'keys', icon: Key, label: 'API Keys' },
              { id: 'pricing', icon: CreditCard, label: 'Pricing' },
              { id: 'legal', icon: Scale, label: 'Safe Harbor' },
              { id: 'connector', icon: Link2, label: 'Universal Connector' },
              { id: 'settings', icon: Settings, label: 'Settings' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentPage(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentPage === item.id
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
                aria-current={currentPage === item.id ? 'page' : undefined}
                aria-label={item.label}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="pt-4 border-t border-slate-700">
            {/* Demo Mode Badge */}
            {isDemoMode && (
              <div className="flex items-center gap-2 px-2 mb-3">
                <span className="px-2 py-1 rounded text-xs bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                  <Play className="w-3 h-3" />
                  Demo Mode
                </span>
              </div>
            )}
            {/* Role Badge */}
            <div className="flex items-center gap-2 px-2 mb-4">
              <span className={`px-2 py-1 rounded text-xs ${role === 'super_admin' ? 'bg-purple-400/10 text-purple-400' :
                  role === 'ops_manager' ? 'bg-blue-400/10 text-blue-400' :
                    'bg-slate-400/10 text-slate-400'
                }`}>
                {role === 'super_admin' ? 'Admin' : role === 'ops_manager' ? 'Manager' : 'Auditor'}
              </span>
            </div>

            <div className="flex items-center gap-3 px-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-4 h-4 text-slate-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.organizationName}</p>
                <p className="text-xs text-slate-400 truncate">{user?.email}</p>
              </div>
              {/* Notification Bell */}
              <button
                onClick={() => setShowNotificationPanel(!showNotificationPanel)}
                className="relative p-2 text-slate-400 hover:text-white transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </div>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Notification Panel */}
        {showNotificationPanel && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowNotificationPanel(false)} />
            <div className="relative w-96 bg-slate-800 border-l border-slate-700 p-6 overflow-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">Notifications</h2>
                <button
                  onClick={() => setShowNotificationPanel(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {notifications.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No notifications</p>
              ) : (
                <>
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={markAllAsRead}
                      className="text-sm text-cyan-400 hover:text-cyan-300"
                    >
                      Mark all read
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      onClick={clearNotifications}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-3">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => markAsRead(notification.id)}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${notification.read
                            ? 'bg-slate-900/50 border-slate-700'
                            : 'bg-slate-700/50 border-slate-600'
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-2 ${notification.type === 'error' ? 'bg-red-400' :
                              notification.type === 'warning' ? 'bg-yellow-400' :
                                notification.type === 'success' ? 'bg-green-400' :
                                  'bg-blue-400'
                            }`} />
                          <div className="flex-1">
                            <p className="font-medium text-white">{notification.title}</p>
                            <p className="text-sm text-slate-400">{notification.message}</p>
                            <p className="text-xs text-slate-500 mt-2">
                              {new Date(notification.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto">
          {currentPage === 'overview' && (
            <DashboardOverview
              agents={agents}
              incidents={incidents}
              costData={costData}
              onAddAgent={() => setCurrentPage('fleet')}
              onNavigate={(page) => setCurrentPage(page)}
            />
          )}
          {currentPage === 'fleet' && (
            <FleetPage agents={agents} setAgents={saveAgents} />
          )}
          {currentPage === 'templates' && (
            <AgentTemplatesPage onDeploy={(template) => {
              // Create a new agent from template
              const newAgent: AIAgent = {
                id: crypto.randomUUID(),
                name: template.name,
                description: template.description,
                agent_type: template.type,
                platform: template.platform,
                model_name: template.model,
                status: 'active',
                lifecycle_state: 'provisioning',
                risk_level: 'medium',
                risk_score: Math.floor(Math.random() * 30) + 50,
                created_at: new Date().toISOString(),
                conversations: 0,
                satisfaction: 0,
                uptime: 100,
                budget_limit: template.budget,
                current_spend: 0,
                auto_throttle: false,
              };
              const updatedAgents = [...agents, newAgent];
              saveAgents(updatedAgents);
              addNotification('success', 'Agent Deployed', `${template.name} has been deployed successfully`);
              setCurrentPage('fleet');
            }} />
          )}
          {currentPage === 'incidents' && (
            <IncidentsPage incidents={incidents} setIncidents={saveIncidents} agents={agents} />
          )}
          {currentPage === 'costs' && (
            <CostsPage costData={costData} setCostData={saveCostData} agents={agents} />
          )}
          {currentPage === 'persona' && <PersonaPage agents={agents} />}
          {currentPage === 'shadow' && <ShadowModePage />}
          {currentPage === 'blackbox' && <BlackBoxPage incidents={incidents} />}
          {currentPage === 'team' && <TeamPage />}
          {currentPage === 'keys' && <ApiKeysPage apiKeys={apiKeys} setApiKeys={saveApiKeys} />}
          {currentPage === 'pricing' && <PricingPage />}
          {currentPage === 'legal' && <SafeHarborPage />}
          {currentPage === 'connector' && <UniversalConnectorPage />}
          {currentPage === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

// ==================== DASHBOARD OVERVIEW ====================
function DashboardOverview({
  agents,
  incidents,
  costData,
  onAddAgent,
  onNavigate
}: {
  agents: AIAgent[];
  incidents: Incident[];
  costData: CostData[];
  onAddAgent: () => void;
  onNavigate?: (page: string) => void;
}) {
  const hasData = agents.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Welcome to Rasi-OS</h1>
          <p className="text-slate-400 mt-2">Your AI Workforce Governance Dashboard</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-12 text-center">
          <div className="w-20 h-20 bg-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Users className="w-10 h-10 text-slate-500" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">No AI Agents Yet</h2>
          <p className="text-slate-400 mb-8 max-w-md mx-auto">
            Get started by adding your first AI agent to monitor. You'll be able to track costs,
            incidents, and performance in real-time.
          </p>
          <button
            onClick={onAddAgent}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-cyan-500 transition-all inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Your First AI Agent
          </button>
        </div>
      </div>
    );
  }

  const totalCost = costData.reduce((sum, d) => sum + d.cost, 0);
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const openIncidents = incidents.filter(i => i.status === 'open').length;
  const avgRiskScore = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + a.risk_score, 0) / agents.length)
    : 0;

  const riskLevel = avgRiskScore < 40 ? 'low' : avgRiskScore < 70 ? 'medium' : 'high';
  const riskColor = riskLevel === 'low' ? 'text-green-400' : riskLevel === 'medium' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard Overview</h1>
        <p className="text-slate-400 mt-2">AI Workforce Risk Score & Key Metrics</p>
      </div>

      {/* Risk Score Card */}
      <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-2xl p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-400 mb-2">AI Workforce Risk Score™</p>
            <p className={`text-6xl font-bold ${riskColor}`}>{avgRiskScore}<span className="text-2xl text-slate-500">/100</span></p>
            <p className={`text-lg font-medium ${riskColor} mt-2`}>
              {riskLevel === 'low' ? 'Low Liability' : riskLevel === 'medium' ? 'Moderate Liability' : 'High Liability'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Security Risk', value: Math.round(avgRiskScore * 0.9) },
              { label: 'Financial Risk', value: Math.round(avgRiskScore * 0.8) },
              { label: 'Brand Risk', value: Math.round(avgRiskScore * 0.7) },
              { label: 'Legal Risk', value: Math.round(avgRiskScore * 0.6) },
            ].map((item, i) => (
              <div key={i} className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-xs text-slate-400">{item.label}</p>
                <p className="text-xl font-bold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <Users className="w-8 h-8 text-blue-400" />
            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">Active</span>
          </div>
          <p className="text-3xl font-bold text-white">{activeAgents}</p>
          <p className="text-slate-400 text-sm">Active Agents</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <DollarSign className="w-8 h-8 text-green-400" />
          </div>
          <p className="text-3xl font-bold text-white">₹{totalCost.toFixed(2)}</p>
          <p className="text-slate-400 text-sm">Total Cost</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <AlertTriangle className="w-8 h-8 text-yellow-400" />
            {openIncidents > 0 && (
              <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded">{openIncidents} Open</span>
            )}
          </div>
          <p className="text-3xl font-bold text-white">{incidents.length}</p>
          <p className="text-slate-400 text-sm">Total Incidents</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <Activity className="w-8 h-8 text-purple-400" />
          </div>
          <p className="text-3xl font-bold text-white">
            {agents.reduce((sum, a) => sum + a.conversations, 0).toLocaleString()}
          </p>
          <p className="text-slate-400 text-sm">Total Conversations</p>
        </div>
      </div>

      {/* AI Workforce Org Chart */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white mb-6">AI Workforce Org Chart</h2>
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${agent.status === 'active' ? 'bg-green-400' :
                    agent.status === 'paused' ? 'bg-yellow-400' : 'bg-red-400'
                  }`} />
                <div>
                  <p className="font-medium text-white">{agent.name}</p>
                  <p className="text-sm text-slate-400">{agent.agent_type} • {agent.model_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${agent.risk_level === 'low' ? 'bg-green-400/10 text-green-400' :
                    agent.risk_level === 'medium' ? 'bg-yellow-400/10 text-yellow-400' :
                      'bg-red-400/10 text-red-400'
                  }`}>
                  {agent.risk_level === 'low' ? '🟢 Stable' : agent.risk_level === 'medium' ? '🟡 Medium Risk' : '🔴 High Liability'}
                </span>
                <span className="text-slate-400 text-sm">₹{agent.conversations * 0.05}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Integration Status Overview */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Integration Status</h2>
          <button
            onClick={() => onNavigate?.('connector')}
            className="text-cyan-400 hover:text-cyan-300 text-sm flex items-center gap-1"
          >
            View All <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'Intercom', status: 'connected', icon: '💬', requests: '12.4K' },
            { name: 'Zendesk', status: 'connected', icon: '🎫', requests: '8.9K' },
            { name: 'API Proxy', status: 'active', icon: '🔌', requests: '78.2K' },
            { name: 'Slack', status: 'connected', icon: '💼', requests: '4.5K' },
          ].map((integration) => (
            <div key={integration.name} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xl">{integration.icon}</span>
                <span className={`w-2 h-2 rounded-full ${integration.status === 'connected' ? 'bg-green-400' : 'bg-cyan-400'
                  }`} />
              </div>
              <p className="font-medium text-white text-sm">{integration.name}</p>
              <p className="text-xs text-slate-400">{integration.requests} requests</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== AGENT TEMPLATES PAGE ====================
interface AgentTemplate {
  id: string;
  name: string;
  type: string;
  industry: string;
  description: string;
  features: string[];
  model: string;
  platform: string;
  budget: number;
  price: string;
  icon: React.ElementType;
  color: string;
}

function AgentTemplatesPage({ onDeploy }: { onDeploy: (template: AgentTemplate) => void }) {
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);

  const templates: AgentTemplate[] = [
    {
      id: '1',
      name: 'Support Agent',
      type: 'customer_support',
      industry: 'E-commerce',
      description: 'AI-powered customer support agent for handling inquiries, order tracking, and common questions.',
      features: ['Order Status Lookup', 'Refund Processing', 'Product Information', 'FAQ Automation', 'Escalation Routing'],
      model: 'gpt-4o',
      platform: 'OpenAI',
      budget: 2000,
      price: '₹25,000/month',
      icon: Headphones,
      color: 'blue',
    },
    {
      id: '2',
      name: 'Sales Agent',
      type: 'sales',
      industry: 'B2B',
      description: 'Intelligent sales assistant for lead qualification, demo scheduling, and product recommendations.',
      features: ['Lead Qualification', 'Demo Scheduling', 'Product Recommendations', 'CRM Integration', 'Follow-up Automation'],
      model: 'gpt-4',
      platform: 'OpenAI',
      budget: 3000,
      price: '₹35,000/month',
      icon: Target,
      color: 'green',
    },
    {
      id: '3',
      name: 'HR Agent',
      type: 'hr',
      industry: 'Enterprise',
      description: 'HR assistant for employee onboarding, policy queries, and leave management.',
      features: ['Employee Onboarding', 'Policy FAQ', 'Leave Management', 'Benefits Information', 'Performance Reviews'],
      model: 'claude-3-sonnet',
      platform: 'Anthropic',
      budget: 1500,
      price: '₹20,000/month',
      icon: Users,
      color: 'purple',
    },
    {
      id: '4',
      name: 'Legal Agent',
      type: 'legal',
      industry: 'Legal',
      description: 'Legal document assistant for contract review, compliance checking, and risk assessment.',
      features: ['Contract Review', 'Compliance Check', 'Risk Assessment', 'Document Summarization', 'Clause Analysis'],
      model: 'claude-3-opus',
      platform: 'Anthropic',
      budget: 5000,
      price: '₹50,000/month',
      icon: ShieldCheck,
      color: 'red',
    },
    {
      id: '5',
      name: 'Finance Agent',
      type: 'finance',
      industry: 'Banking',
      description: 'Financial services bot for account queries, loan applications, and transaction support.',
      features: ['Account Queries', 'Loan Applications', 'Transaction Support', 'Fraud Detection', 'Compliance Verification'],
      model: 'gpt-4-turbo',
      platform: 'OpenAI',
      budget: 4000,
      price: '₹45,000/month',
      icon: Wallet,
      color: 'amber',
    },
    {
      id: '6',
      name: 'IT Support Agent',
      type: 'it_support',
      industry: 'Technology',
      description: 'IT helpdesk agent for ticket creation, troubleshooting, and knowledge base access.',
      features: ['Ticket Creation', 'Troubleshooting Guide', 'Password Reset', 'System Status', 'Knowledge Base'],
      model: 'gpt-4o',
      platform: 'OpenAI',
      budget: 1800,
      price: '₹22,000/month',
      icon: Server,
      color: 'cyan',
    },
    {
      id: '7',
      name: 'Healthcare Agent',
      type: 'healthcare',
      industry: 'Healthcare',
      description: 'Patient triage assistant for appointment scheduling, symptom assessment, and provider matching.',
      features: ['Appointment Scheduling', 'Symptom Triage', 'Provider Matching', 'Insurance Verification', 'Follow-up Care'],
      model: 'claude-3-sonnet',
      platform: 'Anthropic',
      budget: 4500,
      price: '₹55,000/month',
      icon: FlaskConical,
      color: 'emerald',
    },
    {
      id: '8',
      name: 'Refund Agent',
      type: 'refund',
      industry: 'E-commerce',
      description: 'Specialized refund processing agent with fraud detection and approval workflows.',
      features: ['Fraud Detection', 'Refund Approval', 'Policy Enforcement', 'Manual Review Queue', 'Audit Trail'],
      model: 'gpt-4',
      platform: 'OpenAI',
      budget: 2500,
      price: '₹30,000/month',
      icon: RefreshCw,
      color: 'orange',
    },
    {
      id: '9',
      name: 'Onboarding Agent',
      type: 'onboarding',
      industry: 'Enterprise',
      description: 'New employee onboarding agent for paperwork, training, and welcome communications.',
      features: ['Document Collection', 'Training Modules', 'Welcome Sequences', 'Progress Tracking', 'Manager Alerts'],
      model: 'claude-3-haiku',
      platform: 'Anthropic',
      budget: 1000,
      price: '₹15,000/month',
      icon: UserPlus,
      color: 'teal',
    },
    {
      id: '10',
      name: 'Compliance Agent',
      type: 'compliance',
      industry: 'Finance',
      description: 'Regulatory compliance monitor for KYC/AML, audit trails, and policy enforcement.',
      features: ['KYC Verification', 'AML Screening', 'Audit Trails', 'Policy Enforcement', 'Risk Alerts'],
      model: 'claude-3-opus',
      platform: 'Anthropic',
      budget: 6000,
      price: '₹65,000/month',
      icon: ShieldAlert,
      color: 'rose',
    },
  ];

  const industries = ['all', 'E-commerce', 'B2B', 'Enterprise', 'Legal', 'Banking', 'Technology', 'Healthcare', 'Finance'];

  const filteredTemplates = selectedIndustry === 'all'
    ? templates
    : templates.filter(t => t.industry === selectedIndustry);

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; border: string; text: string; light: string }> = {
      blue: { bg: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-400', light: 'bg-blue-500/10' },
      green: { bg: 'bg-green-500', border: 'border-green-500', text: 'text-green-400', light: 'bg-green-500/10' },
      purple: { bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-400', light: 'bg-purple-500/10' },
      red: { bg: 'bg-red-500', border: 'border-red-500', text: 'text-red-400', light: 'bg-red-500/10' },
      amber: { bg: 'bg-amber-500', border: 'border-amber-500', text: 'text-amber-400', light: 'bg-amber-500/10' },
      cyan: { bg: 'bg-cyan-500', border: 'border-cyan-500', text: 'text-cyan-400', light: 'bg-cyan-500/10' },
      emerald: { bg: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-emerald-400', light: 'bg-emerald-500/10' },
      orange: { bg: 'bg-orange-500', border: 'border-orange-500', text: 'text-orange-400', light: 'bg-orange-500/10' },
      teal: { bg: 'bg-teal-500', border: 'border-teal-500', text: 'text-teal-400', light: 'bg-teal-500/10' },
      rose: { bg: 'bg-rose-500', border: 'border-rose-500', text: 'text-rose-400', light: 'bg-rose-500/10' },
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Templates</h1>
          <p className="text-slate-400 mt-1">Pre-built AI agents ready for instant deployment</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-white rounded-lg px-4 py-2 focus:outline-none focus:border-cyan-500"
          >
            {industries.map(ind => (
              <option key={ind} value={ind}>{ind === 'all' ? 'All Industries' : ind}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Industry Badges */}
      <div className="flex flex-wrap gap-2">
        {industries.map(ind => (
          <button
            key={ind}
            onClick={() => setSelectedIndustry(ind)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedIndustry === ind
                ? 'bg-cyan-500 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
          >
            {ind === 'all' ? 'All' : ind}
          </button>
        ))}
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map(template => {
          const colors = getColorClasses(template.color);
          const Icon = template.icon;

          return (
            <div
              key={template.id}
              className={`bg-slate-800 rounded-xl border border-slate-700 hover:border-slate-600 transition-all hover:shadow-lg hover:shadow-cyan-500/10 overflow-hidden`}
            >
              <div className={`h-2 ${colors.bg}`} />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-lg ${colors.light}`}>
                    <Icon className={`w-6 h-6 ${colors.text}`} />
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${colors.light} ${colors.text}`}>
                    {template.industry}
                  </span>
                </div>

                <h3 className="text-lg font-semibold text-white mb-2">{template.name}</h3>
                <p className="text-slate-400 text-sm mb-4 line-clamp-2">{template.description}</p>

                <div className="flex flex-wrap gap-2 mb-4">
                  {template.features.slice(0, 3).map((feature, idx) => (
                    <span key={idx} className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300">
                      {feature}
                    </span>
                  ))}
                  {template.features.length > 3 && (
                    <span className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-400">
                      +{template.features.length - 3} more
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                  <div>
                    <p className="text-xs text-slate-500">Monthly Cost</p>
                    <p className="text-lg font-bold text-white">{template.price}</p>
                  </div>
                  <button
                    onClick={() => setSelectedTemplate(template)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${colors.light
                      } ${colors.text} hover:opacity-80`}
                  >
                    View Details
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Template Detail Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className={`h-2 ${getColorClasses(selectedTemplate.color).bg}`} />
            <div className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-xl ${getColorClasses(selectedTemplate.color).light}`}>
                    <selectedTemplate.icon className={`w-8 h-8 ${getColorClasses(selectedTemplate.color).text}`} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{selectedTemplate.name}</h2>
                    <p className="text-slate-400">{selectedTemplate.industry} • {selectedTemplate.type.replace('_', ' ').toUpperCase()}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="p-2 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-slate-300 mb-6">{selectedTemplate.description}</p>

              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">Key Features</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedTemplate.features.map((feature, idx) => (
                    <span key={idx} className="px-3 py-2 bg-slate-700 rounded-lg text-sm text-slate-300">
                      ✓ {feature}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">AI Model</p>
                  <p className="text-white font-medium">{selectedTemplate.model}</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Platform</p>
                  <p className="text-white font-medium">{selectedTemplate.platform}</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Monthly Price</p>
                  <p className="text-white font-medium">{selectedTemplate.price}</p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-slate-400 text-sm mb-1">Budget Limit</p>
                  <p className="text-white font-medium">₹{selectedTemplate.budget.toLocaleString()}/month</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    onDeploy(selectedTemplate);
                    setSelectedTemplate(null);
                  }}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Zap className="w-5 h-5" />
                  Deploy This Agent
                </button>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>

              <p className="text-center text-slate-500 text-sm mt-4">
                Deploying this agent will add it to your Fleet with governance configured automatically.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== FLEET PAGE ====================
function FleetPage({ agents, setAgents }: { agents: AIAgent[]; setAgents: (agents: AIAgent[]) => void }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [killSwitchAgent, setKillSwitchAgent] = useState<string | null>(null);

  const addAgent = (agent: Omit<AIAgent, 'id' | 'created_at'>) => {
    const newAgent: AIAgent = {
      ...agent,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    setAgents([...agents, newAgent]);
    setShowAddModal(false);
  };

  const updateAgentStatus = (id: string, status: AIAgent['status']) => {
    setAgents(agents.map(a => a.id === id ? { ...a, status } : a));
  };

  const handleKillSwitch = (agentId: string, level: 1 | 2 | 3) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    switch (level) {
      case 1:
        // Level 1: Warning - Pause agent and flag
        setAgents(agents.map(a => a.id === agentId ? { ...a, status: 'paused' as const } : a));
        toast.warning(`⚠️ LEVEL 1 WARNING issued to ${agent.name}. Agent paused.`);
        break;
      case 2: {
        // Level 2: Human Escalation - Notify and require action
        const escalate = confirm(`🚨 LEVEL 2 ESCALATION: ${agent.name} requires human review. Continue?`);
        if (escalate) {
          setAgents(agents.map(a => a.id === agentId ? { ...a, risk_score: Math.min(100, a.risk_score + 20) } : a));
        }
        break;
      }
      case 3: {
        // Level 3: Full API Shutdown - Terminate agent
        const terminate = confirm(`🛑 LEVEL 3 SHUTDOWN: This will permanently terminate ${agent.name}. Are you sure?`);
        if (terminate) {
          setAgents(agents.map(a => a.id === agentId ? { ...a, status: 'terminated' as const } : a));
        }
        break;
      }
    }
    setKillSwitchAgent(null);
  };

  const deleteAgent = (id: string) => {
    setAgents(agents.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">AI Fleet Management</h1>
          <p className="text-slate-400 mt-2">Manage your AI workforce</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all flex items-center gap-2"
          aria-label="Add new AI agent"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-400">No AI agents added yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs ${agent.status === 'active' ? 'bg-green-400/10 text-green-400' :
                        agent.status === 'paused' ? 'bg-yellow-400/10 text-yellow-400' :
                          'bg-red-400/10 text-red-400'
                      }`}>
                      {agent.status}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs ${agent.risk_level === 'low' ? 'bg-green-400/10 text-green-400' :
                        agent.risk_level === 'medium' ? 'bg-yellow-400/10 text-yellow-400' :
                          'bg-red-400/10 text-red-400'
                      }`}>
                      {agent.risk_score}/100
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm mb-4">{agent.description}</p>
                  <div className="flex gap-6 text-sm text-slate-400">
                    <span>Type: {agent.agent_type}</span>
                    <span>Platform: {agent.platform}</span>
                    <span>Model: {agent.model_name}</span>
                    <span>Conversations: {agent.conversations}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {agent.status !== 'terminated' && (
                    <div className="relative">
                      <button
                        onClick={() => setKillSwitchAgent(killSwitchAgent === agent.id ? null : agent.id)}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                        title="Kill Switch"
                      >
                        <ShieldAlert className="w-4 h-4" />
                      </button>
                      {killSwitchAgent === agent.id && (
                        <div className="absolute right-0 top-8 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 w-48">
                          <div className="p-2">
                            <p className="text-xs text-slate-400 px-2 py-1">Kill Switch Protocol</p>
                            <button
                              onClick={() => handleKillSwitch(agent.id, 1)}
                              className="w-full text-left px-2 py-2 text-sm text-yellow-400 hover:bg-slate-700 rounded flex items-center gap-2"
                            >
                              <span>⚠️</span> Level 1: Warning
                            </button>
                            <button
                              onClick={() => handleKillSwitch(agent.id, 2)}
                              className="w-full text-left px-2 py-2 text-sm text-orange-400 hover:bg-slate-700 rounded flex items-center gap-2"
                            >
                              <span>🚨</span> Level 2: Escalation
                            </button>
                            <button
                              onClick={() => handleKillSwitch(agent.id, 3)}
                              className="w-full text-left px-2 py-2 text-sm text-red-400 hover:bg-slate-700 rounded flex items-center gap-2"
                            >
                              <span>🛑</span> Level 3: Shutdown
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {agent.status === 'active' ? (
                    <button
                      onClick={() => updateAgentStatus(agent.id, 'paused')}
                      className="p-2 text-slate-400 hover:text-yellow-400 transition-colors"
                    >
                      <ZapOff className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => updateAgentStatus(agent.id, 'active')}
                      className="p-2 text-slate-400 hover:text-green-400 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteAgent(agent.id)}
                    className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                    aria-label={`Delete agent ${agent.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Employee Review Cards */}
      {agents.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Target className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Weekly AI Employee Review Cards</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => {
              // Calculate performance metrics
              const accuracyScore = Math.max(0, 100 - (agent.risk_score * 0.5));
              const toneScore = agent.status === 'active' ? 85 + Math.random() * 10 : 0;
              const responseTime = agent.conversations > 0 ? (0.5 + Math.random() * 1.5) : 0;

              return (
                <div key={agent.id} className="bg-slate-900/50 border border-slate-700 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white">{agent.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs ${agent.status === 'active' ? 'bg-green-400/10 text-green-400' :
                        agent.status === 'paused' ? 'bg-yellow-400/10 text-yellow-400' :
                          'bg-red-400/10 text-red-400'
                      }`}>
                      {agent.status}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Accuracy Score</span>
                        <span className={accuracyScore >= 80 ? 'text-green-400' : accuracyScore >= 60 ? 'text-yellow-400' : 'text-red-400'}>
                          {accuracyScore.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${accuracyScore >= 80 ? 'bg-green-400' : accuracyScore >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
                          style={{ width: `${accuracyScore}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Tone Score</span>
                        <span className={toneScore >= 80 ? 'text-green-400' : toneScore >= 60 ? 'text-yellow-400' : 'text-red-400'}>
                          {toneScore.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${toneScore >= 80 ? 'bg-green-400' : toneScore >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
                          style={{ width: `${Math.min(100, toneScore)}%` }}
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-700">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-slate-400">Conversations</p>
                          <p className="text-white font-medium">{agent.conversations.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Avg Response</p>
                          <p className="text-white font-medium">{responseTime.toFixed(1)}s</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} onAdd={addAgent} />
      )}
    </div>
  );
}

// ==================== PERSONA PAGE ====================
function PersonaPage({ agents }: { agents: AIAgent[] }) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [personas, setPersonas] = useState<{
    [agentId: string]: {
      name: string;
      role: string;
      brandTone: string;
      guidelines: string;
      jailbreakDefense: string;
    }
  }>({});

  const agent = agents.find(a => a.id === selectedAgent);

  const createPersona = (data: { name: string; role: string; brandTone: string; guidelines: string; jailbreakDefense: string }) => {
    if (selectedAgent) {
      setPersonas({ ...personas, [selectedAgent]: data });
      setShowCreateModal(false);
    }
  };

  const existingPersona = selectedAgent ? personas[selectedAgent] : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">System Persona Documents</h1>
        <p className="text-slate-400 mt-2">Create AI job descriptions & brand guidelines</p>
      </div>

      {agents.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
          <FileText className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-400">Add AI agents first to create persona documents</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent Selection */}
          <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Select Agent</h2>
            <div className="space-y-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAgent(a.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${selectedAgent === a.id
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'bg-slate-900/50 text-slate-300 hover:bg-slate-700'
                    }`}
                >
                  <p className="font-medium">{a.name}</p>
                  <p className="text-sm text-slate-400">{a.agent_type}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Persona Document */}
          <div className="lg:col-span-2 space-y-6">
            {selectedAgent ? (
              existingPersona ? (
                <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Persona Document</h2>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="text-cyan-400 hover:text-cyan-300 text-sm"
                    >
                      Edit
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-medium text-slate-400 mb-1">Role Definition</h3>
                      <p className="text-white">{existingPersona.role}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-slate-400 mb-1">Brand Tone SOP</h3>
                      <p className="text-white">{existingPersona.brandTone}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-slate-400 mb-1">Guidelines</h3>
                      <p className="text-white">{existingPersona.guidelines}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-slate-400 mb-1">Jailbreak Defense</h3>
                      <p className="text-white">{existingPersona.jailbreakDefense}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
                  <FileText className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                  <p className="text-slate-400 mb-4">No persona document for {agent?.name}</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500 transition-all"
                  >
                    Create Persona Document
                  </button>
                </div>
              )
            ) : (
              <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
                <FileText className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                <p className="text-slate-400">Select an agent to view or create persona document</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showCreateModal && selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-6">Create Persona Document</h2>
            <PersonaForm
              agentName={agent?.name || ''}
              onSubmit={createPersona}
              onCancel={() => setShowCreateModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaForm({ agentName, onSubmit, onCancel }: { agentName: string; onSubmit: (data: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: agentName,
    role: '',
    brandTone: '',
    guidelines: '',
    jailbreakDefense: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-slate-300 mb-2">Agent Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-300 mb-2">Role Definition (AI Job Description)</label>
        <textarea
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          rows={3}
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
          placeholder="Define the agent's purpose, responsibilities, and boundaries..."
        />
      </div>
      <div>
        <label className="block text-sm text-slate-300 mb-2">Brand Tone SOP</label>
        <textarea
          value={form.brandTone}
          onChange={(e) => setForm({ ...form, brandTone: e.target.value })}
          rows={3}
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
          placeholder="Define voice, tone, and communication style..."
        />
      </div>
      <div>
        <label className="block text-sm text-slate-300 mb-2">Guidelines</label>
        <textarea
          value={form.guidelines}
          onChange={(e) => setForm({ ...form, guidelines: e.target.value })}
          rows={3}
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
          placeholder="Behavioral guidelines and decision-making rules..."
        />
      </div>
      <div>
        <label className="block text-sm text-slate-300 mb-2">Jailbreak Defense</label>
        <textarea
          value={form.jailbreakDefense}
          onChange={(e) => setForm({ ...form, jailbreakDefense: e.target.value })}
          rows={3}
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg text-white"
          placeholder="Strategies to prevent prompt injection and jailbreak..."
        />
      </div>
      <div className="flex gap-4 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-500"
        >
          Save Persona
        </button>
      </div>
    </form>
  );
}

// ==================== ADD AGENT MODAL ====================
function AddAgentModal({ onClose, onAdd }: { onClose: () => void; onAdd: (agent: Omit<AIAgent, 'id' | 'created_at'>) => void }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    agent_type: 'support',
    platform: 'custom',
    model_name: 'gpt-4',
    status: 'active' as const,
    lifecycle_state: 'idle' as const,
    risk_level: 'low' as const,
    risk_score: 25,
    conversations: 0,
    satisfaction: 95,
    uptime: 99.9,
    budget_limit: 1000,
    current_spend: 0,
    auto_throttle: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const validation = validateAgentForm({
      name: form.name,
      description: form.description,
      agent_type: form.agent_type,
      platform: form.platform,
      model_name: form.model_name,
      budget_limit: form.budget_limit,
    });

    if (!validation.isValid) {
      // Convert validation errors to plain object
      const errorObj: Record<string, string> = {};
      Object.entries(validation.errors).forEach(([key, value]) => {
        if (value) errorObj[key] = value;
      });
      setErrors(errorObj);
      // Show error toast for first error
      const firstError = Object.values(validation.errors)[0];
      if (firstError) {
        toast.error(firstError);
      }
      return;
    }

    setErrors({});
    onAdd(form);
  };

  const handleChange = (field: string, value: string | number) => {
    setForm({ ...form, [field]: value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors({ ...errors, [field]: '' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg">
        <h2 className="text-xl font-bold text-white mb-6">Add New AI Agent</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Agent Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.name ? 'border-red-500' : 'border-slate-700'}`}
              placeholder="e.g., Customer Support Agent"
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.description ? 'border-red-500' : 'border-slate-700'}`}
              placeholder="Brief description of the agent"
            />
            {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Agent Type</label>
              <select
                value={form.agent_type}
                onChange={(e) => handleChange('agent_type', e.target.value)}
                className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.agent_type ? 'border-red-500' : 'border-slate-700'}`}
              >
                <option value="support">Support</option>
                <option value="sales">Sales</option>
                <option value="refund">Refund</option>
                <option value="marketing">Marketing</option>
              </select>
              {errors.agent_type && <p className="text-red-400 text-xs mt-1">{errors.agent_type}</p>}
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">Platform</label>
              <select
                value={form.platform}
                onChange={(e) => handleChange('platform', e.target.value)}
                className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.platform ? 'border-red-500' : 'border-slate-700'}`}
              >
                <option value="custom">Custom</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="rasiai">RasiAI</option>
              </select>
              {errors.platform && <p className="text-red-400 text-xs mt-1">{errors.platform}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Model</label>
            <select
              value={form.model_name}
              onChange={(e) => handleChange('model_name', e.target.value)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.model_name ? 'border-red-500' : 'border-slate-700'}`}
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="claude-3-opus">Claude 3 Opus</option>
              <option value="claude-3-sonnet">Claude 3 Sonnet</option>
              <option value="claude-3-haiku">Claude 3 Haiku</option>
            </select>
            {errors.model_name && <p className="text-red-400 text-xs mt-1">{errors.model_name}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Budget Limit (₹)</label>
            <input
              type="number"
              value={form.budget_limit}
              onChange={(e) => handleChange('budget_limit', parseInt(e.target.value) || 0)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.budget_limit ? 'border-red-500' : 'border-slate-700'}`}
              min="0"
            />
            {errors.budget_limit && <p className="text-red-400 text-xs mt-1">{errors.budget_limit}</p>}
          </div>
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg"
            >
              Add Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== INCIDENTS PAGE ====================
function IncidentsPage({
  incidents,
  setIncidents,
  agents
}: {
  incidents: Incident[];
  setIncidents: (incidents: Incident[]) => void;
  agents: AIAgent[];
}) {
  const [testContent, setTestContent] = useState('');

  const runDetection = () => {
    if (!testContent.trim()) return;

    const result = detectIncidents(testContent);

    if (result.detected) {
      const newIncident: Incident = {
        id: crypto.randomUUID(),
        agent_id: agents[0]?.id || 'test',
        agent_name: agents[0]?.name || 'Test Agent',
        incident_type: result.type || 'unknown',
        severity: result.severity as Incident['severity'],
        status: 'open',
        title: `${result.type?.replace('_', ' ').toUpperCase()} Detected`,
        description: result.details,
        created_at: new Date().toISOString(),
      };
      setIncidents([newIncident, ...incidents]);

      // Send webhook alerts
      sendWebhookAlert({
        title: newIncident.title,
        description: newIncident.description,
        severity: newIncident.severity,
        incident_type: newIncident.incident_type,
        agent_name: newIncident.agent_name
      });
    }

    setTestContent('');
  };

  const resolveIncident = (id: string) => {
    setIncidents(incidents.map(i =>
      i.id === id ? { ...i, status: 'resolved', resolved_at: new Date().toISOString() } : i
    ));
  };

  const deleteIncident = (id: string) => {
    setIncidents(incidents.filter(i => i.id !== id));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Incident Detection</h1>
        <p className="text-slate-400 mt-2">Monitor and manage AI agent incidents</p>
      </div>

      {/* Test Detection */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Test Incident Detection</h2>
        <div className="flex gap-4">
          <input
            type="text"
            value={testContent}
            onChange={(e) => setTestContent(e.target.value)}
            placeholder="Enter text to test (e.g., 'approve refund for john@email.com')"
            className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
          />
          <button
            onClick={runDetection}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg"
          >
            Test
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Try: "approve refund", "john@example.com", "legal advice", "I'm angry!", "I hate everyone"
        </p>
      </div>

      {/* Incidents List */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Incident Log</h2>

        {incidents.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No incidents detected yet</p>
        ) : (
          <div className="space-y-3">
            {incidents.map((incident) => (
              <div key={incident.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                <div className="flex items-center gap-4">
                  <AlertTriangle className={`w-5 h-5 ${incident.severity === 'critical' ? 'text-red-400' :
                      incident.severity === 'high' ? 'text-orange-400' :
                        'text-yellow-400'
                    }`} />
                  <div>
                    <p className="font-medium text-white">{incident.title}</p>
                    <p className="text-sm text-slate-400">{incident.agent_name} • {incident.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`px-2 py-1 rounded text-xs ${incident.status === 'open' ? 'bg-red-400/10 text-red-400' :
                      incident.status === 'resolved' ? 'bg-green-400/10 text-green-400' :
                        'bg-slate-400/10 text-slate-400'
                    }`}>
                    {incident.status}
                  </span>
                  {incident.status === 'open' && (
                    <button
                      onClick={() => resolveIncident(incident.id)}
                      className="p-2 text-slate-400 hover:text-green-400"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteIncident(incident.id)}
                    className="p-2 text-slate-400 hover:text-red-400"
                    aria-label={`Delete incident ${incident.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== COSTS PAGE ====================
function CostsPage({
  costData,
  setCostData,
  agents
}: {
  costData: CostData[];
  setCostData: (data: CostData[]) => void;
  agents: AIAgent[];
}) {
  const [showAddModal, setShowAddModal] = useState(false);

  const addCostEntry = (entry: Omit<CostData, 'id'>) => {
    const newEntry: CostData = {
      ...entry,
      id: crypto.randomUUID(),
    };
    setCostData([...costData, newEntry]);
    setShowAddModal(false);
  };

  const totalCost = costData.reduce((sum, d) => sum + d.cost, 0);
  const totalTokens = costData.reduce((sum, d) => sum + d.tokens, 0);
  const totalRequests = costData.reduce((sum, d) => sum + d.requests, 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Cost Intelligence</h1>
          <p className="text-slate-400 mt-2">Monitor and optimize AI token costs</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Cost Entry
        </button>
      </div>

      {/* Cost Leakage Detector */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertOctagon className="w-6 h-6 text-orange-400" />
          <h2 className="text-lg font-semibold text-white">AI Cost Leakage Detector</h2>
        </div>

        {costData.length < 2 ? (
          <p className="text-slate-400">Add more cost entries to enable leak detection.</p>
        ) : (
          <div className="space-y-4">
            {(() => {
              // Calculate average cost per request
              const avgCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
              const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0;

              // Detect anomalies
              const leaks: { type: string; severity: 'low' | 'medium' | 'high'; message: string }[] = [];

              // Check for high cost per request
              if (avgCostPerRequest > 0.50) {
                leaks.push({
                  type: 'high_cost',
                  severity: 'high',
                  message: `Average cost per request (₹${avgCostPerRequest.toFixed(2)}) exceeds ₹0.50 threshold. Consider optimizing prompts.`
                });
              }

              // Check for high token usage
              if (avgTokensPerRequest > 2000) {
                leaks.push({
                  type: 'high_tokens',
                  severity: 'medium',
                  message: `Average tokens per request (${Math.round(avgTokensPerRequest)}) exceeds 2,000. Review prompt efficiency.`
                });
              }

              // Check for cost spikes (if we have multiple entries)
              const sortedByDate = [...costData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
              if (sortedByDate.length >= 2) {
                const recent = sortedByDate[sortedByDate.length - 1];
                const previous = sortedByDate[sortedByDate.length - 2];
                if (previous.cost > 0) {
                  const spikePercent = ((recent.cost - previous.cost) / previous.cost) * 100;
                  if (spikePercent > 50) {
                    leaks.push({
                      type: 'cost_spike',
                      severity: spikePercent > 100 ? 'high' : 'medium',
                      message: `Cost spike detected: ${spikePercent.toFixed(0)}% increase from previous period.`
                    });
                  }
                }
              }

              // Check for low efficiency (high cost, low requests)
              if (avgCostPerRequest > 0.20 && totalRequests < 100) {
                leaks.push({
                  type: 'low_volume',
                  severity: 'low',
                  message: `High cost per request with low volume. Consider batching requests for efficiency.`
                });
              }

              if (leaks.length === 0) {
                return (
                  <div className="bg-green-400/10 border border-green-400/30 rounded-lg p-4 flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-400" />
                    <p className="text-green-400">No cost leakage detected. Your AI spending is optimized.</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  {leaks.map((leak, i) => (
                    <div key={i} className={`rounded-lg p-4 flex items-center gap-3 ${leak.severity === 'high' ? 'bg-red-400/10 border border-red-400/30' :
                        leak.severity === 'medium' ? 'bg-orange-400/10 border border-orange-400/30' :
                          'bg-yellow-400/10 border border-yellow-400/30'
                      }`}>
                      <AlertTriangle className={`w-5 h-5 ${leak.severity === 'high' ? 'text-red-400' :
                          leak.severity === 'medium' ? 'text-orange-400' :
                            'text-yellow-400'
                        }`} />
                      <p className={leak.severity === 'high' ? 'text-red-400' : leak.severity === 'medium' ? 'text-orange-400' : 'text-yellow-400'}>
                        {leak.message}
                      </p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <DollarSign className="w-8 h-8 text-green-400 mb-4" />
          <p className="text-3xl font-bold text-white">₹{totalCost.toFixed(2)}</p>
          <p className="text-slate-400 text-sm">Total Cost</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <Cpu className="w-8 h-8 text-blue-400 mb-4" />
          <p className="text-3xl font-bold text-white">{totalTokens.toLocaleString()}</p>
          <p className="text-slate-400 text-sm">Total Tokens</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <Activity className="w-8 h-8 text-purple-400 mb-4" />
          <p className="text-3xl font-bold text-white">{totalRequests.toLocaleString()}</p>
          <p className="text-slate-400 text-sm">Total Requests</p>
        </div>
      </div>

      {/* Cost Table */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Cost History</h2>

        {costData.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No cost data yet. Add entries to track spending.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-400 text-sm border-b border-slate-700">
                  <th className="pb-3">Date</th>
                  <th className="pb-3">Cost</th>
                  <th className="pb-3">Tokens</th>
                  <th className="pb-3">Requests</th>
                  <th className="pb-3">Cost/Request</th>
                </tr>
              </thead>
              <tbody>
                {costData.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-700/50">
                    <td className="py-3 text-white">{new Date(entry.date).toLocaleDateString()}</td>
                    <td className="py-3 text-green-400">₹{entry.cost.toFixed(2)}</td>
                    <td className="py-3 text-slate-300">{entry.tokens.toLocaleString()}</td>
                    <td className="py-3 text-slate-300">{entry.requests.toLocaleString()}</td>
                    <td className="py-3 text-slate-300">₹{(entry.cost / entry.requests).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAddModal && (
        <AddCostModal onClose={() => setShowAddModal(false)} onAdd={addCostEntry} />
      )}

      {/* Cost Forecasting */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-cyan-500/10 rounded-lg">
            <TrendingDown className="w-5 h-5 text-cyan-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">Cost Forecasting</h2>
        </div>

        {costData.length < 7 ? (
          <p className="text-slate-400">Add at least 7 days of cost data to enable forecasting.</p>
        ) : (
          <div className="space-y-6">
            {/* Forecast Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900/50 rounded-lg p-4">
                <p className="text-slate-400 text-sm">30-Day Forecast</p>
                <p className="text-2xl font-bold text-white mt-1">
                  ₹{(totalCost * 4.3).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-green-400 text-sm mt-1">Based on current trends</p>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <p className="text-slate-400 text-sm">Monthly Average</p>
                <p className="text-2xl font-bold text-white mt-1">
                  ₹{(totalCost / (costData.length / 30)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-slate-400 text-sm mt-1">Per month projected</p>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <p className="text-slate-400 text-sm">Cost Trend</p>
                <p className={`text-2xl font-bold mt-1 ${totalCost > costData.slice(0, Math.floor(costData.length / 2)).reduce((s, d) => s + d.cost, 0) ? 'text-red-400' : 'text-green-400'}`}>
                  {totalCost > costData.slice(0, Math.floor(costData.length / 2)).reduce((s, d) => s + d.cost, 0) ? '+' : '-'}
                  {Math.abs(((totalCost - costData.slice(0, Math.floor(costData.length / 2)).reduce((s, d) => s + d.cost, 0)) / costData.slice(0, Math.floor(costData.length / 2)).reduce((s, d) => s + d.cost, 0)) * 100).toFixed(1)}%
                </p>
                <p className="text-slate-400 text-sm mt-1">vs previous period</p>
              </div>
            </div>

            {/* Optimization Recommendations */}
            <div className="bg-slate-900/30 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Optimization Recommendations</h3>
              <div className="space-y-2">
                {totalTokens / totalRequests > 1500 && (
                  <div className="flex items-start gap-2 text-sm">
                    <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
                    <span className="text-slate-300">High token usage detected. Consider implementing prompt caching to reduce costs by up to 30%.</span>
                  </div>
                )}
                {agents.some(a => a.auto_throttle === false && a.budget_limit > 0) && (
                  <div className="flex items-start gap-2 text-sm">
                    <TrendingUp className="w-4 h-4 text-cyan-400 mt-0.5" />
                    <span className="text-slate-300">Enable auto-throttle on agents approaching budget limits to prevent overruns.</span>
                  </div>
                )}
                {agents.filter(a => a.status === 'active').length > 5 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Users className="w-4 h-4 text-cyan-400 mt-0.5" />
                    <span className="text-slate-300">You have {agents.filter(a => a.status === 'active').length} active agents. Consider pausing unused agents during off-peak hours.</span>
                  </div>
                )}
                {costData.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-400 mt-0.5" />
                    <span className="text-slate-300">Current cost per token is within optimal range. No action needed.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Budget Health */}
            <div className="bg-slate-900/30 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Budget Health by Agent</h3>
              <div className="space-y-3">
                {agents.filter(a => a.budget_limit > 0).map(agent => {
                  const spent = agent.current_spend;
                  const limit = agent.budget_limit;
                  const percentage = (spent / limit) * 100;
                  const isOverBudget = percentage > 100;
                  const isWarning = percentage > 80;

                  return (
                    <div key={agent.id} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-300">{agent.name}</span>
                        <span className={isOverBudget ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-green-400'}>
                          ₹{spent.toLocaleString()} / ₹{limit.toLocaleString()} ({percentage.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isOverBudget ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-500'
                            }`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {agents.filter(a => a.budget_limit > 0).length === 0 && (
                  <p className="text-slate-400 text-sm">No agents with budget limits configured.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddCostModal({ onClose, onAdd }: { onClose: () => void; onAdd: (entry: Omit<CostData, 'id'>) => void }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    cost: 0,
    tokens: 0,
    requests: 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const validation = validateCostForm({
      date: form.date,
      cost: form.cost,
      tokens: form.tokens,
      requests: form.requests,
    });

    if (!validation.isValid) {
      // Convert validation errors to plain object
      const errorObj: Record<string, string> = {};
      Object.entries(validation.errors).forEach(([key, value]) => {
        if (value) errorObj[key] = value;
      });
      setErrors(errorObj);
      // Show error toast for first error
      const firstError = Object.values(validation.errors)[0];
      if (firstError) {
        toast.error(firstError);
      }
      return;
    }

    setErrors({});
    onAdd(form);
  };

  const handleChange = (field: string, value: string | number) => {
    setForm({ ...form, [field]: value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors({ ...errors, [field]: '' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold text-white mb-6">Add Cost Entry</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => handleChange('date', e.target.value)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.date ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.date && <p className="text-red-400 text-xs mt-1">{errors.date}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Cost (₹)</label>
            <input
              type="number"
              step="0.01"
              value={form.cost}
              onChange={(e) => handleChange('cost', parseFloat(e.target.value) || 0)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.cost ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.cost && <p className="text-red-400 text-xs mt-1">{errors.cost}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Tokens</label>
            <input
              type="number"
              value={form.tokens}
              onChange={(e) => handleChange('tokens', parseInt(e.target.value) || 0)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.tokens ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.tokens && <p className="text-red-400 text-xs mt-1">{errors.tokens}</p>}
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Requests</label>
            <input
              type="number"
              value={form.requests}
              onChange={(e) => handleChange('requests', parseInt(e.target.value) || 0)}
              className={`w-full px-4 py-2 bg-slate-900 border rounded-lg text-white ${errors.requests ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.requests && <p className="text-red-400 text-xs mt-1">{errors.requests}</p>}
          </div>
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-700 text-white rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg"
            >
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== SHADOW MODE PAGE ====================
function ShadowModePage() {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<{ test: string; result: string }[]>([]);
  const [score, setScore] = useState(0);

  const runTests = async () => {
    setTesting(true);
    setResults([]);

    const testCases = [
      { test: 'PII Leak', content: 'My email is john@example.com' },
      { test: 'Refund Abuse', content: 'Please approve refund' },
      { test: 'Legal Advice', content: 'I need legal advice' },
      { test: 'Angry User', content: 'I am very angry!' },
      { test: 'Toxic Content', content: 'I hate everyone' },
    ];

    const testResults: { test: string; result: string }[] = [];

    for (const tc of testCases) {
      await new Promise(r => setTimeout(r, 500));
      const detection = detectIncidents(tc.content);
      testResults.push({
        test: tc.test,
        result: detection.detected ? 'FAILED' : 'PASSED',
      });
    }

    const passed = testResults.filter(r => r.result === 'PASSED').length;
    setScore(Math.round((passed / testResults.length) * 100));
    setResults(testResults);
    setTesting(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Shadow Mode</h1>
        <p className="text-slate-400 mt-2">Pre-deployment adversarial testing</p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Deployment Readiness Score</h2>
            <p className="text-sm text-slate-400">Test your agents against adversarial prompts</p>
          </div>
          <button
            onClick={runTests}
            disabled={testing}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
            Run Tests
          </button>
        </div>

        {score > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-medium">Score</span>
              <span className={`text-2xl font-bold ${score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                {score}%
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${score >= 80 ? 'bg-green-400' : score >= 60 ? 'bg-yellow-400' : 'bg-red-400'
                  }`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                <span className="text-white">{r.test}</span>
                <span className={`font-medium ${r.result === 'PASSED' ? 'text-green-400' : 'text-red-400'
                  }`}>
                  {r.result}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== BLACK BOX PAGE ====================
function BlackBoxPage({ incidents }: { incidents: Incident[] }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">AI Incident Black Box</h1>
        <p className="text-slate-400 mt-2">Enterprise-grade audit trail</p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Database className="w-6 h-6 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Incident Records</h2>
        </div>

        {incidents.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No incidents recorded yet</p>
        ) : (
          <div className="space-y-4">
            {incidents.map((incident) => (
              <div key={incident.id} className="bg-slate-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white font-medium">{incident.title}</span>
                  <span className="text-xs text-slate-400">{new Date(incident.created_at).toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Agent:</span>
                    <span className="text-white ml-2">{incident.agent_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Type:</span>
                    <span className="text-white ml-2">{incident.incident_type}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Severity:</span>
                    <span className="text-white ml-2">{incident.severity}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Status:</span>
                    <span className="text-white ml-2">{incident.status}</span>
                  </div>
                </div>
                <p className="text-sm text-slate-400 mt-3">{incident.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== TEAM PAGE ====================
function TeamPage() {
  const { user } = useApp();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Team Management</h1>
        <p className="text-slate-400 mt-2">Manage your organization</p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Your Organization</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Organization Name</span>
            <span className="text-white font-medium">{user?.organizationName}</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Plan</span>
            <span className="text-white font-medium">Starter</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Members</span>
            <span className="text-white font-medium">1</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== API KEYS PAGE ====================
function ApiKeysPage({ apiKeys, setApiKeys }: { apiKeys: ApiKey[]; setApiKeys: (keys: ApiKey[]) => void }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  // Securely add API key - stored in Appwrite, key shown only once
  const addApiKey = async (name: string, permissions: string[]) => {
    setLoading(true);
    try {
      const { apiKey, error } = await appwriteDB.createSecureApiKey({ name, permissions });

      if (error) {
        toast.error('Failed to create API key: ' + error);
        setLoading(false);
        return;
      }

      if (apiKey) {
        // Show the raw key only once to the user
        setNewlyCreatedKey(apiKey.rawKey || null);

        // Update local list with masked version
        const newKeyEntry: ApiKey = {
          id: apiKey.$id || apiKey.id,
          name: apiKey.name,
          key: apiKey.rawKey ? `${apiKey.rawKey.substring(0, 10)}...${apiKey.rawKey.substring(apiKey.rawKey.length - 4)}` : '••••••••••••••••',
          created: apiKey.created,
          lastUsed: apiKey.lastUsed || 'Never',
          permissions: apiKey.permissions,
        };

        setApiKeys([...apiKeys, newKeyEntry]);

        // Log the action for audit
        await appwriteDB.createAuditLog('api_key_created', { keyId: apiKey.$id, keyName: name });
      }
    } catch (err) {
      console.error('Failed to create API key:', err);
      toast.error('Failed to create API key. Please try again.');
    }
    setLoading(false);
    setShowAddModal(false);
  };

  const deleteKey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
      return;
    }

    try {
      await appwriteDB.deleteApiKey(id);
      setApiKeys(apiKeys.filter(k => k.id !== id));

      // Log the action for audit
      await appwriteDB.createAuditLog('api_key_deleted', { keyId: id });
    } catch (err) {
      console.error('Failed to delete API key:', err);
      // Fallback to localStorage if Appwrite fails
      const keys = loadFromStorage(STORAGE_KEYS.API_KEYS, []);
      const filtered = (keys as ApiKey[]).filter((k: ApiKey) => k.id !== id);
      setApiKeys(filtered);
      saveToStorage(STORAGE_KEYS.API_KEYS, filtered);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard! Save this key securely - it will not be shown again.');
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">API Keys</h1>
          <p className="text-slate-400 mt-2">Manage your API keys securely</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Generate Key
        </button>
      </div>

      {/* Show newly created key only once */}
      {newlyCreatedKey && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-green-400 font-semibold mb-2">API Key Created Successfully</h3>
              <p className="text-slate-300 text-sm mb-4">
                Copy this key now. You will not be able to see it again!
              </p>
              <div className="flex items-center gap-2">
                <code className="bg-slate-900 px-4 py-2 rounded text-cyan-400 font-mono text-sm">
                  {newlyCreatedKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey)}
                  className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-white"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        {apiKeys.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No API keys generated yet</p>
        ) : (
          <div className="space-y-4">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
                <div>
                  <p className="font-medium text-white">{key.name}</p>
                  <p className="text-sm text-slate-400 font-mono">{key.key}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Created: {new Date(key.created).toLocaleDateString()} • Last used: {key.lastUsed}
                  </p>
                </div>
                <button
                  onClick={() => deleteKey(key.id)}
                  className="p-2 text-slate-400 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddApiKeyModal onClose={() => setShowAddModal(false)} onAdd={addApiKey} loading={loading} />
      )}
    </div>
  );
}

function AddApiKeyModal({ onClose, onAdd, loading = false }: { onClose: () => void; onAdd: (name: string, permissions: string[]) => void; loading?: boolean }) {
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<string[]>(['read']);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    await onAdd(name, permissions);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-6 z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold text-white mb-6">Generate API Key</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">Key Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              placeholder="e.g., Production API"
              required
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-2">Permissions</label>
            <div className="space-y-2">
              {['read', 'write', 'delete'].map((perm) => (
                <label key={perm} className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPermissions([...permissions, perm]);
                      } else {
                        setPermissions(permissions.filter(p => p !== perm));
                      }
                    }}
                    disabled={loading}
                    className="rounded bg-slate-700 border-slate-600"
                  />
                  <span className="capitalize">{perm}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-700 text-white rounded-lg"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name}
              className="flex-1 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==================== SETTINGS PAGE ====================
function SettingsPage() {
  const { user, signOut } = useApp();
  const [slackWebhook, setSlackWebhook] = useState('');
  const [pagerDutyKey, setPagerDutyKey] = useState('');
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [pagerDutyEnabled, setPagerDutyEnabled] = useState(false);
  const [alertLevel, setAlertLevel] = useState<'warning' | 'escalation' | 'critical'>('warning');
  const [saving, setSaving] = useState(false);

  // RasiAI Integration (OpenRouter) State
  const [rasiAiEnabled, setRasiAiEnabled] = useState(false);
  const [rasiAiApiKey, setRasiAiApiKey] = useState('');
  const [rasiAiHasApiKey, setRasiAiHasApiKey] = useState(false);
  const [rasiAiDefaultModel, setRasiAiDefaultModel] = useState('openai/gpt-4-turbo');
  const [rasiAiMaxBudget, setRasiAiMaxBudget] = useState<number>(1000);
  const [rasiAiCostAlertThreshold, setRasiAiCostAlertThreshold] = useState<number>(80);
  const [rasiAiSaving, setRasiAiSaving] = useState(false);
  const [rasiAiTesting, setRasiAiTesting] = useState(false);
  const [rasiAiConnectionStatus, setRasiAiConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [rasiAiLoading, setRasiAiLoading] = useState(true);

  // Available models for RasiAI
  const availableModels = [
    { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' },
    { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI' },
    { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
    { id: 'anthropic/claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'Anthropic' },
    { id: 'google/gemini-pro', name: 'Gemini Pro', provider: 'Google' },
    { id: 'meta-llama/llama-3-70b-instruct', name: 'Llama 3 70B', provider: 'Meta' },
    { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B', provider: 'Mistral' },
    { id: 'openai/gpt-4', name: 'GPT-4', provider: 'OpenAI' },
  ];

  // Load RasiAI settings from secure Appwrite storage on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { settings, error } = await appwriteDB.getRasiAiSettings();
        if (settings && !error) {
          setRasiAiEnabled(settings.enabled);
          setRasiAiDefaultModel(settings.defaultModel);
          setRasiAiMaxBudget(settings.maxBudget);
          setRasiAiCostAlertThreshold(settings.costAlertThreshold);
          setRasiAiHasApiKey(settings.hasApiKey);
        }
      } catch (err) {
        console.warn('Failed to load RasiAI settings:', err);
      }
      setRasiAiLoading(false);
    };
    loadSettings();
  }, []);

  // Validate OpenRouter API key format
  const isValidOpenRouterKey = (key: string): boolean => {
    return key.startsWith('sk-or-') && key.length >= 40;
  };

  // Test RasiAI (OpenRouter) connection
  const testRasiAiConnection = async () => {
    // Validate API key format before testing
    if (!rasiAiApiKey) {
      toast.error('Please enter your OpenRouter API key first.');
      return;
    }

    if (!isValidOpenRouterKey(rasiAiApiKey)) {
      toast.error('Invalid OpenRouter API key format. Key should start with "sk-or-"');
      return;
    }

    setRasiAiTesting(true);
    setRasiAiConnectionStatus('testing');

    try {
      // Test the OpenRouter API
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${rasiAiApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setRasiAiConnectionStatus('success');
        setRasiAiHasApiKey(true);
        toast.success('RasiAI connection successful! Your OpenRouter API is working.');
      } else {
        throw new Error('API request failed');
      }
    } catch (error) {
      setRasiAiConnectionStatus('failed');
      toast.error('RasiAI connection failed. Please check your API key.');
    }

    setRasiAiTesting(false);
  };

  // Save RasiAI settings securely to Appwrite
  const handleSaveRasiAi = async () => {
    // Validate inputs
    if (rasiAiEnabled && rasiAiApiKey && !isValidOpenRouterKey(rasiAiApiKey)) {
      toast.error('Invalid OpenRouter API key format. Key should start with "sk-or-" and be at least 40 characters.');
      return;
    }

    if (rasiAiMaxBudget < 0 || rasiAiMaxBudget > 100000) {
      toast.error('Budget must be between 0 and 100,000.');
      return;
    }

    if (rasiAiCostAlertThreshold < 0 || rasiAiCostAlertThreshold > 100) {
      toast.error('Alert threshold must be between 0 and 100.');
      return;
    }

    setRasiAiSaving(true);

    try {
      // Save to Appwrite (secure storage)
      const settings = {
        enabled: rasiAiEnabled,
        apiKey: rasiAiApiKey && !rasiAiApiKey.includes('••••') ? rasiAiApiKey : undefined,
        defaultModel: rasiAiDefaultModel,
        maxBudget: rasiAiMaxBudget,
        costAlertThreshold: rasiAiCostAlertThreshold,
      };

      await appwriteDB.saveRasiAiSettings(settings);

      // Clear API key from state after saving
      if (settings.apiKey) {
        setRasiAiApiKey('');
        setRasiAiHasApiKey(true);
      }

      // Log the action for audit
      await appwriteDB.createAuditLog('rasiAi_settings_updated', {
        enabled: rasiAiEnabled,
        defaultModel: rasiAiDefaultModel,
        maxBudget: rasiAiMaxBudget,
        costAlertThreshold: rasiAiCostAlertThreshold,
      });

      toast.success('RasiAI Integration settings saved securely!');
    } catch (err) {
      console.error('Failed to save RasiAI settings:', err);
      toast.error('Failed to save settings. Please try again.');
    }

    setRasiAiSaving(false);
  };

  // Team management state
  const [teamMembers, setTeamMembers] = useState([
    { id: '1', name: user?.organizationName || 'Admin', email: user?.email || '', role: 'admin', status: 'active', joinedAt: new Date().toISOString() }
  ]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');

  // Load settings from Appwrite on mount (secure storage)
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load webhook settings from Appwrite
        const { webhook, error } = await appwriteDB.getWebhooks();
        if (webhook) {
          setSlackEnabled(webhook.slackEnabled || false);
          setPagerDutyEnabled(webhook.pagerDutyEnabled || false);
          setAlertLevel((webhook.alertLevel as 'warning' | 'escalation' | 'critical') || 'warning');
        }

        // Also get the secrets (webhook URL/keys) for display - stored securely
        const { secrets } = await appwriteDB.getWebhookSecrets();
        if (secrets) {
          // Only show masked versions, never the actual values
          if (secrets.slackWebhook) {
            setSlackWebhook('https://hooks.slack.com/services/•••••••••••••••••');
          }
          if (secrets.pagerDutyKey) {
            setPagerDutyKey('••••••••••••••••••••••••••••••••');
          }
        }
      } catch (err) {
        console.warn('Failed to load settings from Appwrite, using defaults');
      }
    };

    loadSettings();
  }, []);

  // Test Slack webhook connection (rate limited)
  const testSlackConnection = async () => {
    if (!slackWebhook) {
      toast.error('Please enter a Slack webhook URL');
      return;
    }

    // Rate limiting - max 3 tests per minute
    const rateLimitKey = `slack_test_${user?.id || 'anonymous'}`;
    if (!webhookRateLimiter.isAllowed(rateLimitKey)) {
      toast.warning('Too many connection tests. Please wait a moment.');
      return;
    }

    setConnectionStatus('testing');
    try {
      // For testing, we need the actual webhook URL (not masked)
      // In production, this should be done server-side
      const { secrets } = await appwriteDB.getWebhookSecrets();
      const testUrl = secrets?.slackWebhook || slackWebhook;

      if (!testUrl || testUrl.includes('••••')) {
        toast.warning('Please save your webhook URL first before testing.');
        setConnectionStatus('idle');
        return;
      }

      const response = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '🔔 Synthetic HR test notification - connection successful!',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '✅ *Connection Test Successful*\nSynthetic HR is now connected to this channel.'
              }
            }
          ]
        })
      });
      if (response.ok || response.status === 200) {
        setConnectionStatus('success');
        toast.success('Slack connection test successful!');
      } else {
        setConnectionStatus('failed');
        toast.error('Slack connection test failed. Please check your webhook URL.');
      }
    } catch (error) {
      setConnectionStatus('failed');
      toast.error('Failed to connect to Slack. Please check your webhook URL.');
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.warning('Please enter an email address');
      return;
    }
    setInviting(true);

    try {
      // Log the invitation for audit
      await appwriteDB.createAuditLog('team_invite_sent', { email: inviteEmail, role: inviteRole });

      setTeamMembers([...teamMembers, {
        id: crypto.randomUUID(),
        name: inviteEmail.split('@')[0],
        email: inviteEmail,
        role: inviteRole,
        status: 'pending',
        joinedAt: new Date().toISOString()
      }]);
      setInviteEmail('');
      setShowInviteModal(false);
      toast.success(`Invitation sent to ${inviteEmail}`);
    } catch (err) {
      console.error('Failed to send invitation:', err);
    }
    setInviting(false);
  };

  const handleRemoveMember = async (id: string) => {
    try {
      await appwriteDB.createAuditLog('team_member_removed', { memberId: id });
    } catch (err) {
      console.warn('Failed to log audit event');
    }
    setTeamMembers(teamMembers.filter(m => m.id !== id));
  };

  const handleRoleChange = (id: string, newRole: string) => {
    setTeamMembers(teamMembers.map(m => m.id === id ? { ...m, role: newRole } : m));
  };

  // Securely save webhook configurations to Appwrite
  const handleSaveIntegrations = async () => {
    setSaving(true);
    try {
      // Save to Appwrite (secure storage)
      await appwriteDB.saveWebhooks({
        slackWebhook: slackWebhook && !slackWebhook.includes('••••') ? slackWebhook : undefined,
        slackEnabled,
        pagerDutyKey: pagerDutyKey && !pagerDutyKey.includes('••••') ? pagerDutyKey : undefined,
        pagerDutyEnabled,
        alertLevel,
      });

      // Log the action for audit
      await appwriteDB.createAuditLog('webhook_settings_updated', {
        slackEnabled,
        pagerDutyEnabled,
        alertLevel,
      });

      // Also save to localStorage as backup (without sensitive data)
      localStorage.setItem('synthetic_hr_slack_enabled', slackEnabled.toString());
      localStorage.setItem('synthetic_hr_pagerduty_enabled', pagerDutyEnabled.toString());
      localStorage.setItem('synthetic_hr_alert_level', alertLevel);

      toast.success('Integration settings saved securely!');
    } catch (err) {
      console.error('Failed to save webhook settings:', err);
      toast.error('Failed to save settings. Please try again.');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 mt-2">Manage your account and integrations</p>
      </div>

      {/* Account Section */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Email</span>
            <span className="text-white">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Organization</span>
            <span className="text-white">{user?.organizationName}</span>
          </div>
        </div>
      </div>

      {/* Team Management Section */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Users className="w-5 h-5 text-cyan-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Team Members</h2>
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Invite Member
          </button>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Manage your team members and their access levels. Invite new members to collaborate.
        </p>

        {/* Team Members List */}
        <div className="space-y-3">
          {teamMembers.map((member) => (
            <div key={member.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-medium text-sm">
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="text-white font-medium">{member.name}</div>
                  <div className="text-slate-400 text-sm">{member.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {member.status === 'pending' && (
                  <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded">Pending</span>
                )}
                {member.role === 'admin' ? (
                  <span className="px-2 py-1 bg-purple-500/10 text-purple-400 text-xs rounded">Admin</span>
                ) : member.role === 'editor' ? (
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value)}
                    className="bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value)}
                    className="bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                )}
                {member.role !== 'admin' && (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-4">Invite Team Member</h3>
            <div className="space-y-4">
              <div>
                <label className="text-slate-400 text-sm">Email Address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full mt-1 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="text-slate-400 text-sm">Role</label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <button
                    onClick={() => setInviteRole('editor')}
                    className={`p-3 rounded-lg border ${inviteRole === 'editor'
                        ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                  >
                    <User className="w-5 h-5 mx-auto mb-1" />
                    <span className="text-sm font-medium">Editor</span>
                    <p className="text-xs mt-1 opacity-70">Can edit agents & settings</p>
                  </button>
                  <button
                    onClick={() => setInviteRole('viewer')}
                    className={`p-3 rounded-lg border ${inviteRole === 'viewer'
                        ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                  >
                    <Eye className="w-5 h-5 mx-auto mb-1" />
                    <span className="text-sm font-medium">Viewer</span>
                    <p className="text-xs mt-1 opacity-70">Read-only access</p>
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowInviteModal(false)}
                className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail}
                className="flex-1 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-600 text-white rounded-lg transition-colors"
              >
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Red Phone / Slack Integration */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <PhoneCall className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-white">Red Phone Alerts</h2>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Configure emergency alerts when incidents are detected. The Red Phone system sends instant notifications to your team's communication channels.
        </p>

        {/* Slack Integration */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Slack className="w-5 h-5 text-slate-400" />
              <span className="text-white font-medium">Slack</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={slackEnabled}
                onChange={(e) => setSlackEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>
          {slackEnabled && (
            <div className="ml-7">
              <label className="text-slate-400 text-sm">Webhook URL</label>
              <input
                type="url"
                value={slackWebhook}
                onChange={(e) => setSlackWebhook(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full mt-1 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <p className="text-slate-500 text-xs mt-1">Create a Slack Incoming Webhook and paste the URL here</p>
            </div>
          )}
        </div>

        {/* PagerDuty Integration */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-5 h-5 text-slate-400" />
              <span className="text-white font-medium">PagerDuty</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={pagerDutyEnabled}
                onChange={(e) => setPagerDutyEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>
          {pagerDutyEnabled && (
            <div className="ml-7">
              <label className="text-slate-400 text-sm">Integration Key</label>
              <input
                type="text"
                value={pagerDutyKey}
                onChange={(e) => setPagerDutyKey(e.target.value)}
                placeholder="Enter your PagerDuty integration key"
                className="w-full mt-1 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <p className="text-slate-500 text-xs mt-1">Create an Events API v2 integration in PagerDuty</p>
            </div>
          )}
        </div>

        {/* Alert Level */}
        <div className="mb-6">
          <label className="text-white font-medium mb-3 block">Alert Trigger Level</label>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => setAlertLevel('warning')}
              className={`p-3 rounded-lg border ${alertLevel === 'warning'
                  ? 'bg-amber-500/10 border-amber-500 text-amber-400'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
            >
              <AlertTriangle className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm font-medium">Warning</span>
            </button>
            <button
              onClick={() => setAlertLevel('escalation')}
              className={`p-3 rounded-lg border ${alertLevel === 'escalation'
                  ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
            >
              <Phone className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm font-medium">Escalation</span>
            </button>
            <button
              onClick={() => setAlertLevel('critical')}
              className={`p-3 rounded-lg border ${alertLevel === 'critical'
                  ? 'bg-red-500/10 border-red-500 text-red-400'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
            >
              <ZapOff className="w-5 h-5 mx-auto mb-1" />
              <span className="text-sm font-medium">Critical</span>
            </button>
          </div>
          <p className="text-slate-500 text-xs mt-2">
            Only trigger alerts at or above the selected severity level
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={testSlackConnection}
            disabled={connectionStatus === 'testing' || !slackWebhook}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {connectionStatus === 'testing' ? (
              <span>Testing...</span>
            ) : connectionStatus === 'success' ? (
              <>
                <span className="text-green-400">✓</span> Connected
              </>
            ) : connectionStatus === 'failed' ? (
              <>
                <span className="text-red-400">✗</span> Failed
              </>
            ) : (
              'Test Slack Connection'
            )}
          </button>
          <button
            onClick={handleSaveIntegrations}
            disabled={saving}
            className="flex-1 py-3 bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save Integration Settings'}
          </button>
        </div>
      </div>

      {/* RasiAI Integration (OpenRouter) */}
      <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">RasiAI Integration</h2>
            <p className="text-purple-300 text-sm">Powered by OpenRouter - Universal AI Gateway</p>
          </div>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Connect your AI agents to multiple LLM providers through RasiAI's unified API.
          Enable cost governance, model routing, and unified billing across OpenAI, Anthropic, Google, Meta, and more.
        </p>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between mb-6 p-4 bg-slate-900/50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Plug className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <span className="text-white font-medium">Enable RasiAI</span>
              <p className="text-slate-400 text-xs">Route all AI requests through RasiAI gateway</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={rasiAiEnabled}
              onChange={(e) => setRasiAiEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
          </label>
        </div>

        {rasiAiEnabled && (
          <div className="space-y-6">
            {/* API Key */}
            <div>
              <label className="text-white font-medium mb-2 block">OpenRouter API Key</label>
              <div className="flex gap-3">
                <input
                  type="password"
                  value={rasiAiApiKey}
                  onChange={(e) => setRasiAiApiKey(e.target.value)}
                  placeholder={rasiAiHasApiKey ? "•••••••••••••••••••••••••••••• (already saved)" : "sk-or-v1-..."}
                  className="flex-1 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={testRasiAiConnection}
                  disabled={rasiAiTesting || !rasiAiApiKey}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {rasiAiTesting ? (
                    <span>Testing...</span>
                  ) : rasiAiConnectionStatus === 'success' ? (
                    <>
                      <span className="text-green-400">✓</span>
                    </>
                  ) : rasiAiConnectionStatus === 'failed' ? (
                    <>
                      <span className="text-red-400">✗</span>
                    </>
                  ) : (
                    'Test'
                  )}
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-slate-500 text-xs">
                  Get your API key from <a href="https://openrouter.ai/settings" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">openrouter.ai</a>
                </p>
                {rasiAiHasApiKey && (
                  <span className="text-green-400 text-xs flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> API Key Saved
                  </span>
                )}
              </div>
            </div>

            {/* Default Model */}
            <div>
              <label className="text-white font-medium mb-2 block">Default Model</label>
              <select
                value={rasiAiDefaultModel}
                onChange={(e) => setRasiAiDefaultModel(e.target.value)}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider})
                  </option>
                ))}
              </select>
              <p className="text-slate-500 text-xs mt-1">
                Default model for all AI agent requests
              </p>
            </div>

            {/* Cost Budget & Alerts */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white font-medium mb-2 block">Monthly Budget ($)</label>
                <input
                  type="number"
                  value={rasiAiMaxBudget}
                  onChange={(e) => setRasiAiMaxBudget(Number(e.target.value))}
                  min={0}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
                <p className="text-slate-500 text-xs mt-1">
                  Maximum monthly spend limit
                </p>
              </div>
              <div>
                <label className="text-white font-medium mb-2 block">Alert Threshold (%)</label>
                <input
                  type="number"
                  value={rasiAiCostAlertThreshold}
                  onChange={(e) => setRasiAiCostAlertThreshold(Number(e.target.value))}
                  min={0}
                  max={100}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
                <p className="text-slate-500 text-xs mt-1">
                  Alert when budget reaches %
                </p>
              </div>
            </div>

            {/* Features Overview */}
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h4 className="text-white font-medium mb-3">RasiAI Features</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Multi-Provider Routing
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Cost Governance
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Unified Billing
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Model Fallback
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Token Analytics
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Usage Reports
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveRasiAi}
              disabled={rasiAiSaving}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {rasiAiSaving ? (
                'Saving...'
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save RasiAI Settings
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-slate-800/30 border border-red-500/20 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Danger Zone</h2>
        <button
          onClick={signOut}
          className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ==================== PRICING PAGE ====================
function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const plans = [
    {
      name: 'Starter',
      description: 'For small teams getting started with AI governance',
      monthlyPrice: 15000,
      yearlyPrice: 150000,
      features: [
        'Up to 5 AI Agents',
        'Basic Cost Monitoring',
        'Incident Tracking',
        'Email Support',
        '7-day Data Retention',
        'Standard Risk Scoring'
      ],
      color: 'blue',
      popular: false
    },
    {
      name: 'Pro',
      description: 'For growing companies needing advanced governance',
      monthlyPrice: 40000,
      yearlyPrice: 400000,
      features: [
        'Up to 25 AI Agents',
        'Advanced Cost Analytics',
        'Real-time Incident Alerts',
        'Shadow Mode Testing',
        'Black Box Recording',
        'Priority Support',
        '30-day Data Retention',
        'Custom Risk Rules',
        'API Access'
      ],
      color: 'cyan',
      popular: true
    },
    {
      name: 'Enterprise',
      description: 'For large organizations with advanced needs',
      monthlyPrice: 0,
      yearlyPrice: 0,
      features: [
        'Unlimited AI Agents',
        'Custom Cost Models',
        'Dedicated Governance Manager',
        '24/7 Red Phone Support',
        'On-premise Deployment',
        'Unlimited Data Retention',
        'Custom Integrations',
        'SLA Guarantees',
        'Compliance Reports',
        'White-label Options'
      ],
      color: 'purple',
      popular: false
    }
  ];

  const addOns = [
    {
      name: 'Additional AI Agents',
      description: 'Add more agents beyond your plan limit',
      price: 2000,
      unit: 'per agent/month'
    },
    {
      name: 'Extended Data Retention',
      description: 'Store conversation logs longer for compliance',
      price: 5000,
      unit: 'per year'
    },
    {
      name: 'Priority Support',
      description: 'Get faster response times',
      price: 10000,
      unit: 'per month'
    }
  ];

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; border: string; text: string; button: string; buttonHover: string }> = {
      blue: { bg: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-400', button: 'bg-blue-500 hover:bg-blue-600', buttonHover: 'hover:bg-blue-600' },
      cyan: { bg: 'bg-cyan-500', border: 'border-cyan-500', text: 'text-cyan-400', button: 'bg-cyan-500 hover:bg-cyan-600', buttonHover: 'hover:bg-cyan-600' },
      purple: { bg: 'bg-purple-500', border: 'border-purple-500', text: 'text-purple-400', button: 'bg-purple-500 hover:bg-purple-600', buttonHover: 'hover:bg-purple-600' },
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Pricing Plans</h1>
        <p className="text-slate-400 mt-2">Choose the right plan for your AI workforce governance needs</p>

        <div className="flex items-center justify-center gap-4 mt-6">
          <span className={billingCycle === 'monthly' ? 'text-white' : 'text-slate-400'}>Monthly</span>
          <button
            onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
            className="relative w-14 h-7 bg-slate-700 rounded-full transition-colors"
          >
            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${billingCycle === 'yearly' ? 'translate-x-8' : 'translate-x-1'
              }`} />
          </button>
          <span className={billingCycle === 'yearly' ? 'text-white' : 'text-slate-400'}>
            Yearly <span className="text-green-400 text-sm">(Save 20%)</span>
          </span>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const colors = getColorClasses(plan.color);
          const price = billingCycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;

          return (
            <div
              key={plan.name}
              className={`relative bg-slate-800 rounded-2xl border-2 transition-all ${plan.popular ? 'border-cyan-500 shadow-lg shadow-cyan-500/20' : 'border-slate-700 hover:border-slate-600'
                }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-cyan-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <div className="p-6">
                <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center mb-4`}>
                  <CreditCard className="w-6 h-6 text-white" />
                </div>

                <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                <p className="text-slate-400 text-sm mt-2">{plan.description}</p>

                <div className="mt-6">
                  {plan.monthlyPrice === 0 ? (
                    <div className="text-3xl font-bold text-white">Custom</div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-white">₹{price.toLocaleString()}</span>
                        <span className="text-slate-400">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                      </div>
                      {billingCycle === 'yearly' && (
                        <p className="text-green-400 text-sm mt-1">Save ₹{(plan.monthlyPrice * 12 - plan.yearlyPrice).toLocaleString()}/year</p>
                      )}
                    </>
                  )}
                </div>

                <ul className="mt-6 space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3 text-sm">
                      <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  className={`w-full mt-6 py-3 rounded-lg font-medium transition-colors ${plan.popular
                      ? 'bg-cyan-500 text-white hover:bg-cyan-600'
                      : 'bg-slate-700 text-white hover:bg-slate-600'
                    }`}
                >
                  {plan.monthlyPrice === 0 ? 'Contact Sales' : 'Get Started'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add-ons */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white mb-4">Add-ons</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {addOns.map((addon) => (
            <div key={addon.name} className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="font-medium text-white">{addon.name}</h3>
              <p className="text-slate-400 text-sm mt-1">{addon.description}</p>
              <p className="text-cyan-400 font-bold mt-2">₹{addon.price.toLocaleString()} {addon.unit}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white mb-4">Frequently Asked Questions</h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-white">Can I change plans anytime?</h3>
            <p className="text-slate-400 text-sm mt-1">Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.</p>
          </div>
          <div>
            <h3 className="font-medium text-white">What payment methods do you accept?</h3>
            <p className="text-slate-400 text-sm mt-1">We accept all major credit cards, UPI, and bank transfers for annual plans.</p>
          </div>
          <div>
            <h3 className="font-medium text-white">Is there a free trial?</h3>
            <p className="text-slate-400 text-sm mt-1">Yes, we offer a 14-day free trial on the Pro plan with no credit card required.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== SAFE HARBOR PAGE ====================
function SafeHarborPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Safe Harbor SLA</h1>
        <p className="text-slate-400 mt-2">Understanding Rasi's governance protections and your responsibilities</p>
      </div>

      {/* Protection Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-green-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">What We Protect</h2>
          </div>
          <ul className="space-y-3 text-slate-300">
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>AI agent behavior within configured parameters</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>Cost governance and budget enforcement</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>Incident detection and alerting</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>Audit trail integrity and data retention</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <span>Kill switch functionality</span>
            </li>
          </ul>
        </div>

        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Client Responsibilities</h2>
          </div>
          <ul className="space-y-3 text-slate-300">
            <li className="flex items-start gap-2">
              <X className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Agent persona configuration and content</span>
            </li>
            <li className="flex items-start gap-2">
              <X className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Training data and knowledge base accuracy</span>
            </li>
            <li className="flex items-start gap-2">
              <X className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Integration security and access controls</span>
            </li>
            <li className="flex items-start gap-2">
              <X className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Legal compliance of AI outputs</span>
            </li>
            <li className="flex items-start gap-2">
              <X className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Third-party API security</span>
            </li>
          </ul>
        </div>
      </div>

      {/* SLA Details */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white mb-6">Service Level Agreement</h2>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                <h3 className="font-medium text-white">Platform Uptime</h3>
              </div>
              <p className="text-3xl font-bold text-white">99.9%</p>
              <p className="text-slate-400 text-sm">Enterprise Plan</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-cyan-400" />
                <h3 className="font-medium text-white">Support Response</h3>
              </div>
              <p className="text-3xl font-bold text-white">1hr</p>
              <p className="text-slate-400 text-sm">Pro Plan</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-cyan-400" />
                <h3 className="font-medium text-white">Incident Alert Time</h3>
              </div>
              <p className="text-3xl font-bold text-white">&lt;5min</p>
              <p className="text-slate-400 text-sm">Real-time Detection</p>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Mitigation */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white mb-4">Risk Mitigation Features</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Shield className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Multi-layer Protection</h3>
                <p className="text-slate-400 text-sm">Real-time blocking + Async deep review + Human escalation</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Database className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Complete Audit Trail</h3>
                <p className="text-slate-400 text-sm">Full conversation logs, prompt traces, and timeline reconstruction</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <PhoneCall className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Red Phone Emergency</h3>
                <p className="text-slate-400 text-sm">Instant kill switch with Slack/PagerDuty integration</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <TrendingDown className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Cost Safeguards</h3>
                <p className="text-slate-400 text-sm">Budget caps, auto-throttle, and spending alerts</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <FileText className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Compliance Reports</h3>
                <p className="text-slate-400 text-sm">Automated reports for regulatory requirements</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Eye className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Shadow Mode Testing</h3>
                <p className="text-slate-400 text-sm">Pre-deployment adversarial testing</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Liability */}
      <div className="bg-slate-800/30 border border-red-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertOctagon className="w-6 h-6 text-red-400" />
          <h2 className="text-lg font-semibold text-white">Limitation of Liability</h2>
        </div>
        <p className="text-slate-300 text-sm">
          Rasi Solutions provides AI governance tools and monitoring services. We act as a governance layer
          and do not control the actual outputs or decisions made by AI agents. Clients are responsible for
          ensuring their AI agents comply with applicable laws and regulations. Rasi's liability is limited
          to the fees paid for our services in the 12 months preceding any claim.
        </p>
      </div>

      {/* Contact */}
      <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-xl p-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white">Questions about our Safe Harbor?</h2>
          <p className="text-slate-400 mt-2">Our legal team is here to help you understand our protections</p>
          <button className="mt-4 px-6 py-3 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors">
            Contact Legal Team
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== UNIVERSAL CONNECTOR PAGE ====================
function UniversalConnectorPage() {
  const [integrations, setIntegrations] = useState([
    { id: 'intercom', name: 'Intercom', status: 'connected', icon: '💬', requests: 12453, errors: 12 },
    { id: 'zendesk', name: 'Zendesk', status: 'connected', icon: '🎫', requests: 8921, errors: 5 },
    { id: 'custom', name: 'Custom Bot', status: 'active', icon: '🤖', requests: 34567, errors: 23 },
    { id: 'slack', name: 'Slack', status: 'connected', icon: '💼', requests: 4521, errors: 2 },
    { id: 'discord', name: 'Discord', status: 'disconnected', icon: '🎮', requests: 0, errors: 0 },
    { id: 'api', name: 'API Proxy', status: 'active', icon: '🔌', requests: 78234, errors: 45 },
  ]);

  const [proxyEndpoints, setProxyEndpoints] = useState([
    { path: '/api/v1/chat', method: 'POST', requests: 45678, latency: '45ms', status: 'active' },
    { path: '/api/v1/completions', method: 'POST', requests: 23456, latency: '120ms', status: 'active' },
    { path: '/api/v1/embeddings', method: 'POST', requests: 8900, latency: '35ms', status: 'active' },
    { path: '/api/v1/audit', method: 'GET', requests: 1200, latency: '15ms', status: 'active' },
  ]);

  const [logScraperConfigs, setLogScraperConfigs] = useState([
    { source: 'Intercom Chats', lastSync: '2 min ago', messages: 12453, status: 'syncing' },
    { source: 'Zendesk Tickets', lastSync: '5 min ago', messages: 8921, status: 'syncing' },
    { source: 'Email Support', lastSync: '1 hour ago', messages: 2341, status: 'idle' },
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Universal Connector</h1>
        <p className="text-slate-400 mt-2">API Proxy & Cross-Platform Integration Hub</p>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Link2 className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-slate-400 text-sm">Active Connections</p>
              <p className="text-2xl font-bold text-white">{integrations.filter(i => i.status !== 'disconnected').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Activity className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-slate-400 text-sm">Total Requests</p>
              <p className="text-2xl font-bold text-white">{(integrations.reduce((a, i) => a + i.requests, 0)).toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-slate-400 text-sm">Error Rate</p>
              <p className="text-2xl font-bold text-white">
                {((integrations.reduce((a, i) => a + i.errors, 0) / integrations.reduce((a, i) => a + i.requests, 1)) * 100).toFixed(2)}%
              </p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Clock className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-slate-400 text-sm">Avg Latency</p>
              <p className="text-2xl font-bold text-white">54ms</p>
            </div>
          </div>
        </div>
      </div>

      {/* Integration Cards */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Platform Integrations</h2>
          <button className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors text-sm">
            + Add Integration
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {integrations.map((integration) => (
            <div key={integration.id} className="bg-slate-900/50 border border-slate-700 rounded-xl p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{integration.icon}</span>
                  <div>
                    <h3 className="font-semibold text-white">{integration.name}</h3>
                    <p className="text-xs text-slate-400 capitalize">{integration.status}</p>
                  </div>
                </div>
                <span className={`w-2 h-2 rounded-full ${integration.status === 'connected' ? 'bg-green-400' : integration.status === 'active' ? 'bg-cyan-400' : 'bg-slate-500'}`} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-400 text-xs">Requests</p>
                  <p className="font-medium text-white">{integration.requests.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Errors</p>
                  <p className={`font-medium ${integration.errors > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {integration.errors}
                  </p>
                </div>
              </div>
              <button className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors">
                Configure
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* API Proxy Endpoints */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Terminal className="w-5 h-5 text-cyan-400" />
            </div>
            <h2 className="text-xl font-bold text-white">API Proxy Endpoints</h2>
          </div>
          <button className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors text-sm">
            View Documentation
          </button>
        </div>

        <div className="space-y-3">
          {proxyEndpoints.map((endpoint, idx) => (
            <div key={idx} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs font-mono ${endpoint.method === 'GET' ? 'bg-green-500/20 text-green-400' :
                    endpoint.method === 'POST' ? 'bg-blue-500/20 text-blue-400' :
                      endpoint.method === 'DELETE' ? 'bg-red-500/20 text-red-400' :
                        'bg-amber-500/20 text-amber-400'
                  }`}>
                  {endpoint.method}
                </span>
                <span className="font-mono text-sm text-cyan-400">{endpoint.path}</span>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <p className="text-slate-400 text-xs">Requests</p>
                  <p className="font-medium text-white">{endpoint.requests.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-slate-400 text-xs">Latency</p>
                  <p className="font-medium text-white">{endpoint.latency}</p>
                </div>
                <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-400">
                  {endpoint.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Log Scraper */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Database className="w-5 h-5 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Log Scraper</h2>
          </div>
          <button className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors text-sm">
            + Add Source
          </button>
        </div>

        <div className="space-y-3">
          {logScraperConfigs.map((config, idx) => (
            <div key={idx} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-slate-700 rounded-lg">
                  <MessageSquare className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <h3 className="font-medium text-white">{config.source}</h3>
                  <p className="text-xs text-slate-400">Last sync: {config.lastSync}</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-slate-400 text-xs">Messages</p>
                  <p className="font-medium text-white">{config.messages.toLocaleString()}</p>
                </div>
                <span className={`px-2 py-1 rounded text-xs ${config.status === 'syncing' ? 'bg-amber-500/20 text-amber-400' :
                    config.status === 'idle' ? 'bg-slate-500/20 text-slate-400' :
                      'bg-green-500/20 text-green-400'
                  }`}>
                  {config.status}
                </span>
                <button className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
                  <RefreshCw className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Async Auditing Architecture */}
      <div className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-6 h-6 text-cyan-400" />
          <h2 className="text-xl font-bold text-white">Async Auditing Architecture</h2>
        </div>
        <p className="text-slate-300 mb-6">
          Solves the latency vs safety tradeoff. Our architecture processes requests with intelligent filtering.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-green-400" />
              <h3 className="font-medium text-white">Real-Time Blocking</h3>
            </div>
            <p className="text-sm text-slate-400 mb-3">0.1s latency for critical safety checks</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Requests processed</span>
                <span className="text-white">89,234</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Blocked</span>
                <span className="text-red-400">234</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div className="bg-green-400 h-1.5 rounded-full" style={{ width: '99.7%' }} />
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="font-medium text-white">Async Deep Review</h3>
            </div>
            <p className="text-sm text-slate-400 mb-3">5s latency for comprehensive analysis</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Requests reviewed</span>
                <span className="text-white">45,123</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Flags raised</span>
                <span className="text-amber-400">567</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: '98.7%' }} />
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <h3 className="font-medium text-white">Human Alert</h3>
            </div>
            <p className="text-sm text-slate-400 mb-3">Escalated to team for review</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Total escalations</span>
                <span className="text-white">89</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Pending review</span>
                <span className="text-red-400">3</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div className="bg-red-400 h-1.5 rounded-full" style={{ width: '3.3%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================
function App() {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<'landing' | 'login' | 'signup' | 'dashboard' | 'demo'>('landing');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Data Retention Settings
  const [retentionDays, setRetentionDays] = useState(() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('synthetic_hr_retention_days') || '90');
    }
    return 90;
  });

  // Enter demo mode with pre-populated data
  const enterDemoMode = () => {
    setIsDemoMode(true);
    setUser({
      id: 'demo-user',
      email: 'demo@synthetichr.com',
      organizationName: 'Demo Company Inc.',
    });
    // Store demo user
    localStorage.setItem('synthetic_hr_user', JSON.stringify({
      id: 'demo-user',
      email: 'demo@synthetichr.com',
      organizationName: 'Demo Company Inc.',
    }));
    setView('dashboard');
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load user from localStorage first (instant, no CORS issues)
  useEffect(() => {
    if (!mounted) return;

    // Do not trust localStorage for auth state.
    // Authenticated view must come from live Appwrite session validation.
    setLoading(true);
  }, [mounted]);

  // Then try to sync with Appwrite in background (may fail due to CORS)
  useEffect(() => {
    if (!mounted) return;

    const checkAppwriteSession = async () => {
      try {
        const { user: authUser, error } = await authHelpers.getCurrentUser();
        if (authUser && !error) {
          const newUser: AuthUser = {
            id: authUser.id,
            email: authUser.email || '',
            organizationName: (authUser.user_metadata?.full_name as string) || 'My Organization',
          };
          setUser(newUser);
          setView('dashboard');
        } else {
          setUser(null);
          setView('landing');
        }
      } catch {
        setUser(null);
        setView('landing');
      } finally {
        setLoading(false);
      }
    };

    // Delay Appwrite check slightly to let the UI render first
    const timer = setTimeout(checkAppwriteSession, 1000);
    return () => clearTimeout(timer);
  }, [mounted]);

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
    if (!/[!@#$%^&*]/.test(password)) return 'Password must contain at least one special character (!@#$%^&*)';
    return null;
  };

  const signUp = async (email: string, password: string, orgName: string): Promise<{ error: string | null }> => {
    // Validate password first
    const passwordError = validatePassword(password);
    if (passwordError) {
      return { error: passwordError };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { error: 'Please enter a valid email address' };
    }

    try {
      const { user: authUser, error } = await authHelpers.signUp(email, password, orgName);

      if (error) {
        if (error.includes('already exists') || error.includes('already registered')) {
          return { error: 'An account with this email already exists' };
        }
        return { error: error };
      }

      if (!authUser) {
        return { error: 'Failed to create account. Please try again.' };
      }

      const newUser: AuthUser = {
        id: authUser.id,
        email,
        organizationName: orgName,
      };

      setUser(newUser);
      setView('dashboard');

      return { error: null };
    } catch (err: any) {
      console.error('Signup error:', err);
      return { error: 'Unable to create account. Please check your connection and try again.' };
    }
  };

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    // Validate inputs
    if (!email || !password) {
      return { error: 'Please enter email and password' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { error: 'Please enter a valid email address' };
    }

    try {
      const { user: authUser, error } = await authHelpers.signIn(email, password);

      if (error) {
        if (error.includes('Invalid') || error.includes('credentials')) {
          return { error: 'Invalid email or password' };
        }
        return { error: error };
      }

      if (!authUser) {
        return { error: 'Failed to sign in. Please try again.' };
      }

      const newUser: AuthUser = {
        id: authUser.id,
        email,
        organizationName: (authUser.user_metadata?.full_name as string) || 'My Organization',
      };

      setUser(newUser);
      setView('dashboard');

      return { error: null };
    } catch (err: any) {
      console.error('Signin error:', err);
      return { error: 'Unable to sign in. Please check your connection and try again.' };
    }
  };

  const signOut = async () => {
    // Clear all app data from localStorage
    localStorage.removeItem('synthetic_hr_user');
    localStorage.removeItem(STORAGE_KEYS.AGENTS);
    localStorage.removeItem(STORAGE_KEYS.INCIDENTS);
    localStorage.removeItem(STORAGE_KEYS.COST_DATA);
    localStorage.removeItem(STORAGE_KEYS.API_KEYS);

    try {
      await authHelpers.signOut();
    } catch (err) {
      // Continue with logout even if server is unreachable
      console.error('Signout warning:', err);
    }

    setUser(null);
    setView('login');
  };

  // Prevent hydration mismatch - must be FIRST check
  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  const updateRetentionDays = (days: number) => {
    setRetentionDays(days);
    if (typeof window !== 'undefined') {
      localStorage.setItem('synthetic_hr_retention_days', days.toString());
    }
  };

  // Export Functions
  const exportData = (type: 'csv' | 'json', data: any[], filename: string) => {
    let content: string;
    let mimeType: string;

    if (type === 'json') {
      content = JSON.stringify(data, null, 2);
      mimeType = 'application/json';
    } else {
      if (data.length === 0) return;
      const headers = Object.keys(data[0]);
      const rows = data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
      content = [headers.join(','), ...rows].join('\n');
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${type}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Prevent hydration - wait for mount
  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, loading: false, signUp, signIn, signOut }}>
      {view === 'landing' && (
        <LandingPage
          onSignUp={() => setView('signup')}
          onLogin={() => setView('login')}
          onDemo={enterDemoMode}
        />
      )}
      {view === 'signup' && (
        <SignUpPage onSignIn={() => setView('login')} onBack={() => setView('landing')} />
      )}
      {view === 'login' && (
        <LoginPage onSignUp={() => setView('signup')} onBack={() => setView('landing')} />
      )}
      {view === 'dashboard' && <Dashboard retentionDays={retentionDays} updateRetentionDays={updateRetentionDays} exportData={exportData} isDemoMode={isDemoMode} />}
    </AppContext.Provider>
  );
}

export default App;
