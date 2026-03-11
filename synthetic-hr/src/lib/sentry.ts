/**
 * Sentry Error Tracking Setup
 * Initialize Sentry for production error tracking and performance monitoring
 */

import * as Sentry from '@sentry/react';

export const initSentry = () => {
  // Only initialize if we have a Sentry DSN configured
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  
  if (!sentryDsn) {
    console.warn('Sentry DSN not configured. Error tracking disabled.');
    return;
  }

  const environment = import.meta.env.MODE || 'development';
  const isProduction = environment === 'production';

  Sentry.init({
    // Sentry DSN (Data Source Name)
    dsn: sentryDsn,

    // Environment (development, staging, production)
    environment,

    // Release version (optional but recommended)
    release: import.meta.env.VITE_APP_VERSION || '1.0.0',

    // Sample rate (0 = no errors sent, 1 = all errors sent)
    sampleRate: isProduction ? 0.9 : 1.0,

    // Trace sample rate for performance monitoring
    tracesSampleRate: isProduction ? 0.1 : 1.0,

    // Attach stack traces to all messages
    attachStacktrace: true,

    // Ignore errors from known sources
    ignoreErrors: [
      // Browser extensions
      'top.GLOBALS',
      // See http://blog.errorception.com/2012/03/tale-of-unfindable-js-error.html
      'originalCreateNotification',
      'canvas.contentDocument',
      'MyApp_RemoveAllHighlights',
      // LocalStorage quota exceeded
      'QuotaExceededError',
    ],

    // Before sending errors to Sentry
    beforeSend(event, hint) {
      // Filter out sensitive data if needed
      if (event.request?.url) {
        // Don't capture errors from internal development URLs
        if (event.request.url.includes('chrome-extension')) {
          return null;
        }
      }

      return event;
    },

    // Denylist for performance urls
    denyUrls: [
      // Browser extensions
      /extensions\//i,
      /^chrome:\/\//i,
      // Third party scripts
      /google-analytics/i,
      // LocalStorage errors
      /QuotaExceededError/i,
    ],
  });
};

/**
 * Utility to capture exceptions manually in try-catch blocks
 */
export const captureException = (error: Error, context?: Record<string, any>) => {
  Sentry.captureException(error, {
    contexts: {
      app: context || {},
    },
  });
};

/**
 * Utility to capture custom messages
 */
export const captureMessage = (message: string, level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'error') => {
  Sentry.captureMessage(message, level);
};

/**
 * Set user context for error tracking
 */
export const setSentryUser = (userId: string, email?: string) => {
  Sentry.setUser({
    id: userId,
    email: email || 'unknown',
  });
};

/**
 * Clear user context (on logout)
 */
export const clearSentryUser = () => {
  Sentry.setUser(null);
};

export default Sentry;
