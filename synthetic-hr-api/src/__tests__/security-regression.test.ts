import fs from 'fs';
import path from 'path';

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

const ALLOW_SERVICE_REST_FILES = new Set([
  // Auth provisioning is a controlled server-side bootstrap flow.
  path.join(ROUTES_DIR, 'auth.ts'),
  // Legacy connectors are feature-flagged off in production; keep service-role usage contained here.
  path.join(ROUTES_DIR, 'connectors.ts'),
  // Public OAuth callbacks require server-side writes without a user session.
  path.join(ROUTES_DIR, 'integrations.ts'),
  // Gateway is API-key based and is not user-JWT scoped.
  path.join(ROUTES_DIR, 'gateway.ts'),
  // Runtime enrollment + runtime-auth endpoints are server-to-server (no user session).
  path.join(ROUTES_DIR, 'runtimes.ts'),
  // Public invite endpoints still require server-side writes (expiry/reject/claim).
  path.join(ROUTES_DIR, 'invites.ts'),
  // Work-items event relay: server-side fan-out, no user JWT available mid-stream.
  path.join(ROUTES_DIR, 'events.ts'),
  // Marketplace writes integrations/credentials on behalf of the org during OAuth.
  path.join(ROUTES_DIR, 'marketplace.ts'),
  // Slack OAuth callback arrives without a user session (server-to-server flow).
  path.join(ROUTES_DIR, 'slack.ts'),
  // Slack interactive component callbacks (button clicks) arrive from Slack without a user JWT;
  // HMAC-verified at the transport layer — service-role required to update approval_requests.
  path.join(ROUTES_DIR, 'slack-actions.ts'),
  // Approvals: service-role used only for action_policies lookup (routing rule enforcement — server-side policy, not user data).
  path.join(ROUTES_DIR, 'approvals.ts'),
  // Playbooks: service-role used only for public API endpoint (B5, API-key auth) and public share endpoint (B6, no user JWT).
  path.join(ROUTES_DIR, 'playbooks.ts'),
  // Compliance: PDF generation and bulk data export require cross-table org reads; no per-request user JWT in the PDF render path.
  path.join(ROUTES_DIR, 'compliance.ts'),
  // Employee portal: public token-gated endpoints — no user JWT; service-role required to look up agent_portal_links and ai_agents.
  path.join(ROUTES_DIR, 'portal.ts'),
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Never scan test fixtures; the point is to prevent production route modules
      // from accidentally reaching for service-role helpers.
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!full.endsWith('.ts')) continue;
    if (full.endsWith('.test.ts') || full.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('Security regression: service-role access containment', () => {
  it('does not use service-role PostgREST helpers in normal /api routes', () => {
    const files = walk(ROUTES_DIR);

    const violations: Array<{ file: string; reason: string }> = [];

    for (const file of files) {
      const contents = fs.readFileSync(file, 'utf8');

      const usesServiceRest =
        contents.includes('supabaseRestAsService') ||
        contents.includes('supabaseRest(') || // deprecated alias in lib/supabase-rest.ts
        contents.includes('SUPABASE_SERVICE_KEY') ||
        contents.includes('supabaseAdmin');

      if (usesServiceRest && !ALLOW_SERVICE_REST_FILES.has(file)) {
        violations.push({
          file,
          reason: 'References service-role PostgREST access (supabaseRestAsService/supabaseRest/SUPABASE_SERVICE_KEY)',
        });
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `${v.file}: ${v.reason}`)
        .join('\n');
      throw new Error(`Service-role access leakage detected:\n${message}`);
    }
  });
});
