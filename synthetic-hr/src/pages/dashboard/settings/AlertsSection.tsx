import { AlertTriangle, Bell, Check, CheckCircle2, ExternalLink, Mail, Phone, RefreshCw, Save, Send, Slack, Webhook } from 'lucide-react';
import type { NotificationRule, ReconciliationAlertConfigState, SeverityRoutingState } from './types';

export function AlertsSection({
  slackWebhook,
  setSlackWebhook,
  pagerdutyKey,
  setPagerdutyKey,
  alertEmail,
  setAlertEmail,
  saveChannelConfig,
  channelSaved,
  testingChannel,
  testChannel,
  applyAlertPreset,
  severityRouting,
  setSeverityRouting,
  reconciliationAlertConfig,
  setReconciliationAlertConfig,
  handleSaveReconciliationConfig,
  savingReconciliationConfig,
  notifications,
  setNotifications,
  handleSaveNotifications,
  savingNotifications,
}: {
  slackWebhook: string;
  setSlackWebhook: React.Dispatch<React.SetStateAction<string>>;
  pagerdutyKey: string;
  setPagerdutyKey: React.Dispatch<React.SetStateAction<string>>;
  alertEmail: string;
  setAlertEmail: React.Dispatch<React.SetStateAction<string>>;
  saveChannelConfig: () => void;
  channelSaved: boolean;
  testingChannel: 'slack' | 'pagerduty' | 'email' | null;
  testChannel: (channel: 'slack' | 'pagerduty' | 'email') => Promise<void>;
  applyAlertPreset: (preset: 'quiet' | 'balanced' | 'critical_only' | 'ops_heavy') => void;
  severityRouting: SeverityRoutingState;
  setSeverityRouting: React.Dispatch<React.SetStateAction<SeverityRoutingState>>;
  reconciliationAlertConfig: ReconciliationAlertConfigState;
  setReconciliationAlertConfig: React.Dispatch<React.SetStateAction<ReconciliationAlertConfigState>>;
  handleSaveReconciliationConfig: () => void;
  savingReconciliationConfig: boolean;
  notifications: NotificationRule[];
  setNotifications: React.Dispatch<React.SetStateAction<NotificationRule[]>>;
  handleSaveNotifications: () => void;
  savingNotifications: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Alerts</h2>
        <p className="text-slate-400 text-sm">Decide who gets interrupted, what goes where, and how noisy the workspace should be.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Slack', value: slackWebhook ? 'Configured' : 'Missing', note: 'Fast operator awareness', good: !!slackWebhook },
          { label: 'PagerDuty', value: pagerdutyKey ? 'Configured' : 'Missing', note: 'Critical escalation path', good: !!pagerdutyKey },
          { label: 'Email', value: alertEmail ? 'Configured' : 'Missing', note: 'Admin and digest delivery', good: !!alertEmail },
        ].map((item) => (
          <div key={item.label} className={`rounded-2xl border p-5 ${item.good ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-xl font-bold text-white">{item.value}</p>
            <p className="mt-1 text-sm text-slate-400">{item.note}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Alert Presets</h3>
          <p className="text-sm text-slate-400 mt-1">Apply a routing model first, then tune individual events below.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { id: 'quiet', title: 'Quiet', desc: 'Digest-heavy and low interruption.' },
            { id: 'balanced', title: 'Balanced', desc: 'Good default for most teams.' },
            { id: 'critical_only', title: 'Critical Only', desc: 'Only urgent incidents page people.' },
            { id: 'ops_heavy', title: 'Ops-heavy', desc: 'High visibility for active operators.' },
          ].map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyAlertPreset(preset.id as 'quiet' | 'balanced' | 'critical_only' | 'ops_heavy')}
              className="rounded-xl border border-slate-700 bg-slate-900/40 hover:border-cyan-500/30 hover:bg-slate-800/60 p-4 text-left transition-all"
            >
              <p className="text-sm font-semibold text-white">{preset.title}</p>
              <p className="mt-1 text-xs text-slate-400">{preset.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-white">Severity Routing</h3>
          <p className="text-sm text-slate-400 mt-1">Set default escalation behavior by severity before fine-tuning individual event rules.</p>
        </div>
        <div className="space-y-4">
          {([
            { key: 'critical', label: 'Critical', desc: 'Immediate operator interruption and escalation.' },
            { key: 'warning', label: 'Warning', desc: 'Needs attention, but not a paging event.' },
            { key: 'info', label: 'Info', desc: 'Digest or inbox-friendly updates.' },
          ] as const).map((level) => (
            <div key={level.key} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{level.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{level.desc}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-300">
                  {(['slack', 'email', 'pagerduty'] as const).map((channel) => (
                    <label key={channel} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={severityRouting[level.key][channel]}
                        onChange={(e) => setSeverityRouting((prev) => ({
                          ...prev,
                          [level.key]: { ...prev[level.key], [channel]: e.target.checked },
                        }))}
                        className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
                      />
                      <span className="capitalize">{channel}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Webhook className="w-4 h-4 text-cyan-400" /> Alert Channel Configuration
          </h3>
          <button
            onClick={saveChannelConfig}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${channelSaved
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/20'
              }`}
          >
            {channelSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {channelSaved ? 'Saved!' : 'Save Channels'}
          </button>
        </div>

        <p className="text-xs text-slate-400 -mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          These channels are required for Incidents escalation alerts to work. Without them, alerts will be silently skipped.
        </p>

        <div className="border border-slate-700/50 bg-slate-900/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 bg-[#4A154B]/30 border border-[#4A154B]/50 rounded-lg">
              <Webhook className="w-4 h-4 text-[#E01E5A]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Slack</p>
              <p className="text-xs text-slate-500">Incoming Webhook URL from your Slack app</p>
            </div>
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
              Setup guide <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex gap-2">
            <input
              id="slack-webhook-url"
              name="slack-webhook-url"
              type="url"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              className={`flex-1 px-3 py-2.5 bg-slate-800 border rounded-xl text-white text-sm font-mono outline-none focus:ring-1 transition-all ${slackWebhook ? 'border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/30'}`}
            />
            <button onClick={() => void testChannel('slack')} disabled={testingChannel === 'slack'} className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 disabled:opacity-50">
              {testingChannel === 'slack' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </button>
          </div>
          {slackWebhook && <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Slack webhook configured</p>}
          <p className="text-xs text-slate-500 border-t border-slate-800 pt-3">
            <Slack className="w-3 h-3 inline mr-1 text-[#4A154B]" />
            <strong className="text-slate-400">Incident &amp; approval alerts via Slack bot:</strong> Connect your Slack workspace in{' '}
            <button className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2" onClick={() => (window as any).__rasNavigate?.('apps')}>Apps → Slack</button>
            {' '}to enable rich Block Kit notifications. Set the <code className="text-slate-400">alert_channel_id</code> credential to specify the alerts channel.
          </p>
        </div>

        <div className="border border-slate-700/50 bg-slate-900/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 bg-[#06AC38]/20 border border-[#06AC38]/30 rounded-lg">
              <Phone className="w-4 h-4 text-[#06AC38]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">PagerDuty</p>
              <p className="text-xs text-slate-500">Events API v2 Integration / Routing Key</p>
            </div>
            <a href="https://developer.pagerduty.com/docs/ZG9jOjExMDI5NTgw-events-api-v2-overview" target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
              Setup guide <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex gap-2">
            <input
              id="pagerduty-routing-key"
              name="pagerduty-routing-key"
              type="password"
              value={pagerdutyKey}
              onChange={(e) => setPagerdutyKey(e.target.value)}
              placeholder="Enter your 32-character routing key..."
              className={`flex-1 px-3 py-2.5 bg-slate-800 border rounded-xl text-white text-sm font-mono outline-none focus:ring-1 transition-all ${pagerdutyKey ? 'border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/30'}`}
            />
            <button onClick={() => void testChannel('pagerduty')} disabled={testingChannel === 'pagerduty'} className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 disabled:opacity-50">
              {testingChannel === 'pagerduty' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </button>
          </div>
          {pagerdutyKey && <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> PagerDuty routing key configured</p>}
        </div>

        <div className="border border-slate-700/50 bg-slate-900/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 bg-blue-500/20 border border-blue-500/30 rounded-lg">
              <Mail className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Email Alerts</p>
              <p className="text-xs text-slate-500">Alert destination address (can differ from login email)</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              id="alert-email"
              name="alert-email"
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              placeholder="ops-team@yourcompany.com"
              className={`flex-1 px-3 py-2.5 bg-slate-800 border rounded-xl text-white text-sm outline-none focus:ring-1 transition-all ${alertEmail ? 'border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/30'}`}
            />
            <button onClick={() => void testChannel('email')} disabled={testingChannel === 'email'} className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 disabled:opacity-50">
              {testingChannel === 'email' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </button>
          </div>
          {alertEmail && <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Email configured</p>}
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-cyan-400" /> Reconciliation Alerts
            </h3>
            <p className="text-xs text-slate-500 mt-1">Control spend-drift thresholds and where reconciliation issues are delivered.</p>
          </div>
          <button onClick={handleSaveReconciliationConfig} disabled={savingReconciliationConfig} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/20 disabled:opacity-50">
            {savingReconciliationConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingReconciliationConfig ? 'Saving…' : 'Save Reconciliation Alerts'}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <input type="checkbox" checked={reconciliationAlertConfig.channels.inApp} onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, channels: { ...prev.channels, inApp: e.target.checked } }))} className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400" />
            <span className="text-sm text-white">In-app inbox and bell</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <input type="checkbox" checked={reconciliationAlertConfig.channels.email} onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, channels: { ...prev.channels, email: e.target.checked } }))} className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400" />
            <span className="text-sm text-white">Email admin operators</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <input type="checkbox" checked={reconciliationAlertConfig.channels.webhook} onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, channels: { ...prev.channels, webhook: e.target.checked } }))} className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400" />
            <span className="text-sm text-white">Subscribed webhooks</span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="settings-recon-absolute-gap" className="block text-sm font-medium text-slate-300">Absolute drift threshold (USD)</label>
            <input id="settings-recon-absolute-gap" type="number" min="0" step="0.01" value={reconciliationAlertConfig.thresholds.absoluteGapUsd} onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, thresholds: { ...prev.thresholds, absoluteGapUsd: Number(e.target.value) || 0 } }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
          </div>
          <div>
            <label htmlFor="settings-recon-relative-gap" className="block text-sm font-medium text-slate-300">Relative drift threshold (%)</label>
            <input id="settings-recon-relative-gap" type="number" min="0" max="100" step="1" value={Math.round(reconciliationAlertConfig.thresholds.relativeGapRatio * 100)} onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, thresholds: { ...prev.thresholds, relativeGapRatio: Math.max(0, Math.min(1, (Number(e.target.value) || 0) / 100)) } }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
          </div>
          <div>
            <label htmlFor="settings-recon-stale-hours" className="block text-sm font-medium text-slate-300">Stale sync threshold (hours)</label>
            <input id="settings-recon-stale-hours" type="number" min="1" step="1" value={reconciliationAlertConfig.thresholds.staleSyncHours} onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, thresholds: { ...prev.thresholds, staleSyncHours: Math.max(1, Number(e.target.value) || 1) } }))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-cyan-500" />
          </div>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-slate-300">
          These settings are shared with the Coverage page and control when reconciliation alerts appear in-app, send email, and fan out to webhook subscribers.
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 bg-slate-900/40 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-white">Event Routing Rules</h3>
          <p className="text-xs text-slate-500 mt-0.5">Choose which channels receive each event type.</p>
        </div>
        <div className="hidden sm:grid grid-cols-12 px-5 py-3 bg-slate-900/50 border-b border-slate-700/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="col-span-6">Event</div>
          <div className="col-span-2 text-center">Slack</div>
          <div className="col-span-2 text-center">Email</div>
          <div className="col-span-2 text-center">PagerDuty</div>
        </div>
        <div className="divide-y divide-slate-700/30">
          {notifications.map((rule) => (
            <div key={rule.id} className="grid grid-cols-1 sm:grid-cols-12 items-center px-5 py-4 hover:bg-slate-700/10 transition-colors gap-3 sm:gap-0">
              <div className="col-span-6">
                <p className="text-sm font-semibold text-white">{rule.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{rule.description}</p>
              </div>
              {(['slack', 'email', 'pagerduty'] as const).map((channel) => (
                <div key={channel} className="col-span-2 flex items-center justify-center sm:justify-center gap-2 sm:gap-0">
                  <span className="sm:hidden text-xs text-slate-400 capitalize">{channel}:</span>
                  <button
                    onClick={() => setNotifications((prev) => prev.map((n) => n.id === rule.id ? { ...n, channels: { ...n.channels, [channel]: !n.channels[channel] } } : n))}
                    className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${rule.channels[channel] ? 'bg-cyan-500' : 'bg-slate-700'}`}
                    style={{ height: '22px' }}
                  >
                    <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ transform: rule.channels[channel] ? 'translateX(18px)' : 'translateX(0)' }} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={handleSaveNotifications} disabled={savingNotifications} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20">
          {savingNotifications ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {savingNotifications ? 'Saving…' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
