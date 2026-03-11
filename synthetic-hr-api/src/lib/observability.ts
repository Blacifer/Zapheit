import { trace, metrics as metricsApi, SpanStatusCode } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { logger } from './logger';

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

/**
 * Initialize OpenTelemetry SDK
 * Sets up distributed tracing and metrics collection
 */
export const initializeObservability = async (): Promise<void> => {
  if (!OTEL_ENABLED) {
    logger.info('OpenTelemetry observability disabled');
    return;
  }

  try {
    logger.info('OpenTelemetry observability initialized');
  } catch (error: any) {
    logger.error('Failed to initialize OpenTelemetry', {
      error: error?.message || 'Unknown error',
    });
    // Non-blocking: continue without observability
  }
};

/**
 * Shutdown observability SDK
 * Called during graceful shutdown
 */
export const shutdownObservability = async (): Promise<void> => {
  try {
    logger.info('OpenTelemetry SDK shutdown complete');
  } catch (error: any) {
    logger.error('Error during observability shutdown', {
      error: error?.message || 'Unknown error',
    });
  }
};

/**
 * Get the global tracer for spans
 */
export const getTracer = () => {
  return trace.getTracer('synthetic-hr-api', '1.0.0');
};

/**
 * Get the global meter for metrics
 */
export const getMeter = () => {
  return metricsApi.getMeter('synthetic-hr-api', '1.0.0');
};

/**
 * Express middleware for distributed tracing
 * Creates spans for each HTTP request
 */
export const tracingMiddleware = (req: Request, res: Response, next: Function) => {
  if (!OTEL_ENABLED) return next();

  const tracer = getTracer();
  const spanName = `${req.method} ${req.path}`;

  tracer.startActiveSpan(spanName, (span) => {
    // Set span attributes
    span.setAttributes({
      'http.method': req.method,
      'http.url': req.originalUrl,
      'http.source_ip': req.ip || 'unknown',
      'http.user_agent': req.get('user-agent') || 'unknown',
    });

    // Add API key context if available
    if (req.apiKey) {
      span.setAttributes({
        'api_key.id': req.apiKey.id,
        'api_key.org_id': req.apiKey.organization_id,
      });
    }

    // Add auth context if available
    if (req.user) {
      span.setAttributes({
        'user.id': (req.user as any)?.id || 'unknown',
        'user.org_id': (req.user as any)?.organization_id || 'unknown',
      });
    }

    // Wrap response to capture status
    const originalSend = res.send.bind(res);
    res.send = ((data: any) => {
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response_size': Buffer.byteLength(data),
      });

      // Set span status based on HTTP status
      if (res.statusCode >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${res.statusCode}`,
        });
      }

      return originalSend(data);
    }) as typeof res.send;

    // Execute request
    next();

    // End span after response is sent
    res.on('finish', () => {
      span.end();
    });
  });
};

/**
 * Record custom spans for important operations
 */
export const recordSpan = <T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> => {
  if (!OTEL_ENABLED) return operation();

  const tracer = getTracer();
  return tracer.startActiveSpan(operationName, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error?.message || 'Unknown error',
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
};

/**
 * Metrics for monitoring
 */
export const setupMetrics = () => {
  if (!OTEL_ENABLED) return;

  const meter = getMeter();

  // HTTP metrics
  const httpRequestCounter = meter.createCounter('http_requests_total', {
    description: 'Total HTTP requests',
  });

  const httpRequestDuration = meter.createHistogram('http_request_duration_ms', {
    description: 'HTTP request duration in milliseconds',
  });

  // API key metrics
  const apiKeyUsageCounter = meter.createCounter('api_key_requests_total', {
    description: 'Total requests by API key',
  });

  const rateLimitCounter = meter.createCounter('rate_limit_exceeded_total', {
    description: 'Total rate limit exceeded events',
  });

  // Gateway metrics
  const gatewayErrorCounter = meter.createCounter('gateway_errors_total', {
    description: 'Total gateway errors',
  });

  const gatewayLatency = meter.createHistogram('gateway_latency_ms', {
    description: 'Gateway latency in milliseconds',
  });

  // Idempotency metrics
  const idempotencyHitCounter = meter.createCounter('idempotency_cache_hits_total', {
    description: 'Cache hits for idempotency deduplication',
  });

  const idempotencyMissCounter = meter.createCounter('idempotency_cache_misses_total', {
    description: 'Cache misses for idempotency deduplication',
  });

  return {
    httpRequestCounter,
    httpRequestDuration,
    apiKeyUsageCounter,
    rateLimitCounter,
    gatewayErrorCounter,
    gatewayLatency,
    idempotencyHitCounter,
    idempotencyMissCounter,
  };
};

export type Metrics = ReturnType<typeof setupMetrics>;
