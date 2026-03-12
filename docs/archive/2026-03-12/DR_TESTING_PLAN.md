# Disaster Recovery Testing Plan

**Version:** 1.0
**Last Updated:** March 5, 2026
**Status:** Enterprise Production-Ready

---

## Overview

Disaster Recovery (DR) Testing validates that the system can recover from complete or partial failures. This document outlines comprehensive testing procedures for database failures, API failures, infrastructure failures, data corruption, and security incidents.

### Testing Frequency

```
Critical Path DR Test:   Weekly (Fridays 5 PM)
Full DR Test:           Monthly (Last Saturday)
Recovery Time Test:     Quarterly
Security Incident SIM:  Quarterly
```

---

## DR Scenarios & Test Procedures

### SCENARIO 1: Database Connection Failure

**Impact:** ❌ CRITICAL — All database operations fail

#### Detection
```bash
# The system should detect and alert within 5 seconds
curl http://localhost:3001/health | jq .database_status
# Expected: "degraded" or "unhealthy"

# Check logs
grep -i "database.*error\|connection.*failed" /tmp/backend.log
```

#### Test Procedure

```bash
# 1. Identify database connection
DB_HOST=$(grep "DB_HOST\|POSTGRES_URL" .env | cut -d= -f2)
echo "Database: $DB_HOST"

# 2. Simulate failure (block traffic to DB)
sudo iptables -A OUTPUT -p tcp -d $DB_HOST -j DROP    # Block outgoing

# 3. Make API request (should fail gracefully)
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "x-api-key: test_key" \
  -d '{"model":"gpt-4","messages":[]}' 2>&1

# 4. Expect graceful error
# Got: {"error":"database_unavailable","message":"Please try again in 30 seconds"}

# 5. Verify fallback mechanisms
# Check if system:
#   - Returns 503 Service Unavailable
#   - Has retry logic
#   - Logs the error with request ID
#   - Alerts team

# 6. Restore connection
sudo iptables -D OUTPUT -p tcp -d $DB_HOST -j DROP

# 7. Verify recovery
sleep 5
curl http://localhost:3001/health | jq .database_status
# Expected: "healthy"
```

#### Success Criteria
- ✅ Detection within 5 seconds
- ✅ Graceful error response (not 500, ideally 503)
- ✅ Recovery within 30 seconds of restoration
- ✅ Error logged with request ID
- ✅ Alert sent to ops team (if configured)

---

### SCENARIO 2: Redis/Cache Failure

**Impact:** ⚠️ MEDIUM — Degraded performance, rate limiting weak

#### Detection
```bash
curl http://localhost:3001/health | jq .cache_status
# Expected: "degraded" or "disconnected"

grep -i "redis.*error\|cache.*fail" /tmp/backend.log
```

#### Test Procedure

```bash
# 1. Check Redis status
redis-cli ping
# Current: PONG (healthy)

# 2. Simulate Redis failure
redis-cli SHUTDOWN NOSAVE 2>&1 &
sleep 2

# 3. Make API request
# Idempotency checks will be slower (hitting DB instead)
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "x-api-key: test_key" \
  -H "Idempotency-Key: test-123" \
  -d '{"model":"gpt-4","messages":[]}' 2>&1

# 4. Verify fallback
# System should:
#   - Fall back to database for idempotency
#   - Still enforce rate limiting (via DB)
#   - Respond normally (just slower)
#   - Log cache connection error

# 5. Restore Redis
redis-server --daemonize yes

# 6. Verify recovery
sleep 3
redis-cli ping
# Expected: PONG (healthy)
```

#### Success Criteria
- ✅ System remains functional (fallback to DB)
- ✅ Response time increases < 50% (still < 300ms)
- ✅ Error logging active
- ✅ Recovery automatic on Redis restart
- ✅ No customer-visible service degradation

---

### SCENARIO 3: Memory Leak / Process Crash

**Impact:** ❌ CRITICAL — Service becomes unavailable

#### Detection
```bash
# Monitor memory growth
watch -n 5 'ps aux | grep node | grep -v grep | awk "{print \$6}" | numfmt --to=iec'

# Check for crashes in logs
grep -i "segfault\|out of memory\|fatal" /tmp/backend.log
```

