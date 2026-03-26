import type { Role } from '../middleware/rbac';

export type PolicyBusinessHours = {
  start: string;
  end: string;
  utc_offset?: string | null;
};

export type PolicyConstraints = {
  amount_field?: string | null;
  amount_threshold?: number | null;
  threshold_required_role?: Role | null;
  entity_field?: string | null;
  allowed_entities?: string[] | null;
  business_hours?: PolicyBusinessHours | null;
  emergency_disabled?: boolean | null;
  dual_approval?: boolean | null;
};

export type PolicyConstraintEvaluation = {
  blocked: boolean;
  blockReasons: string[];
  approvalRequired: boolean;
  approvalReasons: string[];
  requiredRole: Role | null;
  dualApproval: boolean;
};

function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseUtcOffsetMinutes(value: string | null | undefined): number {
  if (!value) return 0;
  const match = String(value).trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function readPayloadField(payload: Record<string, any>, fieldPath: string | null | undefined): any {
  if (!fieldPath) return undefined;
  return String(fieldPath)
    .split('.')
    .reduce((acc: any, segment) => acc?.[segment], payload);
}

function normalizeRole(value: string | null | undefined): Role | null {
  if (value === 'viewer' || value === 'manager' || value === 'admin' || value === 'super_admin') return value;
  return null;
}

export function evaluatePolicyConstraints(
  payload: Record<string, any>,
  constraints: PolicyConstraints | null | undefined,
  now = new Date(),
): PolicyConstraintEvaluation {
  const safeConstraints = constraints && typeof constraints === 'object' ? constraints : {};
  const evaluation: PolicyConstraintEvaluation = {
    blocked: false,
    blockReasons: [],
    approvalRequired: false,
    approvalReasons: [],
    requiredRole: null,
    dualApproval: Boolean(safeConstraints.dual_approval),
  };

  if (safeConstraints.emergency_disabled) {
    evaluation.blocked = true;
    evaluation.blockReasons.push('Connector action temporarily disabled by emergency policy');
  }

  const entityValue = readPayloadField(payload, safeConstraints.entity_field);
  const allowedEntities = Array.isArray(safeConstraints.allowed_entities)
    ? safeConstraints.allowed_entities.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (safeConstraints.entity_field && allowedEntities.length > 0 && entityValue != null) {
    const entityString = String(entityValue);
    if (!allowedEntities.includes(entityString)) {
      evaluation.blocked = true;
      evaluation.blockReasons.push(`Entity "${entityString}" is outside the allowed policy scope`);
    }
  }

  const amountField = safeConstraints.amount_field || null;
  const threshold = typeof safeConstraints.amount_threshold === 'number'
    ? safeConstraints.amount_threshold
    : Number(safeConstraints.amount_threshold);
  if (amountField && Number.isFinite(threshold)) {
    const rawAmount = readPayloadField(payload, amountField);
    const amount = Number(rawAmount);
    if (Number.isFinite(amount) && amount > threshold) {
      evaluation.approvalRequired = true;
      evaluation.approvalReasons.push(`Amount ${amount} exceeds threshold ${threshold}`);
      evaluation.requiredRole = normalizeRole(safeConstraints.threshold_required_role || 'admin') || 'admin';
    }
  }

  const businessHours = safeConstraints.business_hours;
  if (businessHours?.start && businessHours?.end) {
    const startMinutes = parseClockMinutes(businessHours.start);
    const endMinutes = parseClockMinutes(businessHours.end);
    if (startMinutes != null && endMinutes != null) {
      const offsetMinutes = parseUtcOffsetMinutes(businessHours.utc_offset || '+00:00');
      const localMinutes = ((((now.getUTCHours() * 60) + now.getUTCMinutes()) + offsetMinutes) % 1440 + 1440) % 1440;
      const withinHours = startMinutes <= endMinutes
        ? localMinutes >= startMinutes && localMinutes <= endMinutes
        : localMinutes >= startMinutes || localMinutes <= endMinutes;
      if (!withinHours) {
        evaluation.approvalRequired = true;
        evaluation.approvalReasons.push('Action requested outside allowed business hours');
      }
    }
  }

  if (safeConstraints.dual_approval) {
    evaluation.approvalRequired = true;
    evaluation.approvalReasons.push('Dual approval required by policy');
  }

  return evaluation;
}
