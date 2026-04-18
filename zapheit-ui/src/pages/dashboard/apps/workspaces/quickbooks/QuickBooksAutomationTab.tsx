import { useState, useCallback } from 'react';
import {
  ArrowRight, Bell, Bot, CheckCircle2, ChevronDown, Loader2,
  Play, Plus, Shield, Sparkles, ToggleLeft, ToggleRight,
  Trash2, Zap, AlertCircle, FileText, CreditCard, UserPlus,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { useAgents } from '../../../../../hooks/useData';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

const CONNECTOR_ID = 'quickbooks';

type TriggerType = 'invoice_created' | 'payment_received' | 'invoice_overdue' | 'customer_created';

interface EventTrigger {
  id: string;
  agentId: string;
  agentName: string;
  type: TriggerType;
  pipeline?: string;
  enabled: boolean;
  proposeApprove: boolean;
}

const TRIGGER_META: Record<TriggerType, { label: string; description: string; Icon: typeof Bell }> = {
  invoice_created:   { label: 'Invoice created',   description: 'Agent follows up on new invoices',                Icon: FileText },
  payment_received:  { label: 'Payment received',  description: 'Agent reconciles incoming payments',              Icon: CreditCard },
  invoice_overdue:   { label: 'Invoice overdue',   description: 'Agent sends reminders for overdue invoices',      Icon: AlertCircle },
  customer_created:  { label: 'Customer created',  description: 'Agent enriches new customer records',             Icon: UserPlus },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function QuickBooksAutomationTab() {
  const { agents } = useAgents();

  const [command, setCommand] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [executing, setExecuting] = useState(false);
  const [commandResult, setCommandResult] = useState<{ success: boolean; message: string } | null>(null);

  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [newTriggerType, setNewTriggerType] = useState<TriggerType>('invoice_created');
  const [newTriggerAgent, setNewTriggerAgent] = useState('');
  const [newTriggerPipeline, setNewTriggerPipeline] = useState('');

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
      pipeline: newTriggerPipeline || undefined,
      enabled: true,
      proposeApprove: true,
    };
    setTriggers((prev) => [...prev, trigger]);
    setShowAddTrigger(false);
    setNewTriggerAgent('');
    setNewTriggerPipeline('');
    toast.success(`Trigger added: ${TRIGGER_META[newTriggerType].label}`);
  }, [newTriggerAgent, newTriggerType, newTriggerPipeline, agents]);

  const toggleTrigger = (id: string, field: 'enabled' | 'proposeApprove') => {
    setTriggers((prev) =>
      prev.map((t) => t.id === id ? { ...t, [field]: !t[field] } : t),
    );
  };

  const removeTrigger = (id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="p-5 space-y-8 max-w-2xl">

      {/* Section 1: Natural Language Commands */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Natural Language Commands</h3>
        </div>
        <p className="text-xs text-slate-500">
          Tell an agent what to do in plain English. The command is routed through the governance pipeline.
        </p>

        <div className="relative">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">Agent</label>
          <div className="relative">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full appearance-none px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-green-500/30 pr-8"
            >
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleExecuteCommand(); }}
            placeholder={'e.g. "Create an invoice for customer #42 for $1,500"'}
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-green-500/30"
            disabled={executing}
          />
          <button
            onClick={() => void handleExecuteCommand()}
            disabled={!command.trim() || !selectedAgent || executing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Execute
          </button>
        </div>

        {commandResult && (
          <div className={cn(
            'flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs border',
            commandResult.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300',
          )}>
            {commandResult.success ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
            {commandResult.message}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium">Examples</p>
          {[
            'Create an invoice for Acme Inc for $2,500 due in 30 days',
            'Send invoice #1042 to the customer',
            'List all overdue invoices over $1,000',
            'Create a new customer: Jane Doe, jane@example.com',
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

      {/* Section 2: Event Triggers */}
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
          Configure agents to automatically respond to QuickBooks events. All actions go through governance.
        </p>

        {showAddTrigger && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <p className="text-xs font-semibold text-white">New Event Trigger</p>

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

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">Agent</label>
              <select
                value={newTriggerAgent}
                onChange={(e) => setNewTriggerAgent(e.target.value)}
                className="w-full appearance-none px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-green-500/30"
              >
                <option value="">Select agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider font-medium block mb-1">Pipeline (optional)</label>
              <input
                type="text"
                value={newTriggerPipeline}
                onChange={(e) => setNewTriggerPipeline(e.target.value)}
                placeholder="e.g. accounts-receivable or leave blank for all"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-green-500/30"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={handleAddTrigger} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-semibold transition-colors">
                <Plus className="w-3 h-3" /> Add
              </button>
              <button onClick={() => setShowAddTrigger(false)} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-xs text-slate-400 hover:text-white font-medium transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {triggers.length === 0 && !showAddTrigger ? (
          <div className="text-center py-8">
            <Bot className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-500">No event triggers configured.</p>
            <p className="text-[10px] text-slate-600 mt-1">Add a trigger to let agents respond to QuickBooks events automatically.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {triggers.map((trigger) => {
              const meta = TRIGGER_META[trigger.type];
              return (
                <div key={trigger.id} className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                  trigger.enabled ? 'border-white/8 bg-white/[0.02]' : 'border-white/5 bg-white/[0.01] opacity-60',
                )}>
                  <meta.Icon className="w-4 h-4 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white">{meta.label}</p>
                    <p className="text-[10px] text-slate-500">
                      <Bot className="w-3 h-3 inline mr-0.5" />
                      {trigger.agentName}
                      {trigger.pipeline && <span className="ml-1.5">in {trigger.pipeline}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleTrigger(trigger.id, 'proposeApprove')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all',
                      trigger.proposeApprove
                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
                    )}
                  >
                    <Shield className="w-3 h-3" />
                    {trigger.proposeApprove ? 'Propose' : 'Auto'}
                  </button>
                  <button onClick={() => toggleTrigger(trigger.id, 'enabled')} className="text-slate-500 hover:text-white transition-colors">
                    {trigger.enabled ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <button onClick={() => removeTrigger(trigger.id)} className="text-slate-600 hover:text-rose-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: Governance Info */}
      <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-green-400" />
          <h3 className="text-xs font-semibold text-white">Governance Pipeline</h3>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          All automated actions — NL commands, event triggers, and agent proposals — are routed through the
          governance pipeline. Write actions like <span className="text-slate-400 font-medium">create_invoice</span>,
          <span className="text-slate-400 font-medium"> create_customer</span>, and
          <span className="text-slate-400 font-medium"> send_invoice</span> check action policies,
          may require human approval, and are logged in governed actions with a full audit trail.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-slate-400 font-medium">
            <Zap className="w-3 h-3 text-amber-400" /> Preflight gate
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-slate-400 font-medium">
            <Shield className="w-3 h-3 text-green-400" /> Policy check
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.03] text-slate-400 font-medium">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Audit trail
          </span>
        </div>
      </section>
    </div>
  );
}
