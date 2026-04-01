# Deployment Quick Reference

---

## Self-Host: Docker Compose

All services (postgres, API, frontend) in a single command. The runtime worker is optional and enabled via a Docker Compose profile.

```bash
# 1. Copy and fill in your env file
cp deploy/compose/stack.env.example deploy/compose/stack.env
# Edit deploy/compose/stack.env — fill in SUPABASE_*, JWT_SECRET, OPENAI_API_KEY, etc.

# 2. Start core stack (postgres + API + frontend)
docker compose -f deploy/compose/docker-compose.yml --env-file deploy/compose/stack.env up -d

# 3. (Optional) Also start the runtime worker
docker compose -f deploy/compose/docker-compose.yml --env-file deploy/compose/stack.env --profile runtime up -d

# 4. Verify
curl http://localhost:3001/health
# Frontend available at http://localhost:8080
```

> **Note:** Supabase is always required (cloud or self-hosted) for auth and PostgREST. The postgres service in the compose stack is for the application database only.

---

## Self-Host: Kubernetes (Helm)

Three charts are provided under `charts/`. Install them in this order so the API is ready before the frontend attempts to connect.

```bash
# 1. API
helm install synthetichr-api charts/synthetic-hr-api \
  --set env.SUPABASE_URL=https://your-project.supabase.co \
  --set env.SUPABASE_ANON_KEY=your-anon-key \
  --set env.SUPABASE_SERVICE_KEY=your-service-key \
  --set env.JWT_SECRET=your-jwt-secret \
  --set env.OPENAI_API_KEY=sk-your-key \
  --set env.FRONTEND_URL=https://synthetichr.example.com \
  --set env.API_URL=https://api.synthetichr.example.com

# 2. Runtime worker (one per customer VPC, or self-managed)
helm install synthetichr-runtime charts/synthetic-hr-runtime \
  --set env.SYNTHETICHR_CONTROL_PLANE_URL=https://api.synthetichr.example.com \
  --set env.SYNTHETICHR_RUNTIME_ID=your-runtime-id \
  --set env.SYNTHETICHR_ENROLLMENT_TOKEN=your-token \
  --set env.SYNTHETICHR_API_KEY=your-api-key

# 3. Frontend (enable ingress for external access)
helm install synthetichr-frontend charts/synthetic-hr-frontend \
  --set env.SYNTHETICHR_API_URL=https://api.synthetichr.example.com/api \
  --set env.SYNTHETICHR_SUPABASE_URL=https://your-project.supabase.co \
  --set env.SYNTHETICHR_SUPABASE_ANON_KEY=your-anon-key \
  --set ingress.enabled=true \
  --set ingress.host=synthetichr.example.com \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=synthetichr-tls

# Verify
kubectl get pods
helm status synthetichr-api
```

All charts follow the same pattern as `charts/synthetic-hr-runtime/`. See each chart's `values.yaml` for the full list of configurable env vars.

---

## Blue-Green Deployment & DR Testing Quick Reference

**Print this page and keep at your desk during deployments**

---

## 🚀 DEPLOYMENT QUICK START

```bash
# STEP 1: Deploy (do NOT switch yet)
node scripts/blue-green-deploy.js deploy
# Wait for: "GREEN environment is READY for traffic"

# STEP 2: Manually switch load balancer
# Edit: /etc/nginx/conf.d/blue-green.conf
# Change: server localhost:3001;
# To:     server localhost:3002;
# Then:   sudo systemctl reload nginx

# STEP 3: Monitor (30 minutes minimum)
node scripts/blue-green-deploy.js monitor --duration=30
# Wait for: "Monitoring complete"

# STEP 4: Success or Rollback
# If OK: GREEN becomes new BLUE (done!)
# If issues: node scripts/blue-green-deploy.js rollback
```

---

## 🐛 QUICK STATUS CHECK

```bash
# Is the system healthy?
curl http://localhost:3001/health | jq .

# Which version is live? (BLUE=3001 or GREEN=3002)
lsof -i :3001 :3002 | grep node

# Show detailed status
node scripts/blue-green-deploy.js status

# Check recent errors
grep ERROR /tmp/green.log | tail -20
```

---

## ⚡ EMERGENCY ROLLBACK (if needed)

```bash
# Immediately switch traffic back to BLUE
node scripts/blue-green-deploy.js rollback

# Verify traffic is routed to BLUE
curl -v http://localhost/health | grep "< HTTP"

# Stop GREEN
lsof -i :3002 | grep -v COMMAND | awk '{print $2}' | xargs kill -9

# Monitor BLUE
tail -f /tmp/blue.log | grep -E "ERROR|WARN"
```

---

## 🨊 DISASTER RECOVERY TEST (Weekly)

```bash
# Run quick tests (5 minutes)
node scripts/dr-test.js scenario=database-failure
node scripts/dr-test.js scenario=redis-failure
node scripts/dr-test.js scenario=auth-failure
node scripts/dr-test.js scenario=rate-limit-bypass

# Expected: All show "✅ PASSED"
```

---

## 📊 MONITOR DURING DEPLOYMENT

### Terminal 1: Error Rate
```bash
watch -n 5 'grep -c "ERROR\|FATAL\|Exception" /tmp/green.log'
# Should stay at 0 or very low number
```

### Terminal 2: Database
```bash
watch -n 5 'curl -s http://localhost:3002/health | jq .database_status'
# Should show: "healthy"
```

### Terminal 3: Cache
```bash
watch -n 5 'redis-cli INFO stats | grep connected_clients'
# Should have entries or show connection count
```

