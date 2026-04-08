import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { SupabaseRestError, eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { logger } from '../lib/logger';

const router = Router();

const getOrgId = (req: any): string | null => req.user?.organization_id || null;
const getUserId = (req: any): string | null => req.user?.id || null;
const getUserJwt = (req: any): string => {
  const jwt = req.userJwt as string | undefined;
  if (!jwt) throw new Error('Missing user JWT on request');
  return jwt;
};

function safeError(res: Response, err: any, statusCode = 500) {
  const resolved = err instanceof SupabaseRestError ? err.status : statusCode;
  const message = err instanceof SupabaseRestError ? err.responseBody : (err?.message || 'Internal error');
  logger.error('CTC route error', { status: resolved, message });
  return res.status(resolved).json({ success: false, error: message });
}

// ---------------------------------------------------------------------------
// India Statutory Constants (FY 2025-26 / 2026-27)
// ---------------------------------------------------------------------------
const STATUTORY = {
  PF_RATE: 0.12,                // 12% employer PF
  PF_BASIC_CAP: 15000,          // Monthly basic cap for PF (₹15,000)
  ESI_EMPLOYER_RATE: 0.0325,    // 3.25% employer ESI
  ESI_EMPLOYEE_RATE: 0.0075,    // 0.75% employee ESI
  ESI_GROSS_CEILING: 21000,     // Monthly gross ≤ ₹21,000 for ESI applicability
  GRATUITY_RATE: 0.0481,        // 4.81% of basic (15/26 × 12/12)
  HRA_METRO_RATE: 0.50,         // 50% of basic for metro (Delhi, Mumbai, Chennai, Kolkata)
  HRA_NON_METRO_RATE: 0.40,     // 40% of basic for non-metro
  MIN_BASIC_PERCENT: 0.50,      // Wage Code 2019: basic ≥ 50% of CTC
  PROFESSIONAL_TAX_MAX: 2500,   // Annual max professional tax (varies by state)
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const simulateSchema = z.object({
  ctc_annual: z.number().min(100000).max(100000000),
  is_metro: z.boolean().default(true),
  pf_capped: z.boolean().default(true),      // true = PF on ₹15k cap, false = full basic
  include_esi: z.boolean().default(false),
  basic_percent: z.number().min(0.40).max(0.80).default(0.50),
  hra_percent: z.number().min(0).max(1).optional(), // auto-derived from is_metro if not set
  include_lta: z.boolean().default(true),
  include_medical: z.boolean().default(false),
  include_nps: z.boolean().default(false),
  nps_percent: z.number().min(0).max(0.10).default(0),
  simulation_name: z.string().max(200).optional(),
  save: z.boolean().default(false),
});

const structureCreateSchema = z.object({
  employee_id: z.string().uuid(),
  employee_name: z.string().min(1).max(200),
  employee_email: z.string().email().optional(),
  designation: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  ctc_annual: z.number().min(100000).max(100000000),
  effective_from: z.string().optional(),
  notes: z.string().max(5000).optional(),
  components: z.array(z.object({
    component_type: z.string(),
    component_name: z.string(),
    annual_amount: z.number().min(0),
    is_taxable: z.boolean().default(true),
    is_statutory: z.boolean().default(false),
    calculation_rule: z.string().optional(),
    sort_order: z.number().int().default(0),
  })),
});

const structureListSchema = z.object({
  status: z.string().optional(),
  employee_id: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// CTC Simulation Engine
// ---------------------------------------------------------------------------

interface ComponentBreakdown {
  component_type: string;
  component_name: string;
  annual_amount: number;
  monthly_amount: number;
  is_taxable: boolean;
  is_statutory: boolean;
  calculation_rule: string;
  sort_order: number;
}

interface SimulationResult {
  ctc_annual: number;
  ctc_monthly: number;
  components: ComponentBreakdown[];
  take_home_estimate: { annual: number; monthly: number };
  employer_cost: { annual: number; monthly: number };
  compliance_warnings: string[];
  summary: {
    basic_percent: number;
    total_deductions_annual: number;
    total_allowances_annual: number;
    total_employer_contributions_annual: number;
  };
}

function simulateCTC(input: z.infer<typeof simulateSchema>): SimulationResult {
  const ctc = input.ctc_annual;
  const warnings: string[] = [];
  const components: ComponentBreakdown[] = [];
  let sortOrder = 0;

  // Step 1: Basic Pay
  const basicAnnual = Math.round(ctc * input.basic_percent);
  const basicMonthly = Math.round(basicAnnual / 12);

  if (input.basic_percent < STATUTORY.MIN_BASIC_PERCENT) {
    warnings.push(`Basic pay is ${(input.basic_percent * 100).toFixed(0)}% of CTC — Wage Code 2019 mandates minimum 50%. This structure may not be compliant.`);
  }

  components.push({
    component_type: 'basic',
    component_name: 'Basic Pay',
    annual_amount: basicAnnual,
    monthly_amount: basicMonthly,
    is_taxable: true,
    is_statutory: true,
    calculation_rule: `${(input.basic_percent * 100).toFixed(0)}% of CTC`,
    sort_order: sortOrder++,
  });

  // Step 2: HRA
  const hraRate = input.hra_percent ?? (input.is_metro ? STATUTORY.HRA_METRO_RATE : STATUTORY.HRA_NON_METRO_RATE);
  const hraAnnual = Math.round(basicAnnual * hraRate);
  components.push({
    component_type: 'hra',
    component_name: 'House Rent Allowance',
    annual_amount: hraAnnual,
    monthly_amount: Math.round(hraAnnual / 12),
    is_taxable: true, // partially exempt under Sec 10(13A)
    is_statutory: false,
    calculation_rule: `${(hraRate * 100).toFixed(0)}% of Basic`,
    sort_order: sortOrder++,
  });

  // Step 3: LTA
  let ltaAnnual = 0;
  if (input.include_lta) {
    ltaAnnual = Math.min(Math.round(basicAnnual * 0.08), 120000); // ~8% of basic, capped
    components.push({
      component_type: 'lta',
      component_name: 'Leave Travel Allowance',
      annual_amount: ltaAnnual,
      monthly_amount: Math.round(ltaAnnual / 12),
      is_taxable: false,
      is_statutory: false,
      calculation_rule: '8% of Basic (capped ₹1,20,000)',
      sort_order: sortOrder++,
    });
  }

  // Step 4: Medical Allowance
  let medicalAnnual = 0;
  if (input.include_medical) {
    medicalAnnual = 15000;
    components.push({
      component_type: 'medical',
      component_name: 'Medical Allowance',
      annual_amount: medicalAnnual,
      monthly_amount: Math.round(medicalAnnual / 12),
      is_taxable: true,
      is_statutory: false,
      calculation_rule: 'Flat ₹15,000/year',
      sort_order: sortOrder++,
    });
  }

  // Step 5: Employer PF
  let pfBasicMonthly = basicMonthly;
  if (input.pf_capped && basicMonthly > STATUTORY.PF_BASIC_CAP) {
    pfBasicMonthly = STATUTORY.PF_BASIC_CAP;
  }
  const pfMonthly = Math.round(pfBasicMonthly * STATUTORY.PF_RATE);
  const pfAnnual = pfMonthly * 12;
  components.push({
    component_type: 'employer_pf',
    component_name: 'Employer PF Contribution',
    annual_amount: pfAnnual,
    monthly_amount: pfMonthly,
    is_taxable: false,
    is_statutory: true,
    calculation_rule: input.pf_capped
      ? `12% of Basic (capped at ₹${STATUTORY.PF_BASIC_CAP.toLocaleString('en-IN')}/month)`
      : '12% of Basic (uncapped)',
    sort_order: sortOrder++,
  });

  // Step 6: Employer ESI (if applicable)
  let esiAnnual = 0;
  const grossMonthlyEstimate = Math.round(ctc / 12);
  if (input.include_esi && grossMonthlyEstimate <= STATUTORY.ESI_GROSS_CEILING) {
    const esiMonthly = Math.round(grossMonthlyEstimate * STATUTORY.ESI_EMPLOYER_RATE);
    esiAnnual = esiMonthly * 12;
    components.push({
      component_type: 'employer_esi',
      component_name: 'Employer ESI Contribution',
      annual_amount: esiAnnual,
      monthly_amount: esiMonthly,
      is_taxable: false,
      is_statutory: true,
      calculation_rule: `3.25% of gross (applicable if gross ≤ ₹${STATUTORY.ESI_GROSS_CEILING.toLocaleString('en-IN')}/month)`,
      sort_order: sortOrder++,
    });
  } else if (input.include_esi && grossMonthlyEstimate > STATUTORY.ESI_GROSS_CEILING) {
    warnings.push(`ESI not applicable — monthly CTC ₹${grossMonthlyEstimate.toLocaleString('en-IN')} exceeds ₹${STATUTORY.ESI_GROSS_CEILING.toLocaleString('en-IN')} gross ceiling.`);
  }

  // Step 7: Gratuity provision
  const gratuityAnnual = Math.round(basicAnnual * STATUTORY.GRATUITY_RATE);
  components.push({
    component_type: 'gratuity',
    component_name: 'Gratuity Provision',
    annual_amount: gratuityAnnual,
    monthly_amount: Math.round(gratuityAnnual / 12),
    is_taxable: false,
    is_statutory: true,
    calculation_rule: '4.81% of Basic (15/26 days per year)',
    sort_order: sortOrder++,
  });

  // Step 8: NPS
  let npsAnnual = 0;
  if (input.include_nps && input.nps_percent > 0) {
    npsAnnual = Math.round(basicAnnual * input.nps_percent);
    components.push({
      component_type: 'nps_employer',
      component_name: 'NPS Employer Contribution',
      annual_amount: npsAnnual,
      monthly_amount: Math.round(npsAnnual / 12),
      is_taxable: false,
      is_statutory: false,
      calculation_rule: `${(input.nps_percent * 100).toFixed(0)}% of Basic`,
      sort_order: sortOrder++,
    });
  }

  // Step 9: Special Allowance (balancing figure)
  const allocatedSoFar = basicAnnual + hraAnnual + ltaAnnual + medicalAnnual + pfAnnual + esiAnnual + gratuityAnnual + npsAnnual;
  const specialAnnual = Math.max(0, ctc - allocatedSoFar);
  if (specialAnnual > 0) {
    components.push({
      component_type: 'special',
      component_name: 'Special Allowance',
      annual_amount: specialAnnual,
      monthly_amount: Math.round(specialAnnual / 12),
      is_taxable: true,
      is_statutory: false,
      calculation_rule: 'CTC balance after all allocations',
      sort_order: sortOrder++,
    });
  }

  if (specialAnnual < 0) {
    warnings.push(`Component total exceeds CTC by ₹${Math.abs(specialAnnual).toLocaleString('en-IN')}. Reduce basic percentage or remove optional components.`);
  }

  // Compute summaries
  const totalEmployerContributions = pfAnnual + esiAnnual + gratuityAnnual + npsAnnual;
  const totalAllowances = hraAnnual + ltaAnnual + medicalAnnual + specialAnnual;
  const employeePfAnnual = pfAnnual; // employee PF = employer PF
  const employeeEsiAnnual = input.include_esi && grossMonthlyEstimate <= STATUTORY.ESI_GROSS_CEILING
    ? Math.round(grossMonthlyEstimate * STATUTORY.ESI_EMPLOYEE_RATE) * 12 : 0;
  const ptAnnual = STATUTORY.PROFESSIONAL_TAX_MAX;
  const totalDeductions = employeePfAnnual + employeeEsiAnnual + ptAnnual;
  const grossSalaryAnnual = ctc - totalEmployerContributions;
  const takeHomeAnnual = grossSalaryAnnual - totalDeductions;

  return {
    ctc_annual: ctc,
    ctc_monthly: Math.round(ctc / 12),
    components,
    take_home_estimate: {
      annual: Math.round(takeHomeAnnual),
      monthly: Math.round(takeHomeAnnual / 12),
    },
    employer_cost: {
      annual: ctc,
      monthly: Math.round(ctc / 12),
    },
    compliance_warnings: warnings,
    summary: {
      basic_percent: input.basic_percent,
      total_deductions_annual: totalDeductions,
      total_allowances_annual: totalAllowances,
      total_employer_contributions_annual: totalEmployerContributions,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /simulate — Run CTC breakdown simulation (optionally save)
router.post('/simulate', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const result = simulateCTC(parsed.data);

    // Optionally save to ctc_simulations
    if (parsed.data.save) {
      await supabaseRestAsUser(getUserJwt(req), 'ctc_simulations', new URLSearchParams(), {
        method: 'POST',
        body: {
          organization_id: orgId,
          simulation_name: parsed.data.simulation_name || `CTC ₹${(parsed.data.ctc_annual / 100000).toFixed(1)}L`,
          ctc_annual: parsed.data.ctc_annual,
          location: parsed.data.is_metro ? 'Metro' : 'Non-Metro',
          is_metro: parsed.data.is_metro,
          pf_capped: parsed.data.pf_capped,
          include_esi: parsed.data.include_esi,
          breakdown: result,
          compliance_warnings: result.compliance_warnings,
          created_by: getUserId(req),
        },
      });
    }

    return res.json({ success: true, data: result });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// GET /simulations — List saved simulations
router.get('/simulations', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const query = new URLSearchParams({
      organization_id: eq(orgId),
      order: 'created_at.desc',
      limit: String(req.query.limit || 50),
    });

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'ctc_simulations', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// GET /statutory-rates — Return current statutory constants (no DB hit)
router.get('/statutory-rates', requirePermission('workitems.read'), (_req: Request, res: Response) => {
  return res.json({ success: true, data: STATUTORY });
});

// ─── Salary Structures CRUD ────────────────────────────────────────────────

// GET /structures — List salary structures
router.get('/structures', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = structureListSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const query = new URLSearchParams({
      organization_id: eq(orgId),
      order: 'created_at.desc',
    });
    if (parsed.data.status) query.set('status', eq(parsed.data.status));
    if (parsed.data.employee_id) query.set('employee_id', eq(parsed.data.employee_id));
    if (parsed.data.limit) query.set('limit', String(parsed.data.limit));

    const rows = (await supabaseRestAsUser(getUserJwt(req), 'salary_structures', query)) as any[];
    return res.json({ success: true, data: rows || [], count: rows?.length || 0 });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// GET /structures/:id — Single salary structure with components
router.get('/structures/:id', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const [structures, components] = await Promise.all([
      supabaseRestAsUser(getUserJwt(req), 'salary_structures', new URLSearchParams({
        id: eq(req.params.id),
        organization_id: eq(orgId),
      })),
      supabaseRestAsUser(getUserJwt(req), 'salary_components', new URLSearchParams({
        salary_structure_id: eq(req.params.id),
        organization_id: eq(orgId),
        order: 'sort_order.asc',
      })),
    ]);

    const structure = (structures as any[])?.[0];
    if (!structure) return res.status(404).json({ success: false, error: 'Salary structure not found' });

    return res.json({ success: true, data: { ...structure, components: components || [] } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// POST /structures — Create salary structure with components
router.post('/structures', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const parsed = structureCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors.map(e => e.message) });

    const { components, ...structureData } = parsed.data;

    // Validate basic >= 50%
    const basicComponent = components.find(c => c.component_type === 'basic');
    if (basicComponent && basicComponent.annual_amount < structureData.ctc_annual * 0.5) {
      return res.status(400).json({
        success: false,
        error: `Basic pay ₹${basicComponent.annual_amount.toLocaleString('en-IN')} is less than 50% of CTC ₹${structureData.ctc_annual.toLocaleString('en-IN')}. Wage Code 2019 requires basic ≥ 50%.`,
      });
    }

    // Supersede any existing active structure for this employee
    const existing = (await supabaseRestAsUser(getUserJwt(req), 'salary_structures', new URLSearchParams({
      organization_id: eq(orgId),
      employee_id: eq(structureData.employee_id),
      status: eq('active'),
      select: 'id',
    }))) as any[];

    if (existing?.length) {
      for (const prev of existing) {
        await supabaseRestAsUser(getUserJwt(req), 'salary_structures', new URLSearchParams({
          id: eq(prev.id),
        }), {
          method: 'PATCH',
          body: { status: 'superseded', effective_to: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() },
        });
      }
    }

    // Create new structure
    const result = (await supabaseRestAsUser(getUserJwt(req), 'salary_structures', new URLSearchParams({ select: '*' }), {
      method: 'POST',
      body: {
        organization_id: orgId,
        ...structureData,
        created_by: getUserId(req),
      },
    })) as any[];

    const created = result?.[0];
    if (!created) return res.status(500).json({ success: false, error: 'Failed to create salary structure' });

    // Insert components
    if (components.length > 0) {
      const componentRows = components.map(c => ({
        salary_structure_id: created.id,
        organization_id: orgId,
        ...c,
      }));

      for (const row of componentRows) {
        await supabaseRestAsUser(getUserJwt(req), 'salary_components', new URLSearchParams(), {
          method: 'POST',
          body: row,
        });
      }
    }

    return res.status(201).json({ success: true, data: { ...created, components } });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// PATCH /structures/:id — Update salary structure
router.patch('/structures/:id', requirePermission('workitems.manage'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const allowedFields = ['status', 'notes', 'effective_to', 'designation', 'department', 'location'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const result = (await supabaseRestAsUser(getUserJwt(req), 'salary_structures', new URLSearchParams({
      id: eq(req.params.id),
      organization_id: eq(orgId),
      select: '*',
    }), {
      method: 'PATCH',
      body: updates,
    })) as any[];

    const updated = result?.[0];
    if (!updated) return res.status(404).json({ success: false, error: 'Salary structure not found' });

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    return safeError(res, err);
  }
});

// GET /stats — Org-level salary statistics
router.get('/stats', requirePermission('workitems.read'), async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, error: 'Organization not found' });

    const [structures, simulations] = await Promise.all([
      supabaseRestAsUser(getUserJwt(req), 'salary_structures', new URLSearchParams({
        organization_id: eq(orgId),
        status: eq('active'),
        select: 'id,ctc_annual,department,location',
      })),
      supabaseRestAsUser(getUserJwt(req), 'ctc_simulations', new URLSearchParams({
        organization_id: eq(orgId),
        select: 'id',
      })),
    ]);

    const rows = (structures as any[]) || [];
    const totalCtc = rows.reduce((sum: number, r: any) => sum + (Number(r.ctc_annual) || 0), 0);
    const avgCtc = rows.length > 0 ? Math.round(totalCtc / rows.length) : 0;
    const departments = [...new Set(rows.map((r: any) => r.department).filter(Boolean))];

    return res.json({
      success: true,
      data: {
        active_structures: rows.length,
        total_annual_ctc: totalCtc,
        avg_annual_ctc: avgCtc,
        departments,
        saved_simulations: ((simulations as any[]) || []).length,
      },
    });
  } catch (err: any) {
    return safeError(res, err);
  }
});

export default router;
