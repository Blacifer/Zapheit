# Incident Response Playbook

## Quick Reference: Incident Types & Response Times

This playbook enables **5-minute incident detection**, 15-minute resolution for most issues, and 30-minute RTO for critical failures.

---

## Incident Classification

### Severity Levels

| Level | Definition | RTO | Response | Examples |
|-------|-----------|-----|----------|----------|
| **P1 - Critical** | Production down, revenue at risk, data loss possible | 30 min | Page on-call immediately | Database down, API 500 errors on 100%+ traffic, data breach |
| **P2 - High** | Feature broken for subset of users, some data loss | 2 hours | Page on-call, notify support | Email not sending, single server down, login for 10% users broken |
| **P3 - Medium** | Degraded performance, workaround exists | 4 hours | Schedule next business day | Slow API (p95 > 2s), minor bugs, UI issues |
| **P4 - Low** | Cosmetic or non-critical issues | Next sprint | Engineering backlog | Typo in UI, old version caching, analytics delay |

---

## Detection & Alerting

### Automated Incident Detection

**1. Golden Signals Monitoring (deployed via Prometheus + Grafana)**

| Signal | Alert Threshold | P Level | Escalation |
|--------|----------------|---------|-----------|
| **Latency (p95)** | > 2000 ms for > 5 min | P2 | Page on-call |
| **Latency (p99)** | > 5000 ms for > 2 min | P1 | Page on-call |
| **Error Rate** | > 5% for > 2 min | P1 | Page on-call |
| **Traffic** | > 2x baseline for > 10 min | P2 | Alert ops |
| **Saturation** | CPU > 85%, Memory > 90%, Disk > 80% | P2 | Alert ops |

**2. Application-Level Alerts**

| Alert | Threshold | Action |
|-------|-----------|--------|
| Database unavailable | 1+ consecutive failed pings | P1: Page, disable writes |
| Auth failures (jwt-verify) | > 50 failures/min | P1: Page, investigate key rotation |
| Payment processing down | > 10 failed charges in 1 hour | P1: Page, notify customers |
| Email delivery failure | > 5 consecutive failures | P2: Page, switch to webhook |
| Disk space | < 10% available | P1: Page, drain old logs, enable compression |

**3. Manual Incident Report**

Users can report incidents via:
- **Slack**: #incidents channel (monitored 24/7)
- **Email**: incidents@zapheit.com (PagerDuty auto-creates ticket)
- **In-app**: Settings → Report Issue (sends email)

---

## P1 Critical Incident Playbook (30-minute RTO)

### Step 1: Detect & Triage (Target: 2 minutes)

**Automated Detection**
- Monitoring system detects issue and pages on-call engineer via PagerDuty
- Alert includes: Severity, affected service, recent error logs, suggested runbook

**Manual Detection**
- User reports via Slack or email  
- Run diagnostic command:
  ```bash
  curl https://api.zapheit.com/health
  # Expected response should show all dependencies healthy
  # If any dependency shows "unhealthy", continue with Section 2 matching that service
  ```

**Confirm P1 Status**
- [ ] Is production traffic affected? (yes = P1)
- [ ] Is customer data at risk? (yes = P1)
- [ ] Are paying customers impacted? (yes = P1)
- If any YES: Declare P1 incident

**Action: Create Incident Ticket**
```bash
# PagerDuty creates automatically from alert
# Manual creation if needed:
curl -X POST https://api.pagerduty.com/incidents \
  -H "Authorization: Token token=$PAGERDUTY_TOKEN" \
  -d '{
    "incident": {
      "type": "incident",
      "title": "[P1] API returning 500 errors",
      "urgency": "high",
      "escalation_policy_id": "'$ESCALATION_POLICY_ID'",
      "body": {
        "type": "incident_body",
        "description": "100% of API requests returning 500"
      }
    }
  }'
```

**Notification (Automatic)**
- [ ] Slack #incidents channel posts alert
- [ ] On-call engineer paged (PagerDuty)
- [ ] Engineering manager auto-notified
- [ ] Status page starts "Investigating" status

---

### Step 2: Declare Incident & Establish War Room (2-3 minutes)

**Incident Commander** (on-call engineer who got paged):

1. **Acknowledge incident in PagerDuty**
   - Click "Acknowledge" to stop escalation

2. **Start Slack war room**
   ```bash
   # PagerDuty -> Slack integration auto-creates #incident-XXXXX
   # If not auto-created:
   slack create-channel incident-p1-$(date +%Y%m%d-%H%M)
   # Invite: @on-call-engineer, @manager, @cto (if critical)
   ```

