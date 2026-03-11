/**
 * Database Seed Script
 * Populates Supabase with sample data for testing
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set before seeding the database.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedDatabase() {
  console.log('🌱 Starting database seed...\n');

  try {
    // 1. Create Organization
    console.log('📦 Creating organization...');
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: 'Acme Corporation',
        slug: 'acme-corp',
        plan: 'enterprise',
        settings: {
          features: ['incident_detection', 'cost_tracking', 'compliance'],
          limits: { agents: 50, users: 100 }
        }
      })
      .select()
      .single();

    if (orgError) throw orgError;
    console.log(`✅ Organization created: ${org.name} (${org.id})\n`);

    // 2. Create Users
    console.log('👥 Creating users...');
    const users = [
      {
        organization_id: org.id,
        email: 'admin@acme.com',
        name: 'Alice Admin',
        role: 'admin',
      },
      {
        organization_id: org.id,
        email: 'manager@acme.com',
        name: 'Bob Manager',
        role: 'manager',
      },
      {
        organization_id: org.id,
        email: 'viewer@acme.com',
        name: 'Charlie Viewer',
        role: 'viewer',
      },
    ];

    const { data: createdUsers, error: usersError } = await supabase
      .from('users')
      .insert(users)
      .select();

    if (usersError) throw usersError;
    console.log(`✅ Created ${createdUsers.length} users`);
    createdUsers.forEach(u => console.log(`   - ${u.name} (${u.role})`));
    console.log();

    // 3. Create AI Agents
    console.log('🤖 Creating AI agents...');
    const agents = [
      {
        organization_id: org.id,
        name: 'Customer Support Bot',
        description: 'Handles customer inquiries and support tickets',
        agent_type: 'support',
        platform: 'openai',
        model_name: 'gpt-4',
        system_prompt: 'You are a helpful customer support agent. Be polite and concise.',
        status: 'active',
        risk_level: 'low',
        risk_score: 25,
        config: {
          temperature: 0.7,
          max_tokens: 500
        }
      },
      {
        organization_id: org.id,
        name: 'Sales Assistant',
        description: 'Helps with sales inquiries and product demos',
        agent_type: 'sales',
        platform: 'anthropic',
        model_name: 'claude-3-opus',
        system_prompt: 'You are a sales assistant. Focus on understanding customer needs.',
        status: 'active',
        risk_level: 'medium',
        risk_score: 50,
        config: {
          temperature: 0.8,
          max_tokens: 1000
        }
      },
      {
        organization_id: org.id,
        name: 'Refund Processor',
        description: 'Handles refund requests',
        agent_type: 'refund',
        platform: 'openai',
        model_name: 'gpt-4',
        system_prompt: 'Process refund requests according to company policy.',
        status: 'active',
        risk_level: 'high',
        risk_score: 85,
        config: {
          temperature: 0.3,
          max_tokens: 300
        }
      },
    ];

    const { data: createdAgents, error: agentsError } = await supabase
      .from('ai_agents')
      .insert(agents)
      .select();

    if (agentsError) throw agentsError;
    console.log(`✅ Created ${createdAgents.length} AI agents`);
    createdAgents.forEach(a => console.log(`   - ${a.name} (${a.risk_level} risk)`));
    console.log();

    // 4. Create Sample Conversations
    console.log('💬 Creating sample conversations...');
    const conversations = [
      {
        organization_id: org.id,
        agent_id: createdAgents[0].id,
        user_id: createdUsers[0].id,
        external_conversation_id: 'slack-12345',
        platform: 'slack',
        status: 'active'
      },
      {
        organization_id: org.id,
        agent_id: createdAgents[1].id,
        user_id: createdUsers[1].id,
        external_conversation_id: 'intercom-67890',
        platform: 'intercom',
        status: 'completed',
        ended_at: new Date().toISOString()
      },
    ];

    const { data: createdConvos, error: convosError } = await supabase
      .from('conversations')
      .insert(conversations)
      .select();

    if (convosError) throw convosError;
    console.log(`✅ Created ${createdConvos.length} conversations\n`);

    // 5. Create Sample Messages
    console.log('📝 Creating sample messages...');
    const messages = [
      {
        conversation_id: createdConvos[0].id,
        role: 'user',
        content: 'I need help with my order #12345',
        token_count: 10,
        cost_usd: 0.0001
      },
      {
        conversation_id: createdConvos[0].id,
        role: 'assistant',
        content: 'I can help you with that! Let me look up your order.',
        token_count: 15,
        cost_usd: 0.00015
      },
    ];

    const { data: createdMsgs, error: msgsError } = await supabase
      .from('messages')
      .insert(messages)
      .select();

    if (msgsError) throw msgsError;
    console.log(`✅ Created ${createdMsgs.length} messages\n`);

    // 6. Create Sample Incident
    console.log('🚨 Creating sample incident...');
    const incident = {
      organization_id: org.id,
      agent_id: createdAgents[2].id,
      conversation_id: createdConvos[1].id,
      incident_type: 'refund_abuse',
      severity: 'high',
      status: 'open',
      title: 'Suspicious refund request pattern detected',
      description: 'Agent attempted to process 5 refunds in 10 minutes',
      trigger_content: 'Process refund for all my orders',
      ai_response: 'I will process those refunds right away'
    };

    const { data: createdIncident, error: incidentError } = await supabase
      .from('incidents')
      .insert(incident)
      .select()
      .single();

    if (incidentError) throw incidentError;
    console.log(`✅ Incident created: ${createdIncident.title}\n`);

    // 7. Create API Key
    console.log('🔑 Creating API key...');
    const apiKey = {
      organization_id: org.id,
      key_hash: 'a'.repeat(64), // Mock hash for testing
      name: 'Production API Key',
      last_four: '1234',
      status: 'active',
      rate_limit_per_minute: 100,
      rate_limit_per_day: 50000,
      allowed_models: ['gpt-4', 'claude-3-opus']
    };

    const { data: createdKey, error: keyError } = await supabase
      .from('api_keys')
      .insert(apiKey)
      .select()
      .single();

    if (keyError) throw keyError;
    console.log(`✅ API key created: ${createdKey.name}\n`);

    // 8. Summary
    console.log('✨ Seed completed successfully!\n');
    console.log('📊 Summary:');
    console.log(`   - Organization: ${org.name}`);
    console.log(`   - Users: ${createdUsers.length}`);
    console.log(`   - AI Agents: ${createdAgents.length}`);
    console.log(`   - Conversations: ${createdConvos.length}`);
    console.log(`   - Messages: ${createdMsgs.length}`);
    console.log(`   - Incidents: 1`);
    console.log(`   - API Keys: 1`);
    console.log();
    console.log('🎯 Next: Test API endpoints with this data!');

    return {
      org,
      users: createdUsers,
      agents: createdAgents,
      conversations: createdConvos,
      incident: createdIncident,
      apiKey: createdKey
    };

  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedDatabase().then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  });
}

module.exports = { seedDatabase };
