# OpenTelemetry Setup Guide

## CRITICAL BLOCKER #5: Connect Observability to OTLP

The observability framework is integrated but traces are only exported to console. This guide shows how to connect to production collectors.

---

## Quick Start (5 minutes)

### Step 1: Configure Environment Variables

**For Local Development (Jaeger):**

Add to `.env.local`:
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_EXPORTER_OTLP_INSECURE=true
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

**For Production (Choose One):**

### Option A: Datadog
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.datadoghq.com
OTEL_EXPORTER_OTLP_INSECURE=false
OTEL_EXPORTER_OTLP_AUTH_TOKEN=<your-datadog-api-key>
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

### Option B: New Relic
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.nr-data.net:4317
OTEL_EXPORTER_OTLP_INSECURE=false
OTEL_EXPORTER_OTLP_AUTH_TOKEN=<your-new-relic-license-key>
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

### Option C: Self-Hosted Jaeger/Tempo
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://jaeger.internal:4317
OTEL_EXPORTER_OTLP_INSECURE=false
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

---

## Setup for Each Platform

### Jaeger (Local Development)

**Prerequisites:**
```bash
# Run Jaeger with Docker
docker run -d \
  --name jaeger \
  -p 6831:6831/udp \
  -p 16686:16686 \
  jaegertracing/all-in-one:latest

# Access UI at http://localhost:16686
```

**Configuration:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_EXPORTER_OTLP_INSECURE=true
```

**Verify:**
1. Start backend: `npm run dev`
2. Make a request: `curl http://localhost:3001/health`
3. Check Jaeger UI: http://localhost:16686
4. Look for "synthetic-hr-api" service
5. View traces with full span hierarchy

---

### Datadog (Production)

**Prerequisites:**
1. Sign up for Datadog: https://app.datadoghq.com
2. Create API key: Settings > Organization Settings > API Keys
3. Get Datadog Site (us3.datadoghq.com or eu1.datadoghq.com)

**Configuration:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.datadoghq.com
OTEL_EXPORTER_OTLP_AUTH_TOKEN=<your-api-key>
```

**Verify:**
1. Go to Datadog APM: https://app.datadoghq.com/apm
2. Look for "synthetic-hr-api" service
3. View traces and dependency maps

---

### New Relic (Production Alternative)

**Prerequisites:**
1. Sign up for New Relic: https://newrelic.com
2. Get License Key: Settings > API Keys > INGEST - LICENSE
3. Note your Data Center (US or EU)

**Configuration:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.nr-data.net:4317  # or eu01.nr-data.net
OTEL_EXPORTER_OTLP_AUTH_TOKEN=<your-license-key>
```

**Verify:**
1. Go to New Relic APM: https://one.newrelic.com/apm
2. Look for "synthetic-hr-api" service
3. View traces and service maps

---

### Grafana Stack (Self-Hosted)

**Prerequisites:**
Install with Docker Compose:
```yaml
version: '3.8'
services:
  tempo:
    image: grafana/tempo:latest
    ports:
      - "4317:4317"
    environment:
      TEMPO_TRACE_STORAGE: local
  
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
  
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    depends_on:
      - tempo
      - prometheus
```

