import { lazy, Suspense, useEffect, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  User, Building2, Users, Bell, Shield,
  Save, ChevronRight, X, RefreshCw, Copy, Zap,
  Sparkles, DollarSign, Mail, Edit3, Check, ImagePlus, MessageCircle
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { PageHero } from '../../components/dashboard/PageHero';
import type {
  SettingsTab,
} from './settings/types';
import { useSettingsState } from './settings/useSettingsState';

const OverviewSection = lazy(async () => {
  const mod = await import('./settings/OverviewSection');
  return { default: mod.OverviewSection };
});
const AdvancedSection = lazy(async () => {
  const mod = await import('./settings/AdvancedSection');
  return { default: mod.AdvancedSection };
});
const TeamAccessSection = lazy(async () => {
  const mod = await import('./settings/TeamAccessSection');
  return { default: mod.TeamAccessSection };
});
const WorkspaceSection = lazy(async () => {
  const mod = await import('./settings/WorkspaceSection');
  return { default: mod.WorkspaceSection };
});
const BillingDataSection = lazy(async () => {
  const mod = await import('./settings/BillingDataSection');
  return { default: mod.BillingDataSection };
});
const AlertsSection = lazy(async () => {
  const mod = await import('./settings/AlertsSection');
  return { default: mod.AlertsSection };
});
const SecuritySection = lazy(async () => {
  const mod = await import('./settings/SecuritySection');
  return { default: mod.SecuritySection };
});

function SettingsSectionLoading() {
  return (
    <div className="min-h-[32vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/15 border-t-cyan-300" />
    </div>
  );
}

const SETTINGS_TABS: SettingsTab[] = ['overview', 'workspace', 'team_access', 'alerts', 'security', 'billing_data', 'advanced'];

function normalizeSettingsTab(value: string | null | undefined): SettingsTab | null {
  if (!value) return null;
  return SETTINGS_TABS.includes(value as SettingsTab) ? value as SettingsTab : null;
}

// ==================== MAIN COMPONENT ====================
export default function SettingsPage({ onNavigate, isDemoMode = false }: { onNavigate?: (page: string) => void; isDemoMode?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const pathSuffix = location.pathname.replace(/^.*\/dashboard\/settings\/?/, '');
  const routeTab = normalizeSettingsTab(pathSuffix.split('/')[0] || null);
  const queryTab = normalizeSettingsTab(new URLSearchParams(location.search).get('section'));
  const activeTab: SettingsTab = routeTab || queryTab || 'overview';
  const {
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
  } = useSettingsState({ isDemoMode });

  const navigateToTab = (tab: SettingsTab, replace = false) => {
    const targetPath = tab === 'overview' ? '/dashboard/settings' : `/dashboard/settings/${tab}`;
    if (location.pathname === targetPath && !location.search) return;
    navigate(targetPath, { replace });
  };

  useEffect(() => {
    if (queryTab) {
      navigateToTab(queryTab, true);
      return;
    }

    if (!routeTab && pathSuffix) {
      navigateToTab('overview', true);
    }
  }, [navigate, pathSuffix, queryTab, routeTab]);

  // ==================== SUB-VIEWS ====================
  const renderOverview = () => {
    const activeMembers = teamMembers.filter((member) => member.status === 'active').length;
    const pendingMembers = teamMembers.filter((member) => member.status === 'pending').length;
    const configuredChannels = [slackWebhook, pagerdutyKey, alertEmail].filter(Boolean).length;
    const quotaPct = usageData && usageData.quota > 0 ? Math.min(100, Math.round((usageData.used / usageData.quota) * 100)) : 0;

    const recommendedActions = [];
    if (!twoFactorEnabled) {
      recommendedActions.push({
        key: 'enable-2fa',
        action: () => navigateToTab('security'),
        title: 'Enable two-factor authentication',
        detail: 'Protect admin access before adding more operators.',
        tone: 'amber' as const,
      });
    }
    if (configuredChannels < 2) {
      recommendedActions.push({
        key: 'complete-alert-routing',
        action: () => navigateToTab('alerts'),
        title: 'Complete alert routing',
        detail: 'Set Slack, email, or PagerDuty so critical events do not stay in-app only.',
        tone: 'amber' as const,
      });
    }
    if (pendingMembers > 0) {
      recommendedActions.push({
        key: 'review-pending-invites',
        action: () => navigateToTab('team_access'),
        title: 'Review pending team invitations',
        detail: 'Confirm access before more workspace activity starts to spread.',
        tone: 'cyan' as const,
      });
    }
    if (quotaPct >= 80) {
      recommendedActions.push({
        key: 'review-plan-capacity',
        action: () => navigateToTab('billing_data'),
        title: 'Plan capacity is getting tight',
        detail: `${quotaPct}% of monthly quota used. Review plan and data controls.`,
        tone: 'rose' as const,
      });
    }

    return (
      <OverviewSection
        title="Settings Overview"
        subtitle="Know what is configured, what needs attention, and what to do next."
        cards={[
          {
            label: 'Workspace health',
            value: `${orgName || 'Workspace'} ready`,
            detail: `${usageData?.plan || 'Plan'} · ${dataRetention} day retention · ${workspaceTimezone}`,
            action: () => navigateToTab('workspace'),
            cta: 'Review workspace',
          },
          {
            label: 'Security status',
            value: twoFactorEnabled ? 'Protected' : 'Needs attention',
            detail: `${twoFactorEnabled ? '2FA enabled' : 'Enable 2FA'} · ${sessions.length} active session${sessions.length !== 1 ? 's' : ''}`,
            action: () => navigateToTab('security'),
            cta: twoFactorEnabled ? 'Open security' : 'Turn on 2FA',
          },
          {
            label: 'Alert coverage',
            value: configuredChannels >= 2 ? 'Healthy' : 'Incomplete',
            detail: `${configuredChannels}/3 alert channels configured`,
            action: () => navigateToTab('alerts'),
            cta: configuredChannels >= 2 ? 'Tune alerts' : 'Finish setup',
          },
          {
            label: 'Team access',
            value: `${activeMembers} active`,
            detail: pendingMembers > 0 ? `${pendingMembers} invite${pendingMembers !== 1 ? 's' : ''} pending` : 'No pending invites',
            action: () => navigateToTab('team_access'),
            cta: pendingMembers > 0 ? 'Review access' : 'Manage team',
          },
        ]}
        recommendedActions={recommendedActions}
        orgName={orgName}
        activeMembers={activeMembers}
        configuredChannels={configuredChannels}
        dataRetention={dataRetention}
      />
    );
  };

  const renderWorkspace = () => (
    <WorkspaceSection
      orgName={orgName}
      setOrgName={setOrgName}
      providerDisplayName={providerDisplayName}
      setProviderDisplayName={setProviderDisplayName}
      workspaceTimezone={workspaceTimezone}
      setWorkspaceTimezone={setWorkspaceTimezone}
      defaultResponseStyle={defaultResponseStyle}
      setDefaultResponseStyle={setDefaultResponseStyle}
      profileSection={renderProfile()}
      handleSaveProfile={() => void handleSaveProfile()}
      savingProfile={savingProfile}
    />
  );

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
    <BillingDataSection
      usageData={usageData}
      orgName={orgName}
      setOrgName={setOrgName}
      dataRetention={dataRetention}
      setDataRetention={setDataRetention}
      handleSaveOrg={() => void handleSaveOrg()}
      savingOrg={savingOrg}
      setShowUpgradeModal={setShowUpgradeModal}
      handleExportAllData={() => void handleExportAllData()}
      exportingData={exportingData}
      billingContactName={displayName || user?.organizationName || 'Workspace Admin'}
      billingContactEmail={user?.email || ''}
    />
  );

  // ==================== MORE TOOLS ====================
  const renderTools = () => <AdvancedSection onNavigate={onNavigate} />;

  const renderTeam = () => (
    <TeamAccessSection
      teamMembers={teamMembers}
      setTeamMembers={setTeamMembers}
      showInviteModal={showInviteModal}
      setShowInviteModal={setShowInviteModal}
      inviteEmail={inviteEmail}
      setInviteEmail={setInviteEmail}
      inviteRole={inviteRole}
      setInviteRole={setInviteRole}
      inviting={inviting}
      handleInvite={handleInvite}
      dirty={dirtyState.team_access}
      handleSaveTeamAccess={() => void handleSaveTeamAccess()}
      handleResendInvite={handleResendInvite}
      handleToggleMemberAccess={handleToggleMemberAccess}
      teamEditor={teamEditor}
      setTeamEditor={setTeamEditor}
    />
  );

  const renderNotifications = () => (
    <AlertsSection
      slackWebhook={slackWebhook}
      setSlackWebhook={setSlackWebhook}
      pagerdutyKey={pagerdutyKey}
      setPagerdutyKey={setPagerdutyKey}
      alertEmail={alertEmail}
      setAlertEmail={setAlertEmail}
      saveChannelConfig={saveChannelConfig}
      channelSaved={channelSaved}
      testingChannel={testingChannel}
      testChannel={testChannel}
      applyAlertPreset={applyAlertPreset}
      severityRouting={severityRouting}
      setSeverityRouting={setSeverityRouting}
      reconciliationAlertConfig={reconciliationAlertConfig}
      setReconciliationAlertConfig={setReconciliationAlertConfig}
      handleSaveReconciliationConfig={() => void handleSaveReconciliationConfig()}
      savingReconciliationConfig={savingReconciliationConfig}
      notifications={notifications}
      setNotifications={setNotifications}
      handleSaveNotifications={() => void handleSaveNotifications()}
      savingNotifications={savingNotifications}
    />
  );

  const renderSecurity = () => (
    <SecuritySection
      userRole={user?.role}
      twoFactorEnabled={twoFactorEnabled}
      sessions={sessions}
      handleToggle2FA={handleToggle2FA}
      mfaLoading={mfaLoading}
      showMfaSetup={showMfaSetup}
      mfaQrUri={mfaQrUri}
      mfaSecret={mfaSecret}
      mfaCode={mfaCode}
      setMfaCode={setMfaCode}
      handleVerifyMfa={handleVerifyMfa}
      setShowMfaSetup={setShowMfaSetup}
      handleSignOutAll={handleSignOutAll}
      handleRevokeSession={handleRevokeSession}
      orgName={orgName}
      signOut={signOut}
      showDangerZone={showDangerZone}
      setShowDangerZone={setShowDangerZone}
      deleteConfirm={deleteConfirm}
      setDeleteConfirm={setDeleteConfirm}
      handleDeleteOrg={handleDeleteOrg}
    />
  );

  const TAB_CONTENT: Record<SettingsTab, () => JSX.Element> = {
    overview: renderOverview,
    workspace: renderWorkspace,
    team_access: renderTeam,
    alerts: renderNotifications,
    security: renderSecurity,
    billing_data: renderOrganization,
    advanced: renderTools,
  };

  const tabItems: { id: SettingsTab; label: string; icon: React.ElementType; badge?: string }[] = [
    { id: 'overview', label: 'Overview', icon: Sparkles },
    { id: 'workspace', label: 'Workspace', icon: Building2 },
    { id: 'team_access', label: 'Team & Access', icon: Users, badge: teamMembers.some((member) => member.status === 'pending') ? String(teamMembers.filter((member) => member.status === 'pending').length) : undefined },
    { id: 'alerts', label: 'Alerts', icon: Bell, badge: (!slackWebhook || !pagerdutyKey) ? '!' : undefined },
    { id: 'security', label: 'Security', icon: Shield, badge: twoFactorEnabled ? undefined : '!' },
    { id: 'billing_data', label: 'Billing & Data', icon: DollarSign, badge: usageData && usageData.quota > 0 && usageData.used / usageData.quota >= 0.8 ? '!' : undefined },
    { id: 'advanced', label: 'Advanced', icon: Zap },
  ];

  const activeTabHasUnsavedChanges = activeTab === 'workspace'
    ? dirtyState.workspace
    : activeTab === 'billing_data'
      ? dirtyState.billing_data
      : activeTab === 'alerts'
        ? dirtyState.alerts
        : activeTab === 'team_access'
          ? dirtyState.team_access
          : false;

  const handleSaveActiveSection = async () => {
    if (activeTab === 'workspace') {
      await handleSaveProfile();
      return;
    }
    if (activeTab === 'billing_data') {
      await handleSaveOrg();
      return;
    }
    if (activeTab === 'alerts') {
      await handleSaveNotifications();
      await handleSaveReconciliationConfig();
      return;
    }
    if (activeTab === 'team_access') {
      await handleSaveTeamAccess();
    }
  };

  // ==================== RENDER ====================
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHero
        eyebrow="Settings"
        title="Manage your workspace"
        subtitle="Configure access, alerts, security, and billing in one place."
        recommendation={(() => {
          const recAction = (() => {
            if (!twoFactorEnabled) return { title: 'Enable two-factor authentication', detail: 'Protect admin access with 2FA before adding more team members.' };
            const configuredChannels = [slackWebhook, pagerdutyKey, alertEmail].filter(Boolean).length;
            if (configuredChannels < 2) return { title: 'Set up more alert channels', detail: `Only ${configuredChannels}/3 alert channels configured. Add Slack, email, or PagerDuty.` };
            return null;
          })();
          return recAction ? {
            label: 'Recommended next step',
            title: recAction.title,
            detail: recAction.detail,
          } : undefined;
        })()}
        stats={[
          { label: '2FA', value: twoFactorEnabled ? 'Enabled' : 'Off', detail: `${sessions.length} active session${sessions.length !== 1 ? 's' : ''}` },
          { label: 'Alert channels', value: `${[slackWebhook, pagerdutyKey, alertEmail].filter(Boolean).length}/3`, detail: 'Configured routing types' },
          { label: 'Pending invites', value: `${teamMembers.filter((member) => member.status === 'pending').length}`, detail: 'People waiting for access' },
        ]}
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <div className="flex-shrink-0 lg:w-52">
          <div className="border border-white/[0.10] bg-white/[0.05] rounded-2xl p-3 sticky top-4 glass glass-glow">
            <nav className="space-y-1">
              {tabItems.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                const isDirty = tab.id === 'workspace'
                  ? dirtyState.workspace
                  : tab.id === 'billing_data'
                    ? dirtyState.billing_data
                    : tab.id === 'alerts'
                      ? dirtyState.alerts
                      : tab.id === 'team_access'
                        ? dirtyState.team_access
                        : false;
                return (
                  <button
                    key={tab.id}
                    onClick={() => navigateToTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive
                      ? 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/25 shadow-[0_0_16px_rgba(34,211,238,0.08)]'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                      }`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-cyan-300' : ''}`} />
                    {tab.label}
                    {isDirty && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-amber-400" />
                    )}
                    {tab.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-400 rounded-full font-bold">{tab.badge}</span>
                    )}
                    {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-400" />}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Content panel */}
        <div className="flex-1 min-w-0">
          <Suspense fallback={<SettingsSectionLoading />}>
            {TAB_CONTENT[activeTab]()}
          </Suspense>
        </div>
      </div>

      {/* Upgrade modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowUpgradeModal(false)}>
          <div className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl p-8 shadow-2xl" onClick={(e: MouseEvent) => e.stopPropagation()}>
            <button onClick={() => setShowUpgradeModal(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>

            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400 mb-1">Upgrade your plan</p>
            <h2 className="text-2xl font-bold text-white mb-1">You're on <span className="text-cyan-300">{usageData?.plan ?? 'Free'}</span></h2>
            <p className="text-sm text-slate-400 mb-8">Tell us which plan you'd like — we'll reach out within one business day to get you set up.</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[
                {
                  key: 'audit',
                  name: 'The Audit',
                  price: '₹25,000',
                  cadence: 'one-time',
                  color: 'border-slate-700/60',
                  highlights: ['AI Workforce Health Scan', 'Risk score report', 'Up to 5 agents assessed'],
                  waText: `Hi, I'm on Zapheit (org: ${orgName}) and I'd like to upgrade to The Audit plan. Can we connect?`,
                },
                {
                  key: 'retainer',
                  name: 'The Retainer',
                  price: '₹40k–60k',
                  cadence: '/month',
                  color: 'border-cyan-500/40',
                  badge: 'Most popular',
                  highlights: ['200k gateway requests/month', 'Real-time PII detection', 'Action policies & kill switch'],
                  waText: `Hi, I'm on Zapheit (org: ${orgName}) and I'd like to upgrade to The Retainer plan. Can we connect?`,
                },
                {
                  key: 'enterprise',
                  name: 'Enterprise',
                  price: 'Custom',
                  cadence: '',
                  color: 'border-emerald-500/30',
                  highlights: ['Unlimited gateway requests', 'VPC / on-prem runtime', 'Dedicated governance manager'],
                  waText: `Hi, I'm on Zapheit (org: ${orgName}) and I'd like to discuss Enterprise pricing. Can we connect?`,
                },
              ].map(plan => {
                const isCurrent = usageData?.planKey === plan.key;
                return (
                  <div key={plan.key} className={`relative flex flex-col gap-3 rounded-2xl border p-5 ${plan.color} ${isCurrent ? 'opacity-50 cursor-default' : 'bg-slate-800/40'}`}>
                    {plan.badge && !isCurrent && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500 text-white">
                        {plan.badge}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-600 text-slate-300">
                        Current plan
                      </span>
                    )}
                    <div>
                      <p className="font-bold text-white text-sm">{plan.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{plan.price}{plan.cadence}</p>
                    </div>
                    <ul className="space-y-1.5 flex-1">
                      {plan.highlights.map(h => (
                        <li key={h} className="flex items-start gap-1.5 text-xs text-slate-300">
                          <Check className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                          {h}
                        </li>
                      ))}
                    </ul>
                    {!isCurrent && (
                      <button
                        onClick={() => { window.open(`https://wa.me/919433116259?text=${encodeURIComponent(plan.waText)}`, '_blank'); setShowUpgradeModal(false); }}
                        className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                        Request upgrade
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-center text-xs text-slate-500">
              We'll confirm your upgrade and handle onboarding personally.{' '}
              <span className="text-slate-400">No automated billing — you stay in control.</span>
            </p>
          </div>
        </div>
      )}

      {activeTabHasUnsavedChanges && (
        <div className="fixed bottom-6 right-6 z-40 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-cyan-500/20 bg-slate-900/95 backdrop-blur-xl p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-cyan-500/10 p-2">
              <Save className="w-4 h-4 text-cyan-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">You have unsaved changes</p>
              <p className="text-xs text-slate-400 mt-1">
                Save this section before you leave so your workspace configuration stays in sync.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void handleSaveActiveSection()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-semibold hover:from-cyan-400 hover:to-blue-400 transition-all"
                >
                  Save now
                </button>
                <button
                  onClick={() => {
                    if (activeTab === 'workspace') setProfileBaseline(currentProfileSnapshot);
                    if (activeTab === 'billing_data') setWorkspaceBaseline(currentWorkspaceSnapshot);
                    if (activeTab === 'alerts') setAlertsBaseline(currentAlertsSnapshot);
                    if (activeTab === 'team_access') setTeamBaseline(currentTeamSnapshot);
                    toast.success('Changes dismissed for this section.');
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
