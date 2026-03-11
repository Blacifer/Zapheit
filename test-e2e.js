/**
 * End-to-End API Tests
 * Tests the full flow against the live API with authentication
 */

const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Test user credentials
const TEST_EMAIL = 'admin@acme.com'; // From seed-database.js
const TEST_PASSWORD = 'Admin123!@#'; // Default test password

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

let authToken = null;

function logTest(name, passed, error = null) {
  results.tests.push({ name, passed, error });
  if (passed) {
    results.passed++;
    console.log(`✅ ${name}`);
  } else {
    results.failed++;
    console.log(`❌ ${name}`);
    if (error) console.log(`   Error: ${error}`);
  }
}

async function authenticate() {
  console.log('🔐 Authenticating...');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('❌ Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY');
    return false;
  }
  try {
    // Try to sign in with test credentials
    const response = await axios.post(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        email: TEST_EMAIL,
        password: TEST_PASSWORD
      },
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.access_token) {
      authToken = response.data.access_token;
      console.log(`✅ Authenticated as ${TEST_EMAIL}\n`);
      return true;
    }
  } catch (error) {
    // If authentication fails, try demo user
    console.log('⚠️  Test user not found, trying demo user...');
    try {
      const response = await axios.post(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          email: 'demo@rasi.ai',
          password: 'Demo123!@#'
        },
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.access_token) {
        authToken = response.data.access_token;
        console.log(`✅ Authenticated as demo@rasi.ai\n`);
        return true;
      }
    } catch (demoError) {
      console.log('❌ Authentication failed. Tests will run unauthenticated.\n');
      return false;
    }
  }
  return false;
}

function getAuthHeaders() {
  return authToken ? {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  } : 
{
    'Content-Type': 'application/json'
  };
}

async function runTests() {
  console.log('🧪 Starting E2E Tests\n');
  console.log(`📍 API: ${API_BASE}\n`);

  // Authenticate first
  await authenticate();

  try {
    // Test 1: Health Check
    console.log('=== Health & Status ===');
    try {
      const health = await axios.get(`${API_BASE}/health`);
      logTest(
        'Health check returns 200',
        health.status === 200 && health.data.status === 'ok'
      );
    } catch (error) {
      logTest('Health check returns 200', false, error.message);
    }

    // Test 2: API Documentation
    try {
      const docs = await axios.get(`${API_BASE}/api/docs`);
      logTest('API docs endpoint accessible', docs.status === 200);
    } catch (error) {
      logTest('API docs endpoint accessible', false, error.message);
    }
    console.log();

    // Test 3: Agents endpoint
    console.log('=== AI Agents ===');
    try {
      const agents = await axios.get(`${API_BASE}/api/agents`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/agents returns agents list',
        agents.status === 200 && Array.isArray(agents.data)
      );
      
      if (agents.data.length > 0) {
        console.log(`   Found ${agents.data.length} agents:`);
        agents.data.slice(0, 3).forEach(a => console.log(`     - ${a.name} (${a.risk_level} risk)`));
      }
    } catch (error) {
      logTest('GET /api/agents returns agents list', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 4: Incidents endpoint
    console.log('=== Incidents ===');
    try {
      const incidents = await axios.get(`${API_BASE}/api/incidents`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/incidents returns incidents list',
        incidents.status === 200 && Array.isArray(incidents.data)
      );
      
      if (incidents.data.length > 0) {
        console.log(`   Found ${incidents.data.length} incidents:`);
        incidents.data.slice(0, 3).forEach(i => console.log(`     - ${i.title} (${i.severity})`));
      }
    } catch (error) {
      logTest('GET /api/incidents returns incidents list', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 5: Conversations endpoint
    console.log('=== Conversations ===');
    try {
      const conversations = await axios.get(`${API_BASE}/api/conversations`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/conversations returns conversations list',
        conversations.status === 200 && Array.isArray(conversations.data)
      );
      
      if (conversations.data.length > 0) {
        console.log(`   Found ${conversations.data.length} conversations`);
      }
    } catch (error) {
      logTest('GET /api/conversations returns conversations list', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 6: Cost Tracking
    console.log('=== Cost Tracking ===');
    try {
      const costs = await axios.get(`${API_BASE}/api/cost-tracking`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/cost-tracking returns cost data',
        costs.status === 200
      );
    } catch (error) {
      logTest('GET /api/cost-tracking returns cost data', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 7: Performance Reviews
    console.log('=== Performance Reviews ===');
    try {
      const reviews = await axios.get(`${API_BASE}/api/performance-reviews`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/performance-reviews returns review data',
        reviews.status === 200 && Array.isArray(reviews.data)
      );
    } catch (error) {
      logTest('GET /api/performance-reviews returns review data', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 8: Escalations
    console.log('=== Escalations ===');
    try {
      const escalations = await axios.get(`${API_BASE}/api/escalations`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/escalations returns escalation data',
        escalations.status === 200 && Array.isArray(escalations.data)
      );
    } catch (error) {
      logTest('GET /api/escalations returns escalation data', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 9: API Keys
    console.log('=== API Keys ===');
    try {
      const keys = await axios.get(`${API_BASE}/api/api-keys`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/api-keys returns key data',
        keys.status === 200 && Array.isArray(keys.data)
      );
      
      if (keys.data.length > 0) {
        console.log(`   Found ${keys.data.length} API keys`);
      }
    } catch (error) {
      logTest('GET /api/api-keys returns key data', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 10: Compliance Logs
    console.log('=== Compliance ===');
    try {
      const compliance = await axios.get(`${API_BASE}/api/compliance/logs`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/compliance/logs returns log data',
        compliance.status === 200 && Array.isArray(compliance.data)
      );
    } catch (error) {
      logTest('GET /api/compliance/logs returns log data', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 11: Policies
    console.log('=== Policies ===');
    try {
      const policies = await axios.get(`${API_BASE}/api/policies`, { headers: getAuthHeaders() });
      logTest(
        'GET /api/policies returns policy data',
        policies.status === 200 && Array.isArray(policies.data)
      );
    } catch (error) {
      logTest('GET /api/policies returns policy data', false, error.response?.data?.error || error.message);
    }
    console.log();

    // Test 12: RBAC - Unauthorized access
    console.log('=== RBAC & Security ===');
    try {
      // Try to delete an agent without auth (should fail)
      await axios.delete(`${API_BASE}/api/agents/test-id`);
      logTest('DELETE /api/agents/:id without auth rejected', false, 'Should have been rejected');
    } catch (error) {
      // Should get 401 or 403
      logTest(
        'DELETE /api/agents/:id without auth rejected',
        error.response?.status === 401 || error.response?.status === 403
      );
    }
    console.log();

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  console.log();

  if (results.failed > 0) {
    console.log('❌ Failed Tests:');
    results.tests
      .filter(t => !t.passed)
      .forEach(t => console.log(`   - ${t.name}`));
    console.log();
  }

  if (results.passed === results.tests.length) {
    console.log('🎉 All tests passed! System is production-ready.\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Review errors above.\n');
    process.exit(1);
  }
}

// Run tests
runTests();
