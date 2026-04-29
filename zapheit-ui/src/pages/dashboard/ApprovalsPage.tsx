import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckSquare, Clock, RefreshCw, CheckCircle2, XCircle,
  AlertCircle, Ban, ChevronDown, ChevronUp, Loader2,
  MessageSquare, BellOff, TrendingUp, Shield, ListTodo, Tag,
  Square, CheckSquare2, UserCheck, Bot, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import type { ApprovalRequest } from '../../lib/api-client';
import { HelpTip, HELP_TIPS } from '../../components/HelpTip';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { ReasonCallout } from '../../components/dashboard/ReasonCallout';

type Tab = 'queue' | 'history';

const STATUS_CONFIG: Record<ApprovalRequest['status'], { label: string; icon: typeof CheckCircle2; color: string }> = {
  pending:   { label: 'Pending',   icon: Clock,         color: 'text-amber-400 bg-amber-400/10 border-amber-500/20' },
  approved:  { label: 'Approved',  icon: CheckCircle2,  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' },
  denied:    { label: 'Denied',    icon: XCircle,       color: 'text-red-400 bg-red-400/10 border-red-500/20' },
  expired:   { label: 'Expired',   icon: AlertCircle,   color: 'text-slate-400 bg-slate-400/10 border-slate-500/20' },
  cancelled: { label: 'Cancelled', icon: Ban,           color: 'text-slate-400 bg-slate-400/10 border-slate-500/20' },
};

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Viewer',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTimeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

function PayloadPreview({ payload }: { payload: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(payload, null, 2);
  const isEmpty = Object.keys(payload).length === 0;
  if (isEmpty) return <span className="text-xs text-slate-500 italic">No payload</span>;
  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Hide payload' : 'Show payload'}
      </button>
      {expanded && (
        <pre className="mt-2 p-3 rounded-lg bg-black/30 text-xs text-slate-300 overflow-x-auto max-h-48 font-mono">
          {json}
        </pre>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApprovalRequest['status'] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// Plain-English action templates
const ACTION_LABELS: Record<string, string> = {
  send_message: 'send a message',
  send_email: 'send an email',
  create_record: 'create a record',
  update_record: 'update a record',
  delete_record: 'delete a record',
  create_issue: 'create an issue',
  update_issue: 'update an issue',
  close_issue: 'close an issue',
  create_task: 'create a task',
  update_task: 'update a task',
  post_comment: 'post a comment',
  list_records: 'read some records',
  search: 'run a search',
  execute: 'run a command',
  webhook: 'trigger a webhook',
  api_call: 'make an API call',
};

function friendlyAction(action: string): string {
  const normalized = action.toLowerCase().replace(/[-\s]/g, '_');
  return ACTION_LABELS[normalized] ?? action.replace(/_/g, ' ').toLowerCase();
}

function friendlyService(service?: string | null): string {
  const normalized = String(service || '').toLowerCase();
  if (normalized.includes('greythr') || normalized.includes('greyt')) return 'greytHR';
  if (normalized.includes('tally')) return 'TallyPrime';
  if (normalized.includes('naukri')) return 'Naukri';
  if (normalized.includes('cashfree')) return 'Cashfree';
  if (normalized.includes('razorpay')) return 'Razorpay';
  if (normalized.includes('keka')) return 'Keka';
  if (normalized.includes('darwinbox')) return 'Darwinbox';
  if (normalized.includes('whatsapp')) return 'WhatsApp';
  if (normalized.includes('slack')) return 'Slack';
  if (normalized.includes('github')) return 'GitHub';
  if (normalized.includes('jira')) return 'Jira';
  if (normalized.includes('hubspot')) return 'HubSpot';
  if (normalized.includes('google')) return 'Google Workspace';
  if (normalized.includes('microsoft')) return 'Microsoft 365';
  return service ? service.replace(/[-_]/g, ' ') : 'Connected app';
}

function computeRiskScore(request: ApprovalRequest): number {
  // If API already computed a 0-1 float score, convert
  if (request.risk_score != null) {
    return request.risk_score <= 1 ? Math.round(request.risk_score * 100) : Math.round(request.risk_score);
  }
  let score = 30;
  const action = (request.action || '').toLowerCase();
  if (action.includes('delete') || action.includes('remove') || action.includes('destroy')) score += 30;
  if (action.includes('send') || action.includes('email') || action.includes('message')) score += 15;
  if (action.includes('execute') || action.includes('webhook') || action.includes('api_call')) score += 20;
  const payloadStr = JSON.stringify(request.action_payload || '').toLowerCase();
  if (/\b(aadhaar|pan|passport|password|secret|token|key)\b/.test(payloadStr)) score += 20;
  // External recipient: any email/phone/external URL in payload raises risk
  if (/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/.test(payloadStr)) score += 10;
  if (/\bhttps?:\/\/(?!localhost|127\.0\.0\.1)/.test(payloadStr)) score += 5;
  return Math.min(100, score);
}

function RiskBadge({ score }: { score: number }) {
  const Icon = score >= 70 ? ShieldAlert : score >= 40 ? TrendingUp : ShieldCheck;
  const color = score >= 70 ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
    : score >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border', color)}>
      <Icon className="w-3 h-3" />
      Risk {score}/100
    </span>
  );
}

function walkPayload(payload: unknown, visit: (key: string, value: unknown) => void, parentKey = '') {
  if (!payload || typeof payload !== 'object') return;
  if (Array.isArray(payload)) {
    payload.forEach((value, index) => walkPayload(value, visit, `${parentKey}[${index}]`));
    return;
  }
  Object.entries(payload as Record<string, unknown>).forEach(([key, value]) => {
    const path = parentKey ? `${parentKey}.${key}` : key;
    visit(path, value);
    if (value && typeof value === 'object') walkPayload(value, visit, path);
  });
}

function extractDecisionContext(request: ApprovalRequest, riskScore: number) {
  const payload = request.action_payload || {};
  const flatText = JSON.stringify(payload);
  let amount: string | null = null;
  let entity: string | null = null;
  let recipient: string | null = null;
  let externalUrl: string | null = null;
  const sensitive = new Set<string>();

  walkPayload(payload, (key, value) => {
    const lowerKey = key.toLowerCase();
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!text) return;

    if (!amount && /(amount|total|price|salary|ctc|refund|invoice|payment|payout)/i.test(lowerKey)) {
      const numeric = Number(String(text).replace(/[^\d.-]/g, ''));
      if (Number.isFinite(numeric) && numeric > 0) {
        const currency = /(usd|dollar|\$)/i.test(flatText) ? 'USD' : 'INR';
        amount = new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency,
          maximumFractionDigits: numeric >= 100 ? 0 : 2,
        }).format(numeric);
      }
    }

    if (!recipient && /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(text)) {
      recipient = text.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i)?.[0] || null;
    }

    if (!recipient && /(phone|mobile|whatsapp|to|recipient|customer|employee|candidate|vendor)/i.test(lowerKey) && text.length <= 80) {
      recipient = text;
    }

    if (!externalUrl && /^https?:\/\//i.test(text) && !/localhost|127\.0\.0\.1/i.test(text)) {
      externalUrl = text;
    }

    if (!entity && /(employee|candidate|customer|vendor|invoice|ticket|issue|order|record|lead|job|account|user).*?(id|name|number)?$/i.test(lowerKey) && text.length <= 80) {
      entity = text;
    }

    if (/\b(aadhaar|pan|passport|password|secret|token|api[_-]?key|bank|ifsc|upi)\b/i.test(`${lowerKey} ${text}`)) {
      sensitive.add(lowerKey.split('.').pop()?.replace(/_/g, ' ') || 'sensitive data');
    }
  });

  const action = request.action.toLowerCase();
  const impact = (() => {
    if (action.includes('delete') || action.includes('remove')) return 'Approving will permanently remove or disable data in the connected app.';
    if (amount) return `Approving may create or update a financial action worth ${amount}.`;
    if (recipient && (action.includes('send') || action.includes('message') || action.includes('email'))) return `Approving will send communication to ${recipient}.`;
    if (action.includes('update')) return 'Approving will modify an existing business record.';
    if (action.includes('create')) return 'Approving will create a new business record.';
    return 'Approving lets the agent continue this governed workflow.';
  })();

  const whyReview = request.reason_message
    || request.recommended_next_action
    || (riskScore >= 70 ? 'High-risk action based on payload, destination, or action type.' : 'This action matched a human-review policy.');

  const safeToShowSignals = Array.from(sensitive).slice(0, 3);
  const recommendedDecision = (() => {
    if (riskScore >= 70) return 'Hold or escalate unless the business owner, affected item, and destination are verified.';
    if (externalUrl || safeToShowSignals.length > 0) return 'Review context carefully before approving because the request touches an external destination or sensitive data.';
    if (amount) return 'Approve only after the amount and counterparty match the source system.';
    return 'Approve if the requested action matches the business reason and the affected record is expected.';
  })();
  const reviewChecklist = [
    entity || recipient ? 'Affected person, record, or recipient is expected.' : 'Affected record is clear enough to identify.',
    amount ? 'Amount matches the source document or finance system.' : 'No unexpected financial value is hidden in the payload.',
    externalUrl ? 'External destination is trusted and business-approved.' : 'No unexpected external destination detected.',
  ];

  return {
    app: friendlyService(request.service),
    action: friendlyAction(request.action),
    amount,
    entity,
    recipient,
    externalUrl,
    impact,
    whyReview,
    sensitiveSignals: safeToShowSignals,
    recommendedDecision,
    reviewChecklist,
    expectedOutcome: `${friendlyService(request.service)} will receive the ${friendlyAction(request.action)} request and Zapheit will attach the approval decision to the audit trail.`,
  };
}

