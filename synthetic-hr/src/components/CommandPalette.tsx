import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import {
  BarChart3, Users, AlertTriangle, DollarSign, MessageSquare, Shield,
  FileText, Database, Key, Settings, Zap, Bot, CheckSquare, ScrollText,
  Server, PlugZap, ClipboardList, TrendingUp, Sparkles, Search, ArrowRight,
  Plus, Building2, ShieldCheck,
} from 'lucide-react';

interface CommandPaletteProps {
  onNavigate: (page: string) => void;
  agents?: Array<{ id: string; name: string; status?: string }>;
}

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'fleet', label: 'Fleet', icon: Users },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'action-policies', label: 'Action Policies', icon: Shield },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'costs', label: 'Costs', icon: DollarSign },
  { id: 'audit-log', label: 'Audit Log', icon: ScrollText },
  { id: 'connectors', label: 'Marketplace', icon: Building2 },
  { id: 'playbooks', label: 'Playbooks', icon: FileText },
  { id: 'jobs', label: 'Run History', icon: ClipboardList },
  { id: 'blackbox', label: 'Black Box', icon: Database },
  { id: 'api-access', label: 'API Access', icon: Key },
  { id: 'developer', label: 'Developer', icon: PlugZap },
  { id: 'model-comparison', label: 'Model Comparison', icon: TrendingUp },
  { id: 'runtime-workers', label: 'Runtime Workers', icon: Server },
  { id: 'safe-harbor', label: 'Safe Harbor', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'getting-started', label: 'Getting Started', icon: Sparkles },
  { id: 'agent-library', label: 'Agent Library', icon: Bot },
  { id: 'templates', label: 'Agent Templates', icon: Zap },
];

const QUICK_ACTIONS = [
  { id: 'fleet', label: 'Add New Agent', icon: Plus, hint: 'Fleet' },
  { id: 'api-access', label: 'Create API Key', icon: Key, hint: 'API Access' },
  { id: 'playbooks', label: 'New Playbook', icon: FileText, hint: 'Playbooks' },
  { id: 'action-policies', label: 'New Action Policy', icon: Shield, hint: 'Governance' },
];

function statusDot(status?: string) {
  if (status === 'active') return 'bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]';
  if (status === 'degraded') return 'bg-amber-400';
  return 'bg-slate-600';
}

export function CommandPalette({ onNavigate, agents = [] }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const handleKeydown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleKeydown]);

  const handleSelect = (page: string) => {
    setOpen(false);
    setSearch('');
    onNavigate(page);
  };

  const filteredAgents = search.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : agents.slice(0, 5);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v: boolean) => { setOpen(v); if (!v) setSearch(''); }}
      label="Command palette"
      overlayClassName="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
      contentClassName="fixed z-[9999] top-[14vh] left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)] max-w-xl rounded-2xl border border-slate-700/80 bg-slate-900/98 shadow-[0_25px_80px_rgba(0,0,0,0.7)] overflow-hidden"
      shouldFilter={false}
    >
      {/* Search input */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800">
        <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Search pages, agents, actions..."
          className="flex-1 bg-transparent text-white placeholder:text-slate-500 text-sm outline-none"
        />
        <kbd className="hidden sm:flex items-center text-[10px] text-slate-500 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-mono">
          ESC
        </kbd>
      </div>

      <Command.List className="max-h-[400px] overflow-y-auto overscroll-contain p-2 space-y-0.5">
        <Command.Empty className="py-10 text-center text-sm text-slate-500">
          No results for &ldquo;{search}&rdquo;
        </Command.Empty>

        {/* Quick Actions */}
        <Command.Group>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold px-2 pt-2 pb-1">
            Quick Actions
          </div>
          {QUICK_ACTIONS.filter((a) =>
            !search.trim() || a.label.toLowerCase().includes(search.toLowerCase())
          ).map((action) => (
            <Command.Item
              key={action.id + action.label}
              value={`action ${action.label}`}
              onSelect={() => handleSelect(action.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-sm text-slate-300 data-[selected=true]:bg-slate-800/80 data-[selected=true]:text-white transition-colors group"
            >
              <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 group-data-[selected=true]:border-cyan-500/40 group-data-[selected=true]:bg-cyan-500/10 transition-colors">
                <action.icon className="w-3.5 h-3.5 text-slate-400 group-data-[selected=true]:text-cyan-400" />
              </div>
              <span className="flex-1">{action.label}</span>
              <span className="text-[10px] text-slate-600 bg-slate-800/60 px-1.5 py-0.5 rounded font-medium">{action.hint}</span>
              <ArrowRight className="w-3 h-3 text-slate-600 group-data-[selected=true]:text-cyan-400 opacity-0 group-data-[selected=true]:opacity-100 transition-all" />
            </Command.Item>
          ))}
        </Command.Group>

        {/* Divider */}
        <div className="my-1.5 h-px bg-slate-800/80" />

        {/* Navigate */}
        <Command.Group>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold px-2 pt-1 pb-1">
            Navigate
          </div>
          {NAV_ITEMS.filter((item) =>
            !search.trim() || item.label.toLowerCase().includes(search.toLowerCase())
          ).map((item) => (
            <Command.Item
              key={item.id}
              value={`navigate ${item.label} ${item.id}`}
              onSelect={() => handleSelect(item.id)}
              className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer text-sm text-slate-400 data-[selected=true]:bg-slate-800/60 data-[selected=true]:text-white transition-colors group"
            >
              <item.icon className="w-4 h-4 flex-shrink-0 text-slate-500 group-data-[selected=true]:text-cyan-400 transition-colors" />
              <span className="flex-1">{item.label}</span>
              <ArrowRight className="w-3 h-3 text-slate-600 group-data-[selected=true]:text-cyan-400 opacity-0 group-data-[selected=true]:opacity-100 transition-all" />
            </Command.Item>
          ))}
        </Command.Group>

        {/* Agents */}
        {filteredAgents.length > 0 && (
          <>
            <div className="my-1.5 h-px bg-slate-800/80" />
            <Command.Group>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold px-2 pt-1 pb-1">
                Agents
              </div>
              {filteredAgents.map((agent) => (
                <Command.Item
                  key={agent.id}
                  value={`agent ${agent.name}`}
                  onSelect={() => handleSelect(`fleet`)}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer text-sm text-slate-400 data-[selected=true]:bg-slate-800/60 data-[selected=true]:text-white transition-colors group"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${statusDot(agent.status)}`} />
                  <span className="flex-1 truncate">{agent.name}</span>
                  <span className="text-[10px] text-slate-600 capitalize">{agent.status || 'unknown'}</span>
                  <ArrowRight className="w-3 h-3 text-slate-600 group-data-[selected=true]:text-cyan-400 opacity-0 group-data-[selected=true]:opacity-100 transition-all" />
                </Command.Item>
              ))}
            </Command.Group>
          </>
        )}
      </Command.List>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono text-[10px]">↵</kbd> open
          </span>
        </div>
        <span className="text-[10px] text-slate-600 font-mono">⌘K to toggle</span>
      </div>
    </Command.Dialog>
  );
}
