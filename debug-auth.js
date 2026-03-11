#!/usr/bin/env node

/**
 * Debug authentication and API integration
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const EMAIL = process.env.DEMO_EMAIL || 'demo@rasi.ai';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo123!@#';

async function debug() {
  console.log('🔍 Debugging authentication...\n');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY');
    console.error('Example: SUPABASE_URL=https://your-project.supabase.co SUPABASE_ANON_KEY=... node debug-auth.js');
    process.exit(1);
  }

  // Step 1: Sign in
  console.log('Step 1: Signing in...');
  const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
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

  const signInData = await signInResponse.json();
  const token = signInData.access_token;

  if (!token) {
    console.error('❌ Failed to get token');
    console.error(signInData);
    return;
  }

  console.log('✅ Got token');
  console.log('Token (first 50 chars):', token.substring(0, 50) + '...');

  // Decode JWT to see contents
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
  console.log('\n📋 JWT Payload:');
  console.log('  - sub:', payload.sub);
  console.log('  - email:', payload.email);
  console.log('  - iat:', payload.iat);
  console.log('  - exp:', payload.exp);

  // Step 2: Call API
  console.log('\nStep 2: Calling /api/agents with token...');
  const apiResponse = await fetch(`${API_URL}/api/agents`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const apiData = await apiResponse.json();
  console.log('Status:', apiResponse.status);
  console.log('Response:', JSON.stringify(apiData, null, 2));

  if (!apiResponse.ok) {
    console.log('\n❌ API failed. Check backend logs for middleware debug output.');
  } else {
    console.log('\n✅ API succeeded!');
  }
}

debug().catch(console.error);
