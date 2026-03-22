import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Gavel,
  HandCoins,
  Headset,
  Key,
  Layers,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { api, type MarketplaceApp, type AppBundle, type SlackMessage } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import type { AIAgent } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorsPageProps {
  onNavigate?: (page: string) => void;
  agents?: AIAgent[];
}

type ConnectorSource = 'marketplace' | 'integration';

type UnifiedConnector = {
  id: string;
  name: string;
  description: string;
  category: string;
  source: ConnectorSource;
  logoLetter: string;
  colorHex: string;
  badge?: string;
  installCount: number;
  comingSoon: boolean;
  connected: boolean;
  status: 'connected' | 'syncing' | 'error' | 'expired' | 'disconnected';
  lastErrorMsg?: string | null;
  authType: 'free' | 'api_key' | 'oauth2';
  requiredFields?: Array<{ name: string; label: string; type: 'text' | 'password'; placeholder?: string; required: boolean }>;
  permissions?: string[];
  actionsUnlocked?: string[];
  setupTimeMinutes?: number;
  developer?: string;
  featured?: boolean;
  appData?: MarketplaceApp;
  integrationData?: any;
};

type ConnectionLog = {
  id: string;
  action: string;
  status: string;
  message: string | null;
  created_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; Icon: React.ElementType; color: string }> = {
  all:         { label: 'All',           Icon: ShoppingBag,      color: 'text-slate-400' },
  finance:     { label: 'Finance',       Icon: HandCoins,        color: 'text-rose-400' },
  support:     { label: 'Support',       Icon: Headset,          color: 'text-blue-400' },
  sales:       { label: 'Sales',         Icon: Building2,        color: 'text-emerald-400' },
  it:          { label: 'IT / Identity', Icon: Wrench,           color: 'text-amber-400' },
  compliance:  { label: 'Compliance',    Icon: Gavel,            color: 'text-sky-400' },
  recruitment: { label: 'Recruitment',   Icon: BriefcaseBusiness,color: 'text-violet-400' },
};

const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'alpha',   label: 'A–Z' },
  { value: 'recent',  label: 'Recently added' },
];

const TYPE_OPTIONS = [
  { value: 'all',         label: 'All types' },
  { value: 'marketplace', label: 'Apps' },
  { value: 'integration', label: 'Integrations' },
];

const BADGE_STYLE: Record<string, string> = {
  Popular:          'bg-blue-500/15 border-blue-400/25 text-blue-200',
  Verified:         'bg-emerald-500/15 border-emerald-400/25 text-emerald-200',
  'India Priority': 'bg-amber-500/15 border-amber-400/25 text-amber-200',
  New:              'bg-violet-500/15 border-violet-400/25 text-violet-200',
};

const INTENTS = [
  { id: 'hiring',     label: 'Hiring',            Icon: BriefcaseBusiness, color: '#7C3AED', bundleId: 'recruitment-stack' },
  { id: 'support',    label: 'Customer Support',  Icon: Headset,           color: '#2563EB', bundleId: 'support-stack' },
  { id: 'finance',    label: 'Finance & Payments',Icon: HandCoins,         color: '#DC2626', bundleId: 'finance-stack' },
  { id: 'sales',      label: 'Sales',             Icon: Building2,         color: '#059669', bundleId: 'sales-stack' },
  { id: 'it',         label: 'IT / Access',       Icon: Wrench,            color: '#D97706', bundleId: 'it-stack' },
  { id: 'compliance', label: 'Compliance',        Icon: Gavel,             color: '#0891B2', bundleId: 'compliance-stack' },
];

