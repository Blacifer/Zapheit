import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Send, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { api } from '../../../lib/api-client';
import type { AlertChannel, ChannelType, SeverityLevel, CreateAlertChannelInput } from '../../../lib/api/alert-channels';

const CHANNEL_META: Record<ChannelType, { label: string; color: string; fields: Array<{ key: string; label: string; placeholder: string; type?: string }> }> = {
  pagerduty: {
    label: 'PagerDuty',
    color: 'text-[#06AC38]',
    fields: [{ key: 'routing_key', label: 'Routing Key (Events API v2)', placeholder: '32-character routing key', type: 'password' }],
  },
  teams: {
    label: 'Microsoft Teams',
    color: 'text-[#6264A7]',
    fields: [{ key: 'webhook_url', label: 'Incoming Webhook URL', placeholder: 'https://...webhook.office.com/...', type: 'url' }],
  },
  opsgenie: {
    label: 'Opsgenie',
    color: 'text-[#FF6B00]',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'Opsgenie API key', type: 'password' },
      { key: 'region', label: 'Region', placeholder: 'us or eu (default: us)' },
    ],
  },
  email: {
    label: 'Email',
    color: 'text-blue-400',
    fields: [{ key: 'recipients', label: 'Recipients (comma-separated)', placeholder: 'ops@company.com, cto@company.com' }],
  },
};

const SEVERITIES: SeverityLevel[] = ['low', 'medium', 'high', 'critical'];
const SEV_COLORS: Record<SeverityLevel, string> = {
  low: 'text-slate-400',
  medium: 'text-amber-400',
  high: 'text-orange-400',
  critical: 'text-rose-400',
};

const EMPTY_CONFIG: Record<ChannelType, Record<string, string>> = {
  pagerduty: { routing_key: '' },
  teams: { webhook_url: '' },
  opsgenie: { api_key: '', region: 'us' },
  email: { recipients: '' },
};

function ChannelForm({
  onSave,
  onCancel,
}: {
  onSave: (input: CreateAlertChannelInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ChannelType>('pagerduty');
  const [name, setName] = useState('');
  const [minSeverity, setMinSeverity] = useState<SeverityLevel>('high');
  const [config, setConfig] = useState<Record<string, string>>(EMPTY_CONFIG.pagerduty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTypeChange = (t: ChannelType) => {
    setType(t);
    setConfig({ ...EMPTY_CONFIG[t] });
    if (!name) setName(CHANNEL_META[t].label);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    const meta = CHANNEL_META[type];
    for (const f of meta.fields) {
      if (!config[f.key]?.trim() && f.key !== 'region') {
        setError(`${f.label} is required`); return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), channel_type: type, min_severity: minSeverity, config });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const meta = CHANNEL_META[type];

  return (
    <div className="bg-slate-900/60 border border-slate-600/60 rounded-2xl p-5 space-y-4">
      <h4 className="text-sm font-semibold text-white">New Alert Channel</h4>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Channel Type</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ChannelType)}
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-cyan-500"
          >
            {(Object.keys(CHANNEL_META) as ChannelType[]).map((t) => (
              <option key={t} value={t}>{CHANNEL_META[t].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. ${meta.label} Prod`}
            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Minimum Severity to Trigger</label>
        <div className="flex gap-2">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setMinSeverity(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${minSeverity === s ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {meta.fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs text-slate-400 mb-1.5">{f.label}</label>
            <input
              type={f.type || 'text'}
              value={config[f.key] || ''}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono outline-none focus:border-cyan-500"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl text-sm hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 transition-all"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Add Channel
        </button>
      </div>
    </div>
  );
}

function ChannelRow({ channel, onDelete, onToggle, onTest }: {
  channel: AlertChannel;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onTest: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);

  const meta = CHANNEL_META[channel.channel_type];

  const handleTest = async () => {
    setTesting(true);
    setTestOk(null);
    try {
      await onTest(channel.id);
      setTestOk(true);
    } catch {
      setTestOk(false);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${channel.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    onDelete(channel.id);
  };

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${channel.enabled ? 'border-slate-700/60' : 'border-slate-800 opacity-60'}`}>
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/40">
        <button onClick={() => onToggle(channel.id, !channel.enabled)} className="shrink-0">
          {channel.enabled
            ? <ToggleRight className="w-5 h-5 text-cyan-400" />
            : <ToggleLeft className="w-5 h-5 text-slate-500" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{channel.name}</span>
            <span className={`text-[11px] font-medium ${meta.color}`}>{meta.label}</span>
          </div>
          <span className={`text-xs ${SEV_COLORS[channel.min_severity]}`}>
            Triggers on: {channel.min_severity}+
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => void handleTest()}
            disabled={testing || !channel.enabled}
            title="Send test notification"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-slate-700/80 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white disabled:opacity-40 transition-colors"
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Test
          </button>
          {testOk === true && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {testOk === false && <AlertTriangle className="w-4 h-4 text-rose-400" />}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
            title="Delete channel"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setExpanded((e) => !e)} className="p-1.5 text-slate-500 hover:text-white transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-900/30">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Configuration</p>
          <div className="space-y-1">
            {Object.entries(channel.config).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 w-28 shrink-0">{k}</span>
                <span className="font-mono text-slate-300">{v || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AlertChannelsManager() {
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.alertChannels.list();
      if (!res.success || !res.data) throw new Error(res.error || 'Failed to load');
      setChannels(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (input: CreateAlertChannelInput) => {
    const res = await api.alertChannels.create(input);
    if (!res.success || !res.data) throw new Error(res.error || 'Failed to create');
    setChannels((prev) => [...prev, res.data!]);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await api.alertChannels.delete(id).catch(() => null);
    setChannels((prev) => prev.filter((c) => c.id !== id));
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setChannels((prev) => prev.map((c) => c.id === id ? { ...c, enabled } : c));
    await api.alertChannels.update(id, { enabled }).catch(() => load());
  };

  const handleTest = async (id: string) => {
    const res = await api.alertChannels.test(id);
    if (!res.success) throw new Error(res.error || 'Test failed');
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Alert Channels</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Notifications dispatched on incident creation — PagerDuty, Teams, Opsgenie, or email.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 rounded-xl hover:bg-cyan-500/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Channel
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      {showForm && (
        <ChannelForm
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && channels.length === 0 ? (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading channels…
        </div>
      ) : channels.length === 0 ? (
        <div className="text-xs text-slate-500 text-center py-8 bg-slate-900/30 rounded-xl border border-slate-700/50">
          No alert channels configured. Add one above to start receiving incident notifications.
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <ChannelRow
              key={ch.id}
              channel={ch}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onTest={handleTest}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        Channels fire in parallel on every new incident that meets the minimum severity threshold.
        Secrets are encrypted at rest.
      </p>
    </div>
  );
}