### Terminal 4: Throughput
```bash
watch -n 5 'grep "GET\|POST" /tmp/green.log | wc -l'
# Should show consistent request count
```

---

## 🔍 HEALTH CHECK INTERPRETATION

```json
{
  "status": "healthy",           // ✅ OK to deploy
  "database_status": "healthy",  // ✅ DB connected
  "cache_status": "healthy",     // ✅ Redis working
  "uptime_ms": 120000,           // Time running
  "latency_percentiles": {
    "p50": 5,                    // ✅ Median 5ms
    "p95": 18,                   // ✅ 95th-percentile 18ms
    "p99": 25                    // ✅ 99th-percentile 25ms
  }
}
```

---

## ✅ SLO CHECKLIST (Before Traffic Switch)

```
□ P95 Latency: < 200ms current: ___ ms
□ Error Rate: < 0.1%   current: ___ %
□ Availability: 100%   current: ___ %
□ Database: HEALTHY    current: ___
□ Cache: HEALTHY       current: ___
□ API responding       current: ✅/❌
□ No errors in logs    current: ___ errors
□ Rate limiting works  current: ✅/❌
```

---

## 🚨 CRITICAL ALERTS TO WATCH

| Alert | Meaning | Action |
|-------|---------|--------|
| `error_rate > 1%` | High error rate | ROLLBACK immediately |
| `p95_latency > 1000ms` | Slow responses | ROLLBACK after 5min |
| `database connection error` | DB unreachable | ROLLBACK immediately |
| `redis connection error` | Cache down | Watch, but usually OK |
| `auth failures > 10/min` | Auth issue | ROLLBACK immediately |
| `rate_limit hits expected` | Normal behavior | OK, continue monitoring |

---

## 📱 NOTIFICATION CHECKLIST

During deployment, notify:
- [ ] Slack: #deployment-alerts
- [ ] PagerDuty: Mark as "in progress"
- [ ] Customers: "Scheduled maintenance 2 PM" (if needed)
- [ ] QA Team: "Monitoring deployment"
- [ ] On-call: "Standing by for rollback"

---

## 🔗 KEY PORTS & ENDPOINTS

| Service | Port | Type | Health Check |
|---------|------|------|------|
| BLUE | 3001 | HTTP | curl localhost:3001/health |
| GREEN | 3002 | HTTP | curl localhost:3002/health |
| Load Balancer | 80 | HTTP | curl localhost/health |
| Redis | 6379 | TCP | redis-cli ping |
| PostgreSQL | 5432 | TCP | psql -c "SELECT 1;" |

---

## 🛠️ COMMON ISSUES & FIXES

### GREEN won't start
```bash
# Check port
lsof -i :3002

# Kill if stuck
kill -9 $(lsof -i :3002 | grep node | awk '{print $2}')

# Start manually
cd synthetic-hr-api && PORT=3002 npm run start &
```

### Traffic not switching
```bash
# Verify nginx config
cat /etc/nginx/conf.d/blue-green.conf | grep "server localhost"

# Reload nginx
sudo systemctl reload nginx

# Test routing
curl -v http://localhost | head -20
```

### HIGH ERROR RATE
```bash
# Check logs
tail -f /tmp/green.log | grep ERROR

# Check database
psql -c "SELECT 1;" # If fails, DB is unreachable

# Rollback immediately
node scripts/blue-green-deploy.js rollback
```

### SLOW RESPONSES
```bash
# Check latency
time curl -s http://localhost:3002/health > /dev/null

# Check database queries
psql -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 3;"

# Check memory
ps aux | grep "node.*src" | awk '{print $6}'
```

---

## 📅 DEPLOYMENT TIMELINE

```
T+0:00   Start deployment
         Run: npm run build && npm test
         
T+2:00   Start GREEN environment
         Port 3002 should be listening
         
T+3:00   Validate GREEN
         All SLO checks pass
         
T+4:00   Switch traffic to GREEN
         Update load balancer config
         
T+4:05   Monitor GREEN
         Watch error rate, latency
         
T+34:00  Deployment complete
         Move BLUE to standby
         GREEN becomes new BLUE
```

---

## 🧪 QUICK DR TEST (for on-call)

```bash
# Database failure scenario
lsof -i :3001 | grep node                    # Get PID
kill -stop $(PID)                             # Pause process
node scripts/dr-test.js scenario=database-failure     # Test recovery
kill -cont $(PID)                             # Resume process

# Result should show: ✅ PASSED

# If failed, escalate to DBA team
```

---

## 📞 ESCALATION CONTACTS

**Deployment blocked?**
→ Slack: @devops-lead

**Performance degraded?**
→ Slack: @sre-oncall

**Database issue?**
→ Slack: @dba-team

**Security concern?**
→ Slack: @security-team

**Customer impact?**
→ Slack: @customer-success

---

## 🧠 REMEMBER

```
✅ Always test in staging first
✅ Have rollback ready before switching
✅ Monitor for 30 minutes minimum
✅ Don't deploy on Friday afternoon
✅ Keep BLUE alive for 24+ hours
✅ Document any issues found
✅ Run DR tests monthly
```

---

## 🎯 SUCCESS INDICATORS

**Deployment was successful if:**
- ✅ Error rate stays < 0.1%
- ✅ No 5xx errors in first few requests
- ✅ P95 latency under 200ms
- ✅ Database responsive
- ✅ Cache working
- ✅ No customer complaints
- ✅ All logs clean

---

**Print and laminate this page!**
**Keep by your desk during deployments.**

Last updated: March 5, 2026
