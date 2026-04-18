import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, Sparkles, XCircle } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import type { ApprovalRequest } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { UnifiedApp } from '../types';

interface ApprovalsTabProps {
  serviceId: string;
  app: UnifiedApp;
  linkedAgentIds?: string[];
  onChanged?: () => Promise<void> | void;
}

function isLikelyWriteAction(action: string) {
  return /(create|update|delete|send|post|refund|payout|write|publish|invite|assign|approve|modify|sync)/i.test(action);
}

function chooseSimulationAction(app: UnifiedApp) {
  const policies = app.capabilityPolicies || [];
  const approvalGated = policies.find((item) => item.enabled && item.requires_human_approval);
  if (approvalGated) return approvalGated.capability;

  const writeLike = policies.find((item) => item.enabled && isLikelyWriteAction(item.capability));
  if (writeLike) return writeLike.capability;

  const capability = (app.agentCapabilities || []).find((item) => isLikelyWriteAction(item))
    || (app.agentCapabilities || [])[0];
  return capability || 'update_record';
}

function buildSimulationPayload(action: string, appName: string) {
  const normalized = action.toLowerCase();
  if (normalized.includes('refund')) {
    return { amount: 1499, currency: 'INR', reason: `Operator-requested refund test from ${appName}`, reference: `sim-${Date.now()}` };
  }
  if (normalized.includes('message') || normalized.includes('send') || normalized.includes('email') || normalized.includes('post')) {
    return { subject: `Simulated ${appName} outbound action`, body: 'This is a governed approval smoke test from the Apps workspace.', recipient: 'ops@example.com' };
  }
  if (normalized.includes('ticket') || normalized.includes('case')) {
    return { title: `Simulated ${appName} escalation`, priority: 'high', description: 'Created from the Apps HITL smoke test.' };
  }
  return {
    entity_id: `sim-${Date.now()}`,
    update_reason: `Simulated write action for ${appName}`,
    summary: 'Created from the Apps HITL smoke test.',
  };
}

export function ApprovalsTab({ serviceId, app, linkedAgentIds = [], onChanged }: ApprovalsTabProps) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [simulateBusy, setSimulateBusy] = useState(false);
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const simulationAction = useMemo(() => chooseSimulationAction(app), [app]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const res = await api.approvals.list({ service: serviceId, status: 'pending', limit: 50 });
    if (res.success) {
      setItems(res.data || []);
    }
    setLoading(false);
  }, [serviceId]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      const res = await api.approvals.list({ service: serviceId, status: 'pending', limit: 50 });
      if (mounted && res.success) {
        setItems(res.data || []);
      }
      if (mounted) setLoading(false);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [serviceId]);

  const updateItem = (id: string, status: ApprovalRequest['status']) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, status } : item).filter((item) => item.status === 'pending'));
  };

  const afterDecision = async () => {
    await loadItems();
    await onChanged?.();
  };

  const approve = async (id: string) => {
    setBusyId(id);
    const res = await api.approvals.approve(id);
    if (res.success) {
      updateItem(id, 'approved');
      const execution = (res as any).execution;
      toast.success(execution?.resumed ? 'Approval granted and execution resumed' : 'Approval granted');
      await afterDecision();
    } else {
      toast.error((res as any).error || 'Approval failed');
    }
    setBusyId(null);
  };

  const deny = async (id: string) => {
    setBusyId(id);
    const res = await api.approvals.deny(id);
    if (res.success) {
      updateItem(id, 'denied');
      toast.success('Request denied');
      await afterDecision();
    } else {
      toast.error((res as any).error || 'Deny failed');
    }
    setBusyId(null);
  };

  const simulateWriteAction = async () => {
    setSimulateBusy(true);
    const payload = buildSimulationPayload(simulationAction, app.name);
    const agentId = linkedAgentIds[0];
    const res = await api.unifiedConnectors.toolCall(serviceId, {
      action: simulationAction,
      params: payload,
      ...(agentId ? { agentId } : {}),
    });
    if (res.success) {
      const data = res.data;
      if (data?.paused || data?.state === 'pending_approval') {
        toast.success('Simulated write action paused for approval');
      } else {
        toast.success('Simulated write action executed directly');
      }
      await loadItems();
      await onChanged?.();
    } else {
      toast.error(res.error || 'Simulation failed');
    }
    setSimulateBusy(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <p className="text-sm font-medium text-white">No pending approvals</p>
        <p className="mt-1 text-xs text-slate-400">High-impact actions appear here before Zapheit sends the real request to the connected app.</p>
        {import.meta.env.DEV && (
          <button
            onClick={() => void simulateWriteAction()}
            disabled={simulateBusy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100 disabled:opacity-60"
          >
            {simulateBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Simulate Agent Write Action
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">Approve or reject high-impact agent actions before Zapheit executes them in the connected app.</p>
        {import.meta.env.DEV && (
          <button
            onClick={() => void simulateWriteAction()}
            disabled={simulateBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100 disabled:opacity-60"
          >
            {simulateBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Simulate Agent Write Action
          </button>
        )}
      </div>
      {items.map((item) => {
        const isBusy = busyId === item.id;
        return (
          <div key={item.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <p className="text-xs font-semibold text-white">{item.action}</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{item.reason_message || 'Approval required before execution.'}</p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Agent: {item.agent_id || 'Manual/operator'} · Risk: {item.risk_score ?? 'n/a'}
                </p>
                {item.recommended_next_action && (
                  <p className="mt-1 text-[11px] text-cyan-300">Next: {item.recommended_next_action}</p>
                )}
                <pre className="mt-2 rounded-lg border border-white/8 bg-black/20 p-2 text-[10px] text-slate-400 overflow-x-auto">
{JSON.stringify(item.action_payload || {}, null, 2)}
                </pre>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button
                  onClick={() => void approve(item.id)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-200 border border-emerald-400/20 disabled:opacity-60"
                >
                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Approve
                </button>
                <button
                  onClick={() => void deny(item.id)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-1.5 text-[11px] font-medium text-rose-200 border border-rose-400/20 disabled:opacity-60"
                >
                  <XCircle className="w-3 h-3" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