3. **Post initial status** (in war room Slack)
   ```
   🚨 P1 INCIDENT: API 500 errors (100% traffic affected)
   
   Incident ID: INC-2026-0123
   Page: https://pagerduty.com/incidents/INC-2026-0123
   
   Context:
   - First detection: 14:32 UTC (2 min ago)
   - Affected users: All
   - Estimated impact: $250/min revenue loss
   
   Incident Commander: @alice (alice@zapheit.com)
   Roles needed:
   - [ ] Primary responder (diagnosing root cause)
   - [ ] Secondary responder (executing fixes)
   - [ ] Communications lead (updating customers)
   
   Next update in 5 minutes or when status changes
   ```

---

### Step 3: Root Cause Diagnosis (5-10 minutes)

**Primary Responder Task:** Identify which system is down

Run diagnostic in priority order:

**A. Check API Health**
```bash
curl -v https://api.zapheit.com/health 2>&1 | grep -A 20 "HTTP\|dependencies"
# Expected:
# HTTP/1.1 200 OK
# {
#   "status": "healthy",
#   "dependencies": {
#     "supabase": "healthy",
#     "sentry": "healthy"
#   }
# }
```

**If API Container Reachable (200/503 response):**
- Go to Step 3B (Service-level diagnosis)

**If API Unreachable (connection refused, timeout):**
- Go to Step 3C (Infrastructure failure)

---

**B. Service-Level Diagnosis (if API responds but requests failing)**

```bash
# 1. Check database
curl -s https://api.zapheit.com/health | jq '.dependencies.supabase'
# Expected: "healthy"

# 2. Check API logs
kubectl logs -n production deployment/synthetic-hr-api --tail=50 | grep -i error
# Look for: "Error connecting to database", "JWT verification failed", etc.

# 3. Check error rate
# (Requires Grafana access)
# Dashboard: API Error Rate
# If > 50%: Authentication issue or database issue
```

**Common Causes & Fixes:**

| Symptom | Root Cause | Fix | Time |
|---------|-----------|-----|------|
| All requests → 500 "database connection refused" | Supabase is down | Wait for Supabase recovery (check status.supabase.com) | 5-15 min |
| All requests → 401 "Invalid JWT" | Supabase JWKS endpoint unavailable | Restart API (clears JWKS cache) | 2 min |
| 50% requests fail, 50% succeed | Single API instance down | Auto-load balancer removes it, restart container | 1 min |
| Specific endpoints → 500 | Database query timeout | Identify slow query, add index, increase timeout | 10-20 min |
| POST requests → 502, GET requests work | Database write failure (full disk, constraint violation) | Check disk space, kill oldest logs if needed | 5-10 min |

---

**C. Infrastructure Failure (if API unreachable)**

```bash
# 1. Check Kubernetes cluster health
kubectl get nodes
# All nodes should show "Ready"
# If any "NotReady": Hardware failure, drain and rebuild

# 2. Check pod status
kubectl get pods -n production | grep synthetic-hr-api
# Expected: All pods "Running"
# If "CrashLoopBackOff": Check logs with:
kubectl logs -n production deployment/synthetic-hr-api --tail=20

# 3. Check load balancer
kubectl get svc -n production
# Should show 5/5 endpoints ready
# If 0/5: All pods down, check infrastructure logs
```

---

### Step 4: Execute Fix & Measure Recovery (5-10 minutes)

Based on root cause from Step 3, execute the appropriate runbook:

**If Database Down:**
→ Follow [DR_RECOVERY_PROCEDURES.md](DR_RECOVERY_PROCEDURES.md) Section 1 (5-10 min recovery)

**If API Code Issue:**
→ Restart API containers
```bash
kubectl rollout restart deployment/synthetic-hr-api -n production
kubectl rollout status deployment/synthetic-hr-api -n production
# Monitor that pods come back healthy
```

**If Kubernetes Cluster Issue:**
→ Follow infrastructure playbook or contact cloud provider

**If Authentication/JWT Issue:**
```bash
# Clear JWKS cache
curl -X POST https://api.zapheit.com/admin/clear-cache \
  -H "Authorization: Bearer $ADMIN_TOKEN"
  
# Restart API
kubectl rollout restart deployment/synthetic-hr-api -n production
```

**If Payment Processing Down:**
→ Follow [DR_RECOVERY_PROCEDURES.md](DR_RECOVERY_PROCEDURES.md) Section 6 (15-30 min recovery)

---

### Step 5: Post-Recovery Validation (3-5 minutes)

**Smoke Tests:**

