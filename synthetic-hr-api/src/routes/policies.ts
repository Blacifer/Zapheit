import express, { Request, Response } from 'express';
import { eq, supabaseRestAsUser } from '../lib/supabase-rest';
import { requirePermission } from '../middleware/rbac';

const router = express.Router();

function requireUserJwt(req: Request, res: Response): string | null {
  const userJwt = (req as any).userJwt as string | undefined;
  if (!userJwt) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return userJwt;
}

/**
 * Policy Pack Routes
 * Enterprise feature for governance and compliance
 */

// GET /api/policies/packs - List all policy packs for organization
router.get('/packs', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;

    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const query = new URLSearchParams({
      select: '*',
      order: 'created_at.desc',
      organization_id: eq(organizationId),
    });
    const data = await supabaseRestAsUser(userJwt, 'policy_packs', query);

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching policy packs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/policies/packs/:id - Get policy pack by ID
router.get('/packs/:id', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { id } = req.params;
    const organizationId = req.user?.organization_id;

    const query = new URLSearchParams({
      select: '*',
      id: eq(id),
      organization_id: eq(String(organizationId || '')),
      limit: '1',
    });
    const rows = (await supabaseRestAsUser(userJwt, 'policy_packs', query)) as any[];
    const data = rows?.[0];
    if (!data) {
      return res.status(404).json({ success: false, error: 'Policy pack not found' });
    }

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching policy pack:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/policies/packs - Create new policy pack (requires permissions)
router.post('/packs', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const organizationId = req.user?.organization_id;
    const userId = req.user?.id;
    const { name, description, policy_type, rules, enforcement_level } = req.body;

    if (!organizationId || !userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Validate required fields
    if (!name || !policy_type || !rules) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const created = (await supabaseRestAsUser(userJwt, 'policy_packs', '', {
      method: 'POST',
      body: [{
        organization_id: organizationId,
        name,
        description,
        policy_type,
        rules, // jsonb
        enforcement_level: enforcement_level || 'warn',
        is_active: true,
        created_by: userId,
      }],
    })) as any[];

    res.status(201).json({ success: true, data: created?.[0] });
  } catch (error: any) {
    console.error('Error creating policy pack:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/policies/packs/:id - Update policy pack (requires permissions)
router.patch('/packs/:id', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { id } = req.params;
    const organizationId = req.user?.organization_id;
    const updates = req.body;

    const query = new URLSearchParams({
      id: eq(id),
      organization_id: eq(String(organizationId || '')),
    });
    const updated = (await supabaseRestAsUser(userJwt, 'policy_packs', query, {
      method: 'PATCH',
      body: {
        ...updates,
        updated_at: new Date().toISOString(),
      },
    })) as any[];

    res.json({ success: true, data: updated?.[0] });
  } catch (error: any) {
    console.error('Error updating policy pack:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/policies/packs/:id - Delete policy pack (requires permissions)
router.delete('/packs/:id', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { id } = req.params;
    const organizationId = req.user?.organization_id;

    const query = new URLSearchParams({
      id: eq(id),
      organization_id: eq(String(organizationId || '')),
    });
    await supabaseRestAsUser(userJwt, 'policy_packs', query, { method: 'DELETE' });

    res.json({ success: true, message: 'Policy pack deleted' });
  } catch (error: any) {
    console.error('Error deleting policy pack:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Policy Assignment Routes
 */

// GET /api/policies/assignments - List all policy assignments
router.get('/assignments', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    // RLS already ensures org scoping via policy_pack_id -> policy_packs -> org.
    const query = new URLSearchParams({
      select: '*,policy_pack:policy_packs(id,name,policy_type,enforcement_level)',
      order: 'created_at.desc',
    });
    const data = await supabaseRestAsUser(userJwt, 'policy_assignments', query);

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching policy assignments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/policies/assignments - Assign policy to target (requires permissions)
router.post('/assignments', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const userId = req.user?.id;
    const { policy_pack_id, target_type, target_id } = req.body;

    if (!policy_pack_id || !target_type || !target_id) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const created = (await supabaseRestAsUser(userJwt, 'policy_assignments', '', {
      method: 'POST',
      body: [{
        policy_pack_id,
        target_type,
        target_id,
        assigned_by: userId,
      }],
    })) as any[];

    res.status(201).json({ success: true, data: created?.[0] });
  } catch (error: any) {
    console.error('Error creating policy assignment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/policies/assignments/:id - Remove policy assignment (requires permissions)
router.delete('/assignments/:id', requirePermission('policies.manage'), async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { id } = req.params;

    const query = new URLSearchParams({ id: eq(id) });
    await supabaseRestAsUser(userJwt, 'policy_assignments', query, { method: 'DELETE' });

    res.json({ success: true, message: 'Policy assignment removed' });
  } catch (error: any) {
    console.error('Error deleting policy assignment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Policy Enforcement Check
 * Called before operations to verify compliance
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    const userJwt = requireUserJwt(req, res);
    if (!userJwt) return;

    const { target_type, target_id, operation, context } = req.body;

    // Get all active policies for this target
    const query = new URLSearchParams({
      select: '*,policy_pack:policy_packs!inner(*)',
      target_type: eq(target_type),
      target_id: eq(target_id),
      'policy_pack.is_active': 'eq.true',
    });
    const assignments = (await supabaseRestAsUser(userJwt, 'policy_assignments', query)) as any[];

    const violations: any[] = [];
    const warnings: any[] = [];

    // Check each policy
    for (const assignment of assignments || []) {
      const policyPack = assignment.policy_pack;
      const rules = typeof policyPack.rules === 'string' ? JSON.parse(policyPack.rules) : policyPack.rules;

      for (const rule of rules) {
        // Simple rule evaluation (can be extended)
        const ruleViolated = evaluateRule(rule, operation, context);

        if (ruleViolated) {
          if (policyPack.enforcement_level === 'block') {
            violations.push({
              policy_pack_id: policyPack.id,
              policy_name: policyPack.name,
              rule_id: rule.id,
              rule_type: rule.rule_type,
              severity: rule.severity,
              message: `Policy violation: ${rule.rule_type}`,
            });
          } else if (policyPack.enforcement_level === 'warn') {
            warnings.push({
              policy_pack_id: policyPack.id,
              policy_name: policyPack.name,
              rule_id: rule.id,
              rule_type: rule.rule_type,
              severity: rule.severity,
              message: `Policy warning: ${rule.rule_type}`,
            });
          }
          // audit level: just log, don't block or warn
        }
      }
    }

    const allowed = violations.length === 0;

    res.json({
      success: true,
      allowed,
      violations,
      warnings,
    });
  } catch (error: any) {
    console.error('Error checking policies:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Simple rule evaluation function
 * Can be extended with more sophisticated logic
 */
function evaluateRule(rule: any, operation: string, context: any): boolean {
  // Example rule evaluation
  // In production, this would be more sophisticated
  switch (rule.rule_type) {
    case 'data_retention':
      // Check if data retention period is exceeded
      if (context.data_age_days && rule.condition.max_days) {
        return context.data_age_days > rule.condition.max_days;
      }
      break;

    case 'pii_protection':
      // Check if PII is being accessed/modified
      if (operation === 'data_export' && rule.condition.require_approval) {
        return !context.has_approval;
      }
      break;

    case 'access_control':
      // Check if user has required role
      if (rule.condition.required_role && context.user_role) {
        return context.user_role !== rule.condition.required_role;
      }
      break;

    default:
      return false;
  }

  return false;
}

export default router;
