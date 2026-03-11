# Disaster Recovery Procedures

## Executive Summary

RasiSyntheticHR implements a **Recovery Time Objective (RTO) of 30 minutes** and **Recovery Point Objective (RPO) of 15 minutes** for production outages.

This document provides step-by-step procedures for all critical failure scenarios.

---

## 1. Database Failure Recovery

### Scenario 1.1: Database Connection Loss (Impact: 5-15 minutes)

**Detection:**
- Health endpoint returns 503 with "Supabase connectivity failed"
- Backend logs show `Error: connect ECONNREFUSED` or `ETIMEDOUT`
- Monitoring alert: "Database unavailable for 2+ minutes"

**Recovery Steps (Time: 5-10 minutes):**

1. **Verify Database Status (1 min)**
   ```bash
   # Check Supabase dashboard for service status
   # URL: https://app.supabase.com/project/[PROJECT_ID]/logs
   
   # Or test connectivity directly
   psql postgres://[user]:[password]@[host]/postgres -c "SELECT 1"
   ```

2. **Check Network Connectivity (2 min)**
   ```bash
   # If using Supabase cloud
   nslookup [supabase-host].supabase.co
   ping -c 3 [supabase-host].supabase.co
   
   # Check firewall rules on database
   # All traffic on port 5432 should be allowed from app servers
   ```

3. **Restart API Server (3 min)**
   ```bash
   # Using Docker (if containerized)
   docker restart synthetic-hr-api
   
   # Using systemd (if VM deployment)
   sudo systemctl restart synthetic-hr-api
   
   # Using k8s (if Kubernetes)
   kubectl rollout restart deployment/synthetic-hr-api -n production
   ```

4. **Verify Recovery**
   ```bash
   # Check health endpoint
   curl https://api.rasihr.com/health
   
   # Expected response:
   # {
   #   "status": "healthy",
   #   "dependencies": { "supabase": "healthy" },
   #   "latency_p95_ms": 45,
   #   "latency_p99_ms": 120
   # }
   ```

5. **If Still Failing: Failover to Read Replica (5 min)**
   - Update `DATABASE_URL` environment variable to replica endpoint
   - Drain current connections: `pg_terminate_backend(pid)` on primary
   - Restart API servers
   - Monitor for 5 minutes

---

### Scenario 1.2: Data Corruption or Accidental Deletion (Impact: 15-60 minutes)

**Detection:**
- Audit logs show unexpected DELETE or UPDATE operations
- Customer reports missing data (users, conversations, ai_agents)
- Checksum validation failure in monitoring

**Recovery Steps (Time: 30-45 minutes):**

1. **Identify Scope of Damage (5 min)**
   ```sql
   -- Check audit_logs for recent suspicious activity
   SELECT * FROM audit_logs 
   WHERE created_at > now() - interval '1 hour'
   AND action IN ('DELETE', 'UPDATE', 'DROP')
   ORDER BY created_at DESC 
   LIMIT 20;
   
   -- Check row counts vs. historical baselines
   SELECT 'users' as table_name, COUNT(*) as current_count FROM users
   UNION ALL
   SELECT 'conversations', COUNT(*) FROM conversations
   UNION ALL
   SELECT 'ai_agents', COUNT(*) FROM ai_agents;
   ```

2. **Restore from Backup (20-30 min)**
   
   a. **Determine which backup to use:**
   ```
   - Hourly backup from 1 hour ago: Use if damage is recent
   - Daily backup from yesterday: Use if issue is widespread
   - Point-in-time recovery: Use if you know exact corruption timestamp
   ```
   
   b. **Using Supabase dashboard:**
   - Navigate to: Settings → Backups
   - Select backup from within 15 minutes before corruption detected
   - Click "Restore" and confirm
   - Wait for restore to complete (typically 10-15 minutes)
   - System will be in read-only during restore
   
   c. **Verify restored data:**
   ```sql
   SELECT * FROM audit_logs 
   WHERE created_at > (now() - interval '2 hours')
   ORDER BY created_at DESC LIMIT 5;
   ```

3. **Post-Restore Validation (5 min)**
   ```bash
   # Run database integrity checks
   curl -X POST https://api.rasihr.com/admin/verify-integrity \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   ```

4. **Communicate with Users**
   - Notify affected users of the incident
   - Provide estimated recovery time (5 min remaining)
   - No data loss beyond the corruption window

---

