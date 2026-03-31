#!/usr/bin/env node

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@rasi.ai';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '';
const normalizedApiBase = API_URL.replace(/\/+$/, '');
const agentsEndpoint = normalizedApiBase.endsWith('/api')
  ? `${normalizedApiBase}/agents`
  : `${normalizedApiBase}/api/agents`;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEMO_PASSWORD) {
  console.error('❌ SUPABASE_URL, SUPABASE_ANON_KEY, and DEMO_PASSWORD must be set before running test-api.js');
  process.exit(1);
}

async function test() {
  // Sign in
  const signInResponse = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  
  const signInData = await signInResponse.json();
  const token = signInData.access_token;
  
  console.log('✅ Token obtained');
  console.log(`🚀 Calling API ${agentsEndpoint}...`);
  
  try {
    const apiResponse = await fetch(agentsEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('📊 Response Status:', apiResponse.status);
    const apiData = await apiResponse.json();
    console.log('📋 Response Data:', JSON.stringify(apiData, null, 2));
    
    if (apiResponse.ok && apiData.success) {
      console.log('\n✅ SUCCESS! API returned agents data');
    } else {
      console.log('\n❌ API returned error:', apiData.error);
    }
  } catch (err) {
    console.error('\n❌ API call failed with error:');
    console.error('Error type:', err.constructor.name);
    console.error('Message:', err.message);
    console.error('Code:', err.code);
  }
}

test().catch(console.error);
