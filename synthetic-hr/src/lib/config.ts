export type SyntheticHrFrontendConfig = {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  sentryDsn?: string;
  appVersion?: string;
  errorReportingUrl?: string | null;
  demoModeEnabled?: boolean;
};

declare global {
  interface Window {
    __SYNTHETICHR_CONFIG__?: Partial<SyntheticHrFrontendConfig>;
  }
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

export function getFrontendConfig(): SyntheticHrFrontendConfig {
  const runtime = (typeof window !== 'undefined' ? window.__SYNTHETICHR_CONFIG__ : undefined) || {};

  const apiUrlFromRuntime = readString(runtime.apiUrl);
  const supabaseUrlFromRuntime = readString(runtime.supabaseUrl);
  const supabaseAnonKeyFromRuntime = readString(runtime.supabaseAnonKey);

  const apiUrlFromBuild = readString(import.meta.env.VITE_API_URL);
  const supabaseUrlFromBuild = readString(import.meta.env.VITE_SUPABASE_URL);
  const supabaseAnonKeyFromBuild = readString(import.meta.env.VITE_SUPABASE_ANON_KEY);

  return {
    apiUrl: apiUrlFromRuntime || apiUrlFromBuild || 'http://localhost:3001/api',
    supabaseUrl: supabaseUrlFromRuntime || supabaseUrlFromBuild || '',
    supabaseAnonKey: supabaseAnonKeyFromRuntime || supabaseAnonKeyFromBuild || '',
    sentryDsn: readString(runtime.sentryDsn) || readString(import.meta.env.VITE_SENTRY_DSN),
    appVersion: readString(runtime.appVersion) || readString(import.meta.env.VITE_APP_VERSION) || '1.0.0',
    errorReportingUrl:
      readString(runtime.errorReportingUrl) || readString(import.meta.env.VITE_ERROR_REPORTING_URL) || null,
    demoModeEnabled:
      readBoolean(runtime.demoModeEnabled) ??
      readBoolean(import.meta.env.VITE_DEMO_MODE_ENABLED) ??
      true,
  };
}

