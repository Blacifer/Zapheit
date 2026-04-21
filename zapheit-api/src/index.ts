import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { buildRateLimiter, warmUpHttpRateLimiter } from './lib/http-rate-limiter';

import apiRoutes from './routes/api';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import { supabaseRest } from './lib/supabase-rest';
import costsRoutes from './routes/costs';
import performanceReviewsRoutes from './routes/performance-reviews';
import apiKeysRoutes from './routes/api-keys';
import escalationsRoutes from './routes/escalations';
import invitesRoutes from './routes/invites';
import connectorsRoutes from './routes/connectors';
import integrationsRoutes from './routes/integrations';
import metricsRoutes from './routes/metrics';
import policiesRoutes from './routes/policies';
import complianceRoutes from './routes/compliance';
import webhooksRoutes from './routes/webhooks';
import gatewayRoutes, { initializeIdempotencyCache } from './routes/gateway';
import mcpRoutes from './routes/mcp';
import runtimesRoutes from './routes/runtimes';
import jobsRoutes from './routes/jobs';
import workItemsRoutes from './routes/work-items';
import playbooksRoutes, { handleShareToken, handlePublicPlaybookRun } from './routes/playbooks';
import eventsRoutes from './routes/events';
import slackWebhookRoutes from './routes/slack';
import slackActionsRoutes from './routes/slack-actions';
import whatsappWebhookRoutes from './routes/whatsapp-webhook';
import cashfreeWebhookRoutes from './routes/cashfree-webhook';
import dpdpRoutes from './routes/dpdp';
import marketplaceRoutes from './routes/marketplace';
import actionPoliciesRoutes from './routes/action-policies';
import approvalsRoutes from './routes/approvals';
import rulesRoutes from './routes/rules';
import recruitmentRoutes from './routes/recruitment';
import ctcRoutes from './routes/ctc';
import filingsRoutes from './routes/filings';
import hubsRoutes from './routes/hubs';
import trustRoutes from './routes/trust';
import portalRoutes from './routes/portal';
import tracesRoutes from './routes/traces';
import paymentsRoutes from './routes/payments';
import billingRoutes from './routes/billing';
import { initializeObservability, shutdownObservability, tracingMiddleware } from './lib/observability';
import { validateEnvironment } from './lib/env-validation';
import { authenticateToken, authErrorHandler, checkOrgAccess } from './middleware/auth';
import { validateApiKey } from './middleware/api-key-validation';
import { metricsMiddleware, getMetricsSnapshot } from './middleware/metrics';
import { protectMutationsFromCsrf } from './middleware/request-security';
import { setupSwagger } from './lib/swagger';
import { logger } from './lib/logger';
import { monitoring, setupAlertHandlers } from './lib/monitoring';
import { setProviderSyncSchedulerNextRun, syncEnabledProviderCostsForAllOrganizations } from './lib/provider-sync';
import { startIntegrationTokenRefreshScheduler } from './lib/integrations/auto-refresh';
import { startRetryWorker } from './lib/retry-worker';
import { startRedTeamScheduler } from './lib/redteam-scheduler';
import { startDpdpRetentionWorker } from './lib/dpdp-retention-worker';
import { startFilingScheduler } from './lib/filing-scheduler';
import { startWeeklyEmailScheduler } from './lib/weekly-email-scheduler';
import { runSchemaCompatibilityCheck } from './lib/schema-compat';
import { supabaseRestAsService, eq } from './lib/supabase-rest';

dotenv.config();
validateEnvironment();

// Initialize observability (tracing, metrics) - fail hard in production
(async () => {
  try {
    await initializeObservability();
    logger.info('Observability initialized successfully');
  } catch (error: any) {
    const message = error?.message || 'Unknown error';
    logger.error('Observability initialization failed', { error: message });

    if (process.env.NODE_ENV === 'production' && process.env.OTEL_ENABLED !== 'false') {
      console.error('CRITICAL: Observability required in production but failed to initialize');
      process.exit(1);
    }
  }
})()

const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === 'production') {
  // Required for correct client IP and rate limiting behind a reverse proxy (nginx, ALB, etc).
  app.set('trust proxy', 1);
}

// Extract JWT sub (user ID) from Authorization header without full verification.
// Used only for rate-limit bucketing — actual auth happens inside route middleware.
function jwtSubFromReq(req: express.Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = JSON.parse(
        Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString('utf8'),
      );
      if (payload.sub) return `user:${payload.sub}`;
    } catch {
      // fall through to IP
    }
  }
  return `ip:${req.ip || 'unknown'}`;
}

