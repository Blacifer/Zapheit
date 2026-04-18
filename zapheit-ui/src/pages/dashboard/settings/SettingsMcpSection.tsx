import { useState } from 'react';
import { Plus, Trash2, RefreshCw, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from '../../../lib/toast';
import { supabase } from '../../../lib/supabase-client';
import { getFrontendConfig } from '../../../lib/config';

interface McpServer {
  id: string;
  name: string;
  url: string;
  auth_token?: string;
}

export function SettingsMcpSection() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; toolCount?: number; error?: string }>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', auth_token: '' });

  const loadServers = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
      const res = await fetch(`${apiUrl}/organizations/settings`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setServers(json.data?.mcp_servers || []);
      }
    } catch { /* ignore */ }
    setLoaded(true);
    setLoading(false);
  };

  if (!loaded && !loading) { void loadServers(); }

  const saveServers = async (updated: McpServer[]) => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
      const res = await fetch(`${apiUrl}/organizations/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mcp_servers: updated }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('MCP servers saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  };

  const addServer = async () => {
    if (!newServer.name.trim() || !newServer.url.trim()) {
      toast.error('Name and URL are required.');
      return;
    }
    try { new URL(newServer.url); } catch {
      toast.error('URL is not valid.');
      return;
    }
    const entry: McpServer = {
      id: crypto.randomUUID(),
      name: newServer.name.trim(),
      url: newServer.url.trim(),
      ...(newServer.auth_token.trim() ? { auth_token: newServer.auth_token.trim() } : {}),
    };
    const updated = [...servers, entry];
    setServers(updated);
    setNewServer({ name: '', url: '', auth_token: '' });
    setShowAdd(false);
    await saveServers(updated);
  };

  const removeServer = async (id: string) => {
    const updated = servers.filter((s) => s.id !== id);
    setServers(updated);
    setTestResults((r) => { const copy = { ...r }; delete copy[id]; return copy; });
    await saveServers(updated);
  };

  const testServer = async (srv: McpServer) => {
    setTestingId(srv.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
      const res = await fetch(`${apiUrl}/mcp-servers/${encodeURIComponent(srv.id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: session ? `Bearer ${session.access_token}` : '' },
      });
      const json = await res.json().catch(() => ({}));
      setTestResults((r) => ({ ...r, [srv.id]: { ok: json.success, toolCount: json.data?.toolCount, error: json.error } }));
    } catch (err: any) {
      setTestResults((r) => ({ ...r, [srv.id]: { ok: false, error: err?.message } }));
    }
    setTestingId(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">MCP Servers</h3>
        <p className="text-sm text-slate-400 mt-1">
          Connect Model Context Protocol (MCP) servers to give your agents access to community-built tools via HTTP transport.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {servers.length === 0 && !showAdd && (
            <p className="text-sm text-slate-500 py-4 text-center">No MCP servers configured.</p>
          )}
          {servers.map((srv) => {
            const result = testResults[srv.id];
            return (
              <div key={srv.id} className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{srv.name}</p>
                  <p className="text-xs text-slate-500 truncate font-mono">{srv.url}</p>
                  {result && (
                    <p className={`text-xs mt-1 flex items-center gap-1 ${result.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {result.ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {result.ok ? `Connected — ${result.toolCount ?? 0} tools` : result.error}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void testServer(srv)}
                  disabled={testingId === srv.id}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                >
                  {testingId === srv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Test
                </button>
                <button onClick={() => void removeServer(srv.id)} className="text-slate-500 hover:text-rose-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          {showAdd && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
              <p className="text-sm font-medium text-white">Add MCP Server</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Name</label>
                  <input
                    value={newServer.name}
                    onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                    placeholder="e.g. GitHub MCP"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-xl text-sm outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">URL</label>
                  <input
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                    placeholder="https://mcp.example.com"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-xl text-sm outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Auth Token (optional)</label>
                  <input
                    type="password"
                    value={newServer.auth_token}
                    onChange={(e) => setNewServer({ ...newServer, auth_token: e.target.value })}
                    placeholder="Bearer token for authenticated MCP servers"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 text-white rounded-xl text-sm outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                <button
                  onClick={() => void addServer()}
                  disabled={saving}
                  className="px-4 py-1.5 bg-cyan-500 text-white rounded-xl text-xs font-semibold hover:bg-cyan-400 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  Add Server
                </button>
              </div>
            </div>
          )}

          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add MCP Server
            </button>
          )}
        </div>
      )}
    </div>
  );
}
