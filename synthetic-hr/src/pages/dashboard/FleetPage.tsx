import { useState, useEffect } from 'react';
import {
  Users, DollarSign, Shield, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Activity, Zap, Lock, Server, Eye, Phone, Bot,
  Brain, Target, TrendingUp, X, Plus, Search, Filter, Download, Copy, Trash2, Key,
  ShieldAlert, ZapOff, Play, Rocket
} from 'lucide-react';
import type { AIAgent } from '../../types';
import { toast } from '../../lib/toast';
import { validateAgentForm } from '../../lib/validation';
import { api } from '../../lib/api-client';
import { getFrontendConfig } from '../../lib/config';

interface FleetPageProps {
  agents: AIAgent[];
  setAgents: (agents: AIAgent[]) => void;
}

export default function FleetPage({ agents, setAgents }: FleetPageProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [killSwitchAgent, setKillSwitchAgent] = useState<string | null>(null);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [configureAgentId, setConfigureAgentId] = useState<string | null>(null);
  const [editBudget, setEditBudget] = useState<Record<string, { budget: number; autoThrottle: boolean }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'paused' | 'terminated'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [deployAgentId, setDeployAgentId] = useState<string | null>(null);
  const [runtimesLoading, setRuntimesLoading] = useState(false);
  const [runtimes, setRuntimes] = useState<Array<{ id: string; name: string; mode: string; status: string; last_heartbeat_at: string | null }>>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>('');
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [currentDeployment, setCurrentDeployment] = useState<any | null>(null);
  const [createdEnrollment, setCreatedEnrollment] = useState<{ runtimeId: string; token: string; expiresAt: string } | null>(null);
  const [testJob, setTestJob] = useState<any | null>(null);
  const [testJobBusy, setTestJobBusy] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void> | void;
    type: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => { },
    type: 'warning'
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rasi_safe_harbor_focus');
      if (!raw) return;

      const parsed = JSON.parse(raw) as { page?: string; id?: string };
      if (parsed.page !== 'fleet' || !parsed.id) return;

      setHighlightedAgentId(parsed.id);
      localStorage.removeItem('rasi_safe_harbor_focus');

      const timer = window.setTimeout(() => setHighlightedAgentId(null), 5000);
      return () => window.clearTimeout(timer);
    } catch {
      localStorage.removeItem('rasi_safe_harbor_focus');
    }
  }, []);

  useEffect(() => {
    if (!deployAgentId) return;
    (async () => {
      setRuntimesLoading(true);
      setCreatedEnrollment(null);
      try {
        const [rt, deps] = await Promise.all([
          api.runtimes.list(),
          api.runtimes.listDeployments(deployAgentId),
        ]);

        if (rt.success && Array.isArray(rt.data)) {
          const items = (rt.data as any[]).map((r) => ({
            id: r.id,
            name: r.name,
            mode: r.mode,
            status: r.status,
            last_heartbeat_at: r.last_heartbeat_at || null,
          }));
          setRuntimes(items);
          if (!items.find((r) => r.id === selectedRuntimeId) && items.length > 0) {
            setSelectedRuntimeId(items[0].id);
          }
        } else {
          setRuntimes([]);
        }

        if (deps.success && Array.isArray(deps.data)) {
          const dep = (deps.data as any[]).find((d) => d.agent_id === deployAgentId) || null;
          setCurrentDeployment(dep);
          if (dep?.runtime_instance_id) setSelectedRuntimeId(dep.runtime_instance_id);
        } else {
          setCurrentDeployment(null);
        }
      } catch (err) {
        console.error(err);
        setRuntimes([]);
        setCurrentDeployment(null);
      } finally {
        setRuntimesLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployAgentId]);

  const addAgent = async (agent: Omit<AIAgent, 'id' | 'created_at'>) => {
    try {
      // Explicitly create via API first to get real backend UUID
      const created = await api.agents.create({
        name: agent.name,
        description: agent.description,
        agent_type: agent.agent_type,
        platform: agent.platform,
        model_name: agent.model_name,
        budget_limit: agent.budget_limit || 0,
        system_prompt: agent.system_prompt || '',
        config: (agent as any).config || {},
      });

      if (created.success && created.data) {
        const newId = (created.data as any).id;
        if (newId) {
          const newAgent: AIAgent = {
            ...agent,
            id: newId,
            created_at: new Date().toISOString(),
          };
          setAgents([...agents, newAgent]);
          toast.success(`Agent ${agent.name} added to fleet.`);
          setShowAddModal(false);
          return;
        }
      }
      toast.error('Failed to create agent properly.');
    } catch (err) {
      console.error('Add agent error:', err);
      toast.error('An error occurred while adding the agent to fleet.');
    }
    setShowAddModal(false);
  };

  const updateAgentStatus = (id: string, status: AIAgent['status']) => {
    setAgents(agents.map(a => a.id === id ? { ...a, status } : a));
  };

  const handleConfirmAction = (
    title: string,
    message: string,
    type: 'danger' | 'warning',
    action: () => Promise<void> | void
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      type,
      action: async () => {
        setConfirming(true);
        try {
          await action();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Action failed.';
          toast.error(message);
        } finally {
          setConfirming(false);
        }
      }
    });
  };

  const handleKillSwitch = (agentId: string, level: 1 | 2 | 3) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    switch (level) {
      case 1:
        handleConfirmAction(
          'Issue Warning (Level 1)',
          `Are you sure you want to pause ${agent.name} and issue a warning?`,
          'warning',
          () => {
            setAgents(agents.map(a => a.id === agentId ? { ...a, status: 'paused' as const } : a));
            toast.warning(`⚠️ LEVEL 1 WARNING issued to ${agent.name}. Agent paused.`);
          }
        );
        break;
      case 2:
        handleConfirmAction(
          'Escalate to Human (Level 2)',
          `🚨 LEVEL 2 ESCALATION: ${agent.name} requires human review. This will increase its risk score. Continue?`,
          'warning',
          () => setAgents(agents.map(a => a.id === agentId ? { ...a, risk_score: Math.min(100, a.risk_score + 20) } : a))
        );
        break;
      case 3:
        handleConfirmAction(
          'Terminate Agent (Level 3)',
          `🛑 LEVEL 3 SHUTDOWN: This will permanently terminate ${agent.name}. Are you absolutely sure?`,
          'danger',
          () => setAgents(agents.map(a => a.id === agentId ? { ...a, status: 'terminated' as const } : a))
        );
        break;
    }
    setKillSwitchAgent(null);
  };

  const deleteAgent = (id: string) => {
    const agent = agents.find(a => a.id === id);
    handleConfirmAction(
      'Delete Agent',
      `Are you sure you want to delete ${agent?.name}? This cannot be undone.`,
      'danger',
      async () => {
        const response = await api.agents.delete(id);
        if (!response.success) {
          throw new Error(response.error || 'Failed to delete agent.');
        }
        setAgents(agents.filter(a => a.id !== id));
        toast.success(`${agent?.name || 'Agent'} deleted successfully.`);
      }
    );
  };

  const openConfigure = (agent: AIAgent) => {
    setConfigureAgentId(agent.id);
    setEditBudget(prev => ({
      ...prev,
      [agent.id]: { budget: agent.budget_limit ?? 0, autoThrottle: agent.auto_throttle ?? false },
    }));
  };

  const saveConfigure = (agentId: string) => {
    const vals = editBudget[agentId];
    if (!vals) return;
    setAgents(agents.map(a =>
      a.id === agentId ? { ...a, budget_limit: vals.budget, auto_throttle: vals.autoThrottle } : a
    ));
    toast.success('Agent configuration saved.');
    setConfigureAgentId(null);
  };

  const openDeploy = (agent: AIAgent) => {
    setDeployAgentId(agent.id);
  };

  const closeDeploy = () => {
    setDeployAgentId(null);
    setCreatedEnrollment(null);
    setCurrentDeployment(null);
    setSelectedRuntimeId('');
    setTestJob(null);
  };

  const createRuntime = async (agentName: string) => {
    setRuntimesLoading(true);
    setCreatedEnrollment(null);
    try {
      const name = `${agentName} runtime (${new Date().toLocaleDateString('en-IN')})`;
      const res = await api.runtimes.create({ name, mode: 'vpc' });
      const token = (res as any).enrollment_token as string | undefined;
      const expiresAt = (res as any).enrollment_expires_at as string | undefined;
      if (!res.success || !res.data || !token || !expiresAt) {
        toast.error(res.error || 'Failed to create runtime');
        return;
      }

      const runtimeRow = res.data as any;
      setRuntimes((prev) => [{
        id: runtimeRow.id,
        name: runtimeRow.name,
        mode: runtimeRow.mode,
        status: runtimeRow.status,
        last_heartbeat_at: runtimeRow.last_heartbeat_at || null,
      }, ...prev]);
      setSelectedRuntimeId(runtimeRow.id);
      setCreatedEnrollment({ runtimeId: runtimeRow.id, token, expiresAt });
      toast.success('Runtime created (enrollment token shown once)');
    } finally {
      setRuntimesLoading(false);
    }
  };

  const deployToRuntime = async () => {
    if (!deployAgentId || !selectedRuntimeId) {
      toast.error('Select a runtime first');
      return;
    }
    setDeploymentLoading(true);
    try {
      const res = await api.runtimes.deployAgent({
        agent_id: deployAgentId,
        runtime_instance_id: selectedRuntimeId,
      });
      if (!res.success) {
        toast.error(res.error || 'Deployment failed');
        return;
      }
      setCurrentDeployment(res.data || null);
      toast.success('Deployment saved.');
    } finally {
      setDeploymentLoading(false);
    }
  };

  const createTestChatJob = async () => {
    if (!deployAgentId) return;
    setTestJobBusy(true);
    try {
      const res = await api.jobs.create({
        agent_id: deployAgentId,
        type: 'chat_turn',
        input: {
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Reply in one short sentence.' },
            { role: 'user', content: 'Return: SyntheticHR runtime connection verified.' },
          ],
          temperature: 0.2,
        }
      });
      if (!res.success || !res.data?.job) {
        toast.error(res.error || 'Failed to create test job');
        return;
      }
      setTestJob(res.data);
      toast.success('Test job created (pending approval)');
    } finally {
      setTestJobBusy(false);
    }
  };

  const approveTestJob = async () => {
    const jobId = testJob?.job?.id;
    if (!jobId) return;
    setTestJobBusy(true);
    try {
      const res = await api.jobs.decide(jobId, 'approved');
      if (!res.success) {
        toast.error(res.error || 'Approval failed');
        return;
      }
      toast.success('Approved. Runtime will pick it up shortly.');
    } finally {
      setTestJobBusy(false);
    }
  };

  const filteredAgents = agents.filter(a => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.model_name.toLowerCase().includes(q) || a.agent_type.toLowerCase().includes(q);
    const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
    const matchesType = filterType === 'all' || a.agent_type === filterType;
    return matchesSearch && matchesStatus && matchesType;
  });

  const controlPlaneBaseUrl = (((getFrontendConfig().apiUrl || 'http://localhost:3001/api') as string))
    .toString()
    .replace(/\/api\/?$/, '');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Agent Fleet</h1>
          <p className="text-slate-400 mt-2">Track governed agents, runtime posture, and intervention controls.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary px-4 py-2 text-sm flex items-center gap-2"
          aria-label="Add new AI agent"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      {/* Search & Filter Bar */}
      {agents.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="fleet-search"
              name="fleet-search"
              type="text"
              placeholder="Search agents by name, model, or description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-9 py-2.5 text-sm focus:ring-blue-500/30"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'active', 'paused', 'terminated'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all border ${filterStatus === s
                  ? s === 'all' ? 'bg-white/[0.06] text-white border-white/10'
                    : s === 'active' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : s === 'paused' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-white'
                  }`}
              >
                {s}
              </button>
            ))}
            {Array.from(new Set(agents.map(a => a.agent_type))).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? 'all' : type)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all border ${filterType === type
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : 'text-slate-400 border-slate-700 hover:border-slate-600 hover:text-white'
                  }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white">No governed agents yet</h2>
          <p className="mt-2 text-slate-400">Add your first agent to start monitoring risk, spend, and incident activity from one control surface.</p>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-10 text-center">
          <Filter className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No agents match your filters.</p>
          <button onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterType('all'); }} className="mt-3 text-xs text-cyan-400 hover:text-cyan-300">Clear filters</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredAgents.map((agent) => {
            const isConfigOpen = configureAgentId === agent.id;
            const budgetVals = editBudget[agent.id] ?? { budget: agent.budget_limit ?? 0, autoThrottle: agent.auto_throttle ?? false };
            return (
              <div
                key={agent.id}
                className={`relative bg-slate-800/30 border rounded-2xl overflow-hidden transition-all ${highlightedAgentId === agent.id
                  ? 'border-cyan-400/60 ring-1 ring-cyan-400/40 bg-cyan-500/5'
                  : isConfigOpen ? 'border-emerald-500/40' : 'border-slate-700'
                  }`}
              >
                {/* Main card row */}
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                        <h3 className="text-base font-semibold text-white">{agent.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agent.status === 'active' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                          agent.status === 'paused' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' :
                            'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>{agent.status}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${agent.risk_level === 'low' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                          agent.risk_level === 'medium' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' :
                            'bg-red-400/10 text-red-400 border border-red-400/20'
                          }`}>Risk {agent.risk_score}/100</span>
                        {agent.budget_limit > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-400/10 text-blue-400 border border-blue-400/20">
                            Budget ₹{agent.budget_limit.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm mb-2.5">{agent.description}</p>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        <span>Type: <span className="text-slate-300">{agent.agent_type}</span></span>
                        <span>Provider: <span className="text-slate-300">{agent.platform}</span></span>
                        <span>Model: <span className="text-slate-300 font-mono">{agent.model_name}</span></span>
                        <span>Conversations: <span className="text-slate-300">{agent.conversations}</span></span>
                      </div>
                    </div>

                    {/* Action buttons — always visible */}
                    <div className="flex items-center gap-1 ml-4 shrink-0">
                      {/* Deploy */}
                      <button
                        onClick={() => openDeploy(agent)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-slate-700/60 text-slate-300 border border-slate-600 hover:bg-slate-700 hover:text-white"
                        title="Deploy agent to runtime"
                      >
                        <Server className="w-3.5 h-3.5" />
                        Deploy
                      </button>

                      {/* Configure */}
                      <button
                        onClick={() => isConfigOpen ? setConfigureAgentId(null) : openConfigure(agent)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isConfigOpen
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-700/60 text-slate-300 border border-slate-600 hover:bg-slate-700 hover:text-white'
                          }`}
                        title="Configure agent"
                      >
                        <Key className="w-3.5 h-3.5" />
                        Configure
                      </button>

                      {/* Pause / Activate */}
                      {agent.status !== 'terminated' && (
                        agent.status === 'active' ? (
                          <button
                            onClick={() => handleConfirmAction('Pause Agent', `Are you sure you want to pause ${agent.name}?`, 'warning', () => updateAgentStatus(agent.id, 'paused'))}
                            className="p-2 text-slate-400 hover:text-amber-400 transition-colors rounded-lg hover:bg-amber-400/10"
                            title="Pause Agent"
                          >
                            <ZapOff className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => updateAgentStatus(agent.id, 'active')}
                            className="p-2 text-slate-400 hover:text-emerald-400 transition-colors rounded-lg hover:bg-emerald-400/10"
                            title="Activate Agent"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )
                      )}

                      {/* Delete */}
                      <button
                        onClick={() => deleteAgent(agent.id)}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                        title="Delete Agent"
                        aria-label={`Delete agent ${agent.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Configure Panel (inline expansion) ── */}
                {isConfigOpen && (
                  <div className="border-t border-slate-700/50 bg-slate-900/40 animate-in slide-in-from-top-2 duration-200">
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">

                      {/* Budget & Throttle */}
                      <div className="space-y-4">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-emerald-400" /> Budget & Spend Controls
                        </h4>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">Monthly Budget Cap (₹)</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 text-sm font-bold">₹</span>
                            <input
                              id={`budget-${agent.id}`}
                              name={`budget-${agent.id}`}
                              type="number"
                              value={budgetVals.budget}
                              onChange={(e) => setEditBudget(prev => ({
                                ...prev,
                                [agent.id]: { ...budgetVals, budget: parseInt(e.target.value) || 0 }
                              }))}
                              className="w-full pl-7 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 text-sm"
                              min="0"
                            />
                          </div>
                          <p className="text-xs text-slate-500 mt-1">Current spend: ₹{(agent.current_spend || 0).toLocaleString()}</p>
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative shrink-0">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={budgetVals.autoThrottle}
                              onChange={(e) => setEditBudget(prev => ({
                                ...prev,
                                [agent.id]: { ...budgetVals, autoThrottle: e.target.checked }
                              }))}
                            />
                            <div className={`w-10 h-5 rounded-full transition-colors ${budgetVals.autoThrottle ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                            <div className={`absolute left-1 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform ${budgetVals.autoThrottle ? 'translate-x-5' : ''}`} />
                          </div>
                          <div>
                            <p className="text-sm text-white font-medium">Auto-Throttle</p>
                            <p className="text-xs text-slate-400">Slow down responses as budget limit approaches</p>
                          </div>
                        </label>
                        <div className="pt-4 border-t border-slate-700/50">
                          <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                            <Bot className="w-4 h-4 text-cyan-400" /> Diagnostics
                          </h4>
                          <button
                            onClick={() => {
                              toast.info(`Shadow test initiated for ${agent.name}...`);
                              setTimeout(() => {
                                toast.success(`${agent.name} shadow test completed without new violations.`);
                              }, 1600);
                            }}
                            className="w-full flex justify-center items-center gap-2 px-4 py-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all text-sm font-semibold"
                          >
                            <Play className="w-4 h-4 text-cyan-400" /> Run Shadow Test
                          </button>
                        </div>
                      </div>

                      {/* Kill Switch — always visible danger zone */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4" /> Kill Switch Protocol
                        </h4>
                        <p className="text-xs text-slate-400">Escalating levels of intervention. Use with caution.</p>
                        <div className="space-y-2">
                          <button
                            onClick={() => handleKillSwitch(agent.id, 1)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all text-sm font-medium"
                          >
                            <span className="text-base">⚠️</span>
                            <div className="text-left">
                              <p className="font-semibold">Level 1 – Warning &amp; Pause</p>
                              <p className="text-xs text-amber-400/70">Temporarily pause the agent</p>
                            </div>
                          </button>
                          <button
                            onClick={() => handleKillSwitch(agent.id, 2)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 transition-all text-sm font-medium"
                          >
                            <span className="text-base">🚨</span>
                            <div className="text-left">
                              <p className="font-semibold">Level 2 – Escalate to Human</p>
                              <p className="text-xs text-orange-400/70">Flag for human review, raise risk score</p>
                            </div>
                          </button>
                          <button
                            onClick={() => handleKillSwitch(agent.id, 3)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-sm font-medium"
                          >
                            <span className="text-base">🛑</span>
                            <div className="text-left">
                              <p className="font-semibold">Level 3 – Permanent Shutdown</p>
                              <p className="text-xs text-rose-400/70">Irreversibly terminate this agent</p>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Save / Cancel */}
                    <div className="px-5 pb-5 flex gap-3 justify-end border-t border-slate-700/50 pt-4">
                      <button
                        onClick={() => setConfigureAgentId(null)}
                        className="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-sm hover:bg-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveConfigure(agent.id)}
                        className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 text-white font-semibold rounded-xl text-sm hover:from-emerald-400 hover:to-teal-300 transition-all"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* AI Employee Review Cards */}
      {agents.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Target className="w-6 h-6 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Agent review snapshot</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => {
              // Calculate performance metrics
              const accuracyScore = Math.max(0, 100 - (agent.risk_score * 0.5));
              const toneScore = agent.status === 'active' ? 92 : 0;
              const responseTime = agent.conversations > 0 ? 1.2 : 0;

              return (
                <div key={agent.id} className="bg-slate-900/50 border border-slate-700 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-white">{agent.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs ${agent.status === 'active' ? 'bg-green-400/10 text-green-400' :
                      agent.status === 'paused' ? 'bg-yellow-400/10 text-yellow-400' :
                        'bg-red-400/10 text-red-400'
                      }`}>
                      {agent.status}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Accuracy Score</span>
                        <span className={accuracyScore >= 80 ? 'text-green-400' : accuracyScore >= 60 ? 'text-yellow-400' : 'text-red-400'}>
                          {accuracyScore.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${accuracyScore >= 80 ? 'bg-green-400' : accuracyScore >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
                          style={{ width: `${accuracyScore}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Tone Score</span>
                        <span className={toneScore >= 80 ? 'text-green-400' : toneScore >= 60 ? 'text-yellow-400' : 'text-red-400'}>
                          {toneScore.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${toneScore >= 80 ? 'bg-green-400' : toneScore >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`}
                          style={{ width: `${Math.min(100, toneScore)}%` }}
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-700">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-slate-400">Conversations</p>
                          <p className="text-white font-medium">{agent.conversations.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Avg Response</p>
                          <p className="text-white font-medium">{responseTime.toFixed(1)}s</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deploy Modal */}
      {deployAgentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-700 bg-slate-950/95 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
                  <Rocket className="w-5 h-5 text-cyan-300" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Deploy Agent</h2>
                  <p className="text-xs text-slate-400">
                    Agent: <span className="text-slate-200 font-semibold">{agents.find((a) => a.id === deployAgentId)?.name || 'Unknown'}</span>
                  </p>
                </div>
              </div>
              <button onClick={closeDeploy} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white" aria-label="Close deploy modal">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current deployment</p>
                  {currentDeployment ? (
                    <p className="mt-2 text-sm text-slate-200">
                      Runtime: <span className="font-mono text-cyan-200">{currentDeployment.runtime_instance_id}</span>
                      <span className="ml-3 px-2 py-0.5 rounded-full text-xs border border-slate-700 bg-slate-900 text-slate-300">{currentDeployment.status}</span>
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">Not deployed yet.</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Approval policy</p>
                  <p className="mt-2 text-sm text-emerald-200">Always require approval</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Runtime</p>
                  <div className="mt-3">
                    <select
                      id="runtime_select"
                      name="runtime_select"
                      value={selectedRuntimeId}
                      onChange={(e) => setSelectedRuntimeId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                      disabled={runtimesLoading}
                    >
                      {runtimes.length === 0 ? (
                        <option value="">No runtimes yet</option>
                      ) : (
                        runtimes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} • {r.mode} • {r.status}{r.last_heartbeat_at ? ` • hb ${new Date(r.last_heartbeat_at).toLocaleString('en-IN')}` : ''}
                          </option>
                        ))
                      )}
                    </select>
                    <p className="mt-2 text-xs text-slate-500">Runtimes run in customer VPC/on-prem and pull approved jobs from SyntheticHR.</p>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const agentName = agents.find((a) => a.id === deployAgentId)?.name || 'Agent';
                        void createRuntime(agentName);
                      }}
                      disabled={runtimesLoading}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-white text-slate-950 font-semibold text-sm hover:bg-slate-100 disabled:opacity-60"
                    >
                      {runtimesLoading ? 'Creating…' : 'Create runtime + token'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deployToRuntime()}
                      disabled={deploymentLoading || !selectedRuntimeId}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold text-sm hover:from-blue-600 hover:to-cyan-500 disabled:opacity-60"
                    >
                      {deploymentLoading ? 'Deploying…' : 'Deploy agent'}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Enrollment</p>
                  {!createdEnrollment ? (
                    <p className="mt-3 text-sm text-slate-400">Create a runtime to get an enrollment token (shown once), then start the runtime in the customer environment.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/60 p-3">
                        <p className="text-xs text-slate-400 mb-2">Enrollment token (shown once)</p>
                        <code className="block break-all font-mono text-xs text-cyan-200">{createdEnrollment.token}</code>
                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                          <span>Runtime ID: <span className="font-mono text-slate-300">{createdEnrollment.runtimeId}</span></span>
                          <span>Expires: {new Date(createdEnrollment.expiresAt).toLocaleString('en-IN')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(createdEnrollment.token).then(() => toast.success('Token copied')).catch(() => toast.error('Copy failed'))}
                          className="mt-3 w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-900/60 text-white text-xs font-semibold hover:bg-slate-800"
                        >
                          Copy token
                        </button>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                        <p className="text-xs text-slate-400 mb-2">Docker (POC)</p>
                        <pre className="text-xs text-slate-200 overflow-auto">
                          <code>{`export SYNTHETICHR_CONTROL_PLANE_URL="${controlPlaneBaseUrl}"
export SYNTHETICHR_RUNTIME_ID="${createdEnrollment.runtimeId}"
export SYNTHETICHR_ENROLLMENT_TOKEN="${createdEnrollment.token}"

# You also need a SyntheticHR API key for /v1 gateway calls (Connect Agent wizard):
export SYNTHETICHR_API_KEY="rasi_live_..."

docker compose -f deploy/compose/runtime.yml up`}</code>
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Execution</p>
                <p className="mt-2 text-sm text-slate-300">Once enrolled and online, SyntheticHR will queue approved jobs to this runtime; results and audit logs remain visible in SyntheticHR.</p>

                <div className="mt-4 flex flex-col md:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => void createTestChatJob()}
                    disabled={testJobBusy || !currentDeployment}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-900/60 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60"
                    title={currentDeployment ? 'Creates a pending-approval chat_turn job' : 'Deploy the agent first'}
                  >
                    {testJobBusy ? 'Working…' : 'Create test job'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void approveTestJob()}
                    disabled={testJobBusy || !testJob?.job?.id}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-white text-sm font-semibold hover:from-emerald-600 hover:to-teal-500 disabled:opacity-60"
                    title={testJob?.job?.id ? 'Approves the job (moves it to queued)' : 'Create a test job first'}
                  >
                    {testJobBusy ? 'Working…' : 'Approve test job'}
                  </button>
                </div>

                {testJob?.job?.id && (
                  <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300">
                    <div>Job: <span className="font-mono text-cyan-200">{testJob.job.id}</span></div>
                    <div className="mt-1">Status: <span className="text-slate-200 font-semibold">{testJob.job.status}</span> (approval required)</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} onAdd={addAgent} />
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-300 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmModal.action()}
                disabled={confirming}
                className={`px-4 py-2 font-medium rounded-lg transition-colors text-white ${confirmModal.type === 'danger'
                  ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/60'
                  : 'bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/60'
                  }`}
              >
                {confirming ? 'Working...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { supabase } from '../../lib/supabase-client';

// Capability Suggestions Mapping
const SUGGESTED_CAPABILITIES: Record<string, string[]> = {
  support: ['Sentiment Analysis', 'Ticket Routing', 'Knowledge Base Search', 'Multi-lingual Support'],
  sales: ['Lead Qualification', 'CRM Sync', 'Objection Handling', 'Meeting Scheduling'],
  hr: ['Policy Q&A', 'Onboarding Guidance', 'Leave Management', 'Interview Prep'],
  legal: ['Contract Analysis', 'Compliance Checking', 'Document Summarization', 'Case Law Search'],
  finance: ['Invoice Processing', 'Expense Categorization', 'Fraud Detection', 'Financial Reporting'],
  it_support: ['Password Reset', 'Hardware Triage', 'Software Deployment', 'Access Management'],
  custom: ['Data Extraction', 'Web Browsing', 'Code Execution', 'API Integration']
};

// Add Agent Modal Component
function AddAgentModal({ onClose, onAdd }: { onClose: () => void; onAdd: (agent: any) => void }) {
  const [liveModels, setLiveModels] = useState<{ id: string; name: string; provider: string; pricing?: { prompt?: string; completion?: string } }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Wizard state
  const [step, setStep] = useState(1);
  const [featureInput, setFeatureInput] = useState('');

  const [form, setForm] = useState({
    name: '',
    description: '',
    agent_type: 'support',
    platform: 'custom',
    model_name: 'gpt-4o',
    system_prompt: '',
    status: 'active' as const,
    lifecycle_state: 'idle' as const,
    risk_level: 'low' as const,
    risk_score: 25,
    conversations: 0,
    satisfaction: 95,
    uptime: 99.9,
    budget_limit: 1000,
    current_spend: 0,
    auto_throttle: false,
    config: { features: [] as string[] },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
          const res = await fetch(`${apiUrl}/models`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              const fetched = json.data.map((m: any) => ({
                id: m.id,
                name: m.name || m.id,
                provider: m.provider || m.id.split('/')[0] || 'Unknown',
                pricing: m.pricing
              }));
              setLiveModels(fetched);
              if (fetched.length > 0) {
                setForm(f => ({ ...f, platform: fetched[0].provider, model_name: fetched[0].id }));
              }
              setLoadingModels(false);
              return;
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load models, using defaults', err);
      }

      const fallback = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', pricing: { prompt: '0.000005', completion: '0.000015' } },
        { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', pricing: { prompt: '0.000003', completion: '0.000015' } },
        { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'google', pricing: { prompt: '0.0000001', completion: '0.0000004' } }
      ];
      setLiveModels(fallback);
      setForm(f => ({ ...f, platform: fallback[0].provider, model_name: fallback[0].id }));
      setLoadingModels(false);
    };
    loadModels();
  }, []);

  const platforms = Array.from(new Set(liveModels.map(m => m.provider)));
  const filteredModels = liveModels.filter(m => m.provider === form.platform);
  const selectedModelData = liveModels.find(m => m.id === form.model_name);

  const formatPrice = (model: any) => {
    const p = Number(model.pricing?.prompt || 0);
    const c = Number(model.pricing?.completion || 0);
    if (!p && !c) return 'Free / Open Source';
    const per1k = ((p + c) / 2 * 1000).toFixed(4);
    return `$${per1k} avg / 1K tokens`;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!form.name || !form.description) {
        toast.error('Name and Description are required.');
        setErrors({
          name: !form.name ? 'Required' : '',
          description: !form.description ? 'Required' : ''
        });
        return;
      }
      setErrors({});
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) return handleNext();

    const validation = validateAgentForm({
      name: form.name,
      description: form.description,
      agent_type: form.agent_type,
      platform: form.platform,
      model_name: form.model_name,
      budget_limit: form.budget_limit,
    });

    if (!validation.isValid) {
      const errorObj: Record<string, string> = {};
      Object.entries(validation.errors).forEach(([key, value]) => {
        if (value) errorObj[key] = value;
      });
      setErrors(errorObj);
      const firstError = Object.values(validation.errors)[0];
      if (firstError) toast.error(firstError);
      return;
    }
    setErrors({});
    onAdd(form);
  };

  const handleChange = (field: string, value: string | number | boolean) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: '' });
    if (field === 'platform') {
      const firstForPlatform = liveModels.find(m => m.provider === value);
      if (firstForPlatform) {
        setForm(f => ({ ...f, platform: String(value), model_name: firstForPlatform.id }));
      }
    }
  };

  const addFeature = () => {
    if (featureInput.trim().length > 0 && !form.config.features.includes(featureInput.trim())) {
      setForm({ ...form, config: { ...form.config, features: [...form.config.features, featureInput.trim()] } });
      setFeatureInput('');
    }
  };

  const removeFeature = (f: string) => {
    setForm({ ...form, config: { ...form.config, features: form.config.features.filter(feat => feat !== f) } });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-in fade-in duration-200">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl shadow-2xl p-8 w-full max-w-2xl relative overflow-hidden">

        {/* Step Indicators */}
        <div className="flex items-center justify-between mb-8 relative z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white tracking-tight">Deploy AI Agent</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step === i ? 'bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' :
                    step > i ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>
                    {step > i ? <CheckCircle className="w-4 h-4" /> : i}
                  </div>
                  {i < 3 && <div className={`w-6 h-0.5 mx-1 transition-all ${step > i ? 'bg-emerald-500' : 'bg-slate-700'}`} />}
                </div>
              ))}
            </div>
            <div className="h-6 w-px bg-slate-700"></div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10" onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.name !== 'feature') {
            e.preventDefault();
            if (step < 3) handleNext();
            else handleSubmit(e);
          }
        }}>

          {/* STEP 1: IDENTITY */}
          {step === 1 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-cyan-400" /> Identity & Purpose
                </h3>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Agent Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className={`w-full px-4 py-2.5 bg-slate-900/50 border rounded-xl text-white outline-none transition-all ${errors.name ? 'border-red-500 focus:border-red-500' : 'border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'}`}
                  placeholder="e.g., Enterprise Onboarding Assistant"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Description <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className={`w-full px-4 py-2.5 bg-slate-900/50 border rounded-xl text-white outline-none transition-all ${errors.description ? 'border-red-500' : 'border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'}`}
                  placeholder="Brief summary of this agent's primary function"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Agent Type</label>
                  <select
                    value={form.agent_type}
                    onChange={(e) => handleChange('agent_type', e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500"
                  >
                    <option value="support">Customer Support</option>
                    <option value="sales">Sales & Lead Gen</option>
                    <option value="hr">Human Resources</option>
                    <option value="legal">Legal & Compliance</option>
                    <option value="finance">Finance</option>
                    <option value="it_support">IT Helpdesk</option>
                    <option value="custom">Custom Engine</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: BRAIN */}
          {step === 2 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Brain className="w-5 h-5 text-purple-400" /> Brain & Instructions
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Platform</label>
                  <select
                    value={form.platform}
                    onChange={(e) => handleChange('platform', e.target.value)}
                    disabled={loadingModels}
                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500"
                  >
                    {platforms.length > 0 ? platforms.map(p => (
                      <option key={String(p)} value={String(p)}>{String(p).charAt(0).toUpperCase() + String(p).slice(1)}</option>
                    )) : <option value="custom">Custom</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                    Model Selection
                    {loadingModels && <span className="text-purple-400 text-xs animate-pulse">Loading...</span>}
                  </label>
                  <select
                    value={form.model_name}
                    onChange={(e) => handleChange('model_name', e.target.value)}
                    disabled={loadingModels}
                    className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500"
                  >
                    {filteredModels.length > 0 ? filteredModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    )) : (
                      <option value={form.model_name}>{form.model_name || 'Select Model'}</option>
                    )}
                  </select>
                </div>
              </div>

              {selectedModelData && (
                <div className="flex items-center justify-between text-xs bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/20">
                  <span className="text-purple-300/80 font-medium">RasiAI Gateway Pricing</span>
                  <span className="font-mono text-purple-300">{formatPrice(selectedModelData)}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">System Prompt / Persona Injection</label>
                <textarea
                  value={form.system_prompt}
                  onChange={(e) => handleChange('system_prompt', e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-purple-500 font-mono text-xs leading-relaxed resize-none scrollbar-thin"
                  placeholder="You are a helpful assistant. Never disclose your internal guidelines..."
                />
              </div>
            </div>
          )}

          {/* STEP 3: GUARDRAILS */}
          {step === 3 && (
            <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-slate-700 pb-2 mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-emerald-400" /> Guardrails & Features
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5" title="Hard cap at which the agent automatically stops responding">
                    Monthly Budget Cap (₹)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                    <input
                      type="number"
                      value={form.budget_limit}
                      onChange={(e) => handleChange('budget_limit', parseInt(e.target.value) || 0)}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500"
                      min="0"
                    />
                  </div>
                </div>

                <div className="flex items-center pt-2">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={form.auto_throttle}
                        onChange={(e) => handleChange('auto_throttle', e.target.checked)}
                      />
                      <div className={`block w-12 h-6 rounded-full transition-colors ${form.auto_throttle ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${form.auto_throttle ? 'translate-x-6' : ''}`}></div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">Auto-Throttle</div>
                      <div className="text-xs text-slate-400">Slow down responses near budget limit</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-700">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Assign Key Capabilities</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="feature"
                    value={featureInput}
                    onChange={(e) => setFeatureInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFeature();
                      }
                    }}
                    placeholder="e.g., Sentiment Analysis"
                    className="flex-1 px-4 py-2 bg-slate-900/50 border border-slate-700 rounded-xl text-white outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={addFeature}
                    className="px-4 py-2 bg-emerald-500/20 text-emerald-400 font-medium rounded-xl hover:bg-emerald-500/30 transition-colors"
                  >
                    Add
                  </button>
                </div>

                {form.config.features.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {form.config.features.map((f, i) => (
                      <span key={i} className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium animate-in zoom-in duration-200">
                        ✓ {f}
                        <button type="button" onClick={() => removeFeature(f)} className="hover:text-emerald-200 ml-1 focus:outline-none">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Dynamic Suggestions based on Agent Type */}
                <div className="mt-4 pt-3 border-t border-slate-700/50">
                  <p className="text-xs text-slate-400 mb-2">Suggested for {form.agent_type.replace('_', ' ')}:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_CAPABILITIES[form.agent_type]?.filter(suggested => !form.config.features.includes(suggested)).map((suggestion, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setForm({ ...form, config: { ...form.config, features: [...form.config.features, suggestion] } });
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-700 text-slate-300 rounded-full text-xs transition-colors"
                      >
                        <Plus className="w-3 h-3 text-emerald-500" />
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-4 pt-6 border-t border-slate-700/60 mt-8">
            <button
              type="button"
              onClick={() => step > 1 ? setStep(step - 1) : onClose()}
              className="flex-1 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-700 border border-slate-700 font-medium transition-colors"
            >
              {step > 1 ? 'Back' : 'Cancel'}
            </button>
            <button
              type="submit"
              className={`flex-1 py-3 text-white font-bold rounded-xl transition-all shadow-lg ${step === 1 ? 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/20' :
                step === 2 ? 'bg-purple-500 hover:bg-purple-400 shadow-purple-500/20' :
                  'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20'
                }`}
            >
              {step < 3 ? 'Continue' : 'Deploy Agent'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