const apiLimiter = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyPrefix: 'rl:http:api:',
  keyGenerator: jwtSubFromReq,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});

const writeLimiter = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyPrefix: 'rl:http:write:',
  skip: (req: express.Request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    // Runtime-auth routes have their own auth + rate logic; exclude from generic write limiter
    // so periodic heartbeats (1/15s) and scheduler ticks don't exceed the 60/15min bucket.
    if (req.path.startsWith('/api/runtimes') || req.path.startsWith('/api/v1/runtimes')) return true;
    return false;
  },
  keyGenerator: jwtSubFromReq,
  message: {
    success: false,
    error: 'Too many write operations. Please slow down and try again.',
  },
});

const authWriteLimiter = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'rl:http:auth:',
  skip: (req: express.Request) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
  },
});

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return trimmed.replace(/\/+$/, '') || null;
  }
}

const DEFAULT_PRODUCTION_ORIGINS = ['https://www.zapheit.com'] as const;

// Helper: Get safe CORS origins
function getAllowedOrigins(): string[] {
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://localhost:5173'];
  }

  const configured = [
    process.env.FRONTEND_URL || '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL || '',
    process.env.VERCEL_URL || '',
    process.env.CORS_ALLOWED_ORIGINS || '',
  ]
    .join(',')
    .split(',')
    .map((url) => normalizeOrigin(url))
    .filter((url): url is string => Boolean(url));

  if (configured.includes('*')) {
    throw new Error('CORS wildcard origins not allowed with credentials=true');
  }

  const unique = Array.from(new Set(configured));
  if (unique.length > 0) return unique;

  // Safety fallback to prevent accidental production lockout when env vars are missing.
  logger.warn('No production CORS origins configured. Falling back to default production origin(s).', {
    defaults: DEFAULT_PRODUCTION_ORIGINS,
  });
  return [...DEFAULT_PRODUCTION_ORIGINS];
}

// Helper: Check Supabase connectivity
async function checkSupabaseHealth(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    await Promise.race([
      supabaseRest('organizations', new URLSearchParams('select=id&limit=1')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
    ]);
    return { ok: true, latency_ms: Date.now() - start };
  } catch (error: any) {
    return { ok: false, latency_ms: Date.now() - start, error: error.message };
  }
}

// Middleware - Security first with CORS validation
const allowedOrigins = getAllowedOrigins();
logger.info('Configured allowed CORS origins', { allowedOrigins });
const corsOptionsDelegate: cors.CorsOptionsDelegate = (req, callback) => {
  const requestLike = req as typeof req & { url?: string };
  const routePath = (() => {
    const rawUrl = requestLike.url || '';
    try {
      return new URL(rawUrl, 'http://localhost').pathname;
    } catch {
      return rawUrl.split('?')[0] || '';
    }
  })();
  const isPublicWidgetRoute =
    routePath === '/v1/agents/:agentId/chat'
    || /^\/v1\/agents\/[^/]+\/chat$/.test(routePath);

  if (isPublicWidgetRoute) {
    callback(null, {
      origin: true,
      credentials: false,
      maxAge: 86400,
      methods: ['POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['x-request-id'],
      optionsSuccessStatus: 204,
    });
    return;
  }

  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const normalizedOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : null;

  if (!requestOrigin || (normalizedOrigin && allowedOrigins.includes(normalizedOrigin))) {
    callback(null, {
      origin: true,
      credentials: true,
      maxAge: 86400,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['x-request-id'],
      optionsSuccessStatus: 204,
    });
    return;
  }

  logger.warn('Rejected CORS origin', {
    origin: requestOrigin,
    normalizedOrigin,
    allowedOrigins,
    routePath,
  });
  callback(new Error('CORS not allowed'), {
    origin: false,
  });
};
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...allowedOrigins],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.use(compression()); // Enable gzip compression
app.use(cors(corsOptionsDelegate));
app.options('*', cors(corsOptionsDelegate));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// Slack webhook needs the raw body Buffer for HMAC signature verification.
// Must be registered BEFORE express.json() parses the body into an object.
app.use('/events/slack', express.raw({ type: 'application/json', limit: '1mb' }), slackWebhookRoutes);
// Slack interactive components (button clicks). Raw body required for HMAC verification.
app.use('/events/slack-actions', express.raw({ type: 'application/x-www-form-urlencoded', limit: '1mb' }), slackActionsRoutes);
// WhatsApp Cloud API webhook — raw body required for X-Hub-Signature-256 verification.
app.use('/webhooks/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }), whatsappWebhookRoutes);
// Cashfree payment webhooks — raw body required for HMAC signature verification.
app.use('/webhooks/cashfree', express.raw({ type: 'application/json', limit: '1mb' }), cashfreeWebhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Distributed tracing middleware (log request spans)
app.use(tracingMiddleware);

// Attach request ID for traceability in logs and client-facing errors.
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id']?.toString() || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

// Ensure requestId is present in every object JSON response for easier debugging.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && !('requestId' in body)) {
      return originalJson({
        ...body,
        requestId: req.requestId,
      });
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
});

