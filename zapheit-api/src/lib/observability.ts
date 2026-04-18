import { trace, metrics as metricsApi, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { Request, Response } from 'express';
import { logger } from './logger';

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK.
 * Starts tracing + metrics collection. No-ops when OTEL_ENABLED=false.
 * When OTEL_EXPORTER_OTLP_ENDPOINT is set, exports to that collector;
 * otherwise instruments in-process only (useful for local spans + tracingMiddleware).
 */
export const initializeObservability = async (): Promise<void> => {
  if (!OTEL_ENABLED) {
    logger.info('OpenTelemetry observability disabled');
    return;
  }

  try {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const resource = resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || 'zapheit-api',
      'service.version': process.env.npm_package_version || '1.0.0',
      'deployment.environment': process.env.NODE_ENV || 'development',
    });

    sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({
        ...(endpoint ? { url: `${endpoint}/v1/traces` } : {}),
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          ...(endpoint ? { url: `${endpoint}/v1/metrics` } : {}),
        }),
        exportIntervalMillis: 60_000,
      }),
      instrumentations: [
        new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/health' }),
        new ExpressInstrumentation(),
      ],
    });

    sdk.start();
    logger.info('OpenTelemetry SDK started', { endpoint: endpoint || 'in-process only' });
  } catch (error: any) {
    logger.error('Failed to initialize OpenTelemetry', {
      error: error?.message || 'Unknown error',
    });
    // Non-blocking: continue without observability
  }
};

/**
 * Shutdown observability SDK gracefully.
 * Called during SIGTERM / graceful shutdown.
 */
export const shutdownObservability = async (): Promise<void> => {
  try {
    if (sdk) {
      await sdk.shutdown();
      sdk = null;
    }
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
  return trace.getTracer('zapheit-api', '1.0.0');
};

/**
 * Get the global meter for metrics
 */
export const getMeter = () => {
  return metricsApi.getMeter('zapheit-api', '1.0.0');
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
