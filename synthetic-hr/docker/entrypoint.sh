#!/bin/sh
set -eu

TEMPLATE="/etc/synthetic-hr/runtime-config.template.js"
OUT="/usr/share/nginx/html/runtime-config.js"

# If env vars are set, render a runtime-config.js for the SPA to read.
# If they are not set, keep the baked-in runtime-config.js (which defaults to an empty object).
if [ -n "${SYNTHETICHR_API_URL:-}" ] || [ -n "${SYNTHETICHR_SUPABASE_URL:-}" ] || [ -n "${SYNTHETICHR_SUPABASE_ANON_KEY:-}" ] || [ -n "${SYNTHETICHR_SENTRY_DSN:-}" ] || [ -n "${SYNTHETICHR_APP_VERSION:-}" ] || [ -n "${SYNTHETICHR_ERROR_REPORTING_URL:-}" ]; then
  export SYNTHETICHR_API_URL SYNTHETICHR_SUPABASE_URL SYNTHETICHR_SUPABASE_ANON_KEY SYNTHETICHR_SENTRY_DSN SYNTHETICHR_APP_VERSION SYNTHETICHR_ERROR_REPORTING_URL
  envsubst < "$TEMPLATE" > "$OUT"
fi

exec "$@"

