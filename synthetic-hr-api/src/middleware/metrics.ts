/**
 * Metrics middleware for tracking API performance and reliability
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

// In-memory metrics store (production would use Redis or TimescaleDB)
interface RequestMetric {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
  userId?: string;
  organizationId?: string;
}

// Ring buffer to store last 10000 requests
const MAX_METRICS = 10000;
const requestMetrics: RequestMetric[] = [];
let authFailures = 0;
let authSuccesses = 0;

/**
 * Middleware to track request latency and status codes
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // Capture the original end function
  const originalEnd = res.end;
  
  // Override res.end to capture metrics
  res.end = function(this: Response, ...args: any[]): any {
    const durationMs = Date.now() - startTime;
    
    // Store metric
    const metric: RequestMetric = {
      method: req.method,
      path: sanitizePath(req.path),
      statusCode: res.statusCode,
      durationMs,
      timestamp: Date.now(),
      userId: req.user?.id,
      organizationId: req.user?.organization_id,
    };
    
    // Add to ring buffer
    if (requestMetrics.length >= MAX_METRICS) {
      requestMetrics.shift(); // Remove oldest
    }
    requestMetrics.push(metric);
    
    // Track auth failures
    if (req.path.includes('/auth/') || req.path === '/api/health') {
      if (res.statusCode === 401 || res.statusCode === 403) {
        authFailures++;
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        authSuccesses++;
      }
    }
    
    // Log slow requests
    if (durationMs > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        path: req.path,
        durationMs,
        statusCode: res.statusCode,
        requestId: req.requestId,
      });
    }
    
    // Call the original end
    return originalEnd.apply(this, args as any);
  };
  
  next();
}

/**
 * Sanitize path to remove IDs for grouping
 */
function sanitizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/[0-9a-f]{24}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * Get current metrics snapshot
 */
export function getMetricsSnapshot() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  const fiveMinutesAgo = now - 300000;
  
  // Filter recent metrics
  const recentMetrics = requestMetrics.filter(m => m.timestamp >= fiveMinutesAgo);
  const lastMinuteMetrics = requestMetrics.filter(m => m.timestamp >= oneMinuteAgo);
  
  // Calculate latency percentiles
  const sortedLatencies = [...recentMetrics].sort((a, b) => a.durationMs - b.durationMs);
  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);
  const p99 = percentile(sortedLatencies, 99);
  
  // Error rate
  const totalRequests = recentMetrics.length;
  const errorRequests = recentMetrics.filter(m => m.statusCode >= 500).length;
  const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
  
  // Auth metrics
  const totalAuth = authFailures + authSuccesses;
  const authFailureRate = totalAuth > 0 ? (authFailures / totalAuth) * 100 : 0;
  
  // Requests per minute
  const rpm = lastMinuteMetrics.length;
  
  // Group by endpoint
  const endpointStats = groupByEndpoint(recentMetrics);
  
  // Status code distribution
  const statusDistribution = recentMetrics.reduce((acc, m) => {
    const bucket = Math.floor(m.statusCode / 100) * 100;
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  
  return {
    latency: {
      p50: Math.round(p50),
      p95: Math.round(p95),
      p99: Math.round(p99),
      avg: Math.round(average(sortedLatencies)),
    },
    throughput: {
      rpm,
      total5min: totalRequests,
    },
    errors: {
      count: errorRequests,
      rate: Math.round(errorRate * 100) / 100,
    },
    auth: {
      failures: authFailures,
      successes: authSuccesses,
      failureRate: Math.round(authFailureRate * 100) / 100,
    },
    statusDistribution,
    topEndpoints: endpointStats.slice(0, 10),
    dataRetention: {
      storedRequests: requestMetrics.length,
      maxRequests: MAX_METRICS,
      oldestTimestamp: requestMetrics.length > 0 ? requestMetrics[0].timestamp : now,
    },
  };
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedMetrics: RequestMetric[], p: number): number {
  if (sortedMetrics.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedMetrics.length) - 1;
  return sortedMetrics[Math.max(0, index)]?.durationMs || 0;
}

/**
 * Calculate average latency
 */
function average(metrics: RequestMetric[]): number {
  if (metrics.length === 0) return 0;
  const sum = metrics.reduce((acc, m) => acc + m.durationMs, 0);
  return sum / metrics.length;
}

/**
 * Group metrics by endpoint
 */
function groupByEndpoint(metrics: RequestMetric[]) {
  const grouped = metrics.reduce((acc, m) => {
    const key = `${m.method} ${m.path}`;
    if (!acc[key]) {
      acc[key] = {
        method: m.method,
        path: m.path,
        count: 0,
        totalDuration: 0,
        errors: 0,
      };
    }
    acc[key].count++;
    acc[key].totalDuration += m.durationMs;
    if (m.statusCode >= 500) {
      acc[key].errors++;
    }
    return acc;
  }, {} as Record<string, any>);
  
  return Object.values(grouped)
    .map((stat: any) => ({
      ...stat,
      avgDuration: Math.round(stat.totalDuration / stat.count),
      errorRate: Math.round((stat.errors / stat.count) * 10000) / 100,
    }))
    .sort((a: any, b: any) => b.count - a.count);
}

/**
 * Reset auth metrics (useful for testing)
 */
export function resetAuthMetrics() {
  authFailures = 0;
  authSuccesses = 0;
}

/**
 * Clear all metrics (useful for testing)
 */
export function clearMetrics() {
  requestMetrics.length = 0;
  resetAuthMetrics();
}
