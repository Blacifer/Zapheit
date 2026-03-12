# Database Backup & Restore Strategy

## Backup Architecture Overview

RasiSyntheticHR implements **3-tier backup strategy** with:
- **Hourly snapshots** (last 24 hours)
- **Daily full backups** (last 30 days)
- **Weekly archives** (last 12 weeks, cold storage)
- **Point-in-time recovery** (PITR: last 7 days at 1-minute granularity)

**Backup Location:** Supabase managed backups + AWS S3 archival

---

## Backup Schedule

### Daily Automated Backups

| Backup Type | Frequency | Retention | RPO | Use Case |
|------------|-----------|-----------|-----|----------|
| Hourly Snapshot | Every hour | 24 hours | 60 min | Recent outage recovery (quick) |
| Daily Backup | 2 AM UTC | 30 days | 24 hours | Weekly restore tests |
| Weekly Archive | Sundays | 12 weeks | 7 days | Compliance, long-term retention |
| Transaction Log | Continuous | 7 days | 1 min | Point-in-time recovery |

### Backup Verification

**Automated:** Every backup is automatically tested via:
1. Checksum validation on backup creation
2. Restore test to standby database (weekly)
3. Transaction log consistency checks (daily)

**Manual:** Monthly audit by ops team
```bash
# Verify latest backups in Supabase dashboard
# Settings → Backups → List all backup sets
# Expected: At least 30 daily backups visible
# Verify: Each backup < 2 hours old, checksum passes
```

---

## Backup Storage

### Primary: Supabase Managed Backups
- **Location**: Supabase infrastructure (encrypted, geo-redundant)
- **Access**: Via Supabase dashboard or API
- **Cost**: Included in Supabase plan
- **Retention**: Configurable (30 days default, extended to 48 hours for daily backups)

### Secondary: AWS S3 Archival
- **Location**: `s3://rasihr-backups/database/`
- **Frequency**: Nightly sync from Supabase to S3
- **Cost**: ~$1/month at current data volume
- **Retention**: Eternal (for compliance), lifecycle policy to Glacier after 1 year
- **Encryption**: SSE-S3 with versioning enabled

---

## Restore Procedures

### Restore Type 1: Full Database Restore (Complete Failure)

**Use When:**
- Entire database is corrupted or inaccessible
- Ransomware has encrypted the database
- Accidental DROP TABLE * -- on 5+ tables
- **RTO: 20-30 minutes | RPO: 15-60 minutes**

**Steps:**

1. **Choose Backup Point (2-5 min)**
   ```bash
   # Option A: Supabase Dashboard (easiest)
   # Navigate: Settings → Backups → Select backup → Restore
   
   # Option B: Supabase CLI
   supabase db pull  # Downloads schema from backup
   
   # Option C: AWS S3 + pg_restore (if Supabase unavailable)
   aws s3 cp s3://rasihr-backups/database/backup-2026-03-06.sql.gz .
   gunzip backup-2026-03-06.sql.gz
   ```

2. **Stop Current System (3-5 min)**
   - Kill active API connections to prevent writes during restore
   ```bash
   # Via Supabase:
   # Database will be read-only during restore
   
   # Via API:
   kubectl delete pod -l app=synthetic-hr-api -n production
   # Prevents new writes while restore is in progress
   ```

3. **Initiate Restore (1 min)**
   ```bash
   # Via Supabase Dashboard:
   # Click "Restore" button on selected backup
   # Confirm: "This will overwrite current database"
   
   # Via Supabase CLI:
   supabase db reset  # Restores schema + data from backup
   ```

4. **Monitor Restore Progress (10-20 min)**
   ```bash
   # Check completion in Supabase dashboard
   # Or poll restoration status:
   curl https://api.supabase.co/v1/projects/[PROJECT_ID]/database/backups
   
   # Restore typically completes in:
   # - < 5 min for < 100 MB database
   # - 10-15 min for 100-500 MB database
   # - 20-30 min for > 500 MB database
   ```

5. **Verify Data Integrity (3-5 min)**
   ```sql
   -- Run integrity checks
   -- Count tables
   SELECT COUNT(*) as table_count 
   FROM information_schema.tables 
   WHERE table_schema = 'public';
   -- Expected: 16 tables
   
   -- Verify key data
   SELECT COUNT(*) FROM users;           -- Should match pre-outage count
   SELECT COUNT(*) FROM conversations;   -- Should match pre-outage count
   SELECT MAX(created_at) FROM audit_logs;  -- Recent activity
   ```

6. **Restart System (2-3 min)**
   ```bash
   # Restart API servers
   kubectl rollout restart deployment/synthetic-hr-api -n production
   
   # Restart frontend (clear CDN cache)
   aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_ID --paths "/*"
   
   # Verify health
   curl https://api.rasihr.com/health
   ```

**Total Downtime:** 20-30 minutes

---

### Restore Type 2: Point-in-Time Recovery (PITR)

