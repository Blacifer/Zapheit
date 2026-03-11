# 🚨 CRITICAL BLOCKERS - IMMEDIATE ACTION PLAN
## Fix These First (Next 24-48 Hours)

**Status:** ⚠️ BLOCKING PRODUCTION DEPLOYMENT  
**Timeline:** 24-48 hours to fix all 6 blockers  
**Owner:** Tech Lead / Senior Developer  
**Estimated Effort:** 50-70 hours total (1-2 weeks)

---

## 🔴 BLOCKER #1: AUTH ROUTES NOT INTEGRATED (0.5 hours)

### The Problem
```typescript
// ✅ Routes exist in src/routes/auth.ts
export default router;  // Has password-reset and password-confirm endpoints

// ❌ But they're NEVER MOUNTED in index.ts
// Missing line in src/index.ts:
app.use('/auth', authRoutes);  // THIS IS MISSING!
```

### Impact
- Users cannot reset passwords
- No way to obtain authentication tokens
- All protected endpoints return 401

### The Fix (30 minutes)

**File:** `synthetic-hr-api/src/index.ts`

**Find this section:**
```typescript
// Routes
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);  // ← MIGHT BE HERE BUT CHECK
app.use('/admin', adminRoutes);
```

**If missing, add:**
```typescript
// Routes
app.use('/auth', authRoutes);      // ← ADD THIS LINE
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/costs', costsRoutes);
app.use('/performance', performanceReviewsRoutes);
app.use('/api-keys', apiKeysRoutes);
app.use('/escalations', escalationsRoutes);
app.use('/invites', invitesRoutes);
app.use('/connectors', connectorsRoutes);
app.use('/metrics', metricsRoutes);
app.use('/policies', policiesRoutes);
app.use('/compliance', complianceRoutes);
app.use('/gateway', gatewayRoutes);
```

**Verify:**
```bash
cd synthetic-hr-api
npm run build  # Check for errors
curl http://localhost:3001/auth/password-reset  # Should exist (method not allowed)
```

---

## 🔴 BLOCKER #2: SUPABASE AUTH NOT INTEGRATED (4-6 hours)

### The Problem
```typescript
// auth.ts routes exist BUT don't call Supabase
export async function passwordReset(req: Request): Promise<PasswordResetResponse> {
  // ✅ Validates email format
  // ❌ Doesn't actually call Supabase!
  return { success: true, message: 'Password reset sent' };  // FAKE!
  
  // Missing:
  // await supabase.auth.resetPasswordForEmail(email)
}
```

### Impact
- Password reset button doesn't work
- No JWT tokens generated
- Users can't authenticate
- All API calls fail with 401

### The Fix (6-8 hours)

**File:** `synthetic-hr-api/src/routes/auth.ts`

**Step 1: Import Supabase client**
```typescript
import { supabase } from '../lib/supabase-client';  // Already exists?
```

**Step 2: Implement password reset**
```typescript
export async function passwordReset(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    
    // Validate
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
    // ← ADD THIS: Call Supabase
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`
    });
    
    if (error) throw error;
    
    // Return success
    res.json({ success: true, message: 'Password reset email sent' });
  } catch (error) {
    next(error);
  }
}
```

**Step 3: Implement password confirm**
```typescript
export async function passwordConfirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = req.body;
    
    // Validate password
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password too short' });
    }
    
    // ← ADD THIS: Call Supabase
    const { error } = await supabase.auth.updateUser({
      password: password
    });
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    next(error);
  }
}
```

**Verify:**
```bash
# Test password reset
curl -X POST http://localhost:3001/auth/password-reset \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
# Should return: { success: true, message: "Password reset email sent" }
```

---

## 🔴 BLOCKER #3: TEST TYPESCRIPT ERROR (1 hour)

### The Problem
```typescript
// src/__tests__/unit.test.ts line 31
expect(req.headers.authorization).toBeUndefined();
// ERROR: Property 'authorization' does not exist on type '{}'
```

### Impact
- `npm test` fails to compile
- Blue-green deployment can't run tests
- CI/CD pipeline breaks

### The Fix (1 hour)

**File:** `synthetic-hr-api/src/__tests__/unit.test.ts`

**Around line 30-35, find:**
```typescript
const req = {
  headers: {}
} as Request;
```

**Change to:**
```typescript
const req = {
  headers: {
    authorization: undefined
  }
} as unknown as Request;
```

**Or better, use proper typing:**
```typescript
import { Request, Response } from 'express';

const req = {
  headers: {
    authorization: undefined,
    'content-type': 'application/json'
  },
  body: {},
  params: {}
} as unknown as Request;
```

**Verify:**
```bash
cd synthetic-hr-api
npm run build     # Should succeed
npm test          # Should show 59 tests passing
npm run test:coverage  # Check coverage
```

---

## 🔴 BLOCKER #4: DATABASE SCHEMA NOT DEPLOYED (2-3 hours)

### The Problem
```typescript
// Code runs but crashes at runtime:
const result = await client.query('SELECT * FROM api_keys WHERE id = $1');
// ERROR: relation "api_keys" does not exist

