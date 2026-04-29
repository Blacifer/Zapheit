import { Bot, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { toast } from '../../../../../lib/toast';

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  requiresApproval: boolean;
  active: boolean;
}

const DEFAULT_RULES: AutomationRule[] = [
  {
    id: 'r1',
    name: 'Auto-screen new applicants',
    description: 'When a candidate applies, parse their resume and score them against the job description. Flag top matches for recruiter review.',
    trigger: 'New application received (Naukri)',
    action: 'parse_resume → score → notify recruiter',
    requiresApproval: false,
    active: true,
  },
  {
    id: 'r2',
    name: 'InMail top candidates after search',
    description: 'After a candidate search returns results scored above 80%, queue an InMail for each — pending manager approval.',
    trigger: 'search_candidates returns score ≥ 80%',
    action: 'send_inmail (requires approval)',
    requiresApproval: true,
    active: false,
  },
  {
    id: 'r3',
    name: 'Auto-post jobs to Naukri on deadline',
    description: 'When an open role has been unfilled for 30 days, automatically post it to Naukri — pending HR manager approval.',
    trigger: 'Open role older than 30 days',
    action: 'create_job on Naukri (requires approval)',
    requiresApproval: true,
    active: false,
  },
  {
    id: 'r4',
    name: 'Notify recruiter on LinkedIn profile view',
    description: 'When a candidate views your LinkedIn Company Page after receiving an InMail, send a Slack alert to the assigned recruiter.',
    trigger: 'LinkedIn profile view within 48h of InMail',
    action: 'Slack notification to recruiter',
    requiresApproval: false,
    active: false,
  },
];

export default function RecruitmentAutomationTab() {
  const explainRulePrerequisite = (rule: AutomationRule) => {
    toast.info(
      `${rule.name} requires certified recruiting connectors, an approval policy, an owner, and workflow deployment before it can be changed here.`,
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-5 space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400">
          Automation rules run in the background. Actions marked as "requires approval" are queued until a manager approves them in the{' '}
          <span className="text-white font-medium">Approvals</span> section.
          Rules that trigger InMails or job postings always require approval.
        </p>
      </div>

      {/* Rules list */}
      <div className="space-y-3">
        {DEFAULT_RULES.map((rule) => (
          <div
            key={rule.id}
            className={`p-4 rounded-xl border transition-colors ${rule.active ? 'border-violet-500/30 bg-violet-500/5' : 'border-white/8 bg-white/[0.02]'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${rule.active ? 'bg-violet-600/30' : 'bg-white/5'}`}>
                  <Bot className={`w-4 h-4 ${rule.active ? 'text-violet-400' : 'text-slate-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white">{rule.name}</p>
                    {rule.active ? (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle className="w-2.5 h-2.5" /> Active
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-500 border border-white/10">
                        Inactive
                      </span>
                    )}
                    {rule.requiresApproval && (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <AlertTriangle className="w-2.5 h-2.5" /> Needs approval
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{rule.description}</p>
                  <div className="flex items-center gap-4 mt-2 flex-wrap">
                    <span className="text-[11px] text-slate-500">
                      <span className="text-slate-400 font-medium">Trigger:</span> {rule.trigger}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      <span className="text-slate-400 font-medium">Action:</span> {rule.action}
                    </span>
                  </div>
                </div>
              </div>
              <button
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap ${
                  rule.active
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                    : 'border-slate-500/30 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                }`}
                onClick={() => explainRulePrerequisite(rule)}
              >
                View requirements
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-600 text-center pb-4">Custom automation rules can be created in the Workflows section.</p>
    </div>
  );
}
