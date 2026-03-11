# Advanced Monitoring Configuration Guide

## Overview

RasiSyntheticHR implements a 4-pillar monitoring strategy using the **Golden Signals** framework:

1. **Latency** - How fast requests are processed (p50, p95, p99)
2. **Error Rate** - Percentage of requests that fail
3. **Traffic** - Request volume and throughput
4. **Saturation** - Resource utilization (CPU, memory, connections)

---

## Monitoring Architecture

### Data Collection
- **Real-time Metrics**: Express middleware captures every request
- **Alert Evaluation**: Every 30 seconds, current metrics are checked against rules
- **Storage**: In-memory ring buffer (last 10,000 requests) + PostgreSQL for long-term storage
- **Export**: Can export to Prometheus, Grafana, or any time-series database

### Alert Evaluation Flow

```
Request → Metrics Middleware
         ↓
      Extract: latency, status, endpoint, user
         ↓
    Store in Ring Buffer
         ↓
Every 30 seconds:
  Evaluate against 12 alert rules
  → Calculate percentiles, error rate
  → Check CPU, memory, connections
  → Fire alerts if thresholds exceeded for duration
         ↓
   Alert Handlers (PagerDuty, Slack, etc.)
```

---

## Default Alert Rules

All thresholds are configurable via REST API.

### 1. Latency Alerts

**High Latency (P99)**
- Threshold: > 5,000 ms (5 seconds)
- Duration: 2 minutes
- Severity: **CRITICAL**
- Action: Page on-call immediately
- Why: P99 > 5s means 1% of users experience severe slowness

**Elevated Latency (P95)**
- Threshold: > 2,000 ms (2 seconds)
- Duration: 5 minutes
- Severity: **WARNING**
- Action: Alert ops team
- Why: P95 > 2s indicates systematic performance degradation

### 2. Error Rate Alerts

**High Error Rate**
- Threshold: > 5% errors
- Duration: 2 minutes
- Severity: **CRITICAL**
- Action: Page on-call immediately
- Why: > 5% error rate means > 1 in 20 users hit errors

**Elevated Error Rate**
- Threshold: > 1% errors
- Duration: 5 minutes
- Severity: **WARNING**
- Action: Alert ops team

### 3. Traffic Alerts

**Traffic Spike**
- Threshold: > 2,000 RPM (requests per minute)
- Duration: 1 minute
- Severity: **WARNING**
- Action: Monitor resource saturation
- Why: Sudden spike may exhaust connection pools, hit hitting rate limits

**Traffic Drop**
- Threshold: < 10 RPM
- Duration: 5 minutes
- Severity: **WARNING**
- Action: Check upstream services
- Why: Abnormally low traffic suggests broken API or frontend

### 4. Resource Saturation Alerts

**Critical CPU Usage**
- Threshold: > 95%
- Duration: 1 minute
- Severity: **CRITICAL**
- Action: Page on-call
- Why: CPU maxed = requests backing up

**High CPU Usage**
- Threshold: > 85%
- Duration: 5 minutes
- Severity: **WARNING**
- Action: Alert ops

**High Memory Usage**
- Threshold: > 90%
- Duration: 5 minutes
- Severity: **CRITICAL**
- Action: Page on-call
- Why: Memory exhaustion causes OOM kill or severe slowness

**Elevated Memory Usage**
- Threshold: > 75%
- Duration: 5 minutes
- Severity: **WARNING**
- Action: Alert ops

**Database Connection Exhaustion**
- Threshold: > 80% of max connections
- Duration: 1 minute
- Severity: **CRITICAL**
- Action: Page on-call immediately
- Why: Exhausted connections = new requests will fail

### 5. Authentication Alerts

**High Auth Failure Rate**
- Threshold: > 10% of auth requests fail
- Duration: 2 minutes
- Severity: **WARNING**
- Action: Alert ops, check JWT/API key service

---

## Monitoring API Endpoints

All endpoints require `admin` role (super_admin required for modifications).

