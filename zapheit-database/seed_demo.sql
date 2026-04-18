-- Optional demo seed data for local development.
-- Safe to run multiple times (uses ON CONFLICT DO NOTHING).

-- Insert demo organization and data
INSERT INTO organizations (name, slug, plan) VALUES
    ('Rasi Solutions Demo', 'rasi-demo', 'enterprise')
ON CONFLICT (slug) DO NOTHING;

-- Get the demo org ID
DO $$
DECLARE
    demo_org_id UUID;
BEGIN
    SELECT id INTO demo_org_id FROM organizations WHERE slug = 'rasi-demo';

    -- Insert demo user if not exists
    INSERT INTO users (organization_id, email, name, role)
    VALUES (demo_org_id, 'demo@rasi.ai', 'Demo User', 'admin')
    ON CONFLICT (email) DO NOTHING;

    -- Insert demo AI agents
    INSERT INTO ai_agents (organization_id, name, description, agent_type, platform, model_name, status, risk_level, risk_score)
    VALUES
        (demo_org_id, 'Support Bot', 'Customer Support Agent', 'support', 'openai', 'gpt-4', 'active', 'low', 25),
        (demo_org_id, 'Sales Bot', 'Sales Assistant', 'sales', 'openai', 'gpt-4-turbo', 'active', 'low', 35),
        (demo_org_id, 'Refund Bot', 'Refund Processing Agent', 'refund', 'anthropic', 'claude-3-opus', 'active', 'high', 78),
        (demo_org_id, 'HR Bot', 'Internal HR Assistant', 'hr', 'openai', 'gpt-4', 'active', 'low', 20),
        (demo_org_id, 'Analyst Bot', 'Data Analysis Agent', 'analyst', 'anthropic', 'claude-3-sonnet', 'active', 'medium', 55)
    ON CONFLICT DO NOTHING;

    -- Insert demo cost tracking data (last 30 days)
    INSERT INTO cost_tracking (organization_id, agent_id, date, model_name, input_tokens, output_tokens, total_tokens, cost_usd, request_count)
    SELECT
        demo_org_id,
        ai.id,
        CURRENT_DATE - (generate_series(0, 29))::INTEGER,
        ai.model_name,
        (random() * 100000)::INTEGER,
        (random() * 150000)::INTEGER,
        (random() * 250000)::INTEGER,
        (random() * 50)::DECIMAL(10, 6),
        (random() * 500)::INTEGER
    FROM ai_agents ai
    WHERE ai.organization_id = demo_org_id
    ON CONFLICT DO NOTHING;

    -- Insert demo incidents
    INSERT INTO incidents (organization_id, agent_id, incident_type, severity, title, description, status)
    VALUES
        (demo_org_id, (SELECT id FROM ai_agents WHERE name = 'Refund Bot'), 'pii_leak', 'high', 'PII Detected in Response', 'Agent exposed customer email address', 'investigating'),
        (demo_org_id, (SELECT id FROM ai_agents WHERE name = 'Refund Bot'), 'refund_abuse', 'critical', 'Refund Abuse Attempt', 'Agent approved suspicious refund request', 'open'),
        (demo_org_id, (SELECT id FROM ai_agents WHERE name = 'Support Bot'), 'hallucination', 'medium', 'Factual Error', 'Agent provided incorrect product information', 'resolved')
    ON CONFLICT DO NOTHING;
END $$;

