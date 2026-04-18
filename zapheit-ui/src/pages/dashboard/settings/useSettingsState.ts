import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { toast } from '../../../lib/toast';
import { supabase } from '../../../lib/supabase-client';
import { api } from '../../../lib/api-client';
import { getFrontendConfig } from '../../../lib/config';
import type { ActiveSession, TeamEditorState, TeamMember } from './types';
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_RECONCILIATION_ALERT_CONFIG,
  DEFAULT_SEVERITY_ROUTING,
  DEMO_SESSIONS,
} from './constants';

export function useSettingsState({ isDemoMode = false }: { isDemoMode?: boolean }) {
  const { user, signOut } = useApp();

  const [displayName, setDisplayName] = useState(user?.organizationName || '');
  const [editingName, setEditingName] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const [orgName, setOrgName] = useState(user?.organizationName || '');
  const [providerDisplayName, setProviderDisplayName] = useState('Zapheit AI');
  const [dataRetention, setDataRetention] = useState(90);
  const [savingOrg, setSavingOrg] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [usageData, setUsageData] = useState<{ used: number; quota: number; plan: string; planKey: string; month: string } | null>(null);
  const [workspaceTimezone, setWorkspaceTimezone] = useState('Asia/Kolkata');
  const [defaultResponseStyle, setDefaultResponseStyle] = useState('Balanced');

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

  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [severityRouting, setSeverityRouting] = useState(DEFAULT_SEVERITY_ROUTING);
  const [teamEditor, setTeamEditor] = useState<TeamEditorState>(null);

  const [profileBaseline, setProfileBaseline] = useState('');
  const [workspaceBaseline, setWorkspaceBaseline] = useState('');
  const [alertsBaseline, setAlertsBaseline] = useState('');
  const [teamBaseline, setTeamBaseline] = useState('');

  const [slackWebhook, setSlackWebhook] = useState('');
  const [pagerdutyKey, setPagerdutyKey] = useState('');
  const [alertEmail, setAlertEmail] = useState(user?.email || '');
  const [testingChannel, setTestingChannel] = useState<'slack' | 'pagerduty' | 'email' | null>(null);
  const [channelSaved, setChannelSaved] = useState(false);
  const [reconciliationAlertConfig, setReconciliationAlertConfig] = useState(DEFAULT_RECONCILIATION_ALERT_CONFIG);
  const [savingReconciliationConfig, setSavingReconciliationConfig] = useState(false);

  const [sessions, setSessions] = useState<ActiveSession[]>(
    isDemoMode
      ? DEMO_SESSIONS
      : [{ id: 's-current', device: 'This device', browser: 'Current browser', location: 'Your location', lastActive: 'Now', current: true }]
  );
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
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
  const [memberSince, setMemberSince] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('rasi_alert_channels');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed.slackWebhook) setSlackWebhook(parsed.slackWebhook);
      if (parsed.pagerdutyKey) setPagerdutyKey(parsed.pagerdutyKey);
      if (parsed.alertEmail) setAlertEmail(parsed.alertEmail);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadReconciliationConfig = async () => {
      const response = await api.admin.getCoverageStatus();
      if (!response.success || !response.data || cancelled) return;
      setReconciliationAlertConfig(response.data.reconciliationAlertConfig);
    };
    void loadReconciliationConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
        const res = await fetch(`${apiUrl}/usage`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (json.success && json.data) setUsageData(json.data);
      } catch {}
    };
    void load();
    return () => { cancelled = true; };
  }, []);

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
    const savedTimezone = localStorage.getItem('synthetic_hr_workspace_timezone');
    if (savedTimezone) setWorkspaceTimezone(savedTimezone);
    const savedResponseStyle = localStorage.getItem('synthetic_hr_default_response_style');
    if (savedResponseStyle) setDefaultResponseStyle(savedResponseStyle);
    const savedNotifications = localStorage.getItem('synthetic_hr_notifications_config');
    if (savedNotifications) {
      try { setNotifications(JSON.parse(savedNotifications)); } catch {}
    }
    const savedSeverityRouting = localStorage.getItem('synthetic_hr_severity_routing');
    if (savedSeverityRouting) {
      try { setSeverityRouting(JSON.parse(savedSeverityRouting)); } catch {}
    }
  }, []);

  useEffect(() => {
    const savedRetention = localStorage.getItem('synthetic_hr_retention');
    if (savedRetention) setDataRetention(parseInt(savedRetention, 10));

    if (!isDemoMode) {
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

  useEffect(() => {
    setProfileBaseline(JSON.stringify({ displayName, profileImage, workspaceTimezone, defaultResponseStyle }));
    setWorkspaceBaseline(JSON.stringify({ orgName, dataRetention }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!alertsBaseline) {
      setAlertsBaseline(JSON.stringify({
        notifications,
        severityRouting,
        slackWebhook,
        pagerdutyKey,
        alertEmail,
        reconciliationAlertConfig,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertsBaseline, notifications, severityRouting, slackWebhook, pagerdutyKey, alertEmail, reconciliationAlertConfig]);

  useEffect(() => {
    if (!teamBaseline && teamMembers.length > 0) {
      setTeamBaseline(JSON.stringify(teamMembers));
    }
  }, [teamBaseline, teamMembers]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    await new Promise((r) => setTimeout(r, 600));
    localStorage.setItem('synthetic_hr_display_name', displayName);
    localStorage.setItem('synthetic_hr_workspace_timezone', workspaceTimezone);
    localStorage.setItem('synthetic_hr_default_response_style', defaultResponseStyle);
    setProfileBaseline(JSON.stringify({ displayName, profileImage, workspaceTimezone, defaultResponseStyle }));
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
      const { API_BASE_URL } = await import('../../../lib/api/_helpers');
      const res = await fetch(`${API_BASE_URL}/compliance/data-export.zip`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!res.ok) {
        toast.error('Export failed. Please try again.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zapheit-data-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Full data export downloaded.');
    } catch {
      toast.error('Export failed.');
    }
    setExportingData(false);
  };

  const handleSaveOrg = async () => {
    setSavingOrg(true);
    try {
      localStorage.setItem('synthetic_hr_org_name', orgName);
      localStorage.setItem('synthetic_hr_retention', dataRetention.toString());
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
        await fetch(`${apiUrl}/organizations/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ branding: { provider_name: providerDisplayName.trim() || 'Zapheit AI' } }),
        });
      }
    } catch { /* non-fatal */ }
    setWorkspaceBaseline(JSON.stringify({ orgName, dataRetention, providerDisplayName }));
    setSavingOrg(false);
    toast.success('Organization settings saved.');
  };

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.warning('Enter an email address');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
      toast.warning('Enter a valid email');
      return;
    }
    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
        await fetch(`${apiUrl}/invites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        });
      }
    } catch {}

    const nextMembers: TeamMember[] = [...teamMembers, {
      id: crypto.randomUUID(),
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: inviteRole,
      status: 'pending' as const,
      joinedAt: new Date().toISOString(),
    }];
    setTeamMembers(nextMembers);
    setInviteEmail('');
    setShowInviteModal(false);
    setInviting(false);
    toast.success(`Invitation sent to ${inviteEmail}`);
  };

  const handleSaveTeamAccess = async () => {
    await new Promise((r) => setTimeout(r, 400));
    setTeamBaseline(JSON.stringify(teamMembers));
    toast.success('Team access updated.');
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    await new Promise((r) => setTimeout(r, 500));
    localStorage.setItem('synthetic_hr_notifications_config', JSON.stringify(notifications));
    localStorage.setItem('synthetic_hr_severity_routing', JSON.stringify(severityRouting));
    localStorage.setItem('rasi_alert_channels', JSON.stringify({ slackWebhook, pagerdutyKey, alertEmail }));
    setAlertsBaseline(JSON.stringify({
      notifications,
      severityRouting,
      slackWebhook,
      pagerdutyKey,
      alertEmail,
      reconciliationAlertConfig,
    }));
    setSavingNotifications(false);
    toast.success('Notification preferences saved.');
  };

  const applyAlertPreset = (preset: 'quiet' | 'balanced' | 'critical_only' | 'ops_heavy') => {
    const updated = notifications.map((rule) => {
      if (preset === 'quiet') {
        return { ...rule, channels: { slack: false, email: rule.id === 'weekly.digest', pagerduty: false } };
      }
      if (preset === 'critical_only') {
        const critical = rule.id === 'incident.critical' || rule.id === 'agent.terminated';
        return { ...rule, channels: { slack: critical, email: critical, pagerduty: rule.id === 'incident.critical' } };
      }
      if (preset === 'ops_heavy') {
        return { ...rule, channels: { slack: true, email: rule.id !== 'incident.created', pagerduty: rule.id === 'incident.critical' || rule.id === 'agent.terminated' } };
      }
      return {
        ...rule,
        channels: {
          slack: rule.id !== 'cost.threshold' && rule.id !== 'key.rotated' && rule.id !== 'weekly.digest',
          email: rule.id !== 'incident.created' && rule.id !== 'incident.resolved',
          pagerduty: rule.id === 'incident.critical',
        },
      };
    });
    setNotifications(updated);
    toast.success('Alert preset applied.');
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
    setAlertsBaseline(JSON.stringify({
      notifications,
      severityRouting,
      slackWebhook,
      pagerdutyKey,
      alertEmail,
      reconciliationAlertConfig,
    }));
    toast.success('Reconciliation alert settings saved.');
  };

  const saveChannelConfig = () => {
    localStorage.setItem('rasi_alert_channels', JSON.stringify({ slackWebhook, pagerdutyKey, alertEmail }));
    setChannelSaved(true);
    toast.success('Alert channels saved successfully.');
    setTimeout(() => setChannelSaved(false), 2500);
  };

  const testChannel = async (channel: 'slack' | 'pagerduty' | 'email') => {
    setTestingChannel(channel);
    await new Promise((r) => setTimeout(r, 1200));
    setTestingChannel(null);
    const msgs = {
      slack: slackWebhook ? '✅ Test ping sent to Slack!' : '⚠️ Enter a Slack Webhook URL first.',
      pagerduty: pagerdutyKey ? '✅ Test alert sent to PagerDuty!' : '⚠️ Enter a PagerDuty Routing Key first.',
      email: alertEmail ? `✅ Test email sent to ${alertEmail}!` : '⚠️ Enter an email address first.',
    };
    const ok = channel === 'slack' ? !!slackWebhook : channel === 'pagerduty' ? !!pagerdutyKey : !!alertEmail;
    if (ok) toast.success(msgs[channel]); else toast.warning(msgs[channel]);
  };

  const handleRevokeSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    toast.success('Session revoked.');
  };

  const handleResendInvite = (member: TeamMember) => {
    toast.success(`Invitation resent to ${member.email}`);
  };

  const handleToggleMemberAccess = (memberId: string) => {
    setTeamMembers((prev) => prev.map((member) => {
      if (member.id !== memberId || member.role === 'admin') return member;
      if (member.status === 'suspended') {
        return { ...member, status: 'active' as const, lastActive: 'Just restored' };
      }
      return { ...member, status: 'suspended' as const, lastActive: 'Access suspended' };
    }));
    toast.success('Member access updated.');
  };

  const currentProfileSnapshot = JSON.stringify({ displayName, profileImage, workspaceTimezone, defaultResponseStyle });
  const currentWorkspaceSnapshot = JSON.stringify({ orgName, dataRetention });
  const currentAlertsSnapshot = JSON.stringify({ notifications, severityRouting, slackWebhook, pagerdutyKey, alertEmail, reconciliationAlertConfig });
  const currentTeamSnapshot = JSON.stringify(teamMembers);

  const dirtyState = useMemo(() => ({
    workspace: profileBaseline !== '' && currentProfileSnapshot !== profileBaseline,
    billing_data: workspaceBaseline !== '' && currentWorkspaceSnapshot !== workspaceBaseline,
    alerts: alertsBaseline !== '' && currentAlertsSnapshot !== alertsBaseline,
    team_access: teamBaseline !== '' && currentTeamSnapshot !== teamBaseline,
  }), [alertsBaseline, currentAlertsSnapshot, currentProfileSnapshot, currentTeamSnapshot, currentWorkspaceSnapshot, profileBaseline, teamBaseline, workspaceBaseline]);

  const hasUnsavedChanges = useMemo(() => Object.values(dirtyState).some(Boolean), [dirtyState]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleSignOutAll = async () => {
    toast.success('Signing out all other sessions…');
    setSessions((prev) => prev.filter((s) => s.current));
  };

  const handleDeleteOrg = async () => {
    if (deleteConfirm !== orgName) {
      toast.error('Organization name does not match');
      return;
    }
    toast.error('Account deletion requested — this would be confirmed by email in production.');
    setDeleteConfirm('');
    setShowDangerZone(false);
  };

  const handleToggle2FA = async () => {
    if (isDemoMode) {
      const next = !twoFactorEnabled;
      setTwoFactorEnabled(next);
      localStorage.setItem('synthetic_hr_2fa', next.toString());
      toast.success(next ? '2FA enabled (demo)' : '2FA disabled (demo)');
      return;
    }

    if (twoFactorEnabled) {
      if (!mfaFactorId) return;
      setMfaLoading(true);
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
      setMfaLoading(false);
      if (error) {
        toast.error(`Failed to disable 2FA: ${error.message}`);
        return;
      }
      setTwoFactorEnabled(false);
      setMfaFactorId(null);
      toast.success('Two-factor authentication disabled.');
    } else {
      setMfaLoading(true);
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      setMfaLoading(false);
      if (error || !data) {
        toast.error(`Failed to start 2FA setup: ${error?.message || 'Unknown error'}`);
        return;
      }
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
    if (!challenge) {
      setMfaLoading(false);
      toast.error('Failed to create MFA challenge');
      return;
    }
    const { error } = await supabase.auth.mfa.verify({ factorId: mfaEnrollId, challengeId: challenge.id, code: mfaCode });
    setMfaLoading(false);
    if (error) {
      toast.error(`Verification failed: ${error.message}`);
      return;
    }
    setTwoFactorEnabled(true);
    setMfaFactorId(mfaEnrollId);
    setShowMfaSetup(false);
    setMfaCode('');
    toast.success('Two-factor authentication enabled successfully.');
  };

  return {
    user,
    signOut,
    displayName,
    setDisplayName,
    editingName,
    setEditingName,
    savingProfile,
    profileImage,
    orgName,
    setOrgName,
    providerDisplayName,
    setProviderDisplayName,
    dataRetention,
    setDataRetention,
    savingOrg,
    exportingData,
    usageData,
    workspaceTimezone,
    setWorkspaceTimezone,
    defaultResponseStyle,
    setDefaultResponseStyle,
    teamMembers,
    setTeamMembers,
    showInviteModal,
    setShowInviteModal,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    inviting,
    notifications,
    setNotifications,
    savingNotifications,
    severityRouting,
    setSeverityRouting,
    teamEditor,
    setTeamEditor,
    slackWebhook,
    setSlackWebhook,
    pagerdutyKey,
    setPagerdutyKey,
    alertEmail,
    setAlertEmail,
    testingChannel,
    channelSaved,
    reconciliationAlertConfig,
    setReconciliationAlertConfig,
    savingReconciliationConfig,
    sessions,
    showUpgradeModal,
    setShowUpgradeModal,
    showDangerZone,
    setShowDangerZone,
    deleteConfirm,
    setDeleteConfirm,
    twoFactorEnabled,
    mfaLoading,
    showMfaSetup,
    setShowMfaSetup,
    mfaQrUri,
    mfaSecret,
    mfaCode,
    setMfaCode,
    memberSince,
    saveChannelConfig,
    testChannel,
    handleSaveProfile,
    handleProfileImageUpload,
    handleRemoveProfileImage,
    handleExportAllData,
    handleSaveOrg,
    handleInvite,
    handleSaveTeamAccess,
    handleSaveNotifications,
    applyAlertPreset,
    handleSaveReconciliationConfig,
    handleRevokeSession,
    handleResendInvite,
    handleToggleMemberAccess,
    dirtyState,
    currentProfileSnapshot,
    currentWorkspaceSnapshot,
    currentAlertsSnapshot,
    currentTeamSnapshot,
    setProfileBaseline,
    setWorkspaceBaseline,
    setAlertsBaseline,
    setTeamBaseline,
    handleSignOutAll,
    handleDeleteOrg,
    handleToggle2FA,
    handleVerifyMfa,
  };
}