// And also missing:
// - audit_logs table
// - gateway_idempotency_keys table
```

### Impact
- First API call crashes
- No idempotency = duplicates
- No audit trail
- No rate limiting

### The Fix (3-4 hours)

**Step 1: Review schema**
```bash
cat synthetic-hr-database/schema.sql | head -100
# Check if tables exist
```

**Step 2: Create missing tables**

**File to create:** `synthetic-hr-database/migrations/001_create_api_tables.sql`

```sql
-- Missing tables for gateway
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    rate_limit INTEGER DEFAULT 1000,  -- Per minute
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gateway_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE NOT NULL,
    request_fingerprint VARCHAR(255) NOT NULL,
    response_body TEXT,
    response_status INTEGER,
    is_valid BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX idx_gateway_idempotency_keys_fingerprint ON gateway_idempotency_keys(request_fingerprint);
CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
```

**Step 3: Deploy to database**
```bash
# Using psql
psql -U postgres -d synthetic_hr -f synthetic-hr-database/migrations/001_create_api_tables.sql

# Verify
psql -U postgres -d synthetic_hr -c "\dt"
# Should show: api_keys, gateway_idempotency_keys, audit_logs
```

---

## 🔴 BLOCKER #5: RBAC INCOMPLETE (8-12 hours)

### The Problem
```typescript
// Protected endpoints (8 total):
app.post('/api/agents', requirePermission('agents.create'), ...)

// UNPROTECTED endpoints (20+ total):
app.post('/api/costs', ...)  // No RBAC!
app.put('/api/compliance/:id', ...)  // No RBAC!
app.post('/api/incidents/resolve', ...)  // No RBAC!
app.post('/api/escalations', ...)  // No RBAC!
// ... and many more
```

### Impact
- Anyone can modify costs
- Anyone can change compliance settings
- No role enforcement
- Audit trail incomplete

### The Fix (12-16 hours)

**Step 1: Audit all endpoints (2 hours)**
```bash
cd synthetic-hr-api/src/routes

# Search for all POST/PUT/DELETE
grep -r "app\.post\|app\.put\|app\.delete" *.ts | wc -l
# Count approximately 30+ endpoints

# Check which have requirePermission
grep -r "requirePermission" *.ts | wc -l
# Current: ~8 protected
```

**Step 2: Add RBAC to each write endpoint (8 hours)**

**Template for each route:**
```typescript
// Before:
router.post('/incidents/resolve', async (req, res, next) => {
  // Resolve incident
});

// After:
router.post('/incidents/resolve', 
  requirePermission('incidents.resolve'),  // ← ADD THIS
  async (req, res, next) => {
    // Resolve incident
  }
);
```

**Create permission matrix:**
```typescript
// src/lib/permissions.ts
export const PERMISSIONS = {
  'agents.create': ['super_admin', 'admin'],
  'agents.update': ['super_admin', 'admin'],
  'agents.kill': ['super_admin'],
  'incidents.resolve': ['super_admin', 'admin', 'manager'],
  'incidents.read': ['super_admin', 'admin', 'manager', 'viewer'],
  'costs.read': ['super_admin', 'admin', 'manager'],
  'costs.update': ['super_admin', 'admin'],
  'compliance.read': ['super_admin', 'admin'],
  'compliance.update': ['super_admin'],
  'settings.update': ['super_admin'],
  'users.invite': ['super_admin', 'admin'],
  'roles.assign': ['super_admin'],
  // ... etc
};
```

**Step 3: Add role assignment UI (4 hours)**
- Create API endpoint: `PUT /api/users/:id/role`
- Update frontend to show role dropdown
- Test role change flow

**Verify:**
```bash
# Test as different roles
curl -H "Authorization: Bearer viewer_token" \
  -X POST http://localhost:3001/api/costs \
  -d '{"...": "..."}'
# Should return 403 Forbidden

curl -H "Authorization: Bearer admin_token" \
  -X POST http://localhost:3001/api/costs \
  -d '{"...": "..."}'
# Should return 200 Success
```

---

## 🔴 BLOCKER #6: ENVIRONMENT SEPARATION MISSING (2 hours)

### The Problem
```
.env              ← Single file for all environments
.env.example      ← No variants

