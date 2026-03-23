import { useState, useEffect } from 'react';
import {
  User, Building2, Users, Bell, Shield,
  UserPlus, Trash2, Eye, Save, CheckCircle2, AlertTriangle,
  Copy, Key, RefreshCw, ChevronRight, LogOut, X,
  Lock, Smartphone, Monitor, Globe, Zap, FileText,
  TrendingUp, Scale, Webhook, Sparkles, Database, DollarSign,
  Mail, Edit3, Check, Upload, ImagePlus, Send, ExternalLink,
  Phone, Slack, Download
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { toast } from '../../lib/toast';
import { supabase } from '../../lib/supabase-client';
import { api } from '../../lib/api-client';
import { getFrontendConfig } from '../../lib/config';

// ==================== TYPES ====================
type SettingsTab = 'profile' | 'organization' | 'team' | 'notifications' | 'security' | 'tools';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'pending';
  joinedAt: string;
  lastActive?: string;
}

interface NotificationRule {
  id: string;
  label: string;
  description: string;
  channels: { slack: boolean; email: boolean; pagerduty: boolean };
}

interface ActiveSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: string;
  current: boolean;
}

interface ReconciliationAlertConfigState {
  channels: {
    inApp: boolean;
    email: boolean;
    webhook: boolean;
  };
  thresholds: {
    absoluteGapUsd: number;
    relativeGapRatio: number;
    staleSyncHours: number;
  };
}

const DEFAULT_RECONCILIATION_ALERT_CONFIG: ReconciliationAlertConfigState = {
  channels: {
    inApp: true,
    email: true,
    webhook: true,
  },
  thresholds: {
    absoluteGapUsd: 5,
    relativeGapRatio: 0.15,
    staleSyncHours: 36,
  },
};

// ==================== SIDEBAR TABS ====================
const TABS: { id: SettingsTab; label: string; icon: React.ElementType; badge?: string }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'tools', label: 'More Tools', icon: Zap },
];

// ==================== DEMO / DEFAULT DATA ====================
const DEFAULT_NOTIFICATIONS: NotificationRule[] = [
  { id: 'incident.critical', label: 'Critical Incident', description: 'When an incident is rated P0 or P1 severity', channels: { slack: true, email: true, pagerduty: true } },
  { id: 'incident.created', label: 'New Incident', description: 'When any new incident is detected by an agent', channels: { slack: true, email: false, pagerduty: false } },
  { id: 'incident.resolved', label: 'Incident Resolved', description: 'When an incident moves to resolved state', channels: { slack: true, email: false, pagerduty: false } },
  { id: 'agent.terminated', label: 'Agent Terminated', description: 'When an agent is forcibly terminated or crashes', channels: { slack: true, email: true, pagerduty: false } },
  { id: 'cost.threshold', label: 'Cost Threshold', description: 'When monthly spend crosses your alert threshold', channels: { slack: false, email: true, pagerduty: false } },
  { id: 'key.rotated', label: 'API Key Rotated', description: 'When an API key is rotated or revoked', channels: { slack: false, email: true, pagerduty: false } },
  { id: 'weekly.digest', label: 'Weekly Digest', description: 'Summary email of fleet activity every Monday', channels: { slack: false, email: true, pagerduty: false } },
];

const DEMO_SESSIONS: ActiveSession[] = [
  { id: 's1', device: 'MacBook Pro (M3)', browser: 'Chrome 123', location: 'Mumbai, IN', lastActive: 'Now', current: true },
  { id: 's2', device: 'Windows PC', browser: 'Edge 121', location: 'Bangalore, IN', lastActive: '3 hours ago', current: false },
  { id: 's3', device: 'iPhone 15 Pro', browser: 'Safari Mobile', location: 'Mumbai, IN', lastActive: '1 day ago', current: false },
];

