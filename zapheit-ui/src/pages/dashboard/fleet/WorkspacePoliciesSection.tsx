import { Loader2, Shield } from 'lucide-react';

interface PolicyDraft {
  systemPrompt: string;
  operationalPolicy: string;
}

interface WorkspacePoliciesSectionProps {
  agentId: string;
  policyDraft: PolicyDraft;
  setPolicyDraft: React.Dispatch<React.SetStateAction<PolicyDraft>>;
  policySaving: boolean;
  saveWorkspacePolicies: () => Promise<void>;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
}

export function WorkspacePoliciesSection({
  agentId,
  policyDraft,
  setPolicyDraft,
  policySaving,
  saveWorkspacePolicies,
  onOpenOperationsPage,
}: WorkspacePoliciesSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-white">Persona and policy controls</h3>
        <button
          onClick={() => onOpenOperationsPage?.('persona', { agentId })}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
        >
          Open full editor
        </button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <label className="block">
            <div className="text-sm font-semibold text-white">System prompt</div>
            <div className="text-sm text-slate-400 mt-1">Primary instructions that define how this agent should behave.</div>
            <textarea
              value={policyDraft.systemPrompt}
              onChange={(e) => setPolicyDraft((current) => ({ ...current, systemPrompt: e.target.value }))}
              rows={12}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              placeholder="Describe the role, tone, escalation triggers, and hard constraints for this agent."
            />
          </label>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <label className="block">
            <div className="text-sm font-semibold text-white">Operational policy</div>
            <div className="text-sm text-slate-400 mt-1">Plain-English rules for approvals, refunds, escalations, or anything this agent must never do.</div>
            <textarea
              value={policyDraft.operationalPolicy}
              onChange={(e) => setPolicyDraft((current) => ({ ...current, operationalPolicy: e.target.value }))}
              rows={12}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              placeholder="Example: Refunds above $100 require human approval. Escalate legal threats immediately. Never promise timelines not in policy."
            />
          </label>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => void saveWorkspacePolicies()}
          disabled={policySaving}
          className="rounded-xl bg-blue-500/20 border border-blue-400/30 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-500/25 disabled:opacity-60 inline-flex items-center gap-2"
        >
          {policySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          Save policy changes
        </button>
      </div>
    </div>
  );
}
