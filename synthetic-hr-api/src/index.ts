import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

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
import runtimesRoutes from './routes/runtimes';
import jobsRoutes from './routes/jobs';
import { initializeObservability, shutdownObservability, tracingMiddleware } from './lib/observability';
import { validateEnvironment } from './lib/env-validation';
import { authenticateToken, authErrorHandler, checkOrgAccess } from './middleware/auth';
import { metricsMiddleware, getMetricsSnapshot } from './middleware/metrics';
import { protectMutationsFromCsrf } from './middleware/request-security';
import { setupSwagger } from './lib/swagger';
import { logger } from './lib/logger';
import { monitoring, setupAlertHandlers } from './lib/monitoring';
import { setProviderSyncSchedulerNextRun, syncEnabledProviderCostsForAllOrganizations } from './lib/provider-sync';
import { startIntegrationTokenRefreshScheduler } from './lib/integrations/auto-refresh';

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

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  keyGenerator: (req) => {
    // Rate limit by user ID if authenticated, otherwise by IP
    return (req.user as any)?.id || req.ip || 'unknown';
  },
  message: {
    success: false,
    error: 'Too many write operations. Please slow down and try again.',
  },
});

const authWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
  },
});

// Helper: Get safe CORS origins
function getAllowedOrigins(): string[] {
  if (process.env.NODE_ENV !== 'production') {
    return ['http://localhost:3000', 'http://localhost:5173'];
  }

  const configured = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (configured.includes('*')) {
    throw new Error('CORS wildcard origins not allowed with credentials=true');
  }

  return configured;
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
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'), false);
    }
  },
  credentials: true,
  maxAge: 86400,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
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
    anthropic: Boolean(process.env.RASI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
    openrouter: Boolean(process.env.RASI_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY),
  };

  const response = {
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'Synthetic HR API',
    version: '1.0.0',
    uptime_ms: Math.round(process.uptime() * 1000),
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

// Public auth routes (no authentication required)
app.use('/auth', authRoutes);

// Public API-key gateway routes (OpenAI-compatible)
app.use('/v1', gatewayRoutes);

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
  if (req.path.startsWith('/api/runtimes/jobs/')) {
    return next();
  }

  // Invite claim requires auth, but the user may not be provisioned into an org yet.
  // Allow authenticateToken, skip org isolation for this one endpoint.
  if (req.path === '/api/invites/claim' && req.method === 'POST') {
    return authenticateToken(req, res, next);
  }

  const legacyConnectorsEnabled = process.env.LEGACY_CONNECTORS_ENABLED === 'true';
  if (legacyConnectorsEnabled && req.path.startsWith('/api/connectors/integrations/oauth/callback')) {
    return next();
  }
  if (req.path.startsWith('/api/integrations/oauth/callback')) {
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
app.use('/api', escalationsRoutes);
app.use('/api', invitesRoutes);
if (process.env.LEGACY_CONNECTORS_ENABLED === 'true') {
  app.use('/api/connectors', connectorsRoutes);
}
app.use('/api/integrations', integrationsRoutes);
app.use('/api', webhooksRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/policies', policiesRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/admin', adminRoutes);

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

  const server = app.listen(PORT, () => {
    logger.info('Synthetic HR API server started', {
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