Problems:
- Staging uses production database
- Tests affect real data
- No way to safely test schema changes
- Accidental production changes
```

### Impact
- Testing corrupts production data
- Cannot safely deploy new schema
- Multi-team development impossible

### The Fix (2 hours)

**Step 1: Create environment files**

**File:** `synthetic-hr-api/.env.local`
```
NODE_ENV=local
PORT=3001
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=synthetic_hr_local
REDIS_URL=redis://localhost:6379/1
FRONTEND_URL=http://localhost:5173
```

**File:** `synthetic-hr-api/.env.test`
```
NODE_ENV=test
PORT=3001
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=synthetic_hr_test
REDIS_URL=redis://localhost:6379/2
FRONTEND_URL=http://localhost:5173
```

**File:** `synthetic-hr-api/.env.staging`
```
NODE_ENV=staging
PORT=3001
DB_HOST=staging-db.example.com
DB_USER=staging_user
DB_PASSWORD=<secure>
DB_NAME=synthetic_hr_staging
REDIS_URL=redis://staging-redis:6379
FRONTEND_URL=https://staging.synthetic-hr.com
```

**File:** `synthetic-hr-api/.env.production`
```
NODE_ENV=production
PORT=3001
DB_HOST=prod-db.example.com
DB_USER=prod_user
DB_PASSWORD=<secure>
DB_NAME=synthetic_hr_production
REDIS_URL=redis://prod-redis:6379
FRONTEND_URL=https://synthetic-hr.com
```

**Step 2: Update startup scripts**

**File:** `synthetic-hr-api/package.json`
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:staging": "NODE_ENV=staging npm run start",
    "dev:prod": "NODE_ENV=production npm run start",
    "test": "NODE_ENV=test jest",
    "test:staging": "NODE_ENV=staging jest",
    "start": "node dist/index.js"
  }
}
```

**Step 3: Verify separation**
```bash
# Local development
npm run dev  # Uses .env.local

# Staging
NODE_ENV=staging npm run build && NODE_ENV=staging npm run start

# Production
NODE_ENV=production npm run build && NODE_ENV=production npm run start

# Tests
NODE_ENV=test npm test
```

---

## ✅ VERIFICATION CHECKLIST (After fixes)

### After Each Blocker Fix
- [ ] Code compiles: `npm run build` ✅
- [ ] Tests pass: `npm test` ✅
- [ ] No TypeScript errors
- [ ] No runtime errors on API calls

### After All Blockers Fixed
- [ ] `npm run build` succeeds
- [ ] `npm test` shows 59/59 passing
- [ ] `npm run test:coverage` shows >70%
- [ ] API endpoints respond (no 501 errors)
- [ ] Database schema deployed
- [ ] Auth flow works (test login → API call)
- [ ] RBAC enforced (role-based access)
- [ ] Observability operational (health checks)

---

## 📊 EFFORT ESTIMATION

| Blocker | Effort | Timeline | Owner |
|---------|--------|----------|-------|
| #1: Auth Routes | 0.5 hrs | Same day | Junior Dev |
| #2: Supabase Integration | 6 hrs | Day 1 | Mid Dev |
| #3: TypeScript Error | 1 hr | <1 hour | Any Dev |
| #4: Database Schema | 3 hrs | Day 1 | DBA/Backend |
| #5: RBAC Completion | 12 hrs | Day 2 | Senior Dev |
| #6: Environment Sep | 2 hrs | Day 1 | Any Dev |
| **TOTAL** | **24.5 hrs** | **1-2 Days** | **Parallel** |

---

## 🚀 PARALLEL WORK TRACK

**Day 1 (8 hours parallel):**
- Dev 1: #3 TypeScript error (1 hr) + #6 Environment (2 hrs) = 3 hrs
- Dev 2: #1 Auth routes (0.5 hr) + #4 Database (3 hrs) = 3.5 hrs
- Dev 3: #2 Supabase (6 hrs) = 6 hrs
- **Total Day 1:** 3 devs × 8 hrs = 24 hrs of capacity needed, 12.5 hrs of work → ~4-6 hours elapsed

**Day 2 (8 hours parallel):**
- Dev 1: #5 RBAC part 1 (4 hrs)
- Dev 2: #5 RBAC part 2 (4 hrs)
- Dev 3: Testing + Verification (8 hrs)
- **Total Day 2:** 3 devs × 8 hrs = 24 hrs of capacity needed, 16 hrs of work → ~8-10 hours elapsed

**Realistic Timeline:** 1.5 days with 3 developers

---

## 📞 ESCALATION PROTOCOL

**If you get stuck:**

### TypeScript Error
- → Ask: CTO / Senior TypeScript dev
- → Reference: TypeScript handbook types

### Auth/Supabase
- → Ask: Backend team lead
- → Reference: Supabase Auth docs

### Database
- → Ask: DBA / Database team
- → Reference: Database schema docs

### RBAC
- → Ask: Senior backend engineer
- → Reference: RBAC design doc

---

## ✅  SIGN-OFF PROCESS

After all 6 blockers are fixed:

1. **Code Review** (1 hour)
   - Another dev reviews all changes
   - Verifies no regressions

2. **Testing** (30 min)
   - Run full test suite
   - Check coverage
   - Load test

3. **Staging Deployment** (1 hour)
   - Deploy to staging
   - Run smoke tests
   - Verify auth flow

4. **CTO Approval** (30 min)
   - CTO reviews fixes
   - Approves for next phase
   - Signs off

---

**Ready to start? Pick one blocker and go!** 🚀