## 2. API Server Failure (Impact: 5-30 minutes)

### Scenario 2.1: Single Server Crash

**Detection:**
- Monitoring alert: "API server [instance-id] unhealthy"
- Error rate spikes to 50%+
- Auto-scaling group detects failure

**Recovery Steps (Time: 3-5 minutes):**

```bash
# Auto-recovery via health checks
# Standard load balancer settings:
# - Health check interval: 30 seconds
# - Unhealthy threshold: 2 checks
# - Action: Auto-remove from LB, auto-restart container

# Manual intervention if auto-recovery fails:
docker restart synthetic-hr-api-[instance]

# Or force new deployment:
kubectl rollout restart deployment/synthetic-hr-api -n production
```

### Scenario 2.2: All Servers Down (Complete Outage)

**Detection:**
- All health check endpoints return connection refused
- Load balancer shows 0/N healthy instances
- Incident page auto-updates

**Recovery Steps (Time: 15-30 minutes):**

1. **Determine Root Cause (5 min)**
   ```bash
   # Check logs from last 30 minutes
   kubectl logs -n production deployment/synthetic-hr-api --tail=200
   
   # Look for:
   # - OOM kill: Increase memory limits
   # - Port already in use: Kill conflicting process
   # - Environment variable missing: Check .env.production
   ```

2. **Check Dependencies (3 min)**
   ```bash
   # Is Supabase up?
   curl https://status.supabase.com/api/v2/summary.json
   
   # Is Sentry accessible?
   curl https://sentry.io/_health/
   
   # Is email provider (Resend) up?
   curl https://api.resend.com/emails -H "Authorization: Bearer $RESEND_KEY"
   ```

3. **Restart Deployment (5 min)**
   ```bash
   # Force new rollout
   kubectl set image deployment/synthetic-hr-api \
     synthetic-hr-api=synthetic-hr:$(git rev-parse --short HEAD) \
     -n production --record
   
   # Monitor rollout progress
   kubectl rollout status deployment/synthetic-hr-api -n production
   ```

4. **Post-Recovery Validation**
   ```bash
   # Smoke tests
   curl -X GET https://api.rasihr.com/health
   curl -X POST https://api.rasihr.com/auth/login \
     -d '{"email":"demo@rasihr.com","password":"..."}' \
     -H "Content-Type: application/json"
   ```

---

## 3. Frontend/CDN Outage (Impact: 10-30 minutes)

**Detection:**
- 100% of users see blank page or 404
- CDN health check fails
- Browser console shows CORS errors or 503 responses

**Recovery Steps (Time: 5-10 minutes):**

1. **Check CDN Status**
   - Cloudflare dashboard: https://dash.cloudflare.com
   - Look for zone-wide outages or rule misconfigurations
   - Check if certificate is valid and not expired

2. **Rebuild and Redeploy Frontend**
   ```bash
   # In production deployment pipeline
   npm run build  # Creates dist/
   
   # Upload to CDN/S3
   aws s3 sync dist/ s3://rasihr-frontend-prod/
   
   # Invalidate CDN cache
   aws cloudfront create-invalidation \
     --distribution-id $CLOUDFRONT_ID \
     --paths "/*"
   ```

3. **Verify Deployment**
   - Clear browser cache: Cmd+Shift+R
   - Test across different browsers
   - Check CloudFlare analytics for traffic restoration

---

## 4. Authentication/API Key Failure (Impact: 10-45 minutes)

**Detection:**
- All API calls return 401 "Invalid API key"
- Sentry shows: "crypto.timingSafeEqual failed"
- User login flow broken

**Recovery Steps (Time: 10-15 minutes):**

1. **Check API Key Store (2 min)**
   ```sql
   -- Query api_keys table
   SELECT id, client_key, created_at, last_used_at, is_active 
   FROM api_keys 
   WHERE is_active = true 
   LIMIT 10;
   
   -- Verify cache was cleared
   SELECT COUNT(*) FROM api_key_cache;
   -- Expected: 0 or < 100
   ```

2. **Verify JWKS Endpoint Accessibility (3 min)**
   ```bash
   # Supabase JWT verification depends on JWKS endpoint
   curl https://[project].supabase.co/.well-known/jwks.json
   
   # Should return valid JSON with keys
   # If 503: Supabase API is down, wait for recovery
   ```

