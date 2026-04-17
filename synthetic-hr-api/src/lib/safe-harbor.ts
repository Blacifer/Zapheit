import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

type WebhookLog = {
  id: string;
  webhookId: string;
  event: string;
  endpoint: string;
  attemptedAt: string;
  status: 'delivered' | 'failed';
  responseCode?: number;
  latencyMs?: number;
  note?: string;
};

type KillSwitchAudit = {
  created_at: string;
  resource_id: string | null;
  details?: {
    level?: number;
    reason?: string;
    [key: string]: any;
  };
};

type DocumentType = 'sla' | 'dpa' | 'security';
const SAFE_HARBOR_CONTRACT_BUCKET = 'safe-harbor-contracts';

type SafeHarborConfig = {
  slaOverrides?: {
    tier?: string;
    uptimeTarget?: string;
    supportResponseTarget?: string;
    incidentAlertTarget?: string;
    auditRetentionDays?: number;
  };
  updatedAt?: string;
};

type ContractStatus = 'standard' | 'requested' | 'under_review' | 'approved' | 'executed';

type ContractAttachmentInput = {
  name?: string;
  contentType?: string;
  contentBase64?: string;
};

type ContractAttachment = {
  id: string;
  name: string;
  contentType: string;
  path: string;
  uploadedAt: string;
};

type ContractRecord = {
  id: string;
  status: ContractStatus;
  reference: string;
  notes: string;
  attachments: ContractAttachment[];
  updatedAt: string;
};

const PLAN_SLA_DEFAULTS = {
  free: {
    label: 'Free',
    uptimeTarget: '99.0%',
    supportResponseTarget: 'Community',
    incidentAlertTarget: 'Customer route required',
    auditRetentionDays: 30,
  },
  starter: {
    label: 'Starter',
    uptimeTarget: '99.5%',
    supportResponseTarget: '1 business day',
    incidentAlertTarget: 'Customer route required',
    auditRetentionDays: 90,
  },
  pro: {
    label: 'Pro',
    uptimeTarget: '99.9%',
    supportResponseTarget: '1 hour',
    incidentAlertTarget: '<5 minutes',
    auditRetentionDays: 180,
  },
  enterprise: {
    label: 'Enterprise',
    uptimeTarget: '99.95%',
    supportResponseTarget: '15 minutes',
    incidentAlertTarget: '<5 minutes',
    auditRetentionDays: 365,
  },
} as const;

function resolvePlan(plan?: string | null) {
  const normalized = String(plan || 'free').toLowerCase();
  if (normalized.includes('enterprise')) return { key: 'enterprise', ...PLAN_SLA_DEFAULTS.enterprise };
  if (normalized.includes('pro') || normalized.includes('retainer')) return { key: 'pro', ...PLAN_SLA_DEFAULTS.pro };
  if (normalized.includes('starter') || normalized.includes('audit')) return { key: 'starter', ...PLAN_SLA_DEFAULTS.starter };
  if (normalized.includes('free')) return { key: 'free', ...PLAN_SLA_DEFAULTS.free };
  return { key: 'free', ...PLAN_SLA_DEFAULTS.free };
}

function sanitizeConfig(config: any): SafeHarborConfig {
  return {
    slaOverrides: {
      tier: typeof config?.slaOverrides?.tier === 'string' ? config.slaOverrides.tier.slice(0, 64) : '',
      uptimeTarget: typeof config?.slaOverrides?.uptimeTarget === 'string' ? config.slaOverrides.uptimeTarget.slice(0, 32) : '',
      supportResponseTarget: typeof config?.slaOverrides?.supportResponseTarget === 'string' ? config.slaOverrides.supportResponseTarget.slice(0, 32) : '',
      incidentAlertTarget: typeof config?.slaOverrides?.incidentAlertTarget === 'string' ? config.slaOverrides.incidentAlertTarget.slice(0, 32) : '',
      auditRetentionDays: Number.isFinite(Number(config?.slaOverrides?.auditRetentionDays))
        ? Math.max(0, Math.round(Number(config.slaOverrides.auditRetentionDays)))
        : undefined,
    },
    updatedAt: typeof config?.updatedAt === 'string' ? config.updatedAt : undefined,
  };
}

