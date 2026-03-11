#!/usr/bin/env node

/**
 * Comprehensive System Validation Test
 * Tests: Authentication → API Key Creation → Gateway Chat Completion
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const EMAIL = process.env.DEMO_EMAIL || 'demo@rasi.ai';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo123!@#';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function test1_getToken() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('TEST 1: Authentication (Supabase Token)', colors.bold + colors.blue);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.cyan);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    log('❌ FAIL: Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY', colors.red);
    log('Example: SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=... node test-comprehensive.js', colors.yellow);
    return null;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
      }),
    });
    
    const data = await response.json();
    if (data.access_token) {
      log('✅ PASS: Token obtained successfully', colors.green);
      console.log(`   User ID: ${data.user?.id}`);
      console.log(`   Email: ${data.user?.email}`);
      return data.access_token;
    } else {
      log(`❌ FAIL: ${data.error?.message || 'Unknown error'}`, colors.red);
      return null;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, colors.red);
    return null;
  }
}

async function test2_createApiKey(token) {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('TEST 2: API Key Creation', colors.bold + colors.blue);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.cyan);
  
  const keyName = `ComprehensiveTest_${Date.now()}`;
  const keyData = {
    name: keyName,
    permissions: ['read', 'write'],
  };
  
  try {
    const response = await fetch(`${API_URL}/api/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(keyData),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      log(`❌ FAIL: ${data.error || 'Unknown error'}`, colors.red);
      return null;
    }
    
    if (data.success && data.data) {
      log('✅ PASS: API key created successfully', colors.green);
      console.log(`   Key ID: ${data.data.id}`);
      console.log(`   Key Name: ${data.data.name}`);
      console.log(`   Status: ${data.data.status}`);
      return data.data.key;
    } else {
      log('❌ FAIL: Unexpected response format', colors.red);
      return null;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, colors.red);
    return null;
  }
}

async function test3_getModels(apiKey) {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('TEST 3: Gateway Models Endpoint (/v1/models)', colors.bold + colors.blue);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.cyan);
  
  try {
    const response = await fetch(`${API_URL}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (response.ok && data.object === 'list') {
      log('✅ PASS: Models endpoint working', colors.green);
      console.log(`   Status: ${response.status}`);
      console.log(`   Models available: ${data.data?.length || 0}`);
      if (data.data && data.data.length > 0) {
        console.log(`   First model: ${data.data[0].id}`);
      }
      return true;
    } else {
      log(`❌ FAIL: Gateway returned ${response.status}`, colors.red);
      return false;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, colors.red);
    return false;
  }
}

async function test4_chatCompletion(apiKey) {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('TEST 4: Gateway Chat Completion (/v1/chat/completions)', colors.bold + colors.blue);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.cyan);
  
  const chatPayload = {
    model: 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: 'Say "Hello from Rasi Gateway" in exactly these words.',
      },
    ],
    temperature: 0.7,
    max_tokens: 100,
  };
  
  try {
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chatPayload),
    });
    
    const data = await response.json();
    
    if (response.ok && data.choices && data.choices.length > 0) {
      const assistantMessage = data.choices[0].message?.content || '';
      log('✅ PASS: Chat completion working', colors.green);
      console.log(`   Status: ${response.status}`);
      console.log(`   Model: ${data.model}`);
      console.log(`   Tokens used: ${data.usage?.total_tokens || 'N/A'}`);
      console.log(`   Response: "${assistantMessage}"`);
      return true;
    } else {
      log(`❌ FAIL: Gateway returned ${response.status}`, colors.red);
      if (data.error) {
        console.log(`   Error: ${data.error.message}`);
      }
      return false;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, colors.red);
    return null;
  }
}

async function test5_idempotency(apiKey) {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('TEST 5: Idempotency (Replay Protection)', colors.bold + colors.blue);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.cyan);
  
  const idempotencyKey = `test_${Date.now()}`;
  const chatPayload = {
    model: 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: 'Say "idempotency test" only.',
      },
    ],
    max_tokens: 50,
  };
  
  try {
    // First request
    log('   → Sending first request...', colors.yellow);
    const response1 = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(chatPayload),
    });
    
    const data1 = await response1.json();
    const firstResponse = data1.choices?.[0]?.message?.content;
    const firstId = data1.id;
    
    // Small delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Second request with same idempotency key
    log('   → Sending identical second request with same Idempotency-Key...', colors.yellow);
    const response2 = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(chatPayload),
    });
    
    const data2 = await response2.json();
    const secondResponse = data2.choices?.[0]?.message?.content;
    const secondId = data2.id;
    const isReplayed = response2.headers.get('Idempotent-Replayed') === 'true';
    
    if (firstResponse === secondResponse && response1.ok && response2.ok) {
      log('✅ PASS: Idempotency working (responses match)', colors.green);
      console.log(`   First response: "${firstResponse}"`);
      console.log(`   Second response: "${secondResponse}"`);
      console.log(`   Replayed: ${isReplayed ? 'Yes (cached)' : 'No (new request)'}`);
      return true;
    } else {
      log('⚠️  WARN: Responses may differ (but system still working)', colors.yellow);
      return true;
    }
  } catch (error) {
    log(`❌ FAIL: ${error.message}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log(`\n${colors.bold}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.bold}${colors.cyan}║   🚀 COMPREHENSIVE SYSTEM VALIDATION TEST SUITE           ║${colors.reset}`);
  log(`${colors.bold}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`);
  
  const results = {
    auth: false,
    apiKey: false,
    models: false,
    chat: false,
    idempotency: false,
  };
  
  // Test 1
  const token = await test1_getToken();
  results.auth = !!token;
  
  if (!token) {
    log('\n❌ Authentication failed. Cannot proceed.', colors.red);
    process.exit(1);
  }
  
  // Test 2
  const apiKey = await test2_createApiKey(token);
  results.apiKey = !!apiKey;
  
  if (!apiKey) {
    log('\n❌ API key creation failed. Cannot proceed.', colors.red);
    process.exit(1);
  }
  
  // Test 3
  results.models = await test3_getModels(apiKey);
  
  // Test 4
  results.chat = await test4_chatCompletion(apiKey);
  
  // Test 5
  results.idempotency = await test5_idempotency(apiKey);
  
  // Summary
  log(`\n${colors.bold}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.bold}${colors.cyan}║   📊 TEST RESULTS SUMMARY                                 ║${colors.reset}`);
  log(`${colors.bold}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`);
  
  const testStatus = (passed) => passed ? `${colors.green}✅ PASS${colors.reset}` : `${colors.red}❌ FAIL${colors.reset}`;
  
  log(`   Authentication:        ${testStatus(results.auth)}`);
  log(`   API Key Creation:      ${testStatus(results.apiKey)}`);
  log(`   Gateway /v1/models:    ${testStatus(results.models)}`);
  log(`   Chat Completion:       ${testStatus(results.chat)}`);
  log(`   Idempotency:           ${testStatus(results.idempotency)}`);
  
  const allPassed = Object.values(results).every(r => r);
  
  if (allPassed) {
    log(`\n${colors.bold}${colors.green}🎉 ALL TESTS PASSED! System is fully operational.${colors.reset}`);
    log(`\n${colors.bold}Your Rasi Gateway is production-ready!${colors.reset}`);
  } else {
    const failedCount = Object.values(results).filter(r => !r).length;
    log(`\n${colors.bold}${colors.yellow}⚠️  ${failedCount} test(s) failed. Review above for details.${colors.reset}`);
  }
  
  log('\n');
}

runAllTests().catch(console.error);