// Metrics tracking middleware (before routes)
app.use(metricsMiddleware);

// Health check with dependency validation (no auth required)
app.get('/health', async (req, res) => {
  const metrics = getMetricsSnapshot();
  const supabaseHealth = await checkSupabaseHealth();
  const allHealthy = supabaseHealth.ok;

  const providerKeys = {
    openai: Boolean(process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
    anthropic: Boolean(
      process.env.RASI_ANTHROPIC_API_KEY ||
      process.env.RASI_ANTHROPIC_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_KEY
    ),
    openrouter: Boolean(process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY),
  };

  const build = {
    sha: process.env.K_REVISION || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    service: process.env.K_SERVICE || null,
  };

  const response = {
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'Zapheit API',
    version: '1.0.0',
    uptime_ms: Math.round(process.uptime() * 1000),
    build,
    dependencies: {
      supabase: supabaseHealth,
      provider_keys: providerKeys,
    },
    metrics: {
      latency_p95_ms: metrics.latency.p95,
      latency_p99_ms: metrics.latency.p99,
      requests_per_minute: metrics.throughput.rpm,
      error_rate: metrics.errors.rate,
    },
  };

  res.status(allHealthy ? 200 : 503).json(response);
});

app.use('/api', apiLimiter);
app.use('/api', writeLimiter);
app.use('/api', protectMutationsFromCsrf);

app.use('/admin', apiLimiter);
app.use('/admin', writeLimiter);
app.use('/admin', protectMutationsFromCsrf);

app.use('/auth', authWriteLimiter);
app.use('/auth', protectMutationsFromCsrf);

// Setup Swagger API documentation
setupSwagger(app);

const connectorsEnabled =
  process.env.CONNECTORS_ENABLED ? process.env.CONNECTORS_ENABLED === 'true' : process.env.LEGACY_CONNECTORS_ENABLED !== 'false';

// Public auth routes (no authentication required)
app.use('/auth', authRoutes);

// Public playbook share links (no auth — token-gated)
app.get('/share/:token', handleShareToken);

// Public employee chat portal (token-gated, no JWT)
app.use('/portal', portalRoutes);

// Public playbook API endpoint (API key auth — no user JWT required)
app.post('/public/playbooks/:slug', validateApiKey, handlePublicPlaybookRun);

// Public API-key gateway routes (OpenAI-compatible)
app.use('/v1', gatewayRoutes);

// Governed MCP (Model Context Protocol) gateway
app.use('/mcp', mcpRoutes);

// Inbound event receiver — third-party systems push agent events here.
// Auth is handled inside the router via validateApiKey (no JWT required).
app.use('/events', eventsRoutes);

// Apply authentication middleware to all /api and /admin routes EXCEPT the OAuth callbacks
app.use((req, res, next) => {
  // Explicit public endpoints under /api (token-based flows).
  if (req.path === '/api/invites/accept' && req.method === 'POST') {
    return next();
  }
  if (/^\/api\/invites\/[^/]+\/reject$/.test(req.path) && req.method === 'POST') {
    return next();
  }
  // Runtime enrollment + runtime-auth endpoints (use runtime JWT, not user auth)
  if (req.path === '/api/runtimes/enroll' && req.method === 'POST') {
    return next();
  }
  if (req.path === '/api/runtimes/heartbeat' && req.method === 'POST') {
    return next();
  }
  if (req.path.startsWith('/api/runtimes/jobs/') || req.path.startsWith('/api/v1/runtimes/jobs/')) {
    return next();
  }
  if (req.path.startsWith('/api/runtimes/schedules/') || req.path.startsWith('/api/v1/runtimes/schedules/')) {
    return next();
  }
  if (req.path.startsWith('/api/runtimes/actions/') || req.path.startsWith('/api/v1/runtimes/actions/')) {
    return next();
  }

  // Invite claim requires auth, but the user may not be provisioned into an org yet.
  // Allow authenticateToken, skip org isolation for this one endpoint.
  if (req.path === '/api/invites/claim' && req.method === 'POST') {
    return authenticateToken(req, res, next);
  }

  if (connectorsEnabled && req.path.startsWith('/api/connectors/integrations/oauth/callback')) {
    return next();
  }
  if (req.path.startsWith('/api/integrations/oauth/callback')) {
    return next();
  }
  if (req.path.startsWith('/api/marketplace/oauth/callback')) {
    return next();
  }
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    // Chain auth -> org isolation in a single middleware so the OAuth callback can remain public.
    return authenticateToken(req, res, (err?: any) => {
      if (err) return next(err);
      return checkOrgAccess(req, res, next);
    });
  }
  next();
});

