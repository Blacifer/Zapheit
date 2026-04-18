#!/usr/bin/env node

/**
 * Bootstrap or repair an operator account for a real organization.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 * - OPERATOR_EMAIL
 * - OPERATOR_NAME
 * - OPERATOR_PASSWORD
 * - ORG_NAME
 * - ORG_SLUG
 *
 * Optional env:
 * - OPERATOR_ROLE (default: super_admin)
 * - OPERATOR_EMAIL_CONFIRMED (default: true)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || '';
const OPERATOR_NAME = process.env.OPERATOR_NAME || '';
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD || '';
const ORG_NAME = process.env.ORG_NAME || '';
const ORG_SLUG_INPUT = process.env.ORG_SLUG || '';
const OPERATOR_ROLE = process.env.OPERATOR_ROLE || 'super_admin';
const OPERATOR_EMAIL_CONFIRMED = process.env.OPERATOR_EMAIL_CONFIRMED !== 'false';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

if (!OPERATOR_EMAIL || !OPERATOR_NAME || !OPERATOR_PASSWORD || !ORG_NAME || !ORG_SLUG_INPUT) {
  console.error('OPERATOR_EMAIL, OPERATOR_NAME, OPERATOR_PASSWORD, ORG_NAME, and ORG_SLUG must be set');
  process.exit(1);
}

const normalizedSlug = ORG_SLUG_INPUT
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 100);

if (!normalizedSlug) {
  console.error('ORG_SLUG resolves to an empty slug after normalization');
  process.exit(1);
}

async function main() {
  const { createClient } = require('/Users/patty/Downloads/RasiZapheit/zapheit-api/node_modules/@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let organizationId = null;

  const { data: existingOrg, error: orgLookupError } = await supabase
    .from('organizations')
    .select('id,name,slug')
    .eq('slug', normalizedSlug)
    .maybeSingle();

  if (orgLookupError) {
    console.error('Failed to look up organization:', orgLookupError.message);
    process.exit(1);
  }

  if (existingOrg) {
    organizationId = existingOrg.id;
    console.log(`Using existing organization ${existingOrg.slug} (${organizationId})`);
  } else {
    const { data: createdOrg, error: createOrgError } = await supabase
      .from('organizations')
      .insert([{
        name: ORG_NAME,
        slug: normalizedSlug,
        plan: 'audit',
      }])
      .select('id,name,slug')
      .single();

    if (createOrgError || !createdOrg) {
      console.error('Failed to create organization:', createOrgError?.message || 'Unknown error');
      process.exit(1);
    }

    organizationId = createdOrg.id;
    console.log(`Created organization ${createdOrg.slug} (${organizationId})`);
  }

  const { data: authUsers, error: listUsersError } = await supabase.auth.admin.listUsers();
  if (listUsersError) {
    console.error('Failed to list auth users:', listUsersError.message);
    process.exit(1);
  }

  let authUser = authUsers.users.find((user) => user.email?.toLowerCase() === OPERATOR_EMAIL.toLowerCase()) || null;

  if (!authUser) {
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email: OPERATOR_EMAIL,
      password: OPERATOR_PASSWORD,
      email_confirm: OPERATOR_EMAIL_CONFIRMED,
      user_metadata: {
        full_name: OPERATOR_NAME,
        organization_name: ORG_NAME,
      },
    });

    if (createUserError || !createdUser.user) {
      console.error('Failed to create auth user:', createUserError?.message || 'Unknown error');
      process.exit(1);
    }

    authUser = createdUser.user;
    console.log(`Created auth user ${OPERATOR_EMAIL} (${authUser.id})`);
  } else {
    console.log(`Using existing auth user ${OPERATOR_EMAIL} (${authUser.id})`);

    const { error: updateAuthUserError } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: OPERATOR_PASSWORD,
      email_confirm: OPERATOR_EMAIL_CONFIRMED,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        full_name: OPERATOR_NAME,
        organization_name: ORG_NAME,
      },
    });

    if (updateAuthUserError) {
      console.error('Failed to update auth user:', updateAuthUserError.message);
      process.exit(1);
    }
  }

  const { data: existingProfile, error: profileLookupError } = await supabase
    .from('users')
    .select('id,email,organization_id,role')
    .or(`id.eq.${authUser.id},email.eq.${OPERATOR_EMAIL}`)
    .limit(1)
    .maybeSingle();

  if (profileLookupError) {
    console.error('Failed to look up user profile:', profileLookupError.message);
    process.exit(1);
  }

  if (existingProfile) {
    const { error: updateProfileError } = await supabase
      .from('users')
      .update({
        email: OPERATOR_EMAIL,
        name: OPERATOR_NAME,
        role: OPERATOR_ROLE,
        organization_id: organizationId,
      })
      .eq('id', existingProfile.id);

    if (updateProfileError) {
      console.error('Failed to update user profile:', updateProfileError.message);
      process.exit(1);
    }

    console.log(`Updated operator profile ${existingProfile.id}`);
  } else {
    const { error: createProfileError } = await supabase
      .from('users')
      .insert([{
        id: authUser.id,
        email: OPERATOR_EMAIL,
        name: OPERATOR_NAME,
        role: OPERATOR_ROLE,
        organization_id: organizationId,
      }]);

    if (createProfileError) {
      console.error('Failed to create user profile:', createProfileError.message);
      process.exit(1);
    }

    console.log(`Created operator profile ${authUser.id}`);
  }

  console.log('\nBootstrap complete');
  console.log(`Organization: ${ORG_NAME} (${normalizedSlug})`);
  console.log(`Operator: ${OPERATOR_EMAIL}`);
  console.log(`Role: ${OPERATOR_ROLE}`);
}

main().catch((error) => {
  console.error('Bootstrap failed:', error.message);
  process.exit(1);
});
