import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { initSentry } from './lib/sentry'
import { validateFrontendEnvironment } from './lib/env-validation'
import { initAnalytics } from './lib/analytics'
import './i18n'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ToastProvider } from './components/Toast.tsx'
import './index.css'
import App from './App.tsx'

// Initialize Sentry for error tracking
initSentry();
validateFrontendEnvironment();
initAnalytics();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,       // 1 min before background refetch
      gcTime: 5 * 60_000,      // 5 min before cache eviction
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