function sanitizeContractRecord(record: any): ContractRecord {
  const status: ContractStatus = ['standard', 'requested', 'under_review', 'approved', 'executed'].includes(record?.status)
    ? record.status
    : 'standard';

  const attachments = Array.isArray(record?.attachments)
    ? record.attachments
        .filter((item: any) => item && typeof item.path === 'string')
        .map((item: any) => ({
          id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
          name: typeof item.name === 'string' ? item.name.slice(0, 160) : 'attachment.pdf',
          contentType: typeof item.contentType === 'string' ? item.contentType.slice(0, 120) : 'application/octet-stream',
          path: item.path,
          uploadedAt: typeof item.uploadedAt === 'string' ? item.uploadedAt : new Date().toISOString(),
        }))
    : [];

  return {
    id: typeof record?.id === 'string' ? record.id : crypto.randomUUID(),
    status,
    reference: typeof record?.reference === 'string' ? record.reference.slice(0, 120) : '',
    notes: typeof record?.notes === 'string' ? record.notes.slice(0, 400) : '',
    attachments,
    updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return 'No evidence yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No evidence yet';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function wrapText(text: string, maxLength = 88): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapePdfText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines: string[]) {
  const pageSize = 42;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += pageSize) {
    pages.push(lines.slice(i, i + pageSize));
  }

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId = addObject('<< /Type /Pages /Kids [] /Count 0 >>');
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageIds: number[] = [];
  for (const pageLines of pages) {
    const contentStream = [
      'BT',
      '/F1 12 Tf',
      '50 790 Td',
      '16 TL',
      ...pageLines.flatMap((line, index) =>
        index === 0
          ? [`(${escapePdfText(line)}) Tj`]
          : ['T*', `(${escapePdfText(line)}) Tj`],
      ),
      'ET',
    ].join('\n');
    const contentId = addObject(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const buffers: Buffer[] = [Buffer.from('%PDF-1.4\n', 'utf8')];
  const offsets: number[] = [0];
  let currentOffset = buffers[0].length;

  objects.forEach((body, index) => {
    offsets.push(currentOffset);
    const objectBuffer = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'utf8');
    buffers.push(objectBuffer);
    currentOffset += objectBuffer.length;
  });

  const xrefStart = currentOffset;
  const xrefRows = ['0000000000 65535 f ']
    .concat(offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `))
    .join('\n');

  buffers.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n${xrefRows}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`,
      'utf8',
    ),
  );

  return Buffer.concat(buffers);
}

async function loadOrganization(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan, settings, updated_at')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return data;
}

async function persistOrganizationSettings(orgId: string, settings: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', orgId);

  if (error) throw error;
}

async function loadLatestKillSwitch(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('created_at, resource_id, details')
    .eq('organization_id', orgId)
    .eq('action', 'agent.kill_switch')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0] as KillSwitchAudit | undefined) || null;
}

async function ensureContractBucket() {
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = Array.isArray(buckets) && buckets.some((bucket) => bucket.name === SAFE_HARBOR_CONTRACT_BUCKET);
  if (exists) return;

  const { error } = await supabaseAdmin.storage.createBucket(SAFE_HARBOR_CONTRACT_BUCKET, {
    public: false,
    fileSizeLimit: '10MB',
  });
  if (error && !String(error.message || '').toLowerCase().includes('already exists')) {
    throw error;
  }
}

async function uploadContractAttachment(orgId: string, recordId: string, file: ContractAttachmentInput): Promise<ContractAttachment | null> {
  if (!file?.contentBase64 || !file?.name) return null;

  await ensureContractBucket();

  const attachmentId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || `attachment-${attachmentId}.bin`;
  const path = `${orgId}/${recordId}/${attachmentId}-${safeName}`;
  const buffer = Buffer.from(file.contentBase64, 'base64');
  const contentType = typeof file.contentType === 'string' && file.contentType ? file.contentType : 'application/octet-stream';

  const { error } = await supabaseAdmin.storage.from(SAFE_HARBOR_CONTRACT_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });

  if (error) throw error;

  return {
    id: attachmentId,
    name: file.name.slice(0, 160),
    contentType,
    path,
    uploadedAt: new Date().toISOString(),
  };
}

async function loadLatestContractRecord(orgId: string): Promise<ContractRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('resource_id, created_at, details')
    .eq('organization_id', orgId)
    .eq('action', 'safe_harbor.contract.updated')
    .eq('resource_type', 'safe_harbor_contract')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const record = data?.[0] as any;
  if (!record) return null;

  return sanitizeContractRecord({
    id: record.resource_id || crypto.randomUUID(),
    updatedAt: record.created_at,
    ...(record.details || {}),
  });
}