### 1. Get Real-Time Metrics

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.rasihr.com/admin/monitoring/metrics
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-03-06T15:30:45Z",
  "metrics": {
    "latency": {
      "p50": 45,
      "p95": 320,
      "p99": 1200,
      "avg": 120
    },
    "throughput": {
      "rpm": 425,
      "total5min": 2125
    },
    "errors": {
      "count": 5,
      "rate": 0.24
    },
    "auth": {
      "failures": 2,
      "successes": 98,
      "failureRate": 2.04
    },
    "statusDistribution": {
      "200": 1840,
      "300": 45,
      "400": 180,
      "500": 5
    },
    "topEndpoints": [
      { "path": "/api/conversations", "count": 480, "avgDuration": 85 },
      { "path": "/api/messages", "count": 420, "avgDuration": 120 }
    ]
  },
  "resources": {
    "memory": {
      "total_mb": 2048,
      "used_mb": 1536,
      "free_mb": 512,
      "percent": 75.0
    },
    "cpu": {
      "percent": 42.5,
      "user_ms": 12450,
      "system_ms": 3240
    },
    "uptime_seconds": 345600
  }
}
```

### 2. Get Active Alerts

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.rasihr.com/admin/monitoring/alerts/active
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-03-06T15:30:45Z",
  "count": 1,
  "alerts": [
    {
      "id": "High CPU Usage-active",
      "name": "High CPU Usage",
      "severity": "warning",
      "metric": "cpu_percent",
      "value": 87.5,
      "threshold": 85,
      "message": "High CPU Usage: 87.5 > 85 (cpu_percent)",
      "timestamp": 1746014445000,
      "duration_seconds": 320
    }
  ]
}
```

### 3. Get Alert History

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.rasihr.com/admin/monitoring/alerts/history?limit=50"
```

**Response:** List of 50 most recent alerts (fired in the past)

### 4. Get Alert Rules

**Request:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.rasihr.com/admin/monitoring/alerts/rules
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-03-06T15:30:45Z",
  "count": 12,
  "rules": [
    {
      "name": "High Latency (P99)",
      "metric": "latency_p99_ms",
      "condition": "above",
      "threshold": 5000,
      "duration_seconds": 120,
      "severity": "critical",
      "enabled": true
    },
    ...
  ]
}
```

### 5. Update Alert Rule

**Request:**
```bash
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "threshold": 7000,
    "duration_seconds": 180
  }' \
  https://api.rasihr.com/admin/monitoring/alerts/rules/High%20Latency%20\(P99\)
```

**Response:**
```json
{
  "success": true,
  "message": "Alert rule 'High Latency (P99)' updated",
  "timestamp": "2026-03-06T15:30:45Z"
}
```

### 6. Enable/Disable Alert Rule

**Request:**
```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  https://api.rasihr.com/admin/monitoring/alerts/rules/High%20Latency%20\(P99\)/toggle
```

---

## Grafana Dashboard Configuration

### Data Source Setup

**Add Prometheus data source:**

1. Grafana: Configuration → Data Sources → Add
2. Type: Prometheus
3. URL: `http://localhost:9090` (or your Prometheus instance)
4. Save & Test

### Dashboard JSON

**Create new dashboard:** Paste the following JSON

```json
{
  "dashboard": {
    "title": "RasiSyntheticHR API Monitoring",
    "panels": [
      {
        "title": "Request Latency (P95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, api_request_duration_ms)"
          }
        ]
      },
      {
        "title": "Error Rate %",
        "targets": [
          {
            "expr": "rate(api_requests_total{status=~'5..'}[5m])"
          }
        ]
      },
      {
        "title": "Requests Per Minute",
        "targets": [
          {
            "expr": "rate(api_requests_total[1m])"
          }
        ]
      },
      {
        "title": "CPU Usage %",
        "targets": [
          {
            "expr": "process_cpu_usage_percent"
          }
        ]
      },
      {
        "title": "Memory Usage %",
        "targets": [
          {
            "expr": "process_memory_percent"
          }
        ]
      },
      {
        "title": "Active Alerts",
        "targets": [
          {
            "expr": "count(active_alerts)"
          }
        ]
      }
    ]
  }
}
```

### Key Dashboard Panels

**Row 1: Golden Signals**
- Latency (P50, P95, P99)
- Error Rate (%)
- Traffic (RPM)
- Saturation (CPU %, Memory %)

**Row 2: Endpoint Performance**
- Top 10 slowest endpoints
- Top 10 error-prone endpoints
- Requests per endpoint