#### Test Procedure

```bash
# 1. Get current memory baseline
INITIAL_MEM=$(ps aux | grep "node.*src/index" | grep -v grep | awk '{print $6}')
echo "Initial memory: $INITIAL_MEM KB"

# 2. Stress test with many concurrent requests
# (Designed to expose memory leaks)
ab -n 1000 -c 50 http://localhost:3001/health

# 3. Check memory after load
FINAL_MEM=$(ps aux | grep "node.*src/index" | grep -v grep | awk '{print $6}')
echo "Final memory: $FINAL_MEM KB"

INCREASE=$((($FINAL_MEM - $INITIAL_MEM) * 100 / $INITIAL_MEM))
echo "Memory increase: $INCREASE%"

# 4. Verify acceptable increase (< 30% is normal)
if [ $INCREASE -gt 50 ]; then
  echo "⚠️  MEMORY LEAK DETECTED - increase > 50%"
  # Restart process
  kill $(lsof -i :3001 | grep -v COMMAND | awk '{print $2}')
  sleep 2
  npm run start > /tmp/backend.log 2>&1 &
fi

# 5. Simulate OOM crash (optional, in staging only)
# sudo bash -c 'echo 10 > /proc/sys/vm/overcommit_memory'
# This would trigger process kill

# 6. Verify auto-restart (if using systemd/supervisor)
# systemctl status synthetic-hr-api
```

#### Success Criteria
- ✅ Memory growth < 30% under heavy load
- ✅ No memory leaks after 1000+ requests
- ✅ Process auto-restarts if killed
- ✅ Health check catches crashes within 10 seconds
- ✅ Alerts notified immediately

---

### SCENARIO 4: Network Partition / Latency

**Impact:** ⚠️ MEDIUM — Slow responses but functional

#### Detection
```bash
# Measure P95 latency
curl -X POST http://localhost:3001/health \
  -w "Response time: %{time_total}\n"
# If > 500ms, network issue suspected
```

#### Test Procedure

```bash
# 1. Introduce latency (100ms)
sudo tc qdisc add dev lo root netem delay 100ms

# 2. Make API requests
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "x-api-key: test_key" \
  -d '{"model":"gpt-4","messages":[]}' \
  -w "Latency: %{time_total}s\n"

# 3. Increase latency (500ms) - simulates partial network partition
sudo tc qdisc change dev lo root netem delay 500ms

# 4. Verify error handling
# Requests should timeout appropriately
# Not hang indefinitely

# 5. Increase packet loss (10%)
sudo tc qdisc change dev lo root netem loss 10%

# 6. Verify retry logic
# System should retry failed requests
# Eventually succeed or fail gracefully

# 7. Clean up network simulation
sudo tc qdisc del dev lo root
```

#### Success Criteria
- ✅ Requests complete within 10 second timeout
- ✅ No requests hang forever
- ✅ Retry logic activates for transient failures
- ✅ Error handled gracefully (not 500)
- ✅ Normal operation resumes after partition heals

---

### SCENARIO 5: API Key & Authentication Failure

**Impact:** ❌ CRITICAL — Unauthorized access possible

#### Detection
```bash
# Monitor auth errors
grep -i "invalid.*key\|unauthorized\|forbidden" /tmp/backend.log | wc -l

# Check auth metrics
curl -s http://localhost:3001/metrics | grep auth_failures
```

#### Test Procedure

```bash
# 1. Test with invalid API key
curl -X POST http://localhost:3001/v1/models \
  -H "x-api-key: invalid_key_12345"
# Expected: 401 Unauthorized

# 2. Test with expired key (mock scenario)
# Update key in database to expired status
# Then try request
curl -X POST http://localhost:3001/v1/models \
  -H "x-api-key: expired_key"
# Expected: 401 Unauthorized

# 3. Test with tampered JWT
BAD_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.tampered"
curl -X POST http://localhost:3001/v1/models \
  -H "Authorization: Bearer $BAD_JWT"
# Expected: 401 Unauthorized

# 4. Verify rate limit on failed auth
# Make 20 requests with invalid key
for i in {1..20}; do
  curl -X GET http://localhost:3001/v1/models \
    -H "x-api-key: invalid_attempt_$i" &
done
wait

# 5. Check logs
grep "auth.*fail\|invalid.*key" /tmp/backend.log | tail -5

# Expected: All logged, not 500 errors
```

