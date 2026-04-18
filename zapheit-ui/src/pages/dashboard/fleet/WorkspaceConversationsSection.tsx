import { Clock3, Loader2, MessageSquare } from 'lucide-react';
import type { AgentWorkspaceConversation } from '../../../types';

interface WorkspaceConversationsSectionProps {
  agentId: string;
  conversations: AgentWorkspaceConversation[];
  conversationsError: string | null;
  loadingConversations: boolean;
  onOpenOperationsPage?: (page: string, options?: { agentId?: string }) => void;
}

export function WorkspaceConversationsSection({
  agentId,
  conversations,
  conversationsError,
  loadingConversations,
  onOpenOperationsPage,
}: WorkspaceConversationsSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-white">Recent conversations</h3>
        <button
          onClick={() => onOpenOperationsPage?.('conversations', { agentId })}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 inline-flex items-center gap-1.5"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Open full inbox
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {loadingConversations ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-slate-300 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading recent conversations...
          </div>
        ) : conversationsError ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-100">
            {conversationsError}
          </div>
        ) : conversations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-slate-400">
            No conversations recorded for this agent yet.
          </div>
        ) : (
          conversations.map((conversation) => (
            <div key={conversation.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-white truncate">{conversation.topic}</h4>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                      {conversation.status}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                      {conversation.platform}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 inline-flex items-center gap-1">
                    <Clock3 className="w-3.5 h-3.5" />
                    {new Date(conversation.timestamp).toLocaleString()} • {conversation.user}
                  </div>
                  <p className="mt-3 text-sm text-slate-300 line-clamp-3">{conversation.preview}</p>
                </div>
                <button
                  onClick={() => onOpenOperationsPage?.('conversations', { agentId })}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  Review
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