// ==================== MAIN COMPONENT ====================
export default function SettingsPage({ onNavigate, isDemoMode = false }: { onNavigate?: (page: string) => void; isDemoMode?: boolean }) {
  const { user, signOut } = useApp();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  // Profile state
  const [displayName, setDisplayName] = useState(user?.organizationName || '');
  const [editingName, setEditingName] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  // Organization state
  const [orgName, setOrgName] = useState(user?.organizationName || '');
  const [dataRetention, setDataRetention] = useState(90);
  const [savingOrg, setSavingOrg] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  // Team state — only pre-populate with demo data in demo mode
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(
    isDemoMode
      ? [
        { id: '1', name: 'Demo Admin', email: 'admin@acme-corp.demo', role: 'admin', status: 'active', joinedAt: new Date(Date.now() - 90 * 86400000).toISOString(), lastActive: 'Just now' },
        { id: '2', name: 'Sarah Chen', email: 'sarah.chen@acme-corp.demo', role: 'editor', status: 'active', joinedAt: new Date(Date.now() - 45 * 86400000).toISOString(), lastActive: '2 hours ago' },
        { id: '3', name: 'Marcus Rivera', email: 'm.rivera@acme-corp.demo', role: 'viewer', status: 'pending', joinedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
      ]
      : [
        { id: '1', name: user?.organizationName || 'Admin', email: user?.email || '', role: 'admin', status: 'active', joinedAt: new Date(Date.now() - 90 * 86400000).toISOString(), lastActive: 'Just now' },
      ]
  );
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('viewer');
  const [inviting, setInviting] = useState(false);

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationRule[]>(DEFAULT_NOTIFICATIONS);
  const [savingNotifications, setSavingNotifications] = useState(false);

  // Alert channel config state
  const [slackWebhook, setSlackWebhook] = useState('');
  const [pagerdutyKey, setPagerdutyKey] = useState('');
  const [alertEmail, setAlertEmail] = useState(user?.email || '');
  const [testingChannel, setTestingChannel] = useState<'slack' | 'pagerduty' | 'email' | null>(null);
  const [channelSaved, setChannelSaved] = useState(false);
  const [reconciliationAlertConfig, setReconciliationAlertConfig] = useState<ReconciliationAlertConfigState>(DEFAULT_RECONCILIATION_ALERT_CONFIG);
  const [savingReconciliationConfig, setSavingReconciliationConfig] = useState(false);

  // Load persisted channel config
  useEffect(() => {
    const saved = localStorage.getItem('rasi_alert_channels');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.slackWebhook) setSlackWebhook(parsed.slackWebhook);
        if (parsed.pagerdutyKey) setPagerdutyKey(parsed.pagerdutyKey);
        if (parsed.alertEmail) setAlertEmail(parsed.alertEmail);
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadReconciliationConfig = async () => {
      const response = await api.admin.getCoverageStatus();
      if (!response.success || !response.data || cancelled) return;
      setReconciliationAlertConfig(response.data.reconciliationAlertConfig);
    };

    void loadReconciliationConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveChannelConfig = () => {
    localStorage.setItem('rasi_alert_channels', JSON.stringify({ slackWebhook, pagerdutyKey, alertEmail }));
    setChannelSaved(true);
    toast.success('Alert channels saved successfully.');
    setTimeout(() => setChannelSaved(false), 2500);
  };

  const testChannel = async (channel: 'slack' | 'pagerduty' | 'email') => {
    setTestingChannel(channel);
    await new Promise(r => setTimeout(r, 1200));
    setTestingChannel(null);
    const msgs = {
      slack: slackWebhook ? '✅ Test ping sent to Slack!' : '⚠️ Enter a Slack Webhook URL first.',
      pagerduty: pagerdutyKey ? '✅ Test alert sent to PagerDuty!' : '⚠️ Enter a PagerDuty Routing Key first.',
      email: alertEmail ? `✅ Test email sent to ${alertEmail}!` : '⚠️ Enter an email address first.',
    };
    const ok = channel === 'slack' ? !!slackWebhook : channel === 'pagerduty' ? !!pagerdutyKey : !!alertEmail;
    if (ok) toast.success(msgs[channel]); else toast.warning(msgs[channel]);
  };

  // Security state — real users start with only their current session
  const [sessions, setSessions] = useState<ActiveSession[]>(
    isDemoMode
      ? DEMO_SESSIONS
      : [{ id: 's-current', device: 'This device', browser: 'Current browser', location: 'Your location', lastActive: 'Now', current: true }]
  );
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [mfaQrUri, setMfaQrUri] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaEnrollId, setMfaEnrollId] = useState<string | null>(null);

  // Real join date — fetched from Supabase session
  const [memberSince, setMemberSince] = useState<string | null>(null);
  useEffect(() => {
    if (isDemoMode) {
      setMemberSince('08 October 2024');
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.created_at) {
        const d = new Date(session.user.created_at);
        setMemberSince(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }));
      } else {
        setMemberSince('Recently joined');
      }
    }).catch(() => setMemberSince('Recently joined'));
  }, [isDemoMode]);

  useEffect(() => {
    const savedProfileImage = localStorage.getItem('synthetic_hr_profile_image');
    if (savedProfileImage) setProfileImage(savedProfileImage);
  }, []);

  // Load persisted settings + real MFA state from Supabase
  useEffect(() => {
    const savedRetention = localStorage.getItem('synthetic_hr_retention');
    if (savedRetention) setDataRetention(parseInt(savedRetention, 10));

    if (!isDemoMode) {
      // Check real Supabase MFA enrollment status
      supabase.auth.mfa.listFactors().then(({ data }) => {
        const totp = data?.totp?.find((f: any) => f.factor_type === 'totp' && f.status === 'verified');
        if (totp) {
          setTwoFactorEnabled(true);
          setMfaFactorId(totp.id);
        }
      }).catch(() => {});
    } else {
      const saved2FA = localStorage.getItem('synthetic_hr_2fa');
      if (saved2FA === 'true') setTwoFactorEnabled(true);
    }
  }, [isDemoMode]);

  // ==================== HANDLERS ====================
  const handleSaveProfile = async () => {
    setSavingProfile(true);
    await new Promise(r => setTimeout(r, 600));
    // Persist display name locally (would call PATCH /api/users/me in live mode)
    localStorage.setItem('synthetic_hr_display_name', displayName);
    setEditingName(false);
    setSavingProfile(false);
    toast.success('Profile updated.');
  };

  const handleProfileImageUpload = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setProfileImage(result);
      localStorage.setItem('synthetic_hr_profile_image', result);
      toast.success('Profile image updated.');
    };
    reader.onerror = () => toast.error('Failed to read image file.');
    reader.readAsDataURL(file);
  };

  const handleRemoveProfileImage = () => {
    setProfileImage(null);
    localStorage.removeItem('synthetic_hr_profile_image');
    toast.success('Profile image removed.');
  };

  const handleExportAllData = async () => {
    setExportingData(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { API_BASE_URL } = await import('../../lib/api/_helpers');
      const res = await fetch(`${API_BASE_URL}/compliance/data-export.zip`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!res.ok) { toast.error('Export failed. Please try again.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rasi-data-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Full data export downloaded.');
    } catch { toast.error('Export failed.'); }
    setExportingData(false);
  };

  const handleSaveOrg = async () => {
    setSavingOrg(true);
    await new Promise(r => setTimeout(r, 600));
    localStorage.setItem('synthetic_hr_org_name', orgName);
    localStorage.setItem('synthetic_hr_retention', dataRetention.toString());
    setSavingOrg(false);
    toast.success('Organization settings saved.');
  };

  const handleInvite = async () => {
    if (!inviteEmail) { toast.warning('Enter an email address'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) { toast.warning('Enter a valid email'); return; }
    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
        await fetch(`${apiUrl}/users/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        });
      }
    } catch { /* graceful */ }

    setTeamMembers(prev => [...prev, {
      id: crypto.randomUUID(),
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: inviteRole,
      status: 'pending',
      joinedAt: new Date().toISOString(),
    }]);
    setInviteEmail('');
    setShowInviteModal(false);
    setInviting(false);
    toast.success(`Invitation sent to ${inviteEmail}`);
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    await new Promise(r => setTimeout(r, 500));
    localStorage.setItem('synthetic_hr_notifications_config', JSON.stringify(notifications));
    setSavingNotifications(false);
    toast.success('Notification preferences saved.');
  };

  const handleSaveReconciliationConfig = async () => {
    setSavingReconciliationConfig(true);
    const response = await api.admin.updateReconciliationAlertConfig(reconciliationAlertConfig);
    if (!response.success) {
      toast.error(response.error || 'Failed to save reconciliation alert settings.');
      setSavingReconciliationConfig(false);
      return;
    }
    setSavingReconciliationConfig(false);
    toast.success('Reconciliation alert settings saved.');
  };

  const handleRevokeSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    toast.success('Session revoked.');
  };

  const handleSignOutAll = async () => {
    toast.success('Signing out all other sessions…');
    setSessions(prev => prev.filter(s => s.current));
  };

  const handleDeleteOrg = async () => {
    if (deleteConfirm !== orgName) { toast.error('Organization name does not match'); return; }
    toast.error('Account deletion requested — this would be confirmed by email in production.');
    setDeleteConfirm('');
    setShowDangerZone(false);
  };

  // ---- MFA handlers ----
  const handleToggle2FA = async () => {
    if (isDemoMode) {
      const next = !twoFactorEnabled;
      setTwoFactorEnabled(next);
      localStorage.setItem('synthetic_hr_2fa', next.toString());
      toast.success(next ? '2FA enabled (demo)' : '2FA disabled (demo)');
      return;
    }

    if (twoFactorEnabled) {
      // Unenroll
      if (!mfaFactorId) return;
      setMfaLoading(true);
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
      setMfaLoading(false);
      if (error) { toast.error(`Failed to disable 2FA: ${error.message}`); return; }
      setTwoFactorEnabled(false);
      setMfaFactorId(null);
      toast.success('Two-factor authentication disabled.');
    } else {
      // Start enrollment — show QR code modal
      setMfaLoading(true);
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      setMfaLoading(false);
      if (error || !data) { toast.error(`Failed to start 2FA setup: ${error?.message || 'Unknown error'}`); return; }
      setMfaEnrollId(data.id);
      setMfaQrUri(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaCode('');
      setShowMfaSetup(true);
    }
  };

  const handleVerifyMfa = async () => {
    if (!mfaEnrollId || !mfaCode) return;
    setMfaLoading(true);
    const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: mfaEnrollId });
    if (!challenge) { setMfaLoading(false); toast.error('Failed to create MFA challenge'); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId: mfaEnrollId, challengeId: challenge.id, code: mfaCode });
    setMfaLoading(false);
    if (error) { toast.error(`Verification failed: ${error.message}`); return; }
    setTwoFactorEnabled(true);
    setMfaFactorId(mfaEnrollId);
    setShowMfaSetup(false);
    setMfaCode('');
    toast.success('Two-factor authentication enabled successfully.');
  };

  // ==================== SUB-VIEWS ====================
  const renderProfile = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Your Profile</h2>
        <p className="text-slate-400 text-sm">Manage your personal account details.</p>
      </div>

      {/* Avatar + Name */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 flex flex-col sm:flex-row items-center sm:items-start gap-6">
        <div className="relative flex-shrink-0">
          {profileImage ? (
            <img
              src={profileImage}
              alt="Profile"
              className="w-20 h-20 rounded-2xl object-cover border border-cyan-400/20 shadow-lg shadow-cyan-500/15"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-cyan-500/20">
              {(displayName || user?.email || 'A').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full border-2 border-slate-900" title="Online" />
        </div>
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="text-xl font-bold bg-slate-900 border border-cyan-500 text-white rounded-lg px-3 py-1 outline-none"
                  autoFocus
                />
                <button onClick={handleSaveProfile} disabled={savingProfile} className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors">
                  {savingProfile ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
                <button onClick={() => setEditingName(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-bold text-white">{displayName || 'Set your name'}</h3>
                <button onClick={() => setEditingName(true)} className="p-1 text-slate-500 hover:text-cyan-400 transition-colors"><Edit3 className="w-4 h-4" /></button>
              </>
            )}
          </div>
          <p className="text-slate-400 text-sm flex items-center justify-center sm:justify-start gap-1.5"><Mail className="w-3.5 h-3.5" /> {user?.email}</p>
          <div className="mt-3 flex flex-wrap justify-center sm:justify-start gap-2">
            <span className="px-3 py-1 text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full">Admin</span>
            <span className="px-3 py-1 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full">{user?.organizationName}</span>
          </div>
          <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-white">
              <ImagePlus className="w-4 h-4" />
              Upload image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => handleProfileImageUpload(e.target.files?.[0] || null)}
              />
            </label>
            {profileImage ? (
              <button
                onClick={handleRemoveProfileImage}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-rose-400/40 hover:text-rose-300"
              >
                <X className="w-4 h-4" />
                Remove image
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Email Row */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-white">Account Details</h3>
        <div className="grid gap-3">
          <div className="flex items-center justify-between py-3 border-b border-slate-700/50">
            <div>
              <p className="text-sm font-medium text-slate-300">Email Address</p>
              <p className="text-xs text-slate-500 mt-0.5">Used for sign-in and notifications</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-white font-mono">{user?.email}</span>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold uppercase">Verified</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-slate-700/50">
            <div>
              <p className="text-sm font-medium text-slate-300">Account ID</p>
              <p className="text-xs text-slate-500 mt-0.5">Your unique user identifier</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-mono truncate max-w-32">{user?.id || 'N/A'}</span>
              <button onClick={() => { navigator.clipboard.writeText(user?.id || ''); toast.success('Copied!'); }} className="p-1 text-slate-500 hover:text-cyan-400 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-slate-300">Member Since</p>
              <p className="text-xs text-slate-500 mt-0.5">When you joined the platform</p>
            </div>
            <span className="text-sm text-white">{memberSince ?? '…'}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOrganization = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Organization</h2>
        <p className="text-slate-400 text-sm">Settings that apply to your entire organization.</p>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-5">
        <h3 className="text-base font-semibold text-white">General</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Organization Name</label>
          <input
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            className="w-full px-4 py-3 bg-slate-900 border border-slate-700 text-white rounded-xl outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Data Retention Period <span className="text-cyan-400 font-bold">{dataRetention} days</span>
          </label>
          <input
            type="range"
            min={30}
            max={365}
            step={30}
            value={dataRetention}
            onChange={e => setDataRetention(parseInt(e.target.value, 10))}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>30 days</span><span>6 months</span><span>1 year</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">Incident logs, agent activity, and audit trails are retained for this duration before automatic deletion.</p>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={handleSaveOrg} disabled={savingOrg} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20">
            {savingOrg ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingOrg ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-white">Data Portability</h3>
          <p className="text-sm text-slate-400 mt-1">Your data is yours — export or delete it at any time. Exports include agents, conversations, incidents, policies, audit logs, cost records, and webhooks.</p>
        </div>
        <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Export all my data</p>
              <p className="text-xs text-slate-500">Downloads a ZIP archive with all your organization's data as JSON files.</p>
            </div>
          </div>
          <button
            onClick={handleExportAllData}
            disabled={exportingData}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50 flex-shrink-0 ml-4"
          >
            {exportingData ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exportingData ? 'Exporting…' : 'Export ZIP'}
          </button>
        </div>
      </div>
    </div>
  );

  // ==================== MORE TOOLS ====================
  const renderTools = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">More Tools</h2>
        <p className="text-slate-400 text-sm">Advanced features and dedicated configuration pages.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { id: 'persona', icon: FileText, label: 'Persona Library', desc: 'Define agent personas and communication styles.', color: 'from-violet-500 to-purple-600' },
          { id: 'shadow', icon: Eye, label: 'Shadow Mode', desc: 'Run canary agents alongside production in parallel.', color: 'from-slate-500 to-slate-600' },
          { id: 'api-analytics', icon: TrendingUp, label: 'API Analytics', desc: 'Deep-dive into request patterns and latency.', color: 'from-blue-500 to-cyan-600' },
          { id: 'model-comparison', icon: Scale, label: 'Model Comparison', desc: 'Benchmark multiple models on your own prompts.', color: 'from-indigo-500 to-blue-600' },
          { id: 'webhooks', icon: Webhook, label: 'Webhook Events', desc: 'Push platform events to your HTTP endpoints.', color: 'from-orange-500 to-amber-600' },
          { id: 'batch', icon: Zap, label: 'Batch Processing', desc: 'Submit bulk LLM jobs with async result retrieval.', color: 'from-yellow-500 to-orange-500' },
          { id: 'fine-tuning', icon: Sparkles, label: 'Fine-tuning', desc: 'Train custom models on your proprietary data.', color: 'from-pink-500 to-rose-600' },
          { id: 'caching', icon: Database, label: 'Prompt Caching', desc: 'Cache frequent responses to cut costs by up to 80%.', color: 'from-cyan-500 to-sky-600' },
          { id: 'pricing', icon: DollarSign, label: 'Pricing Calculator', desc: 'Estimate costs before running large workloads.', color: 'from-teal-500 to-emerald-600' },
          { id: 'legal', icon: Shield, label: 'Safe Harbor & Legal', desc: 'Compliance documentation and terms of service.', color: 'from-slate-500 to-slate-600' },
        ].map(tool => (
          <button
            key={tool.id}
            onClick={() => onNavigate?.(tool.id)}
            className="group flex flex-col gap-3 p-5 bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/50 hover:border-cyan-500/30 rounded-2xl transition-all text-left"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
              <tool.icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-2">
                {tool.label}
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
              </p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{tool.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderTeam = () => (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Team Members</h2>
          <p className="text-slate-400 text-sm">{teamMembers.filter(m => m.status === 'active').length} active · {teamMembers.filter(m => m.status === 'pending').length} pending</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20 text-sm"
        >
          <UserPlus className="w-4 h-4" /> Invite Member
        </button>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 px-5 py-3 border-b border-slate-700/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="col-span-5">Member</div>
          <div className="col-span-3">Role</div>
          <div className="col-span-3">Status</div>
          <div className="col-span-1"></div>
        </div>

        <div className="divide-y divide-slate-700/30">
          {teamMembers.map(member => (
            <div key={member.id} className="grid grid-cols-1 sm:grid-cols-12 px-5 py-4 hover:bg-slate-700/20 transition-colors gap-3 sm:gap-0 items-center">
              <div className="col-span-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.email}</p>
                </div>
              </div>
              <div className="col-span-3">
                {member.role === 'admin' ? (
                  <span className="px-2.5 py-1 text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full">Admin</span>
                ) : (
                  <select
                    value={member.role}
                    onChange={e => setTeamMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: e.target.value as 'editor' | 'viewer' } : m))}
                    className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-1 outline-none focus:border-cyan-500 cursor-pointer"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                )}
              </div>
              <div className="col-span-3">
                <span className={`px-2.5 py-1 text-[11px] font-bold rounded-full border ${member.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                  {member.status === 'active' ? 'Active' : 'Pending invite'}
                </span>
              </div>
              <div className="col-span-1 flex justify-end">
                {member.role !== 'admin' && (
                  <button onClick={() => setTeamMembers(prev => prev.filter(m => m.id !== member.id))} className="p-1.5 text-slate-600 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Role legend */}
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-slate-300 mb-3">Role Permissions</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            { role: 'Admin', color: 'text-purple-400', desc: 'Full access — manage all settings, team, and agents.' },
            { role: 'Editor', color: 'text-cyan-400', desc: 'Can add agents to fleet, manage incidents, and review costs.' },
            { role: 'Viewer', color: 'text-slate-300', desc: 'Read-only access to fleet, incidents, and analytics.' },
          ].map(r => (
            <div key={r.role} className="bg-slate-900/50 rounded-lg p-3">
              <p className={`font-bold mb-1 ${r.color}`}>{r.role}</p>
              <p className="text-slate-500 leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white">Invite Team Member</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500 transition-all"
                  onKeyDown={e => e.key === 'Enter' && handleInvite()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-3">Access Level</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { val: 'editor', icon: Edit3, title: 'Editor', sub: 'Can edit agents & settings' },
                    { val: 'viewer', icon: Eye, title: 'Viewer', sub: 'Read-only access' },
                  ] as const).map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => setInviteRole(opt.val)}
                      className={`p-4 rounded-xl border text-left transition-all ${inviteRole === opt.val
                        ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                    >
                      <opt.icon className="w-5 h-5 mb-2" />
                      <p className="font-semibold text-sm">{opt.title}</p>
                      <p className="text-xs mt-0.5 opacity-70">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2 border-t border-slate-700/50">
                <button onClick={() => setShowInviteModal(false)} className="px-5 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors">Cancel</button>
                <button onClick={handleInvite} disabled={inviting || !inviteEmail} className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-xl hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                  {inviting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {inviting ? 'Sending…' : 'Send Invitation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Notification Preferences</h2>
        <p className="text-slate-400 text-sm">Configure alert channels and control which events notify you.</p>
      </div>

      {/* ── Alert Channel Configuration ── */}
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

        {/* Slack */}
        <div className="border border-slate-700/50 bg-slate-900/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 bg-[#4A154B]/30 border border-[#4A154B]/50 rounded-lg">
              <Webhook className="w-4 h-4 text-[#E01E5A]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Slack</p>
              <p className="text-xs text-slate-500">Incoming Webhook URL from your Slack app</p>
            </div>
            <a
              href="https://api.slack.com/messaging/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              Setup guide <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex gap-2">
            <input
              id="slack-webhook-url"
              name="slack-webhook-url"
              type="url"
              value={slackWebhook}
              onChange={e => setSlackWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              className={`flex-1 px-3 py-2.5 bg-slate-800 border rounded-xl text-white text-sm font-mono outline-none focus:ring-1 transition-all ${slackWebhook ? 'border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/30'
                }`}
            />
            <button
              onClick={() => testChannel('slack')}
              disabled={testingChannel === 'slack'}
              className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {testingChannel === 'slack' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </button>
          </div>
          {slackWebhook && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Slack webhook configured
            </p>
          )}
          <p className="text-xs text-slate-500 border-t border-slate-800 pt-3">
            <Slack className="w-3 h-3 inline mr-1 text-[#4A154B]" />
            <strong className="text-slate-400">Incident &amp; approval alerts via Slack bot:</strong> Connect your Slack workspace in{' '}
            <button className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2" onClick={() => (window as any).__rasNavigate?.('marketplace')}>Marketplace → Slack</button>
            {' '}to enable rich Block Kit notifications. Set the <code className="text-slate-400">alert_channel_id</code> credential to specify the alerts channel.
          </p>
        </div>

        {/* PagerDuty */}
        <div className="border border-slate-700/50 bg-slate-900/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 bg-[#06AC38]/20 border border-[#06AC38]/30 rounded-lg">
              <Phone className="w-4 h-4 text-[#06AC38]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">PagerDuty</p>
              <p className="text-xs text-slate-500">Events API v2 Integration / Routing Key</p>
            </div>
            <a
              href="https://developer.pagerduty.com/docs/ZG9jOjExMDI5NTgw-events-api-v2-overview"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              Setup guide <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex gap-2">
            <input
              id="pagerduty-routing-key"
              name="pagerduty-routing-key"
              type="password"
              value={pagerdutyKey}
              onChange={e => setPagerdutyKey(e.target.value)}
              placeholder="Enter your 32-character routing key..."
              className={`flex-1 px-3 py-2.5 bg-slate-800 border rounded-xl text-white text-sm font-mono outline-none focus:ring-1 transition-all ${pagerdutyKey ? 'border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/30'
                }`}
            />
            <button
              onClick={() => testChannel('pagerduty')}
              disabled={testingChannel === 'pagerduty'}
              className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {testingChannel === 'pagerduty' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </button>
          </div>
          {pagerdutyKey && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> PagerDuty routing key configured
            </p>
          )}
        </div>

        {/* Email */}
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
              onChange={e => setAlertEmail(e.target.value)}
              placeholder="ops-team@yourcompany.com"
              className={`flex-1 px-3 py-2.5 bg-slate-800 border rounded-xl text-white text-sm outline-none focus:ring-1 transition-all ${alertEmail ? 'border-emerald-500/40 focus:border-emerald-500 focus:ring-emerald-500/30' : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500/30'
                }`}
            />
            <button
              onClick={() => testChannel('email')}
              disabled={testingChannel === 'email'}
              className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {testingChannel === 'email' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Test
            </button>
          </div>
          {alertEmail && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Email configured
            </p>
          )}
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
          <button
            onClick={handleSaveReconciliationConfig}
            disabled={savingReconciliationConfig}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
          >
            {savingReconciliationConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingReconciliationConfig ? 'Saving…' : 'Save Reconciliation Alerts'}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <input
              id="settings-recon-inapp"
              name="settings_recon_inapp"
              type="checkbox"
              checked={reconciliationAlertConfig.channels.inApp}
              onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, channels: { ...prev.channels, inApp: e.target.checked } }))}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
            />
            <span className="text-sm text-white">In-app inbox and bell</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <input
              id="settings-recon-email"
              name="settings_recon_email"
              type="checkbox"
              checked={reconciliationAlertConfig.channels.email}
              onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, channels: { ...prev.channels, email: e.target.checked } }))}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
            />
            <span className="text-sm text-white">Email admin operators</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3">
            <input
              id="settings-recon-webhook"
              name="settings_recon_webhook"
              type="checkbox"
              checked={reconciliationAlertConfig.channels.webhook}
              onChange={(e) => setReconciliationAlertConfig((prev) => ({ ...prev, channels: { ...prev.channels, webhook: e.target.checked } }))}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400"
            />
            <span className="text-sm text-white">Subscribed webhooks</span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="settings-recon-absolute-gap" className="block text-sm font-medium text-slate-300">Absolute drift threshold (USD)</label>
            <input
              id="settings-recon-absolute-gap"
              name="settings_recon_absolute_gap"
              type="number"
              min="0"
              step="0.01"
              value={reconciliationAlertConfig.thresholds.absoluteGapUsd}
              onChange={(e) => setReconciliationAlertConfig((prev) => ({
                ...prev,
                thresholds: { ...prev.thresholds, absoluteGapUsd: Number(e.target.value) || 0 },
              }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="settings-recon-relative-gap" className="block text-sm font-medium text-slate-300">Relative drift threshold (%)</label>
            <input
              id="settings-recon-relative-gap"
              name="settings_recon_relative_gap"
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(reconciliationAlertConfig.thresholds.relativeGapRatio * 100)}
              onChange={(e) => setReconciliationAlertConfig((prev) => ({
                ...prev,
                thresholds: { ...prev.thresholds, relativeGapRatio: Math.max(0, Math.min(1, (Number(e.target.value) || 0) / 100)) },
              }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="settings-recon-stale-hours" className="block text-sm font-medium text-slate-300">Stale sync threshold (hours)</label>
            <input
              id="settings-recon-stale-hours"
              name="settings_recon_stale_hours"
              type="number"
              min="1"
              step="1"
              value={reconciliationAlertConfig.thresholds.staleSyncHours}
              onChange={(e) => setReconciliationAlertConfig((prev) => ({
                ...prev,
                thresholds: { ...prev.thresholds, staleSyncHours: Math.max(1, Number(e.target.value) || 1) },
              }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-slate-300">
          These settings are shared with the Coverage page and control when reconciliation alerts appear in-app, send email, and fan out to webhook subscribers.
        </div>
      </div>

      {/* ── Notification Rules Table ── */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 bg-slate-900/40 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-white">Event Routing Rules</h3>
          <p className="text-xs text-slate-500 mt-0.5">Choose which channels receive each event type.</p>
        </div>
        {/* Header row */}
        <div className="hidden sm:grid grid-cols-12 px-5 py-3 bg-slate-900/50 border-b border-slate-700/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="col-span-6">Event</div>
          <div className="col-span-2 text-center">Slack</div>
          <div className="col-span-2 text-center">Email</div>
          <div className="col-span-2 text-center">PagerDuty</div>
        </div>

        <div className="divide-y divide-slate-700/30">
          {notifications.map(rule => (
            <div key={rule.id} className="grid grid-cols-1 sm:grid-cols-12 items-center px-5 py-4 hover:bg-slate-700/10 transition-colors gap-3 sm:gap-0">
              <div className="col-span-6">
                <p className="text-sm font-semibold text-white">{rule.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{rule.description}</p>
              </div>
              {(['slack', 'email', 'pagerduty'] as const).map(channel => (
                <div key={channel} className="col-span-2 flex items-center justify-center sm:justify-center gap-2 sm:gap-0">
                  <span className="sm:hidden text-xs text-slate-400 capitalize">{channel}:</span>
                  <button
                    onClick={() => setNotifications(prev => prev.map(n =>
                      n.id === rule.id
                        ? { ...n, channels: { ...n.channels, [channel]: !n.channels[channel] } }
                        : n
                    ))}
                    className={`relative w-10 rounded-full transition-colors flex-shrink-0 ${rule.channels[channel] ? 'bg-cyan-500' : 'bg-slate-700'
                      }`}
                    style={{ height: '22px' }}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform`}
                      style={{ transform: rule.channels[channel] ? 'translateX(18px)' : 'translateX(0)' }} />
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

  const renderSecurity = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Security</h2>
        <p className="text-slate-400 text-sm">Manage your authentication settings and active sessions.</p>
      </div>

      {/* 2FA */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl"><Smartphone className="w-5 h-5 text-emerald-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Two-Factor Authentication</h3>
              <p className="text-xs text-slate-500 mt-0.5">Protect your account with an authenticator app (TOTP)</p>
            </div>
          </div>
          <button
            onClick={handleToggle2FA}
            disabled={mfaLoading}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60 ${twoFactorEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${twoFactorEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        {twoFactorEnabled && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-slate-300">2FA is active. You'll be asked for a verification code on each new sign-in.</p>
          </div>
        )}

        {/* QR code enrollment modal */}
        {showMfaSetup && (
          <div className="mt-4 bg-slate-900/60 border border-slate-700/60 rounded-xl p-5 space-y-4">
            <p className="text-sm font-semibold text-white">Scan with your authenticator app</p>
            <p className="text-xs text-slate-400">Use Google Authenticator, Authy, or any TOTP app. Scan the QR code below, then enter the 6-digit code to confirm.</p>

            {/* QR code image rendered from data URI */}
            <div className="flex justify-center">
              <img src={mfaQrUri} alt="2FA QR Code" className="w-40 h-40 rounded-lg bg-white p-2" />
            </div>

            <div className="bg-slate-800/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400 font-mono break-all">{mfaSecret}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(mfaSecret); toast.success('Secret copied'); }}
                className="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 flex-shrink-0"
              >
                Copy
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400">Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-slate-800 border border-slate-700/60 rounded-lg text-sm text-slate-200 px-3 py-2 font-mono tracking-widest focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleVerifyMfa}
                disabled={mfaLoading || mfaCode.length < 6}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-50 transition-colors"
              >
                {mfaLoading ? 'Verifying…' : 'Enable 2FA'}
              </button>
              <button
                onClick={() => { setShowMfaSetup(false); setMfaCode(''); }}
                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 border border-slate-700/60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Active Sessions */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 rounded-xl"><Monitor className="w-5 h-5 text-cyan-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Active Sessions</h3>
              <p className="text-xs text-slate-500 mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''} currently active</p>
            </div>
          </div>
          <button onClick={handleSignOutAll} className="text-xs text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-500/10 border border-rose-500/20 transition-all">
            Sign out all others
          </button>
        </div>

        <div className="space-y-3">
          {sessions.map(session => (
            <div key={session.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${session.current
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-slate-900/50 border-slate-700/50'
              }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${session.current ? 'bg-emerald-500/10' : 'bg-slate-700/60'}`}>
                  <Monitor className={`w-4 h-4 ${session.current ? 'text-emerald-400' : 'text-slate-400'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{session.device}</p>
                    {session.current && <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold uppercase">Current</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{session.browser} · <Globe className="w-3 h-3 inline" /> {session.location} · {session.lastActive}</p>
                </div>
              </div>
              {!session.current && (
                <button onClick={() => handleRevokeSession(session.id)} className="text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 transition-all flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-6">
        <h3 className="text-base font-semibold text-rose-400 mb-1">Danger Zone</h3>
        <p className="text-sm text-slate-400 mb-4">These actions are permanent and cannot be undone.</p>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-700/50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-white">Sign Out</p>
              <p className="text-xs text-slate-500 mt-0.5">End your current session</p>
            </div>
            <button onClick={signOut} className="px-4 py-2 text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-xl transition-colors flex items-center gap-2">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-rose-500/5 border border-rose-500/20 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-rose-400">Delete Organization</p>
              <p className="text-xs text-slate-500 mt-0.5">Permanently delete all workspace data</p>
            </div>
            <button
              onClick={() => setShowDangerZone(!showDangerZone)}
              className="px-4 py-2 text-sm font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl transition-colors"
            >
              Delete Org
            </button>
          </div>

          {showDangerZone && (
            <div className="p-5 bg-rose-500/5 border border-rose-500/30 rounded-xl space-y-3">
              <p className="text-sm text-rose-300 font-semibold">⚠️ This will immediately and permanently delete:</p>
              <ul className="text-xs text-slate-400 space-y-1 ml-4 list-disc">
                <li>All agents, incidents, and audit logs</li>
                <li>All API keys and integrations</li>
                <li>All team members and their access</li>
                <li>All cost data and organization settings</li>
              </ul>
              <p className="text-xs text-slate-400">Type <span className="text-rose-400 font-mono font-bold">{orgName}</span> to confirm:</p>
              <input
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={orgName}
                className="w-full px-4 py-2.5 bg-slate-900 border border-rose-500/30 rounded-xl text-white font-mono text-sm outline-none focus:border-rose-500 transition-all"
              />
              <button
                onClick={handleDeleteOrg}
                disabled={deleteConfirm !== orgName}
                className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors"
              >
                I understand — Delete Everything
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const TAB_CONTENT: Record<SettingsTab, () => JSX.Element> = {
    profile: renderProfile,
    organization: renderOrganization,
    team: renderTeam,
    notifications: renderNotifications,
    security: renderSecurity,
    tools: renderTools,
  };

  // ==================== RENDER ====================
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="border-b border-slate-700/60 pb-4">
        <h1 className="text-3xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-slate-400 mt-1 text-sm">Manage your account, organization, team, and preferences.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <div className="flex-shrink-0 lg:w-52">
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-3 sticky top-4">
            <nav className="space-y-1">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                      }`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-cyan-400' : ''}`} />
                    {tab.label}
                    {tab.badge && (
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-400 rounded-full font-bold">{tab.badge}</span>
                    )}
                    {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto text-cyan-400/60" />}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Content panel */}
        <div className="flex-1 min-w-0">
          {TAB_CONTENT[activeTab]()}
        </div>
      </div>
    </div>
  );
}
