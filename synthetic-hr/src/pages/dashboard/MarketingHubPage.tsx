import { useCallback, useEffect, useState } from 'react';
import {
  Megaphone, Mail, MessageSquare, Smartphone, Sparkles, RefreshCw,
  Plus, X, Check, Loader2, Users, TrendingUp, BarChart3, Database,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { authenticatedFetch } from '../../lib/api/_helpers';

type TabId = 'campaigns' | 'contacts' | 'performance';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function scoreBg(s: number | null | undefined) {
  if (s == null) return 'bg-slate-800/50 border-slate-700/40';
  if (s >= 70) return 'bg-emerald-500/15 border-emerald-500/30';
  if (s >= 40) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-rose-500/15 border-rose-500/30';
}
function scoreColor(s: number | null | undefined) {
  if (s == null) return 'text-slate-500';
  if (s >= 70) return 'text-emerald-400';
  if (s >= 40) return 'text-amber-400';
  return 'text-rose-400';
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  Email: Mail,
  WhatsApp: MessageSquare,
  SMS: Smartphone,
};

const CHANNEL_COLORS: Record<string, string> = {
  Email: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  WhatsApp: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  SMS: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  draft: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  completed: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
};

interface Campaign {
  id: string;
  name: string;
  channel: 'Email' | 'WhatsApp' | 'SMS';
  status: 'active' | 'draft' | 'paused' | 'completed';
  audience_size: number;
  engagement_score: number | null;
  created_at: string;
}

interface Contact {
  id: string;
  email: string;
  tags: string[];
  subscribed: boolean;
  source: string;
  created_at: string;
}

interface CampaignPerformance {
  campaign_id: string;
  campaign_name: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
}

async function listCampaigns(): Promise<Campaign[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/marketing/campaigns?limit=200');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

async function listContacts(): Promise<Contact[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/marketing/contacts?limit=200');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

async function listPerformance(): Promise<CampaignPerformance[]> {
  try {
    const res: any = await authenticatedFetch('/hubs/marketing/performance?limit=200');
    if (res.success && res.data) return res.data;
  } catch { /* no endpoint yet */ }
  return [];
}

async function scoreCampaignAll(): Promise<{ scored: number }> {
  const res: any = await authenticatedFetch('/hubs/marketing/score-all', { method: 'POST' });
  return res.data || { scored: 0 };
}

export default function MarketingHubPage() {
  const [tab, setTab] = useState<TabId>('campaigns');
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [performance, setPerformance] = useState<CampaignPerformance[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', channel: 'Email' as Campaign['channel'] });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [c, ct, p] = await Promise.all([listCampaigns(), listContacts(), listPerformance()]);
      setCampaigns(c);
      setContacts(ct);
      setPerformance(p);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, []);

  const handleScoreAll = async () => {
    setBusy(true);
    try {
      const r = await scoreCampaignAll();
      toast.success(`Scored ${r.scored} campaigns`);
      void load();
    } catch (e: any) { toast.error(e?.message || 'Scoring failed'); }
    finally { setBusy(false); }
  };

  const handleSeedDemo = async () => {
    setBusy(true);
    try {
      const res: any = await authenticatedFetch('/hubs/demo/generate', { method: 'POST', body: JSON.stringify({ hub: 'marketing' }) });
      if (res.success) { toast.success('Sample data loaded'); void load(); }
      else toast.error(res.error || 'Failed to load sample data');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const handleCreate = async () => {
    if (!newCampaign.name.trim()) return;
    setBusy(true);
    try {
      const res: any = await authenticatedFetch('/hubs/marketing/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name: newCampaign.name, channel: newCampaign.channel, status: 'draft', audience_size: 0 }),
      });
      if (res.success) { toast.success('Campaign created'); setShowCreate(false); setNewCampaign({ name: '', channel: 'Email' }); void load(); }
      else toast.error(res.error || 'Failed to create');
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="flex-none px-6 pt-6 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
              <Megaphone className="w-4 h-4 text-pink-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-100">Marketing Hub</h1>
              <p className="text-xs text-slate-500 mt-0.5">Campaigns, contacts, and performance analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={busy}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 text-xs transition-colors"
            >
              <RefreshCw className={cx('w-3.5 h-3.5', busy && 'animate-spin')} />
              Refresh
            </button>
            {tab === 'campaigns' && (
              <>
                <button
                  onClick={handleScoreAll}
                  disabled={busy || campaigns.length === 0}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-purple-500/30 text-purple-300 hover:bg-purple-500/10 text-xs transition-colors disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Score All
                </button>
                <button
                  onClick={() => setShowCreate(true)}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-pink-600/80 hover:bg-pink-600 text-white text-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Campaign
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors',
                tab === t.id
                  ? 'bg-white/[0.08] text-slate-100'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.id === 'campaigns' && campaigns.length > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 rounded-full bg-white/[0.08] text-slate-400">{campaigns.length}</span>
              )}
              {t.id === 'contacts' && contacts.length > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 rounded-full bg-white/[0.08] text-slate-400">{contacts.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Create Campaign Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-white/[0.1] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-100">New Campaign</h3>
                <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-300">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Campaign Name</label>
                  <input
                    className="w-full h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-pink-500/50"
                    placeholder="e.g. Q1 Re-engagement"
                    value={newCampaign.name}
                    onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Channel</label>
                  <select
                    className="w-full h-9 px-3 rounded-lg bg-slate-800 border border-white/[0.08] text-slate-100 text-sm focus:outline-none"
                    value={newCampaign.channel}
                    onChange={e => setNewCampaign(p => ({ ...p, channel: e.target.value as Campaign['channel'] }))}
                  >
                    <option value="Email">Email</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowCreate(false)} className="flex-1 h-9 rounded-lg border border-white/[0.08] text-slate-400 text-sm hover:text-slate-200 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={busy || !newCampaign.name.trim()}
                  className="flex-1 h-9 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Campaigns Tab */}
        {tab === 'campaigns' && (
          <>
            {campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-full bg-pink-500/10 flex items-center justify-center mb-4">
                  <Megaphone className="w-6 h-6 text-pink-400" />
                </div>
                <p className="text-slate-300 font-medium">No campaigns yet</p>
                <p className="text-slate-500 text-sm mt-1 max-w-xs">Create your first campaign to start reaching your audience via Email, WhatsApp, or SMS.</p>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => setShowCreate(true)}
                    className="h-9 px-4 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Campaign
                  </button>
                  <button
                    onClick={handleSeedDemo}
                    disabled={busy}
                    className="h-9 px-4 rounded-lg border border-white/[0.08] text-slate-400 hover:text-slate-200 text-sm transition-colors flex items-center gap-1.5"
                  >
                    <Database className="w-3.5 h-3.5" />
                    Load sample data
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Campaign</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Channel</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Audience</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Engagement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {campaigns.map(c => {
                      const ChannelIcon = CHANNEL_ICONS[c.channel] || Mail;
                      return (
                        <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-slate-200 font-medium">{c.name}</td>
                          <td className="px-4 py-3">
                            <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border', CHANNEL_COLORS[c.channel])}>
                              <ChannelIcon className="w-3 h-3" />
                              {c.channel}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cx('px-2 py-0.5 rounded-full text-xs border capitalize', STATUS_COLORS[c.status] || STATUS_COLORS.draft)}>
                              {c.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300 tabular-nums">
                            {c.audience_size.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {c.engagement_score != null ? (
                              <span className={cx('inline-block px-2 py-0.5 rounded-full text-xs border tabular-nums font-mono', scoreBg(c.engagement_score), scoreColor(c.engagement_score))}>
                                {c.engagement_score}
                              </span>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Contacts Tab */}
        {tab === 'contacts' && (
          <>
            {contacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-blue-400" />
                </div>
                <p className="text-slate-300 font-medium">No contacts yet</p>
                <p className="text-slate-500 text-sm mt-1 max-w-xs">Connect a marketing app like Mailchimp or Brevo to sync your contact list here.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tags</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Source</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {contacts.map(c => (
                      <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-slate-200 font-mono text-xs">{c.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {c.tags.map(t => (
                              <span key={t} className="px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 text-xs">{t}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs border bg-slate-700/30 text-slate-400 border-slate-600/30">{c.source}</span>
                        </td>
                        <td className="px-4 py-3">
                          {c.subscribed
                            ? <span className="text-emerald-400 text-xs">Subscribed</span>
                            : <span className="text-slate-500 text-xs">Unsubscribed</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Performance Tab */}
        {tab === 'performance' && (
          <>
            {performance.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-purple-400" />
                </div>
                <p className="text-slate-300 font-medium">No performance data yet</p>
                <p className="text-slate-500 text-sm mt-1 max-w-xs">Campaign send metrics will appear here once campaigns are active and sending.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Campaign</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Sent</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Delivered</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Opened</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Clicked</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">CTR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {performance.map(p => {
                      const ctr = p.sent > 0 ? ((p.clicked / p.sent) * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={p.campaign_id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-slate-200 font-medium">{p.campaign_name}</td>
                          <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{p.sent.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{p.delivered.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{p.opened.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{p.clicked.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={cx('text-xs font-mono', Number(ctr) >= 3 ? 'text-emerald-400' : Number(ctr) >= 1 ? 'text-amber-400' : 'text-slate-500')}>
                              {ctr}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