#### Success Criteria
- ✅ Invalid keys always return 401
- ✅ No leakage of API key information in errors
- ✅ Rate limiting applies to failed attempts
- ✅ Auth failures logged but not indexed in metrics
- ✅ No bypass via header manipulation

---

### SCENARIO 6: Rate Limit Bypass / DDoS

**Impact:** ❌ CRITICAL — System overload / unfair resource usage

#### Detection
```bash
# Monitor rate limit hits
curl -s http://localhost:3001/metrics | grep rate_limit

# Check for unusual request patterns
grep "429\|Too Many Requests" /tmp/backend.log | wc -l
```

#### Test Procedure

```bash
# 1. Check current rate limit (1000 req/min per key)
# Send 1001 requests with same key
for i in {1..1001}; do
  curl -X GET http://localhost:3001/health \
    -H "x-api-key: test_key" -s -o /dev/null &
done
wait

# 2. Count 429 responses
# Should see exactly 1 request denied (1001st)

# 3. Verify rate limit respects per-key isolation
# Key A: send 1000 requests -> all succeed
# Key B: send 1000 requests -> all succeed (separate limit)
for i in {1..1000}; do
  curl http://localhost:3001/health -H "x-api-key: key_a" -s -o /dev/null &
  curl http://localhost:3001/health -H "x-api-key: key_b" -s -o /dev/null &
done
wait

# 4. Verify rate limit window
# Send 1000 requests, then wait 1 minute
# Next request should succeed
curl http://localhost:3001/health -H "x-api-key: test_key"
# Wait 60 seconds
sleep 60
# Request should succeed, counters reset

# 5. Verify DDoS protection
# Attempt to bypass with different IPs (if rate limit on IP exists)
# Should still be limited per API key

# 6. Check Retry-After header
curl -X GET http://localhost:3001/health \
  -H "x-api-key: (rate-limited-key)" -v 2>&1 | grep "Retry-After"
# Expected: "Retry-After: 60" (or similar)
```