3. **Clear API Key Cache (2 min)**
   ```bash
   # If using Redis cache
   redis-cli DEL "api_key_*"
   redis-cli DEL "cache:auth:*"
   
   # Signal API servers to drop cache
   curl -X POST https://api.rasihr.com/admin/clear-cache \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   
   # Graceful restart isn't needed—cache TTL handles it
   ```

4. **Regenerate API Keys (5 min)**
   - If widespread failure, issue new API keys to top clients
   - Use `/admin/regenerate-api-key` endpoint
   - Notify clients via email/in-app notification

---

## 5. Email/Notification System Failure (Impact: Low, 24-48 hours to fix)

**Detection:**
- User reports missing confirmation emails
- Webhook logs show 5xx responses
- Sentry events: "Email send failed"

**Recovery Steps (Time: 5-15 minutes):**

1. **Check Email Provider Status**
   - Resend status: https://www.resendstatus.com/
   - Monitor webhook delivery: Resend dashboard → Webhooks

2. **Fallback to Email Webhook (2 min)**
   - Update environment: `EMAIL_PROVIDER=webhook`
   - Point `EMAIL_WEBHOOK_URL` to alternative endpoint
   - Verify webhook is accessible and returning 2xx

3. **Retry Failed Emails (5 min)**
   ```sql
   -- Find emails that failed in last 30 minutes
   SELECT id, email_type, created_at, error_message 
   FROM email_logs 
   WHERE status = 'failed' 
   AND created_at > now() - interval '30 minutes'
   ORDER BY created_at DESC;
   
   -- Manually trigger resend for critical emails
   UPDATE email_logs 
   SET retry_count = retry_count + 1, status = 'pending'
   WHERE id = 'email_id_here';
   ```

4. **User Notification**
   - Send in-app notification: "Email system temporarily unavailable, we'll resend shortly"
   - Update status page: https://status.rasihr.com

---

## 6. Payment Processing Failure (Impact: Revenue at risk, 15-60 minute recovery)

**Detection:**
- Stripe webhook failures in logs
- Failed charge notifications from Stripe dashboard
- Users report "Payment processing failed" errors
- Sentry: "Stripe API timeout or 5xx response"

**Recovery Steps (Time: 15-30 minutes):**

1. **Check Stripe Status (2 min)**
   - https://status.stripe.com/
   - Check API credentials are still valid (not rotated)

2. **Verify Webhook Configuration (3 min)**
   ```bash
   # Check if webhook endpoint is reachable
   curl -X POST https://api.rasihr.com/webhooks/stripe \
     -H "Content-Type: application/json" \
     -d '{"type":"test"}'
   
   # Should return 200, not 5xx
   ```

3. **Retry Failed Payments (10 min)**
   ```sql
   -- Find failed transactions
   SELECT id, user_id, amount, error_code, created_at 
   FROM payments 
   WHERE status = 'failed' 
   AND created_at > now() - interval '1 hour'
   ORDER BY amount DESC;  -- Highest value first
   
   -- For single payment retry:
   UPDATE payments 
   SET retry_count = retry_count + 1, status = 'pending'
   WHERE id = 'payment_id_here';
   ```

4. **Manual Payment Recovery (if needed)**
   - Contact Stripe support: https://support.stripe.com/
   - Verify failed charges in Stripe dashboard
   - Create manual invoices for affected customers
   - Process refunds if necessary

---

## 7. Security Incident (Impact: Varies, 30-180 minute response)

**Detection:**
- Unauthorized API access detected in audit logs
- Secrets exposed in Git or logs
- Data exfiltration detected by monitoring

**Recovery Steps (Time: 30-180 minutes):**

1. **Immediate Containment (5 min)**
   - Disable compromised API keys: `UPDATE api_keys SET is_active = false WHERE id = 'key_id'`
   - Revoke compromised user sessions
   - Enable enhanced logging and monitoring
   - Snapshot current system state for forensics

2. **Investigate Scope (15-30 min)**
   ```sql
   -- Check audit logs for suspicious activity
   SELECT action, user_id, resource_id, ip_address, created_at 
   FROM audit_logs 
   WHERE created_at > now() - interval '24 hours'
   AND (
     action = 'DELETE' OR 
     action = 'EXPORT' OR 
     ip_address NOT IN ('10.0.0.0/8', '172.16.0.0/12')  -- Known IPs
   )
   ORDER BY created_at DESC;
   ```