const BUNDLE_ICONS: Record<string, React.ElementType> = {
  BriefcaseBusiness, Building2, HandCoins, Headset, Wrench, Gavel,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashColor(s: string): string {
  const P = ['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#06B6D4','#EC4899','#6366F1','#84CC16','#F97316'];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return P[h % P.length];
}

function integrationColor(id: string, raw?: string): string {
  if (raw && /^#[0-9a-f]{3,6}$/i.test(raw)) return raw;
  const k = id.toLowerCase();
  if (k.includes('slack'))                              return '#4A154B';
  if (k.includes('linkedin'))                          return '#0A66C2';
  if (k.includes('google') || k.includes('gmail'))     return '#EA4335';
  if (k.includes('microsoft') || k.includes('teams'))  return '#0078D4';
  if (k.includes('hubspot'))                           return '#FF7A59';
  if (k.includes('jira') || k.includes('atlassian'))   return '#0052CC';
  if (k.includes('zendesk'))                           return '#03363D';
  if (k.includes('freshdesk'))                         return '#0070C0';
  if (k.includes('naukri'))                            return '#FF7555';
  if (k.includes('stripe'))                            return '#635BFF';
  if (k.includes('razorpay'))                          return '#2D81E0';
  if (k.includes('paytm'))                             return '#002970';
  return hashColor(id);
}

function fromApp(app: MarketplaceApp): UnifiedConnector {
  const status =
    app.connectionStatus === 'error'   ? 'error'
    : app.connectionStatus === 'expired' ? 'expired'
    : app.connectionStatus === 'syncing' ? 'syncing'
    : app.installed                      ? 'connected'
    : 'disconnected';
  return {
    id: `app:${app.id}`, name: app.name, description: app.description,
    category: app.category, source: 'marketplace',
    logoLetter: app.logoLetter, colorHex: app.colorHex,
    badge: app.badge, installCount: app.installCount,
    comingSoon: !!app.comingSoon, connected: !!app.installed,
    status, lastErrorMsg: app.lastErrorMsg,
    authType: app.installMethod, requiredFields: app.requiredFields,
    permissions: app.permissions, actionsUnlocked: app.actionsUnlocked,
    setupTimeMinutes: app.setupTimeMinutes, developer: app.developer,
    featured: app.featured, appData: app,
  };
}

function fromIntegration(row: any): UnifiedConnector {
  const raw = row.lifecycleStatus || row.status || 'disconnected';
  const status =
    raw === 'connected'                      ? 'connected'
    : raw === 'syncing'                      ? 'syncing'
    : raw === 'error'                        ? 'error'
    : raw === 'expired' || row.tokenExpired  ? 'expired'
    : 'disconnected';
  return {
    id: `int:${row.id}`, name: row.name, description: row.description || '',
    category: row.category || 'it', source: 'integration',
    logoLetter: (row.name || '?')[0].toUpperCase(),
    colorHex: integrationColor(row.id, row.color),
    badge: row.specStatus === 'COMING_SOON' ? undefined : row.badge,
    installCount: 0, comingSoon: row.specStatus === 'COMING_SOON',
    connected: status === 'connected', status, lastErrorMsg: row.lastErrorMsg,
    authType: row.authType === 'oauth2' ? 'oauth2' : 'api_key',
    requiredFields: row.requiredFields,
    permissions: row.capabilities?.reads?.map((r: string) => `Read: ${r}`) || [],
    actionsUnlocked: row.capabilities?.writes?.map((w: any) => w.label) || [],
    integrationData: row,
  };
}

function fmtDate(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString();
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [ref, cb]);
}

// ─── Shared small components ──────────────────────────────────────────────────

function ConnectorLogo({ connector, size = 'md' }: { connector: UnifiedConnector; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-8 h-8 text-xs rounded-xl'
    : size === 'lg' ? 'w-14 h-14 text-xl rounded-2xl'
    : 'w-10 h-10 text-sm rounded-xl';
  return (
    <div className={cn('flex items-center justify-center shrink-0 font-bold text-white shadow-sm', dim)} style={{ backgroundColor: connector.colorHex }}>
      {connector.logoLetter}
    </div>
  );
}

function SetupTimePill({ minutes }: { minutes: number }) {
  const c = minutes <= 3 ? 'text-emerald-300 border-emerald-400/20 bg-emerald-500/10'
    : minutes <= 6 ? 'text-amber-300 border-amber-400/20 bg-amber-500/10'
    : 'text-slate-400 border-white/10 bg-white/5';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-medium', c)}>
      <Clock className="w-2.5 h-2.5" />~{minutes} min
    </span>
  );
}

// ─── App Connect Modal ────────────────────────────────────────────────────────

function AppConnectModal({ connector, mode, onClose, onDone }: {
  connector: UnifiedConnector; mode: 'connect' | 'configure';
  onClose: () => void; onDone: (id: string) => void;
}) {
  const app = connector.appData!;
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.marketplace.install(app.id, creds);
      if (!res.success) throw new Error((res as any).error || 'Failed');
      if ((res.data as any)?.oauth) {
        toast.info(`Redirecting to ${app.name} for authorization…`);
      } else {
        toast.success(mode === 'configure' ? `${app.name} credentials updated` : `${app.name} connected`);
      }
      onDone(connector.id);
    } catch (e: any) { toast.error(e.message || 'Connection failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between p-6 border-b border-white/8">
          <div className="flex items-center gap-4">
            <ConnectorLogo connector={connector} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-bold text-white">{connector.name}</p>
                {connector.badge && (
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', BADGE_STYLE[connector.badge] || BADGE_STYLE['Verified'])}>{connector.badge}</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">by {connector.developer}</p>
              <div className="flex items-center gap-2 mt-1.5">
                {connector.setupTimeMinutes != null && <SetupTimePill minutes={connector.setupTimeMinutes} />}
                <span className="text-xs text-slate-500">{connector.installCount.toLocaleString()} installs</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-5 max-h-[55vh] overflow-y-auto">
          <p className="text-sm text-slate-300 leading-relaxed">{connector.description}</p>
          {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-300" /> Actions Unlocked</p>
              <div className="flex flex-wrap gap-1.5">
                {connector.actionsUnlocked.map((a) => <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>)}
              </div>
            </div>
          )}
          {connector.permissions && connector.permissions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Shield className="w-3 h-3" /> Permissions</p>
              <ul className="space-y-1.5">
                {connector.permissions.map((p) => <li key={p} className="flex items-start gap-2 text-xs text-slate-300"><CheckCircle2 className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />{p}</li>)}
              </ul>
            </div>
          )}
          {connector.authType === 'api_key' && connector.requiredFields && connector.requiredFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Key className="w-3 h-3" /> {mode === 'configure' ? 'Update Credentials' : 'Credentials'}</p>
              <div className="space-y-3">
                {connector.requiredFields.map((f) => (
                  <div key={f.name}>
                    <label className="block text-xs text-slate-400 mb-1.5">{f.label}{f.required && <span className="text-rose-400 ml-0.5">*</span>}</label>
                    <input type={f.type} placeholder={f.placeholder} value={creds[f.name] || ''} onChange={(e) => setCreds((p) => ({ ...p, [f.name]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm font-mono" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {connector.authType === 'oauth2' && (
            <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3 flex items-start gap-3">
              <ExternalLink className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">You'll be redirected to <strong className="text-white">{connector.developer}</strong> to authorize access.</p>
            </div>
          )}
          {connector.authType === 'free' && (
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">No credentials required — connects instantly.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 p-6 border-t border-white/8">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" />{mode === 'configure' ? 'Saving…' : 'Connecting…'}</> : connector.authType === 'oauth2' ? <><ExternalLink className="w-4 h-4" />Authorize with {connector.name}</> : mode === 'configure' ? <><Key className="w-4 h-4" />Update credentials</> : <><Zap className="w-4 h-4" />Connect</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Integration Connect Modal ────────────────────────────────────────────────

function IntegrationConnectModal({ connector, mode, onClose, onDone }: {
  connector: UnifiedConnector; mode: 'connect' | 'configure';
  onClose: () => void; onDone: (id: string) => void;
}) {
  const row = connector.integrationData;
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (connector.authType === 'oauth2') {
        const res = await api.integrations.initOAuth(row.id, '/dashboard/connectors', {}, false);
        if (res.success && (res.data as any)?.url) { window.location.href = (res.data as any).url; return; }
        throw new Error((res as any).error || 'OAuth init failed');
      } else {
        const fn = mode === 'configure' ? api.integrations.configure : api.integrations.connect;
        const res = await fn(row.id, creds);
        if (!res.success) throw new Error((res as any).error || 'Failed');
        toast.success(mode === 'configure' ? `${connector.name} credentials updated` : `${connector.name} connected`);
        onDone(connector.id);
      }
    } catch (e: any) { toast.error(e.message || 'Connection failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between p-6 border-b border-white/8">
          <div className="flex items-center gap-4">
            <ConnectorLogo connector={connector} />
            <div>
              <p className="text-base font-bold text-white">{connector.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{connector.authType === 'oauth2' ? 'OAuth 2.0' : 'API Key'} · {connector.category}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-5 max-h-[55vh] overflow-y-auto">
          {connector.description && <p className="text-sm text-slate-300 leading-relaxed">{connector.description}</p>}
          {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-300" /> Actions Unlocked</p>
              <div className="flex flex-wrap gap-1.5">
                {connector.actionsUnlocked.map((a) => <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>)}
              </div>
            </div>
          )}
          {connector.authType === 'api_key' && connector.requiredFields && connector.requiredFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Key className="w-3 h-3" /> {mode === 'configure' ? 'Update Credentials' : 'Credentials'}</p>
              <div className="space-y-3">
                {connector.requiredFields.map((f) => (
                  <div key={f.name}>
                    <label className="block text-xs text-slate-400 mb-1.5">{f.label}{f.required && <span className="text-rose-400 ml-0.5">*</span>}</label>
                    <input type={f.type} placeholder={f.placeholder} value={creds[f.name] || ''} onChange={(e) => setCreds((p) => ({ ...p, [f.name]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm font-mono" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {connector.authType === 'oauth2' && (
            <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3 flex items-start gap-3">
              <ExternalLink className="w-4 h-4 text-blue-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">You'll be redirected to <strong className="text-white">{connector.name}</strong> to authorize. You'll return here after.</p>
            </div>
          )}
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-start gap-3">
            <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400">All actions are governed by your <strong className="text-slate-300">Action Policies</strong> with full incident detection and audit logging.</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 p-6 border-t border-white/8">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" />{connector.authType === 'oauth2' ? 'Redirecting…' : mode === 'configure' ? 'Saving…' : 'Connecting…'}</> : connector.authType === 'oauth2' ? <><ExternalLink className="w-4 h-4" />Authorize with {connector.name}</> : mode === 'configure' ? <><Key className="w-4 h-4" />Update credentials</> : <><Zap className="w-4 h-4" />Connect</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function SlackTab({ serviceId }: { serviceId: string }) {
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [filter, setFilter] = useState<'all' | SlackMessage['status']>('all');
  const [loading, setLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.slack.getMessages(filter === 'all' ? {} : { status: filter });
    if (res.success) setMessages((res.data as SlackMessage[]) || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const sendReply = async (id: string) => {
    if (!replyText.trim()) return;
    setReplying(true);
    const res = await api.slack.reply(id, replyText.trim());
    if (res.success) {
      toast.success('Reply sent');
      setMessages((p) => p.map((m) => m.id === id ? { ...m, status: 'replied' } : m));
      setReplyTarget(null); setReplyText('');
    } else { toast.error((res as any).error || 'Failed to send'); }
    setReplying(false);
  };

  const updateStatus = async (id: string, status: SlackMessage['status']) => {
    const res = await api.slack.updateStatus(id, status);
    if (res.success) setMessages((p) => p.map((m) => m.id === id ? { ...m, status } : m));
  };

  const FILTERS: Array<{ value: typeof filter; label: string }> = [
    { value: 'all', label: 'All' }, { value: 'new', label: 'New' },
    { value: 'reviewed', label: 'Reviewed' }, { value: 'replied', label: 'Replied' }, { value: 'dismissed', label: 'Dismissed' },
  ];

  const STATUS_COLOR: Record<SlackMessage['status'], string> = {
    new:       'border-blue-400/20 bg-blue-500/10 text-blue-200',
    reviewed:  'border-white/10 bg-white/5 text-slate-300',
    replied:   'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    dismissed: 'border-white/5 bg-white/[0.03] text-slate-500',
  };

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(({ value, label }) => (
          <button key={value} onClick={() => setFilter(value)}
            className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-colors', filter === value ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5')}>
            {label}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors" title="Refresh">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
      ) : messages.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No {filter === 'all' ? '' : filter} messages.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div key={msg.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <User className="w-3 h-3 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-slate-300">{msg.slack_user_name || 'User'}</span>
                    {msg.slack_channel_name && <span className="text-[10px] text-slate-500 ml-1.5">#{msg.slack_channel_name}</span>}
                  </div>
                </div>
                <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-medium', STATUS_COLOR[msg.status])}>
                  {msg.status}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{msg.text}</p>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-slate-600">{fmtDate(msg.created_at)}</span>
                <div className="flex gap-1 ml-auto">
                  {msg.status === 'new' && (
                    <button onClick={() => updateStatus(msg.id, 'reviewed')} className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-white transition-colors">
                      Mark reviewed
                    </button>
                  )}
                  {msg.status !== 'dismissed' && (
                    <button onClick={() => updateStatus(msg.id, 'dismissed')} className="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-rose-300 transition-colors">
                      Dismiss
                    </button>
                  )}
                  <button onClick={() => setReplyTarget(replyTarget === msg.id ? null : msg.id)} className="text-[10px] px-2 py-0.5 rounded-md border border-blue-400/20 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors">
                    Reply
                  </button>
                </div>
              </div>
              {replyTarget === msg.id && (
                <div className="flex items-center gap-2 pt-1">
                  <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendReply(msg.id); } }}
                    placeholder="Type a reply…"
                    className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-600 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  <button onClick={() => void sendReply(msg.id)} disabled={replying || !replyText.trim()} className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                    {replying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailDrawer({ connector, agents, onClose, onConfigure, onDisconnect }: {
  connector: UnifiedConnector;
  agents: AIAgent[];
  onClose: () => void;
  onConfigure: (c: UnifiedConnector) => void;
  onDisconnect: (c: UnifiedConnector) => void;
}) {
  type Tab = 'overview' | 'agents' | 'logs' | 'actions' | 'slack';
  const isSlack = connector.source === 'integration' && connector.integrationData?.id?.toLowerCase().includes('slack');
  const [tab, setTab] = useState<Tab>('overview');
  const [logs, setLogs] = useState<ConnectionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [agentLinkBusy, setAgentLinkBusy] = useState<string | null>(null);
  // Local linked-agent set so toggling re-renders immediately without waiting for parent reload
  const [linkedAgentIds, setLinkedAgentIds] = useState<Set<string>>(() => {
    const rawId = connector.source === 'marketplace' ? connector.appData?.id : connector.integrationData?.id;
    if (!rawId) return new Set();
    return new Set(agents.filter((a) => (a.integrationIds || []).includes(rawId)).map((a) => a.id));
  });

  // The raw connector id used in integration_ids (e.g. "salesforce", "zendesk")
  const rawConnectorId = connector.source === 'marketplace'
    ? connector.appData?.id
    : connector.integrationData?.id;

  const agentNames = useMemo(() => {
    if (connector.source === 'marketplace' && connector.appData) {
      const ids = new Set(connector.appData.relatedAgentIds);
      return agents.filter((a) => ids.has(a.id)).map((a) => a.name);
    }
    if (connector.source === 'integration') {
      const sid = connector.integrationData?.id;
      return agents.filter((a) => a.integrationIds?.includes(sid)).map((a) => a.name);
    }
    return [];
  }, [connector, agents]);

  const loadLogs = useCallback(async () => {
    if (connector.source !== 'integration') return;
    setLogsLoading(true);
    const res = await api.integrations.getLogs(connector.integrationData.id, 20);
    if (res.success) setLogs((res.data as ConnectionLog[]) || []);
    setLogsLoading(false);
  }, [connector]);

  const toActionLabel = (name: string) =>
    name.split('__').pop()!.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const loadCatalog = useCallback(async () => {
    if (!rawConnectorId) return;
    setCatalogLoading(true);

    if (connector.source === 'marketplace') {
      // Pull live tool schemas from the ACTION_REGISTRY endpoint
      const res = await api.unifiedConnectors.getActions(rawConnectorId);
      if (res.success) {
        const tools = (res.data as any[]) || [];
        const items = tools.map((t: any) => ({
          action: t.function?.name?.split('__').pop() ?? t.function?.name,
          label: toActionLabel(t.function?.name ?? ''),
          description: t.function?.description,
          enabled: true,
          service: rawConnectorId,
        }));
        setCatalog(items);
      }
    } else {
      // Legacy integration connector: use action_policies table
      const res = await api.integrations.getActionCatalog();
      if (res.success) {
        const sid = connector.integrationData?.id;
        const items = ((res.data as any[]) || []).filter((a) => !sid || a.service === sid || !a.service);
        setCatalog(items);
      }
    }

    setCatalogLoading(false);
  }, [connector, rawConnectorId]);

  useEffect(() => {
    if (tab === 'logs') void loadLogs();
    if (tab === 'actions') void loadCatalog();
  }, [tab, loadLogs, loadCatalog]);

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await api.integrations.test(connector.integrationData.id);
      setTestResult({ ok: !!res.success, msg: res.success ? 'Connection is healthy' : ((res as any).error || 'Test failed') });
    } catch { setTestResult({ ok: false, msg: 'Test failed' }); }
    setTesting(false);
  };

  const refreshToken = async () => {
    setRefreshing(true);
    const res = await api.integrations.refresh(connector.integrationData.id);
    if (res.success) toast.success('Token refreshed');
    else toast.error((res as any).error || 'Refresh failed');
    setRefreshing(false);
  };

  const toggleAction = async (item: any) => {
    const res = await api.integrations.upsertActions([{ service: item.service || connector.integrationData?.id, action: item.action, enabled: !item.enabled }]);
    if (res.success) setCatalog((p) => p.map((a) => a.action === item.action ? { ...a, enabled: !a.enabled } : a));
    else toast.error('Failed to update action');
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    await onDisconnect(connector);
    setDisconnecting(false);
    onClose();
  };

  const handleUninstall = async () => {
    setUninstalling(true);
    try {
      const res = await api.marketplace.uninstall(connector.appData!.id);
      if (!res.success) throw new Error((res as any).error);
      toast.success(`${connector.name} removed`);
      onClose();
    } catch (e: any) { toast.error(e.message || 'Remove failed'); }
    setUninstalling(false);
  };

  const row = connector.integrationData;
  const hasError = connector.status === 'error' || connector.status === 'expired';

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    ...(connector.connected ? [{ id: 'agents' as Tab, label: `Agents (${linkedAgentIds.size})` }] : []),
    ...(connector.source === 'integration' && connector.connected ? [{ id: 'logs' as Tab, label: 'Logs' }] : []),
    ...(rawConnectorId ? [{ id: 'actions' as Tab, label: 'Actions' }] : []),
    ...(isSlack && connector.connected ? [{ id: 'slack' as Tab, label: 'Slack Inbox' }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button className="flex-1 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />

      {/* Panel */}
      <div className="w-[480px] max-w-[95vw] h-full bg-[#0e1117] border-l border-white/10 flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-4 p-5 border-b border-white/8 shrink-0">
          <ConnectorLogo connector={connector} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-bold text-white">{connector.name}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-500 font-medium">
                {connector.source === 'marketplace' ? 'App' : 'Integration'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {connector.status === 'connected' && <span className="text-xs font-medium text-emerald-400">Connected</span>}
              {connector.status === 'syncing' && <span className="flex items-center gap-1 text-xs text-amber-300 font-medium"><Loader2 className="w-3 h-3 animate-spin" />Syncing</span>}
              {(connector.status === 'error' || connector.status === 'expired') && (
                <span className="flex items-center gap-1 text-xs text-rose-300 font-medium"><AlertCircle className="w-3 h-3" />{connector.status === 'expired' ? 'Token expired' : 'Error'}</span>
              )}
              {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-slate-500"><Zap className="w-3 h-3 text-amber-400" />{connector.actionsUnlocked.length} actions</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-5 py-3 border-b border-white/8 shrink-0">
          {connector.connected ? (
            <>
              <button onClick={() => onConfigure(connector)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors">
                <Key className="w-3.5 h-3.5" />{connector.authType === 'oauth2' ? 'Reauthorize' : 'Update credentials'}
              </button>
              {connector.source === 'integration' && connector.connected && (
                <button onClick={testConnection} disabled={testing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50">
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}Test
                </button>
              )}
              {connector.source === 'integration' && connector.authType === 'oauth2' && (
                <button onClick={refreshToken} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50">
                  {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}Refresh token
                </button>
              )}
            </>
          ) : (
            <button onClick={() => onConfigure(connector)} className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors">
              <Zap className="w-3.5 h-3.5" />Connect
            </button>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn('mx-5 mt-3 px-3 py-2 rounded-xl border text-xs', testResult.ok ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' : 'border-rose-400/20 bg-rose-500/10 text-rose-200')}>
            {testResult.msg}
          </div>
        )}

        {/* Tabs */}
        {TABS.length > 1 && (
          <div className="flex gap-1 px-5 pt-3 shrink-0">
            {TABS.map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', tab === id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5')}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── OVERVIEW TAB ── */}
          {tab === 'overview' && (
            <>
              {connector.description && <p className="text-sm text-slate-300 leading-relaxed">{connector.description}</p>}

              {/* Agents using this */}
              {agentNames.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Bot className="w-3 h-3" /> Used by</p>
                  <div className="flex flex-wrap gap-1.5">
                    {agentNames.map((n) => <span key={n} className="text-xs px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-slate-300">{n}</span>)}
                  </div>
                </div>
              )}

              {/* Actions unlocked */}
              {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-300" /> Actions Unlocked</p>
                  <div className="flex flex-wrap gap-1.5">
                    {connector.actionsUnlocked.map((a) => <span key={a} className="text-xs px-2 py-1 rounded-lg border border-amber-400/15 bg-amber-500/8 text-amber-200">{a}</span>)}
                  </div>
                </div>
              )}

              {/* Permissions */}
              {connector.permissions && connector.permissions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Shield className="w-3 h-3" /> Permissions</p>
                  <ul className="space-y-1.5">
                    {connector.permissions.map((p) => <li key={p} className="flex items-start gap-2 text-xs text-slate-300"><CheckCircle2 className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />{p}</li>)}
                  </ul>
                </div>
              )}

              {/* Integration-specific: token expiry + OAuth readiness */}
              {connector.source === 'integration' && row && (
                <>
                  {row.tokenExpiresAt && (
                    <div className={cn('rounded-xl border px-4 py-3', row.tokenExpired || row.tokenExpiresSoon ? 'border-amber-400/20 bg-amber-500/[0.05]' : 'border-white/8 bg-white/[0.02]')}>
                      <p className="text-xs font-semibold text-slate-400 mb-1">Token Expiry</p>
                      <p className={cn('text-xs', row.tokenExpired ? 'text-rose-300' : row.tokenExpiresSoon ? 'text-amber-300' : 'text-slate-300')}>
                        {row.tokenExpired ? 'Expired' : row.tokenExpiresSoon ? 'Expiring soon' : 'Valid'} · {fmtDate(row.tokenExpiresAt)}
                      </p>
                    </div>
                  )}
                  {row.readiness?.items?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Setup Checklist</p>
                      <div className="space-y-1.5">
                        {row.readiness.items.map((item: any) => (
                          <div key={item.id} className="flex items-start gap-2">
                            <span className={cn('mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                              item.status === 'ok' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                              : item.status === 'blocked' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                              : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                            )}>{item.status}</span>
                            <div className="min-w-0">
                              <p className="text-xs text-slate-300">{item.label}</p>
                              {item.detail && <p className="text-[10px] text-slate-500 mt-0.5">{item.detail}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* App-specific: install stats */}
              {connector.source === 'marketplace' && (
                <div className="grid grid-cols-2 gap-2">
                  {connector.developer && (
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                      <p className="text-[10px] text-slate-500 mb-0.5">Developer</p>
                      <p className="text-xs text-slate-200 font-medium">{connector.developer}</p>
                    </div>
                  )}
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                    <p className="text-[10px] text-slate-500 mb-0.5">Installs</p>
                    <p className="text-xs text-slate-200 font-medium">{connector.installCount.toLocaleString()}</p>
                  </div>
                  {connector.setupTimeMinutes != null && (
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                      <p className="text-[10px] text-slate-500 mb-0.5">Setup time</p>
                      <p className="text-xs text-slate-200 font-medium">~{connector.setupTimeMinutes} min</p>
                    </div>
                  )}
                </div>
              )}

              {/* Error detail */}
              {connector.lastErrorMsg && (
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/[0.05] px-4 py-3">
                  <p className="text-xs font-semibold text-rose-300 mb-1">Last error</p>
                  <p className="text-xs text-slate-300 font-mono break-all">{connector.lastErrorMsg}</p>
                </div>
              )}

              {/* Governance note */}
              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-start gap-3">
                <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-400">All actions governed by <strong className="text-slate-300">Action Policies</strong> with incident detection + audit logging.</p>
              </div>

              {/* Danger zone */}
              <div className="pt-2 border-t border-white/8">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Danger zone</p>
                {connector.source === 'marketplace' ? (
                  <button onClick={handleUninstall} disabled={uninstalling} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/[0.05] text-rose-400 hover:bg-rose-500/10 text-xs font-medium transition-colors disabled:opacity-50">
                    {uninstalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}Remove app
                  </button>
                ) : (
                  <button onClick={handleDisconnect} disabled={disconnecting} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-400/20 bg-rose-500/[0.05] text-rose-400 hover:bg-rose-500/10 text-xs font-medium transition-colors disabled:opacity-50">
                    {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}Disconnect
                  </button>
                )}
              </div>
            </>
          )}

          {/* ── AGENTS TAB ── */}
          {tab === 'agents' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">Toggle which agents can use this connector. Linked agents will have these tools available during conversations.</p>
              {agents.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">No agents in your workspace yet.</p>
              ) : (
                agents.map((agent) => {
                  const isLinked = linkedAgentIds.has(agent.id);
                  const isBusy = agentLinkBusy === agent.id;

                  const toggleLink = async () => {
                    if (!rawConnectorId) return;
                    setAgentLinkBusy(agent.id);
                    try {
                      const currentIds: string[] = agent.integrationIds || [];
                      const newIds = isLinked
                        ? currentIds.filter((id) => id !== rawConnectorId)
                        : [...new Set([...currentIds, rawConnectorId])];
                      const res = await api.unifiedConnectors.updateAgentConnectors(agent.id, newIds);
                      if (res.success) {
                        setLinkedAgentIds((prev) => {
                          const next = new Set(prev);
                          if (isLinked) next.delete(agent.id); else next.add(agent.id);
                          return next;
                        });
                        toast.success(isLinked ? `Unlinked from ${agent.name}` : `Linked to ${agent.name}`);
                      } else {
                        toast.error((res as any).error || 'Failed to update');
                      }
                    } catch { toast.error('Failed to update'); }
                    finally { setAgentLinkBusy(null); }
                  };

                  return (
                    <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                      <div className="w-7 h-7 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
                        <Bot className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">{agent.name}</p>
                        <p className="text-[10px] text-slate-500">{agent.agent_type || 'agent'}</p>
                      </div>
                      <button
                        onClick={() => void toggleLink()}
                        disabled={isBusy || !rawConnectorId}
                        className={cn('shrink-0 w-9 h-5 rounded-full transition-colors relative disabled:opacity-50', isLinked ? 'bg-emerald-500' : 'bg-white/10')}
                      >
                        {isBusy
                          ? <Loader2 className="w-3 h-3 text-white animate-spin absolute top-1 left-3" />
                          : <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', isLinked ? 'translate-x-4' : 'translate-x-0.5')} />
                        }
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── LOGS TAB ── */}
          {tab === 'logs' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-400">Last 20 connection events</p>
                <button onClick={() => void loadLogs()} className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
              {logsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
              ) : logs.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">No logs yet.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md border font-medium',
                        log.status === 'success' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                        : log.status === 'error' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                        : 'border-white/10 bg-white/5 text-slate-300'
                      )}>{log.status}</span>
                      <p className="text-xs text-slate-300 flex-1 truncate">{log.action}</p>
                      <p className="text-[10px] text-slate-600 shrink-0">{fmtDate(log.created_at)}</p>
                    </div>
                    {log.message && <p className="text-[11px] text-slate-500 mt-1 font-mono">{log.message}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── ACTIONS TAB ── */}
          {tab === 'actions' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 mb-3">Toggle which actions agents can perform through this connector.</p>
              {catalogLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 text-slate-500 animate-spin" /></div>
              ) : catalog.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">No actions defined for this connector.</p>
              ) : (
                catalog.map((item, i) => (
                  <div key={item.id || item.action || i} className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200">{item.label || item.action}</p>
                      {item.description && <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>}
                      {item.risk && (
                        <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded-md border mt-1 font-medium',
                          item.risk === 'high' || item.risk === 'money' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
                          : item.risk === 'medium' ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
                          : 'border-white/10 bg-white/5 text-slate-300'
                        )}>{item.risk} risk</span>
                      )}
                    </div>
                    <button
                      onClick={() => void toggleAction(item)}
                      className={cn('shrink-0 w-9 h-5 rounded-full transition-colors relative', item.enabled ? 'bg-emerald-500' : 'bg-white/10')}
                    >
                      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', item.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── SLACK TAB ── */}
          {tab === 'slack' && connector.integrationData && (
            <SlackTab serviceId={connector.integrationData.id} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Bundle Card (Browse Modal) ───────────────────────────────────────────────

function BundleCard({ bundle, apps, onInstallAll }: {
  bundle: AppBundle; apps: MarketplaceApp[];
  onInstallAll: (b: AppBundle) => void;
}) {
  const BundleIcon = BUNDLE_ICONS[bundle.icon] || Layers;
  const bundleApps = apps.filter((a) => bundle.appIds.includes(a.id));
  const allDone = bundleApps.length > 0 && bundleApps.every((a) => a.installed);
  const doneCount = bundleApps.filter((a) => a.installed).length;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 flex flex-col gap-3 min-w-[260px] max-w-[300px] shrink-0">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: bundle.colorHex + '25', border: `1px solid ${bundle.colorHex}40` }}>
          <BundleIcon className="w-4.5 h-4.5" style={{ color: bundle.colorHex }} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">{bundle.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{bundle.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {bundleApps.map((app) => (
          <div key={app.id} title={app.name} className={cn('w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0', app.installed && 'ring-2 ring-emerald-400/40')} style={{ backgroundColor: app.colorHex }}>
            {app.logoLetter}
          </div>
        ))}
        <span className="text-[10px] text-slate-500 ml-1">{bundleApps.length} apps</span>
      </div>
      {allDone ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-medium"><CheckCircle2 className="w-3.5 h-3.5" />All added</div>
      ) : (
        <button onClick={() => onInstallAll(bundle)} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border"
          style={{ borderColor: bundle.colorHex + '40', backgroundColor: bundle.colorHex + '15', color: bundle.colorHex }}>
          {doneCount > 0 ? `Add remaining ${bundleApps.length - doneCount}` : 'Install stack'}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Browse Modal ─────────────────────────────────────────────────────────────

function BrowseModal({ connectors, apps, bundles, agents, onClose, onConnect, onManage, initialCategory }: {
  connectors: UnifiedConnector[];
  apps: MarketplaceApp[];
  bundles: AppBundle[];
  agents: AIAgent[];
  onClose: () => void;
  onConnect: (c: UnifiedConnector) => void;
  onManage: (c: UnifiedConnector) => void;
  initialCategory?: string;
}) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('popular');
  const [filterType, setFilterType] = useState<'all' | 'marketplace' | 'integration'>('all');
  const [filterCategory, setFilterCategory] = useState(initialCategory && CATEGORY_META[initialCategory] ? initialCategory : 'all');
  const [activeDropdown, setActiveDropdown] = useState<'sort' | 'type' | 'cat' | null>(null);
  const [intentDone, setIntentDone] = useState(connectors.some((c) => c.connected));
  const [highlightBundle, setHighlightBundle] = useState<string | null>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  useOutsideClick(filtersRef, () => setActiveDropdown(null));

  const popularityMap = useMemo(() => {
    const sorted = [...connectors].sort((a, b) => b.installCount - a.installCount);
    const m: Record<string, number> = {};
    sorted.forEach((c, i) => { m[c.id] = i + 1; });
    return m;
  }, [connectors]);

  const recommendations = useMemo(() => {
    const agentIds = new Set(agents.map((a) => a.id).filter(Boolean));
    return connectors.filter((c) => {
      if (c.connected || c.source !== 'marketplace') return false;
      return c.appData?.relatedAgentIds?.some((id) => agentIds.has(id));
    }).slice(0, 4);
  }, [connectors, agents]);

  const filtered = useMemo(() => {
    let list = [...connectors];
    if (filterType !== 'all')     list = list.filter((c) => c.source === filterType);
    if (filterCategory !== 'all') list = list.filter((c) => c.category === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || (c.developer || '').toLowerCase().includes(q));
    }
    if (sortBy === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => b.installCount - a.installCount);
    return list;
  }, [connectors, filterType, filterCategory, search, sortBy]);

  const featured = useMemo(() => connectors.filter((c) => c.featured && !search && filterCategory === 'all' && filterType === 'all'), [connectors, search, filterCategory, filterType]);

  function popLabel(c: UnifiedConnector): string | null {
    if (c.source !== 'marketplace') return null;
    const r = popularityMap[c.id];
    if (!r) return null;
    if (r === 1) return 'Most popular';
    if (r <= 10) return `#${r} popular`;
    return null;
  }

  const handleIntentSelect = (bundleId: string) => {
    setHighlightBundle(bundleId); setIntentDone(true);
    setTimeout(() => document.getElementById('browse-bundles')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  const handleBundleInstallAll = (bundle: AppBundle) => {
    const first = apps.find((a) => bundle.appIds.includes(a.id) && !a.installed);
    if (first) onConnect(connectors.find((c) => c.id === `app:${first.id}`)!);
  };

  const toggle = (d: typeof activeDropdown) => setActiveDropdown((p) => p === d ? null : d);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0e1117] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-white/8 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-lg font-bold text-white">Connectors</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Connect Rasi agents to your apps, files, and services. Connectors are reviewed by the Rasi team for security. You can also{' '}
              <button className="text-blue-400 hover:underline" onClick={() => toast.info('Custom connector support coming soon.')}>add a custom connector</button>.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"><X className="w-5 h-5" /></button>
        </div>

        {/* Filters */}
        <div ref={filtersRef} className="flex items-center gap-2 px-6 py-3 border-b border-white/8 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input type="text" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>}
          </div>
          {(['sort', 'type', 'cat'] as const).map((d) => {
            const label = d === 'sort' ? 'Sort' : d === 'type' ? 'Type' : 'Categories';
            const active = activeDropdown === d || (d === 'type' && filterType !== 'all') || (d === 'cat' && filterCategory !== 'all');
            return (
              <div key={d} className="relative">
                <button onClick={() => toggle(d)} className={cn('flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors', active ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10')}>
                  {label} <ChevronDown className="w-3 h-3" />
                </button>
                {activeDropdown === d && (
                  <div className="absolute top-full mt-1 right-0 min-w-[11rem] rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-20 overflow-hidden">
                    {d === 'sort' && SORT_OPTIONS.map((o) => (
                      <button key={o.value} onClick={() => { setSortBy(o.value); setActiveDropdown(null); }} className={cn('w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/5 transition-colors', sortBy === o.value ? 'text-white font-medium' : 'text-slate-400')}>{o.label}</button>
                    ))}
                    {d === 'type' && TYPE_OPTIONS.map((o) => (
                      <button key={o.value} onClick={() => { setFilterType(o.value as any); setActiveDropdown(null); }} className={cn('w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/5 transition-colors', filterType === o.value ? 'text-white font-medium' : 'text-slate-400')}>{o.label}</button>
                    ))}
                    {d === 'cat' && Object.entries(CATEGORY_META).map(([k, { label: lbl, Icon, color }]) => (
                      <button key={k} onClick={() => { setFilterCategory(k); setActiveDropdown(null); }} className={cn('w-full text-left px-3.5 py-2.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors', filterCategory === k ? 'text-white font-medium' : 'text-slate-400')}>
                        <Icon className={cn('w-3.5 h-3.5', color)} />{lbl}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {/* Intent picker (first time) */}
          {!intentDone && !search && filterCategory === 'all' && filterType === 'all' && (
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-5">
              <div className="flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-violet-300" /><p className="text-sm font-bold text-white">What are you trying to automate?</p></div>
              <p className="text-xs text-slate-400 mb-4">Pick a use case and we'll highlight the right connectors.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {INTENTS.map(({ id, label, Icon, color, bundleId }) => (
                  <button key={id} onClick={() => handleIntentSelect(bundleId)} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] text-left transition-all group">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color + '20', border: `1px solid ${color}35` }}>
                      <Icon className="w-4 h-4" style={{ color }} />
                    </div>
                    <span className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recommendation banner */}
          {intentDone && recommendations.length > 0 && !search && filterCategory === 'all' && (
            <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4 text-violet-300" /><p className="text-sm font-semibold text-white">Recommended for your agents</p></div>
              <div className="flex flex-wrap gap-2">
                {recommendations.map((c) => (
                  <button key={c.id} onClick={() => onConnect(c)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/8 bg-white/[0.04] hover:bg-white/[0.08] transition-all">
                    <ConnectorLogo connector={c} size="sm" />
                    <div className="text-left"><p className="text-xs font-semibold text-white">{c.name}</p></div>
                    <ArrowRight className="w-3 h-3 text-slate-500 ml-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bundles */}
          {!search && filterCategory === 'all' && filterType === 'all' && bundles.length > 0 && (
            <div id="browse-bundles">
              <div className="flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-slate-400" /><h3 className="text-sm font-semibold text-white">Install a stack</h3><span className="text-xs text-slate-500">— get a full workflow in one click</span></div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                {bundles.map((b) => <BundleCard key={b.id} bundle={b} apps={apps} onInstallAll={handleBundleInstallAll} />)}
              </div>
              {highlightBundle && <p className="text-xs text-violet-300 mt-2 flex items-center gap-1"><Sparkles className="w-3 h-3" />Showing recommended stack for your use case.</p>}
            </div>
          )}

          {/* Featured */}
          {featured.length > 0 && !search && (
            <div>
              <div className="flex items-center gap-2 mb-3"><Star className="w-4 h-4 text-amber-300" /><h3 className="text-sm font-semibold text-white">Featured</h3></div>
              <div className="grid grid-cols-2 gap-2">
                {featured.map((c) => <ConnectorCard key={c.id} connector={c} popLabel={null} onConnect={onConnect} onManage={onManage} />)}
              </div>
            </div>
          )}

          {/* Full grid */}
          <div>
            {(search || filterCategory !== 'all' || filterType !== 'all') && (
              <p className="text-xs text-slate-500 mb-3">{filtered.length} connector{filtered.length !== 1 ? 's' : ''}{search ? ` for "${search}"` : ''}</p>
            )}
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-500"><Search className="w-8 h-8 mx-auto mb-3 opacity-30" /><p className="text-sm">No connectors found{search ? ` for "${search}"` : ''}.</p></div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((c) => <ConnectorCard key={c.id} connector={c} popLabel={popLabel(c)} onConnect={onConnect} onManage={onManage} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Connector Card (used inside Browse Modal) ────────────────────────────────

function ConnectorCard({ connector: c, popLabel, onConnect, onManage }: {
  connector: UnifiedConnector; popLabel: string | null;
  onConnect: (c: UnifiedConnector) => void; onManage: (c: UnifiedConnector) => void;
}) {
  return (
    <button
      disabled={c.comingSoon}
      onClick={() => { if (c.comingSoon) return; if (c.connected) { onManage(c); } else { onConnect(c); } }}
      className={cn(
        'group text-left rounded-2xl border p-4 flex items-start gap-3 transition-all',
        c.comingSoon ? 'border-white/5 bg-white/[0.01] opacity-50 cursor-default'
        : c.connected ? 'border-emerald-500/20 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07] cursor-pointer'
        : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15 cursor-pointer',
      )}
    >
      <ConnectorLogo connector={c} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight truncate">{c.name}</p>
            {popLabel && <p className="text-[10px] text-slate-500 mt-0.5">{popLabel}</p>}
          </div>
          {c.comingSoon ? (
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-slate-600/40 bg-slate-700/20 text-slate-500 font-medium">Soon</span>
          ) : c.connected ? (
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/25 bg-emerald-500/15 text-emerald-300 font-medium">Connected</span>
          ) : c.badge ? (
            <span className={cn('shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-medium', BADGE_STYLE[c.badge] || BADGE_STYLE['Verified'])}>{c.badge}</span>
          ) : (
            <span className="shrink-0 w-6 h-6 rounded-lg border border-white/10 bg-white/[0.04] group-hover:bg-white/[0.12] group-hover:border-white/20 flex items-center justify-center transition-all">
              <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{c.description}</p>
        <p className="text-[10px] text-slate-600 mt-1">{c.source === 'marketplace' ? 'App' : 'Integration'}</p>
      </div>
    </button>
  );
}

// ─── Connector Row (connected list) ──────────────────────────────────────────

function ConnectorRow({ connector, agentNames, onClick, onConfigure, onDisconnect }: {
  connector: UnifiedConnector; agentNames: string[];
  onClick: (c: UnifiedConnector) => void;
  onConfigure: (c: UnifiedConnector) => void;
  onDisconnect: (c: UnifiedConnector) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideClick(menuRef, () => setShowMenu(false));
  const hasError = connector.status === 'error' || connector.status === 'expired';

  return (
    <div
      onClick={() => onClick(connector)}
      className="flex items-center gap-3 py-3 px-4 rounded-2xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.05] transition-colors cursor-pointer"
    >
      <ConnectorLogo connector={connector} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white leading-tight">{connector.name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-500 font-medium">
            {connector.source === 'marketplace' ? 'App' : 'Integration'}
          </span>
        </div>
        {agentNames.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5">
            <Bot className="w-3 h-3 text-slate-500 shrink-0" />
            <p className="text-[11px] text-slate-500 truncate">{agentNames.slice(0, 3).join(', ')}{agentNames.length > 3 ? ` +${agentNames.length - 3}` : ''}</p>
          </div>
        )}
        {connector.lastErrorMsg && <p className="text-[11px] text-rose-400 mt-0.5 truncate">{connector.lastErrorMsg}</p>}
      </div>

      {connector.actionsUnlocked && connector.actionsUnlocked.length > 0 && !hasError && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <Zap className="w-3 h-3 text-amber-400" />
          <span className="text-xs text-slate-500">{connector.actionsUnlocked.length} actions</span>
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        {hasError ? (
          <button onClick={() => onConfigure(connector)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-400/25 bg-rose-500/10 text-rose-300 text-xs font-medium hover:bg-rose-500/20 transition-colors">
            <AlertCircle className="w-3.5 h-3.5" /> Reconnect
          </button>
        ) : connector.status === 'syncing' ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-300 font-medium px-3 py-1.5 rounded-xl border border-amber-400/20 bg-amber-500/10">
            <Loader2 className="w-3 h-3 animate-spin" /> Syncing
          </span>
        ) : (
          <span className="text-sm font-medium text-emerald-400">Connected</span>
        )}
        <div ref={menuRef} className="relative">
          <button onClick={() => setShowMenu((v) => !v)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMenu && (
            <div className="absolute top-full mt-1 right-0 w-44 rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-10 overflow-hidden">
              <button onClick={() => { onConfigure(connector); setShowMenu(false); }} className="w-full text-left px-3.5 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                {connector.authType === 'oauth2' ? 'Reauthorize' : 'Update credentials'}
              </button>
              <button onClick={() => { onClick(connector); setShowMenu(false); }} className="w-full text-left px-3.5 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                View details
              </button>
              <div className="border-t border-white/8" />
              <button onClick={() => { onDisconnect(connector); setShowMenu(false); }} className="w-full text-left px-3.5 py-2.5 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors">
                {connector.source === 'marketplace' ? 'Remove app' : 'Disconnect'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConnectorsPage({ onNavigate: _onNavigate, agents = [] }: ConnectorsPageProps) {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const agentIdParam = searchParams.get('agentId');
  const domainParam = searchParams.get('domain');

  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [bundles, setBundles] = useState<AppBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'my' | 'all'>(tabParam === 'all' ? 'all' : 'my');
  const [showBrowse, setShowBrowse] = useState(tabParam === 'all');
  const [drawerConnector, setDrawerConnector] = useState<UnifiedConnector | null>(null);
  const [modalTarget, setModalTarget] = useState<{ connector: UnifiedConnector; mode: 'connect' | 'configure' } | null>(null);

  const linkedAgent = agentIdParam ? agents.find((a) => a.id === agentIdParam) : null;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, intsRes, bundlesRes] = await Promise.all([
        api.marketplace.getAll(),
        api.integrations.getAll(),
        api.marketplace.getBundles(),
      ]);
      if (appsRes.success && Array.isArray(appsRes.data)) setApps(appsRes.data);
      if (intsRes.success && Array.isArray(intsRes.data)) setIntegrations(intsRes.data);
      if (bundlesRes.success && Array.isArray(bundlesRes.data)) setBundles(bundlesRes.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const allConnectors = useMemo<UnifiedConnector[]>(() => [
    ...apps.map(fromApp),
    ...integrations.map(fromIntegration),
  ], [apps, integrations]);

  const connectedList = useMemo(() => allConnectors.filter((c) => c.connected), [allConnectors]);

  const agentNamesFor = useCallback((c: UnifiedConnector): string[] => {
    if (c.source === 'marketplace' && c.appData) {
      const ids = new Set(c.appData.relatedAgentIds);
      return agents.filter((a) => ids.has(a.id)).map((a) => a.name);
    }
    if (c.source === 'integration') {
      const sid = c.integrationData?.id;
      return agents.filter((a) => a.integrationIds?.includes(sid)).map((a) => a.name);
    }
    return [];
  }, [agents]);

  const openModal = (connector: UnifiedConnector, mode: 'connect' | 'configure') => setModalTarget({ connector, mode });

  const handleConnected = useCallback((connectorId: string) => {
    setApps((p) => p.map((a) => connectorId === `app:${a.id}` ? { ...a, installed: true } : a));
    setIntegrations((p) => p.map((i) => connectorId === `int:${i.id}` ? { ...i, lifecycleStatus: 'connected', status: 'connected' } : i));
    setModalTarget(null);
    setShowBrowse(false);
  }, []);

  const handleDisconnect = useCallback(async (connector: UnifiedConnector) => {
    try {
      if (connector.source === 'marketplace') {
        const res = await api.marketplace.uninstall(connector.appData!.id);
        if (!res.success) throw new Error((res as any).error);
        setApps((p) => p.map((a) => a.id === connector.appData!.id ? { ...a, installed: false } : a));
      } else {
        const res = await api.integrations.disconnect(connector.integrationData.id);
        if (!res.success) throw new Error((res as any).error);
        setIntegrations((p) => p.map((i) => i.id === connector.integrationData.id ? { ...i, lifecycleStatus: 'disconnected', status: 'disconnected' } : i));
      }
      toast.success(`${connector.name} disconnected`);
    } catch (e: any) { toast.error(e.message || 'Disconnect failed'); }
  }, []);

  const totalActions = connectedList.reduce((s, c) => s + (c.actionsUnlocked?.length || 0), 0);
  const errorCount = connectedList.filter((c) => c.status === 'error' || c.status === 'expired').length;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Connectors</h1>
          <p className="text-slate-400 text-sm mt-1">Connect your agents to apps and integrations.</p>
        </div>
        <button onClick={() => void loadData()} className="p-2 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Agent context banner */}
      {linkedAgent && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.06]">
          <Bot className="w-4 h-4 text-violet-300 shrink-0" />
          <p className="text-sm text-slate-300 flex-1">
            Showing connectors for <strong className="text-white">{linkedAgent.name}</strong> — connected apps will be linked to this agent.
          </p>
        </div>
      )}

      {/* Browse All / My Connectors tab switcher */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/8 w-fit">
        <button
          onClick={() => { setActiveTab('my'); setShowBrowse(false); }}
          className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors', activeTab === 'my' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200')}
        >
          My Connectors{connectedList.length > 0 ? ` (${connectedList.length})` : ''}
        </button>
        <button
          onClick={() => { setActiveTab('all'); setShowBrowse(true); }}
          className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-colors', activeTab === 'all' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200')}
        >
          Browse All
        </button>
      </div>

      {/* Stats bar */}
      {!loading && connectedList.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className={cn('rounded-xl border p-3 text-center', errorCount > 0 ? 'border-rose-400/15 bg-rose-500/[0.04]' : 'border-emerald-400/15 bg-emerald-500/[0.04]')}>
            <p className={cn('text-xl font-bold', errorCount > 0 ? 'text-rose-300' : 'text-emerald-300')}>{connectedList.length - errorCount}/{connectedList.length}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{errorCount > 0 ? `${errorCount} need attention` : 'All healthy'}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center">
            <p className="text-xl font-bold text-white">{totalActions}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Actions unlocked</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-center">
            <p className="text-xl font-bold text-white">{new Set(connectedList.flatMap((c) => agentNamesFor(c))).size}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Agents powered</p>
          </div>
        </div>
      )}

      {/* Connected list */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-slate-500 animate-spin" /></div>
      ) : connectedList.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm font-semibold text-white mb-1.5">No connectors yet</p>
          <p className="text-xs text-slate-400 mb-5 max-w-xs mx-auto">Browse and connect apps and integrations so your agents can take action with full governance.</p>
          <button onClick={() => setShowBrowse(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors">
            Browse connectors
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {connectedList.map((c) => (
            <ConnectorRow
              key={c.id}
              connector={c}
              agentNames={agentNamesFor(c)}
              onClick={setDrawerConnector}
              onConfigure={(connector) => openModal(connector, 'configure')}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <button onClick={() => toast.info('Custom connector support coming soon.')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-white/15 text-slate-400 hover:text-white hover:border-white/25 text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Add custom connector
        </button>
      )}

      {/* Browse Modal */}
      {showBrowse && (
        <BrowseModal
          connectors={allConnectors}
          apps={apps}
          bundles={bundles}
          agents={agents}
          initialCategory={domainParam || undefined}
          onClose={() => { setShowBrowse(false); setActiveTab('my'); }}
          onConnect={(c) => { setShowBrowse(false); setActiveTab('my'); openModal(c, 'connect'); }}
          onManage={(c) => { setShowBrowse(false); setActiveTab('my'); setDrawerConnector(c); }}
        />
      )}

      {/* Detail Drawer */}
      {drawerConnector && (
        <DetailDrawer
          connector={drawerConnector}
          agents={agents}
          onClose={() => setDrawerConnector(null)}
          onConfigure={(c) => { setDrawerConnector(null); openModal(c, 'configure'); }}
          onDisconnect={async (c) => { await handleDisconnect(c); setDrawerConnector(null); }}
        />
      )}

      {/* Connect / Configure Modal */}
      {modalTarget && (
        modalTarget.connector.source === 'marketplace' ? (
          <AppConnectModal connector={modalTarget.connector} mode={modalTarget.mode} onClose={() => setModalTarget(null)} onDone={handleConnected} />
        ) : (
          <IntegrationConnectModal connector={modalTarget.connector} mode={modalTarget.mode} onClose={() => setModalTarget(null)} onDone={handleConnected} />
        )
      )}
    </div>
  );
}