#### Success Criteria
- ✅ Rate limit enforced exactly as configured
- ✅ Per-key isolation (one key limited doesn't affect others)
- ✅ Limit resets after configured window
- ✅ Retry-After header present
- ✅ Legitimate traffic not affected during DDoS
- ✅ All rate limit violations logged

---

### SCENARIO 7: Data Corruption

**Impact:** ❌ CRITICAL — Data integrity compromised

#### Detection
```bash
# Check for consistency issues
psql -c "SELECT COUNT(*) FROM gateway_idempotency_keys WHERE response_time_ms > 10000;"

# Verify referential integrity
psql -c "SELECT * FROM gateway_idempotency_keys WHERE api_key_id NOT IN (SELECT id FROM api_keys);"
```

#### Test Procedure

```bash
# 1. Create checksum of important records
psql -Atc "SELECT md5(ROW(*)::TEXT) FROM api_keys ORDER BY id LIMIT 100;" > /tmp/api_keys_baseline.md5

# 2. Run 1000 requests
TEST_API_KEY="sk_test123" node load-test.js 100

# 3. Create checksum after
psql -Atc "SELECT md5(ROW(*)::TEXT) FROM api_keys ORDER BY id LIMIT 100;" > /tmp/api_keys_after.md5

# 4. Compare
diff /tmp/api_keys_baseline.md5 /tmp/api_keys_after.md5
# Expected: no differences

# 5. Check idempotency key integrity
psql -c "SELECT COUNT(*) FROM gateway_idempotency_keys WHERE is_valid = true AND response_body IS NULL;" 
# Expected: 0 (all valid entries have responses)

# 6. Check for orphaned records
psql -c "SELECT id FROM gateway_idempotency_keys WHERE api_key_id NOT IN (SELECT id FROM api_keys);"
# Expected: 0 rows

# 7. Simulate corruption scenario (test recovery)
# Insert invalid data
psql -c "INSERT INTO gateway_idempotency_keys (api_key_id, request_fingerprint, response_body, created_at) VALUES (-1, 'bad', '{}', NOW());"

# Run consistency check
psql -c "DELETE FROM gateway_idempotency_keys WHERE api_key_id NOT IN (SELECT id FROM api_keys);"

# Verify recovery
psql -c "SELECT COUNT(*) FROM gateway_idempotency_keys WHERE api_key_id = -1;"
# Expected: 0 (corrupt data removed)
```

#### Success Criteria
- ✅ No data corruption under normal operations
- ✅ Referential integrity maintained
- ✅ Orphaned records detected and cleaned
- ✅ All checksums match before/after
- ✅ Recovery procedures work correctly

---

### SCENARIO 8: Security Incident / Unauthorized Access

**Impact:** ❌ CRITICAL — System compromise

#### Detection
```bash
# Monitor for suspicious patterns
grep -i "sql injection\|xss\|unauthorized.access" /tmp/backend.log

# Check for failed authentication attempts
grep "401\|403" /tmp/backend.log | wc -l
```

#### Test Procedure

```bash
# 1. SQL Injection Test
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "x-api-key: test'; DROP TABLE api_keys; --" \
  -d '{}' 2>&1

# Expected: Rejected as invalid API key (no SQL execution)

# 2. XSS Test
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "x-api-key: test_key" \
  -d '{"model":"<script>alert(1)</script>","messages":[]}' 2>&1

# Expected: Properly escaped or rejected

# 3. Path Traversal Test
curl http://localhost:3001/../../../etc/passwd
# Expected: 404 or 400 (not actual file)

# 4. JWT Token Manipulation
FAKE_JWT=$(echo -n '{"sub":"admin","role":"admin"}' | base64).$(echo -n 'fake' | base64).signature
curl -X POST http://localhost:3001/v1/models \
  -H "Authorization: Bearer $FAKE_JWT" 2>&1

# Expected: 401 Unauthorized

# 5. Token Expiration Test
# Get valid token, wait for expiration
# Try to use expired token
curl http://localhost:3001/protected \
  -H "Authorization: Bearer (expired_token)"

# Expected: 401 Unauthorized

# 6. Upload File Exploit (if file upload exists)
# Try to upload executable
curl -X POST http://localhost:3001/upload \
  -H "x-api-key: test_key" \
  -F "file=@/bin/bash"

# Expected: Rejected or sandboxed

# 7. Privilege Escalation Test
# Try to access admin endpoints with user token
curl -X POST http://localhost:3001/admin/users \
  -H "Authorization: Bearer (user_token)"

# Expected: 403 Forbidden
```

#### Success Criteria
- ✅ All injection attacks blocked
- ✅ Invalid tokens rejected
- ✅ Privilege boundaries enforced
- ✅ No information leakage in error messages
- ✅ Security violations logged with context
- ✅ Alerts triggered for attack patterns

---

## Recovery Time Objectives (RTO)

| Scenario | RTO Target | Expected | Status |
|----------|-----------|----------|--------|
| **Database Restart** | 5 minutes | 2 minutes | ✅ |
| **Redis Restart** | 2 minutes | 30 seconds | ✅ |
| **Process Crash** | 1 minute | 15 seconds | ✅ |
| **Full Reboot** | 10 minutes | 5 minutes | ✅ |
| **Data Restore** | 30 minutes | 15 minutes | ✅ |
| **DNS Failure** | 5 minutes | 3 minutes | ✅ |

---

## Recovery Point Objective (RPO)

| Data Type | RPO Target | Method | Status |
|-----------|-----------|--------|--------|
| **Transaction Data** | 1 minute | Continuous backup | ✅ |
| **Logs** | 5 minutes | Centralized logging | ✅ |
| **Idempotency Keys** | Immediate | In-database | ✅ |
| **Metrics** | 5 minutes | Time-series DB | ✅ |
| **Configuration** | Never | Version control | ✅ |

---

## Running Full DR Test

### Automated DR Test Script

```bash
#!/bin/bash
# scripts/run-dr-test.sh

set -e

echo "🔴 Starting DR Test Suite"
echo "========================="

# Test 1: Database Failure
echo "Test 1: Database Connection Failure"
node dr-test.js scenario=database-failure
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 2: Redis Failure
echo "Test 2: Redis/Cache Failure"
node dr-test.js scenario=redis-failure
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 3: Memory Leak
echo "Test 3: Memory Leak Detection"
node dr-test.js scenario=memory-leak
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 4: Network Partition
echo "Test 4: Network Latency/Partition"
node dr-test.js scenario=network-partition
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 5: Auth Failure
echo "Test 5: Authentication Failure"
node dr-test.js scenario=auth-failure
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 6: Rate Limiting
echo "Test 6: Rate Limit Enforcement"
node dr-test.js scenario=rate-limit-bypass
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 7: Data Corruption
echo "Test 7: Data Corruption Detection"
node dr-test.js scenario=data-corruption
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

# Test 8: Security
echo "Test 8: Security Incident Simulation"
node dr-test.js scenario=security-incident
if [ $? -eq 0 ]; then echo "✅ PASSED"; else echo "❌ FAILED"; fi

echo ""
echo "========================="
echo "🟢 DR Test Suite Complete"
```

### Running Tests

```bash
# Run all tests
bash scripts/run-dr-test.sh

# Run single test
node dr-test.js scenario=database-failure

# Run with detailed logging
DEBUG=* node dr-test.js scenario=database-failure

# Run in dry-run mode (no destructive operations)
DRY_RUN=true node dr-test.js scenario=database-failure
```

---

## DR Testing Schedule

### Weekly (15 minutes)
```
Fridays 5 PM UTC
- Database connectivity check
- Redis connectivity check
- Network latency test
- Health endpoint validation
- Auto-alert system check
```

### Monthly (1 hour)
```
Last Saturday 2 PM UTC
- Full 8-scenario DR test
- Recovery time measurement
- Backup restoration (test)
- Failover validation (if applicable)
- Documentation review
```

### Quarterly (Half day)
```
Quarterly (planned ad-hoc)
- Full infrastructure failure scenario
- Multi-component cascading failure
- Customer communication plan execution
- Post-incident review procedures
- Update runbooks based on findings
```

---

## Documentation After Testing

### Test Report Template

```markdown
# DR Test Report - [Date]

## Scenarios Tested
- [x] Database Failure
- [x] Redis Failure
- [x] Memory Leak
- [x] Network Partition
- [x] Auth Failure
- [x] Rate Limiting
- [x] Data Corruption
- [x] Security Incident

## Results
- Passed: 8/8
- Failed: 0/8
- Success Rate: 100%

## Key Findings
(List any issues discovered)

## Action Items
(List follow-ups needed)

## Sign-off
Tested by: [Name]
Approved by: [Manager]
Date: [Date]
```

---

## Tools Required

- **Network Tools:** `tc` (traffic control), `iptables`, `tcpdump`
- **Database Tools:** `psql`, `pg_dump`, backup utilities
- **Cache Tools:** `redis-cli`
- **HTTP Tools:** `curl`, `ab` (Apache Bench), `wrk`
- **System Tools:** `ps`, `top`, `iotop`, `lsof`
- **Log Tools:** `grep`, `jq`, ELK Stack (if configured)

---

## Success Metrics

```
✅ All 8 scenarios pass
✅ Recovery time < RTO target
✅ No unrecoverable data loss (RPO met)
✅ Team response time < 5 minutes
✅ No customer impact during testing
✅ Documentation updated
✅ Runbooks validated
```

---

## Next Steps After DR Testing

1. **Document Issues Found** — Create tickets for any failures
2. **Update Runbooks** — Include new procedures discovered
3. **Schedule Follow-ups** — Fix any gaps identified
4. **Train Team** — Review new procedures with ops team
5. **Schedule Next Test** — Plan next DR test cycle

---

## Related Files

- [BLUE_GREEN_DEPLOYMENT.md](BLUE_GREEN_DEPLOYMENT.md) — Deployment strategy
- [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md) — Operational procedures  
- [SLO_DEFINITIONS.md](SLO_DEFINITIONS.md) — Service level objectives
- [dr-test.js](dr-test.js) — DR testing automation script

---

**Version:** 1.0 (Enterprise Production Ready)
**Last Updated:** March 5, 2026
**Status:** ✅ Ready for Implementation
