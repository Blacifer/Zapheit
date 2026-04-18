import * as Sentry from '@sentry/react';
import { getFrontendConfig } from './config';

export const initSentry = () => {
  const config = getFrontendConfig();
  if (!config.sentryDsn) return;

  const environment = import.meta.env.MODE || 'development';
  const isProduction = environment === 'production';

  Sentry.init({
    dsn: config.sentryDsn,
    environment,
    release: config.appVersion || '1.0.0',
    integrations: [Sentry.browserTracingIntegration()],
    sampleRate: isProduction ? 0.9 : 1.0,
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    attachStacktrace: true,
    ignoreErrors: [
      'top.GLOBALS',
      'originalCreateNotification',
      'canvas.contentDocument',
      'MyApp_RemoveAllHighlights',
      'QuotaExceededError',
    ],
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /google-analytics/i,
    ],
    beforeSend(event) {
      if (event.request?.url?.includes('chrome-extension')) return null;
      return event;
    },
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
