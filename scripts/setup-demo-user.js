#!/usr/bin/env node

/**
 * Setup demo user in database
 * Creates or updates user record with organization assignment
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TEST_USER_ID = '3d56db6b-0d48-4c91-88e7-9f5d2e24926b';
const TEST_EMAIL = 'demo@rasi.ai';
const TARGET_ORG_SLUG = process.env.ORG_SLUG || 'rasi-solutions';
const TARGET_ROLE = process.env.DEMO_ROLE || 'admin';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables must be set');
  process.exit(1);
}

async function setupDemoUser() {
  try {
    console.log('Setting up demo user in database...');

    const headers = {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
    };

    // Resolve the target organization. Prefer an explicit slug, otherwise
    // fall back to the first available organization so the script can still
    // repair a local/dev environment with older seed data.
    let org_id = null;
    let resolvedOrgSlug = null;

    const orgResult = await fetch(
      `${SUPABASE_URL}/rest/v1/organizations?slug=eq.${encodeURIComponent(TARGET_ORG_SLUG)}&select=id,slug,name&limit=1`,
      { headers }
    );
    const orgs = await orgResult.json();

    if (orgs && orgs.length > 0) {
      org_id = orgs[0].id;
      resolvedOrgSlug = orgs[0].slug;
    } else {
      const fallbackOrgResult = await fetch(
        `${SUPABASE_URL}/rest/v1/organizations?select=id,slug,name&order=created_at.asc&limit=1`,
        { headers }
      );
      const fallbackOrgs = await fallbackOrgResult.json();

      if (!fallbackOrgs || fallbackOrgs.length === 0) {
        console.error('❌ No organizations found. Seed an organization before assigning the demo user.');
        process.exit(1);
      }

      org_id = fallbackOrgs[0].id;
      resolvedOrgSlug = fallbackOrgs[0].slug;
      console.warn(`⚠️ Organization slug "${TARGET_ORG_SLUG}" not found. Falling back to "${resolvedOrgSlug}".`);
    }

    console.log(`Using organization: ${resolvedOrgSlug} (${org_id})`);

    // Check if user already exists in users table
    console.log('\nChecking if user exists...');
    const checkResult = await fetch(
      `${SUPABASE_URL}/rest/v1/users?or=(id.eq.${TEST_USER_ID},email.eq.${encodeURIComponent(TEST_EMAIL)})&select=id,email`,
      { headers }
    );
    
    const existingUsers = await checkResult.json();
    
    if (existingUsers && existingUsers.length > 0) {
      const existingUser = existingUsers.find((user) => user.id === TEST_USER_ID) || existingUsers[0];
      console.log(`User exists (${existingUser.id}), updating...`);
      const updateResult = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${existingUser.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            email: TEST_EMAIL,
            organization_id: org_id,
            role: TARGET_ROLE,
            name: 'Demo User',
          }),
        }
      );
      
      if (updateResult.ok) {
        console.log('✅ User updated with organization');
      } else {
        const error = await updateResult.json();
        console.error('❌ Failed to update user:', error);
        process.exit(1);
      }
    } else {
      // User doesn't exist, create it
      console.log('User does not exist, creating...');
      const createResult = await fetch(
        `${SUPABASE_URL}/rest/v1/users`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: TEST_USER_ID,
            email: TEST_EMAIL,
            organization_id: org_id,
            role: TARGET_ROLE,
            name: 'Demo User',
          }),
        }
      );
      
      if (createResult.ok) {
        console.log('✅ User created with organization');
      } else {
        const error = await createResult.json();
        console.error('❌ Failed to create user:', error);
        console.error('Response status:', createResult.status);
        process.exit(1);
      }
    }
    
    // Verify the user now has organization_id
    console.log('\nVerifying user setup...');
    const verifyResult = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${TEST_USER_ID}&select=id,email,organization_id,role,name`,
      { headers }
    );
    
    const verifyUsers = await verifyResult.json();
    if (verifyUsers && verifyUsers.length > 0) {
      const user = verifyUsers[0];
      console.log('✅ Demo user setup complete!');
      console.log(`   ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Organization: ${user.organization_id}`);
      console.log(`   Role: ${user.role}`);
      process.exit(0);
    } else {
      console.error('❌ User verification failed - user not found after setup');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setupDemoUser();
