import React from 'react';
import * as Sentry from '@sentry/react';
import { getFrontendConfig } from '../lib/config';

// Error reporting service URL - in production, this would be your error tracking service
const ERROR_REPORTING_URL = getFrontendConfig().errorReportingUrl || null;

// Sanitize error for display - never expose internal details to users
const sanitizeErrorForDisplay = (error: any): string => {
  if (typeof error === 'string') {
    // Return user-friendly messages only
    if (error.includes('network') || error.includes('fetch')) {
      return 'Unable to connect to the server. Please check your internet connection.';
    }
    if (error.includes('permission') || error.includes('unauthorized')) {
      return 'You do not have permission to perform this action.';
    }
    if (error.includes('validation') || error.includes('invalid')) {
      return 'The information provided is invalid. Please check your input.';
    }
    return 'An unexpected error occurred. Please try again.';
  }

  if (error instanceof Error) {
    // In development, you might want to see the actual error
    if (import.meta.env.DEV) {
      return error.message;
    }
    // In production, return generic message
    return 'An unexpected error occurred. Our team has been notified.';
  }

  return 'An unexpected error occurred. Please try again.';
};

// Report error to error tracking service (production)
const reportError = async (error: any, errorInfo: React.ErrorInfo) => {
  // Always report to Sentry if configured
  Sentry.captureException(error, {
    contexts: {
      react: {
        componentStack: errorInfo.componentStack,
      },
    },
  });

  // Also report to custom endpoint if configured
  if (!ERROR_REPORTING_URL) {
    return;
  }

  try {
    const errorData = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    await fetch(ERROR_REPORTING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errorData),
    });
  } catch (reportingError) {
    console.error('Failed to report error:', reportingError);
  }
};

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; variant?: 'global' | 'local'; fallbackMessage?: string },
  { hasError: boolean; error: any; errorId?: string }
> {
  constructor(props: { children: React.ReactNode; variant?: 'global' | 'local'; fallbackMessage?: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    // Generate a unique error ID for tracking
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return { hasError: true, error, errorId };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Report to error tracking services
    reportError(error, errorInfo);
    // Still log to console in development
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const errorMessage = sanitizeErrorForDisplay(this.state.error);
      const isLocal = this.props.variant === 'local';

      if (isLocal) {
        return (
          <div className="flex flex-col items-center justify-center p-8 bg-slate-800/50 border border-slate-700/50 rounded-xl max-w-lg mx-auto mt-12 text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Interface Error</h2>
            <p className="text-sm text-slate-400 mb-6">
              {this.props.fallbackMessage || errorMessage || "This specific module failed to load. The rest of the dashboard is still operational."}
            </p>
            {this.state.errorId && (
              <p className="text-xs text-slate-500 mb-6 font-mono">ID: {this.state.errorId}</p>
            )}
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors border border-slate-600"
            >
              Try Again
            </button>
          </div>
        );
      }

      // Default Global Error State
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>

            <p className="text-slate-400 mb-6">{errorMessage}</p>

            {this.state.errorId && (
              <p className="text-xs text-slate-500 mb-6">
                Error ID: {this.state.errorId}
              </p>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white font-medium rounded-lg transition-colors"
              >
                Reload Page
              </button>
              <button
                onClick={this.handleGoHome}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
