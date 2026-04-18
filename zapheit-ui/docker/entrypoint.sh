#!/bin/sh
set -eu

TEMPLATE="/etc/zapheit/runtime-config.template.js"
OUT="/usr/share/nginx/html/runtime-config.js"

# If env vars are set, render a runtime-config.js for the SPA to read.
# If they are not set, keep the baked-in runtime-config.js (which defaults to an empty object).
if [ -n "${ZAPHEIT_API_URL:-}" ] || [ -n "${ZAPHEIT_SUPABASE_URL:-}" ] || [ -n "${ZAPHEIT_SUPABASE_ANON_KEY:-}" ] || [ -n "${ZAPHEIT_SENTRY_DSN:-}" ] || [ -n "${ZAPHEIT_APP_VERSION:-}" ] || [ -n "${ZAPHEIT_ERROR_REPORTING_URL:-}" ]; then
  export ZAPHEIT_API_URL ZAPHEIT_SUPABASE_URL ZAPHEIT_SUPABASE_ANON_KEY ZAPHEIT_SENTRY_DSN ZAPHEIT_APP_VERSION ZAPHEIT_ERROR_REPORTING_URL
  envsubst < "$TEMPLATE" > "$OUT"
fi

exec "$@"

