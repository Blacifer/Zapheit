#!/usr/bin/env node

/**
 * End-to-End Authentication Test
 * Tests the full flow: Sign up → Sign in → Authenticated API call
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required. Set them in your environment before running this test.');
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testHealthCheck() {
  log('\n🔍 Testing Backend Health Check...', colors.blue);
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    
    if (response.ok) {
      log('✅ Health check passed', colors.green);
      console.log('   Status:', data.status);
      console.log('   Service:', data.service);
      return true;
    } else {
      log('❌ Health check failed', colors.red);
      return false;
    }
  } catch (error) {
    log(`❌ Health check error: ${error.message}`, colors.red);
    return false;
  }
}

async function testSupabaseAuth() {
  log('\n🔐 Testing Supabase Authentication...', colors.blue);
  
  // Use demo credentials
  const testEmail = 'demo@rasi.ai';
  const testPassword = 'Demo123!@#';
  
  try {
    // Try creating the account first
    log('   → Creating demo account...', colors.yellow);
    const signUpResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    
    const signUpData = await signUpResponse.json();
    console.log('   Debug - Sign up response:', JSON.stringify(signUpData, null, 2));
    
    if (signUpData.access_token) {
      log('   ✅ Sign up successful', colors.green);
      console.log('   User ID:', signUpData.user?.id);
      
      return {
        success: true,
        token: signUpData.access_token,
        userId: signUpData.user?.id,
      };
    } else if (signUpData.error || signUpData.code === 400 || signUpData.code === 422) {
      log(`   ⚠️  User exists or error: ${signUpData.msg || signUpData.error?.message}`, colors.yellow);
      
      // Try signing in instead
      log('   → Signing in existing user...', colors.yellow);
      const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      });
      
      const signInData = await signInResponse.json();
      console.log('   Debug - Sign in response status:', signInResponse.status);
      
      if (signInData.access_token) {
        log('   ✅ Sign in successful', colors.green);
        console.log('   User ID:', signInData.user?.id);
        return {
          success: true,
          token: signInData.access_token,
          userId: signInData.user?.id,
        };
      } else {
        console.log('   Debug - Sign in error:', JSON.stringify(signInData, null, 2));
      }
    }
    
    log('   ❌ Authentication failed', colors.red);
    return { success: false };
  } catch (error) {
    log(`   ❌ Auth error: ${error.message}`, colors.red);
    return { success: false };
  }
}

async function testAuthenticatedAPI(token) {
  log('\n🚀 Testing Authenticated API Call...', colors.blue);
  
  try {
    log('   → Fetching agents from API...', colors.yellow);
    const response = await fetch(`${API_URL}/api/agents`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      log('   ✅ API call successful', colors.green);
      console.log('   Agents fetched:', data.data?.length || 0);
      if (data.data?.length > 0) {
        console.log('   First agent:', data.data[0].name);
      }
      return true;
    } else {
      log(`   ❌ API call failed: ${data.error || 'Unknown error'}`, colors.red);
      if (data.errors) {
        console.log('   Errors:', data.errors);
      }
      return false;
    }
  } catch (error) {
    log(`   ❌ API error: ${error.message}`, colors.red);
    return false;
  }
}

async function runTests() {
  log('\n╔═════════════════════════════════════════════════════════╗', colors.blue);
  log('║  🧪 End-to-End Authentication Test Suite              ║', colors.blue);
  log('╚═════════════════════════════════════════════════════════╝\n', colors.blue);
  
  const results = {
    health: false,
    auth: false,
    api: false,
  };
  
  // Test 1: Health Check
  results.health = await testHealthCheck();
  
  if (!results.health) {
    log('\n❌ Backend is not responding. Please ensure the API server is running.', colors.red);
    process.exit(1);
  }
  
  // Test 2: Authentication
  const authResult = await testSupabaseAuth();
  results.auth = authResult.success;
  
  if (!results.auth) {
    log('\n❌ Authentication failed. Check Supabase configuration.', colors.red);
    process.exit(1);
  }
  
  // Test 3: Authenticated API Call
  results.api = await testAuthenticatedAPI(authResult.token);
  
  // Summary
  log('\n╔═════════════════════════════════════════════════════════╗', colors.blue);
  log('║  📊 Test Results Summary                               ║', colors.blue);
  log('╚═════════════════════════════════════════════════════════╝', colors.blue);
  log(`\n   Backend Health:     ${results.health ? '✅ PASS' : '❌ FAIL'}`, results.health ? colors.green : colors.red);
  log(`   Authentication:     ${results.auth ? '✅ PASS' : '❌ FAIL'}`, results.auth ? colors.green : colors.red);
  log(`   API Integration:    ${results.api ? '✅ PASS' : '❌ FAIL'}`, results.api ? colors.green : colors.red);
  
  const allPassed = results.health && results.auth && results.api;
  
  if (allPassed) {
    log('\n🎉 All tests passed! Your backend is production-ready!\n', colors.green);
    process.exit(0);
  } else {
    log('\n⚠️  Some tests failed. Please review the errors above.\n', colors.yellow);
    process.exit(1);
  }
}

runTests();
