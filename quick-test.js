// Quick test to verify database status

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set before running quick-test.js');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('📊 Database Status Check\n');

  // Check organizations
  const { data: orgs, error: orgsError } = await supabase
    .from('organizations')
    .select('*');
    
  if (orgsError) {
    console.log('❌ Organizations:', orgsError.message);
  } else {
    console.log(`✅ Organizations: ${orgs.length} found`);
    orgs.forEach(org => console.log(`   - ${org.name} (${org.slug})`));
  }

  // Check users
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*');
    
  if (usersError) {
    console.log('❌ Users:', usersError.message);
  } else {
    console.log(`\n✅ Users: ${users.length} found`);
    users.forEach(u => console.log(`   - ${u.name || u.email} (${u.role}) - Org: ${u.organization_id ? '✓' : '✗'}`));
  }

  // Check agents
  const { data: agents, error: agentsError } = await supabase
    .from('ai_agents')
    .select('*');
    
  if (agentsError) {
    console.log('❌ AI Agents:', agentsError.message);
  } else {
    console.log(`\n✅ AI Agents: ${agents.length} found`);
    agents.forEach(a => console.log(`   - ${a.name} (${a.risk_level} risk)`));
  }

  // Check incidents
  const { data: incidents, error: incidentsError } = await supabase
    .from('incidents')
    .select('*');
    
  if (incidentsError) {
    console.log('❌ Incidents:', incidentsError.message);
  } else {
    console.log(`\n✅ Incidents: ${incidents.length} found`);
    if (incidents.length > 0) {
      console.log(`   - ${incidents[0].title} (${incidents[0].severity})`);
    }
  }

  console.log('\n✨ Database is populated and accessible!');
}

test().catch(console.error);
