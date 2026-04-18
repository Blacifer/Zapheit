import { useState, useCallback } from 'react';
import {
  ArrowRight, Bell, Bot, CheckCircle2, ChevronDown, Loader2,
  Play, Plus, Shield, ToggleLeft, ToggleRight,
  Trash2, Zap, AlertCircle, Mail, Calendar, HardDrive, MessageSquare,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { useAgents } from '../../../../../hooks/useData';

const CONNECTOR_ID = 'microsoft-365';

type TriggerType = 'email_received' | 'event_starting' | 'file_shared' | 'teams_message';

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
  email_received: { label: 'Email received',   description: 'Agent triages or responds to incoming Outlook emails',  Icon: Mail },
  event_starting: { label: 'Event starting',   description: 'Agent prepares meeting briefs automatically',           Icon: Calendar },
  file_shared:    { label: 'File shared',       description: 'Agent monitors and logs OneDrive sharing activity',     Icon: HardDrive },
  teams_message:  { label: 'Teams message',     description: 'Agent monitors Teams channels and responds as needed',  Icon: MessageSquare },
};

export function M365AutomationTab() {
  const { agents } = useAgents();

  const [command, setCommand] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [executing, setExecuting] = useState(false);
  const [commandResult, setCommandResult] = useState<{ success: boolean; message: string } | null>(null);

  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [newTriggerType, setNewTriggerType] = useState<TriggerType>('email_received');
  const [newTriggerAgent, setNewTriggerAgent] = useState('');
  const [newTriggerPipeline, setNewTriggerPipeline] = useState('');

  const handleExecuteCommand = useCallback(async () => {
    if (!command.trim() || !selectedAgent) return;
    setExecuting(true);
    setCommandResult(null);
    try {
      const res = await api.jobs.create({
        agent_id: selectedAgent,
        type: 'workflow_run',
        input: { trigger: 'manual_command', context: { command, connector: CONNECTOR_ID } },
      });
      if (res.success) {
        setCommandResult({ success: true, message: 'Command dispatched to agent' });
        setCommand('');
      } else {
        setCommandResult({ success: false, message: (res as any).error || 'Failed to dispatch' });
      }
    } catch {
      setCommandResult({ success: false, message: 'Network error' });
    } finally {
      setExecuting(false);
    }
  }, [command, selectedAgent]);

  const addTrigger = useCallback(() => {
    if (!newTriggerAgent) return;
    const agentName = agents.find((a) => a.id === newTriggerAgent)?.name ?? newTriggerAgent;
    setTriggers((prev) => [...prev, {
      id: crypto.randomUUID(),
      agentId: newTriggerAgent,
      agentName,
      type: newTriggerType,
      pipeline: newTriggerPipeline || undefined,
      enabled: true,
      proposeApprove: false,
    }]);
    setNewTriggerAgent('');
    setNewTriggerPipeline('');
    setShowAddTrigger(false);
    toast.success('Trigger added');
  }, [agents, newTriggerAgent, newTriggerType, newTriggerPipeline]);

  const toggleTrigger = (id: string) => {
    setTriggers((prev) => prev.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const toggleApprove = (id: string) => {
    setTriggers((prev) => prev.map((t) => t.id === id ? { ...t, proposeApprove: !t.proposeApprove } : t));
  };

  const removeTrigger = (id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
    toast.success('Trigger removed');
  };

  return (
    <div className="p-4 space-y-6 max-w-2xl">
      {/* Ad-hoc command */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Run a command</h3>
        </div>
        <p className="text-xs text-slate-500">Dispatch a one-off instruction to an agent connected to Microsoft 365.</p>

        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        >
          <option value="">Select agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. Summarise unread emails from today and create a task for each action item"
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
        />

        <button
          onClick={handleExecuteCommand}
          disabled={executing || !command.trim() || !selectedAgent}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors disabled:opacity-40"
        >
          {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {executing ? 'Running…' : 'Run'}
        </button>

        {commandResult && (
          <div className={cn(
            'flex items-start gap-2 p-3 rounded-lg text-xs',
            commandResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
          )}>
            {commandResult.success
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            {commandResult.message}
          </div>
        )}
      </div>

      {/* Event triggers */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Event triggers</h3>
          </div>
          <button
            onClick={() => setShowAddTrigger((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
            <ChevronDown className={cn('w-3 h-3 transition-transform', showAddTrigger && 'rotate-180')} />
          </button>
        </div>

        <p className="text-xs text-slate-500">Automatically run an agent when Microsoft 365 events occur.</p>

        {showAddTrigger && (
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
            <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">New trigger</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newTriggerType}
                onChange={(e) => setNewTriggerType(e.target.value as TriggerType)}
                className="col-span-2 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 focus:outline-none"
              >
                {(Object.keys(TRIGGER_META) as TriggerType[]).map((k) => (
                  <option key={k} value={k}>{TRIGGER_META[k].label}</option>
                ))}
              </select>
              <select
                value={newTriggerAgent}
                onChange={(e) => setNewTriggerAgent(e.target.value)}
                className="col-span-2 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 focus:outline-none"
              >
                <option value="">Select agent…</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input
                value={newTriggerPipeline}
                onChange={(e) => setNewTriggerPipeline(e.target.value)}
                placeholder="Pipeline / playbook name (optional)"
                className="col-span-2 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={addTrigger}
                disabled={!newTriggerAgent}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors disabled:opacity-40"
              >
                <ArrowRight className="w-3 h-3" /> Save trigger
              </button>
              <button
                onClick={() => setShowAddTrigger(false)}
                className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-slate-400 text-xs hover:bg-white/[0.1] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {triggers.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-4">No triggers configured</p>
        ) : (
          <div className="space-y-2">
            {triggers.map((t) => {
              const meta = TRIGGER_META[t.type];
              return (
                <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                    <meta.Icon className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-slate-200">{meta.label}</span>
                      <ArrowRight className="w-3 h-3 text-slate-600" />
                      <span className="text-xs text-slate-400 truncate">{t.agentName}</span>
                    </div>
                    {t.pipeline && <p className="text-[10px] text-slate-500 truncate">Pipeline: {t.pipeline}</p>}

                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => toggleTrigger(t.id)}
                        className={cn('flex items-center gap-1 text-[10px] font-medium transition-colors', t.enabled ? 'text-emerald-400' : 'text-slate-500')}
                      >
                        {t.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                        {t.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => toggleApprove(t.id)}
                        className={cn('flex items-center gap-1 text-[10px] font-medium transition-colors', t.proposeApprove ? 'text-amber-400' : 'text-slate-500')}
                      >
                        <Shield className="w-3 h-3" />
                        {t.proposeApprove ? 'Propose+approve' : 'Auto-execute'}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => removeTrigger(t.id)}
                    className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Governance note */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
        <Bot className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-500 leading-relaxed">
          All agent actions on Microsoft 365 are governed by your organisation's action policies. Sensitive operations
          (send email, share file, post to Teams) require approval unless the actor is an admin or super-admin.
        </p>
      </div>
    </div>
  );
}
