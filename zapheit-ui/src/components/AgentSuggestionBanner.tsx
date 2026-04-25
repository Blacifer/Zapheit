import { Bot, Zap, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AgentSuggestion {
  agent: string;
  description: string;
}

const AGENT_SUGGESTIONS: Record<string, AgentSuggestion> = {
  'google-workspace': { agent: 'Email Assistant', description: 'Summarise emails, draft replies, and schedule calendar events — all from Zapheit.' },
  'slack':            { agent: 'Team Communication Agent', description: 'Surface action items, route alerts, and keep channels noise-free with AI.' },
  'linkedin':         { agent: 'Hiring Agent', description: 'Rank applicants, draft outreach, and move candidates through your pipeline automatically.' },
  'naukri':           { agent: 'Hiring Agent', description: 'Rank Naukri applicants by fit score, draft JD-matched outreach, and sync shortlists.' },
  'greythr':          { agent: 'HR Assistant', description: 'Auto-triage leave requests, flag payroll anomalies, and answer employee policy questions.' },
  'tally':            { agent: 'Finance Ops Agent', description: 'Flag transaction anomalies, draft GST summaries, and send invoice reminders before they go overdue.' },
  'cashfree':         { agent: 'Finance Ops Agent', description: 'Monitor settlements, flag failed payouts, and auto-initiate reconciliation tasks.' },
  'freshdesk':        { agent: 'Support Agent', description: 'Draft ticket replies, escalate SLA breaches, and surface CSAT trends before they become incidents.' },
  'hubspot':          { agent: 'Sales Agent', description: 'Update deals, surface at-risk leads, and draft follow-up emails at the right moment.' },
  'jira':             { agent: 'DevOps Agent', description: 'Triage bug reports, move stale issues, and auto-generate release notes from closed sprints.' },
  'github':           { agent: 'DevOps Agent', description: 'Summarise PRs, flag risky diffs, and auto-assign reviewers based on code ownership.' },
  'quickbooks':       { agent: 'Finance Ops Agent', description: 'Reconcile transactions, flag overdue invoices, and prepare monthly P&L snapshots.' },
  'notion':           { agent: 'Team Communication Agent', description: 'Keep docs current, surface stale pages, and draft meeting notes from conversation context.' },
  'microsoft-365':    { agent: 'Email Assistant', description: 'Summarise Outlook threads, draft replies, and sync Teams tasks into your workflow.' },
  'zoho':             { agent: 'HR Assistant', description: 'Triage Zoho leave and payroll events, and answer HR policy questions for your team.' },
};

interface Props {
  serviceId: string;
  onDismiss: () => void;
}

export default function AgentSuggestionBanner({ serviceId, onDismiss }: Props) {
  const navigate = useNavigate();
  const suggestion = AGENT_SUGGESTIONS[serviceId];
  if (!suggestion) return null;

  return (
    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">No agent attached yet</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Attach <span className="text-blue-300 font-medium">{suggestion.agent}</span> to {suggestion.description}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => navigate(`/dashboard/agents/new?template=${encodeURIComponent(suggestion.agent)}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
        >
          <Zap className="w-3 h-3" /> Attach Agent
        </button>
        <button onClick={onDismiss} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
