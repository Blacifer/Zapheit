import { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AppContext, type AuthUser } from './context/AppContext';
import { authHelpers, supabase } from './lib/supabase-client';
import { getFrontendConfig } from './lib/config';
import { STORAGE_KEYS } from './lib/utils';
import { MfaEnrollmentGate } from './components/MfaEnrollmentGate';
import { identifyUser, resetAnalytics, analytics } from './lib/analytics';

// Lazy load all page components
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SignUpPage = lazy(() => import('./pages/SignUpPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const SharePage = lazy(() => import('./pages/Share'));
const PublicChatPage = lazy(() => import('./pages/PublicChatPage'));
const InterviewRoomPage = lazy(() => import('./pages/InterviewRoomPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const CashfreeReturnPage = lazy(() => import('./pages/CashfreeReturnPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));

// Loading spinner component
function LoadingSpinner() {
  return (
    <div className="min-h-screen app-bg flex items-center justify-center text-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-2 border-white/20 border-t-blue-400"></div>
    </div>
  );
}

const TIMEOUT_MS = 15 * 60 * 1000;
const ADMIN_MFA_ROLES = new Set<AuthUser['role']>(['super_admin', 'admin']);

async function buildAuthUser(authUser: any): Promise<AuthUser> {
  const { profile } = await authHelpers.getWorkspaceProfile(authUser.id);

  return {
    id: authUser.id,
    email: authUser.email || '',
    organizationName: authUser.user_metadata?.organization_name || 'My Organization',
    role: profile?.role || 'viewer',
  };
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const config = getFrontendConfig();
  const demoEnabled = Boolean(config.demoModeEnabled);
  const pendingInviteStorageKey = 'synthetic_hr_pending_invite_token';

  const claimInviteIfPending = useCallback(async (accessToken: string | null | undefined) => {
    if (!accessToken) return;
    const token = localStorage.getItem(pendingInviteStorageKey);
    if (!token) return;

    const base = (config.apiUrl || 'http://localhost:3001/api').replace(/\/+$/, '');
    const claimUrl = base.endsWith('/api') ? `${base}/invites/claim` : `${base}/api/invites/claim`;

    try {
      const res = await fetch(claimUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        localStorage.removeItem(pendingInviteStorageKey);
      }
    } catch {
      // Best-effort; user can retry from the invite link.
    }
  }, [config.apiUrl]);

  // Inactivity timeout — only active while on the dashboard
  useEffect(() => {
    const isDashboard = location.pathname.startsWith('/dashboard');
    const rememberMe = localStorage.getItem('synthetic_hr_remember_me') === 'true';
    if (!mounted || !isDashboard || isDemoMode || rememberMe) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        signOut();
        setSessionExpired(true);
      }, TIMEOUT_MS);
    };

    resetTimeout();

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => {
      window.addEventListener(event, resetTimeout, { passive: true });
    });

    return () => {
      clearTimeout(timeoutId);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimeout);
      });
    };
  }, [mounted, location.pathname, isDemoMode]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load user session on mount
  useEffect(() => {
    if (!mounted) return;

    const loadSession = async () => {
      try {
        // OAuth routes — let the dedicated pages handle auth; just unblock loading.
        if (location.pathname === '/oauth/popup' || location.pathname === '/auth/callback') {
          setLoading(false);
          return;
        }

        const { user: authUser, error } = await authHelpers.getCurrentUser();
        const isAcceptInvite = location.pathname.startsWith('/accept-invite');

        if (authUser && !error) {
          const userData = await buildAuthUser(authUser);
          setUser(userData);
          localStorage.setItem('has_session', 'true');
          identifyUser(authUser.id, { email: authUser.email, role: userData.role, org_name: userData.organizationName });

          // If landing on auth pages while authenticated, redirect to dashboard.
          if (!isAcceptInvite && (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/signup')) {
            navigate('/dashboard', { replace: true });
          }

          if (isAcceptInvite) {
            const { session } = await authHelpers.getSession();
            await claimInviteIfPending(session?.access_token);
          }
        } else {
          localStorage.removeItem('has_session');
          // Redirect away from protected paths if unauthenticated.
          if (location.pathname.startsWith('/dashboard')) {
            navigate('/login', { replace: true });
          }
        }
      } catch (err) {
        console.error('Session load error:', err);
        localStorage.removeItem('has_session');
      }
      setLoading(false);
    };

    loadSession();
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  const enterDemoMode = () => {
    const demoUser: AuthUser = {
      id: 'demo-' + crypto.randomUUID(),
      email: 'demo@zapheit.com',
      organizationName: 'Demo Organization',
      role: 'admin',
    };
    setUser(demoUser);
    setIsDemoMode(true);
    localStorage.setItem('has_session', 'true');
    analytics.demoEntered();
    navigate('/dashboard');
  };

  // Sign up handler
  const signUp = async (email: string, password: string, orgName: string) => {
    try {
      const result = await authHelpers.signUp(email, password, orgName);

      if (result.error) {
        if (result.error.includes('already registered')) {
          return { error: 'This email is already registered. Please sign in instead.' };
        }
        if (result.error.includes('invalid')) {
          return { error: 'Invalid email or password format.' };
        }
        return { error: result.error };
      }

      return { error: null };
    } catch (err: any) {
      console.error('Signup error:', err);
      return { error: 'Unable to create account. Please check your connection and try again.' };
    }
  };

  // Sign in handler
  const signIn = async (email: string, password: string) => {
    try {
      const result = await authHelpers.signIn(email, password);

      if (result.error) {
        if (result.error.includes('Invalid login credentials')) {
          return { error: 'Invalid email or password.' };
        }
        if (result.error.includes('Email not confirmed')) {
          return { error: 'Please verify your email address before signing in. Check your inbox for a confirmation link.' };
        }
        return { error: result.error };
      }

      if (result.user) {
        // Check if MFA verification is required before granting dashboard access
        try {
          const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel !== 'aal2') {
            // User has MFA enrolled — do not set user or navigate; let LoginPage handle OTP
            await claimInviteIfPending(result.session?.access_token);
            return { error: null, requiresMfa: true };
          }
        } catch {
          // If AAL check fails, proceed with normal login
        }

        const userData = await buildAuthUser(result.user);
        setUser(userData);
        localStorage.setItem('has_session', 'true');
        await claimInviteIfPending(result.session?.access_token);
        const isAcceptInvite = location.pathname.startsWith('/accept-invite');
        navigate(isAcceptInvite ? location.pathname : '/dashboard');
      }

      return { error: null };
    } catch (err: any) {
      console.error('Signin error:', err);
      return { error: 'Unable to sign in. Please check your connection and try again.' };
    }
  };

  // Called from LoginPage after successful MFA verification
  const completeMfaLogin = (userData: AuthUser) => {
    setUser(userData);
    localStorage.setItem('has_session', 'true');
    const isAcceptInvite = location.pathname.startsWith('/accept-invite');
    navigate(isAcceptInvite ? location.pathname : '/dashboard');
  };

  // OAuth sign-in handler (Google, Microsoft)
  const signInWithOAuth = async (provider: 'google' | 'azure') => {
    try {
      const result = await authHelpers.signInWithOAuth(provider);
      if (result.error) {
        return { error: result.error };
      }
      // Browser will redirect to OAuth provider — no further action needed here
      return { error: null };
    } catch (err: any) {
      return { error: err.message };
    }
  };

  // Sign out handler
  const signOut = async () => {
    localStorage.removeItem('has_session');
    localStorage.removeItem('synthetic_hr_user');
    localStorage.removeItem(STORAGE_KEYS.AGENTS);
    localStorage.removeItem(STORAGE_KEYS.INCIDENTS);
    localStorage.removeItem(STORAGE_KEYS.COST_DATA);
    localStorage.removeItem(STORAGE_KEYS.API_KEYS);

    try {
      await authHelpers.signOut();
    } catch (err) {
      console.error('Signout warning:', err);
    }

    setUser(null);
    setIsDemoMode(false);
    resetAnalytics();
    navigate('/login');
  };

  if (!mounted || loading) {
    return <LoadingSpinner />;
  }

  return (
    <AppContext.Provider value={{ user, loading: false, signUp, signIn, signInWithOAuth, signOut, completeMfaLogin }}>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<LandingPage onSignUp={() => navigate('/signup')} onLogin={() => navigate('/login')} onDemo={enterDemoMode} />} />
          <Route path="/signup" element={<SignUpPage onSignIn={() => navigate('/login')} onBack={() => navigate('/')} />} />
          <Route path="/login" element={<LoginPage onSignUp={() => navigate('/signup')} onBack={() => navigate('/')} />} />
          <Route path="/accept-invite/*" element={
            <AcceptInvitePage
              onLogin={() => navigate('/login')}
              onSignUp={() => navigate('/signup')}
              onBack={() => navigate('/')}
              onDone={() => navigate('/dashboard')}
            />
          } />
          <Route path="/oauth/popup" element={<OAuthCallbackPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/share/:token" element={<SharePage />} />
          <Route path="/chat/:token" element={<PublicChatPage />} />
          <Route path="/interview/:templateId" element={<InterviewRoomPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/billing/cashfree/return" element={<CashfreeReturnPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/dashboard/*" element={
            user
              ? (
                <MfaEnrollmentGate
                  required={!isDemoMode && ADMIN_MFA_ROLES.has(user.role)}
                  title="Set Up Admin 2FA"
                  message="Admin access requires two-factor authentication. Scan the QR code with your authenticator app to continue into the dashboard."
                >
                  <Dashboard isDemoMode={isDemoMode} onSignUp={isDemoMode ? () => navigate('/signup') : undefined} />
                </MfaEnrollmentGate>
              )
              : <Navigate to="/login" replace />
          } />
          <Route path="*" element={<NotFoundPage onHome={() => navigate('/')} />} />
        </Routes>
      </Suspense>

      {sessionExpired && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-2xl">⏳</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Session Expired</h2>
            <p className="text-slate-400 mb-8">
              For your security, you have been automatically logged out due to 15 minutes of inactivity.
            </p>
            <button
              onClick={() => {
                setSessionExpired(false);
                navigate('/login');
              }}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-cyan-500 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)]"
            >
              Log In Again
            </button>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}

export default App;

function NotFoundPage({ onHome }: { onHome: () => void }) {
  return (
    <div className="min-h-screen bg-[#050d1a] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-7xl font-bold text-white/10 font-mono">404</p>
        <h1 className="mt-4 text-xl font-bold text-white">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">The page you're looking for doesn't exist or has been moved.</p>
        <button
          onClick={onHome}
          className="mt-8 px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white text-sm font-semibold hover:from-blue-600 hover:to-cyan-500 transition-all"
        >
          Go to home
        </button>
      </div>
    </div>
  );
}