function SlaCountdown({ createdAt, slaHours, escalatedAt }: { createdAt: string; slaHours?: number | null; escalatedAt?: string | null }) {
  const hours = slaHours ?? 24;
  const dueAt = new Date(new Date(createdAt).getTime() + hours * 60 * 60 * 1000);
  const now = new Date();
  const hoursLeft = (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  const overdue = hoursLeft <= 0;
  const warning = !overdue && hoursLeft < hours * 0.5;
  const color = overdue ? 'text-rose-400' : warning ? 'text-amber-400' : 'text-emerald-400';
  const label = overdue
    ? `Overdue by ${Math.abs(Math.round(hoursLeft))}h`
    : `Due in ${Math.round(hoursLeft)}h`;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', color)}>
      <Shield className="w-3 h-3" />
      {label}
      {escalatedAt && <span className="ml-1 text-rose-400 font-medium">· Escalated</span>}
    </span>
  );
}

type ReviewState = { note: string; submitting: boolean };

function PendingCard({
  request,
  selected,
  highlighted,
  onSelect,
  onApprove,
  onDeny,
  onCancel,
  onSnooze,
  onEscalate,
}: {
  request: ApprovalRequest & { risk_score?: number | null; sla_deadline?: string | null; sla_hours?: number | null; escalated_at?: string | null; delegate_to_user_id?: string | null; snoozed_until?: string | null; sub_tasks?: Array<{title: string; completed: boolean}>; tags?: string[] };
  selected: boolean;
  highlighted?: boolean;
  onSelect: (id: string) => void;
  onApprove: (id: string, note: string) => Promise<void>;
  onDeny: (id: string, note: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onSnooze: (id: string, hours: number) => Promise<void>;
  onEscalate: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [review, setReview] = useState<ReviewState>({ note: '', submitting: false });
  const [showNote, setShowNote] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showDelegate, setShowDelegate] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [delegateEmail, setDelegateEmail] = useState('');
  const [delegating, setDelegating] = useState(false);
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState<Array<{id: string; content: string; created_at: string}>>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [subTasks, setSubTasks] = useState(request.sub_tasks ?? []);
  const isExpired = new Date(request.expires_at) < new Date();
  const isSnoozed = request.snoozed_until && new Date(request.snoozed_until) > new Date();

  const handleApprove = async () => {
    setReview(r => ({ ...r, submitting: true }));
    await onApprove(request.id, review.note);
    setReview(r => ({ ...r, submitting: false }));
  };

  const handleDeny = async () => {
    setReview(r => ({ ...r, submitting: true }));
    await onDeny(request.id, review.note);
    setReview(r => ({ ...r, submitting: false }));
  };

  const loadComments = async () => {
    if (commentsLoaded) return;
    const res = await api.approvals.getComments(request.id);
    if (res.success) setComments(res.data || []);
    setCommentsLoaded(true);
  };

  const submitComment = async () => {
    if (!comment.trim()) return;
    const res = await api.approvals.addComment(request.id, comment.trim());
    if (res.success && res.data) {
      setComments(prev => [...prev, res.data]);
      setComment('');
    } else {
      toast.error('Failed to post comment');
    }
  };

  const toggleSubTask = async (idx: number) => {
    const updated = subTasks.map((t, i) => i === idx ? { ...t, completed: !t.completed } : t);
    setSubTasks(updated);
    await api.approvals.updateSubTasks(request.id, updated);
  };

  const riskScore = computeRiskScore(request);
  const decisionContext = extractDecisionContext(request, riskScore);
  const riskTone = riskScore >= 70 ? 'risk' : riskScore >= 40 ? 'review' : 'standard';

  return (
    <div className={cn(
      'rounded-xl border p-5 space-y-4 transition-colors',
      highlighted ? 'border-amber-400/40 bg-amber-500/8 shadow-[0_0_0_1px_rgba(251,191,36,0.16)]' :
      selected ? 'border-cyan-500/40 bg-cyan-500/5' :
      isSnoozed ? 'border-slate-700 bg-white/[0.02] opacity-60' :
      isExpired ? 'border-slate-700 bg-white/[0.02] opacity-60' :
      'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
    )} id={`approval-${request.id}`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Selection checkbox */}
        <button onClick={() => onSelect(request.id)} className="mt-1 shrink-0 text-slate-500 hover:text-cyan-400 transition-colors">
          {selected ? <CheckSquare2 className="w-4 h-4 text-cyan-400" /> : <Square className="w-4 h-4" />}
        </button>
        {/* Agent avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-800">
          <Bot className="h-5 w-5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Plain-English "wants to" headline */}
          <p className="text-base font-semibold text-white leading-tight">
            Agent wants approval to{' '}
            <span className="text-cyan-300">{decisionContext.action}</span>
            <span className="text-slate-400 font-normal text-sm"> in {decisionContext.app}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <RiskBadge score={riskScore} />
            <SlaCountdown createdAt={request.created_at} slaHours={(request as any).sla_hours} escalatedAt={(request as any).escalated_at} />
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
              riskTone === 'risk' ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                : riskTone === 'review' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
            )}>
              {riskTone === 'risk' ? 'Manager review' : riskTone === 'review' ? 'Needs context' : 'Routine check'}
            </span>
            {(request as any).delegate_to_user_id && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-400"><UserCheck className="w-3 h-3" />Delegated</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1.5">
            <span>Requested by: <span className="text-slate-300">{request.requested_by}</span></span>
            <span>Needs: <span className="text-amber-300">{ROLE_LABELS[request.required_role] || request.required_role}</span></span>
            {request.source ? <span>Via: <span className="text-slate-300 capitalize">{request.source}</span></span> : null}
            {request.agent_id ? (
              <button
                onClick={() => navigate(`/dashboard/agents/${request.agent_id}/profile`)}
                className="inline-flex items-center gap-1 text-cyan-300 transition-colors hover:text-cyan-200"
              >
                <Bot className="h-3 w-3" />
                Agent profile
              </button>
            ) : null}
          </div>
          {/* Tags */}
          {(request as any).tags && (request as any).tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(request as any).tags.map((tag: string) => (
                <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-300 border border-slate-600">
                  <Tag className="w-2.5 h-2.5" />{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 text-xs">
          {isSnoozed
            ? <span className="text-blue-400 flex items-center gap-1"><BellOff className="w-3 h-3" />Snoozed</span>
            : isExpired
            ? <span className="text-slate-500">Expired</span>
            : <span className="text-amber-400">{formatTimeUntil(request.expires_at)}</span>
          }
          <span className="text-slate-500">{formatTimeAgo(request.created_at)}</span>
        </div>
      </div>

      {/* Decision brief */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Decision brief</p>
            <p className="mt-1 text-sm font-semibold text-white">{decisionContext.impact}</p>
            <p className="mt-1 text-xs text-slate-400">{decisionContext.whyReview}</p>
          </div>
          <button
            onClick={() => setShowPayload(v => !v)}
            className="self-start rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {showPayload ? 'Hide payload' : 'Inspect payload'}
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'App', value: decisionContext.app },
            { label: 'Affected item', value: decisionContext.entity || decisionContext.recipient || 'Not specified' },
            { label: 'Amount', value: decisionContext.amount || 'No amount detected' },
            { label: 'Audit result', value: request.audit_ref ? `Ref ${request.audit_ref}` : 'Decision will be logged' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
              <p className="mt-1 truncate text-xs font-medium text-slate-200">{item.value}</p>
            </div>
          ))}
        </div>

        {(decisionContext.sensitiveSignals.length > 0 || decisionContext.externalUrl) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {decisionContext.sensitiveSignals.map((signal) => (
              <span key={signal} className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300">
                Sensitive: {signal}
              </span>
            ))}
            {decisionContext.externalUrl && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300">
                External destination
              </span>
            )}
          </div>
        )}

        <div className="mt-3 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.05] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">If approved</p>
          <p className="mt-1 text-xs text-slate-300">{decisionContext.expectedOutcome}</p>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">Recommended decision path</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{decisionContext.recommendedDecision}</p>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reviewer checklist</p>
            <div className="mt-1 space-y-1">
              {decisionContext.reviewChecklist.map((item) => (
                <div key={item} className="flex items-start gap-2 text-xs text-slate-300">
                  <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {showPayload && (
          <div className="mt-3">
            <PayloadPreview payload={request.action_payload} />
          </div>
        )}
      </div>

      <ReasonCallout
        reasonMessage={request.reason_message}
        recommendedNextAction={request.recommended_next_action}
      />

      {/* Sub-tasks */}
      {subTasks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-400 flex items-center gap-1"><ListTodo className="w-3 h-3" />Sub-tasks</p>
          {subTasks.map((t, i) => (
            <label key={i} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white">
              <input type="checkbox" checked={t.completed} onChange={() => toggleSubTask(i)} className="accent-cyan-400" />
              <span className={t.completed ? 'line-through text-slate-500' : ''}>{t.title}</span>
            </label>
          ))}
        </div>
      )}

      {/* Note + Actions */}
      {!isExpired && !isSnoozed && (
        <div className="space-y-3 pt-1 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowNote(v => !v)} className="text-xs text-slate-400 hover:text-white transition-colors">
              {showNote ? 'Hide note' : 'Add note'}
            </button>
            <button
              onClick={() => { setShowComments(v => !v); if (!showComments) loadComments(); }}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <MessageSquare className="w-3 h-3" />
              Comments {comments.length > 0 ? `(${comments.length})` : ''}
            </button>
            <button onClick={() => setShowSnooze(v => !v)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
              <BellOff className="w-3 h-3" />
              Snooze
            </button>
            <button
              onClick={() => onEscalate(request.id)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ShieldAlert className="w-3 h-3" />
              Escalate
            </button>
            <button onClick={() => setShowDelegate(v => !v)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
              <UserCheck className="w-3 h-3" />
              Delegate
            </button>
          </div>
          {showDelegate && (
            <div className="flex gap-2 items-center">
              <input
                type="email"
                value={delegateEmail}
                onChange={(e) => setDelegateEmail(e.target.value)}
                placeholder="Delegate to user ID or email…"
                className="flex-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
              />
              <button
                disabled={delegating || !delegateEmail.trim()}
                onClick={async () => {
                  setDelegating(true);
                  try {
                    const res = await api.approvals.delegate(request.id, delegateEmail.trim());
                    if (res?.success) {
                      toast.success('Approval delegated');
                      setShowDelegate(false);
                      setDelegateEmail('');
                    } else {
                      toast.error(res?.error || 'Failed to delegate');
                    }
                  } finally {
                    setDelegating(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs hover:bg-violet-500/20 transition-colors disabled:opacity-40"
              >
                {delegating ? 'Delegating…' : 'Confirm'}
              </button>
            </div>
          )}
          {showNote && (
            <textarea
              value={review.note}
              onChange={e => setReview(r => ({ ...r, note: e.target.value }))}
              placeholder="Reason for approval or denial…"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/50"
              rows={2}
              maxLength={2000}
            />
          )}
          {showSnooze && (
            <div className="flex gap-2">
              {([1, 4, 24] as const).map(h => (
                <button
                  key={h}
                  onClick={async () => { await onSnooze(request.id, h); setShowSnooze(false); }}
                  className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs hover:bg-blue-500/20 transition-colors"
                >
                  {h}h
                </button>
              ))}
            </div>
          )}
          {showComments && (
            <div className="bg-black/20 rounded-lg p-3 space-y-3">
              {comments.map(c => (
                <div key={c.id} className="text-xs text-slate-300">
                  <span className="text-slate-500">{formatTimeAgo(c.created_at)} · </span>
                  {c.content}
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitComment()}
                  placeholder="Add a comment…"
                  className="flex-1 px-2 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
                <button onClick={submitComment} className="px-3 py-1.5 bg-cyan-600/80 hover:bg-cyan-600 text-white text-xs rounded-lg transition-colors">
                  Post
                </button>
              </div>
            </div>
          )}
          {riskScore < 30 && (
            <p className="text-xs text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Low risk — will be auto-approved if no response in 2 hours
            </p>
          )}
          {riskScore >= 70 && (
            <p className="text-xs text-rose-400 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              High risk — will be escalated to manager if no response in 2 hours
            </p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleApprove}
              disabled={review.submitting}
              className="flex min-h-[44px] items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {review.submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Allow
            </button>
            <button
              onClick={handleDeny}
              disabled={review.submitting}
              className="flex min-h-[44px] items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600/70 hover:bg-rose-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {review.submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Block
            </button>
            <button
              onClick={() => {
                setShowNote(true);
                setReview(r => ({
                  ...r,
                  note: r.note || 'Please revise the payload and resubmit with clearer business justification.',
                }));
              }}
              disabled={review.submitting}
              className="flex min-h-[44px] items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-200 text-sm font-semibold transition-colors hover:bg-amber-500/20 disabled:opacity-50"
            >
              Ask changes
            </button>
            <button
              onClick={() => onCancel(request.id)}
              disabled={review.submitting}
              className="ml-auto flex min-h-[44px] items-center gap-1.5 px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs transition-colors disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-slate-600">Auto-blocked after 24hrs if no response</p>
        </div>
      )}
    </div>
  );
}

function HistoryCard({ request, highlighted = false }: { request: ApprovalRequest; highlighted?: boolean }) {
  return (
    <div
      id={`approval-${request.id}`}
      className={cn(
        'rounded-xl border p-4 space-y-3',
        highlighted
          ? 'border-amber-400/40 bg-amber-500/8 shadow-[0_0_0_1px_rgba(251,191,36,0.16)]'
          : 'border-white/10 bg-white/[0.02]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusBadge status={request.status} />
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">
              {request.service}
            </span>
            <span className="text-sm font-medium text-white truncate">{request.action}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>From: <span className="text-slate-400">{request.requested_by}</span></span>
            {request.reviewer_id && <span>Reviewed by: <span className="text-slate-400 font-mono text-[10px]">{request.reviewer_id.slice(0, 8)}…</span></span>}
            {request.source ? <span>Entry: <span className="text-slate-300 capitalize">{request.source}</span></span> : null}
            {request.job_id ? <span>Run: <span className="text-slate-400 font-mono text-[10px]">{request.job_id.slice(0, 8)}…</span></span> : null}
            {request.approval_source ? <span>Type: <span className="text-slate-300">{request.approval_source === 'job_approval' ? 'Governed job' : 'Connector approval'}</span></span> : null}
          </div>
        </div>
        <span className="text-xs text-slate-500 shrink-0">
          {request.reviewed_at ? formatTimeAgo(request.reviewed_at) : formatTimeAgo(request.created_at)}
        </span>
      </div>
      {request.reviewer_note && (
        <p className="text-sm text-slate-400 italic border-l-2 border-white/10 pl-3">
          "{request.reviewer_note}"
        </p>
      )}
      <ReasonCallout
        reasonMessage={request.reason_message}
        recommendedNextAction={request.recommended_next_action}
      />
      <PayloadPreview payload={request.action_payload} />
    </div>
  );
}

export default function ApprovalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const approvalIdParam = searchParams.get('approvalId');
  const serviceParam = searchParams.get('service');
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>('queue');
  const [all, setAll] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const pending = all.filter(r => r.status === 'pending');
  const history = all.filter(r => r.status !== 'pending');
  const focusedApproval = approvalIdParam ? all.find((request) => request.id === approvalIdParam) : null;
  const sortedPending = [...pending].sort((left, right) => {
    const leftRisk = computeRiskScore(left);
    const rightRisk = computeRiskScore(right);
    const leftDue = new Date((left as any).sla_deadline || left.expires_at).getTime();
    const rightDue = new Date((right as any).sla_deadline || right.expires_at).getTime();
    const leftOverdue = Number.isFinite(leftDue) && leftDue < Date.now();
    const rightOverdue = Number.isFinite(rightDue) && rightDue < Date.now();
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (leftRisk !== rightRisk) return rightRisk - leftRisk;
    return (Number.isFinite(leftDue) ? leftDue : Infinity) - (Number.isFinite(rightDue) ? rightDue : Infinity);
  });
  const highRiskPending = pending.filter((request) => computeRiskScore(request) >= 70);
  const overduePending = pending.filter((request) => {
    const dueAt = new Date((request as any).sla_deadline || request.expires_at).getTime();
    return Number.isFinite(dueAt) && dueAt < Date.now();
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.approvals.list({ limit: 200 });
      if (res.success) setAll(res.data || []);
      else toast.error(res.error || 'Failed to load approval requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!requestedTab && !approvalIdParam) return;
    if (requestedTab === 'history' || requestedTab === 'queue') {
      setTab(requestedTab);
      return;
    }
    if (focusedApproval) {
      setTab(focusedApproval.status === 'pending' ? 'queue' : 'history');
    }
  }, [approvalIdParam, focusedApproval, requestedTab]);

  useEffect(() => {
    if (!approvalIdParam) return;
    const node = document.getElementById(`approval-${approvalIdParam}`);
    if (!node) return;
    window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [approvalIdParam, pending.length, history.length, tab]);

  const clearFocusParams = useCallback(() => {
    setSearchParams((params) => {
      params.delete('approvalId');
      params.delete('service');
      params.delete('tab');
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleApprove = async (id: string, note: string) => {
    const res = await api.approvals.approve(id, note || undefined);
    if (res.success) {
      toast.success('Request approved');
      setAll(prev => prev.map(r => r.id === id ? { ...r, ...(res.data || {}), status: 'approved', reviewer_note: note || null, reviewed_at: new Date().toISOString() } : r));
    } else {
      toast.error(res.error || 'Failed to approve request');
    }
  };

  const handleDeny = async (id: string, note: string) => {
    const res = await api.approvals.deny(id, note || undefined);
    if (res.success) {
      toast.success('Request denied');
      setAll(prev => prev.map(r => r.id === id ? { ...r, ...(res.data || {}), status: 'denied', reviewer_note: note || null, reviewed_at: new Date().toISOString() } : r));
    } else {
      toast.error(res.error || 'Failed to deny request');
    }
  };

  const handleCancel = async (id: string) => {
    const res = await api.approvals.cancel(id);
    if (res.success) {
      toast.success('Request cancelled');
      setAll(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
    } else {
      toast.error(res.error || 'Failed to cancel request');
    }
  };

  const handleSnooze = async (id: string, hours: number) => {
    const res = await api.approvals.snooze(id, hours as 1 | 4 | 24);
    if (res.success) {
      toast.success(`Request snoozed for ${hours}h`);
      const snoozedUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      setAll(prev => prev.map(r => r.id === id ? { ...r, snoozed_until: snoozedUntil } : r));
    } else {
      toast.error(res.error || 'Failed to snooze request');
    }
  };

  const handleEscalate = async (id: string) => {
    const res = await api.approvals.escalate(id);
    if (res.success) {
      toast.success('Request escalated');
      setAll(prev => prev.map(r => r.id === id ? { ...r, ...(res.data || {}), escalated_at: new Date().toISOString() } : r));
    } else {
      toast.error(res.error || 'Failed to escalate request');
    }
  };

  const handleBulkApprove = async () => {
    if (selected.size === 0) return;
    setBulkSubmitting(true);
    const res = await api.approvals.bulkApprove([...selected]);
    setBulkSubmitting(false);
    if (res.success) {
      toast.success(`Approved ${res.approved ?? selected.size} requests`);
      setAll(prev => prev.map(r => selected.has(r.id) ? { ...r, status: 'approved', reviewed_at: new Date().toISOString() } : r));
      setSelected(new Set());
    } else {
      toast.error(res.error || 'Bulk approve failed');
    }
  };

  const handleBulkDeny = async () => {
    if (selected.size === 0) return;
    setBulkSubmitting(true);
    const res = await api.approvals.bulkDeny([...selected]);
    setBulkSubmitting(false);
    if (res.success) {
      toast.error(`Denied ${res.denied ?? selected.size} requests`);
      setAll(prev => prev.map(r => selected.has(r.id) ? { ...r, status: 'denied', reviewed_at: new Date().toISOString() } : r));
      setSelected(new Set());
    } else {
      toast.error(res.error || 'Bulk deny failed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <CheckSquare className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="inline-flex items-center text-2xl font-bold text-white">
              Action Inbox
              <HelpTip text={HELP_TIPS.humanReview} />
            </h1>
            <p className="text-sm text-slate-400">Sensitive requests requiring your review.</p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {focusedApproval && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-semibold text-white">Focused approval</p>
            <p className="mt-1 text-amber-100/80">
              Reviewing <span className="font-medium text-white">{focusedApproval.service}</span> / <span className="font-medium text-white">{focusedApproval.action}</span>
              {serviceParam ? ` from ${serviceParam}` : ''}.
            </p>
          </div>
          <button
            onClick={clearFocusParams}
            className="rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.09]"
          >
            Clear focus
          </button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: 'Pending decisions', value: pending.length, tone: pending.length > 0 ? 'text-amber-300' : 'text-emerald-300', note: 'Waiting for human review' },
          { label: 'High-risk', value: highRiskPending.length, tone: highRiskPending.length > 0 ? 'text-rose-300' : 'text-emerald-300', note: 'Needs extra context' },
          { label: 'Overdue', value: overduePending.length, tone: overduePending.length > 0 ? 'text-rose-300' : 'text-emerald-300', note: 'Past SLA or expiry' },
          { label: 'Reviewed', value: history.length, tone: 'text-cyan-300', note: 'Audit-ready decisions' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
            <p className={cn('mt-1 text-2xl font-bold', card.tone)}>{card.value}</p>
            <p className="mt-1 text-xs text-slate-500">{card.note}</p>
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
          <span className="text-sm text-cyan-300 font-medium">{selected.size} selected</span>
          <button
            onClick={handleBulkApprove}
            disabled={bulkSubmitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            {bulkSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Approve All
          </button>
          <button
            onClick={handleBulkDeny}
            disabled={bulkSubmitting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/70 hover:bg-red-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
          >
            {bulkSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
            Deny All
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-400 hover:text-white transition-colors">
            Deselect all
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-white/[0.04] rounded-xl border border-white/[0.06] w-fit">
        {([
          { id: 'queue' as Tab, label: 'Queue', count: pending.length },
          { id: 'history' as Tab, label: 'History', count: history.length },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:text-white'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                'px-1.5 py-0.5 rounded-full text-xs font-semibold',
                t.id === 'queue' && t.count > 0
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-white/10 text-slate-400'
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        </div>
      ) : tab === 'queue' ? (
        pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500/40 mb-3" />
            <p className="text-white font-medium">Queue is empty</p>
            <p className="text-sm text-slate-400 mt-1">No pending approval requests</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Smart bulk groups: 3+ identical action types get a one-click group approve */}
            {(() => {
              const actionGroups: Record<string, ApprovalRequest[]> = {};
              sortedPending.forEach(r => {
                const key = r.action || 'unknown';
                actionGroups[key] = [...(actionGroups[key] || []), r];
              });
              const groups = Object.entries(actionGroups).filter(([, items]) => items.length >= 3);
              if (groups.length === 0) return null;
              return (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
                  <p className="text-xs font-semibold text-cyan-300 uppercase tracking-wide">Similar requests — approve in bulk</p>
                  <div className="flex flex-wrap gap-2">
                    {groups.map(([action, items]) => (
                      <button
                        key={action}
                        disabled={bulkSubmitting}
                        onClick={async () => {
                          setBulkSubmitting(true);
                          const res = await api.approvals.bulkApprove(items.map(i => i.id));
                          setBulkSubmitting(false);
                          if (res.success) {
                            toast.success(`Approved ${items.length} ${friendlyAction(action)} requests`);
                            const ids = new Set(items.map(i => i.id));
                            setAll(prev => prev.map(r => ids.has(r.id) ? { ...r, status: 'approved', reviewed_at: new Date().toISOString() } : r));
                          } else {
                            toast.error(res.error || 'Bulk approve failed');
                          }
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/20 text-emerald-300 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve all {items.length} &ldquo;{friendlyAction(action)}&rdquo; requests
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {sortedPending.map(r => (
              <PendingCard
                key={r.id}
                request={r as any}
                selected={selected.has(r.id)}
                highlighted={approvalIdParam === r.id}
                onSelect={toggleSelect}
                onApprove={handleApprove}
                onDeny={handleDeny}
                onCancel={handleCancel}
                onSnooze={handleSnooze}
                onEscalate={handleEscalate}
              />
            ))}
          </div>
        )
      ) : (
        history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Clock className="w-12 h-12 text-slate-600 mb-3" />
            <p className="text-white font-medium">No history yet</p>
            <p className="text-sm text-slate-400 mt-1">Reviewed requests will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map(r => (
              <HistoryCard key={r.id} request={r} highlighted={approvalIdParam === r.id} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