3. **Rotate All Secrets (10-15 min)**
   ```bash
   # Regenerate environment variables
   # DATABASE_PASSWORD: Force password reset in Supabase
   # API_KEYS: Invalidate all keys, issue new ones to customers
   # SENTRY_DSN: Rotate in Sentry project settings
   # EMAIL_API_KEY: Rotate in Resend/provider dashboard
   # JWT_SECRET: If exposed, update in Supabase
   
   # Redeploy all services with new secrets
   kubectl rollout restart deployment/synthetic-hr-api -n production
   ```

4. **User Communication (5 min)**
   - Post to status page: "We detected and contained a security incident..."
   - Email affected users
   - Provide guidance: "Reset your password", "Monitor your account"

---

## 8. Cascading Failure (Multiple Systems Down)

**Scenario:** Database + API both failing simultaneously (Impact: Complete outage, 30-60 minutes)

**Recovery Priority:** Database → API → Frontend

1. **Database Recovery First (15-20 min)**
   - Follow Scenario 1.1 (Database Connection Loss)
   - Verify connectivity before proceeding

2. **Then API Recovery (5-10 min)**
   - Follow Scenario 2.2 (All Servers Down)
   - Health endpoint must return healthy before proceeding

3. **Finally Frontend (5 min)**
   - CDN cache should auto-serve previously cached assets
   - Clear cache and redeploy if needed (Scenario 3)

---

## RTO/RPO Targets by Incident Type

| Incident Type | RTO Target | RPO Target | Recovery Difficulty |
|---------------|-----------|-----------|-------------------|
| Single server crash | 5 min | 0 min | ⭐ Easy |
| Database connection loss | 10 min | 0 min | ⭐ Easy |
| Frontend/CDN outage | 10 min | 0 min | ⭐ Easy |
| API key validation failure | 15 min | 0 min | ⭐⭐ Medium |
| Database data corruption | 30 min | 15 min | ⭐⭐⭐ Hard |
| Email system down | 2 hours | 24 hours | ⭐⭐ Medium |
| Payment processing down | 1 hour | 0 min | ⭐⭐⭐ Hard |
| Security breach | 60 min | 0 min | ⭐⭐⭐⭐ Very Hard |
| All systems down | 30 min | 15 min | ⭐⭐⭐⭐ Very Hard |

---

## Testing the DR Plan

### Monthly DR Drill (1st Friday of each month)

```bash
# Test 1: Database failover
# - Manually failover to read replica
# - Measure failover time
# - Verify no data loss

# Test 2: API server restart
# - Rolling restart of all API instances
# - Monitor request latency and error rates
# - Should complete in < 5 minutes

# Test 3: CDN cache clear and rebuild
# - Full frontend rebuild
# - Upload to CDN
# - Verify users can access updated version within 1 minute

# Test 4: Restore from backup
# - Restore test database from 24-hour-old backup
# - Run integrity checks
# - Measure total restore time (target: < 20 minutes)
```

### Post-Incident Review (Every incident, formal or drill)

- Document what went wrong
- Measure actual RTO/RPO vs. targets
- Update runbook with lessons learned
- Identify process improvements
- Notify team of changes

---

## Escalation Path

### Tier 1 (5-minute response)
- **On-Call Engineer**: Detect incident, page team, begin recovery
- **Slack channel**: #incidents (auto-notify)
- **Contact**: PagerDuty escalation

### Tier 2 (15-minute response)
- **Engineering Manager**: Assess severity, authorize customer communications
- **Notify**: Customer Success team (for major accounts)

### Tier 3 (30-minute response)
- **CTO**: Critical business decisions (partial recovery, data loss acceptance)
- **Notify**: Executive team (revenue impact, PR implications)

### External Communications
- **Status Page Update**: Within 5 minutes of detection
- **Customer Email**: Within 15 minutes if RTO > 30 minutes
- **Post-Incident Report**: Within 24 hours

---

## Contact Information

**On-Call Engineering:**
- PagerDuty: https://rasihr.pagerduty.com
- Slack: @on-call-engineer

**Infrastructure Team (Heroku/Supabase):**
- Supabase Support: https://app.supabase.com/support
- Status Pages: https://status.supabase.com

**Third-Party Services:**
- Stripe Support: https://support.stripe.com (chat or ticket)
- Sentry Support: https://forum.sentry.io
- Resend Support: https://support.resend.com

---

**Last Updated:** March 6, 2026  
**Approved By:** CTO
**Next Review:** June 6, 2026
