import { useState, useEffect, useCallback } from 'react';
import {
  Server, RefreshCw, Trash2, Plus, Copy, CheckCircle2,
  AlertTriangle, Clock, Wifi, WifiOff, Activity, ChevronDown,
  ChevronRight, Terminal, X, RotateCcw,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import type { RuntimeInstance } from '../../lib/api/platform';
import { toast } from '../../lib/toast';

// ── helpers ─────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case 'online':    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'degraded':  return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'offline':   return 'text-red-400 bg-red-500/10 border-red-500/30';
    default:          return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

function statusDot(status: string) {
  switch (status) {
    case 'online':   return 'bg-emerald-400 shadow-emerald-400/50';
    case 'degraded': return 'bg-amber-400 shadow-amber-400/50';
    case 'offline':  return 'bg-red-400 shadow-red-400/50';
    default:         return 'bg-slate-500';
  }
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function heartbeatAge(ts: string | null): string {
  if (!ts) return 'Never';
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function modeLabel(mode: string) {
  return mode === 'vpc' ? 'VPC / On-Prem' : 'Hosted';
}

// ── enrollment token modal ────────────────────────────────────────────────

interface EnrollmentModalProps {
  token: string;
  expires: string;
  name: string;
  onClose: () => void;
}

function EnrollmentModal({ token, expires, name, onClose }: EnrollmentModalProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Enrollment Token</h2>
            <p className="text-sm text-slate-400 mt-0.5">For worker: <span className="text-cyan-400 font-medium">{name}</span></p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            This token is shown only once. Copy it now.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-cyan-300 font-mono bg-slate-900 rounded-lg px-3 py-2 break-all select-all">
              {token}
            </code>
            <button
              onClick={copy}
              className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex-shrink-0"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Expires {new Date(expires).toLocaleString()}
        </div>

        <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" /> Start the worker</p>
          <code className="text-xs text-slate-400 font-mono block">
            RASI_ENROLLMENT_TOKEN={token.slice(0, 8)}… \<br />
            {'  '}RASI_API_URL=https://api.rasi.ai \<br />
            {'  '}docker run rasi/runtime-worker:latest
          </code>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── register modal ────────────────────────────────────────────────────────

interface RegisterModalProps {
  onClose: () => void;
  onCreated: (token: string, expires: string, name: string) => void;
}

function RegisterModal({ onClose, onCreated }: RegisterModalProps) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'hosted' | 'vpc'>('vpc');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    const res = await api.runtimes.create({ name: name.trim(), mode });
    setSaving(false);
    if (!res.success || !res.data) { toast.error(res.error || 'Failed to register worker'); return; }
    const d = res.data as any;
    onCreated(d.enrollment_token, d.enrollment_expires_at, name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-white">Register Runtime Worker</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Worker Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. prod-worker-1"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Deployment Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {(['vpc', 'hosted'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`p-3 rounded-xl border text-sm font-semibold transition-all ${
                    mode === m
                      ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {modeLabel(m)}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {mode === 'vpc'
                ? 'Worker runs inside your network — jobs never leave your VPC.'
                : 'Worker runs on Rasi-managed infrastructure.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-slate-400 text-sm hover:text-white transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold text-sm rounded-xl flex items-center gap-2 disabled:opacity-50 hover:from-cyan-400 hover:to-blue-400 transition-all"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {saving ? 'Registering…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── worker row ────────────────────────────────────────────────────────────

interface WorkerRowProps {
  worker: RuntimeInstance;
  onDeregister: (id: string) => void;
  onRotate: (id: string) => void;
  deregistering: boolean;
  rotating: boolean;
}

function WorkerRow({ worker, onDeregister, onRotate, deregistering, rotating }: WorkerRowProps) {
  const [expanded, setExpanded] = useState(false);

  const caps: string[] = Array.isArray(worker.capabilities)
    ? worker.capabilities
    : typeof worker.capabilities === 'object' && worker.capabilities
      ? Object.keys(worker.capabilities)
      : [];

  const isStale = worker.last_heartbeat_at
    ? (Date.now() - new Date(worker.last_heartbeat_at).getTime()) > 5 * 60 * 1000
    : true;

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden bg-slate-800/30 hover:bg-slate-800/50 transition-colors">
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm ${statusDot(worker.status)} ${worker.status === 'online' ? 'animate-pulse' : ''}`} />

        {/* Name + mode */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{worker.name}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 font-medium border border-slate-600/50">
              {modeLabel(worker.mode)}
            </span>
            {worker.version && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-500 font-mono">
                v{worker.version}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {heartbeatAge(worker.last_heartbeat_at)}
              {isStale && worker.status === 'online' && <AlertTriangle className="w-3 h-3 text-amber-400 ml-0.5" />}
            </span>
            <span className="font-mono text-slate-600">{worker.id.slice(0, 8)}</span>
          </div>
        </div>

        {/* Status badge */}
        <span className={`hidden sm:inline-flex text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColor(worker.status)}`}>
          {worker.status === 'online' ? <Wifi className="w-3 h-3 mr-1.5" /> : <WifiOff className="w-3 h-3 mr-1.5" />}
          {statusLabel(worker.status)}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => onRotate(worker.id)}
            disabled={rotating}
            title="Rotate enrollment token"
            className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 rounded-lg transition-all disabled:opacity-40"
          >
            {rotating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => onDeregister(worker.id)}
            disabled={deregistering}
            title="Deregister worker"
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-40"
          >
            {deregistering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-all"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/40 px-5 py-4 bg-slate-900/30 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-slate-500 mb-1 font-medium uppercase tracking-wide text-[10px]">Worker ID</p>
            <p className="font-mono text-slate-300 break-all">{worker.id}</p>
          </div>
          <div>
            <p className="text-slate-500 mb-1 font-medium uppercase tracking-wide text-[10px]">Registered</p>
            <p className="text-slate-300">{new Date(worker.created_at).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-slate-500 mb-1 font-medium uppercase tracking-wide text-[10px]">Last Heartbeat</p>
            <p className="text-slate-300">{worker.last_heartbeat_at ? new Date(worker.last_heartbeat_at).toLocaleString() : '—'}</p>
          </div>
          <div>
            <p className="text-slate-500 mb-1 font-medium uppercase tracking-wide text-[10px]">Capabilities</p>
            {caps.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {caps.map((c, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded-md font-mono">{c}</span>
                ))}
              </div>
            ) : <p className="text-slate-500">—</p>}
          </div>
          {worker.metadata && Object.keys(worker.metadata).length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-slate-500 mb-1 font-medium uppercase tracking-wide text-[10px]">Metadata</p>
              <pre className="text-slate-400 font-mono text-[10px] bg-slate-900 rounded-lg p-3 overflow-auto max-h-32">
                {JSON.stringify(worker.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────

export default function RuntimeWorkersPage() {
  const [workers, setWorkers] = useState<RuntimeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [enrollment, setEnrollment] = useState<{ token: string; expires: string; name: string } | null>(null);
  const [deregistering, setDeregistering] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true); else setRefreshing(true);
    const res = await api.runtimes.list();
    if (res.success && res.data) setWorkers(res.data);
    if (!quiet) setLoading(false); else setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(() => load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const handleDeregister = async (id: string) => {
    const w = workers.find(x => x.id === id);
    if (!confirm(`Deregister "${w?.name}"? This cannot be undone.`)) return;
    setDeregistering(id);
    const res = await api.runtimes.delete(id);
    if (res.success) {
      setWorkers(prev => prev.filter(x => x.id !== id));
      toast.success('Worker deregistered.');
    } else {
      toast.error(res.error || 'Failed to deregister worker.');
    }
    setDeregistering(null);
  };

  const handleRotate = async (id: string) => {
    const w = workers.find(x => x.id === id);
    setRotating(id);
    const res = await api.runtimes.rotateEnrollment(id);
    setRotating(null);
    if (!res.success || !res.data) { toast.error(res.error || 'Rotation failed'); return; }
    const d = res.data as any;
    setEnrollment({ token: d.enrollment_token, expires: d.enrollment_expires_at, name: w?.name || id });
    toast.success('Enrollment token rotated.');
  };

  const onCreated = (token: string, expires: string, name: string) => {
    setShowRegister(false);
    setEnrollment({ token, expires, name });
    load(true);
  };

  // Aggregate stats
  const online  = workers.filter(w => w.status === 'online').length;
  const degraded = workers.filter(w => w.status === 'degraded').length;
  const offline  = workers.filter(w => w.status === 'offline').length;
  const pending  = workers.filter(w => w.status === 'pending').length;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Runtime Workers</h1>
          <p className="text-slate-400 text-sm mt-1">
            Backend async job execution workers — run agent jobs securely inside your VPC or on Rasi-managed infrastructure.
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Workers process jobs from the queue (playbook runs, connector actions, batch tasks). Separate from Fleet — agents are defined in Fleet, workers are the machines that execute them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-xl transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowRegister(true)}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold text-sm rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            <Plus className="w-4 h-4" /> Register Worker
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Online',   value: online,   color: 'text-emerald-400', icon: Wifi },
          { label: 'Degraded', value: degraded, color: 'text-amber-400',   icon: AlertTriangle },
          { label: 'Offline',  value: offline,  color: 'text-red-400',     icon: WifiOff },
          { label: 'Pending',  value: pending,  color: 'text-slate-400',   icon: Clock },
        ].map(stat => (
          <div key={stat.label} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl bg-slate-700/50 flex items-center justify-center ${stat.color}`}>
              <stat.icon className="w-4 h-4" />
            </div>
            <div>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Workers list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            {workers.length} worker{workers.length !== 1 ? 's' : ''} registered
          </h2>
          {refreshing && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" /> Refreshing…
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : workers.length === 0 ? (
          <div className="bg-slate-800/30 border border-slate-700/40 border-dashed rounded-2xl p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
              <Server className="w-7 h-7 text-slate-500" />
            </div>
            <h3 className="text-base font-semibold text-slate-300 mb-2">No workers registered</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mb-5">
              Register a runtime worker to execute agent jobs securely inside your VPC or on Rasi-managed infrastructure.
            </p>
            <button
              onClick={() => setShowRegister(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold text-sm rounded-xl hover:from-cyan-400 hover:to-blue-400 transition-all"
            >
              Register your first worker
            </button>
          </div>
        ) : (
          workers.map(w => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDeregister={handleDeregister}
              onRotate={handleRotate}
              deregistering={deregistering === w.id}
              rotating={rotating === w.id}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {showRegister && (
        <RegisterModal onClose={() => setShowRegister(false)} onCreated={onCreated} />
      )}
      {enrollment && (
        <EnrollmentModal
          token={enrollment.token}
          expires={enrollment.expires}
          name={enrollment.name}
          onClose={() => setEnrollment(null)}
        />
      )}
    </div>
  );
}
