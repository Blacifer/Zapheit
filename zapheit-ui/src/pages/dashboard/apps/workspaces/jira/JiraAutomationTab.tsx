import { useState, useCallback } from 'react';
import {
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Play,
  Plus,
  Shield,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Zap,
  AlertCircle,
  GitPullRequest,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { useAgents } from '../../../../../hooks/useData';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

const CONNECTOR_ID = 'jira';

type TriggerType = 'issue_created' | 'issue_updated' | 'comment_added' | 'status_changed';

interface EventTrigger {
  id: string;
  agentId: string;
  agentName: string;
  type: TriggerType;
  project?: string;
  enabled: boolean;
  proposeApprove: boolean;
}

const TRIGGER_META: Record<TriggerType, { label: string; description: string; Icon: typeof Bell }> = {
  issue_created:  { label: 'Issue created',   description: 'Agent triages when a new issue is created',   Icon: Plus },
  issue_updated:  { label: 'Issue updated',   description: 'Agent responds when an issue is modified',    Icon: GitPullRequest },
  comment_added:  { label: 'Comment added',   description: 'Agent replies when a comment is posted',      Icon: Bell },
  status_changed: { label: 'Status changed',  description: 'Agent acts when an issue transitions status', Icon: Sparkles },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function JiraAutomationTab() {
  const { agents } = useAgents();

  // NL command state
  const [command, setCommand] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [executing, setExecuting] = useState(false);
  const [commandResult, setCommandResult] = useState<{ success: boolean; message: string } | null>(null);

  // Event triggers state
  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [newTriggerType, setNewTriggerType] = useState<TriggerType>('issue_created');
  const [newTriggerAgent, setNewTriggerAgent] = useState('');
  const [newTriggerProject, setNewTriggerProject] = useState('');

  /* -- NL Command execution ---------------------------------------- */
  const handleExecuteCommand = useCallback(async () => {
    if (!command.trim() || !selectedAgent) return;
    setExecuting(true);
    setCommandResult(null);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'nl_command', {
        command: command.trim(),
        agentId: selectedAgent,
      });
      if (res.success) {
        if (res.data?.pending) {
          setCommandResult({ success: true, message: 'Action requires approval — sent to approval queue.' });
          toast.info('Action sent for approval');
        } else {
          setCommandResult({ success: true, message: res.data?.data?.message || 'Command executed successfully.' });
          toast.success('Command executed');
        }
      } else {
        setCommandResult({ success: false, message: res.error || 'Failed to execute command.' });
        toast.error('Command failed');
      }
    } catch {
      setCommandResult({ success: false, message: 'Network error — please try again.' });
    } finally {
      setExecuting(false);
    }
  }, [command, selectedAgent]);

  /* -- Add trigger ------------------------------------------------- */
  const handleAddTrigger = useCallback(() => {
    if (!newTriggerAgent) {
      toast.error('Select an agent');
      return;
    }
    const agent = agents.find((a) => a.id === newTriggerAgent);
    const trigger: EventTrigger = {
      id: `trigger_${Date.now()}`,
      agentId: newTriggerAgent,
      agentName: agent?.name || 'Unknown',
      type: newTriggerType,
      project: newTriggerProject || undefined,
      enabled: true,
      proposeApprove: true,
    };
    setTriggers((prev) => [...prev, trigger]);
    setShowAddTrigger(false);
    setNewTriggerAgent('');
    setNewTriggerProject('');
    toast.success(`Trigger added: ${TRIGGER_META[newTriggerType].label}`);
  }, [newTriggerAgent, newTriggerType, newTriggerProject, agents]);

  /* -- Toggle trigger ---------------------------------------------- */
  const toggleTrigger = (id: string, field: 'enabled' | 'proposeApprove') => {
    setTriggers((prev) =>
      prev.map((t) => t.id === id ? { ...t, [field]: !t[field] } : t),
    );
  };

  /* -- Remove trigger ---------------------------------------------- */
  const removeTrigger = (id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="p-5 space-y-8 max-w-2xl">

      {/* ============================================================ */}
      {/*  Section 1: Natural Language Commands                         */}
      {/* ============================================================ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Natural Language Commands</h3>
        </div>
        <p className="text-xs text-slate-500">
          Tell an agent what to do in plain English. The command is routed through the governance pipeline.
        </p>

        {/* Agent selector */}
        <div className="relative">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">Agent</label>
          <div className="relative">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full appearance-none px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 pr-8"
            >
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        {/* Command input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleExecuteCommand(); }}
            placeholder={'e.g. "Create a bug in PROJ for login page crash"'}
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            disabled={executing}
          />
          <button
            onClick={() => void handleExecuteCommand()}
            disabled={!command.trim() || !selectedAgent || executing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {executing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Execute
          </button>
        </div>

        {/* Result feedback */}
        {commandResult && (
          <div className={cn(
            'flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs border',
            commandResult.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300',
          )}>
            {commandResult.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            )}
            {commandResult.message}
          </div>
        )}

        {/* Examples */}
        <div className="space-y-1">
          <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Examples</p>
          {[
            'Create a high-priority bug in PROJ: "Login page crashes on mobile"',
            'Close all resolved issues in sprint 42',
            'Assign PROJ-123 to the on-call engineer',
            'Add a comment to PROJ-456: "Deployed fix in v2.1.3"',
          ].map((ex) => (
            <button
              key={ex}
              onClick={() => setCommand(ex)}
              className="block w-full text-left text-xs text-slate-500 hover:text-slate-300 py-1 px-2 rounded hover:bg-white/[0.03] transition-colors"
            >
              <ArrowRight className="w-3 h-3 inline mr-1.5 opacity-40" />
              {ex}
            </button>
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  Section 2: Event Triggers                                    */}
      {/* ============================================================ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">Event Triggers</h3>
          </div>
          <button
            onClick={() => setShowAddTrigger(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs text-slate-300 hover:text-white font-medium transition-colors"
          >
            <Plus className="w-3 h-3" /> Add trigger
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Configure agents to automatically respond to Jira events. All actions go through governance.
        </p>

        {/* Add trigger form */}
        {showAddTrigger && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <p className="text-xs font-semibold text-white">New Event Trigger</p>

            {/* Trigger type */}
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1.5">Event type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.entries(TRIGGER_META) as [TriggerType, typeof TRIGGER_META[TriggerType]][]).map(([type, meta]) => (
                  <button
                    key={type}
                    onClick={() => setNewTriggerType(type)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all',
                      newTriggerType === type
                        ? 'border-violet-500/30 bg-violet-500/[0.08] text-white'
                        : 'border-white/8 bg-white/[0.02] text-slate-400 hover:bg-white/[0.05]',
                    )}
                  >
                    <meta.Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs font-medium">{meta.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Agent */}
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">Agent</label>
              <select
                value={newTriggerAgent}
                onChange={(e) => setNewTriggerAgent(e.target.value)}
                className="w-full appearance-none px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
              >
                <option value="">Select agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {/* Project (optional) */}
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">Project key (optional)</label>
              <input
                type="text"
                value={newTriggerProject}
                onChange={(e) => setNewTriggerProject(e.target.value)}
                placeholder="e.g. PROJ or leave blank for all projects"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAddTrigger}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-semibold transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
              <button
                onClick={() => setShowAddTrigger(false)}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Triggers list */}
        {triggers.length === 0 && !showAddTrigger ? (
          <div className="text-center py-8">
            <Bot className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-500">No event triggers configured.</p>
            <p className="text-[10px] text-slate-600 mt-1">Add a trigger to let agents respond to Jira events automatically.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {triggers.map((trigger) => {
              const meta = TRIGGER_META[trigger.type];
              return (
                <div
                  key={trigger.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                    trigger.enabled
                      ? 'border-white/8 bg-white/[0.02]'
                      : 'border-white/5 bg-white/[0.01] opacity-60',
                  )}
                >
                  <meta.Icon className="w-4 h-4 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white">{meta.label}</p>
                    <p className="text-[10px] text-slate-500">
                      <Bot className="w-3 h-3 inline mr-0.5" />
                      {trigger.agentName}
                      {trigger.project && <span className="ml-1.5">in {trigger.project}</span>}
                    </p>
                  </div>

                  {/* Propose-approve toggle */}
                  <button
                    onClick={() => toggleTrigger(trigger.id, 'proposeApprove')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all',
                      trigger.proposeApprove
                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                    )}
                    title={trigger.proposeApprove ? 'Propose & approve mode: agent suggests, you approve' : 'Auto-execute mode: agent acts immediately'}
                  >
                    <Shield className="w-3 h-3" />
                    {trigger.proposeApprove ? 'Propose' : 'Auto'}
                  </button>

                  {/* Enable/disable */}
                  <button
                    onClick={() => toggleTrigger(trigger.id, 'enabled')}
                    className="text-slate-500 hover:text-white transition-colors"
                    title={trigger.enabled ? 'Disable' : 'Enable'}
                  >
                    {trigger.enabled ? (
                      <ToggleRight className="w-5 h-5 text-cyan-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5" />
                    )}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => removeTrigger(trigger.id)}
                    className="text-slate-600 hover:text-rose-400 transition-colors"
                    title="Remove trigger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/*  Section 3: Governance Info                                   */}
      {/* ============================================================ */}
      <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-white">Governance Pipeline</h3>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          All automated actions — NL commands, event triggers, and agent proposals — are routed through the
          governance pipeline. Write actions like <span className="text-slate-400 font-medium">create_issue</span>,
          <span className="text-slate-400 font-medium"> transition_issue</span>, and
          <span className="text-slate-400 font-medium"> add_comment</span> check action policies,
          may require human approval, and are logged in governed actions with a full audit trail.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-slate-400 font-medium">
            <Zap className="w-3 h-3 text-amber-400" /> Preflight gate
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-slate-400 font-medium">
            <Shield className="w-3 h-3 text-cyan-400" /> Policy check
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-slate-400 font-medium">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Audit trail
          </span>
        </div>
      </section>
    </div>
  );
}
