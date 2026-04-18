import { useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { cn } from '../../../../lib/utils';
import type { AIAgent } from '../../../../types';

interface AgentsTabProps {
  agents: AIAgent[];
  rawConnectorId: string | undefined;
  initialLinkedIds: Set<string>;
}

export function AgentsTab({ agents, rawConnectorId, initialLinkedIds }: AgentsTabProps) {
  const [linkedAgentIds, setLinkedAgentIds] = useState<Set<string>>(initialLinkedIds);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);

  const toggleLink = async (agent: AIAgent) => {
    if (!rawConnectorId) return;
    const isLinked = linkedAgentIds.has(agent.id);
    setBusyAgentId(agent.id);
    try {
      const currentIds: string[] = (agent as any).integrationIds || [];
      const newIds = isLinked
        ? currentIds.filter((id) => id !== rawConnectorId)
        : [...new Set([...currentIds, rawConnectorId])];
      const res = await api.unifiedConnectors.updateAgentConnectors(agent.id, newIds);
      if (res.success) {
        setLinkedAgentIds((prev) => {
          const next = new Set(prev);
          if (isLinked) next.delete(agent.id); else next.add(agent.id);
          return next;
        });
        toast.success(isLinked ? `Unlinked from ${agent.name}` : `Linked to ${agent.name}`);
      } else {
        toast.error((res as any).error || 'Failed to update');
      }
    } catch { toast.error('Failed to update'); }
    finally { setBusyAgentId(null); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Toggle which agents can use this app. Linked agents will have these tools available during conversations.</p>
      {agents.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-8">No agents in your workspace yet.</p>
      ) : (
        agents.map((agent) => {
          const isLinked = linkedAgentIds.has(agent.id);
          const isBusy = busyAgentId === agent.id;
          return (
            <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="w-7 h-7 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">{agent.name}</p>
                <p className="text-[10px] text-slate-500">{(agent as any).agent_type || 'agent'}</p>
              </div>
              <button
                onClick={() => void toggleLink(agent)}
                disabled={isBusy || !rawConnectorId}
                className={cn('shrink-0 w-9 h-5 rounded-full transition-colors relative disabled:opacity-50', isLinked ? 'bg-emerald-500' : 'bg-white/10')}
              >
                {isBusy
                  ? <Loader2 className="w-3 h-3 text-white animate-spin absolute top-1 left-3" />
                  : <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', isLinked ? 'translate-x-4' : 'translate-x-0.5')} />
                }
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