```bash
echo "=== P1 Incident Recovery Validation ==="

# 1. Health check
echo "1. Checking API health..."
curl -s https://api.zapheit.com/health | jq '.status'
# Expected: "healthy"

# 2. Database connectivity
echo "2. Testing database query..."
curl -s https://api.zapheit.com/admin/health/db \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.db_connections'
# Expected: > 0

# 3. Authentication test
echo "3. Testing login flow..."
curl -X POST https://api.zapheit.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@zapheit.com","password":"demo123"}' | jq '.token'
# Expected: token string

# 4. Sample API call
echo "4. Testing API call..."
curl -s https://api.zapheit.com/api/conversations \
  -H "Authorization: Bearer $USER_TOKEN" | jq '.conversations[0].id'
# Expected: conversation ID (not error)

# 5. Error rate check
echo "5. Checking error rate..."
# Should be < 1% (was > 50% during incident)
```

**If All Checks Pass:**
- Recovery successful ✓
- Proceed to Step 6 (Communication)

**If Any Check Fails:**
- Incident not resolved
- Go back to Step 3 (re-diagnose)
- Escalate to CTO if diagnosis uncertain

---

### Step 6: Customer Communication (2-3 minutes)

**Incident Commander delegates to Communications Lead**

**Status Page Update** (immediate—1 minute)
```
🔴 RESOLVED: API errors (12:05 - 12:32 UTC, 27 min duration)

All systems are now operating normally. We've confirmed:
✓ All API requests processing normally
✓ Database connectivity restored
✓ No data loss
✓ Root cause identified: [brief explanation]

Full incident report will be published within 24 hours.
```

**Customer Email** (if downtime > 15 minutes)
```
Subject: Incident Report: API was unavailable March 6 12:05-12:32 UTC

Dear Customers,

We experienced a 27-minute outage affecting our API service today.

What happened:
[Explain in non-technical terms—e.g., "Our database service became temporarily unavailable"]

Impact:
[E.g., "Users were unable to sync conversations for 27 minutes"]

Resolution:
[E.g., "We restarted the database service, and all systems came back online at 12:32 UTC"]

What we're doing:
[E.g., "We've implemented additional monitoring to detect similar issues faster"]

We apologize for any inconvenience. Questions? Contact support@zapheit.com.

-The Zapheit Team
```

**Slack #general Announcement** (if major impact)
```
We experienced an API outage from 12:05-12:32 UTC. 
Root cause: [X]. 
No data loss. Full postmortem will be in #incidents.
```

---

### Step 7: Post-Incident Postmortem (Next business day)

**Incident Commander schedules meeting (30-45 min):**

**Attendees:**
- On-call engineer who responded
- Engineering lead
- Product manager (if customer-facing)
- CTO (if P1)

**Discussion Topics:**

1. **Timeline** (5 min)
   - What: Exact sequence of events
   - When: Timestamps for each phase
   - Who: Who took each action

2. **Root Cause Analysis** (10 min)
   - Why it happened
   - Why we didn't catch it sooner
   - Contributing factors

3. **Impact Assessment** (5 min)
   - Customers affected: count
   - Revenue impact: $X
   - Data loss: none/partial/total

4. **Action Items** (5 min)
   - What will prevent this in future?
   - Who owns each action?
   - Target completion date?

5. **Lessons Learned** (5 min)
   - What went well?
   - What could be better?
   - Update runbooks?

**Postmortem Report Template:**
```markdown
# Postmortem: API 500 Errors (March 6, 2:05-2:32 UTC)

## Summary
27-minute outage affecting 100% of users.
No data loss. Root cause: [X].

## Timeline
- 14:05 UTC: Outage begins (automatic alert)
- 14:07 UTC: On-call engineer acknowledges
- 14:12 UTC: Root cause identified (database connection pool exhausted)
- 14:15 UTC: Fix applied (restart database service)
- 14:32 UTC: Recovery confirmed (health checks passing)

## Root Cause
Connection pool exhausted due to inefficient query in conversation listing endpoint.
Runaway queries didn't release connections.

## Contributing Factors
- Query wasn't load-tested with production data volume
- No connection pool exhaustion alert in place
- Automatic restart not triggered (manual intervention needed)

## Action Items
- [ ] Add database connection pool alert (P1, due March 13)
- [ ] Implement connection timeout in queries (P1, due March 13)
- [ ] Load test all endpoints with production data (P2, due March 20)
- [ ] Configure automatic connection pool drain restart (P2, due March 20)

## Metrics
- Detection time: 2 minutes (good)
- Resolution time: 27 minutes (should be < 15 min)
- Customer impact: $6,750 revenue lost
- Error rate peak: 100% (critical)
```

