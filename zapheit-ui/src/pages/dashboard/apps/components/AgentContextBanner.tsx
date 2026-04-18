import { Bot } from 'lucide-react';
import type { AIAgent } from '../../../../types';

interface AgentContextBannerProps {
  agent: AIAgent;
}

export function AgentContextBanner({ agent }: AgentContextBannerProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.06]">
      <Bot className="w-4 h-4 text-violet-300 shrink-0" />
      <p className="text-sm text-slate-300 flex-1">
        Showing apps for <strong className="text-white">{agent.name}</strong> — connected apps will be linked to this agent.
      </p>
    </div>
  );
}
