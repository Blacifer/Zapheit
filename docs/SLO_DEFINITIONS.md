# Service Level Objectives (SLOs)

## Overview
This document defines the Service Level Objectives (SLOs) for the Rasi Synthetic HR Gateway API. These targets ensure enterprise-grade reliability, performance, and consistency for production deployments.

## SLO Targets

### Availability: 99.9%
**Definition:** Percentage of requests that return a successful response (2xx status codes)

**Target:** ≥99.9% availability
- Equivalent to ~43.2 minutes of unplanned downtime per 30-day month
- Excludes planned maintenance windows

**Measurement:**
```
Availability = (Successful Requests / Total Requests) × 100
```

**How We Meet It:**
- Idempotency cache warm-up on startup (prevents execution gaps)
- DB-backed session persistence for all state
- Graceful error handling with proper HTTP status codes
- Rate limiting to prevent cascade failures

---

### Latency: P95 < 200ms, P99 < 500ms
**Definition:** Request/response time from client perspective

**Targets:**
- P95 (95th percentile): < 200ms
- P99 (99th percentile): < 500ms
- Mean: < 100ms

**Measurement:**
```
P95 = Latency value at 95th percentile of all requests
P99 = Latency value at 99th percentile of all requests
```

**How We Meet It:**
- Efficient database queries with proper indexing
- In-memory caching for frequently accessed data (models, idempotency)
- Optimized API routing and middleware ordering
- Connection pooling to database
- Compression for response payloads

---

### Error Rate: < 0.1%
**Definition:** Percentage of requests that fail (4xx, 5xx status codes)

**Target:** < 0.1% error rate
- Allows only ~1 error per 1,000 requests

**Error Classification:**
- **4xx Errors (Client Errors):** 400, 401, 403, 404, 409, 413, 429
  - Bad requests, auth failures, rate limits, conflicts
  - Expected in normal operation
- **5xx Errors (Server Errors):** 500, 501, 502, 503
  - Unexpected failures, must be minimized

**How We Meet It:**
- Input validation to prevent bad requests
- Proper authentication and authorization
- Idempotency to handle retries without duplication
- Circuit breakers for provider APIs
- Comprehensive error handling and logging

---

### Rate Limiting Accuracy: ≥95%
**Definition:** Accuracy of per-key rate limit enforcement

**Target:** ≥95% accuracy
- Properly reject requests exceeding configured limit
- Return 429 status with Retry-After header
- Track per-key usage accurately

**How We Meet It:**
- Per-key rate limiting in gateway routes
- Sliding 60-second window per API key
- In-memory rate tracking with periodic reset
- Accurate count of requests within window

---

### Idempotency Detection: >99%
**Definition:** Accuracy of duplicate request detection

**Target:** >99% detection accuracy
- Detect duplicate requests via Idempotency-Key header
- Return cached response for duplicates
- Prevent double-processing

**How We Meet It:**
- Fingerprint-based deduplication (SHA-256 hash)
- In-memory cache + DB persistence
- Cache warm-up on startup
- 24-hour TTL for idempotency records

---

## Measurement & Monitoring

### Health Check Endpoint
```
GET /health HTTP/1.1
```

Returns current metrics:
```json
{
  "status": "ok",
  "metrics": {
    "latency_p95_ms": 142,
    "requests_per_minute": 87,
    "error_rate": 0.05
  }
}
```

### Load Testing
Run load tests to validate against SLOs:
```bash
export TEST_API_KEY="sk_..."
cd /Users/patty/Downloads/RasiSyntheticHR
npm run load-test
```

Validates:
- Throughput under concurrent load
- Latency percentiles (P50, P95, P99)
- Error rate under load
- Rate limiting enforcement
- Graceful degradation

### Metrics Collection
- OpenTelemetry integration for distributed tracing
- Prometheus-compatible metrics endpoint
- JSON response time tracking
- Per-endpoint latency monitoring
- Error rate by status code

---

## SLO Service Level Indicator (SLI) Matrix

| Indicator | Target | Measurement | Cadence |
|-----------|--------|-------------|---------|
| Availability | 99.9% | Successful requests / Total | Real-time |
| P95 Latency | <200ms | 95th percentile latency | Per minute |
| P99 Latency | <500ms | 99th percentile latency | Per minute |
| Mean Latency | <100ms | Average latency | Per minute |
| Error Rate | <0.1% | Failed requests / Total | Real-time |
| Rate Limit Accuracy | ≥95% | Correct 429 responses | Per hour |
| Idempotency Accuracy | >99% | Correct deduplication | Per hour |

---

## Alert Thresholds

Critical alerts trigger when:
- Availability drops below 99.8% (2x SLO threshold)
- P95 latency exceeds 400ms (2x target)
- Error rate exceeds 0.2% (2x target)
- Database query latency > 100ms consistently

Warning alerts trigger when:
- Availability drops below 99.85%
- P95 latency exceeds 300ms
- Error rate exceeds 0.15%

---

## Compliance & Reporting

### Monthly SLO Report
- Actual availability percentage
- Latency statistics (mean, P95, P99, max)
- Error rate breakdown by status code
- Incidents and root causes
- Performance trends

### Incident Response
SLO breaches require:
1. **Immediate notification** to on-call team
2. **Root cause analysis** within 4 hours
3. **Incident report** within 24 hours
4. **Remediation plan** within 48 hours

---

## Related Documentation
- [Critical Fixes Summary](./CRITICAL_FIXES_SUMMARY.md)
- [Load Testing Guide](./docs/load-testing.md)
- [Observability Setup](./docs/observability.md)
- [Testing Guide](./docs/testing.md)
