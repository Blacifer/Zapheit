-- Migration 052: CTC/Salary Structure Tables for India Payroll
-- India's Wage Code 2019 + PF Act mandate: basic pay >= 50% of CTC
-- This migration creates per-employee salary structures with component breakdown

-- Salary structures (per employee, one active at a time)
CREATE TABLE IF NOT EXISTS salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    employee_name VARCHAR(200),
    employee_email VARCHAR(320),
    designation VARCHAR(200),
    department VARCHAR(200),
    location VARCHAR(200),
    ctc_annual NUMERIC(14,2) NOT NULL CHECK (ctc_annual > 0),
    ctc_monthly NUMERIC(14,2) GENERATED ALWAYS AS (ctc_annual / 12) STORED,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'superseded', 'terminated')),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Salary components (line items within a structure)
CREATE TABLE IF NOT EXISTS salary_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salary_structure_id UUID NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    component_type VARCHAR(30) NOT NULL CHECK (component_type IN (
        'basic',          -- Basic Pay (must be >= 50% of CTC per Wage Code 2019)
        'hra',            -- House Rent Allowance (40-50% of basic depending on metro/non-metro)
        'da',             -- Dearness Allowance
        'special',        -- Special Allowance (balancing figure)
        'lta',            -- Leave Travel Allowance
        'medical',        -- Medical Allowance
        'conveyance',     -- Conveyance Allowance
        'employer_pf',    -- Employer PF contribution (12% of basic, capped at ₹1800/month on ₹15000 basic)
        'employer_esi',   -- Employer ESI (3.25% of gross, if gross <= ₹21000/month)
        'employer_lwf',   -- Labour Welfare Fund (employer share, state-specific)
        'gratuity',       -- Gratuity provision (4.81% of basic per Payment of Gratuity Act)
        'bonus',          -- Statutory/performance bonus
        'food_coupon',    -- Sodexo/meal vouchers
        'nps_employer',   -- National Pension Scheme employer contribution
        'custom'          -- Custom component
    )),
    component_name VARCHAR(100) NOT NULL,
    annual_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (annual_amount >= 0),
    monthly_amount NUMERIC(14,2) GENERATED ALWAYS AS (annual_amount / 12) STORED,
    is_taxable BOOLEAN NOT NULL DEFAULT true,
    is_statutory BOOLEAN NOT NULL DEFAULT false,
    calculation_rule VARCHAR(200),  -- e.g. '50% of CTC', '12% of basic', 'balance'
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CTC simulation history (saved what-if scenarios)
CREATE TABLE IF NOT EXISTS ctc_simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    simulation_name VARCHAR(200),
    ctc_annual NUMERIC(14,2) NOT NULL,
    location VARCHAR(200),
    is_metro BOOLEAN NOT NULL DEFAULT true,
    pf_capped BOOLEAN NOT NULL DEFAULT true, -- true = PF on ₹15000 cap, false = PF on full basic
    include_esi BOOLEAN NOT NULL DEFAULT false,
    breakdown JSONB NOT NULL DEFAULT '{}',   -- full component breakdown snapshot
    compliance_warnings JSONB NOT NULL DEFAULT '[]',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_salary_structures_org ON salary_structures(organization_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_employee ON salary_structures(organization_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_active ON salary_structures(organization_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_salary_components_structure ON salary_components(salary_structure_id);
CREATE INDEX IF NOT EXISTS idx_salary_components_org ON salary_components(organization_id);
CREATE INDEX IF NOT EXISTS idx_ctc_simulations_org ON ctc_simulations(organization_id);

-- RLS
ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctc_simulations ENABLE ROW LEVEL SECURITY;

-- salary_structures RLS
CREATE POLICY salary_structures_select ON salary_structures FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
CREATE POLICY salary_structures_insert ON salary_structures FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
CREATE POLICY salary_structures_update ON salary_structures FOR UPDATE
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

-- salary_components RLS
CREATE POLICY salary_components_select ON salary_components FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
CREATE POLICY salary_components_insert ON salary_components FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
CREATE POLICY salary_components_update ON salary_components FOR UPDATE
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));

-- ctc_simulations RLS
CREATE POLICY ctc_simulations_select ON ctc_simulations FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
CREATE POLICY ctc_simulations_insert ON ctc_simulations FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM users WHERE id = auth.uid()
    ));
