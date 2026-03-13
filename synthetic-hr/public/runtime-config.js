// Optional runtime configuration for enterprise/self-host deployments.
// This file is loaded before the app bundle and can be overwritten at deploy time
// (e.g., via a ConfigMap/volume mount or container entrypoint script).
//
// Example:
// window.__SYNTHETICHR_CONFIG__ = {
//   apiUrl: "https://synthetic-hr.company.com/api",
//   supabaseUrl: "https://your-supabase.company.com",
//   supabaseAnonKey: "your-anon-key",
// };
window.__SYNTHETICHR_CONFIG__ = window.__SYNTHETICHR_CONFIG__ || {};