// Routes
app.use('/api', apiRoutes);
app.use('/api', costsRoutes);
app.use('/api', performanceReviewsRoutes);
app.use('/api', apiKeysRoutes);
app.use('/api/runtimes', runtimesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/work-items', workItemsRoutes);
app.use('/api/playbooks', playbooksRoutes);
app.use('/api/action-policies', actionPoliciesRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/ctc', ctcRoutes);
app.use('/api/hubs', hubsRoutes);
app.use('/api/trust', trustRoutes);
app.use('/api', tracesRoutes);
app.use('/api', escalationsRoutes);
app.use('/api', invitesRoutes);
if (connectorsEnabled) {
  app.use('/api/connectors', connectorsRoutes);
}
app.use('/api/integrations', integrationsRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', billingRoutes);
app.use('/api', webhooksRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/policies', policiesRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/compliance/dpdp', dpdpRoutes);
app.use('/api/compliance/filings', filingsRoutes);
app.use('/admin', adminRoutes);

// /api/v1/ aliases — stable versioned surface, backwards-compatible with /api/
// Existing clients continue to use /api/* without change.
app.use('/api/v1', apiRoutes);
app.use('/api/v1', costsRoutes);
app.use('/api/v1', performanceReviewsRoutes);
app.use('/api/v1', apiKeysRoutes);
app.use('/api/v1/runtimes', runtimesRoutes);
app.use('/api/v1/jobs', jobsRoutes);
app.use('/api/v1/work-items', workItemsRoutes);
app.use('/api/v1/playbooks', playbooksRoutes);
app.use('/api/v1/action-policies', actionPoliciesRoutes);
app.use('/api/v1/approvals', approvalsRoutes);
app.use('/api/v1/rules', rulesRoutes);
app.use('/api/v1/recruitment', recruitmentRoutes);
app.use('/api/v1/ctc', ctcRoutes);
app.use('/api/v1/hubs', hubsRoutes);
app.use('/api/v1/trust', trustRoutes);
app.use('/api/v1', tracesRoutes);
app.use('/api/v1', escalationsRoutes);
app.use('/api/v1', invitesRoutes);
if (connectorsEnabled) {
  app.use('/api/v1/connectors', connectorsRoutes);
}
app.use('/api/v1/integrations', integrationsRoutes);
app.use('/api/v1/marketplace', marketplaceRoutes);
app.use('/api/v1', paymentsRoutes);
app.use('/api/v1', webhooksRoutes);
app.use('/api/v1/metrics', metricsRoutes);
app.use('/api/v1/policies', policiesRoutes);
app.use('/api/v1/compliance', complianceRoutes);
app.use('/api/v1/compliance/dpdp', dpdpRoutes);
app.use('/api/v1/compliance/filings', filingsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    requestId: req.requestId,
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled route error', {
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    requestId: req.requestId,
  });
});