export async function getSafeHarborState(orgId: string) {
  const organization = await loadOrganization(orgId);
  const settings = (organization?.settings || {}) as Record<string, any>;
  const config = sanitizeConfig(settings.rasi_safe_harbor || {});
  const defaultSla = resolvePlan(organization?.plan);
  const sla = {
    tier: config.slaOverrides?.tier || defaultSla.label,
    uptimeTarget: config.slaOverrides?.uptimeTarget || defaultSla.uptimeTarget,
    supportResponseTarget: config.slaOverrides?.supportResponseTarget || defaultSla.supportResponseTarget,
    incidentAlertTarget: config.slaOverrides?.incidentAlertTarget || defaultSla.incidentAlertTarget,
    auditRetentionDays: config.slaOverrides?.auditRetentionDays || defaultSla.auditRetentionDays,
    source: config.updatedAt ? 'organization_override' : 'default_plan_policy',
  };
  const webhookLogs = Array.isArray(settings.rasi_webhook_logs) ? (settings.rasi_webhook_logs as WebhookLog[]) : [];
  const sortedWebhookLogs = [...webhookLogs].sort((a, b) => new Date(b.attemptedAt).getTime() - new Date(a.attemptedAt).getTime());
  const lastWebhookDelivery = sortedWebhookLogs[0] || null;
  const lastKillSwitchEvent = await loadLatestKillSwitch(orgId);
  const contract = await loadLatestContractRecord(orgId);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      plan: String(organization.plan || defaultSla.key),
      updatedAt: organization.updated_at,
    },
    config: {
      slaOverrides: {
        tier: config.slaOverrides?.tier || '',
        uptimeTarget: config.slaOverrides?.uptimeTarget || '',
        supportResponseTarget: config.slaOverrides?.supportResponseTarget || '',
        incidentAlertTarget: config.slaOverrides?.incidentAlertTarget || '',
        auditRetentionDays: config.slaOverrides?.auditRetentionDays || 0,
      },
      updatedAt: config.updatedAt || null,
    },
    contract: contract || {
      id: '',
      status: 'standard',
      reference: '',
      notes: '',
      attachments: [],
      updatedAt: null,
    },
    sla: {
      tier: sla.tier,
      uptimeTarget: sla.uptimeTarget,
      supportResponseTarget: sla.supportResponseTarget,
      incidentAlertTarget: sla.incidentAlertTarget,
      auditRetentionDays: sla.auditRetentionDays,
      source: sla.source,
    },
    proofs: {
      lastWebhookDelivery: lastWebhookDelivery
        ? {
            id: lastWebhookDelivery.id,
            webhookId: lastWebhookDelivery.webhookId,
            attemptedAt: lastWebhookDelivery.attemptedAt,
            event: lastWebhookDelivery.event,
            status: lastWebhookDelivery.status,
            endpoint: lastWebhookDelivery.endpoint,
            responseCode: lastWebhookDelivery.responseCode || null,
            latencyMs: lastWebhookDelivery.latencyMs || null,
            note: lastWebhookDelivery.note || '',
            sourcePage: 'webhooks',
            sourceId: lastWebhookDelivery.id,
          }
        : null,
      lastKillSwitchEvent: lastKillSwitchEvent
        ? {
            createdAt: lastKillSwitchEvent.created_at,
            agentId: lastKillSwitchEvent.resource_id,
            level: Number(lastKillSwitchEvent.details?.level || 0) || null,
            reason: lastKillSwitchEvent.details?.reason || '',
            sourcePage: 'fleet',
            sourceId: lastKillSwitchEvent.resource_id,
          }
        : null,
      lastPolicySyncAt:
        config.updatedAt ||
        settings.rasi_prompt_caching?.updatedAt ||
        settings.rasi_pricing?.updatedAt ||
        organization.updated_at ||
        null,
    },
  };
}

export async function updateSafeHarborConfig(orgId: string, updates: Partial<SafeHarborConfig>) {
  const organization = await loadOrganization(orgId);
  const settings = (organization?.settings || {}) as Record<string, any>;
  const current = sanitizeConfig(settings.rasi_safe_harbor || {});
  const next = sanitizeConfig({
    ...current,
    ...updates,
    slaOverrides: {
      ...current.slaOverrides,
      ...(updates.slaOverrides || {}),
    },
    updatedAt: new Date().toISOString(),
  });

  await persistOrganizationSettings(orgId, {
    ...settings,
    rasi_safe_harbor: next,
  });

  return getSafeHarborState(orgId);
}

export async function updateSafeHarborContract(
  orgId: string,
  actorUserId: string,
  updates: {
    status?: ContractStatus;
    reference?: string;
    notes?: string;
    attachments?: ContractAttachmentInput[];
  },
) {
  const current = (await loadLatestContractRecord(orgId)) || {
    id: crypto.randomUUID(),
    status: 'standard' as ContractStatus,
    reference: '',
    notes: '',
    attachments: [],
    updatedAt: new Date().toISOString(),
  };

  const recordId = current.id || crypto.randomUUID();
  const uploadedAttachments = (
    await Promise.all((updates.attachments || []).map((file) => uploadContractAttachment(orgId, recordId, file)))
  ).filter(Boolean) as ContractAttachment[];

  const next = sanitizeContractRecord({
    id: recordId,
    status: updates.status ?? current.status,
    reference: updates.reference ?? current.reference,
    notes: updates.notes ?? current.notes,
    attachments: [...current.attachments, ...uploadedAttachments],
    updatedAt: new Date().toISOString(),
  });

  const { error } = await supabaseAdmin.from('audit_logs').insert({
    organization_id: orgId,
    user_id: actorUserId,
    action: 'safe_harbor.contract.updated',
    resource_type: 'safe_harbor_contract',
    resource_id: recordId,
    details: next,
  });

  if (error) throw error;

  return getSafeHarborState(orgId);
}