**Configuration:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4317
OTEL_EXPORTER_OTLP_INSECURE=true
```

**Verify:**
1. Go to Grafana: http://localhost:3000
2. Add Tempo data source pointing to http://tempo:3100
3. Query traces for "synthetic-hr-api"

---

## Verify Connection

### Check Connectivity:
```bash
# Test if collector is reachable
curl -v ${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces 2>&1 | grep "200\|404"
```

### Monitor in Backend Logs:
```bash
npm run dev 2>&1 | grep -i "otel\|tracing\|exporter"
```

### Generate Test Data:
```bash
# Make a request to trigger tracing
curl http://localhost:3001/health

# Check in your observability platform for "synthetic-hr-api" service
```

### Common Errors & Solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `ECONNREFUSED` | Collector not running | Start collector or verify endpoint |
| `403 Unauthorized` | Invalid auth token | Check OTEL_EXPORTER_OTLP_AUTH_TOKEN |
| `No traces in UI` | Exporter misconfigured | Check OTEL_TRACES_EXPORTER=otlp |
| `Timeout` | Network/firewall issue | Verify firewall rules and endpoint |

---

## Environment Files

### .env.local (Development)
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_EXPORTER_OTLP_INSECURE=true
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

### .env.staging
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://jaeger.staging.internal:4317
OTEL_EXPORTER_OTLP_INSECURE=false
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

### .env.production
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.datadoghq.com
OTEL_EXPORTER_OTLP_AUTH_TOKEN=[DATADOG_API_KEY]
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

---

## What Gets Traced

✅ **HTTP Requests** - All /api, /admin, /v1 endpoints
✅ **Database Queries** - All Supabase requests
✅ **Error Tracking** - Exceptions with full context
✅ **API Key Usage** - Token validation timing
✅ **Rate Limiting** - Throttling events
✅ **Gateway Operations** - Completions, embeddings, chat
✅ **Idempotency** - Cache hits/misses
✅ **Custom Operations** - Any span wrapped with recordSpan()

---

## Viewing Traces

### Jaeger UI
- Service List: http://localhost:16686
- Find Service: "synthetic-hr-api"
- View Trace: Click trace ID to see full span tree
- Filter: Use tags (user.id, api_key.org_id, etc.)

### Datadog APM
- Service Map: Shows all services and dependencies
- Traces: Filter by service, span name, duration, error status
- Flame Graphs: Visualize request flow
- Metrics: View spans/sec, latency p99, error rates

### New Relic
- Service Map: All microservices and external calls
- Distributed Traces: Full request journey
- Golden Signals: Throughput, latency, errors
- Custom Queries: NRQL for advanced analysis

---

## Performance Tuning

### Sampling (Reduce Volume)

In production, sample traces to reduce costs:

```typescript
// Only trace 10% of requests
import { ProbabilitySampler } from '@opentelemetry/sdk-trace-node';

const sampler = new ProbabilitySampler(0.1);  // 10% sampling
```

### Batch Processing

Configured automatically via OTLPTraceExporter:
- Batch size: 512 spans
- Timeout: 5 seconds
- Max queue size: 2048 spans

### Memory Management

- Traces are flushed periodically
- Old traces are garbage collected
- Rate limiting prevents memory spikes

---

## Troubleshooting

### 1. Traces Not Appearing

**Check Configuration:**
```bash
# Verify environment variables
npm run dev 2>&1 | grep OTEL
```

**Check Endpoint:**
```bash
curl -v http://localhost:4317 2>&1 | head -20
```

**Check Firewall:**
```bash
# Test connectivity from container if using Docker
docker exec backend ping jaeger
```

### 2. High Latency

**Check Trace Exporter:**
- Verify network latency to collector: `ping ${OTEL_EXPORTER_OTLP_ENDPOINT}`
- Increase timeout: `OTEL_EXPORTER_OTLP_TIMEOUT=30000`

**Check Sampling:**
- May be collecting too many traces
- Reduce with ProbabilitySampler

### 3. Memory Issues

**Symptoms:** OOM errors, slow requests

**Solution:**
- Reduce batch size
- Increase flush interval
- Enable sampling

**Config:**
```
OTEL_BSP_MAX_QUEUE_SIZE=512
OTEL_BSP_BATCH_SIZE=256
OTEL_BSP_SCHEDULED_DELAY_MILLIS=5000
```

---

## Next Steps

1. ✅ **Choose Platform**: Select Jaeger, Datadog, New Relic, or self-hosted
2. ✅ **Configure Environment**: Add OTEL_* variables to .env files
3. ✅ **Deploy Collector**: Start observability backend
4. ✅ **Restart Backend**: npm run dev
5. ✅ **Generate Traffic**: Make API requests
6. ✅ **Verify Traces**: Check observability UI
7. ✅ **Set Alerts**: Configure alarms for errors and latency

**Timeline:** 30 minutes to full observability connection

---

## References

- OpenTelemetry Docs: https://opentelemetry.io/docs/
- OTLP Protocol: https://opentelemetry.io/docs/reference/protocol/
- Node.js SDK: https://github.com/open-telemetry/opentelemetry-js
- Java/Python/Go SDKs: https://opentelemetry.io/docs/instrumentation/