**Use When:**
- Specific data was corrupted/deleted hours ago
- Want to recover to exact timestamp (SQL DELETE was 3 hours ago)
- Need to examine multiple versions
- **RTO: 30-45 minutes | RPO: 1 minute**

**Steps:**

1. **Identify Target Timestamp (5 min)**
   ```sql
   -- Query audit_logs for when bad thing happened
   SELECT action, user_id, resource_name, created_at 
   FROM audit_logs 
   WHERE action = 'DELETE' 
   AND resource_name = 'users'
   ORDER BY created_at DESC 
   LIMIT 5;
   
   -- Target recovery time should be BEFORE the DELETE
   -- E.g., if DELETE happened at 2026-03-06 14:30:00
   -- Recover to 2026-03-06 14:25:00
   ```

2. **Create Recovery Database (3-5 min)**
   ```bash
   # Supabase doesn't offer PITR restore directly
   # Workaround: Restore latest backup, then manually apply transaction logs
   
   # Via pg_basebackup (if you have WAL-G configured):
   pg_basebackup --wal-method stream \
     -D /var/lib/postgresql/recovery \
     -h [host] -U [user] \
     --checkpoint=fast -v -P
   ```

3. **Recover Transaction Logs to Target Time (10-15 min)**
   ```bash
   # Set recovery.target_timeline in PostgreSQL
   # PostgreSQL will automatically replay WAL files up to target time
   # Then restart the recovery database
   ```

4. **Validate Recovered Data (5 min)**
   ```sql
   -- Query the recovery database
   SELECT * FROM users ORDER BY id LIMIT 5;
   
   -- Verify counts match expected state at that time
   SELECT COUNT(*) FROM users WHERE created_at < '2026-03-06 14:25:00';
   ```

5. **Copy Data Back (if needed) (10 min)**
   ```sql
   -- If recovery database has good data, copy to production
   INSERT INTO users (id, email, name, ...)
   SELECT id, email, name, ... FROM recovery_db.public.users
   WHERE id NOT IN (SELECT id FROM production.users)
   AND created_at < '2026-03-06 14:25:00';
   ```

**Total Recovery Time:** 30-45 minutes

**Note:** For easier PITR, enable WAL-G archival in Supabase settings.

---

### Restore Type 3: Selective Table Recovery

**Use When:**
- Only 1-2 tables are corrupted
- Other data is fine and shouldn't be overwritten
- Need to preserve recent writes
- **RTO: 15-20 minutes | RPO: Varies**

**Steps:**

1. **Backup Current State (1 min)**
   ```bash
   # Export corrupted table for forensics
   pg_dump -t conversations > corrupted_conversations.sql
   ```

2. **Restore Single Table (5 min)**
   ```bash
   # Option A: From recent backup file
   # Download backup from S3
   aws s3 cp s3://rasihr-backups/database/backup-2026-03-06.sql.gz .
   
   # Extract only the corrupted table
   gunzip backup-2026-03-06.sql.gz
   grep "^COPY conversations" backup-2026-03-06.sql > conversations-backup.sql
   
   # Option B: From Supabase backup API
   # Request table schema + data from known-good backup
   ```

3. **Clear Corrupted Data (1 min)**
   ```sql
   -- Delete bad data
   DELETE FROM conversations WHERE created_at > '2026-03-06 14:00:00';
   
   -- Or truncate if completely corrupted
   -- TRUNCATE conversations CASCADE;  -- Be very careful!
   ```

4. **Restore from Backup (3-5 min)**
   ```bash
   # Use pg_restore to load single table
   pg_restore --data-only --table=conversations \
     -d synthetic-hr backup-2026-03-06.sql
   ```

5. **Verify Counts (1 min)**
   ```sql
   SELECT COUNT(*) FROM conversations;  -- Should match pre-outage count
   ```

**Total Recovery Time:** 15-20 minutes

---

## How to Test Backups

### Monthly Restore Test

**1st Monday of each month, 5 AM UTC:**

```bash
#!/bin/bash
# test-restore.sh

# Step 1: Create temporary restore environment
aws rds create-db-instance-read-replica \
  --db-instance-identifier semantic-hr-production \
  --db-instance-identifier synthetic-hr-production-restore-test

# Step 2: Wait for completion
aws rds wait db-instance-available

# Step 3: Run validation queries
psql -h synthetic-hr-production-restore-test.xxx.us-east-1.rds.amazonaws.com \
  -U postgres \
  -c "SELECT COUNT(*) FROM users;"
  
psql -h synthetic-hr-production-restore-test.xxx.us-east-1.rds.amazonaws.com \
  -U postgres \
  -c "SELECT COUNT(*) FROM conversations;"

# Step 4: Delete read replica
aws rds delete-db-instance \
  --db-instance-identifier synthetic-hr-production-restore-test \
  --skip-final-snapshot

# Step 5: Log results
echo "Restore test completed at $(date)" >> /var/log/restore-tests.log
```