export async function generateSafeHarborDocument(orgId: string, type: DocumentType) {
  const state = await getSafeHarborState(orgId);
  const heading =
    type === 'sla'
      ? 'Zapheit Safe Harbor SLA Summary'
      : type === 'dpa'
        ? 'Zapheit Data Processing Overview'
        : 'Zapheit Security Responsibility Matrix';

  const commonHeader = [
    heading,
    '',
    `Organization: ${state.organization.name}`,
    `Generated: ${formatDateTime(new Date().toISOString())}`,
    `Current plan: ${state.sla.tier}`,
    `Custom terms status: ${state.contract.status}`,
    `Contract reference: ${state.contract.reference || 'Not recorded'}`,
    '',
  ];

  const typeSpecific =
    type === 'sla'
      ? [
          'Operational commitments',
          `- Uptime target: ${state.sla.uptimeTarget}`,
          `- Support response target: ${state.sla.supportResponseTarget}`,
          `- Incident alert target: ${state.sla.incidentAlertTarget}`,
          `- Audit retention target: ${state.sla.auditRetentionDays} days`,
          '',
          'Live proofs',
          `- Last webhook delivery: ${state.proofs.lastWebhookDelivery ? `${formatDateTime(state.proofs.lastWebhookDelivery.attemptedAt)} (${state.proofs.lastWebhookDelivery.status}, ${state.proofs.lastWebhookDelivery.event})` : 'No delivery observed yet'}`,
          `- Last kill switch event: ${state.proofs.lastKillSwitchEvent ? `${formatDateTime(state.proofs.lastKillSwitchEvent.createdAt)} (level ${state.proofs.lastKillSwitchEvent.level || 'n/a'})` : 'No kill switch event recorded yet'}`,
          `- Last policy sync: ${formatDateTime(state.proofs.lastPolicySyncAt)}`,
        ]
      : type === 'dpa'
        ? [
            'Data processing boundary',
            '- Zapheit processes governance metadata, operational telemetry, audit evidence, and control-state summaries.',
            '- Customers remain responsible for prompt content, training data quality, and downstream business processing.',
            '- Third-party model providers remain independent processors/sub-processors outside the Zapheit governance layer.',
            '',
            'Data-handling points to review',
            `- Audit retention target: ${state.sla.auditRetentionDays} days`,
            `- Last policy sync: ${formatDateTime(state.proofs.lastPolicySyncAt)}`,
            `- Custom terms status: ${state.contract.status}`,
            `- Notes: ${state.contract.notes || 'No org-specific DPA notes recorded.'}`,
            `- Attachments on record: ${state.contract.attachments.length}`,
          ]
        : [
            'Security responsibility matrix',
            '- Zapheit covers governance controls, account-level policy persistence, observability, and emergency control surfaces where configured.',
            '- Customer covers prompts, integrations, credentials, model usage decisions, and legal review of outputs.',
            '- Third-party provider availability and behavior remain outside the Zapheit security boundary.',
            '',
            'Latest evidence',
            `- Last webhook delivery: ${state.proofs.lastWebhookDelivery ? `${formatDateTime(state.proofs.lastWebhookDelivery.attemptedAt)} (${state.proofs.lastWebhookDelivery.status})` : 'No delivery observed yet'}`,
            `- Last kill switch event: ${state.proofs.lastKillSwitchEvent ? formatDateTime(state.proofs.lastKillSwitchEvent.createdAt) : 'No kill switch event recorded yet'}`,
            `- Contract reference: ${state.contract.reference || 'Not recorded'}`,
            `- Attachments on record: ${state.contract.attachments.length}`,
          ];

  const footer = [
    '',
    'Legal note',
    '- This document is an account summary generated from live backend state.',
    '- Final commercial, DPA, and liability terms remain defined by the executed agreement with Zapheit and its operating entity.',
  ];

  const lines = [...commonHeader, ...typeSpecific, ...footer].flatMap((line) => wrapText(line));

  return {
    filename: `zapheit-${type}-summary.pdf`,
    buffer: buildSimplePdf(lines),
  };
}
