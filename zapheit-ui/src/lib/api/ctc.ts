import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentBreakdown {
  component_type: string;
  component_name: string;
  annual_amount: number;
  monthly_amount: number;
  is_taxable: boolean;
  is_statutory: boolean;
  calculation_rule: string;
  sort_order: number;
}

export interface SimulationResult {
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

export interface CtcSimulation {
  id: string;
  organization_id: string;
  simulation_name: string;
  ctc_annual: number;
  location: string;
  is_metro: boolean;
  pf_capped: boolean;
  include_esi: boolean;
  breakdown: SimulationResult;
  compliance_warnings: string[];
  created_by: string;
  created_at: string;
}

export interface SalaryStructure {
  id: string;
  organization_id: string;
  employee_id: string;
  employee_name: string;
  employee_email?: string;
  designation?: string;
  department?: string;
  location?: string;
  ctc_annual: number;
  ctc_monthly: number;
  effective_from: string;
  effective_to?: string;
  status: string;
  currency: string;
  notes?: string;
  components?: ComponentBreakdown[];
  created_at: string;
  updated_at: string;
}

export interface CtcStats {
  active_structures: number;
  total_annual_ctc: number;
  avg_annual_ctc: number;
  departments: string[];
  saved_simulations: number;
}

export interface StatutoryRates {
  PF_RATE: number;
  PF_BASIC_CAP: number;
  ESI_EMPLOYER_RATE: number;
  ESI_EMPLOYEE_RATE: number;
  ESI_GROSS_CEILING: number;
  GRATUITY_RATE: number;
  HRA_METRO_RATE: number;
  HRA_NON_METRO_RATE: number;
  MIN_BASIC_PERCENT: number;
  PROFESSIONAL_TAX_MAX: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const ctcApi = {
  async simulate(data: {
    ctc_annual: number;
    is_metro?: boolean;
    pf_capped?: boolean;
    include_esi?: boolean;
    basic_percent?: number;
    hra_percent?: number;
    include_lta?: boolean;
    include_medical?: boolean;
    include_nps?: boolean;
    nps_percent?: number;
    simulation_name?: string;
    save?: boolean;
  }): Promise<ApiResponse<SimulationResult>> {
    return authenticatedFetch('/ctc/simulate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async listSimulations(limit?: number): Promise<ApiResponse<CtcSimulation[]>> {
    const qs = limit ? `?limit=${limit}` : '';
    return authenticatedFetch(`/ctc/simulations${qs}`);
  },

  async getStatutoryRates(): Promise<ApiResponse<StatutoryRates>> {
    return authenticatedFetch('/ctc/statutory-rates');
  },

  async listStructures(params?: { status?: string; employee_id?: string }): Promise<ApiResponse<SalaryStructure[]>> {
    const entries = Object.entries(params || {}).filter(([, v]) => v);
    const qs = entries.length ? '?' + new URLSearchParams(entries as [string, string][]).toString() : '';
    return authenticatedFetch(`/ctc/structures${qs}`);
  },

  async getStructure(id: string): Promise<ApiResponse<SalaryStructure>> {
    return authenticatedFetch(`/ctc/structures/${id}`);
  },

  async getStats(): Promise<ApiResponse<CtcStats>> {
    return authenticatedFetch('/ctc/stats');
  },
};
