import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Mail, Megaphone, MessageSquare, RefreshCw, Smartphone, Sparkles, Users } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import { authenticatedFetch } from '../../../../lib/api/_helpers';
import type { UnifiedApp } from '../types';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

type Campaign = {
  id: string;
  name: string;
  channel: 'Email' | 'WhatsApp' | 'SMS';
  status: 'active' | 'draft' | 'paused' | 'completed';
  audience_size: number;
  engagement_score: number | null;
  created_at: string;
};

type Contact = {
  id: string;
  email: string;
  tags: string[];
  subscribed: boolean;
  source: string;
  created_at: string;
};

type CampaignPerformance = {
  campaign_id: string;
  campaign_name: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  Email: Mail,
  WhatsApp: MessageSquare,
  SMS: Smartphone,
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  draft: 'bg-slate-600/20 text-slate-300 border-slate-600/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  completed: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
};

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

interface MarketingWorkspaceTabProps {
  app: UnifiedApp;
  agentNames: string[];
}

export function MarketingWorkspaceTab({ app, agentNames }: MarketingWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [performance, setPerformance] = useState<CampaignPerformance[]>([]);
  const [workspacePreview, setWorkspacePreview] = useState<any | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [campaignRes, contactRes, performanceRes, previewRes] = await Promise.all([
        authenticatedFetch<any>('/hubs/marketing/campaigns?limit=200'),
        authenticatedFetch<any>('/hubs/marketing/contacts?limit=200'),
        authenticatedFetch<any>('/hubs/marketing/performance?limit=200'),
        app.connected && app.primaryServiceId && ['mailchimp', 'brevo'].includes(String(app.primaryServiceId).toLowerCase())
          ? api.integrations.getWorkspacePreview(app.primaryServiceId)
          : Promise.resolve(null),
      ]);
      if (campaignRes.success && campaignRes.data) setCampaigns(campaignRes.data);
      if (contactRes.success && contactRes.data) setContacts(contactRes.data);
      if (performanceRes.success && performanceRes.data) setPerformance(performanceRes.data);
      if (previewRes?.success && previewRes.data) setWorkspacePreview(previewRes.data);
      else setWorkspacePreview(null);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load marketing workspace');
    } finally {
      setBusy(false);
    }
  }, [app.connected, app.primaryServiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCampaigns = useMemo(() => campaigns.filter((campaign) => campaign.status === 'active').length, [campaigns]);
  const reachableAudience = useMemo(() => campaigns.reduce((sum, campaign) => sum + Number(campaign.audience_size || 0), 0), [campaigns]);
  const topPerformance = useMemo(() => [...performance].sort((a, b) => (b.clicked || 0) - (a.clicked || 0)).slice(0, 6), [performance]);

  const handleScoreAll = async () => {
    try {
      const res: any = await authenticatedFetch('/hubs/marketing/score-all', { method: 'POST' });
      if (res.success) {
        toast.success(`Scored ${(res.data as any)?.scored || 0} campaigns`);
        await load();
      } else {
        toast.error(res.error || 'Scoring failed');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Scoring failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-pink-300">Marketing workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} campaign operations inside Rasi</h3>
            <p className="mt-1 text-sm text-slate-400">Watch active campaigns, audience health, and performance trends while agents help draft and monitor outreach safely.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-60"
            >
              <RefreshCw className={cx('h-3.5 w-3.5', busy && 'animate-spin')} />
              Refresh
            </button>
            <button
              onClick={() => void handleScoreAll()}
              disabled={busy || campaigns.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-pink-500/30 bg-pink-500/10 px-3 py-2 text-xs font-medium text-pink-200 hover:bg-pink-500/20 disabled:opacity-60"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Score All
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Campaigns</p>
            <p className="mt-2 text-2xl font-semibold text-white">{campaigns.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Active</p>
            <p className="mt-2 text-2xl font-semibold text-white">{activeCampaigns}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Audience</p>
            <p className="mt-2 text-2xl font-semibold text-white">{reachableAudience.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Linked agents</p>
            <p className="mt-2 text-2xl font-semibold text-white">{agentNames.length}</p>
          </div>
        </div>
        {agentNames.length > 0 && <p className="mt-3 text-xs text-slate-500">Linked agents: <span className="text-slate-300">{agentNames.join(', ')}</span></p>}
        {workspacePreview?.suggested_next_action ? (
          <p className="mt-2 text-xs text-cyan-300">Next: {workspacePreview.suggested_next_action}</p>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
          <div className="border-b border-white/8 px-4 py-3">
            <h4 className="text-sm font-semibold text-white">Campaign board</h4>
          </div>
          <div className="divide-y divide-white/6">
            {campaigns.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">No campaigns available.</div>
            ) : campaigns.slice(0, 10).map((campaign) => {
              const Icon = CHANNEL_ICONS[campaign.channel] || Megaphone;
              return (
                <div key={campaign.id} className="px-4 py-4">
                  <div className="flex items-start gap-4">
                    <div className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-full border', scoreBg(campaign.engagement_score))}>
                      <span className={cx('text-sm font-bold', scoreColor(campaign.engagement_score))}>{campaign.engagement_score ?? '—'}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{campaign.name}</p>
                        <span className={cx('rounded-full border px-2 py-0.5 text-[10px] uppercase', STATUS_COLORS[campaign.status])}>{campaign.status}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{campaign.channel}</span>
                        <span>{campaign.audience_size.toLocaleString()} audience</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {workspacePreview ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
              <div className="border-b border-white/8 px-4 py-3">
                <h4 className="text-sm font-semibold text-white">Connected marketing feed</h4>
              </div>
              <div className="space-y-3 px-4 py-4">
                {workspacePreview.metrics ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(workspacePreview.metrics).slice(0, 4).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-white/8 bg-[#121826] p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{key.replace(/_/g, ' ')}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.records) && workspacePreview.records.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider campaigns</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.records.slice(0, 5).map((record: any) => (
                        <div key={record.id} className="px-3 py-3">
                          <p className="text-sm font-medium text-white">{record.label}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span>{record.status}</span>
                            {record.meta ? <span>• {record.meta}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.audiences) && workspacePreview.audiences.length > 0 ? (
                  <div className="rounded-xl border border-white/8 bg-[#121826]">
                    <div className="border-b border-white/8 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Provider audiences</p>
                    </div>
                    <div className="divide-y divide-white/6">
                      {workspacePreview.audiences.slice(0, 5).map((audience: any) => (
                        <div key={audience.id} className="px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">{audience.name}</p>
                            <span className="text-xs text-cyan-300">{audience.members} members</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {Array.isArray(workspacePreview.notes) && workspacePreview.notes.length > 0 ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                    {workspacePreview.notes.join(' ')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Top performance</h4>
            </div>
            <div className="divide-y divide-white/6">
              {topPerformance.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-500">No performance data available.</div>
              ) : topPerformance.map((entry) => (
                <div key={entry.campaign_id} className="px-4 py-4">
                  <p className="font-medium text-white">{entry.campaign_name}</p>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-400">
                    <div><span className="block text-slate-500">Sent</span>{entry.sent}</div>
                    <div><span className="block text-slate-500">Delivered</span>{entry.delivered}</div>
                    <div><span className="block text-slate-500">Opened</span>{entry.opened}</div>
                    <div><span className="block text-slate-500">Clicked</span>{entry.clicked}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-300" />
              <h4 className="text-sm font-semibold text-white">Audience snapshot</h4>
            </div>
            <p className="mt-3 text-sm text-slate-400">Contacts and segmentation stay visible here so marketing agents can work from Rasi without losing context.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <div className="flex items-center gap-2 text-slate-300"><Users className="h-4 w-4 text-blue-300" />Contacts</div>
                <p className="mt-2 text-lg font-semibold text-white">{contacts.length}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
                <div className="flex items-center gap-2 text-slate-300"><BarChart3 className="h-4 w-4 text-pink-300" />Tracked campaigns</div>
                <p className="mt-2 text-lg font-semibold text-white">{performance.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