---

## P2 High-Priority Incident (2-hour RTO)

**Shortened Process (vs P1):**

1. **Detect** (2 min) → Create ticket, page on-call
2. **Diagnose** (10 min) → Root cause identified
3. **Fix** (30 min) → Execute appropriate runbook
4. **Validate** (3 min) → Spot checks only (not exhaustive)
5. **Communicate** (2 min) → Status page + Slack update (no customer email)
6. **Postmortem** (next business day) → 15-minute sync

**Examples:** Single server crash, email not sending, login broken for 10% users

---

## P3 Medium Priority (4-hour RTO)

**Simple Process:**
1. Create ticket, add to sprint
2. No paging on-call
3. Fix during regular business hours
4. No customer communication needed

**Examples:** Slow API endpoint, cosmetic UI bug, analytics delay

---

## Escalation Path

### For Incidents You Can't Diagnose

**Situation:** You've followed the diagnostic steps but still don't know root cause.

**Escalation:**

1. **5 minutes in:** Page secondary on-call engineer
   - PagerDuty: Escalation policy → Engineering Manager

2. **10 minutes in:** If still unresolved, page CTO
   - CTO has infrastructure knowledge and external contacts (Supabase, etc.)

3. **15 minutes in:** If still P1 and unresolved
   - CTO decides: Accept partial degradation, switch to failover, delay customer features

---

## Common Incident Scenarios

### Scenario 1: "API Server Down"

**Detection:** All health checks fail, connection refused

**Diagnosis (2 min):**
```bash
kubectl get pods -n production | grep synthetic-hr-api
# If "CrashLoopBackOff" or "Pending":
kubectl logs -n production deployment/synthetic-hr-api | tail -30
```

**Fix (3 min):**
```bash
kubectl rollout restart deployment/synthetic-hr-api -n production
kubectl rollout status deployment/synthetic-hr-api -n production
```

**Validation (2 min):**
```bash
curl https://api.zapheit.com/health
# Expected: 200 OK, status: healthy
```

**Total RTO: 7 minutes**

---

### Scenario 2: "Database Unreachable"

**Detection:** Health endpoint shows 503, "Supabase connectivity failed"

**Diagnosis (2 min):**
```bash
curl https://status.supabase.com/api/v2/summary.json
# If Supabase is down: Wait for recovery
# If Supabase says healthy: Network issue
```

**Fix (10 min):**
- If Supabase down: Wait (nothing to do)
- If network issue: Restart API to clear connection pool

**Total RTO: 10-15 minutes**

---

### Scenario 3: "Payment Processing Failing"

**Detection:** Stripe webhook returns 5xx, customers get "Payment failed"

**Diagnosis (3 min):**
```bash
# Check Stripe status
curl https://status.stripe.com

# Check webhook endpoint
curl -X POST https://api.zapheit.com/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"type": "test"}'
# Expected: 200 OK
```

**Fix (15 min):**
- Restart API if rate-limited
- Contact Stripe support if their API is down
- Retry failed payments manually

**Total RTO: 15-30 minutes**

---

### Scenario 4: "Slow API (p99 > 5 seconds)"

**Detection:** Monitoring alert, users complain app is slow

**Diagnosis (5 min):**
```bash
# Identify slow endpoint
curl -s https://api.zapheit.com/admin/slow-queries \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Look for: Endpoint with highest latency

# Check database query plan
EXPLAIN ANALYZE SELECT * FROM conversations WHERE org_id = '...' LIMIT 100;
```

**Fix (20 min):**
- Add database index if query scans too many rows
- Implement query timeout
- Reduce data returned (pagination)

**Total RTO: 30-45 minutes**

---

## Emergency Contacts

**On-Call Engineer:** PagerDuty → Primary on-call
**Engineering Manager:** PagerDuty → Escalation policy
**CTO:** escalation + critical judgment calls
**Supabase Support:** https://app.supabase.com/support
**Stripe Support:** https://support.stripe.com (for payment issues)

**Escalation Decision Tree:**

```
Incident detected
├─ P1? (production down, revenue loss)
│  ├─ Yes → Page on-call immediately
│  └─ No → Continue
├─ Duration > 5 min?
│  ├─ Yes → Page manager
│  └─ No → Engineers handle
├─ Root cause uncertain after 10 min?
│  ├─ Yes → Escalate to CTO
│  └─ No → Continue
└─ Decision: Fix, workaround, or rollback?
```

---

**Last Updated:** March 6, 2026  
**Owner:** Engineering  
**Test Frequency:** Quarterly incident simulation  
**Next Drill:** June 1, 2026
