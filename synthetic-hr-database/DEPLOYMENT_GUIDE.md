# Database Schema Deployment Guide

## IMMEDIATE ACTION REQUIRED

The database schema must be deployed to PostgreSQL before any API calls will work. This has been identified as **CRITICAL BLOCKER #3**.

## Deployment Options

### Option 1: Deploy to Supabase (Recommended)

**Steps:**

1. Go to **Supabase Dashboard** → Your Project
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `migration_001_core_schema.sql`
5. Paste into the SQL editor
6. Click **Run**
7. Verify all tables created successfully

**Expected Output:**
```
Organizations          | 0
Users                  | 0
AI Agents              | 0
Conversations          | 0
Messages               | 0
Incidents              | 0
Escalations            | 0
Cost Tracking          | 0
Performance Reviews    | 0
API Keys               | 0
Idempotency Keys       | 0
Audit Logs             | 0
API Usage Metrics      | 0
```

**Time to Deploy:** 2-3 minutes

### Option 2: Deploy via psql CLI

If you have a local PostgreSQL instance or remote connection:

```bash
# Export your database URL
export DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Run migration
psql $DATABASE_URL < migration_001_core_schema.sql
```

**Time to Deploy:** 1-2 minutes

### Option 3: Deploy via Docker Compose (Local Development Only)

```bash
# Start PostgreSQL
docker-compose -f docker-compose.postgres.yml up -d

# Wait for container to be ready
sleep 10

# Run migration
docker exec postgres_container psql -U postgres -d synthetic_hr -f migration_001_core_schema.sql
```

## What Gets Created

**14 Tables with:**
- ✅ Foreign key references
- ✅ Proper indexes for query performance
- ✅ UUID primary keys
- ✅ Timestamps for audit trails
- ✅ JSONB columns for flexible data

**Tables:**
1. organizations (multi-tenant)
2. users (with role-based access)
3. ai_agents (platform definitions)
4. conversations (external platform conversations)
5. messages (conversation transcripts)
6. incidents (detected issues)
7. escalations (alert routing)
8. cost_tracking (AI model costs)
9. performance_reviews (agent quality metrics)
10. api_keys (gateway authentication) ← **NEW**
11. gateway_idempotency_keys (duplicate prevention) ← **NEW**
12. audit_logs (compliance trail) ← **NEW**
13. api_usage_metrics (cost analysis) ← **NEW**

## Verify Deployment

### From Supabase Dashboard:

1. Click **SQL Editor**
2. Click **New Query**
3. Run this verification query:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

Should show 14 tables in the results.

### From psql CLI:

```bash
psql $DATABASE_URL -c "\dt"
```

## Environment Variables

After deployment, ensure your application is pointing to the correct database:

### Development (.env.local)
```
DATABASE_URL=postgresql://user:password@localhost:5432/synthetic_hr_local
```

### Testing (.env.test)
```
DATABASE_URL=postgresql://user:password@localhost:5432/synthetic_hr_test
```

### Staging (.env.staging)
```
DATABASE_URL=postgresql://user:password@staging-db:5432/synthetic_hr_staging
```

### Production (.env.production)
```
DATABASE_URL=postgresql://user:password@prod-db:5432/synthetic_hr_production
```

## Rollback (If Needed)

To remove all tables and start fresh:

```sql
DROP TABLE IF EXISTS api_usage_metrics CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS gateway_idempotency_keys CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS performance_reviews CASCADE;
DROP TABLE IF EXISTS cost_tracking CASCADE;
DROP TABLE IF EXISTS escalations CASCADE;
DROP TABLE IF EXISTS incidents CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS ai_agents CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
```

Then re-run the migration.

## Next Steps (After Deployment)

1. ✅ Verify all tables created
2. 🔄 Connect Node.js application to database
3. 🔄 Run smoke tests to verify connectivity
4. 🔄 Run application against staging database

**Timeline:** 2-3 minutes for deployment + 5 minutes for verification

## Troubleshooting

### Error: "Extension uuid-ossp does not exist"

**Solution:** Supabase automatically enables this. If you see this error, try again from the SQL Editor.

### Error: "Relations do not exist"

**Solution:** Tables didn't create properly. Run rollback (above) and retry.

### Connection timeout

**Solution:** 
- Verify DATABASE_URL is correct
- Check firewall/network access
- Try from Supabase SQL Editor first (web-based, no connection issues)

## Production Checklist

Before going to production:

- [ ] Database migrated to production PostgreSQL
- [ ] All 14 tables verified
- [ ] .env.production DATABASE_URL configured
- [ ] Backup created before migration
- [ ] Read replicas configured (if applicable)
- [ ] Monitoring alerts set up

**Critical:** Never test migrations on production. Always test on staging first.
