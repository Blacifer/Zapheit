// Optional runtime configuration for enterprise/self-host deployments.
// This file is loaded before the app bundle and can be overwritten at deploy time
// (e.g., via a ConfigMap/volume mount or container entrypoint script).
//
// Example:
// window.__ZAPHEIT_CONFIG__ = {
//   apiUrl: "https://zapheit.company.com/api",
//   supabaseUrl: "https://your-supabase.company.com",
//   supabaseAnonKey: "your-anon-key",
// };
window.__ZAPHEIT_CONFIG__ = window.__ZAPHEIT_CONFIG__ || {};

