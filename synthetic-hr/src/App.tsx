import { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import { AppContext, type AuthUser } from './context/AppContext';
import { authHelpers } from './lib/supabase-client';
import { getFrontendConfig } from './lib/config';
import { STORAGE_KEYS } from './lib/utils';

// Lazy load all page components
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SignUpPage = lazy(() => import('./pages/SignUpPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'));

// Loading spinner component
function LoadingSpinner() {
  return (
    <div className="min-h-screen app-bg flex items-center justify-center text-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-2 border-white/20 border-t-blue-400"></div>
    </div>
  );
}

const TIMEOUT_MS = 15 * 60 * 1000;

function App() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'landing' | 'signup' | 'login' | 'dashboard' | 'accept-invite' | 'oauth-popup'>('landing');
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

  useEffect(() => {
    if (!mounted || view !== 'dashboard' || isDemoMode) return;

    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        // Session expired
        signOut();
        setSessionExpired(true);
      }, TIMEOUT_MS);
    };

    // Initialize timeout
    resetTimeout();

    // Listen for activity
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
  }, [mounted, view, isDemoMode]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load user session on mount
  useEffect(() => {
    if (!mounted) return;

    const loadSession = async () => {
      try {
        // Check if user has an active session (Supabase handles auth tokens)
        const { user: authUser, error } = await authHelpers.getCurrentUser();
        const isAcceptInvite = typeof window !== 'undefined' && window.location.pathname.startsWith('/accept-invite');
        const isOAuthPopup = typeof window !== 'undefined' && window.location.pathname === '/oauth/popup';

        // OAuth popup callback page — render immediately regardless of auth state.
        if (isOAuthPopup) {
          setView('oauth-popup');
          setLoading(false);
          return;
        }

        if (authUser && !error) {
          const userData: AuthUser = {
            id: authUser.id,
            email: authUser.email || '',
            organizationName: authUser.user_metadata?.organization_name || 'My Organization',
          };
          setUser(userData);
          if (isAcceptInvite) {
            setView('accept-invite');
          } else {
            setView('dashboard');
          }
          // Don't store user data in localStorage - fetch from API on app load
          localStorage.setItem('has_session', 'true');

          if (isAcceptInvite) {
            const { session } = await authHelpers.getSession();
            await claimInviteIfPending(session?.access_token);
          }
        } else {
          localStorage.removeItem('has_session');
          if (isAcceptInvite) setView('accept-invite');
        }
      } catch (err) {
        console.error('Session load error:', err);
        localStorage.removeItem('has_session');
      }
      setLoading(false);
    };

    loadSession();
  }, [mounted, claimInviteIfPending]);

  const enterDemoMode = () => {
    if (!demoEnabled) return;
    const demoUser: AuthUser = {
      id: 'demo-' + crypto.randomUUID(),
      email: 'demo@synthetic-hr.com',
      organizationName: 'Demo Organization',
    };
    setUser(demoUser);
    setView('dashboard');
    setIsDemoMode(true);
    // Only store session marker, not user data
    localStorage.setItem('has_session', 'true');
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
        const userData: AuthUser = {
          id: result.user.id,
          email: result.user.email || '',
          organizationName: result.user.user_metadata?.organization_name || 'My Organization',
        };
        setUser(userData);
        const isAcceptInvite = typeof window !== 'undefined' && window.location.pathname.startsWith('/accept-invite');
        setView(isAcceptInvite ? 'accept-invite' : 'dashboard');
        // Only store session marker, not user data
        localStorage.setItem('has_session', 'true');
        await claimInviteIfPending(result.session?.access_token);
      }

      return { error: null };
    } catch (err: any) {
      console.error('Signin error:', err);
      return { error: 'Unable to sign in. Please check your connection and try again.' };
    }
  };

  // Sign out handler
  const signOut = async () => {
    // Clear all app data from localStorage
    localStorage.removeItem('has_session');
    localStorage.removeItem('synthetic_hr_user'); // Clean up old format if present
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
    setIsDemoMode(false);
  };

  // Prevent hydration mismatch
  if (!mounted || loading) {
    return <LoadingSpinner />;
  }

  return (
    <AppContext.Provider value={{ user, loading: false, signUp, signIn, signOut }}>
      <Suspense fallback={<LoadingSpinner />}>
        {view === 'landing' && (
          <LandingPage
            onSignUp={() => setView('signup')}
            onLogin={() => setView('login')}
            onDemo={demoEnabled ? enterDemoMode : undefined}
          />
        )}
        {view === 'signup' && (
          <SignUpPage onSignIn={() => setView('login')} onBack={() => setView('landing')} />
        )}
        {view === 'login' && (
          <LoginPage onSignUp={() => setView('signup')} onBack={() => setView('landing')} />
        )}
        {view === 'accept-invite' && (
          <AcceptInvitePage
            onLogin={() => setView('login')}
            onSignUp={() => setView('signup')}
            onBack={() => setView('landing')}
            onDone={() => setView('dashboard')}
          />
        )}
        {view === 'oauth-popup' && <OAuthCallbackPage />}
        {view === 'dashboard' && (
          <Dashboard
            isDemoMode={isDemoMode}
            onSignUp={isDemoMode ? () => setView('signup') : undefined}
          />
        )}
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
                setView('login');
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