**Expected Outcomes:**
- Read replica creation: < 10 minutes
- Row counts match production: ✓
- No restore errors: ✓
- Cleanup automatic: ✓

### Post-Restore Validation Checklist

After ANY restore operation:

- [ ] `SELECT COUNT(*) FROM users` > 0
- [ ] `SELECT COUNT(*) FROM organizations` > 0
- [ ] `SELECT COUNT(*) FROM api_keys WHERE is_active` > 0
- [ ] `SELECT MAX(created_at) FROM audit_logs` is recent
- [ ] `SELECT COUNT(*) FROM conversations` matches expected baseline
- [ ] No `NULL` values in critical columns (id, created_at, org_id)
- [ ] Foreign key constraints are intact (no orphaned records)

---

## Backup Failure Response

### Scenario: Backup Creation Failed

**Detection:**
- Backup job in Supabase dashboard shows error status
- Sentry alert: "Backup verification checksum failed"
- No backup created within 24 hours

**Response (Time: 5-10 min):**

1. **Verify Database is Healthy**
   ```bash
   # Check connectivity
   psql -h [host] -U [user] -c "SELECT 1"
   
   # Check disk space
   SELECT pg_database_size('synthetic_hr') / 1024 / 1024 AS size_mb;
   ```

2. **Retry Backup Manually**
   ```bash
   # Via Supabase UI: Click "Create backup now"
   # Or via CLI:
   # supabase start  # Ensures local backups are enabled
   ```

3. **Check Backup Logs**
   ```bash
   # Supabase dashboard: Settings → Backups → View logs
   # Look for: "Backup failed due to..."
   # Common causes:
   # - Insufficient disk space
   # - Database locked by long-running query
   # - WAL archival misconfigured
   ```

4. **If Repeated Failures:**
   - Contact Supabase support with backup logs
   - Implement temporary AWS S3 daily dump as fallback
   ```bash
   pg_dump synthetic_hr | gzip > backup-$(date +%Y%m%d).sql.gz
   aws s3 cp backup-$(date +%Y%m%d).sql.gz s3://rasihr-backups/
   ```

---

## Long-Term Backup Retention

### Archive Strategy (Compliance)

**Requirement:** Keep backups for 7 years (SOC 2, HIPAA if applicable)

1. **First 30 days:** Supabase (frequent restore tests needed)
2. **Days 31-90:** AWS S3 Standard ($0.023/GB/month)
3. **Days 91+:** AWS S3 Glacier ($0.004/GB/month)

**Implementation:**
```bash
# S3 Lifecycle Policy (applied to rasihr-backups bucket)
{
  "Rules": [
    {
      "Id": "ArchiveOldBackups",
      "Status": "Enabled",
      "Prefix": "database/",
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ],
      "Expiration": {
        "Days": 2555  # 7 years
      }
    }
  ]
}
```

**Cost Example (100 MB database):**
- 30 Supabase backups × 100 MB = 3 GB: $0.12/month
- 60 AWS S3 Standard backups × 100 MB = 6 GB: $0.14/month
- 365 AWS S3 Glacier backups × 100 MB = 36.5 GB: $0.15/month
- **Total: ~$0.41/month (increases with schema size)**

---

## Disaster Scenario: Complete AWS Region Failure

**Use Case:** AWS region containing S3 backups is completely down

**Failover Procedure (Time: 30-45 min):**

1. **Restore to Standby Region (20-30 min)**
   - Supabase automatically maintains US-EAST-1 primary and EU-WEST-1 replica
   - Failover is automatic in Supabase (no action needed)
   - Or trigger manual failover: Supabase Settings → Database → Failover

2. **Sync Backups to Secondary Region (5-10 min)**
   ```bash
   # Copy S3 backups from us-east-1 to us-west-2
   aws s3 sync s3://rasihr-backups/ \
     s3://rasihr-backups-uswest2/ \
     --region us-west-2 \
     --copy-props none
   ```

3. **Update Database Connection String**
   - Point API to new region endpoint
   - Update: DATABASE_URL environment variable
   - Restart API servers

---

## Monitoring & Alerts

**Backup Health Dashboard:**
- [ ] Create Grafana dashboard showing:
  - Last backup timestamp
  - Backup duration (trend)
  - Backup size (GB)
  - Restore test results (pass/fail weekly)

**Alerting Rules:**
```yaml
# Alert if no backup in 25 hours
alert:
  - name: NoRecentBackup
    condition: time_since_last_backup > 25h
    severity: critical
    action: PagerDuty page on-call

# Alert if backup duration > 30 minutes (may indicate issues)
alert:
  - name: SlowBackup
    condition: backup_duration_minutes > 30
    severity: warning
    action: Slack @ops-team

# Alert if restore test fails
alert:
  - name: RestoreTestFailed
    condition: restore_test_status == "failed"
    severity: critical
    action: PagerDuty immediate escalation
```

---

**Last Updated:** March 6, 2026  
**Owner:** Database Team  
**Review Schedule:** Quarterly (next: June 6, 2026)
