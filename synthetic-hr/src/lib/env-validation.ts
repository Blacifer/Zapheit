import { getFrontendConfig } from './config';

export function validateFrontendEnvironment(): void {
  const config = getFrontendConfig();

  const missingAll: string[] = [];
  if (!config.supabaseUrl) missingAll.push('VITE_SUPABASE_URL (or public/runtime-config.js: supabaseUrl)');
  if (!config.supabaseAnonKey) missingAll.push('VITE_SUPABASE_ANON_KEY (or public/runtime-config.js: supabaseAnonKey)');

  if (missingAll.length > 0) {
    throw new Error(`Frontend environment validation failed. Missing: ${missingAll.join(', ')}`);
  }

  if (import.meta.env.PROD) {
    if (!config.apiUrl) {
      throw new Error('Frontend production environment validation failed. Missing: VITE_API_URL (or public/runtime-config.js: apiUrl)');
    }
  }
}