**Row 3: Alerts & Health**
- Active alerts (red if any critical)
- Recent alert history (timeline)
- Service health status

**Row 4: Resource Metrics**
- CPU usage over time
- Memory usage over time
- Database connections
- Disk I/O

---

## Integration with External Tools

### PagerDuty Integration

```typescript
// In monitoring.ts, add this handler:
monitoring.on('alert', async (alert: Alert) => {
  if (alert.severity === AlertSeverity.CRITICAL) {
    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: process.env.PAGERDUTY_ROUTING_KEY,
        event_action: 'trigger',
        dedup_key: alert.id,
        payload: {
          summary: alert.message,
          severity: 'critical',
          source: 'RasiHR API',
          custom_details: {
            metric: alert.metric,
            value: alert.value,
            threshold: alert.threshold,
          },
        },
      }),
    });
  }
});
```

### Slack Integration

```typescript
monitoring.on('alert', async (alert: Alert) => {
  const color = alert.severity === AlertSeverity.CRITICAL ? 'danger' : 'warning';
  
  await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: 'POST',
    body: JSON.stringify({
      attachments: [
        {
          color,
          title: alert.name,
          text: alert.message,
          fields: [
            { title: 'Metric', value: alert.metric, short: true },
            { title: 'Value', value: alert.value.toString(), short: true },
            { title: 'Threshold', value: alert.threshold.toString(), short: true },
            { title: 'Duration', value: `${alert.duration_seconds}s`, short: true },
          ],
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    }),
  });
});
```

### Prometheus Metrics Export

```typescript
// Add Prometheus exporter middleware
import prometheus from 'prom-client';

const httpRequestDurationMs = new prometheus.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 500, 1000, 2000, 5000],
});

app.get('/metrics', (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(prometheus.register.metrics());
});
```

---

## Alert Tuning & Optimization

### When to Adjust Thresholds

**Alert Firing Too Often:**
- Increase `threshold` (e.g., 85% → 90%)
- Increase `duration_seconds` (e.g., 60s → 180s)
- Disable if not relevant for your business

**Alert Not Firing When It Should:**
- Lower `threshold` (e.g., 2000ms → 1500ms)
- Lower `duration_seconds` (e.g., 300s → 120s)
- Check historical baseline for that metric

### Building Your Baseline

Run system for 1-2 weeks to establish baseline:

```bash
# Get historical metrics (if storing in database)
SELECT 
  metric_name,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY value) as p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY value) as p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY value) as p99
FROM metrics_history
WHERE timestamp > now() - interval '7 days'
GROUP BY metric_name;
```

**Example Baselines (for 10k RPM):**
- P95 latency: 180-250ms (set alert @ 2000ms = 8-10x baseline)
- Error rate: 0.1-0.5% (set alert @ 5% = 10-50x baseline)
- CPU usage: 25-40% (set alert @ 85% = 2-3x baseline)

---

## Monitoring Best Practices

### 1. Use the Right Percentile
- **P50**: Typical user experience (set generous thresholds)
- **P95**: Users with slower luck (start detecting at 4x p50)
- **P99**: Worst-case users (emergency threshold, page on-call)

### 2. Alert on Trends, Not Spikes
- Don't alert on single spike > 100ms
- Alert on sustained elevation for 2-5 minutes
- Use `duration_seconds` to prevent alert spam

### 3. Avoid Alert Fatigue
- **Too many alerts** = on-call team ignores them (alert blindness)
- Target: < 5 actionable alerts per day
- If getting > 20: Tune thresholds more conservatively

### 4. Test Your Alerts
Monthly alert simulation:
```bash
# Temporarily lower threshold to trigger alert
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"threshold": 100}' \
  https://api.rasihr.com/admin/monitoring/alerts/rules/High%20Latency%20\(P99\)/toggle

# Should trigger alert, trigger PagerDuty, etc.
# Then restore
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"threshold": 5000}' \
  https://api.rasihr.com/admin/monitoring/alerts/rules/High%20Latency%20\(P99\)/toggle
```

---

**Last Updated:** March 6, 2026  
**Owner:** Site Reliability Engineering  
**Review Frequency:** Quarterly (next: June 6, 2026)