async function startServer() {
  await runSchemaCompatibilityCheck();
  // Warm up Redis connection for distributed HTTP rate limiting (no-op if REDIS_URL is absent)
  await warmUpHttpRateLimiter();

  try {
    // Warm up idempotency cache from database on startup
    // This prevents loss of idempotency deduplication when the process restarts
    await initializeIdempotencyCache();
  } catch (error: any) {
    logger.warn('Idempotency cache warm-up failed, continuing with empty cache', {
      error: error?.message,
    });
  }

  // Initialize advanced monitoring and alert handlers
  setupAlertHandlers();
  logger.info('Advanced monitoring initialized');

  // Keep OAuth integrations healthy by refreshing expiring tokens in the background.
  startIntegrationTokenRefreshScheduler();

  // Drain the connector retry queue (circuit-breaker retries).
  startRetryWorker();
  startRedTeamScheduler();
  startDpdpRetentionWorker();
  startFilingScheduler();
  startWeeklyEmailScheduler();

  // Job reaper: every 2 minutes, return stale claimed jobs to the queue so
  // another runtime can pick them up if the original runtime crashed.
  const JOB_CLAIM_TIMEOUT_MS = 5 * 60 * 1000; // must match runtimes.ts constant
  setInterval(async () => {
    try {
      const staleThreshold = new Date(Date.now() - JOB_CLAIM_TIMEOUT_MS).toISOString();
      const q = new URLSearchParams();
      q.set('status', eq('running'));
      q.set('claimed_at', `lt.${staleThreshold}`);
      q.set('claimed_by', 'not.is.null');
      const stale = (await supabaseRestAsService('agent_jobs', q)) as any[];
      for (const job of stale || []) {
        const pq = new URLSearchParams();
        pq.set('id', eq(job.id));
        pq.set('status', eq('running'));
        await supabaseRestAsService('agent_jobs', pq, {
          method: 'PATCH',
          body: { status: 'queued', claimed_by: null, claimed_at: null, started_at: null },
        }).catch((err: any) => logger.warn('job-reaper: failed to reset job', { jobId: job.id, err: err?.message }));
        logger.info('job-reaper: returned stale job to queue', { jobId: job.id, claimedBy: job.claimed_by });
      }
    } catch (err: any) {
      logger.error('job-reaper sweep failed', { error: err?.message });
    }
  }, 2 * 60 * 1000);

  const server = app.listen(PORT, () => {
    logger.info('Zapheit API server started', {
      port: PORT,
      health: `http://localhost:${PORT}/health`,
      api: `http://localhost:${PORT}/api`,
      docs: `http://localhost:${PORT}/api/docs`,
      env: process.env.NODE_ENV || 'development',
    });
  });

  // Periodic alert evaluation (every 30 seconds)
  const alertInterval = setInterval(() => {
    const metrics = getMetricsSnapshot();
    const resourceMetrics = monitoring.getResourceMetrics();

    // Merge metrics for alert evaluation
    const combinedMetrics = {
      ...metrics,
      cpu_percent: resourceMetrics.cpu.percent,
      memory_percent: resourceMetrics.memory.percent,
    };

    monitoring.evaluateAlerts(combinedMetrics);
  }, 30000);

  const providerSyncEnabled = process.env.PROVIDER_SYNC_SCHEDULER_ENABLED !== 'false';
  const providerSyncIntervalMinutes = Math.max(15, Number(process.env.PROVIDER_SYNC_INTERVAL_MINUTES || 360));
  let providerSyncInterval: NodeJS.Timeout | null = null;

  if (providerSyncEnabled) {
    setProviderSyncSchedulerNextRun(new Date(Date.now() + providerSyncIntervalMinutes * 60 * 1000).toISOString());
    providerSyncInterval = setInterval(() => {
      void syncEnabledProviderCostsForAllOrganizations(30, 'scheduler').catch((error: any) => {
        logger.error('Scheduled provider sync sweep failed', { error: error?.message || 'Unknown error' });
      }).finally(() => {
        setProviderSyncSchedulerNextRun(new Date(Date.now() + providerSyncIntervalMinutes * 60 * 1000).toISOString());
      });
    }, providerSyncIntervalMinutes * 60 * 1000);

    logger.info('Provider sync scheduler initialized', {
      intervalMinutes: providerSyncIntervalMinutes,
    });
  } else {
    logger.info('Provider sync scheduler disabled by environment');
  }

  // Graceful shutdown handler
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    clearInterval(alertInterval);
    if (providerSyncInterval) clearInterval(providerSyncInterval);

    server.close(async () => {
      try {
        await shutdownObservability();
        process.exit(0);
      } catch (error: any) {
        logger.error('Error during shutdown', { error: error?.message });
        process.exit(1);
      }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timeout, force exiting');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Only bind a TCP listener when running the server entrypoint directly.
// This keeps unit tests (and other imports) from trying to listen on a port.
if (require.main === module) {
  void startServer();

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

export default app;
export { startServer };
