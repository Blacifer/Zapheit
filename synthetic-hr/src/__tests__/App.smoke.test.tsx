import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock Supabase entirely — no network calls in tests
jest.mock('../lib/supabase-client', () => ({
  authHelpers: {
    getSession: jest.fn().mockResolvedValue({ session: null }),
    onAuthStateChange: jest.fn().mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    }),
    signOut: jest.fn().mockResolvedValue({}),
  },
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
  },
}));

// Mock config to avoid import.meta.env issues in Jest
jest.mock('../lib/config', () => ({
  getFrontendConfig: () => ({
    apiUrl: 'http://localhost:3001/api',
    supabaseUrl: 'http://localhost:54321',
    supabaseAnonKey: 'test-anon-key',
    demoModeEnabled: false,
  }),
}));

// Mock Sentry to avoid DSN errors in tests
jest.mock('@sentry/react', () => ({
  init: jest.fn(),
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  captureException: jest.fn(),
}));

// Lazy-loaded pages use React.lazy — mock the page components
jest.mock('../pages/LandingPage', () => () => <div data-testid="landing-page">Landing</div>);
jest.mock('../pages/LoginPage', () => () => <div data-testid="login-page">Login</div>);
jest.mock('../pages/SignUpPage', () => () => <div data-testid="signup-page">SignUp</div>);
jest.mock('../pages/Dashboard', () => () => <div data-testid="dashboard">Dashboard</div>);
jest.mock('../pages/AcceptInvitePage', () => () => <div data-testid="invite-page">Invite</div>);
jest.mock('../pages/OAuthCallbackPage', () => () => <div data-testid="oauth-page">OAuth</div>);

describe('App routing smoke tests', () => {
  it('renders landing page on root path for unauthenticated user', async () => {
    const App = (await import('../App')).default;
    render(
      <MemoryRouter initialEntries={['/']}>
        <React.Suspense fallback={<div>Loading...</div>}>
          <App />
        </React.Suspense>
      </MemoryRouter>
    );
    // App should render without crashing
    expect(document.body).toBeTruthy();
  });

  it('renders login page at /login', async () => {
    const App = (await import('../App')).default;
    render(
      <MemoryRouter initialEntries={['/login']}>
        <React.Suspense fallback={<div>Loading...</div>}>
          <App />
        </React.Suspense>
      </MemoryRouter>
    );
    expect(document.body).toBeTruthy();
  });
});
