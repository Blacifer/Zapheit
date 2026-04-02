import { logger } from './logger';
import { SupabaseRestError, supabaseRest } from './supabase-rest';

type Requirement = {
  table: string;
  columns: string[];
};

type CompatibilityResult = {
  ok: boolean;
  missing: Array<{ table: string; column: string | null; reason: string }>;
};

const REQUIRED_CONTRACTS: Requirement[] = [
  {
    table: 'agent_corrections',
    columns: ['id', 'organization_id', 'agent_id', 'service', 'action', 'decision', 'context_summary', 'embedding', 'created_at'],
  },
  {
    table: 'synthesized_rules',
    columns: ['id', 'organization_id', 'service', 'action', 'trigger_count', 'proposed_policy', 'status', 'created_at', 'updated_at'],
  },
  {
    table: 'shadow_test_runs',
    columns: ['id', 'organization_id', 'agent_id', 'category', 'attack_prompt', 'passed', 'created_at'],
  },
  {
    table: 'integrations',
    columns: ['id', 'organization_id', 'service_type', 'status', 'enabled_capabilities', 'last_tested_at', 'last_test_result'],
  },
  {
    table: 'connector_action_executions',
    columns: ['id', 'organization_id', 'connector_id', 'action', 'success', 'idempotency_key', 'requested_by', 'policy_snapshot', 'created_at'],
  },
  {
    table: 'connector_retry_queue',
    columns: ['id', 'organization_id', 'connector_id', 'action', 'attempt_count', 'next_attempt_at', 'status', 'updated_at'],
  },
  {
    table: 'connector_circuit_breakers',
    columns: ['id', 'organization_id', 'connector_id', 'state', 'failure_count', 'opened_at', 'updated_at'],
  },
];

function readPostgrestError(err: unknown): string {
  if (!(err instanceof SupabaseRestError)) return (err as any)?.message || 'unknown error';
  try {
    const parsed = JSON.parse(err.responseBody);
    if (parsed?.message) return String(parsed.message);
  } catch {
    // ignore parse failure
  }
  return err.responseBody || err.message;
}

async function checkTableColumn(table: string, column: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const q = new URLSearchParams();
  q.set('select', column);
  q.set('limit', '1');
  try {
    await supabaseRest(table, q);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: readPostgrestError(err) };
  }
}

export async function verifySchemaCompatibility(): Promise<CompatibilityResult> {
  const missing: CompatibilityResult['missing'] = [];

  for (const requirement of REQUIRED_CONTRACTS) {
    // Quick table existence probe first.
    try {
      const tableProbe = new URLSearchParams();
      tableProbe.set('select', 'id');
      tableProbe.set('limit', '1');
      await supabaseRest(requirement.table, tableProbe);
    } catch (err) {
      missing.push({
        table: requirement.table,
        column: null,
        reason: readPostgrestError(err),
      });
      continue;
    }

    const checks = await Promise.all(requirement.columns.map((column) => checkTableColumn(requirement.table, column)));
    checks.forEach((check, idx) => {
      if (!check.ok) {
        missing.push({
          table: requirement.table,
          column: requirement.columns[idx],
          reason: check.reason,
        });
      }
    });
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

export async function runSchemaCompatibilityCheck(): Promise<void> {
  const result = await verifySchemaCompatibility();
  if (result.ok) {
    logger.info('Schema compatibility check passed');
    return;
  }

  logger.error('Schema compatibility check failed', {
    missing_contracts: result.missing.map((item) => ({
      table: item.table,
      column: item.column,
      reason: item.reason,
    })),
  });

  throw new Error(
    `Schema compatibility check failed for ${result.missing.length} contract item(s). Apply latest DB migrations before starting API.`,
  );
}

