import { useEffect, useState, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import {
  BarChart3, Users, AlertTriangle, DollarSign, MessageSquare, Shield,
  Database, Key, Settings, CheckSquare, ScrollText,
  Server, PlugZap, ClipboardList, Sparkles, Search, ArrowRight,
  Plus, Building2, ShieldCheck, Wand2, Layers, Loader2,
} from 'lucide-react';
import { api } from '../lib/api-client';

interface CommandPaletteProps {
  onNavigate: (page: string) => void;
  agents?: Array<{ id: string; name: string; status?: string }>;
}

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'apps', label: 'Apps', icon: Building2 },
  { id: 'hubs', label: 'Hubs', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'getting-started', label: 'Getting Started', icon: Sparkles },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'costs', label: 'Costs', icon: DollarSign },
  { id: 'governed-actions', label: 'Governed Actions', icon: ShieldCheck },
  { id: 'action-policies', label: 'Policies', icon: Shield },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare },
  { id: 'audit-log', label: 'Audit Log', icon: ScrollText },
  { id: 'agent-studio', label: 'Agent Studio', icon: Wand2 },
  { id: 'execution-history', label: 'Execution History', icon: ClipboardList },
  { id: 'blackbox', label: 'Black Box', icon: Database },
  { id: 'api-webhooks', label: 'API & Webhooks', icon: Key },
  { id: 'developer', label: 'Developer', icon: PlugZap },
  { id: 'platform', label: 'Platform', icon: Server },
];

const QUICK_ACTIONS = [
  { id: 'agents', label: 'Add New Agent', icon: Plus, hint: 'Agents' },
  { id: 'apps', label: 'Connect an App', icon: Building2, hint: 'Apps' },
  { id: 'incidents', label: 'Review Incidents', icon: AlertTriangle, hint: 'Trust' },
  { id: 'getting-started', label: 'Finish Setup', icon: Sparkles, hint: 'Simple' },
];

function statusDot(status?: string) {
  if (status === 'active') return 'bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]';
  if (status === 'degraded') return 'bg-amber-400';
  return 'bg-slate-600';
}

export function CommandPalette({ onNavigate, agents = [] }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [connectorResults, setConnectorResults] = useState<Array<{ connectorId: string; label: string; items: any[] }>>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Cross-connector search — debounced
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim() || search.trim().length < 2) {
      setConnectorResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const connectors = [
        { id: 'jira', action: 'search_issues', label: 'Jira Issues' },
        { id: 'github', action: 'list_issues', label: 'GitHub Issues' },
        { id: 'notion', action: 'search', label: 'Notion Pages' },
        { id: 'hubspot', action: 'search_contacts', label: 'HubSpot Contacts' },
      ];
      const settled = await Promise.allSettled(
        connectors.map(c => api.unifiedConnectors.executeAction(c.id, c.action, { query: search.trim(), q: search.trim(), limit: 3 })),
      );
      const results: typeof connectorResults = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.success) {
          const data = r.value.data?.data;
          const items = Array.isArray(data) ? data.slice(0, 3) : (data?.results ? data.results.slice(0, 3) : []);
          if (items.length > 0) {
            results.push({ connectorId: connectors[i].id, label: connectors[i].label, items });
          }
        }
      });
      setConnectorResults(results);
      setSearching(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

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
                  onSelect={() => handleSelect(`agents`)}
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

        {/* Cross-connector search results */}
        {search.trim().length >= 2 && (
          <>
            <div className="my-1.5 h-px bg-slate-800/80" />
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching connected apps…
              </div>
            ) : connectorResults.length > 0 ? (
              connectorResults.map(({ connectorId, label, items }) => (
                <Command.Group key={connectorId}>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold px-2 pt-2 pb-1">
                    {label}
                  </div>
                  {items.map((item: any, i: number) => {
                    const title = item.summary || item.title || item.name || item.properties?.title?.title?.[0]?.plain_text || item.properties?.firstname?.value || `${connectorId} result`;
                    const workspacePath = connectorId === 'jira' ? 'jira' : connectorId === 'github' ? 'github' : connectorId === 'notion' ? 'notion' : connectorId === 'hubspot' ? 'hubspot' : 'apps';
                    return (
                      <Command.Item
                        key={`${connectorId}-${i}`}
                        value={`connector ${connectorId} ${title}`}
                        onSelect={() => handleSelect(`apps/${workspacePath}/workspace`)}
                        className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer text-sm text-slate-400 data-[selected=true]:bg-slate-800/60 data-[selected=true]:text-white transition-colors group"
                      >
                        <Database className="w-4 h-4 flex-shrink-0 text-slate-500 group-data-[selected=true]:text-cyan-400 transition-colors" />
                        <span className="flex-1 truncate">{title}</span>
                        <span className="text-[10px] text-slate-600 capitalize">{connectorId}</span>
                        <ArrowRight className="w-3 h-3 text-slate-600 group-data-[selected=true]:text-cyan-400 opacity-0 group-data-[selected=true]:opacity-100 transition-all" />
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))
            ) : !searching && connectorResults.length === 0 ? (
              <div className="py-2 text-center text-[11px] text-slate-600">No results from connected apps</div>
            ) : null}
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
        <span className="text-[10px] text-slate-600 font-mono">
          {typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'} to toggle
        </span>
      </div>
    </Command.Dialog>
  );
}
