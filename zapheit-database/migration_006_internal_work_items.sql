-- Database Migration: Internal Work Items (Support/Sales/IT)
-- Version: 1.0.0
-- Created: 2026-03-11
-- Description: Add internal module tables so connector_action can create tickets/leads/access requests inside the app.

BEGIN;

-- Support tickets (internal)
CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    title TEXT NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'open', -- open, pending, resolved, closed
    priority VARCHAR(10) DEFAULT 'medium', -- low, medium, high, urgent

    customer_email TEXT,
    source VARCHAR(30) DEFAULT 'agent', -- agent, manual, import
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_support_tickets_org_id ON support_tickets(organization_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX idx_support_tickets_created_at ON support_tickets(created_at);

-- Sales leads (internal CRM-lite)
CREATE TABLE sales_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    company_name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,

    stage VARCHAR(20) DEFAULT 'new', -- new, qualified, discovery, demo, proposal, won, lost
    score INTEGER DEFAULT 0,
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    notes JSONB DEFAULT '{}'::jsonb,

    source VARCHAR(30) DEFAULT 'agent', -- agent, manual, import
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sales_leads_org_id ON sales_leads(organization_id);
CREATE INDEX idx_sales_leads_stage ON sales_leads(stage);
CREATE INDEX idx_sales_leads_score ON sales_leads(score);
CREATE INDEX idx_sales_leads_created_at ON sales_leads(created_at);

-- IT access requests (internal IAM-lite)
CREATE TABLE it_access_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    subject TEXT NOT NULL,
    requestor_email TEXT,
    system_name TEXT,
    requested_access JSONB DEFAULT '{}'::jsonb,
    justification TEXT,

    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, completed, canceled
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMP WITH TIME ZONE,

    source VARCHAR(30) DEFAULT 'agent', -- agent, manual, import
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_it_access_requests_org_id ON it_access_requests(organization_id);
CREATE INDEX idx_it_access_requests_status ON it_access_requests(status);
CREATE INDEX idx_it_access_requests_created_at ON it_access_requests(created_at);

COMMIT;

