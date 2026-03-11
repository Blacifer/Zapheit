#!/usr/bin/env node

/**
 * Test API Key Creation
 * Creates an API key via the backend without needing UI login
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
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function getToken() {
  log('\n🔐 Step 1: Getting Supabase token...', colors.blue);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    log('   ❌ Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY', colors.red);
    log('   Example: SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=... node test-api-key-creation.js', colors.yellow);
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
      log('   ✅ Token obtained', colors.green);
      return data.access_token;
    } else {
      log(`   ❌ Failed to get token: ${data.error?.message || 'Unknown error'}`, colors.red);
      return null;
    }
  } catch (error) {
    log(`   ❌ Error: ${error.message}`, colors.red);
    return null;
  }
}

async function createApiKey(token) {
  log('\n🔑 Step 2: Creating API key via backend...', colors.blue);
  
  const keyName = `DemoKey_${Date.now()}`;
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
      log(`   ❌ Failed: ${data.error || 'Unknown error'}`, colors.red);
      console.log('   Response:', JSON.stringify(data, null, 2));
      return null;
    }
    
    if (data.success && data.data) {
      log('   ✅ API key created successfully!', colors.green);
      console.log(`   Key ID: ${data.data.id}`);
      console.log(`   Key Name: ${data.data.name}`);
      console.log(`   Permissions: ${JSON.stringify(data.data.permissions || keyData.permissions)}`);
      return data.data.key;
    } else {
      log(`   ❌ Unexpected response`, colors.red);
      console.log('   Response:', JSON.stringify(data, null, 2));
      return null;
    }
  } catch (error) {
    log(`   ❌ Error: ${error.message}`, colors.red);
    return null;
  }
}

async function testGateway(apiKey) {
  log('\n🚀 Step 3: Testing gateway with API key...', colors.blue);
  
  try {
    const response = await fetch(`${API_URL}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    if (response.ok) {
      log('   ✅ Gateway is responding!', colors.green);
      console.log(`   Models endpoint status: 200`);
      if (data.object === 'list') {
        console.log(`   Available models: ${data.data?.length || 0}`);
      }
      return true;
    } else {
      log(`   ❌ Gateway error: ${response.status}`, colors.red);
      return false;
    }
  } catch (error) {
    log(`   ❌ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function runTest() {
  log('\n╔═════════════════════════════════════════════════════════╗', colors.cyan);
  log('║  🔑 API Key Creation & Gateway Test                   ║', colors.cyan);
  log('╚═════════════════════════════════════════════════════════╝', colors.cyan);
  
  // Step 1: Get token
  const token = await getToken();
  if (!token) {
    log('\n❌ Failed to authenticate. Exiting.', colors.red);
    process.exit(1);
  }
  
  // Step 2: Create API key
  const apiKey = await createApiKey(token);
  if (!apiKey) {
    log('\n❌ Failed to create API key. Exiting.', colors.red);
    process.exit(1);
  }
  
  log(`\n✨ Your new API key: ${colors.cyan}${apiKey}${colors.reset}`);
  log('   Save this key securely - it will not be shown again!', colors.yellow);
  
  // Step 3: Test gateway
  await testGateway(apiKey);
  
  // Summary
  log('\n╔═════════════════════════════════════════════════════════╗', colors.cyan);
  log('║  📊 Summary                                            ║', colors.cyan);
  log('╚═════════════════════════════════════════════════════════╝', colors.cyan);
  log('\n✅ API key creation successful!', colors.green);
  log('\nYou can now use this key to call the Rasi gateway:', colors.reset);
  log(`\n  curl -X POST ${API_URL}/v1/chat/completions \\`, colors.yellow);
  log(`    -H "Authorization: Bearer ${apiKey}" \\`, colors.yellow);
  log(`    -H "Content-Type: application/json" \\`, colors.yellow);
  log(`    -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`, colors.yellow);
  
  log('\n');
}

runTest().catch(console.error);
